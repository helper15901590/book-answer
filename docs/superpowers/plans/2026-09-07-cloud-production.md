# 云端生产部署改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Remix Remix 0.991（单文件 Express + React 全栈应用）改造为可安全部署到国内云 VPS + Docker 的生产系统。

**Architecture:** 后端从 2058 行单文件 `server.ts` 拆分为 `server/` 模块化结构（middleware/routes/services），安全加固（admin 鉴权、bcrypt、限流、密钥脱敏、后台入口剥离至独立 `/admin` 页），数据层 sql.js → better-sqlite3（write-through + WAL + DATA_DIR 持久卷），冗余代码清理，Docker Compose 部署产物。

**Tech Stack:** Node 22、Express 4、React 19、Vite 6（多页）、TypeScript 5.8、better-sqlite3、bcryptjs、helmet、express-rate-limit、jsonwebtoken、Docker Compose、Caddy（预留）。

**Spec:** `docs/superpowers/specs/2026-09-07-cloud-production-design.md`

## Global Constraints

- **UI 硬约束**：不修改任何 UI 设计（布局/样式/交互文案）。已授权例外：① 移除主前端后台入口按钮（AiStudioWorkspace.tsx:859-866 的 Settings 齿轮按钮）；② 新增独立 `/admin` 登录入口页；③ 删除组件内死代码分支时渲染结果必须逐像素一致。
- **前端逻辑改动白名单**（仅这些，均为配合后端的必要逻辑改动，非 UI 改动）：App.tsx 配置拉取 URL 切换与 #admin 逻辑移除、AiStudioWorkspace.tsx 后台按钮移除、AdminPanel.tsx fetch 注入 Authorization、新增 admin.html / src/admin-main.tsx / src/components/AdminGate.tsx / src/lib/apiFetch.ts。
- **API 兼容**：除本计划明确变更项外，所有 API 路径与请求/响应格式保持逐字节兼容。
- **编码规范**：遵循 AGENTS.md（YAGNI、最少代码、精准修改、中文注释、TypeScript 强类型）。
- **验证基线**（无测试框架，以此替代 TDD 循环）：每任务收尾必须 ① `npm run lint` 通过；② `npm run dev` 启动无报错 + 该任务的 curl 冒烟断言通过；③ 独立 git commit。
- **提交署名**：git identity 已配置为 chanleon（仓库级）。
- **禁止提交**：`.env`、`.env.local`、`commercial.sqlite`、`data/`（.gitignore 已覆盖）。
- **服务端导入约定**：ESM（package.json `"type": "module"`），相对导入带 `.js` 后缀（如 `import { db } from '../db.js'`）。

## 与 Spec 的偏差决议（实施侦察后确认，执行前需用户知悉）

