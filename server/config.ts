import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import { ADMIN_PASSWORD_MIN_LENGTH, validateStrongPassword } from './services/password.js';

dotenv.config({ path: ['.env.local', '.env'] });

const env = process.env.NODE_ENV || 'development';
export const IS_PROD = env === 'production';
export const IS_TEST = env === 'test';
export const PORT = Number(process.env.PORT) || 3000;
export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');

export const APP_ORIGIN = (() => {
  const raw = (process.env.APP_ORIGIN || '').trim().replace(/\/+$/, '');
  if (raw) return raw;
  if (IS_PROD) {
    console.error('FATAL: 生产环境必须设置 APP_ORIGIN，用于 Cookie 与 CSRF 来源校验');
    process.exit(1);
  }
  return `http://localhost:${PORT}`;
})();

export const APP_ENCRYPTION_KEY = (() => {
  const raw = (process.env.APP_ENCRYPTION_KEY || '').trim();
  if (!raw && IS_TEST) {
    return crypto.createHash('sha256').update('codex-test-encryption-key').digest();
  }
  if (!raw) {
    console.error('FATAL: 必须设置 APP_ENCRYPTION_KEY（32 字节 base64 或 64 位 hex）');
    process.exit(1);
  }
  try {
    const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new Error('key length mismatch');
    return key;
  } catch {
    console.error('FATAL: APP_ENCRYPTION_KEY 必须是 32 字节 base64 或 64 位 hex');
    process.exit(1);
  }
})();

export const ADMIN_PHONE = (process.env.ADMIN_PHONE || '').trim();
export const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').trim();
if (IS_PROD) {
  if (!/^\d{11}$/.test(ADMIN_PHONE)) {
    console.error('FATAL: 生产环境必须设置 11 位 ADMIN_PHONE');
    process.exit(1);
  }
  const passwordError = validateStrongPassword(ADMIN_PASSWORD, ADMIN_PASSWORD_MIN_LENGTH, ADMIN_PHONE);
  if (passwordError) {
    console.error(`FATAL: ADMIN_PASSWORD 不符合安全策略：${passwordError}`);
    process.exit(1);
  }
}

export const TRUST_PROXY = process.env.TRUST_PROXY === '1';
export const COOKIE_SECURE = IS_PROD;
export const USER_SESSION_COOKIE = 'remix_user_session';
export const USER_CSRF_COOKIE = 'remix_user_csrf';
export const ADMIN_SESSION_COOKIE = 'remix_admin_session';
export const ADMIN_CSRF_COOKIE = 'remix_admin_csrf';
export const ADMIN_CHALLENGE_COOKIE = 'remix_admin_challenge';
export const PASSWORD_CHANGE_COOKIE = 'remix_password_change';
export const USER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const CHALLENGE_TTL_MS = 10 * 60 * 1000;

export const SENTRY_DSN = (process.env.SENTRY_DSN || '').trim();
export const APP_VERSION = (process.env.APP_VERSION || 'dev').trim();
export const HEALTHCHECK_PING_URL = (process.env.HEALTHCHECK_PING_URL || '').trim();
export const RESTIC_REPOSITORY = (process.env.RESTIC_REPOSITORY || '').trim();