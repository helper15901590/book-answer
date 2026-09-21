// 统一 fetch 包装器：浏览器只持有 HttpOnly 会话 Cookie，写请求自动携带 CSRF Token。
// 判定是否在后台页面：前后台共用这个包装器，但两者读的 CSRF Cookie 名不同。
// 这里不能写成 startsWith('/admin')——那会把任何以 /admin 开头的路径都误判为后台。
function isAdminPage(): boolean {
  const pathname = window.location.pathname;
  return pathname === '/admin' || pathname.startsWith('/admin.html');
}

function readCookie(name: string): string {
  const prefix = `${name}=`;
  const item = document.cookie.split('; ').find((part) => part.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : '';
}

export function csrfCookieName(): string {
  return isAdminPage() ? 'book_answer_admin_csrf' : 'book_answer_user_csrf';
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