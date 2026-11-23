import React, { useState, useEffect, useRef } from 'react';
import { Header, NavTab } from './components/Header';
import { SellerInfoForm } from './components/SellerInfoForm';
import { ProductForm } from './components/ProductForm';
import { CatalogView } from './components/CatalogView';
import { SdgInfoModal } from './components/SdgInfoModal';
import { PrivacyNoticeModal } from './components/PrivacyNoticeModal';
import { ProductIdeasView } from './components/ProductIdeasView';
import { AdaptivePosterStudio } from './components/AdaptivePosterStudio';
import {
  ProductInput,
  MarketingContent,
  SavedCraft,
  ArtisanProfile,
  ProductIdea,
  CaptionTone,
  GeneratedPosterRecord,
} from './types';
import {
  checkServerHealth,
  generateMarketingContent,
  generatePosterImage,
} from './services/api';
import { deduplicateCrafts } from './utils/craftDeduplication';
import {
  fetchSupabaseProducts,
  insertProductToSupabase,
  updateProductInSupabase,
  fetchGeneratedPostersFromSupabase,
} from './services/supabase';
import {
  Sparkles,
  Hammer,
  Database,
  CheckCircle2,
  AlertCircle,
  X,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';

const POSTER_MAP_STORAGE_KEY = 'craftcopy_poster_map';

function loadPosterMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(POSTER_MAP_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {}
  return {};
}

function savePosterToMap(productId: string, posterUrl: string) {
  if (!productId || !posterUrl || posterUrl.startsWith('data:')) return;
  try {
    const current = loadPosterMap();
    current[productId] = posterUrl;
    localStorage.setItem(POSTER_MAP_STORAGE_KEY, JSON.stringify(current));
  } catch {}
}

const INITIAL_ARTISAN_PROFILE: ArtisanProfile = {
  makerName: '',
  studioName: '',
  businessType: '',
  craftSpecialty: '',
  location: '',
  bio: '',
  targetCustomers: '',
  brandPersonality: 'Warm & Handmade',
  preferredAesthetic: 'Warm & Handmade',
  brandColors: '',
  instagramHandle: '',
  socialMediaHandle: '',
  websiteUrl: '',
  defaultHourlyRate: 180,
  defaultOverheadRate: 50,
  standardMarginPercent: 30,
};

const INITIAL_PRODUCT: ProductInput = {
  id: '',
  name: '',
  ownerName: '',
  productDetails: '',
  features: '',
  targetAudience: '',
  category: 'Handmade Crochet',
  currentPrice: null,
  cost: null,
  materials: '',
  story: '',
  craftTechnique: '',
  photoUrl: '',
  caption: '',
  productDescription: '',
  productIdea: '',
  costDetails: {
    materialsCost: 0,
    laborHours: 0,
    hourlyRate: 180,
    overheadCost: 0,
    targetMarginPercent: 30,
  },
};

export default function App() {
  const [currentTab, setCurrentTab] = useState<NavTab>('create');
  const [createViewMode, setCreateViewMode] = useState<'profile' | 'product' | 'studio' | 'generating'>('product');
  const [product, setProduct] = useState<ProductInput>(() => ({
    ...INITIAL_PRODUCT,
  }));
  const [marketingContent, setMarketingContent] = useState<MarketingContent | null>(null);
  const [tone, setTone] = useState<CaptionTone>('friendly');
  const [customInstructions, setCustomInstructions] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationStage, setGenerationStage] = useState<string>('Analyzing your product photo & crafting promotional materials...');
  const generationInFlightRef = useRef(false);
  const [geminiConfigured, setGeminiConfigured] = useState(false);
  const [isSdgModalOpen, setIsSdgModalOpen] = useState(false);
  const [isPrivacyModalOpen, setIsPrivacyModalOpen] = useState(false);
  const [generationTipIndex, setGenerationTipIndex] = useState(0);

  // Track IDs that belong to existing public.products records so we preserve and protect them
  const [supabaseLoadedIds, setSupabaseLoadedIds] = useState<Set<string>>(new Set());
  const [syncToast, setSyncToast] = useState<{ message: string; type: 'success' | 'info' | 'warning' | 'error' } | null>(null);

  // Saved AI Posters retrieved permanently from Supabase ("generated_posters")
  const [savedPosters, setSavedPosters] = useState<GeneratedPosterRecord[]>([]);
  const [isLoadingSavedPosters, setIsLoadingSavedPosters] = useState<boolean>(true);
  const [savedPostersError, setSavedPostersError] = useState<string | null>(null);
  const [savedPostersSetupRequired, setSavedPostersSetupRequired] = useState<boolean>(false);

  useEffect(() => {
    if (syncToast) {
      const timer = setTimeout(() => setSyncToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [syncToast]);

  // Load artisan profile from local storage
  const [artisanProfile, setArtisanProfile] = useState<ArtisanProfile>(() => {
    try {
      const saved = localStorage.getItem('craftcopy_artisan_profile');
      if (saved) return { ...INITIAL_ARTISAN_PROFILE, ...JSON.parse(saved) };
    } catch (e) {
      console.warn('Could not parse artisan profile:', e);
    }
    return INITIAL_ARTISAN_PROFILE;
  });

  // Load saved crafts from local storage
  const [savedCrafts, setSavedCrafts] = useState<SavedCraft[]>(() => {
    try {
      const saved = localStorage.getItem('craftcopy_saved_crafts');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return deduplicateCrafts(parsed);
        }
      }
    } catch (e) {
      console.warn('Could not parse saved crafts:', e);
    }
    return [];
  });

  useEffect(() => {
    try {
      localStorage.setItem('craftcopy_artisan_profile', JSON.stringify(artisanProfile));
    } catch (e) {
      console.warn('Failed to persist artisan profile:', e);
    }
  }, [artisanProfile]);

  useEffect(() => {
    try {
      localStorage.setItem('craftcopy_saved_crafts', JSON.stringify(savedCrafts));
    } catch (e) {
      console.warn('Failed to persist crafts:', e);
    }
  }, [savedCrafts]);

  const handleTabChange = (tab: NavTab) => {
    if (tab === 'create' && createViewMode === 'profile') {
      setCreateViewMode('product');
    }
    setCurrentTab(tab);
  };

  // Handle saving artisan profile
  const handleSaveProfile = (updatedProfile: ArtisanProfile, applyToProduct = false) => {
    const previousMaker = (artisanProfile.makerName || '').trim();
    const nextMaker = (updatedProfile.makerName || '').trim();
    setArtisanProfile(updatedProfile);
    if (applyToProduct) {
      setProduct((prev) => ({
        ...prev,
        ownerName:
          nextMaker ||
          ((prev.ownerName || '').trim() === previousMaker ? '' : prev.ownerName),
        costDetails: {
          ...prev.costDetails,
          hourlyRate: updatedProfile.defaultHourlyRate || prev.costDetails.hourlyRate,
          overheadCost: updatedProfile.defaultOverheadRate || prev.costDetails.overheadCost,
          targetMarginPercent: updatedProfile.standardMarginPercent || prev.costDetails.targetMarginPercent,
        },
      }));
    }
  };

  // Clear local browser data (Business Profile, local drafts, poster cache) without touching Supabase records
  const handleClearLocalBrowserData = () => {
    try {
      localStorage.removeItem('craftcopy_artisan_profile');
      localStorage.removeItem('craftcopy_saved_crafts');
      localStorage.removeItem('craftcopy_poster_map');
      localStorage.removeItem('craftcopy_saved_poster_sigs');
    } catch {}
    setArtisanProfile(INITIAL_ARTISAN_PROFILE);
    setProduct({ ...INITIAL_PRODUCT });
    setMarketingContent(null);
    setSavedCrafts((prev) => prev.filter((c) => supabaseLoadedIds.has(c.id)));
    setSyncToast({
      type: 'info',
      message: 'Local Business Profile and browser drafts cleared. Saved database records remain safe.',
    });
  };

  // Handle selecting a product idea from ideas catalog
  const handleSelectProductIdea = (idea: ProductIdea) => {
    const makerNote = artisanProfile.makerName || artisanProfile.studioName
      ? `\n\nHandcrafted by ${artisanProfile.makerName || 'our maker'}${artisanProfile.studioName ? ` at ${artisanProfile.studioName}` : ''}.`
      : '';
    const fullStory = `${idea.starterStory}${makerNote}`;

    setProduct({
      ...INITIAL_PRODUCT,
      id: `craft-${Date.now()}`,
      name: idea.name,
      ownerName: artisanProfile.makerName || '',
      category: idea.category,
      currentPrice: idea.suggestedRetail,
      cost: idea.materialsCost,
      materials: idea.materials,
      productDetails: fullStory,
      story: fullStory,
      craftTechnique: idea.craftTechnique,
      photoUrl: idea.photoUrl,
      productDescription: fullStory,
      productIdea: idea.whyItSells,
      costDetails: {
        materialsCost: idea.materialsCost,
        laborHours: idea.estimatedHours,
        hourlyRate: artisanProfile.defaultHourlyRate || 180,
        overheadCost: artisanProfile.defaultOverheadRate || 50,
        targetMarginPercent: idea.profitMarginPercent || 30,
      },
    });

    setMarketingContent(null);
    setGenerationError(null);
    setCreateViewMode('product');
    setCurrentTab('create');
  };

  // Fetch and sync products from Supabase public.products table
  const syncWithSupabase = async (showToast = false) => {
    try {
      const res = await fetchSupabaseProducts();
      if (res.success && res.products.length > 0) {
        const idSet = new Set(res.products.map((p) => p.id));
        setSupabaseLoadedIds(idSet);

        setSavedCrafts((prev) => {
          const cleanPrev = deduplicateCrafts(prev);
          const prevById = new Map<string, SavedCraft>();
          for (const c of cleanPrev) {
            if (c.id) prevById.set(c.id, c);
            if (c.product?.id) prevById.set(c.product.id, c);
          }

          const posterMap = loadPosterMap();
          const syncedFromDb: SavedCraft[] = [];

          for (const rawSp of res.products) {
            const existing = prevById.get(rawSp.id);
            const mappedPoster = rawSp.posterUrl || existing?.posterUrl || existing?.product?.posterUrl || posterMap[rawSp.id] || '';
            const sp: ProductInput = mappedPoster ? { ...rawSp, posterUrl: mappedPoster } : rawSp;
            const sellerPrice = sp.currentPrice && Number(sp.currentPrice) > 0 ? Number(sp.currentPrice) : 0;

            const content: MarketingContent = existing?.content || {
              captions: {
                instagram: {
                  title: `${sp.name} ✨`,
                  body: sp.caption || sp.productDescription || sp.story || `Thoughtfully handcrafted with ${sp.materials || 'artisan care'}. Available in small artisan batches.`,
                  hashtags: ['#Handcrafted', '#ArtisanMade', '#ShopSmall', '#SlowCraft', '#SDG9'],
                },
                facebook: {
                  title: `Handcrafted in our studio: ${sp.name}`,
                  body: sp.caption || sp.story || `Individually crafted with ${sp.materials || 'artisan care'}.`,
                  callToAction: 'Message us to order yours!',
                  hashtags: ['#Handmade', '#ArtisanGoods'],
                },
                tiktok: {
                  hook: `POV: Handcrafting the ${sp.name} 🌿`,
                  audioIdea: 'Cozy workshop ASMR sounds',
                  body: sp.caption || `Making the ${sp.name} from raw materials.`,
                  hashtags: ['#CraftTok', '#SmallBusinessCheck'],
                },
              },
              descriptions: {
                short: sp.productDescription || `${sp.name} handmade with ${sp.materials || 'artisan materials'}.`,
                story: sp.productDescription || sp.story,
                bulletPoints: [
                  `Handmade with ${sp.materials || 'artisan materials'}`,
                  `Technique: ${sp.craftTechnique || 'Handmade'}`,
                  'Small-batch artisan quality',
                ],
                careInstructions: 'Handle with care. Wipe gently with a soft dry cloth.',
              },
              promotional: {
                marketPitch: `Welcome! Here is our handmade ${sp.name}.`,
                limitedDrop: `New studio drop: Limited batch of ${sp.name} available now!`,
                makerStory: sp.story,
              },
              pricing: {
                suggestedRetail: sellerPrice,
                wholesale: 0,
                minBreakeven: 0,
                profitMarginPercent: 0,
                pricingTip: sellerPrice > 0 ? `Selling price: ₱${sellerPrice.toLocaleString()}` : '',
                marketComparison: '',
              },
              generatedAt: new Date().toISOString(),
              isAiGenerated: false,
              aiModelUsed: 'Supabase Cloud Database',
              isSimulated: false,
              userSatisfied: true,
            };

            syncedFromDb.push({
              id: sp.id,
              product: sp,
              posterUrl: mappedPoster || undefined,
              content,
              status: 'approved',
              createdAt: existing?.createdAt || 'Supabase Record',
            });
          }

          const dbIds = new Set(res.products.map((p) => p.id));
          const localOnly = cleanPrev.filter((c) => !dbIds.has(c.id) && !dbIds.has(c.product?.id));
          return deduplicateCrafts([...syncedFromDb, ...localOnly]);
        });

        if (showToast) {
          setSyncToast({
            type: 'success',
            message: `Synchronized with Supabase: ${res.rawCount} products loaded.`,
          });
        }
      } else if (res.isConfigured && showToast && res.error) {
        setSyncToast({
          type: 'error',
          message: `Supabase Error: ${res.error}`,
        });
      }
    } catch (err: any) {
      console.warn('Supabase sync error:', err);
      if (showToast) {
        setSyncToast({
          type: 'error',
          message: `Supabase Error: ${err?.message || 'Sync failed'}`,
        });
      }
    }
  };

  // Retrieve permanently saved posters from Supabase "generated_posters" table
  const syncGeneratedPosters = async (showToast = false) => {
    setIsLoadingSavedPosters(true);
    setSavedPostersError(null);
    setSavedPostersSetupRequired(false);

    try {
      const res = await fetchGeneratedPostersFromSupabase();
      if (res.success) {
        setSavedPosters(res.posters);
        if (showToast) {
          setSyncToast({
            type: 'success',
            message: `Retrieved ${res.posters.length} saved AI poster${res.posters.length === 1 ? '' : 's'} from Supabase.`,
          });
        }
      } else {
        setSavedPostersError(res.error || 'Could not retrieve saved posters from Supabase.');
        setSavedPostersSetupRequired(Boolean(res.setupRequired));
        if (showToast) {
          setSyncToast({
            type: 'error',
            message: res.error || 'Failed to load saved posters from Supabase.',
          });
        }
      }
    } catch (err: any) {
      const msg = err?.message || 'Unexpected error retrieving saved posters.';
      setSavedPostersError(msg);
      if (showToast) {
        setSyncToast({
          type: 'error',
          message: msg,
        });
      }
    } finally {
      setIsLoadingSavedPosters(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    checkServerHealth().then((health) => {
      if (isMounted) {
        setGeminiConfigured(health.geminiConfigured);
      }
    });
    syncWithSupabase(false);
    syncGeneratedPosters(false);
    return () => {
      isMounted = false;
    };
  }, []);

  const generationTips = [
    'Matching poster palette & mood to your uploaded product photo...',
    'Weaving an authentic artisan story & marketing captions...',
    'Writing a clear, ready-to-use product description...',
    'Composing platform captions for Instagram, Facebook, and TikTok...',
    'Aligning living-wage craft value (UN SDG 9)...',
  ];

  useEffect(() => {
    let interval: any;
    if (isGenerating) {
      interval = setInterval(() => {
        setGenerationTipIndex((prev) => (prev + 1) % generationTips.length);
      }, 1600);
    }
    return () => clearInterval(interval);
  }, [isGenerating]);

  // Trigger Generation (Captions + Product Description + Adaptive Promotional Poster PNG)
  const handleProceedToGenerate = async (customTone?: CaptionTone, tweakPrompt?: string) => {
    if (generationInFlightRef.current) return;
    generationInFlightRef.current = true;

    setGenerationError(null);
    setIsGenerating(true);
    setCreateViewMode('generating');
    setGenerationStage('Analyzing your product photo & writing persuasive copy...');

    const effectiveTone = customTone || tone;
    const effectivePrompt = tweakPrompt || customInstructions;
    const targetProductId = product.id || `craft-${Date.now()}`;
    const productForGen: ProductInput = {
      ...product,
      id: targetProductId,
      ownerName: (product.ownerName || artisanProfile.makerName || '').trim(),
    };

    try {
      const res = await generateMarketingContent(
        productForGen,
        effectiveTone,
        effectivePrompt,
        artisanProfile
      );

      setGenerationStage('Composing your adaptive promotional poster with your product photo...');

      const posterDir = res.content.posterDirection;
      const igCap = res.content.captions?.instagram;
      const fbCap = res.content.captions?.facebook;
      const posterRes = await generatePosterImage({
        product: productForGen,
        sellerProfile: artisanProfile,
        aspectRatio: '4:5',
        designVariation: 'artisan',
        aesthetic: 'auto',
        posterCopy: {
          headline: posterDir?.headline || igCap?.title || productForGen.name,
          subheadline: posterDir?.subheadline || res.content.descriptions?.short || '',
          callToAction: posterDir?.callToAction || fbCap?.callToAction || 'Send a DM to Order',
          hashtags: igCap?.hashtags?.join(' ') || '',
          recommendedAesthetic: posterDir?.recommendedAesthetic || 'earthy',
        },
      });

      if (!posterRes.success || !posterRes.posterUrl) {
        throw new Error(
          posterRes.error || 'Poster image could not be generated. Please click Retry.'
        );
      }

      savePosterToMap(targetProductId, posterRes.posterUrl);
      setMarketingContent(res.content);

      const generatedCaption = res.content.captions.instagram
        ? `${res.content.captions.instagram.title ? `${res.content.captions.instagram.title}\n\n` : ''}${res.content.captions.instagram.body}${res.content.captions.instagram.hashtags ? `\n\n${res.content.captions.instagram.hashtags.join(' ')}` : ''}`
        : '';
      const generatedDesc = res.content.descriptions.story || res.content.descriptions.short || '';
      const generatedIdea = res.content.promotional.makerStory || res.content.promotional.marketPitch || '';

      setProduct((prev) => ({
        ...prev,
        id: targetProductId,
        caption: generatedCaption,
        productDescription: generatedDesc,
        productIdea: generatedIdea,
        posterUrl: posterRes.posterUrl,
      }));

      setSavedCrafts((prev) =>
        prev.map((c) =>
          c.id === targetProductId || c.product?.id === targetProductId
            ? {
                ...c,
                posterUrl: posterRes.posterUrl,
                product: { ...c.product, posterUrl: posterRes.posterUrl },
              }
            : c
        )
      );

      setCreateViewMode('studio');
    } catch (err: any) {
      console.error('Failed generation:', err);
      setGenerationError(
        err?.message || 'Poster generation encountered an unexpected error. Please click Retry.'
      );
      setCreateViewMode('generating');
    } finally {
      generationInFlightRef.current = false;
      setIsGenerating(false);
    }
  };

  // Keep studio-regenerated posters synced with Saved state
  const handlePosterGeneratedInStudio = (posterUrl: string, updatedProd: ProductInput) => {
    const pid = updatedProd.id || product.id;
    if (pid) savePosterToMap(pid, posterUrl);
    setProduct((prev) => ({
      ...prev,
      ...updatedProd,
      posterUrl,
    }));
    setSavedCrafts((prev) =>
      prev.map((c) =>
        c.id === pid || c.product?.id === pid
          ? {
              ...c,
              posterUrl,
              product: { ...c.product, ...updatedProd, posterUrl },
            }
          : c
      )
    );
  };

  // Save generated promotional poster, captions, and product description to Saved Outputs & Supabase
  const handleSavePosterToCatalog = async (
    targetProduct: ProductInput,
    posterDataUrl: string,
    captionText: string,
    headlineText: string,
    posterUrl?: string
  ): Promise<{ success: boolean; error?: string; product?: ProductInput }> => {
    try {
      const resolvedPosterUrl = posterUrl || targetProduct.posterUrl || '';
      const resolvedDescription =
        targetProduct.productDescription ||
        marketingContent?.descriptions?.story ||
        marketingContent?.descriptions?.short ||
        targetProduct.productDetails ||
        '';

      const updatedProduct: ProductInput = {
        ...targetProduct,
        id: targetProduct.id || `craft-${Date.now()}`,
        ownerName: (targetProduct.ownerName || artisanProfile.makerName || '').trim(),
        caption: captionText,
        productDescription: resolvedDescription,
        photoUrl: targetProduct.photoUrl || resolvedPosterUrl || posterDataUrl,
        posterUrl: resolvedPosterUrl || targetProduct.posterUrl,
      };

      const isExistingSupabaseRow =
        Boolean(updatedProduct.id) &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(updatedProduct.id);

      let finalProduct = updatedProduct;
      if (isExistingSupabaseRow) {
        const upRes = await updateProductInSupabase(updatedProduct);
        if (upRes.success && upRes.product) {
          finalProduct = {
            ...upRes.product,
            posterUrl: resolvedPosterUrl || updatedProduct.posterUrl,
            productDescription: upRes.product.productDescription || resolvedDescription,
          };
        }
      } else {
        const res = await insertProductToSupabase(updatedProduct);
        if (res.success && res.product) {
          finalProduct = {
            ...res.product,
            posterUrl: resolvedPosterUrl || updatedProduct.posterUrl,
            productDescription: res.product.productDescription || resolvedDescription,
          };
          setSupabaseLoadedIds((prev) => new Set([...prev, finalProduct.id]));
        }
      }

      const approvedMarketingContent: MarketingContent = marketingContent
        ? {
            ...marketingContent,
            userSatisfied: true,
            captions: {
              ...marketingContent.captions,
              instagram: {
                ...marketingContent.captions.instagram,
                title: headlineText || marketingContent.captions.instagram.title,
                body: captionText,
              },
            },
            descriptions: {
              ...marketingContent.descriptions,
              story: resolvedDescription || marketingContent.descriptions.story,
            },
          }
        : {
            captions: {
              instagram: {
                title: headlineText,
                body: captionText,
                hashtags: ['#Handmade', '#ArtisanMade', '#SlowCraft', '#ShopSmall'],
              },
              facebook: {
                title: headlineText,
                body: captionText,
                callToAction: 'Send a message to order!',
                hashtags: ['#Handmade', '#SupportMakers'],
              },
              tiktok: {
                hook: `${headlineText} 🌿`,
                audioIdea: 'Workshop ASMR',
                body: captionText,
                hashtags: ['#CraftTok', '#ArtisanPiece'],
              },
            },
            descriptions: {
              short: `${finalProduct.name} - Handcrafted quality.`,
              story: resolvedDescription || captionText,
              bulletPoints: [
                `Product: ${finalProduct.name}`,
                ...(finalProduct.materials ? [`Materials: ${finalProduct.materials}`] : []),
              ],
              careInstructions: 'Handle with mindful care.',
            },
            promotional: {
              marketPitch: headlineText,
              limitedDrop: `New release: ${finalProduct.name}`,
              makerStory: finalProduct.story || '',
            },
            pricing: (() => {
              const sellerPrice =
                finalProduct.currentPrice && Number(finalProduct.currentPrice) > 0
                  ? Number(finalProduct.currentPrice)
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
            generatedAt: new Date().toISOString(),
            isAiGenerated: true,
            aiModelUsed: 'CraftCopy AI Poster Studio',
            isSimulated: false,
            userSatisfied: true,
          };

      setMarketingContent(approvedMarketingContent);

      const savedPoster = resolvedPosterUrl || finalProduct.posterUrl || '';
      if (savedPoster && finalProduct.id) {
        savePosterToMap(finalProduct.id, savedPoster);
      }

      const newCraft: SavedCraft = {
        id: finalProduct.id,
        product: { ...finalProduct, posterUrl: savedPoster || undefined },
        posterUrl: savedPoster || undefined,
        content: approvedMarketingContent,
        status: 'approved',
        createdAt: new Date().toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
      };

      setSavedCrafts((prev) => {
        const filtered = prev.filter(
          (c) =>
            c.id !== finalProduct.id &&
            c.product?.id !== finalProduct.id &&
            c.id !== newCraft.id &&
            c.product?.id !== newCraft.id
        );
        return [newCraft, ...filtered];
      });
      setProduct({ ...finalProduct, posterUrl: savedPoster || undefined });

      setSyncToast({
        type: 'success',
        message: 'Promotional poster, captions & description saved!',
      });

      return { success: true, product: finalProduct };
    } catch (err: any) {
      console.error('Error saving poster to catalog:', err);
      setSyncToast({
        type: 'error',
        message: `Failed to save output: ${err?.message || 'Error'}`,
      });
      return { success: false, error: err?.message };
    }
  };

  // Start fresh product
  const handleStartNewProduct = () => {
    setProduct({
      ...INITIAL_PRODUCT,
      ownerName: artisanProfile.makerName || '',
      id: `craft-${Date.now()}`,
      costDetails: {
        materialsCost: 0,
        laborHours: 0,
        hourlyRate: artisanProfile.defaultHourlyRate || 180,
        overheadCost: artisanProfile.defaultOverheadRate || 50,
        targetMarginPercent: artisanProfile.standardMarginPercent || 30,
      },
    });
    setMarketingContent(null);
    setGenerationError(null);
    setCreateViewMode('product');
    setCurrentTab('create');
  };

  // Direct save product with photo to Saved Outputs and Supabase public.products
  const handleDirectSaveProduct = async (
    prodToSave: ProductInput
  ): Promise<{ success: boolean; error?: string; product?: ProductInput }> => {
    try {
      const isExistingUuid =
        Boolean(prodToSave.id) &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(prodToSave.id);

      const res = isExistingUuid
        ? await updateProductInSupabase(prodToSave)
        : await insertProductToSupabase(prodToSave);

      if (res.success && res.product) {
        const finalProd = res.product;
        setSupabaseLoadedIds((prev) => new Set([...prev, finalProd.id]));
        setSyncToast({
          type: 'success',
          message: isExistingUuid
            ? 'Product updated in Supabase (public.products)!'
            : 'Product saved to Supabase (public.products)!',
        });

        const sellerPrice =
          finalProd.currentPrice && Number(finalProd.currentPrice) > 0
            ? Number(finalProd.currentPrice)
            : 0;

        const initialContent: MarketingContent = marketingContent || {
          captions: {
            instagram: {
              title: `${finalProd.name} ✨`,
              body: finalProd.caption || finalProd.story || `Thoughtfully handcrafted with ${finalProd.materials || 'artisan care'}.`,
              hashtags: ['#Handcrafted', '#ArtisanMade', '#ShopSmall', '#SlowCraft', '#SDG9'],
            },
            facebook: {
              title: `From our studio: ${finalProd.name}`,
              body: finalProd.story || `Every piece is individually handcrafted using ${finalProd.craftTechnique || 'traditional craft methods'}.`,
              callToAction: 'Send us a message to reserve yours!',
              hashtags: ['#Handmade', '#ArtisanGoods'],
            },
            tiktok: {
              hook: `POV: Handcrafting the ${finalProd.name} 🌿`,
              audioIdea: 'Cozy workshop ASMR sounds',
              body: `Behind the scenes making of the ${finalProd.name}.`,
              hashtags: ['#CraftTok', '#SmallBusinessCheck'],
            },
          },
          descriptions: {
            short: `${finalProd.name} handmade with ${finalProd.materials || 'artisan materials'}.`,
            story: finalProd.productDescription || finalProd.story || '',
            bulletPoints: [
              `Materials: ${finalProd.materials || 'Artisan supplies'}`,
              `Technique: ${finalProd.craftTechnique || 'Handmade craftsmanship'}`,
              'Small-batch artisan quality',
            ],
            careInstructions: 'Handle with care. Wipe gently with a soft dry cloth.',
          },
          promotional: {
            marketPitch: `Welcome! This is our ${finalProd.name}.`,
            limitedDrop: `New studio drop: Limited batch of ${finalProd.name} available now!`,
            makerStory: finalProd.story || '',
          },
          pricing: {
            suggestedRetail: sellerPrice,
            wholesale: 0,
            minBreakeven: 0,
            profitMarginPercent: 0,
            pricingTip: sellerPrice > 0 ? `Selling price: ₱${sellerPrice.toLocaleString()}` : '',
            marketComparison: '',
          },
          generatedAt: new Date().toISOString(),
          isAiGenerated: false,
          aiModelUsed: 'Supabase Cloud Database',
          isSimulated: false,
          userSatisfied: true,
        };

        const newCraft: SavedCraft = {
          id: finalProd.id,
          product: { ...finalProd },
          posterUrl: finalProd.posterUrl,
          content: initialContent,
          status: 'approved',
          createdAt: new Date().toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          }),
        };

        setSavedCrafts((prev) => {
          const filtered = prev.filter(
            (c) =>
              c.product?.id !== finalProd.id &&
              c.id !== finalProd.id &&
              c.id !== newCraft.id &&
              c.product?.id !== newCraft.id
          );
          return [newCraft, ...filtered];
        });

        setProduct(finalProd);
        return { success: true, product: finalProd };
      } else {
        const errMsg = res.error || 'Failed to save product to Supabase public.products.';
        setSyncToast({
          type: 'error',
          message: `Supabase Error: ${errMsg}`,
        });
        return { success: false, error: errMsg };
      }
    } catch (err: any) {
      const errMsg = err?.message || 'Unexpected error saving to Supabase';
      setSyncToast({
        type: 'error',
        message: `Supabase Error: ${errMsg}`,
      });
      return { success: false, error: errMsg };
    }
  };

  // Open saved craft from catalog into the Create Poster Studio
  const handleSelectSavedCraft = (craft: SavedCraft) => {
    const posterMap = loadPosterMap();
    const resolvedPoster =
      craft.product.posterUrl || craft.posterUrl || posterMap[craft.product.id] || undefined;
    setProduct({
      ...craft.product,
      posterUrl: resolvedPoster,
    });
    setMarketingContent(craft.content);
    setGenerationError(null);
    setCreateViewMode('studio');
    setCurrentTab('create');
  };

  // Add newly saved poster to state immediately & keep deduplicated
  const handlePosterSavedToSupabase = (poster: GeneratedPosterRecord) => {
    setSavedPosters((prev) => {
      const filtered = prev.filter(
        (p) => p.id !== poster.id && p.poster_image_url !== poster.poster_image_url
      );
      return [poster, ...filtered];
    });
    setSavedPostersError(null);
    setSavedPostersSetupRequired(false);
    setSyncToast({
      type: 'success',
      message: 'Poster uploaded to Supabase Storage & saved to AI Posters!',
    });
  };

  // Open a saved Supabase poster in the Studio
  const handleOpenSavedPoster = (poster: GeneratedPosterRecord) => {
    const matchedCraft = savedCrafts.find(
      (c) =>
        c.product?.name?.trim().toLowerCase() ===
        poster.product_name.trim().toLowerCase()
    );
    if (matchedCraft) {
      setProduct({
        ...matchedCraft.product,
        name: poster.product_name || matchedCraft.product.name,
        ownerName: poster.seller_name || matchedCraft.product.ownerName,
        caption: poster.caption || matchedCraft.product.caption,
        posterUrl: poster.poster_image_url,
      });
      setMarketingContent(matchedCraft.content);
    } else {
      setProduct({
        ...INITIAL_PRODUCT,
        id: `poster-${poster.id}`,
        name: poster.product_name || 'Saved Craft Poster',
        ownerName: poster.seller_name || '',
        caption: poster.caption || '',
        posterUrl: poster.poster_image_url,
      });
      setMarketingContent(null);
    }
    setGenerationError(null);
    setCreateViewMode('studio');
    setCurrentTab('create');
  };

  // Edit saved craft back into the Product Details Form
  const handleEditSavedCraftInForm = (craft: SavedCraft) => {
    setProduct({ ...craft.product });
    setMarketingContent(craft.content);
    setGenerationError(null);
    setCreateViewMode('product');
    setCurrentTab('create');
  };

  // Delete saved craft (protected for existing Supabase records)
  const handleDeleteCraft = (id: string) => {
    if (supabaseLoadedIds.has(id)) {
      setSyncToast({
        type: 'warning',
        message: 'Database Protection: Existing Supabase project records cannot be deleted.',
      });
      return;
    }
    setSavedCrafts((prev) => prev.filter((c) => c.id !== id && c.product?.id !== id));
  };

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#423023] flex flex-col font-sans selection:bg-[#E2D5C3]">
      {/* Header */}
      <Header
        currentTab={currentTab}
        setCurrentTab={handleTabChange}
        savedCount={savedCrafts.length}
        onOpenSdg={() => setIsSdgModalOpen(true)}
        onOpenSellerInfo={() => {
          setCurrentTab('create');
          setCreateViewMode('profile');
        }}
        makerName={artisanProfile.studioName || artisanProfile.makerName}
      />

      {/* Main Content Area */}
      <main className="flex-1">
        {currentTab === 'create' && (
          <div>
            {/* Business Profile */}
            {createViewMode === 'profile' && (
              <SellerInfoForm
                profile={artisanProfile}
                onSaveProfile={(p) => handleSaveProfile(p, true)}
                onContinue={(updatedProfile) => {
                  handleSaveProfile(updatedProfile, true);
                  setCreateViewMode('product');
                }}
                onSkip={() => setCreateViewMode('product')}
                onOpenPrivacyNotice={() => setIsPrivacyModalOpen(true)}
              />
            )}

            {/* Product Information Form */}
            {createViewMode === 'product' && (
              <ProductForm
                product={product}
                setProduct={setProduct}
                tone={tone}
                setTone={setTone}
                customInstructions={customInstructions}
                setCustomInstructions={setCustomInstructions}
                onProceedToGenerate={() => handleProceedToGenerate()}
                isGenerating={isGenerating}
                artisanProfile={artisanProfile}
                onOpenProductIdeas={() => setCurrentTab('ideas')}
                onBackToSellerInfo={() => setCreateViewMode('profile')}
                onSaveProduct={handleDirectSaveProduct}
                onOpenPrivacyNotice={() => setIsPrivacyModalOpen(true)}
              />
            )}

            {/* AI Poster & Caption Generation Loading / Error State */}
            {createViewMode === 'generating' && (
              <div className="max-w-xl mx-auto px-4 py-14 text-center space-y-6">
                {generationError ? (
                  <div className="p-6 sm:p-8 rounded-3xl bg-white border border-red-200 shadow-sm space-y-5 text-left">
                    <div className="flex items-start gap-3">
                      <div className="w-11 h-11 rounded-2xl bg-red-100 text-red-700 flex items-center justify-center shrink-0">
                        <AlertCircle className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="text-lg sm:text-xl font-bold font-artisan text-[#423023]">
                          Poster Generation Could Not Complete
                        </h3>
                        <p className="text-xs sm:text-sm text-red-700 mt-1 leading-relaxed">
                          {generationError}
                        </p>
                      </div>
                    </div>

                    <p className="text-xs text-[#6B5544] bg-[#FAF7F2] border border-[#E8DFD1] rounded-2xl p-3">
                      Your Business Profile, Product Info, and uploaded photo are safely preserved. You can retry immediately without restarting.
                    </p>

                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      <button
                        type="button"
                        id="btn-retry-poster-generation"
                        onClick={() => handleProceedToGenerate()}
                        disabled={isGenerating}
                        className="px-5 py-2.5 rounded-xl bg-[#4E654E] hover:bg-[#3E523E] text-white text-xs sm:text-sm font-bold flex items-center gap-2 shadow-sm transition-all disabled:opacity-60"
                      >
                        <RefreshCw className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
                        <span>Retry Poster Generation</span>
                      </button>
                      <button
                        type="button"
                        id="btn-back-to-product-on-error"
                        onClick={() => {
                          setGenerationError(null);
                          setCreateViewMode('product');
                        }}
                        className="px-4 py-2.5 rounded-xl bg-[#FAF7F2] hover:bg-[#EFE7DA] border border-[#D5C7B6] text-[#553E2E] text-xs font-semibold transition-all"
                      >
                        &larr; Edit Product Info
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="w-16 h-16 rounded-full bg-[#E7EFE6] text-[#4E654E] mx-auto flex items-center justify-center animate-bounce shadow-sm">
                      <Hammer className="w-8 h-8" />
                    </div>
                    <div>
                      <h3 className="text-xl sm:text-2xl font-bold font-artisan text-[#423023]">
                        Creating Your Promotional Poster &amp; Captions...
                      </h3>
                      <p className="text-xs sm:text-sm text-[#735F4C] mt-1">
                        {generationStage}
                      </p>
                    </div>

                    <div className="p-4 rounded-2xl bg-white border border-[#D5C7B6] max-w-md mx-auto shadow-xs">
                      <div className="flex items-center justify-center gap-2 text-xs font-semibold text-[#4E654E]">
                        <Sparkles className="w-4 h-4 animate-spin text-[#C59B3C]" />
                        <span>{generationTips[generationTipIndex]}</span>
                      </div>
                      <div className="mt-3 h-1.5 rounded-full bg-[#EFE7DA] overflow-hidden">
                        <div className="h-full bg-[#4E654E] animate-pulse w-3/4 rounded-full" />
                      </div>
                    </div>

                    {geminiConfigured && (
                      <p className="text-[11px] text-[#8E7C6B]">
                        Powered by Google Gemini AI &amp; Adaptive Poster Engine
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Promotional Studio (Poster + Captions + Product Description) */}
            {createViewMode === 'studio' && (
              <AdaptivePosterStudio
                currentProduct={product}
                marketingContent={marketingContent}
                savedCrafts={savedCrafts}
                savedPosters={savedPosters}
                isLoadingSavedPosters={isLoadingSavedPosters}
                savedPostersError={savedPostersError}
                savedPostersSetupRequired={savedPostersSetupRequired}
                onRefreshSavedPosters={() => syncGeneratedPosters(true)}
                onPosterSavedToSupabase={handlePosterSavedToSupabase}
                artisanProfile={artisanProfile}
                onSelectProduct={(newProd) => setProduct(newProd)}
                onPosterGenerated={handlePosterGeneratedInStudio}
                onSaveToCatalog={handleSavePosterToCatalog}
                onNavigateToTab={handleTabChange}
                onBackToProductInfo={() => setCreateViewMode('product')}
                onStartNewProduct={handleStartNewProduct}
                onUpdateArtisanProfile={(updated) => handleSaveProfile(updated, true)}
                onOpenSellerInfo={() => {
                  setCurrentTab('create');
                  setCreateViewMode('profile');
                }}
              />
            )}
          </div>
        )}

        {/* Tab: Product Ideas & AI Brainstormer */}
        {currentTab === 'ideas' && (
          <ProductIdeasView
            onSelectIdea={handleSelectProductIdea}
            artisanProfile={artisanProfile}
          />
        )}

        {/* Tab: Saved Outputs Catalog */}
        {currentTab === 'catalog' && (
          <CatalogView
            savedCrafts={savedCrafts}
            onSelectCraft={handleSelectSavedCraft}
            onDeleteCraft={handleDeleteCraft}
            onNewProduct={handleStartNewProduct}
            onBrowseIdeas={() => setCurrentTab('ideas')}
            onEditCraftInForm={handleEditSavedCraftInForm}
            supabaseLoadedIds={supabaseLoadedIds}
            onSyncSupabase={() => syncWithSupabase(true)}
            savedPosters={savedPosters}
            isLoadingSavedPosters={isLoadingSavedPosters}
            savedPostersError={savedPostersError}
            savedPostersSetupRequired={savedPostersSetupRequired}
            onRefreshSavedPosters={() => syncGeneratedPosters(true)}
            onOpenSavedPoster={handleOpenSavedPoster}
          />
        )}
      </main>

      {/* Supabase & Save Notification Toast */}
      {syncToast && (
        <div
          className="fixed bottom-5 right-5 z-50 max-w-sm sm:max-w-md shadow-xl rounded-2xl p-4 border flex items-start gap-3 bg-white text-[#423023] border-[#E8DFD1]"
          role="alert"
        >
          {syncToast.type === 'success' && (
            <div className="w-8 h-8 rounded-full bg-[#E2EBE2] text-[#2F442F] flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5 text-[#3E523E]" />
            </div>
          )}
          {syncToast.type === 'error' && (
            <div className="w-8 h-8 rounded-full bg-red-100 text-red-700 flex items-center justify-center shrink-0">
              <AlertCircle className="w-5 h-5 text-red-600" />
            </div>
          )}
          {syncToast.type === 'info' && (
            <div className="w-8 h-8 rounded-full bg-[#EAE2D3] text-[#6E5038] flex items-center justify-center shrink-0">
              <Database className="w-4 h-4 text-[#4E654E]" />
            </div>
          )}
          {syncToast.type === 'warning' && (
            <div className="w-8 h-8 rounded-full bg-[#FFF3D6] text-[#7A5A1B] flex items-center justify-center shrink-0">
              <AlertCircle className="w-5 h-5 text-[#C59B3C]" />
            </div>
          )}
          <div className="flex-1 pr-1 text-xs">
            <p className="font-bold text-[#423023]">
              {syncToast.type === 'success'
                ? 'Saved Successfully'
                : syncToast.type === 'error'
                ? 'Sync Error'
                : syncToast.type === 'warning'
                ? 'Record Protected'
                : 'Notice'}
            </p>
            <p className="text-[#6A5847] mt-0.5">{syncToast.message}</p>
          </div>
          <button
            onClick={() => setSyncToast(null)}
            className="text-[#998777] hover:text-[#423023] p-1 rounded-lg hover:bg-[#F3ECE0]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Cozy Footer */}
      <footer className="border-t border-[#E8DFD1] bg-[#F4EFE6] py-6 px-4 text-xs text-[#7A6755] mt-auto">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-artisan font-bold text-[#423023]">CraftCopy</span>
            <span>•</span>
            <span>Promotional Posters &amp; Marketing Copy for Independent Makers</span>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              id="btn-footer-privacy-notice"
              onClick={() => setIsPrivacyModalOpen(true)}
              className="text-[#4E654E] hover:underline font-semibold flex items-center gap-1"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Privacy Notice</span>
            </button>
            <button
              type="button"
              onClick={() => setIsSdgModalOpen(true)}
              className="text-[#4E654E] hover:underline font-semibold"
            >
              Supporting UN SDG 9
            </button>
          </div>
        </div>
      </footer>

      {/* UN SDG 9 Informational Modal */}
      <SdgInfoModal
        isOpen={isSdgModalOpen}
        onClose={() => setIsSdgModalOpen(false)}
      />

      {/* Privacy & Data Protection Modal */}
      <PrivacyNoticeModal
        isOpen={isPrivacyModalOpen}
        onClose={() => setIsPrivacyModalOpen(false)}
        onClearLocalData={handleClearLocalBrowserData}
      />
    </div>
  );
}
