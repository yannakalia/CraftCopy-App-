export interface CostDetails {
  materialsCost: number;
  laborHours: number;
  hourlyRate: number;
  overheadCost: number;
  targetMarginPercent: number;
}

export interface ArtisanProfile {
  makerName: string; // Owner's Name
  studioName: string; // Seller/Business Name
  businessType?: string; // Business Type (e.g. Handmade Crochet, Leather, Pottery, etc.)
  craftSpecialty: string; // Legacy alias for businessType
  bio: string; // Short Business Description
  targetCustomers?: string; // Target Customers
  brandPersonality?: string; // Brand Personality or Preferred Aesthetic
  preferredAesthetic?: string; // e.g. Warm & Handmade, Minimalist, Earthy, etc.
  location: string; // Business Location
  brandColors?: string; // Preferred Brand Colors
  instagramHandle: string; // Social Media Username (reference only)
  socialMediaHandle?: string; // Alias for socialMediaHandle
  websiteUrl: string;
  defaultHourlyRate: number;
  defaultOverheadRate: number;
  standardMarginPercent: number;
}

export interface ProductIdea {
  id: string;
  name: string;
  category: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Master Artisan';
  estimatedHours: number;
  materialsCost: number;
  suggestedRetail: number;
  profitMarginPercent: number;
  materials: string;
  craftTechnique: string;
  starterStory: string;
  photoUrl: string;
  whyItSells: string;
  marketDemand: 'Bestseller' | 'High Demand' | 'Trending' | 'Steady';
  bestSeason: string;
  tags: string[];
}

export type PromotionalObjective = 
  | 'product_launch'
  | 'new_arrival'
  | 'seasonal_promotion'
  | 'sale_discount'
  | 'brand_awareness';

export type CaptionTone = 
  | 'friendly'
  | 'professional'
  | 'persuasive'
  | 'elegant'
  | 'playful'
  | 'storytelling';

export type AspectRatioFormat = '4:5' | '1:1' | '9:16' | '16:9';

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

export interface CustomPosterColors {
  backgroundHex?: string;
  backgroundSecondaryHex?: string;
  accentHex?: string;
  textPrimaryHex?: string;
  textSecondaryHex?: string;
}

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

export interface ProductInput {
  id: string;
  name: string;
  ownerName?: string;
  productDetails?: string;
  targetAudience?: string;
  promotionalObjective?: PromotionalObjective;
  category: string;
  currentPrice: number | null;
  cost?: number | null;
  materials: string;
  story: string;
  craftTechnique: string;
  photoUrl: string;
  posterUrl?: string; // Rendered promotional poster URL
  features?: string; // Product Features or Unique Selling Points
  caption?: string;
  productDescription?: string;
  productIdea?: string;
  costDetails: CostDetails;
}

export interface PlatformCaption {
  title?: string;
  body: string;
  hashtags: string[];
  callToAction?: string;
  hook?: string;
  audioIdea?: string;
}

export interface PosterDirection {
  headline: string;
  subheadline: string;
  callToAction: string;
  recommendedAesthetic: PosterAesthetic;
  visualNotes?: string;
}

export interface MarketingContent {
  captions: {
    instagram: PlatformCaption;
    facebook: PlatformCaption;
    tiktok: PlatformCaption;
  };
  descriptions: {
    short: string;
    story: string;
    bulletPoints: string[];
    careInstructions: string;
  };
  promotional: {
    marketPitch: string;
    limitedDrop: string;
    makerStory: string;
  };
  pricing: {
    suggestedRetail: number;
    wholesale: number;
    minBreakeven: number;
    profitMarginPercent: number;
    pricingTip: string;
    marketComparison: string;
  };
  posterDirection?: PosterDirection;
  generatedAt: string;
  isAiGenerated: boolean;
  aiModelUsed: string;
  isSimulated: boolean;
  userSatisfied: boolean;
}

export interface SavedCraft {
  id: string;
  product: ProductInput;
  content: MarketingContent;
  posterUrl?: string;
  status: 'draft' | 'approved';
  createdAt: string;
}

export interface GeneratedPosterRecord {
  id: string;
  seller_name: string;
  business_name: string;
  product_name: string;
  poster_image_url: string;
  caption: string;
  created_at: string;
}


