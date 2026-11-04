# 二次开发手册（DEV_HANDBOOK）

> 面向接手本项目的开发者：读完本文应能独立完成环境搭建、定位任意功能对应的代码、判断改动的影响面，并避开项目里已经踩过的坑。
> 配套阅读：[ONBOARDING.md](ONBOARDING.md)（架构速览）、[deploy.md](deploy.md)（部署运维）、[FULLSTACK_BEGINNER_GUIDE.md](FULLSTACK_BEGINNER_GUIDE.md)（零基础教材）。
> 编码规范以根目录 [AGENTS.md](../AGENTS.md) 为准，项目结构与命令以 [CLAUDE.md](../CLAUDE.md) 为准，本文不重复二者已有内容，只补充「代码是怎么组织的、改动该落在哪、哪里不能碰」。

---

## 1. 项目定位与业务边界

「问书（book_answer）」把书籍 / 导师的蒸馏文档（本质是一段 `systemPrompt`）包装成可对话的 AI 化身。匿名用户可以浏览书籍广场、导师广场、分类、搜索、详情；**发起对话、查看历史、消耗配额必须登录**。支持手机号 + 密码自助注册（注册即登录，默认普通会员）；管理员仍可在后台建号并手工开通会员，当前**没有在线支付**。忘记密码无自助找回，界面提示联系管理员。

四个业务角色：匿名访客（只读公开接口）、普通用户（登录后聊天）、管理员（后台全部能力）、LLM 上游（OpenAI 兼容接口，DeepSeek 为默认）。

当前部署形态是**单实例**：一台机器、一个 Node 进程、一个 SQLite 文件（WAL）。这是硬边界——所有涉及多副本、多进程共享状态的扩展（不止数据库，还包括限流计数、在线用户统计、管理员登录失败计数）都需要先做架构改造。

---

## 2. 本地运行与构建

前置 Node.js 22。首次启动：

```bash
npm install
cp .env.example .env.local     # 至少填 APP_ORIGIN、APP_ENCRYPTION_KEY、ADMIN_PHONE、ADMIN_PASSWORD
npm run dev
```

开发模式下 `server/index.ts` 在 3000 端口起 Express，并以 Vite middleware 模式内嵌前端（HMR 可用），没有独立的前端 dev server。默认入口挂在子路径下：

| 入口 | 地址 |
|------|------|
| 用户端 | `http://localhost:3000/bookanswer/` |
| 管理后台 | `http://localhost:3000/bookanswer/admin`（跳转到 `admin.html`） |
| 健康检查 | `http://localhost:3000/bookanswer/api/health` |

**子路径是全局设计，不是可选项。** 前缀唯一定义在仓库根 `basePath.ts`（默认 `/bookanswer`），构建期由 `vite.config.ts` 的 `base` 消费，运行期由 `server/config.ts` 消费；`server/app.ts` 最后把整个 Express 应用 `root.use(BASE_PATH, app)` 挂到前缀下。环境变量 `BASE_PATH` 只作为测试注入口存在。改前缀只需改 `basePath.ts` 并重新构建，但注意同步 `docker/.env.example` 的健康检查拼 URL 说明。前端所有请求都经过 `src/lib/apiFetch.ts` 自动补前缀，业务代码里不要手写前缀。

构建产物分两部分：`vite build` 产出 `dist/`（双 HTML 入口：`index.html` 与 `admin.html`），`esbuild` 把服务端打包为 `dist-server/server.cjs`（依赖外置）。生产启动 `node dist-server/server.cjs`，Express 静态托管 `dist/`，`/admin` 直接 `sendFile(admin.html)`，其余路径回落 `index.html`。

日常验证链：`npm run lint`（tsc 类型检查，含 i18n 字典完整性）→ `npm test`（vitest + supertest）→ `npm run build` → `npm run audit:prod` → `npm run config:check`，`npm run verify` 是这五步的串联。

---

## 3. 整体架构

```
浏览器
├── index.html  → src/main.tsx  → I18nProvider → App → AiStudioWorkspace（市场/导师/聊天）
└── admin.html  → src/admin-main.tsx → AdminGate → AdminPanel（7 个页签）

Express（server/app.ts 装配，中间件顺序如下）
1. helmet（CSP/HSTS，开发模式放宽 inline/ws）
2. GET /api/health（在限流之前注册，探针不受限）
3. /api 全局限流 300 次/分
4. express.json（5MB）/ cookie-parser / pino-http（redact 敏感字段）
5. /assets 静态目录 + 独立限流 300 次/分
6. 请求计数 → authMiddleware（解析用户/管理员会话）
7. /api 统一 CSRF 校验（豁免表见下）
8. 路由：auth / skills / follows / tts / chat / admin / config
9. Sentry 错误处理 → /api 404 → 静态资源/Vite → BASE_PATH 包装
```

服务端分层很扁：`routes/*` 直接调 `db` 单例与 `services/*`，没有 repository / service 编排层。`server/db.ts` 的 `CommercialSQLDatabase` 类是唯一数据访问入口，约 1160 行，schema、迁移、CRUD、统计都在里面。

前后端共享类型与纯函数集中在一个文件：`src/types.ts`（`UserProfile`、`Skill`、`ChatSession`、`LLMConfig`、会员到期计算等）。服务端从 `../src/types.js` 导入——这是刻意设计，修改共享类型时前后端会同时受编译检查保护。

---

## 4. 目录地图

