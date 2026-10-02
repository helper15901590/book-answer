import React from 'react';
import { X, Crown, AlertTriangle } from 'lucide-react';
import { LLMConfig, MembershipTier, membershipActionFor, MembershipAction } from '../types';
import { useI18n, type TranslationKey } from '../i18n';

type PaidTier = 'monthly_member' | 'quarterly_member' | 'yearly_member';

// 各购买动作对应的按钮文案键
const MEMBERSHIP_ACTION_KEY: Record<MembershipAction, TranslationKey> = {
  subscribe: 'membership.actionSubscribe',
  renew: 'membership.actionRenew',
  upgrade: 'membership.actionUpgrade',
  included: 'membership.actionIncluded',
};

const TIER_NAME_KEY: Record<PaidTier, TranslationKey> = {
  monthly_member: 'tier.monthly',
  quarterly_member: 'tier.quarterly',
  yearly_member: 'tier.yearly',
};

const TIER_UNIT_KEY: Record<PaidTier, TranslationKey> = {
  monthly_member: 'membership.unitMonth',
  quarterly_member: 'membership.unitQuarter',
  yearly_member: 'membership.unitYear',
};

interface MembershipModalProps {
  llmConfig: LLMConfig;
  currentTier?: MembershipTier;
  onClose: () => void;
}

// 会员订阅窗口：展示三档套餐与价格（来自后台 membershipPlans 配置）。
// 开通功能当前禁用（支付未开放，账号与会员权益由管理员统一开通），按钮置灰仅可浏览。
export const MembershipModal: React.FC<MembershipModalProps> = ({ llmConfig, currentTier, onClose }) => {
  const { t } = useI18n();
  const plans = llmConfig?.membershipPlans;
  const limits = llmConfig?.dailyLimits;

  const current = currentTier ?? 'free_member';

  const tiers: { key: PaidTier; price?: number; quota: number }[] = [
    { key: 'monthly_member', price: plans?.monthlyPrice, quota: limits?.monthlyMember ?? 100 },
    { key: 'quarterly_member', price: plans?.quarterlyPrice, quota: limits?.quarterlyMember ?? 200 },
    { key: 'yearly_member', price: plans?.yearlyPrice, quota: limits?.yearlyMember ?? 500 },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl border border-gray-200 overflow-hidden flex flex-col antialiased text-left">
        {/* Header（与登录弹窗同风格） */}
        <div className="px-5 py-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
          <span className="font-bold text-sm text-gray-900 tracking-tight flex items-center gap-1.5">
            <Crown className="w-4 h-4 text-[#8c6227]" />
            {t('membership.title')}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-900 rounded-lg transition-colors cursor-pointer"
            aria-label={t('common.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {/* 禁用态公告 */}
          <div className="p-2 bg-rose-50 border border-rose-200 rounded-xl text-[11px] text-rose-600 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{t('membership.notice')}</span>
          </div>

          {/* 三档套餐卡片 */}
          {tiers.map((tier) => {
            const isCurrent = currentTier === tier.key;
            const action = membershipActionFor(current, tier.key);
            const isIncluded = action === 'included';
            return (
              <div
                key={tier.key}
                className={`rounded-xl border p-3.5 flex items-center justify-between gap-3 ${
                  isCurrent ? 'border-[#e2dacd] bg-[#faf7f1]' : 'border-gray-200 bg-white'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                    {t(TIER_NAME_KEY[tier.key])}
                    {isCurrent && (
                      <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-[#f4efe6] text-[#8c6227] border border-[#e2dacd] font-medium">
                        {t('membership.currentTier')}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5">{t('membership.quotaMonthly', { quota: tier.quota })}</div>
                </div>
                {/* 价格与按钮都用固定列宽：否则「¥199」比「¥29.9」窄、按钮文案长短不一，
                    三张卡片的这两列会各偏各的 */}
                <div className="flex items-center gap-2.5 shrink-0">
                  <div className="w-20 text-right whitespace-nowrap">
                    <span className="text-sm font-bold text-gray-900">¥{tier.price ?? '--'}</span>
                    <span className="text-[10px] text-gray-400 ml-0.5">{t(TIER_UNIT_KEY[tier.key])}</span>
                  </div>
                  <button
                    type="button"
                    disabled
                    title={t(isIncluded ? 'membership.includedTooltip' : 'membership.disabledTooltip')}
                    className={`w-[72px] py-1.5 rounded-lg text-[11px] font-bold text-center border cursor-not-allowed ${isIncluded ? 'bg-white text-gray-300 border-gray-200' : 'bg-gray-100 text-gray-400 border-gray-200'}`}
                  >
                    {t(MEMBERSHIP_ACTION_KEY[action])}
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
