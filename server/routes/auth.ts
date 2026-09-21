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
  requireUser,
  sanitizeUser,
} from '../middleware/auth.js';
import { PASSWORD_CHANGE_COOKIE, CHALLENGE_TTL_MS, COOKIE_SECURE } from '../config.js';
import { sha256 } from '../services/security.js';
import { BCRYPT_ROUNDS, USER_PASSWORD_MIN_LENGTH, validateStrongPassword } from '../services/password.js';
import { asyncJsonHandler } from '../middleware/asyncHandler.js';
import { DELETE_ACCOUNT_PHRASES } from '../../src/i18n/deleteAccountPhrase.js';

const authLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'RATE_LIMITED', message: '尝试过于频繁，请稍后再试' } });
// 改密单独用一个计数桶：首次登录必须走「登录 → 强制改密」两次请求，若与登录共用同一个桶，
// 共享出口 IP 下每分钟只能放行 5 名新用户，等于把登录的防爆破额度消耗在改密上。
const passwordChangeLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'RATE_LIMITED', message: '尝试过于频繁，请稍后再试' } });
const loginSchema = z.object({ phone: z.string().trim().regex(/^\d{11}$/), password: z.string().min(1) });
const passwordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(USER_PASSWORD_MIN_LENGTH).max(128) });
const COOKIE_BASE = { httpOnly: true, secure: COOKIE_SECURE, sameSite: 'strict' as const, path: '/' };

function genericLoginFailure(res: Response): void {
  res.status(401).json({ error: 'INVALID_CREDENTIALS', message: '账号或密码错误' });
}

export function registerAuthRoutes(app: Express): void {
  // bcryptjs 是纯 JS 实现，Promise 版在返回之前就已同步算完整段哈希（成本 10 实测约 58ms），
  // 所以这里的 await 并不能把这段计算移出事件循环——真正的收益来自成本因子降到 10（见 BCRYPT_ROUNDS）。
  // 保留 async 形式是为了让 asyncJsonHandler 统一兜住异常并返回 JSON 500，而不是让请求挂起。
  app.post('/api/auth/login', authLimiter, asyncJsonHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return genericLoginFailure(res);
    const { phone, password } = parsed.data;
    const user = db.getUserByPhone(phone);
    if (!user || !user.password || user.status === 'disabled' || user.status === 'deleted') return genericLoginFailure(res);
    if (db.isUserLocked(user)) return res.status(423).json({ error: 'ACCOUNT_LOCKED', message: '账号暂时锁定，请 15 分钟后重试' });
    const passwordOk = await bcrypt.compare(password, user.password);
    // 上面的 await 是本处理器唯一的让出点：并发请求可能全部越过门禁后才逐一恢复。
    // 若不在落库前复检，一个限流窗口内可猜的次数会从 5 次放大到并发数倍。
    if (db.isUserLocked(user)) return res.status(423).json({ error: 'ACCOUNT_LOCKED', message: '账号暂时锁定，请 15 分钟后重试' });
    if (!passwordOk) {
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
  }));

  // 仅服务于「首次登录强制改密」：必须携带登录时下发的改密凭证。
  // 登录态下的自助改密入口已移除，本接口不再接受已建立会话的请求。
  app.post('/api/auth/change-password', passwordChangeLimiter, asyncJsonHandler<AuthRequest>(async (req, res) => {
    const parsed = passwordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PASSWORD', message: `新密码至少 ${USER_PASSWORD_MIN_LENGTH} 个字符` });
    const { currentPassword, newPassword } = parsed.data;

    const token = req.cookies?.[PASSWORD_CHANGE_COOKIE] as string | undefined;
    if (!token) return res.status(401).json({ error: 'UNAUTHENTICATED', message: '登录状态已失效，请重新登录' });
    const challenge = db.getAuthChallengeByTokenHash(sha256(token), 'password_change');
    if (!challenge || challenge.usedAt || new Date(challenge.expiresAt).getTime() <= Date.now()) return res.status(401).json({ error: 'CHALLENGE_EXPIRED', message: '改密会话已过期，请重新登录' });
    const user = db.getUserById(challenge.subjectId);

    if (!user || !user.password || !(await bcrypt.compare(currentPassword, user.password))) return genericLoginFailure(res);
    const policyError = validateStrongPassword(newPassword, USER_PASSWORD_MIN_LENGTH, user.phone, false);
    if (policyError) return res.status(400).json({ error: 'INVALID_PASSWORD', message: policyError });
    if (await bcrypt.compare(newPassword, user.password)) return res.status(400).json({ error: 'PASSWORD_REUSED', message: '新密码不能与当前密码相同' });

    db.updateUserPassword(user.id, await bcrypt.hash(newPassword, BCRYPT_ROUNDS));
    db.revokeUserSessions(user.id);
    db.markAuthChallengeUsed(challenge.id);
    res.clearCookie(PASSWORD_CHANGE_COOKIE, COOKIE_BASE);
    createUserSession(req, res, user.id);
    db.audit({ actorType: 'user', actorId: user.id, action: 'password_changed', ip: req.ip, userAgent: req.get('user-agent') || undefined });
    return res.json({ success: true, user: sanitizeUser({ ...user, mustChangePassword: false, password: undefined }) });
  }));

  // 用户自助注销。是**硬删除**：连带清空对话记录、登录会话、配额账本与改密凭证，不可恢复。
  // 因此要求用户主动输入确认短语——这是不可逆操作，必须有明确的确认动作，不能只靠点按钮。
  // 短语本身定义在 src/i18n/deleteAccountPhrase.ts：三份字典与服务端共用同一份常量，
  // 服务端只引那个叶子模块，避免为了三条短语把整份字典打进 bundle（曾使产物增大 27.9%）。
  app.post('/api/auth/delete-account', requireUser, asyncJsonHandler<AuthRequest>(async (req, res) => {
    const submitted = String(req.body?.confirm || '').trim().toLowerCase();
    const accepted = DELETE_ACCOUNT_PHRASES.some((phrase) => phrase.toLowerCase() === submitted);
    if (!accepted) return res.status(400).json({ error: 'CONFIRMATION_MISMATCH', message: '确认文本不匹配，请输入完整短语后重试' });

    const userId = req.user!.id;
    if (!db.deleteUser(userId)) return res.status(500).json({ error: 'DELETE_FAILED', message: '注销失败，请稍后重试或联系管理员' });
    db.audit({ actorType: 'user', actorId: userId, action: 'account_deleted_by_self', ip: req.ip, userAgent: req.get('user-agent') || undefined });
    // 该用户的 auth_sessions 已被 deleteUser 清掉，这里主要是把浏览器上的 Cookie 一起清干净
    clearUserSession(req, res);
    return res.json({ success: true });
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