import type { Dictionary } from './zh-CN';
import type { Locale } from '../types';
import { zhCN } from './zh-CN';
import { zhTW } from './zh-TW';
import { en } from './en';

// Record<Locale, Dictionary> 保证新增语言时必须补齐整份字典
export const dictionaries: Record<Locale, Dictionary> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  en,
};
