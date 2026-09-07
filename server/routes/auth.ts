import { Express } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { db } from '../../src/db.js';
import { AuthRequest, signToken, sanitizeUser } from '../middleware/auth.js';
import { getEffectiveMembershipTier } from '../../src/types.js';
import { GUEST_USER } from '../../src/data/initialData.js';

// 登录限流：10 次/分/IP（防撞库/暴力破解）
const authLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: '尝试过于频繁，请稍后再试' } });

export function registerAuthRoutes(app: Express): void {
  // 3. Auth APIs (Multi-tenant JWT stateless session)
  // 登录接口：严禁在此自动注册新账号，仅在现有数据库中匹配已存在用户
  app.post('/api/auth/login', authLimiter, (req, res) => {
    const { phone, code, nickname, avatar } = req.body;
    const cleanPhone = (phone || '').trim();
    if (!cleanPhone) {
      return res.status(400).json({ error: '请输入手机号码' });
    }
    const cleanCode = (code || '').trim();
    if (!cleanCode) {
      return res.status(400).json({ error: '请输入登录验证码/密码' });
    }
    if (!/^\d{6}$/.test(cleanCode)) {
      return res.status(400).json({ error: '验证码/密码必须为6位阿拉伯数字' });
    }

    const config = db.getLLMConfig();
    const guestLimit = config.dailyLimits?.guestUser ?? 3;
    const freeMemberLimit = config.dailyLimits?.freeMember ?? 10;
    const monthlyLimit = config.dailyLimits?.monthlyMember ?? 100;
    const quarterlyLimit = config.dailyLimits?.quarterlyMember ?? 200;
    const yearlyLimit = config.dailyLimits?.yearlyMember ?? 500;

    let user = db.getUserByPhone(cleanPhone);
    if (!user) {
      const users = db.getUsers();
      user = users.find((u) => u.phone === cleanPhone || (u.nickname && u.nickname === cleanPhone));
    }

    if (user) {
      // 密码校验：数据库存储 bcrypt 哈希，使用 compareSync 恒定时间比对（不再明文比较，不再"未设密码即存输入"）
      const storedHash = (user.password || '').trim();
      if (!storedHash || !bcrypt.compareSync(cleanCode, storedHash)) {
        return res.status(400).json({ error: '登录密码或验证码错误，请重新输入' });
      }

      if (user.role === 'guest') {
        user.role = 'member';
      }
      if (!user.membershipTier || user.membershipTier === 'guest') {
        user.membershipTier = 'free_member';
      }

      const effectiveTier = getEffectiveMembershipTier(user);
      if (effectiveTier === 'monthly_member') {
        user.dailyMaxChats = monthlyLimit;
      } else if (effectiveTier === 'quarterly_member') {
        user.dailyMaxChats = quarterlyLimit;
      } else if (effectiveTier === 'yearly_member') {
        user.dailyMaxChats = yearlyLimit;
      } else if (effectiveTier === 'free_member') {
        user.dailyMaxChats = freeMemberLimit;
      } else {
        user.dailyMaxChats = guestLimit;
      }

      if (nickname) user.nickname = nickname;
      if (avatar) user.avatar = avatar;
      db.saveUser(user);
    } else {
      // 仅管理员建号：不再自动注册（自助注册后门已关闭）
      return res.status(404).json({ error: '该账号不存在，内测阶段账号由管理员统一开通，请联系管理员' });
    }

    const token = signToken(user);
    res.json({ success: true, user: { ...sanitizeUser(user), token }, token });
  });

  app.get('/api/auth/me', (req: AuthRequest, res) => {
    if (req.user) {
      return res.json({ user: sanitizeUser(req.user) });
    }
    res.json({ user: sanitizeUser(GUEST_USER) });
  });

  app.post('/api/auth/logout', (req, res) => {
    res.json({ success: true, user: sanitizeUser(GUEST_USER) });
  });

  app.post('/api/auth/update', (req: AuthRequest, res) => {
    const targetUserId = req.user?.id || req.body.userId;
    if (!targetUserId) {
      return res.status(401).json({ error: '请先登录' });
    }
    const existing = db.getUserById(targetUserId);
    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }
    const updated = db.saveUser({ ...existing, ...req.body.updates });
    res.json({ success: true, user: sanitizeUser(updated) });
  });
}
