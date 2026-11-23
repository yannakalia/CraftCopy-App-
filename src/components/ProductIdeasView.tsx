import React, { useState, useMemo } from 'react';
import {
  Search,
  Sparkles,
  Lightbulb,
  ArrowRight,
  Filter,
  Flame,
  Wand2,
  X,
  AlertCircle,
  Hammer,
} from 'lucide-react';
import { ProductIdea, ArtisanProfile } from '../types';
import { CURATED_PRODUCT_IDEAS } from '../data/productIdeas';
import { CRAFT_CATEGORIES } from '../data/sampleProducts';
import { brainstormProductIdeas } from '../services/api';

interface ProductIdeasViewProps {
  onSelectIdea: (idea: ProductIdea) => void;
  artisanProfile?: ArtisanProfile;
}

export const ProductIdeasView: React.FC<ProductIdeasViewProps> = ({
  onSelectIdea,
  artisanProfile,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>('All');
  const [selectedDemand, setSelectedDemand] = useState<string>('All');
  const [sortBy, setSortBy] = useState<'recommended' | 'price-desc' | 'time-asc' | 'margin-desc'>('recommended');

  // AI Brainstormer state
  const [brainstormInput, setBrainstormInput] = useState('');
  const [isBrainstorming, setIsBrainstorming] = useState(false);
  const [brainstormError, setBrainstormError] = useState<string | null>(null);
  const [customIdeas, setCustomIdeas] = useState<ProductIdea[]>([]);
  const [showBrainstormBox, setShowBrainstormBox] = useState(false);

  // Combine curated + brainstormed ideas
  const allIdeas = useMemo(() => {
    return [...customIdeas, ...CURATED_PRODUCT_IDEAS];
  }, [customIdeas]);

  // Filtered & Searched ideas
  const filteredIdeas = useMemo(() => {
    return allIdeas.filter((idea) => {
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = idea.name.toLowerCase().includes(q);
        const matchesCategory = idea.category.toLowerCase().includes(q);
        const matchesMaterials = idea.materials.toLowerCase().includes(q);
        const matchesWhy = idea.whyItSells.toLowerCase().includes(q);
        const matchesTags = idea.tags.some((t) => t.toLowerCase().includes(q));
        if (!matchesName && !matchesCategory && !matchesMaterials && !matchesWhy && !matchesTags) {
          return false;
        }
      }

      // Category
      if (selectedCategory !== 'All' && idea.category !== selectedCategory) {
        return false;
      }

      // Difficulty
      if (selectedDifficulty !== 'All' && idea.difficulty !== selectedDifficulty) {
        return false;
      }

      // Demand
      if (selectedDemand !== 'All') {
        if (selectedDemand === 'Bestseller' && idea.marketDemand !== 'Bestseller') return false;
        if (selectedDemand === 'Trending' && idea.marketDemand !== 'Trending') return false;
      }

      return true;
    }).sort((a, b) => {
      if (sortBy === 'price-desc') return b.suggestedRetail - a.suggestedRetail;
      if (sortBy === 'time-asc') return a.estimatedHours - b.estimatedHours;
      if (sortBy === 'margin-desc') return b.profitMarginPercent - a.profitMarginPercent;
      return 0; // recommended original order
    });
  }, [allIdeas, searchQuery, selectedCategory, selectedDifficulty, selectedDemand, sortBy]);

  // Handle real Gemini AI brainstorm generator
  const handleBrainstorm = async () => {
    if (!brainstormInput.trim() || isBrainstorming) return;
    setIsBrainstorming(true);
    setBrainstormError(null);
    try {
      const res = await brainstormProductIdeas(
        brainstormInput.trim(),
        selectedCategory !== 'All' ? selectedCategory : undefined,
        artisanProfile
      );
      if (res.success && res.ideas && res.ideas.length > 0) {
        setCustomIdeas((prev) => [...res.ideas!, ...prev]);
        setBrainstormInput('');
      } else {
        setBrainstormError(res.error || 'Could not generate product ideas right now. Please try again.');
      }
    } catch (err: any) {
      setBrainstormError(err?.message || 'Unexpected error brainstorming product ideas.');
    } finally {
      setIsBrainstorming(false);
    }
  };

  const quickPromptChips = [
    'Full-grain leather wallet & brass snaps',
    'Handmade leather shoes & crepe soles',
    'Organic cotton yarn for crocheted bags',
    'Natural linen cloth for artisan shirts',
    'Textured acrylic canvas wall art',
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8 space-y-6">
      {/* Header Banner */}
      <div className="bg-[#F4EFE6] border border-[#E3D5C1] rounded-3xl p-5 sm:p-7 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#E7EFE6] text-[#344834] text-xs font-semibold">
                <Lightbulb className="w-3.5 h-3.5 text-[#4E654E]" />
                Artisan Inspiration Hub
              </span>
              <span className="text-xs text-[#7A6755]">
                {allIdeas.length} Curated Craft Concepts
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold font-artisan text-[#423023]">
              What to Sell: Proven Craft Product Ideas
            </h2>
            <p className="text-xs sm:text-sm text-[#735F4C] max-w-2xl">
              Discover high-demand, profitable handcrafted products that sell well at artisan markets and online shops. Click <strong>"Craft This"</strong> on any card to immediately pre-fill your product form!
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowBrainstormBox(!showBrainstormBox)}
              className="px-4 py-2.5 rounded-xl bg-[#4E654E] text-[#FAF7F2] text-xs font-bold hover:bg-[#3E523E] transition-all flex items-center gap-1.5 shadow-sm"
            >
              <Wand2 className="w-4 h-4 text-[#E7EFE6]" />
              <span>{showBrainstormBox ? 'Hide AI Brainstormer' : 'Brainstorm from My Materials'}</span>
            </button>
          </div>
        </div>

        {/* AI Materials Brainstormer Drawer */}
        {showBrainstormBox && (
          <div className="mt-5 pt-5 border-t border-[#DCCDB7] space-y-3 animate-in fade-in">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#C59B3C]" />
                <h3 className="text-xs sm:text-sm font-bold text-[#423023]">
                  AI Craft Idea Brainstormer: What materials or scraps do you have on hand?
                </h3>
              </div>
              <span className="text-[11px] text-[#867362]">Instant custom suggestions</span>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-2">
              <input
                type="text"
                placeholder="e.g. Leftover vegetable-tanned leather scraps and solid brass key rings..."
                value={brainstormInput}
                onChange={(e) => setBrainstormInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleBrainstorm()}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#D5C7B6] bg-white text-[#423023] text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#4E654E]"
              />
              <button
                type="button"
                onClick={handleBrainstorm}
                disabled={!brainstormInput.trim() || isBrainstorming}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-[#8B6544] text-white text-xs font-bold hover:bg-[#735133] disabled:opacity-50 transition-all shrink-0 flex items-center justify-center gap-1.5"
              >
                {isBrainstorming ? (
                  <>
                    <Sparkles className="w-3.5 h-3.5 animate-spin" />
                    <span>Brainstorming...</span>
                  </>
                ) : (
                  <>
                    <Lightbulb className="w-3.5 h-3.5" />
                    <span>Generate Product Ideas</span>
                  </>
                )}
              </button>
            </div>

            {/* Quick Inspiration chips */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11px] text-[#887463]">Try quick prompts:</span>
              {quickPromptChips.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setBrainstormInput(chip)}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-white border border-[#D8CCBD] text-[#635041] hover:bg-[#F2ECE1] transition-colors"
                >
                  + {chip}
                </button>
              ))}
            </div>

            {brainstormError && (
              <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{brainstormError}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Search & Filtering Controls */}
      <div className="bg-[#FAF7F2] border border-[#E8DFD1] rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
        {/* Main Search Input */}
        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#887463]">
            <Search className="w-4 h-4 sm:w-5 sm:h-5" />
          </span>
          <input
            type="text"
            id="search-products-input"
            placeholder="Search products by name, materials, technique, or tags (e.g. 'mug', 'leather', 'charcuterie', 'candle', 'gift')..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 sm:pl-11 pr-10 py-3 rounded-xl border border-[#D5C7B6] bg-white text-[#423023] text-sm focus:outline-none focus:ring-2 focus:ring-[#4E654E] placeholder:text-[#A69786]"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[#8A7969] hover:text-[#423023]"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar">
          <button
            onClick={() => setSelectedCategory('All')}
            className={`px-3 py-1.5 rounded-xl font-semibold whitespace-nowrap transition-all ${
              selectedCategory === 'All'
                ? 'bg-[#4E654E] text-white shadow-xs'
                : 'bg-white border border-[#D8CCBD] text-[#604D3F] hover:bg-[#EFE7DA]'
            }`}
          >
            All Categories ({allIdeas.length})
          </button>
          {CRAFT_CATEGORIES.map((cat) => {
            const count = allIdeas.filter((i) => i.category === cat).length;
            if (count === 0 && selectedCategory !== cat) return null;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-xl font-medium whitespace-nowrap transition-all ${
                  selectedCategory === cat
                    ? 'bg-[#4E654E] text-white shadow-xs'
                    : 'bg-white border border-[#D8CCBD] text-[#604D3F] hover:bg-[#EFE7DA]'
                }`}
              >
                {cat} ({count})
              </button>
            );
          })}
        </div>

        {/* Secondary Filter Dropdowns */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#E8DFD1] text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 text-[#786554]">
              <Filter className="w-3.5 h-3.5" />
              <span className="font-semibold">Filter:</span>
            </div>

            {/* Difficulty Filter */}
            <select
              value={selectedDifficulty}
              onChange={(e) => setSelectedDifficulty(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-[#D5C7B6] bg-white text-[#423023] focus:outline-none focus:ring-1 focus:ring-[#4E654E]"
            >
              <option value="All">All Skill Levels</option>
              <option value="Beginner">Beginner Friendly</option>
              <option value="Intermediate">Intermediate</option>
              <option value="Master Artisan">Master Artisan</option>
            </select>

            {/* Demand Filter */}
            <select
              value={selectedDemand}
              onChange={(e) => setSelectedDemand(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-[#D5C7B6] bg-white text-[#423023] focus:outline-none focus:ring-1 focus:ring-[#4E654E]"
            >
              <option value="All">All Market Demand</option>
              <option value="Bestseller">Bestsellers Only</option>
              <option value="Trending">Trending Only</option>
            </select>

            {(searchQuery || selectedCategory !== 'All' || selectedDifficulty !== 'All' || selectedDemand !== 'All') && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('All');
                  setSelectedDifficulty('All');
                  setSelectedDemand('All');
                }}
                className="text-[#8B6544] hover:underline font-semibold ml-1"
              >
                Reset filters
              </button>
            )}
          </div>

          {/* Sort By */}
          <div className="flex items-center gap-1.5 text-[#786554]">
            <span>Sort by:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-2.5 py-1.5 rounded-lg border border-[#D5C7B6] bg-white text-[#423023] font-medium focus:outline-none focus:ring-1 focus:ring-[#4E654E]"
            >
              <option value="recommended">Market Recommended</option>
              <option value="price-desc">Highest Retail Price (₱)</option>
              <option value="time-asc">Quickest to Make (Hours)</option>
              <option value="margin-desc">Highest Profit Margin (%)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Ideas Grid */}
      {filteredIdeas.length === 0 ? (
        <div className="bg-[#FAF7F2] border border-dashed border-[#D5C7B6] rounded-2xl p-10 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-[#EFE7DA] text-[#7A6655] mx-auto flex items-center justify-center">
            <Search className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-[#423023]">
            {searchQuery.trim()
              ? `No craft products found for "${searchQuery}"`
              : 'No craft products match the selected filters'}
          </h3>
          <p className="text-xs text-[#7A6655] max-w-md mx-auto">
            Try another keyword or reset your filters, or use the AI brainstormer above to generate custom product ideas for your specific supplies!
          </p>
          <button
            onClick={() => {
              setSearchQuery('');
              setSelectedCategory('All');
              setSelectedDifficulty('All');
              setSelectedDemand('All');
            }}
            className="px-4 py-2 rounded-xl bg-[#4E654E] text-white text-xs font-bold hover:bg-[#3E523E]"
          >
            Clear Search &amp; Show All
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredIdeas.map((idea, idx) => (
            <div
              key={`idea-${idea.id || idx}-${idx}`}
              className="bg-[#FAF7F2] border border-[#E8DFD1] rounded-2xl overflow-hidden shadow-xs hover:shadow-md hover:border-[#4E654E]/50 transition-all flex flex-col justify-between group"
            >
              <div>
                {/* Photo & Demand Badge */}
                <div className="relative h-44 w-full bg-[#EDE4D5] overflow-hidden">
                  {idea.photoUrl ? (
                    <img
                      src={idea.photoUrl}
                      alt={idea.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#EFE7DA] to-[#E2D4C0] p-4 text-center">
                      <Hammer className="w-8 h-8 text-[#8B6544]" />
                      <span className="text-xs font-bold text-[#423023]">{idea.category}</span>
                      <span className="text-[11px] text-[#7A6755]">
                        AI Concept — add your own photo next
                      </span>
                    </div>
                  )}
                  <div className="absolute top-3 left-3 flex items-center gap-1.5">
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase shadow-xs flex items-center gap-1 ${
                      idea.marketDemand === 'Bestseller'
                        ? 'bg-[#C59B3C] text-white'
                        : idea.marketDemand === 'Trending'
                        ? 'bg-[#E76F51] text-white'
                        : 'bg-[#4E654E] text-white'
                    }`}>
                      <Flame className="w-3 h-3" />
                      {idea.marketDemand}
                    </span>
                  </div>

                  <div className="absolute bottom-3 right-3 bg-white/90 backdrop-blur-xs px-2 py-0.5 rounded-lg text-[11px] font-bold text-[#423023] shadow-xs">
                    {idea.difficulty}
                  </div>
                </div>

                {/* Content Details */}
                <div className="p-4 sm:p-5 space-y-3">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#8B6544]">
                      {idea.category}
                    </span>
                    <h3 className="text-base font-bold font-artisan text-[#423023] line-clamp-1 group-hover:text-[#4E654E] transition-colors">
                      {idea.name}
                    </h3>
                  </div>

                  {/* Why It Sells Box */}
                  <div className="p-2.5 rounded-xl bg-[#F4EFE6] border border-[#E4D7C4] text-xs text-[#5C4A3A] leading-relaxed">
                    <strong className="text-[#423023] block text-[11px] mb-0.5">
                      💡 Why It Sells:
                    </strong>
                    {idea.whyItSells}
                  </div>

                  {/* Economics Metrics */}
                  <div className="grid grid-cols-3 gap-2 py-2 border-y border-[#E8DFD1] text-center text-xs">
                    <div>
                      <span className="block text-[10px] text-[#887463]">Suggested Retail</span>
                      <span className="font-bold text-[#4E654E] text-sm">₱{idea.suggestedRetail.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="block text-[10px] text-[#887463]">Est. Time</span>
                      <span className="font-semibold text-[#423023]">{idea.estimatedHours} hrs</span>
                    </div>
                    <div>
                      <span className="block text-[10px] text-[#887463]">Target Margin</span>
                      <span className="font-semibold text-[#C59B3C]">{idea.profitMarginPercent}%</span>
                    </div>
                  </div>

                  {/* Materials Preview */}
                  <div className="text-xs text-[#715E4E]">
                    <span className="font-semibold text-[#423023]">Materials: </span>
                    <span className="line-clamp-2">{idea.materials}</span>
                  </div>
                </div>
              </div>

              {/* Action Button: "Turn into Product / Create Poster" */}
              <div className="p-4 sm:p-5 pt-0">
                <button
                  type="button"
                  id={`btn-craft-idea-${idea.id}`}
                  onClick={() => onSelectIdea(idea)}
                  className="w-full py-2.5 px-4 rounded-xl bg-[#4E654E] text-white text-xs font-bold hover:bg-[#3E523E] transition-all flex items-center justify-center gap-1.5 shadow-xs active:scale-[0.98]"
                >
                  <span>Turn into Product / Create Poster</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
