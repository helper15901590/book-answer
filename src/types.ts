export type UserRole = 'member' | 'admin';

export type MembershipTier =
  | 'free_member'
  | 'monthly_member'
  | 'quarterly_member'
  | 'yearly_member';

export type UserStatus = 'active' | 'disabled' | 'deleted';

export interface DailyLimitsConfig {
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
  status?: UserStatus;
  membershipTier?: MembershipTier;
  membershipExpiresAt?: string;
  mustChangePassword?: boolean;
  dailyMaxChats?: number;
  dailyUsedCount?: number;
  isAdmin?: boolean;
  createdAt?: string;
  updatedAt?: string;
  lastActiveDate?: string;
  lastActiveMonth?: string;
  lastLoginAt?: string;
  deletedAt?: string;
}

export type SkillType = 'book' | 'mentor';

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
  skillType?: SkillType;
}

export type PublicSkill = Pick<
  Skill,
  | 'id'
  | 'title'
  | 'author'
  | 'category'
  | 'coverUrl'
  | 'description'
  | 'tags'
  | 'chatCount'
  | 'searchCount'
  | 'hotScore'
  | 'sampleQuestions'
  | 'skillType'
>;

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  thinkingTime?: number;
  isStreaming?: boolean;
  modelUsed?: string;
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

export type PublicChatSession = Omit<ChatSession, 'userId'>;

export interface LLMConfig {
  apiBaseUrl?: string;
  apiKey?: string;
  apiKeyConfigured?: boolean;
  primaryModel: string;
  timeoutSec: number;
  maxTokens?: number;
  deepseekApiKey: string;
  dailyLimits?: DailyLimitsConfig;
  membershipPlans?: MembershipPlanConfig;
  agreements?: LegalAgreements;
}

export interface AuthPolicy {
  userMinLength: number;
  adminMinLength: number;
  registrationEnabled: boolean;
}

export interface LegalAgreements {
  userAgreementTitle: string;
  userAgreementContent: string;
  privacyPolicyTitle: string;
  privacyPolicyContent: string;
  updatedAt?: string;
}

export interface AuthSessionRecord {
  id: string;
  tokenHash: string;
  subjectType: 'user' | 'admin';
  subjectId: string;
  role: UserRole;
  csrfHash: string;
  authVersion?: string;
  expiresAt: string;
  lastSeenAt: string;
  createdAt: string;
  revokedAt?: string;
  ip?: string;
  userAgent?: string;
}

export interface AdminSecurityRecord {
  id: string;
  totpSecretEnc?: string;
  totpEnabled: boolean;
  recoveryCodeHashes: string[];
  pendingSecretEnc?: string;
  pendingRecoveryHashes: string[];
  authVersion?: string;
  updatedAt: string;
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

// 分类筛选的哨兵值。它同时用于「比较」与「展示」：
// 比较逻辑必须始终使用这个常量，绝不能换成翻译后的文本，否则筛选会失效；
// 只有展示时才通过 t('common.all') 输出当前语言。
export const ALL_CATEGORIES = '全部';

export function formatBookTitle(title: string = ''): string {
  const clean = cleanBookTitle(title);
  return clean ? `《${clean}》` : '';
}

export function formatUserDisplayName(nickname?: string): string {
  if (!nickname) return '普通会员';
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
  if (!user || user.status === 'deleted') return 'free_member';
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

// 各会员等级的有效期月数；0 表示无到期时间（普通会员）
export const MEMBERSHIP_TIER_MONTHS: Record<MembershipTier, number> = {
  free_member: 0,
  monthly_member: 1,
  quarterly_member: 3,
  yearly_member: 12,
};

// 档位高低次序：用于判断某档位相对用户当前档位是升级、续费还是降级
export const MEMBERSHIP_TIER_RANK: Record<MembershipTier, number> = {
  free_member: 0,
  monthly_member: 1,
  quarterly_member: 2,
  yearly_member: 3,
};

// 会员购买动作：由「用户当前档位」与「目标档位」的相对高低决定。
// subscribe 首次开通 / renew 同档续费 / upgrade 升到更高档 / included 低档位权益已被覆盖（不支持主动降级）
export type MembershipAction = 'subscribe' | 'renew' | 'upgrade' | 'included';

export function membershipActionFor(current: MembershipTier, target: MembershipTier): MembershipAction {
  const currentRank = MEMBERSHIP_TIER_RANK[current];
  const targetRank = MEMBERSHIP_TIER_RANK[target];
  if (currentRank === 0) return 'subscribe';
  if (targetRank === currentRank) return 'renew';
  return targetRank > currentRank ? 'upgrade' : 'included';
}

// 等级对应的额度上限：建号、编辑、升级与前端展示共用一处，
// 避免各处各写一套而出现「等级已变、额度还是旧值」的口径不一致。
export function tierDailyLimit(config: LLMConfig | undefined, tier: MembershipTier): number {
  const limits = config?.dailyLimits;
  switch (tier) {
    case 'monthly_member':
      return limits?.monthlyMember ?? 100;
    case 'quarterly_member':
      return limits?.quarterlyMember ?? 200;
    case 'yearly_member':
      return limits?.yearlyMember ?? 500;
    default:
      return limits?.freeMember ?? 10;
  }
}

// 按自然月顺延。必须先把日期钳到目标月的最后一天，否则 1/31 + 1 个月会被 Date 归一化成 3/3，
// 白白多送几天有效期，到期日与标称周期对不上。
function addMonths(date: Date, months: number): Date {
  const day = date.getDate();
  const result = new Date(date);
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDayOfTargetMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDayOfTargetMonth));
  return result;
}

// 会员到期时间（升级/续费）：在尚未过期的现有有效期上顺延，不吞掉用户已付费的剩余时长。
// 普通会员返回 undefined，表示清除到期时间。
export function membershipExpiryAfterRenewal(currentExpiry: string | undefined, tier: MembershipTier): string | undefined {
  const months = MEMBERSHIP_TIER_MONTHS[tier];
  if (!months) return undefined;
  const base = currentExpiry && new Date(currentExpiry).getTime() > Date.now() ? new Date(currentExpiry) : new Date();
  return addMonths(base, months).toISOString();
}

// 会员到期时间（后台配置）：一律以「当前真实时间」为基准，从现在起算一个完整周期。
// 管理员在后台改等级属于重新配置权益，不是在原有效期上续期，因此不叠加剩余时长——
// 若叠加，管理员每次点保存都会白白送出一个月，且到期日会越滚越远、无法与真实周期对上。
export function membershipExpiryFromNow(tier: MembershipTier): string | undefined {
  return membershipExpiryAfterRenewal(undefined, tier);
}

// 会员等级的展示文案已改用多语言键，见 src/i18n/format.ts 的 membershipTierKey()。
// 此处不再提供中文文案函数，避免界面文案与语言状态脱节。