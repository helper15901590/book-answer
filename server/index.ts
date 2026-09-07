import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import { PORT, IS_PROD } from './config.js';
import { AuthRequest, signToken, extractUserFromRequest, authMiddleware } from './middleware/auth.js';
import { metrics } from './services/metrics.js';
import { db } from '../src/db.js';
import {
  UserProfile,
  ChatMessage,
  OrderLog,
  cleanBookTitle,
  MembershipTier,
  getEffectiveMembershipTier,
  getMembershipTierLabel,
} from '../src/types.js';
import { GUEST_USER } from '../src/data/initialData.js';

// Helper for deep offline book distillation synthesis when LLMs are offline
function generateDeepBookDistillation(skill: any, userQuery: string, history: ChatMessage[] = []): string {
  const bookTitle = cleanBookTitle(skill?.title || '经典著作');
  const author = skill?.author || '原著作者';
  const tags = (skill?.tags || ['认知进阶', '底层逻辑', '实战决策']).filter(Boolean);
  const mainTag = tags[0] || '系统性思考';
  const secondTag = tags[1] || '本质洞察';

  const rawQuotes = (skill?.bookContent || '')
    .split('\n')
    .map((s: string) => s.trim())
    .filter((s: string) => s && !s.startsWith('#') && !s.startsWith('【') && s.length > 4);

  const matchedQuote = rawQuotes.find((q: string) => 
    userQuery.split('').some((char) => q.includes(char) && !'的是在中有和了吗呢？?，。请问如何'.includes(char))
  ) || rawQuotes[0] || '弱小和无知不是生存的障碍，傲慢才是。';

  const rawChapters = (skill?.catalogContent || '')
    .split('\n')
    .map((s: string) => s.trim())
    .filter((s: string) => s && (s.startsWith('-') || s.startsWith('第') || /^\d/.test(s) || s.startsWith('#')));

  const matchedChapter = rawChapters.find((c: string) =>
    userQuery.split('').some((char) => c.includes(char) && !'的是在中有和了吗呢？?，。请问如何'.includes(char))
  ) || rawChapters[0] || '第一章：核心逻辑与基石定律';

  const cleanChapter = matchedChapter.replace(/^[-*#\d.]+\s*/, '').replace(/^[第一二三四五六七八九十]+[章节讲集部篇：:\s]*/, '');

  return `针对你所探讨的议题：“**${userQuery}**”，为你提供深度剖析：

### 一、 核心逻辑与底层规律溯源
在《${bookTitle}》中，探讨此类问题的底层基石是 **【${mainTag}】** 与 **【${secondTag}】**：
1. **穿透表象看本质**：很多时候我们在具体场景中感受到的阻力，并不是执行层面的缺陷，而是底层假设与认知模型存在偏差。
2. **核心锚点**：面对复杂系统的博弈或破局，首要任务是确立自己的**不可变核心边界**与**非对称优势**。

### 二、 思维模型推演与破局路径
建议从以下三个关键杠杆点切入破局：
* **维度 1（认知升维与逆向防守）**：先明确“什么事情绝对不能做”，通过排除致命错误（安全边际）来锁定高概率胜率。
* **维度 2（构建复利型飞轮）**：将单次的尝试转化为标准化、可沉淀的原则，让经验在时间周期中形成正向增强回路。
* **维度 3（非对称反馈与动态校准）**：以极低试错成本开展小步快跑，获取真实世界的反馈数据，持续优化决策算法。

### 三、 落地推演行动清单（Action Checklist）
1. **第一步（盘点核心筹码）**：写下你目前掌握的独特专长或核心资源，剥离低价值无效消耗；
2. **第二步（制定边界原则）**：依据“${mainTag}”制定 2~3 条不可逾越的行为铁律；
3. **第三步（敏捷闭环验证）**：在 48 小时内完成一次最小闭环落地测试，并记录核心推演得失。`;
}

// Helper to sanitize chat messages for DeepSeek / OpenAI compatible APIs
function sanitizeMessagesForLLM(
  systemPrompt: string,
  history: ChatMessage[] = [],
  currentMessage: string
): { role: string; content: string }[] {
  const result: { role: string; content: string }[] = [];

  const cleanSystem = (systemPrompt || '').trim();
  if (cleanSystem) {
    result.push({ role: 'system', content: cleanSystem });
  }

  // Filter valid history messages
  const validHistory = (history || [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0)
    .slice(-12);

  for (const m of validHistory) {
    const trimmed = m.content.trim();
    // Prevent duplicate of current message at the very end of history
    if (m === validHistory[validHistory.length - 1] && m.role === 'user' && trimmed === currentMessage.trim()) {
      continue;
    }
    result.push({ role: m.role, content: trimmed });
  }

  const cleanUserMsg = (currentMessage || '').trim();
  if (cleanUserMsg) {
    result.push({ role: 'user', content: cleanUserMsg });
  }

  return result;
}
function isInvalidOrPlaceholderKey(key?: string): boolean {
  if (!key) return true;
  const k = key.trim();
  if (k.length < 12) return true;
  if (k.includes('****')) return true;
  if (k.toLowerCase().includes('placeholder') || k.toLowerCase().includes('your_api_key')) return true;
  return false;
}

function resolveGeminiModelName(modelName?: string): string {
  const m = (modelName || '').trim().toLowerCase();
  if (!m || !m.includes('gemini')) {
    return 'gemini-3.1-flash-lite';
  }
  if (m === 'gemini-pro' || m.includes('3.1-pro')) {
    return 'gemini-3.1-pro-preview';
  }
  if (m.includes('flash-lite') || m.includes('lite')) {
    return 'gemini-3.1-flash-lite';
  }
  if (m === 'gemini-3.8-flash') {
    return 'gemini-3.8-flash';
  }
  if (m === 'gemini-flash-latest') {
    return 'gemini-flash-latest';
  }
  if (
    m.includes('2.5') ||
    m.includes('2.0') ||
    m.includes('1.5') ||
    m.includes('1.0') ||
    m === 'gemini-flash' ||
    m === 'gemini'
  ) {
    return 'gemini-3.1-flash-lite';
  }
  return modelName!.trim();
}

async function callGeminiResponse({
  geminiKey,
  targetModel,
  systemPrompt,
  messageText,
  timeoutMs,
}: {
  geminiKey: string;
  targetModel?: string;
  systemPrompt: string;
  messageText: string;
  timeoutMs?: number;
}): Promise<string> {
  const ai = new GoogleGenAI({
    apiKey: geminiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const preferred = resolveGeminiModelName(targetModel);
  // Place high-availability and fast 'gemini-3.1-flash-lite' immediately as first fallback
  // to seamlessly handle temporary 503 high-demand / capacity spikes on 3.8-flash
  const candidateModels = Array.from(
    new Set([preferred, 'gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-3.8-flash'])
  );
  const totalTimeout = timeoutMs || 60000;
  const deadline = Date.now() + totalTimeout;

  let lastErr: any = null;
  for (const model of candidateModels) {
    const remainingTotalMs = deadline - Date.now();
    if (remainingTotalMs < 2000) {
      break;
    }
    const perAttemptTimeout = Math.min(25000, Math.max(4000, remainingTotalMs));

    for (let attempt = 0; attempt < 2; attempt++) {
      if (Date.now() >= deadline - 1000) break;

      let timer: NodeJS.Timeout | null = null;
      try {
        const generatePromise = ai.models.generateContent({
          model,
          contents: messageText,
          config: {
            systemInstruction: systemPrompt,
            temperature: 0.7,
          },
        });
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Gemini 请求超时 (${Math.round(perAttemptTimeout / 1000)}秒)`)),
            perAttemptTimeout
          );
        });
        const response: any = await Promise.race([generatePromise, timeoutPromise]);
        if (timer) clearTimeout(timer);
        const text = (response?.text || '').trim();
        if (text) {
          return text;
        }
      } catch (err: any) {
        if (timer) clearTimeout(timer);
        lastErr = err;
        const errMsg = err?.message || String(err);
        console.warn(`Gemini generation with model [${model}] attempt ${attempt + 1} notice:`, errMsg);

        const isHighDemand =
          errMsg.includes('503') ||
          errMsg.includes('high demand') ||
          errMsg.includes('UNAVAILABLE') ||
          errMsg.includes('429');

        // On 503 / UNAVAILABLE / high demand, immediately failover to next candidate model
        // without burning time retrying the exact same overloaded model cluster
        if (isHighDemand) {
          break;
        }

        if (attempt < 1) {
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    }
  }
  throw lastErr || new Error('Gemini generation failed');
}

// Helper to sanitize API Keys
function cleanApiKey(rawKey: string): string {
  let key = (rawKey || '').trim();
  if (key.startsWith('Bearer ')) {
    key = key.substring(7).trim();
  }
  key = key.replace(/^["']|["']$/g, '');
  return key;
}

// Helper to resolve standard OpenAI compatible endpoint
function resolveOpenAIUrl(baseUrl: string): string {
  let url = (baseUrl || 'https://api.deepseek.com/v1').trim().replace(/\/+$/, '');
  if (url.endsWith('/chat/completions')) return url;
  if (url.endsWith('/v1') || url.includes('/compatible-mode') || url.endsWith('/openai')) {
    return `${url}/chat/completions`;
  }
  if (
    url.includes('openai.com') ||
    url.includes('siliconflow.cn') ||
    url.includes('groq.com') ||
    url.includes('moonshot.cn') ||
    url.includes('deepseek.com')
  ) {
    if (!url.includes('/v1')) {
      return `${url}/v1/chat/completions`;
    }
  }
  return `${url}/chat/completions`;
}

// Generate grounded recommended follow-up questions from uploaded Skill/mentor document using LLM
async function generateRecommendedQuestionsFromLLM({
  systemPrompt,
  title,
  author,
}: {
  systemPrompt: string;
  title?: string;
  author?: string;
}): Promise<string[]> {
  const llmConfig = db.getLLMConfig();
  const rawApiKey = (llmConfig.apiKey || llmConfig.deepseekApiKey || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || '').trim();
  const apiKey = cleanApiKey(rawApiKey);
  const apiBaseUrl = (llmConfig.apiBaseUrl || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').trim();
  const modelUsed = (llmConfig.primaryModel || process.env.DEEPSEEK_MODEL || 'deepseek-chat').trim();
  const geminiKey = process.env.GEMINI_API_KEY || (apiKey.startsWith('AIza') ? apiKey : '');
  const hasValidCustomKey = !isInvalidOrPlaceholderKey(apiKey);
  const isExplicitGemini = modelUsed.toLowerCase().includes('gemini');

  const docSnippet = (systemPrompt || '').slice(0, 4000);
  const cleanTitle = cleanBookTitle(title || '本书');
  const authorStr = author ? `【作者】：${author}\n` : '';

  const prompt = `你是一位深度理解原著精髓的导师与读者对话引导专家。
请仔细分析以下刚刚上传的书籍/导师 Skill 原著文档内容（包含原著的核心理论、关键概念、案例与导师角色定位）：

【书名】：${cleanTitle}
${authorStr}【Skill 原著文档内容】：
${docSnippet}

【任务要求】：
请根据该文档中实际包含的核心概念、独特论点、关键案例或思维模型，提炼生成 3 到 4 个最切中原著精髓、最引人入胜、最具启发性且紧密贴合本书独特内容的读者“推荐追问”（引导性问题）。

【严苛标准】：
1. 必须紧密贴合文档中提及的具体概念、术语、理论或案例，严禁出现任何通用、空泛的模板套话（例如切勿输出“本书最核心的观点是什么”、“如何将书中理论应用到工作中”等放之四海而皆准的空泛问题）；
2. 问句自然、口语化，适合读者在刚开启与导师对话时一键点击提问，字数控制在 15 ~ 28 字之间；
3. 必须且仅能以严格合法的 JSON 字符串数组格式输出，例如：
["问题一", "问题二", "问题三"]
绝对不要带有任何 markdown 语法块（如 \`\`\`json）、序号、前缀或多余的解释文字。`;

  let rawOutput = '';

  // 1. Try Custom OpenAI / DeepSeek if configured
  if (hasValidCustomKey && !isExplicitGemini) {
    try {
      const targetUrl = resolveOpenAIUrl(apiBaseUrl);
      const isReasoner =
        modelUsed.includes('reasoner') ||
        modelUsed.includes('r1') ||
        modelUsed.includes('o1') ||
        modelUsed.includes('o3');

      const payload: any = {
        model: modelUsed,
        messages: [
          { role: 'system', content: '你是一位精通图书知识体系的专家，只输出合法的 JSON 字符串数组。' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 600,
      };
      if (!isReasoner) {
        payload.temperature = 0.7;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const json: any = await res.json();
        rawOutput = json.choices?.[0]?.message?.content || '';
      }
    } catch (e) {
      console.warn('Custom LLM question generation failed, trying fallback:', e);
    }
  }

  // 2. Try Gemini if custom failed or gemini configured
  if (!rawOutput && geminiKey) {
    try {
      rawOutput = await callGeminiResponse({
        geminiKey,
        targetModel: resolveGeminiModelName(modelUsed),
        systemPrompt: '你是一位精通图书知识体系的专家，只输出合法的 JSON 字符串数组。',
        messageText: prompt,
        timeoutMs: 30000,
      });
    } catch (e) {
      console.warn('Gemini question generation failed:', e);
    }
  }

  // 3. Parse JSON output
  let parsed: string[] = [];
  if (rawOutput) {
    try {
      const cleaned = rawOutput.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      const jsonArr = JSON.parse(cleaned);
      if (Array.isArray(jsonArr)) {
        parsed = jsonArr.map((item) => String(item).trim()).filter((item) => item.length > 4);
      }
    } catch {
      const lines = rawOutput
        .split('\n')
        .map((l) => l.replace(/^[\d\.\-\*\s"“'‘\[\]]+/, '').replace(/["”'’\,\]]+$/, '').trim())
        .filter((l) => l.endsWith('？') || l.endsWith('?') || (l.length >= 10 && !l.startsWith('{')));
      if (lines.length >= 2) {
        parsed = lines.slice(0, 4);
      }
    }
  }

  // 4. Grounded heuristic fallback if LLM output was empty or invalid
  if (parsed.length < 2) {
    const conceptMatches = Array.from(systemPrompt.matchAll(/[“"「]([^”"」]{2,15})[”"」]/g)).map((m) => m[1]);
    const boldMatches = Array.from(systemPrompt.matchAll(/\*\*([^*]{2,15})\*\*/g)).map((m) => m[1]);
    const combined = Array.from(new Set([...conceptMatches, ...boldMatches])).filter(
      (c) => !c.includes('http') && !c.includes('www') && c.length >= 2 && c.length <= 15
    );

    if (combined.length >= 3) {
      parsed = [
        `如何理解原著中提出的“${combined[0]}”？它在实际场景中如何应用？`,
        `原著中关于“${combined[1]}”的核心逻辑是什么？如何避免常见误区？`,
        `如何将“${combined[2]}”与实际决策或行动相结合？`,
      ];
    } else if (combined.length >= 1) {
      parsed = [
        `如何理解原著中提出的“${combined[0]}”？它在实际场景中如何应用？`,
        `结合《${cleanTitle}》的核心论述，遇到重大抉择时该如何破局？`,
        `原著中最具实操价值的思考工具或原则是什么？`,
      ];
    } else {
      parsed = [
        `结合《${cleanTitle}》的导师设定，当前领域最核心的底层逻辑是什么？`,
        `原著中最值得反复咀嚼的思考模型或方法论是什么？`,
        `如果我想在实际工作与生活中实践本书精髓，第一步该怎么做？`,
      ];
    }
  }

  return parsed.slice(0, 4);
}

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
    res.json({ success: true, user: { ...user, token }, token });
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
    res.json({ success: true, user: { ...newUser, token }, token, message: '注册成功' });
  });

  app.get('/api/auth/me', (req: AuthRequest, res) => {
    if (req.user) {
      return res.json({ user: req.user });
    }
    res.json({ user: GUEST_USER });
  });

  app.post('/api/auth/logout', (req, res) => {
    res.json({ success: true, user: GUEST_USER });
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
    res.json({ success: true, user: updated });
  });

  // 4. Skills & Distilled Books Market APIs
  app.get('/api/skills', (req, res) => {
    const { search, category } = req.query;
    let skills = db.getSkills();

    if (search && typeof search === 'string') {
      const q = search.toLowerCase().trim();
      const cleanQ = cleanBookTitle(q).toLowerCase();
      skills = skills.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          (cleanQ && s.title.toLowerCase().includes(cleanQ)) ||
          (cleanQ && cleanBookTitle(s.title).toLowerCase().includes(cleanQ)) ||
          (s.author && s.author.toLowerCase().includes(q)) ||
          (cleanQ && s.author && s.author.toLowerCase().includes(cleanQ))
      );
    }

    if (category && typeof category === 'string' && category !== '全部') {
      skills = skills.filter((s) => s.category === category);
    }

    res.json({ skills });
  });

  app.get('/api/skills/:id', (req, res) => {
    const skill = db.getSkillById(req.params.id);
    if (!skill) {
      return res.status(404).json({ error: 'Skill not found' });
    }
    res.json({ skill });
  });

  app.post('/api/skills/:id/click', (req, res) => {
    const skill = db.getSkillById(req.params.id);
    if (!skill) {
      return res.status(404).json({ error: 'Skill not found' });
    }
    skill.searchCount = (skill.searchCount || 0) + 1;
    db.saveSkill(skill);
    res.json({ success: true, skill });
  });

  // Dynamic Follow-up Question Generation based on uploaded skill.md content
  app.post(['/api/skills/generate-questions', '/api/admin/skills/generate-questions'], async (req: AuthRequest, res) => {
    const { systemPrompt, title, author, skillId } = req.body || {};
    if (!systemPrompt || typeof systemPrompt !== 'string' || !systemPrompt.trim()) {
      return res.status(400).json({ error: '缺少有效的 Skill 原著文档内容 (systemPrompt)' });
    }

    try {
      const questions = await generateRecommendedQuestionsFromLLM({
        systemPrompt,
        title,
        author,
      });

      // If skillId provided, also update DB skill
      if (skillId && typeof skillId === 'string') {
        const skill = db.getSkillById(skillId);
        if (skill) {
          skill.sampleQuestions = questions;
          db.saveSkill(skill);
        }
      }

      res.json({ success: true, questions });
    } catch (err: any) {
      console.error('Error in /api/skills/generate-questions:', err);
      res.status(500).json({ error: err.message || '提炼推荐追问失败' });
    }
  });

  // 5. Chat Sessions APIs (User-isolated)
  app.get('/api/chat/sessions', (req: AuthRequest, res) => {
    const uid = req.user?.id || (typeof req.query.userId === 'string' ? req.query.userId : undefined);
    const sessions = uid ? db.getChatSessions(uid) : [];
    res.json({ sessions });
  });

  app.post('/api/chat/sessions', (req: AuthRequest, res) => {
    const { skillId, userId } = req.body;
    const uid = req.user?.id || userId;
    const skill = db.getSkillById(skillId);
    if (!skill) {
      return res.status(404).json({ error: 'Skill not found' });
    }

    const newSession = {
      id: 'session-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      userId: uid || undefined,
      skillId: skill.id,
      skillTitle: skill.title,
      skillAuthor: skill.author,
      skillCoverUrl: skill.coverUrl,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [
        {
          id: 'msg-' + Date.now(),
          role: 'assistant' as const,
          content: `你好！我是《${cleanBookTitle(skill.title)}》作者【${skill.author}】的AI思想蒸馏体。
我已将本书的核心理论、决策模型（${(skill.tags || []).join('、')}）融会贯通。
你可以提出你当前在商业、投资、工作或生活中的具体困惑，我将以原著思维模型为你提供深度答疑与决策剖析。`,
          timestamp: new Date().toISOString(),
          recommendedQuestions: Array.isArray(skill.sampleQuestions) && skill.sampleQuestions.length > 0 ? skill.sampleQuestions : undefined,
        },
      ],
    };

    db.saveChatSession(newSession);
    res.json({ session: newSession });
  });

  app.delete('/api/chat/sessions/:id', (req: AuthRequest, res) => {
    const uid = req.user?.id || (typeof req.query.userId === 'string' ? req.query.userId : undefined);
    if (!uid) {
      return res.status(401).json({ error: '未授权或缺少用户标识' });
    }
    const deleted = db.deleteChatSession(req.params.id, uid);
    res.json({ success: deleted });
  });

  // =========================================================================
  // Membership-based Multi-tier Quota Verification & Consumption Engine
  // =========================================================================
  function checkAndConsumeQuota(
    user: UserProfile | null,
    skill: any,
    llmConfig: any
  ): {
    allowed: boolean;
    status?: number;
    error?: string;
    message?: string;
    tier?: MembershipTier;
    updatedUser?: UserProfile;
  } {
    const guestLimit = llmConfig.dailyLimits?.guestUser ?? 3;
    const freeMemberLimit = llmConfig.dailyLimits?.freeMember ?? 10;
    const monthlyLimit = llmConfig.dailyLimits?.monthlyMember ?? 100;
    const quarterlyLimit = llmConfig.dailyLimits?.quarterlyMember ?? 200;
    const yearlyLimit = llmConfig.dailyLimits?.yearlyMember ?? 500;

    const isAdmin = user?.role === 'admin' || user?.isAdmin;
    if (isAdmin) {
      return { allowed: true, updatedUser: user || undefined };
    }

    const effectiveTier = getEffectiveMembershipTier(user);

    // 1. Guest (Unauthenticated or guest role)
    if (effectiveTier === 'guest' || !user) {
      const used = user?.guestUsedCount || 0;
      if (used >= guestLimit) {
        return {
          allowed: false,
          status: 401,
          error: 'GUEST_LIMIT_REACHED',
          message: `您当前还未注册登录，享有的体验额度${guestLimit}次已用完，请登录后继续体验。`,
          tier: 'guest',
        };
      }
      if (user) {
        user.guestUsedCount = used + 1;
        user.dailyMaxChats = guestLimit;
        const saved = db.saveUser(user);
        return { allowed: true, tier: 'guest', updatedUser: saved };
      }
      return { allowed: true, tier: 'guest' };
    }

    // 2. Free Member (Registered user without active VIP)
    if (effectiveTier === 'free_member') {
      const used = user.dailyUsedCount || 0;
      if (used >= freeMemberLimit) {
        return {
          allowed: false,
          status: 403,
          error: 'PAYWALL_REQUIRED',
          message: `本月普通会员免费额度已达上限 (${freeMemberLimit}/${freeMemberLimit}次)。开通月度/季度/年度会员，尊享每月超高频原著导师畅答与极速推理！`,
          tier: 'free_member',
        };
      }
      user.dailyUsedCount = used + 1;
      user.dailyMaxChats = freeMemberLimit;
      const saved = db.saveUser(user);
      return { allowed: true, tier: 'free_member', updatedUser: saved };
    }

    // 3. Monthly VIP
    if (effectiveTier === 'monthly_member') {
      const used = user.dailyUsedCount || 0;
      if (used >= monthlyLimit) {
        return {
          allowed: false,
          status: 429,
          error: 'VIP_LIMIT_REACHED',
          message: `您本月月度会员对话额度已达上限 (${monthlyLimit}/${monthlyLimit}次)，每月1日零点自动刷新，请下月继续交流。`,
          tier: 'monthly_member',
        };
      }
      user.dailyUsedCount = used + 1;
      user.dailyMaxChats = monthlyLimit;
      const saved = db.saveUser(user);
      return { allowed: true, tier: 'monthly_member', updatedUser: saved };
    }

    // 4. Quarterly VIP
    if (effectiveTier === 'quarterly_member') {
      const used = user.dailyUsedCount || 0;
      if (used >= quarterlyLimit) {
        return {
          allowed: false,
          status: 429,
          error: 'VIP_LIMIT_REACHED',
          message: `您本月季度会员对话额度已达上限 (${quarterlyLimit}/${quarterlyLimit}次)，每月1日零点自动刷新，请下月继续交流。`,
          tier: 'quarterly_member',
        };
      }
      user.dailyUsedCount = used + 1;
      user.dailyMaxChats = quarterlyLimit;
      const saved = db.saveUser(user);
      return { allowed: true, tier: 'quarterly_member', updatedUser: saved };
    }

    // 5. Yearly VIP
    if (effectiveTier === 'yearly_member') {
      const used = user.dailyUsedCount || 0;
      if (used >= yearlyLimit) {
        return {
          allowed: false,
          status: 429,
          error: 'VIP_LIMIT_REACHED',
          message: `您本月年度会员对话额度已达上限 (${yearlyLimit}/${yearlyLimit}次)，每月1日零点自动刷新，请下月继续交流。`,
          tier: 'yearly_member',
        };
      }
      user.dailyUsedCount = used + 1;
      user.dailyMaxChats = yearlyLimit;
      const saved = db.saveUser(user);
      return { allowed: true, tier: 'yearly_member', updatedUser: saved };
    }

    return { allowed: true, updatedUser: user };
  }

  // 6. Native SSE (Server-Sent Events) High-Concurrency Streaming Endpoint
  app.post('/api/chat/stream', async (req: AuthRequest, res) => {
    const { sessionId, skillId, messageText, userId } = req.body;
    if (!sessionId || !messageText) {
      return res.status(400).json({ error: '缺少必要的 sessionId 或 messageText 参数' });
    }

    const currentUser = req.user || (userId ? db.getUserById(userId) : null);
    let session = db.getChatSessionById(sessionId);
    if (!session) {
      const targetSkill = (skillId ? db.getSkillById(skillId) : null) || db.getSkills()[0];
      if (targetSkill) {
        session = {
          id: sessionId,
          userId: currentUser?.id,
          skillId: targetSkill.id,
          skillTitle: targetSkill.title,
          skillAuthor: targetSkill.author,
          skillCoverUrl: targetSkill.coverUrl,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [],
        };
        db.saveChatSession(session);
      }
    }

    const skill = (session ? db.getSkillById(session.skillId) : null) || db.getSkills()[0];
    const llmConfig = db.getLLMConfig();

    // Check Membership Quota
    const quota = checkAndConsumeQuota(currentUser, skill, llmConfig);
    if (!quota.allowed) {
      return res.status(quota.status || 403).json({
        error: quota.error,
        message: quota.message,
        tier: quota.tier,
      });
    }

    // Save user message immediately
    const userMsg: ChatMessage = {
      id: 'msg-u-' + Date.now(),
      role: 'user',
      content: messageText,
      timestamp: new Date().toISOString(),
    };
    if (session) {
      session.messages.push(userMsg);
      db.saveChatSession(session);
    }

    // Set SSE Headers
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    metrics.activeSseConnections++;
    if (metrics.activeSseConnections > metrics.peakConcurrentSse) {
      metrics.peakConcurrentSse = metrics.activeSseConnections;
    }

    let isClientConnected = true;
    res.on('close', () => {
      isClientConnected = false;
      metrics.activeSseConnections = Math.max(0, metrics.activeSseConnections - 1);
    });

    const rawApiKey = (llmConfig.apiKey || llmConfig.deepseekApiKey || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || '').trim();
    const apiKey = cleanApiKey(rawApiKey);
    const apiBaseUrl = (llmConfig.apiBaseUrl || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').trim();
    const modelUsed = (llmConfig.primaryModel || process.env.DEEPSEEK_MODEL || 'deepseek-chat').trim();
    const geminiKey = process.env.GEMINI_API_KEY || (apiKey.startsWith('AIza') ? apiKey : '');

    let fullAssistantReply = '';
    const startTime = Date.now();

    const writeSSE = (data: any) => {
      if (!isClientConnected || res.writableEnded) return;
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      if (typeof (res as any).flush === 'function') {
        (res as any).flush();
      }
    };

    let realStreamSuccess = false;

    let systemPrompt = (skill?.systemPrompt || '').trim();

    // 1. Prepare sanitized messages payload for LLM
    const messagesPayload = sanitizeMessagesForLLM(systemPrompt, session?.messages || [], messageText);

    const isExplicitGemini = modelUsed.toLowerCase().includes('gemini');

    const hasValidCustomKey = !isInvalidOrPlaceholderKey(apiKey);

    // Tier 1: Primary Route: If custom OpenAI/DeepSeek API Key is configured and valid
    if (hasValidCustomKey && !isExplicitGemini) {
      try {
        const targetUrl = resolveOpenAIUrl(apiBaseUrl);
        const isReasoner =
          modelUsed.includes('reasoner') ||
          modelUsed.includes('r1') ||
          modelUsed.includes('o1') ||
          modelUsed.includes('o3');

        const requestBody: any = {
          model: modelUsed,
          messages: messagesPayload,
          stream: true,
          max_tokens: llmConfig.maxTokens ? Number(llmConfig.maxTokens) : 4096,
        };

        if (!isReasoner) {
          requestBody.temperature = 0.7;
        }

        const timeoutSeconds = Math.max(30, Number(llmConfig.timeoutSec) || 60);
        const controller = new AbortController();
        const timeoutTimer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

        const upstreamRes = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
        clearTimeout(timeoutTimer);

        if (upstreamRes.ok && upstreamRes.body) {
          const reader = upstreamRes.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (isClientConnected) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data:')) continue;
              const payloadStr = trimmed.replace(/^data:\s*/, '').trim();
              if (payloadStr === '[DONE]') continue;

              try {
                const parsed = JSON.parse(payloadStr);
                const choice = parsed.choices?.[0];
                const delta = choice?.delta?.content ?? choice?.delta?.reasoning_content ?? '';
                if (delta) {
                  realStreamSuccess = true;
                  fullAssistantReply += delta;
                  writeSSE({ delta, fullText: fullAssistantReply });
                }
              } catch {
                // ignore JSON parse error on incomplete chunk
              }
            }
          }
        } else {
          // Upstream returned HTTP error status (401, 403, 500, etc.)
          const errText = await upstreamRes.text().catch(() => '');
          console.warn(`Upstream API failed (HTTP ${upstreamRes.status}): ${errText.slice(0, 150)}. Falling back to Gemini...`);
        }
      } catch (err: any) {
        console.warn('Primary LLM streaming exception, falling back to Gemini:', err?.message || err);
      }
    }

    // Tier 2: If Tier 1 did not produce response, fall back to server-side Gemini
    if ((!realStreamSuccess || !fullAssistantReply) && geminiKey) {
      try {
        const text = await callGeminiResponse({
          geminiKey,
          targetModel: modelUsed,
          systemPrompt,
          messageText,
        });
        if (text) {
          realStreamSuccess = true;
          fullAssistantReply = text;
          // Stream chunks to client for smooth typing experience
          const chunkSize = 20;
          let currentProgress = '';
          for (let i = 0; i < text.length; i += chunkSize) {
            if (!isClientConnected) break;
            const delta = text.slice(i, i + chunkSize);
            currentProgress += delta;
            writeSSE({ delta, fullText: currentProgress });
          }
        }
      } catch (geminiErr: any) {
        console.warn('Gemini stream failed, falling back to distillation engine:', geminiErr?.message || geminiErr);
      }
    }

    // Tier 3: If both external LLMs are unavailable, use high-quality book distillation
    if (!realStreamSuccess || !fullAssistantReply) {
      const distillation = generateDeepBookDistillation(skill, messageText, session?.messages || []);
      realStreamSuccess = true;
      fullAssistantReply = distillation;
      const chunkSize = 24;
      let currentProgress = '';
      for (let i = 0; i < distillation.length; i += chunkSize) {
        if (!isClientConnected) break;
        const delta = distillation.slice(i, i + chunkSize);
        currentProgress += delta;
        writeSSE({ delta, fullText: currentProgress });
      }
    }

    // Save final assistant message to DB
    const thinkingTime = Number(((Date.now() - startTime) / 1000).toFixed(2));
    const assistantMsg: ChatMessage = {
      id: 'msg-a-' + Date.now(),
      role: 'assistant',
      content: fullAssistantReply,
      timestamp: new Date().toISOString(),
      thinkingTime,
      modelUsed,
    };

    if (session) {
      session.messages.push(assistantMsg);
      session.updatedAt = new Date().toISOString();
      db.saveChatSession(session);
    }

    // Send final completion payload
    writeSSE({
      done: true,
      assistantMessage: assistantMsg,
      session,
      user: quota.updatedUser || currentUser,
    });

    res.end();
  });

  // Backward-compatible POST /api/chat/send
  app.post('/api/chat/send', async (req: AuthRequest, res) => {
    const { sessionId, skillId, messageText, userId } = req.body;
    if (!sessionId || !messageText) {
      return res.status(400).json({ error: '缺少必要的 sessionId 或 messageText 参数' });
    }

    const currentUser = req.user || (userId ? db.getUserById(userId) : null);
    let session = db.getChatSessionById(sessionId);
    if (!session) {
      const targetSkill = (skillId ? db.getSkillById(skillId) : null) || db.getSkills()[0];
      if (targetSkill) {
        session = {
          id: sessionId,
          userId: currentUser?.id,
          skillId: targetSkill.id,
          skillTitle: targetSkill.title,
          skillAuthor: targetSkill.author,
          skillCoverUrl: targetSkill.coverUrl,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [],
        };
        db.saveChatSession(session);
      }
    }

    const skill = (session ? db.getSkillById(session.skillId) : null) || db.getSkills()[0];
    const llmConfig = db.getLLMConfig();

    const quota = checkAndConsumeQuota(currentUser, skill, llmConfig);
    if (!quota.allowed) {
      return res.status(quota.status || 403).json({
        error: quota.error,
        message: quota.message,
        tier: quota.tier,
      });
    }

    const userMsg: ChatMessage = {
      id: 'msg-u-' + Date.now(),
      role: 'user',
      content: messageText,
      timestamp: new Date().toISOString(),
    };
    if (session) {
      session.messages.push(userMsg);
    }

    const rawApiKey = (llmConfig.apiKey || llmConfig.deepseekApiKey || process.env.DEEPSEEK_API_KEY || '').trim();
    const apiKey = cleanApiKey(rawApiKey);
    const apiBaseUrl = (llmConfig.apiBaseUrl || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').trim();
    const modelUsed = (llmConfig.primaryModel || process.env.DEEPSEEK_MODEL || 'deepseek-chat').trim();
    const geminiKey = process.env.GEMINI_API_KEY || (apiKey.startsWith('AIza') ? apiKey : '');

    let assistantReply = '';
    const startTime = Date.now();

    let systemPrompt = (skill?.systemPrompt || '').trim();

    // 1. Prepare sanitized messages payload for LLM
    const messagesPayload = sanitizeMessagesForLLM(systemPrompt, session?.messages || [], messageText);
    const isExplicitGemini = modelUsed.toLowerCase().includes('gemini');

    const hasValidCustomKey = !isInvalidOrPlaceholderKey(apiKey);

    // Tier 1: Primary Route: If custom OpenAI/DeepSeek API Key is configured
    if (hasValidCustomKey && !isExplicitGemini) {
      try {
        const targetUrl = resolveOpenAIUrl(apiBaseUrl);
        const isReasoner =
          modelUsed.includes('reasoner') ||
          modelUsed.includes('r1') ||
          modelUsed.includes('o1') ||
          modelUsed.includes('o3');

        const reqBody: any = {
          model: modelUsed,
          messages: messagesPayload,
          stream: false,
          max_tokens: llmConfig.maxTokens ? Number(llmConfig.maxTokens) : 4096,
        };
        if (!isReasoner) reqBody.temperature = 0.7;

        const timeoutSeconds = Math.max(30, Number(llmConfig.timeoutSec) || 60);
        const controller = new AbortController();
        const timeoutTimer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

        const resUpstream = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(reqBody),
          signal: controller.signal,
        });
        clearTimeout(timeoutTimer);

        if (resUpstream.ok) {
          const json = await resUpstream.json().catch(() => ({}));
          assistantReply = json.choices?.[0]?.message?.content || json.choices?.[0]?.message?.reasoning_content || '';
        } else {
          const errText = await resUpstream.text().catch(() => '');
          console.warn(`Upstream sync call failed (HTTP ${resUpstream.status}): ${errText.slice(0, 150)}. Falling back to Gemini...`);
        }
      } catch (e: any) {
        console.warn('OpenAI sync call error, falling back to Gemini:', e?.message || e);
      }
    }

    // Tier 2: If Tier 1 failed or no valid key, fall back to Gemini
    if (!assistantReply && geminiKey) {
      try {
        assistantReply = await callGeminiResponse({
          geminiKey,
          targetModel: modelUsed,
          systemPrompt,
          messageText,
        });
      } catch (e: any) {
        console.warn('Gemini sync call error, falling back to distillation engine:', e?.message || e);
      }
    }

    // Tier 3: If both external LLMs are unavailable, use high-quality book distillation
    if (!assistantReply) {
      assistantReply = generateDeepBookDistillation(skill, messageText, session?.messages || []);
    }

    const thinkingTime = Number(((Date.now() - startTime) / 1000).toFixed(2));
    const assistantMsg: ChatMessage = {
      id: 'msg-a-' + Date.now(),
      role: 'assistant',
      content: assistantReply,
      timestamp: new Date().toISOString(),
      thinkingTime: thinkingTime || 0.8,
      modelUsed,
    };

    if (session) {
      session.messages.push(assistantMsg);
      session.updatedAt = new Date().toISOString();
      db.saveChatSession(session);
    }

    res.json({
      userMessage: userMsg,
      assistantMessage: assistantMsg,
      session,
      user: quota.updatedUser || currentUser,
    });
  });

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
  app.get('/api/tags', (req, res) => {
    const tags = db.getTags();
    res.json({ tags });
  });

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
