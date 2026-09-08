# CLAUDE.md — 项目指令

> 编码规范以 `AGENTS.md` 为准（YAGNI、最少代码、精准修改、强类型、中文注释）。本文件补充项目结构与命令。

## 项目简介
「Remix Remix 0.991」— 经典著作 AI 思想蒸馏平台（Google AI Studio 导出应用）。
用户与"书籍 AI 导师"（如《三体》《穷查理宝典》）对话，含会员体系、配额与后台管理（支付已删除，账号仅管理员开通）。

## 技术栈
- 前端：React 19 + TypeScript 5.8 + Vite 6 + Tailwind CSS 4 + lucide-react + motion
- 后端：Express 4（模块化 `server/`：index/config/db + middleware/ + routes/ + services/），开发态内嵌 Vite middleware
- 数据库：better-sqlite3（WAL、write-through），持久化到 `data/commercial.sqlite`（`DATA_DIR` 可配）
- 认证：JWT（jsonwebtoken），手机号+6位数字密码（bcryptjs 哈希）；角色 guest/member/admin
- LLM：主路 DeepSeek/OpenAI 兼容接口 → 备用 Gemini（@google/genai）→ 兜底离线模板生成

## 常用命令
- 开发：`npm run dev`（tsx server/index.ts，含 HMR）
- 构建：`npm run build`（vite build 多页 index.html/admin.html + esbuild 打包 server → dist/server.cjs）
- 生产启动：`npm start`
- 类型检查（lint）：`npm run lint`（tsc --noEmit）
- 测试：无测试基础设施

## 环境变量（.env.local 或 .env，参考 .env.example）
`JWT_SECRET`（生产必填 ≥16 字符）、`ADMIN_PHONE`/`ADMIN_PASSWORD`（管理后台登录凭证，账号不入库）、`DATA_DIR`、`TRUST_PROXY`、`HOST_PORT`（仅 compose 插值）、`GEMINI_API_KEY`、`DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`

## 项目结构
| 路径 | 职责 |
|------|------|
| `server/index.ts` | Express 装配入口：helmet/限流/静态资源/Vite 集成/优雅关闭 |
| `server/config.ts` | 环境变量读取（dotenv、JWT_SECRET fail-fast、DATA_DIR、TRUST_PROXY） |
| `server/db.ts` | `CommercialSQLDatabase` 类（better-sqlite3）：建表、迁移、种子数据、write-through |
| `server/middleware/` | `auth.ts`（JWT 解析/sanitizeUser）、`admin.ts`（requireAdmin） |
| `server/routes/` | auth / skills / chat(SSE) / admin / config 路由模块（`registerXxxRoutes(app)`） |
| `server/services/` | adminSeed / quota / metrics / llm（主路 OpenAI 兼容 → Gemini → 离线兜底） |
| `src/main.tsx` | React 入口（主前端，无任何后台入口痕迹） |
| `src/admin-main.tsx` + `admin.html` | 管理后台独立多页入口（AdminGate 验证后渲染 AdminPanel） |
| `src/App.tsx` | 根组件：用户/技能/LLM 配置状态 |
| `src/components/AiStudioWorkspace.tsx` | 主界面（书籍市场 + 聊天工作区，AI Studio 风格） |
| `src/components/AdminPanel.tsx` | 后台：用户/技能/订单/LLM 配置/标签/统计 |
| `src/components/LoginModal.tsx` | 登录弹窗（注册端点已移除，账号仅管理员开通） |
| `src/types.ts` | 前后端共享类型 + 会员等级/格式化工具函数 |
| `src/data/initialData.ts` | 种子书籍（INITIAL_SKILLS）、游客用户、默认 LLM 配置 |
| `docker/` | Dockerfile（多阶段 bookworm-slim）、compose.yaml（app+caddy[profile https]）、Caddyfile.template |
| `data/` | 运行时数据（gitignore）：commercial.sqlite(+wal/shm)、assets/ 上传素材、backups/ |

## 数据表（data/commercial.sqlite）
users / skills / chat_sessions / orders / system_config

## 约定
- 前后端共用 `src/types.ts` 与 `src/data/initialData.ts`（server/ 直接 import，勿拆分重复定义）
- API 返回统一 JSON：成功载荷 + `error`/`message` 中文错误提示
- 聊天流式响应走 SSE（`/api/chat/stream`），注意 `X-Accel-Buffering: no`
- 配额按会员等级（guest/free/monthly/quarterly/yearly）在 `checkAndConsumeQuota` 中控制
- UI 文案与注释使用中文；保持现有 UI 风格不动（AGENTS.md 要求）
- git 仓库（分支 feat/cloud-production）；`.env`、`data/`、`commercial.sqlite` 严禁提交
