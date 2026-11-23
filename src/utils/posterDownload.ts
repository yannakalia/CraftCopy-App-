export type PosterDownloadFormat = 'png' | 'jpg';

export interface SaveToGalleryResult {
  success: boolean;
  fileName?: string;
  format?: PosterDownloadFormat;
  width?: number;
  height?: number;
  method?: 'download' | 'share';
  directUrl?: string | null;
  message?: string;
  error?: string;
  permissionDenied?: boolean;
  needsSecondTap?: boolean;
  cancelled?: boolean;
}

interface ResolvedPosterAsset {
  blob: Blob;
  fileName: string;
  width?: number;
  height?: number;
  directUrl: string | null;
}

const MAX_CACHE_ENTRIES = 16;
const resolvedPosterCache = new Map<string, ResolvedPosterAsset>();
const inFlightPreloads = new Map<string, Promise<ResolvedPosterAsset>>();

function sanitizeFileStem(name?: string): string {
  const cleaned = (name || 'craftcopy-poster')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned || 'craftcopy-poster';
}

function buildPosterFileStem(productName?: string, aspectRatio: string = '4:5'): string {
  return `craftcopy-${sanitizeFileStem(productName)}-poster-${aspectRatio.replace(':', 'x')}`;
}

function makeCacheKey(src: string, format: PosterDownloadFormat, fileName: string): string {
  return `${format}::${fileName}::${src.slice(0, 200)}::${src.length}`;
}

function setCachedPosterAsset(key: string, asset: ResolvedPosterAsset): void {
  if (resolvedPosterCache.has(key)) {
    resolvedPosterCache.delete(key);
  }
  resolvedPosterCache.set(key, asset);
  if (resolvedPosterCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = resolvedPosterCache.keys().next().value;
    if (oldestKey) resolvedPosterCache.delete(oldestKey);
  }
}

function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return (
    /iPhone|iPad|iPod/i.test(ua) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua))
  );
}

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '') || isIOSDevice();
}

export function canShareFilesToSystem(): boolean {
  if (typeof navigator === 'undefined' || typeof File === 'undefined') return false;
  return typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
}

function safeCanShareFile(file: File | null): boolean {
  if (!file || !canShareFilesToSystem()) return false;
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

function decodeDataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',');
  if (parts.length < 2) {
    throw new Error('Invalid poster image data.');
  }
  const mimeMatch = parts[0].match(/data:([^;]+);base64/i);
  const mimeType = mimeMatch?.[1] || 'image/png';
  const binary = atob(parts[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

async function convertBlobFullResolution(
  sourceBlob: Blob,
  targetFormat: PosterDownloadFormat
): Promise<{ blob: Blob; width?: number; height?: number }> {
  const desiredMime = targetFormat === 'jpg' ? 'image/jpeg' : 'image/png';
  const sourceMime = (sourceBlob.type || '').toLowerCase();

  const imgUrl = URL.createObjectURL(sourceBlob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      const timer = setTimeout(() => reject(new Error('Timed out preparing image for download.')), 8000);
      el.onload = () => {
        clearTimeout(timer);
        resolve(el);
      };
      el.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Could not decode poster image for download.'));
      };
      el.src = imgUrl;
    });

    const width = img.naturalWidth || undefined;
    const height = img.naturalHeight || undefined;

    if (
      (targetFormat === 'png' && sourceMime === 'image/png') ||
      (targetFormat === 'jpg' && (sourceMime === 'image/jpeg' || sourceMime === 'image/jpg'))
    ) {
      return { blob: sourceBlob, width, height };
    }

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { blob: sourceBlob, width, height };
    }
    if (targetFormat === 'jpg') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const convertedBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b && b.size > 0) resolve(b);
          else reject(new Error('Could not encode high-resolution poster image.'));
        },
        desiredMime,
        targetFormat === 'jpg' ? 0.96 : 1.0
      );
    });

    return { blob: convertedBlob, width, height };
  } finally {
    URL.revokeObjectURL(imgUrl);
  }
}

