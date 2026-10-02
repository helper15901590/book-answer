# book_answer 全栈零基础教材

> 面向第一次接触 Web 开发、但愿意耐心学习的读者。
>
> 目标不是让你立刻背代码，而是建立一张能反复使用的“技术地图”：看到任何一个名词，都知道它在系统中处于哪一层、为什么会出现、解决什么问题、本项目具体怎样实现。
>
> 本教材以当前仓库 `C:\Users\Administrator\Desktop\book-answer` 为依据编写。仓库会继续变化，遇到行为不一致时，以源码和 `docs/deploy.md` 为准。

## 如何使用这份教材

不要从第一页硬背到最后一页。推荐按下面的顺序学习：

1. 先读“项目全景图”，知道这个产品做什么。
2. 再读“Web 基础”，理解浏览器和后端为什么必须通信。
3. 按前端、后端、数据库、部署四条线逐章学习。
4. 每学一条链路，都在浏览器、接口响应、数据库三处找证据。
5. 最后再学安全、备份、监控和扩容。它们是“把系统安全地跑起来”的知识，不是地基之外的装饰。

每一章建议用同一个方法：

- **是什么**：用一句人话解释。
- **为什么**：它解决什么旧问题。
- **怎么做**：它在项目中的真实位置。
- **英文全称与历史**：术语为什么这样命名，大约在什么背景下出现。
- **常见误区**：初学最容易混淆的地方。
- **动手练习**：观察或验证一个事实。

---

## 一分钟认识这个项目

`book_answer` 是一个“经典著作与导师人物 AI 思想蒸馏平台”。

用户可以：

- 匿名浏览书籍、导师和技能详情。
- 登录后创建聊天会话、查看历史记录、向 AI 提问。
- 根据会员等级获得不同额度的每日或每月 AI 使用次数。

管理员可以：

- 创建、禁用、删除用户，重置临时密码。
- 设置会员等级和有效期。
- 管理书籍、导师、标签、封面和系统提示词。
- 配置 OpenAI 兼容的大模型接口和每日额度。
- 查看统计、订单占位数据和审计记录。
- 使用密码、第二重口令和 TOTP 动态验证码保护后台。

需要先纠正一个直觉：这里所谓的“AI 导师”并不是本项目自己训练出来的大模型。项目负责账号、权限、技能提示词、聊天上下文、配额、流式转发和持久化；真正的文字生成由外部大模型服务完成。可以把项目理解成“大模型的业务外壳与安全网关”。

## 技术栈总览

| 层次 | 本项目的技术 | 主要职责 |
|---|---|---|
| 浏览器界面 | HTML、CSS、JavaScript、React、TypeScript | 显示页面、接收输入、调用接口、渲染流式回答 |
| 前端构建 | Vite、esbuild、Rollup、Tailwind CSS | 开发时热更新，发布时压缩并生成静态文件 |
| 网络协议 | DNS、TCP/IP、TLS、HTTP、SSE | 把请求、响应和流式文字可靠地送到两端 |
| 后端运行时 | Node.js 22 | 在服务器上运行 JavaScript/TypeScript 代码 |
| 后端框架 | Express 4 | 路由、中间件、请求校验和响应 |
| 数据校验 | Zod | 检查请求字段是否合法 |
| 数据库 | SQLite、better-sqlite3、WAL | 用一个本地数据库文件保存用户、技能、会话和配置 |
| 身份与安全 | 服务端 Session、Cookie、CSRF、bcrypt、TOTP、Helmet、限流 | 证明“你是谁”、限制“你能做什么”、防止攻击 |
| AI 接入 | OpenAI 兼容 HTTP API、SSE 流式响应 | 安全地调用 DeepSeek 等模型并把文字逐段传给浏览器 |
| 可观测性 | Pino、Sentry、健康检查、指标 | 看日志、跟踪错误、判断服务是否活着 |
| 部署 | Linux VPS、Docker、Docker Compose、Caddy | 把应用打包到服务器，通过 HTTPS 对公网提供服务 |
| 自动化 | GitHub Actions、Vitest、TypeScript 编译器、Autocannon | 自动检查、测试、构建和压测 |
| 备份 | SQLite backup、restic、S3 兼容存储、Cron | 定期备份并具备恢复能力 |

## 系统全景图

```text
                         公网用户浏览器
                               |
                    DNS 解析域名 -> 服务器 IP
                               |
                        HTTPS / TLS 加密
                               |
                        Caddy 反向代理
                               |
                     http://app:3000（容器内）
                               |
                 +-------------+-------------+
                 |                           |
         React 静态页面                  Express API
       dist/index.html 等               server/routes/*
                 |                           |
                 +-------- 同源 /api -------+
                                             |
                                  中间件：安全、限流、日志、会话
                                             |
                                  业务路由与 service 层
                                             |
                        +--------------------+-------------------+
                        |                    |                   |
                   SQLite 数据库      第三方 LLM API      日志/错误监控
                 data/commercial.sqlite    DeepSeek         Pino/Sentry
```

理解这张图要抓住两点：

1. **浏览器不直接碰数据库，也不直接碰模型密钥。** 浏览器只和本项目后端说话。
2. **生产环境虽然看起来有 Caddy、Node、SQLite 等多个部件，但它们运行在同一台 VPS 的容器和挂载目录中。** 当前架构追求简单，不以高可用和多副本为目标。

## 仓库目录地图

```text
book-answer/
├── src/                        前端源码
│   ├── App.tsx                 用户端根组件
│   ├── components/             页面与业务组件
│   ├── i18n/                   多语言
│   ├── lib/                    浏览器端公共工具
│   ├── data/                   初始技能和默认配置
│   └── types.ts                前后端共享的 TypeScript 类型
├── server/                     后端源码
│   ├── index.ts                进程入口与优雅停机
│   ├── app.ts                  Express 应用总装
│   ├── config.ts               环境变量读取与启动校验
│   ├── db.ts                   SQLite schema、迁移与数据访问
│   ├── middleware/             会话、CSRF、异步错误兜底
│   ├── routes/                 登录、技能、聊天、后台、公开配置
│   └── services/               密码、额度、LLM、日志、安全等业务服务
├── tests/                      自动化测试
├── scripts/                    配置检查、冒烟、压测、备份恢复等脚本
├── docker/                     Dockerfile、Compose、Caddy 模板
├── docs/                       架构、学习、部署与设计文档
├── .github/workflows/ci.yml   持续集成
├── package.json               依赖和 npm 命令
├── vite.config.ts             前端构建配置
├── vitest.config.ts           测试配置
├── tsconfig.json              TypeScript 编译规则
├── data/                      运行数据，已被 Git 忽略
├── dist/                      前端生产构建结果
└── dist-server/               后端生产构建结果
```

`data/`、`dist/` 和 `dist-server/` 都是“产物”，不是应该手工编辑的源码：

- `data/`：运行时产生的数据库与上传图片。
- `dist/`：Vite 生成的前端静态文件。
- `dist-server/`：esbuild 生成的后端单文件 bundle。

---

# 第 1 章：Web 到底是什么

## 1.1 从“点击按钮”看整个互联网

你在浏览器里点击“发送”以后，电脑内部大致做了这些事：

1. 浏览器中的 JavaScript 读取输入框内容。
2. 浏览器把数据组织成 HTTP 请求。
3. DNS 把域名翻译成服务器 IP 地址。
4. 浏览器与服务器建立 TCP 连接，HTTPS 时再建立 TLS 加密层。
5. 请求经过互联网、云安全组、Caddy，到达 Node.js 后端。
6. Express 找到对应路由，中间件检查身份、来源和频率。
7. 业务代码访问 SQLite，或者调用外部大模型 API。
8. 后端生成 HTTP 响应。聊天接口使用 SSE 持续分段返回。
9. 浏览器解析响应，React 更新页面。

这段路可以从两个角度理解：

- **逻辑角度**：页面层 -> 接口层 -> 服务层 -> 数据层。
- **物理角度**：用户电脑 -> 公网 -> 云服务器 -> 容器 -> 进程 -> 文件。

学习全栈最重要的一件事，就是始终问自己：“现在处理这件事的，是浏览器、后端、数据库，还是外部服务？”

## 1.2 客户端与服务器

**英文**：Client / Server。

**是什么**：客户端是主动提出请求的软件，服务器是等待请求并返回结果的软件。浏览器是客户端，本项目运行在 VPS 上的 Node.js 进程是服务器。

**为什么**：个人电脑可能关机、网络不稳定，也不适合保存所有用户的数据。集中部署服务器可以维护同一份业务规则和数据。

**命名逻辑**：Client 原意是“客户、委托人”，在计算机中指请求服务的一方；Server 是“提供服务的一方”。

**历史背景**：客户端/服务器模型在 20 世纪 80 年代随着局域网和个人计算机普及。万维网出现后，浏览器成为最常见的客户端。

**本项目的边界**：

- 浏览器负责显示和输入，不能相信它传来的权限信息。
- 后端决定用户身份、配额和可访问的数据。
- 数据库只接受后端访问。
- 大模型 API Key 只保存在服务器环境或加密后的数据库配置中，绝不能发送给浏览器。

## 1.3 IP、域名与 DNS

**IP**：Internet Protocol，互联网协议。IP 地址是联网设备的数字地址，例如 IPv4 的 `203.0.113.10` 或 IPv6 地址。

**DNS**：Domain Name System，域名系统。它像互联网的电话簿，把 `example.com` 翻译成 IP。

**命名逻辑**：Domain 是“领域、域名”，Name System 表示“名称系统”。

**历史背景**：互联网早期用主机文件手工维护地址。1983 年 DNS 出现，解决了地址越来越多、无法集中维护的问题。

一次访问通常发生：

```text
example.com
   ↓ DNS 查询
203.0.113.10
   ↓ 连接 443 端口
服务器上的 Caddy
```

**为什么需要域名**：用户可以记名称，服务器更换 IP 时只需修改 DNS 记录。域名还用于 TLS 证书和 HTTP 来源校验。

**本项目的联系**：生产环境要求 `APP_ORIGIN` 设置为用户实际访问的完整地址，例如 `https://example.com`。后端用它校验写请求来源，防止 CSRF。

## 1.4 端口

**是什么**：一台服务器可以同时运行很多网络程序，端口号用来区分具体服务。例如：

- 80：HTTP 默认端口。
- 443：HTTPS 默认端口。
- 3000：本项目应用内部监听端口。
- 22：SSH 远程登录默认端口。

**为什么**：IP 只能找到“哪台机器”，端口进一步找到“机器上的哪个服务”。

**本项目的联系**：

```text
公网 -> Caddy 容器 80/443 -> app 容器 3000
```

Compose 默认把 app 的 3000 端口绑定到宿主机 `127.0.0.1`，也就是只允许服务器本机访问。这样外部用户不能绕过 Caddy 直接访问后端。无域名内测时才改成 `0.0.0.0` 并开放云安全组端口。

## 1.5 TCP、TLS 与 HTTPS

**TCP**：Transmission Control Protocol，传输控制协议。它负责把数据拆成包、确认收到、按顺序重组，并处理丢包重传。

**TLS**：Transport Layer Security，传输层安全协议。它提供加密、身份验证和完整性保护。

**HTTPS**：Hypertext Transfer Protocol Secure，安全的超文本传输协议。实践中就是 HTTP 运行在 TLS 之上。

**SSL**：Secure Sockets Layer，安全套接字层。它是 TLS 的前身，现在说“SSL 证书”通常是历史习惯，技术上大多已是 TLS。

**历史背景**：Netscape 在 20 世纪 90 年代提出 SSL。SSL 3.0 之后由 IETF 标准化并更名为 TLS。现代浏览器已经淘汰旧 SSL 版本。

**为什么需要 HTTPS**：

- 防止密码、Cookie、聊天内容在公网明文传输。
- 让浏览器确认访问的是证书对应的真实域名。
- 防止内容被中途篡改。

**本项目的联系**：

- 正式部署用 Caddy 自动申请和续期证书。
- 生产 Cookie 默认带 `Secure`，只允许通过 HTTPS 发送。
- 无域名内测必须显式设置 `ALLOW_INSECURE_HTTP=1`，同时关闭几项 HTTPS 强制策略，风险很高，只能短期使用。

## 1.6 URL 的组成

**URL**：Uniform Resource Locator，统一资源定位符。

可以这样拆解：

```text
https://example.com:443/api/chat/stream?mode=fast#result
└─┬─┘   └────┬────┘└┬┘└──────┬───────┘└────┬────┘└──┬─┘
协议      主机名    端口      路径           查询参数   片段
```

另一个相近概念是 **URI**：Uniform Resource Identifier，统一资源标识符。URI 是更宽的概念；URL 是“能定位资源位置”的 URI。

**历史背景**：Tim Berners-Lee 在 1989 年提出万维网构想，URL、HTTP、HTML 是其中的基础。URL 的核心目标是让全球资源有统一名称和定位方式。

**本项目例子**：

- `/api/skills`：读取公开技能列表。
- `/api/chat/stream`：提交消息并接收 SSE 流。
- `/admin`：管理后台入口。
- `/assets/...`：用户上传的封面等静态素材。

## 1.7 HTTP 请求与响应

**HTTP**：HyperText Transfer Protocol，超文本传输协议。

**是什么**：浏览器和服务器之间的一套文本约定。客户端发 Request，服务器回 Response。

**历史背景**：

- 1991 年出现早期 HTTP/0.9。
- 1996 年 HTTP/1.0 正式标准化。
- 1997 年 HTTP/1.1 支持持久连接等能力。
- 2015 年 HTTP/2 提升并发传输效率。
- 2022 年 HTTP/3 正式标准化，底层使用 QUIC/UDP。

本项目是普通 HTTPS 请求和 SSE 长连接，不要求你掌握所有协议细节。先理解 HTTP/1.1 的请求模型就够用。

一个请求主要包括：

```http
POST /api/auth/login HTTP/1.1
Host: example.com
Content-Type: application/json
Origin: https://example.com

{"phone":"13800000000","password":"..."}
```

一个响应主要包括：

```http
HTTP/1.1 200 OK
Content-Type: application/json
Set-Cookie: book_answer_user_session=...

{"success":true,"user":{...}}
```

### HTTP 方法

| 方法 | 含义 | 本项目例子 |
|---|---|---|
| GET | 读取资源，通常不应改变数据 | `GET /api/skills` |
| POST | 提交数据或执行动作 | `POST /api/auth/login` |
| DELETE | 删除资源 | `DELETE /api/chat/sessions/:id` |
| PUT | 用完整内容替换资源 | 本项目未使用 |
| PATCH | 局部修改资源 | 本项目未使用 |

**命名历史**：方法名来自 HTTP 对资源操作语义的约定。后来 Roy Fielding 在 2000 年博士论文中总结 REST 风格，进一步强调用统一语义操作资源。

**注意**：GET 在项目里用于“读取”，但 GET 不是绝对安全的天然保证。安全来自后端实现，而不是前端是否用了某个方法。

### 常见状态码

状态码是三位数字：

- `2xx`：成功。最常见是 `200 OK`。
- `3xx`：重定向。例如 `/admin` 跳转到页面文件。
- `4xx`：请求方或权限有问题。
- `5xx`：服务器或上游服务出错。

本项目常见状态码：

| 状态码 | 含义 | 项目场景 |
|---|---|---|
| 200 | 成功 | 正常接口、SSE 已经开始返回 |
| 400 | Bad Request，请求格式错误 | Zod 校验失败 |
| 401 | Unauthorized，通常表示未登录或会话失效 | 访客读取聊天历史 |
| 403 | Forbidden，已识别但不允许 | CSRF 失败、普通用户访问后台 |
| 404 | Not Found，资源不存在 | 技能或会话不存在 |
| 409 | Conflict，冲突 | 会话 ID 被其他用户占用 |
| 423 | Locked，资源被锁定 | 连续登录失败后账号锁定 |
| 500 | Internal Server Error，未捕获的服务端错误 | 程序 bug |
| 502 | Bad Gateway，上游服务失败 | 大模型不可用 |
| 503 | Service Unavailable，当前不可服务 | 数据库异常或 AI 未配置 |

**一个初学陷阱**：SSE 路由可能先返回 HTTP `200`，之后在流里发送 `{"error":"AI_UNAVAILABLE"}`。所以“HTTP 200”只表示连接成功，不代表业务一定成功。

## 1.8 Header、Cookie 与同源

**Header**：HTTP 头，是请求或响应中的元数据。

常见请求头：

- `Content-Type: application/json`：正文是 JSON。
- `Origin`：请求从哪个页面发出，用于 CSRF 校验。
- `Cookie`：浏览器自动携带的登录票据。
- `X-CSRF-Token`：前端主动添加的防伪令牌。

常见响应头：

- `Set-Cookie`：服务器要求浏览器保存 Cookie。
- `Content-Security-Policy`：限制页面可加载和执行哪些资源。
- `Cache-Control`：告诉浏览器和中间层怎样缓存。

**Cookie** 是浏览器保存的小段文本。它不是数据库，也不适合放大数据。服务端通过 `Set-Cookie` 下发，浏览器后续请求同源地址会自动携带。

**同源（Same Origin）** 指协议、域名、端口三者完全一致：

```text
https://example.com 和 https://example.com/api    同源
https://example.com 和 https://www.example.com    不同源
http://example.com  和 https://example.com        不同源
```

同源策略是浏览器的重要安全边界。它阻止恶意网页随意读取其他网站的响应。

## 1.9 浏览器里的 HTML、CSS 和 JavaScript

网页有三项最基本的语言：

| 技术 | 英文全称 | 作用 | 类比 |
|---|---|---|---|
| HTML | HyperText Markup Language | 定义内容和结构 | 房子的骨架、房间 |
| CSS | Cascading Style Sheets | 定义样式和布局 | 装修与颜色 |
| JavaScript | 不带 Java 含义的正式缩写，标准名是 ECMAScript | 定义行为和交互 | 水电、开关和自动装置 |

### HTML

**是什么**：用标签描述标题、按钮、文本、表单等结构。

**历史**：Tim Berners-Lee 在 1990 年代初创造 HTML。它来源于 SGML（Standard Generalized Markup Language，标准通用标记语言）的思想。

**本项目的联系**：`index.html` 只有一个根节点，真正的用户界面由 React 在浏览器中创建。

### CSS

**是什么**：控制视觉呈现、间距、排版和响应式布局。Cascading 表示多个来源的样式规则会按优先级层叠和继承。

**历史**：CSS 在 1996 年成为 W3C 推荐标准，目的是把内容和视觉分离。

**本项目**：使用 Tailwind CSS，把大量样式写成 class 组合。最终仍会生成普通 CSS 文件。

### JavaScript

**是什么**：浏览器中的脚本语言，后来通过 Node.js 也能在服务器运行。

**历史**：Brendan Eich 于 1995 年在 Netscape 用很短时间创造。为了借助 Java 的热度，名字被定为 JavaScript，但它和 Java 不是同一种语言，也没有继承关系。1997 年开始标准化为 ECMAScript。

**本项目**：前后端主要代码都是 JavaScript 的带类型版本 TypeScript。

### DOM

**DOM**：Document Object Model，文档对象模型。

**是什么**：浏览器把 HTML 解析成树形对象，JavaScript 可以读取和修改这些对象。

```text
document
└── html
    ├── head
    └── body
        └── div#root
```

React 最终仍然操作 DOM，只是它替开发者管理“何时改、改哪一部分”。

## 1.10 从静态网页到单页应用

**SPA**：Single Page Application，单页应用。

传统网站每点一个链接，浏览器向服务器请求一份新 HTML，整页刷新。SPA 首次加载 JavaScript 后，由前端路由和组件切换内容，页面不必整页刷新。

**历史背景**：2000 年代中期 AJAX（Asynchronous JavaScript and XML，异步 JavaScript 和 XML）让网页可以不刷新就获取数据。2010 年前后，Backbone、Angular、React、Vue 等框架推动 SPA 普及。

本项目是 SPA：

- 用户端由 `src/main.tsx` 挂载 `App`。
- 管理端由 `src/admin-main.tsx` 挂载后台界面。
- 生产环境 Express 把 `dist/index.html` 和 JS/CSS 发给浏览器。
- 页面数据通过 `/api/...` 获取。

**SPA 的优点**：交互流畅，前后端职责较清楚。

**SPA 的代价**：首包变大；SEO 和首屏有时需要额外处理；状态错误可能在浏览器里持续存在；前端权限检查不能代替后端检查。