| 路径 | 职责 | 改动频率 |
|------|------|----------|
| `basePath.ts` | 子路径前缀唯一配置点 | 极低 |
| `server/index.ts` | 进程启动、Sentry、过期会话定时清理、优雅关闭 | 低 |
| `server/config.ts` | 环境变量读取与生产强校验（缺关键变量直接 `process.exit(1)`） | 低 |
| `server/app.ts` | 中间件顺序、路由装配、静态托管、子路径挂载 | 中 |
| `server/db.ts` | schema DDL、迁移/漂移检查、种子数据、全部数据方法 | 高 |
| `server/middleware/auth.ts` | 会话解析、CSRF、`requireUser` / `requireAdmin` | 中 |
| `server/routes/auth.ts` | 用户登录、首登改密、自助注销、me、登出 | 中 |
| `server/routes/chat.ts` | 会话 CRUD、SSE 流式聊天、同步聊天、配额结算 | 高 |
| `server/routes/follows.ts` | 登录后关注/取关与关注列表 | 中 |
| `server/routes/tts.ts` + `server/services/tts.ts` / `omniTts.ts` | 登录后的语音合成（CosyVoice HTTP 或 Qwen-Omni Realtime 复刻音色），管理端配置与试听 | 低 |
| `server/routes/admin.ts` | 管理员登录、用户生命周期、技能/标签、LLM 配置、上传 | 高 |
| `server/routes/skills.ts` | 公开技能列表/详情/点击热度、标签、推荐问提炼 | 中 |
| `server/routes/config.ts` | 公开配置（额度、套餐、协议、口令策略） | 低 |
| `server/services/security.ts` | AES-256-GCM、随机令牌、用户 ID | 低 |
| `server/services/quota.ts` | 配额预留/结算的业务封装 | 中 |
| `server/services/llm/` | 推荐问生成、消息清洗、API Key/URL 规整 | 中 |
| `src/App.tsx` | 用户端根组件：用户态、公开配置、技能列表的加载与刷新 | 中 |
| `src/components/AiStudioWorkspace.tsx` | 用户端全部 UI 与交互（广场、关注列表、聊天；1600+ 行） | 高 |
| `src/components/PlazaView.tsx` + `src/lib/usePlazaController.ts` | 书籍 / 导师 / 文化（`reliable`）三广场共用的视图壳与筛选分页状态 | 中 |
| `src/components/FaceToFaceView.tsx` + `src/lib/useVoicePlayback.ts` | 面对面全屏界面（16:9 人物舞台 + 对话面板）与分句播放队列 | 中 |
| `src/components/AdminPanel.tsx` | 后台全部页签（3100+ 行，见 §9） | 高 |
| `src/i18n/` | 三语字典、`t()` 取值、服务端错误码翻译 | 高（改文案） |
| `src/lib/apiFetch.ts` | fetch 包装：补前缀、带 Cookie、注入 CSRF、`assetSrc`、`tryLogout` | 低 |
| `tests/` | api / i18n / subpath 三组集成测试 | 中 |
| `scripts/` | 配置自检、账号重置、协议同步、压测、备份恢复、冒烟 | 低 |
| `docker/` | Dockerfile、compose（app + 可选 Caddy profile）、Caddyfile 模板 | 低 |

---

## 5. 数据模型

数据库文件 `DATA_DIR/commercial.sqlite`，WAL 模式，`synchronous=NORMAL`，`busy_timeout=5000`，外键开启。共 11 张表：

| 表 | 作用 | 关键点 |
|----|------|--------|
| `users` | 用户账号与会员状态 | `phone` 唯一；`status` 为 active/disabled/deleted；`membership_tier` + `membership_expires_at`；`daily_used_count` + `last_active_date`/`last_active_month` 是配额计数器；`failed_login_attempts`/`locked_until` 是登录锁定 |
| `skills` | 书籍与导师 | `system_prompt` 是提示词本体，**绝不进公开接口**；`tags`/`sample_questions` 存 JSON 字符串；`category` 是主分类；`skill_type` 为 book/mentor；`search_count` 是前台热度 |
| `chat_sessions` | 会话与消息 | `messages` 是整段 JSON 数组；带技能标题/作者/封面的冗余快照；`user_id` 外键级联删除 |
| `user_follows` | 用户关注关系 | 复合主键 `(user_id, skill_id)` 保证幂等；双外键级联：删除用户或技能时自动清理 |
| `orders` | 订单表 | **当前无任何写入路径**，是在线支付功能的预留（见 §12 技术债） |
| `system_config` | KV 配置 | `tags`（JSON 数组）、`llm_config`（含加密后的 API Key、额度、套餐价格、协议正文）、`tts_config`（语音合成开关、模型、音色、加密 Key） |
| `auth_sessions` | 服务端会话 | 只存令牌的 sha256；`csrf_hash` 同时绑定 CSRF 令牌；`auth_version` 用于管理员会话失效；30 天滚动 / 管理员 8 小时 |
| `auth_challenges` | 短期挑战 | 首登改密，10 分钟过期、一次性 |
| `quota_ledger` | 配额账本 | `request_id` 唯一（幂等防重）；状态 reserved → consumed/refunded；`period_key` 用于跨周期退款保护 |
| `audit_logs` | 审计日志 | 管理员敏感操作、登录、注销等；无对外查询接口 |
| `schema_migrations` | 迁移版本 | 目前只有 version 1（旧结构改名让位） |

**Schema 管理机制必须理解**，这是二次开发最容易踩坑的地方：