function extractLocalUploadFileName(src: string): string | null {
  try {
    if (src.startsWith('/uploads/')) {
      return src.replace(/^\/uploads\//, '').split('?')[0];
    }
    if (/^https?:\/\//i.test(src) && typeof window !== 'undefined') {
      const parsed = new URL(src);
      if (parsed.origin === window.location.origin && parsed.pathname.startsWith('/uploads/')) {
        return parsed.pathname.replace(/^\/uploads\//, '');
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function getDirectPosterDownloadUrl(params: {
  src: string;
  productName?: string;
  aspectRatio?: string;
  format?: PosterDownloadFormat;
}): string | null {
  const { src, productName, aspectRatio = '4:5', format = 'png' } = params;
  if (!src) return null;
  const stem = buildPosterFileStem(productName, aspectRatio);
  const localUploadFile = extractLocalUploadFileName(src);
  if (localUploadFile) {
    return `/api/posters/download?file=${encodeURIComponent(localUploadFile)}&format=${encodeURIComponent(
      format
    )}&name=${encodeURIComponent(stem)}`;
  }
  if (/^https:\/\//i.test(src.trim())) {
    return `/api/posters/download?url=${encodeURIComponent(src.trim())}&format=${encodeURIComponent(
      format
    )}&name=${encodeURIComponent(stem)}`;
  }
  return null;
}

export async function resolveHighResPosterBlob(params: {
  src: string;
  productName?: string;
  aspectRatio?: string;
  format?: PosterDownloadFormat;
}): Promise<ResolvedPosterAsset> {
  const { src, productName, aspectRatio = '4:5', format = 'png' } = params;
  if (!src) {
    throw new Error('No generated poster image is available to download yet.');
  }

  const stem = buildPosterFileStem(productName, aspectRatio);
  const ext = format === 'jpg' ? 'jpg' : 'png';
  const fileName = `${stem}.${ext}`;
  const cacheKey = makeCacheKey(src, format, fileName);

  const cached = resolvedPosterCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const existingInFlight = inFlightPreloads.get(cacheKey);
  if (existingInFlight) {
    return existingInFlight;
  }

  const directUrl = getDirectPosterDownloadUrl({ src, productName, aspectRatio, format });
  const isHttpsSrc = /^https:\/\//i.test(src.trim());

  const loadPromise = (async (): Promise<ResolvedPosterAsset> => {
    // 1. Server-hosted or HTTPS-hosted poster -> fetch via dedicated attachment route at 100% native resolution
    if (directUrl) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);
      try {
        const resp = await fetch(directUrl, { signal: controller.signal, cache: 'no-store' });
        if (!resp.ok) {
          let errText = `Server returned HTTP ${resp.status} while downloading the poster.`;
          try {
            const errJson = await resp.json();
            if (errJson?.error) errText = errJson.error;
          } catch {}
          throw new Error(errText);
        }

        const resHeader = resp.headers.get('X-Poster-Resolution') || '';
        const resParts = resHeader.split('x').map(Number);
        const blob = await resp.blob();
        if (!blob || blob.size < 500 || !blob.type.startsWith('image/')) {
          throw new Error('Downloaded file did not contain valid image data.');
        }
        const asset: ResolvedPosterAsset = {
          blob,
          fileName,
          width: resParts[0] || undefined,
          height: resParts[1] || undefined,
          directUrl,
        };
        setCachedPosterAsset(cacheKey, asset);
        return asset;
      } catch (err: any) {
        // For HTTPS Supabase Storage URLs, seamlessly fall through to direct CORS fetch + canvas export if serverless endpoint fails
        if (!isHttpsSrc) {
          if (err?.name === 'AbortError') {
            throw new Error('Poster download timed out. Please check your connection and try again.');
          }
          throw err;
        }
      } finally {
        clearTimeout(timer);
      }
    }

    // 2. Full-resolution canvas data URL
    if (src.startsWith('data:image/')) {
      const rawBlob = decodeDataUrlToBlob(src);
      const converted = await convertBlobFullResolution(rawBlob, format);
      const asset: ResolvedPosterAsset = {
        blob: converted.blob,
        fileName,
        width: converted.width,
        height: converted.height,
        directUrl: null,
      };
      setCachedPosterAsset(cacheKey, asset);
      return asset;
    }

    // 3. External HTTPS image URL
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      let resp: Response;
      try {
        resp = await fetch(src, { mode: 'cors', signal: controller.signal });
      } catch {
        resp = await fetch(`/api/proxy-image?url=${encodeURIComponent(src)}`, {
          signal: controller.signal,
        });
      }
      if (!resp.ok) {
        resp = await fetch(`/api/proxy-image?url=${encodeURIComponent(src)}`, {
          signal: controller.signal,
        });
      }
      if (!resp.ok) {
        throw new Error(`Could not fetch poster image (HTTP ${resp.status}).`);
      }
      const rawBlob = await resp.blob();
      if (!rawBlob || rawBlob.size < 500) {
        throw new Error('Downloaded poster image was empty.');
      }
      const converted = await convertBlobFullResolution(rawBlob, format);
      const asset: ResolvedPosterAsset = {
        blob: converted.blob,
        fileName,
        width: converted.width,
        height: converted.height,
        directUrl: null,
      };
      setCachedPosterAsset(cacheKey, asset);
      return asset;
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new Error('Poster download timed out. Please try again.');
      }
      if (err instanceof TypeError || /CORS|Failed to fetch|NetworkError/i.test(String(err?.message))) {
        throw new Error(
          'Browser security or network blocked direct image access. Try regenerating the poster and saving again.'
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  })();

  inFlightPreloads.set(cacheKey, loadPromise);
  try {
    return await loadPromise;
  } finally {
    inFlightPreloads.delete(cacheKey);
  }
}

export function preloadPosterForGallery(params: {
  src: string;
  productName?: string;
  aspectRatio?: string;
  format?: PosterDownloadFormat;
}): void {
  if (!params.src || typeof window === 'undefined') return;
  resolveHighResPosterBlob(params).catch(() => {
    // Silent background pre-warm; errors are surfaced cleanly if the user clicks Save
  });
}

function triggerAnchorDownload(href: string, fileName: string): void {
  const link = document.createElement('a');
  link.href = href;
  link.download = fileName;
  link.rel = 'noopener noreferrer';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export async function savePosterToDeviceGallery(params: {
  src: string;
  productName?: string;
  aspectRatio?: string;
  format?: PosterDownloadFormat;
  preferSystemShare?: boolean;
}): Promise<SaveToGalleryResult> {
  const { src, productName, aspectRatio = '4:5', format = 'png', preferSystemShare = false } = params;

  if (!src) {
    return {
      success: false,
      error: 'No generated poster image is available to download yet.',
    };
  }

  const stem = buildPosterFileStem(productName, aspectRatio);
  const ext = format === 'jpg' ? 'jpg' : 'png';
  const expectedFileName = `${stem}.${ext}`;
  const cacheKey = makeCacheKey(src, format, expectedFileName);
  const directUrl = getDirectPosterDownloadUrl({ src, productName, aspectRatio, format });

  try {
    // Use pre-warmed memory cache synchronously whenever possible so mobile Safari / Chrome
    // transient user activation is NOT lost across an async fetch boundary.
    let asset = resolvedPosterCache.get(cacheKey);
    let didAwaitFetch = false;

    if (!asset) {
      didAwaitFetch = true;
      asset = await resolveHighResPosterBlob({
        src,
        productName,
        aspectRatio,
        format,
      });
    }

    const { blob, fileName, width, height } = asset;
    const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
    const fileForShare =
      typeof File !== 'undefined' ? new File([blob], fileName, { type: mimeType }) : null;

    // On iOS Safari (where <a download> on Blob URLs doesn't save to Camera Roll)
    // or when user explicitly chooses Share/Photos on mobile, invoke Web Share API Level 2.
    const shouldUseShareSheet =
      safeCanShareFile(fileForShare) &&
      (preferSystemShare || isIOSDevice() || !('download' in HTMLAnchorElement.prototype));

    if (shouldUseShareSheet && fileForShare) {
      try {
        await navigator.share({
          files: [fileForShare],
          title: productName ? `${productName} Promotional Poster` : 'CraftCopy Promotional Poster',
        });
        const dims = width && height ? `${width}×${height} ` : '';
        return {
          success: true,
          fileName,
          format,
          width,
          height,
          directUrl: asset.directUrl,
          method: 'share',
          message: `Poster ready in your device Photos/Gallery sheet (${dims}${format.toUpperCase()}). Choose "Save Image" or "Photos".`,
        };
      } catch (shareErr: any) {
        if (shareErr?.name === 'AbortError') {
          return {
            success: false,
            cancelled: true,
            directUrl: asset.directUrl,
            error: 'Save to gallery was cancelled.',
          };
        }
        if (shareErr?.name === 'NotAllowedError' || shareErr?.name === 'SecurityError') {
          if (didAwaitFetch) {
            return {
              success: false,
              needsSecondTap: true,
              directUrl: asset.directUrl,
              error:
                'Full-resolution poster is ready! Tap "Save to Gallery" or "Photos" once more to open your device save sheet.',
            };
          }
          if (preferSystemShare || !('download' in HTMLAnchorElement.prototype)) {
            return {
              success: false,
              permissionDenied: true,
              directUrl: asset.directUrl,
              error:
                'Permission to open device gallery/share sheet was blocked. Please allow downloads/photos permission or use the Direct Download link below.',
            };
          }
        }
        // Otherwise fall through to attachment download below
      }
    }

    // Standard high-res download (Android Chrome, Samsung Internet, Desktop Chrome/Firefox/Edge/Safari).
    // Android automatically indexes saved Downloads images into the Device Gallery / Photos app.
    const blobUrl = URL.createObjectURL(blob);
    try {
      triggerAnchorDownload(blobUrl, fileName);
    } catch (domErr: any) {
      URL.revokeObjectURL(blobUrl);

      // Final fallback for restricted WebViews that allow HTTP attachment links but block blob: URLs
      if (asset.directUrl) {
        try {
          triggerAnchorDownload(asset.directUrl, fileName);
          const dims = width && height ? `${width}×${height} ` : '';
          return {
            success: true,
            fileName,
            format,
            width,
            height,
            directUrl: asset.directUrl,
            method: 'download',
            message: `Saved ${dims}${format.toUpperCase()} (${fileName}) to your device Downloads & Gallery!`,
          };
        } catch {}
      }

      const isPerm =
        domErr?.name === 'NotAllowedError' ||
        domErr?.name === 'SecurityError' ||
        /permission|denied|blocked/i.test(String(domErr?.message));
      return {
        success: false,
        permissionDenied: isPerm,
        directUrl: asset.directUrl,
        error: isPerm
          ? 'Download permission was blocked by your browser or device settings. Please allow file downloads for this site and try again.'
          : domErr?.message || 'Unable to start file download on this device.',
      };
    }

    // Keep Blob URL alive long enough (15s) for Android DownloadManager to finish reading
    setTimeout(() => {
      try {
        URL.revokeObjectURL(blobUrl);
      } catch {}
    }, 15000);

    const dims = width && height ? `${width}×${height} ` : '';
    return {
      success: true,
      fileName,
      format,
      width,
      height,
      directUrl: asset.directUrl,
      method: 'download',
      message: isIOSDevice()
        ? `Downloaded ${dims}${format.toUpperCase()} (${fileName}). Tap "Save Image" in Safari Downloads to add it to Photos.`
        : `Saved ${dims}${format.toUpperCase()} (${fileName}) to your device Downloads & Gallery!`,
    };
  } catch (err: any) {
    const msg = String(err?.message || 'Failed to save poster to gallery.');
    const isPerm =
      err?.name === 'NotAllowedError' ||
      err?.name === 'SecurityError' ||
      /permission|denied|blocked/i.test(msg);
    return {
      success: false,
      permissionDenied: isPerm,
      directUrl,
      error: msg,
    };
  }
}

async function computeBlobSha256(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const digest = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    // Fallback hash if SubtleCrypto is unavailable in insecure context
  }
  const bytes = new Uint8Array(buf);
  let hash = 2166136261;
  const step = Math.max(1, Math.floor(bytes.length / 4096));
  for (let i = 0; i < bytes.length; i += step) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619);
  }
  return `fnv-${bytes.length}-${(hash >>> 0).toString(16)}`;
}

function inferImageMimeFromBytes(bytes: Uint8Array): string | null {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 4 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    return 'image/webp';
  }
  return null;
}

export async function resolvePosterImageBlobForUpload(src: string): Promise<{
  blob: Blob;
  mimeType: string;
  sha256: string;
}> {
  const trimmed = (src || '').trim();
  if (!trimmed) {
    throw new Error('No generated poster image is available to save yet.');
  }

  let blob: Blob;
  if (trimmed.startsWith('data:image/')) {
    blob = decodeDataUrlToBlob(trimmed);
  } else {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      let resp: Response;
      try {
        resp = await fetch(trimmed, {
          mode: trimmed.startsWith('/') ? 'same-origin' : 'cors',
          signal: controller.signal,
          cache: 'no-store',
        });
      } catch {
        if (/^https:\/\//i.test(trimmed)) {
          resp = await fetch(`/api/proxy-image?url=${encodeURIComponent(trimmed)}`, {
            signal: controller.signal,
          });
        } else {
          throw new Error('Failed to load generated poster image for upload.');
        }
      }

      if (!resp.ok && /^https:\/\//i.test(trimmed)) {
        resp = await fetch(`/api/proxy-image?url=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
      }

      if (!resp.ok) {
        throw new Error(`Could not read generated poster image (HTTP ${resp.status}).`);
      }

      blob = await resp.blob();
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new Error('Timed out preparing poster image for upload. Please try again.');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  if (!blob || blob.size < 500) {
    throw new Error('Generated poster image is empty or invalid.');
  }

  let mimeType = (blob.type || '').toLowerCase();
  if (!mimeType.startsWith('image/')) {
    const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    const inferred = inferImageMimeFromBytes(head);
    if (!inferred) {
      throw new Error('Selected poster data is not a valid image file.');
    }
    mimeType = inferred;
    blob = new Blob([blob], { type: mimeType });
  }

  const sha256 = await computeBlobSha256(blob);
  return { blob, mimeType, sha256 };
}

