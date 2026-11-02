# 可靠广场与关注列表 Implementation Plan

**Goal:** 在用户端左侧栏新增「可靠广场」与「关注列表」两个入口；「可靠广场」成为与书籍广场、导师广场完全对等的第三种技能类型（`reliable`）；用户登录后可关注任意技能卡片，关注关系服务端持久化，并在关注列表中集中展示；管理后台同步支持可靠类型的内容管理，并可查看用户的关注数据。

> **实施状态（2026-11-02）：已完成。** 已通过 `npm run lint`、`npm test`（17 用例）、`npm run build`、`npm run config:check`，并额外验证了旧库自动补建 `user_follows` 表。`npm run verify` 会在 `audit:prod` 步骤因仓库既有依赖的 7 项审计告警（含 1 项 critical）而中断，与本次改动无关。

**Tech Stack:** React 19 + TypeScript 5.8 + Vite 6 + Tailwind CSS 4 / Express 4 + better-sqlite3（WAL）/ vitest + supertest。

**已确认的产品决策（2026-11-02）：**

| # | 决策 |
|---|------|
| D1 | 「可靠广场」= `SkillType` 新增第三种类型 `reliable`，与 `book` / `mentor` 并列，复用同一套技能模型与广场交互 |
| D2 | 关注必须登录，关注关系存服务端数据库；匿名点击关注弹出登录框 |
| D3 | 后台不新增独立页签：现有「导师书籍管理」扩展支持可靠类型；用户管理增加关注数据查看 |

**非目标（本次不做）：** 在线支付、关注数展示/排行、关注动态或通知、对分类/用户/导师的关注、匿名本地关注与登录后合并、关注列表的分页与搜索筛选（首版只做卡片网格）。

---

## Global Constraints

- 遵循 [AGENTS.md](../../../AGENTS.md)：YAGNI、最少代码、精准修改、优先复用、中文注释、TypeScript 强类型。
- 遵循 [CLAUDE.md](../../../CLAUDE.md)：身份只来自服务端会话；公开接口只输出 `PublicSkill`（`systemPrompt` 永不外泄）；`/api` 写请求默认受 CSRF 保护；服务端错误返回错误码。
- 用户端文案只改 `src/i18n/locales/zh-CN.ts`，`en.ts` / `zh-TW.ts` 必须同步补齐，漏键 `npm run lint` 直接失败；管理后台不做多语言，新增文案用中文硬编码。
- 数据库 schema 唯一权威是 `server/db.ts` 的 `SCHEMA_DDL`；新增**表**靠 `CREATE TABLE IF NOT EXISTS` 在每次启动自动创建，无需 `schema_migrations` 版本号；新增**列**才需要登记 `ensureColumns().addedColumns`（本计划不新增列）。
- 不破坏现有书籍广场 / 导师广场行为；改动后必须回归二者。
- 工作区当前未安装依赖，执行验证前先 `npm install`（Node 22）。

---

## 1. 总体设计

### 1.1 数据模型

新增一张关注关系表（多对多），不修改 `users` / `skills` 现有结构：

```sql
CREATE TABLE IF NOT EXISTS user_follows (
  user_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, skill_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_follows_user ON user_follows(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_follows_skill ON user_follows(skill_id);
```

要点：

- 复合主键天然保证「同一用户同一技能只关注一次」，`INSERT OR IGNORE` 即幂等。
- 双外键 + `foreign_keys=ON`（已开启）：删除用户或删除技能时关注关系自动级联；同时在 `deleteUser` / `clearAllUsers` / `deleteSkill` 中按现有代码风格显式清理，行为不依赖隐式级联。
- 现有库在下次启动时由 `createTables()` 自动补建，无需手工迁移。
- 关注列表按 `created_at DESC` 排序（最近关注在前）。

### 1.2 API 设计

