# CLAUDE.md — 项目指令

> 编码规范以 `AGENTS.md` 为准（YAGNI、最少代码、精准修改、强类型、中文注释）。本文件补充项目结构与命令。

## 项目简介
「Remix AI」是经典著作与导师人物 AI 思想蒸馏平台。匿名用户可浏览市场和技能详情，但发起对话必须登录；会员与账号由管理员手工开通，暂不接入在线支付。

## 技术栈
- 前端：React 19 + TypeScript 5.8 + Vite 6 + Tailwind CSS 4
- 后端：Express 4，`server/app.ts` 提供可测试应用工厂
- 数据库：better-sqlite3，WAL，版本化迁移，账号数据可重置
- 认证：服务端随机会话 + HttpOnly Cookie + CSRF 双提交；用户强密码，管理员 TOTP + 恢复码
- 密钥：LLM API Key 使用 `APP_ENCRYPTION_KEY` 做 AES-256-GCM 加密
- 日志：Pino 结构化日志 + 可选 Sentry
- 部署：单实例 Docker Compose + Caddy HTTPS + restic 异地备份

## 常用命令
- 开发：`npm run dev`
- 类型检查：`npm run lint`
- 测试：`npm test`
- 构建：`npm run build`
- 完整验证：`npm run verify`
- 配置检查：`npm run config:check`
- 清空账号：`CONFIRM_ACCOUNT_RESET=RESET_ACCOUNTS npm run db:reset-accounts`
- 重置管理员 MFA：`CONFIRM_ADMIN_MFA_RESET=RESET_MFA npm run admin:mfa-reset`
- 容量测试：`BASE_URL=https://域名/api/health CONNECTIONS=50 DURATION=30 npm run load:test`

## 环境变量
`NODE_ENV`、`PORT`、`DATA_DIR`、`APP_ORIGIN`、`APP_ENCRYPTION_KEY`、`TRUST_PROXY`、`ADMIN_PHONE`、`ADMIN_PASSWORD`、LLM 配置、Sentry/restic/S3 配置。生产环境缺少 `APP_ORIGIN`、`APP_ENCRYPTION_KEY`、管理员强凭证时拒绝启动。项目不再使用 JWT。

## 项目结构
| 路径 | 职责 |
|------|------|
| `server/index.ts` | 进程启动、Sentry、优雅关闭 |
| `server/app.ts` | Express 应用装配、Helmet/CSP、限流、Cookie/CSRF、路由 |
| `server/db.ts` | SQLite schema、迁移、账号、会话、配额、注销与统计 |
| `server/middleware/auth.ts` | Cookie 会话解析、CSRF、用户/管理员鉴权 |
| `server/routes/auth.ts` | 登录、强制改密、导出、注销申请 |
| `server/routes/chat.ts` | 登录后才能访问的会话与 SSE 对话 |
| `server/routes/admin.ts` | 管理员 MFA、用户生命周期、技能、配置和统计 |
| `server/services/security.ts` | AES-GCM、随机令牌、TOTP、恢复码 |
| `src/components/AiStudioWorkspace.tsx` | 公开市场与登录后聊天工作区 |
| `src/components/AdminGate.tsx` | 管理员密码 + TOTP 登录门控 |
| `src/components/AdminPanel.tsx` | 后台管理面板 |
| `tests/api.test.ts` | 认证、越权、MFA、强制改密集成测试 |

## 约定
- 匿名用户只能浏览公开内容；聊天、会话和配额接口必须使用服务端认证身份。
- 禁止接受客户端传入的 `userId` 作为身份，禁止把登录态写进 `localStorage`。
- 公开技能接口必须使用 `PublicSkill`，不得暴露 `systemPrompt`、`bookContent`、`catalogContent`。
- 用户密码至少 12 位且含字母和数字；管理员密码至少 16 位且含字母和数字。
- 改密、重置密码和禁用账号必须撤销已有会话。
- LLM 上游失败必须退还预留配额；API Key 永不返回前端明文。
- 运行数据、`.env`、SQLite、备份和上传素材严禁提交。