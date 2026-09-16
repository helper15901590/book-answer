import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { Express, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db, getTodayString } from '../db.js';
import { ADMIN_PASSWORD, ADMIN_PHONE, ADMIN_CHALLENGE_COOKIE, ADMIN_MFA_ENABLED, ADMIN_SECOND_PASSWORD, CHALLENGE_TTL_MS, COOKIE_SECURE, DATA_DIR } from '../config.js';
import { metrics, onlineUsers } from '../services/metrics.js';
import {
  AuthRequest,
  buildAdminProfile,
  clearAdminSession,
  createAdminSession,
  getAdminAuthVersion,
  issueChallengeToken,
  requireAdmin,
  sanitizeUser,
} from '../middleware/auth.js';
import { cleanApiKey, isInvalidOrPlaceholderKey, resolveOpenAIUrl } from '../services/llm/sanitize.js';
import { ADMIN_PASSWORD_MIN_LENGTH, generateTemporaryPassword, validateStrongPassword } from '../services/password.js';
import { asyncJsonHandler } from '../middleware/asyncHandler.js';
import { decryptSecret, encryptSecret, generateRecoveryCodes, generateTotpSetup, generateUserId, hmac, randomToken, safeEqual, sha256, verifyTotp } from '../services/security.js';
import { MembershipTier, UserProfile, cleanBookTitle, AdminSecurityRecord, membershipExpiryFromNow, tierDailyLimit } from '../../src/types.js';

const adminLoginLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: '尝试过于频繁，请稍后再试' } });
const adminActionLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });
const challengeCookieBase = { httpOnly: true, secure: COOKIE_SECURE, sameSite: 'strict' as const, path: '/' };
const loginFailures = new Map<string, { count: number; lockedUntil: number; lastSeen: number }>();

// 失败计数若不清理会随攻击流量无界增长；15 分钟无活动的条目视为过期
setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [key, item] of loginFailures) {
    if (item.lastSeen < cutoff) loginFailures.delete(key);
  }
}, 60_000).unref();

function validAdminCredentials(phone: string, password: string): boolean {
  return phone === ADMIN_PHONE && password === ADMIN_PASSWORD;
}

function issueAdminChallenge(req: AuthRequest, res: Response, type: 'admin_mfa_setup' | 'admin_mfa_verify'): void {
  const challenge = issueChallengeToken();
  db.createAuthChallenge({ tokenHash: challenge.tokenHash, type, subjectId: 'admin', expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString() });
  res.cookie(ADMIN_CHALLENGE_COOKIE, challenge.token, { ...challengeCookieBase, maxAge: CHALLENGE_TTL_MS });
}

function resolveChallenge(req: AuthRequest, type: string) {
  const token = req.cookies?.[ADMIN_CHALLENGE_COOKIE] as string | undefined;
  if (!token) return null;
  const challenge = db.getAuthChallengeByTokenHash(sha256(token), type);
  if (!challenge || challenge.usedAt || new Date(challenge.expiresAt).getTime() <= Date.now()) return null;
  return challenge;
}

