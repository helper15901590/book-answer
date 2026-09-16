import { NextFunction, Request, Response } from 'express';

// Express 4 不会捕获 async 处理器抛出的异常：未包裹时 Promise 被 reject，请求会一直挂起直到客户端超时，
// 前端只看到「没反应」。统一包裹后转为 JSON 错误响应。
export function asyncJsonHandler<T extends Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: T, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch((err: any) => {
      console.error('异步路由未捕获异常:', err?.message || err);
      if (res.headersSent) return next(err);
      res.status(500).json({ error: 'INTERNAL_ERROR', message: '服务器内部错误，请稍后重试' });
    });
  };
}