## 1.11 一次页面加载与一次接口请求不是一回事

这是 Zero 基础最容易混淆的地方。

第一次打开首页：

```text
GET /                 -> 返回 index.html
GET /assets/index.js  -> 返回 JavaScript
GET /assets/index.css -> 返回 CSS
```

脚本运行后，应用再发起 API 请求：

```text
GET /api/auth/me       -> 当前是否登录
GET /api/config/public -> 公共配置
GET /api/skills        -> 技能列表
```

因此“页面打不开”和“页面能打开但数据为空”是两类故障：

- 页面打不开：先看 HTML、JS/CSS、DNS、HTTPS、容器。
- 页面能打开但数据为空：先看 `/api/...`、登录会话、数据库和返回内容。

## 1.12 练习：只靠浏览器理解请求

1. 运行项目后打开浏览器开发者工具。
2. 进入 Network（网络）面板。
3. 刷新首页，观察 HTML、CSS、JS 的加载顺序。
4. 过滤 `api`，找到 `/api/auth/me`、`/api/config/public`、`/api/skills`。
5. 点击某个请求，依次查看：
   - Request URL：请求地址。
   - Method：GET 或 POST。
   - Status Code：状态码。
   - Request Headers：请求头。
   - Response：服务器返回的数据。

你至少要能回答：

- 浏览器请求的是文件，还是 API 数据？
- 请求有没有自动携带 Cookie？
- 后端返回的是 HTML，还是 JSON？
- 页面上的某个字段来自哪个 API？

---

# 第 2 章：前端是怎样工作的

## 2.1 前端不是“画页面”这么简单

**前端**通常指运行在浏览器里的部分。它负责：

- 把数据渲染成用户能看懂的界面。
- 收集点击、输入和选择。
- 管理页面临时状态。
- 调用后端 API。
- 展示加载、错误、空数据和成功反馈。
- 在不刷新整页的情况下更新界面。

本项目的前端根目录是 `src/`。

## 2.2 先认识 Node.js、npm 和 package.json

虽然 Node.js 主要被称为后端运行时，但前端开发工具也运行在 Node.js 上。最常见的工具是 npm。

**Node.js**：

- **是什么**：让 JavaScript 脱离浏览器、直接在操作系统上运行的运行时。
- **组成部分**：V8 JavaScript 引擎 + 事件循环 + 文件系统、网络等能力。
- **历史**：2009 年由 Ryan Dahl 创建。传统 Web 服务器常为每个连接创建线程；Node 使用事件循环和异步 I/O，适合大量 I/O 密集任务。
- **命名逻辑**：Node 表示网络程序中的一个“节点”。
- **本项目版本要求**：Node.js 22。

**npm**：

- **官方定位**：Node Package Manager，通常这样解释为“Node 包管理器”。需要知道“npm”本身最初并不是严格按首字母缩写得名的。
- **是什么**：安装依赖、运行脚本、管理版本的命令和公共仓库。
- **历史**：2010 年随 Node 生态发展，后来成为全球最大的开源包生态之一。
- **下载来源**：默认 npm Registry，即 npm 包注册中心。

`package.json` 是项目清单，写着：

- 项目名称和模块类型。
- 可运行命令。
- 运行时依赖 `dependencies`。
- 开发时依赖 `devDependencies`。

本项目一些关键依赖：

```text
react / react-dom     界面和 React DOM 渲染
typescript            静态类型
vite                  开发服务器与前端构建
tailwindcss           工具类 CSS
express               后端 Web 框架
better-sqlite3        SQLite 驱动
zod                   数据校验
pino                  结构化日志
bcryptjs              密码哈希
```

**版本号**如 `^19.0.1` 遵循 Semantic Versioning：

```text
主版本.次版本.修订号
19   .   0   .   1
```

- 主版本变化：可能有不兼容修改。
- 次版本变化：增加功能，通常兼容。
- 修订号变化：修 bug，通常兼容。
- `^` 允许不改变主版本的升级。
- `package-lock.json` 锁定实际安装的精确版本，保证不同机器安装结果尽量一致。

`npm ci` 与 `npm install`：

- `npm install`：开发时安装，必要时更新锁文件。
- `npm ci`：按锁文件干净安装，CI 和 Docker 构建优先使用。

## 2.3 TypeScript：给 JavaScript 加类型

**英文全称**：TypeScript，没有更长官方全称，可以理解为 “Typed JavaScript”。

**是什么**：JavaScript 的超集。合法 JavaScript 基本也是合法 TypeScript，同时增加类型标注、接口、泛型和编译期检查。

**为什么需要**：

```ts
function sendMessage(text: string) { ... }

sendMessage(123); // TypeScript 在运行前就提示类型错误
```

在多人项目里，类型帮助回答：

- 这个对象有哪些字段？
- 字段是否可能为空？
- 函数参数和返回值是什么？
- 改了一个类型后，哪些地方受影响？

**命名逻辑**：Type 表示类型，就是带类型的 Script。

**历史**：微软在 2012 年发布 TypeScript，主要作者 Anders Hejlsberg。背景是大型 JavaScript 应用越来越难维护，需要静态检查工具。

**重要事实**：浏览器不认识 TypeScript。构建时必须转成 JavaScript。本项目的 `npm run lint` 实际执行 `tsc --noEmit`，只检查类型、不生成文件。

本项目的共享类型在 `src/types.ts`，例如：

- `UserProfile`：用户资料。
- `Skill`：完整技能对象，含 `systemPrompt`。
- `PublicSkill`：能公开给浏览器的技能，不含内部提示词。
- `LLMConfig`：模型和额度配置。
- `ChatSession` / `ChatMessage`：聊天会话与消息。

**为什么前后端能共享类型**：前后端都在同一个仓库、同一种 TypeScript 语言里，`server/` 可以 import `src/types.ts`。这减少接口字段对不上的风险。但类型只在开发和构建阶段检查，不能替代运行时校验；因此后端还使用 Zod 验证外部传来的 JSON。

## 2.4 React：把界面拆成组件

**英文全称**：React 不是缩写，原词 React 表示“反应、响应”。它强调界面会随数据和状态变化而重新渲染。

**是什么**：用于构建用户界面的 JavaScript 库。核心单位是组件（Component）。

**命名逻辑与历史**：Facebook 在 2013 年开源 React。它把页面描述为组件树，采用声明式思想，并借助虚拟 DOM 差异计算减少手工 DOM 操作。

**声明式与命令式**：

- 命令式：一步步命令浏览器“先找按钮，再改文字，再隐藏弹窗”。
- 声明式：描述“当 user 为空时显示登录按钮，当 user 存在时显示用户头像”，React 负责差值更新。

**组件**：接收输入、返回界面描述的独立单元。现代 React 组件通常是返回 JSX 的函数。

**JSX**：JavaScript XML。它是一种语法扩展，看起来像 HTML，实际上会被编译成 JavaScript 函数调用。

```tsx
function Hello({ name }: { name: string }) {
  return <h1>你好，{name}</h1>;
}
```

JSX 并不等于 HTML：`className` 取代 `class`，事件名使用 `onClick` 这样的驼峰形式，表达式要放在 `{}` 中。

### Props 与 State

**Props**：Properties，属性。由父组件传给子组件，子组件不应直接修改。

**State**：组件内部会随时间变化的数据。修改 state 会让 React 重新渲染相关组件。

```text
父组件拥有 user 状态
   ↓ props
子组件根据 user 决定显示“登录”还是用户资料
```

本项目 `App.tsx` 保存全局级别的用户端状态：

- `user`：当前登录用户。
- `skills`：技能列表。
- `llmConfig`：公开模型配置。
- `authPolicy`：密码和注册策略。
- `selectedSkill`：当前选中的技能。
- `isLoginOpen` / `loginReason`：是否打开登录框以及原因。

它通过 props 把这些状态传给 `AiStudioWorkspace`。

### Hook

**是什么**：Hook 是 React 16.8 引入的函数，让函数组件拥有状态和生命周期能力。

常见 Hook：

- `useState`：保存状态。
- `useEffect`：在渲染后执行同步、订阅或清理逻辑。
- `useCallback`：缓存函数引用，避免依赖它的 effect 反复执行。
- `useMemo`：缓存计算结果。
- `useRef`：保存不触发渲染的可变引用。

`App.tsx` 在启动时：

1. `refreshUserProfile()` 调 `/api/auth/me`。
2. `refreshPublicConfig()` 调 `/api/config/public`。
3. 调 `/api/skills` 获取技能。
4. 监听 `focus` 和 `visibilitychange`，当用户回到页面时重新同步账号与配置。

**为什么要监听 focus**：管理员可能刚修改了会员等级或额度。用户切回标签页时刷新，能减少“页面显示旧数据”的错位。

### React StrictMode

`src/main.tsx` 使用 `<StrictMode>`。开发模式下，它会有意做一些额外检查，甚至让部分 effect 执行两次，以暴露副作用问题。生产环境不会因此重复发送请求。

初学者看到“开发环境请求了两次”不要立刻认定后端重复处理。要同时观察浏览器网络面板和生产构建行为。

## 2.5 Vite：开发服务器与构建工具

**英文名**：Vite 来自法语，意思是“快”，常读作类似 “veet”。

**是什么**：前端开发服务器和构建工具。开发时提供快速启动、模块加载和 HMR；发布时把源码打成优化后的静态资源。

**HMR**：Hot Module Replacement，热模块替换。修改代码后只替换发生变化的部分，不总是整页刷新。

**历史背景**：Vite 由 Vue 作者 Evan You 等人在 2020 年推出。它利用浏览器原生 ES Module，开发时不为所有文件反复打包，因此大型项目启动更快；生产构建使用 Rollup。

**本项目 `vite.config.ts`**：

- React 插件处理 JSX 和 Fast Refresh。
- Tailwind 插件生成样式。
- `@` 别名指向项目根目录。
- 可通过 `DISABLE_HMR` 关闭 HMR，适合某些自动编辑场景。

开发时，Vite 作为 middleware 挂在 Express 上，所以只启动 `npm run dev`，前后端就在同一个 `http://localhost:3000`，不需要单独解决跨域。

生产时，Vite 生成 `dist/`，Express 只负责把这些静态文件发出去。

## 2.6 Tailwind CSS：原子化样式

**英文全称**：Tailwind CSS，名称可理解为“尾样式”，不是缩写。

**是什么**：Utility-first CSS framework，工具优先的 CSS 框架。通过组合大量单一职责的 class 写样式。

```html
<div class="flex items-center gap-2 rounded-lg px-4 py-2">
```

对应 `display:flex`、垂直居中、间距、圆角、水平竖直内边距。

**历史背景**：Tailwind 由 Adam Wathan 等人在 2017 年前后创建。它针对传统 CSS 中命名困难、样式复用和删除困难的问题，转而强调直接在结构中组合小工具类。

**优点**：快速、一致、容易看出当前元素样式。

**代价**：class 很长；复杂组件需要提取子组件或公共样式；如果项目没有统一设计尺度，仍可能混乱。

**项目规范提醒**：当前 UI 风格必须保持现状，修改功能时不要顺手重做样式。

## 2.7 用户端前端结构

### 入口

`src/main.tsx`：

```text
index.html 的 #root
  -> React createRoot
  -> I18nProvider
  -> App
```

### App

`src/App.tsx` 是用户端组合层：

- 维护账号、技能、公共配置。
- 挂载主工作区 `AiStudioWorkspace`。
- 条件挂载 `LoginModal`。

### AiStudioWorkspace

`src/components/AiStudioWorkspace.tsx` 是用户端主工作区，包含：

- 顶部导航和账号状态。
- 技能市场与搜索。
- 书籍/导师详情。
- 聊天工作区。
- 历史会话。
- 登录触发。
- 流式消息接收。
- 会员弹窗等交互。

这个组件约 1500 行，当前承担的功能很多。学习时建议按功能搜索，不要试图一口气从头读到尾：

```text
market / skill / session / message / stream / login
```

从工程演进看，组件过大以后可以考虑按功能拆分，但必须避免为了“看起来架构更漂亮”而做无关重构。

### 其他关键组件

| 文件 | 职责 |
|---|---|
| `LoginModal.tsx` | 登录、首次改密 |
| `AdminGate.tsx` | 管理后台登录和 MFA |
| `AdminPanel.tsx` | 后台用户、技能、配置和统计管理 |
| `MarketSection.tsx` | 技能市场列表 |
| `BookDetailModal.tsx` | 书籍详情 |
| `MembershipModal.tsx` | 会员方案展示 |
| `MarkdownMessage.tsx` | 安全渲染 AI 的 Markdown 回答 |
| `LanguageSwitcher.tsx` | 语言切换 |

## 2.8 前端 API 封装

`src/lib/apiFetch.ts` 负责统一处理：

- 写请求默认带上 `credentials: 'include'`，让浏览器携带 HttpOnly Cookie。
- 从可读的 CSRF Cookie 读取令牌。
- 写入 `X-CSRF-Token` 请求头。
- 统一处理 401、403 和错误信息。

为什么不用每个组件都手写 fetch：

- 避免漏掉 CSRF。
- 避免各组件错误处理不一致。
- 让所有接口调用有统一入口。

### 为什么 Session Cookie 是 HttpOnly，CSRF Cookie 不是

- `book_answer_user_session` 含会话票据，设为 HttpOnly，JavaScript 不能读取，降低 XSS 偷走会话的风险。
- `book_answer_user_csrf` 必须让 JavaScript 读取并放进请求头，因此不是 HttpOnly。

这并不矛盾：会话票据始终自动发送，但攻击站点即使能让浏览器自动发 Cookie，也难以读取 Cookie 并伪造自定义 CSRF 头。

## 2.9 登录前端到底做了什么

`LoginModal.tsx` 的主要步骤：

1. 用户输入手机号和密码。
2. `fetch('/api/auth/login', { method: 'POST' })`。
3. 如果响应是 `passwordChangeRequired`，显示新密码设置界面。
4. 调 `/api/auth/change-password`。
5. 登录成功后把后端返回的用户对象交给 `App`。
6. 关闭弹窗并刷新用户资料。

需要特别注意：

- 前端不保存密码到 localStorage。
- 前端不自行判断“这个用户是不是管理员”。
- 登录成功的权威依据是后端会话，而不是组件里的一个布尔值。
- 页面刷新后会调 `/api/auth/me` 重新确认身份。

## 2.10 前端如何接收流式 AI 回答

浏览器的 `fetch` 不仅能拿完整 JSON，也能读取响应体流：

```ts
const response = await fetch('/api/chat/stream', { ... });
const reader = response.body.getReader();
const decoder = new TextDecoder();
```

每收到一段二进制数据：

1. `TextDecoder` 把字节转成文本。
2. 按换行拆开 SSE 消息。
3. 解析 `data: {...}`。
4. 取出 `delta` 和 `fullText`。
5. 更新界面，让用户看到文字逐渐出现。

**SSE**：Server-Sent Events，服务器发送事件。

**特点**：

- 服务器到客户端单向持续发送。
- 基于普通 HTTP，可自动重连（原生 `EventSource` 场景）。
- 文本协议，调试直观。
- 比 WebSocket 简单，适合只推文字的场景。

**命名逻辑与历史**：Event 表示事件，Server-Sent 表示由服务器发送。它是 HTML5 时代逐步标准化的一项浏览器能力。

本项目没有用原生 `EventSource`，因为聊天是 `POST` 且要发送 CSRF 头；原生 EventSource 主要支持 GET，JSON POST 请求不适用。所以使用 `fetch` + 流读取，但传输格式仍采用 SSE 的 `data:` 格式。

## 2.11 多语言 i18n

**i18n**：Internationalization。单词首字母 I、尾字母 N 之间有 18 个字母，因此缩写为 i18n。中文通常叫“国际化”。

本项目支持：

- `zh-CN`：中国大陆简体中文。
- `zh-TW`：台湾繁体中文。
- `en`：英文。

`src/i18n/locales/` 保存三套字典。测试会检查：

- 三种语言的键是否完全一致。
- 是否有空文案。
- 占位符是否一致。

后端不应把所有 UI 文案都写死成中文。有些错误返回错误码，例如 `AI_UNAVAILABLE`，前端再按当前语言翻译，这样同一条后端错误可以适配所有语言。

## 2.12 前端状态和“事实来源”

学习前端最容易犯的错误，是把同一事实保存在多个地方：

- 用户对象既存在 `App`，又存在 `AiStudioWorkspace` 本地 state。
- 技能列表既从接口读取，又保留一份旧数组。
- 会员额度在用户对象和公共配置中各存一份。

如果它们不同步，就出现“后台已修改，前台没变化”之类的问题。

本项目做了几种同步：

- App 启动和窗口重新聚焦时刷新用户与公共配置。
- 聊天结束后后端返回最新用户对象，前端更新配额显示。
- 技能点击后服务端增加热度；后台保存时会避免用旧快照覆盖新热度。

**理论原则**：对同一项关键事实，明确一个权威来源。通常服务器的数据库是权威，前端 state 只是当前页面快照。

## 2.13 前端常见故障怎么定位

| 现象 | 首先看什么 | 常见原因 |
|---|---|---|
| 整页白屏 | Console、Network、HTML | JS 报错、构建文件缺失、CSP 阻止脚本 |
| 样式全乱 | CSS 请求、class、构建 | CSS 未生成、浏览器缓存、Tailwind 扫描问题 |
| 按钮没反应 | Console、事件处理函数 | JS 异常、loading 状态未恢复 |
| 一直显示未登录 | `/api/auth/me`、Cookie | 会话过期、Cookie 域或 Secure 配置错误 |
| 写操作 403 | Origin、CSRF 请求头 | APP_ORIGIN 不一致、CSRF Cookie 丢失 |
| AI 不输出 | Network 的 stream、SSE 数据 | 上游模型失败、网络中断、代理缓冲 |
| 页面数据旧 | 对应 API 响应 | 未刷新、服务端数据未更新、状态覆盖 |

## 2.14 练习：追踪一个技能卡片

1. 在 `AiStudioWorkspace.tsx` 搜索 `fetch('/api/tags')` 和 `apiFetch('/api/skills/'`。
2. 找到市场列表如何接收 `skills` props。
3. 在浏览器 Network 面板找到 `/api/skills`。
4. 对照响应字段和 `Skill` / `PublicSkill` 类型。
5. 点击技能，找到 `/api/skills/:id/click`。
6. 刷新页面，观察热度变化。

完成后你应该能回答：

- 数据先从哪里来？
- 组件在什么条件下渲染卡片？
- 点击动作改的是前端 state，还是服务端数据库？
- 刷新后为什么还能看到变化？

---

# 第 3 章：后端的运行原理与项目结构

## 3.1 Node.js 为什么能运行 JavaScript

**英文全称**：Node.js。

**是什么**：基于 V8 JavaScript 引擎的服务端运行时。它不只是“把浏览器里的 JS 搬出来”，还提供文件、网络、进程、加密等系统能力。

**V8**：Google 开发的开源 JavaScript 引擎，Chrome 和 Node.js 都使用。它把 JavaScript 编译成机器码执行。

**为什么不用为前后端学习两种语言**：Node.js 让 JavaScript 同时覆盖浏览器和服务器，团队可以复用语言、工具和类型。代价是 CPU 密集型任务可能阻塞事件循环，需要谨慎处理。

### 事件循环

**Event Loop**：事件循环。

Node.js 采用非阻塞 I/O：

```text
收到请求
  -> 发起数据库或网络 I/O
  -> 等待期间去处理其他请求
  -> I/O 完成后执行回调或恢复 Promise
```

它不是“真的同时执行所有代码”。JavaScript 主线程同一时刻仍只执行一段同步代码。

**为什么 bcrypt 很重要**：bcrypt 哈希计算比较昂贵。本项目把它作为异步能力的调用，但注释也指出底层计算仍会消耗主线程时间。因此降低安全参数不能随便做，还要用限流控制并发登录。

**常见阻塞示例**：

- 大循环处理百万条数据。
- 同步文件读写。
- CPU 密集的图片处理。
- 巨大 JSON 的同步解析。

本项目业务量较小，大量操作是网络 I/O 和 SQLite 快速读写。真正的大模型生成发生在外部服务器，本项目主要等待和处理流。

**命名与历史**：Node 原意“节点”，暗示它是网络中的一个节点。Ryan Dahl 在 2009 年创建 Node.js，灵感来自事件驱动服务器和高性能 V8。

## 3.2 JavaScript 模块：ESM 与 CommonJS

**ESM**：ECMAScript Modules，标准 JavaScript 模块系统。