| 方法 | 路径 | 鉴权 | 请求 / 响应 | 说明 |
|------|------|------|-------------|------|
| GET | `/api/follows` | `requireUser` | `{ follows: FollowedSkill[] }` | 当前用户的关注列表，联表返回技能最新信息（标题/作者/封面等以 `skills` 表为准） |
| POST | `/api/follows` | `requireUser` + CSRF | `{ skillId: string }` → `{ success: true }` | 关注；技能不存在返回 404 `SKILL_NOT_FOUND`；重复关注幂等成功 |
| DELETE | `/api/follows/:skillId` | `requireUser` + CSRF | `{ success: true }` | 取消关注；不存在也返回成功（幂等） |
| GET | `/api/admin/users/:userId/follows` | `requireAdmin` | `{ follows: FollowedSkill[] }` | 后台查看某个用户的关注列表；用户不存在 404 |
| GET | `/api/admin/users` | `requireAdmin` | 现有 `users` 数组追加 `followCount: number` | 后台用户列表展示关注数（一次 GROUP BY 查询，避免 N+1） |

类型：

```ts
// src/types.ts
export type SkillType = 'book' | 'mentor' | 'reliable';
export const SKILL_TYPES = ['book', 'mentor', 'reliable'] as const;
export function isSkillType(value: unknown): value is SkillType;

// 关注列表 DTO：技能公开字段 + 关注时间
export type FollowedSkill = PublicSkill & { followedAt: string };
```

技能类型扩展只影响 `skills.skill_type` 的**取值**，不改列定义，旧值 `book` / `mentor` 完全兼容。

### 1.3 用户端交互设计

**左侧栏**在「导师广场」下方依次新增两个同风格按钮：

| 按钮 | 图标（lucide） | 行为 |
|------|----------------|------|
| 可靠广场 | `ShieldCheck` | `mainView = 'reliable'`，展示 `skillType === 'reliable'` 的技能，交互与书籍/导师广场一致 |
| 关注列表 | `Star` | 已登录：`mainView = 'follows'`；未登录：弹出登录框（与聊天入口一致），不切视图 |

**可靠广场**：搜索、分类标签、20 张/批分页、详情弹窗、卡片热度与 TOP 排名、点击进入对话，全部复用现有广场逻辑；欢迎语与输入框占位按可靠类型单独出文案（文案默认值见 §3.4，可随时在字典中调整）。

**关注按钮**：每张 `SkillCard` 底部操作区（分类文字与「对话」按钮之间）新增星标按钮：

- 未关注：灰色描边星 + 「关注」；已关注：琥珀色实心星 + 「已关注」，`aria-pressed` 同步。
- 点击必须 `stopPropagation`，不能触发卡片详情或进入对话。
- 未登录点击：调用 `onOpenLogin()` 弹出登录框（与现有聊天入口行为一致）。
- 所有广场（书籍/导师/可靠）与关注列表内的卡片都显示该按钮；关注列表内点击即取消关注并从列表移除。
- 采用乐观更新：先改本地状态，请求失败回滚并 toast 提示。

**关注列表**：卡片网格（复用 `SkillCard`，不显示 TOP 排名），卡片点击看详情、对话按钮进入聊天；空态提示「还没有关注任何技能」并提供去书籍广场的按钮。首版不做搜索/分类/分页（关注量通常有限，YAGNI），如后续需要可复用 `MarketSection`。

### 1.4 后台交互设计

**技能管理**：

- 类型筛选页签从「全部 / 书籍 / 导师」扩展为「全部 / 书籍 / 导师 / 可靠」，数量统计自动跟随。
- 新增/编辑弹窗的类型下拉增加「可靠（可靠广场）」；可靠类型使用「名称 + 作者」字段（与书籍相同，显示作者输入框）。
- 列表类型徽标新增「可靠」（建议 emerald 配色）；空态文案、弹窗标题、保存提示、删除确认文案按类型分支补全。

**用户管理**：

- 用户列表新增「关注数」列（来自 `followCount`）。
- 用户操作区新增「查看关注」按钮，打开弹窗展示该用户关注的技能（标题、作者、类型、分类、关注时间），空态提示。
- 不提供管理员代关注/代取关能力（本次不需要）。

---

## 2. 改动文件清单

