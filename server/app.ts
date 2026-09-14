import express from 'express';
import path from 'path';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import * as Sentry from '@sentry/node';
import { createServer as createViteServer } from 'vite';
import { IS_PROD, IS_TEST, DATA_DIR, TRUST_PROXY } from './config.js';
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

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https://images.unsplash.com'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
    },
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
  app.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));
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
    app.get('/leonchan1590', (_req, res) => res.redirect('/leonchan1590.html'));
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('/leonchan1590', (_req, res) => res.sendFile(path.join(distPath, 'leonchan1590.html')));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  return app;
}