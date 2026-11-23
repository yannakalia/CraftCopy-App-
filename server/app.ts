import './fontInit';
import express from 'express';
import path from 'path';
import fs from 'fs';
import dns from 'dns';
import net from 'net';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  renderPromotionalPosterPng,
  exportPosterImageForDownload,
  PosterAesthetic,
  AspectRatioFormat,
  DesignVariation,
  CustomPosterColors,
} from './posterRenderer';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const GEMINI_MODEL = 'gemini-3.1-flash-lite';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const GENERATED_POSTERS_BUCKET = 'generated-posters';
// AWS Lambda / Netlify synchronous response cap is 6 MB (base64 expands binary by ~4/3)
const MAX_SERVERLESS_BINARY_BYTES = 4_200_000;

export function isServerlessRuntime(): boolean {
  return Boolean(
    process.env.NETLIFY ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.LAMBDA_TASK_ROOT
  );
}

const uploadsDir = path.join(process.cwd(), 'public/uploads');
const resolvedUploadsDir = path.resolve(uploadsDir);

function ensureLocalUploadsDir(): void {
  if (isServerlessRuntime()) return;
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
}

// Lightweight in-memory rate limiter for API routes
const apiRateStore = new Map<string, { count: number; resetAt: number }>();
function apiRateLimiter(maxPerMinute = 120) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const existing = apiRateStore.get(ip);

    if (!existing || now > existing.resetAt) {
      if (apiRateStore.size > 5000) {
        apiRateStore.clear();
      }
      apiRateStore.set(ip, { count: 1, resetAt: now + 60_000 });
      return next();
    }

    if (existing.count >= maxPerMinute) {
      return res.status(429).json({
        success: false,
        error: 'Too many requests. Please wait a moment and try again.',
      });
    }

    existing.count += 1;
    return next();
  };
}

// ---------------------------------------------------------------------------
// Helpers: Sanitization, SSRF Protection, Image Verification & EXIF Stripping
// ---------------------------------------------------------------------------

function sanitizeText(value: unknown, maxLength = 2000): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .slice(0, maxLength);
}

function isUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function isPrivateOrBlockedIp(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^::ffff:/, '');
  if (!net.isIP(normalized)) return false;

  if (net.isIPv4(normalized)) {
    const parts = normalized.split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // Cloud metadata / link-local
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // Multicast / reserved
    return false;
  }

  // IPv6 loopback, unspecified, ULA (fc00::/7), link-local (fe80::/10)
  if (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  ) {
    return true;
  }
  return false;
}

async function validateSafeExternalImageUrl(rawUrl: string): Promise<URL | null> {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:') return null;

    const host = parsed.hostname.toLowerCase();
    if (
      !host ||
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      isPrivateOrBlockedIp(host)
    ) {
      return null;
    }

    const addresses = await dns.promises.lookup(host, { all: true });
    if (!addresses || addresses.length === 0) return null;
    for (const entry of addresses) {
      if (isPrivateOrBlockedIp(entry.address)) {
        return null;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

function isSafeImageReference(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.length > 12 * 1024 * 1024) return false;
  if (trimmed.startsWith('/uploads/')) {
    const safeName = path.basename(trimmed);
    return safeName === trimmed.slice('/uploads/'.length) && /^[a-zA-Z0-9._-]+$/.test(safeName);
  }
  if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
    return true;
  }
  if (/^https:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const host = parsed.hostname.toLowerCase();
      return Boolean(
        host &&
          host !== 'localhost' &&
          !host.endsWith('.local') &&
          !host.endsWith('.internal') &&
          !isPrivateOrBlockedIp(host)
      );
    } catch {
      return false;
    }
  }
  return false;
}

async function sanitizeRasterImageBuffer(
  rawBuffer: Buffer
): Promise<{ buffer: Buffer; mimeType: string; ext: 'png' | 'jpg' | 'webp' }> {
  if (!rawBuffer || rawBuffer.length === 0 || rawBuffer.length > MAX_IMAGE_BYTES) {
    throw new Error('Image must be non-empty and under 10 MB.');
  }

  const meta = await sharp(rawBuffer, { failOn: 'error' }).metadata();
  const fmt = (meta.format || '').toLowerCase();
  if (!['png', 'jpeg', 'jpg', 'webp', 'gif'].includes(fmt)) {
    throw new Error('Only PNG, JPEG, WebP, and GIF image files are allowed.');
  }

  // Re-encode / auto-rotate without .withMetadata() to strip all EXIF, GPS, and camera metadata
  if (fmt === 'png' || fmt === 'gif') {
    const clean = await sharp(rawBuffer).rotate().png({ compressionLevel: 9 }).toBuffer();
    return { buffer: clean, mimeType: 'image/png', ext: 'png' };
  }
  if (fmt === 'webp') {
    const clean = await sharp(rawBuffer).rotate().webp({ quality: 90 }).toBuffer();
    return { buffer: clean, mimeType: 'image/webp', ext: 'webp' };
  }
  const clean = await sharp(rawBuffer).rotate().jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  return { buffer: clean, mimeType: 'image/jpeg', ext: 'jpg' };
}

function getAppUrl(req: express.Request): string {
  const envUrl = (process.env.APP_URL || process.env.URL || process.env.DEPLOY_PRIME_URL || '').trim();
  if (envUrl && envUrl !== 'MY_APP_URL' && /^https?:\/\//i.test(envUrl)) {
    return envUrl.replace(/\/+$/, '');
  }
  const protoHeader = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const proto = protoHeader.split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] as string) || req.get('host') || `localhost:${PORT}`;
  return `${proto}://${host}`.replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// Server-Side Supabase & Gemini Clients (keys stay on backend only)
// ---------------------------------------------------------------------------

function getSupabaseEnv(): { url: string; key: string; isServiceRole: boolean } {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  const key = serviceKey || anonKey;
  return {
    url,
    key,
    isServiceRole: Boolean(serviceKey),
  };
}

function getServerSupabaseClient(): SupabaseClient | null {
  const { url, key } = getSupabaseEnv();
  if (url && key && url !== 'YOUR_SUPABASE_URL' && key !== 'YOUR_SUPABASE_ANON_KEY') {
    try {
      return createClient(url, key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
    } catch (err) {
      console.warn('Failed to create server Supabase client:', err);
    }
  }
  return null;
}

function isOwnSupabaseGeneratedPostersUrl(rawUrl: string): boolean {
  const { url } = getSupabaseEnv();
  if (!url || !rawUrl) return false;
  const expectedPrefix = `${url}/storage/v1/object/public/${GENERATED_POSTERS_BUCKET}/`;
  return rawUrl.startsWith(expectedPrefix);
}

function isPosterSetupErrorServer(message?: string, code?: string): boolean {
  const msg = String(message || '').toLowerCase();
  const c = String(code || '').toUpperCase();
  return (
    c === 'PGRST205' ||
    c === '42P01' ||
    msg.includes('bucket not found') ||
    (msg.includes('generated_posters') &&
      (msg.includes('not found') || msg.includes('does not exist') || msg.includes('schema cache'))) ||
    msg.includes('row-level security')
  );
}

async function uploadBufferToSupabaseStorage(params: {
  client: SupabaseClient;
  buffer: Buffer;
  mimeType: string;
  ext: 'png' | 'jpg' | 'webp';
  prefix: string;
}): Promise<{ publicUrl: string; storagePath: string; fileName: string }> {
  const { client, buffer, mimeType, ext, prefix } = params;
  // Strictly match RLS regex: ^posters/[a-z0-9._-]+\.(png|jpg|jpeg|webp)$
  const slug =
    prefix
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 36) || 'craft';
  const rand = Math.random().toString(36).substring(2, 8);
  const fileName = `${slug}-${Date.now()}-${rand}.${ext}`;
  const storagePath = `posters/${fileName}`;

  let uploadRes = await client.storage
    .from(GENERATED_POSTERS_BUCKET)
    .upload(storagePath, buffer, {
      contentType: mimeType,
      cacheControl: '3600',
      upsert: false,
    });

  // If bucket is missing and service role key is present, safely create the public bucket and retry once
  if (
    uploadRes.error &&
    uploadRes.error.message.toLowerCase().includes('bucket not found') &&
    getSupabaseEnv().isServiceRole
  ) {
    await client.storage.createBucket(GENERATED_POSTERS_BUCKET, {
      public: true,
      fileSizeLimit: MAX_IMAGE_BYTES,
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
    });
    uploadRes = await client.storage
      .from(GENERATED_POSTERS_BUCKET)
      .upload(storagePath, buffer, {
        contentType: mimeType,
        cacheControl: '3600',
        upsert: false,
      });
  }

  if (uploadRes.error) {
    const err = new Error(uploadRes.error.message) as any;
    err.statusCode = (uploadRes.error as any).statusCode;
    err.setupRequired = isPosterSetupErrorServer(uploadRes.error.message, (uploadRes.error as any).statusCode);
    throw err;
  }

  const uploadedPath = uploadRes.data?.path || storagePath;
  const { data: urlData } = client.storage.from(GENERATED_POSTERS_BUCKET).getPublicUrl(uploadedPath);
  const publicUrl = urlData?.publicUrl || '';

  if (!publicUrl || !/^https:\/\//i.test(publicUrl)) {
    throw new Error('Supabase Storage upload succeeded, but no valid HTTPS public URL was returned.');
  }

  return { publicUrl, storagePath: uploadedPath, fileName };
}

async function saveImageToLocalUploads(
  buffer: Buffer,
  mimeType: string,
  ext: 'png' | 'jpg' | 'webp',
  prefix = 'craft'
): Promise<{ fileName: string; relativeUrl: string; filePath: string; buffer: Buffer; mimeType: string }> {
  ensureLocalUploadsDir();
  const cleanBase = prefix.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'craft';
  const uniqueFileName = `${cleanBase}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${ext}`;
  const filePath = path.resolve(uploadsDir, uniqueFileName);
  if (!filePath.startsWith(resolvedUploadsDir + path.sep)) {
    throw new Error('Invalid upload destination path.');
  }
  fs.writeFileSync(filePath, buffer);

  return {
    fileName: uniqueFileName,
    relativeUrl: `/uploads/${uniqueFileName}`,
    filePath,
    buffer,
    mimeType,
  };
}

