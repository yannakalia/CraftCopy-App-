import {
  ProductInput,
  MarketingContent,
  PlatformCaption,
  ArtisanProfile,
  CustomPosterColors,
  DesignVariation,
  ProductIdea,
} from '../types';

export interface GenerationResponse {
  content: MarketingContent;
  isSimulated: boolean;
  modelUsed: string;
  note?: string;
}

export interface PosterGenerationResponse {
  success: boolean;
  posterUrl?: string;
  publicUrl?: string;
  fileName?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  fileSize?: number;
  designVariation?: DesignVariation;
  palette?: {
    aesthetic: string;
    aestheticName: string;
    undertone: 'warm' | 'cool' | 'neutral';
    dominantHex: string;
    secondaryHex: string;
    accentHex: string;
    backgroundHex: string;
    backgroundSecondaryHex: string;
    cardBgHex: string;
    textPrimaryHex: string;
    textSecondaryHex: string;
    badgeBgHex: string;
    badgeTextHex: string;
    borderHex: string;
  };
  posterCopy?: {
    headline: string;
    subheadline: string;
    callToAction: string;
    recommendedAesthetic: string;
  };
  aiModelUsed?: string;
  error?: string;
  retryable?: boolean;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 30000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Request timed out. The server took too long to respond—please click Retry.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function safeParseJsonResponse(res: Response): Promise<{ data: any; httpError?: string }> {
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (data) {
    return { data };
  }

  if (res.status === 413) {
    return {
      data: null,
      httpError: 'Image or upload payload is too large for the server limit. Please use a smaller photo and retry.',
    };
  }
  if (res.status === 504) {
    return {
      data: null,
      httpError: 'The server took too long to respond (HTTP 504). Please click Retry.',
    };
  }
  if (res.status === 404) {
    return {
      data: null,
      httpError: 'API endpoint not found (HTTP 404). Please check Netlify Functions and redirects configuration.',
    };
  }
  return {
    data: null,
    httpError: `Unexpected response from server (HTTP ${res.status}). Please retry.`,
  };
}

export async function checkServerHealth(): Promise<{
  geminiConfigured: boolean;
  supabaseConfigured: boolean;
}> {
  try {
    const res = await fetchWithTimeout('/api/health', {}, 8000);
    if (!res.ok) return { geminiConfigured: false, supabaseConfigured: false };
    const data = await res.json();
    return {
      geminiConfigured: Boolean(data.geminiConfigured),
      supabaseConfigured: Boolean(data.supabaseConfigured),
    };
  } catch {
    return { geminiConfigured: false, supabaseConfigured: false };
  }
}

export interface ThemeRewriteResponse {
  success: boolean;
  themeLabel?: string;
  data?: {
    posterHeadline: string;
    posterSubheadline: string;
    posterCallToAction: string;
    instagram: {
      title: string;
      body: string;
      hashtags: string[];
    };
    facebook: {
      title: string;
      body: string;
      callToAction: string;
      hashtags: string[];
    };
    tiktok: {
      hook: string;
      audioIdea: string;
      body: string;
      hashtags: string[];
    };
  };
  error?: string;
}

export async function generateMarketingContent(
  product: ProductInput,
  tone: string = 'friendly',
  customInstructions: string = '',
  sellerProfile?: ArtisanProfile,
  options?: { theme?: string; designStyle?: string }
): Promise<GenerationResponse> {

  const res = await fetchWithTimeout(
    '/api/generate-content',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        product,
        tone,
        customInstructions,
        sellerProfile,
        theme: options?.theme || 'auto',
        designStyle: options?.designStyle || 'artisan',
      }),
    },
    30000
  );

  const { data, httpError } = await safeParseJsonResponse(res);
  if (!data) {
    throw new Error(httpError || `Unexpected response from server (HTTP ${res.status}). Please retry.`);
  }

  if (!res.ok || data?.success === false || !data?.data) {
    throw new Error(data?.error || data?.reason || `Generation failed (HTTP ${res.status}). Please retry.`);
  }

  const d = data.data;
  const marketingResult: MarketingContent = {
    captions: {
      instagram: d.captions?.instagram || {
        title: `${product.name} ✨`,
        body: d.descriptions?.story || '',
        hashtags: ['#Handmade', '#ShopSmall', '#ArtisanCraft', '#SDG9'],
      },
      facebook: d.captions?.facebook || {
        title: `Handcrafted in our studio: ${product.name}`,
        body: d.descriptions?.short || '',
        callToAction: 'Message us to order yours!',
        hashtags: ['#Handcrafted', '#ArtisanMade'],
      },
      tiktok: d.captions?.tiktok || {
        hook: 'POV: Slow craftsmanship vs mass production 🌿',
        audioIdea: 'Cozy workshop ASMR acoustic sounds',
        body: `Making the ${product.name} from raw materials.`,
        hashtags: ['#CraftTok', '#SmallBusinessCheck'],
      },
    },
    descriptions: {
      short: d.descriptions?.short || `${product.name} made with ${product.materials || 'carefully selected materials'}.`,
      story: d.descriptions?.story || product.productDetails || product.story,
      bulletPoints: d.descriptions?.bulletPoints || [
        `Handmade with ${product.materials || 'artisan materials'}`,
        `Crafted by ${sellerProfile?.studioName || 'our studio'}`,
        'Small-batch artisan quality',
      ],
      careInstructions: d.descriptions?.careInstructions || 'Gently clean with a damp cloth.',
    },
    promotional: {
      marketPitch: d.promotional?.marketPitch || `Welcome! Here is our handmade ${product.name}.`,
      limitedDrop: d.promotional?.limitedDrop || `New batch of ${product.name} available now in limited quantities!`,
      makerStory: d.promotional?.makerStory || product.story,
    },
    pricing: (() => {
      const sellerPrice =
        product.currentPrice !== null &&
        product.currentPrice !== undefined &&
        Number(product.currentPrice) > 0
          ? Number(product.currentPrice)
          : 0;
      return {
        suggestedRetail: sellerPrice,
        wholesale: 0,
        minBreakeven: 0,
        profitMarginPercent: 0,
        pricingTip: sellerPrice > 0 ? `Selling price: ₱${sellerPrice.toLocaleString()}` : '',
        marketComparison: '',
      };
    })(),
    posterDirection: d.posterDirection
      ? {
          headline: d.posterDirection.headline || d.captions?.instagram?.title || product.name,
          subheadline: d.posterDirection.subheadline || d.descriptions?.short || '',
          callToAction: d.posterDirection.callToAction || d.captions?.facebook?.callToAction || 'Message us to order',
          recommendedAesthetic: d.posterDirection.recommendedAesthetic || 'earthy',
          visualNotes: d.posterDirection.visualNotes || '',
        }
      : undefined,
    generatedAt: new Date().toISOString(),
    isAiGenerated: true,
    aiModelUsed: data.aiModelUsed || 'Gemini 3.1 Flash Lite (Live AI)',
    isSimulated: false,
    userSatisfied: false,
  };

  return {
    content: marketingResult,
    isSimulated: false,
    modelUsed: data.aiModelUsed || 'Gemini 3.1 Flash Lite (Live AI)',
  };
}

