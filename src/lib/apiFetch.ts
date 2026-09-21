// 统一 fetch 包装器：浏览器只持有 HttpOnly 会话 Cookie，写请求自动携带 CSRF Token。
// 判定是否在后台页面：前后台共用这个包装器，但两者读的 CSRF Cookie 名不同。
// 必须先归一化尾斜杠与大小写——Express 默认非严格路由，生产环境的 /admin 是 sendFile
// 而不是 redirect，所以地址栏可能停在 /admin/ 或 /Admin，它们返回的同样是后台页面；
// 只精确匹配 '/admin' 会让这些情况读错 Cookie，导致后台所有写请求 403。
// 归一化时只去掉「一个」尾斜杠：Express 的非严格路由也只忽略一个，
// /admin// 会被路由到通配兜底、返回**用户端**页面，不能算后台。
function isAdminPage(): boolean {
  const pathname = window.location.pathname.replace(/\/$/, '').toLowerCase();
  return pathname === '/admin' || pathname === '/admin.html';
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