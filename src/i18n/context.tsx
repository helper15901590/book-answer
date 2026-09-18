import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { dictionaries } from './locales';
import { interpolate, lookup } from './format';
import { LOCALES, type Locale, type TFunction } from './types';

const STORAGE_KEY = 'book_answer_locale';

// 默认语言：本地保存的选择 > 浏览器语言 > 兜底简体中文
function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (LOCALES as readonly string[]).includes(saved)) return saved as Locale;
  } catch {
    // 隐私模式等禁用 localStorage 的情况，忽略
  }
  const nav = (typeof navigator !== 'undefined' && navigator.language) || '';
  if (/^zh-(TW|HK|MO|Hant)/i.test(nav)) return 'zh-TW';
  if (/^zh/i.test(nav)) return 'zh-CN';
  if (/^en/i.test(nav)) return 'en';
  return 'zh-CN';
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TFunction;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 惰性初始化：首帧就用正确语言，避免先渲染中文再切换的闪烁
  const [locale, setLocale] = useState<Locale>(detectLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // 忽略写入失败
    }
  }, [locale]);

  // t 的引用随语言变化，凡把它放进依赖的 useMemo/useCallback 都会跟着重算
  const t = useCallback<TFunction>(
    (key, vars) => interpolate(lookup(dictionaries[locale], key), vars),
    [locale]
  );

  const value = useMemo<I18nContextValue>(() => ({ locale, setLocale, t }), [locale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n 必须在 I18nProvider 内使用');
  return ctx;
}
