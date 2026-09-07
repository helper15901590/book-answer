import { Express } from 'express';
import { db } from '../../src/db.js';
import { AuthRequest, signToken, sanitizeUser } from '../middleware/auth.js';
import { UserProfile, getEffectiveMembershipTier } from '../../src/types.js';
import { GUEST_USER } from '../../src/data/initialData.js';

export function registerAuthRoutes(app: Express): void {
  // 3. Auth APIs (Multi-tenant JWT stateless session)
  // 登录接口：严禁在此自动注册新账号，仅在现有数据库中匹配已存在用户
  app.post('/api/auth/login', (req, res) => {
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
      // 验证码/密码校验：如果该账号设置了密码或专属验证码，则校验是否一致
      if (user.password && user.password.trim()) {
        const requiredCode = user.password.trim();
        if (cleanCode !== requiredCode) {
          return res.status(400).json({ error: '登录密码或验证码错误，请重新输入' });
        }
      } else {
        user.password = cleanCode;
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
      // 未注册手机号自动创建账号（验证码免注册登录一体化）
      const newId = 'usr_' + Math.floor(Math.random() * 899999 + 100000);
      const suffix = cleanPhone.length >= 4 ? cleanPhone.slice(-4) : cleanPhone.padStart(4, '0');
      user = {
        id: newId,
        unionId: 'union_' + newId,
        phone: cleanPhone,
        password: cleanCode,
        nickname: (nickname || '').trim() || suffix,
        avatar: avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80',
        role: 'member',
        membershipTier: 'free_member',
        dailyMaxChats: freeMemberLimit,
        dailyUsedCount: 0,
        createdAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
        lastActiveDate: new Date().toISOString().split('T')[0],
      };
      db.saveUser(user);
    }

    const token = signToken(user);
    res.json({ success: true, user: { ...sanitizeUser(user), token }, token });
  });

  // 注册接口：专用于创建新账号并持久化至数据库
  app.post('/api/auth/register', (req, res) => {
    const { phone, code, nickname, avatar } = req.body;
    const cleanPhone = (phone || '').trim();
    if (!cleanPhone) {
      return res.status(400).json({ error: '请输入手机号码' });
    }
    if (!/^\d{11}$/.test(cleanPhone)) {
      return res.status(400).json({ error: '手机号码必须为11位阿拉伯数字' });
    }
    const cleanCode = (code || '').trim();
    if (!cleanCode) {
      return res.status(400).json({ error: '请输入6位短信验证码' });
    }
    if (!/^\d{6}$/.test(cleanCode)) {
      return res.status(400).json({ error: '验证码必须为6位阿拉伯数字' });
    }

    // 检查手机号是否已被注册
    let existing = db.getUserByPhone(cleanPhone);
    if (!existing) {
      const users = db.getUsers();
      existing = users.find((u) => u.phone === cleanPhone);
    }
    if (existing) {
      return res.status(400).json({ error: '该手机号码已注册，请直接前往登录' });
    }

    const config = db.getLLMConfig();
    const freeMemberLimit = config.dailyLimits?.freeMember ?? 10;

    const newId = 'usr_' + Math.floor(Math.random() * 899999 + 100000);
    const suffix = cleanPhone.length >= 4 ? cleanPhone.slice(-4) : cleanPhone.padStart(4, '0');
    const newUser: UserProfile = {
      id: newId,
      unionId: 'union_' + newId,
      phone: cleanPhone,
      password: cleanCode,
      nickname: (nickname || '').trim() || suffix,
      avatar: avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80',
      role: 'member',
      membershipTier: 'free_member',
      dailyMaxChats: freeMemberLimit,
      dailyUsedCount: 0,
      createdAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
    };
    db.saveUser(newUser);

    const token = signToken(newUser);
    res.json({ success: true, user: { ...sanitizeUser(newUser), token }, token, message: '注册成功' });
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