| 层 | 文件 | 改动 |
|----|------|------|
| 类型 | `src/types.ts` | `SkillType` 扩展、`SKILL_TYPES` / `isSkillType`、`FollowedSkill` |
| 数据 | `server/db.ts` | `SCHEMA_DDL` 新增 `user_follows`；索引；`mapSkillRow` 支持 reliable；关注 CRUD 与计数；删除清理 |
| 路由 | `server/routes/follows.ts`（新建） | 用户端关注接口 |
| 路由 | `server/app.ts` | 注册 `registerFollowRoutes(app)` |
| 路由 | `server/routes/skills.ts` | `?type=` 过滤改用 `isSkillType`，接受 reliable |
| 路由 | `server/routes/admin.ts` | 技能保存接受 reliable；用户列表附 `followCount`；新增用户关注查看接口 |
| 路由 | `server/routes/chat.ts` | 新建会话欢迎语增加 reliable 分支 |
| 前端 | `src/components/SkillCard.tsx` | 关注按钮与 props |
| 前端 | `src/components/MarketSection.tsx` | 透传 `followedSkillIds` / `onToggleFollow` |
| 前端 | `src/components/PlazaView.tsx`（新建） | 抽取广场通用状态与弹窗，供三个广场复用（见 §3.5） |
| 前端 | `src/components/FollowListView.tsx`（新建） | 关注列表卡片网格 + 空态 |
| 前端 | `src/components/AiStudioWorkspace.tsx` | `mainView` 扩展、侧栏入口、关注状态与 API、可靠广场接入、可靠欢迎语 |
| 前端 | `src/components/AdminPanel.tsx` | 可靠类型管理与用户关注查看 |
| i18n | `src/i18n/locales/zh-CN.ts` / `en.ts` / `zh-TW.ts` | 新增文案键 |
| i18n | `src/i18n/serverMessage.ts` | `SKILL_NOT_FOUND` 映射 |
| 测试 | `tests/api.test.ts` | 关注与可靠类型的集成测试 |
| 文档 | `README.md`、`docs/DEV_HANDBOOK.md` | 功能与模块清单同步（可选但建议） |

---

## 3. 任务拆解

### Task 1：类型与常量（`src/types.ts`）

- [ ] `SkillType` 增加 `'reliable'`。
- [ ] 增加 `SKILL_TYPES` 常量与 `isSkillType()` 类型守卫，供服务端路由与 `db.mapSkillRow` 统一校验，替代散落的二元三元表达式。
- [ ] 增加 `FollowedSkill` DTO 类型。
- [ ] `PublicSkill` 的 `Pick` 已包含 `skillType`，无需改动。

**验收：** `npm run lint` 通过；全库搜索 `=== 'mentor'` 列出所有需要评估的二元分支（见 §4 风险表）。

### Task 2：数据层（`server/db.ts`）

- [ ] `SCHEMA_DDL` 增加 `user_follows` 建表语句；`createIndices()` 增加两个索引。
- [ ] `mapSkillRow`：`skillType: isSkillType(obj.skill_type) ? obj.skill_type : 'book'`（NULL / 旧脏值回落 book）。
- [ ] 新增方法：
  - `followSkill(userId: string, skillId: string): void` — `INSERT OR IGNORE`。
  - `unfollowSkill(userId: string, skillId: string): boolean` — 返回是否真的删除。
  - `getUserFollows(userId: string): { skill: Skill; followedAt: string }[]` — `JOIN skills`，`ORDER BY f.created_at DESC`；联表保证返回技能最新字段。
  - `getUserFollowCounts(): Map<string, number>` — `GROUP BY user_id`。
- [ ] `deleteUser` 事务内追加 `DELETE FROM user_follows WHERE user_id = ?`；`clearAllUsers` 追加整表清理。
- [ ] `deleteSkill` 改为事务：先删 `user_follows WHERE skill_id`，再删技能，返回布尔值。
- [ ] 不写种子数据；可靠广场初始为空由后台创建。

**验收：** 旧库启动自动建表；`npm run config:check` 通过；删除用户/技能后无孤儿关注行。

### Task 3：服务端路由

