import crypto from 'crypto';
import { Express, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db } from '../db.js';
import { AuthRequest, requireUser, sanitizeUser } from '../middleware/auth.js';
import { metrics } from '../services/metrics.js';
import { reserveQuota, settleQuota } from '../services/quota.js';
import { cleanApiKey, isInvalidOrPlaceholderKey, resolveOpenAIUrl, sanitizeMessagesForLLM } from '../services/llm/sanitize.js';
import { ChatMessage, ChatSession, PublicChatSession, cleanBookTitle } from '../../src/types.js';

const chatLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' } });
const MAX_MESSAGE_LENGTH = 4000;
const chatSchema = z.object({
  sessionId: z.string().min(1).max(128),
  skillId: z.string().min(1).optional(),
  messageText: z.string().min(1).max(MAX_MESSAGE_LENGTH),
  requestId: z.string().min(8).max(128).optional(),
  userId: z.never().optional(),
});

function asyncHandler(fn: (req: AuthRequest, res: Response) => Promise<unknown>) {
  return (req: AuthRequest, res: Response) => {
    fn(req, res).catch((err: any) => {
      console.error('聊天端点未捕获异常:', err?.message || err);
      if (!res.headersSent) res.status(500).json({ error: 'INTERNAL_ERROR', message: '服务器内部错误，请稍后重试' });
      else if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: 'INTERNAL_ERROR' })}\n\n`);
        res.end();
      }
    });
  };
}

function sessionView(session: any): PublicChatSession | undefined {
  if (!session) return undefined;
  const { userId: _userId, ...view } = session;
  return view;
}

// 按客户端传入的 sessionId 取会话。若该 id 已存在但不属于当前用户，必须判为冲突——
// 否则后面的 saveChatSession 会按主键 upsert，直接覆盖掉他人的会话内容。
// 会话 id 由前端按「技能 + 时间戳」生成，可被猜中或撞号，因此这里不能省略归属检查。
function resolveSession(sessionId: string, userId: string, skillId?: string): { session?: ChatSession; error?: 'SESSION_CONFLICT' | 'SKILL_NOT_FOUND' } {
  const own = db.getChatSessionById(sessionId, userId);
  if (own) return { session: own };
  if (db.getChatSessionById(sessionId)) return { error: 'SESSION_CONFLICT' };
  const targetSkill = (skillId ? db.getSkillById(skillId) : null) || db.getSkills()[0];
  if (!targetSkill) return { error: 'SKILL_NOT_FOUND' };
  const created: ChatSession = {
    id: sessionId,
    userId,
    skillId: targetSkill.id,
    skillTitle: targetSkill.title,
    skillAuthor: targetSkill.author,
    skillCoverUrl: targetSkill.coverUrl,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
  };
  db.saveChatSession(created);
  return { session: created };
}

function sessionErrorResponse(res: Response, error: 'SESSION_CONFLICT' | 'SKILL_NOT_FOUND') {
  return error === 'SESSION_CONFLICT'
    ? res.status(409).json({ error: 'SESSION_CONFLICT', message: '会话标识冲突，请重新开始对话' })
    : res.status(404).json({ error: 'Skill not found' });
}

export function registerChatRoutes(app: Express): void {
  app.get('/api/chat/sessions', requireUser, (req: AuthRequest, res) => {
    const sessions = db.getChatSessions(req.user!.id).map((session) => sessionView(session)!);
    res.json({ sessions });
  });

  app.post('/api/chat/sessions', requireUser, (req: AuthRequest, res) => {
    const skillId = typeof req.body?.skillId === 'string' ? req.body.skillId : '';
    const skill = db.getSkillById(skillId);
    if (!skill) return res.status(404).json({ error: 'Skill not found' });
    const newSession = {
      id: `session-${crypto.randomUUID()}`,
      userId: req.user!.id,
      skillId: skill.id,
      skillTitle: skill.title,
      skillAuthor: skill.author,
      skillCoverUrl: skill.coverUrl,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [{
        id: `msg-${crypto.randomUUID()}`,
        role: 'assistant' as const,
        content: (skill.skillType === 'mentor')
          ? `你好！我是【${skill.author}】AI思想导师。\n我已将其核心思想、决策智慧（${(skill.tags || []).join('、')}）融会贯通。\n你可以提出你当前在商业、投资、工作或生活中的具体困惑，我将以导师思维为你提供深度答疑与决策剖析。`
          : `你好！我是《${cleanBookTitle(skill.title)}》作者【${skill.author}】的AI思想蒸馏体。\n我已将本书的核心理论、决策模型（${(skill.tags || []).join('、')}）融会贯通。\n你可以提出你当前在商业、投资、工作或生活中的具体困惑，我将以原著思维模型为你提供深度答疑与决策剖析。`,
        timestamp: new Date().toISOString(),
        recommendedQuestions: skill.sampleQuestions?.length ? skill.sampleQuestions : undefined,
      }],
    };
    db.saveChatSession(newSession);
    return res.json({ session: sessionView(newSession) });
  });

  app.delete('/api/chat/sessions/:id', requireUser, (req: AuthRequest, res) => {
    const deleted = db.deleteChatSession(req.params.id, req.user!.id);
    return res.json({ success: deleted });
  });

  app.post('/api/chat/stream', requireUser, chatLimiter, asyncHandler(async (req: AuthRequest, res) => {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_REQUEST', message: '请检查会话、技能和消息内容' });
    const { sessionId, skillId, messageText } = parsed.data;
    const requestId = parsed.data.requestId || crypto.randomUUID();
    const resolved = resolveSession(sessionId, req.user!.id, skillId);
    if (!resolved.session) return sessionErrorResponse(res, resolved.error!);
    const session = resolved.session;
    const skill = db.getSkillById(session.skillId) || db.getSkills()[0];
    const llmConfig = db.getLLMConfig();
    const apiKey = cleanApiKey((llmConfig.apiKey || process.env.DEEPSEEK_API_KEY || '').trim());
    const apiBaseUrl = (llmConfig.apiBaseUrl || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').trim();
    const modelUsed = (llmConfig.primaryModel || process.env.DEEPSEEK_MODEL || 'deepseek-chat').trim();
    if (isInvalidOrPlaceholderKey(apiKey)) return res.status(503).json({ error: 'AI_NOT_CONFIGURED', message: 'AI 服务尚未配置，请联系管理员在后台设置大模型 API' });

    const quota = reserveQuota(req.user!, llmConfig, requestId);
    if (!quota.allowed) return res.status(quota.status || 403).json({ error: quota.error, message: quota.message, tier: quota.tier });

    const userMsg: ChatMessage = { id: `msg-u-${crypto.randomUUID()}`, role: 'user', content: messageText, timestamp: new Date().toISOString() };
    session.messages.push(userMsg);
    db.saveChatSession(session);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    metrics.activeSseConnections++;
    metrics.peakConcurrentSse = Math.max(metrics.peakConcurrentSse, metrics.activeSseConnections);
    let isClientConnected = true;
    let connectionReleased = false;
    const controller = new AbortController();
    const releaseConnection = () => {
      if (connectionReleased) return;
      connectionReleased = true;
      metrics.activeSseConnections = Math.max(0, metrics.activeSseConnections - 1);
    };
    const cleanupConnection = () => {
      isClientConnected = false;
      controller.abort();
      releaseConnection();
    };
    res.on('close', cleanupConnection);

    let fullAssistantReply = '';
    const startTime = Date.now();
    const writeSSE = (data: any) => {
      if (!isClientConnected || res.writableEnded) return;
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      if (typeof (res as any).flush === 'function') (res as any).flush();
    };
    const messagesPayload = sanitizeMessagesForLLM((skill?.systemPrompt || '').trim(), session.messages, messageText);
    const isReasoner = modelUsed.includes('reasoner') || modelUsed.includes('r1') || modelUsed.includes('o1') || modelUsed.includes('o3');
    const timeoutSeconds = Math.max(30, Number(llmConfig.timeoutSec) || 60);
    const timeoutTimer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

    try {
      const upstreamRes = await fetch(resolveOpenAIUrl(apiBaseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: modelUsed, messages: messagesPayload, stream: true, max_tokens: llmConfig.maxTokens ? Number(llmConfig.maxTokens) : 4096, ...(isReasoner ? {} : { temperature: 0.7 }) }),
        signal: controller.signal,
      });
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
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.replace(/^data:\s*/, '').trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const choice = JSON.parse(payload).choices?.[0];
              const delta = choice?.delta?.content ?? choice?.delta?.reasoning_content ?? '';
              if (delta) {
                fullAssistantReply += delta;
                writeSSE({ delta, fullText: fullAssistantReply });
              }
            } catch {}
          }
        }
      } else {
        const errText = await upstreamRes.text().catch(() => '');
        console.warn(`上游 LLM 调用失败 (HTTP ${upstreamRes.status}): ${errText.slice(0, 150)}`);
      }
    } catch (err: any) {
      console.warn('主路 LLM 流式调用异常:', err?.message || err);
    } finally {
      clearTimeout(timeoutTimer);
      res.off('close', cleanupConnection);
    }

    try {
      if (!fullAssistantReply) {
        settleQuota(quota.ledgerId, 'refunded');
        writeSSE({ error: 'AI_UNAVAILABLE' });
        if (!res.writableEnded) res.end();
        return;
      }

      settleQuota(quota.ledgerId, 'consumed');
      const assistantMsg: ChatMessage = { id: `msg-a-${crypto.randomUUID()}`, role: 'assistant', content: fullAssistantReply, timestamp: new Date().toISOString(), thinkingTime: Number(((Date.now() - startTime) / 1000).toFixed(2)), modelUsed };
      session.messages.push(assistantMsg);
      session.updatedAt = new Date().toISOString();
      db.saveChatSession(session);
      writeSSE({ done: true, assistantMessage: assistantMsg, session: sessionView(session), user: sanitizeUser(db.getUserById(req.user!.id) || req.user!) });
      if (!res.writableEnded) res.end();
    } finally {
      // 必须放在 finally：releaseConnection 幂等（客户端中途断开时 close 回调已释放过），
      // 但若中途抛异常又不在 finally 里释放，连接计数会只增不减
      releaseConnection();
    }
  }));

  app.post('/api/chat/send', requireUser, chatLimiter, asyncHandler(async (req: AuthRequest, res) => {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_REQUEST', message: '请检查会话、技能和消息内容' });
    const { sessionId, skillId, messageText } = parsed.data;
    const requestId = parsed.data.requestId || crypto.randomUUID();
    const resolved = resolveSession(sessionId, req.user!.id, skillId);
    if (!resolved.session) return sessionErrorResponse(res, resolved.error!);
    const session = resolved.session;
    const skill = db.getSkillById(session.skillId) || db.getSkills()[0];
    const llmConfig = db.getLLMConfig();
    const apiKey = cleanApiKey((llmConfig.apiKey || process.env.DEEPSEEK_API_KEY || '').trim());
    const apiBaseUrl = (llmConfig.apiBaseUrl || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').trim();
    const modelUsed = (llmConfig.primaryModel || process.env.DEEPSEEK_MODEL || 'deepseek-chat').trim();
    if (isInvalidOrPlaceholderKey(apiKey)) return res.status(503).json({ error: 'AI_NOT_CONFIGURED', message: 'AI 服务尚未配置，请联系管理员在后台设置大模型 API' });
    const quota = reserveQuota(req.user!, llmConfig, requestId);
    if (!quota.allowed) return res.status(quota.status || 403).json({ error: quota.error, message: quota.message, tier: quota.tier });

    const userMsg: ChatMessage = { id: `msg-u-${crypto.randomUUID()}`, role: 'user', content: messageText, timestamp: new Date().toISOString() };
    session.messages.push(userMsg);
    let assistantReply = '';
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), Math.max(30, Number(llmConfig.timeoutSec) || 60) * 1000);
    try {
      const isReasoner = modelUsed.includes('reasoner') || modelUsed.includes('r1') || modelUsed.includes('o1') || modelUsed.includes('o3');
      const upstream = await fetch(resolveOpenAIUrl(apiBaseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: modelUsed, messages: sanitizeMessagesForLLM((skill?.systemPrompt || '').trim(), session.messages, messageText), stream: false, max_tokens: llmConfig.maxTokens ? Number(llmConfig.maxTokens) : 4096, ...(isReasoner ? {} : { temperature: 0.7 }) }),
        signal: controller.signal,
      });
      if (upstream.ok) {
        const json: any = await upstream.json().catch(() => ({}));
        assistantReply = json.choices?.[0]?.message?.content || json.choices?.[0]?.message?.reasoning_content || '';
      }
    } catch (err: any) {
      console.warn('主路 LLM 同步调用异常:', err?.message || err);
    } finally {
      clearTimeout(timeoutTimer);
    }
    if (!assistantReply) {
      settleQuota(quota.ledgerId, 'refunded');
      session.updatedAt = new Date().toISOString();
      db.saveChatSession(session);
      return res.status(502).json({ error: 'AI_UNAVAILABLE', message: 'AI 服务暂时不可用，请稍后重试' });
    }
    settleQuota(quota.ledgerId, 'consumed');
    const assistantMsg: ChatMessage = { id: `msg-a-${crypto.randomUUID()}`, role: 'assistant', content: assistantReply, timestamp: new Date().toISOString(), thinkingTime: Number(((Date.now() - startTime) / 1000).toFixed(2)), modelUsed };
    session.messages.push(assistantMsg);
    session.updatedAt = new Date().toISOString();
    db.saveChatSession(session);
    return res.json({ userMessage: userMsg, assistantMessage: assistantMsg, session: sessionView(session), user: sanitizeUser(db.getUserById(req.user!.id) || req.user!) });
  }));
}