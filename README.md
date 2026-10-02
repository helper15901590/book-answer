# 问书（book_answer）

经典著作与导师人物 AI 思想蒸馏平台。管理员上传书籍 / 导师的蒸馏文档（skill.md），平台将其转化为可对话的 AI 化身；匿名用户可浏览市场与详情，发起对话必须登录。会员由管理员手工开通，暂不接入在线支付。

## 功能特性

- **书籍广场 / 导师广场**：分类、搜索、热度排行、详情页，20 张/批分页加载
- **AI 对话**：SSE 流式输出、按书隔离的会话历史、基于原著内容的推荐追问（由大模型从 skill.md 提炼）
- **会员与配额**：普通 / 月度 / 季度 / 年度四档，免费按日、付费按自然月重置；上游失败自动退还配额
- **管理后台**（`/admin`）：仪表盘统计、导师书籍管理、标签管理、用户生命周期、会员开通、模型配置与连通性测试、协议配置
- **多语言**：简体中文 / 繁体中文 / 英语，顶栏切换
- **安全**：服务端会话 + HttpOnly Cookie + CSRF 双提交、管理员 TOTP + 恢复码、API Key AES-256-GCM 加密存储、登录限流与锁定、审计日志

## 技术栈

React 19 + TypeScript 5.8 + Vite 6 + Tailwind CSS 4 / Express 4 / better-sqlite3（WAL）/ Pino + Sentry / Docker Compose + Caddy + restic

## 快速开始

前置：Node.js 22、npm。

```bash
npm install
cp .env.example .env.local
```

在 `.env.local` 中至少配置（完整模板见 `.env.example`）：

```dotenv
APP_ORIGIN=http://localhost:3000
APP_ENCRYPTION_KEY=<openssl rand -base64 32 的结果>
ADMIN_PHONE=13800000000
ADMIN_PASSWORD=AdminPass12345678!
```

启动：

```bash
npm run dev
```

| 入口 | 地址 |
|------|------|
| 用户端 | `http://localhost:3000/bookanswer/` |
| 管理后台 | `http://localhost:3000/bookanswer/admin` |
| 健康检查 | `http://localhost:3000/bookanswer/api/health` |

> 整个应用默认挂载在 `/bookanswer` 子路径下（子路径部署，前缀唯一配置点在仓库根 [basePath.ts](basePath.ts)，同时作用于 Vite 构建与运行时挂载）。改该文件后重启 `npm run dev` 即换前缀；置空则回落到根路径。

首次进入后台：输入 `ADMIN_PHONE` / `ADMIN_PASSWORD`，按提示绑定 TOTP 并保存一次性恢复码。LLM API Key 可在后台「模型配置」填写，也可通过 `DEEPSEEK_API_KEY` 等环境变量提供。

## 常用命令

| 命令 | 用途 |
|------|------|
| `npm run dev` | 开发模式（Vite HMR + Express API） |
| `npm run lint` | 类型检查（含多语言字典完整性） |
| `npm test` | 集成测试（认证、越权、MFA、强制改密、子路径、i18n） |
| `npm run build` | 构建前端 + 打包服务端 |
| `npm run verify` | lint + test + build + 生产依赖审计 + 配置检查 |
| `npm run config:check` | 环境变量与数据库健康自检 |
| `npm run db:reset-accounts` | 清空账号数据（需 `CONFIRM_ACCOUNT_RESET=RESET_ACCOUNTS`） |
| `npm run admin:mfa-reset` | 重置管理员 MFA（需 `CONFIRM_ADMIN_MFA_RESET=RESET_MFA`） |
| `npm run agreements:sync` | 用代码中的协议正文覆盖数据库版本（需 `CONFIRM_AGREEMENT_SYNC=SYNC`） |
| `npm run load:test` | autocannon 容量测试 |

## 项目结构

| 路径 | 职责 |
|------|------|
| `server/app.ts` | Express 应用装配（安全中间件顺序、路由、静态资源、子路径挂载） |
| `server/db.ts` | SQLite schema、迁移与自检、账号 / 会话 / 配额 / 统计 |
| `server/middleware/auth.ts` | 会话解析、CSRF、用户 / 管理员鉴权 |
| `server/routes/` | auth（登录、强制改密、注销）、skills、chat（会话 + SSE）、admin、config |
| `server/services/` | 安全（AES-GCM / TOTP）、配额、LLM 调用、日志、指标 |
| `src/components/AiStudioWorkspace.tsx` | 用户端：市场与聊天工作区 |
| `src/components/AdminGate.tsx` / `AdminPanel.tsx` | 管理后台：登录门控与面板 |
| `src/i18n/` | 多语言字典、取值、服务端错误码翻译 |
| `tests/` | vitest + supertest 集成测试 |
| `docker/` `scripts/` `docs/` | 部署、备份、冒烟与运维文档 |

## 核心约定（开发前必读）

- **编码规范以 [AGENTS.md](AGENTS.md) 为准**（YAGNI、最少代码、精准修改、中文注释、强类型），项目结构与命令见 [CLAUDE.md](CLAUDE.md)。
- 账号不开放自助注册，由管理员创建；用户首次登录强制改密。改密、重置密码、禁用账号必须撤销已有会话。
- **会员到期时间两种口径不可混用**：后台配置等级以当前时间重新起算；升级 / 续费在原有效期上顺延。会员不支持主动降级。
- 公开技能接口只返回 `PublicSkill`，绝不暴露 `systemPrompt`；LLM API Key 永不回传前端明文；上游失败必须退还预留配额。
- **多语言**：简体中文是唯一权威源，改文案只动 `src/i18n/locales/zh-CN.ts`，`en.ts` / `zh-TW.ts` 必须同步补齐（漏键 `npm run lint` 即失败）。书名、作者、分类、协议正文属数据，不翻译。
- 服务端错误返回错误码，用户端按码翻译（`src/i18n/serverMessage.ts`）；管理后台不做多语言。

## 部署与运维

生产部署（Docker Compose + Caddy HTTPS + restic 异地备份）、管理员 MFA 操作与备份恢复见 [docs/deploy.md](docs/deploy.md)。

当前边界：单实例部署（SQLite 同步写，不支持多副本）；不包含在线支付；会员由管理员手工开通。更多细节见 [docs/ONBOARDING.md](docs/ONBOARDING.md)（架构与数据模型）与 [docs/FULLSTACK_BEGINNER_GUIDE.md](docs/FULLSTACK_BEGINNER_GUIDE.md)（零基础全栈教材）。
