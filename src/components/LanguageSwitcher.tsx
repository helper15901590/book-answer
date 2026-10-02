import React, { useState } from 'react';
import { LOCALES, useI18n, type Locale } from '../i18n';

// 语言名一律用「该语言自己的写法」，不随界面语言翻译：
// 这样用户在英文界面里也能一眼找到自己的语言。
const LOCALE_LABEL: Record<Locale, string> = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  en: 'English',
};

// 收起态显示的是「点它能切到哪种语言」，而不是当前语言：中文界面显示 En，英文界面显示 中。
// 当前语言的完整名称仍保留在 title / aria-label 与下拉项里。
const LOCALE_SWITCH_LABEL: Record<Locale, string> = {
  'zh-CN': 'En',
  'zh-TW': 'En',
  en: '中',
};

export const LanguageSwitcher: React.FC = () => {
  const { locale, setLocale, t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  // 无障碍名必须包含可见文字（WCAG 2.5.3 Label in Name）：按钮写着「En」，
  // 若 aria-label 只报当前语言，语音控制用户照可见文字念「点击 En」会失败。
  // 文案走字典：它含标点与连接语，属于界面文案，不在「语言名不翻译」的豁免范围内。
  const switchHint = t('workspace.langSwitchTitle', {
    short: LOCALE_SWITCH_LABEL[locale],
    current: LOCALE_LABEL[locale],
  });

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        title={switchHint}
        aria-label={switchHint}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="flex items-center justify-center min-w-7 h-7 px-1.5 rounded-full text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 cursor-pointer transition-colors"
      >
        {LOCALE_SWITCH_LABEL[locale]}
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
