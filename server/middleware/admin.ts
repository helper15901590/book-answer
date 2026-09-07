import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { UserProfile } from '../../src/types.js';

// 统一管理员判定：role 为 admin 或 isAdmin 标记为真；空用户一律视为非管理员
export function isAdminUser(user?: UserProfile | null): boolean {
  return !!user && (user.role === 'admin' || !!user.isAdmin);
}

// 管理端点强制鉴权：JWT 有效且为 admin 角色
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!isAdminUser(req.user)) {
    res.status(403).json({ error: 'FORBIDDEN', message: '需要管理员权限' });
    return;
  }
  next();
}
