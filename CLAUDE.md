# CLAUDE.md — 项目指令

> 编码规范以 `AGENTS.md` 为准（YAGNI、最少代码、精准修改、强类型、中文注释）。本文件补充项目结构与命令。

## 项目简介
「Remix Remix 0.991」— 经典著作 AI 思想蒸馏平台（Google AI Studio 导出应用）。
用户与"书籍 AI 导师"（如《三体》《穷查理宝典》）对话，含会员体系、配额、支付（模拟）与后台管理。

## 技术栈
- 前端：React 19 + TypeScript 5.8 + Vite 6 + Tailwind CSS 4 + lucide-react + motion
- 后端：Express 4（单文件 `server.ts`，约 2000 行），开发态内嵌 Vite middleware
- 数据库：sql.js（WASM SQLite），持久化到根目录 `commercial.sqlite`
- 认证：JWT（jsonwebtoken），手机号+密码；角色 guest/member/admin
- LLM：主路 DeepSeek/OpenAI 兼容接口 → 备用 Gemini（@google/genai）→ 兜底离线模板生成

## 常用命令
- 开发：`npm run dev`（tsx server.ts，含 HMR）
- 构建：`npm run build`（vite build + esbuild 打包 server → dist/server.cjs）
- 生产启动：`npm start`
- 类型检查（lint）：`npm run lint`（tsc --noEmit）
- 测试：无测试基础设施

## 环境变量（.env.local，参考 .env.example）
`GEMINI_API_KEY`、`DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`、`APP_URL`

## 项目结构
| 路径 | 职责 |
|------|------|
| `server.ts` | 全部后端：auth/skills/chat(SSE)/payment/admin API + 静态资源 + Vite 集成 |
| `src/main.tsx` | React 入口 |
| `src/App.tsx` | 根组件：用户/技能/LLM 配置状态，`#admin` 哈希路由打开后台 |
| `src/components/AiStudioWorkspace.tsx` | 主界面（书籍市场 + 聊天工作区，AI Studio 风格） |
| `src/components/AdminPanel.tsx` | 后台：用户/技能/订单/LLM 配置/标签/统计 |
| `src/components/LoginModal.tsx` | 登录/注册弹窗 |
| `src/db.ts` | `CommercialSQLDatabase` 类：建表、迁移、种子数据、防抖落盘 |
| `src/types.ts` | 前后端共享类型 + 会员等级/格式化工具函数 |
| `src/data/initialData.ts` | 种子书籍（INITIAL_SKILLS）、游客用户、默认 LLM 配置 |
| `assets/` | 运行时上传的素材（`/assets` 静态服务） |

## 数据表（commercial.sqlite）
users / skills / chat_sessions / orders / system_config

## 约定
- 前后端共用 `src/types.ts` 与 `src/db.ts`（server.ts 直接 import，勿拆分重复定义）
- API 返回统一 JSON：成功载荷 + `error`/`message` 中文错误提示
- 聊天流式响应走 SSE（`/api/chat/stream`），注意 `X-Accel-Buffering: no`
- 配额按会员等级（guest/free/monthly/quarterly/yearly）在 `checkAndConsumeQuota` 中控制
- UI 文案与注释使用中文；保持现有 UI 风格不动（AGENTS.md 要求）
- 非 git 仓库；修改前无版本控制兜底，谨慎做破坏性变更
