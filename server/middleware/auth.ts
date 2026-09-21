import { NextFunction, Request, Response } from 'express';
import { db } from '../db.js';
import { AuthSessionRecord, UserProfile } from '../../src/types.js';
import {
  ADMIN_CSRF_COOKIE,
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_MS,
  ADMIN_PASSWORD,
  ADMIN_PHONE,
  ADMIN_SECOND_PASSWORD,
  APP_ORIGIN,
  COOKIE_SECURE,
  USER_CSRF_COOKIE,
  USER_SESSION_COOKIE,
  USER_SESSION_TTL_MS,
} from '../config.js';
import { randomToken, safeEqual, sha256 } from '../services/security.js';
import { touchUser } from '../services/metrics.js';

export const ADMIN_ACCOUNT_ID = 'admin';
const COOKIE_BASE = { httpOnly: true, secure: COOKIE_SECURE, sameSite: 'strict' as const };

export interface AuthRequest extends Request {
  user?: UserProfile;
  authSession?: AuthSessionRecord;
  sessionKind?: 'user' | 'admin';
}

export function buildAdminProfile(): UserProfile {
  return {
    id: ADMIN_ACCOUNT_ID,
    nickname: '管理员',
    avatar: '',
    phone: ADMIN_PHONE || undefined,
    role: 'admin',
    status: 'active',
    membershipTier: 'yearly_member',
    isAdmin: true,
    dailyMaxChats: 9999,
  };
}

export function sanitizeUser(user: UserProfile): UserProfile {
  const { password: _password, ...rest } = user;
  return rest;
}

export function getAdminAuthVersion(): string {
  const security = db.getAdminSecurity();
  // 安全码也纳入版本：轮换安全码后必须让已签发的管理员会话失效
  return sha256(`${ADMIN_PHONE}:${ADMIN_PASSWORD}:${ADMIN_SECOND_PASSWORD}:${security?.totpSecretEnc || ''}`);
}

function readCookie(req: Request, name: string): string | undefined {
  return (req as any).cookies?.[name];
}

// CSRF Cookie 的生命周期必须与会话 Cookie 保持一致。此前它不带 maxAge（会话级），
// 而会话 Cookie 是持久的（管理员 8 小时 / 用户 30 天）——浏览器完整退出后 CSRF Cookie 消失、
// 会话仍在，于是登出请求（同样受 CSRF 保护）必定 403，用户从界面上再也退不出来。
function setCsrfCookie(res: Response, name: string, token: string, maxAge: number): void {
  res.cookie(name, token, { ...COOKIE_BASE, httpOnly: false, maxAge });
}

function clearSessionCookies(res: Response, kind: 'user' | 'admin'): void {
  const sessionName = kind === 'user' ? USER_SESSION_COOKIE : ADMIN_SESSION_COOKIE;
  const csrfName = kind === 'user' ? USER_CSRF_COOKIE : ADMIN_CSRF_COOKIE;
  res.clearCookie(sessionName, COOKIE_BASE);
  res.clearCookie(csrfName, { ...COOKIE_BASE, httpOnly: false });
}

export function createUserSession(req: Request, res: Response, userId: string): AuthSessionRecord {
  const token = randomToken();
  const csrfToken = randomToken(24);
  const session = db.createAuthSession({
    tokenHash: sha256(token),
    subjectType: 'user',
    subjectId: userId,
    role: 'member',
    csrfHash: sha256(csrfToken),
    expiresAt: new Date(Date.now() + USER_SESSION_TTL_MS).toISOString(),
    ip: req.ip,
    userAgent: req.get('user-agent') || undefined,
  });
  res.cookie(USER_SESSION_COOKIE, token, { ...COOKIE_BASE, maxAge: USER_SESSION_TTL_MS });
  setCsrfCookie(res, USER_CSRF_COOKIE, csrfToken, USER_SESSION_TTL_MS);
  return session;
}

export function createAdminSession(req: Request, res: Response): AuthSessionRecord {
  const token = randomToken();
  const csrfToken = randomToken(24);
  const session = db.createAuthSession({
    tokenHash: sha256(token),
    subjectType: 'admin',
    subjectId: ADMIN_ACCOUNT_ID,
    role: 'admin',
    csrfHash: sha256(csrfToken),
    authVersion: getAdminAuthVersion(),
    expiresAt: new Date(Date.now() + ADMIN_SESSION_TTL_MS).toISOString(),
    ip: req.ip,
    userAgent: req.get('user-agent') || undefined,
  });
  res.cookie(ADMIN_SESSION_COOKIE, token, { ...COOKIE_BASE, maxAge: ADMIN_SESSION_TTL_MS });
  setCsrfCookie(res, ADMIN_CSRF_COOKIE, csrfToken, ADMIN_SESSION_TTL_MS);
  return session;
}

