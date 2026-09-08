import { Express } from 'express';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { GoogleGenAI } from '@google/genai';
import { db, getTodayString } from '../db.js';
import { DATA_DIR, ADMIN_PHONE, ADMIN_PASSWORD } from '../config.js';
import { metrics } from '../services/metrics.js';
import { requireAdmin } from '../middleware/admin.js';
import { sanitizeUser, signToken, buildAdminProfile } from '../middleware/auth.js';
import { cleanApiKey, isInvalidOrPlaceholderKey, resolveOpenAIUrl } from '../services/llm/sanitize.js';
import { resolveGeminiModelName } from '../services/llm/gemini.js';
import { newUserId } from '../services/ids.js';
import { UserProfile, MembershipTier, cleanBookTitle } from '../../src/types.js';

// 后台登录限流：10 次/分/IP（与前台登录限流同口径）
const adminLoginLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: '尝试过于频繁，请稍后再试' } });

// 管理员密码 bcrypt 哈希惰性缓存（compareSync 恒定时间比对，避免明文直接比较）
let adminPasswordHash: string | null = null;

export function registerAdminRoutes(app: Express): void {
  // 后台专用登录端点：管理员账号不入库，直接校验环境变量凭证（ADMIN_PHONE/ADMIN_PASSWORD）；
  // 前台 /api/auth/login 对管理员手机号一律按「账号不存在」处理
  app.post('/api/admin/login', adminLoginLimiter, (req, res) => {
    const { phone, code } = req.body;
    const cleanPhone = (phone || '').trim();
    const cleanCode = (code || '').trim();
    if (!cleanPhone || !cleanCode) {
      return res.status(400).json({ error: '请输入手机号码与密码' });
    }
    if (!ADMIN_PHONE || !/^\d{6}$/.test(ADMIN_PASSWORD)) {
      return res.status(500).json({ error: '管理员凭证未配置，请检查环境变量 ADMIN_PHONE/ADMIN_PASSWORD' });
    }
    // 非管理员手机号按「账号不存在」提示，不暴露管理员身份
    if (cleanPhone !== ADMIN_PHONE) {
      return res.status(404).json({ error: '该账号不存在' });
    }
    if (!adminPasswordHash) adminPasswordHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
    if (!bcrypt.compareSync(cleanCode, adminPasswordHash)) {
      return res.status(400).json({ error: '登录密码错误，请重新输入' });
    }
    const admin = buildAdminProfile();
    const token = signToken(admin);
    res.json({ success: true, user: { ...sanitizeUser(admin), token }, token });
  });

  // 素材上传 API
  app.post('/api/admin/upload-asset', requireAdmin, async (req, res) => {
    try {
      const { fileName, fileData } = req.body;
      if (!fileName || !fileData) {
        return res.status(400).json({ error: 'Missing fileName or fileData' });
      }

      const assetsDir = path.join(DATA_DIR, 'assets');
      if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir, { recursive: true });
      }

      const base64Data = fileData.replace(/^data:image\/\w+;base64,/, '').replace(/^data:application\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');

      const cleanFileName = `cover_${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const filePath = path.join(assetsDir, cleanFileName);

      await fs.promises.writeFile(filePath, buffer);
      const publicUrl = `/assets/${cleanFileName}`;
      res.json({ success: true, url: publicUrl });
    } catch (err: any) {
      console.error('Asset upload error:', err);
      res.status(500).json({ error: err.message || 'Failed to save asset' });
    }
  });

  // 标签管理 API
  app.post('/api/admin/tags', requireAdmin, (req, res) => {
    const { tags, renamedMap, deletedTags } = req.body;
    if (!Array.isArray(tags)) {
      return res.status(400).json({ error: 'tags must be an array' });
    }

    const savedTags = db.saveTags(tags);
    const skills = db.getSkills();
    skills.forEach((s) => {
      let changed = false;
      if (s.category) {
        if (renamedMap && renamedMap[s.category]) {
          s.category = renamedMap[s.category];
          changed = true;
        }
        if (deletedTags && deletedTags.includes(s.category)) {
          s.category = savedTags[0] || '';
          changed = true;
        }
        if (!savedTags.includes(s.category)) {
          s.category = savedTags[0] || '';
          changed = true;
        }
      } else if (savedTags.length > 0) {
        s.category = savedTags[0];
        changed = true;
      }

      if (Array.isArray(s.tags)) {
        let updatedTags = s.tags.map((t) => (renamedMap && renamedMap[t]) || t);
        if (deletedTags) {
          updatedTags = updatedTags.filter((t) => !deletedTags.includes(t));
        }
        updatedTags = updatedTags.filter((t) => savedTags.includes(t));
        if (updatedTags.length === 0 && savedTags.length > 0) {
          updatedTags = s.category && savedTags.includes(s.category) ? [s.category] : [savedTags[0]];
        }
        if (JSON.stringify(updatedTags) !== JSON.stringify(s.tags)) {
          s.tags = updatedTags;
          changed = true;
        }
      } else {
        s.tags = savedTags.length > 0 ? [savedTags[0]] : [];
        changed = true;
      }
      if (changed) {
        db.saveSkill(s);
      }
    });

    res.json({ success: true, tags: savedTags });
  });

  // 后台管理运营 API
  app.get('/api/admin/stats', requireAdmin, (req, res) => {
    const baseStats = db.getAdminStats();
    res.json({
      stats: {
        ...baseStats,
        activeSseConnections: metrics.activeSseConnections,
        peakConcurrentSse: metrics.peakConcurrentSse,
        totalRequestsServed: metrics.totalRequestsServed,
        requestsLastMinute: metrics.requestsLastMinute,
        uptimeHours: Number(((Date.now() - metrics.startTime) / 3600000).toFixed(1)),
      },
    });
  });

  app.get('/api/admin/users', requireAdmin, (req, res) => {
    const users = db.getUsers();
    res.json({ users: users.map(sanitizeUser) });
  });

  app.post('/api/admin/users/create', requireAdmin, (req, res) => {
    const { phone, password, code, membershipTier } = req.body;
    
    const cleanPhone = (phone || '').trim();
    if (!cleanPhone) {
      return res.status(400).json({ error: '手机号码不能为空' });
    }
    if (!/^\d{11}$/.test(cleanPhone)) {
      return res.status(400).json({ error: '手机号码必须为11位阿拉伯数字' });
    }

    const cleanCode = (code || password || '').trim();
    if (!cleanCode) {
      return res.status(400).json({ error: '登录验证码不能为空' });
    }
    // 与改密口径一致：非 6 位数字会被前台登录的格式校验拦下，产出无法登录的死账号
    if (!/^\d{6}$/.test(cleanCode)) {
      return res.status(400).json({ error: '密码必须为6位阿拉伯数字' });
    }

    // 管理员手机号不可被普通账号占用：维持前台对该号码统一按「账号不存在」处理的不变量
    if (ADMIN_PHONE && cleanPhone === ADMIN_PHONE) {
      return res.status(400).json({ error: '该手机号不可用' });
    }

    const existing = db.getUserByPhone(cleanPhone);
    if (existing) {
      return res.status(400).json({ error: '该手机号已存在关联用户' });
    }

    const suffix = cleanPhone.length >= 4 ? cleanPhone.slice(-4) : cleanPhone.padStart(4, '0');
    const autoNickname = suffix;
    const userId = newUserId();
    const unionId = 'union_' + crypto.randomUUID();
    const assignedTier: MembershipTier = membershipTier || 'free_member';
    
    // 跟随后台统一配置的会员有效周期
    let expiresAt: string | undefined = undefined;
    if (assignedTier === 'monthly_member') {
      const expDate = new Date();
      expDate.setMonth(expDate.getMonth() + 1);
      expiresAt = expDate.toISOString();
    } else if (assignedTier === 'quarterly_member') {
      const expDate = new Date();
      expDate.setMonth(expDate.getMonth() + 3);
      expiresAt = expDate.toISOString();
    } else if (assignedTier === 'yearly_member') {
      const expDate = new Date();
      expDate.setFullYear(expDate.getFullYear() + 1);
      expiresAt = expDate.toISOString();
    }

    // 跟随后台统一配置的每日模型调用上限
    const config = db.getLLMConfig();
    let maxChats = config.dailyLimits?.freeMember ?? 10;
    if (assignedTier === 'guest') maxChats = config.dailyLimits?.guestUser ?? 3;
    else if (assignedTier === 'monthly_member') maxChats = config.dailyLimits?.monthlyMember ?? 100;
    else if (assignedTier === 'quarterly_member') maxChats = config.dailyLimits?.quarterlyMember ?? 200;
    else if (assignedTier === 'yearly_member') maxChats = config.dailyLimits?.yearlyMember ?? 500;

    const newUser: UserProfile = {
      id: userId,
      unionId,
      phone: cleanPhone,
      password: bcrypt.hashSync(cleanCode, 10),
      nickname: autoNickname,
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&h=120&q=80',
      role: assignedTier === 'guest' ? 'guest' : 'member',
      membershipTier: assignedTier,
      membershipExpiresAt: expiresAt,
      dailyMaxChats: maxChats,
      dailyUsedCount: 0,
      guestUsedCount: 0,
      isAdmin: false,
      // 复用配额引擎的本地时区日期口径（UTC 口径会在每天 00:00-08:00 建号时写入「昨天」，触发多余的周期重置）
      lastActiveDate: getTodayString(),
      createdAt: new Date().toISOString(),
    };

    const saved = db.saveUser(newUser);
    res.json({ success: true, user: sanitizeUser(saved) });
  });

  app.delete('/api/admin/users/:userId', requireAdmin, (req, res) => {
    const { userId } = req.params;
    const success = db.deleteUser(userId);
    res.json({ success });
  });

  app.post('/api/admin/users/update', requireAdmin, (req, res) => {
    const { userId, phone, password, code, membershipTier, resetQuota } = req.body;
    const user = db.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    // 更新手机号码与自动生成昵称
    if (phone !== undefined) {
      const cleanPhone = phone.trim();
      if (cleanPhone) {
        // 服务端兜底校验：拒绝掩码占位（138****xxxx）等非法手机号入库
        if (!/^\d{11}$/.test(cleanPhone)) {
          return res.status(400).json({ error: '手机号码必须为11位阿拉伯数字' });
        }
        // 管理员手机号不可被普通账号占用（同建号口径）
        if (ADMIN_PHONE && cleanPhone === ADMIN_PHONE) {
          return res.status(400).json({ error: '该手机号不可用' });
        }
        const existing = db.getUserByPhone(cleanPhone);
        if (existing && existing.id !== user.id) {
          return res.status(400).json({ error: '该手机号已存在关联用户' });
        }
        user.phone = cleanPhone;
        const suffix = cleanPhone.length >= 4 ? cleanPhone.slice(-4) : cleanPhone.padStart(4, '0');
        user.nickname = suffix;
      } else {
        user.phone = undefined;
      }
    }

    // 更新验证码
    const newCode = (code !== undefined ? code : password);
    if (newCode && typeof newCode === 'string' && newCode.trim()) {
      // 与建号口径一致：密码必须为6位数字，防止误存非法口令导致账号无法登录
      if (!/^\d{6}$/.test(newCode.trim())) {
        return res.status(400).json({ error: '密码必须为6位阿拉伯数字' });
      }
      user.password = bcrypt.hashSync(newCode.trim(), 10);
    }

    // 更新会员等级（自动联动有效期与每日模型调用上限）
    if (membershipTier) {
      const isTierChanged = user.membershipTier !== membershipTier;
      user.membershipTier = membershipTier;

      if (user.role !== 'admin') {
        user.role = membershipTier === 'guest' ? 'guest' : 'member';
      }

      // 跟随后台统一配置的会员有效周期
      const hasValidFutureExpiry = user.membershipExpiresAt && !isNaN(new Date(user.membershipExpiresAt).getTime()) && new Date(user.membershipExpiresAt).getTime() > Date.now();
      if (isTierChanged || !hasValidFutureExpiry) {
        if (membershipTier === 'monthly_member') {
          const expDate = new Date();
          expDate.setMonth(expDate.getMonth() + 1);
          user.membershipExpiresAt = expDate.toISOString();
        } else if (membershipTier === 'quarterly_member') {
          const expDate = new Date();
          expDate.setMonth(expDate.getMonth() + 3);
          user.membershipExpiresAt = expDate.toISOString();
        } else if (membershipTier === 'yearly_member') {
          const expDate = new Date();
          expDate.setFullYear(expDate.getFullYear() + 1);
          user.membershipExpiresAt = expDate.toISOString();
        } else {
          user.membershipExpiresAt = undefined;
        }
      }

      // 跟随后台统一配置的每日模型调用上限
      const config = db.getLLMConfig();
      let maxChats = config.dailyLimits?.freeMember ?? 10;
      if (membershipTier === 'guest') maxChats = config.dailyLimits?.guestUser ?? 3;
      else if (membershipTier === 'monthly_member') maxChats = config.dailyLimits?.monthlyMember ?? 100;
      else if (membershipTier === 'quarterly_member') maxChats = config.dailyLimits?.quarterlyMember ?? 200;
      else if (membershipTier === 'yearly_member') maxChats = config.dailyLimits?.yearlyMember ?? 500;
      user.dailyMaxChats = maxChats;
    }

    if (resetQuota) {
      user.dailyUsedCount = 0;
      user.guestUsedCount = 0;
    }

    db.saveUser(user);
    res.json({ success: true, user: sanitizeUser(user) });
  });

  app.post('/api/admin/users/upgrade-tier', requireAdmin, (req, res) => {
    const { userId, tier, days } = req.body;
    if (!userId || !tier) {
      return res.status(400).json({ error: 'Missing userId or tier' });
    }
    const updated = db.upgradeUserMembership(userId, tier, days || 30);
    if (!updated) {
      return res.status(404).json({ error: '用户不存在' });
    }
    res.json({ success: true, user: sanitizeUser(updated) });
  });

  app.post('/api/admin/users/:userId/membership', requireAdmin, (req, res) => {
    const { userId } = req.params;
    const { membershipTier, membershipExpiresAt } = req.body;
    const user = db.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (membershipTier) user.membershipTier = membershipTier;
    if (membershipExpiresAt !== undefined) user.membershipExpiresAt = membershipExpiresAt;
    db.saveUser(user);
    res.json({ success: true, user: sanitizeUser(user) });
  });

  app.post('/api/admin/users/clear-all', requireAdmin, (req, res) => {
    db.clearAllUsers();
    res.json({ success: true, message: '已成功清空所有用户数据' });
  });

  app.post('/api/admin/orders/clear-all', requireAdmin, (req, res) => {
    db.clearAllOrders();
    res.json({ success: true, message: '已成功清空所有订单数据' });
  });

  app.post('/api/admin/skills', requireAdmin, (req, res) => {
    const { skill } = req.body;
    if (!skill || !skill.title || !skill.author) {
      return res.status(400).json({ error: '请填写真实的导师书名与作者' });
    }

    const rawTags = Array.isArray(skill.tags)
      ? skill.tags.filter((t: any) => typeof t === 'string' && t.trim())
      : [];

    const currentDbTags = db.getTags();
    let validTags = rawTags.filter((t: string) => currentDbTags.includes(t));
    if (validTags.length === 0) {
      validTags = currentDbTags.length > 0 ? [currentDbTags[0]] : ['商业投资'];
    }

    const category = skill.category && validTags.includes(skill.category)
      ? skill.category
      : validTags[0];

    const skillData = {
      id: skill.id || 'skill-' + Date.now(),
      title: cleanBookTitle(skill.title),
      author: skill.author,
      description: skill.description || '',
      category: category,
      coverUrl: skill.coverUrl || 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=600&q=80',
      tags: rawTags,
      systemPrompt: skill.systemPrompt || '',
      catalogContent: skill.catalogContent || '# 目录\n- 第一章：核心阐释\n- 第二章：应用思考',
      bookContent: skill.bookContent || '',
      tokenCount: Number(skill.tokenCount) || 12000,
      preferredModel: skill.preferredModel || 'deepseek-chat',
      sampleQuestions: Array.isArray(skill.sampleQuestions) ? skill.sampleQuestions : [],
      chatCount: Number(skill.chatCount) || 0,
      searchCount: Number(skill.searchCount) || 0,
    };

    const saved = db.saveSkill(skillData);
    res.json({ success: true, skill: saved });
  });

  app.delete('/api/admin/skills/:id', requireAdmin, (req, res) => {
    const success = db.deleteSkill(req.params.id);
    res.json({ success });
  });

  app.get('/api/admin/orders', requireAdmin, (req, res) => {
    const orders = db.getOrders();
    res.json({ orders });
  });

  app.get('/api/admin/llm-config', requireAdmin, (req, res) => {
    const llmConfig = db.getLLMConfig();
    res.json({ llmConfig });
  });

  app.post('/api/admin/llm-config', requireAdmin, (req, res) => {
    const { llmConfig } = req.body;
    if (!llmConfig) {
      return res.status(400).json({ error: 'Missing llmConfig data' });
    }
    const saved = db.saveLLMConfig(llmConfig);
    res.json({ success: true, llmConfig: saved });
  });

  app.post('/api/admin/llm-test', requireAdmin, async (req, res) => {
    const { apiBaseUrl, apiKey, primaryModel } = req.body;
    const cleanKey = cleanApiKey(apiKey || process.env.DEEPSEEK_API_KEY || '');
    const model = (primaryModel || 'deepseek-chat').trim();
    const baseUrl = (apiBaseUrl || 'https://api.deepseek.com/v1').trim();
    const geminiKey = process.env.GEMINI_API_KEY || (cleanKey.startsWith('AIza') ? cleanKey : '');

    const hasValidKey = !isInvalidOrPlaceholderKey(cleanKey);

    if (!hasValidKey && !geminiKey) {
      return res.json({
        success: false,
        error: '未提供有效 API 密钥 (API Key 为空或为示例格式)',
      });
    }

    const startTime = Date.now();

    // 1. If Gemini model or no custom key provided (using server-side Gemini service)
    if (model.toLowerCase().includes('gemini') || (!hasValidKey && geminiKey)) {
      try {
        const ai = new GoogleGenAI({
          apiKey: geminiKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        });
        const targetModel = resolveGeminiModelName(model);
        const testModels = Array.from(new Set([targetModel, 'gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-3.8-flash']));
        let response: any = null;
        let usedModelName = targetModel;
        let lastErr: any = null;

        for (const tm of testModels) {
          let timer: NodeJS.Timeout | null = null;
          try {
            const generatePromise = ai.models.generateContent({
              model: tm,
              contents: '请回复“连接成功”四个字。',
            });
            const timeoutPromise = new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('请求超时 (8秒)')), 8000);
            });
            response = await Promise.race([generatePromise, timeoutPromise]);
            if (timer) clearTimeout(timer);
            usedModelName = tm;
            if (response?.text) break;
          } catch (e: any) {
            if (timer) clearTimeout(timer);
            lastErr = e;
          }
        }

        if (!response) {
          throw lastErr || new Error('模型服务未正常响应');
        }

        const latency = Date.now() - startTime;
        return res.json({
          success: true,
          latencyMs: latency,
          model: `${usedModelName} (平台内置高可用服务)`,
          reply: response?.text || '连接成功',
        });
      } catch (err: any) {
        return res.json({
          success: false,
          error: err.message || '大模型服务连接失败',
        });
      }
    }

    // 2. Standard OpenAI-compatible model test
    try {
      const targetUrl = resolveOpenAIUrl(baseUrl);
      const isReasoner =
        model.includes('reasoner') ||
        model.includes('r1') ||
        model.includes('o1') ||
        model.includes('o3');

      const payload: any = {
        model,
        messages: [{ role: 'user', content: '测试API连通性，请回复OK' }],
        max_tokens: 16,
      };
      if (!isReasoner) {
        payload.temperature = 0.7;
      }

      const controller = new AbortController();
      const timeoutTimer = setTimeout(() => controller.abort(), 12000);

      const upstreamRes = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cleanKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeoutTimer);

      const latency = Date.now() - startTime;
      if (upstreamRes.ok) {
        const json = await upstreamRes.json().catch(() => ({}));
        const reply = json.choices?.[0]?.message?.content || 'OK';
        return res.json({
          success: true,
          latencyMs: latency,
          model,
          reply,
        });
      } else {
        const errText = await upstreamRes.text().catch(() => '');
        let errMsg = `HTTP ${upstreamRes.status}`;
        try {
          const errJson = JSON.parse(errText);
          errMsg = errJson.error?.message || errJson.message || errMsg;
        } catch {
          if (errText) errMsg = `${errMsg}: ${errText.slice(0, 150)}`;
        }
        return res.json({
          success: false,
          error: errMsg,
          status: upstreamRes.status,
        });
      }
    } catch (err: any) {
      return res.json({
        success: false,
        error: err.name === 'AbortError' ? '请求超时 (12秒)' : err.message || '网络连接异常',
      });
    }
  });
}