- [ ] 新建 `server/routes/follows.ts`，用 `zod` 校验入参，复用 `toPublicSkill` 把联表结果转成 `FollowedSkill`。
- [ ] `server/app.ts` 注册 `registerFollowRoutes(app)`（放在 skills 之后、chat 之前均可）。
- [ ] `server/routes/skills.ts`：`?type=` 过滤改为 `isSkillType(type)`（仅接受三种合法值）。
- [ ] `server/routes/admin.ts`：
  - 技能保存：`skillType: isSkillType(input.skillType) ? input.skillType : 'book'`。
  - `GET /api/admin/users`：一次性取 `getUserFollowCounts()`，合并进返回对象。
  - 新增 `GET /api/admin/users/:userId/follows`（`requireAdmin`），用户不存在返回 404 `NOT_FOUND`。
- [ ] `server/routes/chat.ts`：把欢迎语三元表达式改为 `buildWelcomeMessage(skill)` 小函数，增加 reliable 分支（文案见 §3.4）。
- [ ] 错误码 `SKILL_NOT_FOUND` 加入 `src/i18n/serverMessage.ts` 与三份字典的 `server.*`。

**验收：** 未登录访问关注接口 401；匿名伪造 `userId` 无效；无 CSRF 令牌写请求 403；关注不存在技能 404。

### Task 4：多语言字典

先改 `zh-CN.ts`，再同步 `en.ts` / `zh-TW.ts`。新增键建议：

| 键 | 简体中文默认值 |
|----|----------------|
| `workspace.reliablePlaza` | 可靠广场 |
| `workspace.followList` | 关注列表 |
| `workspace.followEmpty` | 还没有关注任何技能 |
| `workspace.followEmptyHint` | 去广场逛逛，点击卡片上的「关注」即可加入这里 |
| `workspace.goBrowse` | 去逛逛 |
| `workspace.loginToFollow` | 登录后才能关注 |
| `workspace.followFailed` | 关注操作失败，请稍后重试 |
| `workspace.welcomeReliableNew` | 你好！我是{title}的 AI 可靠知识导师。\n\n已为你开启全新的对话页面，你可以随时提出你关注的问题。 |
| `workspace.welcomeReliable` | 你好！我是{title}的 AI 可靠知识导师。\n\n你可以随时向我提出关于其核心内容、方法框架的问题，或探讨如何在实际场景中应用。 |
| `skillCard.follow` | 关注 |
| `skillCard.followed` | 已关注 |
| `skillCard.unfollow` | 取消关注（按钮 title/aria-label） |
| `market.searchPlaceholderReliable` | 搜索名称或作者... |
| `market.unitReliable` | 项可靠内容 |
| `server.SKILL_NOT_FOUND` | 未找到该技能，可能已被下架 |

- [ ] 三份字典同步补齐；`npm test` 的 i18n 校验通过。
- [ ] 可靠广场欢迎语文案默认为占位稿，上线前可由产品在字典中直接调整。

### Task 5：卡片与广场组件

- [ ] `SkillCard` 增加可选 props：`isFollowed?: boolean`、`onToggleFollow?: (skill: Skill) => void`。
- [ ] 关注按钮放在底部操作区（分类与「对话」之间），星标 + 文案，`stopPropagation`，`aria-pressed`，未传 handler 时不渲染（兼容独立使用）。
- [ ] `MarketSection` 增加 `followedSkillIds: Set<string>` 与 `onToggleFollow`，透传给每张卡片。
- [ ] 新建 `FollowListView`：接收 `skills: FollowedSkill[]`、`followedSkillIds`、`onToggleFollow`、`onSelectSkill`、`onViewDetail`，渲染三列卡片网格与空态按钮；不显示排名。

### Task 6：用户端工作区（`AiStudioWorkspace.tsx`）

