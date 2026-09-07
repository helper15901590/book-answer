import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { PORT, IS_PROD } from './config.js';
import { authMiddleware } from './middleware/auth.js';
import { metrics } from './services/metrics.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerSkillsRoutes } from './routes/skills.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerPaymentRoutes } from './routes/payment.js';
import { registerAdminRoutes } from './routes/admin.js';

async function startServer() {
  const app = express();

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

  registerAuthRoutes(app);
  registerSkillsRoutes(app);
  registerChatRoutes(app);
  registerPaymentRoutes(app);
  registerAdminRoutes(app);

  if (!IS_PROD) {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
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
