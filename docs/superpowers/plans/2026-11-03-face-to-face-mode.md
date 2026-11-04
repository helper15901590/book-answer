# 面对面模式（Qwen-Omni 克隆音色朗读）Implementation Plan

**Goal:** 在现有聊天页之外新增全屏「面对面」模式：按用户提供的 16:9 设计稿 1:1 实现人物画面 + 右侧半透明对话面板；AI 回复仍由现有对话模型生成，文字逐句交给阿里云 Qwen-Omni Realtime，用用户已复刻的音色朗读；「书信」返回现有文字聊天页。会话、历史与未发送草稿在两种模式间共享。

> **实施状态（2026-11-03）：已完成。** `npm run lint`、`npm test`（28 用例，新增 WAV 封装与模拟 WebSocket 的 Omni 协议测试）、`npm run build`、`npm run config:check` 全部通过；生产构建冒烟验证了健康检查、16:9 人物底图可访问、后台保存 Qwen-Omni 配置（Key 加密不回显）与公开配置 `voiceModeEnabled=true`。界面已按「沉浸版」设计更新（无面板底色、文字浮于背景、细线输入）。Omni 握手报文已对齐交接文档中验证可用的 DashScope SDK（顶层 voice + pcm16、session.update 后立即发送文本与 response.create、response 显式声明音频模态），并在管理端试听中返回上游错误摘要便于定位；沙箱无法直连 DashScope，真实克隆音色合成需按交付步骤在本机后台配置后试听验证。

**Tech Stack:** React 19 + TypeScript 5.8 + Vite 6 + Tailwind CSS 4 / Express 4 / DashScope Qwen-Omni Realtime WebSocket（服务端经 `ws` 连接）/ vitest + supertest。

**已确认的产品决策（2026-11-03）：**

| # | 决策 |
|---|------|
| D1 | 「面对面」为**全屏沉浸式**界面，覆盖整个应用（含侧栏），按设计稿 1:1 呈现；右上角有「书信 / 面对面」切换与全屏按钮 |
| D2 | 「书信」= 关闭面对面舞台，**返回现有文字聊天页**；会话、消息、草稿全部保留 |
| D3 | 克隆音色只用于 **Qwen-Omni 仅朗读**：回答文字仍由现有对话模型生成，逐句交给 `qwen3.8-omni-flash-realtime` 用克隆音色合成语音；接受朗读可能偶有多字/漏字、延迟略高 |

**关键约束：** 交接文档中的音色 `qwen-omni-vc-myvoice-voice-20261103110738442-2b90` 的 `target_model` 是 `qwen3.8-omni-flash-realtime`，只能通过 Realtime WebSocket 使用，不能走现有 CosyVoice HTTP 接口。合成时必须使用同一模型；北京地域，WS 地址可用 `wss://dashscope.aliyuncs.com/api-ws/v1/realtime`，若控制台要求业务空间专属域名则在后台填写 `wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime`。

**非目标：** 麦克风语音输入（ASR）、用 Omni 直接生成回答、全屏纸张书信版式、面对面模式内切换会话、人物照片动效/视频化、后台在线创建克隆音色。

---

## Global Constraints

- 遵循 AGENTS.md：YAGNI、最少代码、精准修改、中文注释、强类型。
- 交接资料 `声音克隆/`、`面对面/` 含 API Key 与原始录音，**必须加入 .gitignore，严禁提交**；音色 ID 与 Key 只通过后台配置（Key 加密入库）使用，不写进代码。
- 不破坏现有文字聊天、配额、SSE、注册与语音播放队列；面对面只是一层视图 + TTS 引擎扩展。
- 用户端新增文案三语同步（zh-CN 权威）；管理后台中文硬编码。
- 新增依赖仅前后端皆可用的 `ws`（服务端 WebSocket 需要自定义 Authorization 头，Node 内置 WebSocket 不支持请求头）。

## 1. 后端设计

### 1.1 TTS 配置扩展

`TTSConfig` 增加：

```ts
export type TTSProvider = 'cosyvoice' | 'qwen-omni';
interface TTSConfig {
  enabled: boolean;
  provider: TTSProvider;   // 默认 cosyvoice；老配置缺省时回退 cosyvoice
  apiBaseUrl: string;      // CosyVoice HTTP
  wsUrl: string;           // Qwen-Omni Realtime，默认 wss://dashscope.aliyuncs.com/api-ws/v1/realtime
  model: string;
  voice: string;
  apiKey?: string;
  apiKeyConfigured?: boolean;
}
```

