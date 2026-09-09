# Onboarding Guide: Remix Remix 0.991

> 经典著作 AI 思想蒸馏平台 — 用户与书籍 AI 导师（如《三体》《穷查理宝典》）对话，含会员配额体系与后台管理。

## Tech Stack

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| Language | TypeScript | 5.8 | 前后端统一，强类型 |
| Frontend | React | 19 | + Vite 6 构建 |
| CSS | Tailwind CSS | 4 | 通过 `@tailwindcss/vite` 插件集成 |
| Icons | lucide-react | 0.546 | |
| Animation | motion | 12 | |
| Backend | Express | 4 | 模块化 `server/` 目录 |
| Database | better-sqlite3 | 13 | WAL 模式，write-through 直写 |
| Auth | jsonwebtoken + bcryptjs | | JWT 7 天有效，6 位数字密码 |
| Rate Limit | express-rate-limit | 8 | 全局 300/min/IP，登录 10/min |
| LLM | OpenAI 兼容接口 | | DeepSeek 或阿里 DashScope 二选一 |
| Build (FE) | Vite | 6 | 多页构建：index.html + admin.html |
| Build (BE) | esbuild | 0.25 | → `dist-server/server.cjs` |
| Runtime | tsx (dev) / Node (prod) | | `tsx server/index.ts` |

## Architecture

**全栈单体应用**，Express 同时服务 API 与前端静态资源。前端为**多页应用 (MPA)**：

```
┌─────────────────────────────────────────────────────┐
│                    Browser                          │
│  ┌──────────────────┐   ┌─────────────────────────┐ │
│  │  index.html      │   │  admin.html             │ │
│  │  (用户主界面)     │   │  (管理后台 /admin)       │ │
│  │  main.tsx → App  │   │  admin-main.tsx → Gate  │ │
│  └────────┬─────────┘   └───────────┬─────────────┘ │
└───────────┼─────────────────────────┼───────────────┘
            │  /api/*  (REST JSON)    │
            │  /api/chat/stream (SSE) │
┌───────────▼─────────────────────────▼───────────────┐
│                   Express Server                     │
│  helmet → rateLimit → json → authMiddleware          │
│  ┌─────────────────────────────────────────────────┐ │
│  │  routes/auth     routes/skills   routes/chat    │ │
│  │  routes/admin    routes/config                  │ │
│  └───────────┬─────────────────────────────────────┘ │
│  ┌───────────▼─────────────────────────────────────┐ │
│  │  services/quota   services/llm/*   services/ids │ │
│  │  services/metrics  services/adminSeed           │ │
│  └───────────┬─────────────────────────────────────┘ │
│  ┌───────────▼──────────────┐  ┌──────────────────┐ │
│  │  db.ts (better-sqlite3)  │  │  上游 LLM API    │ │
│  │  → data/commercial.sqlite│  │  DeepSeek/DashScope│ │
│  └──────────────────────────┘  └──────────────────┘ │
└──────────────────────────────────────────────────────┘
```

**Dev 模式**：Vite 以 middleware 模式嵌入 Express，支持 HMR。
**Prod 模式**：Vite 构建到 `dist/`，esbuild 打包 server 到 `dist-server/server.cjs`，Express 直出静态文件。

## Key Entry Points

| Entry | Path | Purpose |
|-------|------|---------|
| Server | `server/index.ts` | Express 装配：中间件 → 路由 → Vite/静态 → 优雅关闭 |
| Config | `server/config.ts` | 环境变量（dotenv）、JWT_SECRET fail-fast、DATA_DIR |
| Database | `server/db.ts` | `CommercialSQLDatabase` 类：建表、索引、种子、CRUD |
| User Frontend | `src/main.tsx` | React 入口 → `App.tsx` |
| Admin Frontend | `src/admin-main.tsx` | AdminGate 验证 → AdminPanel |
| Shared Types | `src/types.ts` | 前后端共用的接口、枚举、工具函数 |
| Seed Data | `src/data/initialData.ts` | 种子书籍（INITIAL_SKILLS）、游客用户、默认配置 |

## Directory Map

