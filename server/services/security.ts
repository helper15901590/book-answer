import crypto from 'crypto';
import { APP_ENCRYPTION_KEY } from '../config.js';

const ENC_PREFIX = 'enc:v1';

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
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

// 用户对外 ID：usr_ 前缀 + 8 位随机字符，共 12 位。
// 字符集剔除 0/O/1/I/l 等易混字符，便于人工核对与口头传达。
const USER_ID_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function generateUserId(): string {
  let suffix = '';
  for (let i = 0; i < 8; i++) suffix += USER_ID_ALPHABET[crypto.randomInt(USER_ID_ALPHABET.length)];
  return `usr_${suffix}`;
}