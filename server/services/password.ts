import crypto from 'crypto';

// 用户口令只校验长度、不强制字符组合（组合规则对弱口令的遏制有限，却明显增加用户流失），
// 强度不足的风险改由前端实时提示告知；管理员口令仍保持长度 + 组合双重校验。
export const USER_PASSWORD_MIN_LENGTH = 6;
export const ADMIN_PASSWORD_MIN_LENGTH = 16;
export const TEMPORARY_PASSWORD_LENGTH = 16;

// 口令哈希成本因子。12 轮在纯 JS 的 bcryptjs 下实测约 226ms，且同步调用会整体阻塞事件循环——
// 上线首日数百人集中首次登录时，服务会在这 226ms 窗口内对所有人完全无响应。10 轮实测约 61ms，
// CPU 降至四分之一，对密码哈希仍是足够强度。已有哈希不受影响：验证时按各自存储的成本因子进行。
export const BCRYPT_ROUNDS = 10;

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*_-+=';

export function validateStrongPassword(password: string, minLength: number, phone?: string, requireMixedChars = true): string | null {
  const value = (password || '').trim();
  if (value.length < minLength) return `密码至少需要 ${minLength} 个字符`;
  if (value.length > 128) return '密码不能超过 128 个字符';
  if (/\s/.test(value)) return '密码不能包含空白字符';
  if (requireMixedChars && (!/[A-Za-z]/.test(value) || !/\d/.test(value))) return '密码必须同时包含字母和数字';
  if (phone && value.includes(phone)) return '密码不能包含手机号码';
  return null;
}

export function generateTemporaryPassword(length = TEMPORARY_PASSWORD_LENGTH): string {
  const all = UPPER + LOWER + DIGITS + SYMBOLS;
  const chars = [
    UPPER[crypto.randomInt(UPPER.length)],
    LOWER[crypto.randomInt(LOWER.length)],
    DIGITS[crypto.randomInt(DIGITS.length)],
    SYMBOLS[crypto.randomInt(SYMBOLS.length)],
  ];

  while (chars.length < length) {
    chars.push(all[crypto.randomInt(all.length)]);
  }

  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}