export async function generatePosterImage(params: {
  product: ProductInput;
  sellerProfile?: ArtisanProfile;
  aspectRatio?: '4:5' | '1:1' | '9:16' | '16:9';
  designVariation?: DesignVariation | string;
  aesthetic?: string;
  customColors?: CustomPosterColors;
  regenerationInstruction?: string;
  refreshCopy?: boolean;
  previousHeadline?: string;
  posterCopy?: {
    headline?: string;
    subheadline?: string;
    callToAction?: string;
    hashtags?: string;
    recommendedAesthetic?: string;
  };
}): Promise<PosterGenerationResponse> {
  try {
    const res = await fetchWithTimeout(
      '/api/generate-poster',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      },
      30000
    );

    const { data, httpError } = await safeParseJsonResponse(res);
    if (!res.ok || !data?.success || !data?.posterUrl) {
      return {
        success: false,
        error:
          data?.error ||
          httpError ||
          `Poster generation failed (HTTP ${res.status}). Please click Retry.`,
        retryable: data?.retryable ?? res.status !== 413,
      };
    }

    return data as PosterGenerationResponse;
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Poster generation request failed. Please click Retry.',
      retryable: true,
    };
  }
}

export async function reviseMarketingCaption(
  product: ProductInput,
  currentCaption: PlatformCaption,
  revisionInstruction: string,
  platform: 'instagram' | 'facebook' | 'tiktok' = 'instagram',
  tone: string = 'friendly',
  options?: { theme?: string; sellerProfile?: ArtisanProfile }
): Promise<{ success: boolean; revisedCaption?: PlatformCaption; isSimulated: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout(
      '/api/revise-caption',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product,
          currentCaption,
          revisionInstruction,
          platform,
          tone,
          theme: options?.theme || 'auto',
          sellerProfile: options?.sellerProfile,
        }),
      },
      22000
    );

    const { data, httpError } = await safeParseJsonResponse(res);
    if (res.ok && data?.success && data?.revisedCaption) {
      return {
        success: true,
        revisedCaption: {
          ...currentCaption,
          ...data.revisedCaption,
          hashtags: data.revisedCaption.hashtags || currentCaption.hashtags,
        },
        isSimulated: false,
      };
    }

    return {
      success: false,
      isSimulated: false,
      error: data?.error || httpError || 'Could not revise caption. Please try again.',
    };
  } catch (err: any) {
    return {
      success: false,
      isSimulated: false,
      error: err?.message || 'Network error revising caption.',
    };
  }
}

