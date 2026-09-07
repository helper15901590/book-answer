export type UserRole = 'guest' | 'member' | 'admin';

export type MembershipTier =
  | 'guest'
  | 'free_member'
  | 'monthly_member'
  | 'quarterly_member'
  | 'yearly_member';

export interface DailyLimitsConfig {
  guestUser?: number;
  freeMember?: number;
  monthlyMember?: number;
  quarterlyMember?: number;
  yearlyMember?: number;
}

export interface MembershipPlanConfig {
  monthlyPrice: number;
  quarterlyPrice: number;
  yearlyPrice: number;
}

export interface UserProfile {
  id: string;
  unionId: string;
  phone?: string;
  password?: string;
  nickname: string;
  avatar: string;
  role: UserRole;
  membershipTier?: MembershipTier;
  membershipExpiresAt?: string; // ISO string for paid VIP expiration
  dailyMaxChats?: number;
  dailyUsedCount?: number;
  monthlyUsedCount?: number;
  guestUsedCount?: number;
  isAdmin?: boolean;
  createdAt?: string;
  lastActiveDate?: string;
  lastActiveMonth?: string;
  token?: string;
}

export interface Skill {
  id: string;
  title: string;
  author: string;
  category: string;
  coverUrl: string;
  description: string;
  tags: string[];
  systemPrompt: string;
  catalogContent?: string;
  bookContent?: string;
  tokenCount?: number;
  preferredModel?: string;
  chatCount?: number;
  searchCount?: number;
  hotScore?: number;
  sampleQuestions?: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  thinkingTime?: number;
  isStreaming?: boolean;
  modelUsed?: string;
  isFallback?: boolean;
  recommendedQuestions?: string[];
}

export interface ChatSession {
  id: string;
  userId?: string;
  skillId: string;
  skillTitle: string;
  skillAuthor: string;
  skillCoverUrl: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface LLMConfig {
  apiBaseUrl?: string;
  apiKey?: string;
  primaryProvider: 'deepseek' | 'custom';
  primaryModel: string;
  fallbackProvider?: 'deepseek' | 'custom';
  fallbackModel?: string;
  timeoutSec: number;
  maxTokens?: number;
  deepseekApiKey: string;
  dailyLimits?: DailyLimitsConfig;
  membershipPlans?: MembershipPlanConfig;
  agreements?: LegalAgreements;
}

export interface LegalAgreements {
  userAgreementTitle: string;
  userAgreementContent: string;
  privacyPolicyTitle: string;
  privacyPolicyContent: string;
  updatedAt?: string;
}

export type OrderPlanType = 'monthly' | 'quarterly' | 'yearly';

export interface OrderLog {
  id: string;
  tradeNo: string;
  userId: string;
  unionId?: string;
  skillId?: string;
  skillTitle?: string;
  planType?: OrderPlanType;
  planName?: string;
  amount: number;
  type?: 'membership';
  paymentMethod: 'wechat' | 'alipay' | 'card';
  status: 'pending' | 'success' | 'failed';
  createdAt: string;
  paidAt?: string;
}

export function cleanBookTitle(title: string = ''): string {
  return title.replace(/^[《<]+|[》>]+$/g, '').trim();
}

export function formatBookTitle(title: string = ''): string {
  const clean = cleanBookTitle(title);
  return clean ? `《${clean}》` : '';
}

export function formatUserDisplayName(nickname?: string): string {
  if (!nickname) return '普通会员';
  if (nickname === '游客用户' || nickname === '游客') return '游客';
  if (/^\d{11}$/.test(nickname)) {
    return nickname.slice(-4);
  }
  let clean = nickname.replace(/^(新?书友_?|微信用户_?|书友_?)/g, '').trim();
  if (!clean) return nickname;
  const digits = clean.replace(/\D/g, '');
  if (digits.length >= 4) {
    return digits.slice(-4);
  }
  return clean;
}

export function formatMessageTimestamp(raw?: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();

  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(trimmed)) {
    const parts = trimmed.split(':');
    return `${parts[0].padStart(2, '0')}:${parts[1]}`;
  }

  const d = new Date(trimmed);
  if (isNaN(d.getTime())) {
    return trimmed.replace(/[TZ]/g, ' ').slice(0, 16).trim();
  }

  const now = new Date();
  const isSameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');

  if (isSameDay) {
    return `${hours}:${minutes}`;
  }

  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${month}-${day} ${hours}:${minutes}`;
}

export function getEffectiveMembershipTier(user?: UserProfile | null): MembershipTier {
  if (!user || user.role === 'guest' || user.membershipTier === 'guest') return 'guest';
  const tier = user.membershipTier || 'free_member';
  if (tier === 'free_member') return tier;

  if (user.membershipExpiresAt) {
    const expireDate = new Date(user.membershipExpiresAt);
    if (isNaN(expireDate.getTime()) || expireDate.getTime() < Date.now()) {
      return 'free_member';
    }
  }
  return tier;
}

export function getMembershipTierLabel(tier?: MembershipTier): string {
  switch (tier) {
    case 'guest':
      return '游客';
    case 'free_member':
      return '普通会员';
    case 'monthly_member':
      return '月度会员';
    case 'quarterly_member':
      return '季度会员';
    case 'yearly_member':
      return '年度会员';
    default:
      return '普通会员';
  }
}
