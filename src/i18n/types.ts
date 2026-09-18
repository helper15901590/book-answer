import type { Dictionary } from './locales/zh-CN';

// 支持的语言。顺序即切换器中的展示顺序。
export const LOCALES = ['zh-CN', 'zh-TW', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

// 递归推导字典所有叶子节点的点号路径，例如 'brand.name' | 'workspace.login'。
// 用它约束 t() 的参数，键名写错会在编译期报错。
type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends Record<string, unknown> ? Leaves<T[K], `${P}${K}.`> : `${P}${K}`;
}[keyof T & string];

export type TranslationKey = Leaves<Dictionary>;

// 插值变量统一用 {name} 形式；未匹配到的占位符会原样保留，便于一眼发现漏配
export type TVars = Record<string, string | number>;
export type TFunction = (key: TranslationKey, vars?: TVars) => string;
