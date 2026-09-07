import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../../src/db.js';
import { UserProfile } from '../../src/types.js';
import { JWT_SECRET } from '../config.js';

export const JWT_EXPIRES_IN = '7d';

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
    const payload = jwt.verify(token, JWT_SECRET) as { id: string; unionId?: string };
    if (payload && payload.id) {
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
  }
  next();
}