```ts
import express from 'express';
export function registerAuthRoutes() {}
```

**CommonJS**：Node 早期使用的模块系统。

```js
const express = require('express');
module.exports = {};
```

`package.json` 中：

```json
"type": "module"
```

表示 `.js` 文件按 ESM 解释。

本项目源码常见 `import './config.js'`，即使磁盘上是 `config.ts`。这是为了符合 TypeScript/Node 的模块解析约定；开发时由 `tsx` 处理，生产构建时由 esbuild 合并。

生产后端输出扩展名是 `.cjs`：

```text
dist-server/server.cjs
```

`cjs` 明确指出它是 CommonJS 文件，避免被根目录 `"type":"module"` 干扰。

## 3.3 TypeScript 后端怎样运行

项目有两套使用方式：

### 开发时

```bash
npm run dev
```

实际执行：

```text
cross-env NODE_ENV=development tsx server/index.ts
```

**cross-env**：让 Windows、macOS、Linux 都能用同样的方式设置环境变量。

**tsx**：TypeScript Execute，能在开发时直接运行 TypeScript，不需先手工编译。

### 生产时

```bash
npm run build
```

先执行：

```text
vite build
```

生成前端 `dist/`。

再执行：

```text
esbuild server/index.ts --bundle --platform=node --format=cjs \
  --packages=external --outfile=dist-server/server.cjs
```

含义：

- `bundle`：把项目自己的后端模块尽量合并成一个文件。
- `platform=node`：按 Node.js 环境构建。
- `format=cjs`：输出 CommonJS。
- `packages=external`：npm 依赖不从 node_modules 一起打包，运行时仍需安装生产依赖。
- 输出 `dist-server/server.cjs`。

启动生产：

```bash
npm start
```

等价于：

```text
NODE_ENV=production node dist-server/server.cjs
```

**为什么要构建**：生产环境不必带 TypeScript 编译器和源码解析开销，直接运行更稳定、更简洁的 JavaScript。

## 3.4 Express 是什么

**英文全称**：Express.js，通常简称 Express。它不是一个展开缩写。

**是什么**：Node.js 上简洁、灵活的 Web 框架，提供路由、中间件、请求和响应封装。

**命名逻辑**：Express 原意“快速、明确表达”。它追求用较少代码表达 HTTP 服务。

**历史**：Express 由 TJ Holowaychuk 等人在 2010 年前后创建，受 Ruby 的 Sinatra 框架启发。它强调“unopinionated”，也就是不过度规定项目结构，开发者自己组织路由、服务和数据层。

**本项目使用 Express 4**，不是 Express 5。版本差异可能影响路由语法和错误处理，因此升级必须单独评估。

## 3.5 API、REST 与 JSON

**API**：Application Programming Interface，应用程序编程接口。

**是什么**：程序之间约定好的调用方式。本项目主要是 HTTP API：前端通过 URL、方法、请求头和正文调用后端。

**REST**：Representational State Transfer，表述性状态转移。

**命名逻辑**：Representational State 表示“资源的某种表现”，Transfer 表示在客户端和服务器之间转移。

**历史**：Roy Fielding 在 2000 年的博士论文中提出。REST 不是强制标准，而是一种架构风格。它强调资源 URI、统一方法和无状态交互。

本项目是“偏 REST 的 HTTP API”：

- `GET /api/skills` 读取资源集合。
- `DELETE /api/chat/sessions/:id` 删除资源。
- 同时也有 `POST /api/chat/stream` 这样的动作型接口，并不追求教科书式纯 REST。

**JSON**：JavaScript Object Notation，JavaScript 对象表示法。

**是什么**：一种轻量、人类可读的数据格式。

**命名与历史**：Douglas Crockford 在 2001 年左右推广 JSON。虽然名字包含 JavaScript，它早已成为语言无关的文本格式。

```json
{
  "success": true,
  "skills": []
}
```

**为什么不用 HTML 响应 API**：HTML 主要给浏览器显示；JSON 更适合程序读取和组合。接口返回 JSON，React 再决定如何显示。

## 3.6 应用启动入口

后端有两个重要入口：

### `server/index.ts`：进程入口

职责：

1. 初始化 Sentry。
2. 监听未处理的 Promise rejection。
3. 监听未捕获异常，记录后退出。
4. 调用 `createApp()` 创建 Express 应用。
5. 清理过期登录会话，并每小时再清理一次。
6. `app.listen(PORT, '0.0.0.0')` 开始监听。
7. 收到 SIGTERM/SIGINT 时优雅关闭：停止接收新连接，最多等待 8 秒，关闭数据库再退出。

**为什么需要优雅关闭**：容器发布新版本时，Docker 会要求旧进程停止。若直接强杀，正在写的 SQLite 事务、正在返回的 SSE 或日志可能处理不完整。优雅关闭给进行中的请求一个收尾窗口。

**SIGTERM / SIGINT**：

- SIGTERM 是系统请求进程终止的软信号，Docker 停止容器时常用。
- SIGINT 对应 Ctrl+C 等中断。

### `server/app.ts`：应用组装入口

它负责把安全、日志、路由、静态文件按顺序组合起来，不直接实现具体业务。

**为什么分开**：

- `index.ts` 管进程生命周期。
- `app.ts` 管 HTTP 应用结构。
- 测试可以创建 app 而不用真的监听端口。

## 3.7 Express 中间件

**英文**：Middleware，中间件。

**是什么**：请求进入具体路由前，由一系列函数逐层加工或检查。

```text
请求 -> 安全头 -> 限流 -> JSON 解析 -> Cookie 解析 -> 日志
     -> 身份解析 -> CSRF -> 业务路由 -> 响应
```

**命名逻辑**：它位于客户端和最终业务处理之间，所以叫“中间”的软件。

**历史背景**：中间件概念在 Web 框架中早已存在。Express 把中间件作为核心组合机制，形成类似管道的处理链。

**顺序非常重要**。请求先经过谁，决定后续代码能看到什么：

1. `helmet` 设置安全响应头。
2. `/api/health` 在总限流之前注册，保证监控探针不被限流。
3. `/api` 全局限流每分钟 300 次。
4. `express.json` 解析最大 5 MB 的 JSON 正文。
5. `cookieParser` 把 Cookie 解析成对象。
6. `pino-http` 记录请求日志，但忽略健康检查噪音。
7. `/assets` 单独限流并提供静态文件。
8. 请求指标计数。
9. `authMiddleware` 尝试解析用户或管理员会话。
10. `/api` 的 `csrfProtection` 检查写请求。
11. 初始化管理员种子。
12. 注册业务路由。
13. Sentry 错误处理。
14. API 未匹配时返回 JSON 404。
15. 开发环境挂 Vite；生产环境挂 `dist/` 静态文件。

**为什么健康检查放在限流前**：云监控每分钟可能请求多次。如果探针被限流，服务明明正常也会被判定不健康。

**为什么静态资源另设限流**：总限流只挂 `/api`，否则首页一次加载十几个 JS/CSS/图片就浪费 API 次数。但 `/assets` 开放给匿名用户，仍需要防止单 IP 无限下载。

## 3.8 路由是什么

**Route**：路由。

**是什么**：把“请求方法 + 路径”映射到处理函数。

```ts
app.get('/api/skills', handler);
app.post('/api/auth/login', handler);
```

**命名逻辑**：Route 原是“路线”，在网络中指请求从入口到处理器的路线。

**本项目按业务拆文件**：

| 文件 | 路由前缀 | 职责 |
|---|---|---|
| `server/routes/auth.ts` | `/api/auth` | 用户登录、改密、当前用户、退出 |
| `server/routes/skills.ts` | `/api/skills` | 公开技能、标签、提问生成 |
| `server/routes/chat.ts` | `/api/chat` | 会话和聊天流 |
| `server/routes/admin.ts` | `/api/admin` | 管理后台全部操作 |
| `server/routes/config.ts` | `/api/config` | 公开配置 |

**为什么拆文件**：一个文件承担所有接口会难找、难测、难修改。按业务领域拆开，符合低耦合。

## 3.9 当前 API 总表

### 公开或登录相关

| 方法 | 路径 | 是否需要登录 | 作用 |
|---|---|---|---|
| GET | `/api/health` | 否 | 检查数据库与进程状态 |
| GET | `/api/config/public` | 否 | 公开额度、会员价格、协议、密码策略 |
| GET | `/api/skills` | 否 | 技能列表，支持搜索、分类、类型筛选 |
| GET | `/api/skills/:id` | 否 | 技能详情，返回公开 DTO |
| POST | `/api/skills/:id/click` | 否 | 增加技能热度 |
| GET | `/api/tags` | 否 | 标签列表 |
| POST | `/api/auth/login` | 否 | 用户登录 |
| POST | `/api/auth/change-password` | 挑战票据 | 首次登录改密 |
| GET | `/api/auth/me` | 是 | 当前用户 |
| POST | `/api/auth/logout` | 是 | 注销用户会话 |

### 聊天

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/chat/sessions` | 读取当前用户的历史会话 |
| POST | `/api/chat/sessions` | 创建新会话 |
| DELETE | `/api/chat/sessions/:id` | 删除自己的会话 |
| POST | `/api/chat/stream` | 调用模型并用 SSE 持续返回 |
| POST | `/api/chat/send` | 一次返回完整回答的非流式备用接口 |

### 管理员登录与 MFA

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | `/api/admin/login` | 管理员第一重登录 |
| POST | `/api/admin/mfa/setup` | 生成 TOTP 密钥和恢复码 |
| POST | `/api/admin/mfa/confirm` | 确认绑定 |
| POST | `/api/admin/mfa/verify` | 日常 MFA 验证 |
| POST | `/api/admin/logout` | 管理员退出 |
| GET | `/api/admin/me` | 当前管理员 |

### 管理后台业务

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/admin/stats` | 统计信息 |
| GET | `/api/admin/users` | 用户列表 |
| POST | `/api/admin/users/create` | 创建用户和临时密码 |
| POST | `/api/admin/users/reset-password` | 重置临时密码 |
| POST | `/api/admin/users/status` | 启用或禁用 |
| POST | `/api/admin/users/update` | 修改用户资料 |
| POST | `/api/admin/users/upgrade-tier` | 修改会员等级和到期时间 |
| DELETE | `/api/admin/users/:userId` | 删除用户 |
| POST | `/api/admin/users/clear-all` | 清空用户 |
| POST | `/api/admin/orders/clear-all` | 清空订单 |
| POST | `/api/admin/upload-asset` | 上传封面等素材 |
| POST | `/api/admin/tags` | 增删标签 |
| GET | `/api/admin/skills` | 完整技能列表 |
| POST | `/api/admin/skills` | 新建或更新技能 |
| DELETE | `/api/admin/skills/:id` | 删除技能 |
| POST | `/api/admin/skills/generate-questions` | 用模型生成示例问题 |
| GET | `/api/admin/orders` | 订单占位数据 |
| GET | `/api/admin/llm-config` | 读取模型配置，不返回明文 Key |
| POST | `/api/admin/llm-config` | 保存模型配置 |
| POST | `/api/admin/llm-test` | 测试模型连通性 |

**为什么需要 API 清单**：当页面出错时，你可以在 Network 面板先定位接口，再从路由文件找到后端处理入口，最后追到数据库方法。不要一上来就在几千行前端文件里乱找。

## 3.10 请求参数与响应格式

请求参数来源有四类：

1. **路径参数**：`/api/skills/:id` 中的 `id`。
2. **查询参数**：`/api/skills?category=商业投资`。
3. **JSON 正文**：POST 请求中的 `req.body`。
4. **Cookie/Header**：会话、CSRF、Origin 等元数据。

后端不能相信任何外部输入，即使前端已经限制过：

- 路径参数可能被手工改。
- JSON 可能缺字段、类型错误或太长。
- 用户可能伪造 `userId`。
- 请求可能来自恶意页面。

**Zod**：

- **是什么**：TypeScript-first schema validation library，类型优先的数据结构校验库。
- **为什么**：TypeScript 只在开发时检查，不能阻止运行时恶意请求。
- **例子**：聊天消息 schema 要求 `sessionId`、`messageText` 长度符合范围，并明确禁止 `userId` 字段。
- **命名**：Zod 是一个简短品牌名，不是传统缩写。

**成功响应**常见形式：

```json
{ "success": true, "data": ... }
```

项目有些接口直接返回 `{ sessions }` 或 `{ skills }`，没有强制一个完全统一的包装。未来若要改协议，应先全局梳理，不能只改一端。

**错误响应**通常包含：

```json
{
  "error": "UNAUTHENTICATED",
  "message": "请先登录后继续"
}
```

`error` 适合程序判断和国际化，`message` 适合开发调试或中文提示。

## 3.11 一次请求经过的完整路径

以“读取自己的聊天历史”为例：

```text
浏览器
  GET /api/chat/sessions
  Cookie 自动携带用户会话
        ↓
Express app.ts
  helmet -> API 限流 -> JSON/Cookie -> 日志
        ↓
authMiddleware
  对 Cookie 做 SHA-256
  在 auth_sessions 表中查 token_hash
  检查会话是否过期、是否被撤销
  从 users 表加载用户并挂到 req.user
        ↓
requireUser
  确认会话种类是 user，状态正常
        ↓
chat route
  db.getChatSessions(req.user.id)
        ↓
SQLite
  SELECT ... WHERE user_id = ?
        ↓
route 转成 PublicChatSession
        ↓
JSON 返回浏览器
```

这里最重要的安全原则是：

> 会话身份来自服务端根据 Cookie 查到的事实，不信任前端的 `userId` 参数。

聊天 schema 中甚至使用 `z.never().optional()` 明确拒绝 `userId`，避免旧客户端继续传客户端身份。

## 3.12 为什么会话既在 Cookie 里又在数据库里

服务端会话通常这样设计：

- 浏览器 Cookie 只保存随机令牌，例如 `abc...`。
- 数据库保存令牌的 SHA-256 哈希、用户 ID、过期时间和 CSRF 哈希。
- 每次请求，服务端哈希 Cookie 中的令牌再查数据库。

**为什么不直接保存用户 ID 在 Cookie**：用户可以修改 Cookie。只保存随机不可猜令牌，真正身份在服务端查表，更安全。

**为什么不保存明文令牌哈希以外的内容**：数据库如果泄露，攻击者不能直接拿哈希当 Cookie，因为服务端会对 Cookie 再做一次哈希，结果不相等。

**SHA-256**：Secure Hash Algorithm 256-bit，安全哈希算法 256 位版本。它是单向摘要，不适合保存密码，但适合做高熵随机令牌的索引哈希。

## 3.13 环境变量和配置

**Environment Variable**：环境变量。由操作系统或 Docker 在启动进程时传入，不写死在代码里。

**为什么**：

- 开发、测试、生产使用不同配置。
- 密钥不能提交到 Git。
- 同一镜像可以靠不同环境配置部署。

`server/config.ts` 使用 dotenv：

- 开发时读取 `.env.local`，再读取 `.env`。
- 生产容器由 Compose 的 `env_file` 和 `environment` 注入。
- 缺少关键配置时拒绝启动。

关键变量：

| 变量 | 作用 |
|---|---|
| `NODE_ENV` | development、test 或 production |
| `PORT` | 后端监听端口 |
| `DATA_DIR` | SQLite、上传素材、备份根目录 |
| `APP_ORIGIN` | 正式访问来源，用于 Cookie 和 CSRF |
| `APP_ENCRYPTION_KEY` | 加密 TOTP 密钥和 LLM API Key |
| `ADMIN_PHONE` | 管理员登录账号 |
| `ADMIN_PASSWORD` | 管理员登录密码 |
| `ADMIN_MFA_ENABLED` | 是否启用 TOTP |
| `ADMIN_SECOND_PASSWORD` | 可选的第二重安全码 |
| `TRUST_PROXY` | 是否信任反向代理的客户端 IP 头 |
| `ALLOW_INSECURE_HTTP` | 是否允许没有 HTTPS 的内测模式 |
| `SENTRY_DSN` | Sentry 上报地址 |
| `HEALTHCHECK_PING_URL` | 外部健康检查地址 |
| `RESTIC_*` | 异地备份配置 |

**TRUST_PROXY 为什么危险**：限流通常按客户端 IP 分桶。反向代理会通过 `X-Forwarded-For` 告诉后端真实 IP，但如果服务是公网直连却信任这个头，攻击者可以每次伪造不同 IP，绕过限流。

**APP_ORIGIN 为什么不只是显示地址**：写请求会对比 `Origin`。域名、协议或端口写错，登录后的 POST 可能全部被 CSRF 拒绝。

---

# 第 4 章：认证、授权与 Web 安全

安全不是开发完成后的“补丁”，而是每一条数据流都要问的问题：

- 谁在发起请求？
- 他声称自己是谁？
- 服务端凭什么相信？
- 他有没有权限做这件事？
- 数据在传输和存储时是否保密？
- 请求太频繁会不会拖垮系统？
- 出错信息会不会泄露内部秘密？

## 4.1 认证与授权不是一回事

**Authentication**：认证，回答“你是谁”。

**Authorization**：授权，回答“你能做什么”。

例如：

- 用户输入密码并建立会话，是认证。
- 普通用户请求管理员接口被拒绝，是授权。
- 登录成功但会员过期，不能使用高等级额度，也是业务授权或权益判断。

本项目通过 `requireUser` 检查用户会话，通过 `requireAdmin` 检查管理员会话和角色。

## 4.2 密码为什么不能明文保存

如果数据库保存：

```text
password = "MySecret123"
```

一旦数据库备份泄露、服务器被入侵或管理员误导出，所有用户密码立刻暴露。用户常在多个网站复用密码，后果会扩散。

### Hash、加密和编码的区别

| 概念 | 英文 | 能否还原 | 本项目用途 |
|---|---|---|---|
| 编码 | Encoding，如 Base64 | 可以，只是换表示形式 | 传输二进制数据 |
| 加密 | Encryption | 有密钥时可还原 | 保护 LLM API Key、TOTP secret |
| 哈希 | Hashing | 设计上不可逆 | 保存密码和令牌摘要 |

**重要**：Base64 不是加密。它只是编码，任何人都能解码。

## 4.3 bcrypt 密码哈希

**英文全称**：bcrypt。名字由 Blowfish 的 “b” 和 crypt 组成。

**是什么**：专门为密码保存设计的自适应哈希算法。

**历史**：1999 年由 Niels Provos 和 David Mazières 设计，基于 Blowfish 分组密码。

它做三件重要的事：

1. 加入随机 Salt，避免相同密码得到相同哈希。
2. 加入 cost factor，计算成本可随硬件变强而增加。
3. 每次验证都需实际计算，攻击者不能从哈希反推出唯一原密码。

**Salt**：盐，随机数据，与密码一起哈希。它让攻击者不能预先建立“常见密码 -> 哈希”的总表，也避免两个相同密码在数据库中一眼可见。

**Cost Factor**：成本因子，控制计算轮数。成本每加 1，计算量约翻倍。项目使用 `BCRYPT_ROUNDS`，并考虑登录并发和 2 核服务器性能。

**为什么不用 SHA-256 存密码**：SHA-256 太快，适合校验高熵令牌，不适合低熵人类密码。攻击者每秒可以尝试几十亿次。bcrypt 每次计算更昂贵，提高了离线爆破成本。

### 本项目的密码流程

1. 管理员创建用户。
2. 服务端随机生成 16 字符临时密码。
3. 临时密码只返回一次，管理员线下交给用户。
4. 用户首次登录时，服务端只发短期改密挑战，不直接创建长期会话。
5. 用户提交当前临时密码和新密码。
6. 服务端验证挑战、验证当前密码、检查新密码策略、不能与旧密码相同。
7. 新密码用 bcrypt 哈希保存。
8. 撤销旧会话，建立正式用户会话。

**挑战票据**：Challenge，短时间有效、一次使用的凭据。它用于“第一阶段已通过，但还差一个步骤”的流程。

## 4.4 登录失败限制

本项目：

- 连续失败 5 次后锁定 15 分钟。
- 登录接口本身也有限流。
- 登录失败时返回通用信息，避免直接告诉攻击者“手机号存在但密码错误”。
- bcrypt 比较前和保存结果前复检锁定状态，防止并发请求绕过计数。

**为什么需要并发复检**：如果 100 个请求同时读到“失败次数 0”，然后都继续计算密码，最后可能一次窗口尝试远超 5 次。需要在最终写库前重新检查。

## 4.5 Session 与 JWT

**Session**：会话。