| # | 偏差 | 依据 |
|---|------|------|
| D1 | 支付路由**全部删除**（而非 spec 第 4 节的"熔断保留" create-order 两个端点） | 全库 grep 证实前端零调用（无任何 fetch 指向 /api/payment/*），保留桩即冗余代码，违反决策 #8 |
| D2 | `/api/auth/register` 路由**删除**（而非熔断桩）；自助注册的真正收口点是 login 的"未注册自动建号"分支（server.ts:605-624），改为返回友好错误 | LoginModal.tsx:86 仅调用 /api/auth/login，register 路由前端零调用 |
| D3 | 不实现 `must_change_password`；管理员建号的初始密码由管理员在后台表单设定（非随机生成） | 前端无用户自助改密入口（触发 spec 2.2.7 的降级分支）；AdminPanel 建号表单已有密码输入框，UI 不可改 |
| D4 | 登录密码保持 **6 位数字**格式（bcrypt 哈希存储 + 限流防爆破补偿） | LoginModal.tsx:73 前端硬校验 `/^\d{6}$/`，UI 不可改；spec 2.2 的"≥8位含字母数字"不可达，残余风险写入部署文档 |
| D5 | AdminPanel 全部 fetch 注入 Authorization 头（新增 apiFetch 包装器） | requireAdmin 生效后裸 fetch 将全部 403，后台瘫痪；纯逻辑改动 |
| D6 | 所有 API 响应中的 user 对象剥离 `password` 字段 | bcrypt 哈希外泄防护；且 AdminPanel.tsx:371 编辑表单回显 `u.password`，剥离后显示空=不修改，与现有提交逻辑（空值不更新，server.ts:1746-1749）天然兼容 |
| D7 | Docker 运行时镜像用 `node:22-bookworm-slim`（glibc）而非 spec 的 alpine | better-sqlite3 官方 prebuilt 针对 glibc；alpine/musl 需容器内编译工具链，得不偿失 |
| D8 | 公开路径 `/api/skills/generate-questions` 保留（限流 10 次/时/IP），但携带 skillId 落库仅管理员生效 | AiStudioWorkspace.tsx:528 用户侧依赖此端点自动生成追问；落库写权限收紧防篡改 |

---

## P1 · 后端模块化搬移（纯机械，行为零变化）

**原始 server.ts 分区索引**（搬移定位用；每完成一个搬移任务，剩余行号会偏移，后续任务以**函数名/注释横幅**为锚点定位，行号仅作初始参考）：

| 原始行号 | 内容 | 去向 |
|---|---|---|
| 19-20 | JWT_SECRET / JWT_EXPIRES_IN | Task 2 → middleware/auth.ts |
| 23-67 | generateDeepBookDistillation | Task 3 → services/llm/offline.ts |
| 70-102 | sanitizeMessagesForLLM | Task 3 → services/llm/sanitize.ts |
| 103-110 | isInvalidOrPlaceholderKey | Task 3 → services/llm/sanitize.ts |
| 112-140 | resolveGeminiModelName | Task 3 → services/llm/gemini.ts |
| 142-231 | callGeminiResponse | Task 3 → services/llm/gemini.ts |
| 234-241 | cleanApiKey | Task 3 → services/llm/sanitize.ts |
| 244-262 | resolveOpenAIUrl | Task 3 → services/llm/sanitize.ts |
| 265-414 | generateRecommendedQuestionsFromLLM | Task 3 → services/llm/questions.ts |
| 417-419 | interface AuthRequest | Task 2 → middleware/auth.ts |
| 422-433 | signToken | Task 2 → middleware/auth.ts |
| 436-462 | extractUserFromRequest | Task 2 → middleware/auth.ts |
| 465-471 | authMiddleware | Task 2 → middleware/auth.ts |
| 474-485 | metrics 对象 + setInterval | Task 2 → services/metrics.ts |
| 487-512 | startServer 壳、express 装配、请求计数中间件、/api/health | Task 1 → index.ts |
| 515-540 | POST /api/admin/upload-asset | Task 6 → routes/admin.ts |
| 544-628 | POST /api/auth/login | Task 5 → routes/auth.ts |
| 631-680 | POST /api/auth/register | Task 5 → routes/auth.ts |
| 682-704 | GET me / POST logout / POST update | Task 5 → routes/auth.ts |
| 707-777 | skills 市场路由 + generate-questions | Task 5 → routes/skills.ts |
| 780-827 | chat sessions CRUD | Task 5 → routes/chat.ts |
| 832-951 | checkAndConsumeQuota（startServer 内部函数） | Task 4 → services/quota.ts |
| 954-1198 | POST /api/chat/stream | Task 5 → routes/chat.ts |
| 1201-1352 | POST /api/chat/send | Task 5 → routes/chat.ts |
| 1357-1561 | payment 全部路由 | Task 6 → routes/payment.ts |
| 1564-1567 | GET /api/tags | Task 5 → routes/skills.ts |
| 1569-1620 | POST /api/admin/tags | Task 6 → routes/admin.ts |
| 1623-1897 | admin 运营路由（stats/users/skills/orders/llm-config） | Task 6 → routes/admin.ts |
| 1899-2036 | POST /api/admin/llm-test | Task 6 → routes/admin.ts |
| 2038-2056 | Vite/静态资源装配 + listen | Task 1 → index.ts |

### Task 1: server/ 骨架 + index.ts 原样搬移

**Files:**
- Create: `server/config.ts`、`server/index.ts`
- Modify: `package.json`（scripts.dev / scripts.build）
- Move: `server.ts` → `server/index.ts`（git mv；根目录不再保留 server.ts）

**Interfaces:**
- Produces: `server/config.ts` 导出 `PORT: number`、`IS_PROD: boolean`；`server/index.ts` 为唯一后端入口（`startServer(): Promise<void>` 自执行）。

- [ ] **Step 1: 创建 server/config.ts**

```ts
import dotenv from 'dotenv';

// 本地开发加载 .env.local / .env（生产由容器环境变量注入，文件不存在时静默跳过）
dotenv.config({ path: ['.env.local', '.env'] });

export const IS_PROD = process.env.NODE_ENV === 'production';
export const PORT = Number(process.env.PORT) || 3000;
```

- [ ] **Step 2: 移动 server.ts → server/index.ts 并修正导入**

```bash
git mv server.ts server/index.ts
```

编辑 `server/index.ts`：
1. 头部导入路径修正（3 处）：`'./src/db.js'` → `'../src/db.js'`；`'./src/types.js'` → `'../src/types.js'`；`'./src/data/initialData.js'` → `'../src/data/initialData.js'`。
2. 新增导入：`import { PORT, IS_PROD } from './config.js';`
3. 删除 `startServer` 内的 `const PORT = 3000;`（原 489 行）。
4. 将 `if (process.env.NODE_ENV !== 'production')`（原 2039 行）改为 `if (!IS_PROD)`。
5. 其余内容**一个字符都不改**。

- [ ] **Step 3: 更新 package.json scripts**

```json
"dev": "tsx server/index.ts",
"build": "vite build && esbuild server/index.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs",
```

- [ ] **Step 4: 验证**

```bash
npm run lint
```
预期：无错误（tsconfig 无 include 限制，自动覆盖 server/）。

启动冒烟（后台运行 `npm run dev`，等待 `running on http://0.0.0.0:3000` 日志后执行，完毕杀掉进程）：
```bash
curl -s http://localhost:3000/api/health          # 预期 {"status":"ok",...}
curl -s http://localhost:3000/api/skills | head -c 200   # 预期 {"skills":[...
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/   # 预期 200（Vite dev 页面）
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(server): 迁移入口至 server/index.ts 并引入 config.ts（行为零变化）"
```

### Task 2: 提取 middleware/auth.ts 与 services/metrics.ts

**Files:**
- Create: `server/middleware/auth.ts`、`server/services/metrics.ts`
- Modify: `server/index.ts`（删除被搬移代码，改为导入）

**Interfaces:**
- Produces:
  - `middleware/auth.ts`: `interface AuthRequest extends Request { user?: UserProfile }`、`const JWT_SECRET`、`const JWT_EXPIRES_IN = '7d'`、`signToken(user: UserProfile): string`、`extractUserFromRequest(req: Request): UserProfile | null`、`authMiddleware(req, res, next): void`
  - `services/metrics.ts`: `const metrics: { activeSseConnections; totalRequestsServed; requestsLastMinute; peakConcurrentSse; totalAiTokensEstimated; startTime }`（可变单例，含每分钟归零 interval）

- [ ] **Step 1: 创建 server/middleware/auth.ts**

将 index.ts 中以下片段**原样剪切**进来（锚点：`const JWT_SECRET`、`interface AuthRequest`、`function signToken`、`function extractUserFromRequest`、`function authMiddleware`），文件头部补导入：

```ts
import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../../src/db.js';
import { UserProfile } from '../../src/types.js';
```

注意：此阶段 `db` 仍在 `src/db.js`（Task 16 才迁移至 `server/db.ts`）。所有被搬移符号加 `export`。JWT_SECRET/JWT_EXPIRES_IN 保持原值与原逻辑（Task 8 才改造）。

- [ ] **Step 2: 创建 server/services/metrics.ts**

```ts
// 全局并发指标（供 /api/health 与 /api/admin/stats 使用）
export const metrics = {
  activeSseConnections: 0,
  totalRequestsServed: 0,
  requestsLastMinute: 0,
  peakConcurrentSse: 0,
  totalAiTokensEstimated: 0,
  startTime: Date.now(),
};

setInterval(() => {
  metrics.requestsLastMinute = 0;
}, 60000);
```

从 index.ts 剪切原 metrics 定义与 interval（原 474-485）。

- [ ] **Step 3: index.ts 改为导入**

删除已搬移代码，头部新增：

```ts
import { AuthRequest, signToken, extractUserFromRequest, authMiddleware } from './middleware/auth.js';
import { metrics } from './services/metrics.js';
```

同时删除 index.ts 中不再使用的 `jwt`、`jsonwebtoken` 导入（若仍被其他保留代码使用则保留）。

- [ ] **Step 4: 验证**：`npm run lint` + dev 启动 + 冒烟：

```bash
curl -s http://localhost:3000/api/health   # 预期 status ok 且含 uptimeSeconds
curl -s http://localhost:3000/api/auth/me  # 预期 {"user":{...role":"guest"...}}
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(server): 提取 auth 中间件与 metrics 模块（行为零变化）"
```

### Task 3: 提取 services/llm/*（4 个文件）

**Files:**
- Create: `server/services/llm/sanitize.ts`、`server/services/llm/gemini.ts`、`server/services/llm/offline.ts`、`server/services/llm/questions.ts`
- Modify: `server/index.ts`

**Interfaces:**
- Produces（全部具名导出）:
  - `sanitize.ts`: `cleanApiKey(rawKey: string): string`、`isInvalidOrPlaceholderKey(key?: string): boolean`、`resolveOpenAIUrl(baseUrl: string): string`、`sanitizeMessagesForLLM(systemPrompt: string, history: ChatMessage[], currentMessage: string): { role: string; content: string }[]`
  - `gemini.ts`: `resolveGeminiModelName(modelName?: string): string`、`callGeminiResponse(opts: { geminiKey: string; targetModel?: string; systemPrompt: string; messageText: string; timeoutMs?: number }): Promise<string>`
  - `offline.ts`: `generateDeepBookDistillation(skill: any, userQuery: string, history?: ChatMessage[]): string`
  - `questions.ts`: `generateRecommendedQuestionsFromLLM(opts: { systemPrompt: string; title?: string; author?: string }): Promise<string[]>`

- [ ] **Step 1: 按分区索引剪切 4 个文件**

每个文件头部补最小导入并给函数加 `export`：
- `sanitize.ts`: `import { ChatMessage } from '../../../src/types.js';`
- `gemini.ts`: `import { GoogleGenAI } from '@google/genai';`
- `offline.ts`: `import { cleanBookTitle, ChatMessage } from '../../../src/types.js';`
- `questions.ts`: `import { db } from '../../../src/db.js'; import { cleanBookTitle } from '../../../src/types.js'; import { cleanApiKey, isInvalidOrPlaceholderKey, resolveOpenAIUrl } from './sanitize.js'; import { callGeminiResponse, resolveGeminiModelName } from './gemini.js';`

函数体**一字不改**。

- [ ] **Step 2: index.ts 改为导入**

```ts
import { cleanApiKey, isInvalidOrPlaceholderKey, resolveOpenAIUrl, sanitizeMessagesForLLM } from './services/llm/sanitize.js';
import { callGeminiResponse, resolveGeminiModelName } from './services/llm/gemini.js';
import { generateDeepBookDistillation } from './services/llm/offline.js';
import { generateRecommendedQuestionsFromLLM } from './services/llm/questions.js';
```

删除 index.ts 中不再使用的导入（注意：`GoogleGenAI` 仍被 index.ts 的 llm-test 路由使用，**保留**；仅当 grep 证实无引用才删）。

- [ ] **Step 3: 验证**：`npm run lint` + dev 启动 + 冒烟：

```bash
curl -s -X POST http://localhost:3000/api/chat/send -H "Content-Type: application/json" \
  -d '{"sessionId":"smoke-1","skillId":"skill-santi","messageText":"你好"}' | head -c 300
# 预期：返回 assistantMessage（无 LLM key 时走离线蒸馏兜底，不应 500）
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor(server): 提取 LLM 服务模块 sanitize/gemini/offline/questions（行为零变化）"
```

### Task 4: 提取 services/quota.ts

**Files:**
- Create: `server/services/quota.ts`
- Modify: `server/index.ts`

**Interfaces:**
- Produces: `checkAndConsumeQuota(user: UserProfile | null, skill: any, llmConfig: any): { allowed: boolean; status?: number; error?: string; message?: string; tier?: MembershipTier; updatedUser?: UserProfile }`

- [ ] **Step 1: 剪切函数**

`checkAndConsumeQuota` 当前定义在 `startServer()` 函数体内部（锚点注释横幅 `Membership-based Multi-tier Quota Verification & Consumption Engine`）。剪切到 `server/services/quota.ts`，提升为模块级导出函数，头部：

```ts
import { db } from '../../src/db.js';
import { UserProfile, MembershipTier, getEffectiveMembershipTier } from '../../src/types.js';
```

函数体一字不改（它只引用 db、类型工具与自身参数，无闭包依赖——已核实）。

- [ ] **Step 2: index.ts 导入** `import { checkAndConsumeQuota } from './services/quota.js';`

- [ ] **Step 3: 验证**：`npm run lint` + dev + 重跑 Task 3 Step 3 的 chat/send 冒烟（配额逻辑在链路上）。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor(server): 提取会员配额引擎 services/quota.ts（行为零变化）"
```

### Task 5: 提取 routes/auth.ts、routes/skills.ts、routes/chat.ts

**Files:**
- Create: `server/routes/auth.ts`、`server/routes/skills.ts`、`server/routes/chat.ts`
- Modify: `server/index.ts`

**Interfaces:**
- Produces: `registerAuthRoutes(app: Express): void`、`registerSkillsRoutes(app: Express): void`、`registerChatRoutes(app: Express): void`
- Consumes: Task 2-4 的全部导出。

- [ ] **Step 1: 创建 3 个路由模块**

统一骨架（以 auth 为例）：

```ts
import { Express } from 'express';
import { db } from '../../src/db.js';
import { AuthRequest, signToken } from '../middleware/auth.js';
import { metrics } from '../services/metrics.js';
import { checkAndConsumeQuota } from '../services/quota.js';
// ...其余按需（GUEST_USER、cleanBookTitle、sanitizeMessagesForLLM、callGeminiResponse、
//     generateDeepBookDistillation、generateRecommendedQuestionsFromLLM、
//     cleanApiKey、isInvalidOrPlaceholderKey、resolveOpenAIUrl 等）

export function registerAuthRoutes(app: Express): void {
  // 原样粘贴 login / register / me / logout / update 五个 handler（原 544-704）
}
```

搬移分配：
- `auth.ts`：POST /api/auth/login、POST /api/auth/register、GET /api/auth/me、POST /api/auth/logout、POST /api/auth/update（含 GUEST_USER 导入）。
- `skills.ts`：GET /api/skills、GET /api/skills/:id、POST /api/skills/:id/click、POST ['/api/skills/generate-questions','/api/admin/skills/generate-questions']（双路径原样保留，Task 9 再拆分）、GET /api/tags（原 1564-1567）。
- `chat.ts`：GET/POST/DELETE /api/chat/sessions*、POST /api/chat/stream、POST /api/chat/send（含 SSE 全部逻辑与 metrics 计数）。

handler 体一字不改；`req: AuthRequest` 类型标注保留。

- [ ] **Step 2: index.ts 装配**

在 `app.use(authMiddleware)` 之后、Vite 中间件之前，按原路由顺序调用：

```ts
registerAuthRoutes(app);
registerSkillsRoutes(app);
registerChatRoutes(app);
```

（health、upload-asset、payment、admin 路由此时仍在 index.ts 内，Task 6 处理；顺序保持：health → upload-asset → auth → skills → chat → payment → admin → tags → vite/static。）

- [ ] **Step 3: 验证**：`npm run lint` + dev + 冒烟：

```bash
curl -s http://localhost:3000/api/skills | head -c 120          # skills 列表
curl -s http://localhost:3000/api/tags                          # 标签
curl -s -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" \
  -d '{"phone":"13800000000","code":"123456"}' | head -c 200    # 此时旧库无此号会自动建号（Task 10 才关闭），预期 success:true
curl -s -X POST http://localhost:3000/api/chat/send -H "Content-Type: application/json" \
  -d '{"sessionId":"smoke-2","skillId":"skill-santi","messageText":"测试"}' | head -c 200
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor(server): 提取 auth/skills/chat 路由模块（行为零变化）"
```

### Task 6: 提取 routes/payment.ts、routes/admin.ts，删除 index.ts 剩余路由

**Files:**
- Create: `server/routes/payment.ts`、`server/routes/admin.ts`
- Modify: `server/index.ts`（最终只留：装配、health、静态/Vite、listen）

**Interfaces:**
- Produces: `registerPaymentRoutes(app: Express): void`、`registerAdminRoutes(app: Express): void`

- [ ] **Step 1: 搬移**
- `payment.ts`：create-membership-order、create-order、order-status/:tradeNo、simulate-pay、webhook、GET orders（原 1357-1561，本阶段原样保留，Task 11 删除）。
- `admin.ts`：upload-asset（原 515-540）、POST /api/admin/tags、stats、users GET、users/create、users/:userId DELETE、users/update、upgrade-tier、:userId/membership、clear-all×2、skills POST/DELETE、orders GET、llm-config GET/POST、llm-test（原 1569-2036）。upload-asset 所需 `fs`/`path` 导入随迁。

- [ ] **Step 2: index.ts 最终形态**

```ts
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { PORT, IS_PROD } from './config.js';
import { authMiddleware } from './middleware/auth.js';
import { metrics } from './services/metrics.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerSkillsRoutes } from './routes/skills.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerPaymentRoutes } from './routes/payment.js';
import { registerAdminRoutes } from './routes/admin.js';

async function startServer() {
  const app = express();

  app.use(express.json({ limit: '10mb' }));
  app.use('/assets', express.static(path.join(process.cwd(), 'assets')));

  // 请求计数
  app.use((req, res, next) => {
    metrics.totalRequestsServed++;
    metrics.requestsLastMinute++;
    next();
  });

  app.use(authMiddleware);

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      activeSseConnections: metrics.activeSseConnections,
      peakConcurrentSse: metrics.peakConcurrentSse,
      uptimeSeconds: Math.floor((Date.now() - metrics.startTime) / 1000),
    });
  });

  registerAuthRoutes(app);
  registerSkillsRoutes(app);
  registerChatRoutes(app);
  registerPaymentRoutes(app);
  registerAdminRoutes(app);

  if (!IS_PROD) {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Enterprise Commercial Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
```

- [ ] **Step 3: 验证**：`npm run lint` + dev + 全量冒烟（health、skills、tags、me、chat/send、admin/stats、admin/llm-config、payment/order-status 404 路径）+ 浏览器打开首页点一本书进聊天发一条消息（人工确认 UI 与流式正常）。

```bash
curl -s http://localhost:3000/api/admin/stats | head -c 150      # 此时仍无鉴权（Task 9 收紧），预期 200
curl -s http://localhost:3000/api/admin/llm-config | head -c 150
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor(server): 提取 payment/admin 路由，index.ts 收敛为纯装配层；P1 模块化完成"
```

---

## P2 · 安全加固

### Task 7: 前端 apiFetch 包装器 + AdminPanel 注入 Authorization（D5，零行为变化）

**Files:**
- Create: `src/lib/apiFetch.ts`
- Modify: `src/components/AdminPanel.tsx`（仅 fetch 调用点与 import，UI 零改动）

**Interfaces:**
- Produces: `apiFetch(input: string, init?: RequestInit): Promise<Response>`、`authHeaders(extra?: Record<string,string>): Record<string,string>`（供 Task 14 的 AdminGate 复用）

- [ ] **Step 1: 创建 src/lib/apiFetch.ts**

```ts
// 统一注入 JWT 的 fetch 包装器（token 约定存于 localStorage.auth_token）
export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = { ...(extra || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const merged = authHeaders(init.headers as Record<string, string> | undefined);
  return fetch(input, { ...init, headers: merged });
}
```

- [ ] **Step 2: 替换 AdminPanel.tsx 中指向受保护端点的 fetch**

头部加 `import { apiFetch } from '../lib/apiFetch';`。将下列行号的 `fetch(` 替换为 `apiFetch(`（其余参数不动）：
- 258 `/api/admin/stats`、260 `/api/admin/users`、261 `/api/admin/llm-config`
- 281 POST llm-config、339 users/create、384/413/792 users/update、463 llm-test、523 generate-questions、571 admin/skills、629/665/696/722/763 admin/tags、2232/2301 upload-asset

**不改**：259 `/api/skills`、262 `/api/tags`（公开 GET，保持原样）。

- [ ] **Step 3: 验证**：`npm run lint` + dev + 浏览器：首页 →（当前仍可经 #admin 进后台）→ 后台各 Tab 数据加载正常（此时端点未收紧，行为应与改造前完全一致）。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(front): apiFetch 包装器，AdminPanel 请求统一注入 Authorization（逻辑改动，UI 零变化）"
```

### Task 8: config.ts fail-fast + JWT_SECRET 环境变量 + randomUUID + 移除 query-token

**Files:**
- Modify: `server/config.ts`、`server/middleware/auth.ts`、`server/routes/admin.ts`、`server/routes/chat.ts`、`server/routes/payment.ts`（ID 生成点）

**Interfaces:**
- Produces: `config.ts` 新增导出 `JWT_SECRET: string`、`ADMIN_PHONE: string`、`ADMIN_PASSWORD: string`；`middleware/auth.ts` 不再自定义 JWT_SECRET（改导入）。

- [ ] **Step 1: 扩展 server/config.ts**

```ts
// JWT 签名密钥：生产环境必须显式提供，否则拒绝启动（fail-fast）
export const JWT_SECRET = (() => {
  const secret = (process.env.JWT_SECRET || '').trim();
  if (IS_PROD && secret.length < 16) {
    console.error('FATAL: 生产环境必须设置 JWT_SECRET 环境变量（≥16 字符）');
    process.exit(1);
  }
  return secret || 'distilled_ai_studio_secret_key_2026'; // 仅限本地开发
})();

// 管理员种子账号（首次启动创建，见 Task 10）
export const ADMIN_PHONE = (process.env.ADMIN_PHONE || '').trim();
export const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').trim();
```

- [ ] **Step 2: middleware/auth.ts**

1. 删除本地 `const JWT_SECRET = ...` 与 `import jwt` 之外的密钥定义，改为 `import { JWT_SECRET } from '../config.js';`（`JWT_EXPIRES_IN = '7d'` 保留在本文件并导出）。
2. `extractUserFromRequest` 中删除 query-token 分支（原 444-446：`} else if (req.query.token ...)`）。执行前先验证前端无使用：`grep -rn "token=" src/ --include="*.tsx"` 预期无 URL 传 token 命中；若有命中则保留分支并在提交信息注明。

- [ ] **Step 3: ID 生成改 crypto.randomUUID**

- `routes/admin.ts` users/create：`const userId = 'usr_' + crypto.randomUUID();`、`const unionId = 'union_' + crypto.randomUUID();`（替换原手机号截取+Date.now 拼接，原 1662-1663）
- `routes/payment.ts`：`id: 'ord-' + crypto.randomUUID()`（两处订单创建；tradeNo 保留 `VIP_` + Date.now 格式——对账展示用，非安全敏感）
- `routes/chat.ts` 新建 session：`id: 'session-' + crypto.randomUUID()`
- `routes/auth.ts` login 自动建号分支的 `'usr_' + Math.floor(...)`（该分支 Task 10 整体删除，此处不必改）

`crypto.randomUUID` 为 Node 22 全局 API，无需导入。

- [ ] **Step 4: 验证**：`npm run lint` + dev + 冒烟：

```bash
NODE_ENV=production JWT_SECRET= node -e "process.env.NODE_ENV='production'; import('./server/config.ts')" 2>/dev/null || true
# 更直接：JWT_SECRET= NODE_ENV=production npx tsx -e "import('./server/config.js').catch(()=>{})" —— 预期进程输出 FATAL 并退出码 1
curl -s http://localhost:3000/api/health   # dev 模式正常
```

（dev 模式下不设 JWT_SECRET 应正常启动——开发兜底密钥仍生效。）

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(server): JWT_SECRET fail-fast、crypto.randomUUID ID、移除 query-token 认证"
```

### Task 9: requireAdmin 全覆盖 + generate-questions 拆分 + user 对象剥离 password（D6/D8）

**Files:**
- Create: `server/middleware/admin.ts`
- Modify: `server/routes/admin.ts`、`server/routes/skills.ts`、`server/routes/auth.ts`、`server/routes/chat.ts`、`server/middleware/auth.ts`（sanitizeUser 放此处）

**Interfaces:**
- Produces: `requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void`（403 `{"error":"FORBIDDEN","message":"需要管理员权限"}`）；`sanitizeUser(user: UserProfile): UserProfile`（剥离 password）。

- [ ] **Step 1: 创建 server/middleware/admin.ts**

```ts
import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';

// 管理端点强制鉴权：JWT 有效且为 admin 角色
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  const u = req.user;
  if (!u || (u.role !== 'admin' && !u.isAdmin)) {
    res.status(403).json({ error: 'FORBIDDEN', message: '需要管理员权限' });
    return;
  }
  next();
}
```

- [ ] **Step 2: middleware/auth.ts 增加 sanitizeUser 并全局应用**

```ts
// 对外返回的用户对象一律剥离密码字段（哈希也不可出网）
export function sanitizeUser(user: UserProfile): UserProfile {
  const { password: _password, ...rest } = user;
  return rest;
}
```

应用点（响应中所有 user 对象包一层 sanitizeUser）：
- `routes/auth.ts`：login 成功响应（`user: { ...user, token }` → `user: { ...sanitizeUser(user), token }`）、GET me（两处：req.user 与 GUEST_USER 分支）、POST update 响应
- `routes/admin.ts`：users GET（`users.map(sanitizeUser)`）、users/create、users/update、upgrade-tier、:userId/membership 响应
- `routes/chat.ts`：stream 的 done 载荷 `user: quota.updatedUser || currentUser` → `user: sanitizeUser(quota.updatedUser || currentUser || GUEST_USER)`；send 响应同理

`extractUserFromRequest` 内部返回的 req.user 保留 password（服务端校验需要），只在**出网响应**处剥离。

- [ ] **Step 3: routes/admin.ts 全部路由挂 requireAdmin**

每个 `app.get/post/delete('/api/admin/...'` 的参数列表第二位插入 `requireAdmin`，覆盖：upload-asset、tags POST、stats、users GET、users/create、users/:userId DELETE、users/update、upgrade-tier、:userId/membership、users/clear-all、orders/clear-all、skills POST、skills/:id DELETE、orders GET、llm-config GET/POST、llm-test。共 18 个注册点，逐一核对不遗漏。

- [ ] **Step 4: generate-questions 双路径拆分（D8）**

`routes/skills.ts` 中原双路径注册拆为两个：

```ts
// 公开路径：限流由 Task 13 挂载；skillId 落库仅管理员生效（防未授权篡改书籍数据）
app.post('/api/skills/generate-questions', async (req: AuthRequest, res) => {
  // 原 handler 体，唯一改动：skillId 更新分支外包条件
  //   const canWrite = req.user?.role === 'admin' || req.user?.isAdmin;
  //   if (skillId && typeof skillId === 'string' && canWrite) { ...原落库逻辑... }
});

// 管理路径：requireAdmin 保护
app.post('/api/admin/skills/generate-questions', requireAdmin, async (req: AuthRequest, res) => {
  // 与原 handler 完全一致（含落库）——将原 handler 提取为共享函数 invokeGenerateQuestions(req, res, canWrite: boolean) 供两处复用
});
```

实施提示：把原 handler 体提取为模块内共享函数 `invokeGenerateQuestions(req: AuthRequest, res: Response, canWrite: boolean)`，两个注册点分别以 `canWrite=false`（公开，但 req.user 为 admin 时升为 true）与 `canWrite=true`（管理路径）调用，避免代码重复（AGENTS.md 复用原则）。

- [ ] **Step 5: 验证**：`npm run lint` + dev + 冒烟（**关键安全断言**）：

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/admin/stats                 # 预期 403
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/admin/llm-config            # 预期 403
curl -s -X POST http://localhost:3000/api/admin/users/clear-all | head -c 100                # 预期 FORBIDDEN
curl -s http://localhost:3000/api/auth/me | grep -c password                                 # 预期 0
# 管理员正向链路待 Task 10 种子账号后复验
```

浏览器：普通用户视角首页/聊天完全正常（不受影响）。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(server): requireAdmin 全覆盖、user 响应剥离 password、generate-questions 权限拆分"
```

### Task 10: bcrypt 密码哈希 + 关闭自助注册（D2/D3/D4）+ 管理员种子账号

**Files:**
- Create: `server/services/adminSeed.ts`
- Modify: `package.json`（依赖）、`server/routes/auth.ts`、`server/routes/admin.ts`、`server/index.ts`（启动时调用种子）

**Interfaces:**
- Produces: `ensureAdminSeed(): void`（幂等：库中无 admin 时按 env 创建）

- [ ] **Step 1: 安装依赖**

```bash
npm install bcryptjs        # v3.x 自带类型，无需 @types
```

- [ ] **Step 2: routes/auth.ts login 改造**

1. 头部 `import bcrypt from 'bcryptjs';`
2. 校验逻辑替换（原 571-580 的明文比对与"未设密码即存输入"分支整体删除）：

```ts
if (user) {
  const storedHash = (user.password || '').trim();
  if (!storedHash || !bcrypt.compareSync(cleanCode, storedHash)) {
    return res.status(400).json({ error: '登录密码或验证码错误，请重新输入' });
  }
  // ...（role/tier/dailyMaxChats 归一化逻辑原样保留）
} else {
  // 仅管理员建号：不再自动注册（原自动建号分支删除）
  return res.status(404).json({ error: '该账号不存在，内测阶段账号由管理员统一开通，请联系管理员' });
}
```

3. **删除整个 POST /api/auth/register 路由**（前端零调用，见 D2）。

- [ ] **Step 3: routes/admin.ts 密码哈希**

1. users/create：`password: bcrypt.hashSync(cleanCode, 10)`（原 `password: cleanCode`）
2. users/update 验证码更新分支：`user.password = bcrypt.hashSync(newCode.trim(), 10)`

- [ ] **Step 4: 创建 server/services/adminSeed.ts**

```ts
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db } from '../../src/db.js';
import { ADMIN_PHONE, ADMIN_PASSWORD } from '../config.js';

// 幂等确保存在管理员账号：优先环境变量，缺省生成随机 6 位数字密码并打印一次
export function ensureAdminSeed(): void {
  const admins = db.getUsers().filter((u) => u.role === 'admin' || u.isAdmin);
  if (admins.length > 0) return;

  const phone = ADMIN_PHONE || '13900000000';
  if (db.getUserByPhone(phone)) {
    console.warn(`⚠️ 手机号 ${phone} 已存在但非管理员，跳过管理员种子创建，请手动提权`);
    return;
  }
  const password = ADMIN_PASSWORD && ADMIN_PASSWORD.length >= 6 ? ADMIN_PASSWORD : crypto.randomInt(0, 1000000).toString().padStart(6, '0');

  db.saveUser({
    id: 'usr_' + crypto.randomUUID(),
    unionId: 'union_admin_' + crypto.randomUUID(),
    phone,
    password: bcrypt.hashSync(password, 10),
    nickname: '管理员',
    avatar: '',
    role: 'admin',
    membershipTier: 'yearly_member',
    isAdmin: true,
    dailyMaxChats: 9999,
    createdAt: new Date().toISOString(),
  } as any);

  console.log(`✅ 管理员种子账号已创建：手机号 ${phone} / 初始密码 ${password}（请立即登录后修改，本提示仅出现一次）`);
}
```

- [ ] **Step 5: index.ts 启动调用**

`startServer()` 内、`registerAuthRoutes(app)` 之前加：

```ts
import { ensureAdminSeed } from './services/adminSeed.js';
// ...
ensureAdminSeed();
```

- [ ] **Step 6: 验证**：`npm run lint` + 删除本地旧库（`rm -f commercial.sqlite`，数据已确认可清空）+ dev 启动（观察管理员种子日志）+ 冒烟：

```bash
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" \
  -d '{"phone":"13900000000","code":"<种子日志中的密码>"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).token||''))")
echo "token: ${ADMIN_TOKEN:0:20}..."
curl -s http://localhost:3000/api/admin/stats -H "Authorization: Bearer $ADMIN_TOKEN" | head -c 150   # 预期 200
curl -s -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" \
  -d '{"phone":"13712345678","code":"123456"}'   # 预期 404 该账号不存在...
curl -s -X POST http://localhost:3000/api/admin/users/create -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"phone":"13712345678","code":"246810"}' | head -c 200  # 预期 success:true
curl -s -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" \
  -d '{"phone":"13712345678","code":"111111"}'   # 预期 400 密码错误
curl -s -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" \
  -d '{"phone":"13712345678","code":"246810"}' | grep -c '"password"'   # 预期 0（已剥离）
```

浏览器人工验证：LoginModal 用管理员账号登录成功；建号用户可登录聊天；AdminPanel 编辑用户表单密码框显示为空（D6 预期行为，留空提交不改变密码）。

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(server): bcrypt 密码哈希、关闭自助注册（仅管理员建号）、管理员种子账号"
```

### Task 11: 删除支付路由（D1）

**Files:**
- Delete: `server/routes/payment.ts`
- Modify: `server/index.ts`（移除注册调用与导入）

**Interfaces:**
- Consumes: 无（纯删除）。`OrderLog` 类型与 orders 表、`/api/admin/orders` 管理端点**保留**（AdminPanel 订单页依赖）。

- [ ] **Step 1: 删除**

```bash
git rm server/routes/payment.ts
```

index.ts 删除 `import { registerPaymentRoutes } ...` 与 `registerPaymentRoutes(app);` 两行。

- [ ] **Step 2: 验证**：`npm run lint` + dev + 冒烟：

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/payment/simulate-pay            # 预期 404
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/payment/create-membership-order  # 预期 404
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/payment/webhook                  # 预期 404
# 管理员 token 下 /api/admin/orders 预期 200（订单管理保留）
```

浏览器：首页与聊天 UI 无任何变化（前端本就无支付调用）。

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(server): 删除全部模拟支付路由（前端零调用，管理员手动开通会员）"
```

### Task 12: /api/config/public + App.tsx 切换

**Files:**
- Create: `server/routes/config.ts`
- Modify: `server/index.ts`、`src/App.tsx`（仅一行 URL）

**Interfaces:**
- Produces: `registerConfigRoutes(app: Express): void`；`GET /api/config/public` → `{ llmConfig: { timeoutSec, dailyLimits, membershipPlans, agreements } }`（响应外层键名保持 `llmConfig`，使 App.tsx 仅改 URL）

- [ ] **Step 1: 创建 server/routes/config.ts**

```ts
import { Express } from 'express';
import { db } from '../../src/db.js';

// 公开配置端点：仅暴露前端启动所需的非敏感配置，绝不返回 apiKey / apiBaseUrl
export function registerConfigRoutes(app: Express): void {
  app.get('/api/config/public', (req, res) => {
    const c = db.getLLMConfig();
    res.json({
      llmConfig: {
        timeoutSec: c.timeoutSec,
        dailyLimits: c.dailyLimits,
        membershipPlans: c.membershipPlans,
        agreements: c.agreements,
      },
    });
  });
}
```

index.ts 导入并注册（与其他 register 并列）。

- [ ] **Step 2: App.tsx 切换（原 55 行）**

`fetch('/api/admin/llm-config')` → `fetch('/api/config/public')`。其余逻辑（dailyMaxChats 联动）不动。

- [ ] **Step 3: 验证**：`npm run lint` + dev + 冒烟：

```bash
curl -s http://localhost:3000/api/config/public | grep -c apiKey    # 预期 0
curl -s http://localhost:3000/api/config/public | head -c 200       # 预期含 dailyLimits/membershipPlans/agreements
```

浏览器：游客打开首页，Network 面板确认不再请求 /api/admin/llm-config，额度展示正常。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: 公开配置端点 /api/config/public（密钥脱敏），App 启动拉取切换"
```

### Task 13: helmet + 限流

**Files:**
- Modify: `package.json`、`server/index.ts`、`server/routes/auth.ts`、`server/routes/skills.ts`

**Interfaces:**
- Produces: `middleware/rateLimit.ts` 不需要独立文件（用量小，直接在装配处定义，遵循最少代码原则）

- [ ] **Step 1: 安装**

```bash
npm install helmet express-rate-limit
```

- [ ] **Step 2: index.ts 装配**（`app.use(express.json(...))` 之前）

```ts
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

// 安全头（CSP 关闭：避免破坏现有内联样式与 unsplash 外链封面，UI 硬约束）
app.use(helmet({ contentSecurityPolicy: false }));
// 全局限流：300 次/分/IP
app.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));
```

- [ ] **Step 3: 敏感端点收紧**

`routes/auth.ts` login（导出共享限流器供本文件使用）：

```ts
const authLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: '尝试过于频繁，请稍后再试' } });
app.post('/api/auth/login', authLimiter, async (req, res) => { ... });
```

`routes/skills.ts` 公开 generate-questions（D8，LLM 成本敏感）：

```ts
const questionsLimiter = rateLimit({ windowMs: 3600_000, limit: 10, message: { error: '请求过于频繁，请稍后再试' } });
app.post('/api/skills/generate-questions', questionsLimiter, async (req: AuthRequest, res) => { ... });
```

- [ ] **Step 4: 验证**：`npm run lint` + dev + 冒烟：

```bash
for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code} " -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"phone":"13800000001","code":"111111"}'; done
# 预期：前 10 个 400/404，后 2 个 429
curl -sI http://localhost:3000/api/health | grep -i "ratelimit\|x-content-type\|cross-origin" | head -5   # helmet/限流头存在
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(server): helmet 安全头与分级限流（全局300/分、登录10/分、问题生成10/时）"
```

### Task 14: 管理后台入口剥离 + /admin 独立入口页

**Files:**
- Create: `admin.html`（根目录）、`src/admin-main.tsx`、`src/components/AdminGate.tsx`
- Modify: `src/App.tsx`、`src/components/AiStudioWorkspace.tsx`、`vite.config.ts`、`server/index.ts`

**Interfaces:**
- Consumes: `apiFetch`/`authHeaders`（Task 7）、AdminPanel 现有 props 签名 `{ llmConfig, setLlmConfig, skills, setSkills, user, setUser, onClose }`
- Produces: 路由 `/admin`（dev 重定向至 /admin.html；prod 直出 dist/admin.html）

- [ ] **Step 1: AiStudioWorkspace.tsx 移除后台按钮（已授权例外①）**

1. 删除原 859-866 的 `<button onClick={onOpenAdmin} ...><Settings .../></button>` 整块。
2. 接口 `AiStudioWorkspaceProps` 删除 `onOpenAdmin: () => void;`（原 49 行），函数签名解构中删除 `onOpenAdmin,`（原 63 行）。
3. `grep -n "Settings" src/components/AiStudioWorkspace.tsx`：若 lucide 导入的 `Settings` 图标再无其他使用处，从 import 列表中删除；若仍有使用则保留。

- [ ] **Step 2: App.tsx 清理后台逻辑**

删除：`AdminPanel` import、`isAdminOpen` state（原 87-93）、URL 监听 effect（原 96-111）、`openAdmin`/`closeAdmin`（原 113-126）、`onOpenAdmin={openAdmin}` prop、`{isAdminOpen && <AdminPanel .../>}` 块（原 168-178）。其余（LoginModal、用户同步、llmConfig 拉取）不动。

- [ ] **Step 3: 创建 admin.html（根目录）**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>管理后台</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/admin-main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: 创建 src/admin-main.tsx**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminGate } from './components/AdminGate';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminGate />
  </StrictMode>,
);
```

- [ ] **Step 5: 创建 src/components/AdminGate.tsx**（新建入口页，已授权例外②；风格沿用现有 Tailwind 设计语言）

```tsx
import React, { useEffect, useState } from 'react';
import { UserProfile, Skill, LLMConfig } from '../types';
import { DEFAULT_LLM_CONFIG } from '../data/initialData';
import { AdminPanel } from './AdminPanel';
import { authHeaders } from '../lib/apiFetch';

// 管理后台独立入口：先验证管理员身份，再渲染原封不动的 AdminPanel
export const AdminGate: React.FC = () => {
  const [admin, setAdmin] = useState<UserProfile | null>(null);
  const [checking, setChecking] = useState(true);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [llmConfig, setLlmConfig] = useState<LLMConfig>(DEFAULT_LLM_CONFIG);
  const [skills, setSkills] = useState<Skill[]>([]);

  // 已持有有效管理员 token 则直接进入
  useEffect(() => {
    fetch('/api/auth/me', { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => {
        if (data.user && (data.user.role === 'admin' || data.user.isAdmin)) setAdmin(data.user);
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || '登录失败');
        return;
      }
      if (data.user?.role !== 'admin' && !data.user?.isAdmin) {
        setError('该账号非管理员，禁止访问后台');
        return;
      }
      if (data.token) localStorage.setItem('auth_token', data.token);
      setAdmin(data.user);
    } catch {
      setError('网络请求异常，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500 text-sm">
        正在验证身份…
      </div>
    );
  }

  if (!admin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl border border-gray-200 p-6">
          <h1 className="font-bold text-base text-gray-900 mb-4">管理后台登录</h1>
          <form onSubmit={handleLogin} className="space-y-3">
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">管理员手机号</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={11}
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                placeholder="请输入11位手机号"
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-gray-900"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">密码 / 验证码</label>
              <input
                type="password"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="6位数字"
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-gray-900"
              />
            </div>
            {error && <p className="text-xs text-rose-500">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2 bg-gray-900 text-white text-xs font-medium rounded-xl hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              {submitting ? '登录中…' : '登录'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <AdminPanel
      llmConfig={llmConfig}
      setLlmConfig={setLlmConfig}
      skills={skills}
      setSkills={setSkills}
      user={admin}
      setUser={setAdmin}
      onClose={() => {
        window.location.href = '/';
      }}
    />
  );
};
```

- [ ] **Step 6: vite.config.ts 多页入口**

```ts
build: {
  rollupOptions: {
    input: {
      main: path.resolve(__dirname, 'index.html'),
      admin: path.resolve(__dirname, 'admin.html'),
    },
  },
},
```

（合入现有 defineConfig 返回对象。）

- [ ] **Step 7: server/index.ts 路由**

dev 分支（vite 中间件挂载前）：`app.get('/admin', (_req, res) => res.redirect('/admin.html'));`
prod 分支（express.static 之后、catch-all 之前）：`app.get('/admin', (_req, res) => res.sendFile(path.join(distPath, 'admin.html')));`

- [ ] **Step 8: 验证**：`npm run lint` + `npm run build`（多页构建成功，dist 含 index.html 与 admin.html）+ dev 冒烟：

浏览器（dev）：
1. `http://localhost:3000/` → 首页正常，顶栏"问书"旁**齿轮按钮消失**，地址栏输 `#admin` 无反应；
2. `http://localhost:3000/admin` → 重定向 `/admin.html` → 管理员登录页；
3. 普通用户账号登录 → 「该账号非管理员，禁止访问后台」；
4. 管理员账号登录 → AdminPanel 完整功能（统计/用户/书籍/标签/LLM 配置各 Tab 数据加载正常——依赖 Task 7 的 apiFetch）；
5. 像素级对照：主页/聊天/LoginModal 与改造前一致（git 基线可 `git stash` 对照或截图比对）。

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: 管理后台入口自主前端剥离，新增 /admin 独立登录入口（AdminPanel 组件零修改）"
```

---

## P3 · 冗余清理

### Task 15: 买断制/legacy/死代码全量清理

**Files:**
- Modify: `src/types.ts`、`src/data/initialData.ts`、`src/db.ts`、`server/routes/admin.ts`、`server/routes/auth.ts`、`server/routes/chat.ts`（视引用而定）
- Delete: `src/data/mockData.ts`、`metadata.json`、`assets/.aistudio/`

**Interfaces:**
- 类型收窄（消费方全部随改）：`PriceType` 删除；`Skill` 移除 `priceType`/`buyoutPrice`；`UserProfile` 移除 `unlockedSkillIds`/`buyoutUsedCount`/`buyoutUsageMap`/`invitedCount`/`referralCode`；`DailyLimitsConfig` 移除 `buyoutUser`；`OrderPlanType` 收窄为 `'monthly' | 'quarterly' | 'yearly'`；`OrderLog.type` 收窄为 `'membership'`；`LLMConfig` 移除 `proxyBufferingOff`/`simulateTimeout`。

- [ ] **Step 1: 前置核实（每项删除的依据）**

```bash
grep -rn "mockData" src/ server/ index.html vite.config.ts     # 预期：仅 mockData.ts 自身 → 可删
grep -rn "metadata.json\|aistudio" src/ server/ index.html vite.config.ts package.json  # 预期无运行时引用 → 可删
grep -rn "invitedCount\|referralCode\|referral_code\|invited_count" src/components/    # 预期 0 命中 → 可删（若命中则停止，上报用户）
grep -rn "priceType\|buyout\|unlockedSkillIds" src/components/  # 预期 0 命中（已初步核实）→ 可删
grep -rn "proxyBufferingOff\|simulateTimeout" server/           # 预期 0 命中 → 可删
```

- [ ] **Step 2: 逐文件清理**

1. `src/types.ts`：删除上表所列字段/类型值（含 `// legacy backward compatibility` 注释行）。
2. `src/data/initialData.ts`：删除每个 INITIAL_SKILLS 条目中的 `priceType: 'free_trial',` 行；DEFAULT_LLM_CONFIG 删除 `proxyBufferingOff: true,`。
3. `src/db.ts`（本阶段仍是 sql.js 实现，Task 16 才重写；此处同步删列保证 lint 通过）：
   - createTables：users 表删除 `buyout_used_count`、`buyout_usage_map`、`unlocked_skill_ids`、`invited_count`、`referral_code` 列；skills 表删除 `price_type`、`buyout_price` 列
   - migrateSchemaIfNeeded：删除 buyout 相关 ALTER 分支（原 176-180）
   - saveUser/INSERT、mapUserRowToProfile、upgradeUserMembership、saveSkill/INSERT、mapSkillRow：删除对应字段读写（原 248/259/355-372/464-466/496-510/541/561/572 等处）
4. `server/routes/admin.ts`：users/create 的 newUser 对象删除 `buyoutUsedCount/buyoutUsageMap/unlockedSkillIds/invitedCount` 字段（原 1703-1708）；skills POST 的 skillData 删除 `priceType`/`buyoutPrice`（原 1859-1860）。
5. `server/routes/auth.ts`：login 建号分支已删（Task 10）；如残留 buyout 字段引用一并清除。
6. 删除文件：`git rm src/data/mockData.ts metadata.json && git rm -r assets/.aistudio`。

- [ ] **Step 3: 验证**：`npm run lint`（**类型收窄后全库编译通过是核心断言**——任何漏改的引用都会在此暴露）+ `rm -f commercial.sqlite` + dev 启动（全新建库）+ 冒烟：

```bash
curl -s http://localhost:3000/api/skills | head -c 200      # 种子书籍正常，无 priceType 字段
curl -s -X POST http://localhost:3000/api/chat/send -H "Content-Type: application/json" \
  -d '{"sessionId":"smoke-3","skillId":"skill-santi","messageText":"你好"}' | head -c 200
```

浏览器：首页卡片渲染与改造前逐像素一致（priceType 本就未渲染）。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: 清理买断制/legacy/死代码残余（buyout、unlockedSkillIds、mockData、调试标志、AI Studio 导出残余）"
```

---

## P4 · 数据层替换

### Task 16: better-sqlite3 + server/db.ts 迁移 + DATA_DIR + 优雅关闭

**Files:**
- Move/Rewrite: `src/db.ts` → `server/db.ts`（公开方法签名不变，内核重写）
- Modify: `package.json`（+better-sqlite3，-sql.js，-@types/sql.js）、`server/config.ts`（+DATA_DIR）、`server/index.ts`（导入路径、/assets 路径、优雅关闭）、`server/routes/admin.ts`（upload-asset 路径）、其余 server/routes/*、server/services/*（db 导入路径 `'../../src/db.js'` → `'../db.js'`）

**Interfaces:**
- Produces:
  - `config.ts`: `DATA_DIR: string`（默认 `path.join(process.cwd(), 'data')`，env `DATA_DIR` 覆盖）
  - `server/db.ts`: `class CommercialSQLDatabase`（公开方法签名与现有 25 个 public 方法完全一致：getUsers/getUserById/getUserByPhone/saveUser/upgradeUserMembership/deleteUser/clearAllUsers/getSkills/getSkillById/saveSkill/deleteSkill/getTags/saveTags/getLLMConfig/saveLLMConfig/getChatSessions/getChatSessionById/saveChatSession/deleteChatSession/getOrders/getOrderByTradeNo/createOrder/updateOrderStatus/clearAllOrders/getAdminStats）+ `close(): void`；`export const db = new CommercialSQLDatabase();`

- [ ] **Step 1: 前置核实 + 依赖**

```bash
grep -rn "from '.*db" src/ --include="*.tsx" --include="*.ts" | grep -v "src/db.ts"   # 预期 0 命中（前端不依赖 db）
npm install better-sqlite3 && npm uninstall sql.js @types/sql.js
npm install -D @types/better-sqlite3
```

- [ ] **Step 2: config.ts 增加 DATA_DIR**

```ts
import path from 'path';
// 运行数据根目录（数据库/上传素材/备份），容器部署时挂载持久卷
export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
```

- [ ] **Step 3: 移动并重写 server/db.ts**

```bash
git mv src/db.ts server/db.ts
```

重写要点（公开签名逐一保持）：
1. 头部：

```ts
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { UserProfile, Skill, ChatSession, OrderLog, LLMConfig, MembershipTier, getEffectiveMembershipTier } from '../src/types.js';
import { INITIAL_SKILLS, DEFAULT_LLM_CONFIG } from '../src/data/initialData.js';
import { DATA_DIR } from './config.js';

const SQLITE_DB_PATH = path.join(DATA_DIR, 'commercial.sqlite');
```

2. 初始化（构造函数同步完成，删除 async/isInitialized/persistToDisk/scheduleSave/saveTimeout 全套）：

```ts
constructor() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'backups'), { recursive: true });
  this.db = new Database(SQLITE_DB_PATH);
  this.db.pragma('journal_mode = WAL');
  this.db.pragma('busy_timeout = 5000');
  this.createTables();
  this.createIndices();
  this.seedInitialData();
  console.log('✅ Commercial SQLite Engine (better-sqlite3, write-through WAL) at:', SQLITE_DB_PATH);
}

public close(): void {
  this.db?.close();
  this.db = null;
}
```

3. API 翻译模式（sql.js → better-sqlite3），全文件按此逐方法转换：

| sql.js 旧写法 | better-sqlite3 新写法 |
|---|---|
| `this.db.run(sql, params)` | `this.db!.prepare(sql).run(params)` |
| `this.db.exec(sql)` 取查询结果 | `this.db!.prepare(sql).all(params)`（返回对象数组，**键即列名**，不再是 `res[0].values` 二维数组） |
| 单行查询 `exec` + `values[0]` | `this.db!.prepare(sql).get(params)`（无行返回 `undefined`） |
| 行数据 `row[index]` 按列序号取值 | `row.column_name` 按列名取值（mapUserRowToProfile/mapSkillRow 等映射函数相应改为按列名） |
| 事务批量 | `this.db!.transaction(() => {...})()` |

代表性示例（其余方法同构转换）：

```ts
public getUserById(id: string): UserProfile | undefined {
  if (!this.db) return undefined;
  const row = this.db.prepare(`SELECT * FROM users WHERE id = ? OR union_id = ?`).get(id, id) as any;
  return row ? this.mapUserRowToProfile(row) : undefined;
}

public saveUser(user: UserProfile): UserProfile {
  if (!this.db) return user;
  this.db.prepare(
    `INSERT OR REPLACE INTO users (id, union_id, phone, password, nickname, avatar, role, membership_tier,
      membership_expires_at, daily_max_chats, daily_used_count, guest_used_count, is_admin, last_active_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    user.id, user.unionId, user.phone ?? null, user.password ?? null, user.nickname, user.avatar ?? null,
    user.role, user.membershipTier ?? 'free_member', user.membershipExpiresAt ?? null,
    user.dailyMaxChats ?? 10, user.dailyUsedCount ?? 0, user.guestUsedCount ?? 0,
    user.isAdmin || user.role === 'admin' ? 1 : 0, user.lastActiveDate ?? null, user.createdAt ?? null
  );
  return user;
}
```

4. Schema（Task 15 已清冗余列的最终形态）：users（id/union_id/phone/password/nickname/avatar/role/membership_tier/membership_expires_at/daily_max_chats/daily_used_count/guest_used_count/is_admin/last_active_date/created_at）、skills（id/title/author/description/category/cover_url/tags/system_prompt/catalog_content/book_content/token_count/preferred_model/sample_questions/chat_count/search_count）、chat_sessions、orders、system_config——列定义照抄现文件（去除已删字段），JSON 序列化字段（tags/sample_questions/messages 等）沿用 `JSON.stringify/parse` 现有约定。
5. `migrateSchemaIfNeeded`、`cleanResidualMockData`：整个删除（全新建库，无历史包袱）。
6. `getAdminStats`：逻辑保留，`databaseType` 字符串改为 `'SQLite (better-sqlite3, WAL)'`，删除 `totalMessages` 若其依赖已删表结构则按现查询逻辑等价保留。

- [ ] **Step 4: 全库导入路径更新**

```bash
grep -rln "src/db.js" server/    # 全部改为相对新路径（routes/* 与 services/* → '../db.js'；index.ts → './db.js'）
```

- [ ] **Step 5: 素材目录切 DATA_DIR**

- `server/index.ts`：`app.use('/assets', express.static(path.join(process.cwd(), 'assets')))` → `express.static(path.join(DATA_DIR, 'assets'))`（导入 DATA_DIR）
- `server/routes/admin.ts` upload-asset：`const assetsDir = path.join(process.cwd(), 'assets')` → `path.join(DATA_DIR, 'assets')`

- [ ] **Step 6: 优雅关闭（index.ts listen 改造）**

```ts
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Enterprise Commercial Server running on http://0.0.0.0:${PORT}`);
});

// 容器停止/重启时优雅退出：停止接流 → 关闭数据库
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    console.log(`收到 ${sig}，开始优雅关闭…`);
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
```

- [ ] **Step 7: 验证**：`npm run lint` + `rm -f commercial.sqlite && rm -rf data` + dev 启动（预期日志：better-sqlite3 初始化 + data/ 目录出现 + 管理员种子）+ 冒烟：

```bash
ls data/                                   # 预期 commercial.sqlite commercial.sqlite-wal commercial.sqlite-shm assets/ backups/
curl -s http://localhost:3000/api/skills | head -c 150
curl -s -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" \
  -d '{"phone":"13900000000","code":"<种子密码>"}' | head -c 120
# 管理员 token 建号 → 普通用户登录 → 发消息 → 重启 dev 进程 → 会话与账号仍在（write-through 断言）
```

浏览器：完整走一遍 游客聊天 → 登录 → 后台建号/改配置 → 刷新数据仍在。根目录旧 `commercial.sqlite` 文件确认不再生成后 `git status` 干净。

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(server): 数据层迁移 better-sqlite3（write-through+WAL）、DATA_DIR 持久化、优雅关闭"
```

---

## P5 · 部署产物与演练

### Task 17: Dockerfile + compose + Caddy 模板 + .env.example

**Files:**
- Create: `docker/Dockerfile`、`docker/compose.yaml`、`docker/Caddyfile.template`
- Modify: `.env.example`

- [ ] **Step 1: docker/Dockerfile**（D7：glibc slim 镜像）

```dockerfile
# ---- 构建阶段 ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- 运行阶段 ----
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/server.cjs"]
```

- [ ] **Step 2: docker/compose.yaml**

```yaml
services:
  app:
    build:
      context: ..
      dockerfile: docker/Dockerfile
    restart: unless-stopped
    env_file: ../.env
    environment:
      NODE_ENV: production
      PORT: "3000"
      DATA_DIR: /app/data
    ports:
      - "${HOST_PORT:-3000}:3000"
    volumes:
      - ../data:/app/data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3

  # 域名备案后启用：docker compose --profile https up -d
  caddy:
    image: caddy:2
    profiles: ["https"]
    restart: unless-stopped
    depends_on: [app]
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config

volumes:
  caddy_data:
  caddy_config:
```

- [ ] **Step 3: docker/Caddyfile.template**

```
# 备案完成后：复制为 docker/Caddyfile，替换域名，执行
#   docker compose --profile https up -d
你的域名.com {
    reverse_proxy app:3000 {
        # SSE 流式响应必需：禁用代理缓冲
        flush_interval -1
    }
}
```

- [ ] **Step 4: 更新 .env.example**（全量替换）

```
# ===== 运行时 =====
NODE_ENV="production"
PORT="3000"
DATA_DIR="./data"
# 生产环境必填（≥16字符），缺失将拒绝启动
JWT_SECRET=""
# 管理员种子账号（首次启动创建；缺省 13900000000 + 随机6位密码打印至日志）
ADMIN_PHONE=""
ADMIN_PASSWORD=""

# ===== LLM（也可由管理员登录后在后台 /admin 配置，存于数据库） =====
GEMINI_API_KEY=""
DEEPSEEK_API_KEY=""
DEEPSEEK_BASE_URL="https://api.deepseek.com/v1"
DEEPSEEK_MODEL="deepseek-chat"
```

- [ ] **Step 5: 验证**：`npm run lint`（不涉及 TS 变更，应直接通过）+ 本地构建演练：

```bash
docker compose -f docker/compose.yaml build    # 预期构建成功
docker compose -f docker/compose.yaml up -d    # 需本地 .env 提供 JWT_SECRET
curl -s http://localhost:3000/api/health       # 预期 ok
docker compose -f docker/compose.yaml logs app | head -20   # 预期 better-sqlite3 初始化 + 管理员种子日志
docker compose -f docker/compose.yaml down
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(deploy): Dockerfile/compose/Caddy 模板与 .env.example"
```

### Task 18: backup.sh + smoke.sh + deploy.md + 完整演练

**Files:**
- Create: `scripts/backup.sh`、`scripts/smoke.sh`、`docs/deploy.md`

- [ ] **Step 1: scripts/backup.sh**

```bash
#!/usr/bin/env bash
# 每日热备份 SQLite（宿主机 crontab 调用，需 apt install sqlite3）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="${DATA_DIR:-$ROOT/data}"
KEEP_DAYS=14
mkdir -p "$DATA/backups"
sqlite3 "$DATA/commercial.sqlite" ".backup '$DATA/backups/db-$(date +%F).sqlite'"
find "$DATA/backups" -name 'db-*.sqlite' -mtime +"$KEEP_DAYS" -delete
echo "backup done: $DATA/backups/db-$(date +%F).sqlite"
```

- [ ] **Step 2: scripts/smoke.sh**（对应 spec 6.2 全部断言）

```bash
#!/usr/bin/env bash
# 部署后冒烟验证：BASE=http://IP:PORT ADMIN_PHONE=xxx ADMIN_CODE=xxx ./scripts/smoke.sh
set -uo pipefail
BASE="${BASE:-http://localhost:3000}"
PASS=0; FAIL=0
check() { # check <名称> <预期> <实际>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✅ $1"; else FAIL=$((FAIL+1)); echo "  ❌ $1 (预期 $2, 实际 $3)"; fi
}
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

echo "== 冒烟验证 $BASE =="
check "health 200" "200" "$(code "$BASE/api/health")"
check "public 配置不含 apiKey" "0" "$(curl -s "$BASE/api/config/public" | grep -c apiKey)"
check "public 配置含 dailyLimits" "1" "$(curl -s "$BASE/api/config/public" | grep -c dailyLimits | head -1 | sed 's/^[0-9]*$/1/')"
check "游客访问 admin/stats 被拒" "403" "$(code "$BASE/api/admin/stats")"
check "游客访问 admin/llm-config 被拒" "403" "$(code "$BASE/api/admin/llm-config")"
check "游客清空用户被拒" "403" "$(code -X POST "$BASE/api/admin/users/clear-all")"
check "注册端点已移除" "404" "$(code -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' -d '{}')"
check "simulate-pay 已移除" "404" "$(code -X POST "$BASE/api/payment/simulate-pay")"
check "webhook 已移除" "404" "$(code -X POST "$BASE/api/payment/webhook")"
check "未知手机号登录被拒" "404" "$(code -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"phone":"19999999999","code":"123456"}')"

if [ -n "${ADMIN_PHONE:-}" ] && [ -n "${ADMIN_CODE:-}" ]; then
  TOKEN=$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d "{\"phone\":\"$ADMIN_PHONE\",\"code\":\"$ADMIN_CODE\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
  if [ -n "$TOKEN" ]; then
    check "管理员登录成功" "1" "1"
    check "管理员访问 stats" "200" "$(code -H "Authorization: Bearer $TOKEN" "$BASE/api/admin/stats")"
    check "登录响应不含 password" "0" "$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d "{\"phone\":\"$ADMIN_PHONE\",\"code\":\"$ADMIN_CODE\"}" | grep -c '"password"')"
    SESS="smoke-$(date +%s)"
    REPLY=$(curl -s -X POST "$BASE/api/chat/send" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -d "{\"sessionId\":\"$SESS\",\"skillId\":\"skill-santi\",\"messageText\":\"你好\"}")
    check "聊天链路可用（含离线兜底）" "1" "$(echo "$REPLY" | grep -c assistantMessage | sed 's/^[0-9]*$/1/')"
  else
    check "管理员登录成功" "1" "0"
  fi
else
  echo "  ⚠️ 跳过管理员链路（未提供 ADMIN_PHONE/ADMIN_CODE）"
fi
check "首页 200" "200" "$(code "$BASE/")"
check "/admin 入口 200/302" "1" "$(code -L "$BASE/admin" | grep -Ec '^(200|302)$' | sed 's/^0$/0/;s/^[1-9].*/1/')"

