// 统一注入 JWT 的 fetch 包装器。
// 会话隔离：主前端 token 存于 localStorage.auth_token；
// /leonchan1590 后台入口使用独立的 admin_auth_token，
// 后台登录不再泄漏到主前端（主前端登出也不会踢掉后台会话）。
const MAIN_TOKEN_KEY = 'auth_token';
const ADMIN_TOKEN_KEY = 'admin_auth_token';

// 当前页是否为管理后台入口页
function isAdminPage(): boolean {
  return window.location.pathname.startsWith('/leonchan1590');
}

// 当前页面应使用的 token 存储键
export function authTokenKey(): string {
  return isAdminPage() ? ADMIN_TOKEN_KEY : MAIN_TOKEN_KEY;
}

export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = localStorage.getItem(authTokenKey());
  const headers: Record<string, string> = { ...(extra || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const merged = authHeaders(init.headers as Record<string, string> | undefined);
  return fetch(input, { ...init, headers: merged });
}