**是什么**：服务端保存一段身份状态，浏览器只保存随机会话 ID。

**JWT**：JSON Web Token，JSON 网络令牌。

**是什么**：一种把声明数据签名后放在客户端携带的令牌。服务端可通过签名校验其真实性，通常不必每次查会话表。

本项目明确选择服务端 Session，而不是 localStorage JWT：

1. 浏览器保存随机 Session token，放在 HttpOnly Cookie。
2. 数据库 `auth_sessions` 保存 token 的 SHA-256 哈希。
3. 服务端能即时撤销会话，例如用户改密、禁用、删除或退出。
4. 前端 JavaScript 读不到 HttpOnly Session Cookie。

**为什么不用 localStorage JWT**：localStorage 可被任意同源 JavaScript 读取，一旦 XSS 成功，令牌容易被窃取。JWT 若没有额外黑名单，也很难即时撤销。

Session 的代价是每次请求可能查数据库；本项目的 SQLite 单机场景完全可以承受，而且换来了更直观的撤销能力。

## 4.6 Cookie 的三个安全属性

### HttpOnly

设为 true 后，JavaScript 不能通过 `document.cookie` 读取。它不能阻止请求自动携带，但能减少 XSS 直接偷会话。

### Secure

设为 true 后，浏览器只在 HTTPS 请求中发送。生产环境默认开启。

**为什么内测 HTTP 要关闭**：浏览器不会把 Secure Cookie 通过普通 HTTP 发回服务器，表现为“登录成功但马上掉线”。

### SameSite

控制跨站请求是否携带 Cookie：

- `Strict`：跨站请求不携带，最严格。
- `Lax`：顶层导航等部分场景携带。
- `None`：允许跨站，但必须 Secure。

本项目使用 `SameSite=Strict`，进一步降低 CSRF 风险。

## 4.7 CSRF 是什么

**CSRF**：Cross-Site Request Forgery，跨站请求伪造。

**攻击想象**：

1. 用户已登录 `bank.example`。
2. 用户打开恶意网站。
3. 恶意网站偷偷向 `bank.example` 发转账请求。
4. 浏览器可能自动带上 bank 的 Cookie。
5. 服务器如果只看 Cookie，就误以为这是用户自愿操作。

**命名逻辑**：攻击者伪造用户发起的跨站请求。

**历史背景**：随着 Cookie 自动携带和 Web 表单普及，CSRF 在 2000 年代成为常见 Web 风险。

本项目多层防御：

- Cookie 使用 `SameSite=Strict`。
- 写请求校验 `Origin` 是否等于 `APP_ORIGIN`。
- 登录后下发 CSRF Token。
- 前端把 Token 放进 `X-CSRF-Token`。
- 服务端同时验证请求头 Token 和可读 CSRF Cookie，再与数据库会话中的 CSRF 哈希比较。
- 登录、首次改密和 MFA 等必须免登录的端点做明确豁免。

**为什么不能只靠 SameSite**：浏览器版本、历史行为、代理和业务需求可能变化。Origin 校验和 Token 提供额外防线。

## 4.8 XSS 是什么

**XSS**：Cross-Site Scripting，跨站脚本攻击。

**为什么缩写不是 CSS**：CSS 已被 Cascading Style Sheets 占用，安全领域为避免混淆，改用 XSS，X 表示 cross。

**攻击方式**：攻击者让恶意 JavaScript 在受害者浏览器、目标网站的同源环境里执行。

常见来源：

- 用户输入未转义就插入 HTML。
- 富文本或 Markdown 允许危险标签。
- 第三方脚本被入侵。
- 直接使用 `dangerouslySetInnerHTML`。

本项目：

- React 默认会把文本视为文本，不执行其中的 HTML。
- AI 回答用 `react-markdown` 渲染，并且需要依赖其安全默认值和 CSP 限制。
- Helmet 设置 Content Security Policy。
- 会话 Cookie 使用 HttpOnly，降低 Session 被盗后的直接危害。

**CSP**：Content Security Policy，内容安全策略。通过响应头规定可执行脚本、可连接地址和可加载图片来源。

## 4.9 限流与暴力破解

**Rate Limiting**：限流。

本项目有多个层级：

- 全局 `/api`：每分钟 300 次。
- 聊天：每分钟 30 次。
- 生成问题：每分钟 10 次。
- 用户登录、改密、管理员登录都有更严格限制。
- `/assets` 单独限制，防止匿名资源被滥用。

**为什么需要多层**：全局限流防止总体滥用，专项限流保护昂贵操作。聊天还会调用付费大模型，登录和 MFA 还涉及密码猜测。

**限流键通常是 IP**。因此 `TRUST_PROXY` 必须与部署拓扑一致，否则：
- 代理后不信任代理头，所有用户可能共用一个 IP 桶。
- 直连却信任伪造头，攻击者可以伪造 IP 绕过桶。

## 4.10 Helmet 与安全响应头

**Helmet** 不是缩写，是 Express 的安全中间件包，名称比喻给应用“戴上头盔”。

它统一设置安全头：

- Content-Security-Policy。
- Strict-Transport-Security。
- X-Content-Type-Options。
- Referrer-Policy。
- 禁止页面被嵌入 iframe 等。

**HSTS**：HTTP Strict Transport Security，HTTP 严格传输安全。浏览器记住某个域名以后必须使用 HTTPS，防止降级攻击。

**为什么开发环境要放宽 CSP**：Vite 开发时注入内联脚本和 WebSocket HMR。严格 CSP 会让开发页面白屏。生产构建没有这些内联需求，所以策略更严格。

## 4.11 TOTP、MFA 与恢复码

**TOTP**：Time-based One-Time Password，基于时间的一次性密码。

**是什么**：认证器 App 和服务器共享一个密钥，用当前时间窗口和密钥计算 6 位数字。30 秒或一段时间后变化。

**标准**：TOTP 定义在 RFC 6238，建立在此前的 HOTP（HMAC-based One-Time Password，基于哈希消息认证码的一次性密码）思想之上。

**MFA**：Multi-Factor Authentication，多因素认证。

“因素”通常分三类：

1. 你知道的：密码、安全码。
2. 你拥有的：手机认证器、硬件密钥。
3. 你本身：指纹、面容。

管理员密码 + TOTP 属于“知道 + 拥有”两因素。

**本项目管理员流程**：

1. 检查管理员手机号和密码。
2. 若尚未绑定 TOTP，创建短期 `admin_mfa_setup` 挑战。
3. `/mfa/setup` 生成 Base32 secret、otpauth URI 和 8 个恢复码。
4. 用户扫码或手工输入密钥。
5. `/mfa/confirm` 用一次正确 TOTP 确认绑定。
6. 后续登录用 `/mfa/verify`。
7. 管理员会话固定 8 小时，不滚动续期。

**Base32**：一种用 32 个字符表示二进制数据的编码，方便认证器二维码/手工输入。它是编码，不是加密。

**恢复码**：一次性备用码。数据库只保存 HMAC 哈希，不保存明文。使用时找到匹配项并立即从可用列表删除。

**第二重口令**：可选的安全码，不与 TOTP 强绑定。它是另一个“你知道的东西”，通常与 TOTP 二选一；同时开启时两者都要通过。

## 4.12 加密与哈希在本项目中的分工

`server/services/security.ts` 使用：

| 工具 | 用途 |
|---|---|
| `crypto.randomBytes` | 生成高熵随机令牌 |
| `crypto.randomInt` | 无偏随机整数，生成用户 ID 和临时密码 |
| SHA-256 | 对高熵会话令牌建立数据库查找摘要 |
| HMAC-SHA256 | 对恢复码做带密钥摘要 |
| AES-256-GCM | 加密 LLM API Key 和 TOTP secret |
| bcrypt | 哈希用户和管理员密码 |

**AES**：Advanced Encryption Standard，高级加密标准。

**GCM**：Galois/Counter Mode，一种认证加密模式，既保密又能发现密文被篡改。

**HMAC**：Hash-based Message Authentication Code，基于哈希的消息认证码。它需要密钥，能验证数据来源和完整性。

**为什么恢复码用 HMAC 而不是普通 SHA-256**：恢复码虽然随机，但仍是“需要验证的秘密”。带服务端密钥的 HMAC 让数据库泄露者没有 `APP_ENCRYPTION_KEY` 时更难批量利用。

**为什么 API Key 可逆加密**：后端调用外部模型时必须拿到明文 API Key，因此不能哈希，只能加密。`APP_ENCRYPTION_KEY` 一旦丢失，已有密文就无法恢复。

## 4.13 最小权限与不泄露原则

优秀后端遵守：

- 能匿名看的接口才匿名。
- 聊天、会话、配额必须登录。
- 后台全部接口必须管理员会话和 CSRF。
- 返回用户资料时移除密码字段。
- 返回公开技能时移除 `systemPrompt`。
- 管理员读取 LLM 配置时不返回明文 API Key，只返回“是否已配置”。
- 日志不记录密码、Cookie、API Key 和完整敏感正文。
- 错误响应给用户可理解的提示，但详细堆栈写给日志或 Sentry。

`PublicSkill` 与隐藏 `systemPrompt` 是本项目非常重要的数据边界：管理员需要编辑内部提示词，普通用户不应拿到它。

## 4.14 安全练习

对下面每个请求，先判断它应该返回 200、401、403、404、409 还是 423，再到 `tests/api.test.ts` 或源码验证：

1. 未登录用户读取 `/api/chat/sessions`。
2. 普通用户读取 `/api/admin/stats`。
3. 用户 A 删除用户 B 的会话。
4. 用户请求中手工加入另一个人的 `userId`。
5. 已登录用户 POST 请求不带 CSRF Token。
6. 普通用户读取 `/api/skills/free`。
7. 管理员读取 LLM 配置。

关键结论：

- 未登录通常是 401。
- 已登录但权限不足通常是 403。
- 资源不存在或无权限看到通常用 404 隐藏存在性。
- 前后端都做检查，但后端才是最终防线。

---

# 第 5 章：数据库是怎样保存世界的

## 5.1 数据库、DBMS 与 SQL

**Database**：数据库，有组织地保存数据的集合。

**DBMS**：Database Management System，数据库管理系统。SQLite、PostgreSQL、MySQL、SQL Server 都属于 DBMS。严格说，日常说的“数据库”有时混合指数据本身和软件。

**RDBMS**：Relational Database Management System，关系型数据库管理系统。它把数据组织成表（Table）、行（Row）和列（Column）。

**SQL**：Structured Query Language，结构化查询语言。

**历史**：IBM 研究员 Edgar F. Codd 在 1970 年提出关系模型。IBM 在 1970 年代开发 System R，后来 SQL 成为关系数据库的通用查询语言，并在 1986 年左右形成 ANSI/ISO 标准。

**命名逻辑**：SQL 通常读作 “S-Q-L” 或 “sequel”。它描述的是“查询语言”，但后来也承担插入、更新、删除和结构定义。

## 5.2 表和电子表格有什么区别

表面上看，数据库表很像 Excel：

```text
users 表
+------+--------+-------+
| id   | phone  | tier  |
+------+--------+-------+
| usr1 | 138... | free  |
| usr2 | 139... | month |
+------+--------+-------+
```

本质区别：

- 数据库有严格类型、约束和索引。
- 多客户端可并发访问。
- 支持事务原子性。
- 可以通过外键维护关系。
- 可以按条件高效查询。
- 有权限和日志机制。

## 5.3 主键、外键、唯一约束与索引

### Primary Key / 主键

唯一标识一行。例如 `users.id`。

**要求**：非空、唯一。项目大量使用字符串 ID，如 `usr_xxx`、`skill-xxx`，方便排查和避免自增 ID 泄露业务规模。

### Foreign Key / 外键

让一张表引用另一张表的行。例如：

```sql
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
```

**ON DELETE CASCADE** 表示删用户时自动删除他的聊天会话。项目初始化时执行 `PRAGMA foreign_keys = ON`，SQLite 才会真正执行外键规则。

**为什么不能只靠应用代码维护关系**：应用可能漏写分支。外键是数据库层的最后约束。

### UNIQUE / 唯一约束

例如 `users.phone`、`orders.trade_no` 和 `quota_ledger.request_id` 不能重复。重复创建账号或重复扣额度会直接失败。

### Index / 索引

**是什么**：帮助数据库快速找到数据的数据结构。多数关系库使用 B-tree 或变体。

**类比**：在一本 1000 页的书里按关键词找内容，没有索引要逐页翻；有索引可先查关键词对应的页码。

**代价**：

- 占用磁盘。
- 插入、更新时要同步维护。
- 不合适的索引反而拖慢写操作。

本项目索引包括：

- 用户手机号、状态、会员等级和活跃日期。
- 技能分类与热度。
- 会话 `user_id + updated_at`。
- 会话令牌 subject、过期时间。
- 挑战过期时间。
- 配额用户和创建时间。
- 审计创建时间。
- 订单交易号、用户和状态。

**一条重要原则**：索引建立在“经常筛选、排序、连接”的列上，不是字段越多越好。

## 5.4 事务与 ACID

**Transaction**：事务，一组要么全部成功、要么全部失败的操作。

**ACID**：

- Atomicity，原子性：全做或全不做。
- Consistency，一致性：不能留下破坏约束的半成品状态。
- Isolation，隔离性：并发事务之间的影响受规则控制。
- Durability，持久性：提交后即使崩溃也应保存。

### 额度预占例子

一次聊天需要：

1. 读取用户当前额度。
2. 检查是否超过上限。
3. `daily_used_count + 1`。
4. 插入一条账本记录。

如果第 3 步成功、第 4 步失败，就会出现“额度扣了但没有账”。项目用 `better-sqlite3` 的 transaction 包成一个原子操作：

```ts
const tx = this.db.transaction(() => {
  // 检查、更新计数、插入账本
});
return tx();
```

大模型成功返回后，把账本从 `reserved` 改成 `consumed`。模型失败时改成 `refunded`，并按当前周期条件回退用户计数。

**为什么账本要单独存在**：只保存一个数字无法解释每次扣减；账本记录可实现排查、幂等和审计。`request_id UNIQUE` 防止同一次请求重复预占。

## 5.5 SQLite 是什么

**英文全称**：SQLite，名字由 SQL 和 Lite 组成，Lite 表示轻量。

**是什么**：嵌入式关系数据库。严格说它是一个库，不是独立数据库服务器进程。

**作者与历史**：D. Richard Hipp 在 2000 年发布 SQLite，最初用于无需独立数据库服务器的软件场景。

**为什么适合本项目**：

- 单机、单应用实例。
- 不需要单独部署数据库服务。
- 数据库就是一个文件，备份和迁移直观。
- better-sqlite3 同步 API 简单，读操作快。
- 事务足以保护用户、会话和配额等小规模数据。

**和 PostgreSQL/MySQL 的区别**：

| 方面 | SQLite | 传统客户端/服务器数据库 |
|---|---|---|
| 部署 | 嵌入应用，一个文件 | 独立进程/服务 |
| 扩展 | 适合单机和中小规模 | 更适合多实例和大规模并发 |
| 运维 | 简单 | 需要连接池、备份、权限等 |
| 网络访问 | 通常本地文件 | 多客户端通过网络访问 |
| 当前项目 | 正确选择 | 尚未需要 |

**当前边界**：SQLite 单文件架构不适合同一数据库挂到多个应用副本。未来要水平扩容，需要评估 PostgreSQL、Redis 和对象存储。

## 5.6 better-sqlite3 不是 ORM

**better-sqlite3** 是 Node.js 的 SQLite 驱动。

**ORM**：Object-Relational Mapping，对象关系映射。

ORM 会把 JavaScript 对象映射成数据库表和 SQL，例如 Prisma、TypeORM、Sequelize。

本项目没有用 ORM，而是：

- 在 `server/db.ts` 显式写 SQL。
- 用 `prepare()` 预编译语句。
- 用参数 `?` 传入值。
- 手工把 snake_case 数据库行映射成 camelCase TypeScript 对象。

**优点**：SQL 清楚、依赖少、行为可控。

**缺点**：当表和查询很多时，`db.ts` 会变大，需要按领域拆分 repository，并建立更完整的迁移体系。

## 5.7 参数化 SQL 与 SQL 注入

错误写法：

```ts
const sql = `SELECT * FROM users WHERE phone = '${phone}'`;
```

如果用户输入 `' OR 1=1 --`，SQL 含义可能被改变。这就是 **SQL Injection**（SQL 注入）。

正确写法：

```ts
db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
```

数据库把参数当作数据，而不是 SQL 语法。

**为什么叫注入**：攻击者把恶意 SQL 语法“注入”到原本的查询字符串中。

本项目几乎所有外部值都通过 `?` 参数传入。即使有 TypeScript 类型，运行时也仍然需要参数化，因为类型不会阻止字符串内容中的 SQL 字符。

## 5.8 SQLite 的 WAL 模式

**WAL**：Write-Ahead Logging，预写式日志。

普通模式下，写入可能阻塞读取。WAL 先把修改写到 `-wal` 文件，读者可以继续读取旧的一致快照，提交后再由 checkpoint 合并回主数据库。