- [ ] `mainView` 类型扩展为 `'chat' | 'market' | 'mentor' | 'reliable' | 'follows'`。
- [ ] 侧栏在导师广场按钮下新增可靠广场（`ShieldCheck`）与关注列表（`Star`）两个按钮，沿用现有选中/未选中样式；关注列表按钮未登录时先 `onOpenLogin()` 并 return。
- [ ] 关注状态：
  - `followedSkills: FollowedSkill[]` 与派生的 `followedSkillIds: Set<string>`。
  - 登录态变化时请求 `GET /api/follows`；登出清空。
  - `handleToggleFollow(skill)`：未登录 → 登录框；已关注 → 乐观移除 + `DELETE`；未关注 → 乐观前插 + `POST`；失败回滚并 toast。
  - 把 `followedSkillIds` / `handleToggleFollow` 传给所有广场与关注列表。
- [ ] 可靠广场：通过 `PlazaView` 实例接入（见 §3.5），`onSelectSkill` 复用 `handleSelectBookFromMarket`，欢迎语增加 reliable 分支。
- [ ] 关注列表：`mainView === 'follows'` 时渲染 `FollowListView`，空态可跳回书籍广场；登出时既然 `mainView` 已被重置为 market，无需额外处理。
- [ ] 本地新建会话的两处欢迎语（`handleCreateNewChat`、`handleSelectBookFromMarket`）增加 reliable 分支。

### Task 7：广场逻辑复用（`PlazaView.tsx`，建议在 Task 6 之前完成）

现有书籍/导师广场在 `AiStudioWorkspace` 中各复制了一份「搜索 + 分类 + 分页 + 全部标签弹窗 + 详情弹窗 + 溢出测量」逻辑。为避免加入第三份复制，抽取一个受控壳组件：

- [ ] 新建 `src/components/PlazaView.tsx`，props：`skills`（已按类型过滤）、`categories`、`renamedCategoriesMap`、`deletedCategoriesSet`、`user`、`searchPlaceholder`、`unitLabel`、`followedSkillIds`、`onToggleFollow`、`onSelectSkill`；内部管理搜索、选中分类、可见数量、分类溢出、全部标签弹窗、详情弹窗。
- [ ] 内部直接复用现有 `MarketSection` 与 `BookDetailModal`。
- [ ] 把书籍广场、导师广场迁移到 `PlazaView`（行为、样式保持不变），再以 `type='reliable'` 实例化可靠广场。
- [ ] 回归清单：三广场的搜索、分类切换、全部标签弹窗、20 条分页、详情弹窗、卡片进入对话、热度显示。

> 若实施时评估重构风险偏高，退路是保留现有两处内联逻辑，仅为可靠广场复制同款实现；但需在 PR 说明中记录重复代码的取舍。

### Task 8：管理后台（`AdminPanel.tsx`）

- [ ] `skillTypeFilter` 联合类型加 `'reliable'`；筛选按钮数组加「可靠」及计数。
- [ ] 列表类型徽标增加可靠（emerald）；空态/表头/操作文案按类型分支。
- [ ] 技能弹窗：类型下拉加「可靠（可靠广场）」；可靠与书籍一样显示作者输入框；标题字段标签按类型显示「书名 / 名称」。
- [ ] 保存校验、成功提示、删除确认文案补 reliable 分支。
- [ ] 用户管理：
  - `AdminUser = UserProfile & { followCount?: number }`，列表新增「关注数」列。
  - 行操作新增「查看关注」按钮，点击 `GET /api/admin/users/:userId/follows`，弹窗展示技能列表（标题、作者、类型、分类、关注时间），空态提示；请求失败走 `ensureAdminAuthorized` 与 toast。
- [ ] 后台新增文案保持中文硬编码，不引入 i18n。

### Task 9：测试与文档

- [ ] `tests/api.test.ts` 新增用例（复用现有 `adminAgent` / `userAgent`）：
  - 未登录 `GET/POST/DELETE /api/follows` 均 401。
  - 用户关注技能（带 CSRF）→ 列表包含该技能与 `followedAt`；重复关注幂等；关注不存在技能 404 `SKILL_NOT_FOUND`。
  - 取消关注 → 列表为空；重复取消幂等。
  - 管理员可查看该用户关注列表；普通用户访问后台接口 403。
  - 管理员创建 `skillType='reliable'` 技能 → `GET /api/skills?type=reliable` 能查到、`type=book` 查不到 → 删除后关注关系一并清除。
  - 用户删除后关注行清理（可通过重新建号/直连测试库断言）。
