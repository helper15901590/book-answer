import React from 'react';
import { Skill, UserProfile, formatBookTitle, cleanBookTitle } from '../types';
import { X, MessageSquare } from 'lucide-react';

interface BookDetailModalProps {
  skill: Skill | null;
  user?: UserProfile;
  isOpen: boolean;
  onClose: () => void;
  onStartChat?: (skill: Skill) => void;
}

export const BookDetailModal: React.FC<BookDetailModalProps> = ({
  skill,
  user,
  isOpen,
  onClose,
  onStartChat,
}) => {
  if (!isOpen || !skill) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-lg h-[480px] rounded-2xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150 cursor-default text-left relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 bg-gray-50/90 border-b border-gray-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-sm font-bold text-gray-900 font-serif truncate">
              {formatBookTitle(skill.title)} · 内容详情
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
            title="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body - Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 text-xs sm:text-sm text-gray-700 leading-relaxed whitespace-pre-line select-text">
          {skill.description || '暂无内容介绍'}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between shrink-0">
          {/* Left-bottom: Author & Category info */}
          <div className="text-xs text-gray-500">
            <span>作者：{skill.author}</span>
            <span className="mx-1.5 text-gray-300">|</span>
            <span>分类：{skill.category || '通识'}</span>
          </div>

          {/* Right-bottom: Chat Button */}
          <button
            type="button"
            onClick={() => {
              onClose();
              if (onStartChat) onStartChat(skill);
            }}
            className="px-2 py-1 bg-transparent hover:bg-transparent text-[#8c6227] hover:text-[#5c3e14] text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 group/btn hover:scale-105 border-0 shadow-none outline-none"
          >
            <MessageSquare className="w-3.5 h-3.5 text-[#8c6227] group-hover/btn:text-[#5c3e14]" />
            <span className="group-hover/btn:underline underline-offset-2">进入对话</span>
          </button>
        </div>
      </div>
    </div>
  );
};
