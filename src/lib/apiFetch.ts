// 统一 fetch 包装器：浏览器只持有 HttpOnly 会话 Cookie，写请求自动携带 CSRF Token。
function isAdminPage(): boolean {
  return window.location.pathname.startsWith('/leonchan1590');
}

function readCookie(name: string): string {
  const prefix = `${name}=`;
  const item = document.cookie.split('; ').find((part) => part.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : '';
}

export function csrfCookieName(): string {
  return isAdminPage() ? 'remix_admin_csrf' : 'remix_user_csrf';
}

export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra || {}) };
  const csrf = readCookie(csrfCookieName());
  if (csrf) headers['X-CSRF-Token'] = csrf;
  return headers;
}

export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  return fetch(input, {
    ...init,
    credentials: 'include',
    headers: authHeaders(init.headers as Record<string, string> | undefined),
  });
}