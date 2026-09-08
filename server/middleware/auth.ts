import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db.js';
import { UserProfile } from '../../src/types.js';
import { JWT_SECRET, ADMIN_PHONE } from '../config.js';
import { touchUser } from '../services/metrics.js';

export const JWT_EXPIRES_IN = '7d';

// 管理员账号不入库：JWT 中携带的固定虚拟 ID 与合成身份（后台登录直接校验 .env 凭证）
export const ADMIN_ACCOUNT_ID = 'admin';

export function buildAdminProfile(token?: string): UserProfile {
  return {
    id: ADMIN_ACCOUNT_ID,
    unionId: 'union_admin_backend',
    nickname: '管理员',
    avatar: '',
    phone: ADMIN_PHONE || undefined,
    role: 'admin',
    membershipTier: 'yearly_member',
    isAdmin: true,
    dailyMaxChats: 9999,
    token,
  };
}

// Extend Express Request to include authenticated user
export interface AuthRequest extends Request {
  user?: UserProfile;
}

// Generate JWT token for user
export function signToken(user: UserProfile): string {
  return jwt.sign(
    {
      id: user.id,
      unionId: user.unionId,
      role: user.role,
      membershipTier: user.membershipTier,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// 对外返回的用户对象一律剥离密码字段（哈希也不可出网）
export function sanitizeUser(user: UserProfile): UserProfile {
  const { password: _password, ...rest } = user;
  return rest;
}

// Extract and verify user from Request
export function extractUserFromRequest(req: Request): UserProfile | null {
  const authHeader = req.headers.authorization;
  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.headers['x-auth-token'] && typeof req.headers['x-auth-token'] === 'string') {
    token = req.headers['x-auth-token'].trim();
  }

  if (!token) return null;

  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as { id: string; unionId?: string };
    if (payload && payload.id) {
      // 管理员身份为合成对象（不入库），命中虚拟 ID 直接返回
      if (payload.id === ADMIN_ACCOUNT_ID) {
        return buildAdminProfile(token);
      }
      const user = db.getUserById(payload.id);
      if (user) {
        return { ...user, token };
      }
    }
  } catch {
    // invalid or expired token
  }
  return null;
}

// Authentication middleware
export function authMiddleware(req: AuthRequest, res: Response, next: () => void) {
  const user = extractUserFromRequest(req);
  if (user) {
    req.user = user;
    // 在线用户打点：仅统计真实登录用户（管理员合成账号与游客不计）
    if (user.id !== ADMIN_ACCOUNT_ID) {
      touchUser(user.id);
    }
  }
  next();
}