function decodeBase64ImageInput(imageData: string): Buffer {
  if (imageData.startsWith('data:')) {
    const matches = imageData.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/i);
    if (!matches || !matches[2]) {
      throw new Error('Only PNG, JPEG, WebP, and GIF product photos are supported.');
    }
    return Buffer.from(matches[2], 'base64');
  }
  return Buffer.from(imageData, 'base64');
}

async function resolveProductImageBuffer(photoUrl?: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (!photoUrl || typeof photoUrl !== 'string') return null;
  const trimmed = photoUrl.trim();
  if (!trimmed) return null;

  try {
    if (trimmed.startsWith('data:image/')) {
      const matches = trimmed.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/i);
      if (matches && matches[1] && matches[2]) {
        const buffer = Buffer.from(matches[2], 'base64');
        if (buffer.length > 0 && buffer.length <= MAX_IMAGE_BYTES) {
          return { mimeType: matches[1], buffer };
        }
      }
    }

    if (trimmed.startsWith('/uploads/') && !isServerlessRuntime()) {
      const safeName = path.basename(trimmed);
      const localPath = path.resolve(uploadsDir, safeName);
      if (localPath.startsWith(resolvedUploadsDir + path.sep) && fs.existsSync(localPath)) {
        const buffer = fs.readFileSync(localPath);
        const ext = path.extname(safeName).toLowerCase();
        const mimeType =
          ext === '.png'
            ? 'image/png'
            : ext === '.webp'
            ? 'image/webp'
            : ext === '.gif'
            ? 'image/gif'
            : 'image/jpeg';
        if (buffer.length > 0) {
          return { mimeType, buffer };
        }
      }
    }

    if (/^https:\/\//i.test(trimmed)) {
      const safeUrl = await validateSafeExternalImageUrl(trimmed);
      if (!safeUrl) {
        return null;
      }
      const controller = new AbortController();
      const timeoutMs = isServerlessRuntime() ? 5000 : 8000;
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await fetch(safeUrl.toString(), {
        signal: controller.signal,
        redirect: 'error',
      });
      clearTimeout(timeout);
      if (resp.ok) {
        const contentType = resp.headers.get('content-type') || 'image/jpeg';
        if (contentType.startsWith('image/')) {
          const arrBuf = await resp.arrayBuffer();
          if (arrBuf.byteLength > 0 && arrBuf.byteLength <= MAX_IMAGE_BYTES) {
            return {
              mimeType: contentType.split(';')[0].trim(),
              buffer: Buffer.from(arrBuf),
            };
          }
        }
      }
    }
  } catch (err) {
    console.warn('Could not load product image buffer:', err);
  }
  return null;
}

async function resolveProductImageForGemini(photoUrl?: string): Promise<{ data: string; mimeType: string } | null> {
  const resolved = await resolveProductImageBuffer(photoUrl);
  if (!resolved) return null;
  return {
    mimeType: resolved.mimeType,
    data: resolved.buffer.toString('base64'),
  };
}

function classifyGeminiError(error: any): { status: number; message: string; retryable: boolean } {
  const rawMsg = String(error?.message || error || 'AI service error');
  const statusCode = Number(error?.status || error?.code || error?.statusCode || 0);

  if (rawMsg.includes('GEMINI_TIMEOUT')) {
    return {
      status: 504,
      message: 'The AI service took too long to respond. Please click Retry to generate again.',
      retryable: true,
    };
  }
  if (statusCode === 403 || rawMsg.includes('PERMISSION_DENIED')) {
    return {
      status: 403,
      message: 'Gemini API authentication failed (403). Please verify GEMINI_API_KEY in environment secrets.',
      retryable: false,
    };
  }
  if (statusCode === 400 || rawMsg.includes('API_KEY_INVALID')) {
    return {
      status: 400,
      message: 'Gemini API key is invalid. Please check GEMINI_API_KEY in environment secrets.',
      retryable: false,
    };
  }
  if (statusCode === 429 || rawMsg.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      message: 'AI rate limit reached. Please wait a moment and click Retry.',
      retryable: true,
    };
  }
  if (statusCode === 503 || rawMsg.includes('UNAVAILABLE') || rawMsg.includes('high demand')) {
    return {
      status: 503,
      message: 'Gemini AI service is temporarily busy. Please click Retry.',
      retryable: true,
    };
  }
  return {
    status: 502,
    message: `AI generation failed: ${rawMsg}`,
    retryable: true,
  };
}

