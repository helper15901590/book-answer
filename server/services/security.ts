import crypto from 'crypto';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { APP_ENCRYPTION_KEY } from '../config.js';

const ENC_PREFIX = 'enc:v1';

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function hmac(value: string): string {
  return crypto.createHmac('sha256', APP_ENCRYPTION_KEY).update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', APP_ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENC_PREFIX, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':');
}

export function decryptSecret(value: string): string {
  if (!value.startsWith(`${ENC_PREFIX}:`)) return value;
  const [, , ivRaw, tagRaw, encryptedRaw] = value.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', APP_ENCRYPTION_KEY, Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, 'base64url')), decipher.final()]).toString('utf8');
}

export function isEncryptedSecret(value?: string): boolean {
  return !!value && value.startsWith(`${ENC_PREFIX}:`);
}

export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => `${randomToken(9)}-${randomToken(9)}`.toUpperCase());
}

export function generateTotpSetup(label: string): { secret: string; otpauthUri: string } {
  const secret = generateSecret();
  return {
    secret,
    otpauthUri: generateURI({ issuer: 'Remix AI', label, secret }),
  };
}

export function verifyTotp(secret: string, token: string): boolean {
  const normalized = (token || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  try {
    return verifySync({ secret, token: normalized, epochTolerance: 30 }).valid;
  } catch {
    return false;
  }
}