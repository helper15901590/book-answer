import type { TranslationKey, TVars } from '../i18n';

export type PasswordStrengthLevel = 'weak' | 'medium' | 'strong';

export interface PasswordStrength {
  level: PasswordStrengthLevel;
  /** 强度等级文案的字典键（由组件翻译，工具函数本身不产出中文） */
  labelKey: TranslationKey;
  /** 风险提示文案的字典键 */
  hintKey: TranslationKey;
  /** 提示文案里的插值变量 */
  hintVars?: TVars;
  barClass: string;
  textClass: string;
  widthPercent: number;
}

// 弱 / 中 / 强 的熵阈值（比特）。40 以下可在离线爆破中较快被攻破，60 以上才算稳妥。
const WEAK_BELOW_BITS = 40;
const STRONG_FROM_BITS = 60;

// 口令强度提示：服务端已放宽为「只校验长度」，弱口令风险改由此处实时告知。
// 用字符集大小 × 长度估算信息熵，比单纯数「有没有字母数字」更贴近真实破解难度。
// 返回 null 表示尚未输入，无需展示。
export function evaluatePasswordStrength(password: string, minLength: number): PasswordStrength | null {
  if (!password) return null;

  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  const singleRepeated = /^(.)\1+$/.test(password);
  const digitsOnly = /^\d+$/.test(password);

  let charset = 0;
  if (hasLower) charset += 26;
  if (hasUpper) charset += 26;
  if (hasDigit) charset += 10;
  if (hasSymbol) charset += 32;
  const bits = charset > 0 ? password.length * Math.log2(charset) : 0;

  // 单字符重复几乎零熵；短纯数字（生日、手机尾号、123456 一类）是撞库首选，一并直接判弱
  const obviouslyGuessed = singleRepeated || (digitsOnly && password.length < 12);

  if (obviouslyGuessed || bits < WEAK_BELOW_BITS) {
    return {
      level: 'weak',
      labelKey: 'password.weak',
      hintKey: singleRepeated
        ? 'password.hintRepeated'
        : digitsOnly
          ? 'password.hintDigits'
          : 'password.hintLow',
      hintVars: singleRepeated || digitsOnly ? undefined : { min: Math.max(8, minLength) },
      barClass: 'bg-rose-500',
      textClass: 'text-rose-600',
      widthPercent: 33,
    };
  }

  if (bits < STRONG_FROM_BITS) {
    return {
      level: 'medium',
      labelKey: 'password.medium',
      hintKey: 'password.hintMedium',
      barClass: 'bg-amber-500',
      textClass: 'text-amber-600',
      widthPercent: 66,
    };
  }

  return {
    level: 'strong',
    labelKey: 'password.strong',
    hintKey: 'password.hintStrong',
    barClass: 'bg-emerald-500',
    textClass: 'text-emerald-600',
    widthPercent: 100,
  };
}
