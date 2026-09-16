import { Express, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db } from '../db.js';
import {
  AuthRequest,
  clearUserSession,
  createUserSession,
  issueChallengeToken,
  sanitizeUser,
} from '../middleware/auth.js';
import { PASSWORD_CHANGE_COOKIE, CHALLENGE_TTL_MS, COOKIE_SECURE } from '../config.js';
import { sha256 } from '../services/security.js';
import { USER_PASSWORD_MIN_LENGTH, validateStrongPassword } from '../services/password.js';
import { asyncJsonHandler } from '../middleware/asyncHandler.js';

const authLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'RATE_LIMITED', message: '尝试过于频繁，请稍后再试' } });
const loginSchema = z.object({ phone: z.string().trim().regex(/^\d{11}$/), password: z.string().min(1) });
const passwordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(USER_PASSWORD_MIN_LENGTH).max(128) });
const COOKIE_BASE = { httpOnly: true, secure: COOKIE_SECURE, sameSite: 'strict' as const, path: '/' };

function genericLoginFailure(res: Response): void {
  res.status(401).json({ error: 'INVALID_CREDENTIALS', message: '账号或密码错误' });
}

export function registerAuthRoutes(app: Express): void {
  app.post('/api/auth/login', authLimiter, (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return genericLoginFailure(res);
    const { phone, password } = parsed.data;
    const user = db.getUserByPhone(phone);
    if (!user || !user.password || user.status === 'disabled' || user.status === 'deleted') return genericLoginFailure(res);
    if (db.isUserLocked(user)) return res.status(423).json({ error: 'ACCOUNT_LOCKED', message: '账号暂时锁定，请 15 分钟后重试' });
    if (!bcrypt.compareSync(password, user.password)) {
      db.recordLoginFailure(user.id);
      return genericLoginFailure(res);
    }

    if (user.mustChangePassword) {
      const challenge = issueChallengeToken();
      const id = db.createAuthChallenge({ tokenHash: challenge.tokenHash, type: 'password_change', subjectId: user.id, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString() });
      res.cookie(PASSWORD_CHANGE_COOKIE, challenge.token, { ...COOKIE_BASE, maxAge: CHALLENGE_TTL_MS });
      db.audit({ actorType: 'user', actorId: user.id, action: 'login_password_change_required', ip: req.ip, userAgent: req.get('user-agent') || undefined });
      return res.json({ passwordChangeRequired: true, challengeId: id });
    }

    db.recordLoginSuccess(user.id);
    createUserSession(req, res, user.id);
    db.audit({ actorType: 'user', actorId: user.id, action: 'login_success', ip: req.ip, userAgent: req.get('user-agent') || undefined });
    return res.json({ success: true, user: sanitizeUser({ ...user, mustChangePassword: false }) });
  });

  // 仅服务于「首次登录强制改密」：必须携带登录时下发的改密凭证。
  // 登录态下的自助改密入口已移除，本接口不再接受已建立会话的请求。
  app.post('/api/auth/change-password', authLimiter, asyncJsonHandler<AuthRequest>(async (req, res) => {
    const parsed = passwordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PASSWORD', message: `新密码至少 ${USER_PASSWORD_MIN_LENGTH} 个字符` });
    const { currentPassword, newPassword } = parsed.data;

    const token = req.cookies?.[PASSWORD_CHANGE_COOKIE] as string | undefined;
    if (!token) return res.status(401).json({ error: 'UNAUTHENTICATED', message: '登录状态已失效，请重新登录' });
    const challenge = db.getAuthChallengeByTokenHash(sha256(token), 'password_change');
    if (!challenge || challenge.usedAt || new Date(challenge.expiresAt).getTime() <= Date.now()) return res.status(401).json({ error: 'CHALLENGE_EXPIRED', message: '改密会话已过期，请重新登录' });
    const user = db.getUserById(challenge.subjectId);

    if (!user || !user.password || !bcrypt.compareSync(currentPassword, user.password)) return genericLoginFailure(res);
    const policyError = validateStrongPassword(newPassword, USER_PASSWORD_MIN_LENGTH, user.phone, false);
    if (policyError) return res.status(400).json({ error: 'INVALID_PASSWORD', message: policyError });
    if (bcrypt.compareSync(newPassword, user.password)) return res.status(400).json({ error: 'PASSWORD_REUSED', message: '新密码不能与当前密码相同' });

    db.updateUserPassword(user.id, await bcrypt.hash(newPassword, 12));
    db.revokeUserSessions(user.id);
    db.markAuthChallengeUsed(challenge.id);
    res.clearCookie(PASSWORD_CHANGE_COOKIE, COOKIE_BASE);
    createUserSession(req, res, user.id);
    db.audit({ actorType: 'user', actorId: user.id, action: 'password_changed', ip: req.ip, userAgent: req.get('user-agent') || undefined });
    return res.json({ success: true, user: sanitizeUser({ ...user, mustChangePassword: false, password: undefined }) });
  }));

  app.get('/api/auth/me', (req: AuthRequest, res) => {
    if (!req.user || req.sessionKind !== 'user') return res.status(401).json({ error: 'UNAUTHENTICATED' });
    return res.json({ user: sanitizeUser(req.user) });
  });

  app.post('/api/auth/logout', (req: AuthRequest, res) => {
    clearUserSession(req, res);
    res.json({ success: true });
  });
}