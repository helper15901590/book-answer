# Remix Remix 0.991 — 云端生产部署改造设计（Spec）

- 日期：2026-09-07
- 状态：待用户评审
- 路线：方案 B（适度模块化 + 加固）

## 0. 背景与已确认决策

生产就绪审计发现阻断级问题：`/api/admin/*` 无鉴权、apiKey 明文泄露给游客、密码明文存储且存在账号接管漏洞、支付为无验证模拟、sql.js 内存数据库与云平台临时文件系统不兼容、PORT 硬编码。

与需求方逐条确认的决策：

| # | 维度 | 决策 |
|---|------|------|
| 1 | 部署形态 | 国内云 VPS + Docker（单容器，Compose 编排，预留 Caddy） |
| 2 | 支付 | 关闭：删除 simulate-pay / 无验签 webhook；购买端点熔断为友好提示；管理员后台手动开通会员 |
| 3 | 认证 | 仅管理员建号：关闭自助注册（端点熔断）；bcrypt 密码哈希 |
| 4 | 规模 | ≤500 用户：sql.js → better-sqlite3 + 持久卷 + 每日备份；不迁 PostgreSQL |
| 5 | 域名 | 暂无：`http://IP:端口` 内测；Caddy/HTTPS 配置预留，备案后启用 |
| 6 | 数据 | 现有 `commercial.sqlite` 数据可清空，全新建库 + 种子数据 |
| 7 | UI | **硬约束：不修改任何 UI 设计**。例外（均已明确授权）：① 管理后台入口从主前端剥离；② 新增独立的 `/admin` 登录入口页；③ 清理组件内死代码分支时以「渲染结果逐像素一致」为验收标准 |
| 8 | 冗余 | 全面清理逻辑冲突与冗余代码（买断制残余、mock 残余、调试标志等），见第 7 节清单 |

编码规范以 `AGENTS.md` 为准（YAGNI、最少代码、精准修改、强类型、中文注释）。

## 1. 总体架构与部署拓扑

```
互联网
  │  http://IP:3000（内测期；备案后切 Caddy:443 自动 HTTPS）
  ▼
Docker Compose
  ├─ caddy（profile: https，内测期不启用）
  └─ app 容器（node:22-alpine）
       ├─ dist/server.cjs（esbuild 产物，Express，NODE_ENV=production）
       ├─ serve dist/ 静态前端（多页：index.html + admin.html）
       └─ 绑定挂载：
            ├─ ./data/commercial.sqlite   ← better-sqlite3 数据文件
            ├─ ./data/assets/             ← 上传素材
            └─ ./data/backups/            ← 每日备份（保留 14 天）
```

- 数据全部落宿主机 `./data/`（环境变量 `DATA_DIR`，默认 `./data`），容器可随时重建不丢数据。
- 备份：宿主机 crontab 每日 04:00 执行 `scripts/backup.sh`（`sqlite3 .backup` 热备份 + 清理 14 天前旧备份）；容器内不装定时任务依赖。VPS 需 `apt install sqlite3`。
- 环境注入：宿主机 `.env`（不进镜像、不进 git）提供 `PORT`、`JWT_SECRET`、`NODE_ENV`、`DATA_DIR`、`ADMIN_PHONE`、`ADMIN_PASSWORD`、LLM 相关 key；`.env.example` 同步更新。
- 仓库结构新增：`docker/`、`scripts/`、`docs/`、`server/`；`server.ts` 拆分后删除。

## 2. 安全与认证

### 2.1 鉴权分层

| 层 | 措施 |
|---|---|
| 全局 | `helmet` 安全头；`express-rate-limit`：全局 300 次/分/IP，`/api/auth/*` 10 次/分/IP |
| 管理员 | `requireAdmin` 中间件（JWT 有效且 `role === 'admin'`）覆盖**全部** `/api/admin/*` 路由 |
| 用户 | 保留 `authMiddleware`；用户/订单 ID 改用 `crypto.randomUUID()` |