1. `SCHEMA_DDL`（`server/db.ts` 内静态常量）是 schema 的唯一权威定义，既用于建表，也用于在内存库里还原「期望结构」。
2. 每次启动依次执行 `createTables()`（幂等建表）→ `ensureColumns()` → `createIndices()`。已存在的表不会被 `CREATE TABLE IF NOT EXISTS` 修改，所以**新增列必须同时改两处**：`SCHEMA_DDL` 里的建表语句，以及 `ensureColumns()` 里的 `addedColumns` 登记表（`[表, 列, 完整定义]`）。
3. 如果只在 DDL 里加列而没登记 `addedColumns`，启动时 `checkSchemaDrift()` 会对比内存期望结构与真实库，发现「声明了但库里没有」的列并**直接抛错拒绝启动**——这是刻意的，把运行期 `no such column` 提前到启动期。多列只告警（历史遗留），类型不一致只告警（ALTER 改不动类型）。
4. SQLite 的 `ALTER TABLE ADD COLUMN` 不支持「NOT NULL 且无默认值」和「表达式默认值」；这类列要先加可空列，再 `UPDATE` 回填，或写独立迁移。
5. 种子数据：首次启动插入 `INITIAL_SKILLS` + `INITIAL_MENTORS`、默认标签、默认 LLM 配置。`getSkills()` 在表为空时会回落到种子数据——**这是只读便利**；任何写路径必须用 `getPersistedSkills()`，否则一次保存会把管理员删掉的种子书「复活」进库。

---

## 6. 认证与安全机制

三层身份的判定完全在服务端，客户端只持有 Cookie：

| 层 | 凭据 | 校验 |
|----|------|------|
| 匿名 | 无 | 只能访问 health、公开配置、公开技能、标签、登录端点 |
| 用户 | `book_answer_user_session` HttpOnly Cookie + `book_answer_user_csrf` | 会话令牌 sha256 比对 `auth_sessions`；`requireUser` 还要求 `sessionKind === 'user'` 且账号非 disabled/deleted |
| 管理员 | `book_answer_admin_session` + `book_answer_admin_csrf` | 会话 `auth_version` 必须等于 `sha256(ADMIN_PHONE:ADMIN_PASSWORD)`，修改管理员密码即让旧会话全部失效 |

会话是**服务端随机会话**（非 JWT）：`randomToken()` 32 字节 base64url，数据库只存 sha256，用户会话每次请求滚动续到 30 天后，管理员固定 8 小时。`authMiddleware` 会先按路径决定先解析哪种会话（`/api/admin` 先管理员，其余先用户），两种 Cookie 同时存在时按路径优先。

**CSRF 双提交**：写请求必须同时满足「请求头 `X-CSRF-Token`」与「对应 CSRF Cookie」各自 sha256 后都等于会话的 `csrf_hash`；同时校验 `Origin` 必须与 `APP_ORIGIN` 一致。两类拒绝使用不同错误码：`ORIGIN_REJECTED`（多为 APP_ORIGIN 配错或缺省，属运维问题）与 `CSRF_REJECTED`（Cookie 与会话不匹配，提示用户清 Cookie）。豁免表只有三个前缀：`/api/auth/login`、`/api/auth/change-password`、`/api/admin/login`——注意豁免比对用的是 `BASE_PATH + baseUrl + path` 的完整路径，改前缀时这张表靠 `BASE_PATH` 变量自动对齐，不要硬编码路径。

CSRF Cookie 的 `maxAge` 与会话 Cookie 严格一致（用户 30 天 / 管理员 8 小时）。曾因 CSRF Cookie 是会话级而会话是持久级，浏览器退出后用户永远登不出去（登出请求本身也被 CSRF 拦住）。

**管理员账号不落库**：完全来自环境变量 `ADMIN_PHONE` / `ADMIN_PASSWORD`（生产要求 11 位手机号 + 16 位以上且含字母数字），`buildAdminProfile()` 合成一个虚拟档案。登录仅校验手机号 + 密码，首次登录与后续登录没有区别；修改管理员密码会自动让旧会话失效。

**用户登录**：失败 5 次锁定 15 分钟（持久化在 users 表）；bcrypt 成本因子 10；首登（`must_change_password=1`）不发会话，只发 10 分钟的一次性改密挑战 Cookie；改密成功后旧会话全部撤销并重新签发会话。**自助注册**（`POST /api/auth/register`，5 次/分/IP）成功后直接签发 30 天会话，注册用户默认普通会员、不强制改密；手机号唯一约束兜底并发同号注册。管理员登录失败计数在**进程内存**中（5 次 / 15 分钟），多实例部署会失效。

**加密**：`APP_ENCRYPTION_KEY`（32 字节 base64 或 64 位 hex）驱动 AES-256-GCM，密文格式 `enc:v1:iv:tag:cipher`。LLM API Key 加密落库；日志经 pino redact 屏蔽 Cookie、Authorization、密码、验证码、API Key、上传内容。

**限流**（进程内计数，多实例会分裂）：`/api` 全局 300 次/分、`/assets` 300 次/分、登录 10 次/分、改密 10 次/分、聊天 30 次/分、管理员登录 10 次/分、后台操作 60 次/分、推荐问提炼 10 次/分。

---

## 7. 核心业务流程

### 7.1 首次登录与强制改密

管理员建号时生成 16 位临时密码（只显示一次），`must_change_password=1`。用户登录时服务端只创建 `password_change` 挑战并种 `book_answer_password_change` Cookie，不建会话；`POST /api/auth/change-password` 校验挑战 + 当前密码 + 新密码策略（至少 6 位，不强制组合，前端实时提示强度），成功后撤销该用户全部旧会话、标记挑战已用、重新签发正式会话。登录态下的自助改密入口已移除，该接口只服务于首登场景。自助注册用户（`POST /api/auth/register`）不经过此流程，注册成功即直接登录。

### 7.2 聊天（SSE）

`POST /api/chat/stream` 的完整链路：

