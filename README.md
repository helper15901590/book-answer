# 问书（book_answer）

经典著作与导师人物 AI 思想蒸馏平台。管理员上传书籍 / 导师的蒸馏文档（skill.md），平台将其转化为可对话的 AI 化身；匿名用户可浏览市场与详情，支持手机号 + 密码自助注册，发起对话必须登录。会员由管理员手工开通，暂不接入在线支付。

## 功能特性

- **书籍广场 / 导师广场 / 文化广场**（内部类型 `reliable`）：分类、搜索、热度排行、详情页，20 张/批分页加载
- **关注列表**：登录后可关注任意技能卡片，关注关系服务端持久化，集中查看已关注内容
- **AI 对话**：SSE 流式输出、按书隔离的会话历史、基于原著内容的推荐追问（由大模型从 skill.md 提炼）；对话列表支持单条删除与一键清空
- **面对面语音对话**：AI 回复逐句交给 DashScope 语音合成（CosyVoice HTTP / Qwen-Omni Realtime 复刻音色），16:9 全屏沉浸界面，与「书信」文字模式共用同一会话；**仅「文化广场」（内部类型 `reliable`）类技能可用**（书籍 / 导师技能不显示面对面入口）
- **会员与配额**：普通 / 月度 / 季度 / 年度四档，免费按日、付费按自然月重置；上游失败自动退还配额
- **管理后台**（`/admin`）：仪表盘统计、导师书籍管理、标签管理、用户生命周期、会员开通、模型配置与连通性测试、协议配置
- **多语言**：简体中文 / 繁体中文 / 英语，顶栏切换
- **安全**：服务端会话 + HttpOnly Cookie + CSRF 双提交、管理员账号密码登录、API Key AES-256-GCM 加密存储、登录限流与锁定、审计日志

## 技术栈

React 19 + TypeScript 5.8 + Vite 6 + Tailwind CSS 4 / Express 4 / better-sqlite3（WAL）/ ws（Qwen-Omni Realtime）/ 阿里云 DashScope（LLM 与语音合成）/ Pino + Sentry / Docker Compose + Caddy + restic

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

首次进入后台：输入 `ADMIN_PHONE` / `ADMIN_PASSWORD` 即可登录。LLM API Key 可在后台「模型配置」填写，也可通过 `DEEPSEEK_API_KEY` 等环境变量提供。

## 语音合成（面对面）配置

在后台「模型配置 → 语音对话（TTS）」中配置，**不通过环境变量下发**。配置存 `system_config` 的 `tts_config`，DashScope API Key 用 `APP_ENCRYPTION_KEY` 加密落库，管理端只回显 `apiKeyConfigured`，任何接口都不返回明文。

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `enabled` | 语音总开关；关闭后用户端不显示「面对面」入口 | `false` |
| `provider` | 语音引擎：`cosyvoice` 走 HTTP 文本合成（mp3）；`qwen-omni` 走 Realtime WebSocket（wav，用于复刻音色） | `cosyvoice` |
| `apiBaseUrl` | CosyVoice HTTP 地址（`provider=cosyvoice` 时校验） | `https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer` |
| `wsUrl` | Qwen-Omni Realtime 地址（`provider=qwen-omni` 时校验）；控制台若要求业务空间专属域名，填 `wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime` | `wss://dashscope.aliyuncs.com/api-ws/v1/realtime` |
| `model` | 合成模型。**选 qwen-omni 时必须与创建复刻音色时的 `target_model` 完全一致**，否则合成失败 | `cosyvoice-v3-flash` |
| `voice` | 音色 ID：CosyVoice 音色名，或 Qwen-Omni 复刻音色 `qwen-omni-vc-...` | `longlaobo_v3` |
| `apiKey` | DashScope API Key（北京地域）；加密存储，保存后不再回显 | — |

用户端「面对面」入口是否出现，只看公开配置 `voiceModeEnabled`，判定条件是同时满足：`enabled` 为真、Key 有效（非占位值）、`model` 与 `voice` 非空，以及当前引擎所需地址非空（`cosyvoice` 看 `apiBaseUrl`，`qwen-omni` 看 `wsUrl`）。

几点使用约束：

- 复刻音色与 API Key 都绑定 DashScope 业务空间，换空间后需要重新创建音色并更换 Key 与地址，不能直接搬。
- 单次合成文本上限 500 字；前端逐句调用（每句 ≤180 字），按登录用户 120 次/分钟限流。
- Qwen-Omni 只负责「朗读」：回答文字仍由聊天模型生成，逐句交给 Omni 用复刻音色合成；它的朗读契约同时放在 `session.instructions` 与 `response.create.response.instructions`，避免把待朗读的问句当成问题回答。
- 未配置或配置不全时，`/api/tts/synthesize` 返回 `TTS_NOT_CONFIGURED`，用户端只提示语音不可用，文字对话不受影响。

