// 统一 fetch 包装器：浏览器只持有 HttpOnly 会话 Cookie，写请求自动携带 CSRF Token。
// 判定是否在后台页面：前后台共用这个包装器，但两者读的 CSRF Cookie 名不同。
//
// 这里的规则必须与服务端**实际返回哪个页面**一一对应，而路由层与静态文件层的规则并不相同：
//   - Express 路由默认非严格且不区分大小写：/admin、/admin/、/Admin 都命中 app.get('/admin')，
//     生产上是 sendFile（不重定向，地址栏原样保留），返回的就是后台页面；
//   - 静态文件在 Linux 上区分大小写、也不容忍尾斜杠：只有精确的 /admin.html 才是后台页面，
//     /Admin.html、/ADMIN.HTML、/admin.html/ 都会落到 app.get('*') 返回**用户端**页面。
// 把后一组误判为后台，会让用户端页面去读管理员 CSRF Cookie（普通用户没有），
// 于是该页所有写请求 403——包括登出。

// 子路径部署前缀：构建期由 vite.config.ts 的 base（源头是仓库根 basePath.ts）注入。
// 根路径部署时为 '/'，剥掉尾斜杠后是空串，下面的拼接全部退化为原样路径。
const BASE = import.meta.env.BASE_URL.replace(/\/+$/, '');

function isAdminPage(): boolean {
  const pathname = window.location.pathname;
  if (BASE && !pathname.startsWith(BASE)) return false;
  const rest = pathname.slice(BASE.length);
  return /^\/admin\/?$/i.test(rest) || rest === '/admin.html';
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

// 子路径部署下接口不在站点根：调用方一律传 '/api/...' 根相对路径，前缀在这里统一补。
export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${input}`, {
    ...init,
    credentials: 'include',
    headers: authHeaders(init.headers as Record<string, string> | undefined),
  });
}

// 数据库存的图片路径是根相对形式（上传接口返回 /assets/xxx 并原样持久化），渲染时补子路径前缀；
// 外链（https://...）与 data: 内联图不经过 BASE，原样透传。
export function assetSrc(url: string): string {
  return url.startsWith('/') ? `${BASE}${url}` : url;
}

// 登出请求的共同语义：apiFetch 对非 2xx 不抛异常，所以「是否真的登出成功」必须显式判断。
// 调用方拿到 false 时**不要**清理本地登录态——服务端会话仍然有效，清了会出现
// 「界面显示已登出、切个标签页又被 /api/auth/me 自动登回来」的错乱。
export async function tryLogout(url: string): Promise<boolean> {
  try {
    const res = await apiFetch(url, { method: 'POST' });
    return res.ok;
  } catch (e) {
    console.warn('登出请求异常:', e);
    return false;
  }
}
