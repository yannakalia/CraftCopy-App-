import React, { useState, useRef, useEffect } from 'react';
import {
  Upload,
  Wand2,
  Check,
  Store,
  Lightbulb,
  RefreshCw,
  Trash2,
  Maximize2,
  Loader2,
  CheckCircle2,
  Database,
  ChevronDown,
  X,
  ShieldCheck,
} from 'lucide-react';
import { ProductInput, ArtisanProfile, CaptionTone } from '../types';
import { CRAFT_CATEGORIES } from '../data/sampleProducts';
import { optimizeImageFile, formatBytes } from '../utils/imageOptimizer';

interface ProductFormProps {
  product: ProductInput;
  setProduct: React.Dispatch<React.SetStateAction<ProductInput>>;
  tone: any;
  setTone: (tone: any) => void;
  customInstructions: string;
  setCustomInstructions: (notes: string) => void;
  onProceedToGenerate: () => void;
  isGenerating: boolean;
  artisanProfile: ArtisanProfile;
  onOpenProductIdeas: () => void;
  onBackToSellerInfo: () => void;
  onSaveProduct?: (product: ProductInput) => Promise<{ success: boolean; error?: string; product?: ProductInput }> | void;
  onOpenPrivacyNotice?: () => void;
}

const CAPTION_TONES: { id: CaptionTone; label: string }[] = [
  { id: 'friendly', label: 'Friendly & Warm' },
  { id: 'professional', label: 'Clean & Informative' },
  { id: 'persuasive', label: 'Persuasive' },
  { id: 'elegant', label: 'Elegant & Luxury' },
  { id: 'playful', label: 'Playful' },
  { id: 'storytelling', label: 'Storytelling' },
];