function maskPhone(phone?: string): string {
  if (!phone || phone.length < 7) return phone || '';
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

export function registerAdminRoutes(app: Express): void {
  app.post('/api/admin/login', adminLoginLimiter, (req, res) => {
    const phone = String(req.body?.phone || '').trim();
    const password = String(req.body?.password || req.body?.code || '');
    const secondPassword = String(req.body?.secondPassword || '');
    const key = `${req.ip}:${phone}`;
    const failure = loginFailures.get(key);
    if (failure && failure.lockedUntil > Date.now()) return res.status(423).json({ error: 'ACCOUNT_LOCKED', message: '登录尝试过多，请 15 分钟后重试' });
    // 安全码与密码合并判定：失败提示统一，不暴露是哪一重出错
    const secondOk = !ADMIN_SECOND_PASSWORD || safeEqual(sha256(secondPassword), sha256(ADMIN_SECOND_PASSWORD));
    if (!validAdminCredentials(phone, password) || !secondOk) {
      const next = { count: (failure?.count || 0) + 1, lockedUntil: 0, lastSeen: Date.now() };
      if (next.count >= 5) next.lockedUntil = Date.now() + 15 * 60 * 1000;
      loginFailures.set(key, next);
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: '账号或密码错误' });
    }
    loginFailures.delete(key);
    // 关闭动态验证码时直接建立管理员会话（仅内测受控环境使用，见 config.ADMIN_MFA_ENABLED）
    if (!ADMIN_MFA_ENABLED) {
      createAdminSession(req as AuthRequest, res);
      db.audit({ actorType: 'admin', actorId: 'admin', action: 'admin_login_success', metadata: { mfa: 'disabled' }, ip: req.ip, userAgent: req.get('user-agent') || undefined });
      return res.json({ success: true, user: sanitizeUser(buildAdminProfile()) });
    }
    const security = db.getAdminSecurity();
    if (!security?.totpEnabled || !security.totpSecretEnc) {
      issueAdminChallenge(req as AuthRequest, res, 'admin_mfa_setup');
      return res.json({ mfaSetupRequired: true });
    }
    issueAdminChallenge(req as AuthRequest, res, 'admin_mfa_verify');
    return res.json({ mfaRequired: true });
  });

  app.post('/api/admin/mfa/setup', adminLoginLimiter, (req: AuthRequest, res) => {
    const challenge = resolveChallenge(req, 'admin_mfa_setup');
    if (!challenge) return res.status(401).json({ error: 'CHALLENGE_EXPIRED', message: 'MFA 设置会话已过期，请重新登录' });
    const setup = generateTotpSetup(ADMIN_PHONE || 'admin');
    const recoveryCodes = generateRecoveryCodes(8);
    const current = db.getAdminSecurity();
    db.saveAdminSecurity({
      id: 'primary',
      totpSecretEnc: current?.totpSecretEnc,
      totpEnabled: false,
      recoveryCodeHashes: current?.recoveryCodeHashes || [],
      pendingSecretEnc: encryptSecret(setup.secret),
      pendingRecoveryHashes: recoveryCodes.map((code) => hmac(code)),
      authVersion: current?.authVersion,
      updatedAt: new Date().toISOString(),
    });
    return res.json({ secret: setup.secret, otpauthUri: setup.otpauthUri, recoveryCodes });
  });

  app.post('/api/admin/mfa/confirm', adminLoginLimiter, (req: AuthRequest, res) => {
    const challenge = resolveChallenge(req, 'admin_mfa_setup');
    if (!challenge) return res.status(401).json({ error: 'CHALLENGE_EXPIRED', message: 'MFA 设置会话已过期，请重新登录' });
    const security = db.getAdminSecurity();
    if (!security?.pendingSecretEnc) return res.status(400).json({ error: 'MFA_NOT_READY', message: '请先生成 MFA 密钥' });
    const secret = decryptSecret(security.pendingSecretEnc);
    if (!verifyTotp(secret, String(req.body?.code || ''))) return res.status(400).json({ error: 'INVALID_TOTP', message: '动态验证码错误' });
    const activated: AdminSecurityRecord = {
      ...security,
      totpSecretEnc: security.pendingSecretEnc,
      totpEnabled: true,
      recoveryCodeHashes: security.pendingRecoveryHashes,
      pendingSecretEnc: undefined,
      pendingRecoveryHashes: [],
      authVersion: getAdminAuthVersion(),
      updatedAt: new Date().toISOString(),
    };
    db.saveAdminSecurity(activated);
    db.revokeAdminSessions();
    db.markAuthChallengeUsed(challenge.id);
    res.clearCookie(ADMIN_CHALLENGE_COOKIE, challengeCookieBase);
    createAdminSession(req, res);
    db.audit({ actorType: 'admin', actorId: 'admin', action: 'admin_mfa_enabled', ip: req.ip, userAgent: req.get('user-agent') || undefined });
    return res.json({ success: true, user: sanitizeUser(buildAdminProfile()) });
  });

  app.post('/api/admin/mfa/verify', adminLoginLimiter, (req: AuthRequest, res) => {
    const challenge = resolveChallenge(req, 'admin_mfa_verify');
    if (!challenge) return res.status(401).json({ error: 'CHALLENGE_EXPIRED', message: 'MFA 验证会话已过期，请重新登录' });
    const security = db.getAdminSecurity();
    if (!security?.totpSecretEnc) return res.status(400).json({ error: 'MFA_NOT_CONFIGURED', message: '管理员 MFA 尚未配置' });
    const code = String(req.body?.code || '').trim();
    const recoveryCode = String(req.body?.recoveryCode || '').trim();
    let accepted = verifyTotp(decryptSecret(security.totpSecretEnc), code);
    if (!accepted && recoveryCode) {
      const hash = hmac(recoveryCode);
      const index = security.recoveryCodeHashes.indexOf(hash);
      if (index >= 0) {
        security.recoveryCodeHashes.splice(index, 1);
        security.updatedAt = new Date().toISOString();
        db.saveAdminSecurity(security);
        accepted = true;
      }
    }
    if (!accepted) return res.status(401).json({ error: 'INVALID_MFA', message: '动态验证码或恢复码错误' });
    db.markAuthChallengeUsed(challenge.id);
    res.clearCookie(ADMIN_CHALLENGE_COOKIE, challengeCookieBase);
    createAdminSession(req, res);
    db.audit({ actorType: 'admin', actorId: 'admin', action: 'admin_login_success', ip: req.ip, userAgent: req.get('user-agent') || undefined });
    return res.json({ success: true, user: sanitizeUser(buildAdminProfile()) });
  });

  app.post('/api/admin/logout', (req: AuthRequest, res) => {
    clearAdminSession(req, res);
    res.json({ success: true });
  });
  app.get('/api/admin/me', requireAdmin, (req: AuthRequest, res) => {
    res.json({ user: sanitizeUser(req.user!) });
  });

  app.get('/api/admin/stats', requireAdmin, (_req, res) => {
    const stats = db.getAdminStats();
    // 前端按 { stats: {...} } 解构；此前直接平铺返回，导致仪表盘永远停在「统计数据加载中…」。
    // peakConcurrentSse 与 uptimeHours 也在前端 AdminStats 里消费，需一并返回。
    res.json({
      stats: {
        ...stats,
        onlineUsers: onlineUsers(),
        totalRequestsServed: metrics.totalRequestsServed,
        requestsLastMinute: metrics.requestsLastMinute,
        activeSseConnections: metrics.activeSseConnections,
        peakConcurrentSse: metrics.peakConcurrentSse,
        uptimeHours: Number(((Date.now() - metrics.startTime) / 3_600_000).toFixed(1)),
      },
    });
  });

  app.get('/api/admin/users', requireAdmin, (_req, res) => {
    const users = db.getUsers().map((user) => sanitizeUser(user));
    res.json({ users });
  });

  app.post('/api/admin/users/create', requireAdmin, asyncJsonHandler<AuthRequest>(async (req, res) => {
    const phone = String(req.body?.phone || '').trim();
    const membershipTier = (req.body?.membershipTier || 'free_member') as MembershipTier;
    if (!/^\d{11}$/.test(phone)) return res.status(400).json({ error: 'INVALID_PHONE', message: '手机号码必须为 11 位数字' });
    if (phone === ADMIN_PHONE || db.getUserByPhone(phone)) return res.status(400).json({ error: 'PHONE_EXISTS', message: '该手机号不可用' });
    if (!['free_member', 'monthly_member', 'quarterly_member', 'yearly_member'].includes(membershipTier)) return res.status(400).json({ error: 'INVALID_TIER', message: '会员等级无效' });
    const temporaryPassword = generateTemporaryPassword();
    const now = new Date();
    const expiry = membershipExpiryFromNow(membershipTier);
    const dailyLimit = tierDailyLimit(db.getLLMConfig(), membershipTier);
    const user: UserProfile = {
      id: generateUserId(),
      unionId: `union_${crypto.randomUUID()}`,
      phone,
      password: await bcrypt.hash(temporaryPassword, 12),
      nickname: phone.slice(-4),
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&h=120&q=80',
      role: 'member',
      status: 'active',
      membershipTier,
      membershipExpiresAt: expiry,
      mustChangePassword: true,
      dailyMaxChats: dailyLimit,
      dailyUsedCount: 0,
      lastActiveDate: getTodayString(),
      createdAt: now.toISOString(),
    };
    const saved = db.saveUser(user);
    db.audit({ actorType: 'admin', actorId: 'admin', action: 'user_created', targetType: 'user', targetId: saved.id, metadata: { phone: maskPhone(phone), tier: membershipTier }, ip: req.ip, userAgent: req.get('user-agent') || undefined });
    res.json({ success: true, user: sanitizeUser(saved), temporaryPassword });
  }));

  app.post('/api/admin/users/reset-password', requireAdmin, async (req: AuthRequest, res) => {
    const user = db.getUserById(String(req.body?.userId || ''));
    if (!user) return res.status(404).json({ error: 'NOT_FOUND', message: '用户不存在' });
    const temporaryPassword = generateTemporaryPassword();
    user.password = await bcrypt.hash(temporaryPassword, 12);
    user.mustChangePassword = true;
    user.status = 'active';
    db.revokeUserSessions(user.id);
    db.saveUser(user);
    db.audit({ actorType: 'admin', actorId: 'admin', action: 'user_password_reset', targetType: 'user', targetId: user.id, ip: req.ip, userAgent: req.get('user-agent') || undefined });
    res.json({ success: true, temporaryPassword });
  });

  app.post('/api/admin/users/status', requireAdmin, (req: AuthRequest, res) => {
    const user = db.getUserById(String(req.body?.userId || ''));
    const status = String(req.body?.status || '');
    if (!user) return res.status(404).json({ error: 'NOT_FOUND', message: '用户不存在' });
    if (!['active', 'disabled'].includes(status)) return res.status(400).json({ error: 'INVALID_STATUS', message: '账号状态无效' });
    user.status = status as UserProfile['status'];
    db.saveUser(user);
    if (status === 'disabled') db.revokeUserSessions(user.id);
    db.audit({ actorType: 'admin', actorId: 'admin', action: `user_${status}`, targetType: 'user', targetId: user.id, ip: req.ip, userAgent: req.get('user-agent') || undefined });
    res.json({ success: true, user: sanitizeUser(user) });
  });

  app.post('/api/admin/users/update', requireAdmin, (req: AuthRequest, res) => {
    const { userId, phone, membershipTier, resetQuota } = req.body || {};
    const user = db.getUserById(String(userId || ''));
    if (!user) return res.status(404).json({ error: 'NOT_FOUND', message: '用户不存在' });
    if (phone !== undefined) {
      const cleanPhone = String(phone).trim();
      if (!/^\d{11}$/.test(cleanPhone) || cleanPhone === ADMIN_PHONE) return res.status(400).json({ error: 'INVALID_PHONE', message: '手机号码无效' });
      const existing = db.getUserByPhone(cleanPhone);
      if (existing && existing.id !== user.id) return res.status(400).json({ error: 'PHONE_EXISTS', message: '手机号已存在' });
      user.phone = cleanPhone;
      user.nickname = cleanPhone.slice(-4);
    }
    if (membershipTier && ['free_member', 'monthly_member', 'quarterly_member', 'yearly_member'].includes(membershipTier)) {
      // 额度每次保存都跟当前全局配置对齐
      user.dailyMaxChats = tierDailyLimit(db.getLLMConfig(), membershipTier);
      if (user.membershipTier !== membershipTier) {
        // 后台改等级 = 重新配置权益：到期日从当前时间重新起算，不叠加原有剩余时长
        user.membershipTier = membershipTier;
        user.membershipExpiresAt = membershipExpiryFromNow(membershipTier);
      }
    }
    if (resetQuota) user.dailyUsedCount = 0;
    db.saveUser(user);
    res.json({ success: true, user: sanitizeUser(user) });
  });

  app.post('/api/admin/users/upgrade-tier', requireAdmin, (req: AuthRequest, res) => {
    const tier = String(req.body?.tier || '') as MembershipTier;
    if (!['free_member', 'monthly_member', 'quarterly_member', 'yearly_member'].includes(tier)) return res.status(400).json({ error: 'INVALID_TIER', message: '会员等级无效' });
    const updated = db.upgradeUserMembership(String(req.body?.userId || ''), tier);
    if (!updated) return res.status(404).json({ error: 'NOT_FOUND', message: '用户不存在' });
    res.json({ success: true, user: sanitizeUser(updated) });
  });

  app.delete('/api/admin/users/:userId', requireAdmin, (req, res) => {
    const success = db.deleteUser(req.params.userId);
    db.audit({ actorType: 'admin', actorId: 'admin', action: 'user_deleted', targetType: 'user', targetId: req.params.userId, ip: req.ip, userAgent: req.get('user-agent') || undefined });
    res.json({ success });
  });

  app.post('/api/admin/users/clear-all', requireAdmin, (_req, res) => {
    db.clearAllUsers();
    res.json({ success: true, message: '已清空所有账号数据' });
  });

  app.post('/api/admin/orders/clear-all', requireAdmin, (_req, res) => {
    db.clearAllOrders();
    res.json({ success: true });
  });

  app.post('/api/admin/upload-asset', requireAdmin, adminActionLimiter, async (req, res) => {
    try {
      const fileName = String(req.body?.fileName || '');
      const fileData = String(req.body?.fileData || '');
      if (!fileName || !fileData) return res.status(400).json({ error: 'Missing fileName or fileData' });
      if (!/\.(png|jpe?g|webp|gif)$/i.test(fileName)) return res.status(400).json({ error: '仅支持常见图片格式' });
      const base64Data = fileData.replace(/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i, '');
      const buffer = Buffer.from(base64Data, 'base64');
      if (!buffer.length || buffer.length > 2 * 1024 * 1024) return res.status(400).json({ error: '图片必须小于 2MB' });
      const assetsDir = path.join(DATA_DIR, 'assets');
      fs.mkdirSync(assetsDir, { recursive: true });
      const cleanFileName = `cover_${Date.now()}_${randomToken(6)}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      await fs.promises.writeFile(path.join(assetsDir, cleanFileName), buffer, { flag: 'wx' });
      return res.json({ success: true, url: `/assets/${cleanFileName}` });
    } catch (err: any) {
      console.error('Asset upload error:', err);
      return res.status(500).json({ error: '图片保存失败' });
    }
  });

  app.post('/api/admin/tags', requireAdmin, (req, res) => {
    const { tags, renamedMap, deletedTags } = req.body || {};
    if (!Array.isArray(tags)) return res.status(400).json({ error: 'tags must be an array' });
    const savedTags = db.saveTags(tags);
    const skills = db.getSkills();
    for (const skill of skills) {
      let changed = false;
      if (skill.category) {
        if (renamedMap?.[skill.category]) { skill.category = renamedMap[skill.category]; changed = true; }
        if (deletedTags?.includes(skill.category) || !savedTags.includes(skill.category)) { skill.category = savedTags[0] || ''; changed = true; }
      } else if (savedTags.length) { skill.category = savedTags[0]; changed = true; }
      if (Array.isArray(skill.tags)) {
        let updated = skill.tags.map((tag) => renamedMap?.[tag] || tag);
        if (deletedTags) updated = updated.filter((tag) => !deletedTags.includes(tag));
        updated = updated.filter((tag) => savedTags.includes(tag));
        if (!updated.length && savedTags.length) updated = [savedTags[0]];
        if (JSON.stringify(updated) !== JSON.stringify(skill.tags)) { skill.tags = updated; changed = true; }
      }
      if (changed) db.saveSkill(skill);
    }
    res.json({ success: true, tags: savedTags });
  });

  app.get('/api/admin/skills', requireAdmin, (_req, res) => {
    res.json({ skills: db.getSkills() });
  });

  app.post('/api/admin/skills', requireAdmin, (req, res) => {
    const input = req.body?.skill;
    if (!input?.title || !input?.author) return res.status(400).json({ error: '请填写书名与作者' });
    const tags = Array.isArray(input.tags) ? input.tags.filter((tag: any) => typeof tag === 'string' && tag.trim()) : [];
    const validTags = tags.length ? tags : db.getTags().slice(0, 1);
    const skill = {
      id: input.id || `skill-${crypto.randomUUID()}`,
      title: cleanBookTitle(input.title),
      author: String(input.author),
      description: String(input.description || ''),
      category: validTags.includes(input.category) ? input.category : validTags[0],
      coverUrl: String(input.coverUrl || 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=600&q=80'),
      tags: validTags,
      systemPrompt: String(input.systemPrompt || ''),
      catalogContent: String(input.catalogContent || ''),
      bookContent: String(input.bookContent || ''),
      tokenCount: Number(input.tokenCount) || 12000,
      preferredModel: String(input.preferredModel || 'deepseek-chat'),
      sampleQuestions: Array.isArray(input.sampleQuestions) ? input.sampleQuestions.map(String).slice(0, 6) : [],
      chatCount: Number(input.chatCount) || 0,
      searchCount: Number(input.searchCount) || 0,
      skillType: input.skillType === 'mentor' ? 'mentor' as const : 'book' as const,
    };
    res.json({ success: true, skill: db.saveSkill(skill) });
  });

  app.delete('/api/admin/skills/:id', requireAdmin, (req, res) => {
    res.json({ success: db.deleteSkill(req.params.id) });
  });

  app.get('/api/admin/orders', requireAdmin, (_req, res) => res.json({ orders: db.getOrders() }));

  app.get('/api/admin/llm-config', requireAdmin, (_req, res) => res.json({ llmConfig: db.getAdminLLMConfigView() }));

  app.post('/api/admin/llm-config', requireAdmin, (req, res) => {
    const input = req.body?.llmConfig;
    if (!input) return res.status(400).json({ error: 'Missing llmConfig data' });
    const mode = req.body?.apiKeyMode as 'keep' | 'replace' | 'clear' | undefined;
    const rawSubmittedKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey : input.apiKey;
    const submittedKey = typeof rawSubmittedKey === 'string' ? rawSubmittedKey.trim() : undefined;
    const apiKey = mode === 'clear' ? null : mode === 'replace' || submittedKey ? submittedKey : undefined;
    if ((mode === 'replace' || submittedKey !== undefined) && !apiKey) return res.status(400).json({ error: 'INVALID_API_KEY', message: '请填写 API Key' });
    const saved = db.saveLLMConfig(input, apiKey);
    res.json({ success: true, llmConfig: db.getAdminLLMConfigView(), apiKeyConfigured: Boolean(saved.apiKey) });
  });

  app.post('/api/admin/llm-test', requireAdmin, async (req, res) => {
    const current = db.getLLMConfig();
    const cleanKey = cleanApiKey(req.body?.apiKey || current.apiKey || process.env.DEEPSEEK_API_KEY || '');
    const model = String(req.body?.primaryModel || current.primaryModel || 'deepseek-chat').trim();
    const baseUrl = String(req.body?.apiBaseUrl || current.apiBaseUrl || 'https://api.deepseek.com/v1').trim();
    if (isInvalidOrPlaceholderKey(cleanKey)) return res.json({ success: false, error: '未提供有效 API 密钥' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const startTime = Date.now();
    try {
      const upstream = await fetch(resolveOpenAIUrl(baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cleanKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: '测试API连通性，请回复OK' }], max_tokens: 16 }),
        signal: controller.signal,
      });
      const body = await upstream.text();
      res.json({ success: upstream.ok, status: upstream.status, model, latencyMs: Date.now() - startTime, response: body.slice(0, 500) });
    } catch (error: any) {
      res.json({ success: false, error: error?.message || '连接失败' });
    } finally {
      clearTimeout(timer);
    }
  });
}