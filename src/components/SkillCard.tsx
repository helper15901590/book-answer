import React from 'react';
import { MessageSquare, Flame } from 'lucide-react';
import { Skill, UserProfile, cleanBookTitle } from '../types';

interface SkillCardProps {
  skill: Skill;
  rank?: number;
  user?: UserProfile;
  selectedCategory?: string;
  renamedCategoriesMap?: Record<string, string>;
  deletedCategoriesSet?: Set<string>;
  validCategories?: string[];
  onSelectSkill: (skill: Skill) => void;
  onViewDetail?: (skill: Skill) => void;
}

export const SkillCard: React.FC<SkillCardProps> = ({
  skill,
  rank,
  user,
  selectedCategory,
  renamedCategoriesMap,
  deletedCategoriesSet,
  validCategories,
  onSelectSkill,
  onViewDetail,
}) => {
  const formatCount = (count?: number) => {
    if (!count) return '0';
    if (count >= 10000) {
      return `${(count / 10000).toFixed(1)}w`;
    }
    return `${count}`;
  };

  const getRankText = (r?: number) => {
    if (r === undefined || r <= 0) return null;
    if (r <= 100) return `TOP ${r}`;
    return `TOP 100+`;
  };

  const rankText = getRankText(rank);

  // Combine category and tags into a single unified list of unique tags, filtered strictly against database tags
  const rawTags = Array.from(
    new Set(
      [skill.category, ...(skill.tags || [])]
        .filter(Boolean)
        .map((t) => renamedCategoriesMap?.[t] || t)
        .filter((t) => !deletedCategoriesSet?.has(t))
        .filter((t) => !validCategories || validCategories.includes(t))
    )
  );

  let displayTags = rawTags;
  if (selectedCategory && selectedCategory !== '全部' && rawTags.includes(selectedCategory)) {
    displayTags = [selectedCategory, ...rawTags.filter((t) => t !== selectedCategory)];
  }

  const primaryCategory = displayTags[0] || skill.category || '精选';

  const handleCardClick = () => {
    if (onViewDetail) {
      onViewDetail(skill);
    } else {
      onSelectSkill(skill);
    }
  };

  return (
    <div
      onClick={handleCardClick}
      className="group bg-white hover:bg-gray-50/90 rounded-2xl p-3.5 flex flex-col justify-between gap-3 cursor-pointer border border-gray-200/80 hover:border-gray-300 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 relative overflow-hidden h-full"
    >
      {/* 1. Header: TOP排行 + 热度 */}
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 pb-2.5">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          {rankText && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#f4efe6] text-[#8c6227] border border-[#e2d8c3] shrink-0">
              {rankText}
            </span>
          )}
        </div>

        {/* 热度 */}
        <div className="flex items-center gap-1 text-[11px] text-gray-500 font-medium shrink-0">
          <Flame className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
          <span>{formatCount(skill.searchCount)} 热度</span>
        </div>
      </div>

      {/* 2. Content Row: Left = Cover Image, Right = Title & Author, Description */}
      <div className="flex gap-3.5 items-start flex-1 min-w-0">
        {/* Cover Image */}
        <div className="w-20 h-28 rounded-xl overflow-hidden bg-gray-100 shrink-0 shadow-xs group-hover:scale-[1.02] transition-transform duration-200 relative border border-gray-200/80">
          <img
            src={skill.coverUrl}
            alt={skill.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-r from-black/25 to-transparent pointer-events-none" />
        </div>

        {/* Right Info Column */}
        <div className="flex-1 min-w-0 flex flex-col justify-between h-full">
          <div>
            {/* Title & Author on the same line */}
            <div className="flex items-baseline gap-1.5 min-w-0 flex-wrap">
              <h3 className="text-sm font-bold text-gray-900 group-hover:text-black transition-colors leading-snug truncate max-w-full">
                {cleanBookTitle(skill.title)}
              </h3>
              <span className="text-[11px] text-gray-400 font-medium truncate shrink-0">
                · {skill.author}
              </span>
            </div>

            <p className="text-xs text-gray-600 line-clamp-3 leading-relaxed mt-1.5">
              {skill.description}
            </p>
          </div>

          {/* Action Footer: Left = Tag / Category Badge, Right = Chat Button */}
          <div className="flex items-center justify-between gap-1.5 pt-2 mt-auto">
            {/* Left-bottom corner: Primary Category Tag */}
            <div className="flex items-center">
              <span className="text-[11px] text-gray-400 font-medium select-none truncate max-w-[120px]">
                {primaryCategory}
              </span>
            </div>

            {/* Right-bottom corner: Chat Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelectSkill(skill);
              }}
              className="px-1 py-1 text-xs font-semibold text-[#8c6227] hover:text-[#5c3e14] bg-transparent hover:bg-transparent rounded-lg transition-all duration-150 flex items-center gap-1 cursor-pointer shrink-0 active:scale-95 whitespace-nowrap group/btn hover:scale-105"
              title="进入对话"
            >
              <MessageSquare className="w-3.5 h-3.5 transition-transform group-hover/btn:scale-110" />
              <span className="group-hover/btn:underline underline-offset-2">对话</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
