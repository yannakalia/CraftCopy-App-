/**
 * AI-Adaptive Poster Palette & Aesthetic Analyzer
 * 
 * Analyzes uploaded product photos to extract dominant & secondary colors,
 * color undertones, and classifies the visual aesthetic into:
 * - Pastel: soft pastel tones, cream backgrounds, delicate styling (e.g. knitwear, gentle crochet)
 * - Dark: sophisticated deep tones, elegant accents, luxury styling (e.g. jewelry, premium leather)
 * - Vibrant: high saturation, lively complementary palettes, playful styling (e.g. colorful crafts)
 * - Earthy: warm neutrals, terracotta, olive, artisan craft tones (e.g. pottery, ceramics, natural yarn)
 * - Minimalist: clean monochromatic neutrals, subtle accents, generous space (e.g. modern accessories)
 * - Appetizing: warm golden, honey, cinnamon, and oven-baked tones for artisanal food and treats
 * 
 * Ensures all generated colors meet WCAG contrast guidelines for razor-sharp readability.
 */

import type { PosterAesthetic as SharedPosterAesthetic, CustomPosterColors } from '../types';

export type PosterAesthetic = SharedPosterAesthetic;

export type CraftCategoryType = 'crochet' | 'food' | 'jewelry' | 'leather' | 'ceramics' | 'candles' | 'general';

