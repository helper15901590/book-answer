import express from 'express';
import path from 'path';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import * as Sentry from '@sentry/node';
import { createServer as createViteServer } from 'vite';
import { IS_PROD, IS_TEST, DATA_DIR, TRUST_PROXY, ALLOW_INSECURE_HTTP } from './config.js';
import { db } from './db.js';
import { authMiddleware, csrfProtection } from './middleware/auth.js';
import { metrics } from './services/metrics.js';
import { logger } from './services/logger.js';
import { registerAuthRoutes } from './routes/auth.js';
import { ensureAdminSeed } from './services/adminSeed.js';
import { registerSkillsRoutes } from './routes/skills.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerConfigRoutes } from './routes/config.js';

export async function createApp() {
  const app = express();
  if (TRUST_PROXY) app.set('trust proxy', 1);

  // 开发模式下 Vite 会注入内联 preamble 脚本，并通过独立端口的 WebSocket 推送 HMR，
  // 严格 CSP 会同时拦掉这两者导致整页白屏；生产构建产物没有内联脚本，策略保持严格不变。
  const isViteDev = !IS_PROD && !IS_TEST;
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: isViteDev ? ["'self'", "'unsafe-inline'"] : ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https://images.unsplash.com'],
        connectSrc: isViteDev ? ["'self'", 'ws:', 'wss:'] : ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        // 无 HTTPS 部署必须移除：否则浏览器会把同源资源升级为 https，无 TLS 监听时整页白屏
        ...(ALLOW_INSECURE_HTTP ? { upgradeInsecureRequests: null } : {}),
      },
    },
    hsts: ALLOW_INSECURE_HTTP ? false : undefined,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));
  app.get('/api/health', (_req, res) => {
    if (!db.ping()) return res.status(503).json({ status: 'unhealthy', timestamp: new Date().toISOString() });
    return res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      activeSseConnections: metrics.activeSseConnections,
      peakConcurrentSse: metrics.peakConcurrentSse,
      uptimeSeconds: Math.floor((Date.now() - metrics.startTime) / 1000),
    });
  });
  // 只对 /api 计数：静态资源不消耗额度。此前挂在全局，一次页面加载的十几个 JS/CSS/图片请求
  // 都计入这 300 次/分钟，同一出口 IP 下的用户（公司、学校网络）会互相挤掉额度。
  // /api/health 注册在本行之前，仍不受限流影响，探针不会被误杀。
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));
  // /assets 是匿名可访问的用户上传素材（单文件上限 2MB，文件名随机但仍可被转发）。
  // 限流收窄到 /api 之后它失去了兜底，这里单独补一个同样宽松的桶，避免单个 IP 无上限拉取带宽。
  app.use('/assets', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));
  app.use('/assets', express.static(path.join(DATA_DIR, 'assets'), { fallthrough: true, index: false }));
  app.use((_req, _res, next) => {
    metrics.totalRequestsServed++;
    metrics.requestsLastMinute++;
    next();
  });
  app.use(authMiddleware);


  app.use('/api', csrfProtection);

  ensureAdminSeed();
  registerAuthRoutes(app);
  registerSkillsRoutes(app);
  registerChatRoutes(app);
  registerAdminRoutes(app);
  registerConfigRoutes(app);
  Sentry.setupExpressErrorHandler(app);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not Found' }));

  if (IS_TEST) {
    // 测试只验证 API，不挂载 Vite 前端中间件
  } else if (!IS_PROD) {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.get('/admin', (_req, res) => res.redirect('/admin.html'));
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('/admin', (_req, res) => res.sendFile(path.join(distPath, 'admin.html')));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  return app;
}