`server/db.ts` 的 `getTTSConfig/saveTTSConfig` 负责默认值与 provider/wsUrl 规范化；旧记录无需迁移。

### 1.2 Omni 朗读服务

新增 `server/services/omniTts.ts` 与 `server/services/wav.ts`（PCM16 → WAV 封装）：

1. 校验 provider/model/voice/wsUrl/key；缺失 → `TTS_NOT_CONFIGURED`。
2. `new WebSocket(wsUrl?model=... , { headers: { Authorization: Bearer key } })`（`ws` 包）。
3. `session.update` 与已验证 SDK 一致：顶层 `voice`、`input_audio_format/output_audio_format: 'pcm16'`、`turn_detection: null`、`smooth_output: false`；`instructions` 使用 verbatim-reading 契约（整条用户消息都是待朗读文本，不回答、不改写、不朗读系统提示）。
4. 发送 `conversation.item.create`（用户消息只放纯文本）与 `response.create`（声明 modalities，并再次携带同一份朗读契约；只放 session 级时 Omni 会把「什么是文化？」这类问句当问题回答，语音与字幕不一致）。
5. 累积 `response.audio.delta` 的 base64 PCM（24kHz/16bit/mono），`response.done` 后包装成 WAV 返回；`error`/超时（60s）/无音频 → `TTS_UNAVAILABLE`。
6. `synthesizeSpeech` 按 provider 分流；返回值改为 `{ buffer, mime }`（CosyVoice → `audio/mpeg`，Omni → `audio/wav`）。路由与管理端试听使用动态 Content-Type。
7. 单次文本上限仍 500 字；前端逐句调用（≤180 字），预取深度沿用现有播放队列。

### 1.3 管理端

「模型配置 → 语音对话（TTS）」增加「语音引擎」：

- `CosyVoice：HTTP，系统音色 / CosyVoice 复刻`：显示 API 地址、模型、音色预设（可编辑）。
- `Qwen-Omni：Realtime，复刻音色`：显示 Realtime WebSocket 地址、模型（默认 `qwen3.8-omni-flash-realtime`）、复刻音色参数（可编辑，粘贴音色 ID），并提示模型必须与创建音色的 `target_model` 一致。
- 切换引擎时自动填入对应模型默认值；Key、启用、保存、试听沿用现有逻辑。

## 2. 前端设计

### 2.1 模式与入口

聊天页顶部切换由「文字对话 / 语音对话」改为「**书信 / 面对面**」：

- 书信：现有聊天界面（含侧栏、会话列表、文字输入）。
- 面对面：打开全屏覆盖层（`position: fixed; inset: 0; z-index` 低于全局弹窗），底层聊天保持挂载，会话与草稿共享。
- 仅当 `voiceModeEnabled`（TTS 已启用且 Key 有效）时显示面对面入口。
- 面对面内点「书信」：关闭覆盖层、回到聊天页并停止语音；退出全屏。

### 2.2 面对面界面（1:1 还原设计稿）

新组件 `src/components/FaceToFaceView.tsx` + `FaceToFaceView.css`（样式按原型移植并加 `face-` 前缀，使用容器查询单位适配 16:9）：

- 全屏铺满视口：人物底图按 16:9 居中，四边渐隐融入 #0b1424 背景（不再显示黑边）；移动端人物占上方 76vw。
- 沉浸版设计：取消右侧面板底色/边框/圆角与阴影，回复文字直接浮在人物背景的右侧留白中；用户消息为左对齐浅色文字；输入区为半透明细线 + 文字 + 圆形小发送按钮，聚焦时仅提高细线亮度。
- 顶栏：左上仅「← 返回」，右上「全屏 / 退出全屏」轻量文字按钮；全屏时隐藏所有按钮，Esc 退出。
- 对话区：顶部音波（播放语音时逐条跳动），下方只展示最新一轮 AI 回复（不回显用户提问）；AI 回复**只实时显示当前正在朗读的一句**（`useVoicePlayback.currentSpeechText`：新句开始时替换旧句，已说过的文字自动消失；完整回复切回书信模式查看），自动滚动到底部。
- 输入提示：`放轻松，从你想聊的开始...`。
- 输入：Enter 发送、Shift+Enter 换行、输入法合成保护；生成中禁用发送；自动滚动到底部。
- 语音：沿用 `useVoicePlayback` 的逐句合成与播放（后端自动走 Omni），回答点击可重播（`title` 提示），切换书信/退出时停止并回收。
- 全屏：`document.documentElement.requestFullscreen()`，失败时 toast 提示；监听 `fullscreenchange` 更新按钮文案。
- 响应式：≤900px 时按原型改为上下布局（人物 66vw、面板卡片式）。
- 欢迎语：会话已有欢迎消息则正常展示；无消息时显示原型欢迎文案（三语字典）。