本项目初始化：

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
```

含义：

- WAL：提高读写并发。
- synchronous=NORMAL：WAL 下仍有崩溃安全，但减少每次提交的磁盘同步成本。
- busy_timeout：遇到写锁等待最多 5 秒，而不是立即报 database is locked。
- foreign_keys：启用外键约束。

你会看到：

```text
data/commercial.sqlite
data/commercial.sqlite-wal
data/commercial.sqlite-shm
```

它们不是三份重复数据库：

- `.sqlite`：主数据库。
- `-wal`：尚未 checkpoint 的提交记录。
- `-shm`：WAL 索引共享内存文件。

**备份不能只随便复制主文件**，因为可能有未合并的 WAL 内容。项目用 SQLite `.backup` 命令生成一致性备份，再校验 `PRAGMA integrity_check`。

## 5.9 项目数据库总览

数据库文件：

```text
data/commercial.sqlite
```

初始化在 `server/db.ts`：

1. 创建 DATA_DIR、assets、backups 目录。
2. 打开数据库。
3. 设置 WAL、同步模式、超时和外键。
4. 检查 schema_migrations。
5. 创建表和索引。
6. 迁移明文秘密。
7. 写入初始技能和默认配置。

### `schema_migrations`

记录已经应用的结构版本。当前主要处理版本 1，并在发现旧表结构时把旧表改成 `*_legacy_v1`，再创建新表。

**Migration**：数据库迁移，指结构随版本变化时安全升级已有数据。成熟系统通常每个版本一个 migration 文件，本项目当前较简化。开发新表或修改字段时，不能只改 `CREATE TABLE IF NOT EXISTS` 就假设旧库会自动变化，需要明确迁移逻辑。

### `users`

保存普通账号：

| 字段组 | 内容 |
|---|---|
| 身份 | id、phone、password_hash、nickname、avatar |
| 权限 | role、status |
| 会员 | membership_tier、membership_expires_at |
| 配额 | must_change_password、daily_max_chats、daily_used_count、last_active_date、last_active_month |
| 安全 | failed_login_attempts、locked_until、last_login_at |
| 生命周期 | created_at、updated_at、deleted_at |

管理员不在 users 表，而是由环境变量构建固定管理员身份。这样做简化了管理员账号管理，也意味着管理员密码和 MFA 安全性高度依赖环境变量及 `admin_security` 表。

### `skills`

保存书籍或导师技能：

- `system_prompt`：内部系统提示词，不公开。
- `sample_questions`：JSON 字符串数组。
- `tags`：JSON 字符串数组。
- `chat_count`：聊天使用次数。
- `search_count`：热度或浏览点击次数。
- `skill_type`：`book` 或 `mentor`。

### `chat_sessions`

保存一段聊天：

- 所属 `user_id`。
- 技能快照 `skill_id`、标题、作者、封面。
- `messages`：JSON 字符串，里面是消息数组。
- 创建和更新时间。

**为什么不单独建 messages 表**：

- 当前每次读取通常按整个会话使用。
- 保存一个 JSON 数组比多表连接简单。
- 小规模场景性能足够。

**代价**：

- 不能方便地按单条消息查询和统计。
- 大对话会变大。
- JSON 内字段没有数据库约束。
- 并发编辑同一会话时容易覆盖。

这是一种 denormalization（反规范化）或文档式存储方式。简单不等于错误，但要明确它的适用边界。

### `orders`

项目已定义订单表，包括交易号、用户、会员方案、金额、支付方式、状态等，但当前业务没有在线支付和退款。现阶段主要是数据结构和后台占位能力，不能把“有表”误认为“支付已实现”。

### `system_config`

键值配置表。当前重要键：

- `tags`：标签 JSON。
- `llm_config`：模型地址、模型名、额度和协议等 JSON。

**Key-Value** 结构灵活，适合少量全局配置。缺点是 JSON 字段缺少数据库级约束，不能像普通列一样建立复杂索引。管理员保存时，后端会合并、清洗并特殊处理敏感 API Key。

### `auth_sessions`

服务端登录会话：

- `token_hash`：Cookie 令牌的 SHA-256。
- `subject_type`：user 或 admin。
- `subject_id`：用户 ID 或 admin。
- `csrf_hash`：CSRF Token 的哈希。
- `auth_version`：管理员凭据版本，用于改密码后立即失效。
- `expires_at`、`last_seen_at`、`revoked_at`。
- IP、User-Agent 等审计上下文。

### `auth_challenges`

短期挑战：

- 首次登录改密。
- 管理员 MFA 设置。
- 管理员 MFA 验证。

特点：一次性、有期限、只保存 token 哈希。

### `admin_security`

保存管理员 TOTP 和恢复码数据：

- 正式加密 secret。
- 是否启用。
- 恢复码 HMAC 哈希。
- 待确认的 pending secret 和恢复码。
- `auth_version`。

### `quota_ledger`

AI 额度账本：

- `request_id UNIQUE`：请求幂等。
- `period_key`：日或月周期。
- `status`：reserved、consumed、refunded。
- 创建与结算时间。

### `audit_logs`

审计日志：

- 谁做了什么。
- 操作目标。
- 附加元数据。
- IP 和 User-Agent。
- 时间。

**Audit Log** 不是普通调试日志。它重点记录敏感操作的追责线索，例如账号状态变更、配额或管理配置修改。

## 5.10 SQL 的四个基本动作

**CRUD**：Create、Read、Update、Delete，创建、读取、更新、删除。

```sql
INSERT INTO users (...) VALUES (...);
SELECT * FROM users WHERE id = ?;
UPDATE users SET status = ? WHERE id = ?;
DELETE FROM users WHERE id = ?;
```

项目还使用 **UPSERT**：

```sql
INSERT INTO skills (...) VALUES (...)
ON CONFLICT(id) DO UPDATE SET ...;
```

意思是：不存在就插入，存在就按主键更新。`saveUser`、`saveSkill`、`saveChatSession` 都使用这种模式。

**UPSERT 的历史**：它是 “UPDATE or INSERT” 的合成词。不同数据库语法略有不同，SQLite 从较新版本开始支持 `ON CONFLICT`。

**风险**：如果调用方把错误对象的主键传进来，UPSERT 可能覆盖已有行。聊天路由因此特别检查会话所属用户，不能仅凭 sessionId 直接覆盖。

## 5.11 时间与金额

项目大量使用 ISO 8601 时间字符串，例如：

```text
2026-09-18T07:30:00.000Z
```

末尾 `Z` 表示 UTC（Coordinated Universal Time，协调世界时）。ISO 8601 是国际标准化组织制定的日期时间表示标准。

部分 SQLite 默认 `datetime('now')` 使用 UTC 风格。

生产 Compose 设置：

```yaml
TZ: Asia/Shanghai
```

因为“每日额度零点刷新”的业务含义按北京时间计算。代码中的本地日期函数会按服务器时区生成 `YYYY-MM-DD`。

**金额**：订单表把金额定义为 `REAL`。SQLite 的 REAL 是浮点数，真实支付系统通常不应直接用浮点数保存金额，最好用最小货币单位整数（例如分）或精确十进制类型。当前项目没有在线支付，属于待演进边界。

## 5.12 备份、一致性与恢复

备份不是“复制一份文件就完事”。必须回答：

- 备份是否覆盖 WAL 中的最新提交？
- 备份文件是否损坏？
- 能否在另一台机器恢复？
- 恢复需要多久？
- 备份本身是否加密和异地保存？

本项目：

- `scripts/backup.sh` 用 SQLite `.backup` 生成一致副本。
- 执行 `PRAGMA integrity_check`。
- 打包数据库和 assets。
- 如果配置 restic，再上传到 S3 兼容对象存储。
- 默认每日备份、保留 30 天。
- `scripts/restore.sh` 恢复数据库和素材。
- `scripts/verify-backup.sh` 检查备份。

**RPO**：Recovery Point Objective，恢复点目标。允许最多丢多少时间数据；本项目目标 24 小时。

**RTO**：Recovery Time Objective，恢复时间目标。故障后多久恢复；本项目目标 4 小时。

## 5.13 数据库练习

在不改动原数据库的前提下，可以复制 `data/commercial.sqlite` 到临时目录，再用 sqlite3 只读观察：

```bash
sqlite3 data/commercial.sqlite ".tables"
sqlite3 data/commercial.sqlite ".schema users"
sqlite3 data/commercial.sqlite "SELECT id, nickname, status, membership_tier FROM users LIMIT 5;"
```

如果只想理解原理，先不要执行任何 UPDATE 或 DELETE。你需要回答：

1. 一个用户和聊天会话靠哪个字段关联？
2. 删除用户为什么会删除会话？
3. 为什么 `phone` 要唯一？
4. 为什么额度账本需要 request_id？
5. 为什么只复制 `.sqlite` 主文件可能遗漏 WAL 数据？

---

# 第 6 章：AI、大模型与流式对话

## 6.1 大模型不是普通数据库

**LLM**：Large Language Model，大语言模型。

**是什么**：通过大量文本训练出的参数化模型，能根据输入 token 序列预测下一个 token。

**Token**：词元。模型不一定按“字”或“单词”处理文本，而是先切分成 token。一个中文字可能占一个或多个 token，具体取决于模型分词器。

**Tokenizer**：分词器，把文本变成 token ID 的程序。

**参数**：模型中可学习的数值。参数越多，通常模型容量越大，但推理成本和显存需求也更高。

**为什么模型回答有概率性**：它根据概率分布选择下一个 token。即使问题相同，输出也可能不同。

**Temperature**：温度参数。较低通常更稳定、更保守；较高通常更随机、更有创造性。项目对非推理模型使用 `temperature: 0.7`。

**max_tokens**：限制模型最多生成多少 token，防止无限输出和不可控费用。

**Context Window**：上下文窗口。模型一次能看到的 token 总量，包括 system 提示、历史消息和当前问题。超出后必须截断、摘要或拒绝。

## 6.2 提示词的三种角色

发给大模型的 `messages` 通常分成：

| role | 作用 | 本项目 |
|---|---|---|
| system | 最高层行为规则和角色设定 | 技能的 `systemPrompt` |
| user | 用户提出的问题或指令 | 当前聊天输入 |
| assistant | 模型之前给出的回答 | 会话历史 |

**Prompt**：提示词或提示。它不只是“问题”，也包括角色、约束、背景和输出格式。

**System Prompt**：系统提示词。项目管理员可以为每本书或导师配置，用来定义它应如何回答。

**Prompt Engineering**：提示工程，设计提示以获得更符合目标输出的实践。它不是传统软件工程，效果会随着模型变化。

**Prompt Injection**：提示注入。用户在输入中试图覆盖系统规则，例如“忽略上面的要求”。仅靠提示词不能完全根治，高风险操作必须在代码层限制权限，而不能让模型自行决定是否转账、删数据或泄露秘密。

## 6.3 为什么由后端代理模型请求

流程：

```text
浏览器 -> 本项目后端 -> 外部模型服务
浏览器 <- 本项目后端 <- 外部模型服务
```

后端代理的原因：

1. **保护 API Key**：浏览器代码所有内容都能被查看，不能把密钥下发。
2. **统一鉴权**：先验证用户会话，再允许模型调用。
3. **统一配额**：防止用户绕过前端限制反复请求。
4. **过滤上下文**：只发送允许的消息和系统提示。
5. **统一错误处理**：把上游错误翻译成稳定的业务错误码。
6. **记录和审计**：可统计调用情况、延迟和故障。
7. **更换供应商**：前端不需要知道背后是 DeepSeek、DashScope 还是其他兼容接口。

**API Key**：用于调用服务商的秘密凭据。它应像密码一样保护。

## 6.4 “OpenAI 兼容接口”是什么意思

现代许多模型服务商提供类似 OpenAI Chat Completions 的 HTTP 接口：

```http
POST https://api.example.com/v1/chat/completions
Authorization: Bearer sk-...
Content-Type: application/json
```

请求体：

```json
{
  "model": "deepseek-chat",
  "messages": [
    { "role": "system", "content": "你是..." },
    { "role": "user", "content": "你好" }
  ],
  "stream": true
}
```

响应可能是标准 JSON，也可能在 `stream: true` 时持续返回 SSE 数据。

**为什么叫兼容**：接口形状接近 OpenAI，已有客户端或业务代码改少量 base URL 和模型名就能切换供应商。

本项目 `resolveOpenAIUrl()` 会把管理员填写的 base URL 补成 `/chat/completions`，并处理部分服务商不同路径习惯。

**Bearer**：HTTP Authorization 的一种方案，格式是 `Authorization: Bearer <token>`。Bearer 的意思是“持有者”，谁拿到令牌谁就能使用，因此必须保密。

**DSN**：Data Source Name，数据源名称。Sentry 的 DSN 用于告诉 SDK 将错误发送到哪里。

## 6.5 一次流式聊天请求的完整过程

### 第一步：前端提交

前端调用：

```text
POST /api/chat/stream
Cookie: book_answer_user_session=...
X-CSRF-Token: ...
```

正文：

```json
{
  "sessionId": "session-...",
  "skillId": "skill-...",
  "messageText": "这本书的核心观点是什么？",
  "requestId": "可选，用于幂等"
}
```

### 第二步：后端检查

`server/routes/chat.ts`：

1. `requireUser` 确认登录。
2. `chatLimiter` 检查每分钟频率。
3. Zod 校验长度和字段，拒绝客户端 `userId`。
4. `resolveSession()` 确认会话属于当前用户，避免覆盖别人的会话。
5. 读取技能。
6. 读取数据库中的模型配置，或回退到环境变量。
7. 检测 API Key 是否为空、过短或占位符。
8. 调用 `reserveQuota()` 预留一次额度。

### 第三步：准备上下文

`sanitizeMessagesForLLM()`：

- 加入技能 `systemPrompt`。
- 过滤非法 role 和空内容。
- 只保留最近 12 条有效历史消息。
- 避免把当前用户消息重复发送。
- 最后加入当前问题。

**为什么只取最近 12 条**：控制 token 成本并避免超过上下文窗口。代价是更早的对话被遗忘。成熟产品常用摘要或长期记忆解决。

### 第四步：调用上游模型

后端用 Node 的内置 `fetch()` 发送请求：

```ts
fetch(resolveOpenAIUrl(apiBaseUrl), {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify({ model, messages, stream: true }),
  signal: controller.signal,
});
```

`AbortController` 用于超时取消或客户端断开后停止上游请求，避免用户早已离开但服务器仍继续付费生成。

### 第五步：上游返回 SSE

上游可能一段段发送：

```text
data: {"choices":[{"delta":{"content":"这"}}]}

data: {"choices":[{"delta":{"content":"本书"}}]}

data: [DONE]
```

项目：

1. `getReader()` 逐块读取响应体。
2. `TextDecoder` 把字节流解码为字符串。
3. 用 buffer 处理“半行”数据，不能假设每次 read 都刚好是一条完整消息。
4. 找到以 `data:` 开头的行。
5. 跳过 `[DONE]`。
6. 解析 JSON，取 `delta.content` 或 `delta.reasoning_content`。
7. 拼接 `fullAssistantReply`。
8. 把 `{ delta, fullText }` 再以 SSE 发给浏览器。

### 第六步：结算并保存

- 如果完全没有回答：账本标记 `refunded`，发送 `AI_UNAVAILABLE`。
- 如果已有回答：账本标记 `consumed`，把 assistant 消息加入会话并保存。
- 最后发送 `{ done: true, assistantMessage, session, user }`。
- 关闭连接并释放 SSE 指标。

**为什么要有非流式 `/api/chat/send`**：它保留完整响应模式，便于测试、兼容或某些不支持流式的场景。当前主界面使用 `/api/chat/stream`。

## 6.6 SSE 协议细节

**英文全称**：Server-Sent Events。

SSE 的每条事件大致是：

```text
data: 文本
\n
\n
```

浏览器看到两个连续换行，才认为一条事件结束。

项目使用 `Content-Type: text/event-stream`，并设置：

- `Cache-Control: no-cache, no-transform`
- `Connection: keep-alive`
- `X-Accel-Buffering: no`

**为什么关闭缓冲**：Nginx 等中间层可能为了效率先累计一段数据再发送，导致用户看到“AI 卡很久后一次性吐一大段”。`X-Accel-Buffering: no` 是常用提示。

Caddy 配置中的：

```text
flush_interval -1
```

用于让反向代理立即刷新流式数据。

**SSE 与 WebSocket 对比**：

| 能力 | SSE | WebSocket |
|---|---|---|
| 方向 | 服务器到客户端为主 | 双向 |
| 协议 | HTTP 文本事件流 | 独立握手后全双工 |
| 复杂度 | 较低 | 较高 |
| 重连 | EventSource 可自动 | 需自己设计 |
| 本项目 | 使用 | 未使用 |

**WebSocket**：一种在浏览器和服务器之间建立持续双向通信通道的协议，2011 年标准化。聊天机器人若只需服务器持续推文字，SSE 更简单。

## 6.7 配额为什么先“预留”再“结算”

如果先调用模型，失败后再扣额度：

- 恶意用户可反复触发昂贵调用。
- 并发请求可能同时看到“还有额度”，导致超用。

如果先直接扣死，不考虑失败：

- 模型服务故障会让用户平白损失次数。

因此使用三态：

```text
reserved（已预留，不能再被其他请求使用）
   ├── 模型成功 -> consumed（已消费）
   └── 模型失败 -> refunded（已退款）
