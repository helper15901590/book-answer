# Onboarding Guide: book_answer

## Overview
经典著作与导师人物 AI 思想蒸馏平台。匿名用户可以通过主站浏览书籍、导师和详情，但创建会话、查看历史或发送消息必须登录。管理员后台提供账号、会员、技能、LLM、统计和 MFA。

## Tech Stack
| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript 5.8, Vite 6, Tailwind CSS 4 |
| Backend | Express 4, Node 22 |
| Database | better-sqlite3, WAL, versioned migrations |
| Auth | Server-side sessions, HttpOnly cookies, CSRF, bcrypt, TOTP |
| LLM | OpenAI-compatible DeepSeek / DashScope |
| Operations | Pino, Sentry, Caddy, restic, Docker Compose |

## Architecture
```text
Browser
├── index.html → src/main.tsx → App → AiStudioWorkspace
└── leonchan1590.html → admin-main.tsx → AdminGate → AdminPanel

Express app (server/app.ts)
├── Helmet / rate limit / JSON / Cookie / CSRF
├── routes/auth | skills | chat | admin | config
├── services/quota | llm | security | logger | metrics
└── SQLite: data/commercial.sqlite
```

匿名请求只能访问健康检查、公开配置、公开技能、标签和登录端点。聊天与会话身份完全来自服务端会话，不接受客户端 `userId`。

## Entry Points
| Entry | Purpose |
|---|---|
| `server/index.ts` | 进程启动、Sentry、定时清理、优雅关闭 |
| `server/app.ts` | Express 应用工厂 |
| `server/db.ts` | 数据模型、迁移和持久化 |
| `server/middleware/auth.ts` | 会话、CSRF、用户和管理员鉴权 |
| `server/routes/auth.ts` | 登录、改密 |
| `server/routes/chat.ts` | 登录后聊天和 SSE |
| `server/routes/admin.ts` | 管理员 MFA 与后台操作 |
| `src/components/AiStudioWorkspace.tsx` | 市场与聊天 UI |
| `src/components/AdminGate.tsx` | 管理员密码和 TOTP 登录 |
| `tests/api.test.ts` | 集成测试 |

## Data Model
- `users`：随机 `usr_<UUID>`、强密码哈希、状态、会员与登录安全字段
- `chat_sessions`：按用户隔离的消息 JSON
- `auth_sessions`：仅保存会话令牌哈希，支持即时吊销
- `auth_challenges`：首次改密、管理员 MFA 的短期挑战
- `admin_security`：加密 TOTP secret 与恢复码哈希
- `quota_ledger`：配额预留、消费和退款
- `audit_logs`：管理员敏感操作审计
- `skills` / `system_config`：技能和运行配置

## Key Flows
### 用户登录
1. 管理员创建用户，系统生成 16 字符临时密码并只显示一次。
2. 用户首次登录只得到短期改密挑战。
3. 用户设置至少 6 位的长期密码（不强制字符组合，界面实时提示强度与风险）。
4. 服务端创建 30 天滚动会话，Cookie 使用 HttpOnly、SameSite=Strict 和生产 Secure。
5. 改密、重置密码或禁用账号会撤销全部旧会话。

### 聊天
1. `/api/chat/stream` 必须携带有效用户 Cookie 和 CSRF Token。
2. 服务端按当前用户查询会话，未知或非本人会话返回 404。
3. 配额通过 `quota_ledger` 原子预留。
4. 上游成功输出后标记消费，失败或首包前中断则退款。
5. 最终回复按当前会话归属保存。

### 管理员
1. 管理员密码至少 16 位且包含字母和数字。
2. 首次登录必须绑定 TOTP，生成 8 个一次性恢复码。
3. 管理员会话固定 8 小时，修改密码或 MFA 后旧会话失效。
4. 敏感操作写入 `audit_logs`。

## Commands
```bash
npm run dev
npm run lint
npm test
npm run build
npm run verify
npm run config:check
CONFIRM_ACCOUNT_RESET=RESET_ACCOUNTS npm run db:reset-accounts
CONFIRM_ADMIN_MFA_RESET=RESET_MFA npm run admin:mfa-reset
```

## Public APIs
- `GET /api/skills` / `GET /api/skills/:id`：只返回 `PublicSkill`
- `POST /api/auth/login`：手机号和密码
- `GET /api/auth/me`：当前用户或 401
- `POST /api/auth/change-password`：修改密码
- `/api/chat/*`：全部要求登录
- `/api/admin/*`：全部要求管理员会话

## Operations
- `docker/`：单机 Compose、Caddy HTTPS、非 root 容器
- `scripts/backup.sh`：SQLite + assets + restic 异地备份
- `scripts/restore.sh`：恢复数据库和素材
- `scripts/verify-backup.sh`：恢复前完整性检查
- `docs/deploy.md`：生产部署、MFA、备份与上线检查

## Conventions
- 注释和 UI 文案使用中文；普通文件 camelCase，React 组件 PascalCase。
- API 错误返回包含明确 `error` / `message`。
- 不记录密码、Cookie、API Key 或完整敏感请求体。
- 公开 DTO 与后台完整模型分离。
- SQLite 仅支持单实例；扩容前需迁移 PostgreSQL / Redis / 对象存储。