import React, { useState } from 'react';
import { Star } from 'lucide-react';
import { ALL_CATEGORIES, FollowedSkill, Skill, UserProfile } from '../types';
import { useI18n } from '../i18n';
import { SkillCard } from './SkillCard';
import { BookDetailModal } from './BookDetailModal';

interface FollowListViewProps {
  follows: FollowedSkill[];
  /** 与卡片按钮共享同一份关注集合：列表内取消关注后卡片状态立即同步 */
  followedSkillIds: Set<string>;
  user?: UserProfile;
  onToggleFollow: (skill: Skill) => void;
  onSelectSkill: (skill: Skill) => void;
  onGoBrowse: () => void;
}

export const FollowListView: React.FC<FollowListViewProps> = ({
  follows,
  followedSkillIds,
  user,
  onToggleFollow,
  onSelectSkill,
  onGoBrowse,
}) => {
  const { t } = useI18n();
  const [detailSkill, setDetailSkill] = useState<Skill | null>(null);

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-gray-50/50">
      <div className="flex items-center gap-2">
        <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
        <h2 className="text-sm font-bold text-gray-900">{t('workspace.followList')}</h2>
        <span className="text-xs text-gray-400 font-mono">({follows.length})</span>
      </div>

      {follows.length === 0 ? (
        <div className="p-12 text-center flex flex-col items-center gap-3">
          <Star className="w-10 h-10 text-gray-200" />
          <p className="text-sm font-medium text-gray-600">{t('workspace.followEmpty')}</p>
          <p className="text-xs text-gray-400 max-w-sm leading-relaxed">{t('workspace.followEmptyHint')}</p>
          <button
            type="button"
            onClick={onGoBrowse}
            className="mt-1 px-4 py-1.5 rounded-xl bg-[#f4efe6] text-[#2c221e] border border-[#e2d8c3] text-xs font-bold hover:bg-[#eae3d5] transition-colors cursor-pointer shadow-2xs"
          >
            {t('workspace.goBrowse')}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-6">
          {follows.map((skill) => (
            // FollowedSkill 只含公开字段（不含 systemPrompt）；卡片与前端技能列表本身
            // 也只消费公开字段，这里的断言与现有数据流一致。
            <SkillCard
              key={skill.id}
              skill={skill as unknown as Skill}
              user={user}
              selectedCategory={ALL_CATEGORIES}
              isFollowed={followedSkillIds.has(skill.id)}
              onToggleFollow={onToggleFollow}
              onSelectSkill={onSelectSkill}
              onViewDetail={(item) => setDetailSkill(item)}
            />
          ))}
        </div>
      )}

      <BookDetailModal
        skill={detailSkill}
        user={user}
        isOpen={Boolean(detailSkill)}
        onClose={() => setDetailSkill(null)}
        onStartChat={(skill) => {
          setDetailSkill(null);
          onSelectSkill(skill);
        }}
      />
    </div>
  );
};