1. 校验登录与 `zod` 入参（`sessionId`、可选 `skillId`、`messageText` 最长 4000 字、可选 `requestId`；`userId` 被 `z.infer` 明令禁止）。
2. `resolveSession()`：按「当前用户 + sessionId」取会话；若该 id 存在但不属于本人 → 409 `SESSION_CONFLICT`（否则后续 upsert 会覆盖他人会话）；不存在则构造内存中的新会话，**不落库**（避免被拒绝的请求留下空会话）。
3. 读取 `db.getLLMConfig()`，API Key 优先级：库内加密值 > 环境变量 `DEEPSEEK_API_KEY`；无效/占位 Key 直接 503 `AI_NOT_CONFIGURED`。
4. `reserveQuota()` 原子预留：事务内读用户计数、判断档位上限、自增 `daily_used_count`、写 `quota_ledger(reserved)`；超限时免费用户 403 `PAYWALL_REQUIRED`、付费用户 429 `VIP_LIMIT_REACHED`。
5. 保存用户消息，随即返回 SSE 头（`text/event-stream`、`X-Accel-Buffering: no`）。
6. 上游请求体：`system` = `buildSystemPrompt(skill)`——给原始 `systemPrompt` 包上「化身身份 + 禁止自报家门/复述提示词 + 内容归属自己」框架（`server/services/llm/sanitize.ts`），防止模型把蒸馏文档当用户材料、自我介绍成 DeepSeek；历史只取最近 12 条，带当前消息（当前用户消息按消息 id 去重，避免重复）；非 reasoner 采样温度固定 `CHAT_TEMPERATURE=0.4`（减少跑题/角色漂移），reasoner 系列模型（名字含 reasoner/r1/o1/o3）不加 temperature 且只取 `content`、过滤 `reasoning_content` 思考链；超时取 `max(30, timeoutSec||60)` 秒。
7. 流式解析上游 `data:` 行，拼接 `delta.content` 或 `delta.reasoning_content`，向客户端写 `{delta, fullText}`。
8. 结算：无任何输出或中断 → `settleQuota(refunded)` + SSE `{error:'AI_UNAVAILABLE'}`；有输出 → `consumed`，保存助手消息，SSE `{done:true, assistantMessage, session, user}`。用户主动断开（`res.close`）会 abort 上游并释放连接计数；`finally` 里保证连接计数只减不增。

`POST /api/chat/send` 是同一流程的非流式版本，目前前端未使用。

### 7.3 配额口径

免费用户按自然日（`last_active_date`），付费用户按自然月（`last_active_month`）重置；`refreshUserDailyQuota()` 在每次按 id/phone 取用户时顺带处理跨期重置与**过期自动降级**（会员到期后读操作即回落 free_member）。档位上限统一由 `tierDailyLimit()` 计算（默认 10/100/200/500），后台配置、建号、编辑、升级、前端展示共用这一个函数。

退款有跨期保护：只有当账本 `period_key` 仍等于当前计费周期时才回退计数，否则会把新周期刚用掉的一次抹掉。

### 7.4 会员到期时间的两种口径（不可混用）

| 场景 | 函数 | 语义 |
|------|------|------|
| 后台配置等级（建号 / 编辑用户） | `membershipExpiryFromNow()` | 以当前真实时间为基准，重新起算完整周期 |
| 升级 / 续费（`/api/admin/users/upgrade-tier`） | `membershipExpiryAfterRenewal()` | 在未过期的现有有效期上顺延，不吞掉剩余时长 |

按自然月顺延时先把日期钳到目标月最后一天（1/31 + 1 月 = 2/28），避免 Date 归一化成 3/3 多送几天。会员**不支持主动降级**：`membershipActionFor()` 统一判定开通/续费/升级/已包含，低于当前档位的卡片只显示「已包含」。目前用户端订阅窗口整体禁用（无在线支付），这套判定只影响展示。

### 7.5 技能、标签与推荐问

公开技能接口统一经 `toPublicSkill()` 输出 `PublicSkill`——不含 `systemPrompt`。`POST /api/skills/:id/click` 匿名可调用，只自增 `search_count`（这就是前台「热度」）。书籍/导师靠 `skill_type` 区分，前端两个广场共用卡片与筛选逻辑。

标签是**全平台分类主键**，每个技能必须落在恰好一个分类。`POST /api/admin/tags` 是整批提交语义：`replaceTags()` 在一个事务里保存标签列表、按 `renamedMap` 级联改名、按 `deletedTags` 级联回落（分类回落到第一个标签，标签列表至少保留一个）、重写所有技能行；上限 50 个，超限与「删空」都显式拒绝（`TOO_MANY_TAGS` / `EMPTY_TAGS`），被拒的破坏性写入也写审计。

推荐问由 `POST /api/admin/skills/generate-questions`（admin）调用主路 LLM 从 `systemPrompt` 提炼，要求模型只输出 JSON 数组；失败返回 `[]` 且**不写回**库（避免清空管理员既有内容）。

### 7.6 LLM 配置与协议

库内的 `system_config.llm_config` 是唯一事实源，后台保存优先于环境变量。管理端读取走 `getAdminLLMConfigView()`，`apiKey` 永远不返回明文，只返回 `apiKeyConfigured` 布尔值；保存时 `apiKeyMode` 支持 keep / replace / clear。协议正文（用户协议、隐私政策）也存放在 `llm_config.agreements` 里，后台可编辑，`saveLLMConfig` 检测到正文变化会自动刷新 `updatedAt` 生效日期；改代码里的 `DEFAULT_*` 只影响新库，存量库要用 `npm run agreements:sync` 覆盖。

### 7.7 关注列表

关注必须登录：`POST /api/follows` 写入 `user_follows`（重复关注幂等），`DELETE /api/follows/:skillId` 取消（不存在也返回成功），`GET /api/follows` 联表返回技能最新公开字段与 `followedAt`，按关注时间倒序。前端登录后拉取关注集合，卡片上的星标按钮采用乐观更新；关注列表页首版只做卡片网格（搜索/分类/分页留待需要时再复用 `MarketSection`）。管理员可在后台用户列表看到 `followCount`，并通过 `GET /api/admin/users/:userId/follows` 查看某个用户的关注明细。

### 7.8 面对面模式（语音朗读）