## 常用命令

| 命令 | 用途 |
|------|------|
| `npm run dev` | 开发模式（Vite HMR + Express API） |
| `npm run lint` | 类型检查（含多语言字典完整性） |
| `npm test` | 集成测试（认证、越权、强制改密、子路径、i18n） |
| `npm run build` | 构建前端 + 打包服务端 |
| `npm run verify` | lint + test + build + 生产依赖审计 + 配置检查 |
| `npm run config:check` | 环境变量与数据库健康自检 |
| `npm run db:reset-accounts` | 清空账号数据（需 `CONFIRM_ACCOUNT_RESET=RESET_ACCOUNTS`） |
| `npm run agreements:sync` | 用代码中的协议正文覆盖数据库版本（需 `CONFIRM_AGREEMENT_SYNC=SYNC`） |
| `npm run load:test` | autocannon 容量测试 |

## 项目结构

| 路径 | 职责 |
|------|------|
| `server/app.ts` | Express 应用装配（安全中间件顺序、路由、静态资源、子路径挂载） |
| `server/db.ts` | SQLite schema、迁移与自检、账号 / 会话 / 配额 / 统计 |
| `server/middleware/auth.ts` | 会话解析、CSRF、用户 / 管理员鉴权 |
| `server/routes/` | auth（登录、强制改密、注销）、skills、follows（关注）、chat（会话 + SSE）、tts（语音合成）、admin、config |
| `server/services/` | 安全（AES-GCM / 随机令牌）、配额、LLM 调用、语音合成（CosyVoice / Qwen-Omni Realtime）、日志、指标 |
| `src/components/AiStudioWorkspace.tsx` | 用户端：市场与聊天工作区 |
| `src/components/FaceToFaceView.tsx` | 面对面全屏界面（16:9 人物舞台 + 对话面板） |
| `src/lib/useVoicePlayback.ts` | 逐句语音播放队列（预取、重试、当前朗读字幕） |
| `src/components/AdminGate.tsx` / `AdminPanel.tsx` | 管理后台：登录门控与面板 |
| `src/i18n/` | 多语言字典、取值、服务端错误码翻译 |
| `tests/` | vitest + supertest 集成测试 |
| `docker/` `scripts/` `docs/` | 部署、备份、冒烟与运维文档 |

## 核心约定（开发前必读）

- **编码规范以 [AGENTS.md](AGENTS.md) 为准**（YAGNI、最少代码、精准修改、中文注释、强类型），项目结构与命令见 [CLAUDE.md](CLAUDE.md)。
- 支持手机号 + 密码自助注册（注册即登录，默认普通会员）；管理员仍可在后台建号并强制首登改密。忘记密码无自助找回，界面提示联系管理员。改密、重置密码、禁用账号必须撤销已有会话。
- **会员到期时间两种口径不可混用**：后台配置等级以当前时间重新起算；升级 / 续费在原有效期上顺延。会员不支持主动降级。
- 公开技能接口只返回 `PublicSkill`，绝不暴露 `systemPrompt`；LLM API Key 永不回传前端明文；上游失败必须退还预留配额。
- 语音合成配置存 `system_config.tts_config`，DashScope Key 加密存储、管理端只回显 `apiKeyConfigured`；Qwen-Omni 复刻音色必须与创建时的 `target_model` 一致；「面对面」与「书信」共用同一会话，切换会话 / 模式或发送新消息必须中止旧语音。
- **多语言**：简体中文是唯一权威源，改文案只动 `src/i18n/locales/zh-CN.ts`，`en.ts` / `zh-TW.ts` 必须同步补齐（漏键 `npm run lint` 即失败）。书名、作者、分类、协议正文属数据，不翻译。
- 服务端错误返回错误码，用户端按码翻译（`src/i18n/serverMessage.ts`）；管理后台不做多语言。

## 部署与运维

生产部署（Docker Compose + Caddy HTTPS + restic 异地备份）、管理员登录与备份恢复见 [docs/deploy.md](docs/deploy.md)。

当前边界：单实例部署（SQLite 同步写，不支持多副本）；不包含在线支付；会员由管理员手工开通。更多细节见 [docs/ONBOARDING.md](docs/ONBOARDING.md)（架构与数据模型）与 [docs/FULLSTACK_BEGINNER_GUIDE.md](docs/FULLSTACK_BEGINNER_GUIDE.md)（零基础全栈教材）。