### 2.2 密码与账号

1. `bcryptjs` 哈希存储（纯 JS，避免 Alpine 原生编译）；`users.password` 列只存哈希。
2. 移除登录接管漏洞：登录只校验哈希，删除「未设密码则把输入存为密码」逻辑（原 `server.ts:579`）。
3. 自助注册关闭：`POST /api/auth/register` 保留端点，恒返回友好提示「内测阶段账号由管理员统一开通，请联系管理员」；前端注册界面不动。
4. 管理员建号：`POST /api/admin/users/create`（requireAdmin）生成随机初始密码返回，管理员线下告知；账号带 `must_change_password` 标记。
5. 管理员种子：首次启动读取 `ADMIN_PHONE`/`ADMIN_PASSWORD` 创建；缺失则生成随机密码打印到启动日志（仅一次）。
6. `JWT_SECRET` 生产环境缺失即拒绝启动（fail-fast），移除硬编码兜底值。
7. 首登强制改密：实施时核实前端是否已有用户自助改密入口——有则服务端启用 `mustChangePassword` 强制（改密前仅放行 auth 相关端点）；没有则降级为「管理员后台重置」（现有 AdminPanel 编辑用户已支持），不做强制，避免用户被锁死。

### 2.3 密钥脱敏

- 新增 `GET /api/config/public`：仅返回 `dailyLimits`、`membershipPlans`、`agreements`，**绝不返回 apiKey / apiBaseUrl**。
- `App.tsx` 启动拉取从 `/api/admin/llm-config` 切换到 `/api/config/public`（纯逻辑改动，无界面变化）。
- `GET /api/admin/llm-config`（完整配置含 key）与 `POST /api/admin/llm-config`、`llm-test` 仅管理员可访问。

### 2.4 管理后台独立入口（用户授权的入口剥离）

1. 主前端剥离：`App.tsx` 移除 `#admin` 哈希监听与 AdminPanel 挂载；断开 `AiStudioWorkspace` 的 `onOpenAdmin` 触发入口。主应用不再有任何后台痕迹。
2. 独立入口：Vite 多页应用，新增 `admin.html` + `src/admin-main.tsx`，Express 将 `/admin` 路由到该页：
   - 未登录 → 新建的管理员登录页（手机号+密码，沿用现有 Tailwind 设计语言）；
   - 登录成功且 `role === 'admin'` → 渲染**原封不动的 AdminPanel 组件**；
   - 非管理员登录 `/admin` → 拒绝并提示。
3. 双层防护：前端入口页 + 服务端 requireAdmin。

## 3. 数据层（better-sqlite3）

1. `sql.js` → `better-sqlite3`（node:22-alpine 有官方 prebuilt，无编译依赖）。
2. `CommercialSQLDatabase` 类**对外方法签名不变**，仅替换内核实现；类从 `src/db.ts` 迁至 `server/db.ts`（实施时核实前端无 import；`src/types.ts`、`src/data/initialData.ts` 保留为共享）。
3. 写入模型：内存+100ms 防抖整库导出 → **write-through 立即落盘**；启用 `WAL` + `busy_timeout`；删除 `persistToDisk`/`scheduleSave`。
4. 路径：`DATA_DIR/commercial.sqlite`、`DATA_DIR/assets/`、`DATA_DIR/backups/`；`/assets` 静态服务与 `upload-asset` 写入路径同步调整。
5. Schema：沿用 5 张表（users/skills/chat_sessions/orders/system_config），去除第 7 节所列冗余列，新增 `users.must_change_password INTEGER DEFAULT 0`；`password` 存哈希。
6. 全新建库：不迁移旧数据（已确认可清空）；首启 建表 → 建索引 → 种子（`INITIAL_SKILLS` + 管理员账号）；删除 `cleanResidualMockData`。

## 4. 支付关闭

