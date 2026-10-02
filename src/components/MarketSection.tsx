import React from 'react';
import { Search, X, ChevronDown } from 'lucide-react';
import { Skill, UserProfile, ALL_CATEGORIES } from '../types';
import { SkillCard } from './SkillCard';
import { useI18n } from '../i18n';

interface MarketSectionProps {
  /** 搜索关键词 */
  search: string;
  onSearchChange: (val: string) => void;
  /** 搜索框占位文案（由父组件传入，因为函数默认参数里不能用 Hook 取翻译） */
  searchPlaceholder: string;
  /** 分类标签 */
  tagsContainerRef: React.RefObject<HTMLDivElement | null>;
  selectedCategory: string;
  onCategoryChange: (cat: string) => void;
  allSkillsCount: number;
  otherCategories: string[];
  maxVisibleCategories: number;
  onOpenAllCategories: () => void;
  /** 数据 */
  filteredSkills: Skill[];
  displayedSkills: Skill[];
  sortedSkills: Skill[];
  user?: UserProfile;
  renamedCategoriesMap: Record<string, string>;
  deletedCategoriesSet: Set<string>;
  validCategories: string[];
  /** 分页 */
  hasMoreCards: boolean;
  onLoadMore: () => void;
  pageSize: number;
  remainingCount: number;
  /** 卡片事件 */
  onSelectSkill: (skill: Skill) => void;
  onViewDetail: (skill: Skill) => void;
  /** 尾部文案单位（"本原著书籍" / "位导师"） */
  unitLabel: string;
}

export default function MarketSection({
  search,
  onSearchChange,
  searchPlaceholder,
  tagsContainerRef,
  selectedCategory,
  onCategoryChange,
  allSkillsCount,
  otherCategories,
  maxVisibleCategories,
  onOpenAllCategories,
  filteredSkills,
  displayedSkills,
  sortedSkills,
  user,
  renamedCategoriesMap,
  deletedCategoriesSet,
  validCategories,
  hasMoreCards,
  onLoadMore,
  pageSize,
  remainingCount,
  onSelectSkill,
  onViewDetail,
  unitLabel,
}: MarketSectionProps) {
  const { t } = useI18n();

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-gray-50/50">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 md:gap-4">
        {/* Search Bar */}
        <div className="relative w-full sm:w-72 md:w-80 shrink-0">
          <Search className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full pl-11 pr-10 py-2 bg-white text-sm text-gray-900 placeholder:text-gray-400 rounded-full outline-none focus:ring-2 focus:ring-gray-300 transition-all font-sans shadow-xs border border-gray-200"
          />
          {search && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Category Tags */}
        <div className="relative flex-1 min-w-0 flex items-center">
          <div
            ref={tagsContainerRef}
            className="max-h-[68px] overflow-hidden flex flex-wrap items-center gap-1.5 sm:gap-2 transition-all w-full"
          >
            {/* 全部 */}
            <button
              onClick={() => onCategoryChange(ALL_CATEGORIES)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
                selectedCategory === ALL_CATEGORIES
                  ? 'bg-[#f4efe6] text-[#2c221e] font-bold shadow-2xs'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/80'
              }`}
            >
              {t('market.allTag', { count: allSkillsCount })}
            </button>

            {/* Category Tags */}
            {(() => {
              const visibleList = otherCategories.slice(0, maxVisibleCategories);
              const hasMore = maxVisibleCategories < otherCategories.length;

              return (
                <>
                  {visibleList.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => onCategoryChange(cat)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
                        selectedCategory === cat
                          ? 'bg-[#f4efe6] text-[#2c221e] font-bold shadow-2xs'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/80'
                      }`}
                    >
                      #{cat}
                    </button>
                  ))}

                  {hasMore && (
                    <button
                      onClick={onOpenAllCategories}
                      className="px-2 py-1 rounded-lg text-xs font-bold text-gray-500 hover:text-gray-900 hover:bg-gray-100/80 cursor-pointer transition-colors whitespace-nowrap"
                      title={t('market.viewAllTags')}
                    >
                      ...
                    </button>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Grid Layout: Displays 3 items per row on lg screens */}
      {filteredSkills.length === 0 ? (
        <div className="p-12 text-center text-sm text-gray-400">{t('market.empty')}</div>
      ) : (
        <div className="space-y-6 pb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayedSkills.map((skill) => {
              const globalRank = sortedSkills.findIndex((s) => s.id === skill.id) + 1;
              return (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  rank={globalRank}
                  user={user}
                  selectedCategory={selectedCategory}
                  renamedCategoriesMap={renamedCategoriesMap}
                  deletedCategoriesSet={deletedCategoriesSet}
                  validCategories={validCategories}
                  onSelectSkill={onSelectSkill}
                  onViewDetail={onViewDetail}
                />
              );
            })}
          </div>

          {/* Load more / expand button when >= 20 cards */}
          {hasMoreCards && (
            <div className="flex flex-col items-center justify-center pt-3 pb-4">
              <button
                type="button"
                onClick={onLoadMore}
                className="group px-6 py-2.5 rounded-full bg-white hover:bg-[#f4efe6] text-[#2c221e] border border-gray-300 hover:border-[#ded3be] text-xs font-semibold shadow-2xs hover:shadow-xs transition-all duration-200 flex items-center gap-2 cursor-pointer active:scale-98"
              >
                <span>{t('market.loadMore')}</span>
                <span className="text-gray-400 group-hover:text-gray-600 font-normal">
                  {t('market.loadMoreHint', { shown: displayedSkills.length, total: filteredSkills.length, remaining: remainingCount })}
                </span>
                <ChevronDown className="w-4 h-4 text-gray-500 group-hover:text-[#2c221e] group-hover:translate-y-0.5 transition-transform" />
              </button>
            </div>
          )}

          {!hasMoreCards && filteredSkills.length > pageSize && (
            <div className="text-center py-4 text-xs text-gray-400 flex items-center justify-center gap-2">
              <span className="w-8 h-px bg-gray-200"></span>
              <span>{t('market.allShown', { count: filteredSkills.length, unit: unitLabel })}</span>
              <span className="w-8 h-px bg-gray-200"></span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