```

这是分布式/并发系统常用的“预留-确认”模式，英文可理解为 Reservation / Two-phase settlement。

会员额度逻辑：

- 免费会员按日限制。
- 付费会员按周期（当前主要按月/会员有效期）限制。
- 管理员不计入普通额度。
- 达到限制时，免费用户返回 `PAYWALL_REQUIRED`，付费用户返回 `VIP_LIMIT_REACHED`。

## 6.8 生成推荐问题

后台可为技能生成 3 至 4 个示例问题。`server/services/llm/questions.ts`：

1. 取当前系统提示词作为“原著资料”。
2. 要求模型输出严格 JSON 字符串数组。
3. 要求问题具体，不能是泛泛模板。
4. 设置 15 秒超时。
5. 解析 JSON；解析失败时尝试按行提取。
6. 仍失败就返回空数组，不生成伪造的离线模板。

**为什么不做假兜底**：如果模型不可用，宁可明确没有结果，也不应把伪造成“根据原著生成”的内容写给管理员。

## 6.9 模型调用常见故障

| 现象 | 可能原因 | 排查 |
|---|---|---|
| `AI_NOT_CONFIGURED` | API Key 缺失或像占位符 | 后台 LLM 配置 |
| HTTP 401/403 | Key 无效、权限不足 | 后台测试连接，检查服务商 |
| HTTP 404 | base URL 或路径不对 | 检查是否生成正确 `/chat/completions` |
| HTTP 429 | 上游限流或额度耗尽 | 查看服务商控制台 |
| 请求超时 | 网络、模型负载或回答过长 | timeoutSec、上游状态 |
| SSE 长时间无输出 | 上游未流式、代理缓冲 | 检查 Caddy、上游响应头 |
| 用户断开后仍计费 | 未传播取消信号 | 检查 AbortController |
| 回答被截断 | 最大 token 或超时 | maxTokens、timeoutSec |
| 历史遗忘 | 只取最近 12 条 | 摘要或长期记忆尚未实现 |

## 6.10 AI 练习：画出一次成功请求

在纸上画五列：

```text
浏览器 | Express | SQLite | DeepSeek | 回到浏览器
```

按顺序填入：

1. 发送 message。
2. 验证会话和 CSRF。
3. 查询会话、技能和额度。
4. 预留额度。
5. 保存用户消息。
6. 调用上游流式接口。
7. 接收 delta。
8. 服务端通过 SSE 转发。
9. 浏览器追加文字。
10. 结算并保存最终回复。

当你能够不看资料画出这条链，就已经掌握了本项目最核心的端到端数据流。

---

# 第 7 章：测试、类型检查与构建

## 7.1 为什么需要自动化检查

一个功能改动可能同时影响：

- 前端类型。
- 后端请求字段。
- 数据库写入。
- 安全策略。
- 多语言文案。
- 部署配置。

人工只点几遍页面容易漏。自动化检查的价值是：**把已经理解的规则写成机器能重复执行的证据**。

本项目提供：

```bash
npm run lint         # TypeScript 类型检查
npm test             # 自动测试
npm run build        # 生产构建
npm run verify       # 类型 + 测试 + 构建 + 依赖审计 + 配置检查
npm run config:check # 用隔离数据目录做启动配置检查
npm run load:test    # 压测健康检查接口
```

## 7.2 静态检查与类型检查

**Static Analysis**：静态分析，在不运行程序的情况下检查代码。

TypeScript `tsc --noEmit`：

- 检查类型错误。
- 不生成 JavaScript。
- 可发现拼写错误的字段、错误参数和空值使用。
- 不能发现所有业务错误，也不能替代运行时校验。

**Lint** 原意是衣服上的“线头”。早期 Unix 工具 lint 用来找 C 代码中像线头一样的小问题。后来泛指代码规范和质量检查。本项目 `npm run lint` 主要是类型检查。

## 7.3 单元测试、集成测试与端到端测试

**Unit Test**：单元测试。测试一个较小函数或模块，速度快，依赖通常用替身。

**Integration Test**：集成测试。测试多个模块协作，例如路由 + 中间件 + 数据库。

**End-to-End Test / E2E**：端到端测试。从真实界面或真实网络入口一路测到后端和数据。最接近用户，但最慢、最容易受环境影响。

**Test Double**：测试替身。测试中用假对象替代真实依赖。常见：

- Stub：返回固定结果。
- Mock：记录调用并预设行为。
- Fake：简化但可工作的实现，例如内存数据库。

本项目的 `tests/api.test.ts` 用 Supertest 直接请求 Express app，属于 API 集成测试。测试通过本地 mock HTTP 服务模拟模型上游，不调用真实 DeepSeek，不产生费用。

**Supertest**：Node 中用于测试 HTTP 服务的库，可以不用真的监听公网端口就发请求。

**Mock**：模拟对象或模拟服务。重点在于让测试可控、稳定、可重复。

## 7.4 Vitest

**Vitest**：基于 Vite 生态的测试运行器。

**为什么叫 Vitest**：Vite + Test，是品牌化命名。

API 测试覆盖的例子：

- 匿名用户访问聊天返回 401。
- 管理员必须 MFA。
- 创建用户时生成一次性临时密码。
- 用户首次登录必须改密。
- 登录后可读取自己的会话。
- 流式聊天可解析上游 SSE。
- 上游失败时返回错误且额度不增加。
- 伪造 userId 不能越权。
- 公开接口不暴露内部提示词。
- 管理员入口可达、未知 API 返回 404。

**为什么测试“失败后额度不增加”重要**：它验证的是跨模块的不变量：模型失败不能导致用户损失额度。

## 7.5 多语言测试

`tests/i18n.test.ts` 递归收集所有翻译键，验证：

- zh-CN、zh-TW、en 三种语言键一致。
- 没有空字符串。
- `{name}` 之类的占位符一致。

**为什么类型还不够**：开发者可能使用 `as any` 绕过类型，或者删掉某个译文。测试在运行层面再检查一次。

## 7.6 测试中的隔离

测试不应污染开发数据库。配置检查脚本会：

1. 设置 `NODE_ENV=test`。
2. 使用临时 `DATA_DIR`。
3. 建立数据库并执行 ping。
4. 输出配置摘要。
5. 关闭数据库。
6. 删除临时目录。

**Isolation**：隔离。好的测试不应依赖上次运行留下的数据，也不应修改真实生产数据。

## 7.7 构建过程

前端和后端分开构建：

```text
src/        --vite build-->        dist/
server/     --esbuild bundle-->    dist-server/server.cjs
```

生产容器随后只复制：

- `dist/`
- `dist-server/`
- `package.json` / lock 文件
- 生产依赖 node_modules

不复制源码、测试和开发依赖。

**Build Artifact**：构建产物。产物可以由源码重新生成，通常不手工修改。

**Minification**：压缩，例如缩短变量名、删除空白。它减少下载体积，但会让浏览器调试更难，所以需要 source map 或保留开发构建。

**Bundling**：打包，把多个模块合成较少文件，减少请求数量。

**Tree Shaking**：摇树优化，删除未被使用的导出代码。主要由打包器完成。

## 7.8 依赖安全审计

```bash
npm audit --omit=dev --audit-level=high
```

含义：

- 检查已知依赖漏洞。
- `omit=dev` 只关心生产依赖。
- 达到 high 级别时失败。

**为什么不只看自己写的代码**：现代应用大量依赖开源包，漏洞可能来自间接依赖。审计不是绝对保证，但能发现已知问题。

**SBOM**：Software Bill of Materials，软件物料清单，记录软件包含哪些组件。它是供应链安全实践，当前项目未生成完整 SBOM。

## 7.9 CI 与 CD

**CI**：Continuous Integration，持续集成。开发者每次提交代码后，自动运行检查和测试，尽早发现问题。

**CD**：

- Continuous Delivery，持续交付：自动准备好可发布版本，但上线可能需人工确认。
- Continuous Deployment，持续部署：通过检查后自动上线。

**历史**：持续集成思想来自 1990 年代极限编程实践。GitHub Actions 在 2018 年左右推出，使托管在 GitHub 的项目容易配置自动化。

本项目 `.github/workflows/ci.yml`：

- 推送 main 或 `feat/cloud-production` 时触发。
- Pull Request 时触发。
- Ubuntu runner。
- 安装 Node 22。
- `npm ci`。
- `npm run lint`。
- `npm test`。

当前 CI **只验证，不自动部署**。它属于持续集成，不是完整持续部署流水线。

**Pull Request / PR**：合并请求。开发者提出一组改动，团队审查并运行自动检查后再合并。

## 7.10 冒烟测试

**Smoke Test**：冒烟测试。

名称来自硬件行业：新设备第一次通电，先看会不会冒烟。软件中指部署后快速验证最关键路径是否基本可用。

本项目 `scripts/smoke.sh` 检查：

- 健康检查。
- 匿名访问受保护接口返回 401。
- 伪造 userId 仍被拒绝。
- 已移除接口返回 404。
- 管理后台入口可达。
- 管理登录、MFA、创建用户、清理测试用户等链路。

**为什么不能只看“服务启动成功”**：进程活着不代表数据库、Cookie、CSRF、登录和后台都工作。

## 7.11 负载测试

**Load Testing**：负载测试。模拟多个并发用户，观察吞吐、延迟和错误率。

**Autocannon** 是 Node.js 的高性能 HTTP 基准工具，名字借用“机炮”，表示快速连续发请求。

本项目默认：

- 50 个连接。
- 持续 30 秒。
- 默认压测 `/api/health`。

**重要边界**：压健康检查只证明 HTTP 和基本进程处理能力，不等价于真实聊天负载。真实模型调用涉及外部网络、SSE 长连接和付费，应该使用模拟上游或受控测试环境。

项目容量目标是 500 DAU、50 并发登录用户、10 条并发 SSE。

**DAU**：Daily Active Users，日活跃用户数。

## 7.12 软件质量的关键词

- **Correctness**：正确性，结果符合需求。
- **Reliability**：可靠性，持续正常工作的能力。
- **Availability**：可用性，服务可被访问的时间比例。
- **Latency**：延迟，一次操作耗时。
- **Throughput**：吞吐量，单位时间处理多少请求。
- **Scalability**：可扩展性，负载增加时如何扩容。
- **Maintainability**：可维护性，修改和理解的成本。
- **Observability**：可观测性，通过日志、指标、追踪理解系统内部状态。

**高可用（High Availability）** 和备份不是一回事。备份用于数据恢复；高可用用于故障时继续服务。本项目当前是单机架构，没有真正高可用。

## 7.13 练习：让一次改动经过完整质量门

选择一个只改文案的小任务，不要直接改代码。先写出计划：

1. 会改哪个前端文件？
2. 需要改三种语言吗？
3. 类型检查能否发现漏改？
4. 测试能否发现空翻译？
5. `npm run verify` 需要哪些步骤？
6. Git 提交后发现 CI 失败，该先看哪一步日志？

这个练习的关键不是执行改动，而是形成“改动影响范围”的思维。

---

# 第 8 章：从本机到云服务器

## 8.1 “本机运行”和“云上部署”差在哪里

本机开发：

```text
你的电脑
├── Node.js 进程
├── Vite 开发服务器
└── data/commercial.sqlite
```

云上生产：

```text
云服务器 VPS
├── Docker Engine
├── app 容器：Node + dist 前端 + dist-server 后端
├── Caddy 容器：HTTPS 与反向代理
├── Docker Volume：Caddy 证书和状态
└── 宿主机 ./data：SQLite、上传素材、本地备份
```

主要差别：

- 网络入口从 localhost 变成公网域名/IP。
- 必须考虑 HTTPS、服务器防火墙和云安全组。
- 密钥由环境变量注入，不能提交 Git。
- 服务崩溃后要自动重启。
- 数据库必须挂载到持久卷。
- 需要日志、监控、备份和恢复。
- 构建环境和运行环境要尽量一致。

## 8.2 VPS、云服务器与 IaaS

**VPS**：Virtual Private Server，虚拟专用服务器。它通常是在物理服务器上通过虚拟化分出的独立虚拟机，有一定 CPU、内存、磁盘和网络配额。

**IaaS**：Infrastructure as a Service，基础设施即服务。云厂商提供虚拟机、网络、存储等底层资源，用户自己管理操作系统和软件。

本项目部署文档假设单台 Linux VPS：

- 2 核 2 GB 内存是当前资源预算之一。
- Docker 运行应用和 Caddy。
- SQLite 数据在宿主机 `data/`。
- 没有 Kubernetes、集群或负载均衡。

**为什么不一开始就上 Kubernetes**：Kubernetes 解决多服务、多实例和大规模调度问题，同时带来巨大运维复杂度。当前系统目标是单机、简单、可恢复，YAGNI 原则要求不要提前引入猜测性的复杂架构。

## 8.3 Linux 与 SSH

**Linux**：开源操作系统内核，常见服务器发行版有 Ubuntu、Debian、Rocky Linux 等。本部署文档基于 Debian/Ubuntu 的 `apt` 包管理器。

**SSH**：Secure Shell，安全外壳协议。用于加密登录远程服务器。

常见操作：

```bash
ssh user@服务器IP
```

**为什么服务器常用 Linux**：稳定、开源、工具丰富、容器支持强、云厂商支持广。

**命名逻辑**：Shell 是命令解释器外壳；SSH 提供安全的远程 Shell。

**历史**：SSH 在 1995 年出现，取代会明文传输密码的 rlogin、Telnet 等工具。

## 8.4 云安全组与防火墙

**Security Group**：安全组，云平台层面的虚拟防火墙，控制哪些入站和出站流量允许到达实例。

**Firewall**：主机操作系统内的防火墙。安全组和主机防火墙可以同时存在。

典型规则：

- 允许 22：SSH，最好限制为自己的办公 IP。
- 允许 80：HTTP，Caddy 用于 ACME 校验和跳转。
- 允许 443：HTTPS，正式用户入口。
- 不直接开放 3000：让 3000 只走 Caddy 内部网络。

无域名内测模式需要开放 3000，且应尽量限制来源 IP，因为这是明文 HTTP。

## 8.5 域名、备案与 DNS

在中国大陆运营网站，若使用大陆服务器和公网域名，通常涉及 ICP 备案要求。备案不是代码或 DNS 技术本身，而是监管流程。具体规则会变化，必须以云厂商和当地要求为准。

部署前：

1. 购买域名。
2. 在 DNS 控制台添加 A 记录：域名 -> 服务器公网 IP。
3. 若使用 CDN 或负载均衡，按服务商要求配置 CNAME 等记录。
4. 等待 DNS 生效。
5. 让 Caddy 使用域名申请证书。

**A 记录**：把域名映射到 IPv4。
**AAAA 记录**：映射到 IPv6。
**CNAME**：把一个域名别名指向另一个域名。

## 8.6 Docker 是什么

**Docker** 是容器化平台和工具品牌。

**Container**：容器。把应用及其用户态依赖封装成隔离的运行环境。

**Image**：镜像。只读模板。容器是镜像的运行实例。

**Registry**：镜像仓库，例如 Docker Hub，用来保存和分发镜像。

**命名逻辑**：Docker 借用了码头装运集装箱的比喻。集装箱标准化后，不关心里面装什么都能运输；容器镜像让软件不依赖开发机环境。

### 容器与虚拟机的区别

虚拟机通常包含完整 Guest OS，启动较重：

```text
物理机 -> Hypervisor -> 每台 VM 内含完整 OS -> 应用
```

容器共享宿主 Linux 内核，隔离进程、网络、文件系统等：

```text
物理机/VM -> Linux 内核 -> 多个隔离容器
```

**技术基础**：

- Namespaces：命名空间，隔离进程、网络、挂载点等视图。
- cgroups：控制组，限制和管理 CPU、内存等资源。

**历史**：容器思想早于 Docker。Docker 在 2013 年由 dotCloud 团队（Solomon Hykes 等）推出，大幅降低了构建和分发容器的门槛。

**重要纠正**：容器不是虚拟机，不提供完整 Guest OS；容器边界也不会自动让应用绝对安全，仍需非 root、最小权限和镜像更新。

## 8.7 阅读 Dockerfile

本项目 `docker/Dockerfile` 是 multi-stage build（多阶段构建）：

### 构建阶段

```dockerfile
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts && node node_modules/esbuild/install.js
COPY . .
RUN npm run build
```

作用：

- 使用 Node 22 Debian Bookworm slim 镜像。
- 先复制 package 文件，让 Docker 缓存依赖安装层。
- `npm ci` 按锁文件安装。
- `--ignore-scripts` 避免 better-sqlite3 在无 Python 的 slim 镜像中执行 node-gyp 重建，因为 npm 包已有 Linux 预编译文件。
- 手工运行 esbuild 的安装脚本，因为它需要准备平台二进制。
- 复制源码并构建前端与后端。

**slim**：精简版基础镜像，体积更小，但可能缺少编译器或工具。
**node-gyp**：Node 原生扩展构建工具。
**prebuild**：预编译二进制，避免每次安装都现场编译。

### 运行阶段

```dockerfile
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
USER node
EXPOSE 3000
CMD ["node", "dist-server/server.cjs"]
```

作用：

- 重新使用干净镜像，不带构建工具和源码。
- 只安装生产依赖。
- 只复制构建产物。
- `USER node` 使用非 root 用户运行。
- 暴露 3000。
- 容器启动 Node 后端。

**为什么多阶段构建**：减少最终镜像体积和攻击面。编译需要开发工具，运行不需要。

**EXPOSE 是否等于开放公网端口**：不是。它只是元数据，真正映射由 Compose 控制。

## 8.8 .dockerignore 为什么重要

`.dockerignore` 类似 `.gitignore`，决定哪些文件不进入 Docker build context。

本项目忽略：

- `node_modules`：避免 Windows 二进制覆盖 Linux 容器依赖。
- `.git`：减小上下文。
- `.env*`：避免密钥进入镜像。
- `data`、SQLite、日志：不把运行数据烧进镜像。
- `dist`、`dist-server`：镜像内会自己构建。
- 真实 `Caddyfile`：只在部署时生成，防止域名等配置误入。

**Build Context**：执行 `docker build` 时发送给 Docker daemon 的目录集合。上下文越小，构建越快，泄密风险越低。

## 8.9 Docker Compose

**Docker Compose**：用 YAML 文件定义多个容器、网络、卷和依赖关系的工具。

**命名逻辑**：Compose 表示“组合”，把多个容器组合成一个应用。

本项目 `docker/compose.yaml` 有两个 service：

### app

- 从根目录和 Dockerfile 构建。
- `restart: unless-stopped`：异常退出自动重启，除非管理员主动停止。
- 读取 `.env`。
- 设置 `NODE_ENV=production`、`PORT=3000`、`DATA_DIR=/app/data`。
- 设置时区 `Asia/Shanghai`。
- 设置 Node 堆上限 `--max-old-space-size=768`。
- `mem_limit: 1024m` 限制容器内存。
- 提高文件描述符上限，支持更多 SSE 长连接。
- 端口映射 `${BIND_ADDRESS}:${HOST_PORT}:3000`。
- 日志轮转，最多 3 个 10 MB 文件。
- 把宿主 `../data` 挂到 `/app/data`。
- 健康检查请求 `/api/health`。

### caddy

- 使用 `caddy:2` 官方镜像。
- 通过 `profiles: ["https"]` 控制，只有 `--profile https` 才启动。
- 依赖 app 健康后才启动。
- 暴露 80/443。
- 挂载 Caddyfile、证书和配置卷。
- 限制 128 MB 内存。

**Service**：Compose 中一个可运行组件，通常对应一个容器。
**Profile**：让一组服务按需启用的开关。
**Volume**：持久化数据卷，容器重建后数据仍在。

## 8.10 为什么数据必须挂载

容器理论上可以随时删除重建。如果把 SQLite 写在容器可写层：

- `docker compose down` 后可能一起消失。
- 升级镜像时容易丢数据。
- 不便于宿主机备份。

本项目把宿主机 `data/` 挂载到容器 `/app/data`：

```text
宿主机 /opt/book_answer/data
        <-> app 容器 /app/data
```

这里保存：

- `commercial.sqlite`
- `assets/`
- `backups/`

**Bind Mount**：直接把宿主目录挂到容器路径。项目 app 使用宿主 `data/`。
**Named Volume**：Docker 管理的卷。Caddy 的 `caddy_data` 和 `caddy_config` 使用命名卷，以保证证书和配置在容器重建后保留。

## 8.11 非 root 运行与文件权限

Dockerfile 的 `USER node` 对应 uid 1000。宿主 `data/` 必须允许 uid 1000 写入：

```bash
sudo chown -R 1000:1000 data
```

否则可能看到：

```text
readonly database
```

这不是数据库代码坏了，而是 Linux 文件权限不匹配。

**最小权限原则**：应用不应以 root 运行。即使被利用，攻击者拿到的也是受限用户权限。

## 8.12 Caddy 与反向代理

**Reverse Proxy**：反向代理。用户访问 Caddy，Caddy 再把请求转给内部 app。

**Forward Proxy** 代理客户端访问外部网络；**Reverse Proxy** 代理服务器接收外部请求。方向不同。

Caddy 配置：

```text
example.com {
    encode zstd gzip
    header { ... }
    reverse_proxy app:3000 {
        flush_interval -1
        header_up X-Real-IP {remote_host}
    }
}
```

作用：

- `example.com`：指定站点域名。
- 压缩：减少传输体积。
- 安全头：补充 HSTS、Referrer-Policy 等。
- `app:3000`：通过 Compose 网络用服务名访问 app。
- `flush_interval -1`：不缓冲流式输出，保障 AI 逐段显示。

### Caddy 自动 HTTPS

**Caddy** 是 Go 编写的开源 Web 服务器和反向代理。

**命名与历史**：Caddy 名字来自“容器/盒子”的联想，2015 年由 Matt Holt 发起。它最著名特点是默认自动 HTTPS。

**ACME**：Automatic Certificate Management Environment，自动证书管理环境协议。

Caddy 自动：

1. 证明域名归你所有。
2. 向 CA（Certificate Authority，证书颁发机构）申请证书。
3. 配置 HTTPS。
4. 到期前续签。

Let’s Encrypt 是常见免费 CA。Caddy 的使用大幅减少手工证书操作。

## 8.13 环境变量与密钥

服务器配置：

```bash
cp .env.example .env
openssl rand -base64 32
```

`APP_ENCRYPTION_KEY` 必须是 32 字节，可用 base64 或 64 位 hex 表示。它用于 AES-256-GCM 加密：

- LLM API Key。
- TOTP secret。

生产关键变量：

```dotenv
APP_ORIGIN=https://example.com
APP_ENCRYPTION_KEY=...
ADMIN_PHONE=13800000000
ADMIN_PASSWORD=...
TRUST_PROXY=1
```

**为什么不能把 .env 提交 Git**：任何拿到仓库的人都会获得数据库加密密钥和管理员密码。`.gitignore` 和 `.dockerignore` 都排除了 `.env*`。

**Secrets Management**：密钥管理。简单部署使用环境变量和受限文件权限；大型系统可使用云 KMS、Vault 或容器编排 secret。当前项目尚未接入 KMS 自动轮换。

## 8.14 标准生产部署流程

### 1. 准备服务器

安装 Docker、Compose、SQLite、restic、curl。若要在宿主机运行 npm 运维脚本，还需 Node 22。

### 2. 获取源码

把仓库放到服务器目录，例如：

```text
/opt/book_answer
```

### 3. 配置环境

复制 `.env.example` 为 `.env`，填写域名、加密密钥、管理员信息和外部服务。

### 4. 准备数据目录

```bash
mkdir -p data
sudo chown -R 1000:1000 data
```

### 5. 配置 Caddy

复制模板为 `docker/Caddyfile`，替换真实域名。

### 6. 构建并启动

```bash
docker compose -f docker/compose.yaml --profile https up -d --build
```

### 7. 检查容器

```bash
docker compose -f docker/compose.yaml ps
docker compose -f docker/compose.yaml logs -f app
```

### 8. 验证

- `https://域名` 能打开。
- `/api/health` 返回 ok。
- `/admin` 能进入后台。
- 管理员完成 TOTP。
- 冒烟脚本通过。
- 备份可生成并校验。
- 服务器重启后容器自动恢复。

## 8.15 无域名 IP 直连模式

仅用于短期内测：

```dotenv
APP_ORIGIN=http://公网IP:3000
BIND_ADDRESS=0.0.0.0
TRUST_PROXY=0
ALLOW_INSECURE_HTTP=1
```

启动：

```bash
docker compose --env-file .env -f docker/compose.yaml up -d --build
```

**安全性**：HTTP 明文意味着密码、手机号、聊天内容和 Cookie 都可能被窃听或篡改。只能限制在可信网络和很短周期内，正式对外前必须切换 HTTPS。

**为什么四个配置必须联动**：

- `APP_ORIGIN` 错 -> CSRF 拒绝写请求。
- `BIND_ADDRESS=127.0.0.1` -> 公网访问不到。
- `TRUST_PROXY=1` -> 直连时攻击者可伪造代理 IP 头。
- `ALLOW_INSECURE_HTTP=0` -> Secure Cookie/HSTS/CSP 使 HTTP 部署失效。

## 8.16 发布、回滚与更新

常规更新：

```bash
git pull
npm run verify
docker compose -f docker/compose.yaml --profile https up -d --build
```

- `git pull` 获取版本。
- 验证通过再部署。
- Compose 重建 app，Caddy 保持运行。
- 健康检查未通过时，应停止并回滚到上一个 Git 版本。

**Rollback**：回滚。回到以前能工作的版本。

**Blue-Green Deployment**：蓝绿部署，同时准备旧、新两套环境，切换流量后回滚很快。当前单机架构未实现。

**Canary Release**：金丝雀发布，先给少量用户新版本，观察无误再扩大。当前未实现。

## 8.17 部署练习

把生产请求按顺序排列：

```text
浏览器 -> ? -> ? -> ? -> ? -> SQLite/LLM
```

参考：

```text
浏览器
-> DNS
-> 云安全组
-> Caddy 80/443
-> Compose 网络 app:3000
-> Express 中间件
-> 路由/服务
-> SQLite 或 LLM
```

然后回答：

1. 为什么 app 端口只绑定 127.0.0.1？
2. 为什么 SQLite 不放容器内部可写层？
3. 为什么 Caddy 的 flush 配置影响聊天体验？
4. 为什么 `.env` 不应进入镜像？
5. 为什么有备份仍不等于高可用？

---

# 第 9 章：在本机把项目跑起来并观察它

## 9.1 前置知识

本地开发至少需要：

- Node.js 22。
- npm。
- 一个可用的 `.env.local` 或 `.env`。
- 可写的 `data/` 目录。
- 只有调用真实 AI 时才需要有效模型 API Key。

检查：

```bash
node -v
npm -v
```

预期 Node 输出 v22.x。

## 9.2 安装依赖

```bash
npm install
```

发生什么：