聊天页顶部是「书信 / 面对面」切换：书信即原有文字聊天；面对面打开全屏舞台（`src/components/FaceToFaceView.tsx` + `FaceToFaceView.css`），底图 `src/assets/face-portrait.png` 按 16:9 居中并四边渐隐铺满屏幕；左上「返回」退出、右上「全屏」；全屏时隐去其它控件，仅保留右上角「退出全屏」按钮（图标 + 文字），Esc 同样可退出。右侧对话区无面板底色，音波在上、只展示最新一轮 AI 回复（不回显用户提问），输入为细线样式；与文字聊天共用同一会话、消息与未发送草稿。AI 回复仍由现有对话模型生成；SSE 流式生成时前端按句切分（`src/lib/voiceText.ts`），逐句调用 `POST /api/tts/synthesize` 合成播放，播放队列（`src/lib/useVoicePlayback.ts`）维持「1 句在播 + 1 句在合成」的预取；`useVoicePlayback` 在每句音频开始播放时通过 `currentSpeechText / isRevealing` 只显示当前正在朗读的一句，新句替换旧句、上一句自动消失（逐句字幕为纯文本：流式分句可能切断 `**` 等 Markdown 标记，字幕与合成都使用已去除标记的文本；完整回复切回书信模式查看）；返回时停止语音。

TTS 支持两种引擎（配置存 `system_config` 的 `tts_config`，API Key 用 `APP_ENCRYPTION_KEY` 加密）：

- `cosyvoice`：DashScope CosyVoice HTTP 接口，返回 mp3；可用系统音色或 CosyVoice 复刻音色。
- `qwen-omni`：Qwen-Omni Realtime WebSocket（`server/services/omniTts.ts`，服务端用 `ws` 包连接），PCM16/24k 音频由服务端封装成 WAV；用于 Omni 声音复刻音色。复刻音色必须与创建时的 `target_model` 一致（如 `qwen3.8-omni-flash-realtime`）；qwen3.8 若要求业务空间专属地址，后台可改 Realtime 地址。朗读契约必须同时放在 `session.instructions` 与 `response.create.response.instructions`——只放 session 级时，Omni 偶尔会把「什么是文化？」这类问句当成用户提问去回答，导致语音内容与字幕不一致。

管理端「模型配置 → 语音对话（TTS）」可切换引擎、填写模型/音色并试听。`voiceModeEnabled` 只在「启用 + Key 有效 + 当前引擎字段齐全」时为真；用户端据此显示面对面入口，但该入口**仅对「文化广场」（内部类型 `reliable`）类技能开放**——书籍 / 导师会话不显示，已在面对面时切换过去会自动退回书信模式。TTS 不额外扣聊天配额，接口有独立限流（按登录用户 120 次/分）与 500 字文本上限。

---

## 8. API 清单

公开接口（无需登录）：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查（DB ping、SSE 连接数、运行时长），不受限流 |
| GET | `/api/config/public` | 额度、套餐价、协议、口令策略（无任何密钥） |
| GET | `/api/skills` | 支持 `?search=&category=&type=book\|mentor` |
| GET | `/api/skills/:id` | 单个技能（PublicSkill） |
| POST | `/api/skills/:id/click` | 热度 +1 |
| GET | `/api/tags` | 分类标签列表 |
| POST | `/api/auth/register` | 手机号 + 密码自助注册；成功即签发会话（默认普通会员，5 次/分/IP） |
| POST | `/api/auth/login` | 手机号 + 密码；可能返回 `passwordChangeRequired` |

