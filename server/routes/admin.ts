import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { Express } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db, getTodayString, MAX_TAGS } from '../db.js';
import { ADMIN_PASSWORD, ADMIN_PHONE, DATA_DIR } from '../config.js';
import { metrics, onlineUsers } from '../services/metrics.js';
import {
  AuthRequest,
  buildAdminProfile,
  clearAdminSession,
  createAdminSession,
  requireAdmin,
  sanitizeUser,
} from '../middleware/auth.js';
import { cleanApiKey, isInvalidOrPlaceholderKey, resolveOpenAIUrl } from '../services/llm/sanitize.js';
import { BCRYPT_ROUNDS, generateTemporaryPassword } from '../services/password.js';
import { asyncJsonHandler } from '../middleware/asyncHandler.js';
import { generateUserId, randomToken } from '../services/security.js';
import { MembershipTier, UserProfile, cleanBookTitle, isSkillType, membershipExpiryFromNow, tierDailyLimit } from '../../src/types.js';
import { toPublicSkill } from './skills.js';

const adminLoginLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: '尝试过于频繁，请稍后再试' } });
const adminActionLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });
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

function maskPhone(phone?: string): string {
  if (!phone || phone.length < 7) return phone || '';
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

export function registerAdminRoutes(app: Express): void {
  app.post('/api/admin/login', adminLoginLimiter, (req, res) => {
    const phone = String(req.body?.phone || '').trim();
    const password = String(req.body?.password || req.body?.code || '');
    const key = `${req.ip}:${phone}`;
    const failure = loginFailures.get(key);
    if (failure && failure.lockedUntil > Date.now()) return res.status(423).json({ error: 'ACCOUNT_LOCKED', message: '登录尝试过多，请 15 分钟后重试' });
    if (!validAdminCredentials(phone, password)) {
      const next = { count: (failure?.count || 0) + 1, lockedUntil: 0, lastSeen: Date.now() };
      if (next.count >= 5) next.lockedUntil = Date.now() + 15 * 60 * 1000;
      loginFailures.set(key, next);
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: '账号或密码错误' });
    }
    loginFailures.delete(key);
    createAdminSession(req as AuthRequest, res);
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
        csrfOriginRejected: metrics.csrfOriginRejected,
        csrfTokenRejected: metrics.csrfTokenRejected,
        uptimeHours: Number(((Date.now() - metrics.startTime) / 3_600_000).toFixed(1)),
      },
    });
  });

  app.get('/api/admin/users', requireAdmin, (_req, res) => {
    // 关注数一次 GROUP BY 取回，避免为每个用户单独查询（N+1）。
    const followCounts = db.getUserFollowCounts();
    const users = db.getUsers().map((user) => ({ ...sanitizeUser(user), followCount: followCounts.get(user.id) || 0 }));
    res.json({ users });
  });

  // 后台查看单个用户的关注列表：只读，不提供代关注/代取关。
  app.get('/api/admin/users/:userId/follows', requireAdmin, (req: AuthRequest, res) => {
    const user = db.getUserById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'NOT_FOUND', message: '用户不存在' });
    const follows = db.getUserFollows(user.id).map(({ skill, followedAt }) => ({ ...toPublicSkill(skill), followedAt }));
    return res.json({ follows });
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
      phone,
      password: await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS),
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

  app.post('/api/admin/users/reset-password', requireAdmin, asyncJsonHandler<AuthRequest>(async (req, res) => {
    const user = db.getUserById(String(req.body?.userId || ''));
    if (!user) return res.status(404).json({ error: 'NOT_FOUND', message: '用户不存在' });
    const temporaryPassword = generateTemporaryPassword();
    user.password = await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS);
    user.mustChangePassword = true;
    user.status = 'active';
    db.revokeUserSessions(user.id);
    db.saveUser(user);
    db.audit({ actorType: 'admin', actorId: 'admin', action: 'user_password_reset', targetType: 'user', targetId: user.id, ip: req.ip, userAgent: req.get('user-agent') || undefined });
    res.json({ success: true, temporaryPassword });
  }));

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
    // 错误码不与既有的 INVALID_REQUEST 复用：那个码在用户端三份字典里已经绑定到
    // 「请检查会话、技能和消息内容」，同一码承载两种语义会让按码翻译与按码排查同时失效。
    if (!Array.isArray(tags)) return res.status(400).json({ error: 'INVALID_TAGS', message: '标签必须是数组' });
    // 超限必须显式拒绝，不能交给 replaceTags 去截断：被丢掉的标签下所有书籍会被回落到
    // 第一个分类，而调用方只会看到一个 success。
    if (tags.length > MAX_TAGS) return res.status(400).json({ error: 'TOO_MANY_TAGS', message: `分类标签最多 ${MAX_TAGS} 个，当前 ${tags.length} 个` });
    const { savedTags, affectedSkills } = db.replaceTags({ tags, renamedMap, deletedTags });
    // 至少得留一个分类：标签是整个平台的分类主键，删空会让所有书籍失去分类。
    // 被拒的破坏性写入同样要留档——否则「反复试探清空分类」在 audit_logs 里毫无痕迹。
    if (!savedTags.length) {
      db.audit({
        actorType: 'admin', actorId: 'admin', action: 'tags_update_rejected',
        metadata: { reason: 'EMPTY_TAGS', renamedMap: renamedMap || {}, deletedTags: deletedTags || [] },
        ip: req.ip, userAgent: req.get('user-agent') || undefined,
      });
      return res.status(400).json({ error: 'EMPTY_TAGS', message: '至少需要保留一个分类标签，否则全部书籍会失去分类' });
    }
    db.audit({
      actorType: 'admin', actorId: 'admin', action: 'tags_updated',
      metadata: { tagCount: savedTags.length, renamedMap: renamedMap || {}, deletedTags: deletedTags || [], affectedSkills },
      ip: req.ip, userAgent: req.get('user-agent') || undefined,
    });
    res.json({ success: true, tags: savedTags, affectedSkills });
  });

  app.get('/api/admin/skills', requireAdmin, (_req, res) => {
    res.json({ skills: db.getSkills() });
  });

  app.post('/api/admin/skills', requireAdmin, (req, res) => {
    const input = req.body?.skill;
    if (!input?.title || !input?.author) return res.status(400).json({ error: '请填写书名与作者' });
    const tags = Array.isArray(input.tags) ? input.tags.filter((tag: any) => typeof tag === 'string' && tag.trim()) : [];
    const validTags = tags.length ? tags : db.getTags().slice(0, 1);
    // 更新既有技能时先取当前记录：热度字段缺省时要用它保留库中值，见下方 searchCount。
    const existing = input.id ? db.getSkillById(String(input.id)) : undefined;
    const skill = {
      id: input.id || `skill-${crypto.randomUUID()}`,
      title: cleanBookTitle(input.title),
      author: String(input.author),
      description: String(input.description || ''),
      category: validTags.includes(input.category) ? input.category : validTags[0],
      coverUrl: String(input.coverUrl || 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=600&q=80'),
      tags: validTags,
      systemPrompt: String(input.systemPrompt || ''),
      sampleQuestions: Array.isArray(input.sampleQuestions) ? input.sampleQuestions.map(String).slice(0, 6) : [],
      chatCount: Number(input.chatCount) || 0,
      // 热度由管理员设定初始值、服务端再随浏览自增。字段缺省表示管理员没改动这个输入框，
      // 必须沿用库中当前值，否则一次只改描述的保存会把弹窗打开期间累积的浏览增量抹掉。
      searchCount: input.searchCount === undefined ? (existing?.searchCount ?? 0) : Number(input.searchCount) || 0,
      skillType: isSkillType(input.skillType) ? input.skillType : 'book',
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