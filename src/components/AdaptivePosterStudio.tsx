import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Sparkles,
  Download,
  Copy,
  Check,
  RefreshCw,
  Maximize2,
  Upload,
  CheckCircle2,
  X,
  Bookmark,
  Loader2,
  Wand2,
  ThumbsUp,
  AlertCircle,
  ImageDown,
  Share2,
  Palette,
  Layout,
  Shuffle,
  RotateCcw,
  PlusCircle,
  Database,
} from 'lucide-react';
import {
  ProductInput,
  MarketingContent,
  SavedCraft,
  ArtisanProfile,
  AspectRatioFormat,
  DesignVariation,
  CaptionTone,
  CustomPosterColors,
  GeneratedPosterRecord,
} from '../types';
import { deduplicateCrafts } from '../utils/craftDeduplication';
import {
  PosterPalette,
  PosterAesthetic,
  CraftCategoryType,
  analyzeProductPhoto,
  buildPhotoHarmonizedPalette,
  createPaletteForAesthetic,
  applyCustomColorsToPalette,
  inferCraftCategory,
  generateIntegratedCaptions,
  hexToRgb,
} from '../utils/posterPaletteAnalyzer';
import { optimizeImageFile } from '../utils/imageOptimizer';
import {
  savePosterToDeviceGallery,
  preloadPosterForGallery,
  getDirectPosterDownloadUrl,
  resolvePosterImageBlobForUpload,
  PosterDownloadFormat,
  canShareFilesToSystem,
  isMobileDevice,
} from '../utils/posterDownload';
import {
  reviseMarketingCaption,
  regenerateMarketingCaption,
  rewriteCaptionsForTheme,
  uploadPosterPng,
  generatePosterImage,
} from '../services/api';
import {
  saveGeneratedPosterToSupabase,
  GENERATED_POSTERS_SETUP_SQL,
} from '../services/supabase';

interface AdaptivePosterStudioProps {
  currentProduct: ProductInput;
  marketingContent?: MarketingContent | null;
  savedCrafts?: SavedCraft[];
  savedPosters?: GeneratedPosterRecord[];
  isLoadingSavedPosters?: boolean;
  savedPostersError?: string | null;
  savedPostersSetupRequired?: boolean;
  onRefreshSavedPosters?: () => void;
  onPosterSavedToSupabase?: (poster: GeneratedPosterRecord) => void;
  artisanProfile?: ArtisanProfile;
  onSelectProduct?: (product: ProductInput) => void;
  onPosterGenerated?: (posterUrl: string, product: ProductInput) => void;
  onSaveToCatalog?: (
    product: ProductInput,
    posterDataUrl: string,
    captionText: string,
    headlineText: string,
    posterUrl?: string
  ) => Promise<{ success: boolean; error?: string; product?: ProductInput }>;
  onNavigateToTab?: (tab: 'create' | 'ideas' | 'catalog') => void;
  onBackToProductInfo?: () => void;
  onStartNewProduct?: () => void;
  onUpdateArtisanProfile?: (updatedProfile: ArtisanProfile) => void;
  onOpenSellerInfo?: () => void;
}

const DESIGN_VARIATIONS: { id: DesignVariation; label: string; desc: string; tag?: string }[] = [
  { id: 'artisan', label: 'Handmade Classic', desc: 'Framed split card, craft borders & warm story layout' },
  { id: 'fullbleed', label: 'Full-Bleed Hero', desc: 'Edge-to-edge full photo with dark cinematic overlay', tag: 'New' },
  { id: 'archway', label: 'Botanical Arch', desc: 'Signature arched photo window & two-tone backdrop', tag: 'New' },
  { id: 'polaroid', label: 'Vintage Polaroid', desc: 'Tilted darkroom print with handwritten-style caption chin', tag: 'New' },
  { id: 'spotlight', label: 'Split Lookbook', desc: 'Bold asymmetric color-blocked side panel & overlapping card', tag: 'New' },
  { id: 'editorial', label: 'Editorial Magazine', desc: 'Top masthead line, sharp edge-to-edge frame & serif footer' },
  { id: 'minimalist', label: 'Swiss Minimalist', desc: 'Generous gallery mat, crisp sans header & airy balance' },
  { id: 'promotional', label: 'Promotional / Sale', desc: 'Bold top header banner, prominent price badge & wide CTA' },
  { id: 'luxury', label: 'Heirloom Arch Luxury', desc: 'Double filigree border, arched window & gold/espresso styling' },
  { id: 'playful', label: 'Playful Collage', desc: 'Tilted sticker card, confetti accents & bubbly pills' },
];

const COLOR_THEMES: { id: PosterAesthetic | 'auto'; label: string; swatch: string }[] = [
  { id: 'auto', label: 'Match Photo Colors', swatch: '#8B6544' },
  { id: 'earthy', label: 'Earthy Clay', swatch: '#B25A38' },
  { id: 'pastel', label: 'Soft Pastel', swatch: '#C9687E' },
  { id: 'dark', label: 'Midnight Lux', swatch: '#181412' },
  { id: 'vibrant', label: 'Vibrant Pop', swatch: '#E65C00' },
  { id: 'minimalist', label: 'Swiss Ivory', swatch: '#4A5568' },
  { id: 'appetizing', label: 'Oven Honey', swatch: '#C45D28' },
  { id: 'sage', label: 'Botanical Sage', swatch: '#3D6147' },
  { id: 'ocean', label: 'Coastal Blue', swatch: '#255F85' },
  { id: 'berry', label: 'Velvet Berry', swatch: '#8E294C' },
];

const CAPTION_TONES: { id: CaptionTone; label: string }[] = [
  { id: 'friendly', label: 'Friendly & Approachable' },
  { id: 'professional', label: 'Professional' },
  { id: 'persuasive', label: 'Persuasive' },
  { id: 'elegant', label: 'Elegant & Luxury' },
  { id: 'playful', label: 'Playful' },
  { id: 'storytelling', label: 'Storytelling' },
];

async function ensurePosterFontsLoaded(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  try {
    await Promise.race([
      Promise.all([
        document.fonts.ready,
        document.fonts.load('700 48px "Fraunces"').catch(() => []),
        document.fonts.load('400 24px "Plus Jakarta Sans"').catch(() => []),
        document.fonts.load('700 24px "Plus Jakarta Sans"').catch(() => []),
        document.fonts.load('700 48px "Noto Serif"').catch(() => []),
        document.fonts.load('400 24px "Noto Sans"').catch(() => []),
        document.fonts.load('700 24px "Noto Sans"').catch(() => []),
        document.fonts.load('700 20px "DejaVu Sans"').catch(() => []),
      ]),
      new Promise<void>((resolve) => setTimeout(resolve, 2500)),
    ]);
  } catch {
    // Proceed cleanly with system fallback fonts if FontFaceSet API rejects
  }
}

const SAVED_POSTER_SIGS_STORAGE_KEY = 'craftcopy_saved_poster_sigs';