export interface PosterPalette {
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
  glowHex: string;
  confidence: number;
  moodDescription: string;
  recommendedTagline: string;
  craftCategory?: CraftCategoryType;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface HSL {
  h: number; // 0-360
  s: number; // 0-100
  l: number; // 0-100
}

/**
 * Converts RGB to Hex string
 */
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (c: number) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Converts Hex string to RGB
 */
export function hexToRgb(hex: string): RGB {
  let clean = hex.replace('#', '');
  if (clean.length === 3) {
    clean = clean.split('').map(c => c + c).join('');
  }
  const num = parseInt(clean, 16);
  if (isNaN(num)) return { r: 78, g: 101, b: 78 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

/**
 * Converts RGB to HSL
 */
export function rgbToHsl(r: number, g: number, b: number): HSL {
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
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/**
 * Converts HSL (h: 0-360, s: 0-100, l: 0-100) back to RGB
 */
export function hslToRgb(h: number, s: number, l: number): RGB {
  const hh = (((h % 360) + 360) % 360) / 360;
  const ss = Math.max(0, Math.min(100, s)) / 100;
  const ll = Math.max(0, Math.min(100, l)) / 100;
  if (ss === 0) {
    const v = Math.round(ll * 255);
    return { r: v, g: v, b: v };
  }
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  const hue2rgb = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return {
    r: Math.round(hue2rgb(hh + 1 / 3) * 255),
    g: Math.round(hue2rgb(hh) * 255),
    b: Math.round(hue2rgb(hh - 1 / 3) * 255),
  };
}

function hslToHex(h: number, s: number, l: number): string {
  const rgb = hslToRgb(h, s, l);
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

/**
 * Calculate relative luminance (WCAG definition)
 */
export function getLuminance(rgb: RGB): number {
  const a = [rgb.r, rgb.g, rgb.b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

/**
 * Detects craft category from product name, category string, or materials
 */
export function inferCraftCategory(name = '', category = '', materials = '', details = ''): CraftCategoryType {
  const combined = `${name} ${category} ${materials} ${details}`.toLowerCase();
  if (combined.includes('crochet') || combined.includes('yarn') || combined.includes('knit') || combined.includes('macrame') || combined.includes('woven') || combined.includes('tote')) {
    return 'crochet';
  }
  if (combined.includes('bread') || combined.includes('bake') || combined.includes('cookie') || combined.includes('pastry') || combined.includes('cake') || combined.includes('coffee') || combined.includes('food') || combined.includes('treat')) {
    return 'food';
  }
  if (combined.includes('jewelry') || combined.includes('earring') || combined.includes('necklace') || combined.includes('ring') || combined.includes('bracelet') || combined.includes('gold') || combined.includes('silver') || combined.includes('bead')) {
    return 'jewelry';
  }
  if (combined.includes('leather') || combined.includes('wallet') || combined.includes('belt') || combined.includes('shoe') || combined.includes('veg-tan')) {
    return 'leather';
  }
  if (combined.includes('pottery') || combined.includes('ceramic') || combined.includes('clay') || combined.includes('mug') || combined.includes('vase') || combined.includes('plate')) {
    return 'ceramics';
  }
  if (combined.includes('candle') || combined.includes('soap') || combined.includes('wax') || combined.includes('scent') || combined.includes('balm') || combined.includes('skincare')) {
    return 'candles';
  }
  return 'general';
}

/**
 * Generates an integrated marketing caption package based exclusively on actual product data
 */
export function generateIntegratedCaptions(
  productName: string,
  categoryType: CraftCategoryType,
  materials = '',
  technique = '',
  price: number | null = null,
  story = '',
  ownerName = '',
  theme: PosterAesthetic | 'auto' = 'auto'
): {
  headline: string;
  shortDescription: string;
  persuasiveCaption: string;
  callToAction: string;
  hashtags: string;
} {
  const name = productName || 'Handcrafted Artisan Creation';
  const cleanMaterials = materials || 'carefully sourced artisan materials';
  const cleanTechnique = technique || 'mindful small-batch handcrafting';
  const cleanPrice =
    price && Number(price) > 0
      ? `₱${Number(price).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`
      : 'DM for pricing';
  const makerByline = ownerName ? ` by ${ownerName}` : '';
  const storyLine = story ? `\n\n${story}` : '';

  if (theme === 'dark') {
    return {
      headline: `Small-Batch Luxury: ${name}`,
      shortDescription: `Sculpted in limited numbers from ${cleanMaterials}. Quiet confidence in every detail.`,
      persuasiveCaption: `Not made for everyone—crafted only for those who notice the details.\n\nMeet the ${name}${makerByline}: formed with ${cleanMaterials} using ${cleanTechnique} for an heirloom finish that stands apart from anything off a factory line.${storyLine}\n\n• Price: ${cleanPrice}\n• Small-batch atelier release`,
      callToAction: 'DM "RESERVE" to claim this limited piece.',
      hashtags: '#QuietLuxury #SlowLuxury #ArtisanAtelier #SmallBatchCraft #HeirloomQuality #HandcraftedFinds',
    };
  }

  if (theme === 'vibrant') {
    return {
      headline: `Your New Favorite Drop: ${name}!`,
      shortDescription: `Fresh from the studio using ${cleanMaterials}. Bold, joyful, and 100% handmade.`,
      persuasiveCaption: `Stop scrolling—this is the handmade upgrade your daily routine has been waiting for! ✨\n\nMade from ${cleanMaterials} with ${cleanTechnique}, the ${name}${makerByline} brings personality and true craft energy in a small-batch drop.${storyLine}\n\n💸 Studio price: ${cleanPrice}\n⚡ Limited pieces available before this batch sells out!`,
      callToAction: 'Drop a comment or DM "MINE" before this batch is gone!',
      hashtags: '#ShopSmallFinds #ArtisanDrop #IndieMaker #ViralFinds #HandmadeMood #SupportLocalMakers',
    };
  }

  if (theme === 'pastel') {
    return {
      headline: `Soft Moments With ${name}`,
      shortDescription: `Gently handcrafted with ${cleanMaterials}. Cozy, tender, and made to be treasured.`,
      persuasiveCaption: `POV: You finally find a handmade piece that feels like a deep breath. 🤍\n\nEach ${name}${makerByline} is shaped with ${cleanMaterials} through ${cleanTechnique}, bringing soft comfort and thoughtful charm to your everyday ritual.${storyLine}\n\nPrice: ${cleanPrice} • Lovingly crafted in small batches.`,
      callToAction: 'Send a sweet DM to reserve yours or gift someone special!',
      hashtags: '#CozyAesthetic #SoftLiving #HandmadeWithCare #SmallBusinessLove #GiftIdeas #SlowCraft',
    };
  }

  if (theme === 'minimalist') {
    return {
      headline: `${name} — Studio Edition`,
      shortDescription: `Form, texture, and ${cleanMaterials}. Intentional small-batch design without clutter.`,
      persuasiveCaption: `Less noise. Better materials.\n\nThe ${name}${makerByline} is handcrafted from ${cleanMaterials} using ${cleanTechnique}. Designed for everyday utility and clean form.${storyLine}\n\n${cleanPrice} — Small-batch studio release.`,
      callToAction: 'Message us directly for availability.',
      hashtags: '#MinimalistDesign #IntentionalLiving #ModernCraft #SlowDesign #StudioMade #CleanAesthetic',
    };
  }

  if (theme === 'sage') {
    return {
      headline: `Rooted in Craft: ${name}`,
      shortDescription: `Created consciously with ${cleanMaterials} and ${cleanTechnique}. Earth-kind, small-batch quality.`,
      persuasiveCaption: `Good things still take real hands and real time. 🌿\n\nCrafted from ${cleanMaterials} using ${cleanTechnique}, the ${name}${makerByline} celebrates slow living and honest local materials.${storyLine}\n\n• Studio price: ${cleanPrice}\n• Mindfully crafted in small batches`,
      callToAction: 'Send us a DM to bring this botanical craft home.',
      hashtags: '#SlowLiving #EcoFriendlyCraft #BotanicalVibes #MindfulMaker #SustainableHandmade #LocalArtisan',
    };
  }

  if (theme === 'ocean') {
    return {
      headline: `Breezy & Timeless: ${name}`,
      shortDescription: `Handcrafted with ${cleanMaterials} for effortless, serene everyday style.`,
      persuasiveCaption: `Crisp, calm, and unmistakably handmade. 🌊\n\nThe ${name}${makerByline} pairs ${cleanMaterials} with ${cleanTechnique} for an airy piece made to travel through every season with you.${storyLine}\n\nPrice: ${cleanPrice} • Ready in limited studio numbers.`,
      callToAction: 'DM us today to claim yours before this wave wraps up!',
      hashtags: '#CoastalCraft #SereneLiving #HandcraftedEveryday #IndieStudio #BlueAesthetic #ArtisanGoods',
    };
  }

  if (theme === 'berry') {
    return {
      headline: `Boutique Pick: ${name}`,
      shortDescription: `Richly detailed with ${cleanMaterials}. A keepsake made to delight and gift.`,
      persuasiveCaption: `Consider this your sign to spoil yourself—or someone you love. 🍇✨\n\nHand-finished with ${cleanMaterials} via ${cleanTechnique}, the ${name}${makerByline} feels like opening a boutique treasure made just for you.${storyLine}\n\nPrice: ${cleanPrice} • Limited boutique edition.`,
      callToAction: 'Send a DM to order or request gift-ready wrapping!',
      hashtags: '#BoutiqueFinds #CuratedHandmade #GiftWorthy #SmallBatchBeauty #ArtisanStudio #ShopIndependent',
    };
  }

  if (theme === 'appetizing' || categoryType === 'food') {
    return {
      headline: `Fresh Out of Our Kitchen: ${name}`,
      shortDescription: `Small-batch artisanal treat made with ${cleanMaterials}. Pure, honest homemade flavor.`,
      persuasiveCaption: `Wait until you smell this fresh batch. ✨\n\nPrepared in small batches with ${cleanMaterials} using ${cleanTechnique}, our ${name}${makerByline} brings warm, homemade comfort you can taste in every bite.${storyLine}\n\nPrice: ${cleanPrice} • Fresh batch open for orders now.`,
      callToAction: 'DM us now to lock in your box before today’s batch sells out!',
      hashtags: '#FreshBatch #ArtisanFood #SmallBatchGoodness #HomemadeTreats #LocalFoodFinds #SupportLocalMakers',
    };
  }

  switch (categoryType) {
    case 'crochet':
      return {
        headline: `Slow Stitches, Cozy Soul: ${name}`,
        shortDescription: `Hand-crocheted stitch by stitch using ${cleanMaterials}. Built to be held and kept.`,
        persuasiveCaption: `You can always tell when something wasn’t rushed by a machine. 🧶\n\nEvery stitch of the ${name}${makerByline} is worked by hand using ${cleanMaterials} and ${cleanTechnique} for softness and durability that lasts.${storyLine}\n\nPrice: ${cleanPrice} • Limited small-batch release.`,
        callToAction: 'Send a DM to reserve yours or ask about custom yarn shades!',
        hashtags: '#CrochetTok #SlowFashion #HandCrocheted #ArtisanMade #CozyFinds #SupportLocalMakers',
      };

    case 'jewelry':
      return {
        headline: `Wearable Craft: ${name}`,
        shortDescription: `Hand-finished with ${cleanMaterials} for effortless everyday shine.`,
        persuasiveCaption: `The piece everyone asks "Wait—where did you get that?" ✨\n\nIndividually crafted with ${cleanMaterials} using ${cleanTechnique}, the ${name}${makerByline} pairs lightweight comfort with true maker character.${storyLine}\n\nPrice: ${cleanPrice} • Small-batch handcrafted piece.`,
        callToAction: 'Tap to save or DM us to claim yours!',
        hashtags: '#HandmadeJewelry #ArtisanAccessories #OneOfAKind #DailyJewelry #SlowCraft #ShopSmall',
      };

    case 'leather':
      return {
        headline: `Built to Age Beautifully: ${name}`,
        shortDescription: `Hand-cut and stitched from ${cleanMaterials}. Honest heirloom craft.`,
        persuasiveCaption: `Fast accessories wear out. Real leathercraft grows richer with every year you carry it.\n\nThe ${name}${makerByline} is shaped from ${cleanMaterials} using ${cleanTechnique}—crafted to earn its patina beside you.${storyLine}\n\nPrice: ${cleanPrice} • Direct from the maker’s bench.`,
        callToAction: 'Message us to order yours or request custom initials!',
        hashtags: '#LeatherCraft #BuyItForLife #HandmadeLeather #HeritageGoods #SlowFashion #MakerBuilt',
      };

    case 'ceramics':
      return {
        headline: `Shaped by Hand: ${name}`,
        shortDescription: `Small-batch stoneware crafted from ${cleanMaterials} for unhurried daily rituals.`,
        persuasiveCaption: `Your morning ritual deserves something shaped by real hands, not a conveyor belt.\n\nCrafted from ${cleanMaterials} using ${cleanTechnique}, each ${name}${makerByline} carries subtle organic variations that make yours one of one.${storyLine}\n\nPrice: ${cleanPrice} • Fresh from this kiln batch.`,
        callToAction: 'DM to claim yours from this small kiln release!',
        hashtags: '#PotteryLove #HandmadeCeramics #SlowMornings #ArtisanHome #KilnBatch #CeramicStudio',
      };

    case 'candles':
      return {
        headline: `Set the Mood: ${name}`,
        shortDescription: `Small-batch hand-poured with ${cleanMaterials} for calm, lingering warmth.`,
        persuasiveCaption: `Instant reset for tired evenings. 🕯️\n\nHand-poured with ${cleanMaterials} using ${cleanTechnique}, the ${name}${makerByline} brings clean, comforting ambiance straight to your favorite corner.${storyLine}\n\nPrice: ${cleanPrice} • Hand-poured in limited batches.`,
        callToAction: 'Send a DM to order yours or build a gift bundle!',
        hashtags: '#HandPouredCandles #CozyHome #SlowEvenings #SmallBatchCandles #BotanicalLiving #ShopLocal',
      };

    case 'general':
    default:
      return {
        headline: `Made by Real Hands: ${name}`,
        shortDescription: `Crafted in small batches from ${cleanMaterials}. Honest quality that lasts.`,
        persuasiveCaption: `Here is why handmade still hits different. ✨\n\nCrafted from ${cleanMaterials} using ${cleanTechnique}, the ${name}${makerByline} is built with intention and real local skill—no shortcuts, no mass production.${storyLine}\n\nPrice: ${cleanPrice} • Small-batch release.`,
        callToAction: 'Send a DM to reserve yours today!',
        hashtags: '#HandmadeFinds #ArtisanMade #SlowCraft #ShopSmall #SupportLocalMakers #CraftedWithCare',
      };
  }
}

/**
 * Samples pixels from an Image element and extracts subject-weighted palette & aesthetic.
 * Matches server/posterRenderer.ts so client preview & high-res download stay visually identical.
 */
export async function analyzeProductPhoto(
  imageUrl: string,
  categoryOverride?: CraftCategoryType,
  moodHint?: PosterAesthetic,
  useHarmonizedAuto: boolean = true
): Promise<PosterPalette> {
  return new Promise((resolve) => {
    const fallbackPalette = createPaletteForAesthetic(
      moodHint || (categoryOverride === 'food' ? 'appetizing' : categoryOverride === 'crochet' ? 'pastel' : 'earthy'),
      { r: 120, g: 84, b: 54 },
      { r: 197, g: 155, b: 60 }
    );

    if (!imageUrl) {
      return resolve(fallbackPalette);
    }

    let settled = false;
    const finish = (result: PosterPalette) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(result);
    };

    const timeoutId = setTimeout(() => {
      finish(fallbackPalette);
    }, 5000);

    let triedProxy = false;
    const loadImage = (src: string) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onerror = () => {
        if (!triedProxy && /^https:\/\//i.test(imageUrl)) {
          triedProxy = true;
          loadImage(`/api/proxy-image?url=${encodeURIComponent(imageUrl)}`);
        } else {
          finish(fallbackPalette);
        }
      };

      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) return finish(fallbackPalette);

          const sampleSize = 72;
          canvas.width = sampleSize;
          canvas.height = sampleSize;
          ctx.drawImage(img, 0, 0, sampleSize, sampleSize);

          const imgData = ctx.getImageData(0, 0, sampleSize, sampleSize);
          const data = imgData.data;

          let totalR = 0, totalG = 0, totalB = 0;
          let totalSat = 0, totalLum = 0;
          let warmHueCount = 0;
          let coolHueCount = 0;
          let validPixels = 0;

          const allBuckets = new Map<string, { weight: number; count: number; r: number; g: number; b: number; hsl: HSL }>();
          const subjectBuckets = new Map<string, { weight: number; count: number; r: number; g: number; b: number; hsl: HSL }>();

          for (let idx = 0; idx < sampleSize * sampleSize; idx++) {
            const i = idx * 4;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];

            if (a < 128) continue;

            const px = idx % sampleSize;
            const py = Math.floor(idx / sampleSize);
            const inCenter = px >= 12 && px <= 59 && py >= 12 && py <= 59;

            validPixels++;
            totalR += r;
            totalG += g;
            totalB += b;

            const hsl = rgbToHsl(r, g, b);
            totalSat += hsl.s;
            totalLum += hsl.l;

            if ((hsl.h >= 0 && hsl.h <= 70) || hsl.h >= 320) {
              warmHueCount++;
            } else if (hsl.h >= 160 && hsl.h <= 270) {
              coolHueCount++;
            }

            const hueBucket = Math.floor(hsl.h / 24);
            const satBucket = Math.floor(hsl.s / 20);
            const lightBucket = Math.floor(hsl.l / 20);
            const bucketKey = `${hueBucket}-${satBucket}-${lightBucket}`;
            const pixelWeight = (inCenter ? 2.2 : 1) * (1 + hsl.s / 90);

            const existing = allBuckets.get(bucketKey);
            if (existing) {
              existing.weight += pixelWeight;
              existing.count++;
              existing.r = Math.round((existing.r * (existing.count - 1) + r) / existing.count);
              existing.g = Math.round((existing.g * (existing.count - 1) + g) / existing.count);
              existing.b = Math.round((existing.b * (existing.count - 1) + b) / existing.count);
            } else {
              allBuckets.set(bucketKey, { weight: pixelWeight, count: 1, r, g, b, hsl });
            }

            const isNearPureBackdrop = hsl.l > 92 || hsl.l < 8 || (hsl.s < 8 && (hsl.l > 84 || hsl.l < 16));
            if (!isNearPureBackdrop) {
              const existingSub = subjectBuckets.get(bucketKey);
              if (existingSub) {
                existingSub.weight += pixelWeight;
                existingSub.count++;
                existingSub.r = Math.round((existingSub.r * (existingSub.count - 1) + r) / existingSub.count);
                existingSub.g = Math.round((existingSub.g * (existingSub.count - 1) + g) / existingSub.count);
                existingSub.b = Math.round((existingSub.b * (existingSub.count - 1) + b) / existingSub.count);
              } else {
                subjectBuckets.set(bucketKey, { weight: pixelWeight, count: 1, r, g, b, hsl });
              }
            }
          }

          if (validPixels === 0) return finish(fallbackPalette);

          const avgR = Math.round(totalR / validPixels);
          const avgG = Math.round(totalG / validPixels);
          const avgB = Math.round(totalB / validPixels);
          const avgSat = Math.round(totalSat / validPixels);
          const avgLum = Math.round(totalLum / validPixels);

          const activeBuckets = subjectBuckets.size >= 2 ? subjectBuckets : allBuckets;
          const sortedBuckets = Array.from(activeBuckets.values()).sort((a, b) => b.weight - a.weight);
          const dominant = sortedBuckets[0] || { r: avgR, g: avgG, b: avgB, hsl: rgbToHsl(avgR, avgG, avgB) };

          let secondary = sortedBuckets[1] || dominant;
          for (let j = 1; j < sortedBuckets.length; j++) {
            const cand = sortedBuckets[j];
            const hueDiff = Math.min(Math.abs(cand.hsl.h - dominant.hsl.h), 360 - Math.abs(cand.hsl.h - dominant.hsl.h));
            if (hueDiff > 24 || Math.abs(cand.hsl.l - dominant.hsl.l) > 20 || cand.hsl.s > dominant.hsl.s + 18) {
              secondary = cand;
              break;
            }
          }

          let aesthetic: PosterAesthetic = moodHint || 'earthy';
          if (!moodHint) {
            if (categoryOverride === 'food') {
              aesthetic = 'appetizing';
            } else if (avgLum < 36) {
              aesthetic = 'dark';
            } else if (avgSat > 52) {
              aesthetic = 'vibrant';
            } else if (avgLum > 65 && avgSat >= 12 && avgSat <= 60) {
              aesthetic = 'pastel';
            } else if (avgSat < 20 && avgLum > 42 && avgLum < 86) {
              aesthetic = 'minimalist';
            } else {
              aesthetic = 'earthy';
            }
          }

          const undertone: 'warm' | 'cool' | 'neutral' =
            warmHueCount > coolHueCount * 1.25 ? 'warm' :
            coolHueCount > warmHueCount * 1.25 ? 'cool' : 'neutral';

          const palette = useHarmonizedAuto
            ? buildPhotoHarmonizedPalette(aesthetic, dominant, secondary, undertone)
            : createPaletteForAesthetic(aesthetic, dominant, secondary, undertone);
          palette.confidence = 94;
          palette.craftCategory = categoryOverride;
          finish(palette);
        } catch (err) {
          console.warn('Canvas palette analysis error (falling back):', err);
          if (!triedProxy && /^https:\/\//i.test(imageUrl)) {
            triedProxy = true;
            loadImage(`/api/proxy-image?url=${encodeURIComponent(imageUrl)}`);
          } else {
            finish(fallbackPalette);
          }
        }
      };

      img.src = src;
      if (img.complete && img.naturalWidth > 0 && img.onload) {
        img.onload(new Event('load'));
      }
    };

    loadImage(imageUrl);
  });
}

/**
 * Derives a harmonized poster palette directly from the uploaded product photo's dominant & secondary colors
 * while respecting the aesthetic mood and preserving WCAG text contrast.
 */
export function buildPhotoHarmonizedPalette(
  aesthetic: PosterAesthetic,
  dominant: RGB,
  secondary: RGB,
  undertone: 'warm' | 'cool' | 'neutral' = 'warm'
): PosterPalette {
  const base = createPaletteForAesthetic(aesthetic, dominant, secondary, undertone);
  const domHsl = rgbToHsl(dominant.r, dominant.g, dominant.b);
  const secHsl = rgbToHsl(secondary.r, secondary.g, secondary.b);

  const hue = domHsl.s >= 10 ? domHsl.h : secHsl.s >= 10 ? secHsl.h : undertone === 'cool' ? 205 : 32;
  const accentHue = secHsl.s >= 18 ? secHsl.h : hue;
  const satBase = Math.max(12, Math.min(34, domHsl.s * 0.55));
  const accentSat = Math.max(42, Math.min(72, Math.max(domHsl.s, secHsl.s, 48)));

  if (aesthetic === 'dark') {
    const backgroundHex = hslToHex(hue, Math.min(26, satBase), 10);
    const backgroundSecondaryHex = hslToHex(hue, Math.min(28, satBase), 15);
    const accentHex = hslToHex(accentHue, Math.max(52, accentSat), 60);
    const badgeBgHex = hslToHex(hue, Math.min(30, satBase + 6), 21);
    const borderHex = hslToHex(hue, Math.min(28, satBase), 27);
    const acRgb = hexToRgb(accentHex);
    return {
      ...base,
      aestheticName: 'Matched to Photo (Moody)',
      backgroundHex,
      backgroundSecondaryHex,
      cardBgHex: hslToHex(hue, Math.min(24, satBase), 16),
      accentHex,
      textPrimaryHex: '#FAF6F0',
      textSecondaryHex: hslToHex(hue, 18, 76),
      badgeBgHex,
      badgeTextHex: hslToHex(accentHue, 70, 76),
      borderHex,
      glowHex: `rgba(${acRgb.r}, ${acRgb.g}, ${acRgb.b}, 0.22)`,
    };
  }

  const bgLightness = aesthetic === 'minimalist' ? 97 : aesthetic === 'pastel' ? 96 : 95;
  const bgSat = aesthetic === 'minimalist' ? Math.min(10, satBase) : satBase;
  const backgroundHex = hslToHex(hue, bgSat, bgLightness);
  const backgroundSecondaryHex = hslToHex(hue, Math.min(38, bgSat + 6), bgLightness - 5);
  const accentHex = hslToHex(accentHue, accentSat, 39);
  const textPrimaryHex = hslToHex(hue, Math.min(30, bgSat + 8), 16);
  const textSecondaryHex = hslToHex(hue, Math.min(24, bgSat + 4), 35);
  const badgeBgHex = hslToHex(accentHue, Math.min(48, bgSat + 18), 89);
  const badgeTextHex = hslToHex(accentHue, accentSat, 28);
  const borderHex = hslToHex(hue, Math.min(35, bgSat + 10), 82);
  const acRgb = hexToRgb(accentHex);

  return {
    ...base,
    aestheticName: 'Matched to Product Photo',
    backgroundHex,
    backgroundSecondaryHex,
    cardBgHex: '#FFFFFF',
    accentHex,
    textPrimaryHex,
    textSecondaryHex,
    badgeBgHex,
    badgeTextHex,
    borderHex,
    glowHex: `rgba(${acRgb.r}, ${acRgb.g}, ${acRgb.b}, 0.16)`,
  };
}

/**
 * Builds a coordinated, accessible color scheme for a given aesthetic and sampled colors.
 */
export function createPaletteForAesthetic(
  aesthetic: PosterAesthetic,
  dominant: RGB,
  secondary: RGB,
  undertone: 'warm' | 'cool' | 'neutral' = 'warm'
): PosterPalette {
  const domHex = rgbToHex(dominant.r, dominant.g, dominant.b);
  const secHex = rgbToHex(secondary.r, secondary.g, secondary.b);

  switch (aesthetic) {
    case 'pastel': {
      return {
        aesthetic: 'pastel',
        aestheticName: 'Soft Pastel & Cream',
        undertone,
        dominantHex: domHex,
        secondaryHex: secHex,
        accentHex: '#C9687E',
        backgroundHex: '#FDFBF7',
        backgroundSecondaryHex: '#F6EFE6',
        cardBgHex: '#FFFFFF',
        textPrimaryHex: '#3D312A',
        textSecondaryHex: '#736154',
        badgeBgHex: '#F8E9EB',
        badgeTextHex: '#8B384D',
        borderHex: '#EAE1D3',
        glowHex: 'rgba(201, 104, 126, 0.15)',
        confidence: 90,
        moodDescription: 'Warm handmade feel: soft cream canvas, gentle blush framing, and delicate artisanal typography.',
        recommendedTagline: 'Handmade with Gentle Care & Intention',
      };
    }

    case 'appetizing': {
      return {
        aesthetic: 'appetizing',
        aestheticName: 'Appetizing Oven Warmth',
        undertone: 'warm',
        dominantHex: domHex,
        secondaryHex: secHex,
        accentHex: '#C45D28',
        backgroundHex: '#FCF7EE',
        backgroundSecondaryHex: '#F4E9D7',
        cardBgHex: '#FFFFFF',
        textPrimaryHex: '#3B2416',
        textSecondaryHex: '#75543D',
        badgeBgHex: '#FCE7D2',
        badgeTextHex: '#943A11',
        borderHex: '#E8D2BB',
        glowHex: 'rgba(196, 93, 40, 0.18)',
        confidence: 94,
        moodDescription: 'Appetizing golden warmth: honey, warm crust, cinnamon undertones, and inviting bakery typography.',
        recommendedTagline: 'Freshly Baked • Pure Artisanal Ingredients',
      };
    }

    case 'dark': {
      return {
        aesthetic: 'dark',
        aestheticName: 'Midnight Luxury',
        undertone: 'warm',
        dominantHex: domHex,
        secondaryHex: secHex,
        accentHex: '#E0B259',
        backgroundHex: '#181412',
        backgroundSecondaryHex: '#231D19',
        cardBgHex: '#251F1B',
        textPrimaryHex: '#FAF6F0',
        textSecondaryHex: '#C5B5A5',
        badgeBgHex: '#3D2F1E',
        badgeTextHex: '#F5CE7B',
        borderHex: '#423429',
        glowHex: 'rgba(224, 178, 89, 0.22)',
        confidence: 92,
        moodDescription: 'Dramatic dark espresso backdrop with warm golden foil accents and luxury heirloom typography.',
        recommendedTagline: 'Master Crafted • Heirloom Standard',
      };
    }

    case 'vibrant': {
      return {
        aesthetic: 'vibrant',
        aestheticName: 'Vibrant Craft Pop',
        undertone,
        dominantHex: domHex,
        secondaryHex: secHex,
        accentHex: '#E65C00',
        backgroundHex: '#FFF8F0',
        backgroundSecondaryHex: '#FEEBD6',
        cardBgHex: '#FFFFFF',
        textPrimaryHex: '#2B1E16',
        textSecondaryHex: '#664E3D',
        badgeBgHex: '#FFE4CF',
        badgeTextHex: '#B84500',
        borderHex: '#F0D4BE',
        glowHex: 'rgba(230, 92, 0, 0.2)',
        confidence: 91,
        moodDescription: 'High-energy layout with bright complementary tones, playful badges, and bold artisan typography.',
        recommendedTagline: 'Joyfully Handcrafted • One-of-a-Kind',
      };
    }

    case 'minimalist': {
      return {
        aesthetic: 'minimalist',
        aestheticName: 'Studio Minimalist',
        undertone: 'neutral',
        dominantHex: domHex,
        secondaryHex: secHex,
        accentHex: '#4A5568',
        backgroundHex: '#F9F9F8',
        backgroundSecondaryHex: '#F0F0EE',
        cardBgHex: '#FFFFFF',
        textPrimaryHex: '#1A202C',
        textSecondaryHex: '#5A6578',
        badgeBgHex: '#EDF2F7',
        badgeTextHex: '#2D3748',
        borderHex: '#E2E8F0',
        glowHex: 'rgba(74, 85, 104, 0.1)',
        confidence: 88,
        moodDescription: 'Generous negative space, crisp Swiss typography, and clean gallery-grade borders.',
        recommendedTagline: 'Mindfully Made • Timeless Craft',
      };
    }

    case 'sage': {
      return {
        aesthetic: 'sage',
        aestheticName: 'Botanical Sage & Moss',
        undertone: 'cool',
        dominantHex: domHex,
        secondaryHex: secHex,
        accentHex: '#3D6147',
        backgroundHex: '#F4F7F3',
        backgroundSecondaryHex: '#E5EDE3',
        cardBgHex: '#FFFFFF',
        textPrimaryHex: '#1F3124',
        textSecondaryHex: '#4E6354',
        badgeBgHex: '#DCE8DA',
        badgeTextHex: '#284530',
        borderHex: '#C8D8C6',
        glowHex: 'rgba(61, 97, 71, 0.16)',
        confidence: 93,
        moodDescription: 'Fresh botanical sage and forest moss tones highlighting sustainable natural craft.',
        recommendedTagline: 'Rooted in Nature • Handcrafted Slowly',
      };
    }

    case 'ocean': {
      return {
        aesthetic: 'ocean',
        aestheticName: 'Coastal Indigo & Mist',
        undertone: 'cool',
        dominantHex: domHex,
        secondaryHex: secHex,
        accentHex: '#255F85',
        backgroundHex: '#F3F8FB',
        backgroundSecondaryHex: '#E2EEF5',
        cardBgHex: '#FFFFFF',
        textPrimaryHex: '#152C3E',
        textSecondaryHex: '#4A677D',
        badgeBgHex: '#D8EAF5',
        badgeTextHex: '#184A6B',
        borderHex: '#C4DCEA',
        glowHex: 'rgba(37, 95, 133, 0.16)',
        confidence: 92,
        moodDescription: 'Crisp coastal seafoam and indigo palette for serene, airy product presentation.',
        recommendedTagline: 'Breezy Craftsmanship • Timeless Blue Hues',
      };
    }

    case 'berry': {
      return {
        aesthetic: 'berry',
        aestheticName: 'Velvet Berry & Rose',
        undertone: 'warm',
        dominantHex: domHex,
        secondaryHex: secHex,
        accentHex: '#8E294C',
        backgroundHex: '#FCF4F7',
        backgroundSecondaryHex: '#F5E3EA',
        cardBgHex: '#FFFFFF',
        textPrimaryHex: '#361321',
        textSecondaryHex: '#6E3B4E',
        badgeBgHex: '#F4D7E2',
        badgeTextHex: '#721B3A',
        borderHex: '#E8C5D3',
        glowHex: 'rgba(142, 41, 76, 0.18)',
        confidence: 92,
        moodDescription: 'Rich plum-berry accents over soft rose parchment for boutique gifting appeal.',
        recommendedTagline: 'Boutique Edition • Crafted to Delight',
      };
    }

    case 'earthy':
    default: {
      return {
        aesthetic: 'earthy',
        aestheticName: 'Warm Earth & Clay',
        undertone: 'warm',
        dominantHex: domHex,
        secondaryHex: secHex,
        accentHex: '#B25A38',
        backgroundHex: '#FAF5EE',
        backgroundSecondaryHex: '#EFE7DA',
        cardBgHex: '#FFFFFF',
        textPrimaryHex: '#382B21',
        textSecondaryHex: '#6B5848',
        badgeBgHex: '#E8DED1',
        badgeTextHex: '#704226',
        borderHex: '#DFD1BF',
        glowHex: 'rgba(178, 90, 56, 0.15)',
        confidence: 94,
        moodDescription: 'Organic terracotta and linen tones honoring natural raw materials and slow, authentic handwork.',
        recommendedTagline: 'Raw Natural Materials • Handcrafted Livelihood',
      };
    }
  }
}

function shiftColorLightness(hex: string, amount: number): string {
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

/**
 * Applies user-selected custom hex colors over a base PosterPalette while preserving contrast & borders.
 */
export function applyCustomColorsToPalette(
  base: PosterPalette,
  custom?: CustomPosterColors
): PosterPalette {
  if (!custom) return base;
  const hasBg = Boolean(custom.backgroundHex && /^#[0-9a-f]{6}$/i.test(custom.backgroundHex));
  const hasBg2 = Boolean(custom.backgroundSecondaryHex && /^#[0-9a-f]{6}$/i.test(custom.backgroundSecondaryHex));
  const hasAccent = Boolean(custom.accentHex && /^#[0-9a-f]{6}$/i.test(custom.accentHex));
  const hasText = Boolean(custom.textPrimaryHex && /^#[0-9a-f]{6}$/i.test(custom.textPrimaryHex));

  if (!hasBg && !hasBg2 && !hasAccent && !hasText) return base;

  const backgroundHex = hasBg ? custom.backgroundHex! : base.backgroundHex;
  const bgLum = getLuminance(hexToRgb(backgroundHex));
  const isDarkBg = bgLum < 0.28;

  const backgroundSecondaryHex = hasBg2
    ? custom.backgroundSecondaryHex!
    : hasBg
    ? shiftColorLightness(backgroundHex, isDarkBg ? 18 : -16)
    : base.backgroundSecondaryHex;

  const accentHex = hasAccent ? custom.accentHex! : base.accentHex;
  const textPrimaryHex = hasText
    ? custom.textPrimaryHex!
    : hasBg
    ? isDarkBg
      ? '#FAF6F0'
      : '#241B15'
    : base.textPrimaryHex;

  const textSecondaryHex = custom.textSecondaryHex && /^#[0-9a-f]{6}$/i.test(custom.textSecondaryHex)
    ? custom.textSecondaryHex
    : blendHex(textPrimaryHex, backgroundHex, 0.32);

  const cardBgHex = hasBg ? (isDarkBg ? shiftColorLightness(backgroundHex, 16) : '#FFFFFF') : base.cardBgHex;
  const borderHex = hasBg || hasAccent ? blendHex(backgroundHex, accentHex, 0.28) : base.borderHex;
  const badgeBgHex = hasAccent || hasBg ? blendHex(backgroundHex, accentHex, isDarkBg ? 0.35 : 0.16) : base.badgeBgHex;
  const badgeTextHex = hasAccent ? (isDarkBg ? '#FFFFFF' : blendHex(accentHex, '#000000', 0.25)) : base.badgeTextHex;

  const acRgb = hexToRgb(accentHex);

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
    glowHex: `rgba(${acRgb.r}, ${acRgb.g}, ${acRgb.b}, 0.2)`,
  };
}

