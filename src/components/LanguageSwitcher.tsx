import React, { useState } from 'react';
import { Languages } from 'lucide-react';
import { LOCALES, useI18n, type Locale } from '../i18n';

// 语言名一律用「该语言自己的写法」，不随界面语言翻译：
// 这样用户在英文界面里也能一眼找到自己的语言。
const LOCALE_LABEL: Record<Locale, string> = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  en: 'English',
};

export const LanguageSwitcher: React.FC = () => {
  const { locale, setLocale } = useI18n();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white hover:bg-gray-50 border border-gray-300 shadow-2xs cursor-pointer text-xs font-medium text-gray-700 transition-colors"
      >
        <Languages className="w-3.5 h-3.5 text-gray-500" />
        <span>{LOCALE_LABEL[locale]}</span>
      </button>
      {isOpen && (
        <>
          {/* 点击遮罩关闭 */}
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-32 bg-white rounded-2xl shadow-xl p-1.5 z-50 border border-gray-200">
            {LOCALES.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setLocale(item);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                  item === locale ? 'bg-gray-100 font-semibold text-gray-900' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {LOCALE_LABEL[item]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