export const AdaptivePosterStudio: React.FC<AdaptivePosterStudioProps> = ({
  currentProduct,
  marketingContent,
  savedCrafts = [],
  savedPosters = [],
  isLoadingSavedPosters = false,
  savedPostersError = null,
  savedPostersSetupRequired = false,
  onRefreshSavedPosters,
  onPosterSavedToSupabase,
  artisanProfile,
  onSelectProduct,
  onPosterGenerated,
  onSaveToCatalog,
  onBackToProductInfo,
  onStartNewProduct,
  onUpdateArtisanProfile,
  onOpenSellerInfo,
}) => {
  const [activeProduct, setActiveProduct] = useState<ProductInput>(currentProduct);

  const initialCategory = inferCraftCategory(
    currentProduct.name,
    currentProduct.category,
    currentProduct.materials,
    currentProduct.productDetails
  );
  const [craftCategory, setCraftCategory] = useState<CraftCategoryType>(initialCategory);

  // Poster controls
  const [aspectRatio, setAspectRatio] = useState<AspectRatioFormat>('4:5');
  const [designVariation, setDesignVariation] = useState<DesignVariation>('artisan');
  const [selectedAesthetic, setSelectedAesthetic] = useState<PosterAesthetic | 'auto'>('auto');
  const [aiMoodHint, setAiMoodHint] = useState<PosterAesthetic | undefined>(undefined);
  const [customColors, setCustomColors] = useState<CustomPosterColors>({});
  const [regenerationInstruction, setRegenerationInstruction] = useState('');
  const [refreshCopyOnRegen, setRefreshCopyOnRegen] = useState(true);
  const [isRegenerateModalOpen, setIsRegenerateModalOpen] = useState(false);
  const [palette, setPalette] = useState<PosterPalette | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [isGeneratingPoster, setIsGeneratingPoster] = useState(false);
  const [posterError, setPosterError] = useState<string | null>(null);
  const [hasLocalCanvasEdits, setHasLocalCanvasEdits] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const renderTokenRef = useRef(0);
  const posterGenInFlightRef = useRef(false);

  // Promotional copy, caption & product description states
  const [headline, setHeadline] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [persuasiveCaption, setPersuasiveCaption] = useState('');
  const [facebookCaption, setFacebookCaption] = useState('');
  const [tiktokCaption, setTiktokCaption] = useState('');
  const [productDescription, setProductDescription] = useState('');
  const [captionPlatform, setCaptionPlatform] = useState<'instagram' | 'facebook' | 'tiktok'>('instagram');
  const [callToAction, setCallToAction] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [platformHashtags, setPlatformHashtags] = useState<Record<'instagram' | 'facebook' | 'tiktok', string>>({
    instagram: '',
    facebook: '',
    tiktok: '',
  });
  const [selectedTone, setSelectedTone] = useState<CaptionTone>('friendly');
  const [activeTabPanel, setActiveTabPanel] = useState<'captions' | 'design' | 'product'>('captions');

  // Review, Edit, AI Revise, Approve
  const [revisionInstruction, setRevisionInstruction] = useState('');
  const [isRevisingAi, setIsRevisingAi] = useState(false);
  const [isRegeneratingAi, setIsRegeneratingAi] = useState(false);
  const [isRewritingTheme, setIsRewritingTheme] = useState(false);
  const [themeRewriteNotice, setThemeRewriteNotice] = useState<string | null>(null);
  const themeRewriteSeqRef = useRef(0);
  const [captionActionError, setCaptionActionError] = useState<string | null>(null);
  const [isApproved, setIsApproved] = useState<boolean>(Boolean(marketingContent?.userSatisfied));
  const [uploadedPosterUrl, setUploadedPosterUrl] = useState<string>(currentProduct.posterUrl || '');

  // Status feedback
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [downloadFormat, setDownloadFormat] = useState<PosterDownloadFormat>('png');
  const [isDownloadingPoster, setIsDownloadingPoster] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [savingGalleryCardId, setSavingGalleryCardId] = useState<string | null>(null);
  const [savedGalleryCardSuccessId, setSavedGalleryCardSuccessId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);

  // Permanent Supabase Poster Saving ("generated-posters" storage + "generated_posters" table)
  const [isSavingPoster, setIsSavingPoster] = useState(false);
  const savePosterInFlightRef = useRef(false);
  const [savePosterSuccess, setSavePosterSuccess] = useState<string | null>(null);
  const [savePosterError, setSavePosterError] = useState<string | null>(null);
  const [savePosterDuplicateMsg, setSavePosterDuplicateMsg] = useState<string | null>(null);
  const [savePosterSetupRequired, setSavePosterSetupRequired] = useState(false);
  const [needsSellerNamePrompt, setNeedsSellerNamePrompt] = useState(false);
  const [inlineSellerNameInput, setInlineSellerNameInput] = useState('');
  const [copiedPosterSql, setCopiedPosterSql] = useState(false);
  const [savedPosterSignatures, setSavedPosterSignatures] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(SAVED_POSTER_SIGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {}
    return {};
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [posterDataUrl, setPosterDataUrl] = useState<string>('');

  useEffect(() => {
    if (
      currentProduct.id !== activeProduct.id ||
      currentProduct.photoUrl !== activeProduct.photoUrl ||
      currentProduct.posterUrl !== activeProduct.posterUrl ||
      currentProduct.name !== activeProduct.name ||
      currentProduct.ownerName !== activeProduct.ownerName ||
      currentProduct.currentPrice !== activeProduct.currentPrice
    ) {
      setActiveProduct(currentProduct);
      const cat = inferCraftCategory(
        currentProduct.name,
        currentProduct.category,
        currentProduct.materials,
        currentProduct.productDetails
      );
      setCraftCategory(cat);
      if (currentProduct.posterUrl) {
        setUploadedPosterUrl(currentProduct.posterUrl);
        setHasLocalCanvasEdits(false);
        setPosterError(null);
      } else if (currentProduct.id !== activeProduct.id) {
        setUploadedPosterUrl('');
        setHasLocalCanvasEdits(false);
      }
      setIsApproved(Boolean(marketingContent?.userSatisfied));
    }
  }, [currentProduct, marketingContent?.userSatisfied]);

  // Populate captions & poster text from Gemini marketingContent (or fallback generator)
  const syncCaptionsFromPackage = useCallback(
    (prod: ProductInput, cat: CraftCategoryType, customTone: CaptionTone = 'friendly') => {
      const pkg = generateIntegratedCaptions(
        prod.name,
        cat,
        prod.materials,
        prod.craftTechnique,
        prod.currentPrice,
        prod.productDetails || prod.story,
        prod.ownerName || artisanProfile?.makerName
      );

      const posterDir = marketingContent?.posterDirection;
      let refinedHeadline =
        posterDir?.headline ||
        marketingContent?.captions?.instagram?.title ||
        pkg.headline;
      let refinedShort =
        posterDir?.subheadline ||
        marketingContent?.descriptions?.short ||
        pkg.shortDescription;
      let refinedBody =
        marketingContent?.captions?.instagram?.body ||
        prod.caption ||
        pkg.persuasiveCaption;
      let refinedCta =
        posterDir?.callToAction ||
        marketingContent?.captions?.facebook?.callToAction ||
        pkg.callToAction;

      if (posterDir?.recommendedAesthetic) {
        const aes = posterDir.recommendedAesthetic as PosterAesthetic;
        if (['pastel', 'dark', 'vibrant', 'earthy', 'minimalist', 'appetizing', 'sage', 'ocean', 'berry'].includes(aes)) {
          setAiMoodHint(aes);
        }
      }

      if (customTone === 'storytelling' && (prod.productDetails || prod.story)) {
        refinedBody =
          marketingContent?.captions?.instagram?.body ||
          `${prod.productDetails || prod.story}\n\nHandcrafted in small batches by ${artisanProfile?.studioName || 'our studio'}.`;
      }

      setHeadline(refinedHeadline);
      setShortDescription(refinedShort);
      setPersuasiveCaption(refinedBody);
      setFacebookCaption(
        marketingContent?.captions?.facebook?.body ||
          refinedBody
      );
      setTiktokCaption(
        marketingContent?.captions?.tiktok
          ? `${marketingContent.captions.tiktok.hook ? `${marketingContent.captions.tiktok.hook}\n\n` : ''}${marketingContent.captions.tiktok.body}`
          : refinedBody
      );
      setProductDescription(
        prod.productDescription ||
          marketingContent?.descriptions?.story ||
          marketingContent?.descriptions?.short ||
          prod.productDetails ||
          prod.story ||
          ''
      );
      setCallToAction(refinedCta);
      const igTags = marketingContent?.captions?.instagram?.hashtags?.length
        ? marketingContent.captions.instagram.hashtags.join(' ')
        : pkg.hashtags;
      const fbTags = marketingContent?.captions?.facebook?.hashtags?.length
        ? marketingContent.captions.facebook.hashtags.join(' ')
        : igTags;
      const ttTags = marketingContent?.captions?.tiktok?.hashtags?.length
        ? marketingContent.captions.tiktok.hashtags.join(' ')
        : igTags;
      setPlatformHashtags({
        instagram: igTags,
        facebook: fbTags,
        tiktok: ttTags,
      });
      setHashtags(
        captionPlatform === 'facebook'
          ? fbTags
          : captionPlatform === 'tiktok'
          ? ttTags
          : igTags
      );
    },
    [marketingContent, artisanProfile?.makerName, artisanProfile?.studioName, captionPlatform]
  );

  useEffect(() => {
    syncCaptionsFromPackage(activeProduct, craftCategory, selectedTone);
  }, [activeProduct.id, craftCategory, marketingContent]);

  // Analyze uploaded product photo to extract adaptive color palette & apply user custom color overrides
  useEffect(() => {
    let isCancelled = false;
    const runAnalysis = async () => {
      setIsAnalyzing(true);
      try {
        const photo = activeProduct.photoUrl || '';
        const analyzed = await analyzeProductPhoto(photo, craftCategory, aiMoodHint, true);
        if (!isCancelled) {
          let basePalette: PosterPalette;
          const domRgb = hexToRgb(analyzed.dominantHex);
          const secRgb = hexToRgb(analyzed.secondaryHex);
          if (selectedAesthetic !== 'auto') {
            basePalette = createPaletteForAesthetic(selectedAesthetic, domRgb, secRgb, analyzed.undertone);
          } else if (designVariation === 'luxury') {
            basePalette = buildPhotoHarmonizedPalette('dark', domRgb, secRgb, analyzed.undertone);
          } else if (designVariation === 'minimalist') {
            basePalette = buildPhotoHarmonizedPalette('minimalist', domRgb, secRgb, analyzed.undertone);
          } else if (designVariation === 'playful') {
            basePalette = buildPhotoHarmonizedPalette('vibrant', domRgb, secRgb, analyzed.undertone);
          } else if (designVariation === 'archway') {
            basePalette = buildPhotoHarmonizedPalette('sage', domRgb, secRgb, analyzed.undertone);
          } else {
            basePalette = analyzed;
          }
          setPalette(applyCustomColorsToPalette(basePalette, customColors));
        }
      } catch (err) {
        console.warn('Poster analysis fallback:', err);
      } finally {
        if (!isCancelled) setIsAnalyzing(false);
      }
    };

    runAnalysis();
    return () => {
      isCancelled = true;
    };
  }, [activeProduct.photoUrl, craftCategory, selectedAesthetic, aiMoodHint, designVariation, customColors]);

  const wrapText = (
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
    maxLines: number = 99
  ): number => {
    const words = text.split(/\s+/);
    let line = '';
    let currentY = y;
    let linesDrawn = 0;

    for (let n = 0; n < words.length; n++) {
      const testLine = line + (line ? ' ' : '') + words[n];
      const testWidth = ctx.measureText(testLine).width;

      if (testWidth > maxWidth && n > 0) {
        if (linesDrawn >= maxLines - 1 && n < words.length - 1) {
          ctx.fillText(line + '...', x, currentY);
          return currentY + lineHeight;
        }
        ctx.fillText(line, x, currentY);
        line = words[n];
        currentY += lineHeight;
        linesDrawn++;
      } else {
        line = testLine;
      }
    }
    if (line) {
      ctx.fillText(line, x, currentY);
      currentY += lineHeight;
    }
    return currentY;
  };

  const drawRoundedRect = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    fill = true,
    stroke = false
  ) => {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  };

  // Render high-resolution Poster Canvas using actual uploaded product photo
  const renderPoster = useCallback(async () => {
    if (!palette) return;
    const renderToken = ++renderTokenRef.current;
    setIsRendering(true);

    try {
      await ensurePosterFontsLoaded();
      if (renderToken !== renderTokenRef.current) return;

      let width = 1080;
      let height = 1350;
      if (aspectRatio === '1:1') height = 1080;
      else if (aspectRatio === '9:16') height = 1920;
      else if (aspectRatio === '16:9') {
        width = 1920;
        height = 1080;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Could not initialize poster canvas context.');
      }

      const img = new Image();
      if (activeProduct.photoUrl) {
        await new Promise<void>((resolve) => {
          let settled = false;
          let triedProxy = false;
          const finish = () => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              resolve();
            }
          };
          const timer = setTimeout(finish, 6000);
          img.onload = finish;
          img.onerror = () => {
            if (!triedProxy && /^https:\/\//i.test(activeProduct.photoUrl)) {
              triedProxy = true;
              img.crossOrigin = 'anonymous';
              img.src = `/api/proxy-image?url=${encodeURIComponent(activeProduct.photoUrl)}`;
            } else {
              finish();
            }
          };
          img.crossOrigin = 'anonymous';
          img.src = activeProduct.photoUrl;
          if (img.complete && img.naturalWidth > 0) finish();
        });
      }

      if (renderToken !== renderTokenRef.current) return;

    // Background gradient
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, palette.backgroundHex);
    bgGrad.addColorStop(1, palette.backgroundSecondaryHex);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    const glow = ctx.createRadialGradient(
      width * 0.45,
      height * 0.35,
      80,
      width * 0.45,
      height * 0.35,
      width * 0.65
    );
    glow.addColorStop(0, palette.glowHex);
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = palette.borderHex;
    ctx.lineWidth = designVariation === 'minimalist' ? 1 : 2;
    ctx.strokeRect(36, 36, width - 72, height - 72);

    const brandName = (
      artisanProfile?.studioName ||
      activeProduct.ownerName ||
      'CRAFTCOPY STUDIO'
    ).toUpperCase();
    const rawCat = (activeProduct.category || artisanProfile?.businessType || 'HANDCRAFTED').toUpperCase();
    const categoryTag = `✦ ${rawCat} ✦`;
    const displayPrice =
      activeProduct.currentPrice && Number(activeProduct.currentPrice) > 0
        ? Number(activeProduct.currentPrice)
        : null;
    const priceText = displayPrice
      ? `₱${displayPrice.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`
      : '';
    const headText = headline || activeProduct.name || 'Handcrafted Piece';
    const bodyText =
      shortDescription ||
      activeProduct.productDetails ||
      activeProduct.story ||
      'Thoughtfully handmade in small batches.';
    const ctaText = callToAction || 'Send a DM to Order';

    const drawPhotoFitted = (px: number, py: number, pw: number, ph: number) => {
      if (img.complete && img.naturalWidth > 0) {
        const imgAspect = img.naturalWidth / img.naturalHeight;
        const frameAspect = pw / ph;
        let drawW = pw;
        let drawH = ph;
        let drawX = px;
        let drawY = py;
        if (imgAspect > frameAspect) {
          drawW = ph * imgAspect;
          drawX = px - (drawW - pw) / 2;
        } else {
          drawH = pw / imgAspect;
          drawY = py - (drawH - ph) / 2;
        }
        ctx.drawImage(img, drawX, drawY, drawW, drawH);
      } else {
        ctx.fillStyle = palette.badgeBgHex;
        ctx.fillRect(px, py, pw, ph);
      }
    };

    const drawArchPath = (px: number, py: number, pw: number, ph: number) => {
      const r = pw / 2;
      ctx.beginPath();
      ctx.moveTo(px, py + ph);
      ctx.lineTo(px, py + r);
      ctx.arc(px + r, py + r, r, Math.PI, 0, false);
      ctx.lineTo(px + pw, py + ph);
      ctx.closePath();
    };

    const isLandscape = aspectRatio === '16:9';

    if (designVariation === 'fullbleed') {
      ctx.save();
      drawPhotoFitted(0, 0, width, height);
      ctx.restore();

      const topScrim = ctx.createLinearGradient(0, 0, 0, 240);
      topScrim.addColorStop(0, 'rgba(15, 11, 8, 0.72)');
      topScrim.addColorStop(1, 'rgba(15, 11, 8, 0)');
      ctx.fillStyle = topScrim;
      ctx.fillRect(0, 0, width, 240);

      const botScrim = ctx.createLinearGradient(0, height * 0.42, 0, height);
      botScrim.addColorStop(0, 'rgba(15, 11, 8, 0)');
      botScrim.addColorStop(0.45, 'rgba(15, 11, 8, 0.65)');
      botScrim.addColorStop(1, 'rgba(15, 11, 8, 0.94)');
      ctx.fillStyle = botScrim;
      ctx.fillRect(0, height * 0.42, width, height * 0.58);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.lineWidth = 2;
      drawRoundedRect(ctx, 28, 28, width - 56, height - 56, 20, false, true);

      ctx.font = 'bold 18px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
      const brandW = Math.min(ctx.measureText(brandName).width + 48, 460);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      drawRoundedRect(ctx, 64, 60, brandW, 44, 22, true, false);
      ctx.fillStyle = '#1E1610';
      ctx.fillText(brandName, 88, 88);

      ctx.font = 'bold 16px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
      const catW = Math.min(ctx.measureText(categoryTag).width + 42, 420);
      ctx.fillStyle = palette.accentHex;
      drawRoundedRect(ctx, width - 64 - catW, 60, catW, 44, 22, true, false);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(categoryTag, width - 64 - catW + 21, 88);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 52px Fraunces, "Noto Serif", Georgia, "DejaVu Serif", "Times New Roman", serif';
      const bottomY = height - 290;
      const afterHeadY = wrapText(ctx, headText, 68, bottomY, width - 136, 60, 2);

      ctx.fillStyle = '#F2ECE4';
      ctx.font = '400 24px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
      wrapText(ctx, bodyText, 68, afterHeadY + 12, width - 136, 34, 2);

      ctx.font = 'bold 22px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
      const ctaW = Math.min(ctx.measureText(ctaText).width + 58, width - 320);
      ctx.fillStyle = palette.accentHex;
      drawRoundedRect(ctx, 68, height - 130, ctaW, 58, 29, true, false);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(ctaText, 97, height - 94);

      if (priceText) {
        ctx.font = 'bold 30px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        const pw = ctx.measureText(priceText).width + 48;
        ctx.fillStyle = '#FFFFFF';
        drawRoundedRect(ctx, width - 68 - pw, height - 132, pw, 62, 18, true, false);
        ctx.fillStyle = '#18120E';
        ctx.fillText(priceText, width - 68 - pw + 24, height - 91);
      }
    } else if (designVariation === 'archway' || designVariation === 'luxury') {
      const isLux = designVariation === 'luxury';
      ctx.fillStyle = palette.backgroundHex;
      ctx.fillRect(0, 0, width, height);

      const photoW = isLandscape ? Math.round(width * 0.42) : Math.round(width * 0.72);
      const photoH = isLandscape ? height - 150 : aspectRatio === '1:1' ? 470 : aspectRatio === '9:16' ? 860 : 660;
      const photoX = isLandscape ? 78 : Math.round((width - photoW) / 2);
      const photoY = isLandscape ? 75 : 152;

      if (isLux) {
        ctx.strokeStyle = palette.accentHex;
        ctx.lineWidth = 2;
        ctx.strokeRect(28, 28, width - 56, height - 56);
        ctx.strokeStyle = palette.borderHex;
        ctx.lineWidth = 1;
        ctx.strokeRect(42, 42, width - 84, height - 84);
      } else {
        ctx.fillStyle = palette.backgroundSecondaryHex;
        if (isLandscape) {
          ctx.fillRect(0, 0, Math.round(width * 0.48), height);
        } else {
          ctx.fillRect(0, 0, width, Math.round(photoY + photoH * 0.52));
        }
      }

      ctx.save();
      drawArchPath(photoX, photoY, photoW, photoH);
      ctx.clip();
      drawPhotoFitted(photoX, photoY, photoW, photoH);
      ctx.restore();

      ctx.strokeStyle = isLux ? palette.accentHex : palette.borderHex;
      ctx.lineWidth = isLux ? 4 : 3;
      drawArchPath(photoX, photoY, photoW, photoH);
      ctx.stroke();

      if (priceText) {
        ctx.font = 'bold 28px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        const pW = Math.max(132, ctx.measureText(priceText).width + 48);
        ctx.fillStyle = palette.aesthetic === 'dark' ? '#E0B259' : palette.accentHex;
        drawRoundedRect(ctx, photoX + photoW / 2 - pW / 2, photoY + photoH - 26, pW, 52, 26, true, false);
        ctx.fillStyle = palette.aesthetic === 'dark' ? '#181412' : '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.fillText(priceText, photoX + photoW / 2, photoY + photoH + 8);
        ctx.textAlign = 'left';
      }

      if (isLandscape) {
        const textX = photoX + photoW + 64;
        const maxW = width - textX - 72;
        ctx.fillStyle = palette.accentHex;
        ctx.font = 'bold 18px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        ctx.fillText(brandName, textX, 160);
        ctx.fillStyle = palette.textSecondaryHex;
        ctx.font = '600 16px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        ctx.fillText(categoryTag, textX, 206);

        ctx.fillStyle = palette.textPrimaryHex;
        ctx.font = 'bold 48px Fraunces, "Noto Serif", Georgia, "DejaVu Serif", "Times New Roman", serif';
        const afterH = wrapText(ctx, headText, textX, 320, maxW, 58, 2);
        ctx.fillStyle = palette.textSecondaryHex;
        ctx.font = '400 24px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        wrapText(ctx, bodyText, textX, afterH + 16, maxW, 36, 3);

        ctx.font = 'bold 21px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        const cW = Math.min(Math.max(250, ctx.measureText(ctaText).width + 56), maxW);
        ctx.fillStyle = palette.accentHex;
        drawRoundedRect(ctx, textX, height - 165, cW, 58, isLux ? 8 : 29, true, false);
        ctx.fillStyle = isLux && palette.aesthetic === 'dark' ? '#181412' : '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.fillText(ctaText, textX + cW / 2, height - 129);
        ctx.textAlign = 'left';
      } else {
        ctx.textAlign = 'center';
        ctx.fillStyle = palette.accentHex;
        ctx.font = 'bold 18px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        ctx.fillText(brandName, width / 2, 82);
        ctx.fillStyle = palette.textSecondaryHex;
        ctx.font = '600 15px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        ctx.fillText(categoryTag, width / 2, 118);

        ctx.fillStyle = palette.textPrimaryHex;
        ctx.font = 'bold 42px Fraunces, "Noto Serif", Georgia, "DejaVu Serif", "Times New Roman", serif';
        const afterH = wrapText(ctx, headText, width / 2, photoY + photoH + 64, width - 140, 52, 2);
        ctx.fillStyle = palette.textSecondaryHex;
        ctx.font = '400 22px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        wrapText(ctx, bodyText, width / 2, afterH + 12, width - 160, 32, aspectRatio === '1:1' ? 1 : 2);

        ctx.font = 'bold 21px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        const cW = Math.min(Math.max(270, ctx.measureText(ctaText).width + 64), width - 160);
        ctx.fillStyle = palette.accentHex;
        drawRoundedRect(ctx, (width - cW) / 2, height - 135, cW, 56, isLux ? 8 : 28, true, false);
        ctx.fillStyle = isLux && palette.aesthetic === 'dark' ? '#181412' : '#FFFFFF';
        ctx.fillText(ctaText, width / 2, height - 100);
        ctx.textAlign = 'left';
      }
    } else if (designVariation === 'polaroid' || designVariation === 'playful') {
      const isPolaroid = designVariation === 'polaroid';
      ctx.fillStyle = palette.backgroundHex;
      ctx.fillRect(0, 0, width, height);

      if (!isPolaroid) {
        ctx.fillStyle = palette.accentHex + '22';
        ctx.beginPath();
        ctx.arc(130, 190, 150, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = palette.badgeBgHex;
        ctx.beginPath();
        ctx.arc(width - 90, height - 190, 190, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = palette.borderHex;
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 8]);
        ctx.strokeRect(30, 30, width - 60, height - 60);
        ctx.setLineDash([]);
      }

      const cardW = isLandscape ? 560 : 750;
      const pad = 32;
      const chin = isPolaroid ? 128 : 42;
      const innerW = cardW - pad * 2;
      const innerH = isLandscape ? 560 : aspectRatio === '1:1' ? 420 : aspectRatio === '9:16' ? 760 : 580;
      const cardH = pad + innerH + chin;
      const cx = isLandscape ? Math.round(width * 0.28) : width / 2;
      const cy = isLandscape ? height / 2 : 135 + cardH / 2;
      const angleRad = ((isPolaroid ? -2.2 : 2.0) * Math.PI) / 180;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angleRad);
      ctx.shadowColor = 'rgba(0,0,0,0.18)';
      ctx.shadowBlur = 28;
      ctx.shadowOffsetY = 14;
      ctx.fillStyle = '#FFFFFF';
      drawRoundedRect(ctx, -cardW / 2, -cardH / 2, cardW, cardH, isPolaroid ? 10 : 28, true, false);
      ctx.restore();

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angleRad);
      ctx.beginPath();
      drawRoundedRect(ctx, -innerW / 2, -cardH / 2 + pad, innerW, innerH, isPolaroid ? 8 : 20, false, false);
      ctx.clip();
      drawPhotoFitted(-innerW / 2, -cardH / 2 + pad, innerW, innerH);
      ctx.restore();

      if (isPolaroid) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angleRad);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#2B211B';
        ctx.font = 'bold 30px Fraunces, "Noto Serif", Georgia, "DejaVu Serif", "Times New Roman", serif';
        ctx.fillText(activeProduct.name || 'Artisan Piece', 0, -cardH / 2 + pad + innerH + 58);
        ctx.fillStyle = '#786454';
        ctx.font = '600 17px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        ctx.fillText(brandName, 0, -cardH / 2 + pad + innerH + 94);
        ctx.restore();
        ctx.textAlign = 'left';
      }

      // Tape strip
      ctx.fillStyle = palette.accentHex + 'B8';
      ctx.fillRect(cx - 65, Math.max(24, cy - cardH / 2 - 14), 130, 28);

      if (isLandscape) {
        const textX = Math.round(width * 0.54);
        const maxW = width - textX - 64;
        ctx.fillStyle = palette.textPrimaryHex;
        ctx.font = isPolaroid ? 'bold 48px Fraunces, "Noto Serif", Georgia, "DejaVu Serif", "Times New Roman", serif' : 'bold 46px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        const afterH = wrapText(ctx, headText, textX, 260, maxW, 56, 2);
        ctx.fillStyle = palette.textSecondaryHex;
        ctx.font = '400 24px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        wrapText(ctx, bodyText, textX, afterH + 16, maxW, 34, 3);
        ctx.font = 'bold 22px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        const cW = Math.min(Math.max(250, ctx.measureText(ctaText).width + 58), maxW);
        ctx.fillStyle = palette.accentHex;
        drawRoundedRect(ctx, textX, height - 145, cW, 58, 29, true, false);
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.fillText(ctaText, textX + cW / 2, height - 108);
        ctx.textAlign = 'left';
      } else {
        ctx.fillStyle = palette.textSecondaryHex;
        ctx.font = '600 19px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        ctx.fillText(brandName, 64, 78);

        const copyY = cy + cardH / 2 + 54;
        ctx.textAlign = 'center';
        ctx.fillStyle = palette.textPrimaryHex;
        ctx.font = isPolaroid ? 'bold 42px Fraunces, "Noto Serif", Georgia, "DejaVu Serif", "Times New Roman", serif' : 'bold 42px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        const afterH = wrapText(ctx, headText, width / 2, copyY, width - 140, 50, 2);
        ctx.fillStyle = palette.textSecondaryHex;
        ctx.font = '400 22px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        wrapText(ctx, bodyText, width / 2, afterH + 12, width - 150, 32, aspectRatio === '1:1' ? 1 : 2);

        ctx.font = 'bold 22px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        const cW = Math.min(Math.max(270, ctx.measureText(ctaText).width + 62), width - 140);
        ctx.fillStyle = palette.accentHex;
        drawRoundedRect(ctx, (width - cW) / 2, height - 130, cW, 56, 28, true, false);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(ctaText, width / 2, height - 95);
        ctx.textAlign = 'left';
      }
    } else if (designVariation === 'spotlight') {
      ctx.fillStyle = palette.backgroundHex;
      ctx.fillRect(0, 0, width, height);
      const splitX = isLandscape ? Math.round(width * 0.36) : Math.round(width * 0.44);
      ctx.fillStyle = palette.accentHex;
      ctx.fillRect(0, 0, splitX, isLandscape ? height : Math.round(height * 0.62));

      const px = isLandscape ? 88 : 96;
      const py = isLandscape ? 92 : 168;
      const pw = isLandscape ? Math.round(width * 0.44) : width - 192;
      const ph = isLandscape ? height - 184 : aspectRatio === '1:1' ? 460 : aspectRatio === '9:16' ? 860 : 660;

      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(px + 18, py + 18, pw, ph);
      ctx.save();
      drawPhotoFitted(px, py, pw, ph);
      ctx.restore();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 6;
      ctx.strokeRect(px, py, pw, ph);

      if (priceText) {
        ctx.font = 'bold 28px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        const pW = Math.max(132, ctx.measureText(priceText).width + 44);
        ctx.fillStyle = palette.textPrimaryHex;
        drawRoundedRect(ctx, px + pw - pW + 16, py + ph - 42, pW, 58, 6, true, false);
        ctx.fillStyle = palette.backgroundHex;
        ctx.textAlign = 'center';
        ctx.fillText(priceText, px + pw - pW / 2 + 16, py + ph - 3);
        ctx.textAlign = 'left';
      }

      const tx = isLandscape ? px + pw + 64 : 96;
      const ty = isLandscape ? 260 : py + ph + 64;
      const maxW = isLandscape ? width - tx - 64 : width - 192;
      if (!isLandscape) {
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 20px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        ctx.fillText(brandName, 64, 88);
      } else {
        ctx.fillStyle = palette.accentHex;
        ctx.font = 'bold 20px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        ctx.fillText(brandName, tx, 128);
      }

      ctx.fillStyle = palette.textPrimaryHex;
      ctx.font = 'bold 46px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
      const afterH = wrapText(ctx, headText, tx, ty, maxW, 54, 2);
      ctx.fillStyle = palette.textSecondaryHex;
      ctx.font = '400 23px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
      wrapText(ctx, bodyText, tx, afterH + 14, maxW, 34, isLandscape ? 3 : aspectRatio === '1:1' ? 1 : 2);

      ctx.font = 'bold 22px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
      const cW = Math.min(Math.max(260, ctx.measureText(ctaText).width + 58), maxW);
      ctx.fillStyle = palette.accentHex;
      drawRoundedRect(ctx, tx, height - 135, cW, 56, 8, true, false);
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.fillText(ctaText, tx + cW / 2, height - 100);
      ctx.textAlign = 'left';
    } else if (designVariation === 'editorial' || designVariation === 'minimalist') {
      const isEd = designVariation === 'editorial';
      const margin = isEd ? 56 : 84;
      ctx.fillStyle = palette.backgroundHex;
      ctx.fillRect(0, 0, width, height);

      if (!isEd) {
        ctx.strokeStyle = palette.borderHex;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(40, 40, width - 80, height - 80);
      }

      if (isLandscape) {
        const pw = Math.round(width * 0.48);
        const ph = height - margin * 2;
        const px = width - margin - pw;
        const py = margin;
        ctx.save();
        drawPhotoFitted(px, py, pw, ph);
        ctx.restore();
        ctx.strokeStyle = palette.borderHex;
        ctx.lineWidth = 2;
        ctx.strokeRect(px, py, pw, ph);

        const maxW = px - margin - 48;
        ctx.fillStyle = palette.textPrimaryHex;
        ctx.font = `bold 22px ${isEd ? 'Fraunces, "Noto Serif", Georgia, "DejaVu Serif", "Times New Roman", serif' : '"Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif'}`;
        ctx.fillText(brandName, margin, 106);
        if (isEd) {
          ctx.strokeStyle = palette.textPrimaryHex;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(margin, 128);
          ctx.lineTo(px - 48, 128);
          ctx.stroke();
        }
        ctx.fillStyle = palette.textPrimaryHex;
        ctx.font = `bold 50px ${isEd ? 'Fraunces, "Noto Serif", Georgia, "DejaVu Serif", "Times New Roman", serif' : '"Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif'}`;
        const afterH = wrapText(ctx, headText, margin, 260, maxW, 60, 3);
        ctx.fillStyle = palette.textSecondaryHex;
        ctx.font = '400 24px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        wrapText(ctx, bodyText, margin, afterH + 16, maxW, 34, 3);

        ctx.font = 'bold 20px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        const cW = Math.min(Math.max(240, ctx.measureText(ctaText).width + 54), maxW);
        ctx.fillStyle = palette.textPrimaryHex;
        drawRoundedRect(ctx, margin, height - margin - 58, cW, 56, isEd ? 2 : 28, true, false);
        ctx.fillStyle = palette.backgroundHex;
        ctx.textAlign = 'center';
        ctx.fillText(ctaText, margin + cW / 2, height - margin - 23);
        ctx.textAlign = 'left';
      } else {
        const mastY = isEd ? 104 : 94;
        ctx.fillStyle = palette.textPrimaryHex;
        ctx.font = `bold ${isEd ? 28 : 20}px ${isEd ? 'Fraunces, "Noto Serif", Georgia, "DejaVu Serif", "Times New Roman", serif' : '"Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif'}`;
        ctx.fillText(brandName, margin, mastY);
        ctx.fillStyle = palette.accentHex;
        ctx.font = 'bold 16px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(rawCat, width - margin, mastY);
        ctx.textAlign = 'left';

        if (isEd) {
          ctx.strokeStyle = palette.textPrimaryHex;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(margin, mastY + 20);
          ctx.lineTo(width - margin, mastY + 20);
          ctx.stroke();
        }

        ctx.fillStyle = palette.textPrimaryHex;
        ctx.font = `bold ${isEd ? 46 : 40}px ${isEd ? 'Fraunces, "Noto Serif", Georgia, "DejaVu Serif", "Times New Roman", serif' : '"Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif'}`;
        const afterHeadY = wrapText(ctx, headText, margin, mastY + 78, width - margin * 2, 54, 2);
        const py = afterHeadY + 18;
        const pw = width - margin * 2;
        const ph = Math.max(360, height - py - 245);

        ctx.save();
        ctx.beginPath();
        drawRoundedRect(ctx, margin, py, pw, ph, isEd ? 0 : 12, false, false);
        ctx.clip();
        drawPhotoFitted(margin, py, pw, ph);
        ctx.restore();
        ctx.strokeStyle = palette.borderHex;
        ctx.lineWidth = 2;
        drawRoundedRect(ctx, margin, py, pw, ph, isEd ? 0 : 12, false, true);

        ctx.fillStyle = palette.textSecondaryHex;
        ctx.font = '400 22px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        wrapText(ctx, bodyText, margin, py + ph + 48, pw, 32, aspectRatio === '1:1' ? 1 : 2);

        const ctaY = height - 118;
        ctx.font = 'bold 20px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        const cW = Math.min(Math.max(250, ctx.measureText(ctaText).width + 54), pw - 180);
        ctx.fillStyle = palette.accentHex;
        drawRoundedRect(ctx, margin, ctaY, cW, 54, isEd ? 2 : 27, true, false);
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.fillText(ctaText, margin + cW / 2, ctaY + 34);
        ctx.textAlign = 'left';

        if (priceText) {
          ctx.fillStyle = palette.textPrimaryHex;
          ctx.font = `bold 36px ${isEd ? 'Fraunces, "Noto Serif", Georgia, "DejaVu Serif", "Times New Roman", serif' : '"Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif'}`;
          ctx.textAlign = 'right';
          ctx.fillText(priceText, width - margin, ctaY + 38);
          ctx.textAlign = 'left';
        }
      }
    } else if (designVariation === 'promotional') {
      ctx.fillStyle = palette.backgroundHex;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = palette.accentHex;
      ctx.fillRect(0, 0, width, isLandscape ? 104 : 156);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 22px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
      ctx.fillText(brandName, 64, 64);
      if (!isLandscape) {
        ctx.font = 'bold 26px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        ctx.fillText(categoryTag, 64, 112);
      }

      const px = isLandscape ? 64 : 84;
      const py = isLandscape ? 148 : 206;
      const pw = isLandscape ? Math.round(width / 2 - 96) : width - 168;
      const ph = isLandscape ? height - 212 : aspectRatio === '1:1' ? 430 : aspectRatio === '9:16' ? 800 : 610;

      ctx.save();
      ctx.beginPath();
      drawRoundedRect(ctx, px, py, pw, ph, 24, false, false);
      ctx.clip();
      drawPhotoFitted(px, py, pw, ph);
      ctx.restore();
      ctx.strokeStyle = palette.accentHex;
      ctx.lineWidth = 5;
      drawRoundedRect(ctx, px, py, pw, ph, 24, false, true);

      if (priceText) {
        ctx.font = 'bold 34px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        const pW = Math.max(150, ctx.measureText(priceText).width + 54);
        ctx.fillStyle = palette.textPrimaryHex;
        drawRoundedRect(ctx, px + pw - pW - 18, py + ph - 42, pW, 68, 34, true, false);
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 4;
        drawRoundedRect(ctx, px + pw - pW - 18, py + ph - 42, pW, 68, 34, false, true);
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.fillText(priceText, px + pw - pW / 2 - 18, py + ph + 4);
        ctx.textAlign = 'left';
      }

      if (isLandscape) {
        const tx = width / 2 + 24;
        const maxW = width - tx - 64;
        ctx.fillStyle = palette.textPrimaryHex;
        ctx.font = 'bold 48px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        const afterH = wrapText(ctx, headText, tx, 260, maxW, 58, 2);
        ctx.fillStyle = palette.textSecondaryHex;
        ctx.font = '400 24px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        wrapText(ctx, bodyText, tx, afterH + 16, maxW, 34, 3);
        ctx.fillStyle = palette.accentHex;
        drawRoundedRect(ctx, tx, height - 156, maxW, 74, 16, true, false);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 26px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(ctaText, tx + maxW / 2, height - 110);
        ctx.textAlign = 'left';
      } else {
        ctx.textAlign = 'center';
        ctx.fillStyle = palette.textPrimaryHex;
        ctx.font = 'bold 44px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        const afterH = wrapText(ctx, headText, width / 2, py + ph + 64, width - 160, 52, 2);
        ctx.fillStyle = palette.textSecondaryHex;
        ctx.font = '400 23px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        wrapText(ctx, bodyText, width / 2, afterH + 12, width - 160, 32, aspectRatio === '1:1' ? 1 : 2);
        ctx.fillStyle = palette.accentHex;
        drawRoundedRect(ctx, 84, height - 134, width - 168, 70, 18, true, false);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 26px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        ctx.fillText(ctaText, width / 2, height - 90);
        ctx.textAlign = 'left';
      }
    } else {
      // ARTISAN HANDMADE CLASSIC
      const bgGrad = ctx.createLinearGradient(0, 0, width, height);
      bgGrad.addColorStop(0, palette.backgroundHex);
      bgGrad.addColorStop(1, palette.backgroundSecondaryHex);
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      const glow = ctx.createRadialGradient(width * 0.45, height * 0.35, 80, width * 0.45, height * 0.35, width * 0.65);
      glow.addColorStop(0, palette.glowHex);
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = palette.borderHex;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(36, 36, width - 72, height - 72);

      if (isLandscape) {
        const colW = width / 2;
        const photoX = 64;
        const photoY = 64;
        const photoW = colW - 88;
        const photoH = height - 128;

        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.12)';
        ctx.shadowBlur = 28;
        ctx.shadowOffsetY = 12;
        ctx.fillStyle = palette.cardBgHex;
        drawRoundedRect(ctx, photoX, photoY, photoW, photoH, 24, true, false);
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        drawRoundedRect(ctx, photoX, photoY, photoW, photoH, 24, false, false);
        ctx.clip();
        drawPhotoFitted(photoX, photoY, photoW, photoH);
        ctx.restore();

        ctx.strokeStyle = palette.borderHex;
        ctx.lineWidth = 2;
        drawRoundedRect(ctx, photoX, photoY, photoW, photoH, 24, false, true);

        if (priceText) {
          ctx.font = 'bold 36px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
          const priceWidth = ctx.measureText(priceText).width + 48;
          ctx.fillStyle = palette.aesthetic === 'dark' ? '#E0B259' : palette.textPrimaryHex;
          drawRoundedRect(ctx, photoX + photoW - priceWidth - 24, photoY + photoH - 88, priceWidth, 64, 16, true, false);
          ctx.fillStyle = palette.aesthetic === 'dark' ? '#181412' : '#FFFFFF';
          ctx.fillText(priceText, photoX + photoW - priceWidth, photoY + photoH - 44);
        }

        const textX = colW + 24;
        let textY = 110;
        const textMaxW = width - textX - 64;

        ctx.fillStyle = palette.textSecondaryHex;
        ctx.font = '600 20px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        ctx.fillText(brandName, textX, textY);
        textY += 42;

        ctx.font = '700 16px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        const catW = Math.min(ctx.measureText(categoryTag).width + 32, textMaxW);
        ctx.fillStyle = palette.badgeBgHex;
        drawRoundedRect(ctx, textX, textY - 22, catW, 36, 18, true, false);
        ctx.fillStyle = palette.badgeTextHex;
        ctx.fillText(categoryTag, textX + 16, textY + 2);
        textY += 60;

        ctx.fillStyle = palette.textPrimaryHex;
        ctx.font = 'bold 52px Fraunces, "Noto Serif", Georgia, "DejaVu Serif", "Times New Roman", serif';
        textY = wrapText(ctx, headText, textX, textY, textMaxW, 58, 2);
        textY += 20;

        ctx.fillStyle = palette.textSecondaryHex;
        ctx.font = '400 26px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        wrapText(ctx, bodyText, textX, textY, textMaxW, 38, 3);

        const ctaY = height - 90;
        ctx.font = 'bold 24px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        const ctaW = Math.min(ctx.measureText(ctaText).width + 52, textMaxW);
        ctx.fillStyle = palette.accentHex;
        drawRoundedRect(ctx, textX, ctaY - 50, ctaW, 56, 28, true, false);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(ctaText, textX + 26, ctaY - 14);
      } else {
        const headerY = 75;
        ctx.fillStyle = palette.textSecondaryHex;
        ctx.font = '600 20px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        ctx.fillText(brandName, 64, headerY);

        ctx.font = '700 15px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        const tagWidth = Math.min(ctx.measureText(categoryTag).width + 36, 360);
        ctx.fillStyle = palette.badgeBgHex;
        drawRoundedRect(ctx, width - 64 - tagWidth, headerY - 26, tagWidth, 38, 19, true, false);
        ctx.fillStyle = palette.badgeTextHex;
        ctx.fillText(categoryTag, width - 64 - tagWidth + 18, headerY - 1);

        const photoX = 64;
        const photoY = 120;
        const photoW = width - 128;
        const photoH = aspectRatio === '1:1' ? 480 : aspectRatio === '9:16' ? 840 : 660;

        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.14)';
        ctx.shadowBlur = 32;
        ctx.shadowOffsetY = 16;
        ctx.fillStyle = palette.cardBgHex;
        drawRoundedRect(ctx, photoX, photoY, photoW, photoH, 28, true, false);
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        drawRoundedRect(ctx, photoX, photoY, photoW, photoH, 28, false, false);
        ctx.clip();
        drawPhotoFitted(photoX, photoY, photoW, photoH);
        ctx.restore();

        ctx.strokeStyle = palette.borderHex;
        ctx.lineWidth = 3;
        drawRoundedRect(ctx, photoX, photoY, photoW, photoH, 28, false, true);

        if (priceText) {
          ctx.font = 'bold 32px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
          const priceWidth = ctx.measureText(priceText).width + 48;
          ctx.fillStyle = palette.aesthetic === 'dark' ? '#E0B259' : palette.textPrimaryHex;
          drawRoundedRect(ctx, photoX + photoW - priceWidth - 24, photoY + photoH - 80, priceWidth, 56, 16, true, false);
          ctx.fillStyle = palette.aesthetic === 'dark' ? '#181412' : '#FFFFFF';
          ctx.fillText(priceText, photoX + photoW - priceWidth, photoY + photoH - 41);
        }

        if (activeProduct.name) {
          ctx.font = '600 16px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
          const matWidth = Math.min(ctx.measureText(activeProduct.name).width + 32, photoW - 48);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
          drawRoundedRect(ctx, photoX + 24, photoY + 24, matWidth, 34, 17, true, false);
          ctx.fillStyle = '#2B1E16';
          ctx.fillText(activeProduct.name, photoX + 40, photoY + 47);
        }

        let contentY = photoY + photoH + 50;
        const maxContentWidth = width - 128;

        ctx.fillStyle = palette.textPrimaryHex;
        ctx.font = 'bold 44px Fraunces, "Noto Serif", Georgia, "DejaVu Serif", "Times New Roman", serif';
        contentY = wrapText(ctx, headText, 64, contentY, maxContentWidth, 52, 2);
        contentY += 16;

        ctx.fillStyle = palette.textSecondaryHex;
        ctx.font = '400 24px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        wrapText(ctx, bodyText, 64, contentY, maxContentWidth, 34, aspectRatio === '1:1' ? 2 : 3);

        const footerY = height - 85;
        ctx.font = 'bold 22px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        const ctaWidth = Math.min(ctx.measureText(ctaText).width + 48, width - 128);
        ctx.fillStyle = palette.accentHex;
        drawRoundedRect(ctx, 64, footerY - 48, ctaWidth, 52, 26, true, false);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(ctaText, 88, footerY - 15);

        if (hashtags) {
          ctx.fillStyle = palette.textSecondaryHex;
          ctx.font = '500 18px "Plus Jakarta Sans", "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
          const hashStr = hashtags.split(/\s+/).slice(0, 5).join(' ');
          ctx.fillText(hashStr, 64, footerY + 36);
        }
      }
    }

      if (renderToken !== renderTokenRef.current) return;

      const dataUrl = canvas.toDataURL('image/png', 0.95);
      setPosterDataUrl(dataUrl);
      setPosterError(null);

      if (canvasRef.current) {
        canvasRef.current.width = width;
        canvasRef.current.height = height;
        const displayCtx = canvasRef.current.getContext('2d');
        if (displayCtx) displayCtx.drawImage(canvas, 0, 0);
      }
    } catch (err: any) {
      console.warn('Client canvas poster render issue:', err);
      if (renderToken === renderTokenRef.current && !uploadedPosterUrl) {
        setPosterError(
          err?.message || 'Could not render live canvas preview. Click Generate / Retry AI Poster below.'
        );
      }
    } finally {
      if (renderToken === renderTokenRef.current) {
        setIsRendering(false);
      }
    }
  }, [
    palette,
    aspectRatio,
    designVariation,
    activeProduct,
    headline,
    shortDescription,
    callToAction,
    hashtags,
    marketingContent,
    artisanProfile,
    uploadedPosterUrl,
  ]);

  useEffect(() => {
    if (!palette) return;
    const timer = setTimeout(() => {
      renderPoster();
    }, 140);
    return () => clearTimeout(timer);
  }, [palette, renderPoster]);

  // Generate or regenerate real server-side PNG poster with custom design, colors, and optional AI refresh
  const handleGenerateServerPoster = useCallback(
    async (opts?: {
      designOverride?: DesignVariation;
      aestheticOverride?: PosterAesthetic | 'auto';
      customColorsOverride?: CustomPosterColors;
      instructionOverride?: string;
      refreshCopyOverride?: boolean;
      surpriseMe?: boolean;
    }) => {
      if (posterGenInFlightRef.current) return;
      posterGenInFlightRef.current = true;
      setIsGeneratingPoster(true);
      setPosterError(null);

      let chosenDesign = opts?.designOverride ?? designVariation;
      let chosenAesthetic = opts?.aestheticOverride ?? selectedAesthetic;
      let chosenColors = opts?.customColorsOverride ?? customColors;
      let chosenInstruction = opts?.instructionOverride ?? regenerationInstruction;
      let shouldRefreshCopy = opts?.refreshCopyOverride ?? refreshCopyOnRegen;

      if (opts?.surpriseMe) {
        const altDesigns = DESIGN_VARIATIONS.map((d) => d.id).filter((id) => id !== designVariation);
        const altThemes = COLOR_THEMES.map((t) => t.id).filter(
          (id) => id !== 'auto' && id !== selectedAesthetic
        );
        chosenDesign = altDesigns[Math.floor(Math.random() * altDesigns.length)] || 'fullbleed';
        chosenAesthetic = altThemes[Math.floor(Math.random() * altThemes.length)] || 'vibrant';
        chosenColors = {};
        shouldRefreshCopy = true;
        setDesignVariation(chosenDesign);
        setSelectedAesthetic(chosenAesthetic);
        setCustomColors({});
      }

      try {
        const res = await generatePosterImage({
          product: activeProduct,
          sellerProfile: artisanProfile,
          aspectRatio,
          designVariation: chosenDesign,
          aesthetic: chosenAesthetic,
          customColors: chosenColors,
          regenerationInstruction: chosenInstruction?.trim() || undefined,
          refreshCopy: shouldRefreshCopy,
          previousHeadline: shouldRefreshCopy ? headline : undefined,
          posterCopy: {
            headline,
            subheadline: shortDescription,
            callToAction,
            hashtags,
            recommendedAesthetic: chosenAesthetic,
          },
        });

        if (!res.success || !res.posterUrl) {
          setPosterError(res.error || 'Poster image could not be generated. Please click Retry.');
          return;
        }

        if (shouldRefreshCopy && res.posterCopy) {
          if (res.posterCopy.headline) setHeadline(res.posterCopy.headline);
          if (res.posterCopy.subheadline) setShortDescription(res.posterCopy.subheadline);
          if (res.posterCopy.callToAction) setCallToAction(res.posterCopy.callToAction);
        }

        setUploadedPosterUrl(res.posterUrl);
        setHasLocalCanvasEdits(false);
        setIsApproved(false);
        setIsRegenerateModalOpen(false);

        const updatedProd: ProductInput = {
          ...activeProduct,
          posterUrl: res.posterUrl,
        };
        setActiveProduct(updatedProd);
        if (onSelectProduct) onSelectProduct(updatedProd);
        if (onPosterGenerated) onPosterGenerated(res.posterUrl, updatedProd);
      } catch (err: any) {
        setPosterError(err?.message || 'Failed to generate AI poster. Please click Retry.');
      } finally {
        posterGenInFlightRef.current = false;
        setIsGeneratingPoster(false);
      }
    },
    [
      activeProduct,
      artisanProfile,
      aspectRatio,
      designVariation,
      selectedAesthetic,
      customColors,
      regenerationInstruction,
      refreshCopyOnRegen,
      headline,
      shortDescription,
      callToAction,
      hashtags,
      onSelectProduct,
      onPosterGenerated,
    ]
  );

  // Photo Upload inside Studio
  const handlePhotoUpload = async (file: File) => {
    if (!file || !file.type.startsWith('image/')) return;
    setIsUploadingPhoto(true);
    setPosterError(null);
    try {
      const opt = await optimizeImageFile(file, 1200, 0.88);
      let finalUrl = opt.dataUrl;
      try {
        const res = await fetch('/api/upload-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: opt.dataUrl, fileName: file.name }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.url) finalUrl = data.url;
        }
      } catch (e) {
        console.warn('Upload fallback to dataUrl:', e);
      }

      const updatedProd: ProductInput = {
        ...activeProduct,
        photoUrl: finalUrl,
        posterUrl: undefined,
      };
      setActiveProduct(updatedProd);
      setUploadedPosterUrl('');
      setHasLocalCanvasEdits(true);
      setIsApproved(false);
      if (onSelectProduct) onSelectProduct(updatedProd);
    } catch (err: any) {
      console.error('Failed to process image:', err);
      setPosterError(err?.message || 'Failed to upload product photo.');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const activePlatformCaption =
    captionPlatform === 'facebook'
      ? facebookCaption
      : captionPlatform === 'tiktok'
      ? tiktokCaption
      : persuasiveCaption;

  const setActivePlatformCaption = (val: string) => {
    if (captionPlatform === 'facebook') setFacebookCaption(val);
    else if (captionPlatform === 'tiktok') setTiktokCaption(val);
    else setPersuasiveCaption(val);
    setIsApproved(false);
  };

  const handleSelectPlatform = (plat: 'instagram' | 'facebook' | 'tiktok') => {
    setCaptionPlatform(plat);
    const nextTags = platformHashtags[plat];
    if (nextTags !== undefined) {
      setHashtags(nextTags);
    }
  };

  // Completely rewrite all captions & poster copy from scratch whenever theme or voice changes
  const handleRewriteCaptionsForTheme = async (opts?: {
    themeOverride?: PosterAesthetic | 'auto';
    toneOverride?: CaptionTone;
    designOverride?: DesignVariation;
  }) => {
    const seq = ++themeRewriteSeqRef.current;
    const requestedTheme = opts?.themeOverride ?? selectedAesthetic;
    const effectiveTheme =
      requestedTheme === 'auto'
        ? aiMoodHint || palette?.aesthetic || 'auto'
        : requestedTheme;
    const toneToUse = opts?.toneOverride ?? selectedTone;
    const designToUse = opts?.designOverride ?? designVariation;

    setIsRewritingTheme(true);
    setCaptionActionError(null);
    setThemeRewriteNotice(null);

    try {
      const res = await rewriteCaptionsForTheme({
        product: activeProduct,
        sellerProfile: artisanProfile,
        theme: effectiveTheme,
        tone: toneToUse,
        designStyle: designToUse,
        previousCaption: fullCompiledCaption,
        seed: Date.now() + seq,
      });

      if (seq !== themeRewriteSeqRef.current) return;

      if (res.success && res.data) {
        const d = res.data;
        const igTags = Array.isArray(d.instagram?.hashtags) ? d.instagram.hashtags.join(' ') : hashtags;
        const fbTags = Array.isArray(d.facebook?.hashtags) ? d.facebook.hashtags.join(' ') : igTags;
        const ttTags = Array.isArray(d.tiktok?.hashtags) ? d.tiktok.hashtags.join(' ') : igTags;

        if (d.posterHeadline || d.instagram?.title) {
          setHeadline(d.posterHeadline || d.instagram.title);
        }
        if (d.posterSubheadline) {
          setShortDescription(d.posterSubheadline);
        }
        if (d.posterCallToAction || d.facebook?.callToAction) {
          setCallToAction(d.posterCallToAction || d.facebook.callToAction);
        }
        if (d.instagram?.body) setPersuasiveCaption(d.instagram.body);
        if (d.facebook?.body) setFacebookCaption(d.facebook.body);
        if (d.tiktok?.body || d.tiktok?.hook) {
          const ttText = [d.tiktok.hook, d.tiktok.body].filter(Boolean).join('\n\n');
          setTiktokCaption(ttText);
        }

        setPlatformHashtags({
          instagram: igTags,
          facebook: fbTags,
          tiktok: ttTags,
        });
        setHashtags(
          captionPlatform === 'facebook'
            ? fbTags
            : captionPlatform === 'tiktok'
            ? ttTags
            : igTags
        );

        setHasLocalCanvasEdits(true);
        setIsApproved(false);
        const label =
          res.themeLabel ||
          COLOR_THEMES.find((t) => t.id === requestedTheme)?.label ||
          'Selected Theme';
        setThemeRewriteNotice(`Captions completely rewritten in "${label}" style.`);
      } else {
        setCaptionActionError(res.error || 'Could not rewrite captions for this theme. Please try again.');
      }
    } catch (err: any) {
      if (seq === themeRewriteSeqRef.current) {
        setCaptionActionError(err?.message || 'Could not rewrite captions for this theme.');
      }
    } finally {
      if (seq === themeRewriteSeqRef.current) {
        setIsRewritingTheme(false);
      }
    }
  };

  // AI Revision of caption right in Studio
  const handleAiReviseCaption = async () => {
    if (!revisionInstruction.trim() || isRevisingAi || isRewritingTheme) return;
    setIsRevisingAi(true);
    setCaptionActionError(null);
    const effectiveTheme =
      selectedAesthetic === 'auto'
        ? aiMoodHint || palette?.aesthetic || 'auto'
        : selectedAesthetic;
    try {
      const res = await reviseMarketingCaption(
        activeProduct,
        {
          title: headline,
          body: activePlatformCaption,
          hashtags: hashtags.split(/\s+/).filter(Boolean),
          callToAction,
        },
        revisionInstruction.trim(),
        captionPlatform,
        selectedTone,
        {
          theme: effectiveTheme,
          sellerProfile: artisanProfile,
        }
      );
      if (res.success && res.revisedCaption) {
        if (res.revisedCaption.title) setHeadline(res.revisedCaption.title);
        setActivePlatformCaption(res.revisedCaption.body);
        if (res.revisedCaption.callToAction) setCallToAction(res.revisedCaption.callToAction);
        if (res.revisedCaption.hashtags?.length) {
          const joined = res.revisedCaption.hashtags.join(' ');
          setHashtags(joined);
          setPlatformHashtags((prev) => ({ ...prev, [captionPlatform]: joined }));
        }
        setRevisionInstruction('');
        setHasLocalCanvasEdits(true);
        setIsApproved(false);
      } else {
        setCaptionActionError(res.error || 'Could not revise caption. Please try again.');
      }
    } catch (err: any) {
      setCaptionActionError(err?.message || 'Could not revise caption.');
    } finally {
      setIsRevisingAi(false);
    }
  };

  // AI Regenerate caption right in Studio
  const handleAiRegenerateCaption = async (overrideTone?: CaptionTone) => {
    if (isRegeneratingAi || isRewritingTheme) return;
    const toneToUse = overrideTone || selectedTone;
    const effectiveTheme =
      selectedAesthetic === 'auto'
        ? aiMoodHint || palette?.aesthetic || 'auto'
        : selectedAesthetic;
    setIsRegeneratingAi(true);
    setCaptionActionError(null);
    setThemeRewriteNotice(null);
    try {
      const res = await regenerateMarketingCaption(
        activeProduct,
        captionPlatform,
        toneToUse,
        Date.now(),
        {
          theme: effectiveTheme,
          designStyle: designVariation,
          sellerProfile: artisanProfile,
          previousCaption: fullCompiledCaption,
        }
      );
      if (res.success && res.newCaption) {
        if (res.newCaption.title) setHeadline(res.newCaption.title);
        const bodyText =
          captionPlatform === 'tiktok' && res.newCaption.hook
            ? `${res.newCaption.hook}\n\n${res.newCaption.body}`
            : res.newCaption.body;
        setActivePlatformCaption(bodyText);
        if (res.newCaption.callToAction) setCallToAction(res.newCaption.callToAction);
        if (res.newCaption.hashtags?.length) {
          const joined = res.newCaption.hashtags.join(' ');
          setHashtags(joined);
          setPlatformHashtags((prev) => ({ ...prev, [captionPlatform]: joined }));
        }
        setHasLocalCanvasEdits(true);
        setIsApproved(false);
      } else {
        setCaptionActionError(res.error || 'Could not regenerate caption. Please try again.');
      }
    } catch (err: any) {
      setCaptionActionError(err?.message || 'Could not regenerate caption.');
    } finally {
      setIsRegeneratingAi(false);
    }
  };

  const fullCompiledCaption = `${headline ? `${headline}\n\n` : ''}${activePlatformCaption}${callToAction ? `\n\n👉 ${callToAction}` : ''}${hashtags ? `\n\n${hashtags}` : ''}`;

  const displayPosterSrc =
    (!hasLocalCanvasEdits && (uploadedPosterUrl || activeProduct.posterUrl)) ||
    posterDataUrl ||
    uploadedPosterUrl ||
    activeProduct.posterUrl ||
    '';

  const directAttachmentUrl = displayPosterSrc
    ? getDirectPosterDownloadUrl({
        src: displayPosterSrc,
        productName: activeProduct.name,
        aspectRatio,
        format: downloadFormat,
      })
    : null;

  // Pre-warm high-res poster Blob in memory so clicking Save to Gallery / Photos triggers
  // synchronously without losing browser transient user activation on iOS Safari & Android Chrome.
  useEffect(() => {
    if (!displayPosterSrc) return;
    preloadPosterForGallery({
      src: displayPosterSrc,
      productName: activeProduct.name,
      aspectRatio,
      format: downloadFormat,
    });
  }, [displayPosterSrc, activeProduct.name, aspectRatio, downloadFormat]);

  // Save actual generated high-resolution poster to device gallery / downloads (PNG or HQ JPG)
  const handleDownloadPoster = async (
    overrideFormat?: PosterDownloadFormat,
    preferSystemShare: boolean = false
  ) => {
    const srcToDownload = displayPosterSrc;
    if (!srcToDownload || isDownloadingPoster) return;

    const chosenFormat = overrideFormat || downloadFormat;
    setIsDownloadingPoster(true);
    setDownloadError(null);
    setDownloadMessage(null);
    setDownloadSuccess(false);

    try {
      const result = await savePosterToDeviceGallery({
        src: srcToDownload,
        productName: activeProduct.name,
        aspectRatio,
        format: chosenFormat,
        preferSystemShare,
      });

      if (result.success) {
        setDownloadSuccess(true);
        setDownloadMessage(
          result.message || `Saved high-resolution ${chosenFormat.toUpperCase()} poster to your device gallery!`
        );
        setTimeout(() => {
          setDownloadSuccess(false);
        }, 4500);
      } else if (!result.cancelled) {
        setDownloadError(
          result.error || 'Could not save poster to your device. Please check storage/download permissions and retry.'
        );
      }
    } catch (err: any) {
      setDownloadError(
        err?.message || 'Unexpected error while saving poster to gallery. Please try again.'
      );
    } finally {
      setIsDownloadingPoster(false);
    }
  };

  // Save a poster card from the AI Posters gallery list directly to device gallery
  const handleDownloadSavedPosterCard = async (craft: SavedCraft) => {
    const posterSrc = craft.posterUrl || craft.product?.posterUrl || '';
    if (!posterSrc || savingGalleryCardId) return;

    setSavingGalleryCardId(craft.id);
    setDownloadError(null);
    try {
      const result = await savePosterToDeviceGallery({
        src: posterSrc,
        productName: craft.product?.name,
        aspectRatio: '4:5',
        format: downloadFormat,
      });
      if (result.success) {
        setSavedGalleryCardSuccessId(craft.id);
        setDownloadMessage(
          result.message || `Saved "${craft.product?.name}" poster (${downloadFormat.toUpperCase()}) to your gallery!`
        );
        setTimeout(() => setSavedGalleryCardSuccessId(null), 4000);
      } else if (!result.cancelled) {
        setDownloadError(result.error || 'Failed to save poster to gallery.');
      }
    } catch (err: any) {
      setDownloadError(err?.message || 'Failed to save poster to gallery.');
    } finally {
      setSavingGalleryCardId(null);
    }
  };

  const handleCopySection = (sectionName: string, textToCopy: string) => {
    navigator.clipboard.writeText(textToCopy);
    setCopiedSection(sectionName);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const recordSavedSignature = useCallback((sig: string) => {
    setSavedPosterSignatures((prev) => {
      const next = { ...prev, [sig]: true };
      try {
        const keys = Object.keys(next);
        if (keys.length > 120) {
          for (const k of keys.slice(0, keys.length - 120)) {
            delete next[k];
          }
        }
        localStorage.setItem(SAVED_POSTER_SIGS_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const readSavedSellerInfoFromStorage = useCallback((): {
    makerName: string;
    studioName: string;
    rawProfile: Partial<ArtisanProfile>;
  } => {
    try {
      const raw = localStorage.getItem('craftcopy_artisan_profile');
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ArtisanProfile>;
        if (parsed && typeof parsed === 'object') {
          return {
            makerName: typeof parsed.makerName === 'string' ? parsed.makerName.trim() : '',
            studioName: typeof parsed.studioName === 'string' ? parsed.studioName.trim() : '',
            rawProfile: parsed,
          };
        }
      }
    } catch {}
    return { makerName: '', studioName: '', rawProfile: {} };
  }, []);

  const storedSellerInfo = readSavedSellerInfoFromStorage();
  const currentSellerName = (
    artisanProfile?.makerName ||
    storedSellerInfo.makerName ||
    activeProduct.ownerName ||
    ''
  ).trim();
  const currentBusinessName = (
    artisanProfile?.studioName ||
    storedSellerInfo.studioName ||
    ''
  ).trim();
  const currentProductName = (activeProduct.name || '').trim();

  const currentUiPosterSignature = [
    activeProduct.id || 'new',
    currentProductName.toLowerCase(),
    currentSellerName.toLowerCase(),
    currentBusinessName.toLowerCase(),
    hasLocalCanvasEdits ? 'canvas' : 'server',
    hasLocalCanvasEdits ? posterDataUrl.slice(0, 80) + ':' + posterDataUrl.length : displayPosterSrc,
    fullCompiledCaption.trim(),
    designVariation,
    aspectRatio,
    selectedAesthetic,
    JSON.stringify(customColors),
    headline.trim(),
    shortDescription.trim(),
    callToAction.trim(),
  ].join('::');

  const isCurrentPosterAlreadySaved = Boolean(
    displayPosterSrc &&
      (savedPosterSignatures[currentUiPosterSignature] ||
        (!hasLocalCanvasEdits &&
          savedPosters.some(
            (p) =>
              p.poster_image_url === displayPosterSrc &&
              p.product_name.trim().toLowerCase() === currentProductName.toLowerCase() &&
              p.seller_name.trim().toLowerCase() === currentSellerName.toLowerCase() &&
              p.caption.trim() === fullCompiledCaption.trim()
          )))
  );

  useEffect(() => {
    setSavePosterDuplicateMsg(null);
    setSavePosterError(null);
  }, [currentUiPosterSignature]);

  useEffect(() => {
    if (currentSellerName) {
      setNeedsSellerNamePrompt(false);
    }
  }, [currentSellerName]);

  // Save Poster permanently to Supabase Storage ("generated-posters") & "generated_posters" table
  const handleSavePosterToSupabase = async (overrideSellerName?: string) => {
    if (savePosterInFlightRef.current || isSavingPoster) return;

    setSavePosterError(null);
    setSavePosterDuplicateMsg(null);
    setSavePosterSetupRequired(false);

    if (!displayPosterSrc) {
      setSavePosterError('No generated poster image is available yet. Please generate a poster first.');
      return;
    }

    const latestStoredInfo = readSavedSellerInfoFromStorage();
    const resolvedSellerName = (
      (typeof overrideSellerName === 'string' ? overrideSellerName : '') ||
      artisanProfile?.makerName ||
      latestStoredInfo.makerName ||
      activeProduct.ownerName ||
      ''
    ).trim();
    const resolvedBusinessName = (
      artisanProfile?.studioName ||
      latestStoredInfo.studioName ||
      ''
    ).trim();
    const resolvedProductName = (activeProduct.name || '').trim();

    if (!resolvedSellerName) {
      setNeedsSellerNamePrompt(true);
      setSavePosterError(
        'Owner Name from Seller Information is required before saving this poster so seller_name is recorded accurately.'
      );
      return;
    }

    setNeedsSellerNamePrompt(false);

    if (isCurrentPosterAlreadySaved && !overrideSellerName) {
      setSavePosterDuplicateMsg(
        'This poster has already been saved to AI Posters. Update the design or caption, or regenerate to save a new version.'
      );
      return;
    }

    savePosterInFlightRef.current = true;
    setIsSavingPoster(true);
    setSavePosterSuccess(null);

    try {
      const resolved = await resolvePosterImageBlobForUpload(displayPosterSrc);
      const contentSig = [
        resolved.sha256,
        resolvedProductName.toLowerCase(),
        resolvedSellerName.toLowerCase(),
        resolvedBusinessName.toLowerCase(),
        fullCompiledCaption.trim(),
      ].join('::');

      if (savedPosterSignatures[contentSig]) {
        recordSavedSignature(currentUiPosterSignature);
        setSavePosterDuplicateMsg(
          'This exact poster image and caption have already been saved to AI Posters.'
        );
        return;
      }

      const res = await saveGeneratedPosterToSupabase({
        sellerName: resolvedSellerName,
        businessName: resolvedBusinessName,
        productName: resolvedProductName,
        imageBlob: resolved.blob,
        posterSourceUrl:
          !hasLocalCanvasEdits && /^https:\/\//i.test(displayPosterSrc)
            ? displayPosterSrc
            : undefined,
        caption: fullCompiledCaption.trim(),
      });

      if (!res.success || !res.poster) {
        setSavePosterError(res.error || 'Failed to save poster to Supabase.');
        setSavePosterSetupRequired(Boolean(res.setupRequired));
        return;
      }

      const savedRecord = res.poster;
      recordSavedSignature(contentSig);
      recordSavedSignature(currentUiPosterSignature);

      // Update studio URL to permanent Supabase Storage public URL
      setUploadedPosterUrl(savedRecord.poster_image_url);
      setHasLocalCanvasEdits(false);

      const permanentUiSig = [
        activeProduct.id || 'new',
        resolvedProductName.toLowerCase(),
        resolvedSellerName.toLowerCase(),
        resolvedBusinessName.toLowerCase(),
        'server',
        savedRecord.poster_image_url,
        fullCompiledCaption.trim(),
        designVariation,
        aspectRatio,
        selectedAesthetic,
        JSON.stringify(customColors),
        headline.trim(),
        shortDescription.trim(),
        callToAction.trim(),
      ].join('::');
      recordSavedSignature(permanentUiSig);

      const updatedProd: ProductInput = {
        ...activeProduct,
        ownerName: savedRecord.seller_name || resolvedSellerName,
        posterUrl: savedRecord.poster_image_url,
      };
      setActiveProduct(updatedProd);
      if (onSelectProduct) onSelectProduct(updatedProd);
      if (onPosterGenerated) onPosterGenerated(savedRecord.poster_image_url, updatedProd);
      if (onPosterSavedToSupabase) onPosterSavedToSupabase(savedRecord);

      setSavePosterSuccess(
        `Poster saved permanently to Supabase & AI Posters under Owner "${savedRecord.seller_name || resolvedSellerName}"!`
      );
      setTimeout(() => setSavePosterSuccess(null), 5000);
    } catch (err: any) {
      setSavePosterError(
        err?.message || 'Unexpected error saving poster to Supabase. Please try again.'
      );
    } finally {
      savePosterInFlightRef.current = false;
      setIsSavingPoster(false);
    }
  };

  const handleConfirmInlineSellerNameAndSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inlineSellerNameInput.trim();
    if (!trimmed) {
      setSavePosterError('Please enter your Owner Name before saving.');
      return;
    }

    const latestStored = readSavedSellerInfoFromStorage();
    const baseProfile: ArtisanProfile = {
      makerName: trimmed,
      studioName: artisanProfile?.studioName || latestStored.studioName || '',
      businessType:
        artisanProfile?.businessType || latestStored.rawProfile.businessType || '',
      craftSpecialty:
        artisanProfile?.craftSpecialty || latestStored.rawProfile.craftSpecialty || '',
      location: artisanProfile?.location || latestStored.rawProfile.location || '',
      bio: artisanProfile?.bio || latestStored.rawProfile.bio || '',
      targetCustomers:
        artisanProfile?.targetCustomers || latestStored.rawProfile.targetCustomers || '',
      brandPersonality:
        artisanProfile?.brandPersonality ||
        latestStored.rawProfile.brandPersonality ||
        'Warm & Handmade',
      preferredAesthetic:
        artisanProfile?.preferredAesthetic ||
        latestStored.rawProfile.preferredAesthetic ||
        'Warm & Handmade',
      brandColors: artisanProfile?.brandColors || latestStored.rawProfile.brandColors || '',
      instagramHandle:
        artisanProfile?.instagramHandle || latestStored.rawProfile.instagramHandle || '',
      socialMediaHandle:
        artisanProfile?.socialMediaHandle || latestStored.rawProfile.socialMediaHandle || '',
      websiteUrl: artisanProfile?.websiteUrl || latestStored.rawProfile.websiteUrl || '',
      defaultHourlyRate:
        artisanProfile?.defaultHourlyRate || latestStored.rawProfile.defaultHourlyRate || 180,
      defaultOverheadRate:
        artisanProfile?.defaultOverheadRate || latestStored.rawProfile.defaultOverheadRate || 50,
      standardMarginPercent:
        artisanProfile?.standardMarginPercent ||
        latestStored.rawProfile.standardMarginPercent ||
        30,
    };

    try {
      localStorage.setItem('craftcopy_artisan_profile', JSON.stringify(baseProfile));
    } catch {}

    if (onUpdateArtisanProfile) {
      onUpdateArtisanProfile(baseProfile);
    }
    setActiveProduct((prev) => ({
      ...prev,
      ownerName: trimmed,
    }));
    setNeedsSellerNamePrompt(false);
    setSavePosterError(null);
    await handleSavePosterToSupabase(trimmed);
  };

  // Approve, upload rendered poster PNG, & Save to Supabase + Catalog
  const handleApproveAndSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setSaveSuccess(false);
    setSaveError(null);

    try {
      let persistedPosterUrl = uploadedPosterUrl || activeProduct.posterUrl || '';
      if (posterDataUrl && (hasLocalCanvasEdits || !persistedPosterUrl)) {
        const up = await uploadPosterPng(
          posterDataUrl,
          `poster-${activeProduct.name || 'craft'}.png`
        );
        if (up.success && up.url) {
          persistedPosterUrl = up.url;
          setUploadedPosterUrl(up.url);
          setHasLocalCanvasEdits(false);
        }
      }

      const prodWithPoster: ProductInput = {
        ...activeProduct,
        productDescription: productDescription.trim() || activeProduct.productDescription || '',
        posterUrl: persistedPosterUrl || activeProduct.posterUrl,
      };
      setActiveProduct(prodWithPoster);

      if (onSaveToCatalog) {
        const res = await onSaveToCatalog(
          prodWithPoster,
          posterDataUrl,
          fullCompiledCaption,
          headline,
          persistedPosterUrl
        );
        if (res.success) {
          if (res.product) setActiveProduct(res.product);
          setIsApproved(true);
          setSaveSuccess(true);
          setTimeout(() => setSaveSuccess(false), 3500);
        } else {
          setSaveError(res.error || 'Could not save to Supabase, but package is approved locally.');
          setIsApproved(true);
        }
      } else {
        setIsApproved(true);
      }
    } catch (err: any) {
      setSaveError(err?.message || 'Error approving & saving package');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8 animate-in fade-in duration-300">
      {/* Studio Header Banner */}
      <div className="bg-[#FAF7F2] rounded-3xl border border-[#E8DFD1] p-5 sm:p-7 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-[#8B6544] uppercase tracking-wider">
              Complete Promotional Output
            </span>
            {currentBusinessName && (
              <>
                <span className="text-xs text-[#7A6755]">•</span>
                <span className="text-xs text-[#7A6755]">{currentBusinessName}</span>
              </>
            )}
            {currentSellerName && (
              <>
                <span className="text-xs text-[#7A6755]">•</span>
                <span className="text-xs text-[#7A6755]">
                  Owner: <strong className="text-[#423023]">{currentSellerName}</strong>
                </span>
              </>
            )}
            {isApproved && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#E7EFE6] text-[#2F442F] text-[11px] font-bold border border-[#C5DAC3]">
                <CheckCircle2 className="w-3 h-3 text-[#4E654E]" />
                Approved &amp; Saved
              </span>
            )}
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold font-artisan text-[#423023] mt-1">
            Promotional Package: {activeProduct.name || 'Your Product'}
          </h1>
          <p className="text-xs sm:text-sm text-[#735F4C] mt-1 max-w-2xl">
            Customize your adaptive promotional poster, marketing captions, and product description in one place—then save to your device gallery or Supabase.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {onStartNewProduct && (
            <button
              type="button"
              id="btn-new-poster-from-studio"
              onClick={onStartNewProduct}
              className="px-3.5 py-2.5 rounded-xl bg-white hover:bg-[#FAF7F2] border border-[#D5C7B6] text-[#553E2E] text-xs font-semibold flex items-center gap-1.5 transition-all"
            >
              <PlusCircle className="w-3.5 h-3.5 text-[#4E654E]" />
              <span>New Poster</span>
            </button>
          )}

          {onBackToProductInfo && (
            <button
              type="button"
              id="btn-back-to-product-from-poster"
              onClick={onBackToProductInfo}
              className="px-3.5 py-2.5 rounded-xl bg-white hover:bg-[#FAF7F2] border border-[#D5C7B6] text-[#553E2E] text-xs font-semibold transition-all"
            >
              &larr; Edit Product Info
            </button>
          )}

          <button
            type="button"
            id="btn-regenerate-server-poster"
            onClick={() => setIsRegenerateModalOpen(true)}
            disabled={isGeneratingPoster}
            className="px-3.5 py-2.5 rounded-xl bg-white hover:bg-[#FAF7F2] border border-[#D5C7B6] text-[#423023] text-xs font-bold flex items-center gap-1.5 shadow-2xs transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#8B6544] ${isGeneratingPoster ? 'animate-spin' : ''}`} />
            <span>{isGeneratingPoster ? 'Regenerating Poster...' : 'Regenerate Poster'}</span>
          </button>

          <button
            type="button"
            id="btn-download-poster"
            onClick={() => handleDownloadPoster()}
            disabled={!displayPosterSrc || isGeneratingPoster || isDownloadingPoster}
            className="px-3.5 py-2.5 rounded-xl bg-white hover:bg-[#FAF7F2] border border-[#D5C7B6] text-[#423023] text-xs font-bold flex items-center gap-1.5 shadow-2xs transition-all disabled:opacity-50"
          >
            {isDownloadingPoster ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#4E654E]" />
            ) : downloadSuccess ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            ) : (
              <ImageDown className="w-4 h-4 text-[#4E654E]" />
            )}
            <span>
              {isDownloadingPoster
                ? 'Saving...'
                : downloadSuccess
                ? 'Saved to Gallery!'
                : 'Save to Gallery'}
            </span>
          </button>

          <button
            type="button"
            id="btn-save-poster-header"
            onClick={() => handleSavePosterToSupabase()}
            disabled={!displayPosterSrc || isGeneratingPoster || isSavingPoster}
            className={`px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-2xs transition-all disabled:opacity-50 ${
              isCurrentPosterAlreadySaved
                ? 'bg-[#E7EFE6] border border-[#C5DAC3] text-[#2F442F]'
                : 'bg-white hover:bg-[#FAF7F2] border border-[#4E654E]/50 text-[#2F442F]'
            }`}
            title="Upload poster image to Supabase Storage and save details to generated_posters"
          >
            {isSavingPoster ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-[#4E654E]" />
                <span>Saving Poster...</span>
              </>
            ) : isCurrentPosterAlreadySaved ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-[#4E654E]" />
                <span>Poster Saved</span>
              </>
            ) : (
              <>
                <Bookmark className="w-4 h-4 text-[#4E654E]" />
                <span>Save Poster</span>
              </>
            )}
          </button>

          <button
            type="button"
            id="btn-approve-save-poster"
            onClick={handleApproveAndSave}
            disabled={isSaving || !displayPosterSrc}
            className="px-4 py-2.5 rounded-xl bg-[#4E654E] hover:bg-[#3E523E] text-white text-xs sm:text-sm font-bold flex items-center gap-2 shadow-sm transition-all active:scale-95 disabled:opacity-60"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Approving & Saving...</span>
              </>
            ) : saveSuccess ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                <span>Approved & Saved!</span>
              </>
            ) : (
              <>
                <ThumbsUp className="w-4 h-4 text-[#E7EFE6]" />
                <span>{isApproved ? 'Re-Save Updates' : 'Approve & Save Package'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {saveError && (
        <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs">
          {saveError}
        </div>
      )}

      {needsSellerNamePrompt && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-amber-50 border border-amber-300 text-amber-950 text-xs space-y-3 shadow-xs"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-amber-950">
                  Owner Name Required from Seller Information
                </p>
                <p className="text-amber-800 mt-0.5">
                  Please enter the Owner Name so your poster is saved with the real <code className="font-mono font-semibold">seller_name</code> value in Supabase.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setNeedsSellerNamePrompt(false);
                setSavePosterError(null);
              }}
              className="text-amber-800 font-bold hover:underline shrink-0"
            >
              Dismiss
            </button>
          </div>
          <form
            onSubmit={handleConfirmInlineSellerNameAndSave}
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
          >
            <input
              type="text"
              id="inline-seller-owner-name-top"
              value={inlineSellerNameInput}
              onChange={(e) => setInlineSellerNameInput(e.target.value)}
              placeholder="Enter Owner Name (e.g., Maria Santos)"
              className="flex-1 px-3 py-2 rounded-xl bg-white border border-amber-300 text-[#423023] text-xs focus:outline-none focus:ring-2 focus:ring-[#4E654E]"
            />
            <button
              type="submit"
              disabled={!inlineSellerNameInput.trim() || isSavingPoster}
              className="px-4 py-2 rounded-xl bg-[#4E654E] hover:bg-[#3E523E] text-white font-bold text-xs transition-all disabled:opacity-50 shrink-0"
            >
              {isSavingPoster ? 'Saving Poster...' : 'Save Owner Name & Poster'}
            </button>
            {onOpenSellerInfo && (
              <button
                type="button"
                onClick={onOpenSellerInfo}
                className="px-3 py-2 rounded-xl bg-white hover:bg-[#FAF7F2] border border-amber-300 text-amber-900 font-semibold text-xs shrink-0"
              >
                Open Seller Info Form
              </button>
            )}
          </form>
        </div>
      )}

      {posterError && (
        <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-900 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-red-900">Poster Generation Issue</p>
              <p className="text-red-700 mt-0.5">{posterError}</p>
            </div>
          </div>
          <button
            type="button"
            id="btn-retry-poster-studio"
            onClick={() => handleGenerateServerPoster()}
            disabled={isGeneratingPoster}
            className="px-3.5 py-2 rounded-xl bg-red-700 hover:bg-red-800 text-white font-bold text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingPoster ? 'animate-spin' : ''}`} />
            <span>Retry Poster Generation</span>
          </button>
        </div>
      )}

      {/* Main Studio Grid: Poster Preview (Left) + Captions & Design Editor (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Adaptive Poster Preview */}
        <div className="lg:col-span-6 flex flex-col items-center">
          <div className="w-full flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-[#E8DFD1]/80 text-xs">
            <div className="flex items-center gap-1 bg-[#EAE2D3] p-1 rounded-xl">
              {(['4:5', '1:1', '9:16', '16:9'] as AspectRatioFormat[]).map((ratio) => (
                <button
                  key={ratio}
                  type="button"
                  onClick={() => {
                    setAspectRatio(ratio);
                    setHasLocalCanvasEdits(true);
                    setIsApproved(false);
                  }}
                  className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                    aspectRatio === ratio
                      ? 'bg-[#423023] text-white shadow-2xs'
                      : 'text-[#6B5544] hover:text-[#423023]'
                  }`}
                >
                  {ratio}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setIsPreviewModalOpen(true)}
              disabled={!displayPosterSrc}
              className="px-2.5 py-1.5 rounded-lg bg-white border border-[#D5C7B6] text-[#553E2E] hover:bg-[#FAF7F2] text-xs font-semibold flex items-center gap-1 disabled:opacity-50"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>Full Preview</span>
            </button>
          </div>

          <div className="relative w-full max-w-[500px] rounded-3xl p-3 bg-gradient-to-b from-[#ECE4D8] to-[#DFD5C6] shadow-xl border border-[#D5C7B6]">
            {isGeneratingPoster && (
              <div className="absolute inset-0 bg-[#FAF7F2]/85 backdrop-blur-xs rounded-3xl z-20 flex flex-col items-center justify-center gap-2 text-xs font-bold text-[#4E654E]">
                <Loader2 className="w-6 h-6 animate-spin text-[#4E654E]" />
                <span>Generating AI Promotional Poster...</span>
              </div>
            )}

            <div className="relative overflow-hidden rounded-2xl shadow-inner bg-black/5 flex items-center justify-center">
              {displayPosterSrc ? (
                <img
                  src={displayPosterSrc}
                  alt={`Promotional poster for ${activeProduct.name}`}
                  className="w-full h-auto object-contain rounded-2xl cursor-pointer hover:opacity-95 transition-opacity"
                  onClick={() => setIsPreviewModalOpen(true)}
                  onError={() => {
                    if (!hasLocalCanvasEdits && uploadedPosterUrl) {
                      setUploadedPosterUrl('');
                      if (posterDataUrl) setHasLocalCanvasEdits(true);
                    }
                  }}
                />
              ) : isRendering || isAnalyzing ? (
                <div className="w-full aspect-[4/5] flex flex-col items-center justify-center gap-2 text-xs text-[#7A6755]">
                  <Loader2 className="w-5 h-5 animate-spin text-[#4E654E]" />
                  <span>Preparing Promotional Poster...</span>
                </div>
              ) : (
                <div className="w-full aspect-[4/5] flex flex-col items-center justify-center gap-3 p-6 text-center text-xs text-[#7A6755]">
                  <AlertCircle className="w-6 h-6 text-[#8B6544]" />
                  <span>No poster image ready yet.</span>
                  <button
                    type="button"
                    onClick={() => handleGenerateServerPoster()}
                    className="px-4 py-2 rounded-xl bg-[#4E654E] text-white font-bold text-xs flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Generate Promotional Poster</span>
                  </button>
                </div>
              )}
            </div>

            <div className="mt-3 px-2 flex items-center justify-between text-[11px] text-[#6E5948]">
              <span className="font-medium flex items-center gap-1.5">
                <span>
                  Palette: <strong>{palette?.aestheticName || 'Adaptive'}</strong>
                </span>
                {(isAnalyzing || isRendering) && displayPosterSrc && (
                  <span className="text-[10px] text-[#4E654E] font-semibold">• Updating...</span>
                )}
              </span>
              <span>
                Style: <strong>{DESIGN_VARIATIONS.find((d) => d.id === designVariation)?.label}</strong>
              </span>
            </div>

            {/* Dedicated Save to Gallery Action Bar right below Poster Preview */}
            <div className="mt-3 p-3 rounded-2xl bg-[#FAF7F2] border border-[#D5C7B6] space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1 bg-[#EAE2D3] p-0.5 rounded-lg text-[11px]">
                  <button
                    type="button"
                    id="btn-format-png"
                    onClick={() => setDownloadFormat('png')}
                    className={`px-2.5 py-1 rounded-md font-bold transition-all ${
                      downloadFormat === 'png'
                        ? 'bg-white text-[#423023] shadow-2xs'
                        : 'text-[#6B5544] hover:text-[#423023]'
                    }`}
                  >
                    PNG (Lossless)
                  </button>
                  <button
                    type="button"
                    id="btn-format-jpg"
                    onClick={() => setDownloadFormat('jpg')}
                    className={`px-2.5 py-1 rounded-md font-bold transition-all ${
                      downloadFormat === 'jpg'
                        ? 'bg-white text-[#423023] shadow-2xs'
                        : 'text-[#6B5544] hover:text-[#423023]'
                    }`}
                  >
                    JPG (High Quality)
                  </button>
                </div>

                <div className="flex items-center gap-1.5 flex-1 sm:flex-initial justify-end">
                  {canShareFilesToSystem() && isMobileDevice() && (
                    <button
                      type="button"
                      id="btn-share-save-gallery"
                      onClick={() => handleDownloadPoster(undefined, true)}
                      disabled={!displayPosterSrc || isGeneratingPoster || isDownloadingPoster}
                      className="px-3 py-2 rounded-xl bg-white hover:bg-[#EFE7DA] border border-[#D5C7B6] text-[#423023] text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50"
                      title="Open device share sheet to Save to Photos"
                    >
                      <Share2 className="w-3.5 h-3.5 text-[#8B6544]" />
                      <span>Photos</span>
                    </button>
                  )}

                  <button
                    type="button"
                    id="btn-save-poster-primary"
                    onClick={() => handleSavePosterToSupabase()}
                    disabled={!displayPosterSrc || isGeneratingPoster || isSavingPoster}
                    className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-2xs transition-all disabled:opacity-50 ${
                      isCurrentPosterAlreadySaved
                        ? 'bg-[#E7EFE6] border border-[#C5DAC3] text-[#2F442F]'
                        : 'bg-white hover:bg-[#EFE7DA] border border-[#4E654E] text-[#2F442F]'
                    }`}
                  >
                    {isSavingPoster ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#4E654E]" />
                        <span>Saving Poster...</span>
                      </>
                    ) : isCurrentPosterAlreadySaved ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#4E654E]" />
                        <span>Poster Saved</span>
                      </>
                    ) : (
                      <>
                        <Bookmark className="w-3.5 h-3.5 text-[#4E654E]" />
                        <span>Save Poster</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    id="btn-save-to-gallery-primary"
                    onClick={() => handleDownloadPoster()}
                    disabled={!displayPosterSrc || isGeneratingPoster || isDownloadingPoster}
                    className="flex-1 sm:flex-initial px-4 py-2 rounded-xl bg-[#4E654E] hover:bg-[#3E523E] text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition-all active:scale-95 disabled:opacity-50"
                  >
                    {isDownloadingPoster ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Saving High-Res Poster...</span>
                      </>
                    ) : downloadSuccess ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />
                        <span>Saved to Gallery!</span>
                      </>
                    ) : (
                      <>
                        <ImageDown className="w-3.5 h-3.5 text-[#E7EFE6]" />
                        <span>Save to Gallery</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {savePosterSuccess && (
                <div
                  role="status"
                  className="px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>{savePosterSuccess}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSavePosterSuccess(null)}
                    className="text-emerald-700 font-bold hover:underline shrink-0"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {savePosterDuplicateMsg && (
                <div
                  role="status"
                  className="px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px] flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span>{savePosterDuplicateMsg}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSavePosterDuplicateMsg(null)}
                    className="text-amber-800 font-bold hover:underline shrink-0"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {savePosterError && (
                <div
                  role="alert"
                  className="px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-red-900 text-[11px] space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
                      <span>{savePosterError}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSavePosterError(null)}
                      className="text-red-700 font-bold hover:underline shrink-0"
                    >
                      Dismiss
                    </button>
                  </div>
                  {needsSellerNamePrompt && (
                    <form
                      onSubmit={handleConfirmInlineSellerNameAndSave}
                      className="p-2 rounded-lg bg-white border border-red-200 space-y-2"
                    >
                      <div className="flex flex-col sm:flex-row gap-1.5">
                        <input
                          type="text"
                          id="inline-seller-owner-name-bottom"
                          value={inlineSellerNameInput}
                          onChange={(e) => setInlineSellerNameInput(e.target.value)}
                          placeholder="Enter Owner Name (from Seller Info)"
                          className="flex-1 px-2.5 py-1.5 rounded-lg border border-[#D5C7B6] text-[#423023] text-[11px] focus:outline-none focus:ring-1 focus:ring-[#4E654E]"
                        />
                        <button
                          type="submit"
                          disabled={!inlineSellerNameInput.trim() || isSavingPoster}
                          className="px-3 py-1.5 rounded-lg bg-[#4E654E] text-white font-bold text-[10px] disabled:opacity-50 shrink-0"
                        >
                          Save Name &amp; Poster
                        </button>
                        {onOpenSellerInfo && (
                          <button
                            type="button"
                            onClick={onOpenSellerInfo}
                            className="px-2.5 py-1.5 rounded-lg bg-[#FAF7F2] border border-[#D5C7B6] text-[#553E2E] font-semibold text-[10px] shrink-0"
                          >
                            Seller Info
                          </button>
                        )}
                      </div>
                    </form>
                  )}
                  {savePosterSetupRequired && (
                    <div className="p-2 rounded-lg bg-white border border-red-200 space-y-1.5">
                      <p className="text-[10px] text-[#553E2E]">
                        Run the SQL migration in your Supabase SQL Editor to create the{' '}
                        <code className="font-mono font-bold">generated-posters</code> storage bucket and{' '}
                        <code className="font-mono font-bold">generated_posters</code> table.
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(GENERATED_POSTERS_SETUP_SQL);
                            setCopiedPosterSql(true);
                            setTimeout(() => setCopiedPosterSql(false), 2500);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-[#4E654E] text-white font-bold text-[10px] flex items-center gap-1"
                        >
                          {copiedPosterSql ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedPosterSql ? 'SQL Copied!' : 'Copy SQL Setup Script'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSavePosterToSupabase()}
                          className="px-2.5 py-1 rounded-lg bg-red-700 text-white font-bold text-[10px]"
                        >
                          Retry Save
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {downloadMessage && (
                <div
                  role="status"
                  className="px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>{downloadMessage}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDownloadMessage(null)}
                    className="text-emerald-700 font-bold hover:underline shrink-0"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {downloadError && (
                <div
                  role="alert"
                  className="px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-900 text-[11px] space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
                      <span>{downloadError}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDownloadError(null)}
                      className="text-red-700 font-bold hover:underline shrink-0"
                    >
                      Dismiss
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleDownloadPoster()}
                      className="px-2.5 py-1 rounded-lg bg-red-700 text-white font-bold text-[10px]"
                    >
                      Retry Save
                    </button>
                    {canShareFilesToSystem() && (
                      <button
                        type="button"
                        onClick={() => handleDownloadPoster(undefined, true)}
                        className="px-2.5 py-1 rounded-lg bg-white border border-red-200 text-red-800 font-bold text-[10px]"
                      >
                        Save via Photos Sheet
                      </button>
                    )}
                    {directAttachmentUrl && (
                      <a
                        href={directAttachmentUrl}
                        download
                        className="px-2.5 py-1 rounded-lg bg-white border border-red-200 text-red-800 font-bold text-[10px]"
                      >
                        Direct Download
                      </a>
                    )}
                  </div>
                </div>
              )}

              {directAttachmentUrl && !downloadError && (
                <div className="flex items-center justify-between gap-2 text-[10px] text-[#7A6755] pt-0.5">
                  <span>
                    Saves full resolution to device Downloads & Gallery.
                  </span>
                  <a
                    href={directAttachmentUrl}
                    download
                    className="font-semibold text-[#4E654E] hover:underline shrink-0"
                  >
                    Direct File Link
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Review & Edit Captions, Poster Copy, and Design */}
        <div className="lg:col-span-6 space-y-5">
          {/* Active Product & Photo Switcher */}
          <div className="bg-[#FAF7F2] rounded-3xl border border-[#E8DFD1] p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                {activeProduct.photoUrl ? (
                  <img
                    src={activeProduct.photoUrl}
                    alt={activeProduct.name}
                    className="w-12 h-12 rounded-xl object-cover border border-[#D5C7B6] shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-[#EAE2D3] flex items-center justify-center text-[10px] text-[#7A6755] shrink-0">
                    No Photo
                  </div>
                )}
                <div className="min-w-0">
                  <p className="font-bold text-xs sm:text-sm text-[#423023] truncate">
                    {activeProduct.name || 'Product'}
                  </p>
                  <p className="text-[11px] text-[#4E654E] font-semibold">
                    {activeProduct.currentPrice
                      ? `₱${activeProduct.currentPrice.toLocaleString()}`
                      : 'Price optional'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploadingPhoto}
                className="px-3 py-1.5 rounded-xl bg-[#4E654E] hover:bg-[#3E523E] text-white text-xs font-bold flex items-center gap-1.5 shrink-0"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{isUploadingPhoto ? 'Uploading...' : activeProduct.photoUrl ? 'Replace Photo' : 'Upload Photo'}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handlePhotoUpload(e.target.files[0]);
                  }
                }}
              />
            </div>

            {savedCrafts.length > 0 && (
              <select
                value={activeProduct.id}
                onChange={(e) => {
                  const found = savedCrafts.find((c) => c.product.id === e.target.value);
                  if (found) {
                    const mergedProduct = found.posterUrl && !found.product.posterUrl
                      ? { ...found.product, posterUrl: found.posterUrl }
                      : found.product;
                    setActiveProduct(mergedProduct);
                    setUploadedPosterUrl(found.posterUrl || found.product.posterUrl || '');
                    setHasLocalCanvasEdits(false);
                    setPosterError(null);
                    const cat = inferCraftCategory(
                      found.product.name,
                      found.product.category,
                      found.product.materials
                    );
                    setCraftCategory(cat);
                    if (onSelectProduct) onSelectProduct(found.product);
                  }
                }}
                className="w-full px-3 py-1.5 rounded-xl border border-[#D5C7B6] bg-white text-xs text-[#423023]"
              >
                <option value={activeProduct.id}>
                  Active Product: {activeProduct.name || 'Current'}
                </option>
                {deduplicateCrafts(savedCrafts.filter((c) => c.product.id !== activeProduct.id)).map(
                  (craft, idx) => (
                    <option
                      key={`poster-craft-${craft.id || craft.product?.id || idx}-${idx}`}
                      value={craft.product.id}
                    >
                      Load Saved: {craft.product.name}
                    </option>
                  )
                )}
              </select>
            )}
          </div>

          {/* Tabbed Review & Edit Panel */}
          <div className="bg-[#FAF7F2] rounded-3xl border border-[#E8DFD1] p-4 sm:p-5 shadow-xs space-y-4">
            <div className="flex border-b border-[#E8DFD1] gap-1.5 pb-2.5">
              <button
                type="button"
                onClick={() => setActiveTabPanel('captions')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  activeTabPanel === 'captions'
                    ? 'bg-[#4E654E] text-white shadow-2xs'
                    : 'text-[#635041] hover:bg-[#EFE7DA]'
                }`}
              >
                Captions & Poster Text
              </button>

              <button
                type="button"
                onClick={() => setActiveTabPanel('design')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  activeTabPanel === 'design'
                    ? 'bg-[#4E654E] text-white shadow-2xs'
                    : 'text-[#635041] hover:bg-[#EFE7DA]'
                }`}
              >
                Poster Style & Colors
              </button>

              <button
                type="button"
                onClick={() => setActiveTabPanel('product')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  activeTabPanel === 'product'
                    ? 'bg-[#4E654E] text-white shadow-2xs'
                    : 'text-[#635041] hover:bg-[#EFE7DA]'
                }`}
              >
                Name & Price
              </button>
            </div>

            {/* TAB 1: Captions & AI Review/Regenerate */}
            {activeTabPanel === 'captions' && (
              <div className="space-y-3.5">
                {captionActionError && (
                  <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center justify-between gap-2">
                    <span>{captionActionError}</span>
                    <button
                      type="button"
                      onClick={() => setCaptionActionError(null)}
                      className="text-red-700 font-bold hover:underline shrink-0"
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                {isRewritingTheme && (
                  <div className="p-2.5 rounded-xl bg-[#EEF4ED] border border-[#C7DAC5] text-[#2F442F] text-xs font-medium flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                    <span>Rewriting captions from scratch to match your selected theme &amp; style...</span>
                  </div>
                )}

                {!isRewritingTheme && themeRewriteNotice && (
                  <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                      {themeRewriteNotice}
                    </span>
                    <button
                      type="button"
                      onClick={() => setThemeRewriteNotice(null)}
                      className="text-emerald-800 font-bold hover:underline shrink-0"
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                {/* Theme, Tone & Regenerate Bar */}
                <div className="p-3 bg-white rounded-2xl border border-[#E5DACD] space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs font-bold text-[#423023]">Theme, Voice &amp; Fresh Rewrite</span>
                    <button
                      type="button"
                      onClick={() => handleAiRegenerateCaption()}
                      disabled={isRegeneratingAi || isRewritingTheme}
                      className="px-3 py-1 rounded-lg bg-[#E7EFE6] text-[#2F442F] hover:bg-[#D5E6D3] text-xs font-bold flex items-center gap-1.5 disabled:opacity-60"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isRegeneratingAi ? 'animate-spin' : ''}`} />
                      <span>{isRegeneratingAi ? 'Writing Fresh Hook...' : 'Regenerate Hook'}</span>
                    </button>
                  </div>

                  <div>
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-[#7A6755] mb-1.5">
                      Caption &amp; Poster Theme (Rewrites Full Copy)
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {COLOR_THEMES.map((st) => {
                        const isSelected = selectedAesthetic === st.id;
                        return (
                          <button
                            key={st.id}
                            type="button"
                            onClick={() => {
                              setSelectedAesthetic(st.id);
                              setCustomColors({});
                              setHasLocalCanvasEdits(true);
                              setIsApproved(false);
                              handleRewriteCaptionsForTheme({ themeOverride: st.id });
                            }}
                            className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1.5 transition-all ${
                              isSelected
                                ? 'bg-[#4E654E] text-white font-bold shadow-2xs'
                                : 'bg-[#FAF7F2] text-[#553E2E] hover:bg-[#EFE7DA] border border-[#E8DFD1]'
                            }`}
                          >
                            <span
                              className="w-2.5 h-2.5 rounded-full border border-black/15 shrink-0"
                              style={{ backgroundColor: st.swatch }}
                            />
                            <span>{st.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-[#7A6755] mb-1.5">
                      Voice &amp; Marketing Style
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {CAPTION_TONES.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => {
                            setSelectedTone(t.id);
                            handleRewriteCaptionsForTheme({ toneOverride: t.id });
                          }}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                            selectedTone === t.id
                              ? 'bg-[#8B6544] text-white font-bold'
                              : 'bg-[#FAF7F2] text-[#553E2E] hover:bg-[#EFE7DA] border border-[#E8DFD1]'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Headline */}
                <div>
                  <label className="block text-[11px] font-bold text-[#635041] mb-1">
                    Poster Headline
                  </label>
                  <input
                    type="text"
                    value={headline}
                    onChange={(e) => {
                      setHeadline(e.target.value);
                      setHasLocalCanvasEdits(true);
                      setIsApproved(false);
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-[#D5C7B6] bg-white text-xs text-[#423023] font-semibold"
                  />
                </div>

                {/* Poster Short Text */}
                <div>
                  <label className="block text-[11px] font-bold text-[#635041] mb-1">
                    Poster Subheadline / Short Copy
                  </label>
                  <textarea
                    rows={2}
                    value={shortDescription}
                    onChange={(e) => {
                      setShortDescription(e.target.value);
                      setHasLocalCanvasEdits(true);
                      setIsApproved(false);
                    }}
                    className="w-full p-2.5 rounded-xl border border-[#D5C7B6] bg-white text-xs text-[#423023]"
                  />
                </div>

                {/* Full Social Caption + Platform Selector */}
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                    <div className="flex items-center gap-1">
                      <label className="text-[11px] font-bold text-[#635041] mr-1">
                        Marketing Caption
                      </label>
                      {(['instagram', 'facebook', 'tiktok'] as const).map((plat) => (
                        <button
                          key={plat}
                          type="button"
                          onClick={() => handleSelectPlatform(plat)}
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold capitalize transition-all ${
                            captionPlatform === plat
                              ? 'bg-[#4E654E] text-white'
                              : 'bg-[#EFE7DA] text-[#553E2E] hover:bg-[#E2D5C3]'
                          }`}
                        >
                          {plat}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopySection('full', fullCompiledCaption)}
                      className="text-[11px] font-bold text-[#4E654E] hover:underline flex items-center gap-1"
                    >
                      {copiedSection === 'full' ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>{copiedSection === 'full' ? 'Copied!' : 'Copy Full Caption'}</span>
                    </button>
                  </div>
                  <textarea
                    rows={4}
                    value={activePlatformCaption}
                    onChange={(e) => setActivePlatformCaption(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-[#D5C7B6] bg-white text-xs text-[#423023] leading-relaxed"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-[#635041] mb-1">
                      Poster Call to Action
                    </label>
                    <input
                      type="text"
                      value={callToAction}
                      onChange={(e) => {
                        setCallToAction(e.target.value);
                        setHasLocalCanvasEdits(true);
                        setIsApproved(false);
                      }}
                      className="w-full px-3 py-1.5 rounded-xl border border-[#D5C7B6] bg-white text-xs text-[#423023]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#635041] mb-1">
                      Hashtags
                    </label>
                    <input
                      type="text"
                      value={hashtags}
                      onChange={(e) => {
                        setHashtags(e.target.value);
                        setPlatformHashtags((prev) => ({ ...prev, [captionPlatform]: e.target.value }));
                        setHasLocalCanvasEdits(true);
                        setIsApproved(false);
                      }}
                      className="w-full px-3 py-1.5 rounded-xl border border-[#D5C7B6] bg-white text-xs text-[#423023]"
                    />
                  </div>
                </div>

                {/* Product Description (for shop listings & marketplace copy) */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-bold text-[#635041]">
                      Product Description (Shop &amp; Catalog Copy)
                    </label>
                    <button
                      type="button"
                      onClick={() => handleCopySection('description', productDescription)}
                      disabled={!productDescription.trim()}
                      className="text-[11px] font-bold text-[#4E654E] hover:underline flex items-center gap-1 disabled:opacity-50"
                    >
                      {copiedSection === 'description' ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>{copiedSection === 'description' ? 'Copied!' : 'Copy Description'}</span>
                    </button>
                  </div>
                  <textarea
                    rows={3}
                    value={productDescription}
                    onChange={(e) => {
                      setProductDescription(e.target.value);
                      setIsApproved(false);
                    }}
                    placeholder="Detailed product story and craftsmanship description..."
                    className="w-full p-2.5 rounded-xl border border-[#D5C7B6] bg-white text-xs text-[#423023] leading-relaxed"
                  />
                </div>

                {/* AI Caption Revision Input */}
                <div className="p-3 rounded-2xl bg-white border border-[#E0D5C5] space-y-2">
                  <label className="block text-[11px] font-bold text-[#423023]">
                    Ask Gemini to Revise Caption
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="e.g. Make it shorter, warmer, or highlight limited stock..."
                      value={revisionInstruction}
                      onChange={(e) => setRevisionInstruction(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAiReviseCaption();
                        }
                      }}
                      className="flex-1 px-3 py-1.5 rounded-xl border border-[#D5C7B6] bg-[#FAF7F2] text-xs text-[#423023]"
                    />
                    <button
                      type="button"
                      onClick={handleAiReviseCaption}
                      disabled={!revisionInstruction.trim() || isRevisingAi}
                      className="px-3.5 py-1.5 rounded-xl bg-[#4E654E] hover:bg-[#3E523E] text-white text-xs font-bold flex items-center gap-1 disabled:opacity-50"
                    >
                      <Wand2 className={`w-3.5 h-3.5 ${isRevisingAi ? 'animate-spin' : ''}`} />
                      <span>{isRevisingAi ? 'Revising...' : 'Revise'}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: Poster Style, Additional Designs & Custom Colors */}
            {activeTabPanel === 'design' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-[11px] font-bold text-[#635041] uppercase tracking-wide flex items-center gap-1.5">
                    <Layout className="w-3.5 h-3.5 text-[#8B6544]" />
                    <span>Poster Designs ({DESIGN_VARIATIONS.length} Styles)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => handleGenerateServerPoster({ surpriseMe: true })}
                    disabled={isGeneratingPoster}
                    className="px-2.5 py-1 rounded-lg bg-[#EFE7DA] hover:bg-[#E2D5C3] text-[#423023] text-[10px] font-bold flex items-center gap-1 transition-all"
                  >
                    <Shuffle className="w-3 h-3 text-[#8B6544]" />
                    <span>Surprise Style</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 max-h-[290px] overflow-y-auto pr-1">
                  {DESIGN_VARIATIONS.map((dv) => {
                    const isSelected = designVariation === dv.id;
                    return (
                      <button
                        key={dv.id}
                        type="button"
                        onClick={() => {
                          setDesignVariation(dv.id);
                          setHasLocalCanvasEdits(true);
                          setIsApproved(false);
                        }}
                        className={`p-2.5 rounded-2xl border text-left transition-all relative ${
                          isSelected
                            ? 'bg-[#FAF7F2] border-[#4E654E] ring-2 ring-[#4E654E]/20 shadow-xs'
                            : 'bg-white border-[#E0D5C5] hover:bg-[#FDFBF7]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-bold text-[#423023]">{dv.label}</span>
                          {dv.tag && (
                            <span className="px-1.5 py-0.5 rounded bg-[#E7EFE6] text-[#2F442F] text-[9px] font-bold uppercase">
                              {dv.tag}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-[#7A6755] leading-snug block mt-0.5">
                          {dv.desc}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <label className="text-[11px] font-bold text-[#635041] uppercase tracking-wide flex items-center gap-1.5">
                      <Palette className="w-3.5 h-3.5 text-[#8B6544]" />
                      <span>Color Themes (Auto-Rewrites Captions)</span>
                    </label>
                    {isRewritingTheme && (
                      <span className="text-[10px] font-semibold text-[#4E654E] flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Rewriting captions...
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-xs">
                    {COLOR_THEMES.map((st) => (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => {
                          setSelectedAesthetic(st.id);
                          setCustomColors({});
                          setHasLocalCanvasEdits(true);
                          setIsApproved(false);
                          handleRewriteCaptionsForTheme({ themeOverride: st.id });
                        }}
                        className={`px-2 py-1.5 rounded-xl font-medium flex items-center gap-1.5 transition-all ${
                          selectedAesthetic === st.id &&
                          !customColors.backgroundHex &&
                          !customColors.accentHex &&
                          !customColors.textPrimaryHex
                            ? 'bg-[#4E654E] text-white font-bold shadow-2xs'
                            : 'bg-white border border-[#D8CCBD] text-[#553E2E] hover:bg-[#EFE7DA]'
                        }`}
                      >
                        <span
                          className="w-3 h-3 rounded-full border border-black/15 shrink-0"
                          style={{ backgroundColor: st.swatch }}
                        />
                        <span className="truncate">{st.label}</span>
                      </button>
                    ))}
                  </div>
                  {themeRewriteNotice && !isRewritingTheme && (
                    <p className="mt-1.5 text-[11px] font-medium text-emerald-800 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>{themeRewriteNotice}</span>
                    </p>
                  )}
                </div>

                {/* Custom Color Pickers */}
                <div className="p-3 rounded-2xl bg-white border border-[#E0D5C5] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-[#423023]">
                      Custom Poster Colors
                    </span>
                    {(customColors.backgroundHex || customColors.accentHex || customColors.textPrimaryHex) && (
                      <button
                        type="button"
                        onClick={() => {
                          setCustomColors({});
                          setHasLocalCanvasEdits(true);
                        }}
                        className="text-[10px] font-bold text-[#8B6544] hover:underline flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Reset Colors</span>
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="flex flex-col gap-1 text-[10px] font-semibold text-[#635041]">
                      <span>Background</span>
                      <div className="flex items-center gap-1.5 p-1 rounded-lg border border-[#D5C7B6] bg-[#FAF7F2]">
                        <input
                          type="color"
                          value={customColors.backgroundHex || palette?.backgroundHex || '#FAF5EE'}
                          onChange={(e) => {
                            setCustomColors((prev) => ({ ...prev, backgroundHex: e.target.value }));
                            setHasLocalCanvasEdits(true);
                            setIsApproved(false);
                          }}
                          className="w-6 h-6 rounded border-0 bg-transparent cursor-pointer"
                        />
                        <span className="text-[10px] font-mono text-[#553E2E] truncate">
                          {(customColors.backgroundHex || palette?.backgroundHex || '#FAF5EE').toUpperCase()}
                        </span>
                      </div>
                    </label>

                    <label className="flex flex-col gap-1 text-[10px] font-semibold text-[#635041]">
                      <span>Accent / CTA</span>
                      <div className="flex items-center gap-1.5 p-1 rounded-lg border border-[#D5C7B6] bg-[#FAF7F2]">
                        <input
                          type="color"
                          value={customColors.accentHex || palette?.accentHex || '#B25A38'}
                          onChange={(e) => {
                            setCustomColors((prev) => ({ ...prev, accentHex: e.target.value }));
                            setHasLocalCanvasEdits(true);
                            setIsApproved(false);
                          }}
                          className="w-6 h-6 rounded border-0 bg-transparent cursor-pointer"
                        />
                        <span className="text-[10px] font-mono text-[#553E2E] truncate">
                          {(customColors.accentHex || palette?.accentHex || '#B25A38').toUpperCase()}
                        </span>
                      </div>
                    </label>

                    <label className="flex flex-col gap-1 text-[10px] font-semibold text-[#635041]">
                      <span>Headline Text</span>
                      <div className="flex items-center gap-1.5 p-1 rounded-lg border border-[#D5C7B6] bg-[#FAF7F2]">
                        <input
                          type="color"
                          value={customColors.textPrimaryHex || palette?.textPrimaryHex || '#382B21'}
                          onChange={(e) => {
                            setCustomColors((prev) => ({ ...prev, textPrimaryHex: e.target.value }));
                            setHasLocalCanvasEdits(true);
                            setIsApproved(false);
                          }}
                          className="w-6 h-6 rounded border-0 bg-transparent cursor-pointer"
                        />
                        <span className="text-[10px] font-mono text-[#553E2E] truncate">
                          {(customColors.textPrimaryHex || palette?.textPrimaryHex || '#382B21').toUpperCase()}
                        </span>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Quick Apply & Regenerate Action */}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    id="btn-apply-design-regenerate"
                    onClick={() => handleGenerateServerPoster({ refreshCopyOverride: false })}
                    disabled={isGeneratingPoster}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-[#4E654E] hover:bg-[#3E523E] text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs disabled:opacity-60"
                  >
                    <Sparkles className={`w-3.5 h-3.5 ${isGeneratingPoster ? 'animate-spin' : ''}`} />
                    <span>{isGeneratingPoster ? 'Rendering Poster...' : 'Render High-Res Poster'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsRegenerateModalOpen(true)}
                    disabled={isGeneratingPoster}
                    className="px-3.5 py-2.5 rounded-xl bg-white hover:bg-[#EFE7DA] border border-[#D5C7B6] text-[#423023] text-xs font-bold flex items-center gap-1.5"
                  >
                    <Wand2 className="w-3.5 h-3.5 text-[#8B6544]" />
                    <span>AI Direction...</span>
                  </button>
                </div>
              </div>
            )}

            {/* TAB 3: Quick Product Name & Price Edit */}
            {activeTabPanel === 'product' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold text-[#635041] mb-1">
                    Product Name
                  </label>
                  <input
                    type="text"
                    value={activeProduct.name}
                    onChange={(e) => {
                      const updated = { ...activeProduct, name: e.target.value };
                      setActiveProduct(updated);
                      setHasLocalCanvasEdits(true);
                      setIsApproved(false);
                      if (onSelectProduct) onSelectProduct(updated);
                    }}
                    className="w-full px-3 py-1.5 rounded-xl border border-[#D5C7B6] bg-white text-xs text-[#423023] font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-[#635041] mb-1">
                    Selling Price (₱)
                  </label>
                  <input
                    type="number"
                    value={activeProduct.currentPrice || ''}
                    onChange={(e) => {
                      const val = e.target.value ? parseFloat(e.target.value) : null;
                      const updated = { ...activeProduct, currentPrice: val };
                      setActiveProduct(updated);
                      setHasLocalCanvasEdits(true);
                      setIsApproved(false);
                      if (onSelectProduct) onSelectProduct(updated);
                    }}
                    className="w-full px-3 py-1.5 rounded-xl border border-[#D5C7B6] bg-white text-xs text-[#423023]"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* AI Posters Section (Retrieved from Supabase "generated_posters" + Local Fallback) */}
      {(() => {
        const supabaseUrls = new Set(savedPosters.map((p) => p.poster_image_url));
        const localOnlyCrafts = deduplicateCrafts(savedCrafts).filter((c) => {
          const url = c.posterUrl || c.product?.posterUrl || '';
          return Boolean(url) && !supabaseUrls.has(url);
        });
        const totalPostersCount = savedPosters.length + localOnlyCrafts.length;

        return (
          <section
            id="ai-posters-section"
            className="bg-[#FAF7F2] rounded-3xl border border-[#E8DFD1] p-5 sm:p-6 shadow-xs space-y-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#8B6544]">
                    AI Posters
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#E7EFE6] text-[#2F442F] text-[10px] font-semibold border border-[#C5DAC3]">
                    <Database className="w-2.5 h-2.5 text-[#4E654E]" />
                    <span>Supabase Cloud</span>
                  </span>
                </div>
                <h2 className="text-lg font-bold font-artisan text-[#423023] mt-0.5">
                  Your Generated Posters ({totalPostersCount})
                </h2>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xs text-[#735F4C]">
                  Permanently stored in Supabase &amp; accessible across sessions.
                </p>
                {onRefreshSavedPosters && (
                  <button
                    type="button"
                    id="btn-refresh-ai-posters"
                    onClick={onRefreshSavedPosters}
                    disabled={isLoadingSavedPosters}
                    className="px-3 py-1.5 rounded-xl bg-white hover:bg-[#EFE7DA] border border-[#D5C7B6] text-[#423023] text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 text-[#4E654E] ${isLoadingSavedPosters ? 'animate-spin' : ''}`} />
                    <span>{isLoadingSavedPosters ? 'Loading...' : 'Refresh'}</span>
                  </button>
                )}
              </div>
            </div>

            {savedPostersError && (
              <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-900 text-xs space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <span>{savedPostersError}</span>
                  </div>
                  {onRefreshSavedPosters && (
                    <button
                      type="button"
                      onClick={onRefreshSavedPosters}
                      className="px-3 py-1.5 rounded-lg bg-red-700 text-white font-bold text-[11px] shrink-0"
                    >
                      Retry Load
                    </button>
                  )}
                </div>
                {savedPostersSetupRequired && (
                  <div className="p-2.5 rounded-xl bg-white border border-red-200 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-[#553E2E]">
                      Create the <code className="font-mono font-bold">generated-posters</code> bucket &amp;{' '}
                      <code className="font-mono font-bold">generated_posters</code> table in Supabase SQL Editor.
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(GENERATED_POSTERS_SETUP_SQL);
                        setCopiedPosterSql(true);
                        setTimeout(() => setCopiedPosterSql(false), 2500);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-[#4E654E] text-white font-bold text-[11px] flex items-center gap-1"
                    >
                      {copiedPosterSql ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedPosterSql ? 'SQL Copied!' : 'Copy SQL Setup Script'}</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {isLoadingSavedPosters && totalPostersCount === 0 ? (
              <div className="py-10 flex flex-col items-center justify-center gap-2 text-xs text-[#7A6755]">
                <Loader2 className="w-6 h-6 animate-spin text-[#4E654E]" />
                <span>Retrieving saved AI posters from Supabase...</span>
              </div>
            ) : totalPostersCount === 0 ? (
              <div className="p-8 rounded-2xl border border-dashed border-[#D5C7B6] bg-white/70 text-center space-y-2">
                <Bookmark className="w-6 h-6 text-[#8B6544] mx-auto" />
                <p className="text-xs sm:text-sm font-bold text-[#423023]">
                  No saved AI posters yet
                </p>
                <p className="text-xs text-[#7A6755] max-w-md mx-auto">
                  Click <strong>Save Poster</strong> above to upload your generated poster image to Supabase Storage and save it here permanently.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {savedPosters.map((poster) => {
                  const isCardDownloading = savingGalleryCardId === poster.id;
                  const isCardSaved = savedGalleryCardSuccessId === poster.id;
                  const isCurrentlyLoaded = uploadedPosterUrl === poster.poster_image_url;
                  const formattedDate = poster.created_at
                    ? new Date(poster.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })
                    : '';

                  const loadSupabasePosterIntoStudio = () => {
                    const matchedCraft = savedCrafts.find(
                      (c) =>
                        c.product?.name?.trim().toLowerCase() ===
                        poster.product_name.trim().toLowerCase()
                    );
                    const loadedProd: ProductInput = matchedCraft
                      ? {
                          ...matchedCraft.product,
                          name: poster.product_name || matchedCraft.product.name,
                          ownerName: poster.seller_name || matchedCraft.product.ownerName,
                          caption: poster.caption || matchedCraft.product.caption,
                          posterUrl: poster.poster_image_url,
                        }
                      : {
                          ...activeProduct,
                          id: `poster-${poster.id}`,
                          name: poster.product_name || 'Saved Craft Poster',
                          ownerName: poster.seller_name || '',
                          caption: poster.caption || '',
                          posterUrl: poster.poster_image_url,
                        };
                    setActiveProduct(loadedProd);
                    setUploadedPosterUrl(poster.poster_image_url);
                    setHasLocalCanvasEdits(false);
                    setPosterError(null);
                    if (poster.caption) {
                      setPersuasiveCaption(poster.caption);
                    }
                    if (onSelectProduct) onSelectProduct(loadedProd);
                  };

                  return (
                    <div
                      key={`supabase-poster-${poster.id}`}
                      className={`rounded-2xl border p-3 bg-white flex flex-col gap-3 transition-all ${
                        isCurrentlyLoaded ? 'border-[#4E654E] ring-2 ring-[#4E654E]/15' : 'border-[#E0D5C5]'
                      }`}
                    >
                      <div
                        onClick={loadSupabasePosterIntoStudio}
                        className="aspect-[4/5] w-full rounded-xl overflow-hidden bg-[#F3ECE0] border border-[#E8DFD1] cursor-pointer flex items-center justify-center"
                      >
                        <img
                          src={poster.poster_image_url}
                          alt={`Saved poster for ${poster.product_name}`}
                          className="w-full h-full object-contain hover:scale-[1.01] transition-transform"
                          referrerPolicy="no-referrer"
                        />
                      </div>

                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-bold text-[#423023] truncate">
                            {poster.product_name || 'Promotional Poster'}
                          </p>
                          <span className="px-1.5 py-0.5 rounded bg-[#E7EFE6] text-[#2F442F] text-[9px] font-bold shrink-0">
                            Saved
                          </span>
                        </div>
                        <p className="text-[11px] text-[#7A6755] truncate">
                          {[poster.business_name, poster.seller_name].filter(Boolean).join(' • ')}
                          {formattedDate ? `${[poster.business_name, poster.seller_name].some(Boolean) ? ' • ' : ''}${formattedDate}` : ''}
                        </p>
                        {poster.caption && (
                          <p className="text-[11px] text-[#5C4A3C] line-clamp-2 bg-[#FAF7F2] p-2 rounded-lg border border-[#EDE4D5]">
                            {poster.caption}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 mt-auto">
                        <button
                          type="button"
                          onPointerEnter={() =>
                            preloadPosterForGallery({
                              src: poster.poster_image_url,
                              productName: poster.product_name,
                              aspectRatio: '4:5',
                              format: downloadFormat,
                            })
                          }
                          onClick={async () => {
                            if (savingGalleryCardId) return;
                            setSavingGalleryCardId(poster.id);
                            setDownloadError(null);
                            try {
                              const result = await savePosterToDeviceGallery({
                                src: poster.poster_image_url,
                                productName: poster.product_name,
                                aspectRatio: '4:5',
                                format: downloadFormat,
                              });
                              if (result.success) {
                                setSavedGalleryCardSuccessId(poster.id);
                                setDownloadMessage(
                                  result.message || `Saved "${poster.product_name}" poster to your gallery!`
                                );
                                setTimeout(() => setSavedGalleryCardSuccessId(null), 4000);
                              } else if (!result.cancelled) {
                                setDownloadError(result.error || 'Failed to save poster to gallery.');
                              }
                            } catch (err: any) {
                              setDownloadError(err?.message || 'Failed to save poster to gallery.');
                            } finally {
                              setSavingGalleryCardId(null);
                            }
                          }}
                          disabled={isCardDownloading}
                          className="flex-1 px-2.5 py-2 rounded-xl bg-[#4E654E] hover:bg-[#3E523E] text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-all disabled:opacity-60"
                        >
                          {isCardDownloading ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Saving...</span>
                            </>
                          ) : isCardSaved ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />
                              <span>Saved!</span>
                            </>
                          ) : (
                            <>
                              <ImageDown className="w-3.5 h-3.5" />
                              <span>Save to Gallery</span>
                            </>
                          )}
                        </button>

                        {poster.caption && (
                          <button
                            type="button"
                            onClick={() => handleCopySection(`poster-cap-${poster.id}`, poster.caption)}
                            className="px-2.5 py-2 rounded-xl bg-[#EFE7DA] hover:bg-[#E2D5C3] text-[#423023] text-xs font-semibold flex items-center gap-1"
                            title="Copy saved caption"
                          >
                            {copiedSection === `poster-cap-${poster.id}` ? (
                              <Check className="w-3.5 h-3.5 text-[#4E654E]" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            loadSupabasePosterIntoStudio();
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="px-2.5 py-2 rounded-xl bg-[#FAF7F2] hover:bg-[#EFE7DA] border border-[#D5C7B6] text-[#423023] text-xs font-semibold transition-all"
                        >
                          Open
                        </button>
                      </div>
                    </div>
                  );
                })}

                {localOnlyCrafts.map((craft, idx) => {
                  const posterSrc = craft.posterUrl || craft.product?.posterUrl || '';
                  const isCardDownloading = savingGalleryCardId === craft.id;
                  const isCardSaved = savedGalleryCardSuccessId === craft.id;
                  const isCurrentlyLoaded = craft.product?.id === activeProduct.id;

                  return (
                    <div
                      key={`ai-poster-card-${craft.id || idx}-${idx}`}
                      className={`rounded-2xl border p-3 bg-white flex flex-col gap-3 transition-all ${
                        isCurrentlyLoaded ? 'border-[#4E654E] ring-2 ring-[#4E654E]/15' : 'border-[#E0D5C5]'
                      }`}
                    >
                      <div
                        onClick={() => {
                          const mergedProduct =
                            craft.posterUrl && !craft.product.posterUrl
                              ? { ...craft.product, posterUrl: craft.posterUrl }
                              : craft.product;
                          setActiveProduct(mergedProduct);
                          setUploadedPosterUrl(posterSrc);
                          setHasLocalCanvasEdits(false);
                          setPosterError(null);
                          if (onSelectProduct) onSelectProduct(mergedProduct);
                        }}
                        className="aspect-[4/5] w-full rounded-xl overflow-hidden bg-[#F3ECE0] border border-[#E8DFD1] cursor-pointer flex items-center justify-center"
                      >
                        <img
                          src={posterSrc}
                          alt={`Generated poster for ${craft.product?.name}`}
                          className="w-full h-full object-contain hover:scale-[1.01] transition-transform"
                        />
                      </div>

                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[#423023] truncate">
                          {craft.product?.name || 'Promotional Poster'}
                        </p>
                        <p className="text-[11px] text-[#7A6755] truncate">
                          {craft.product?.category || 'Handmade Craft'}
                          {craft.product?.currentPrice ? ` • ₱${craft.product.currentPrice.toLocaleString()}` : ''}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 mt-auto">
                        <button
                          type="button"
                          onPointerEnter={() =>
                            preloadPosterForGallery({
                              src: posterSrc,
                              productName: craft.product?.name,
                              aspectRatio: '4:5',
                              format: downloadFormat,
                            })
                          }
                          onTouchStart={() =>
                            preloadPosterForGallery({
                              src: posterSrc,
                              productName: craft.product?.name,
                              aspectRatio: '4:5',
                              format: downloadFormat,
                            })
                          }
                          onClick={() => handleDownloadSavedPosterCard(craft)}
                          disabled={isCardDownloading}
                          className="flex-1 px-3 py-2 rounded-xl bg-[#4E654E] hover:bg-[#3E523E] text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-all disabled:opacity-60"
                        >
                          {isCardDownloading ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Saving...</span>
                            </>
                          ) : isCardSaved ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />
                              <span>Saved!</span>
                            </>
                          ) : (
                            <>
                              <ImageDown className="w-3.5 h-3.5" />
                              <span>Save to Gallery</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            const mergedProduct =
                              craft.posterUrl && !craft.product.posterUrl
                                ? { ...craft.product, posterUrl: craft.posterUrl }
                                : craft.product;
                            setActiveProduct(mergedProduct);
                            setUploadedPosterUrl(posterSrc);
                            setHasLocalCanvasEdits(false);
                            setPosterError(null);
                            if (onSelectProduct) onSelectProduct(mergedProduct);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="px-3 py-2 rounded-xl bg-[#FAF7F2] hover:bg-[#EFE7DA] border border-[#D5C7B6] text-[#423023] text-xs font-semibold transition-all"
                        >
                          Edit
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })()}

      {/* Full-Resolution Preview Modal */}
      {isPreviewModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative max-w-2xl w-full bg-[#FAF7F2] rounded-3xl overflow-hidden shadow-2xl border border-[#E8DFD1] flex flex-col max-h-[92vh]">
            <div className="p-4 border-b border-[#E8DFD1] flex items-center justify-between">
              <div>
                <h3 className="font-bold font-artisan text-lg text-[#423023]">
                  Full-Resolution Poster Preview
                </h3>
                <p className="text-xs text-[#7A6755]">
                  {aspectRatio} • {DESIGN_VARIATIONS.find((d) => d.id === designVariation)?.label}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsPreviewModalOpen(false)}
                className="p-1.5 rounded-lg hover:bg-[#EFE7DA] text-[#6E5745]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 flex items-center justify-center bg-[#EDE4D5]">
              {displayPosterSrc && (
                <img
                  src={displayPosterSrc}
                  alt={activeProduct.name}
                  className="max-h-[70vh] object-contain rounded-2xl shadow-lg border border-black/10"
                />
              )}
            </div>

            <div className="p-4 bg-white border-t border-[#E8DFD1] flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleApproveAndSave}
                disabled={isSaving}
                className="px-4 py-2 rounded-xl bg-[#EFE7DA] hover:bg-[#E2D5C3] text-[#423023] text-xs font-bold flex items-center gap-1.5"
              >
                <Bookmark className="w-3.5 h-3.5 text-[#8B6544]" />
                <span>{isApproved ? 'Saved to Catalog' : 'Approve & Save'}</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleDownloadPoster('jpg')}
                  disabled={isDownloadingPoster}
                  className="px-3 py-2 rounded-xl bg-[#FAF7F2] hover:bg-[#EFE7DA] border border-[#D5C7B6] text-[#423023] text-xs font-bold flex items-center gap-1.5 disabled:opacity-60"
                >
                  <Download className="w-3.5 h-3.5 text-[#8B6544]" />
                  <span>JPG</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadPoster('png')}
                  disabled={isDownloadingPoster}
                  className="px-4 py-2 rounded-xl bg-[#4E654E] hover:bg-[#3E523E] text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-60"
                >
                  {isDownloadingPoster ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : downloadSuccess ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />
                  ) : (
                    <ImageDown className="w-3.5 h-3.5" />
                  )}
                  <span>{downloadSuccess ? 'Saved to Gallery!' : 'Save to Gallery (PNG)'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Customize & Regenerate Poster Modal */}
      {isRegenerateModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="relative max-w-2xl w-full bg-[#FAF7F2] rounded-3xl overflow-hidden shadow-2xl border border-[#E8DFD1] flex flex-col max-h-[92vh]">
            <div className="p-4 sm:p-5 border-b border-[#E8DFD1] flex items-center justify-between bg-white">
              <div>
                <h3 className="font-bold font-artisan text-lg sm:text-xl text-[#423023] flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-[#8B6544]" />
                  <span>Customize & Regenerate Poster</span>
                </h3>
                <p className="text-xs text-[#7A6755] mt-0.5">
                  Pick a completely different layout, change theme or custom colors, and tell AI how you want your new poster styled.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsRegenerateModalOpen(false)}
                className="p-1.5 rounded-lg hover:bg-[#EFE7DA] text-[#6E5745]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-5 overflow-y-auto space-y-5 flex-1">
              {/* 1. Design Selection */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wide text-[#423023]">
                    1. Choose Poster Design ({DESIGN_VARIATIONS.length} Layouts)
                  </label>
                  <button
                    type="button"
                    id="btn-surprise-regenerate"
                    onClick={() => handleGenerateServerPoster({ surpriseMe: true })}
                    disabled={isGeneratingPoster}
                    className="px-2.5 py-1 rounded-lg bg-[#EFE7DA] hover:bg-[#E2D5C3] text-[#423023] text-[11px] font-bold flex items-center gap-1"
                  >
                    <Shuffle className="w-3.5 h-3.5 text-[#8B6544]" />
                    <span>Surprise Me (New Layout + Colors)</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-2 gap-2">
                  {DESIGN_VARIATIONS.map((dv) => {
                    const isSelected = designVariation === dv.id;
                    return (
                      <button
                        key={`modal-dv-${dv.id}`}
                        type="button"
                        onClick={() => {
                          setDesignVariation(dv.id);
                          setHasLocalCanvasEdits(true);
                        }}
                        className={`p-2.5 rounded-2xl border text-left transition-all ${
                          isSelected
                            ? 'bg-white border-[#4E654E] ring-2 ring-[#4E654E]/25 shadow-xs'
                            : 'bg-white/80 border-[#E0D5C5] hover:bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-bold text-[#423023]">{dv.label}</span>
                          {dv.tag && (
                            <span className="px-1.5 py-0.5 rounded bg-[#E7EFE6] text-[#2F442F] text-[9px] font-bold uppercase">
                              {dv.tag}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-[#7A6755] leading-snug block mt-0.5">
                          {dv.desc}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. Colors Selection */}
              <div className="space-y-2.5">
                <label className="block text-xs font-bold uppercase tracking-wide text-[#423023]">
                  2. Choose Color Palette or Custom Colors
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-[11px]">
                  {COLOR_THEMES.map((st) => (
                    <button
                      key={`modal-theme-${st.id}`}
                      type="button"
                      onClick={() => {
                        setSelectedAesthetic(st.id);
                        setCustomColors({});
                        setHasLocalCanvasEdits(true);
                      }}
                      className={`px-2 py-1.5 rounded-xl font-medium flex items-center gap-1.5 transition-all ${
                        selectedAesthetic === st.id &&
                        !customColors.backgroundHex &&
                        !customColors.accentHex &&
                        !customColors.textPrimaryHex
                          ? 'bg-[#4E654E] text-white font-bold shadow-2xs'
                          : 'bg-white border border-[#D8CCBD] text-[#553E2E] hover:bg-[#EFE7DA]'
                      }`}
                    >
                      <span
                        className="w-3 h-3 rounded-full border border-black/15 shrink-0"
                        style={{ backgroundColor: st.swatch }}
                      />
                      <span className="truncate">{st.label}</span>
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-3 gap-2.5 p-3 rounded-2xl bg-white border border-[#E0D5C5]">
                  <label className="flex flex-col gap-1 text-[11px] font-semibold text-[#635041]">
                    <span>Background</span>
                    <div className="flex items-center gap-2 p-1 rounded-lg border border-[#D5C7B6] bg-[#FAF7F2]">
                      <input
                        type="color"
                        value={customColors.backgroundHex || palette?.backgroundHex || '#FAF5EE'}
                        onChange={(e) => setCustomColors((p) => ({ ...p, backgroundHex: e.target.value }))}
                        className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent"
                      />
                      <span className="text-[10px] font-mono text-[#553E2E]">
                        {(customColors.backgroundHex || palette?.backgroundHex || '#FAF5EE').toUpperCase()}
                      </span>
                    </div>
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] font-semibold text-[#635041]">
                    <span>Accent / Button</span>
                    <div className="flex items-center gap-2 p-1 rounded-lg border border-[#D5C7B6] bg-[#FAF7F2]">
                      <input
                        type="color"
                        value={customColors.accentHex || palette?.accentHex || '#B25A38'}
                        onChange={(e) => setCustomColors((p) => ({ ...p, accentHex: e.target.value }))}
                        className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent"
                      />
                      <span className="text-[10px] font-mono text-[#553E2E]">
                        {(customColors.accentHex || palette?.accentHex || '#B25A38').toUpperCase()}
                      </span>
                    </div>
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] font-semibold text-[#635041]">
                    <span>Headline Text</span>
                    <div className="flex items-center gap-2 p-1 rounded-lg border border-[#D5C7B6] bg-[#FAF7F2]">
                      <input
                        type="color"
                        value={customColors.textPrimaryHex || palette?.textPrimaryHex || '#382B21'}
                        onChange={(e) => setCustomColors((p) => ({ ...p, textPrimaryHex: e.target.value }))}
                        className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent"
                      />
                      <span className="text-[10px] font-mono text-[#553E2E]">
                        {(customColors.textPrimaryHex || palette?.textPrimaryHex || '#382B21').toUpperCase()}
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              {/* 3. Custom Instruction & AI Headline Refresh */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wide text-[#423023]">
                  3. How Would You Like to Change It? (Optional)
                </label>
                <input
                  type="text"
                  id="input-regenerate-instruction"
                  placeholder="e.g. Make it look like a luxury boutique gift poster with bold gold headline..."
                  value={regenerationInstruction}
                  onChange={(e) => setRegenerationInstruction(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#D5C7B6] bg-white text-xs text-[#423023]"
                />
                <div className="flex flex-wrap gap-1.5">
                  {[
                    'Punchy promo headline for quick sales',
                    'Luxury gift-ready boutique look',
                    'Cozy handmade story vibe',
                    'Clean modern gallery showcase',
                  ].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => setRegenerationInstruction(chip)}
                      className="px-2.5 py-1 rounded-lg bg-white border border-[#D8CCBD] hover:bg-[#EFE7DA] text-[10px] font-medium text-[#553E2E]"
                    >
                      {chip}
                    </button>
                  ))}
                </div>

                <label className="flex items-center gap-2 pt-1 text-xs text-[#423023] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={refreshCopyOnRegen}
                    onChange={(e) => setRefreshCopyOnRegen(e.target.checked)}
                    className="rounded border-[#D5C7B6] text-[#4E654E] focus:ring-[#4E654E]"
                  />
                  <span>Also generate fresh AI headline, tagline & call-to-action for this design</span>
                </label>
              </div>
            </div>

            <div className="p-4 bg-white border-t border-[#E8DFD1] flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setIsRegenerateModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-[#FAF7F2] hover:bg-[#EFE7DA] border border-[#D5C7B6] text-[#553E2E] text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                id="btn-confirm-regenerate-poster"
                onClick={() => handleGenerateServerPoster()}
                disabled={isGeneratingPoster}
                className="px-5 py-2.5 rounded-xl bg-[#4E654E] hover:bg-[#3E523E] text-white text-xs sm:text-sm font-bold flex items-center gap-2 shadow-sm disabled:opacity-60"
              >
                {isGeneratingPoster ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Regenerating Poster...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    <span>Regenerate Poster Now</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
