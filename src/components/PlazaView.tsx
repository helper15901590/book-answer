import React from 'react';
import { X } from 'lucide-react';
import { ALL_CATEGORIES, Skill, UserProfile } from '../types';
import { useI18n } from '../i18n';
import { PlazaController } from '../lib/usePlazaController';
import MarketSection from './MarketSection';
import { BookDetailModal } from './BookDetailModal';

interface PlazaViewProps {
  controller: PlazaController;
  user?: UserProfile;
  searchPlaceholder: string;
  unitLabel: string;
  /** 全部标签弹窗的标题（书籍 / 导师 / 可靠各不相同） */
  allTagsTitle: string;
  renamedCategoriesMap: Record<string, string>;
  deletedCategoriesSet: Set<string>;
  followedSkillIds: Set<string>;
  onToggleFollow: (skill: Skill) => void;
  onSelectSkill: (skill: Skill) => void;
}

// 书籍 / 导师 / 可靠三个广场共用的视图壳：数据与状态由 usePlazaController 提供，
// 这里只负责把 MarketSection、全部标签弹窗与详情弹窗拼在一起。
export const PlazaView: React.FC<PlazaViewProps> = ({
  controller,
  user,
  searchPlaceholder,
  unitLabel,
  allTagsTitle,
  renamedCategoriesMap,
  deletedCategoriesSet,
  followedSkillIds,
  onToggleFollow,
  onSelectSkill,
}) => {
  const { t } = useI18n();
  const { categories } = controller;

  return (
    <>
      <MarketSection
        search={controller.search}
        onSearchChange={controller.setSearch}
        searchPlaceholder={searchPlaceholder}
        tagsContainerRef={controller.tagsContainerRef}
        selectedCategory={controller.selectedCategory}
        onCategoryChange={controller.setSelectedCategory}
        allSkillsCount={controller.allSkillsCount}
        otherCategories={controller.otherCategories}
        maxVisibleCategories={controller.maxVisibleCategories}
        onOpenAllCategories={controller.openAllCategories}
        filteredSkills={controller.filteredSkills}
        displayedSkills={controller.displayedSkills}
        sortedSkills={controller.sortedSkills}
        user={user}
        renamedCategoriesMap={renamedCategoriesMap}
        deletedCategoriesSet={deletedCategoriesSet}
        validCategories={categories}
        hasMoreCards={controller.hasMoreCards}
        onLoadMore={controller.loadMore}
        pageSize={controller.pageSize}
        remainingCount={controller.remainingCount}
        onSelectSkill={onSelectSkill}
        onViewDetail={controller.openDetail}
        unitLabel={unitLabel}
        followedSkillIds={followedSkillIds}
        onToggleFollow={onToggleFollow}
      />

      {/* 全部标签弹窗（内部状态由 controller 统一持有，三个广场共用同一套 UI） */}
      {controller.isAllCategoriesModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-gray-200 p-6 space-y-4 text-left relative animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <h3 className="text-base font-bold text-gray-900 font-serif flex items-center gap-2">
                <span>{allTagsTitle}</span>
                <span className="text-xs font-sans font-normal text-gray-500">
                  {t('workspace.tagsCount', { count: categories.length })}
                </span>
              </h3>
              <button
                onClick={controller.closeAllCategories}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 max-h-[55vh] overflow-y-auto p-1">
              {categories.map((cat) => {
                const isSelected = cat === controller.selectedCategory;
                return (
                  <button
                    key={cat}
                    onClick={() => controller.selectCategory(cat)}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#f4efe6] text-[#2c221e] font-bold shadow-xs border border-[#e2d8c3]'
                        : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                    }`}
                  >
                    #{cat === ALL_CATEGORIES ? t('workspace.allWithCount', { count: controller.allSkillsCount }) : cat}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <BookDetailModal
        skill={controller.detailSkill}
        user={user}
        isOpen={Boolean(controller.detailSkill)}
        onClose={controller.closeDetail}
        onStartChat={(skill) => {
          controller.closeDetail();
          onSelectSkill(skill);
        }}
      />
    </>
  );
};