echo "== 结果: $PASS 通过 / $FAIL 失败 =="
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 3: docs/deploy.md**（部署手册，包含以下章节，内容据实撰写）

1. **VPS 准备**：Docker + Compose 插件安装、`apt install sqlite3`（备份用）、防火墙放行端口（内测期仅放行 SSH + 应用端口；80/443 备案后再开）
2. **首次部署**：clone/上传代码 → 复制 `.env.example` 为 `.env` 并填写 `JWT_SECRET`（`openssl rand -hex 32`）与 `ADMIN_PHONE/ADMIN_PASSWORD` → `docker compose -f docker/compose.yaml up -d --build`
3. **冒烟验证**：`BASE=http://IP:3000 ADMIN_PHONE=... ADMIN_CODE=... bash scripts/smoke.sh`
4. **备份 crontab**：`crontab -e` 添加 `0 4 * * * /路径/scripts/backup.sh >> /路径/data/backups/backup.log 2>&1`；恢复步骤（停容器 → 用备份文件覆盖 data/commercial.sqlite* → 起容器）
5. **备案后切 HTTPS**：Caddyfile.template → Caddyfile（填域名）→ `docker compose --profile https up -d` → 验证 `https://域名/admin`
6. **残余风险声明**：内测期 HTTP 明文（JWT 可被嗅探，仅限小范围可信网络）；6 位数字密码空间有限（依赖限流缓解，建议管理员账号使用高熵 6 位并定期更换）；单实例架构不支持水平扩展
7. **日常运维**：日志（`docker compose logs -f app`）、更新发布流程（git pull → build → up -d）、数据目录说明

