# 新会话交接提示词（直接复制给新窗口的 AI）

你是「book_answer（问书）」项目的接手开发者。请先完整阅读以下文件，再开始任何修改：

1. `docs/DEV_HANDBOOK.md`（架构 / 数据模型 / 认证 / SSE / 配额 / i18n / 排障）
2. `CLAUDE.md`、`AGENTS.md`
3. 本文件 `docs/HANDOFF_PROMPT.md`（当前状态交接）
4. 当前功能相关：`src/components/FaceToFaceView.tsx`、`FaceToFaceView.css`、`src/lib/useVoicePlayback.ts`、`server/services/omniTts.ts`、`server/services/tts.ts`、`server/routes/tts.ts`、`src/components/AiStudioWorkspace.tsx`、`src/components/AdminPanel.tsx`、`src/types.ts`（TTSConfig）、`src/i18n/locales/zh-CN.ts` 的 `workspace.face*` / `login.*`。

## 项目与运行

- 路径 `D:\work_space\AI\book-answer`；Node 22；React 19 + TS 5.8 + Vite 6 + Tailwind 4；Express 4 + better-sqlite3（WAL，单实例）；前后端同进程。
- `npm run dev` 启动，用户端 `http://localhost:3000/bookanswer/`，后台 `/bookanswer/admin`；子路径前缀唯一定义在 `basePath.ts`，业务代码不要手写 `/bookanswer`。
- `.env.local` 必须有 `APP_ORIGIN`、`APP_ENCRYPTION_KEY`、`ADMIN_PHONE`、`ADMIN_PASSWORD`，否则启动失败。
- 命令：`npm install` → `npm run lint` → `npm test`（30 用例）→ `npm run build` → `npm run config:check`。`npm run verify` 会在 `audit:prod` 因仓库既有依赖告警失败，不要擅自 audit fix。

## 当前仓库状态

- 分支 `feat/reliable-plaza-follows`（基于 `feat/cloud-production`），大量改动尚未提交。
- `git status` 中绝大多数 modified 是 Windows 检出 CRLF 造成的假修改（增删行数相等）；提交前统一行尾，只提交真实改动。
- 最近新增依赖 `ws`（服务端 Omni Realtime WebSocket）；拉代码后先 `npm install`。
- `声音克隆/`（含 API Key、原始录音）与 `面对面/`（设计稿、原型、图标）已在 `.gitignore`，严禁提交；API Key 只存在于本地文件和后台加密配置中，绝不写进代码、日志或前端。

## 已完成的功能（不要重复实现）

1. 可靠广场 + 关注列表（SkillType `reliable`、`user_follows`、关注接口、后台 followCount / 查看关注、PlazaView / FollowListView）。
2. 管理员登录简化：只校验 `ADMIN_PHONE` + `ADMIN_PASSWORD`，已移除二次口令与 TOTP。
3. 用户自助注册：`POST /api/auth/register`，手机号 + 密码，注册即登录，默认普通会员；忘记密码提示「联系管理员 陈亮」；始终开放，5 次/分/IP。
4. 面对面模式：
   - 聊天页顶部「书信 / 面对面」切换；面对面全屏沉浸版，人物底图按 16:9 居中、四边渐隐铺满屏幕；
   - 左上仅箭头返回（无文字），右上仅全屏图标（无文字）；全屏时隐藏所有按钮，Esc 退出；
   - 顶部音波，只有最新一轮 AI 回复（不回显用户提问）；逐句字幕只显示当前正在朗读的一句，上一句自动消失；模型思考时输入框无占位提示；
   - 点返回回到文字聊天；与文字聊天共用会话、历史、未发送草稿；favicon 使用人物图标。
5. 语音合成双引擎（后台「模型配置 → 语音对话」）：
   - CosyVoice HTTP（mp3，系统音色 / CosyVoice 复刻）；
   - Qwen-Omni Realtime WS（wav，Omni 复刻音色）。当前生产配置为 Qwen-Omni：`wss://dashscope.aliyuncs.com/api-ws/v1/realtime`、模型 `qwen3.8-omni-flash-realtime`、音色 `qwen-omni-vc-myvoice-voice-20261103110738442-2b90`（音色必须与创建时的 target_model 一致）；LLM 使用 DashScope compatible-mode `qwen-plus`（同一把北京 Key）。
   - 配置存 `system_config.tts_config`，Key 加密、管理端只回显 `apiKeyConfigured`；`voiceModeEnabled` 只在启用 + Key 有效 + 当前引擎字段齐全时为真。