1. **删除**：`POST /api/payment/simulate-pay`、`POST /api/payment/webhook`。
2. **熔断保留**：`POST /api/payment/create-membership-order`、`POST /api/payment/create-order` 恒返回「会员开通暂未开放，请联系管理员」，经前端现有错误提示通道展示（UI 零改动）；`GET /api/payment/orders` 保留。
3. **手动开通**：沿用 `/api/admin/users/upgrade-tier`、`/api/admin/users/:userId/membership`（AdminPanel 已有对应操作界面），挂 requireAdmin；`GET /api/admin/orders` 等订单管理不变。

## 5. 后端模块化拆分

```
server/
├── index.ts              # 入口：组装 Express、中间件顺序、静态资源、
│                         #       Vite(dev)/dist(prod) 集成、PORT 监听、SIGTERM 优雅关闭
├── config.ts             # 环境变量统一读取 + fail-fast 校验
├── db.ts                 # CommercialSQLDatabase（自 src/db.ts 迁移，内核 better-sqlite3）
├── middleware/
│   ├── auth.ts           # signToken / extractUser / authMiddleware
│   ├── admin.ts          # requireAdmin
│   └── rateLimit.ts      # 全局 + auth 专用限流器
├── routes/
│   ├── auth.ts           # login / register(熔断桩) / me / logout / update
│   ├── skills.ts         # 市场列表、详情、click 计数、generate-questions
│   ├── chat.ts           # sessions CRUD + stream(SSE) + send
│   ├── payment.ts        # orders 查询 + 熔断桩
│   ├── admin.ts          # users / skills / tags / orders / stats / upload-asset
│   └── config.ts         # /api/config/public + /api/admin/llm-config + llm-test
└── services/
    ├── quota.ts          # checkAndConsumeQuota
    └── llm/
        ├── index.ts      # 三级降级链编排（DeepSeek → Gemini → 离线模板）
        ├── openaiCompat.ts  # OpenAI 兼容调用（流式+非流式）
        ├── gemini.ts     # @google/genai 与模型名解析
        ├── offline.ts    # generateDeepBookDistillation
        └── sanitize.ts   # sanitizeMessagesForLLM / cleanApiKey / resolveOpenAIUrl
```

- `package.json`：`dev` → `tsx server/index.ts`；`build` → `vite build`（多页）`&& esbuild server/index.ts --bundle ... --outfile=dist/server.cjs`；`start` 不变。
- 迁移策略：**先搬移后改造**。逐模块搬移，API 路径与请求/响应格式逐字节兼容；每模块完成后 `npm run lint` + git commit + 冒烟；安全改造在搬移完成后叠加，两类变更不混在同一提交。

## 6. 部署产物、验证与实施顺序

### 6.1 部署产物

```
docker/
├── Dockerfile            # 多阶段：node:22 构建 → node:22-alpine 运行
├── compose.yaml          # app（挂载 ./data、env_file）+ caddy（profile: https）
└── Caddyfile.template    # 备案后启用：域名 + 自动 HTTPS 反代 app:3000
scripts/
├── backup.sh             # 宿主机 crontab 调用
└── smoke.sh              # 部署后冒烟验证
docs/deploy.md            # 部署手册：VPS 准备(sqlite3/防火墙)、.env、构建启动、
                          #   crontab、备案后切 HTTPS、数据恢复步骤
```

### 6.2 验证策略

1. 每提交过 `npm run lint`（tsc --noEmit）。
2. `scripts/smoke.sh` 关键断言：
   - `/api/health` 200；
   - `/api/config/public` 返回且不含 apiKey/apiBaseUrl；
   - 游客调 `/api/admin/*` → 401/403；
   - 注册 → 熔断文案；`simulate-pay` → 404；`create-membership-order` → 熔断文案；
   - 管理员登录 → 建号 → 手动升级会员链路通；
   - 聊天 SSE 走通（LLM 无 key 时落离线兜底而非 500）。
