import { Express } from 'express';
import { db } from '../../src/db.js';
import { AuthRequest } from '../middleware/auth.js';
import { metrics } from '../services/metrics.js';
import { checkAndConsumeQuota } from '../services/quota.js';
import { cleanApiKey, isInvalidOrPlaceholderKey, resolveOpenAIUrl, sanitizeMessagesForLLM } from '../services/llm/sanitize.js';
import { callGeminiResponse } from '../services/llm/gemini.js';
import { generateDeepBookDistillation } from '../services/llm/offline.js';
import { ChatMessage, cleanBookTitle } from '../../src/types.js';

export function registerChatRoutes(app: Express): void {
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
}