export function clearUserSession(req: AuthRequest, res: Response): void {
  if (req.sessionKind === 'user' && req.authSession) db.revokeAuthSession(req.authSession.id);
  clearSessionCookies(res, 'user');
}

export function clearAdminSession(req: AuthRequest, res: Response): void {
  if (req.sessionKind === 'admin' && req.authSession) db.revokeAuthSession(req.authSession.id);
  clearSessionCookies(res, 'admin');
}

function resolveSession(req: AuthRequest, cookieName: string, kind: 'user' | 'admin'): void {
  const token = readCookie(req, cookieName);
  if (!token) return;
  const session = db.getAuthSessionByTokenHash(sha256(token));
  if (!session || session.subjectType !== kind) return;
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    db.revokeAuthSession(session.id);
    return;
  }
  if (kind === 'admin') {
    if ((session.authVersion || '') !== getAdminAuthVersion()) return;
    req.user = buildAdminProfile();
  } else {
    const user = db.getUserById(session.subjectId);
    if (!user || user.status === 'deleted') return;
    req.user = user;
    if (user.status === 'active') touchUser(user.id);
    const nextExpiry = new Date(Date.now() + USER_SESSION_TTL_MS).toISOString();
    db.touchAuthSession(session.id, nextExpiry);
    session.expiresAt = nextExpiry;
  }
  req.authSession = session;
  req.sessionKind = kind;
}

export function authMiddleware(req: AuthRequest, _res: Response, next: NextFunction): void {
  const adminFirst = req.path.startsWith('/api/admin');
  if (adminFirst) {
    resolveSession(req, ADMIN_SESSION_COOKIE, 'admin');
    if (!req.user) resolveSession(req, USER_SESSION_COOKIE, 'user');
  } else {
    resolveSession(req, USER_SESSION_COOKIE, 'user');
    if (!req.user) resolveSession(req, ADMIN_SESSION_COOKIE, 'admin');
  }
  next();
}

export function requireUser(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user || req.sessionKind !== 'user') {
    res.status(401).json({ error: 'UNAUTHENTICATED', message: '请先登录后继续' });
    return;
  }
  if (req.user.status === 'disabled' || req.user.status === 'deleted') {
    res.status(403).json({ error: 'ACCOUNT_DISABLED', message: '账号当前不可用' });
    return;
  }
  next();
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user || req.sessionKind !== 'admin' || req.user.role !== 'admin') {
    res.status(403).json({ error: 'FORBIDDEN', message: '需要管理员权限' });
    return;
  }
  next();
}

export function csrfProtection(req: AuthRequest, res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }
  // 本中间件挂在 /api 之下，req.path 是不含挂载前缀的相对路径，必须拼回 baseUrl 才能与完整路径比较。
  // 此前直接拿 req.path 比对导致豁免从未生效：未登录时靠"无会话即放行"侥幸通过，
  // 而浏览器仍持有管理员会话时，前台登录会带上该会话被要求 CSRF 令牌，前端报「安全令牌无效」。
  const routePath = `${req.baseUrl}${req.path}`;
  const exempt = ['/api/auth/login', '/api/auth/change-password', '/api/admin/login'].some((path) => routePath === path) || routePath.startsWith('/api/admin/mfa/');
  if (exempt) {
    next();
    return;
  }
  const origin = req.get('origin');
  const expectedOrigin = APP_ORIGIN.replace(/\/+$/, '');
  if (origin && expectedOrigin && origin.replace(/\/+$/, '') !== expectedOrigin) {
    res.status(403).json({ error: 'CSRF_REJECTED', message: '请求来源无效' });
    return;
  }
  if (!req.authSession) {
    next();
    return;
  }
  const headerToken = req.get('x-csrf-token') || '';
  const cookieToken = req.sessionKind === 'admin' ? readCookie(req, ADMIN_CSRF_COOKIE) : readCookie(req, USER_CSRF_COOKIE);
  const validHeader = headerToken && safeEqual(sha256(headerToken), req.authSession.csrfHash);
  const validCookie = cookieToken && safeEqual(sha256(cookieToken), req.authSession.csrfHash);
  if (!validHeader || !validCookie) {
    res.status(403).json({ error: 'CSRF_REJECTED', message: '安全令牌无效，请刷新页面后重试' });
    return;
  }
  next();
}

export function issueChallengeToken(): { token: string; tokenHash: string; csrfToken: string } {
  const token = randomToken();
  return { token, tokenHash: sha256(token), csrfToken: randomToken(24) };
}