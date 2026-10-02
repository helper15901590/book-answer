import type { Dictionary } from './locales/zh-CN';
import type { Locale, TranslationKey, TVars } from './types';
import type { MembershipTier } from '../types';

// 占位符统一写作 {name}。注意不能用带点的名字（如 {user.id}），否则 \w+ 匹配不到。
export function interpolate(template: string, vars?: TVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    vars[key] === undefined ? whole : String(vars[key])
  );
}

// 按点号路径取值。取不到时原样返回键名，便于一眼看出漏配。
export function lookup(dict: Dictionary, key: TranslationKey): string {
  const value = key
    .split('.')
    .reduce<unknown>((node, segment) => (node == null ? undefined : (node as Record<string, unknown>)[segment]), dict);
  return typeof value === 'string' ? value : key;
}

// 数量简写：中文语境用「万」（沿用原有写法），英文用 K
export function formatCompactCount(count: number | undefined, locale: Locale): string {
  const value = count || 0;
  if (locale === 'en') return value >= 1000 ? `${(value / 1000).toFixed(1)}K` : String(value);
  return value >= 10000 ? `${(value / 10000).toFixed(1)}w` : String(value);
}

// 书名包裹符号：中文用《》，英文用双引号
export function formatBookTitleByLocale(title: string, locale: Locale): string {
  const clean = (title || '').replace(/^[《<]+|[》>]+$/g, '').trim();
  if (!clean) return '';
  return locale === 'en' ? `“${clean}”` : `《${clean}》`;
}

// 会员等级 → 文案键。翻译交给组件，这里只负责映射。
export function membershipTierKey(tier: MembershipTier): TranslationKey {
  switch (tier) {
    case 'monthly_member':
      return 'tier.monthly';
    case 'quarterly_member':
      return 'tier.quarterly';
    case 'yearly_member':
      return 'tier.yearly';
    default:
      return 'tier.free';
  }
}
