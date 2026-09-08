import React from 'react';
import { X, Crown, AlertTriangle } from 'lucide-react';
import { LLMConfig, MembershipTier } from '../types';

interface MembershipModalProps {
  llmConfig: LLMConfig;
  currentTier?: MembershipTier;
  onClose: () => void;
}

// 会员订阅窗口：展示三档套餐与价格（来自后台 membershipPlans 配置）。
// 开通功能当前禁用（支付未开放，账号与会员权益由管理员统一开通），按钮置灰仅可浏览。
export const MembershipModal: React.FC<MembershipModalProps> = ({ llmConfig, currentTier, onClose }) => {
  const plans = llmConfig?.membershipPlans;
  const limits = llmConfig?.dailyLimits;

  const tiers = [
    { key: 'monthly_member' as MembershipTier, name: '月度会员', price: plans?.monthlyPrice, quota: limits?.monthlyMember ?? 100, unit: '/月' },
    { key: 'quarterly_member' as MembershipTier, name: '季度会员', price: plans?.quarterlyPrice, quota: limits?.quarterlyMember ?? 200, unit: '/季' },
    { key: 'yearly_member' as MembershipTier, name: '年度会员', price: plans?.yearlyPrice, quota: limits?.yearlyMember ?? 500, unit: '/年' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl border border-gray-200 overflow-hidden flex flex-col antialiased text-left">
        {/* Header（与登录弹窗同风格） */}
        <div className="px-5 py-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
          <span className="font-bold text-sm text-gray-900 tracking-tight flex items-center gap-1.5">
            <Crown className="w-4 h-4 text-[#8c6227]" />
            会员订阅
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-900 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {/* 禁用态公告 */}
          <div className="p-2 bg-rose-50 border border-rose-200 rounded-xl text-[11px] text-rose-600 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>会员开通暂未开放，请联系管理员开通</span>
          </div>

          {/* 三档套餐卡片 */}
          {tiers.map((t) => {
            const isCurrent = currentTier === t.key;
            return (
              <div
                key={t.key}
                className={`rounded-xl border p-3.5 flex items-center justify-between gap-3 ${
                  isCurrent ? 'border-[#e2dacd] bg-[#faf7f1]' : 'border-gray-200 bg-white'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                    {t.name}
                    {isCurrent && (
                      <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-[#f4efe6] text-[#8c6227] border border-[#e2dacd] font-medium">
                        当前档位
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5">每月 {t.quota} 次调用额度</div>
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  <div className="text-right">
                    <span className="text-sm font-bold text-gray-900">¥{t.price ?? '--'}</span>
                    <span className="text-[10px] text-gray-400 ml-0.5">{t.unit}</span>
                  </div>
                  <button
                    type="button"
                    disabled
                    title="会员开通暂未开放，请联系管理员"
                    className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed"
                  >
                    开通
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