登录后（`requireUser`）：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/auth/me` | 当前用户（已脱敏） |
| POST | `/api/auth/change-password` | 仅首登改密（挑战 Cookie） |
| POST | `/api/auth/delete-account` | 硬删除，需输入三语确认短语之一 |
| POST | `/api/auth/logout` | 撤销会话并清 Cookie |
| GET | `/api/follows` | 当前用户的关注列表（PublicSkill + followedAt） |
| POST | `/api/follows` | 关注技能（幂等，技能不存在 404 `SKILL_NOT_FOUND`） |
| DELETE | `/api/follows/:skillId` | 取消关注（幂等） |
| POST | `/api/tts/synthesize` | 文字转语音（≤500 字），返回 `audio/mpeg`；未配置 503 `TTS_NOT_CONFIGURED`，上游失败 502 `TTS_UNAVAILABLE` |
| GET | `/api/chat/sessions` | 本人会话列表 |
| POST | `/api/chat/sessions` | 新建会话（带 AI 欢迎语与推荐问） |
| DELETE | `/api/chat/sessions/:id` | 删除本人会话 |
| DELETE | `/api/chat/sessions` | 清空本人全部会话与消息（不可恢复） |
| POST | `/api/chat/stream` | SSE 流式对话（前端唯一在用） |
| POST | `/api/chat/send` | 同步对话（备用，前端未接） |

管理员（`/api/admin/*`，除登录外均 `requireAdmin`）：`login`、`logout`、`me`、`stats`；用户管理 `users`（列表，含 `followCount`）、`users/:userId/follows`（查看关注）、`users/create`、`users/reset-password`、`users/status`、`users/update`、`users/upgrade-tier`、`DELETE users/:userId`、`users/clear-all`；技能 `skills`（GET/POST）、`DELETE skills/:id`、`skills/generate-questions`；标签 `tags`；上传 `upload-asset`；订单 `orders`、`orders/clear-all`；模型配置 `llm-config`（GET/POST）、`llm-test`、`tts-config`（GET/POST）、`tts-test`。

约定：所有错误响应体形如 `{ error: 'ERROR_CODE', message: '中文兜底' }`；用户端按错误码查 `src/i18n/serverMessage.ts` 的映射表翻译，未知码才回退 message。新增面向用户的错误码必须同时更新映射表与三份字典。

---

## 9. 前端结构

**用户端**是单体状态：`App.tsx` 持有 `user`、`skills`、`llmConfig`、`authPolicy`、`selectedSkill`，并在窗口 focus / 标签页可见时重新拉取 `/api/auth/me` 与 `/api/config/public`（保证后台改额度后前端及时对齐）。`AiStudioWorkspace` 内部再持有会话列表、`mainView`（`market` / `mentor` / `reliable` / `follows` / `chat`）、关注集合、按对话框隔离的输入草稿、流式状态、各类弹窗。三个广场共用 `PlazaView` 视图壳与 `usePlazaController` 状态钩子（搜索、分类、分页、标签溢出、详情弹窗），避免三份复制；关注列表由 `FollowListView` 单独渲染。聊天页顶部的「书信 / 面对面」切换只在公开配置 `voiceModeEnabled` 为真时显示面对面入口；面对面由 `FaceToFaceView` 全屏渲染（16:9 人物画面、玻璃面板、悬浮输入框），底层文字聊天保持挂载，会话与草稿共享。聊天请求直接 `fetch` SSE 流并手工解析 `data:` 行，没有用 EventSource（需要 POST + 自定义头）。

用户端交互要点：入场默认市场；选择书籍/导师时先打点热度再开聊；已有带消息的会话直接复用，空会话按新会话处理；每本书的输入草稿互不串台；配额先在本地预判（`checkQuotaAndCanProceed`），服务端仍是最终裁决；流式失败时把错误码翻译成当前语言追加为一条助手消息。

**管理后台**是另一个独立入口（`admin.html`），不经过 `I18nProvider`，全部中文。`AdminGate` 负责「账号 + 密码登录 → AdminPanel」；`AdminPanel` 是单文件巨型组件，7 个页签：仪表盘（2 分钟静默刷新）、书籍/导师管理、分类标签（拖动排序、改名、删除）、资源配置（四档额度与价格）、用户管理（建号/改手机号/改档位/重置密码/禁用/删除/清空）、LLM 配置（Key 三种模式、连通性测试）、协议配置。所有请求经 `apiFetch`，401/403 统一走 `ensureAdminAuthorized` 刷新回登录页。

**API 封装**（`src/lib/apiFetch.ts`）是前后端契约的关键粘合层：`apiFetch` 自动拼 `import.meta.env.BASE_URL` 前缀、`credentials: 'include'`、按当前页面（用户端/后台）注入对应 CSRF Cookie 的值；`assetSrc` 给 `/assets/...` 补前缀；`tryLogout` 显式返回是否真的登出成功——调用方只有拿到 true 才能清本地状态。

**多语言（用户端）**：`zh-CN.ts` 是唯一权威源（约 520 条），`Dictionary` 类型从它推导，`en.ts` / `zh-TW.ts` 必须用 `const xxx: Dictionary` 标注，漏键 `npm run lint` 直接失败。`t('a.b.c')` 的键名是编译期类型，写错即报错；插值统一 `{name}`。`tests/i18n.test.ts` 另外校验三语键集合、空文案、占位符一致，以及注销短语常量与字典逐条对应。注销确认短语单独放在叶子模块 `src/i18n/deleteAccountPhrase.ts`，服务端只引它，避免把整份字典打进服务端 bundle。

---

## 10. 测试与验证

`tests/` 用 vitest + supertest 直接对 `createApp()` 发请求，环境变量由 `vitest.config.ts` 注入（`NODE_ENV=test`、固定管理员凭证、`DATA_DIR=./.test-runtime`、`BASE_PATH=''`），测试文件串行执行（`fileParallelism: false`）。

`api.test.ts` 覆盖：公开 DTO 不含 `systemPrompt`；聊天接口拒绝匿名与伪造 `userId`；管理员账号密码登录 + 建号 + 首登强制改密 + 会话隔离；mock LLM 的 SSE 成功与失败（失败退款后 `dailyUsedCount` 仍为 1）；CSRF Cookie 与会话同寿命、自助注销（三语短语、大小写不敏感）；`ORIGIN_REJECTED` 与 `CSRF_REJECTED` 区分；标签上限、拒空、级联改名与审计留痕；关注关系与可靠类型；批量清空会话仅影响本人。

`subpath.test.ts` 用 `vi.stubEnv('BASE_PATH', '/bookanswer')` + 动态 import 验证前缀内可达、前缀外 404、CSRF 豁免表跟随前缀。

`i18n.test.ts` 见上节。CI（`.github/workflows/ci.yml`）在 push 到 `main` / `feat/cloud-production` 与 PR 时执行 `npm ci` + `npm run lint` + `npm test`。

本地新增测试的注意点：数据落在 `.test-runtime`，`beforeAll` 会先删目录；多个测试共享同一数据库文件，用例之间要自行还原（参考标签用例的 `finally` 回滚）。

---

## 11. 部署与运维

`docker/Dockerfile` 是两阶段构建：build 阶段 `npm ci --ignore-scripts`（better-sqlite3 用包内 prebuilds，slim 镜像无 Python）+ 显式补跑 esbuild install；运行阶段只带生产依赖与 `dist` / `dist-server`，以非 root 的 `node`（uid 1000）运行。

`docker/docker-compose.yaml`：`app` 服务挂 `../data:/app/data`，`TZ=Asia/Shanghai`（配额日界/月界以服务器本地时区为准），堆上限 768MB、容器 1GB、nofile 65536（SSE 长连接），健康检查走 `${BASE_PATH:-/bookanswer}/api/health`。Caddy 在 `https` profile 里按需启用（域名备案后），`Caddyfile.template` 已含 HSTS 与 `flush_interval -1`（SSE 不缓冲）。

生产环境启动即拒绝的情形（`server/config.ts`）：缺 `APP_ORIGIN`、缺/非法 `APP_ENCRYPTION_KEY`、`ADMIN_PHONE` 不是 11 位、管理员密码不达标、`ALLOW_INSECURE_HTTP=1` 与 `TRUST_PROXY=1` 同时开启、无 HTTPS 模式下 `APP_ORIGIN` 不是 http://。`ALLOW_INSECURE_HTTP=1` 会关闭 Cookie Secure、CSP upgrade 与 HSTS，只允许内测直连使用。

运维脚本：`scripts/backup.sh`（sqlite `.backup` + integrity_check + assets 打包 + 本地保留 7 天 + 可选 restic 保留 30 天 + 可选健康检查 ping）、`restore.sh`（先备份当前库为 `.before-restore`，恢复后 `chown 1000:1000`）、`verify-backup.sh`（恢复前完整性检查）、`smoke.sh`（curl 冒烟，支持「连 127.0.0.1、带公网 Origin」绕过云主机无 hairpin NAT）、`load-test.ts`（autocannon）。详见 [deploy.md](deploy.md)。

---

## 12. 二次开发指南

### 12.1 不可破坏的约束（红线）

以下规则由产品与安全评审沉淀而来，改动相关代码前逐条确认：

1. 身份只来自服务端会话，**禁止接受客户端传入的 `userId`**；登录态不写 localStorage。
2. 公开接口只输出 `PublicSkill`，`systemPrompt` 永不外泄；LLM API Key 永不返回明文，只返回 `apiKeyConfigured`。
3. 上游 LLM 失败必须退还预留配额；账本状态只能从 reserved 结算一次。
4. 改密、重置密码、禁用账号、删除账号必须撤销该用户全部会话；修改管理员密码必须让旧管理员会话失效（`authVersion`）。
5. 后台配置等级 = 从当前时间重新起算；升级/续费 = 在原有效期顺延。二者不可混用，会员不支持主动降级。
6. 标签至少保留一个；超 50 个显式拒绝而非截断；改名/删除必须级联重写所有技能且整批原子生效。
7. 写路径读技能必须用 `getPersistedSkills()`，不得用带种子兜底的 `getSkills()`。
8. 所有 `/api` 写请求自动受 CSRF 保护；新增免豁免端点要极其谨慎，且豁免比对要带 `BASE_PATH`。
9. 服务端错误必须返回错误码；用户可见的错误码要同步 `serverMessage.ts` 与三份字典。
10. 密码策略：用户 ≥6 位不强制组合（前端提示强度）；管理员 ≥16 位含字母数字；日志与审计不得记录密码、Cookie、API Key、完整敏感请求体。
11. 会话 Cookie / CSRF Cookie 的 `maxAge` 必须一致；清 Cookie 的属性必须与种下时一致。
12. 新增数据库列必须同时更新 `SCHEMA_DDL` 与 `addedColumns`，否则启动即失败（这是特性，不是 bug）。
13. 用户端文案只改 `zh-CN.ts`，`en.ts` / `zh-TW.ts` 必须同步；书名、作者、分类、协议正文、昵称是「数据」不翻译；后台不做多语言。
14. 子路径前缀只从 `basePath.ts` / `BASE_PATH` 取，业务代码不手写 `/bookanswer`。

### 12.2 常见扩展场景与落点

| 需求 | 改动落点 |
|------|----------|
| 新增用户端接口 | `server/routes/*` 注册（`app.ts` 已统一装配）→ 若面向用户，错误码进 `serverMessage.ts` + 三份字典 → 前端 `apiFetch` 调用 |
| 新增后台接口 | 放进 `server/routes/admin.ts`，挂 `requireAdmin`；敏感操作补 `db.audit()`；前端 `AdminPanel` 对应页签 |
| 技能新增字段 | `src/types.ts`（`Skill`/`PublicSkill`）→ `db.ts` 的 `SCHEMA_DDL` + `addedColumns` + `mapSkillRow`/`saveSkill`/`getAdmin...` → 后台编辑弹窗 → 用户端展示 |
| 新增会员档位 | `types.ts`（`MembershipTier`、`MEMBERSHIP_TIER_MONTHS/RANK`、`tierDailyLimit`）→ `users.membership_tier` 校验清单（`admin.ts` 有多处字面量数组）→ `config.ts` 公开字段 → `MembershipModal` → i18n 的 `tier.*` / `membership.*` → 服务端测试 |
| 接入在线支付 | `orders` 表已就位但无写入路径：需要下单接口（创建 pending 订单 + `trade_no`）、支付回调验签 + 幂等 + 状态机、成功后调用与 `upgrade-tier` 相同的顺延逻辑；注意「回调重复」与「金额校验」；用户端 `MembershipModal` 目前整窗禁用 |
| 更换 / 新增 LLM 供应商 | 配置层已抽象为 OpenAI 兼容接口：`llmConfig.apiBaseUrl` / `primaryModel`，`resolveOpenAIUrl()` 会补全常见厂商路径；新厂商若协议不同需改 `chat.ts` 与 `llm/sanitize.ts` |
| 新增界面语言 | `src/i18n/types.ts` 的 `LOCALES` → 新建 `locales/xx.ts` 并标注 `: Dictionary` → `locales/index.ts` 注册 → `LanguageSwitcher` 标签 → `deleteAccountPhrase.ts` 补短语（`tests/i18n.test.ts` 会强制校验） |
| 改部署前缀 | 只改 `basePath.ts` 并重建；核对 `docker/.env.example` 健康检查说明与运维文档 |
| 多实例 / 扩容 | SQLite 与进程内限流/在线统计都不支持：需迁移 PostgreSQL、引入共享限流（Redis）、SSE 需要粘性会话或消息总线，属于大改 |

### 12.3 已知边界与技术债

单实例限制见 §1。数据层方面，`orders` 表与 `/api/admin/users/upgrade-tier` 是支付时代预留（前端未接入升级接口，订单没有任何写入路径）；`chatCount`、`hotScore` 字段只存在于类型与 DTO，界面未消费（热度实际用 `searchCount`）。聊天有流式与非流式两个端点，前端只用流式。

前端最大技术债是 `AdminPanel.tsx`（3100+ 行单组件）与 `AiStudioWorkspace.tsx`（1600 行），与 AGENTS.md「禁止单个组件膨胀」相悖；功能迭代时建议顺势按页签/视图拆子组件，但遵循「精准修改」，不要为拆而拆。关注列表首版只做卡片网格，没有搜索、分类与分页（关注量通常有限）；若后续需要，可直接复用 `MarketSection` 的筛选能力。`AdminPanel` 挂载时会清理四个历史遗留的 `localStorage` 分类键（`admin_custom_categories` 等），用户端仍保留了读取逻辑用于兼容；新功能不要再用 localStorage 存业务数据。管理后台完全未做多语言，若要国际化需先引入 `I18nProvider` 并补齐一套后台字典。

`users.daily_max_chats` 字段仍在，但运行时额度已统一按 `tierDailyLimit(config, tier)` 计算，改额度配置后已建用户会即时生效；修改这部分逻辑时注意两处口径。

### 12.4 改动后的验证清单

| 改动类型 | 必跑 |
|----------|------|
| 任意代码 | `npm run lint` + `npm test`（或一次 `npm run verify`） |
| 数据库 schema | 在**已有旧库**上启动一次验证迁移不炸（`checkSchemaDrift` 会兜底），再跑 `npm test` |
| i18n 文案 / 新增语言 | `npm run lint`（漏键）+ `npm test`（键集合/占位符/注销短语） |
| 认证 / CSRF / Cookie | `tests/api.test.ts` 全量，并手工验证「浏览器完整退出后再登录、登出」 |
| 子路径 / 路由 | `tests/subpath.test.ts`；本地把 `basePath.ts` 置空与置回各跑一次冒烟 |
| 部署 / 环境变量 | `npm run config:check`、`docker compose config`、`scripts/smoke.sh` |
| 涉及 UI | 手工过一遍：匿名浏览 → 登录 → 首登改密 → 聊天流式 → 配额耗尽提示 → 注销账号 |

---

## 13. 快速排障索引

| 现象 | 最可能原因 | 排查点 |
|------|-----------|--------|
| 所有写请求 403、提示「安全令牌已失效」 | CSRF Cookie 与会话不匹配 / APP_ORIGIN 配错 | 看错误码是 `CSRF_REJECTED` 还是 `ORIGIN_REJECTED`；对比服务端日志里的 origin 与 expectedOrigin |
| 后台「登录成功但页面全空」 | 管理员会话过期（8 小时）或 `authVersion` 失效 | `ensureAdminAuthorized` 应已刷新回登录页；否则重新登录，或确认管理员密码是否被修改 |
| 启动报「数据库结构同步失败」 | DDL 加了列但没登记 `addedColumns` | 按报错列清单补登记；若库里有 `users_legacy_v1` 需人工处理 |
| 保存 LLM 配置后调用失败 | 库内配置优先于环境变量 | 后台「模型配置」里改地址/模型/Key，而不是只改 `.env` |
| 解密失败、LLM 配置静默回退默认值 | `APP_ENCRYPTION_KEY` 与建库时不一致 | `agreements:sync` 等脚本会用 `apiKeyConfigured === undefined` 识别该状态 |
| 升级后到期时间不对 | 混用了两种到期口径 | 后台保存走 `membershipExpiryFromNow`，升级接口走 `membershipExpiryAfterRenewal` |
| 用户第一天还能聊天、第二天额度没重置 | `TZ` 与部署环境不一致 | 容器固定 `Asia/Shanghai`；`getTodayString()` 取服务器本地时区 |
| 语音模式没有入口 / 不出声 | TTS 未启用、Key 无效、引擎字段不全或浏览器拦截自动播放 | 后台「模型配置 → 语音对话」确认已启用且 `TTS_NOT_CONFIGURED` 未出现，点「试听已保存的配置」验证上游；Qwen-Omni 复刻音色要确认模型与 `target_model` 一致、Realtime 地址可达；页面无手势时自动播放会被拦截，点击 AI 回答可重播 |
| 语音断断续续 / 缺句 | 每句一次 Realtime 请求，上游慢、限流或偶发失败都会表现为句间停顿或跳句 | 浏览器 Network 查看 `/api/tts/synthesize` 的状态与耗时；服务端日志看 `TTS 合成耗时`、`语音合成上游失败`、`TTS 限流触发`；确认 DashScope 账号并发/限流。当前已按用户限流 120 次/分、预取 3 句、5xx 自动重试一次，并兼容 `response.audio.done` 提前收尾 |
| 开发模式整页白屏 | 严格 CSP 拦掉了 Vite 注入的内联脚本或 HMR WebSocket | `app.ts` 的 `isViteDev` 分支放宽了 script/connect 指令；确认没把它误删 |
| 恢复备份后容器报 readonly database | 文件属主被改回 root | 以容器 uid 1000 为属主：`chown -R 1000:1000 data/` |

---

## 14. 推荐阅读顺序

第一次接手建议按此顺序建立心智模型：`README.md` → `AGENTS.md` + `CLAUDE.md` → 本文 §3–§7 → `src/types.ts`（业务对象全貌）→ `server/db.ts`（数据与迁移机制）→ `server/middleware/auth.ts` + `server/routes/auth.ts`（认证闭环）→ `server/routes/chat.ts`（核心业务）→ `src/lib/apiFetch.ts` + `src/App.tsx`（前端数据流）→ `tests/api.test.ts`（行为契约）。需要补基础概念时读 `docs/FULLSTACK_BEGINNER_GUIDE.md`。
