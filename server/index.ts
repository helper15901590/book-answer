import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import { PORT, IS_PROD } from './config.js';
import { AuthRequest, extractUserFromRequest, authMiddleware } from './middleware/auth.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerSkillsRoutes } from './routes/skills.js';
import { registerChatRoutes } from './routes/chat.js';
import { metrics } from './services/metrics.js';
import { cleanApiKey, isInvalidOrPlaceholderKey, resolveOpenAIUrl } from './services/llm/sanitize.js';
import { resolveGeminiModelName } from './services/llm/gemini.js';
import { db } from '../src/db.js';
import {
  UserProfile,
  OrderLog,
  cleanBookTitle,
  MembershipTier,
  getMembershipTierLabel,
} from '../src/types.js';

async function startServer() {
  const app = express();

  app.use(express.json({ limit: '10mb' }));
  app.use('/assets', express.static(path.join(process.cwd(), 'assets')));

  // Request counter
  app.use((req, res, next) => {
    metrics.totalRequestsServed++;
    metrics.requestsLastMinute++;
    next();
  });

  app.use(authMiddleware);

  // 1. Health check & concurrency status
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      activeSseConnections: metrics.activeSseConnections,
      peakConcurrentSse: metrics.peakConcurrentSse,
      uptimeSeconds: Math.floor((Date.now() - metrics.startTime) / 1000),
    });
  });

  // 2. Upload asset API
  app.post('/api/admin/upload-asset', async (req, res) => {
    try {
      const { fileName, fileData } = req.body;
      if (!fileName || !fileData) {
        return res.status(400).json({ error: 'Missing fileName or fileData' });
      }

      const assetsDir = path.join(process.cwd(), 'assets');
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

  // 3-6. Auth / Skills / Chat 路由（已提取至 server/routes/*，行为零变化）
  registerAuthRoutes(app);
  registerSkillsRoutes(app);
  registerChatRoutes(app);

  // =========================================================================
  // 7. Membership Order & Commercial Payment APIs
  // =========================================================================
  app.post('/api/payment/create-membership-order', (req: AuthRequest, res) => {
    const { planType, paymentMethod, userId } = req.body;
    let targetUser = req.user || (userId ? db.getUserById(userId) : null);

    if (!targetUser || targetUser.role === 'guest') {
      return res.status(401).json({ error: '请先登录会员账号再进行会员订阅' });
    }

    const config = db.getLLMConfig();
    const plans = config.membershipPlans || {
      monthlyPrice: 29.9,
      quarterlyPrice: 69.9,
      yearlyPrice: 199.0,
    };

    let amount = plans.monthlyPrice;
    let planName = '月度会员 (30天)';
    let normalizedPlan: 'monthly' | 'quarterly' | 'yearly' = 'monthly';

    if (planType === 'quarterly') {
      normalizedPlan = 'quarterly';
      amount = plans.quarterlyPrice;
      planName = '季度会员 (90天)';
    } else if (planType === 'yearly') {
      normalizedPlan = 'yearly';
      amount = plans.yearlyPrice;
      planName = '年度会员 (365天)';
    }

    const tradeNo = 'VIP_' + Date.now() + '_' + Math.floor(Math.random() * 899 + 100);
    const order: OrderLog = {
      id: 'ord-' + Date.now(),
      tradeNo,
      userId: targetUser.id,
      unionId: targetUser.unionId,
      planType: normalizedPlan,
      planName,
      amount,
      type: 'membership',
      paymentMethod: paymentMethod || 'wechat',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    db.createOrder(order);

    res.json({
      success: true,
      order,
      qrCodeData: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=PAY_${tradeNo}`,
      message: `订单创建成功，请扫码完成支付`,
    });
  });

  // Backward compatibility alias for create-order
  app.post('/api/payment/create-order', (req: AuthRequest, res) => {
    const { planType, paymentMethod, userId } = req.body;
    let targetUser = req.user || (userId ? db.getUserById(userId) : null);

    if (!targetUser || targetUser.role === 'guest') {
      return res.status(401).json({ error: '请先登录会员账号' });
    }

    const config = db.getLLMConfig();
    const plans = config.membershipPlans || {
      monthlyPrice: 29.9,
      quarterlyPrice: 69.9,
      yearlyPrice: 199.0,
    };

    let amount = plans.monthlyPrice;
    let planName = '月度会员 (30天)';
    let normalizedPlan: 'monthly' | 'quarterly' | 'yearly' = 'monthly';

    if (planType === 'quarterly') {
      normalizedPlan = 'quarterly';
      amount = plans.quarterlyPrice;
      planName = '季度会员 (90天)';
    } else if (planType === 'yearly') {
      normalizedPlan = 'yearly';
      amount = plans.yearlyPrice;
      planName = '年度会员 (365天)';
    }

    const tradeNo = 'VIP_' + Date.now() + '_' + Math.floor(Math.random() * 899 + 100);
    const order: OrderLog = {
      id: 'ord-' + Date.now(),
      tradeNo,
      userId: targetUser.id,
      unionId: targetUser.unionId,
      planType: normalizedPlan,
      planName,
      amount,
      type: 'membership',
      paymentMethod: paymentMethod || 'wechat',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    db.createOrder(order);

    res.json({
      success: true,
      order,
      qrCodeData: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=PAY_${tradeNo}`,
      message: `订单创建成功`,
    });
  });

  // Polling order status
  app.get('/api/payment/order-status/:tradeNo', (req, res) => {
    const order = db.getOrderByTradeNo(req.params.tradeNo);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    const user = order.userId ? db.getUserById(order.userId) : null;
    res.json({
      tradeNo: order.tradeNo,
      status: order.status,
      paidAt: order.paidAt,
      user,
    });
  });

  // Test / Sandbox Instant Checkout
  app.post('/api/payment/simulate-pay', (req: AuthRequest, res) => {
    const { tradeNo, planType, userId } = req.body;
    const uid = req.user?.id || userId;
    let targetOrder: OrderLog | undefined;

    if (tradeNo) {
      targetOrder = db.getOrderByTradeNo(tradeNo);
    }

    if (targetOrder) {
      const updated = db.updateOrderStatus(targetOrder.id, 'success');
      const user = updated?.userId ? db.getUserById(updated.userId) : null;
      return res.json({ success: true, order: updated, user });
    }

    if (uid) {
      const user = db.getUserById(uid);
      if (user) {
        const config = db.getLLMConfig();
        const plans = config.membershipPlans || {
          monthlyPrice: 29.9,
          quarterlyPrice: 69.9,
          yearlyPrice: 199.0,
        };

        const targetPlan = planType === 'quarterly' ? 'quarterly' : planType === 'yearly' ? 'yearly' : 'monthly';
        const amount = targetPlan === 'quarterly' ? plans.quarterlyPrice : targetPlan === 'yearly' ? plans.yearlyPrice : plans.monthlyPrice;
        const planName = targetPlan === 'quarterly' ? '季度会员 (90天)' : targetPlan === 'yearly' ? '年度会员 (365天)' : '月度会员 (30天)';

        const newTradeNo = 'VIP_' + Date.now() + '_' + Math.floor(Math.random() * 899 + 100);
        const order: OrderLog = {
          id: 'ord-' + Date.now(),
          tradeNo: newTradeNo,
          userId: user.id,
          unionId: user.unionId,
          planType: targetPlan,
          planName,
          amount,
          type: 'membership',
          paymentMethod: 'wechat',
          status: 'success',
          createdAt: new Date().toISOString(),
          paidAt: new Date().toISOString(),
        };

        db.createOrder(order);

        let tier: MembershipTier = 'monthly_member';
        let days = 30;
        if (targetPlan === 'quarterly') {
          tier = 'quarterly_member';
          days = 90;
        } else if (targetPlan === 'yearly') {
          tier = 'yearly_member';
          days = 365;
        }

        const updatedUser = db.upgradeUserMembership(user.id, tier, days);
        return res.json({ success: true, order, user: updatedUser });
      }
    }

    res.status(400).json({ error: '无效的支付请求参数' });
  });

  // Webhook for real payment callbacks (e.g. WeChat Pay / Alipay)
  app.post('/api/payment/webhook', (req, res) => {
    const { tradeNo, status } = req.body;
    if (!tradeNo) {
      return res.status(400).json({ error: 'Missing tradeNo' });
    }
    const updated = db.updateOrderStatus(tradeNo, status === 'failed' ? 'failed' : 'success');
    res.json({ success: true, order: updated });
  });

  app.get('/api/payment/orders', (req: AuthRequest, res) => {
    const uid = req.user?.id || (typeof req.query.userId === 'string' ? req.query.userId : undefined);
    const orders = db.getOrders(uid);
    res.json({ orders });
  });

  // 8. Tags Management APIs

  app.post('/api/admin/tags', (req, res) => {
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

  // 9. Admin Operations APIs
  app.get('/api/admin/stats', (req, res) => {
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

  app.get('/api/admin/users', (req, res) => {
    const users = db.getUsers();
    res.json({ users });
  });

  app.post('/api/admin/users/create', (req, res) => {
    const { phone, password, code, membershipTier } = req.body;
    
    const cleanPhone = (phone || '').trim();
    if (!cleanPhone) {
      return res.status(400).json({ error: '手机号码不能为空' });
    }

    const cleanCode = (code || password || '').trim();
    if (!cleanCode) {
      return res.status(400).json({ error: '登录验证码不能为空' });
    }

    const existing = db.getUserByPhone(cleanPhone);
    if (existing) {
      return res.status(400).json({ error: '该手机号已存在关联用户' });
    }

    const suffix = cleanPhone.length >= 4 ? cleanPhone.slice(-4) : cleanPhone.padStart(4, '0');
    const autoNickname = suffix;
    const userId = 'usr_' + (cleanPhone ? cleanPhone.slice(-8) : Date.now().toString().slice(-8) + Math.floor(Math.random() * 1000));
    const unionId = 'wx_internal_' + Date.now() + Math.floor(Math.random() * 1000);
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
      password: cleanCode,
      nickname: autoNickname,
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&h=120&q=80',
      role: assignedTier === 'guest' ? 'guest' : 'member',
      membershipTier: assignedTier,
      membershipExpiresAt: expiresAt,
      dailyMaxChats: maxChats,
      dailyUsedCount: 0,
      guestUsedCount: 0,
      buyoutUsedCount: 0,
      buyoutUsageMap: {},
      unlockedSkillIds: [],
      isAdmin: false,
      lastActiveDate: new Date().toISOString().slice(0, 10),
      invitedCount: 0,
      createdAt: new Date().toISOString(),
    };

    const saved = db.saveUser(newUser);
    res.json({ success: true, user: saved });
  });

  app.delete('/api/admin/users/:userId', (req, res) => {
    const { userId } = req.params;
    const success = db.deleteUser(userId);
    res.json({ success });
  });

  app.post('/api/admin/users/update', (req, res) => {
    const { userId, phone, password, code, membershipTier, resetQuota } = req.body;
    const user = db.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    // 更新手机号码与自动生成昵称
    if (phone !== undefined) {
      const cleanPhone = phone.trim();
      if (cleanPhone) {
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
      user.password = newCode.trim();
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
    res.json({ success: true, user });
  });

  app.post('/api/admin/users/upgrade-tier', (req, res) => {
    const { userId, tier, days } = req.body;
    if (!userId || !tier) {
      return res.status(400).json({ error: 'Missing userId or tier' });
    }
    const updated = db.upgradeUserMembership(userId, tier, days || 30);
    res.json({ success: true, user: updated });
  });

  app.post('/api/admin/users/:userId/membership', (req, res) => {
    const { userId } = req.params;
    const { membershipTier, membershipExpiresAt } = req.body;
    const user = db.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (membershipTier) user.membershipTier = membershipTier;
    if (membershipExpiresAt !== undefined) user.membershipExpiresAt = membershipExpiresAt;
    db.saveUser(user);
    res.json({ success: true, user });
  });

  app.post('/api/admin/users/clear-all', (req, res) => {
    db.clearAllUsers();
    res.json({ success: true, message: '已成功清空所有用户数据' });
  });

  app.post('/api/admin/orders/clear-all', (req, res) => {
    db.clearAllOrders();
    res.json({ success: true, message: '已成功清空所有订单数据' });
  });

  app.post('/api/admin/skills', (req, res) => {
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
      priceType: skill.priceType || 'free_trial',
      buyoutPrice: Number(skill.buyoutPrice) || 19.9,
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

  app.delete('/api/admin/skills/:id', (req, res) => {
    const success = db.deleteSkill(req.params.id);
    res.json({ success });
  });

  app.get('/api/admin/orders', (req, res) => {
    const orders = db.getOrders();
    res.json({ orders });
  });

  app.get('/api/admin/llm-config', (req, res) => {
    const llmConfig = db.getLLMConfig();
    res.json({ llmConfig });
  });

  app.post('/api/admin/llm-config', (req, res) => {
    const { llmConfig } = req.body;
    if (!llmConfig) {
      return res.status(400).json({ error: 'Missing llmConfig data' });
    }
    const saved = db.saveLLMConfig(llmConfig);
    res.json({ success: true, llmConfig: saved });
  });

  app.post('/api/admin/llm-test', async (req, res) => {
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

  // 10. Vite Middleware for development / production
  if (!IS_PROD) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Enterprise Commercial Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
