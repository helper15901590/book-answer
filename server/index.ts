import express from 'express';
import path from 'path';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer as createViteServer } from 'vite';
import { PORT, IS_PROD } from './config.js';
import { db } from '../src/db.js';
import { authMiddleware } from './middleware/auth.js';
import { metrics } from './services/metrics.js';
import { registerAuthRoutes } from './routes/auth.js';
import { ensureAdminSeed } from './services/adminSeed.js';
import { registerSkillsRoutes } from './routes/skills.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerConfigRoutes } from './routes/config.js';

async function startServer() {
  const app = express();

  // 安全头（CSP 关闭：避免破坏现有内联样式与 unsplash 外链封面，UI 硬约束）
  app.use(helmet({ contentSecurityPolicy: false }));
  // 全局限流：300 次/分/IP
  app.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));

  app.use(express.json({ limit: '10mb' }));
  app.use('/assets', express.static(path.join(process.cwd(), 'assets')));

  // 请求计数
  app.use((req, res, next) => {
    metrics.totalRequestsServed++;
    metrics.requestsLastMinute++;
    next();
  });

  app.use(authMiddleware);

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      activeSseConnections: metrics.activeSseConnections,
      peakConcurrentSse: metrics.peakConcurrentSse,
      uptimeSeconds: Math.floor((Date.now() - metrics.startTime) / 1000),
    });
  });

  // 等待 SQLite（WASM）初始化完成后再执行管理员种子，避免 this.db 未就绪导致 saveUser 空操作
  await db.whenReady();
  ensureAdminSeed();
  registerAuthRoutes(app);
  registerSkillsRoutes(app);
  registerChatRoutes(app);
  registerAdminRoutes(app);
  registerConfigRoutes(app);

  // 未匹配的 /api/* 请求返回 JSON 404（防止落入 SPA catch-all 返回 index.html 200）
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  if (!IS_PROD) {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    // 管理后台独立入口：dev 下重定向至多页构建的 admin.html
    app.get('/admin', (_req, res) => res.redirect('/admin.html'));
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // 管理后台独立入口：prod 下直出 dist/admin.html
    app.get('/admin', (_req, res) => res.sendFile(path.join(distPath, 'admin.html')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Enterprise Commercial Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
