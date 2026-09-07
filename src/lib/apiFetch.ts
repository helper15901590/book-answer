// 统一注入 JWT 的 fetch 包装器（token 约定存于 localStorage.auth_token）
export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = { ...(extra || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const merged = authHeaders(init.headers as Record<string, string> | undefined);
  return fetch(input, { ...init, headers: merged });
}
