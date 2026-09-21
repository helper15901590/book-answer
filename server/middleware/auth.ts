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
import { metrics, touchUser } from '../services/metrics.js';
import { logger } from '../services/logger.js';

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

// Origin 头与请求路径都由客户端控制，单个头上限 16KB（Node 默认 max-http-header-size）。
// 原样落盘的话一次拒绝就能写十几 KB，而日志轮转只有 10m×3——几分钟的刷流量就能把这条
// 诊断信息本身挤出轮转，恰好在需要它的时候消失。截断到诊断所需的最小长度即可。
function clipForLog(value: string, max = 200): string {
  return value.length > max ? `${value.slice(0, max)}…(+${value.length - max}B)` : value;
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
    // 来源不符与令牌不符是两回事：前者是 APP_ORIGIN 配错（运维问题，刷新页面永远不会好），
    // 后者是浏览器 Cookie 与会话对不上。此前两者共用 CSRF_REJECTED，前端按码翻译后同样显示
    // 「安全令牌无效」，会把配置问题伪装成用户侧令牌问题。分开码，并在日志里留下双方原值——
    // Origin 不是秘密，这正是定位该问题所需的最小信息。
    logger.warn({ route: clipForLog(routePath), origin: clipForLog(origin), expectedOrigin }, 'CSRF 来源校验拒绝');
    metrics.csrfOriginRejected++;
    res.status(403).json({ error: 'ORIGIN_REJECTED', message: '请求来源无效' });
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
    // 只记录「有没有、对不对」，绝不记录令牌本身。头与 Cookie 只要一侧缺失或与会话不匹配就会
    // 落到这里，分开记才能立刻区分「浏览器没存下 CSRF Cookie」与「Cookie 属于另一个会话」。
    logger.warn({
      route: clipForLog(routePath),
      sessionId: req.authSession.id,
      sessionKind: req.sessionKind,
      hasHeader: Boolean(headerToken),
      hasCookie: Boolean(cookieToken),
      headerMatches: Boolean(validHeader),
      cookieMatches: Boolean(validCookie),
    }, 'CSRF 令牌校验拒绝');
    metrics.csrfTokenRejected++;
    // 这条建议必须是用户做得到的动作：令牌对不上时登出请求本身也受 CSRF 保护、必定 403，
    // 所以「请退出后重新登录」是走不通的，只有清掉本站 Cookie 才能拿到一对匹配的凭证。
    res.status(403).json({ error: 'CSRF_REJECTED', message: '安全令牌已失效，请清除本站点的 Cookie 后重新登录' });
    return;
  }
  next();
}

export function issueChallengeToken(): { token: string; tokenHash: string; csrfToken: string } {
  const token = randomToken();
  return { token, tokenHash: sha256(token), csrfToken: randomToken(24) };
}