1. npm 读取 `package.json`。
2. 解析依赖树。
3. 根据 `package-lock.json` 决定版本。
4. 下载包到 `node_modules/`。
5. 执行必要的安装脚本。

如果 `node_modules` 已存在但状态异常，不要直接删除前先确认没有需要保留的本地修改。依赖目录本来可再生，但操作仍应遵守项目的文件安全规范。

## 9.3 配置环境

开发环境可以复制：

```bash
cp .env.example .env.local
```

Windows PowerShell 对应：

```powershell
Copy-Item .env.example .env.local
```

至少检查：

```dotenv
APP_ORIGIN=http://localhost:3000
APP_ENCRYPTION_KEY=<32 字节密钥>
ADMIN_PHONE=<管理员手机号>
ADMIN_PASSWORD=<至少 16 位且含字母和数字>
```

生成随机密钥的常见命令：

```bash
openssl rand -base64 32
```

**不要把真实密钥发到聊天、日志、Git 或截图里。** 本教材不会展示你本地 `.env.local` 的内容。

## 9.4 启动

```bash
npm run dev
```

实际流程：

```text
NODE_ENV=development
  -> tsx 直接运行 server/index.ts
  -> createApp()
  -> 初始化 SQLite 和初始数据
  -> Express 监听 3000
  -> createViteServer 挂到同一个 Express
```

访问：

- 用户端：`http://localhost:3000/`
- 管理后台：`http://localhost:3000/admin`

**为什么开发时只有一个端口**：Express 把 Vite middleware 挂进自己。浏览器访问 3000，页面和 `/api` 同源，不需要处理跨域。

## 9.5 观察启动日志

启动时你应该看到类似信息：

- SQLite WAL 引擎位置。
- 监听端口。
- 管理后台或 MFA 配置警告。
- HTTP 请求日志。

若启动立刻退出，优先看：

1. `APP_ORIGIN` 是否在生产模式缺失。
2. `APP_ENCRYPTION_KEY` 是否缺失或长度错误。
3. 管理员密码是否符合策略。
4. 端口是否被其他进程占用。
5. `DATA_DIR` 是否可写。

**Fail Fast**：快速失败。关键配置错误时宁愿启动失败，也不要带着不安全或缺功能的状态运行。

## 9.6 浏览器三件套定位法

前端问题先看：

### Console

回答“JavaScript 是否报错”。CSP、未定义变量、请求异常、React 渲染错误常在这里。

### Network

回答“请求发了没有、发到哪里、返回什么、耗时多久”。

重点看：

- Request URL。
- Method。
- Status。
- Request Headers。
- Cookies。
- Payload。
- Response。
- Timing。
- 是否长时间 pending（SSE 正常可能如此）。

### Application / Storage

查看：

- Cookie 是否存在。
- Cookie 的 HttpOnly、Secure、SameSite。
- localStorage 是否有不应保存的敏感信息。

本项目不会把会话 JWT 放在 localStorage。

## 9.7 后端日志与数据库证据

当前后端使用 Pino 输出结构化日志。日志目标包括：

- 请求路径、状态码、耗时。
- 关键业务错误。
- 模型上游失败。
- 未捕获异常。

数据库证据：

```bash
sqlite3 data/commercial.sqlite "SELECT id, phone, status FROM users;"
sqlite3 data/commercial.sqlite "SELECT id, user_id, updated_at FROM chat_sessions ORDER BY updated_at DESC LIMIT 5;"
```

**只读排查原则**：先 SELECT 观察，不要一上来 UPDATE/DELETE。修改运行数据前必须备份并明确确认影响范围。

## 9.8 三条端到端调试路线

### 路线 A：登录失败

```text
LoginModal
-> /api/auth/login
-> auth route
-> users 表
-> bcrypt 比较
-> auth_sessions 表
-> Set-Cookie
-> 后续 /api/auth/me
```

按顺序检查：

1. 请求正文是否有 phone/password。
2. 状态码是 401、423 还是 403。
3. 用户是否存在、是否被禁用、是否锁定。
4. 密码哈希是否为合法 bcrypt 格式。
5. 登录成功响应有没有 Set-Cookie。
6. 浏览器后续请求是否携带 Cookie。
7. `APP_ORIGIN` 是否与访问地址完全一致。

### 路线 B：聊天没回复

```text
前端输入
-> /api/chat/stream
-> 登录和 CSRF
-> 会话归属
-> 配额
-> LLM 配置
-> 上游 fetch
-> SSE 解析
-> 数据库保存
-> 前端显示
```

第一区分点：SSE 是否已经返回 HTTP 200。

- 非 200：看登录、CSRF、额度、会话或配置。
- 200 但无 delta：看上游请求、流解析、代理缓冲。
- 有 delta 但不显示：看前端流读取和 React state。
- 有回答但历史为空：看最终 saveChatSession。

### 路线 C：后台修改不生效

```text
AdminPanel
-> /api/admin/skills
-> requireAdmin + CSRF
-> Zod/字段清洗
-> db.saveSkill
-> skills 表
-> 用户端 /api/skills
```

检查保存响应、数据库记录和公开接口返回，不要只看后台 toast。

## 9.9 常用命令

```bash
npm run dev          # 开发
npm run lint         # 类型检查
npm test             # 测试一次
npm run test:watch   # 监听测试
npm run build        # 构建前端和后端
npm start            # 运行生产构建
npm run verify       # 完整验证
npm run config:check # 隔离配置检查
npm run load:test    # 压测
```

后台操作脚本必须理解风险，`clear-all` 或 reset 类脚本不能在生产环境随意运行。

## 9.10 Git 基础

**Git** 是分布式版本控制系统，由 Linus Torvalds 在 2005 年为 Linux 内核开发而创建。

核心概念：

- Repository：仓库。
- Working Tree：工作区。
- Index / Staging Area：暂存区。
- Commit：提交，一次不可变历史记录。
- Branch：分支。
- Remote：远端仓库。
- Merge：合并。
- Rebase：重放提交，整理历史。
- Pull Request：请求审查并合并改动。

常用：

```bash
git status
git diff
git log --oneline --decorate
git add <file>
git commit -m "type(scope): message"
git pull
```

`git status` 先看有什么变化；`git diff` 看具体差异；提交前不要混入无关文件。

**为什么不要提交 data/.env**：它们含运行数据和秘密，应由 `.gitignore` 排除。若秘密曾经提交，仅删文件不够，必须轮换密钥并评估历史清理。

## 9.11 本地练习任务

按顺序完成，每一步都记录证据：

1. 启动开发环境。
2. 打开 `/api/health`，记录字段。
3. 打开首页 Network，找到三个初始 API。
4. 未登录打开聊天，确认返回 401。
5. 用管理员创建测试用户。
6. 首次登录，完成强制改密。
7. 发送一条聊天，观察 SSE 分段。
8. 在 SQLite 只读确认会话和消息已保存。
9. 查看 `quota_ledger` 的 reserved/consumed。
10. 停止服务再启动，确认数据仍在。

完成后再停止临时服务，并检查：

```bash
git status --short
```

确认没有把测试数据、密钥或无关改动提交。

---

# 第 10 章：生产运维、监控与未来扩容

## 10.1 代码上线并不意味着工作结束

上线后必须持续回答：

- 服务现在是否可用？
- 用户请求变慢了吗？
- 错误率是否升高？
- 数据库是否可写？
- 磁盘快满了吗？
- AI 供应商是否故障？
- 备份是否真的能恢复？
- 管理员密钥是否泄露或需要轮换？

**Operations**：运维。传统上包括部署、监控、容量、备份、安全和故障处理。现代开发提倡 DevOps（Development + Operations），让开发和运维协作自动化。

**SRE**：Site Reliability Engineering，站点可靠性工程。Google 提出的工程化运维实践，用软件方法管理可用性、错误预算和容量。

## 10.2 日志

**Log**：日志，程序在运行过程中记录的事件。

本项目使用 Pino：

- 结构化 JSON 日志。
- 请求日志由 pino-http 生成。
- 健康检查不记录，避免刷屏。
- 启动失败、未捕获异常、模型错误有日志。

日志级别常见：

- trace：极细粒度跟踪。
- debug：开发调试。
- info：正常重要事件。
- warn：可继续但需注意。
- error：请求或系统失败。
- fatal：进程无法继续。

**日志设计原则**：

- 不记录密码、Cookie、API Key。
- 记录可搜索的请求 ID、用户 ID、状态和耗时。
- 日志要轮转，否则磁盘会被写满。
- 结构化字段比拼接字符串更适合查询。

Docker Compose 设置 json-file 日志最多 3 × 10 MB，防止容器日志无限增长。

**Pino** 是一个 Node.js 日志库品牌名，取“松树”之意；它不是缩写。结构化日志的现代做法借鉴了日志即事件流的思想。

## 10.3 指标与健康检查

**Metric**：指标，可聚合的数值，例如：

- 请求总数。
- 每分钟请求数。
- 活跃 SSE 连接数。
- 峰值并发 SSE。
- 运行时间。
- 延迟分位数。
- 错误率。

本项目 `/api/health` 返回：

```json
{
  "status": "ok",
  "timestamp": "...",
  "activeSseConnections": 0,
  "peakConcurrentSse": 0,
  "uptimeSeconds": 123
}
```

它执行 `db.ping()`，所以不仅检查 Node 进程，还检查 SQLite 是否能执行 `SELECT 1`。

**Health Check** 与业务监控不同：

- 健康检查回答“这个实例是否应该接收流量”。
- 业务监控回答“用户体验是否正常”。

**Uptime**：运行时间。**Downtime**：停机时间。**Availability** 常用比例表示，例如 99.9%。

**SLO**：Service Level Objective，服务等级目标。
**SLA**：Service Level Agreement，服务等级协议，是给客户承诺的合同化水平。
**Error Budget**：错误预算，允许在一段时间内不满足 SLO 的额度。

当前项目没有正式 SLO/SLA 系统，但可以用错误率和可用性建立目标。

## 10.4 Sentry

**Sentry** 是错误跟踪服务品牌。

它收集：

- 异常堆栈。
- 发布版本。
- 环境。
- 浏览器/服务端上下文。
- 发生频率。

**DSN** 告诉 SDK 往哪个项目上报。没有配置 `SENTRY_DSN` 时，项目仍然运行，只是不上报。

**为什么日志和错误监控都要**：日志是连续事件流；错误平台更擅长聚合、分组、报警和追踪首次出现。两者互补。

**Tracing**：分布式追踪。一次请求经过多个服务时，用 trace ID 把各段连接起来。当前项目主要是错误监控和日志，不是完整分布式追踪系统。

## 10.5 备份策略

本项目目标：

- 每日备份。
- 异地存储。
- 保留 30 天。
- RPO 24 小时。
- RTO 4 小时。
- 每周恢复演练。

计划的 Cron 示例：

```bash
0 4 * * * cd /opt/book_answer && DATA_DIR=/opt/book_answer/data \
  /opt/book_answer/scripts/backup.sh >> /opt/book_answer/data/backups/cron.log 2>&1
```

**Cron** 是 Unix/Linux 的定时任务工具。字段顺序通常是：

```text
分钟 小时 日 月 星期 命令
0    4    *  *  *  每天 04:00
```

**3-2-1 备份原则**：

- 至少 3 份数据。
- 2 种不同介质或系统。
- 1 份异地保存。

本项目本机备份 + restic 异地对象存储，在能力范围内接近该原则。

**Restic** 是开源备份工具，支持加密、去重和多种后端存储。备份加密密码丢失后，备份也无法恢复，所以 `RESTIC_PASSWORD` 必须安全保存。

## 10.6 恢复演练

只有“备份成功”不够，还要证明“能恢复”。

恢复流程大致：

1. 停止 app。
2. 选择备份。
3. 校验完整性。
4. 恢复数据库和 assets。
5. 恢复目录属主到 1000:1000。
6. 启动 app。
7. 健康检查。
8. 登录测试。
9. 聊天和历史测试。

**Disaster Recovery**：灾难恢复，简称 DR。服务器损坏、机房故障或误删除后恢复业务的能力。

**恢复演练不应直接覆盖生产**。优先在隔离目录或临时服务器还原并验证。

## 10.7 容量与性能

**CPU-bound**：受 CPU 计算限制，如加密、压缩、图片处理。
**I/O-bound**：受输入输出限制，如数据库、网络、磁盘。
**Memory-bound**：受内存限制。
**Latency**：单次请求耗时。
**Throughput**：单位时间完成量。
**Concurrency**：同时在处理的请求数量。

本项目主要压力：

- 登录时的 bcrypt 计算。
- SQLite 写入和事务锁。
- 外部 LLM 等待。
- 大量 SSE 长连接占用文件描述符和内存。
- 上传图片占用磁盘和带宽。

Compose 设置了内存限制、Node 堆上限和文件描述符上限，目标是在 2 核 2 GB 实例上避免单个容器把机器拖垮。

**为什么内存限制要低于宿主机总内存**：Node、SQLite 页缓存、Docker 和系统本身都要内存。给容器设 1 GB 限额并给 V8 768 MB 堆上限，可减少 OOM kill。

**OOM**：Out Of Memory，内存耗尽。Linux OOM killer 可能直接终止容器进程。

**分位数延迟**：

- P50：一半请求快于此值。
- P95：95% 请求快于此值。
- P99：99% 请求快于此值。

平均值会掩盖少数极慢请求，因此线上更关注 P95/P99。

## 10.8 垂直扩容与水平扩容

### 垂直扩容

**Vertical Scaling / Scale Up**：给单台机器增加 CPU、内存、磁盘。

优点：改动少。
缺点：有硬件上限，单机仍是故障点。

### 水平扩容

**Horizontal Scaling / Scale Out**：增加实例数量。

优点：能分担负载，可做高可用。
缺点：需要处理会话共享、数据库并发、文件共享、部署和负载均衡。

本项目当前是单实例，不能直接把 app 复制多份还共享同一个 SQLite 文件：

- SQLite 文件锁和本地磁盘特性适合单机。
- 上传素材在本地 `data/assets`，多实例不一致。
- 会话存数据库，本身模型没问题，但需要共享数据库。
- SSE 连接落在具体实例，需考虑是否有粘性路由。

## 10.9 未来扩容路线

当单机达到瓶颈，可以逐步演进：

```text
阶段 1：单 VPS + SQLite + 本地素材
阶段 2：PostgreSQL 托管数据库 + 对象存储
阶段 3：多 app 实例 + 负载均衡 + Redis
阶段 4：容器编排、自动伸缩、集中监控
```

### PostgreSQL

优点：

- 客户端/服务器模型，多实例可连接同一数据库。
- 更成熟的并发、索引、事务和备份能力。
- 托管数据库可提供高可用和自动备份。

迁移不是只换驱动：

- 重写 SQLite 方言。
- 处理日期、布尔值和 JSON 类型差异。
- 建立连接池。
- 迁移现有数据。
- 补齐迁移工具。
- 重新做事务和并发测试。

### Redis

**Redis**：Remote Dictionary Server，远程字典服务器。

用途：

- 缓存。
- 分布式限流。
- 会话或队列。
- 跨实例共享短期状态。

### 对象存储

**Object Storage**：对象存储，例如 S3、OSS、COS。适合保存上传图片和备份，不要求用户自己管理文件服务器。

**S3**：Simple Storage Service，Amazon S3 是对象存储服务品牌，后来 S3 兼容 API 成为行业惯例。

### CDN 与负载均衡

**CDN**：Content Delivery Network，内容分发网络。把静态资源缓存到离用户更近的节点。

**Load Balancer**：负载均衡器。把请求分到多个 app 实例。

**Sticky Session**：粘性会话，让同一用户固定去某实例。它对实时流有帮助，但会降低均衡效果，通常优先做无状态服务。

## 10.10 当前架构的明确边界

根据部署文档，本项目当前：

- 不支持多实例、高可用或蓝绿发布。
- 没有在线支付、退款、发票和支付回调。
- 会员由管理员手工开通。
- SQLite 写操作是同步的。
- 没有正式完整数据库迁移框架。
- 聊天消息以 JSON 存在单个会话行中。
- 没有 CDN、Redis 或对象存储。

这不是“架构差”，而是明确选择了符合当前规模的最小可靠方案。学习时要同时理解两件事：

1. 当前为什么这样设计。
2. 什么指标出现时应该演进。

如果只有 500 DAU，直接上 Kubernetes、微服务和多数据库通常增加成本和故障面。若用户量和并发显著增长，再按证据升级。

## 10.11 可观测性三支柱

现代系统常把可观测性分为：

1. **Logs**：离散事件，回答“发生了什么”。
2. **Metrics**：可聚合数值，回答“整体趋势怎样”。
3. **Traces**：请求跨服务路径，回答“慢在哪一段”。

本项目：

- 有结构化日志。
- 有少量进程和 SSE 指标。
- 有 Sentry 错误监控。
- Trace 和统一指标系统有限。

**Observability**：可观测性。系统不必增加代码就能从外部输出推断内部状态。它与“监控几个固定指标”相比更强调探索未知问题。

## 10.12 灾难场景演练

思考以下场景：

| 场景 | 影响 | 优先动作 |
|---|---|---|
| app 容器崩溃 | 服务中断 | 查看重启和日志，健康检查 |
| SQLite 文件损坏 | 数据不可用 | 停止写，保留现场，用备份恢复 |
| 磁盘写满 | 登录、日志、上传失败 | 清理日志/旧备份，扩容磁盘 |
| API Key 泄露 | 被盗刷费用 | 服务商立即撤销并轮换 Key |
| `APP_ENCRYPTION_KEY` 丢失 | TOTP/API Key 无法解密 | 从安全备份恢复密钥 |
| 证书续期失败 | HTTPS 告警或中断 | 看 Caddy 日志、DNS、80/443 |
| 第三方模型故障 | AI 不可用 | 降级提示、切换兼容供应商 |
| 误删用户 | 业务数据丢失 | 立即停止相关写入，从备份恢复/审计 |

## 10.13 运维练习

为你负责的部署写一页 Runbook（运行手册），至少包含：

- 如何确认服务正常。
- 如何查看 app 和 Caddy 日志。
- 如何重启 app。
- 如何验证数据库。
- 如何生成备份。
- 如何恢复备份。
- 如何轮换 LLM API Key。
- 如何回滚版本。
- 联系人和升级路径。

**Runbook** 是给值班人员的可执行步骤。好的 Runbook 不是长篇原理，而是故障时能照着做、每步有预期结果和回退办法的清单。

---

# 第 11 章：像工程师一样思考

## 11.1 一个功能从想法到上线要经过什么

**SDLC**：Software Development Life Cycle，软件开发生命周期。

常见阶段：

1. 需求：谁需要什么，为什么需要。
2. 设计：数据、接口、界面和边界。
3. 开发：按模块实现。
4. 测试：验证正常、异常和权限。
5. 构建：生成可部署产物。
6. 部署：发布到服务器。
7. 运维：监控、备份、报警和优化。
8. 迭代：根据数据和反馈修改。

**为什么初学者要先学流程**：只会写一段语法，不等于能把功能安全地交给用户。

## 11.2 用“每日额度”做一次完整设计

假设要新增“季度会员每天最多 300 次”：

### 需求层

- 谁能使用季度会员额度？
- 是按日还是按会员周期？
- 会员过期当天怎样计算？
- 管理员修改额度后何时生效？
- 失败请求是否扣次数？

不回答这些，代码会不断返工。

### 数据层

现有字段：

- `membership_tier`
- `membership_expires_at`
- `daily_used_count`
- `last_active_date`
- `quota_ledger`

可能要改：

- 配置 JSON 中增加季度日限额。
- 明确额度周期 key。
- 确保跨日回退条件正确。

### API 层

公开配置：

```text
GET /api/config/public
```

返回最新额度。聊天时后端不能相信前端额度，必须从服务端用户状态和配置重新计算。

### 前端层

- 显示当前等级和剩余额度。
- 返回 429 时显示清晰提示。
- 后台修改后，用户重新聚焦页面时刷新配置。

### 安全层

- 匿名用户不能聊天。
- 客户端不能自报会员等级。
- 并发请求不能突破上限。
- 管理员接口需要 CSRF。

### 测试层

- 免费用户到上限。
- 季度用户未过期和已过期。
- 管理员修改额度。
- 失败调用退款。
- 跨日周期不错误退款。

### 部署层

- 环境配置是否需要更新。
- 旧数据库是否兼容。
- 发布后健康检查。
- 备份是否在迁移前完成。