export const ProductForm: React.FC<ProductFormProps> = ({
  product,
  setProduct,
  tone,
  setTone,
  customInstructions,
  setCustomInstructions,
  onProceedToGenerate,
  isGenerating,
  artisanProfile,
  onOpenProductIdeas,
  onBackToSellerInfo,
  onSaveProduct,
  onOpenPrivacyNotice,
}) => {
  const [showOptionalTools, setShowOptionalTools] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [isOptimizingPhoto, setIsOptimizingPhoto] = useState(false);
  const [photoMeta, setPhotoMeta] = useState<{ fileName: string; fileSize: string } | null>(null);
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPhotoMeta(null);
    setSaveErrorMessage(null);
    setSaveSuccessMessage(null);
  }, [product.id]);

  useEffect(() => {
    if (!product.photoUrl) {
      setPhotoMeta(null);
    }
  }, [product.photoUrl]);

  const handleInputChange = (field: keyof ProductInput, value: any) => {
    setProduct((prev) => ({ ...prev, [field]: value }));
  };

  const processAndSetImage = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setSaveErrorMessage('Please choose a valid image file (JPG, PNG, WebP).');
      return;
    }

    try {
      setIsOptimizingPhoto(true);
      setSaveErrorMessage(null);
      const result = await optimizeImageFile(file, 1200, 0.85);

      try {
        const uploadRes = await fetch('/api/upload-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image: result.dataUrl,
            fileName: file.name,
          }),
        });
        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          if (uploadData.success && uploadData.url) {
            handleInputChange('photoUrl', uploadData.url);
            setPhotoMeta({
              fileName: uploadData.fileName || file.name,
              fileSize: formatBytes(result.optimizedSizeBytes),
            });
            return;
          }
        }
      } catch (uploadErr) {
        console.warn('Could not upload to /api/upload-photo, using dataUrl fallback:', uploadErr);
      }

      handleInputChange('photoUrl', result.dataUrl);
      setPhotoMeta({
        fileName: result.fileName,
        fileSize: formatBytes(result.optimizedSizeBytes),
      });
    } catch (err: any) {
      console.error('Error processing photo:', err);
      const reader = new FileReader();
      reader.onload = (e) => {
        const res = e.target?.result as string;
        handleInputChange('photoUrl', res);
        setPhotoMeta({
          fileName: file.name,
          fileSize: formatBytes(file.size),
        });
      };
      reader.readAsDataURL(file);
    } finally {
      setIsOptimizingPhoto(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processAndSetImage(e.dataTransfer.files[0]);
    }
  };

  const handleRemovePhoto = () => {
    handleInputChange('photoUrl', '');
    setPhotoMeta(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDirectSave = async () => {
    if (!product.name.trim() || isSaving) return;
    setIsSaving(true);
    setSaveSuccessMessage(null);
    setSaveErrorMessage(null);

    const currentFormValues: ProductInput = {
      ...product,
      name: product.name.trim(),
      ownerName: (product.ownerName || artisanProfile.makerName || '').trim(),
      productDetails: (product.productDetails || product.story || '').trim(),
      story: (product.productDetails || product.story || '').trim(),
      cost:
        product.cost !== null && product.cost !== undefined && String(product.cost).trim() !== ''
          ? Number(product.cost)
          : product.costDetails?.materialsCost
          ? Number(product.costDetails.materialsCost)
          : null,
      currentPrice:
        product.currentPrice !== null && product.currentPrice !== undefined && String(product.currentPrice).trim() !== ''
          ? Number(product.currentPrice)
          : null,
      photoUrl: (product.photoUrl || '').trim(),
    };

    try {
      if (onSaveProduct) {
        const res = await onSaveProduct(currentFormValues);
        if (res && res.success) {
          setSaveSuccessMessage('Saved to Supabase (public.products)!');
          setTimeout(() => setSaveSuccessMessage(null), 4000);
        } else {
          setSaveErrorMessage(res?.error || 'Failed to save product to Supabase.');
        }
      }
    } catch (err: any) {
      setSaveErrorMessage(err?.message || 'Unexpected error saving product.');
    } finally {
      setIsSaving(false);
    }
  };

  const isValid =
    product.name.trim().length > 0 &&
    Boolean(
      (product.productDetails && product.productDetails.trim().length > 0) ||
      (product.story && product.story.trim().length > 0) ||
      (product.materials && product.materials.trim().length > 0)
    );

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-6 animate-in fade-in duration-300">
      {/* Saved Business Context Bar */}
      <div className="bg-[#FAF7F2] border border-[#E3D5C1] rounded-3xl p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <span className="text-[11px] font-bold text-[#8B6544] uppercase tracking-wider">
            Active Business Profile
          </span>
          <h2 className="text-lg sm:text-xl font-bold font-artisan text-[#423023]">
            {artisanProfile.studioName || 'Your Business'}
            {artisanProfile.makerName && (
              <span className="text-xs font-normal text-[#7A6755] ml-2">
                by {artisanProfile.makerName}
              </span>
            )}
          </h2>
          <p className="text-xs text-[#735F4C] mt-0.5 line-clamp-1">
            {artisanProfile.businessType || artisanProfile.craftSpecialty}
            {artisanProfile.bio ? ` — ${artisanProfile.bio}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            id="btn-back-to-seller-info"
            onClick={onBackToSellerInfo}
            className="px-3.5 py-2 rounded-xl bg-white border border-[#D5C7B6] text-[#423023] hover:bg-[#F2ECE1] text-xs font-semibold transition-all flex items-center gap-1.5 shadow-2xs"
          >
            <Store className="w-3.5 h-3.5 text-[#4E654E]" />
            <span>Edit Business Info</span>
          </button>

          <button
            type="button"
            onClick={onOpenProductIdeas}
            className="px-3.5 py-2 rounded-xl bg-[#EFE7DA] text-[#553E2E] hover:bg-[#E5DAC8] text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs"
          >
            <Lightbulb className="w-3.5 h-3.5 text-[#C59B3C]" />
            <span>Product Ideas</span>
          </button>
        </div>
      </div>

      {/* Heading */}
      <div className="space-y-1">
        <h1 className="text-2xl sm:text-3xl font-bold font-artisan text-[#423023]">
          Product Information
        </h1>
        <p className="text-xs sm:text-sm text-[#735F4C]">
          Upload your product photo and enter the essential details. CraftCopy generates your adaptive promotional poster and persuasive captions together.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Essential Product Fields */}
        <div className="lg:col-span-7 space-y-5">
          <div className="bg-[#FAF7F2] border border-[#E8DFD1] rounded-3xl p-5 sm:p-6 shadow-xs space-y-5">
            {/* Product Name */}
            <div>
              <label htmlFor="input-product-name" className="block text-xs font-bold text-[#423023] mb-1.5">
                Product Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="input-product-name"
                placeholder="e.g. Handcrafted Sunburst Crochet Tote Bag"
                value={product.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#D5C7B6] bg-white text-[#423023] text-sm focus:outline-none focus:ring-2 focus:ring-[#4E654E]"
              />
            </div>

            {/* Product Description */}
            <div>
              <label htmlFor="input-product-details" className="block text-xs font-bold text-[#423023] mb-1.5">
                Product Description <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={4}
                id="input-product-details"
                placeholder="Describe what the product is, key materials, size/color highlights, and why customers love it..."
                value={product.productDetails || product.story || ''}
                onChange={(e) => {
                  const val = e.target.value;
                  setProduct((prev) => ({
                    ...prev,
                    productDetails: val,
                    story: val,
                  }));
                }}
                className="w-full p-3.5 rounded-xl border border-[#D5C7B6] bg-white text-xs sm:text-sm text-[#423023] focus:outline-none focus:ring-2 focus:ring-[#4E654E]"
              />
            </div>

            {/* Selling Price */}
            <div>
              <label htmlFor="input-price" className="block text-xs font-bold text-[#423023] mb-1.5">
                Selling Price (₱)
              </label>
              <div className="relative max-w-xs">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#887463] text-sm font-semibold">
                  ₱
                </span>
                <input
                  type="number"
                  min="0"
                  step="10"
                  id="input-price"
                  placeholder="e.g. 1250"
                  value={product.currentPrice ?? ''}
                  onChange={(e) => {
                    if (e.target.value === '') {
                      handleInputChange('currentPrice', null);
                    } else {
                      const num = Number(e.target.value);
                      handleInputChange('currentPrice', Number.isFinite(num) && num >= 0 ? num : 0);
                    }
                  }}
                  className="w-full pl-8 pr-3.5 py-2.5 rounded-xl border border-[#D5C7B6] bg-white text-[#423023] text-sm focus:outline-none focus:ring-2 focus:ring-[#4E654E]"
                />
              </div>
              <p className="text-[11px] text-[#7A6755] mt-1">
                Shown on your promotional poster badge and featured in marketing captions. Your final selling price is always your decision.
              </p>
            </div>
          </div>

          {/* Collapsible Optional Tools: Category, Voice Tone & Extra Details */}
          <div className="bg-[#FAF7F2] border border-[#E8DFD1] rounded-3xl overflow-hidden shadow-xs">
            <button
              type="button"
              onClick={() => setShowOptionalTools(!showOptionalTools)}
              className="w-full px-5 sm:px-6 py-4 flex items-center justify-between text-left hover:bg-[#F3ECE0] transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <Wand2 className="w-4 h-4 text-[#8B6544]" />
                <div>
                  <span className="text-xs sm:text-sm font-bold text-[#423023] block">
                    Optional: Category, Voice Tone &amp; Extra Details
                  </span>
                  <span className="text-[11px] text-[#7A6755]">
                    Customize product category, caption tone, materials, or promo notes
                  </span>
                </div>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-[#735F4C] transition-transform ${
                  showOptionalTools ? 'rotate-180' : ''
                }`}
              />
            </button>

            {showOptionalTools && (
              <div className="px-5 sm:px-6 pb-6 pt-2 border-t border-[#E8DFD1] space-y-5">
                {/* Category & Tone */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-[#423023] mb-1">
                      Category
                    </label>
                    <select
                      id="select-category"
                      value={product.category}
                      onChange={(e) => handleInputChange('category', e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-[#D5C7B6] bg-white text-[#423023] text-xs focus:outline-none focus:ring-1 focus:ring-[#4E654E]"
                    >
                      {CRAFT_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#423023] mb-1">
                      Caption Voice & Tone
                    </label>
                    <select
                      value={tone}
                      onChange={(e) => setTone(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-[#D5C7B6] bg-white text-[#423023] text-xs focus:outline-none focus:ring-1 focus:ring-[#4E654E]"
                    >
                      {CAPTION_TONES.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Materials & Maker Note */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-[#423023] mb-1">
                      Materials (optional)
                    </label>
                    <input
                      type="text"
                      id="input-materials"
                      placeholder="e.g. 100% cotton yarn, brass clasp"
                      value={product.materials}
                      onChange={(e) => handleInputChange('materials', e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-[#D5C7B6] bg-white text-xs text-[#423023]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#423023] mb-1">
                      Promo Note (optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Limited batch of 10"
                      value={customInstructions}
                      onChange={(e) => setCustomInstructions(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-[#D5C7B6] bg-white text-xs text-[#423023]"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Product Photo Upload & Generate CTA */}
        <div className="lg:col-span-5 space-y-5">
          <div className="bg-[#FAF7F2] border border-[#E8DFD1] rounded-3xl p-5 sm:p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[#423023]">Product Photo</h3>
                <p className="text-[11px] text-[#7A6755]">
                  Used directly in your poster & analyzed for colors and theme
                </p>
              </div>
              {product.photoUrl && (
                <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-[#E7EFE6] text-[#2F442F] font-semibold flex items-center gap-1">
                  <Check className="w-3 h-3 text-[#4E654E]" />
                  Ready
                </span>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  processAndSetImage(e.target.files[0]);
                }
              }}
            />

            {product.photoUrl && !isOptimizingPhoto && (
              <div className="space-y-3">
                <div className="relative rounded-2xl overflow-hidden border border-[#D5C7B6] bg-[#EDE4D5] shadow-xs">
                  <img
                    src={product.photoUrl}
                    alt={product.name || 'Product photo preview'}
                    className="w-full h-64 object-cover"
                    referrerPolicy="no-referrer"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPhotoModal(true)}
                    className="absolute top-2.5 right-2.5 px-2.5 py-1.5 rounded-lg bg-black/70 hover:bg-black/90 text-white text-xs font-medium flex items-center gap-1.5"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                    <span>Zoom</span>
                  </button>
                </div>

                {photoMeta && (
                  <div className="flex items-center justify-between text-[11px] text-[#786554] bg-white px-3 py-1.5 rounded-xl border border-[#E5DACD]">
                    <span className="truncate max-w-[200px]">{photoMeta.fileName}</span>
                    <span className="font-semibold text-[#4E654E]">{photoMeta.fileSize}</span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-2 rounded-xl bg-white border border-[#D5C7B6] hover:bg-[#F2ECE1] text-[#423023] text-xs font-bold flex items-center justify-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-[#4E654E]" />
                    <span>Replace Photo</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleRemovePhoto}
                    className="px-3 py-2 rounded-xl bg-white border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold flex items-center justify-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-600" />
                    <span>Remove</span>
                  </button>
                </div>
              </div>
            )}

            {!product.photoUrl && !isOptimizingPhoto && (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all ${
                  dragActive
                    ? 'border-[#4E654E] bg-[#EBF1EA]'
                    : 'border-[#D5C7B6] bg-white/70 hover:border-[#4E654E] hover:bg-[#F2ECE1]'
                }`}
              >
                <div className="w-12 h-12 rounded-full bg-[#E7EFE6] text-[#4E654E] mx-auto flex items-center justify-center mb-3">
                  <Upload className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-[#423023] mb-1">
                  Upload Product Photo
                </h4>
                <p className="text-xs text-[#7F6E5F] mb-3.5 max-w-xs mx-auto">
                  Drag & drop your photo here or choose an image from your device.
                </p>
                <button
                  type="button"
                  id="btn-upload-product-photo"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2.5 rounded-xl bg-[#4E654E] text-white hover:bg-[#3E523E] text-xs font-bold inline-flex items-center gap-2 shadow-xs"
                >
                  <Upload className="w-4 h-4" />
                  <span>Choose Product Photo</span>
                </button>
              </div>
            )}

            {isOptimizingPhoto && (
              <div className="border-2 border-dashed border-[#4E654E] rounded-2xl p-8 text-center bg-[#EBF1EA] space-y-2">
                <Loader2 className="w-8 h-8 text-[#4E654E] animate-spin mx-auto" />
                <p className="text-xs font-semibold text-[#344834]">
                  Optimizing and uploading photo...
                </p>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-[#7A6755]">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-[#4E654E] shrink-0" />
                <span>EXIF &amp; location metadata is stripped automatically from uploaded photos.</span>
              </span>
              {onOpenPrivacyNotice && (
                <button
                  type="button"
                  onClick={onOpenPrivacyNotice}
                  className="text-[#4E654E] font-semibold hover:underline shrink-0"
                >
                  Privacy Notice
                </button>
              )}
            </div>
          </div>

          {saveErrorMessage && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs">
              {saveErrorMessage}
            </div>
          )}

          {/* Primary Action Buttons */}
          <div className="space-y-2.5">
            <button
              type="button"
              id="btn-generate-content"
              disabled={!isValid || isGenerating}
              onClick={onProceedToGenerate}
              className={`w-full py-4 px-6 rounded-2xl font-bold text-sm sm:text-base flex items-center justify-center gap-2.5 shadow-md transition-all ${
                isValid && !isGenerating
                  ? 'bg-[#4E654E] text-white hover:bg-[#3E523E] hover:shadow-lg active:scale-[0.99]'
                  : 'bg-[#D1C6B8] text-[#867566] cursor-not-allowed'
              }`}
            >
              <Wand2 className="w-5 h-5 text-[#E7EFE6]" />
              <span>Generate Poster & Captions</span>
            </button>

            <button
              type="button"
              id="btn-save-sync"
              disabled={!product.name.trim() || isSaving}
              onClick={handleDirectSave}
              className="w-full py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 border border-[#4E654E]/40 bg-white text-[#2F442F] hover:bg-[#E7EFE6] transition-all disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#4E654E]" />
                  <span>Saving to Supabase...</span>
                </>
              ) : saveSuccessMessage ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="text-emerald-800">{saveSuccessMessage}</span>
                </>
              ) : (
                <>
                  <Database className="w-3.5 h-3.5 text-[#4E654E]" />
                  <span>Save to Supabase</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Full Photo Zoom Modal */}
      {showPhotoModal && product.photoUrl && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="relative max-w-2xl w-full bg-[#FAF7F2] rounded-3xl overflow-hidden shadow-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-[#423023]">{product.name || 'Product Photo'}</span>
              <button
                type="button"
                onClick={() => setShowPhotoModal(false)}
                className="p-1.5 rounded-lg hover:bg-[#EFE7DA] text-[#553E2E]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <img
              src={product.photoUrl}
              alt={product.name || 'Product photo'}
              className="w-full max-h-[75vh] object-contain rounded-2xl bg-white"
            />
          </div>
        </div>
      )}
    </div>
  );
};
