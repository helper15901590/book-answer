import { Express } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { AuthRequest, requireUser } from '../middleware/auth.js';
import {
  TTSInvalidTextError,
  TTSNotConfiguredError,
  TTSUpstreamError,
  synthesizeSpeech,
} from '../services/tts.js';

// 语音按句合成，一条长回复可能触发十几次请求。按「登录用户」而非 IP 限流：
// 同一出口 IP 下的多个用户不会互相挤占，也不会因为一句一句调用很快耗尽额度。
// requireUser 先于本中间件执行，因此这里能拿到用户身份。
const ttsLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as AuthRequest).user?.id || req.ip,
  handler: (req, res) => {
    console.warn('TTS 限流触发:', (req as AuthRequest).user?.id || req.ip);
    res.status(429).json({ error: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' });
  },
});

const ttsSchema = z.object({
  text: z.string().min(1).max(500),
});

export function registerTTSRoutes(app: Express): void {
  app.post('/api/tts/synthesize', requireUser, ttsLimiter, async (req: AuthRequest, res) => {
    const parsed = ttsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'INVALID_REQUEST', message: '请提供有效的朗读文本' });
    }
    try {
      const startedAt = Date.now();
      const { buffer, mime } = await synthesizeSpeech(parsed.data.text);
      const elapsed = Date.now() - startedAt;
      // 单句超过 15 秒通常意味着上游拥塞/网络抖动，留日志便于排查断续
      if (elapsed > 15_000) {
        console.warn(`TTS 合成耗时 ${elapsed}ms（${parsed.data.text.length} 字）`);
      }
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'no-store');
      return res.send(buffer);
    } catch (err) {
      if (err instanceof TTSNotConfiguredError) {
        return res.status(503).json({ error: 'TTS_NOT_CONFIGURED', message: '语音服务尚未配置，请联系管理员' });
      }
      if (err instanceof TTSInvalidTextError) {
        return res.status(400).json({ error: 'INVALID_REQUEST', message: '请提供有效的朗读文本' });
      }
      if (!(err instanceof TTSUpstreamError)) {
        console.warn('语音合成未捕获异常:', (err as Error)?.message || err);
      } else {
        // 用户端不暴露上游细节，但日志保留诊断信息
        console.warn('语音合成上游失败:', (err as any)?.detail || (err as Error)?.message || err);
      }
      return res.status(502).json({ error: 'TTS_UNAVAILABLE', message: '语音服务暂时不可用，请稍后重试' });
    }
  });
}