### 2.3 状态联动

- `chatMode` 改为 `'letter' | 'face'`；发送消息时 `face` 模式喂给 TTS 播放队列。
- 关闭面对面、切换会话、登出、离开聊天视图、发送新消息时停止旧语音。
- 面对面打开期间底层文字聊天仍接收 SSE，关闭后文字已就位。

## 3. i18n

zh-CN 新增：`faceCaption`、`faceInputLabel`、`faceInputPlaceholder`、`faceSend`、`faceFullscreen`、`faceExitFullscreen`、`faceFullscreenFailed`、`faceThinking`、`faceWelcomeTitle`、`faceWelcomeBody`；将 `textChatMode/voiceChatMode` 的值改为「书信 / 面对面」。en / zh-TW 同步补齐。

## 4. 改动文件清单

| 文件 | 改动 |
|------|------|
| `.gitignore` | 忽略 `声音克隆/`、`面对面/` |
| `src/assets/face-portrait.png` | 复制 16:9 人物底图 |
| `src/types.ts` / `src/data/initialData.ts` | `TTSProvider`、`provider/wsUrl`、默认值 |
| `server/db.ts` | TTS 配置规范化 |
| `server/services/omniTts.ts` + `server/services/wav.ts` | Omni Realtime 朗读、PCM→WAV |
| `server/services/tts.ts` | 按 provider 分流、返回 mime |
| `server/routes/tts.ts` / `server/routes/admin.ts` | 动态 Content-Type |
| `package.json` / `package-lock.json` | 新增 `ws` |
| `src/components/FaceToFaceView.tsx` + `.css` | 全屏面对面界面 |
| `src/components/AiStudioWorkspace.tsx` | 书信/面对面切换、覆盖层、语音联动 |
| `src/components/AdminPanel.tsx` | TTS 引擎选择与 Omni 字段 |
| `src/i18n/locales/*.ts` | 新增面对面文案 |
| `tests/omniTts.test.ts` | WAV 封装 + 模拟 WS 协议测试 |
| `docs/DEV_HANDBOOK.md` / `CLAUDE.md` / 新计划文档 | 说明与接入步骤 |

## 5. 风险与对策

| 风险 | 对策 |
|------|------|
| Omni 不是 TTS，朗读可能加语气词 | 强指令“逐字朗读、不评论”；接受少量差异；如不可接受可切换回 CosyVoice 或另建 CosyVoice 音色 |
| qwen3.8 要求业务空间专属 WS 地址 | 后台 wsUrl 可编辑；默认经典地址，失败时按控制台替换 |
| 每句一次 WS 连接，延迟较高 | 保留现有“1 句在播 + 1 句预取”流水线；单句 ≤180 字 |
| 自动播放被拦截 | 点击 AI 回答可重播；文字始终正常显示 |
| 克隆音色 1 年不用会被删除 | 文档提示；生产定期调用保活 |
| 交接资料泄漏 | 文件夹加入 .gitignore；Key 只存加密配置；不写日志 |
| 全屏/移动端布局偏差 | 原型 CSS 1:1 移植 + 媒体查询；手工验收 1366/1920/手机宽度 |
| 回归风险 | 文字聊天与 TTS 队列逻辑不变，仅新增视图与 provider；全量测试 |

## 6. 验收标准

- 面对面界面与设计稿一致：16:9 人物底图、顶栏品牌/切换/全屏、左下标语、右侧玻璃面板与悬浮输入框；1366×768、1920×1080、手机宽度可用。
- 书信可随时退出并回到原聊天页，会话、历史、草稿不丢。
- 配置 Qwen-Omni 引擎（Key、wsUrl、模型、克隆音色）后，面对面回复自动用克隆音色逐句播放；点击回答可重播；退出后语音停止。
- 未配置 TTS 时不显示面对面入口；接口错误码 `TTS_NOT_CONFIGURED` / `TTS_UNAVAILABLE` 可翻译。
- `npm run lint`、`npm test`、`npm run build`、`npm run config:check` 全部通过；旧配置（无 provider/wsUrl）启动与试听不报错。