- [ ] `i18n.test.ts` 自动覆盖新键。
- [ ] 更新 `README.md` 功能列表；更新 `docs/DEV_HANDBOOK.md` 的目录地图、API 清单与技术债章节（把关注模块纳入）。
- [ ] 运行 `npm install && npm run lint && npm test && npm run build && npm run config:check`；全部通过。

---

## 4. 风险与注意事项

| 风险 | 说明与对策 |
|------|-----------|
| 二元类型假设遗漏 | 全库已有大量 `=== 'mentor' ? ... : ...` 分支（`db.mapSkillRow`、`admin.ts` 技能保存、`chat.ts` 欢迎语、`AdminPanel` 多处、`SkillCard` 作者行、会话列表标题）。逐一评估：可靠类型默认按「书籍」视觉处理（显示作者、书名号），仅欢迎语与类型标签区分 |
| 主页组件继续膨胀 | `AiStudioWorkspace` 已 1608 行。通过 `PlazaView` 抽取抵消新增视图的体积；关注状态集中在一处 |
| 关注列表数据过期 | 技能被编辑后，关注列表在下次登录/刷新时更新（接口联表实时取数）；不额外做轮询 |
| 技能/用户删除留下孤儿关注 | 双外键级联 + 三个删除路径显式清理 + 测试覆盖 |
| 未登录关注体验 | 点击关注直接弹登录框；登录完成后需再次点击关注（本次不做「登录后自动补关注」，避免引入待办动作状态） |
| CSRF 与限流 | 新接口全部走 `apiFetch`（自动带 CSRF）与 `requireUser`；写操作计入现有 `/api` 300 次/分全局限流，足够 |
| 可靠广场空数据 | 初始无可靠技能，展示 `market.empty` 空态；管理员创建后即可见。`getSkills()` 的种子兜底不会凭空生成可靠内容 |
| 子路径部署 | 所有前端请求继续走 `apiFetch`，不手写前缀；新静态资源无新增 |
| 旧库兼容 | 新表由启动建表自动补齐；不改列、不改 `schema_migrations`；上线前用现有 `data/commercial.sqlite` 启动一次验证 |

---

## 5. 验收标准

1. 左侧栏在导师广场下方出现「可靠广场」「关注列表」，选中态样式与现有入口一致。
2. 管理员可在后台创建/编辑/删除可靠类型技能；可靠广场的搜索、分类、分页、详情、进入对话与书籍/导师广场行为一致，且书籍/导师广场无回归。
3. 所有广场卡片均显示关注按钮；未登录点击弹登录框；登录后点击可关注/取消关注，状态即时反馈。
4. 关注列表展示已关注技能的卡片，支持进入对话、查看详情、就地取消关注；空态友好；刷新页面或换设备后关注仍在。
5. 删除技能或删除用户后，相关关注关系不复存在。
6. 后台用户列表能看到关注数，并可打开某个用户的关注列表。
7. 三种界面语言的文案完整；`npm run lint`、`npm test`、`npm run build`、`npm run config:check` 全部通过。
8. 现有认证、CSRF、配额、聊天、i18n 测试全部保持绿色。

---

## 6. 实施顺序与预估

| 阶段 | 任务 | 预估 |
|------|------|------|
| P1 后端基座 | Task 1–3（类型、数据层、路由） | 0.5 天 |
| P2 前端骨架 | Task 5、7（卡片、PlazaView 抽取） | 0.5～1 天 |
| P3 用户端功能 | Task 4、6（i18n、侧栏、可靠广场、关注状态与列表） | 1 天 |
| P4 后台 | Task 8 | 0.5 天 |
| P5 测试与验证 | Task 9 + 手工回归 | 0.5 天 |

建议按 P1 → P2 → P3 → P4 → P5 顺序执行，每个阶段结束跑一次 `npm run lint && npm test`，避免问题堆积。新建分支建议 `feat/reliable-plaza-follows`。
