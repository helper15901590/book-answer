# CLAUDE.md — 项目指令

> 编码规范以 `AGENTS.md` 为准（YAGNI、最少代码、精准修改、强类型、中文注释）。本文件补充项目结构与命令。

## 项目简介
「book_answer」是经典著作与导师人物 AI 思想蒸馏平台。匿名用户可浏览市场和技能详情，但发起对话必须登录；会员与账号由管理员手工开通，暂不接入在线支付。

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
| `server/db.ts` | SQLite schema、迁移、账号、会话、配额与统计 |
| `server/middleware/auth.ts` | Cookie 会话解析、CSRF、用户/管理员鉴权 |
| `server/routes/auth.ts` | 登录、强制改密 |
| `server/routes/chat.ts` | 登录后才能访问的会话与 SSE 对话 |
| `server/routes/admin.ts` | 管理员 MFA、用户生命周期、技能、配置和统计 |
| `server/services/security.ts` | AES-GCM、随机令牌、TOTP、恢复码 |
| `src/components/AiStudioWorkspace.tsx` | 公开市场与登录后聊天工作区 |
| `src/components/AdminGate.tsx` | 管理员密码 + TOTP 登录门控 |
| `src/components/AdminPanel.tsx` | 后台管理面板 |
| `tests/api.test.ts` | 认证、越权、MFA、强制改密集成测试 |
| `src/i18n/` | 用户端多语言：基准字典、取值与语言切换（见下方约定） |

## 约定
- 匿名用户只能浏览公开内容；聊天、会话和配额接口必须使用服务端认证身份。
- 禁止接受客户端传入的 `userId` 作为身份，禁止把登录态写进 `localStorage`。
- 公开技能接口必须使用 `PublicSkill`，不得暴露 `systemPrompt`（它就是提示词本体，也是唯一的内容字段）。
- 用户密码至少 6 位（不强制字符组合，前端提示强度与风险）；管理员密码至少 16 位且含字母和数字。
- 改密、重置密码和禁用账号必须撤销已有会话。
- 会员到期时间有两种口径，不可混用：**后台配置等级**（建号、编辑用户）一律以当前时间为基准重新起算；**升级/续费**（`/api/admin/users/upgrade-tier`）在原有效期上顺延，不吞掉用户已付费的剩余时长。
- 会员**不支持主动降级**：低于当前档位的卡片只显示「已包含」，不提供任何降级入口。购买动作由 `membershipActionFor()` 统一判定（开通 / 续费 / 升级 / 已包含）。
- LLM 上游失败必须退还预留配额；API Key 永不返回前端明文。
- 运行数据、`.env`、SQLite、备份和上传素材严禁提交。
- **多语言（用户端）**：支持简体中文 / 繁体中文 / 英语，切换器在顶栏右上角。**简体中文是唯一权威源**——
  - 新增或修改界面文案：只改 `src/i18n/locales/zh-CN.ts`，然后 `en.ts` 与 `zh-TW.ts` **必须同步补齐**；漏任何一个键，`npm run lint` 会直接报 `missing property` 编译失败。
  - **例外**：注销确认短语的值定义在 `src/i18n/deleteAccountPhrase.ts`，三份字典与服务端共用同一份常量——服务端只引这个叶子模块，避免为了三条短语把整份字典打进服务端 bundle。`tests/i18n.test.ts` 会校验两边逐条一致。
  - 迭代英文文案：**只改 `en.ts` 里的值，键名与结构永远不要动**，这样不会牵动其他语言。
  - 组件里一律用 `t('分组.键名')` 取值，键名拼错会在编译期报错；带变量的文案写成 `{name}` 占位符并通过第二个参数传入。
  - 字典内不要放数组；需要列表时用 `q1/q2/q3` 独立键。
  - **属于「数据」而非「界面」的内容不翻译**：书名、作者、分类标签、协议正文、用户昵称。它们由后台维护，翻译会导致前后台不一致。
  - **管理后台不做多语言**，保持全中文。
  - 服务端错误一律返回错误码（`error` 字段），中文 `message` 仅作兼容与日志；用户端按码查 `src/i18n/serverMessage.ts` 的映射表翻译，未知码才回退 message。
  - `tests/i18n.test.ts` 会校验三种语言的键集合、空文案与占位符一致性，改动字典后请一并运行。