import React, { useState } from 'react';
import { Globe } from 'lucide-react';
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
        title={LOCALE_LABEL[locale]}
        aria-label={LOCALE_LABEL[locale]}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="flex items-center justify-center p-1.5 rounded-full text-gray-500 hover:text-gray-900 hover:bg-gray-100 cursor-pointer transition-colors"
      >
        <Globe className="w-4 h-4" />
      </button>
      {isOpen && (
        <>
          {/* 点击遮罩关闭 */}
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div role="menu" className="absolute right-0 top-full mt-2 w-32 bg-white rounded-2xl shadow-xl p-1.5 z-50 border border-gray-200">
            {LOCALES.map((item) => (
              <button
                key={item}
                type="button"
                role="menuitem"
                aria-current={item === locale}
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
