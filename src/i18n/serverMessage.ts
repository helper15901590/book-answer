import type { TFunction, TranslationKey } from './types';

// 服务端错误码 → 字典键。只登记「会直接展示给用户」的码，
// 其余未知码回退使用服务端返回的 message（后台类错误仍是中文，属预期）。
export const SERVER_ERROR_KEYS: Record<string, TranslationKey> = {
  UNAUTHENTICATED: 'server.UNAUTHENTICATED',
  ACCOUNT_DISABLED: 'server.ACCOUNT_DISABLED',
  ACCOUNT_RESTRICTED: 'server.ACCOUNT_RESTRICTED',
  INVALID_CREDENTIALS: 'server.INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'server.ACCOUNT_LOCKED',
  INVALID_PASSWORD: 'server.INVALID_PASSWORD',
  PASSWORD_REUSED: 'server.PASSWORD_REUSED',
  CHALLENGE_EXPIRED: 'server.CHALLENGE_EXPIRED',
  CSRF_REJECTED: 'server.CSRF_REJECTED',
  SESSION_CONFLICT: 'server.SESSION_CONFLICT',
  INVALID_REQUEST: 'server.INVALID_REQUEST',
  AI_NOT_CONFIGURED: 'server.AI_NOT_CONFIGURED',
  AI_UNAVAILABLE: 'server.AI_UNAVAILABLE',
  RATE_LIMITED: 'server.RATE_LIMITED',
  INTERNAL_ERROR: 'server.INTERNAL_ERROR',
};

// 把服务端响应转成当前语言的提示文案：
// 已知错误码走字典 → 未知码回退服务端 message → 最后回退到调用方给的兜底键。
export function serverMessage(
  data: { error?: string; message?: string } | null | undefined,
  t: TFunction,
  fallbackKey: TranslationKey
): string {
  const code = data?.error;
  const key = code ? SERVER_ERROR_KEYS[code] : undefined;
  if (key) return t(key);
  return data?.message || t(fallbackKey);
}