export async function regenerateMarketingCaption(
  product: ProductInput,
  platform: 'instagram' | 'facebook' | 'tiktok' = 'instagram',
  tone: string = 'friendly',
  seed: number = Date.now(),
  options?: {
    theme?: string;
    designStyle?: string;
    sellerProfile?: ArtisanProfile;
    previousCaption?: string;
  }
): Promise<{ success: boolean; newCaption?: PlatformCaption; isSimulated: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout(
      '/api/regenerate-caption',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product,
          platform,
          tone,
          seed,
          theme: options?.theme || 'auto',
          designStyle: options?.designStyle || 'artisan',
          sellerProfile: options?.sellerProfile,
          previousCaption: options?.previousCaption || '',
        }),
      },
      22000
    );

    const { data, httpError } = await safeParseJsonResponse(res);
    if (res.ok && data?.success && data?.newCaption) {
      return {
        success: true,
        newCaption: data.newCaption,
        isSimulated: false,
      };
    }

    return {
      success: false,
      isSimulated: false,
      error: data?.error || httpError || 'Could not regenerate caption. Please try again.',
    };
  } catch (err: any) {
    return {
      success: false,
      isSimulated: false,
      error: err?.message || 'Network error regenerating caption.',
    };
  }
}

export async function rewriteCaptionsForTheme(params: {
  product: ProductInput;
  sellerProfile?: ArtisanProfile;
  theme: string;
  tone: string;
  designStyle?: string;
  previousCaption?: string;
  seed?: number;
}): Promise<ThemeRewriteResponse> {
  try {
    const res = await fetchWithTimeout(
      '/api/rewrite-captions-for-theme',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: params.product,
          sellerProfile: params.sellerProfile,
          theme: params.theme || 'auto',
          tone: params.tone || 'friendly',
          designStyle: params.designStyle || 'artisan',
          previousCaption: params.previousCaption || '',
          seed: params.seed ?? Date.now(),
        }),
      },
      25000
    );

    const { data, httpError } = await safeParseJsonResponse(res);
    if (res.ok && data?.success && data?.data) {
      return {
        success: true,
        themeLabel: data.themeLabel,
        data: data.data,
      };
    }

    return {
      success: false,
      error: data?.error || httpError || `Could not rewrite captions for theme (HTTP ${res.status}).`,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Network error rewriting captions for theme.',
    };
  }
}

export async function uploadPosterPng(
  posterDataUrl: string,
  fileName: string
): Promise<{ success: boolean; url?: string; publicUrl?: string; error?: string }> {
  try {
    const res = await fetchWithTimeout(
      '/api/upload-photo',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: posterDataUrl, fileName }),
      },
      20000
    );
    const { data, httpError } = await safeParseJsonResponse(res);
    if (res.ok && data?.success && data?.url) {
      return { success: true, url: data.url, publicUrl: data.publicUrl };
    }
    return { success: false, error: data?.error || httpError || 'Failed to save poster PNG' };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Upload error' };
  }
}

export async function brainstormProductIdeas(
  materials: string,
  category?: string,
  sellerProfile?: ArtisanProfile
): Promise<{ success: boolean; ideas?: ProductIdea[]; error?: string }> {
  try {
    const res = await fetchWithTimeout(
      '/api/brainstorm-ideas',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ materials, category, sellerProfile }),
      },
      25000
    );
    const { data, httpError } = await safeParseJsonResponse(res);
    if (!res.ok || !data?.success || !Array.isArray(data.ideas)) {
      return {
        success: false,
        error: data?.error || httpError || 'Could not generate ideas. Please try again.',
      };
    }
    return { success: true, ideas: data.ideas as ProductIdea[] };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to reach AI brainstorm service.' };
  }
}
