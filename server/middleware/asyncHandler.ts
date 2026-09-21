import { NextFunction, Request, Response } from 'express';
import * as Sentry from '@sentry/node';

// Express 4 不会捕获 async 处理器抛出的异常：未包裹时 Promise 被 reject，请求会一直挂起直到客户端超时，
// 前端只看到「没反应」。统一包裹后转为 JSON 错误响应。
export function asyncJsonHandler<T extends Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: T, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch((err: any) => {
      // 响应已发出时交给 Express 错误链，Sentry 的 4 参数错误中间件会接手上报。
      // 下面的分支要自行发响应，此时必须显式 captureException：Sentry 只挂在 next(err) 这条路径上，
      // 少了这一步，这类错误永远不会被上报，只剩一条没有堆栈的日志。
      if (res.headersSent) return next(err);
      Sentry.captureException(err);
      console.error('异步路由未捕获异常:', err);
      res.status(500).json({ error: 'INTERNAL_ERROR', message: '服务器内部错误，请稍后重试' });
    });
  };
}