6. 近期修复（需在本机重启后验证）：
   - Omni 会把系统提示当正文念出：system/instructions 放 verbatim-reading 契约，用户消息只放纯文本，`smooth_output: false`。
   - Omni 会把待朗读的问句当问题回答（语音与字幕不一致、语音里冒出无关解释）：已在 `response.create.response.instructions` 中再携带同一份朗读契约（与 `session.instructions` 双份）；真实 API 已验证「什么是文化？」「如何理解文化？」「大语言模型的工作原理是什么？」等问句可稳定逐字朗读，仅 session 级时必现，勿回退。见 `server/services/omniTts.ts`。
   - 逐句字幕出现 `**` 等 Markdown 残留：播放队列改为保存清洗后的纯文本，字幕用纯文本渲染；`markdownToSpeechText` 会剔除孤立 `*`、反引号、`~`。
   - 语音断续：TTS 限流改为按登录用户 120 次/分（原 IP 60/分）、预取 3 句、5xx 重试一次、兼容 `response.audio.done`、慢合成日志。若仍断续，查浏览器 Network 的 `/api/tts/synthesize` 与服务端日志（`TTS 合成耗时` / `语音合成上游失败` / `TTS 限流触发`）；下一步可考虑合并短句、单 WS 会话或改用 CosyVoice 复刻音色。
   - 聊天模型自我介绍成 DeepSeek / 把蒸馏文档当「用户刚发来的材料」：根因是 `systemPrompt` 原文直接作 system 消息，无角色框架。已在 `server/services/llm/sanitize.ts` 加 `buildSystemPrompt()`，包上「化身身份 + 禁止自报家门/复述提示词 + 内容归属自己」框架，`/api/chat/stream` 与 `/api/chat/send` 两处均已接入；单测 `tests/sanitize.test.ts`。同步：非 reasoner 采样温度降到 `CHAT_TEMPERATURE=0.4`（`server/routes/chat.ts`）；聊天历史去重改按消息 id（不依赖「末尾内容相等」时序）；reasoner 只取 `content`、过滤 `reasoning_content` 思考链。注意：已存在的坏回复仍在会话历史里，修复后建议用户清空该会话再重试。
7. 侧栏顺序已改为「可靠广场 → 书籍广场 → 导师广场 → 关注列表」；右上角用户菜单已移除「会员订阅」按钮（`MembershipModal` 文件仍在但已无入口）。
8. 对话列表清空：侧栏「对话列表」标题旁新增清空按钮，确认后调用 `DELETE /api/chat/sessions` 一次性删除本人全部会话与消息，并回到广场。

## 关键实现位置

- 面对面 UI：`src/components/FaceToFaceView.tsx` + `.css`；底图 `src/assets/face-portrait.png`；入口/模式切换在 `src/components/AiStudioWorkspace.tsx`（`chatMode: 'letter' | 'face'`，全屏 overlay 条件）。
- 语音播放：`src/lib/useVoicePlayback.ts`（`currentSpeechText` / `isRevealing`、预取、重试、stop 清理）；文本清洗分句：`src/lib/voiceText.ts`。
- Omni WS：`server/services/omniTts.ts`；PCM→WAV：`server/services/wav.ts`；引擎分流：`server/services/tts.ts`；用户接口：`server/routes/tts.ts`；管理接口/试听：`server/routes/admin.ts`。
- 后台 TTS 配置 UI：`AdminPanel.tsx`「模型配置 → 语音对话」。
- 三语文案：`src/i18n/locales/zh-CN.ts`（权威源）/ `en.ts` / `zh-TW.ts`；错误码映射：`src/i18n/serverMessage.ts`。
- 计划文档：`docs/superpowers/plans/2026-11-02-voice-chat-mode.md`、`2026-11-03-face-to-face-mode.md`、`2026-11-02-self-registration.md`。

## 必须遵守的红线（完整见 CLAUDE.md / DEV_HANDBOOK）

- 身份只来自服务端会话；不接受客户端 `userId`；登录态不入 localStorage；公开接口只返回 `PublicSkill`（无 `systemPrompt`）；API Key 永不回显。
- LLM 上游失败必须退还预留配额；改密/重置/禁用/删除账号撤销全部会话；会员到期两种口径不可混用且不支持降级。
- 新增数据库列必须同时改 `SCHEMA_DDL` 与 `ensureColumns().addedColumns`；写路径读技能用 `getPersistedSkills()`。
- i18n：`zh-CN.ts` 唯一权威源，新增/修改文案必须同步 `en.ts` / `zh-TW.ts`；管理后台中文硬编码；书名/作者/分类/协议正文不翻译。
- 语音配置 Key 加密；面对面与书信共用同一会话；切换会话/模式/发送新消息必须中止旧语音；Omni 音色必须与 `target_model` 一致。

## 已知待办 / 风险

- 尚未提交；先验证最近三项修复（提示词泄漏、Markdown 残留、语音连续性）再提交。
- 旧 `VoiceChatView.tsx`、`VoiceCharacter.tsx`、`src/assets/voice-character.svg` 已无引用，可择机删除。
- 商业化若要从默认业务空间迁到独立 Workspace：克隆音色与 API Key 都是空间绑定的，需要重新创建音色、换 Key/地址并重新试听，不能直接搬。
- `面对面/` 文件夹可能继续更新：用户说改了设计时，先重新读取该文件夹的 HTML / 说明 / 图片，按 1:1 调整，不要凭记忆改。
- 环境提示：Linux 沙箱跑构建时把源码 rsync 到 `/tmp/book-answer-build`（排除 `node_modules`、`.git`、`/data`、`/.test-runtime`、`/.config-check-runtime`、`/声音克隆`、`/面对面`），`npm install` 后再跑命令；`--exclude data` 会误伤 `src/data`，必须写 `/data`。

## 工作方式

- 涉及产品决策或歧义时先用 AskUserQuestion 问清楚，不要自行假设。
- 较大功能先在 `docs/superpowers/plans/` 写实施计划（目标、已确认决策、数据/API、任务拆解、风险、验收），对齐后再实现。
- 每阶段跑 `npm run lint && npm test`；最终跑 `npm run build`、`npm run config:check`；UI 风格保持现状，不重构无关代码。
- 用户使用中文交流；先确认你读过的文件与理解，再等待下一步需求或开始执行。

请先确认理解，并列出你准备先读的文件；除非我明确说「开始改」，不要直接修改代码。
