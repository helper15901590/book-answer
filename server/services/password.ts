import crypto from 'crypto';

export const USER_PASSWORD_MIN_LENGTH = 12;
export const ADMIN_PASSWORD_MIN_LENGTH = 16;
export const TEMPORARY_PASSWORD_LENGTH = 16;

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*_-+=';

export function validateStrongPassword(password: string, minLength: number, phone?: string): string | null {
  const value = (password || '').trim();
  if (value.length < minLength) return `密码至少需要 ${minLength} 个字符`;
  if (value.length > 128) return '密码不能超过 128 个字符';
  if (/\s/.test(value)) return '密码不能包含空白字符';
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return '密码必须同时包含字母和数字';
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