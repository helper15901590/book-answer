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
    logger.info({ port: PORT }, 'book_answer production server started');
  });
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      logger.info({ signal: sig }, '开始优雅关闭');
      // 先断开空闲的 keep-alive 连接，否则 server.close 的回调可能一直不触发
      server.closeIdleConnections();
      server.close(() => {
        db.close();
        process.exit(0);
      });
      // 仍有活跃连接（如进行中的 SSE 流式对话）时，宽限 8 秒后强制收尾；
      // 主动停止服务属正常退出，不用非零退出码，免得 docker 把它记成故障
      setTimeout(() => {
        db.close();
        process.exit(0);
      }, 8_000).unref();
    });
  }
}

startServer().catch((error) => {
  logger.fatal({ err: error }, '服务启动失败');
  Sentry.captureException(error);
  process.exit(1);
});