- [ ] **Step 4: 完整本地演练**

```bash
chmod +x scripts/backup.sh scripts/smoke.sh
docker compose -f docker/compose.yaml up -d --build
BASE=http://localhost:3000 ADMIN_PHONE=<.env 值> ADMIN_CODE=<.env 值> bash scripts/smoke.sh   # 预期全绿
bash scripts/backup.sh && ls data/backups/                                                     # 预期出现当日备份
docker compose -f docker/compose.yaml restart app && curl -s http://localhost:3000/api/health  # 重启数据仍在
docker compose -f docker/compose.yaml down
```

浏览器 UI 终检清单：主页/市场/书籍详情/聊天/LoginModal 与 git 基线截图逐像素一致；`/admin` 全流程（登录页 → 管理员进入 → 各 Tab 操作 → 退出到首页）；主前端无任何后台入口痕迹。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(deploy): 备份/冒烟脚本与部署手册，完成本地容器化演练"
```

---

## Self-Review 记录

- **Spec 覆盖**：§1→Task 16/17（DATA_DIR/Compose/Caddy）；§2.1→Task 9/13；§2.2→Task 8/10（其中 2.2.7 走降级分支，见 D3）；§2.3→Task 9/12；§2.4→Task 14；§3→Task 16；§4→Task 11（按 D1 全删）；§5→Task 1-6；§6.1→Task 17/18；§6.2→Task 18 smoke.sh；§6.3→P0-P5 即任务分组；§7→Task 15；§9 风险对策分布于 Task 8/10/13/16/17。
- **占位符扫描**：无 TBD；所有代码步骤含完整代码或精确锚点+差异说明。
- **类型一致性**：`registerXxxRoutes(app: Express): void` 命名统一；`apiFetch/authHeaders` 在 Task 7 定义、Task 14 复用；`sanitizeUser` Task 9 定义并当任务内应用；`ensureAdminSeed` Task 10 定义即调用；db 公开方法清单来自实际 grep（25 个），Task 16 签名保持。
- **执行顺序依赖**：Task 7 必须先于 Task 9（否则后台瘫痪）；Task 10 依赖 Task 9 的 requireAdmin 已就位（种子管理员验证链路）；Task 15 先于 Task 16（schema 终态一次成型）；Task 14 依赖 Task 7/12（AdminGate 用 authHeaders；AdminPanel 数据自取已带鉴权）。
