import * as Sentry from '@sentry/node';
import { createApp } from './app.js';
import { APP_VERSION, PORT, SENTRY_DSN } from './config.js';
import { db } from './db.js';
import { logger } from './services/logger.js';

if (SENTRY_DSN) {
  Sentry.init({ dsn: SENTRY_DSN, environment: process.env.NODE_ENV || 'development', release: APP_VERSION });
}

process.on('unhandledRejection', (reason: any) => {
  logger.error({ err: reason }, '未处理的 Promise rejection');
  Sentry.captureException(reason);
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, '未捕获异常，进程即将退出');
  Sentry.captureException(error);
  setTimeout(() => process.exit(1), 100).unref();
});

async function startServer() {
  const app = await createApp();
  db.deleteExpiredAuthSessions();
  setInterval(() => db.deleteExpiredAuthSessions(), 60 * 60 * 1000).unref();
  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info({ port: PORT }, 'Remix production server started');
  });
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      logger.info({ signal: sig }, '开始优雅关闭');
      server.close(() => {
        db.close();
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10_000).unref();
    });
  }
}

startServer().catch((error) => {
  logger.fatal({ err: error }, '服务启动失败');
  Sentry.captureException(error);
  process.exit(1);
});
