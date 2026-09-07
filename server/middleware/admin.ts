import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';

// 管理端点强制鉴权：JWT 有效且为 admin 角色
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  const u = req.user;
  if (!u || (u.role !== 'admin' && !u.isAdmin)) {
    res.status(403).json({ error: 'FORBIDDEN', message: '需要管理员权限' });
    return;
  }
  next();
}
