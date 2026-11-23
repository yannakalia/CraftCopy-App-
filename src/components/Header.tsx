import React from 'react';
import { Sparkles, Bookmark, Lightbulb, User, Hammer, Globe } from 'lucide-react';

export type NavTab = 'create' | 'ideas' | 'catalog';

interface HeaderProps {
  currentTab: NavTab;
  setCurrentTab: (tab: NavTab) => void;
  savedCount: number;
  onOpenSdg: () => void;
  onOpenSellerInfo: () => void;
  makerName?: string;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  setCurrentTab,
  savedCount,
  onOpenSdg,
  onOpenSellerInfo,
  makerName,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-[#FAF7F2]/95 backdrop-blur-md border-b border-[#E8DFD1]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between gap-4 sm:gap-8">
        {/* Wordmark / Brand */}
        <div
          onClick={() => setCurrentTab('create')}
          className="flex items-center gap-3 cursor-pointer group whitespace-nowrap shrink-0"
          id="brand-logo"
        >
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-[#4E654E] flex items-center justify-center text-[#FAF7F2] shadow-sm group-hover:bg-[#3E523E] transition-colors border border-[#3E523E]/20">
            <Hammer className="w-5 h-5 sm:w-6 sm:h-6 text-[#E7EFE6]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl sm:text-2xl font-bold font-artisan tracking-tight text-[#423023]">
                CraftCopy
              </span>
            </div>
            <p className="text-[12px] text-[#7C6A59] hidden sm:block">
              AI Marketing &amp; Promotional Posters for Independent Makers
            </p>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex items-center gap-1 sm:gap-2 whitespace-nowrap">
          <button
            id="nav-tab-create"
            onClick={() => setCurrentTab('create')}
            className={`flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap shrink-0 ${
              currentTab === 'create'
                ? 'bg-[#4E654E] text-[#FAF7F2] shadow-xs'
                : 'text-[#6E5038] hover:bg-[#EFE7DA]'
            }`}
          >
            <Sparkles className="w-4 h-4 text-[#C59B3C]" />
            <span>Create Poster</span>
          </button>

          <button
            id="nav-tab-ideas"
            onClick={() => setCurrentTab('ideas')}
            className={`flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl text-xs sm:text-sm font-medium transition-all whitespace-nowrap shrink-0 ${
              currentTab === 'ideas'
                ? 'bg-[#4E654E] text-[#FAF7F2] shadow-xs'
                : 'text-[#6E5038] hover:bg-[#EFE7DA]'
            }`}
          >
            <Lightbulb className="w-4 h-4 text-[#C59B3C]" />
            <span className="hidden xs:inline">Product Ideas</span>
            <span className="xs:hidden">Ideas</span>
          </button>

          <button
            id="nav-tab-catalog"
            onClick={() => setCurrentTab('catalog')}
            className={`flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl text-xs sm:text-sm font-medium transition-all relative whitespace-nowrap shrink-0 ${
              currentTab === 'catalog'
                ? 'bg-[#4E654E] text-[#FAF7F2] shadow-xs'
                : 'text-[#6E5038] hover:bg-[#EFE7DA]'
            }`}
          >
            <Bookmark className="w-4 h-4" />
            <span>Saved</span>
            {savedCount > 0 && (
              <span className="ml-1 px-1.5 py-0.2 bg-[#C59B3C] text-white text-[11px] font-bold rounded-full">
                {savedCount}
              </span>
            )}
          </button>
        </nav>

        {/* Right Profile & SDG 9 Actions */}
        <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
          <button
            id="nav-btn-basic-info"
            onClick={onOpenSellerInfo}
            className="flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-xs sm:text-sm font-medium text-[#5A4535] hover:bg-[#EFE7DA] border border-[#E0D3C3] transition-colors"
            title="View & Edit Business Profile"
          >
            <User className="w-3.5 h-3.5 text-[#4E654E]" />
            <span className="hidden md:inline">{makerName || 'Business Profile'}</span>
          </button>

          <button
            id="nav-tab-sdg"
            onClick={onOpenSdg}
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-[#E7EFE6] text-[#344834] hover:bg-[#D9E6D8] transition-colors border border-[#C5DAC3]"
            title="UN Sustainable Development Goal 9: Industry, Innovation and Infrastructure"
          >
            <Globe className="w-3.5 h-3.5 text-[#4E654E]" />
            <span>SDG 9</span>
          </button>
        </div>
      </div>
    </header>
  );
};