这就是全栈思维：不是只改一个 if，而是沿着端到端链路检查。

## 11.3 如何阅读陌生代码

推荐方法：

1. 先找入口，不从细节开始。
2. 找路由或组件名称。
3. 找到输入和输出类型。
4. 追踪它调用的下一层。
5. 找到数据读写位置。
6. 看错误分支和权限检查。
7. 看测试如何描述预期行为。
8. 最后再读辅助函数。

在本项目中：

- 用户界面从 `src/main.tsx` 和 `src/App.tsx` 开始。
- 管理界面从 `src/admin-main.tsx` 和 `AdminGate.tsx` 开始。
- 后端从 `server/index.ts` 和 `server/app.ts` 开始。
- 数据从 `server/db.ts` 开始。
- 部署从 `docker/compose.yaml` 和 `docs/deploy.md` 开始。

## 11.4 如何提出好问题

低效问题：

```text
为什么不能用？
```

高效问题：

```text
未登录点击发送时，浏览器收到 401。
Network 显示请求是 POST /api/chat/stream，
响应为 {"error":"UNAUTHENTICATED"}。
登录后同一请求可以发送。
这是 Cookie 没保存，还是 CSRF 校验失败？
```

包含：

- 做了哪一步。
- 现象是什么。
- 期望是什么。
- 已观察到哪些证据。
- 已排除哪些原因。

## 11.5 十二周学习路线

每周建议 4 到 6 小时，不要求一次学完。

### 第 1 周：互联网与 HTTP

- 理解 DNS、IP、端口、TCP、TLS、HTTP。
- 会用浏览器 Network 看请求和响应。
- 能区分页面文件请求和 API 请求。
- 阅读本教材第 1 章。

### 第 2 周：HTML、CSS、JavaScript

- 理解 DOM。
- 会写简单 HTML、CSS 和函数。
- 理解变量、对象、数组、Promise、async/await。
- 知道浏览器 JavaScript 和 Node.js 的差异。

### 第 3 周：TypeScript 与组件

- 理解类型、接口、联合类型。
- 能看懂 React props、state 和 JSX。
- 追踪 `App.tsx` -> `AiStudioWorkspace`。

### 第 4 周：前端请求与登录

- 理解 Cookie、Session、CSRF 的配合。
- 追踪 LoginModal 的登录与改密。
- 在 Network 中验证 401、403、200。
- 阅读本教材第 2、4 章。

### 第 5 周：Node.js 与 Express

- 理解事件循环、中间件、路由。
- 能根据 URL 找到对应 route 文件。
- 理解请求正文、状态码和 JSON。
- 阅读本教材第 3 章。

### 第 6 周：数据库与 SQL

- 理解表、行、列、主键、外键、索引。
- 会用只读 SELECT 查看数据。
- 理解事务与额度账本。
- 阅读本教材第 5 章。

### 第 7 周：AI 与 SSE

- 理解 prompt、token、上下文、温度。
- 能画出聊天端到端数据流。
- 理解 API Key 为什么只能在后端。
- 阅读本教材第 6 章。

### 第 8 周：测试与构建

- 会运行 lint、test、build。
- 理解单元、集成和冒烟测试。
- 能描述 CI 做什么。
- 阅读本教材第 7 章。

### 第 9 周：Docker

- 区分镜像、容器、虚拟机。
- 能读懂 Dockerfile 两个阶段。
- 理解 Volume、端口和 `.dockerignore`。
- 阅读本教材第 8 章。

### 第 10 周：Caddy 与云部署

- 理解 DNS、A 记录、HTTPS、反向代理。
- 能在隔离环境演练构建和启动。
- 理解生产环境变量。
- 阅读 `docs/deploy.md`。

### 第 11 周：备份与运维

- 理解 RPO、RTO、备份和恢复。
- 会读结构化日志和健康检查。
- 完成一次不覆盖生产的恢复演练。
- 阅读本教材第 10 章。

### 第 12 周：独立做一个最小全栈功能

选择一个低风险功能，要求：

- 前端有输入和反馈。
- 后端有校验和权限。
- 数据库有持久化。
- 有测试。
- 能构建。
- 有部署说明。

## 11.6 每次学习后的自测

你能不用术语解释这些吗？

1. 输入网址按下回车后发生了什么？
2. 浏览器和服务器分别负责什么？
3. 为什么 SQL 不能直接暴露给用户？
4. 为什么密码用 bcrypt 而不是 Base64？
5. Session 和 JWT 各是什么？
6. 为什么写请求需要 CSRF？
7. 什么是事务，额度为什么先预留？
8. SSE 和普通 JSON 响应有什么区别？
9. Docker 容器和虚拟机有什么区别？
10. 为什么数据库文件必须挂载到宿主机？
11. Caddy 为什么放在 Node 前面？
12. 备份为什么必须演练恢复？

当你能用生活比喻加项目证据回答，才算真正理解，而不是背下定义。

## 11.7 你需要建立的五种思维

### 分层思维

问题发生在哪一层？不要跨层猜。

### 数据流思维

数据从哪来，经过谁，最终存到哪里，谁有权读取？

### 安全边界思维

哪些输入不可信？哪些秘密不能出服务器？哪个 API 必须鉴权？

### 失败思维

数据库失败、模型失败、网络断开、客户端离开时会怎样？有没有退款、重试、超时和回滚？

### 演进思维

现在为什么简单，什么条件下复杂化？不要提前设计，也不要拒绝变化。

---

# 附录 A：英文术语、全称、命名逻辑与历史速查

## A.1 Web 与网络

| 术语 | 英文全称 | 白话解释 | 命名逻辑与发展 |
|---|---|---|---|
| Web | World Wide Web | 万维网 | Tim Berners-Lee 1989 年提出，核心是 URL、HTTP、HTML |
| Internet | Internet | 互联网 | 连接全球网络的网络；“inter”表示互联 |
| IP | Internet Protocol | 互联网协议 | 负责寻址和分组传输 |
| TCP | Transmission Control Protocol | 传输控制协议 | 面向连接，保证可靠有序传输 |
| UDP | User Datagram Protocol | 用户数据报协议 | 无连接、开销小，不保证可靠 |
| DNS | Domain Name System | 域名系统 | 1983 年形成，把名称映射为地址 |
| URL | Uniform Resource Locator | 统一资源定位符 | 统一描述协议、主机、路径等位置 |
| URI | Uniform Resource Identifier | 统一资源标识符 | 比 URL 更宽，标识而不一定定位 |
| HTTP | HyperText Transfer Protocol | 超文本传输协议 | 1990 年代随 Web 出现，后续有 1.1、2、3 |
| HTTPS | Hypertext Transfer Protocol Secure | 安全超文本传输协议 | HTTP 加 TLS |
| TLS | Transport Layer Security | 传输层安全协议 | 从 SSL 发展而来，负责加密和身份验证 |
| SSL | Secure Sockets Layer | 安全套接字层 | TLS 前身，现代通常说 SSL 证书 |
| SSH | Secure Shell | 安全外壳 | 1995 年出现，加密远程登录 |
| CDN | Content Delivery Network | 内容分发网络 | 把静态内容缓存到离用户近的节点 |
| NAT | Network Address Translation | 网络地址转换 | 内网和公网地址之间转换，云主机可能影响自身访问公网 IP |

## A.2 浏览器与前端

| 术语 | 英文全称 | 白话解释 | 命名逻辑与发展 |
|---|---|---|---|
| HTML | HyperText Markup Language | 超文本标记语言 | 用标签描述结构，源自 SGML |
| CSS | Cascading Style Sheets | 层叠样式表 | 1996 年标准，把视觉和内容分离 |
| JavaScript | ECMAScript 是标准名 | 浏览器脚本语言 | 1995 年 Brendan Eich 创造，名字带 Java 是营销历史 |
| DOM | Document Object Model | 文档对象模型 | 浏览器把页面表示为可操作对象树 |
| AJAX | Asynchronous JavaScript and XML | 异步 JavaScript 和 XML | 2005 年流行，使网页局部更新；现代多用 JSON/fetch |
| API | Application Programming Interface | 应用程序编程接口 | “接口”是程序间约定 |
| JSON | JavaScript Object Notation | JavaScript 对象表示法 | 2001 年左右推广，已成为语言无关格式 |
| SPA | Single Page Application | 单页应用 | 首次加载后在浏览器内切换视图 |
| CSR | Client-Side Rendering | 客户端渲染 | 浏览器执行 JS 后生成界面 |
| SSR | Server-Side Rendering | 服务端渲染 | 服务器先返回完整 HTML，现代可按页混用 |
| JSX | JavaScript XML | JavaScript XML 语法扩展 | React 常用，最终编译为 JS |
| React | React | 用户界面库 | 2013 年 Facebook 开源，强调组件和声明式 |
| Hook | Hook | 函数组件的状态与生命周期机制 | React 16.8 引入，如 useState、useEffect |
| Props | Properties | 父组件传给子组件的属性 | 只读输入 |
| State | State | 会触发界面更新的组件内部数据 | 状态变化 -> 重新渲染 |
| TypeScript | Typed JavaScript（常用解释） | 带类型 JavaScript | 微软 2012 年发布，编译期检查 |
| Vite | Vite，法语“快” | 前端开发和构建工具 | 2020 年推出，开发快、生产用 Rollup |
| HMR | Hot Module Replacement | 热模块替换 | 修改模块后局部替换，减少整页刷新 |
| i18n | Internationalization | 国际化 | I 和 N 之间 18 个字母 |
| DTO | Data Transfer Object | 数据传输对象 | 用于跨层/跨边界传递精简数据，如 PublicSkill |

## A.3 后端、API 与运行时

| 术语 | 英文全称 | 白话解释 | 命名逻辑与发展 |
|---|---|---|---|
| Node.js | Node.js | 服务端 JavaScript 运行时 | Ryan Dahl 2009 年创建，基于 V8 和事件循环 |
| V8 | V8 JavaScript Engine | V8 JavaScript 引擎 | Google 开发，将 JS 编译执行 |
| npm | Node package manager（常见解释） | Node 包管理器 | 2010 年发展，管理依赖和脚本 |
| ESM | ECMAScript Modules | ECMAScript 模块 | 标准 import/export 模块机制 |
| CommonJS | CommonJS | Node 早期模块机制 | require/module.exports，本项目生产输出 `.cjs` |
| Express | Express.js | Node Web 框架 | 2010 年前后出现，受 Sinatra 启发，强调中间件 |
| Middleware | Middleware | 中间件 | 位于请求和业务处理之间，按顺序加工 |
| REST | Representational State Transfer | 表述性状态转移 | Roy Fielding 2000 年提出，一种 API 架构风格 |
| CRUD | Create Read Update Delete | 增删改查 | 数据操作四类基础动作 |
| Zod | Zod | TypeScript 数据校验库 | 在运行时验证外部输入 |
| Pino | Pino | Node 日志库 | 产生结构化 JSON 日志 |
| Sentry | Sentry | 错误跟踪平台 | 聚合异常、版本和环境 |
| Vitest | Vite Test | 测试运行器 | 依托 Vite 生态 |
| Supertest | Supertest | HTTP API 测试库 | 直接测试 Express app |
| Autocannon | Autocannon | HTTP 压测工具 | 名称比喻快速连续发请求 |
| CI | Continuous Integration | 持续集成 | 提交后自动检查与测试 |
| CD | Continuous Delivery / Deployment | 持续交付/部署 | 自动准备可发布版本或自动上线 |
| DAU | Daily Active Users | 日活跃用户数 | 产品容量和增长指标 |

## A.4 数据库

| 术语 | 英文全称 | 白话解释 | 命名逻辑与发展 |
|---|---|---|---|
| DB | Database | 数据库 | 有组织的数据集合 |
| DBMS | Database Management System | 数据库管理系统 | 管理数据库的软件 |
| RDBMS | Relational DBMS | 关系型数据库管理系统 | 以表、键和关系组织数据 |
| SQL | Structured Query Language | 结构化查询语言 | IBM 1970 年代关系数据库背景下发展并标准化 |
| SQLite | SQL + Lite | 嵌入式关系数据库 | Richard Hipp 2000 年发布，轻量、单文件 |
| WAL | Write-Ahead Logging | 预写式日志 | 先写日志提高并发和恢复能力 |
| ACID | Atomicity Consistency Isolation Durability | 事务四特性 | 原子、一致、隔离、持久 |
| PK | Primary Key | 主键 | 唯一标识一行 |
| FK | Foreign Key | 外键 | 引用另一表的主键 |
| Index | Index | 索引 | 类似书的目录，加速查找但增加写成本 |
| ORM | Object-Relational Mapping | 对象关系映射 | 在对象和表之间自动映射，本项目未使用 |
| UPSERT | Update or Insert | 存在则更新，否则插入 | 本项目用 ON CONFLICT 实现 |
| Query | Query | 查询 | 向数据库请求数据 |
| Migration | Database Migration | 数据库迁移 | 随版本安全改变结构和数据 |
| Integrity Check | Database Integrity Check | 数据库完整性检查 | SQLite 的 `PRAGMA integrity_check` |
| RPO | Recovery Point Objective | 恢复点目标 | 最多能接受丢多少时间的数据 |
| RTO | Recovery Time Objective | 恢复时间目标 | 故障后多久必须恢复服务 |

## A.5 安全

| 术语 | 英文全称 | 白话解释 | 命名逻辑与发展 |
|---|---|---|---|
| AuthN | Authentication | 认证 | 回答“你是谁” |
| AuthZ | Authorization | 授权 | 回答“你能做什么” |
| Session | Session | 服务端会话 | 浏览器拿令牌，服务端保存状态 |
| Cookie | HTTP Cookie | 浏览器小型状态 | 服务器下发，浏览器按规则自动携带 |
| HttpOnly | HttpOnly Cookie | JS 不可读 Cookie | 降低 XSS 偷会话风险 |
| CSRF | Cross-Site Request Forgery | 跨站请求伪造 | 借用户 Cookie 冒用用户发起请求 |
| XSS | Cross-Site Scripting | 跨站脚本 | 缩写用 X 避免和 CSS 冲突 |
| CSP | Content Security Policy | 内容安全策略 | 限制脚本、连接和资源来源 |
| bcrypt | Blowfish crypt | 密码哈希算法 | 1999 年提出，名字来自 Blowfish 和 crypt |
| Salt | Password Salt | 密码盐 | 随机数据，避免相同密码哈希相同 |
| SHA | Secure Hash Algorithm | 安全哈希算法 | 单向摘要，256 表示输出位数 |
| HMAC | Hash-based Message Authentication Code | 基于哈希的消息认证码 | 带密钥，验证完整性和来源 |
| AES | Advanced Encryption Standard | 高级加密标准 | 对称加密标准 |
| GCM | Galois/Counter Mode | 认证加密模式 | 本项目的 AES-256-GCM |
| API Key | Application Programming Interface Key | 接口密钥 | 服务商识别和计费调用者 |
| TOTP | Time-based One-Time Password | 基于时间的一次性密码 | RFC 6238，常用于认证器 App |
| MFA | Multi-Factor Authentication | 多因素认证 | 密码之外再加“拥有的因素” |
| CORS | Cross-Origin Resource Sharing | 跨源资源共享 | 浏览器跨源请求授权机制；本项目同源，主要未依赖 CORS |
| HSTS | HTTP Strict Transport Security | HTTP 严格传输安全 | 浏览器记住后强制 HTTPS |

## A.6 部署与运维

| 术语 | 英文全称 | 白话解释 | 命名逻辑与发展 |
|---|---|---|---|
| VPS | Virtual Private Server | 虚拟专用服务器 | 云上常见单机部署形态 |
| IaaS | Infrastructure as a Service | 基础设施即服务 | 云厂商提供虚拟机、网络、存储 |
| Docker | Docker | 容器化平台 | 2013 年推出，借集装箱比喻标准化运行环境 |
| Image | Container Image | 容器镜像 | 创建容器的只读模板 |
| Container | Container | 容器 | 镜像的运行实例，共享宿主内核 |
| Compose | Docker Compose | 多容器编排工具 | 用 YAML 组合 app、Caddy 等服务 |
| Volume | Docker Volume | 持久化卷 | 容器重建后保留数据 |
| Reverse Proxy | Reverse Proxy | 反向代理 | 接收公网请求，转发给内部服务 |
| Caddy | Caddy Server | Web 服务器/反向代理 | 2015 年发展，默认自动 HTTPS |
| ACME | Automatic Certificate Management Environment | 自动证书管理环境 | 自动申请和续签 TLS 证书 |
| CA | Certificate Authority | 证书颁发机构 | 签发和证明证书 |
| Cron | Cron | Unix 定时任务 | 按分钟、小时、日等字段调度 |
| Restic | Restic Backup | 加密去重备份工具 | 支持多种远端存储 |
| S3 | Simple Storage Service | 对象存储服务 | 源自 Amazon S3，后成为兼容 API 通称 |
| Redis | Remote Dictionary Server | 远程字典服务器 | 常用于缓存、队列和共享状态 |
| OOM | Out Of Memory | 内存耗尽 | 内核可能杀死进程 |
| SLO | Service Level Objective | 服务等级目标 | 团队设定的可靠性目标 |
| SLA | Service Level Agreement | 服务等级协议 | 对客户承诺的正式协议 |
| CDN | Content Delivery Network | 内容分发网络 | 静态资源靠近用户缓存 |

---

# 附录 B：五条端到端链路速记

## B.1 浏览技能

```text
浏览器 GET /api/skills
-> 全局限流/日志/authMiddleware
-> skills route
-> db.getSkills()
-> SQLite SELECT
-> toPublicSkill 移除 systemPrompt
-> JSON
-> React 渲染卡片
```

## B.2 用户登录

```text
LoginModal
-> POST /api/auth/login
-> Zod
-> users 表按 phone 查询
-> bcrypt.compare
-> 首次登录？改密挑战
-> 创建 auth_sessions
-> Session Cookie + CSRF Cookie
-> 前端更新 user
```

## B.3 AI 聊天

```text
POST /api/chat/stream
-> 用户会话 + CSRF + 限流
-> Zod
-> 验证会话归属
-> 读取 Skill 和 LLM 配置
-> reserveQuota
-> 保存用户消息
-> 调上游 API，stream=true
-> 解析上游 delta
-> SSE 转发浏览器
-> consumed 或 refunded
-> 保存 assistant 回复
```

## B.4 管理员创建用户

```text
AdminPanel
-> POST /api/admin/users/create
-> requireAdmin + CSRF
-> 校验手机号
-> 生成临时密码
-> bcrypt 哈希
-> users 表
-> 审计日志
-> 临时密码只返回一次
```

## B.5 生产部署

```text
Git 源码
-> npm ci / npm build
-> Dockerfile 多阶段构建镜像
-> Compose 启动 app
-> Caddy 接收 80/443
-> reverse_proxy app:3000
-> 宿主 data 持久化 SQLite
-> 健康检查
-> 冒烟测试
-> Cron 备份到 restic/S3
-> 持续监控和恢复演练
```

---

# 结语：怎样才算真正掌握

不要以“能背出 React、Express、SQLite”作为目标。真正的掌握是：

1. 看到一个页面功能，能说出它的数据来源。
2. 看到一个 API，能判断谁可以访问、会读写哪张表。
3. 看到一个数据库字段，能解释为什么存在、修改会影响谁。
4. 看到日志和状态码，能把故障缩小到一层。
5. 看到部署配置，能说清请求怎样从公网走到进程和文件。
6. 面对新需求，能先写边界、再设计接口、最后实现 UI。
7. 知道当前方案的代价，也知道出现什么证据时应该演进。

`book_answer` 的价值不只是一个能运行的网站，而是一套完整的小型工程范例：

- 前端采用现代 React + TypeScript + Vite。
- 后端采用清晰分层的 Express。
- 数据层在规模匹配时选择简单可靠的 SQLite。
- AI 调用通过后端保护密钥、额度和上下文。
- 安全覆盖 Session、CSRF、bcrypt、MFA、限流和 CSP。
- 部署采用 Docker Compose + Caddy，具备备份与恢复路径。
- 测试、CI、日志和监控保证系统可验证、可观察。

先沿着三条路反复走：

```text
登录路：浏览器 -> Session -> users -> auth_sessions
聊天路：浏览器 -> SSE -> quota -> LLM -> SQLite
部署路：Git -> Docker -> Caddy -> VPS -> data
```

当这三条路都能脱离资料画出来，并且能解释每一步“为什么这样做”，你就已经打下了扎实的全栈理论基础。

