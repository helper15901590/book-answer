import { db } from '../../src/db.js';
import { UserProfile, MembershipTier, getEffectiveMembershipTier } from '../../src/types.js';

// =========================================================================
// Membership-based Multi-tier Quota Verification & Consumption Engine
// =========================================================================
export function checkAndConsumeQuota(
  user: UserProfile | null,
  skill: any,
  llmConfig: any
): {
  allowed: boolean;
  status?: number;
  error?: string;
  message?: string;
  tier?: MembershipTier;
  updatedUser?: UserProfile;
} {
  const guestLimit = llmConfig.dailyLimits?.guestUser ?? 3;
  const freeMemberLimit = llmConfig.dailyLimits?.freeMember ?? 10;
  const monthlyLimit = llmConfig.dailyLimits?.monthlyMember ?? 100;
  const quarterlyLimit = llmConfig.dailyLimits?.quarterlyMember ?? 200;
  const yearlyLimit = llmConfig.dailyLimits?.yearlyMember ?? 500;

  const isAdmin = user?.role === 'admin' || user?.isAdmin;
  if (isAdmin) {
    return { allowed: true, updatedUser: user || undefined };
  }

  const effectiveTier = getEffectiveMembershipTier(user);

  // 1. Guest (Unauthenticated or guest role)
  if (effectiveTier === 'guest' || !user) {
    const used = user?.guestUsedCount || 0;
    if (used >= guestLimit) {
      return {
        allowed: false,
        status: 401,
        error: 'GUEST_LIMIT_REACHED',
        message: `您当前还未注册登录，享有的体验额度${guestLimit}次已用完，请登录后继续体验。`,
        tier: 'guest',
      };
    }
    if (user) {
      user.guestUsedCount = used + 1;
      user.dailyMaxChats = guestLimit;
      const saved = db.saveUser(user);
      return { allowed: true, tier: 'guest', updatedUser: saved };
    }
    return { allowed: true, tier: 'guest' };
  }

  // 2. Free Member (Registered user without active VIP)
  if (effectiveTier === 'free_member') {
    const used = user.dailyUsedCount || 0;
    if (used >= freeMemberLimit) {
      return {
        allowed: false,
        status: 403,
        error: 'PAYWALL_REQUIRED',
        message: `本月普通会员免费额度已达上限 (${freeMemberLimit}/${freeMemberLimit}次)。开通月度/季度/年度会员，尊享每月超高频原著导师畅答与极速推理！`,
        tier: 'free_member',
      };
    }
    user.dailyUsedCount = used + 1;
    user.dailyMaxChats = freeMemberLimit;
    const saved = db.saveUser(user);
    return { allowed: true, tier: 'free_member', updatedUser: saved };
  }

  // 3. Monthly VIP
  if (effectiveTier === 'monthly_member') {
    const used = user.dailyUsedCount || 0;
    if (used >= monthlyLimit) {
      return {
        allowed: false,
        status: 429,
        error: 'VIP_LIMIT_REACHED',
        message: `您本月月度会员对话额度已达上限 (${monthlyLimit}/${monthlyLimit}次)，每月1日零点自动刷新，请下月继续交流。`,
        tier: 'monthly_member',
      };
    }
    user.dailyUsedCount = used + 1;
    user.dailyMaxChats = monthlyLimit;
    const saved = db.saveUser(user);
    return { allowed: true, tier: 'monthly_member', updatedUser: saved };
  }

  // 4. Quarterly VIP
  if (effectiveTier === 'quarterly_member') {
    const used = user.dailyUsedCount || 0;
    if (used >= quarterlyLimit) {
      return {
        allowed: false,
        status: 429,
        error: 'VIP_LIMIT_REACHED',
        message: `您本月季度会员对话额度已达上限 (${quarterlyLimit}/${quarterlyLimit}次)，每月1日零点自动刷新，请下月继续交流。`,
        tier: 'quarterly_member',
      };
    }
    user.dailyUsedCount = used + 1;
    user.dailyMaxChats = quarterlyLimit;
    const saved = db.saveUser(user);
    return { allowed: true, tier: 'quarterly_member', updatedUser: saved };
  }

  // 5. Yearly VIP
  if (effectiveTier === 'yearly_member') {
    const used = user.dailyUsedCount || 0;
    if (used >= yearlyLimit) {
      return {
        allowed: false,
        status: 429,
        error: 'VIP_LIMIT_REACHED',
        message: `您本月年度会员对话额度已达上限 (${yearlyLimit}/${yearlyLimit}次)，每月1日零点自动刷新，请下月继续交流。`,
        tier: 'yearly_member',
      };
    }
    user.dailyUsedCount = used + 1;
    user.dailyMaxChats = yearlyLimit;
    const saved = db.saveUser(user);
    return { allowed: true, tier: 'yearly_member', updatedUser: saved };
  }

  return { allowed: true, updatedUser: user };
}