| Path | Purpose |
|------|---------|
| `server/index.ts` | Express 装配入口：helmet/限流/静态资源/Vite 集成/优雅关闭 |
| `server/config.ts` | 环境变量读取（JWT_SECRET fail-fast、DATA_DIR、TRUST_PROXY） |
| `server/db.ts` | 数据库层：建表、迁移、种子、write-through CRUD |
| `server/middleware/auth.ts` | JWT 解析、`sanitizeUser`（剥离密码）、`AuthRequest` 类型扩展 |
| `server/middleware/admin.ts` | `requireAdmin` 中间件 |
| `server/routes/auth.ts` | 登录/登出/身份查询（`/api/auth/*`） |
| `server/routes/skills.ts` | 书籍列表/详情（`/api/skills/*`） |
| `server/routes/chat.ts` | 会话管理 + SSE 流式/同步聊天（`/api/chat/*`） |
| `server/routes/admin.ts` | 后台 CRUD：用户/书籍/订单/LLM 配置/标签/统计 |
| `server/routes/config.ts` | 公开配置端点（仅返回非敏感字段） |
| `server/services/quota.ts` | 多级配额引擎：`checkAndConsumeQuota` |
| `server/services/llm/sanitize.ts` | LLM 请求清洗：API Key 消毒、消息消毒、URL 解析 |
| `server/services/llm/questions.ts` | 推荐追问生成 |
| `server/services/metrics.ts` | 运行时指标（SSE 连接数、请求计数、在线用户） |
| `server/services/ids.ts` | `newUserId`：`usr_` + 10 位顺序号生成 |
| `server/services/adminSeed.ts` | 启动时校验管理员凭证、清理历史管理员行 |
| `src/App.tsx` | 根组件：用户/技能/LLM 配置状态，tab 切换刷新 |
| `src/components/AiStudioWorkspace.tsx` | 主界面：书籍市场 + 聊天工作区（AI Studio 风格） |
| `src/components/AdminPanel.tsx` | 后台面板：用户/技能/订单/LLM 配置/标签/统计/仪表盘 |
| `src/components/AdminGate.tsx` | 后台鉴权门控 |
| `src/components/LoginModal.tsx` | 登录弹窗（注册端点已移除） |
| `src/components/MembershipModal.tsx` | 会员订阅弹窗 |
| `src/components/BookDetailModal.tsx` | 书籍详情弹窗 |
| `src/components/SkillCard.tsx` | 书籍卡片 |
| `src/components/MarkdownMessage.tsx` | Markdown 渲染的聊天消息 |
| `src/lib/apiFetch.ts` | 前端统一 fetch 封装 |
| `src/lib/guestQuota.ts` | 游客本地配额管理（localStorage） |
| `docker/` | Dockerfile（多阶段 bookworm-slim）、compose.yaml、Caddyfile.template |
| `data/` | 运行时数据（gitignore）：sqlite + assets/ + backups/ |
| `scripts/` | 运维脚本（备份、冒烟测试等） |
| `docs/` | 文档 |

## Data Tables

| Table | Purpose |
|-------|---------|
| `users` | 用户档案（id=`usr_`+序号、手机号、bcrypt 密码、会员等级、配额计数） |
| `skills` | 书籍/导师（标题、作者、systemPrompt、原文摘录、标签、统计） |
| `chat_sessions` | 聊天会话（用户归属、消息数组 JSON 序列化） |
| `orders` | 订单日志（tradeNo、金额、状态） |
| `system_config` | KV 配置（tags、llm_config） |

## Request Lifecycle: 一次聊天请求

```
POST /api/chat/stream
    │
    ├── authMiddleware
    │   └── extractUserFromRequest() → JWT 解析 → db.getUserById() → req.user
    │
    ├── chatLimiter（未认证限流 10/min/IP，已认证跳过）
    │
    ├── asyncHandler 包裹（兜底异常处理）
    │
    ├── validateChatBody()（入参校验：类型、长度）
    │
    ├── 会话归属校验（session.userId !== currentUser.id → 403）
    │
    ├── db.getLLMConfig()（数据库优先 → 环境变量兜底）
    │   └── isInvalidOrPlaceholderKey() → 503
    │
    ├── checkAndConsumeQuota(user, skill, config)
    │   └── 按会员等级判定 → 401/403/429
    │
    ├── 用户消息入库（session.messages.push → saveChatSession）
    │
    ├── sanitizeMessagesForLLM()（消息消毒）
    │
    ├── SSE Headers（text/event-stream, X-Accel-Buffering: no）
    │
    ├── fetch(upstream LLM API, stream: true)
    │   └── AbortController（客户端断连 → abort 上游）
    │   └── 逐 chunk 推送 writeSSE({delta, fullText})
    │
    ├── assistant 完整回复入库
    │
    └── writeSSE({done, assistantMessage, session, user})
```

## Membership & Quota

五级会员体系，配额引擎在 `services/quota.ts`：

| Tier | Label | Default Quota | Reset Cycle |
|------|-------|--------------|-------------|
| `guest` | 游客 | 3 次/日 | 每日零点 |
| `free_member` | 普通会员 | 10 次/日 | 每日零点 |
| `monthly_member` | 月度会员 | 100 次/月 | 每月 1 日 |
| `quarterly_member` | 季度会员 | 200 次/月 | 每月 1 日 |
| `yearly_member` | 年度会员 | 500 次/月 | 每月 1 日 |

