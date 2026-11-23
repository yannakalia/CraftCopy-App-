import React, { useState, useMemo } from 'react';
import { 
  Bookmark, 
  Trash2, 
  Copy, 
  Check, 
  Sparkles, 
  Edit3, 
  ShoppingBag, 
  Share2, 
  PlusCircle, 
  Filter,
  Search,
  X,
  Database,
  ShieldCheck,
  ImageDown,
  Loader2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { SavedCraft, GeneratedPosterRecord } from '../types';
import { deduplicateCrafts } from '../utils/craftDeduplication';
import { savePosterToDeviceGallery, preloadPosterForGallery } from '../utils/posterDownload';
import { GENERATED_POSTERS_SETUP_SQL } from '../services/supabase';

interface CatalogViewProps {
  savedCrafts: SavedCraft[];
  onSelectCraft: (craft: SavedCraft) => void;
  onDeleteCraft: (id: string) => void;
  onNewProduct: () => void;
  onBrowseIdeas?: () => void;
  onEditCraftInForm?: (craft: SavedCraft) => void;
  supabaseLoadedIds?: Set<string>;
  onSyncSupabase?: () => void;
  savedPosters?: GeneratedPosterRecord[];
  isLoadingSavedPosters?: boolean;
  savedPostersError?: string | null;
  savedPostersSetupRequired?: boolean;
  onRefreshSavedPosters?: () => void;
  onOpenSavedPoster?: (poster: GeneratedPosterRecord) => void;
}

export const CatalogView: React.FC<CatalogViewProps> = ({
  savedCrafts,
  onSelectCraft,
  onDeleteCraft,
  onNewProduct,
  onBrowseIdeas,
  onEditCraftInForm,
  supabaseLoadedIds,
  onSyncSupabase,
  savedPosters = [],
  isLoadingSavedPosters = false,
  savedPostersError = null,
  savedPostersSetupRequired = false,
  onRefreshSavedPosters,
  onOpenSavedPoster,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [downloadingCraftId, setDownloadingCraftId] = useState<string | null>(null);
  const [downloadedCraftId, setDownloadedCraftId] = useState<string | null>(null);
  const [galleryStatusMsg, setGalleryStatusMsg] = useState<string | null>(null);
  const [galleryErrorMsg, setGalleryErrorMsg] = useState<string | null>(null);
  const [copiedPosterSql, setCopiedPosterSql] = useState<boolean>(false);

  const categories = ['all', ...Array.from(new Set(savedCrafts.map((c) => c.product.category)))];

  const filtered = useMemo(() => {
    return savedCrafts.filter((craft) => {
      // Category filter
      if (filterCategory !== 'all' && craft.product.category !== filterCategory) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = craft.product.name.toLowerCase().includes(q);
        const matchesCategory = craft.product.category.toLowerCase().includes(q);
        const matchesMaterials = craft.product.materials.toLowerCase().includes(q);
        const matchesTechnique = craft.product.craftTechnique.toLowerCase().includes(q);
        if (!matchesName && !matchesCategory && !matchesMaterials && !matchesTechnique) {
          return false;
        }
      }
      return true;
    });
  }, [savedCrafts, filterCategory, searchQuery]);

  const handleCopyCaption = (craft: SavedCraft) => {
    const text = craft.product.caption?.trim()
      ? craft.product.caption
      : `${craft.content.captions.instagram.title}\n\n${craft.content.captions.instagram.body}\n\n${craft.content.captions.instagram.hashtags.join(' ')}`;

    navigator.clipboard.writeText(text);
    setCopiedId(`${craft.id}-caption`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCopyDescription = (craft: SavedCraft) => {
    const desc =
      craft.product.productDescription?.trim() ||
      craft.content.descriptions.story ||
      craft.content.descriptions.short ||
      craft.product.productDetails ||
      '';
    if (!desc) return;
    navigator.clipboard.writeText(desc);
    setCopiedId(`${craft.id}-desc`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSaveCraftPosterToGallery = async (craft: SavedCraft) => {
    const posterSrc = craft.posterUrl || craft.product?.posterUrl || '';
    if (!posterSrc || downloadingCraftId) return;

    setDownloadingCraftId(craft.id);
    setGalleryErrorMsg(null);
    setGalleryStatusMsg(null);
    try {
      const result = await savePosterToDeviceGallery({
        src: posterSrc,
        productName: craft.product?.name,
        aspectRatio: '4:5',
        format: 'png',
      });
      if (result.success) {
        setDownloadedCraftId(craft.id);
        setGalleryStatusMsg(result.message || `Saved "${craft.product?.name}" poster to your gallery!`);
        setTimeout(() => setDownloadedCraftId(null), 3500);
      } else if (!result.cancelled) {
        setGalleryErrorMsg(result.error || 'Could not save poster to gallery.');
      }
    } catch (err: any) {
      setGalleryErrorMsg(err?.message || 'Failed to save poster to gallery.');
    } finally {
      setDownloadingCraftId(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-6">
      {/* Header with Title & Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-[#8B6544]">
            Artisan Studio Collection
          </span>
          <h2 className="text-xl sm:text-2xl font-bold font-artisan text-[#423023]">
            Saved Craft Marketing Kits ({savedCrafts.length})
          </h2>
          <p className="text-xs sm:text-sm text-[#735F4C]">
            Ready-to-post marketing copy, product descriptions, and promotional posters for your creations.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {categories.length > 2 && (
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="text-xs px-3 py-2 rounded-xl border border-[#D5C7B6] bg-white text-[#423023]"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c === 'all' ? 'All Categories' : c}
                </option>
              ))}
            </select>
          )}

          {onSyncSupabase && (
            <button
              id="btn-sync-catalog-supabase"
              onClick={onSyncSupabase}
              className="px-3.5 py-2 rounded-xl bg-white border border-[#D5C7B6] hover:bg-[#F2ECE1] text-[#423023] text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-all"
              title="Synchronize and re-fetch from Supabase public.products"
            >
              <Database className="w-3.5 h-3.5 text-[#4E654E]" />
              <span>Sync Supabase</span>
            </button>
          )}

          <button
            onClick={onNewProduct}
            className="px-4 py-2 rounded-xl bg-[#4E654E] text-[#FAF7F2] text-xs font-bold hover:bg-[#3E523E] flex items-center gap-1.5 shadow-sm"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Create New</span>
          </button>
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className="bg-[#FAF7F2] border border-[#E8DFD1] rounded-2xl p-3.5 sm:p-4 shadow-xs flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#887463]">
            <Search className="w-4 h-4" />
          </span>
          <input
            type="text"
            id="search-saved-crafts"
            placeholder="Search saved products by name, materials, or technique..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-8 py-2 rounded-xl border border-[#D5C7B6] bg-white text-[#423023] text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#4E654E]"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#8A7969] hover:text-[#423023]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {categories.length > 1 && (
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Filter className="w-3.5 h-3.5 text-[#786554] shrink-0" />
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="w-full sm:w-auto text-xs px-3 py-2 rounded-xl border border-[#D5C7B6] bg-white text-[#423023] focus:outline-none focus:ring-1 focus:ring-[#4E654E]"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c === 'all' ? 'All Categories' : c}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {galleryStatusMsg && (
        <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{galleryStatusMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setGalleryStatusMsg(null)}
            className="text-emerald-700 font-bold hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {galleryErrorMsg && (
        <div className="p-3 rounded-2xl bg-red-50 border border-red-200 text-red-900 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{galleryErrorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setGalleryErrorMsg(null)}
            className="text-red-700 font-bold hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Permanent Saved AI Posters Section (from Supabase "generated_posters") */}
      <section
        id="catalog-ai-posters-section"
        className="bg-[#FAF7F2] border border-[#E8DFD1] rounded-3xl p-4 sm:p-5 shadow-xs space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#8B6544]">
                AI Posters
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#E7EFE6] text-[#2F442F] text-[10px] font-semibold border border-[#C5DAC3]">
                <Database className="w-2.5 h-2.5 text-[#4E654E]" />
                <span>Supabase Storage</span>
              </span>
            </div>
            <h3 className="text-base sm:text-lg font-bold font-artisan text-[#423023]">
              Saved AI Posters ({savedPosters.length})
            </h3>
          </div>

          {onRefreshSavedPosters && (
            <button
              type="button"
              id="btn-refresh-catalog-ai-posters"
              onClick={onRefreshSavedPosters}
              disabled={isLoadingSavedPosters}
              className="px-3 py-1.5 rounded-xl bg-white border border-[#D5C7B6] hover:bg-[#F2ECE1] text-[#423023] text-xs font-semibold flex items-center gap-1.5 self-start sm:self-auto disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#4E654E] ${isLoadingSavedPosters ? 'animate-spin' : ''}`} />
              <span>{isLoadingSavedPosters ? 'Loading...' : 'Refresh Posters'}</span>
            </button>
          )}
        </div>

        {savedPostersError && (
          <div className="p-3 rounded-2xl bg-red-50 border border-red-200 text-red-900 text-xs space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{savedPostersError}</span>
              </div>
              {onRefreshSavedPosters && (
                <button
                  type="button"
                  onClick={onRefreshSavedPosters}
                  className="px-2.5 py-1 rounded-lg bg-red-700 text-white font-bold text-[10px] shrink-0"
                >
                  Retry
                </button>
              )}
            </div>
            {savedPostersSetupRequired && (
              <div className="p-2 rounded-xl bg-white border border-red-200 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-[#553E2E]">
                  Run the SQL script in Supabase SQL Editor to enable <code className="font-mono font-bold">generated-posters</code> &amp; <code className="font-mono font-bold">generated_posters</code>.
                </span>
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
              </div>
            )}
          </div>
        )}

        {isLoadingSavedPosters && savedPosters.length === 0 ? (
          <div className="py-8 flex flex-col items-center justify-center gap-2 text-xs text-[#7A6755]">
            <Loader2 className="w-5 h-5 animate-spin text-[#4E654E]" />
            <span>Loading saved AI posters from Supabase...</span>
          </div>
        ) : savedPosters.length === 0 ? (
          <div className="p-6 rounded-2xl border border-dashed border-[#D5C7B6] bg-white/70 text-center space-y-1.5">
            <p className="text-xs font-bold text-[#423023]">No permanently saved AI posters yet</p>
            <p className="text-[11px] text-[#7A6755]">
              Generate a poster in the Studio and click <strong>Save Poster</strong> to store it permanently in Supabase.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {savedPosters.map((poster) => {
              const formattedDate = poster.created_at
                ? new Date(poster.created_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })
                : '';
              const isCardDownloading = downloadingCraftId === poster.id;
              const isCardDownloaded = downloadedCraftId === poster.id;

              return (
                <div
                  key={`catalog-supabase-poster-${poster.id}`}
                  className="rounded-2xl border border-[#E0D5C5] bg-white p-3 flex flex-col gap-2.5 hover:border-[#4E654E]/50 transition-all"
                >
                  <div
                    onClick={() => onOpenSavedPoster?.(poster)}
                    className="aspect-[4/5] w-full rounded-xl overflow-hidden bg-[#F3ECE0] border border-[#E8DFD1] cursor-pointer flex items-center justify-center"
                  >
                    <img
                      src={poster.poster_image_url}
                      alt={poster.product_name || 'Saved AI Poster'}
                      className="w-full h-full object-contain hover:scale-[1.01] transition-transform"
                      referrerPolicy="no-referrer"
                    />
                  </div>

                  <div className="min-w-0 space-y-1">
                    <p className="text-xs font-bold text-[#423023] truncate">
                      {poster.product_name || 'Promotional Poster'}
                    </p>
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

                  <div className="flex items-center gap-1.5 mt-auto pt-1">
                    <button
                      type="button"
                      onPointerEnter={() =>
                        preloadPosterForGallery({
                          src: poster.poster_image_url,
                          productName: poster.product_name,
                          format: 'png',
                        })
                      }
                      onClick={async () => {
                        if (downloadingCraftId) return;
                        setDownloadingCraftId(poster.id);
                        setGalleryErrorMsg(null);
                        setGalleryStatusMsg(null);
                        try {
                          const result = await savePosterToDeviceGallery({
                            src: poster.poster_image_url,
                            productName: poster.product_name,
                            aspectRatio: '4:5',
                            format: 'png',
                          });
                          if (result.success) {
                            setDownloadedCraftId(poster.id);
                            setGalleryStatusMsg(result.message || `Saved "${poster.product_name}" poster to your gallery!`);
                            setTimeout(() => setDownloadedCraftId(null), 3500);
                          } else if (!result.cancelled) {
                            setGalleryErrorMsg(result.error || 'Could not save poster to gallery.');
                          }
                        } catch (err: any) {
                          setGalleryErrorMsg(err?.message || 'Failed to save poster to gallery.');
                        } finally {
                          setDownloadingCraftId(null);
                        }
                      }}
                      disabled={isCardDownloading}
                      className="flex-1 px-2.5 py-1.5 rounded-lg bg-[#E7EFE6] hover:bg-[#D5E6D3] border border-[#C5DAC3] text-[#2F442F] text-xs font-bold flex items-center justify-center gap-1 disabled:opacity-60"
                    >
                      {isCardDownloading ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : isCardDownloaded ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <ImageDown className="w-3 h-3 text-[#4E654E]" />
                      )}
                      <span>{isCardDownloaded ? 'Saved!' : 'Save to Gallery'}</span>
                    </button>

                    {poster.caption && (
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(poster.caption);
                          setCopiedId(`sp-cap-${poster.id}`);
                          setTimeout(() => setCopiedId(null), 2000);
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-[#EFE7DA] hover:bg-[#E2D5C3] text-[#423023] text-xs font-semibold flex items-center gap-1"
                        title="Copy caption"
                      >
                        {copiedId === `sp-cap-${poster.id}` ? (
                          <Check className="w-3 h-3 text-[#4E654E]" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    )}

                    {onOpenSavedPoster && (
                      <button
                        type="button"
                        onClick={() => onOpenSavedPoster(poster)}
                        className="px-2.5 py-1.5 rounded-lg bg-[#4E654E] hover:bg-[#3E523E] text-white text-xs font-bold"
                      >
                        Open
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {filtered.length === 0 ? (
        <div className="bg-[#FAF7F2] border border-dashed border-[#D5C7B6] rounded-2xl p-10 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-[#EFE7DA] text-[#7A6655] mx-auto flex items-center justify-center">
            <Bookmark className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-[#423023]">
            {searchQuery ? `No saved products match "${searchQuery}"` : 'No saved crafts yet'}
          </h3>
          <p className="text-xs text-[#7A6655] max-w-sm mx-auto">
            {searchQuery 
              ? 'Try adjusting your search terms or clearing the filter.' 
              : 'Generate your first product marketing copy using the Workshop, then approve and save it to store it here.'}
          </p>
          <div className="flex items-center justify-center gap-2 pt-1">
            {searchQuery ? (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setFilterCategory('all');
                }}
                className="px-4 py-2 rounded-xl bg-[#4E654E] text-white text-xs font-bold hover:bg-[#3E523E]"
              >
                Clear Search Filter
              </button>
            ) : (
              <button
                onClick={onNewProduct}
                className="px-4 py-2 rounded-xl bg-[#4E654E] text-white text-xs font-bold hover:bg-[#3E523E]"
              >
                Start First Product
              </button>
            )}
            {onBrowseIdeas && (
              <button
                onClick={onBrowseIdeas}
                className="px-4 py-2 rounded-xl bg-[#FAF7F2] border border-[#D8CCBC] text-[#553E2E] text-xs font-semibold hover:bg-[#EAE2D3]"
              >
                Browse Product Ideas
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {deduplicateCrafts(filtered).map((craft, idx) => (
            <div
              key={`catalog-craft-${craft.id || craft.product?.id || idx}-${idx}`}
              className="bg-[#FAF7F2] border border-[#E8DFD1] rounded-2xl p-4 sm:p-5 shadow-xs flex flex-col justify-between hover:border-[#4E654E]/40 transition-all"
            >
              <div>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    {(craft.posterUrl || craft.product.posterUrl || craft.product.photoUrl) ? (
                      <img
                        src={craft.posterUrl || craft.product.posterUrl || craft.product.photoUrl}
                        alt={craft.product.name}
                        className="w-14 h-14 rounded-xl object-cover border border-[#D5C7B6]"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-xl bg-[#EFE7DA] flex items-center justify-center text-[#735F4C]">
                        <ShoppingBag className="w-6 h-6" />
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#8B6544]">
                          {craft.product.category}
                        </span>
                        {(supabaseLoadedIds?.has(craft.id) || craft.createdAt === 'Supabase Record' || craft.content?.aiModelUsed === 'Supabase Cloud Database') && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-md bg-[#E2EBE2] text-[#2F442F] text-[9px] font-semibold border border-[#BED2BD]" title="Synchronized with Supabase public.products">
                            <Database className="w-2.5 h-2.5 text-[#3E523E]" />
                            <span>Supabase Cloud</span>
                          </span>
                        )}
                      </div>
                      <h4 className="text-sm font-bold text-[#423023] line-clamp-1">
                        {craft.product.name}
                      </h4>
                      <div className="flex items-center gap-2 mt-0.5 text-xs">
                        {craft.product.currentPrice && Number(craft.product.currentPrice) > 0 ? (
                          <span className="font-bold text-[#4E654E]">
                            ₱{Number(craft.product.currentPrice).toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-[#887463] italic">Price not set</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {supabaseLoadedIds?.has(craft.id) ? (
                    <span 
                      className="p-1.5 text-[#4E654E] rounded-lg bg-[#EAEFE9]" 
                      title="Database Protection: Existing Supabase project records are preserved and cannot be deleted."
                    >
                      <ShieldCheck className="w-4 h-4 text-[#3E523E]" />
                    </span>
                  ) : (
                    <button
                      onClick={() => onDeleteCraft(craft.id)}
                      className="p-1.5 text-[#9C8A7B] hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete saved kit"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Promotional Caption & Product Description */}
                <div className="space-y-2 mb-3">
                  <div className="bg-white p-2.5 rounded-xl border border-[#E2D5C4]">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-[#8B6544] mb-0.5">
                      Marketing Caption
                    </span>
                    <p className="text-xs text-[#5C4A3C] line-clamp-2 leading-relaxed">
                      {craft.product.caption || `${craft.content.captions.instagram.title} — ${craft.content.captions.instagram.body.slice(0, 110)}`}
                    </p>
                  </div>

                  {(craft.product.productDescription || craft.content.descriptions.short) && (
                    <div className="bg-white p-2.5 rounded-xl border border-[#E2D5C4]">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-[#4E654E] mb-0.5">
                        Product Description
                      </span>
                      <p className="text-xs text-[#5C4A3C] line-clamp-2 leading-relaxed">
                        {craft.product.productDescription || craft.content.descriptions.short}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Bar */}
              <div className="pt-2 border-t border-[#E8DFD1] flex items-center justify-between gap-2 flex-wrap">
                <div className="text-[11px] text-[#8C7A6B]">
                  {craft.createdAt || 'Saved Output'}
                </div>

                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  {(craft.posterUrl || craft.product?.posterUrl) && (
                    <button
                      type="button"
                      onPointerEnter={() =>
                        preloadPosterForGallery({
                          src: craft.posterUrl || craft.product?.posterUrl || '',
                          productName: craft.product?.name,
                          format: 'png',
                        })
                      }
                      onTouchStart={() =>
                        preloadPosterForGallery({
                          src: craft.posterUrl || craft.product?.posterUrl || '',
                          productName: craft.product?.name,
                          format: 'png',
                        })
                      }
                      onClick={() => handleSaveCraftPosterToGallery(craft)}
                      disabled={downloadingCraftId === craft.id}
                      className="px-2.5 py-1.5 rounded-lg bg-[#E7EFE6] hover:bg-[#D5E6D3] border border-[#C5DAC3] text-[#2F442F] text-xs font-bold flex items-center gap-1 transition-all disabled:opacity-60"
                      title="Download actual high-res generated poster to your device gallery"
                    >
                      {downloadingCraftId === craft.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : downloadedCraftId === craft.id ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <ImageDown className="w-3 h-3 text-[#4E654E]" />
                      )}
                      <span>{downloadedCraftId === craft.id ? 'Saved!' : 'Save to Gallery'}</span>
                    </button>
                  )}

                  {onEditCraftInForm && (
                    <button
                      onClick={() => onEditCraftInForm(craft)}
                      className="px-2.5 py-1.5 rounded-lg bg-white border border-[#D5C7B6] hover:bg-[#F2ECE1] text-[#423023] text-xs font-semibold flex items-center gap-1 transition-all shadow-2xs"
                      title="Edit craft info and photo"
                    >
                      <Edit3 className="w-3 h-3 text-[#4E654E]" />
                      <span>Edit</span>
                    </button>
                  )}

                  <button
                    onClick={() => handleCopyCaption(craft)}
                    className="px-2.5 py-1.5 rounded-lg bg-[#EFE7DA] hover:bg-[#E2D5C3] text-[#423023] text-xs font-semibold flex items-center gap-1 transition-all"
                  >
                    {copiedId === `${craft.id}-caption` ? (
                      <Check className="w-3 h-3 text-[#4E654E]" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>{copiedId === `${craft.id}-caption` ? 'Copied!' : 'Copy Caption'}</span>
                  </button>

                  {(craft.product.productDescription || craft.content.descriptions.short) && (
                    <button
                      onClick={() => handleCopyDescription(craft)}
                      className="px-2.5 py-1.5 rounded-lg bg-[#EFE7DA] hover:bg-[#E2D5C3] text-[#423023] text-xs font-semibold flex items-center gap-1 transition-all"
                    >
                      {copiedId === `${craft.id}-desc` ? (
                        <Check className="w-3 h-3 text-[#4E654E]" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>{copiedId === `${craft.id}-desc` ? 'Copied!' : 'Copy Description'}</span>
                    </button>
                  )}

                  <button
                    onClick={() => onSelectCraft(craft)}
                    className="px-3 py-1.5 rounded-lg bg-[#4E654E] hover:bg-[#3E523E] text-white text-xs font-bold transition-all"
                  >
                    Open Poster &rarr;
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