async function callGeminiWithTimeoutAndRetry<T>(
  operation: () => Promise<T>,
  timeoutMs = 22000,
  maxRetries = 1
): Promise<T> {
  const effectiveTimeout = isServerlessRuntime() ? Math.min(timeoutMs, 8200) : timeoutMs;
  const effectiveRetries = isServerlessRuntime() ? 0 : maxRetries;

  let lastErr: any;
  for (let attempt = 0; attempt <= effectiveRetries; attempt++) {
    try {
      const result = await Promise.race([
        operation(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('GEMINI_TIMEOUT')), effectiveTimeout)
        ),
      ]);
      return result;
    } catch (err: any) {
      lastErr = err;
      const status = Number(err?.status || err?.code || 0);
      const msg = String(err?.message || '');
      const isTransient = status === 503 || status === 429 || msg.includes('UNAVAILABLE') || msg.includes('fetch');
      if (attempt < effectiveRetries && isTransient) {
        await new Promise((r) => setTimeout(r, 900));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function buildSafeProductDbPayload(raw: any): Record<string, any> {
  const name = sanitizeText(raw?.name ?? raw?.product_name ?? raw?.title, 200);
  const ownerName = sanitizeText(raw?.ownerName ?? raw?.owner_name, 150);
  const details = sanitizeText(
    raw?.productDetails ??
      raw?.product_details ??
      raw?.story ??
      (raw?.materials
        ? `Materials: ${raw.materials}${raw?.craftTechnique ? ` | Technique: ${raw.craftTechnique}` : ''}`
        : ''),
    5000
  );
  const rawPhoto = sanitizeText(raw?.photoUrl ?? raw?.photo_url ?? raw?.image_url, 12 * 1024 * 1024);
  if (rawPhoto && !isSafeImageReference(rawPhoto)) {
    throw new Error('Invalid or unsupported product photo reference.');
  }

  let rawCost: number | null = null;
  if (raw?.cost !== null && raw?.cost !== undefined && String(raw.cost).trim() !== '') {
    const n = Number(raw.cost);
    if (Number.isFinite(n) && n >= 0) rawCost = n;
  } else if (
    raw?.costDetails?.materialsCost !== undefined &&
    raw?.costDetails?.materialsCost !== null &&
    Number(raw.costDetails.materialsCost) > 0
  ) {
    const n = Number(raw.costDetails.materialsCost);
    if (Number.isFinite(n) && n >= 0) rawCost = n;
  }

  let rawPrice: number | null = null;
  if (raw?.currentPrice !== null && raw?.currentPrice !== undefined && String(raw.currentPrice).trim() !== '') {
    const n = Number(raw.currentPrice);
    if (Number.isFinite(n) && n >= 0) rawPrice = n;
  } else if (raw?.price !== null && raw?.price !== undefined && String(raw.price).trim() !== '') {
    const n = Number(raw.price);
    if (Number.isFinite(n) && n >= 0) rawPrice = n;
  }

  const caption = sanitizeText(raw?.caption, 5000) || null;
  const productDescription = sanitizeText(raw?.productDescription ?? raw?.product_description, 5000) || null;
  const productIdea = sanitizeText(raw?.productIdea ?? raw?.product_idea, 3000) || null;

  return {
    product_name: name,
    owner_name: ownerName,
    product_details: details,
    photo_url: rawPhoto,
    cost: rawCost,
    price: rawPrice,
    caption,
    product_description: productDescription,
    product_idea: productIdea,
  };
}

// ---------------------------------------------------------------------------
// Trend-Savvy Caption Style & Theme Personas
// ---------------------------------------------------------------------------

const THEME_PERSONAS: Record<string, { label: string; styleGuide: string; hashtagFlavor: string }> = {
  auto: {
    label: 'Photo-Matched Natural Studio',
    styleGuide:
      'Authentic modern maker aesthetic matched to the product photo colors and mood. Start with a relatable visual hook, spotlight tactile textures and color details visible in the piece, and keep the energy genuine, warm, and scroll-stopping.',
    hashtagFlavor: '#HandmadeFinds #ArtisanStudio #ShopSmall #CraftCore',
  },
  earthy: {
    label: 'Earthy Clay & Slow Living',
    styleGuide:
      'Grounded, organic slow-living aesthetic. Use tactile sensory words (textured, sun-warmed, raw grain, crafted to last), an unhurried mindfulness hook ("Slow down with something made by real hands"), and warm down-to-earth storytelling.',
    hashtagFlavor: '#SlowLiving #OrganicCraft #EarthyAesthetic #MindfulLiving',
  },
  pastel: {
    label: 'Soft Pastel & Cozy Daydream',
    styleGuide:
      'Soft, cozy, aesthetic-feed vibe (cottagecore / gentle joy). Open with a dreamy, feel-good hook ("That little pocket of calm your day needed"), light sweet pacing, soft romantic phrasing, and inviting friendly warmth.',
    hashtagFlavor: '#CozyAesthetic #SoftLiving #CuteFinds #HandmadeJoy',
  },
  dark: {
    label: 'Midnight Lux & Quiet Luxury',
    styleGuide:
      'High-end quiet-luxury editorial voice. Zero fluff or excessive emojis. Bold, confident, poised opening hook ("Quiet luxury, made by hand—never mass-produced"), moody dramatic imagery, sharp minimalist rhythm, and exclusive collector-drop CTA.',
    hashtagFlavor: '#QuietLuxury #HeirloomCraft #ArtisanEdition #CuratedStyle',
  },
  vibrant: {
    label: 'Vibrant Pop & Dopamine Craft',
    styleGuide:
      'High-energy, trend-forward, dopamine-dressing/decor energy! Open with a punchy scroll-stopper ("Instant mood booster alert ✨" or "Main character energy, handmade edition"), dynamic short sentences, playful excitement, and urgent hype CTA.',
    hashtagFlavor: '#DopamineDecor #MainCharacterEnergy #BoldCraft #TrendingFinds',
  },
  minimalist: {
    label: 'Swiss Ivory & Modern Minimalist',
    styleGuide:
      'Crisp gallery-grade modern minimalism. Clean, spacious line breaks, form-and-function focus, "less clutter, more intention" hook, precise understated language, zero cheesy clichés.',
    hashtagFlavor: '#MinimalistDesign #IntentionalLiving #ModernCraft #CleanAesthetic',
  },
  appetizing: {
    label: 'Oven Honey & Craving Foodie',
    styleGuide:
      'Mouth-watering, sensory-rich foodie trend style. Open with an irresistible craving hook ("Wait until you smell this..." or "Warning: impossible to eat just one"), highlight crunch/aroma/freshness/small-batch warmth, and urge-to-order-now CTA.',
    hashtagFlavor: '#FoodieFinds #SmallBatchGoodness #FreshlyCrafted #CravingAlert',
  },
  sage: {
    label: 'Botanical Sage & Eco Ritual',
    styleGuide:
      'Serene botanical wellness and eco-conscious ritual vibe. Open with a calming lifestyle hook ("Turn everyday routines into a peaceful ritual"), emphasize sustainable/natural materials, calm restoration, and mindful gifting.',
    hashtagFlavor: '#BotanicalVibes #SustainableCraft #MindfulRitual #GreenLiving',
  },
  ocean: {
    label: 'Coastal Blue & Breezy Escape',
    styleGuide:
      'Airy coastal ease and sunlit weekend mood. Open with a breezy escapist hook ("Instant weekend calm, delivered"), crisp sunlit phrasing, effortless style, and relaxed inviting CTA.',
    hashtagFlavor: '#CoastalAesthetic #BreezyStyle #EverydayEscape #ArtisanMade',
  },
  berry: {
    label: 'Velvet Berry & Boutique Romance',
    styleGuide:
      'Lush boutique gifting charm with romantic poise. Open with an affectionate treat-yourself hook ("The gift they will brag about finding first"), rich indulgent tone, thoughtful presentation focus, and personal boutique CTA.',
    hashtagFlavor: '#BoutiqueFinds #GiftInspo #RomanticCraft #CuratedGifts',
  },
};

const TONE_STYLE_GUIDES: Record<string, string> = {
  friendly:
    'Warm, conversational creator-next-door voice—like recommending a favorite find to a friend. Natural modern phrasing and light, purposeful emojis.',
  professional:
    'Polished boutique brand voice: crisp value proposition, clear craftsmanship specs, trustworthy quality assurances, and refined CTA.',
  persuasive:
    'High-converting social commerce style: lead with emotional benefit or scarcity ("small-batch drop"), overcome hesitation with material/craft proof, and close with a direct action CTA.',
  elegant:
    'Poised, gallery-editorial luxury tone: unhurried elegance, evocative sensory detail, minimal emojis, elevated vocabulary.',
  playful:
    'Witty, trend-savvy, upbeat Gen-Z/Millennial energy: fun POV or relatable observation hook, punchy cadence, clever wordplay.',
  storytelling:
    'Authentic behind-the-scenes micro-narrative: share the spark of inspiration, the hands-on process, and why owning this piece feels personal.',
};

const CREATIVE_HOOK_ANGLES = [
  'Relatable POV / Lifestyle Scene ("POV: you finally upgrade your everyday with...")',
  'Scroll-Stopping Curiosity / Detail Reveal ("Wait until you look closely at the...")',
  'Anti-Mass-Production Contrast ("Why settle for factory-made when...")',
  'Insider Collector / Small-Batch Drop ("Only a few made in this batch—here is why...")',
  'Sensory & Tactile Immersion (lead immediately with texture, scent, weight, or finish)',
  'Social Proof / Compliment Magnet ("The piece everyone asks where you got it")',
];

function getThemeDescriptor(themeId?: string) {
  const key = (themeId || 'auto').toLowerCase().trim();
  return THEME_PERSONAS[key] || THEME_PERSONAS.auto;
}

function getToneGuide(toneId?: string) {
  const key = (toneId || 'friendly').toLowerCase().trim();
  return TONE_STYLE_GUIDES[key] || TONE_STYLE_GUIDES.friendly;
}

function pickHookAngle(seed?: number): string {
  const idx = Math.abs(Math.floor(Number(seed) || Date.now())) % CREATIVE_HOOK_ANGLES.length;
  return CREATIVE_HOOK_ANGLES[idx];
}

// ---------------------------------------------------------------------------
// Express App Factory (Shared by server.ts and Netlify Functions)
// ---------------------------------------------------------------------------

export function createApiApp(): express.Express {
  const app = express();
  const jsonLimit = isServerlessRuntime() ? '5.5mb' : '25mb';

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: jsonLimit }));
  app.use(express.urlencoded({ limit: jsonLimit, extended: true }));

  // Normalize Netlify Function direct paths (/.netlify/functions/api/...) -> /api/...
  app.use((req, _res, next) => {
    if (req.url.startsWith('/.netlify/functions/api')) {
      const stripped = req.url.slice('/.netlify/functions/api'.length);
      req.url = `/api${stripped.startsWith('/') ? stripped : stripped ? `/${stripped}` : ''}`;
    }
    next();
  });

  // Protective HTTP response headers (iframe-compatible)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    next();
  });

  // Serve local /uploads only when running standalone Node/Express
  if (!isServerlessRuntime()) {
    ensureLocalUploadsDir();
    app.use(
      '/uploads',
      express.static(uploadsDir, {
        setHeaders: (res) => {
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('Cache-Control', 'private, max-age=3600');
        },
      })
    );
  }

  // Safe SSRF-protected external image proxy
  app.get('/api/proxy-image', apiRateLimiter(120), async (req, res) => {
    try {
      const rawUrl = String(req.query.url || '').trim();
      if (!rawUrl || !/^https:\/\//i.test(rawUrl)) {
        return res.status(400).json({ error: 'Valid https:// image URL is required.' });
      }

      const safeUrl = await validateSafeExternalImageUrl(rawUrl);
      if (!safeUrl) {
        return res.status(403).json({ error: 'External URL host is blocked or invalid.' });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), isServerlessRuntime() ? 5500 : 8000);
      const resp = await fetch(safeUrl.toString(), {
        signal: controller.signal,
        redirect: 'error',
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        return res.status(404).json({ error: 'Could not fetch remote image.' });
      }
      const contentType = resp.headers.get('content-type') || 'image/jpeg';
      if (!contentType.startsWith('image/')) {
        return res.status(400).json({ error: 'URL does not point to an image.' });
      }
      const arrBuf = await resp.arrayBuffer();
      if (arrBuf.byteLength === 0 || arrBuf.byteLength > MAX_IMAGE_BYTES) {
        return res.status(400).json({ error: 'Image is empty or exceeds 10MB.' });
      }

      const sanitized = await sanitizeRasterImageBuffer(Buffer.from(arrBuf));
      if (isServerlessRuntime() && sanitized.buffer.length > MAX_SERVERLESS_BINARY_BYTES) {
        return res.status(413).json({ error: 'Proxied image exceeds serverless response size limit.' });
      }
      res.setHeader('Content-Type', sanitized.mimeType);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.send(sanitized.buffer);
    } catch {
      return res.status(502).json({ error: 'Image proxy request could not be completed.' });
    }
  });

  // Upload photo -> Persistent Supabase Storage ("generated-posters"), local /uploads fallback when unconfigured
  app.post('/api/upload-photo', apiRateLimiter(60), async (req, res) => {
    try {
      const { image, fileName } = req.body || {};
      if (!image || typeof image !== 'string') {
        return res.status(400).json({ success: false, error: 'Valid image data is required.' });
      }

      const baseName =
        typeof fileName === 'string' && fileName
          ? path.basename(fileName, path.extname(fileName))
          : 'craft';

      const rawBuffer = decodeBase64ImageInput(image);
      const sanitized = await sanitizeRasterImageBuffer(rawBuffer);

      const client = getServerSupabaseClient();
      if (client) {
        try {
          const uploaded = await uploadBufferToSupabaseStorage({
            client,
            buffer: sanitized.buffer,
            mimeType: sanitized.mimeType,
            ext: sanitized.ext,
            prefix: `photo-${baseName}`,
          });

          return res.json({
            success: true,
            url: uploaded.publicUrl,
            publicUrl: uploaded.publicUrl,
            fileName: uploaded.fileName,
            storagePath: uploaded.storagePath,
            storage: 'supabase',
          });
        } catch (storageErr: any) {
          console.error('Supabase photo upload failed:', storageErr?.message || storageErr);
          if (isServerlessRuntime()) {
            return res.status(storageErr?.setupRequired ? 404 : 502).json({
              success: false,
              setupRequired: Boolean(storageErr?.setupRequired),
              error: storageErr?.message || 'Failed to persist uploaded photo to Supabase Storage.',
            });
          }
        }
      }

      if (!isServerlessRuntime()) {
        const saved = await saveImageToLocalUploads(
          sanitized.buffer,
          sanitized.mimeType,
          sanitized.ext,
          baseName
        );
        return res.json({
          success: true,
          url: saved.relativeUrl,
          publicUrl: `${getAppUrl(req)}${saved.relativeUrl}`,
          fileName: saved.fileName,
          storage: 'local',
        });
      }

      // Serverless fallback when Supabase is not configured
      const inlineDataUrl = `data:${sanitized.mimeType};base64,${sanitized.buffer.toString('base64')}`;
      if (inlineDataUrl.length > MAX_SERVERLESS_BINARY_BYTES) {
        return res.status(413).json({
          success: false,
          error: 'Image is too large without Supabase Storage configured. Please configure Supabase or use a smaller photo.',
        });
      }
      return res.json({
        success: true,
        url: inlineDataUrl,
        publicUrl: inlineDataUrl,
        fileName: `${baseName}.${sanitized.ext}`,
        storage: 'inline',
      });
    } catch (err: any) {
      console.error('Error saving uploaded photo:', err?.message || err);
      return res.status(400).json({
        success: false,
        error: err?.message || 'Failed to validate and save uploaded photo.',
      });
    }
  });

  // Health check endpoint
  app.get('/api/health', (_req, res) => {
    const hasKey = !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY';
    const supabaseClient = getServerSupabaseClient();
    res.json({
      status: 'ok',
      runtime: isServerlessRuntime() ? 'netlify-functions' : 'node-express',
      geminiConfigured: hasKey,
      supabaseConfigured: Boolean(supabaseClient),
      model: GEMINI_MODEL,
      platform: 'CraftCopy Artisan Engine',
    });
  });

  // Safe Supabase availability check (never exposes URL or keys to browser)
  app.get('/api/supabase/config', (_req, res) => {
    const client = getServerSupabaseClient();
    res.json({
      configured: Boolean(client),
    });
  });

  // Supabase backend health / connection status check
  app.get('/api/supabase/status', async (_req, res) => {
    const client = getServerSupabaseClient();
    if (!client) {
      return res.json({
        configured: false,
        connected: false,
        message: 'Supabase environment variables are not configured on the server.',
      });
    }

    try {
      const { data, error } = await client.from('products').select('*');
      if (error) {
        return res.json({
          configured: true,
          connected: false,
          error: 'Database connection check failed.',
        });
      }
      return res.json({
        configured: true,
        connected: true,
        recordCount: data?.length ?? 0,
        columns: data && data.length > 0 ? Object.keys(data[0]) : [],
      });
    } catch {
      return res.json({
        configured: true,
        connected: false,
        error: 'Database connection check failed.',
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Server-Side Protected Supabase Database & Storage API Routes
  // ---------------------------------------------------------------------------

  app.get('/api/products', apiRateLimiter(120), async (_req, res) => {
    const client = getServerSupabaseClient();
    if (!client) {
      return res.status(503).json({
        success: false,
        isConfigured: false,
        products: [],
        rawCount: 0,
        error: 'Supabase is not configured on the server.',
      });
    }

    try {
      const { data, error } = await client.from('products').select('*');
      if (error) {
        return res.status(502).json({
          success: false,
          isConfigured: true,
          products: [],
          rawCount: 0,
          error: error.message,
        });
      }
      const rows = Array.isArray(data) ? data : [];
      return res.json({
        success: true,
        isConfigured: true,
        rows,
        rawCount: rows.length,
      });
    } catch {
      return res.status(500).json({
        success: false,
        isConfigured: true,
        products: [],
        rawCount: 0,
        error: 'Failed to retrieve products.',
      });
    }
  });

  app.post('/api/products', apiRateLimiter(60), async (req, res) => {
    const client = getServerSupabaseClient();
    if (!client) {
      return res.status(503).json({
        success: false,
        isConfigured: false,
        error: 'Supabase is not configured on the server.',
      });
    }

    try {
      const payload = buildSafeProductDbPayload(req.body?.product || req.body);
      if (!payload.product_name) {
        return res.status(400).json({
          success: false,
          isConfigured: true,
          error: 'Product name is required.',
        });
      }
      payload.created_at = new Date().toISOString();

      let insertRes = await client.from('products').insert([payload]).select();
      if (insertRes.error) {
        const colMismatch = insertRes.error.message.match(/column "([^"]+)" of relation "products" does not exist/i);
        if (colMismatch && colMismatch[1]) {
          delete payload[colMismatch[1]];
          insertRes = await client.from('products').insert([payload]).select();
        }
      }

      if (insertRes.error) {
        return res.status(400).json({
          success: false,
          isConfigured: true,
          error: insertRes.error.message,
        });
      }

      const row = insertRes.data?.[0] || null;
      return res.json({
        success: true,
        isConfigured: true,
        row,
        insertedId: row?.id ? String(row.id) : '',
      });
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        isConfigured: true,
        error: err?.message || 'Failed to save product.',
      });
    }
  });

  app.patch('/api/products/:id', apiRateLimiter(60), async (req, res) => {
    const client = getServerSupabaseClient();
    if (!client) {
      return res.status(503).json({
        success: false,
        error: 'Supabase is not configured on the server.',
      });
    }

    const productId = sanitizeText(req.params.id, 64);
    if (!isUuid(productId)) {
      return res.status(400).json({ success: false, error: 'Valid product UUID is required.' });
    }

    try {
      const payload = buildSafeProductDbPayload(req.body?.product || req.body);
      if (!payload.product_name) {
        return res.status(400).json({ success: false, error: 'Product name is required.' });
      }

      let updateRes = await client.from('products').update(payload).eq('id', productId).select();
      if (updateRes.error) {
        const colMismatch = updateRes.error.message.match(/column "([^"]+)" of relation "products" does not exist/i);
        if (colMismatch && colMismatch[1]) {
          delete payload[colMismatch[1]];
          updateRes = await client.from('products').update(payload).eq('id', productId).select();
        }
      }

      if (updateRes.error) {
        return res.status(400).json({ success: false, error: updateRes.error.message });
      }

      return res.json({
        success: true,
        row: updateRes.data?.[0] || null,
      });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err?.message || 'Failed to update product.' });
    }
  });

  app.patch('/api/products/:id/caption', apiRateLimiter(60), async (req, res) => {
    const client = getServerSupabaseClient();
    if (!client) {
      return res.status(503).json({ success: false, error: 'Supabase is not configured on the server.' });
    }

    const productId = sanitizeText(req.params.id, 64);
    if (!isUuid(productId)) {
      return res.status(400).json({ success: false, error: 'Valid product UUID is required.' });
    }

    const caption = sanitizeText(req.body?.caption, 5000);
    try {
      const { data, error } = await client
        .from('products')
        .update({ caption })
        .eq('id', productId)
        .select();

      if (error) {
        return res.status(400).json({ success: false, error: error.message });
      }

      return res.json({
        success: true,
        row: data?.[0] || null,
      });
    } catch {
      return res.status(500).json({ success: false, error: 'Failed to update caption.' });
    }
  });

  app.get('/api/posters', apiRateLimiter(120), async (_req, res) => {
    const client = getServerSupabaseClient();
    if (!client) {
      return res.status(503).json({
        success: false,
        isConfigured: false,
        posters: [],
        error: 'Supabase is not configured on the server.',
      });
    }

    try {
      const { data, error } = await client
        .from('generated_posters')
        .select('id, seller_name, business_name, product_name, poster_image_url, caption, created_at')
        .order('created_at', { ascending: false });

      if (error) {
        const setupRequired = isPosterSetupErrorServer(error.message, (error as any).code);
        return res.status(setupRequired ? 404 : 502).json({
          success: false,
          isConfigured: true,
          setupRequired,
          posters: [],
          error: setupRequired
            ? `Supabase setup needed for "generated_posters": ${error.message}`
            : error.message,
        });
      }

      const posters = Array.isArray(data)
        ? data.filter((p) => typeof p?.poster_image_url === 'string' && /^https:\/\//i.test(p.poster_image_url))
        : [];

      return res.json({
        success: true,
        isConfigured: true,
        posters,
      });
    } catch {
      return res.status(500).json({
        success: false,
        isConfigured: true,
        posters: [],
        error: 'Failed to retrieve saved posters.',
      });
    }
  });

  app.post('/api/posters/save', apiRateLimiter(40), async (req, res) => {
    const client = getServerSupabaseClient();
    if (!client) {
      return res.status(503).json({
        success: false,
        isConfigured: false,
        error: 'Supabase is not configured on the server.',
      });
    }

    try {
      const sellerName = sanitizeText(req.body?.sellerName, 150);
      const businessName = sanitizeText(req.body?.businessName, 150);
      const productName = sanitizeText(req.body?.productName, 200);
      const caption = sanitizeText(req.body?.caption, 5000);
      const imageDataUrl = typeof req.body?.imageDataUrl === 'string' ? req.body.imageDataUrl.trim() : '';
      const posterSourceUrl = typeof req.body?.posterSourceUrl === 'string' ? req.body.posterSourceUrl.trim() : '';

      if (!sellerName) {
        return res.status(400).json({
          success: false,
          isConfigured: true,
          error: 'Owner Name from the Seller Information form is required before saving this poster.',
        });
      }

      let publicUrl = '';

      // Fast path: reuse already-persisted HTTPS URL inside our generated-posters bucket
      if (!imageDataUrl && posterSourceUrl && isOwnSupabaseGeneratedPostersUrl(posterSourceUrl)) {
        const safeUrl = await validateSafeExternalImageUrl(posterSourceUrl);
        if (!safeUrl) {
          return res.status(400).json({
            success: false,
            isConfigured: true,
            error: 'Invalid poster Storage URL.',
          });
        }
        publicUrl = safeUrl.toString();
      } else {
        let rawBuffer: Buffer | null = null;
        if (imageDataUrl && imageDataUrl.startsWith('data:image/')) {
          const matches = imageDataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/i);
          if (!matches || !matches[2]) {
            return res.status(400).json({
              success: false,
              isConfigured: true,
              error: 'Invalid poster image data.',
            });
          }
          rawBuffer = Buffer.from(matches[2], 'base64');
        } else if (posterSourceUrl) {
          const resolved = await resolveProductImageBuffer(posterSourceUrl);
          if (resolved) {
            rawBuffer = resolved.buffer;
          }
        }

        if (!rawBuffer || rawBuffer.length < 500) {
          return res.status(400).json({
            success: false,
            isConfigured: true,
            error: 'Generated poster image data is empty or invalid.',
          });
        }

        // Validate real raster image & strip EXIF/metadata
        const cleanImage = await sanitizeRasterImageBuffer(rawBuffer);

        try {
          const uploaded = await uploadBufferToSupabaseStorage({
            client,
            buffer: cleanImage.buffer,
            mimeType: cleanImage.mimeType,
            ext: cleanImage.ext,
            prefix: productName || 'craftcopy-poster',
          });
          publicUrl = uploaded.publicUrl;
        } catch (uploadErr: any) {
          const setupRequired = Boolean(uploadErr?.setupRequired);
          return res.status(setupRequired ? 404 : 502).json({
            success: false,
            isConfigured: true,
            setupRequired,
            error: setupRequired
              ? `Supabase Storage bucket "generated-posters" requires setup/policy: ${uploadErr.message}`
              : `Storage upload failed: ${uploadErr.message}`,
          });
        }
      }

      if (!publicUrl || !/^https:\/\//i.test(publicUrl)) {
        return res.status(502).json({
          success: false,
          isConfigured: true,
          error: 'Poster upload succeeded, but Supabase did not return a valid HTTPS public URL.',
        });
      }

      const recordPayload = {
        seller_name: sellerName,
        business_name: businessName,
        product_name: productName,
        poster_image_url: publicUrl,
        caption,
      };

      const { data: insertData, error: insertError } = await client
        .from('generated_posters')
        .insert([recordPayload])
        .select('id, seller_name, business_name, product_name, poster_image_url, caption, created_at');

      if (insertError) {
        const setupRequired = isPosterSetupErrorServer(insertError.message, (insertError as any).code);
        return res.status(setupRequired ? 404 : 400).json({
          success: false,
          isConfigured: true,
          setupRequired,
          error: setupRequired
            ? `Supabase table "generated_posters" requires setup/policy: ${insertError.message}`
            : `Database save failed: ${insertError.message}`,
        });
      }

      const poster = insertData?.[0] || null;
      if (!poster) {
        return res.status(502).json({
          success: false,
          isConfigured: true,
          error: 'Poster uploaded, but could not verify the saved database record.',
        });
      }

      return res.json({
        success: true,
        isConfigured: true,
        poster,
      });
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        isConfigured: true,
        error: err?.message || 'Failed to save poster to Supabase.',
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Gemini Marketing, Product Ideas & Promotional Poster Endpoints
  // ---------------------------------------------------------------------------

  app.post('/api/brainstorm-ideas', apiRateLimiter(60), async (req, res) => {
    const { materials, category, sellerProfile } = req.body as {
      materials?: string;
      category?: string;
      sellerProfile?: any;
    };

    if (!materials || typeof materials !== 'string' || !materials.trim()) {
      return res.status(400).json({ success: false, error: 'Please describe your available materials or supplies.' });
    }

    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        success: false,
        error: 'GEMINI_API_KEY is not configured in environment secrets.',
      });
    }

    try {
      const prompt = `You are a product development strategist for local craftsmen and independent small businesses.
Materials or skills on hand: "${materials.trim()}"
${category && category !== 'All' ? `Preferred Category: "${category}"` : ''}
${sellerProfile?.studioName ? `Studio Name: "${sellerProfile.studioName}"` : ''}
${sellerProfile?.businessType ? `Business Specialty: "${sellerProfile.businessType}"` : ''}

Generate 3 practical, high-margin handmade product ideas using these materials, priced realistically in Philippine Pesos (PHP).
For each idea return:
- name (clear marketable product title)
- category (e.g. Handmade Crochet, Leathercraft, Pottery & Ceramics, Jewelry & Beadwork, Woodcraft & Home, Artisan Bakery & Food, Candles & Botanicals, Woven & Textiles, Art & Decor, or Other Handmade Craft)
- difficulty ("Beginner", "Intermediate", or "Master Artisan")
- estimatedHours (realistic production hours as a number, e.g. 1.5)
- materialsCost (realistic PHP cost as integer, e.g. 250)
- suggestedRetail (realistic PHP retail price ensuring living wage + margin, e.g. 950)
- profitMarginPercent (number 25-55)
- materials (comma-separated materials list)
- craftTechnique (concise technique summary)
- starterStory (2-3 authentic sentences ready to pre-fill a product description)
- whyItSells (1-2 practical sentences on customer appeal)
- marketDemand ("Bestseller", "High Demand", "Trending", or "Steady")
- bestSeason (e.g. "Year-round Gifting")
- tags (3-5 short lowercase tags)`;

      const response = await callGeminiWithTimeoutAndRetry(
        () =>
          ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: prompt,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
              systemInstruction:
                'You are an artisan product strategist. Return valid JSON array of 3 craft product concepts with accurate Philippine Peso pricing.',
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    category: { type: Type.STRING },
                    difficulty: { type: Type.STRING },
                    estimatedHours: { type: Type.NUMBER },
                    materialsCost: { type: Type.NUMBER },
                    suggestedRetail: { type: Type.NUMBER },
                    profitMarginPercent: { type: Type.NUMBER },
                    materials: { type: Type.STRING },
                    craftTechnique: { type: Type.STRING },
                    starterStory: { type: Type.STRING },
                    whyItSells: { type: Type.STRING },
                    marketDemand: { type: Type.STRING },
                    bestSeason: { type: Type.STRING },
                    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                  required: [
                    'name',
                    'category',
                    'difficulty',
                    'estimatedHours',
                    'materialsCost',
                    'suggestedRetail',
                    'profitMarginPercent',
                    'materials',
                    'craftTechnique',
                    'starterStory',
                    'whyItSells',
                    'marketDemand',
                    'bestSeason',
                    'tags',
                  ],
                },
              },
            },
          }),
        20000,
        1
      );

      const parsed = JSON.parse(response.text?.trim() || '[]');
      const ideas = (Array.isArray(parsed) ? parsed : []).slice(0, 3).map((item: any, idx: number) => ({
        id: `ai-idea-${Date.now()}-${idx}`,
        name: String(item.name || 'Artisan Craft Piece'),
        category: String(item.category || (category && category !== 'All' ? category : 'Other Handmade Craft')),
        difficulty: (['Beginner', 'Intermediate', 'Master Artisan'].includes(item.difficulty)
          ? item.difficulty
          : 'Intermediate') as 'Beginner' | 'Intermediate' | 'Master Artisan',
        estimatedHours: Number(item.estimatedHours) || 1.5,
        materialsCost: Math.round(Number(item.materialsCost) || 250),
        suggestedRetail: Math.round(Number(item.suggestedRetail) || 950),
        profitMarginPercent: Math.round(Number(item.profitMarginPercent) || 35),
        materials: String(item.materials || materials.trim()),
        craftTechnique: String(item.craftTechnique || 'Small-batch handcrafting'),
        starterStory: String(item.starterStory || ''),
        photoUrl: '',
        whyItSells: String(item.whyItSells || 'High perceived handmade value for everyday use and gifting.'),
        marketDemand: (['Bestseller', 'High Demand', 'Trending', 'Steady'].includes(item.marketDemand)
          ? item.marketDemand
          : 'Trending') as 'Bestseller' | 'High Demand' | 'Trending' | 'Steady',
        bestSeason: String(item.bestSeason || 'Year-round Gifting'),
        tags: Array.isArray(item.tags) ? item.tags.map(String) : ['handmade', 'artisan'],
      }));

      return res.json({ success: true, ideas });
    } catch (error: any) {
      console.error('Gemini brainstorm error:', error?.message || error);
      const classified = classifyGeminiError(error);
      return res.status(classified.status).json({
        success: false,
        error: classified.message,
      });
    }
  });

  app.post('/api/generate-content', apiRateLimiter(60), async (req, res) => {
    const {
      product,
      tone = 'friendly',
      theme = 'auto',
      designStyle = 'artisan',
      customInstructions = '',
      sellerProfile,
    } = req.body || {};

    if (!product || typeof product.name !== 'string' || !product.name.trim()) {
      return res.status(400).json({ success: false, error: 'Product name and details are required.' });
    }

    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        success: false,
        simulated: false,
        retryable: false,
        error: 'GEMINI_API_KEY is not configured in environment secrets.',
      });
    }

    try {
      const priceDisplay =
        product.currentPrice && Number(product.currentPrice) > 0
          ? `₱${Number(product.currentPrice).toLocaleString()}`
          : 'DM for pricing';
      const studioName = sellerProfile?.studioName || 'Artisan Studio';
      const makerName = sellerProfile?.makerName || product.ownerName || 'Independent Maker';
      const businessType = sellerProfile?.businessType || sellerProfile?.craftSpecialty || 'Handmade Creations';
      const sellerDescription = sellerProfile?.bio || 'Handcrafted small-batch pieces made with care.';
      const themeInfo = getThemeDescriptor(theme);
      const toneGuide = getToneGuide(tone);
      const hookAngle = pickHookAngle(Date.now());

      const imagePart = await resolveProductImageForGemini(product.photoUrl);

      const prompt = `You are CraftCopy, a top-tier modern social media strategist and copywriter for independent makers and small brands.

SELLER INFORMATION:
- Business Name: "${studioName}"
- Owner Name: "${makerName}"
- Business Type: "${businessType}"
- Business Description: "${sellerDescription}"

PRODUCT DETAILS (STAY 100% FACTUAL TO THESE):
- Product Name: "${product.name}"
- Product Details / Story: "${product.productDetails || product.story || 'Handcrafted piece'}"
- Category: "${product.category || businessType}"
- Selling Price: ${priceDisplay}
${product.materials ? `- Materials: "${product.materials}"` : ''}
${product.craftTechnique ? `- Craft Technique: "${product.craftTechnique}"` : ''}
${product.features ? `- Key Features: "${product.features}"` : ''}
${customInstructions ? `- Extra Maker Note: "${customInstructions}"` : ''}

STYLE & CURRENT TRENDS BRIEF:
- Selected Theme Aesthetic: "${themeInfo.label}" — ${themeInfo.styleGuide}
- Selected Voice Tone: "${tone}" — ${toneGuide}
- Design Layout Mood: "${designStyle}"
- Fresh Hook Angle to Use: ${hookAngle}
${imagePart ? '\nPRODUCT PHOTO ATTACHED: Inspect the actual product photo closely. Reference real colors, textures, shape, and mood from the photo, and pick the best matching `recommendedAesthetic`.' : ''}

WRITING RULES FOR TODAY'S AUDIENCE:
1. Write fresh, modern, trend-aware social copy (avoid dated clichés like "Elevate your space today!" or generic robotic filler). Use scroll-stopping first-line hooks, clean line breaks, vivid product-specific details (real materials, feel, craftsmanship, price ${priceDisplay}), and a natural, low-friction CTA.
2. Tailor each platform distinctly:
   - Instagram: Catchy hook title + aesthetic, story-driven scannable body + mix of niche craft and trending discovery hashtags (${themeInfo.hashtagFlavor} + product-specific tags).
   - Facebook: Warm, relatable community/marketplace post highlighting value, real details, price (${priceDisplay}), and direct ordering CTA.
   - TikTok: Native creator POV/trend hook + realistic trending audio vibe + crisp punchy caption + discovery tags.
3. Generate cohesive promotional poster copy (\`posterDirection\`) matching the selected style: crisp headline (max 7 words), punchy subheadline (max 18 words), CTA badge text (max 6 words), and \`recommendedAesthetic\` from: pastel, dark, vibrant, earthy, minimalist, appetizing, sage, ocean, berry.
4. Stay 100% truthful to the seller and product details provided; never invent materials, discounts, or claims not given.
5. Return pure JSON matching the schema.`;

      const contents: any = imagePart
        ? [{ inlineData: { data: imagePart.data, mimeType: imagePart.mimeType } }, prompt]
        : prompt;

      const response = await callGeminiWithTimeoutAndRetry(
        () =>
          ai.models.generateContent({
            model: GEMINI_MODEL,
            contents,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
              systemInstruction:
                'You are a modern social commerce copywriter for independent makers. Write scroll-stopping, trend-relevant, distinctly styled captions grounded strictly in real product details and visual photo cues. Return valid JSON only.',
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  captions: {
                    type: Type.OBJECT,
                    properties: {
                      instagram: {
                        type: Type.OBJECT,
                        properties: {
                          title: { type: Type.STRING },
                          body: { type: Type.STRING },
                          hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
                        },
                        required: ['title', 'body', 'hashtags'],
                      },
                      facebook: {
                        type: Type.OBJECT,
                        properties: {
                          title: { type: Type.STRING },
                          body: { type: Type.STRING },
                          callToAction: { type: Type.STRING },
                        },
                        required: ['title', 'body', 'callToAction'],
                      },
                      tiktok: {
                        type: Type.OBJECT,
                        properties: {
                          hook: { type: Type.STRING },
                          audioIdea: { type: Type.STRING },
                          body: { type: Type.STRING },
                          hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
                        },
                        required: ['hook', 'audioIdea', 'body', 'hashtags'],
                      },
                    },
                    required: ['instagram', 'facebook', 'tiktok'],
                  },
                  descriptions: {
                    type: Type.OBJECT,
                    properties: {
                      short: { type: Type.STRING },
                      story: { type: Type.STRING },
                      bulletPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
                      careInstructions: { type: Type.STRING },
                    },
                    required: ['short', 'story', 'bulletPoints', 'careInstructions'],
                  },
                  promotional: {
                    type: Type.OBJECT,
                    properties: {
                      marketPitch: { type: Type.STRING },
                      limitedDrop: { type: Type.STRING },
                      makerStory: { type: Type.STRING },
                    },
                    required: ['marketPitch', 'limitedDrop', 'makerStory'],
                  },
                  posterDirection: {
                    type: Type.OBJECT,
                    properties: {
                      headline: { type: Type.STRING },
                      subheadline: { type: Type.STRING },
                      callToAction: { type: Type.STRING },
                      recommendedAesthetic: { type: Type.STRING },
                      visualNotes: { type: Type.STRING },
                    },
                    required: ['headline', 'subheadline', 'callToAction', 'recommendedAesthetic'],
                  },
                },
                required: ['captions', 'descriptions', 'promotional', 'posterDirection'],
              },
            },
          }),
        22000,
        1
      );

      const text = response.text?.trim() || '';
      if (!text) {
        return res.status(502).json({
          success: false,
          simulated: false,
          retryable: true,
          error: 'Gemini returned an empty response. Please retry.',
        });
      }

      const parsedData = JSON.parse(text);

      return res.json({
        success: true,
        simulated: false,
        aiModelUsed: 'Gemini 3.1 Flash Lite (Live AI)',
        data: parsedData,
      });
    } catch (error: any) {
      console.error('Gemini content generation error:', error?.message || error);
      const classified = classifyGeminiError(error);
      return res.status(classified.status).json({
        success: false,
        simulated: false,
        retryable: classified.retryable,
        error: classified.message,
      });
    }
  });

  // Real Promotional Poster PNG Generation Endpoint
  // Combines Gemini visual analysis + Sharp PNG compositing and persists directly to Supabase Storage ("generated-posters")
  app.post('/api/generate-poster', apiRateLimiter(60), async (req, res) => {
    const {
      product,
      sellerProfile,
      aspectRatio = '4:5',
      designVariation = 'artisan',
      aesthetic = 'auto',
      customColors,
      regenerationInstruction,
      refreshCopy = false,
      previousHeadline,
      posterCopy,
    } = (req.body || {}) as {
      product: any;
      sellerProfile?: any;
      aspectRatio?: AspectRatioFormat;
      designVariation?: DesignVariation;
      aesthetic?: PosterAesthetic | 'auto';
      customColors?: CustomPosterColors;
      regenerationInstruction?: string;
      refreshCopy?: boolean;
      previousHeadline?: string;
      posterCopy?: {
        headline?: string;
        subheadline?: string;
        callToAction?: string;
        hashtags?: string;
        recommendedAesthetic?: PosterAesthetic;
      };
    };

    if (!product || !product.name) {
      return res.status(400).json({
        success: false,
        error: 'Product name and details are required to generate a poster.',
      });
    }

    let resolvedPhoto: { buffer: Buffer; mimeType: string } | null = null;
    if (product.photoUrl) {
      resolvedPhoto = await resolveProductImageBuffer(product.photoUrl);
      if (!resolvedPhoto) {
        return res.status(400).json({
          success: false,
          retryable: false,
          error: 'Could not read the uploaded product photo on the server. Please re-upload your photo and try again.',
        });
      }
    }

    try {
      let finalHeadline = refreshCopy ? '' : posterCopy?.headline?.trim() || '';
      let finalSubheadline = refreshCopy ? '' : posterCopy?.subheadline?.trim() || '';
      let finalCta = refreshCopy ? '' : posterCopy?.callToAction?.trim() || '';
      const finalAesthetic: PosterAesthetic | 'auto' = aesthetic || 'auto';
      let moodHint: PosterAesthetic | undefined =
        posterCopy?.recommendedAesthetic && posterCopy.recommendedAesthetic !== ('auto' as any)
          ? posterCopy.recommendedAesthetic
          : undefined;

      // Run fast Gemini visual direction if copy wasn't provided OR user requested fresh AI variation / instructions
      if (!finalHeadline || !finalSubheadline || refreshCopy || (regenerationInstruction && regenerationInstruction.trim().length > 0)) {
        const ai = getGeminiClient();
        if (!ai) {
          return res.status(503).json({
            success: false,
            retryable: false,
            error: 'GEMINI_API_KEY is not configured in environment secrets.',
          });
        }

        const priceDisplay = product.currentPrice
          ? `₱${Number(product.currentPrice).toLocaleString()}`
          : 'Handmade quality';
        const studioName = sellerProfile?.studioName || 'Artisan Studio';
        const businessType = sellerProfile?.businessType || product.category || 'Handmade Craft';

        const styleInstruction = regenerationInstruction?.trim()
          ? `Seller's custom direction for this poster: "${regenerationInstruction.trim()}"`
          : `Design Layout Style selected: "${designVariation}". Create copy that matches this style strongly.`;

        const freshnessRule = previousHeadline
          ? `IMPORTANT: Do NOT repeat the previous headline "${previousHeadline}". Write a noticeably fresh, creative headline and new angle.`
          : '';

        const prompt = `Analyze the attached product photo and craft details to design concise, persuasive poster copy.
Business: "${studioName}" (${businessType})
Product: "${product.name}"
Details: "${product.productDetails || product.story || 'Handcrafted creation'}"
Price: ${priceDisplay}
${styleInstruction}
${freshnessRule}

Return JSON with:
- headline (max 6 words, captivating title)
- subheadline (max 16 words highlighting materials/craft or seller direction)
- callToAction (max 5 words for CTA pill, e.g. "Send a DM to Order")
- recommendedAesthetic (one of: pastel, dark, vibrant, earthy, minimalist, appetizing, sage, ocean, berry)`;

        const contents: any = resolvedPhoto
          ? [
              { inlineData: { data: resolvedPhoto.buffer.toString('base64'), mimeType: resolvedPhoto.mimeType } },
              prompt,
            ]
          : prompt;

        const aiResp = await callGeminiWithTimeoutAndRetry(
          () =>
            ai.models.generateContent({
              model: GEMINI_MODEL,
              contents,
              config: {
                thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    headline: { type: Type.STRING },
                    subheadline: { type: Type.STRING },
                    callToAction: { type: Type.STRING },
                    recommendedAesthetic: { type: Type.STRING },
                  },
                  required: ['headline', 'subheadline', 'callToAction', 'recommendedAesthetic'],
                },
              },
            }),
          18000,
          1
        );

        const dir = JSON.parse(aiResp.text?.trim() || '{}');
        finalHeadline = finalHeadline || dir.headline || product.name;
        finalSubheadline = finalSubheadline || dir.subheadline || product.productDetails || 'Handcrafted in small batches.';
        finalCta = finalCta || dir.callToAction || 'Send a DM to Order';
        if (
          ['pastel', 'dark', 'vibrant', 'earthy', 'minimalist', 'appetizing', 'sage', 'ocean', 'berry'].includes(
            dir.recommendedAesthetic
          )
        ) {
          moodHint = dir.recommendedAesthetic as PosterAesthetic;
        }
      }

      const brandName = sellerProfile?.studioName || product.ownerName || 'CRAFTCOPY STUDIO';
      const categoryTag = product.category || sellerProfile?.businessType || 'HANDCRAFTED';
      const displayPrice =
        product.currentPrice && Number(product.currentPrice) > 0
          ? Number(product.currentPrice)
          : null;

      const rendered = await renderPromotionalPosterPng({
        photoBuffer: resolvedPhoto ? resolvedPhoto.buffer : null,
        productName: product.name,
        brandName,
        categoryTag,
        headline: finalHeadline,
        subheadline: finalSubheadline,
        callToAction: finalCta || 'Send a DM to Order',
        hashtags: posterCopy?.hashtags || '#Handmade #ArtisanMade #ShopSmall',
        price: displayPrice,
        aspectRatio,
        aesthetic: finalAesthetic,
        moodHint,
        designVariation,
        customColors,
      });

      // Verify valid non-empty PNG bytes before persisting
      const isPng =
        rendered.buffer.length > 1000 &&
        rendered.buffer[0] === 0x89 &&
        rendered.buffer[1] === 0x50 &&
        rendered.buffer[2] === 0x4e &&
        rendered.buffer[3] === 0x47;

      if (!isPng) {
        throw new Error('Rendered poster output did not produce valid PNG image data.');
      }

      const slug =
        (product.name || 'craft')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 28) || 'craft';

      let posterUrl = '';
      let publicUrl = '';
      let fileName = '';
      let storagePath = '';
      let storageMode: 'supabase' | 'local' | 'inline' = 'supabase';

      const client = getServerSupabaseClient();
      if (client) {
        try {
          const uploaded = await uploadBufferToSupabaseStorage({
            client,
            buffer: rendered.buffer,
            mimeType: rendered.mimeType,
            ext: 'png',
            prefix: `poster-${slug}`,
          });
          posterUrl = uploaded.publicUrl;
          publicUrl = uploaded.publicUrl;
          fileName = uploaded.fileName;
          storagePath = uploaded.storagePath;
          storageMode = 'supabase';
        } catch (storageErr: any) {
          console.error('Supabase Storage poster upload failed:', storageErr?.message || storageErr);
          const setupRequired = Boolean(storageErr?.setupRequired);
          return res.status(setupRequired ? 404 : 502).json({
            success: false,
            retryable: !setupRequired,
            setupRequired,
            error: setupRequired
              ? `Supabase Storage bucket "generated-posters" requires setup/policy: ${storageErr.message}`
              : `Could not store generated poster in Supabase Storage: ${storageErr.message}`,
          });
        }
      } else if (!isServerlessRuntime()) {
        const saved = await saveImageToLocalUploads(
          rendered.buffer,
          rendered.mimeType,
          'png',
          `poster-${slug}`
        );
        posterUrl = saved.relativeUrl;
        publicUrl = `${getAppUrl(req)}${saved.relativeUrl}`;
        fileName = saved.fileName;
        storageMode = 'local';
      } else {
        // Serverless fallback when Supabase keys aren't configured
        const dataUrl = `data:image/png;base64,${rendered.buffer.toString('base64')}`;
        if (dataUrl.length > MAX_SERVERLESS_BINARY_BYTES) {
          return res.status(503).json({
            success: false,
            retryable: false,
            error: 'Supabase Storage environment variables are required to persist generated posters on Netlify.',
          });
        }
        posterUrl = dataUrl;
        publicUrl = dataUrl;
        fileName = `poster-${slug}-${Date.now()}.png`;
        storageMode = 'inline';
      }

      return res.json({
        success: true,
        posterUrl,
        publicUrl,
        fileName,
        storagePath: storagePath || undefined,
        storage: storageMode,
        mimeType: rendered.mimeType,
        width: rendered.width,
        height: rendered.height,
        fileSize: rendered.buffer.length,
        designVariation,
        palette: rendered.palette,
        posterCopy: {
          headline: finalHeadline,
          subheadline: finalSubheadline,
          callToAction: finalCta || 'Send a DM to Order',
          recommendedAesthetic: rendered.palette.aesthetic,
        },
        aiModelUsed: 'Gemini 3.1 Flash Lite + CraftCopy Sharp Poster Engine',
      });
    } catch (error: any) {
      console.error('Poster generation error:', error?.message || error);
      const classified = classifyGeminiError(error);
      return res.status(classified.status).json({
        success: false,
        retryable: classified.retryable,
        error: classified.message,
      });
    }
  });

  // High-Resolution Poster Attachment Download Endpoint (supports HTTPS Supabase Storage URLs & local files)
  app.get('/api/posters/download', apiRateLimiter(120), async (req, res) => {
    try {
      const rawUrl = String(req.query.url || '').trim();
      const rawFile = String(req.query.file || '').trim();
      const rawFormat = String(req.query.format || 'png').toLowerCase();
      const format: 'png' | 'jpg' = rawFormat === 'jpg' || rawFormat === 'jpeg' ? 'jpg' : 'png';
      const rawName = String(req.query.name || 'craftcopy-poster').trim();

      const externalUrlCandidate = rawUrl || (/^https:\/\//i.test(rawFile) ? rawFile : '');
      let fileBuffer: Buffer | null = null;

      if (externalUrlCandidate) {
        const safeUrl = await validateSafeExternalImageUrl(externalUrlCandidate);
        if (!safeUrl) {
          return res.status(403).json({ success: false, error: 'Poster download URL host is invalid or blocked.' });
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), isServerlessRuntime() ? 6500 : 12000);
        const resp = await fetch(safeUrl.toString(), {
          signal: controller.signal,
          redirect: 'error',
        });
        clearTimeout(timeout);

        if (!resp.ok) {
          return res.status(404).json({ success: false, error: 'Poster image not found in storage.' });
        }
        const arrBuf = await resp.arrayBuffer();
        if (arrBuf.byteLength === 0 || arrBuf.byteLength > MAX_IMAGE_BYTES) {
          return res.status(400).json({ success: false, error: 'Poster image is empty or exceeds size limit.' });
        }
        fileBuffer = Buffer.from(arrBuf);
      } else if (rawFile) {
        if (isServerlessRuntime()) {
          return res.status(404).json({
            success: false,
            error: 'Legacy /uploads poster files are not available in serverless mode. Please regenerate the poster.',
          });
        }
        const safeFileName = path.basename(rawFile);
        const filePath = path.join(uploadsDir, safeFileName);
        const resolvedTarget = path.resolve(filePath);

        if (!resolvedTarget.startsWith(resolvedUploadsDir + path.sep) || !fs.existsSync(resolvedTarget)) {
          return res.status(404).json({ success: false, error: 'Poster file not found on the server.' });
        }

        fileBuffer = fs.readFileSync(resolvedTarget);
      } else {
        return res.status(400).json({ success: false, error: 'Missing poster file or URL parameter.' });
      }

      if (!fileBuffer || fileBuffer.length === 0) {
        return res.status(404).json({ success: false, error: 'Poster file is empty.' });
      }

      let exported = await exportPosterImageForDownload(fileBuffer, format);

      // Keep binary payload within Netlify / AWS Lambda 6 MB base64-encoded limit
      if (isServerlessRuntime() && exported.buffer.length > MAX_SERVERLESS_BINARY_BYTES) {
        const compactBuf =
          format === 'jpg'
            ? await sharp(exported.buffer)
                .jpeg({ quality: 88, chromaSubsampling: '4:2:0', mozjpeg: true })
                .toBuffer()
            : await sharp(exported.buffer)
                .png({ compressionLevel: 9, palette: true, quality: 92 })
                .toBuffer();
        if (compactBuf.length <= MAX_SERVERLESS_BINARY_BYTES) {
          exported = { ...exported, buffer: compactBuf };
        }
      }

      const cleanDownloadStem =
        rawName
          .toLowerCase()
          .replace(/\.(png|jpe?g|webp)$/i, '')
          .replace(/[^a-z0-9-_]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 64) || 'craftcopy-poster';

      const downloadFileName = `${cleanDownloadStem}.${exported.ext}`;

      res.setHeader('Content-Type', exported.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${downloadFileName}"`);
      res.setHeader('Content-Length', String(exported.buffer.length));
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Poster-Resolution', `${exported.width}x${exported.height}`);
      return res.send(exported.buffer);
    } catch (err: any) {
      console.error('Poster download error:', err?.message || err);
      return res.status(500).json({
        success: false,
        error: err?.message || 'Failed to prepare high-resolution poster download.',
      });
    }
  });

  // Revise Caption Endpoint
  app.post('/api/revise-caption', apiRateLimiter(60), async (req, res) => {
    const {
      product,
      currentCaption,
      revisionInstruction,
      platform = 'instagram',
      tone = 'friendly',
      theme = 'auto',
      sellerProfile,
    } = req.body || {};

    if (
      !product ||
      typeof product.name !== 'string' ||
      !currentCaption ||
      typeof revisionInstruction !== 'string' ||
      !revisionInstruction.trim()
    ) {
      return res.status(400).json({
        success: false,
        error: 'Product, current caption, and revision instructions are required',
      });
    }

    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        success: false,
        simulated: false,
        error: 'GEMINI_API_KEY is not configured.',
      });
    }

    try {
      const priceDisplay =
        product.currentPrice && Number(product.currentPrice) > 0
          ? `₱${Number(product.currentPrice).toLocaleString()}`
          : 'DM for pricing';
      const materialsDisplay = product.materials || 'Hand-selected artisan materials';
      const themeInfo = getThemeDescriptor(theme);
      const toneGuide = getToneGuide(tone);

      const prompt = `You are CraftCopy, revising a ${platform} marketing caption for an independent maker to keep it engaging, modern, and aligned with the requested revision.

SELLER CONTEXT:
- Business: "${sellerProfile?.studioName || 'Artisan Studio'}"${sellerProfile?.makerName ? ` by ${sellerProfile.makerName}` : ''}

PRODUCT DETAILS (FACTUAL SOURCE):
- Product Name: "${product.name}"
- Product Description: "${product.productDetails || product.story || ''}"
- Price: ${priceDisplay}
- Materials: "${materialsDisplay}"
${product.craftTechnique ? `- Craft Technique: "${product.craftTechnique}"` : ''}
- Active Theme Style: "${themeInfo.label}" (${themeInfo.styleGuide})
- Voice Tone: "${tone}" (${toneGuide})

CURRENT CAPTION:
Title/Hook: "${currentCaption.title || ''}"
Body: "${currentCaption.body || ''}"
Hashtags: ${JSON.stringify(currentCaption.hashtags || [])}
${currentCaption.callToAction ? `Call To Action: "${currentCaption.callToAction}"` : ''}

REVISION INSTRUCTION:
"${revisionInstruction}"

Apply the requested revision with a catchy hook, engaging modern flow, factual product details including price (${priceDisplay}), a clear CTA, and relevant hashtags. Return valid JSON only.`;

      const response = await callGeminiWithTimeoutAndRetry(
        () =>
          ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: prompt,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
              systemInstruction:
                'You are an expert modern social media copy editor for handmade brands. Apply revisions cleanly while keeping hooks engaging and all product facts accurate. Return valid JSON only.',
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  body: { type: Type.STRING },
                  hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
                  callToAction: { type: Type.STRING },
                  hook: { type: Type.STRING },
                  audioIdea: { type: Type.STRING },
                },
                required: ['body', 'hashtags'],
              },
            },
          }),
        18000,
        1
      );

      const parsed = JSON.parse(response.text?.trim() || '{}');
      return res.json({
        success: true,
        simulated: false,
        revisedCaption: parsed,
      });
    } catch (error: any) {
      console.error('Gemini caption revision error:', error?.message || error);
      const classified = classifyGeminiError(error);
      return res.status(classified.status).json({
        success: false,
        simulated: false,
        error: classified.message,
      });
    }
  });

  // Regenerate Single Platform Caption with Fresh Hook & Theme Alignment
  app.post('/api/regenerate-caption', apiRateLimiter(60), async (req, res) => {
    const {
      product,
      sellerProfile,
      platform = 'instagram',
      tone = 'friendly',
      theme = 'auto',
      designStyle = 'artisan',
      previousCaption = '',
      seed = Date.now(),
    } = req.body || {};

    if (!product || typeof product.name !== 'string' || !product.name.trim()) {
      return res.status(400).json({ success: false, error: 'Product is required' });
    }

    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        success: false,
        simulated: false,
        error: 'GEMINI_API_KEY is not configured.',
      });
    }

    try {
      const priceDisplay =
        product.currentPrice && Number(product.currentPrice) > 0
          ? `₱${Number(product.currentPrice).toLocaleString()}`
          : 'DM for pricing';

      const themeInfo = getThemeDescriptor(theme);
      const toneGuide = getToneGuide(tone);
      const hookAngle = pickHookAngle(Number(seed) || Date.now());
      const imagePart = await resolveProductImageForGemini(product.photoUrl);

      const prompt = `You are CraftCopy. Completely rewrite a brand-new, trend-savvy ${platform} caption from scratch for this handmade product.

SELLER & PRODUCT FACTS (MUST BE ACCURATE):
- Business: "${sellerProfile?.studioName || 'Artisan Studio'}"${sellerProfile?.makerName ? ` by ${sellerProfile.makerName}` : ''}
- Product Name: "${product.name}"
- Product Details / Story: "${product.productDetails || product.story || ''}"
- Materials: "${product.materials || 'Handcrafted artisan materials'}"
- Craft Technique: "${product.craftTechnique || 'Handmade craft'}"
- Price: ${priceDisplay}

STYLE MANDATE:
- Selected Theme Style: "${themeInfo.label}" — ${themeInfo.styleGuide}
- Voice & Tone: "${tone}" — ${toneGuide}
- Visual Design Vibe: "${designStyle}"
- Fresh Hook Framework: ${hookAngle}
${previousCaption ? `\nPREVIOUS CAPTION (DO NOT COPY OR PARAPHRASE—WRITE A COMPLETELY DIFFERENT OPENING HOOK, STRUCTURE, AND PHRASING):\n"""\n${String(previousCaption).slice(0, 900)}\n"""` : ''}

REQUIREMENTS:
1. Open with a scroll-stopping modern hook tailored to today's ${platform} audience.
2. Weave in specific product details, tactile sensory imagery, and price (${priceDisplay}).
3. End with a clear, high-converting call-to-action and curated trending hashtags (${themeInfo.hashtagFlavor} + product-specific tags).
4. Return valid JSON only (title, body, callToAction, hashtags${platform === 'tiktok' ? ', hook, audioIdea' : ''}).`;

      const contents: any = imagePart
        ? [{ inlineData: { data: imagePart.data, mimeType: imagePart.mimeType } }, prompt]
        : prompt;

      const response = await callGeminiWithTimeoutAndRetry(
        () =>
          ai.models.generateContent({
            model: GEMINI_MODEL,
            contents,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
              systemInstruction:
                'You are a modern social copywriter. Never lightly tweak an old caption—always generate a completely fresh angle, hook, cadence, and CTA matching the selected theme and real product details. Return valid JSON only.',
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  body: { type: Type.STRING },
                  hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
                  callToAction: { type: Type.STRING },
                  hook: { type: Type.STRING },
                  audioIdea: { type: Type.STRING },
                },
                required: ['title', 'body', 'callToAction', 'hashtags'],
              },
            },
          }),
        18000,
        1
      );

      const parsed = JSON.parse(response.text?.trim() || '{}');
      return res.json({
        success: true,
        simulated: false,
        newCaption: parsed,
      });
    } catch (error: any) {
      console.error('Gemini caption regeneration error:', error?.message || error);
      const classified = classifyGeminiError(error);
      return res.status(classified.status).json({
        success: false,
        simulated: false,
        error: classified.message,
      });
    }
  });

  // Complete Cross-Platform Caption & Poster Copy Rewrite When Theme / Style Changes
  app.post('/api/rewrite-captions-for-theme', apiRateLimiter(60), async (req, res) => {
    const {
      product,
      sellerProfile,
      theme = 'auto',
      tone = 'friendly',
      designStyle = 'artisan',
      previousCaption = '',
      seed = Date.now(),
    } = req.body || {};

    if (!product || typeof product.name !== 'string' || !product.name.trim()) {
      return res.status(400).json({ success: false, error: 'Product details are required to rewrite captions.' });
    }

    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        success: false,
        error: 'GEMINI_API_KEY is not configured.',
      });
    }

    try {
      const priceDisplay =
        product.currentPrice && Number(product.currentPrice) > 0
          ? `₱${Number(product.currentPrice).toLocaleString()}`
          : 'DM for pricing';
      const themeInfo = getThemeDescriptor(theme);
      const toneGuide = getToneGuide(tone);
      const hookAngle = pickHookAngle(Number(seed) || Date.now());
      const imagePart = await resolveProductImageForGemini(product.photoUrl);

      const prompt = `You are CraftCopy. The seller just switched to a DIFFERENT THEME ("${themeInfo.label}" / tone "${tone}").
Your mission is to COMPLETELY REWRITE all captions and poster copy from scratch so the voice, rhythm, hook, vocabulary, and marketing style fully embody this new theme—do NOT just swap a few words from the old draft.

ACTUAL SELLER & PRODUCT FACTS (100% GROUND TRUTH):
- Business Name: "${sellerProfile?.studioName || 'Artisan Studio'}"
- Owner Name: "${sellerProfile?.makerName || product.ownerName || 'Independent Maker'}"
- Business Type: "${sellerProfile?.businessType || sellerProfile?.craftSpecialty || 'Handmade Craft'}"
- Product Name: "${product.name}"
- Product Description / Story: "${product.productDetails || product.story || 'Thoughtfully handmade piece'}"
- Category: "${product.category || 'Handmade Craft'}"
- Materials: "${product.materials || 'Hand-selected artisan materials'}"
- Craft Technique: "${product.craftTechnique || 'Small-batch handcrafting'}"
- Selling Price: ${priceDisplay}

NEW TARGET THEME & STYLE:
- Theme Aesthetic: "${themeInfo.label}" — ${themeInfo.styleGuide}
- Voice Tone: "${tone}" — ${toneGuide}
- Poster Layout Vibe: "${designStyle}"
- Fresh Hook Framework: ${hookAngle}
- Suggested Hashtag Flavor: ${themeInfo.hashtagFlavor}
${previousCaption ? `\nOLD CAPTION TO COMPLETELY DISCARD (DO NOT REUSE ITS OPENING HOOK, SENTENCE STRUCTURE, OR KEY PHRASES):\n"""\n${String(previousCaption).slice(0, 1000)}\n"""` : ''}

CRITICAL REQUIREMENTS:
1. Write brand-new, trend-aware captions for Instagram, Facebook, and TikTok that feel unmistakably written for the "${themeInfo.label}" theme and "${tone}" tone.
2. Every caption must open with a catchy, scroll-stopping hook tailored to today's audience, reference real product details (name, materials/technique/story, and price ${priceDisplay}), and close with an engaging CTA.
3. Also provide matching \`posterHeadline\` (max 7 words), \`posterSubheadline\` (max 16 words), and \`posterCallToAction\` (max 6 words) aligned to this new theme.
4. Return pure JSON matching the schema.`;

      const contents: any = imagePart
        ? [{ inlineData: { data: imagePart.data, mimeType: imagePart.mimeType } }, prompt]
        : prompt;

      const response = await callGeminiWithTimeoutAndRetry(
        () =>
          ai.models.generateContent({
            model: GEMINI_MODEL,
            contents,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
              systemInstruction:
                'You are an elite social media brand copywriter. When a user changes theme, completely transform the voice, hook, cadence, and marketing angle from the ground up while staying 100% accurate to the real product details. Return valid JSON only.',
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  posterHeadline: { type: Type.STRING },
                  posterSubheadline: { type: Type.STRING },
                  posterCallToAction: { type: Type.STRING },
                  instagram: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      body: { type: Type.STRING },
                      hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
                    },
                    required: ['title', 'body', 'hashtags'],
                  },
                  facebook: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      body: { type: Type.STRING },
                      callToAction: { type: Type.STRING },
                      hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
                    },
                    required: ['title', 'body', 'callToAction', 'hashtags'],
                  },
                  tiktok: {
                    type: Type.OBJECT,
                    properties: {
                      hook: { type: Type.STRING },
                      audioIdea: { type: Type.STRING },
                      body: { type: Type.STRING },
                      hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
                    },
                    required: ['hook', 'audioIdea', 'body', 'hashtags'],
                  },
                },
                required: ['posterHeadline', 'posterSubheadline', 'posterCallToAction', 'instagram', 'facebook', 'tiktok'],
              },
            },
          }),
        22000,
        1
      );

      const text = response.text?.trim() || '';
      if (!text) {
        return res.status(502).json({ success: false, error: 'Gemini returned an empty response. Please retry.' });
      }

      const parsed = JSON.parse(text);
      return res.json({
        success: true,
        themeLabel: themeInfo.label,
        data: parsed,
      });
    } catch (error: any) {
      console.error('Gemini theme rewrite error:', error?.message || error);
      const classified = classifyGeminiError(error);
      return res.status(classified.status).json({
        success: false,
        error: classified.message,
      });
    }
  });

  // Catch body-parser payload limit / malformed JSON errors cleanly
  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!err) return next();
    if (err?.type === 'entity.too.large' || err?.status === 413 || err?.statusCode === 413) {
      return res.status(413).json({
        success: false,
        error: 'Image or request payload is too large (max ~4.5 MB for serverless uploads). Please use a smaller or optimized photo.',
      });
    }
    if (err instanceof SyntaxError && (err as any)?.status === 400) {
      return res.status(400).json({
        success: false,
        error: 'Invalid JSON payload sent to server.',
      });
    }
    return res.status(500).json({
      success: false,
      error: err?.message || 'Unexpected server error.',
    });
  });

  return app;
}