管理员（`admin` 角色）不受配额限制。配额上限可在后台 `llm_config.dailyLimits` 中调整。

## Auth & Security

- **管理员身份不入库**：凭证来自环境变量（`ADMIN_PHONE`/`ADMIN_PASSWORD`），JWT 中合成虚拟身份
- **前台登录拒绝管理员手机号**：一律返回「账号不存在」
- **后台独立登录端点**：`/api/admin/login`，直比环境变量
- **密码**：bcryptjs 哈希存储，6 位数字格式
- **JWT**：7 天有效期，HS256 签名
- **安全头**：helmet（CSP 关闭，避免破坏内联样式与外链封面）
- **限流**：全局 300/min，登录 10/min，未认证聊天 10/min

## Conventions

- **提交格式**：conventional commits（`feat(scope):`, `fix(scope):`, `refactor(scope):`）
- **语言**：代码注释与 UI 文案统一使用中文
- **API 返回**：统一 JSON — 成功 `{ success, data }` / 失败 `{ error, message }`（中文提示）
- **文件命名**：camelCase（`apiFetch.ts`），React 组件 PascalCase（`AdminPanel.tsx`）
- **时区**：配额日界使用服务器本地时区（`getTodayString()`），禁止 UTC 口径
- **数据库**：单例 write-through（`db.ts` 底部 `export const db = new CommercialSQLDatabase()`）
- **前后端共享**：`src/types.ts` 和 `src/data/initialData.ts` 被 server 直接 import

## Common Tasks

| Task | Command |
|------|---------|
| 开发启动 | `npm run dev` |
| 构建生产包 | `npm run build` |
| 生产启动 | `npm start` |
| 类型检查 | `npm run lint` |
| 清理构建产物 | `npm run clean` |

## Environment Variables (`.env.local` / `.env`)

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `JWT_SECRET` | ✅ 必填 | — | ≥16 字符，缺失拒绝启动 |
| `ADMIN_PHONE` | 后台登录需要 | — | 管理员手机号 |
| `ADMIN_PASSWORD` | 后台登录需要 | — | 6 位数字 |
| `PORT` | 否 | `3000` | 监听端口 |
| `DATA_DIR` | 否 | `./data` | 运行数据根目录 |
| `TRUST_PROXY` | 否 | `0` | 反代时置 1 |
| `DEEPSEEK_API_KEY` | LLM 需要 | — | 或后台配置存数据库 |
| `DEEPSEEK_BASE_URL` | 否 | `https://api.deepseek.com/v1` | 或阿里 DashScope URL |
| `DEEPSEEK_MODEL` | 否 | `deepseek-chat` | 或 `qwen-max` 等 |

## Where to Look

| I want to... | Look at... |
|--------------|-----------|
| 新增 API 端点 | `server/routes/` 对应模块，`registerXxxRoutes(app)` 模式 |
| 修改聊天/流式逻辑 | `server/routes/chat.ts` + `services/llm/sanitize.ts` |
| 调整配额规则 | `server/services/quota.ts` + `types.ts:DailyLimitsConfig` |
| 增加数据表/字段 | `server/db.ts` 的 `createTables()` + 对应 map 函数 |
| 修改前端 UI | `src/components/AiStudioWorkspace.tsx`（主界面） |
| 修改后台管理 | `src/components/AdminPanel.tsx` |
| 调整共享类型 | `src/types.ts`（前后端共用） |
| 修改种子书籍 | `src/data/initialData.ts` |
| 部署/容器化 | `docker/` 目录 |
| 修改环境变量 | `.env.example` + `server/config.ts` |

## LLM Integration

**单路径架构**（Gemini 备用与离线模板兜底已移除）：

1. API Key 来源优先级：数据库 `llm_config` → 环境变量 `DEEPSEEK_API_KEY`
2. 未配置 → 返回 503（不伪造回复，不浪费用户配额）
3. 上游失败 → 返回明确错误信息
4. 支持 DeepSeek 和阿里云百炼（DashScope），均为 OpenAI 兼容接口
5. 流式（SSE）和同步（JSON）两种调用模式

## Deployment

- **Docker**：多阶段构建（bookworm-slim）
- **Compose**：app + Caddy（可选 HTTPS profile）
- **Caddy**：反向代理 + 自动 TLS
- **持久化**：`data/` 目录挂载持久卷
- **优雅关闭**：SIGTERM/SIGINT → 停止接流 → 关闭数据库
