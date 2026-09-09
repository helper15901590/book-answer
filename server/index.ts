import express from 'express';
import path from 'path';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer as createViteServer } from 'vite';
import { PORT, IS_PROD, DATA_DIR, TRUST_PROXY } from './config.js';
import { db } from './db.js';
import { authMiddleware } from './middleware/auth.js';
import { metrics } from './services/metrics.js';
import { registerAuthRoutes } from './routes/auth.js';
import { ensureAdminSeed } from './services/adminSeed.js';
import { registerSkillsRoutes } from './routes/skills.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerConfigRoutes } from './routes/config.js';

// 最后防线：Express 4 不捕获 async handler 异常，Node 22 默认策略下未处理
// rejection 会直接崩掉进程；此处仅记日志保活（具体端点的错误收尾在 asyncHandler 中）
process.on('unhandledRejection', (reason: any) => {
  console.error('未处理的 Promise rejection（进程保持存活）:', reason?.message || reason);
});

async function startServer() {
  const app = express();

  // 反向代理部署时信任第一跳，使限流按 X-Forwarded-For 计 IP（须在挂载限流器前设置）
  if (TRUST_PROXY) app.set('trust proxy', 1);

  // 安全头（CSP 关闭：避免破坏现有内联样式与 unsplash 外链封面，UI 硬约束）
  app.use(helmet({ contentSecurityPolicy: false }));
  // 全局限流：300 次/分/IP
  app.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));

  app.use(express.json({ limit: '10mb' }));
  app.use('/assets', express.static(path.join(DATA_DIR, 'assets')));

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

  // better-sqlite3 同步初始化，db 导入即就绪，直接执行管理员种子（须在注册路由前）
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
    // 管理后台独立入口：dev 下重定向至多页构建的 leonchan1590.html
    app.get('/leonchan1590', (_req, res) => res.redirect('/leonchan1590.html'));
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // 管理后台独立入口：prod 下直出 dist/leonchan1590.html
    app.get('/leonchan1590', (_req, res) => res.sendFile(path.join(distPath, 'leonchan1590.html')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Enterprise Commercial Server running on http://0.0.0.0:${PORT}`);
  });

  // 容器停止/重启时优雅退出：停止接流 → 关闭数据库
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      console.log(`收到 ${sig}，开始优雅关闭…`);
      server.close(() => {
        db.close();
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10_000).unref();
    });
  }
}

startServer();
