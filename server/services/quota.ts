import { db } from '../db.js';
import { UserProfile, MembershipTier, getEffectiveMembershipTier } from '../../src/types.js';

export interface QuotaReservation {
  allowed: boolean;
  status?: number;
  error?: string;
  message?: string;
  tier?: MembershipTier;
  ledgerId?: string;
}

export function reserveQuota(user: UserProfile, llmConfig: any, requestId: string): QuotaReservation {
  if (!user || !user.id) {
    return { allowed: false, status: 401, error: 'UNAUTHENTICATED', message: '请先登录后继续' };
  }
  if (user.status !== 'active') {
    return { allowed: false, status: 403, error: 'ACCOUNT_RESTRICTED', message: '账号当前不可用' };
  }
  if (user.role === 'admin' || user.isAdmin) return { allowed: true };

  const effectiveTier = getEffectiveMembershipTier(user);
  const limits = {
    free_member: llmConfig.dailyLimits?.freeMember ?? 10,
    monthly_member: llmConfig.dailyLimits?.monthlyMember ?? 100,
    quarterly_member: llmConfig.dailyLimits?.quarterlyMember ?? 200,
    yearly_member: llmConfig.dailyLimits?.yearlyMember ?? 500,
  };
  const limit = limits[effectiveTier];
  const reserved = db.reserveQuota(user.id, limit, requestId);
  if (!reserved.allowed) {
    const isFree = effectiveTier === 'free_member';
    return {
      allowed: false,
      status: isFree ? 403 : 429,
      error: isFree ? 'PAYWALL_REQUIRED' : 'VIP_LIMIT_REACHED',
      message: isFree
        ? `今日普通会员免费额度已达上限 (${limit}/${limit}次)，每日零点自动刷新。`
        : `当前会员等级的本期对话额度已达上限 (${limit}/${limit}次)，到期后自动刷新。`,
      tier: effectiveTier,
    };
  }
  return { allowed: true, tier: effectiveTier, ledgerId: reserved.ledgerId };
}

export function settleQuota(ledgerId: string | undefined, status: 'consumed' | 'refunded'): void {
  if (ledgerId) db.settleQuota(ledgerId, status);
}