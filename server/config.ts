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

// 管理员登录动态验证码（TOTP）：默认开启。仅内测等受控环境可设为 0 关闭，
// 关闭后管理员仅凭手机号 + 密码即可进入后台，失去第二重防护。
export const ADMIN_MFA_ENABLED = process.env.ADMIN_MFA_ENABLED !== '0';
if (!ADMIN_MFA_ENABLED) {
  console.warn('⚠️ ADMIN_MFA_ENABLED=0：管理后台已关闭动态验证码，仅凭密码即可登录，请勿在此状态下长期对公网开放');
}

// 管理员第二重口令（安全码）：可选，无需任何 App。设置后登录需额外提供，
// 留空则不做第二重校验。与动态验证码相互独立，同时启用时两重都需通过。
export const ADMIN_SECOND_PASSWORD = (process.env.ADMIN_SECOND_PASSWORD || '').trim();
if (IS_PROD && ADMIN_SECOND_PASSWORD) {
  if (ADMIN_SECOND_PASSWORD.length < 8) {
    console.error('FATAL: ADMIN_SECOND_PASSWORD 至少需要 8 个字符');
    process.exit(1);
  }
  if (ADMIN_SECOND_PASSWORD === ADMIN_PASSWORD
    || ADMIN_PASSWORD.includes(ADMIN_SECOND_PASSWORD)
    || ADMIN_SECOND_PASSWORD.includes(ADMIN_PASSWORD)) {
    console.error('FATAL: ADMIN_SECOND_PASSWORD 与 ADMIN_PASSWORD 不能相同或互相包含——否则拿到密码即可推出安全码，第二重验证形同虚设');
    process.exit(1);
  }
}

export const TRUST_PROXY = process.env.TRUST_PROXY === '1';

// 无 HTTPS 部署开关：内测阶段用「公网 IP + HTTP」直连时设为 1。
// 开启后会关闭 Cookie 的 Secure 标记、CSP 的 upgrade-insecure-requests 与 HSTS——
// 这三项在 HTTP 下会导致登录态丢失或整页白屏，因此仅在无 TLS 监听时使用。
export const ALLOW_INSECURE_HTTP = IS_PROD && process.env.ALLOW_INSECURE_HTTP === '1';
export const COOKIE_SECURE = IS_PROD && !ALLOW_INSECURE_HTTP;
if (ALLOW_INSECURE_HTTP) {
  console.warn('⚠️ ALLOW_INSECURE_HTTP=1：登录态将在 HTTP 明文下传输，仅限内测环境，正式上线前必须切回 HTTPS');
}

// 交叉校验：直连部署（无反向代理）下若同时信任代理头，客户端可伪造 X-Forwarded-For 绕过全部限流
if (ALLOW_INSECURE_HTTP && TRUST_PROXY) {
  console.error('FATAL: ALLOW_INSECURE_HTTP=1 与 TRUST_PROXY=1 不能同时启用——直连部署没有代理可信任，限流会形同虚设');
  process.exit(1);
}
// 直连模式必须用 http:// 的地址，否则所有写请求会被 CSRF 来源校验拒绝
if (ALLOW_INSECURE_HTTP && !APP_ORIGIN.startsWith('http://')) {
  console.error(`FATAL: 启用 ALLOW_INSECURE_HTTP 时 APP_ORIGIN 必须以 http:// 开头，当前为 ${APP_ORIGIN}`);
  process.exit(1);
}
export const USER_SESSION_COOKIE = 'book_answer_user_session';
export const USER_CSRF_COOKIE = 'book_answer_user_csrf';
export const ADMIN_SESSION_COOKIE = 'book_answer_admin_session';
export const ADMIN_CSRF_COOKIE = 'book_answer_admin_csrf';
export const ADMIN_CHALLENGE_COOKIE = 'book_answer_admin_challenge';
export const PASSWORD_CHANGE_COOKIE = 'book_answer_password_change';
export const USER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const CHALLENGE_TTL_MS = 10 * 60 * 1000;

export const SENTRY_DSN = (process.env.SENTRY_DSN || '').trim();
export const APP_VERSION = (process.env.APP_VERSION || 'dev').trim();
export const HEALTHCHECK_PING_URL = (process.env.HEALTHCHECK_PING_URL || '').trim();
export const RESTIC_REPOSITORY = (process.env.RESTIC_REPOSITORY || '').trim();