3. 手动 UI 检查单：主页/市场/聊天/登录弹窗像素级不变；`/admin` 独立入口工作正常；主前端无后台痕迹。
4. 本地 `docker compose up` 完整演练后再上 VPS。

### 6.3 实施阶段（每阶段独立可回滚）

- **P0** git 基线（已完成 .gitignore 加固：排除 commercial.sqlite、data/）
- **P1** 后端模块化搬移（纯机械，行为零变化）
- **P2** 安全加固（第 2 节全部 + 第 4 节熔断/删除）
- **P3** 冗余清理（第 7 节清单）
- **P4** 数据层替换（第 3 节）
- **P5** 部署产物 + 本地演练（第 6.1/6.2 节）

## 7. 冗余清理清单

摸底结论：买断制/legacy 残余集中在 `server.ts`、`src/types.ts`、`src/db.ts`，**`src/components/` 无任何引用**，清理可零 UI 改动完成。

| 类别 | 项 | 位置（摸底） | 处理 |
|------|----|--------------|------|
| 买断制 | `PriceType 'buyout'`、`Skill.buyoutPrice`、`buyout_price` 列及默认 19.9 | types.ts:51,62；db.ts:105,248,259,541,561,572；server.ts:1860 | 删除；`priceType` 若组件仍引用则保留为 `'free_trial'` 字面量类型，保证渲染不变 |
| 买断制 | `buyoutUsedCount`、`buyoutUsageMap`、对应列与迁移逻辑 | types.ts:40-41；db.ts:86-87,176-180,355-372,464-466,496-510；server.ts:1703-1704 | 删除 |
| 买断制 | `DailyLimitsConfig.buyoutUser`、`OrderPlanType 'buyout'`、`OrderLog.type 'buyout'` | types.ts:16,123,135 | 删除（订单表留历史字段不回填） |
| 兼容残余 | `unlockedSkillIds` + `unlocked_skill_ids` 列 | types.ts:35；db.ts；server.ts:1705 | 删除 |
| mock 残余 | `src/data/mockData.ts`（2 行死文件）、`cleanResidualMockData()` | mockData.ts；db.ts:59,219 | 删除（核实无 import 后） |
| 调试标志 | `LLMConfig.simulateTimeout`、`proxyBufferingOff` 及服务端分支 | types.ts:108-109；initialData.ts；server.ts | 删除字段与对应模拟分支 |
| 疑似冗余 | `invitedCount`、`referralCode`（邀请/推荐功能疑似未上线） | types.ts:47-48；db.ts:355 | 实施时全局检索核实：前端无引用即删除，有引用则上报再定 |
| 导出残余 | `metadata.json`、`assets/.aistudio/`（AI Studio 导出痕迹，运行时无引用） | 根目录 | 核实无引用后删除 |

**验收标准**：清理后 `npm run lint` 通过 + 冒烟通过 + 主界面与 AdminPanel 渲染结果逐像素一致；每项清理独立小步提交，便于回滚。

## 8. 范围外（后续迭代，不在本次）

真实支付接入（微信/支付宝 + 验签）、域名备案与 HTTPS 切换、短信验证码、PostgreSQL 迁移、水平扩展、CI/CD。

## 9. 风险与对策

| 风险 | 对策 |
|------|------|
| 无测试基础设施，拆分/清理引入回归 | 先搬移后改造、逐字节 API 兼容、小步提交、lint+冒烟每步跑、UI 像素级检查单 |
| better-sqlite3 原生模块 | 使用官方 prebuilt（node:22-alpine 支持）；Dockerfile 构建阶段验证 |
| 明文密码历史数据 | 数据已确认可清空，全新建库，无存量哈希迁移问题 |
| VPS 被扫描爆破 | rate-limit + 仅管理员建号 + `/admin` 独立入口 + fail-fast JWT_SECRET |
