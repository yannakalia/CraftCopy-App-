import { ensureServerFontsReady } from './fontInit';
import sharp, { type OverlayOptions } from 'sharp';

export type PosterAesthetic =
  | 'pastel'
  | 'dark'
  | 'vibrant'
  | 'earthy'
  | 'minimalist'
  | 'appetizing'
  | 'sage'
  | 'ocean'
  | 'berry';

export type AspectRatioFormat = '4:5' | '1:1' | '9:16' | '16:9';

export type DesignVariation =
  | 'artisan'
  | 'minimalist'
  | 'editorial'
  | 'promotional'
  | 'luxury'
  | 'playful'
  | 'polaroid'
  | 'fullbleed'
  | 'archway'
  | 'spotlight';

export interface CustomPosterColors {
  backgroundHex?: string;
  backgroundSecondaryHex?: string;
  accentHex?: string;
  textPrimaryHex?: string;
  textSecondaryHex?: string;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface ServerPosterPalette {
  aesthetic: PosterAesthetic;
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
}

export interface RenderPosterParams {
  photoBuffer: Buffer | null;
  productName: string;
  brandName: string;
  categoryTag: string;
  headline: string;
  subheadline: string;
  callToAction: string;
  hashtags?: string;
  price?: number | null;
  aspectRatio?: AspectRatioFormat;
  aesthetic?: PosterAesthetic | 'auto';
  moodHint?: PosterAesthetic;
  designVariation?: DesignVariation;
  customColors?: CustomPosterColors;
}

export interface RenderedPosterResult {
  buffer: Buffer;
  width: number;
  height: number;
  mimeType: 'image/png';
  palette: ServerPosterPalette;
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
}

function hexToRgb(hex: string): RGB {
  let clean = (hex || '').replace('#', '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  const num = parseInt(clean, 16);
  if (isNaN(num)) return { r: 78, g: 101, b: 78 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function getLuminance(rgb: RGB): number {
  const a = [rgb.r, rgb.g, rgb.b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

function shiftHexLightness(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return rgbToHex(clamp(rgb.r + amount), clamp(rgb.g + amount), clamp(rgb.b + amount));
}

function blendHex(hexA: string, hexB: string, ratioB: number): string {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return rgbToHex(
    a.r * (1 - ratioB) + b.r * ratioB,
    a.g * (1 - ratioB) + b.g * ratioB,
    a.b * (1 - ratioB) + b.b * ratioB
  );
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const hn = ((h % 360) + 360) % 360 / 360;
  const sn = Math.max(0, Math.min(100, s)) / 100;
  const ln = Math.max(0, Math.min(100, l)) / 100;
  if (sn === 0) {
    const v = Math.round(ln * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  return {
    r: Math.round(hue2rgb(p, q, hn + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, hn) * 255),
    b: Math.round(hue2rgb(p, q, hn - 1 / 3) * 255),
  };
}

function buildPhotoHarmonizedPalette(
  mood: PosterAesthetic,
  dominant: RGB,
  secondary: RGB,
  undertone: 'warm' | 'cool' | 'neutral'
): ServerPosterPalette {
  const dominantHex = rgbToHex(dominant.r, dominant.g, dominant.b);
  const secondaryHex = rgbToHex(secondary.r, secondary.g, secondary.b);
  const domHsl = rgbToHsl(dominant.r, dominant.g, dominant.b);
  const secHsl = rgbToHsl(secondary.r, secondary.g, secondary.b);

  // Pick the most expressive chromatic color from the photo for the accent
  const accentSourceHsl = secHsl.s > domHsl.s + 10 ? secHsl : domHsl;
  const baseHue = accentSourceHsl.s >= 8 ? accentSourceHsl.h : undertone === 'cool' ? 205 : 28;
  const bgHue = domHsl.s >= 6 ? domHsl.h : baseHue;

  if (mood === 'dark') {
    const bgRgb = hslToRgb(bgHue, Math.min(28, Math.max(10, domHsl.s * 0.45)), 10);
    const bg2Rgb = hslToRgb(bgHue, Math.min(32, Math.max(12, domHsl.s * 0.5)), 16);
    const cardRgb = hslToRgb(bgHue, Math.min(24, Math.max(8, domHsl.s * 0.4)), 14);
    const accentRgb = hslToRgb(
      baseHue,
      accentSourceHsl.s < 12 ? 42 : Math.min(78, Math.max(48, accentSourceHsl.s)),
      62
    );
    const backgroundHex = rgbToHex(bgRgb.r, bgRgb.g, bgRgb.b);
    const accentHex = rgbToHex(accentRgb.r, accentRgb.g, accentRgb.b);
    return {
      aesthetic: 'dark',
      aestheticName: 'Photo-Matched Midnight',
      undertone,
      dominantHex,
      secondaryHex,
      accentHex,
      backgroundHex,
      backgroundSecondaryHex: rgbToHex(bg2Rgb.r, bg2Rgb.g, bg2Rgb.b),
      cardBgHex: rgbToHex(cardRgb.r, cardRgb.g, cardRgb.b),
      textPrimaryHex: '#FAF7F2',
      textSecondaryHex: blendHex('#FAF7F2', backgroundHex, 0.28),
      badgeBgHex: blendHex(backgroundHex, accentHex, 0.28),
      badgeTextHex: blendHex(accentHex, '#FFFFFF', 0.45),
      borderHex: blendHex(backgroundHex, accentHex, 0.35),
    };
  }

  // Light harmonious poster canvas derived directly from the product photo's real hue
  const bgSat = mood === 'minimalist' ? Math.min(12, domHsl.s * 0.35) : mood === 'vibrant' ? Math.min(36, Math.max(16, domHsl.s * 0.5)) : Math.min(26, Math.max(10, domHsl.s * 0.42));
  const bgLight = mood === 'minimalist' ? 97 : mood === 'pastel' ? 96 : 95;
  const bgRgb = hslToRgb(bgHue, bgSat, bgLight);
  const bg2Rgb = hslToRgb(bgHue, Math.min(38, bgSat + 8), bgLight - 5);

  // Ensure CTA accent color has strong contrast with white text (lightness <= 42%)
  const accentSat = accentSourceHsl.s < 10 ? 18 : mood === 'vibrant' ? Math.min(82, Math.max(55, accentSourceHsl.s)) : Math.min(68, Math.max(36, accentSourceHsl.s));
  const accentLight = mood === 'pastel' ? 44 : 38;
  const accentRgb = hslToRgb(baseHue, accentSat, accentLight);
  const accentHex = rgbToHex(accentRgb.r, accentRgb.g, accentRgb.b);

  const backgroundHex = rgbToHex(bgRgb.r, bgRgb.g, bgRgb.b);
  const backgroundSecondaryHex = rgbToHex(bg2Rgb.r, bg2Rgb.g, bg2Rgb.b);
  const textPrimaryRgb = hslToRgb(bgHue, Math.min(24, Math.max(8, bgSat)), 15);
  const textPrimaryHex = rgbToHex(textPrimaryRgb.r, textPrimaryRgb.g, textPrimaryRgb.b);
  const textSecondaryHex = blendHex(textPrimaryHex, backgroundHex, 0.34);

  const moodLabelMap: Record<PosterAesthetic, string> = {
    earthy: 'Photo-Matched Earthy',
    pastel: 'Photo-Matched Soft Pastel',
    vibrant: 'Photo-Matched Vibrant',
    minimalist: 'Photo-Matched Minimalist',
    appetizing: 'Photo-Matched Warm',
    sage: 'Photo-Matched Botanical',
    ocean: 'Photo-Matched Coastal',
    berry: 'Photo-Matched Berry',
    dark: 'Photo-Matched Midnight',
  };

  return {
    aesthetic: mood,
    aestheticName: moodLabelMap[mood] || 'Matched to Product Photo',
    undertone,
    dominantHex,
    secondaryHex,
    accentHex,
    backgroundHex,
    backgroundSecondaryHex,
    cardBgHex: '#FFFFFF',
    textPrimaryHex,
    textSecondaryHex,
    badgeBgHex: blendHex(backgroundHex, accentHex, 0.14),
    badgeTextHex: blendHex(accentHex, textPrimaryHex, 0.22),
    borderHex: blendHex(backgroundHex, accentHex, 0.25),
  };
}

function buildPaletteForAesthetic(
  aesthetic: PosterAesthetic,
  dominant: RGB,
  secondary: RGB,
  undertone: 'warm' | 'cool' | 'neutral'
): ServerPosterPalette {
  const dominantHex = rgbToHex(dominant.r, dominant.g, dominant.b);
  const secondaryHex = rgbToHex(secondary.r, secondary.g, secondary.b);

  switch (aesthetic) {
    case 'pastel':
      return {
        aesthetic: 'pastel',
        aestheticName: 'Soft Pastel & Cream',
        undertone,
        dominantHex,
        secondaryHex,
        accentHex: '#C9687E',
        backgroundHex: '#FDFBF7',
        backgroundSecondaryHex: '#F6EFE6',
        cardBgHex: '#FFFFFF',
        textPrimaryHex: '#3D312A',
        textSecondaryHex: '#736154',
        badgeBgHex: '#F8E9EB',
        badgeTextHex: '#8B384D',
        borderHex: '#EAE1D3',
      };
    case 'appetizing':
      return {
        aesthetic: 'appetizing',
        aestheticName: 'Appetizing Oven Warmth',
        undertone: 'warm',
        dominantHex,
        secondaryHex,
        accentHex: '#C45D28',
        backgroundHex: '#FCF7EE',
        backgroundSecondaryHex: '#F4E9D7',
        cardBgHex: '#FFFFFF',
        textPrimaryHex: '#3B2416',
        textSecondaryHex: '#75543D',
        badgeBgHex: '#FCE7D2',
        badgeTextHex: '#943A11',
        borderHex: '#E8D2BB',
      };
    case 'dark':
      return {
        aesthetic: 'dark',
        aestheticName: 'Midnight Luxury',
        undertone: 'warm',
        dominantHex,
        secondaryHex,
        accentHex: '#E0B259',
        backgroundHex: '#181412',
        backgroundSecondaryHex: '#261F1B',
        cardBgHex: '#251F1B',
        textPrimaryHex: '#FAF6F0',
        textSecondaryHex: '#C5B5A5',
        badgeBgHex: '#3D2F1E',
        badgeTextHex: '#F5CE7B',
        borderHex: '#4A3A2E',
      };
    case 'vibrant':
      return {
        aesthetic: 'vibrant',
        aestheticName: 'Vibrant Craft Pop',
        undertone,
        dominantHex,
        secondaryHex,
        accentHex: '#E65C00',
        backgroundHex: '#FFF8F0',
        backgroundSecondaryHex: '#FEEBD6',
        cardBgHex: '#FFFFFF',
        textPrimaryHex: '#2B1E16',
        textSecondaryHex: '#664E3D',
        badgeBgHex: '#FFE4CF',
        badgeTextHex: '#B84500',
        borderHex: '#F0D4BE',
      };
    case 'minimalist':
      return {
        aesthetic: 'minimalist',
        aestheticName: 'Studio Minimalist',
        undertone: 'neutral',
        dominantHex,
        secondaryHex,
        accentHex: '#4A5568',
        backgroundHex: '#F9F9F8',
        backgroundSecondaryHex: '#EEEEEC',
        cardBgHex: '#FFFFFF',
        textPrimaryHex: '#1A202C',
        textSecondaryHex: '#5A6578',
        badgeBgHex: '#EDF2F7',
        badgeTextHex: '#2D3748',
        borderHex: '#DCE2EB',
      };
    case 'sage':
      return {
        aesthetic: 'sage',
        aestheticName: 'Botanical Sage & Moss',
        undertone: 'cool',
        dominantHex,
        secondaryHex,
        accentHex: '#3D6147',
        backgroundHex: '#F4F7F3',
        backgroundSecondaryHex: '#E5EDE3',
        cardBgHex: '#FFFFFF',
        textPrimaryHex: '#1F3124',
        textSecondaryHex: '#4E6354',
        badgeBgHex: '#DCE8DA',
        badgeTextHex: '#284530',
        borderHex: '#C8D8C6',
      };
    case 'ocean':
      return {
        aesthetic: 'ocean',
        aestheticName: 'Coastal Indigo & Mist',
        undertone: 'cool',
        dominantHex,
        secondaryHex,
        accentHex: '#255F85',
        backgroundHex: '#F3F8FB',
        backgroundSecondaryHex: '#E2EEF5',
        cardBgHex: '#FFFFFF',
        textPrimaryHex: '#152C3E',
        textSecondaryHex: '#4A677D',
        badgeBgHex: '#D8EAF5',
        badgeTextHex: '#184A6B',
        borderHex: '#C4DCEA',
      };
    case 'berry':
      return {
        aesthetic: 'berry',
        aestheticName: 'Velvet Berry & Rose',
        undertone: 'warm',
        dominantHex,
        secondaryHex,
        accentHex: '#8E294C',
        backgroundHex: '#FCF4F7',
        backgroundSecondaryHex: '#F5E3EA',
        cardBgHex: '#FFFFFF',
        textPrimaryHex: '#361321',
        textSecondaryHex: '#6E3B4E',
        badgeBgHex: '#F4D7E2',
        badgeTextHex: '#721B3A',
        borderHex: '#E8C5D3',
      };
    case 'earthy':
    default:
      return {
        aesthetic: 'earthy',
        aestheticName: 'Warm Earth & Clay',
        undertone: 'warm',
        dominantHex,
        secondaryHex,
        accentHex: '#B25A38',
        backgroundHex: '#FAF5EE',
        backgroundSecondaryHex: '#EFE7DA',
        cardBgHex: '#FFFFFF',
        textPrimaryHex: '#382B21',
        textSecondaryHex: '#6B5848',
        badgeBgHex: '#E8DED1',
        badgeTextHex: '#704226',
        borderHex: '#DFD1BF',
      };
  }
}

function applyCustomColorsServer(
  base: ServerPosterPalette,
  custom?: CustomPosterColors
): ServerPosterPalette {
  if (!custom) return base;
  const hasBg = Boolean(custom.backgroundHex && /^#[0-9a-f]{6}$/i.test(custom.backgroundHex));
  const hasBg2 = Boolean(custom.backgroundSecondaryHex && /^#[0-9a-f]{6}$/i.test(custom.backgroundSecondaryHex));
  const hasAccent = Boolean(custom.accentHex && /^#[0-9a-f]{6}$/i.test(custom.accentHex));
  const hasText = Boolean(custom.textPrimaryHex && /^#[0-9a-f]{6}$/i.test(custom.textPrimaryHex));
  if (!hasBg && !hasBg2 && !hasAccent && !hasText) return base;

  const backgroundHex = hasBg ? custom.backgroundHex! : base.backgroundHex;
  const isDarkBg = getLuminance(hexToRgb(backgroundHex)) < 0.28;
  const backgroundSecondaryHex = hasBg2
    ? custom.backgroundSecondaryHex!
    : hasBg
    ? shiftHexLightness(backgroundHex, isDarkBg ? 20 : -18)
    : base.backgroundSecondaryHex;
  const accentHex = hasAccent ? custom.accentHex! : base.accentHex;
  const textPrimaryHex = hasText
    ? custom.textPrimaryHex!
    : hasBg
    ? isDarkBg
      ? '#FAF6F0'
      : '#241B15'
    : base.textPrimaryHex;
  const textSecondaryHex =
    custom.textSecondaryHex && /^#[0-9a-f]{6}$/i.test(custom.textSecondaryHex)
      ? custom.textSecondaryHex
      : blendHex(textPrimaryHex, backgroundHex, 0.32);
  const cardBgHex = hasBg ? (isDarkBg ? shiftHexLightness(backgroundHex, 16) : '#FFFFFF') : base.cardBgHex;
  const borderHex = blendHex(backgroundHex, accentHex, 0.28);
  const badgeBgHex = blendHex(backgroundHex, accentHex, isDarkBg ? 0.35 : 0.16);
  const badgeTextHex = isDarkBg ? '#FFFFFF' : blendHex(accentHex, '#000000', 0.25);

  return {
    ...base,
    aestheticName: 'Custom Palette',
    backgroundHex,
    backgroundSecondaryHex,
    accentHex,
    textPrimaryHex,
    textSecondaryHex,
    cardBgHex,
    borderHex,
    badgeBgHex,
    badgeTextHex,
  };
}

export async function analyzePhotoPaletteServer(
  photoBuffer: Buffer | null,
  aestheticOverride?: PosterAesthetic | 'auto',
  designVariation?: DesignVariation,
  customColors?: CustomPosterColors,
  moodHint?: PosterAesthetic
): Promise<ServerPosterPalette> {
  let dominant: RGB = { r: 120, g: 84, b: 54 };
  let secondary: RGB = { r: 197, g: 155, b: 60 };
  let undertone: 'warm' | 'cool' | 'neutral' = 'warm';
  let detectedAesthetic: PosterAesthetic = moodHint || 'earthy';
  let hasRealPhotoColors = false;

  if (photoBuffer && photoBuffer.length > 0) {
    try {
      const size = 48;
      const { data, info } = await sharp(photoBuffer)
        .resize(size, size, { fit: 'cover' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      let totalR = 0;
      let totalG = 0;
      let totalB = 0;
      let totalSat = 0;
      let totalLum = 0;
      let warmCount = 0;
      let coolCount = 0;
      let pixels = 0;

      const subjectBuckets = new Map<
        string,
        { weight: number; count: number; r: number; g: number; b: number; hsl: { h: number; s: number; l: number } }
      >();
      const allBuckets = new Map<
        string,
        { weight: number; count: number; r: number; g: number; b: number; hsl: { h: number; s: number; l: number } }
      >();

      for (let idx = 0, px = 0; idx < data.length; idx += info.channels, px++) {
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const row = Math.floor(px / size);
        const col = px % size;
        const inCenter = row >= 10 && row <= 38 && col >= 10 && col <= 38;

        pixels++;
        totalR += r;
        totalG += g;
        totalB += b;

        const hsl = rgbToHsl(r, g, b);
        totalSat += hsl.s;
        totalLum += hsl.l;

        if ((hsl.h >= 0 && hsl.h <= 70) || hsl.h >= 320) warmCount++;
        else if (hsl.h >= 160 && hsl.h <= 270) coolCount++;

        const key = `${Math.floor(hsl.h / 24)}-${Math.floor(hsl.s / 20)}-${Math.floor(hsl.l / 20)}`;
        const pixelWeight = (inCenter ? 2.2 : 1.0) * (hsl.s > 18 ? 1.5 : 1.0);

        const existingAll = allBuckets.get(key);
        if (existingAll) {
          existingAll.count++;
          existingAll.weight += pixelWeight;
          existingAll.r = Math.round((existingAll.r * (existingAll.count - 1) + r) / existingAll.count);
          existingAll.g = Math.round((existingAll.g * (existingAll.count - 1) + g) / existingAll.count);
          existingAll.b = Math.round((existingAll.b * (existingAll.count - 1) + b) / existingAll.count);
        } else {
          allBuckets.set(key, { weight: pixelWeight, count: 1, r, g, b, hsl });
        }

        // Ignore pure white studio backdrops & deep black shadow corners for product subject color extraction
        const isBackdropNeutral = (hsl.l > 91 && hsl.s < 14) || (hsl.l < 8 && hsl.s < 16);
        if (!isBackdropNeutral) {
          const existingSub = subjectBuckets.get(key);
          if (existingSub) {
            existingSub.count++;
            existingSub.weight += pixelWeight;
            existingSub.r = Math.round((existingSub.r * (existingSub.count - 1) + r) / existingSub.count);
            existingSub.g = Math.round((existingSub.g * (existingSub.count - 1) + g) / existingSub.count);
            existingSub.b = Math.round((existingSub.b * (existingSub.count - 1) + b) / existingSub.count);
          } else {
            subjectBuckets.set(key, { weight: pixelWeight, count: 1, r, g, b, hsl });
          }
        }
      }

      if (pixels > 0) {
        hasRealPhotoColors = true;
        const avgR = Math.round(totalR / pixels);
        const avgG = Math.round(totalG / pixels);
        const avgB = Math.round(totalB / pixels);
        const avgSat = Math.round(totalSat / pixels);
        const avgLum = Math.round(totalLum / pixels);

        const activeBuckets = subjectBuckets.size >= 2 ? subjectBuckets : allBuckets;
        const sorted = Array.from(activeBuckets.values()).sort((a, b) => b.weight - a.weight);
        dominant = sorted[0] || { r: avgR, g: avgG, b: avgB };
        secondary = sorted[1] || dominant;

        const domHsl = rgbToHsl(dominant.r, dominant.g, dominant.b);
        for (let j = 1; j < sorted.length; j++) {
          const cand = sorted[j];
          const hueDiff = Math.min(Math.abs(cand.hsl.h - domHsl.h), 360 - Math.abs(cand.hsl.h - domHsl.h));
          if (hueDiff > 24 || Math.abs(cand.hsl.l - domHsl.l) > 20 || cand.hsl.s > domHsl.s + 18) {
            secondary = cand;
            break;
          }
        }

        undertone = warmCount > coolCount * 1.25 ? 'warm' : coolCount > warmCount * 1.25 ? 'cool' : 'neutral';

        if (!moodHint) {
          if (avgLum < 36) detectedAesthetic = 'dark';
          else if (avgSat > 52) detectedAesthetic = 'vibrant';
          else if (avgLum > 65 && avgSat >= 12 && avgSat <= 60) detectedAesthetic = 'pastel';
          else if (avgSat < 20 && avgLum > 42 && avgLum < 86) detectedAesthetic = 'minimalist';
          else detectedAesthetic = 'earthy';
        }
      }
    } catch (err) {
      console.warn('Server pixel palette analysis warning:', err);
    }
  }

  let chosenAesthetic: PosterAesthetic = detectedAesthetic;
  const isAutoMode = !aestheticOverride || aestheticOverride === 'auto';

  if (!isAutoMode) {
    chosenAesthetic = aestheticOverride as PosterAesthetic;
  } else if (designVariation === 'luxury') {
    chosenAesthetic = 'dark';
  } else if (designVariation === 'minimalist') {
    chosenAesthetic = 'minimalist';
  } else if (designVariation === 'playful') {
    chosenAesthetic = 'vibrant';
  }

  // When in Auto-Match mode with an uploaded photo, harmonize the poster palette directly with the photo's real colors!
  const basePalette =
    isAutoMode && hasRealPhotoColors
      ? buildPhotoHarmonizedPalette(chosenAesthetic, dominant, secondary, undertone)
      : buildPaletteForAesthetic(chosenAesthetic, dominant, secondary, undertone);

  return applyCustomColorsServer(basePalette, customColors);
}

function sanitizePosterText(str: string): string {
  return String(str || '')
    // Remove control characters that break XML or render as tofu boxes
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    // Remove zero-width joiners and emoji variation selectors
    .replace(/[\u200B-\u200D\uFE00-\uFE0F]/g, '')
    // Strip supplementary-plane emoji blocks (not present in server TTF fonts)
    .replace(/[\u{1F000}-\u{1FAFF}]/gu, '')
    // Strip BMP dingbat/misc symbols except supported glyphs like ★ (\u2605) and ✦ (\u2726)
    .replace(/[\u2600-\u2604\u2606-\u2725\u2727-\u27BF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeXml(str: string): string {
  return sanitizePosterText(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function svgToUtf8Buffer(svg: string): Buffer {
  const trimmed = String(svg || '').trim();
  const xmlSvg = trimmed.startsWith('<?xml')
    ? trimmed
    : `<?xml version="1.0" encoding="UTF-8"?>\n${trimmed}`;
  return Buffer.from(xmlSvg, 'utf8');
}

function wrapTextLines(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const clean = sanitizePosterText(text);
  if (!clean) return [];
  const words = clean.split(' ');
  const lines: string[] = [];
  let current = '';

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      if (lines.length >= maxLines) {
        const lastIdx = lines.length - 1;
        if (!lines[lastIdx].endsWith('...')) {
          lines[lastIdx] = `${lines[lastIdx].slice(0, Math.max(0, maxCharsPerLine - 3))}...`;
        }
        return lines;
      }
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) {
    if (lines.length >= maxLines) {
      const lastIdx = lines.length - 1;
      lines[lastIdx] = `${lines[lastIdx].slice(0, Math.max(0, maxCharsPerLine - 3))}...`;
    } else {
      lines.push(current);
    }
  }
  return lines;
}

async function prepareMaskedPhoto(
  photoBuffer: Buffer | null,
  targetW: number,
  targetH: number,
  maskType: 'rounded' | 'arch' | 'sharp',
  radius: number = 24
): Promise<Buffer | null> {
  if (!photoBuffer || photoBuffer.length === 0) return null;

  const resizedPhoto = await sharp(photoBuffer)
    .rotate()
    .resize(targetW, targetH, { fit: 'cover', position: 'centre' })
    .ensureAlpha()
    .toBuffer();

  if (maskType === 'sharp') {
    return sharp(resizedPhoto).png().toBuffer();
  }

  let maskSvg: string;
  if (maskType === 'arch') {
    const archR = Math.round(targetW / 2);
    maskSvg = `<svg width="${targetW}" height="${targetH}" xmlns="http://www.w3.org/2000/svg"><path d="M 0,${targetH} L 0,${archR} A ${archR},${archR} 0 0 1 ${targetW},${archR} L ${targetW},${targetH} Z" fill="#ffffff"/></svg>`;
  } else {
    maskSvg = `<svg width="${targetW}" height="${targetH}" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="${targetW}" height="${targetH}" rx="${radius}" ry="${radius}" fill="#ffffff"/></svg>`;
  }

  return sharp(resizedPhoto)
    .composite([{ input: Buffer.from(maskSvg), blend: 'dest-in' }])
    .png()
    .toBuffer();
}

export async function renderPromotionalPosterPng(params: RenderPosterParams): Promise<RenderedPosterResult> {
  const aspectRatio: AspectRatioFormat = params.aspectRatio || '4:5';
  const designVariation: DesignVariation = params.designVariation || 'artisan';

  let width = 1080;
  let height = 1350;
  if (aspectRatio === '1:1') {
    width = 1080;
    height = 1080;
  } else if (aspectRatio === '9:16') {
    width = 1080;
    height = 1920;
  } else if (aspectRatio === '16:9') {
    width = 1920;
    height = 1080;
  }

  const palette = await analyzePhotoPaletteServer(
    params.photoBuffer,
    params.aesthetic,
    designVariation,
    params.customColors,
    params.moodHint
  );

  ensureServerFontsReady();

  const brandText = (sanitizePosterText(params.brandName) || 'CRAFTCOPY STUDIO').toUpperCase().slice(0, 36);
  const rawCategory = (sanitizePosterText(params.categoryTag) || 'HANDCRAFTED').toUpperCase().slice(0, 24);
  const categoryText = `✦ ${rawCategory} ✦`;
  const priceText =
    params.price && params.price > 0
      ? `₱${params.price.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`
      : '';
  const productTagText = (sanitizePosterText(params.productName) || 'Artisan Piece').slice(0, 34);
  const ctaText = (sanitizePosterText(params.callToAction) || 'Send a DM to Order').slice(0, 38);
  const hashText = sanitizePosterText(params.hashtags || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .map((t) => (t.startsWith('#') ? t : `#${t}`))
    .join(' ');

  const serifFont = "'Noto Serif', 'DejaVu Serif', 'Liberation Serif', Georgia, serif";
  const sansFont = "'Noto Sans', 'DejaVu Sans', 'Liberation Sans', Arial, sans-serif";
  const isLandscape = aspectRatio === '16:9';
  const composites: OverlayOptions[] = [];

  let baseSvgContent = '';
  let overlaySvgContent = '';

  const priceFill = palette.aesthetic === 'dark' ? '#E0B259' : palette.accentHex;
  const priceTextColor = palette.aesthetic === 'dark' ? '#181412' : '#FFFFFF';

  // ============================================================================
  // LAYOUT 1: FULLBLEED (Edge-to-Edge Hero Photo + Frosted/Gradient Editorial Overlay)
  // ============================================================================
  if (designVariation === 'fullbleed') {
    const heroPhoto = await prepareMaskedPhoto(params.photoBuffer, width, height, 'sharp', 0);
    if (heroPhoto) {
      composites.push({ input: heroPhoto, top: 0, left: 0 });
    }

    const headLines = wrapTextLines(params.headline || params.productName, isLandscape ? 32 : 24, 2);
    const subLines = wrapTextLines(
      params.subheadline || 'Handcrafted with intention in small batches.',
      isLandscape ? 58 : 44,
      2
    );
    const catPillW = Math.min(categoryText.length * 10.5 + 42, 420);
    const ctaPillW = Math.min(Math.max(260, ctaText.length * 14 + 64), width - 128);
    const bottomBaseY =
      height -
      168 -
      (headLines.length * 62 + 12 + Math.max(0, subLines.length - 1) * 36);

    const headEls = headLines
      .map(
        (line, i) =>
          `<text x="68" y="${bottomBaseY + i * 62}" font-family="${serifFont}" font-size="${
            isLandscape ? 56 : 52
          }" font-weight="bold" fill="#FFFFFF">${escapeXml(line)}</text>`
      )
      .join('');
    const subStart = bottomBaseY + headLines.length * 62 + 12;
    const subEls = subLines
      .map(
        (line, i) =>
          `<text x="68" y="${subStart + i * 36}" font-family="${sansFont}" font-size="24" fill="#F2ECE4">${escapeXml(
            line
          )}</text>`
      )
      .join('');

    baseSvgContent = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="${width}" height="${height}" fill="${palette.backgroundHex}"/></svg>`;

    const pricePillW = priceText ? Math.max(150, priceText.length * 22 + 52) : 0;
    overlaySvgContent = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="topScrim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#0F0B08" stop-opacity="0.72"/>
            <stop offset="100%" stop-color="#0F0B08" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="bottomScrim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#0F0B08" stop-opacity="0"/>
            <stop offset="38%" stop-color="#0F0B08" stop-opacity="0.62"/>
            <stop offset="100%" stop-color="#0F0B08" stop-opacity="0.92"/>
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="${width}" height="240" fill="url(#topScrim)"/>
        <rect x="0" y="${Math.round(height * 0.42)}" width="${width}" height="${Math.round(height * 0.58)}" fill="url(#bottomScrim)"/>
        <rect x="28" y="28" width="${width - 56}" height="${height - 56}" rx="20" fill="none" stroke="#FFFFFF" stroke-opacity="0.28" stroke-width="2"/>
        <!-- Top Floating Pills -->
        <rect x="64" y="60" width="${Math.min(brandText.length * 13 + 48, 460)}" height="44" rx="22" fill="#FFFFFF" fill-opacity="0.92"/>
        <text x="88" y="88" font-family="${sansFont}" font-size="18" font-weight="bold" letter-spacing="1.4" fill="#1E1610">${escapeXml(brandText)}</text>
        <rect x="${width - 64 - catPillW}" y="60" width="${catPillW}" height="44" rx="22" fill="${palette.accentHex}"/>
        <text x="${width - 64 - catPillW / 2}" y="88" text-anchor="middle" font-family="${sansFont}" font-size="16" font-weight="bold" fill="#FFFFFF">${escapeXml(categoryText)}</text>
        <!-- Bottom Copy -->
        ${headEls}
        ${subEls}
        <rect x="68" y="${height - 130}" width="${ctaPillW}" height="60" rx="30" fill="${palette.accentHex}"/>
        <text x="${68 + ctaPillW / 2}" y="${height - 92}" text-anchor="middle" font-family="${sansFont}" font-size="22" font-weight="bold" fill="#FFFFFF">${escapeXml(ctaText)}</text>
        ${
          priceText
            ? `
          <rect x="${width - 68 - pricePillW}" y="${height - 134}" width="${pricePillW}" height="64" rx="18" fill="#FFFFFF"/>
          <text x="${width - 68 - pricePillW / 2}" y="${height - 91}" text-anchor="middle" font-family="${sansFont}" font-size="32" font-weight="bold" fill="#18120E">${escapeXml(priceText)}</text>
        `
            : ''
        }
      </svg>
    `;
    composites.push({ input: svgToUtf8Buffer(overlaySvgContent), top: 0, left: 0 });
  }

  // ============================================================================
  // LAYOUT 2: ARCHWAY or LUXURY (Arched Photo Window + Two-Tone / Filigree Framing)
  // ============================================================================
  else if (designVariation === 'archway' || designVariation === 'luxury') {
    const isLux = designVariation === 'luxury';
    const photoW = isLandscape ? Math.round(width * 0.42) : Math.round(width * 0.72);
    const photoH = isLandscape
      ? height - 150
      : aspectRatio === '1:1'
      ? 470
      : aspectRatio === '9:16'
      ? 860
      : 660;
    const photoX = isLandscape ? 78 : Math.round((width - photoW) / 2);
    const photoY = isLandscape ? 75 : 152;
    const archR = Math.round(photoW / 2);

    const archPhoto = await prepareMaskedPhoto(params.photoBuffer, photoW, photoH, 'arch');
    if (archPhoto) {
      composites.push({ input: archPhoto, top: photoY, left: photoX });
    }

    const archPathAtPos = `M ${photoX},${photoY + photoH} L ${photoX},${photoY + archR} A ${archR},${archR} 0 0 1 ${
      photoX + photoW
    },${photoY + archR} L ${photoX + photoW},${photoY + photoH} Z`;

    if (isLandscape) {
      const textX = photoX + photoW + 64;
      const textMaxW = width - textX - 72;
      const headLines = wrapTextLines(params.headline || params.productName, 20, 2);
      const subLines = wrapTextLines(params.subheadline || 'Handcrafted in limited studio batches.', 36, 3);
      const ctaW = Math.min(Math.max(250, ctaText.length * 14 + 56), textMaxW);

      const headEls = headLines
        .map(
          (line, i) =>
            `<text x="${textX}" y="${330 + i * 60}" font-family="${serifFont}" font-size="48" font-weight="bold" fill="${
              palette.textPrimaryHex
            }">${escapeXml(line)}</text>`
        )
        .join('');
      const subStart = 330 + headLines.length * 60 + 20;
      const subEls = subLines
        .map(
          (line, i) =>
            `<text x="${textX}" y="${subStart + i * 36}" font-family="${sansFont}" font-size="24" fill="${
              palette.textSecondaryHex
            }">${escapeXml(line)}</text>`
        )
        .join('');

      baseSvgContent = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${width}" height="${height}" fill="${palette.backgroundHex}"/>
          ${
            !isLux
              ? `<rect x="0" y="0" width="${Math.round(width * 0.48)}" height="${height}" fill="${palette.backgroundSecondaryHex}"/>`
              : `<rect x="28" y="28" width="${width - 56}" height="${height - 56}" fill="none" stroke="${palette.accentHex}" stroke-width="2" stroke-opacity="0.65"/>
                 <rect x="42" y="42" width="${width - 84}" height="${height - 84}" fill="none" stroke="${palette.borderHex}" stroke-width="1"/>`
          }
          <text x="${textX}" y="160" font-family="${sansFont}" font-size="18" font-weight="bold" letter-spacing="4" fill="${palette.accentHex}">${escapeXml(brandText)}</text>
          <text x="${textX}" y="210" font-family="${sansFont}" font-size="16" font-weight="bold" letter-spacing="2" fill="${palette.textSecondaryHex}">${escapeXml(categoryText)}</text>
          <line x1="${textX}" y1="242" x2="${textX + 120}" y2="242" stroke="${palette.accentHex}" stroke-width="3"/>
          ${headEls}
          ${subEls}
          ${
            priceText
              ? `<text x="${textX}" y="${height - 230}" font-family="${serifFont}" font-size="44" font-weight="bold" fill="${palette.accentHex}">${escapeXml(priceText)}</text>`
              : ''
          }
          <rect x="${textX}" y="${height - 165}" width="${ctaW}" height="58" rx="${isLux ? 8 : 29}" fill="${palette.accentHex}"/>
          <text x="${textX + ctaW / 2}" y="${height - 128}" text-anchor="middle" font-family="${sansFont}" font-size="21" font-weight="bold" fill="${
            isLux && palette.aesthetic === 'dark' ? '#181412' : '#FFFFFF'
          }">${escapeXml(ctaText)}</text>
        </svg>
      `;
    } else {
      const headLines = wrapTextLines(params.headline || params.productName, 28, 2);
      const subLines = wrapTextLines(
        params.subheadline || 'Handcrafted in small batches.',
        48,
        aspectRatio === '1:1' ? 1 : 2
      );
      const copyY = photoY + photoH + 64;
      const headEls = headLines
        .map(
          (line, i) =>
            `<text x="${width / 2}" y="${copyY + i * 54}" text-anchor="middle" font-family="${serifFont}" font-size="42" font-weight="bold" fill="${
              palette.textPrimaryHex
            }">${escapeXml(line)}</text>`
        )
        .join('');
      const subStart = copyY + headLines.length * 54 + 14;
      const subEls = subLines
        .map(
          (line, i) =>
            `<text x="${width / 2}" y="${subStart + i * 34}" text-anchor="middle" font-family="${sansFont}" font-size="22" fill="${
              palette.textSecondaryHex
            }">${escapeXml(line)}</text>`
        )
        .join('');

      const ctaW = Math.min(Math.max(280, ctaText.length * 14 + 68), width - 160);
      const ctaY = height - 135;

      baseSvgContent = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${width}" height="${height}" fill="${palette.backgroundHex}"/>
          ${
            isLux
              ? `
                <rect x="28" y="28" width="${width - 56}" height="${height - 56}" fill="none" stroke="${palette.accentHex}" stroke-width="2" stroke-opacity="0.7"/>
                <rect x="42" y="42" width="${width - 84}" height="${height - 84}" fill="none" stroke="${palette.borderHex}" stroke-width="1"/>
              `
              : `
                <rect x="0" y="0" width="${width}" height="${Math.round(photoY + photoH * 0.52)}" fill="${palette.backgroundSecondaryHex}"/>
                <circle cx="${width / 2}" cy="${photoY + archR}" r="${archR + 28}" fill="none" stroke="${palette.accentHex}" stroke-opacity="0.24" stroke-width="2"/>
              `
          }
          <text x="${width / 2}" y="82" text-anchor="middle" font-family="${sansFont}" font-size="18" font-weight="bold" letter-spacing="4" fill="${palette.accentHex}">${escapeXml(brandText)}</text>
          <text x="${width / 2}" y="118" text-anchor="middle" font-family="${sansFont}" font-size="15" font-weight="bold" letter-spacing="2" fill="${palette.textSecondaryHex}">${escapeXml(categoryText)}</text>
          <path d="${archPathAtPos}" fill="${palette.cardBgHex}"/>
          ${headEls}
          ${subEls}
          <rect x="${(width - ctaW) / 2}" y="${ctaY}" width="${ctaW}" height="56" rx="${isLux ? 8 : 28}" fill="${palette.accentHex}"/>
          <text x="${width / 2}" y="${ctaY + 35}" text-anchor="middle" font-family="${sansFont}" font-size="21" font-weight="bold" fill="${
            isLux && palette.aesthetic === 'dark' ? '#181412' : '#FFFFFF'
          }">${escapeXml(ctaText)}</text>
          ${
            hashText
              ? `<text x="${width / 2}" y="${ctaY + 84}" text-anchor="middle" font-family="${sansFont}" font-size="16" fill="${palette.textSecondaryHex}">${escapeXml(hashText)}</text>`
              : ''
          }
        </svg>
      `;
    }

    const priceBadgeW = priceText ? Math.max(132, priceText.length * 20 + 48) : 0;
    overlaySvgContent = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <path d="${archPathAtPos}" fill="none" stroke="${isLux ? palette.accentHex : palette.borderHex}" stroke-width="${
      isLux ? 4 : 3
    }"/>
        ${
          priceText
            ? `
          <rect x="${photoX + photoW / 2 - priceBadgeW / 2}" y="${photoY + photoH - 28}" width="${priceBadgeW}" height="52" rx="26" fill="${priceFill}"/>
          <text x="${photoX + photoW / 2}" y="${photoY + photoH + 6}" text-anchor="middle" font-family="${sansFont}" font-size="28" font-weight="bold" fill="${priceTextColor}">${escapeXml(priceText)}</text>
        `
            : ''
        }
      </svg>
    `;
    composites.push({ input: svgToUtf8Buffer(overlaySvgContent), top: 0, left: 0 });
  }

  // ============================================================================
  // LAYOUT 3: POLAROID or PLAYFUL (Rotated Sticker/Polaroid Card with Drop Shadow)
  // ============================================================================
  else if (designVariation === 'polaroid' || designVariation === 'playful') {
    const isPolaroid = designVariation === 'polaroid';
    const cardW = isLandscape ? 580 : isPolaroid ? 760 : 790;
    const padSide = 34;
    const padBottom = isPolaroid ? 132 : 44;
    const innerW = cardW - padSide * 2;
    const innerH = isLandscape
      ? 600
      : aspectRatio === '1:1'
      ? 430
      : aspectRatio === '9:16'
      ? 780
      : 590;
    const cardH = padSide + innerH + padBottom;

    const innerPhoto = await prepareMaskedPhoto(params.photoBuffer, innerW, innerH, 'rounded', isPolaroid ? 8 : 20);

    // Render Polaroid / Sticker card buffer & tilt by angle
    const cardBg = svgToUtf8Buffer(
      `<svg width="${cardW}" height="${cardH}" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="${cardW}" height="${cardH}" rx="${isPolaroid ? 10 : 28}" fill="#FFFFFF" stroke="${palette.borderHex}" stroke-width="3"/>
        ${
          isPolaroid
            ? `<text x="${cardW / 2}" y="${padSide + innerH + 64}" text-anchor="middle" font-family="${serifFont}" font-size="32" font-weight="bold" fill="#2B211B">${escapeXml(productTagText)}</text>
               <text x="${cardW / 2}" y="${padSide + innerH + 102}" text-anchor="middle" font-family="${sansFont}" font-size="18" fill="#786454">${escapeXml(brandText)}</text>`
            : ''
        }
      </svg>`
    );

    const cardParts: OverlayOptions[] = [];
    if (innerPhoto) {
      cardParts.push({ input: innerPhoto, top: padSide, left: padSide });
    }
    const cardComposed = await sharp(cardBg).composite(cardParts).png().toBuffer();
    const angle = isPolaroid ? -2.2 : 2.0;
    const rotatedCard = await sharp(cardComposed)
      .rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const rotMeta = await sharp(rotatedCard).metadata();
    const rotW = rotMeta.width || cardW;
    const rotH = rotMeta.height || cardH;

    const targetCenterX = isLandscape ? Math.round(width * 0.28) : Math.round(width / 2);
    const targetCenterY = isLandscape
      ? Math.round(height / 2)
      : Math.round(130 + rotH / 2);
    const cardLeft = Math.max(20, Math.round(targetCenterX - rotW / 2));
    const cardTop = Math.max(40, Math.round(targetCenterY - rotH / 2));

    composites.push({ input: rotatedCard, top: cardTop, left: cardLeft });

    if (isLandscape) {
      const textX = Math.round(width * 0.52);
      const textMaxW = width - textX - 72;
      const headLines = wrapTextLines(params.headline || params.productName, 21, 2);
      const subLines = wrapTextLines(params.subheadline || 'Handcrafted with love.', 36, 3);
      const ctaW = Math.min(Math.max(250, ctaText.length * 14 + 60), textMaxW);

      const headEls = headLines
        .map(
          (line, i) =>
            `<text x="${textX}" y="${280 + i * 60}" font-family="${isPolaroid ? serifFont : sansFont}" font-size="48" font-weight="bold" fill="${palette.textPrimaryHex}">${escapeXml(line)}</text>`
        )
        .join('');
      const subStart = 280 + headLines.length * 60 + 20;
      const subEls = subLines
        .map(
          (line, i) =>
            `<text x="${textX}" y="${subStart + i * 36}" font-family="${sansFont}" font-size="25" fill="${palette.textSecondaryHex}">${escapeXml(line)}</text>`
        )
        .join('');

      baseSvgContent = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${width}" height="${height}" fill="${palette.backgroundHex}"/>
          <circle cx="140" cy="140" r="220" fill="${palette.accentHex}" fill-opacity="0.1"/>
          <circle cx="${width - 120}" cy="${height - 100}" r="260" fill="${palette.badgeBgHex}" fill-opacity="0.65"/>
          <rect x="${textX}" y="130" width="${Math.min(categoryText.length * 11 + 42, textMaxW)}" height="40" rx="20" fill="${palette.badgeBgHex}"/>
          <text x="${textX + 20}" y="156" font-family="${sansFont}" font-size="16" font-weight="bold" fill="${palette.badgeTextHex}">${escapeXml(categoryText)}</text>
          ${headEls}
          ${subEls}
          ${
            priceText
              ? `<rect x="${textX}" y="${height - 230}" width="${Math.max(130, priceText.length * 22 + 44)}" height="58" rx="16" fill="${priceFill}"/>
                 <text x="${textX + 22}" y="${height - 190}" font-family="${sansFont}" font-size="32" font-weight="bold" fill="${priceTextColor}">${escapeXml(priceText)}</text>`
              : ''
          }
          <rect x="${textX}" y="${height - 145}" width="${ctaW}" height="58" rx="29" fill="${palette.accentHex}"/>
          <text x="${textX + ctaW / 2}" y="${height - 108}" text-anchor="middle" font-family="${sansFont}" font-size="22" font-weight="bold" fill="#FFFFFF">${escapeXml(ctaText)}</text>
        </svg>
      `;
    } else {
      const copyStart = cardTop + rotH + 46;
      const headLines = wrapTextLines(params.headline || params.productName, 29, 2);
      const subLines = wrapTextLines(params.subheadline || 'Made by hand in small batches.', 50, aspectRatio === '1:1' ? 1 : 2);
      const ctaW = Math.min(Math.max(270, ctaText.length * 14 + 62), width - 140);
      const ctaY = height - 130;

      const headEls = headLines
        .map(
          (line, i) =>
            `<text x="${width / 2}" y="${copyStart + i * 52}" text-anchor="middle" font-family="${
              isPolaroid ? serifFont : sansFont
            }" font-size="42" font-weight="bold" fill="${palette.textPrimaryHex}">${escapeXml(line)}</text>`
        )
        .join('');
      const subStart = copyStart + headLines.length * 52 + 12;
      const subEls = subLines
        .map(
          (line, i) =>
            `<text x="${width / 2}" y="${subStart + i * 34}" text-anchor="middle" font-family="${sansFont}" font-size="22" fill="${palette.textSecondaryHex}">${escapeXml(line)}</text>`
        )
        .join('');

      baseSvgContent = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${width}" height="${height}" fill="${palette.backgroundHex}"/>
          ${
            !isPolaroid
              ? `<circle cx="130" cy="190" r="150" fill="${palette.accentHex}" fill-opacity="0.14"/>
                 <circle cx="${width - 90}" cy="${height - 190}" r="190" fill="${palette.badgeBgHex}"/>`
              : `<rect x="30" y="30" width="${width - 60}" height="${height - 60}" fill="none" stroke="${palette.borderHex}" stroke-width="2" stroke-dasharray="10 8"/>`
          }
          <text x="64" y="82" font-family="${sansFont}" font-size="19" font-weight="bold" letter-spacing="1.6" fill="${palette.textSecondaryHex}">${escapeXml(brandText)}</text>
          <rect x="${width - 64 - Math.min(categoryText.length * 10 + 40, 380)}" y="54" width="${Math.min(categoryText.length * 10 + 40, 380)}" height="38" rx="19" fill="${palette.badgeBgHex}"/>
          <text x="${width - 64 - Math.min(categoryText.length * 10 + 40, 380) / 2}" y="79" text-anchor="middle" font-family="${sansFont}" font-size="15" font-weight="bold" fill="${palette.badgeTextHex}">${escapeXml(categoryText)}</text>
          ${headEls}
          ${subEls}
          <rect x="${(width - ctaW) / 2}" y="${ctaY}" width="${ctaW}" height="56" rx="28" fill="${palette.accentHex}"/>
          <text x="${width / 2}" y="${ctaY + 36}" text-anchor="middle" font-family="${sansFont}" font-size="22" font-weight="bold" fill="#FFFFFF">${escapeXml(ctaText)}</text>
        </svg>
      `;
    }

    // Tape / Sticker accent + price stamp overlay above the tilted card
    const tapeW = 140;
    const priceW = priceText ? Math.max(128, priceText.length * 20 + 44) : 0;
    overlaySvgContent = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect x="${targetCenterX - tapeW / 2}" y="${Math.max(24, cardTop - 14)}" width="${tapeW}" height="32" rx="4" fill="${palette.accentHex}" fill-opacity="0.72"/>
        ${
          priceText && !isLandscape
            ? `
          <rect x="${cardLeft + rotW - priceW - 12}" y="${cardTop + 26}" width="${priceW}" height="54" rx="27" fill="${priceFill}"/>
          <text x="${cardLeft + rotW - priceW / 2 - 12}" y="${cardTop + 62}" text-anchor="middle" font-family="${sansFont}" font-size="28" font-weight="bold" fill="${priceTextColor}">${escapeXml(priceText)}</text>
        `
            : ''
        }
      </svg>
    `;
    composites.push({ input: svgToUtf8Buffer(overlaySvgContent), top: 0, left: 0 });
  }

  // ============================================================================
  // LAYOUT 4: SPOTLIGHT (Asymmetric Color-Blocked Split Panel Lookbook)
  // ============================================================================
  else if (designVariation === 'spotlight') {
    const splitX = isLandscape ? Math.round(width * 0.36) : Math.round(width * 0.44);
    const photoX = isLandscape ? 88 : 96;
    const photoY = isLandscape ? 92 : 168;
    const photoW = isLandscape ? Math.round(width * 0.44) : width - 192;
    const photoH = isLandscape
      ? height - 184
      : aspectRatio === '1:1'
      ? 460
      : aspectRatio === '9:16'
      ? 860
      : 660;

    const spotPhoto = await prepareMaskedPhoto(params.photoBuffer, photoW, photoH, 'sharp', 0);
    if (spotPhoto) {
      composites.push({ input: spotPhoto, top: photoY, left: photoX });
    }

    if (isLandscape) {
      const textX = photoX + photoW + 64;
      const textMaxW = width - textX - 64;
      const headLines = wrapTextLines(params.headline || params.productName, 21, 2);
      const subLines = wrapTextLines(params.subheadline || 'Modern small-batch craft.', 36, 3);
      const ctaW = Math.min(Math.max(250, ctaText.length * 14 + 58), textMaxW);

      const headEls = headLines
        .map(
          (line, i) =>
            `<text x="${textX}" y="${280 + i * 62}" font-family="${sansFont}" font-size="50" font-weight="bold" fill="${palette.textPrimaryHex}">${escapeXml(line)}</text>`
        )
        .join('');
      const subStart = 280 + headLines.length * 62 + 18;
      const subEls = subLines
        .map(
          (line, i) =>
            `<text x="${textX}" y="${subStart + i * 36}" font-family="${sansFont}" font-size="24" fill="${palette.textSecondaryHex}">${escapeXml(line)}</text>`
        )
        .join('');

      baseSvgContent = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${width}" height="${height}" fill="${palette.backgroundHex}"/>
          <rect x="0" y="0" width="${splitX}" height="${height}" fill="${palette.accentHex}"/>
          <rect x="${splitX - 18}" y="0" width="18" height="${height}" fill="${palette.backgroundSecondaryHex}"/>
          <text x="${textX}" y="128" font-family="${sansFont}" font-size="20" font-weight="bold" letter-spacing="2" fill="${palette.accentHex}">${escapeXml(brandText)}</text>
          <text x="${textX}" y="176" font-family="${sansFont}" font-size="16" font-weight="bold" fill="${palette.textSecondaryHex}">${escapeXml(categoryText)}</text>
          ${headEls}
          ${subEls}
          <rect x="${textX}" y="${height - 150}" width="${ctaW}" height="60" rx="8" fill="${palette.accentHex}"/>
          <text x="${textX + ctaW / 2}" y="${height - 112}" text-anchor="middle" font-family="${sansFont}" font-size="22" font-weight="bold" fill="#FFFFFF">${escapeXml(ctaText)}</text>
        </svg>
      `;
    } else {
      const contentY = photoY + photoH + 64;
      const headLines = wrapTextLines(params.headline || params.productName, 27, 2);
      const subLines = wrapTextLines(params.subheadline || 'Modern small-batch craft.', 50, aspectRatio === '1:1' ? 1 : 2);
      const ctaW = Math.min(Math.max(260, ctaText.length * 14 + 58), width - 160);
      const footerY = height - 135;

      const headEls = headLines
        .map(
          (line, i) =>
            `<text x="96" y="${contentY + i * 56}" font-family="${sansFont}" font-size="44" font-weight="bold" fill="${palette.textPrimaryHex}">${escapeXml(line)}</text>`
        )
        .join('');
      const subStart = contentY + headLines.length * 56 + 14;
      const subEls = subLines
        .map(
          (line, i) =>
            `<text x="96" y="${subStart + i * 34}" font-family="${sansFont}" font-size="23" fill="${palette.textSecondaryHex}">${escapeXml(line)}</text>`
        )
        .join('');

      baseSvgContent = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${width}" height="${height}" fill="${palette.backgroundHex}"/>
          <rect x="0" y="0" width="${splitX}" height="${Math.round(height * 0.62)}" fill="${palette.accentHex}"/>
          <rect x="${photoX + 18}" y="${photoY + 18}" width="${photoW}" height="${photoH}" fill="#000000" fill-opacity="0.18"/>
          <text x="64" y="88" font-family="${sansFont}" font-size="21" font-weight="bold" letter-spacing="2" fill="#FFFFFF">${escapeXml(brandText)}</text>
          <rect x="${width - 64 - Math.min(categoryText.length * 10 + 40, 360)}" y="58" width="${Math.min(categoryText.length * 10 + 40, 360)}" height="38" rx="4" fill="${palette.badgeBgHex}"/>
          <text x="${width - 64 - Math.min(categoryText.length * 10 + 40, 360) / 2}" y="83" text-anchor="middle" font-family="${sansFont}" font-size="15" font-weight="bold" fill="${palette.badgeTextHex}">${escapeXml(categoryText)}</text>
          ${headEls}
          ${subEls}
          <rect x="96" y="${footerY}" width="${ctaW}" height="56" rx="8" fill="${palette.accentHex}"/>
          <text x="${96 + ctaW / 2}" y="${footerY + 35}" text-anchor="middle" font-family="${sansFont}" font-size="22" font-weight="bold" fill="#FFFFFF">${escapeXml(ctaText)}</text>
        </svg>
      `;
    }

    const priceW = priceText ? Math.max(132, priceText.length * 20 + 44) : 0;
    overlaySvgContent = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect x="${photoX}" y="${photoY}" width="${photoW}" height="${photoH}" fill="none" stroke="#FFFFFF" stroke-width="6"/>
        ${
          priceText
            ? `
          <rect x="${photoX + photoW - priceW + 16}" y="${photoY + photoH - 42}" width="${priceW}" height="60" rx="6" fill="${palette.textPrimaryHex}"/>
          <text x="${photoX + photoW - priceW / 2 + 16}" y="${photoY + photoH - 2}" text-anchor="middle" font-family="${sansFont}" font-size="30" font-weight="bold" fill="${palette.backgroundHex}">${escapeXml(priceText)}</text>
        `
            : ''
        }
      </svg>
    `;
    composites.push({ input: svgToUtf8Buffer(overlaySvgContent), top: 0, left: 0 });
  }

  // ============================================================================
  // LAYOUT 5: EDITORIAL MAGAZINE or MINIMALIST SWISS (Top Typography + Sharp Photo)
  // ============================================================================
  else if (designVariation === 'editorial' || designVariation === 'minimalist') {
    const isEditorial = designVariation === 'editorial';
    const margin = isEditorial ? 56 : 84;

    if (isLandscape) {
      const photoW = Math.round(width * 0.48);
      const photoH = height - margin * 2;
      const photoX = width - margin - photoW;
      const photoY = margin;
      const cleanPhoto = await prepareMaskedPhoto(params.photoBuffer, photoW, photoH, 'sharp', 0);
      if (cleanPhoto) {
        composites.push({ input: cleanPhoto, top: photoY, left: photoX });
      }

      const textMaxW = photoX - margin - 48;
      const headLines = wrapTextLines(params.headline || params.productName, 19, 3);
      const subLines = wrapTextLines(params.subheadline || 'Mindfully made studio collection.', 34, 3);
      const ctaW = Math.min(Math.max(240, ctaText.length * 14 + 54), textMaxW);

      const headEls = headLines
        .map(
          (line, i) =>
            `<text x="${margin}" y="${280 + i * 64}" font-family="${isEditorial ? serifFont : sansFont}" font-size="52" font-weight="bold" fill="${palette.textPrimaryHex}">${escapeXml(line)}</text>`
        )
        .join('');
      const subStart = 280 + headLines.length * 64 + 22;
      const subEls = subLines
        .map(
          (line, i) =>
            `<text x="${margin}" y="${subStart + i * 36}" font-family="${sansFont}" font-size="24" fill="${palette.textSecondaryHex}">${escapeXml(line)}</text>`
        )
        .join('');

      baseSvgContent = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${width}" height="${height}" fill="${palette.backgroundHex}"/>
          ${
            isEditorial
              ? `<line x1="${margin}" y1="128" x2="${photoX - 48}" y2="128" stroke="${palette.textPrimaryHex}" stroke-width="3"/>`
              : `<rect x="40" y="40" width="${width - 80}" height="${height - 80}" fill="none" stroke="${palette.borderHex}" stroke-width="1.5"/>`
          }
          <text x="${margin}" y="106" font-family="${isEditorial ? serifFont : sansFont}" font-size="22" font-weight="bold" letter-spacing="3" fill="${palette.textPrimaryHex}">${escapeXml(brandText)}</text>
          <text x="${margin}" y="182" font-family="${sansFont}" font-size="16" font-weight="bold" letter-spacing="2" fill="${palette.accentHex}">${escapeXml(rawCategory)}</text>
          ${headEls}
          ${subEls}
          ${
            priceText
              ? `<text x="${margin}" y="${height - 196}" font-family="${sansFont}" font-size="36" font-weight="bold" fill="${palette.accentHex}">${escapeXml(priceText)}</text>`
              : ''
          }
          <rect x="${margin}" y="${height - margin - 58}" width="${ctaW}" height="56" rx="${isEditorial ? 2 : 28}" fill="${palette.textPrimaryHex}"/>
          <text x="${margin + ctaW / 2}" y="${height - margin - 23}" text-anchor="middle" font-family="${sansFont}" font-size="20" font-weight="bold" fill="${palette.backgroundHex}">${escapeXml(ctaText)}</text>
        </svg>
      `;
    } else {
      const headLines = wrapTextLines(params.headline || params.productName, isEditorial ? 25 : 29, 2);
      const subLines = wrapTextLines(
        params.subheadline || 'Mindfully made studio edition.',
        52,
        aspectRatio === '1:1' ? 1 : 2
      );

      const mastheadY = isEditorial ? 105 : 94;
      const headStartY = mastheadY + (isEditorial ? 82 : 72);
      const headEls = headLines
        .map(
          (line, i) =>
            `<text x="${margin}" y="${headStartY + i * 56}" font-family="${isEditorial ? serifFont : sansFont}" font-size="${
              isEditorial ? 48 : 40
            }" font-weight="bold" fill="${palette.textPrimaryHex}">${escapeXml(line)}</text>`
        )
        .join('');

      const photoY = headStartY + headLines.length * 56 + 18;
      const footerReserve = 195 + subLines.length * 34;
      const photoW = width - margin * 2;
      const photoH = Math.max(360, height - photoY - footerReserve);

      const cleanPhoto = await prepareMaskedPhoto(
        params.photoBuffer,
        photoW,
        photoH,
        isEditorial ? 'sharp' : 'rounded',
        isEditorial ? 0 : 12
      );
      if (cleanPhoto) {
        composites.push({ input: cleanPhoto, top: photoY, left: margin });
      }

      const subStartY = photoY + photoH + 54;
      const subEls = subLines
        .map(
          (line, i) =>
            `<text x="${margin}" y="${subStartY + i * 34}" font-family="${sansFont}" font-size="22" fill="${palette.textSecondaryHex}">${escapeXml(line)}</text>`
        )
        .join('');

      const ctaW = Math.min(Math.max(250, ctaText.length * 14 + 54), width - margin * 2 - 190);
      const ctaY = height - 118;

      baseSvgContent = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${width}" height="${height}" fill="${palette.backgroundHex}"/>
          ${
            isEditorial
              ? `<line x1="${margin}" y1="${mastheadY + 22}" x2="${width - margin}" y2="${mastheadY + 22}" stroke="${palette.textPrimaryHex}" stroke-width="3"/>`
              : `<rect x="44" y="44" width="${width - 88}" height="${height - 88}" fill="none" stroke="${palette.borderHex}" stroke-width="1.5"/>`
          }
          <text x="${margin}" y="${mastheadY}" font-family="${isEditorial ? serifFont : sansFont}" font-size="${
        isEditorial ? 28 : 20
      }" font-weight="bold" letter-spacing="3" fill="${palette.textPrimaryHex}">${escapeXml(brandText)}</text>
          <text x="${width - margin}" y="${mastheadY}" text-anchor="end" font-family="${sansFont}" font-size="16" font-weight="bold" letter-spacing="2" fill="${palette.accentHex}">${escapeXml(rawCategory)}</text>
          ${headEls}
          ${subEls}
          <line x1="${margin}" y1="${ctaY - 26}" x2="${width - margin}" y2="${ctaY - 26}" stroke="${palette.borderHex}" stroke-width="1.5"/>
          <rect x="${margin}" y="${ctaY}" width="${ctaW}" height="54" rx="${isEditorial ? 2 : 27}" fill="${palette.accentHex}"/>
          <text x="${margin + ctaW / 2}" y="${ctaY + 34}" text-anchor="middle" font-family="${sansFont}" font-size="20" font-weight="bold" fill="#FFFFFF">${escapeXml(ctaText)}</text>
          ${
            priceText
              ? `<text x="${width - margin}" y="${ctaY + 38}" text-anchor="end" font-family="${isEditorial ? serifFont : sansFont}" font-size="38" font-weight="bold" fill="${palette.textPrimaryHex}">${escapeXml(priceText)}</text>`
              : ''
          }
        </svg>
      `;

      overlaySvgContent = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <rect x="${margin}" y="${photoY}" width="${photoW}" height="${photoH}" rx="${isEditorial ? 0 : 12}" fill="none" stroke="${palette.borderHex}" stroke-width="2"/>
        </svg>
      `;
      composites.push({ input: svgToUtf8Buffer(overlaySvgContent), top: 0, left: 0 });
    }
  }

  // ============================================================================
  // LAYOUT 6: PROMOTIONAL / SALE (High-Contrast Banner + Price Star Badge)
  // ============================================================================
  else if (designVariation === 'promotional') {
    const photoX = isLandscape ? 64 : 84;
    const photoY = isLandscape ? 148 : 210;
    const photoW = isLandscape ? Math.round(width / 2 - 96) : width - 168;
    const photoH = isLandscape
      ? height - 212
      : aspectRatio === '1:1'
      ? 430
      : aspectRatio === '9:16'
      ? 800
      : 610;

    const promoPhoto = await prepareMaskedPhoto(params.photoBuffer, photoW, photoH, 'rounded', 24);
    if (promoPhoto) {
      composites.push({ input: promoPhoto, top: photoY, left: photoX });
    }

    if (isLandscape) {
      const textX = width / 2 + 24;
      const textMaxW = width - textX - 64;
      const headLines = wrapTextLines(params.headline || params.productName, 20, 2);
      const subLines = wrapTextLines(params.subheadline || 'Limited-time craft offer!', 36, 3);
      const headEls = headLines
        .map(
          (line, i) =>
            `<text x="${textX}" y="${290 + i * 62}" font-family="${sansFont}" font-size="50" font-weight="bold" fill="${palette.textPrimaryHex}">${escapeXml(line)}</text>`
        )
        .join('');
      const subStart = 290 + headLines.length * 62 + 16;
      const subEls = subLines
        .map(
          (line, i) =>
            `<text x="${textX}" y="${subStart + i * 36}" font-family="${sansFont}" font-size="24" fill="${palette.textSecondaryHex}">${escapeXml(line)}</text>`
        )
        .join('');

      baseSvgContent = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${width}" height="${height}" fill="${palette.backgroundHex}"/>
          <rect x="0" y="0" width="${width}" height="104" fill="${palette.accentHex}"/>
          <text x="64" y="64" font-family="${sansFont}" font-size="26" font-weight="bold" letter-spacing="2" fill="#FFFFFF">${escapeXml(brandText)}</text>
          <text x="${width - 64}" y="64" text-anchor="end" font-family="${sansFont}" font-size="22" font-weight="bold" fill="#FFFFFF">${escapeXml(categoryText)}</text>
          ${headEls}
          ${subEls}
          <rect x="${textX}" y="${height - 156}" width="${textMaxW}" height="74" rx="16" fill="${palette.accentHex}"/>
          <text x="${textX + textMaxW / 2}" y="${height - 110}" text-anchor="middle" font-family="${sansFont}" font-size="26" font-weight="bold" fill="#FFFFFF">${escapeXml(ctaText)}</text>
        </svg>
      `;
    } else {
      const copyY = photoY + photoH + 64;
      const headLines = wrapTextLines(params.headline || params.productName, 26, 2);
      const subLines = wrapTextLines(params.subheadline || 'Special release — order now.', 48, aspectRatio === '1:1' ? 1 : 2);
      const headEls = headLines
        .map(
          (line, i) =>
            `<text x="${width / 2}" y="${copyY + i * 54}" text-anchor="middle" font-family="${sansFont}" font-size="44" font-weight="bold" fill="${palette.textPrimaryHex}">${escapeXml(line)}</text>`
        )
        .join('');
      const subStart = copyY + headLines.length * 54 + 12;
      const subEls = subLines
        .map(
          (line, i) =>
            `<text x="${width / 2}" y="${subStart + i * 34}" text-anchor="middle" font-family="${sansFont}" font-size="23" fill="${palette.textSecondaryHex}">${escapeXml(line)}</text>`
        )
        .join('');

      baseSvgContent = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${width}" height="${height}" fill="${palette.backgroundHex}"/>
          <rect x="0" y="0" width="${width}" height="156" fill="${palette.accentHex}"/>
          <text x="64" y="64" font-family="${sansFont}" font-size="22" font-weight="bold" letter-spacing="2" fill="#FFFFFF">${escapeXml(brandText)}</text>
          <text x="64" y="112" font-family="${sansFont}" font-size="28" font-weight="bold" fill="#FFFFFF">${escapeXml(categoryText)}</text>
          <rect x="${photoX}" y="${photoY}" width="${photoW}" height="${photoH}" rx="24" fill="${palette.cardBgHex}"/>
          ${headEls}
          ${subEls}
          <rect x="84" y="${height - 134}" width="${width - 168}" height="70" rx="18" fill="${palette.accentHex}"/>
          <text x="${width / 2}" y="${height - 90}" text-anchor="middle" font-family="${sansFont}" font-size="26" font-weight="bold" fill="#FFFFFF">${escapeXml(ctaText)}</text>
        </svg>
      `;
    }

    const pricePillW = priceText ? Math.max(150, priceText.length * 24 + 54) : 0;
    overlaySvgContent = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect x="${photoX}" y="${photoY}" width="${photoW}" height="${photoH}" rx="24" fill="none" stroke="${palette.accentHex}" stroke-width="5"/>
        <rect x="${photoX + 20}" y="${photoY + 20}" width="${Math.min(productTagText.length * 11 + 40, photoW - 40)}" height="38" rx="10" fill="#FFFFFF" fill-opacity="0.95"/>
        <text x="${photoX + 40}" y="${photoY + 45}" font-family="${sansFont}" font-size="17" font-weight="bold" fill="#201610">${escapeXml(productTagText)}</text>
        ${
          priceText
            ? `
          <rect x="${photoX + photoW - pricePillW - 18}" y="${photoY + photoH - 42}" width="${pricePillW}" height="68" rx="34" fill="${palette.textPrimaryHex}" stroke="#FFFFFF" stroke-width="4"/>
          <text x="${photoX + photoW - pricePillW / 2 - 18}" y="${photoY + photoH + 4}" text-anchor="middle" font-family="${sansFont}" font-size="34" font-weight="bold" fill="#FFFFFF">${escapeXml(priceText)}</text>
        `
            : ''
        }
      </svg>
    `;
    composites.push({ input: svgToUtf8Buffer(overlaySvgContent), top: 0, left: 0 });
  }

  // ============================================================================
  // LAYOUT 7 (DEFAULT): ARTISAN HANDMADE CLASSIC (Framed Split Card + Warm Craft Masthead)
  // ============================================================================
  else {
    const photoX = 64;
    const photoY = isLandscape ? 64 : 122;
    const photoW = isLandscape ? Math.round(width / 2 - 88) : width - 128;
    const photoH = isLandscape
      ? height - 128
      : aspectRatio === '1:1'
      ? 475
      : aspectRatio === '9:16'
      ? 880
      : 710;
    const photoRadius = isLandscape ? 24 : 28;

    const roundedPhoto = await prepareMaskedPhoto(params.photoBuffer, photoW, photoH, 'rounded', photoRadius);
    if (roundedPhoto) {
      composites.push({ input: roundedPhoto, top: photoY, left: photoX });
    }

    if (isLandscape) {
      const textX = width / 2 + 28;
      const textMaxW = width - textX - 64;
      const headLines = wrapTextLines(params.headline || params.productName, 22, 2);
      const subLines = wrapTextLines(
        params.subheadline || 'Handcrafted with care in small studio batches.',
        36,
        3
      );

      const catPillW = Math.min(categoryText.length * 11 + 42, textMaxW);
      const ctaPillW = Math.min(Math.max(240, ctaText.length * 14 + 60), textMaxW);
      const ctaY = height - 148;

      const cursorY = 128;
      const headElements = headLines
        .map(
          (line, i) =>
            `<text x="${textX}" y="${cursorY + 125 + i * 60}" font-family="${serifFont}" font-size="48" font-weight="bold" fill="${
              palette.textPrimaryHex
            }">${escapeXml(line)}</text>`
        )
        .join('');

      const subStartY = cursorY + 125 + headLines.length * 60 + 20;
      const subElements = subLines
        .map(
          (line, i) =>
            `<text x="${textX}" y="${subStartY + i * 38}" font-family="${sansFont}" font-size="25" fill="${
              palette.textSecondaryHex
            }">${escapeXml(line)}</text>`
        )
        .join('');

      baseSvgContent = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="${palette.backgroundHex}"/>
              <stop offset="100%" stop-color="${palette.backgroundSecondaryHex}"/>
            </linearGradient>
            <radialGradient id="glowGrad" cx="45%" cy="40%" r="60%">
              <stop offset="0%" stop-color="${palette.accentHex}" stop-opacity="0.16"/>
              <stop offset="100%" stop-color="${palette.accentHex}" stop-opacity="0"/>
            </radialGradient>
          </defs>
          <rect width="${width}" height="${height}" fill="url(#bgGrad)"/>
          <rect width="${width}" height="${height}" fill="url(#glowGrad)"/>
          <rect x="34" y="34" width="${width - 68}" height="${height - 68}" fill="none" stroke="${palette.borderHex}" stroke-width="2.5"/>
          <rect x="${photoX + 4}" y="${photoY + 10}" width="${photoW}" height="${photoH}" rx="${photoRadius}" ry="${photoRadius}" fill="#000000" fill-opacity="0.13"/>
          <rect x="${photoX}" y="${photoY}" width="${photoW}" height="${photoH}" rx="${photoRadius}" ry="${photoRadius}" fill="${palette.cardBgHex}" stroke="${palette.borderHex}" stroke-width="3"/>
          <text x="${textX}" y="${cursorY}" font-family="${sansFont}" font-size="20" font-weight="bold" letter-spacing="1.5" fill="${palette.textSecondaryHex}">${escapeXml(brandText)}</text>
          <rect x="${textX}" y="${cursorY + 24}" width="${catPillW}" height="38" rx="19" fill="${palette.badgeBgHex}"/>
          <text x="${textX + 20}" y="${cursorY + 49}" font-family="${sansFont}" font-size="16" font-weight="bold" fill="${palette.badgeTextHex}">${escapeXml(categoryText)}</text>
          ${headElements}
          ${subElements}
          <rect x="${textX}" y="${ctaY}" width="${ctaPillW}" height="58" rx="29" fill="${palette.accentHex}"/>
          <text x="${textX + ctaPillW / 2}" y="${ctaY + 37}" text-anchor="middle" font-family="${sansFont}" font-size="22" font-weight="bold" fill="#FFFFFF">${escapeXml(ctaText)}</text>
          ${hashText ? `<text x="${textX}" y="${ctaY + 92}" font-family="${sansFont}" font-size="17" fill="${palette.textSecondaryHex}">${escapeXml(hashText)}</text>` : ''}
        </svg>
      `;
    } else {
      const headLines = wrapTextLines(params.headline || params.productName, 31, 2);
      const subLines = wrapTextLines(
        params.subheadline || 'Thoughtfully handmade in small batches.',
        54,
        aspectRatio === '1:1' ? 2 : 3
      );
      const catPillW = Math.min(categoryText.length * 10 + 40, 380);
      const ctaPillW = Math.min(Math.max(250, ctaText.length * 14 + 58), width - 128);
      const footerY = height - 135;

      const contentY = photoY + photoH + 62;
      const headElements = headLines
        .map(
          (line, i) =>
            `<text x="64" y="${contentY + i * 52}" font-family="${serifFont}" font-size="42" font-weight="bold" fill="${
              palette.textPrimaryHex
            }">${escapeXml(line)}</text>`
        )
        .join('');

      const subStartY = contentY + headLines.length * 52 + 12;
      const subElements = subLines
        .map(
          (line, i) =>
            `<text x="64" y="${subStartY + i * 34}" font-family="${sansFont}" font-size="23" fill="${
              palette.textSecondaryHex
            }">${escapeXml(line)}</text>`
        )
        .join('');

      baseSvgContent = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="${palette.backgroundHex}"/>
              <stop offset="100%" stop-color="${palette.backgroundSecondaryHex}"/>
            </linearGradient>
            <radialGradient id="glowGrad" cx="45%" cy="35%" r="65%">
              <stop offset="0%" stop-color="${palette.accentHex}" stop-opacity="0.16"/>
              <stop offset="100%" stop-color="${palette.accentHex}" stop-opacity="0"/>
            </radialGradient>
          </defs>
          <rect width="${width}" height="${height}" fill="url(#bgGrad)"/>
          <rect width="${width}" height="${height}" fill="url(#glowGrad)"/>
          <rect x="34" y="34" width="${width - 68}" height="${height - 68}" fill="none" stroke="${palette.borderHex}" stroke-width="2.5"/>
          <text x="64" y="84" font-family="${sansFont}" font-size="20" font-weight="bold" letter-spacing="1.4" fill="${palette.textSecondaryHex}">${escapeXml(brandText)}</text>
          <rect x="${width - 64 - catPillW}" y="57" width="${catPillW}" height="38" rx="19" fill="${palette.badgeBgHex}"/>
          <text x="${width - 64 - catPillW / 2}" y="82" text-anchor="middle" font-family="${sansFont}" font-size="15" font-weight="bold" fill="${palette.badgeTextHex}">${escapeXml(categoryText)}</text>
          <rect x="${photoX + 4}" y="${photoY + 12}" width="${photoW}" height="${photoH}" rx="${photoRadius}" ry="${photoRadius}" fill="#000000" fill-opacity="0.15"/>
          <rect x="${photoX}" y="${photoY}" width="${photoW}" height="${photoH}" rx="${photoRadius}" ry="${photoRadius}" fill="${palette.cardBgHex}"/>
          ${headElements}
          ${subElements}
          <rect x="64" y="${footerY}" width="${ctaPillW}" height="54" rx="27" fill="${palette.accentHex}"/>
          <text x="${64 + ctaPillW / 2}" y="${footerY + 35}" text-anchor="middle" font-family="${sansFont}" font-size="22" font-weight="bold" fill="#FFFFFF">${escapeXml(ctaText)}</text>
          ${hashText ? `<text x="64" y="${footerY + 84}" font-family="${sansFont}" font-size="18" fill="${palette.textSecondaryHex}">${escapeXml(hashText)}</text>` : ''}
        </svg>
      `;
    }

    const productBadgeW = Math.min(Math.max(170, productTagText.length * 10.5 + 36), photoW - 48);
    const priceBadgeW = priceText ? Math.max(120, priceText.length * 20 + 46) : 0;

    overlaySvgContent = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect x="${photoX}" y="${photoY}" width="${photoW}" height="${photoH}" rx="${photoRadius}" ry="${photoRadius}" fill="none" stroke="${palette.borderHex}" stroke-width="3"/>
        <rect x="${photoX + 24}" y="${photoY + 24}" width="${productBadgeW}" height="36" rx="18" fill="#FFFFFF" fill-opacity="0.93"/>
        <text x="${photoX + 42}" y="${photoY + 47}" font-family="${sansFont}" font-size="16" font-weight="bold" fill="#2B1E16">${escapeXml(productTagText)}</text>
        ${
          priceText
            ? `
          <rect x="${photoX + photoW - priceBadgeW - 24}" y="${photoY + photoH - 58 - 24}" width="${priceBadgeW}" height="58" rx="16" fill="${priceFill}"/>
          <text x="${photoX + photoW - priceBadgeW / 2 - 24}" y="${photoY + photoH - 43}" text-anchor="middle" font-family="${sansFont}" font-size="31" font-weight="bold" fill="${priceTextColor}">${escapeXml(priceText)}</text>
        `
            : ''
        }
      </svg>
    `;
    composites.push({ input: svgToUtf8Buffer(overlaySvgContent), top: 0, left: 0 });
  }

  const finalBuffer = await sharp(svgToUtf8Buffer(baseSvgContent))
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toBuffer();

  return {
    buffer: finalBuffer,
    width,
    height,
    mimeType: 'image/png',
    palette,
  };
}

export async function exportPosterImageForDownload(
  inputBuffer: Buffer,
  format: 'png' | 'jpg' = 'png'
): Promise<{ buffer: Buffer; mimeType: string; ext: 'png' | 'jpg'; width: number; height: number }> {
  const image = sharp(inputBuffer);
  const meta = await image.metadata();
  const width = meta.width || 1080;
  const height = meta.height || 1350;

  if (format === 'jpg') {
    const jpgBuffer = await image
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 96, chromaSubsampling: '4:4:4', mozjpeg: true })
      .toBuffer();
    return {
      buffer: jpgBuffer,
      mimeType: 'image/jpeg',
      ext: 'jpg',
      width,
      height,
    };
  }

  const isAlreadyPng =
    inputBuffer.length > 8 &&
    inputBuffer[0] === 0x89 &&
    inputBuffer[1] === 0x50 &&
    inputBuffer[2] === 0x4e &&
    inputBuffer[3] === 0x47;

  const pngBuffer = isAlreadyPng ? inputBuffer : await image.png({ compressionLevel: 6 }).toBuffer();
  return {
    buffer: pngBuffer,
    mimeType: 'image/png',
    ext: 'png',
    width,
    height,
  };
}
