# 语音对话模式 Implementation Plan

**Goal:** 在现有文字聊天之外新增「语音对话」模式：AI 回复由阿里云 DashScope CosyVoice 以老年人物音色合成为语音自动播放；语音模式左侧显示人物动画（先内置占位形象，后期替换为正式 gif/矢量图），右侧聚焦展示最新一轮回复文字，文字下方为文字输入框。TTS 的 Key、模型与音色在管理后台「模型配置」中维护。

> **实施状态（2026-11-02）：已完成。** 已通过 `npm run lint`、`npm test`（24 用例，新增 voiceText 单测与 TTS API 集成用例）、`npm run build`、`npm run config:check`，并用生产构建产物 + 临时 DATA_DIR 冒烟验证健康检查、公开配置与 TTS 匿名 401。`npm run verify` 仍会在 audit:prod 因仓库既有依赖告警中断，与本次改动无关。后台音色已改为**可编辑字段**，内置老年、青年、说书等常用 v3 音色预设，也可自由填写任意音色参数。人物形象已替换为用户提供的 `src/assets/voice-character.svg`（爷爷站立讲解动画，SMIL、无脚本）。

**Tech Stack:** React 19 + TypeScript 5.8 + Vite 6 + Tailwind CSS 4 / Express 4 + better-sqlite3（WAL）/ vitest + supertest / DashScope CosyVoice HTTP API。

**已确认的产品决策（2026-11-02）：**

| # | 决策 |
|---|------|
| D1 | TTS 配置放后台「模型配置」页：API Key 加密入库、模型/音色/开关可配，并带试听；与现有 LLM 配置同一套机制 |
| D2 | 预置两种 60 岁以上老年音色，后台可切换，默认龙老伯：`longlaobo_v3`（龙老伯，沧桑岁月爷，男）/ `longlaoyi_v3`（龙老姨，烟火从容阿姨，女） |
| D3 | 分句渐进播放：AI 回复流式生成时按句切分，边生成边合成、按序播放，首句尽快出声 |
| D4 | 语音模式右侧只展示最新一轮（当前 AI 回复 + 用户提问小字回显）；完整历史仍在会话中，切回文字模式可查看 |

**非目标（本次不做）：** 用户语音输入（ASR）、按技能/导师区分人物形象、TTS 音频持久化或跨用户缓存、语音专属会员权益或额外扣配额、移动端专门的大屏适配、多 TTS 供应商抽象。

---

## Global Constraints

- 遵循 [AGENTS.md](../../../AGENTS.md)：YAGNI、最少代码、精准修改、优先复用、中文注释、TypeScript 强类型；UI 风格保持现状。
- 遵循 [CLAUDE.md](../../../CLAUDE.md)：身份只来自服务端会话；API Key 永不返回前端明文；`/api` 写请求默认受 CSRF 保护；服务端错误返回错误码。
- 用户端文案只改 `src/i18n/locales/zh-CN.ts`，`en.ts` / `zh-TW.ts` 必须同步补齐，漏键 `npm run lint` 直接失败；管理后台不做多语言，新增文案用中文硬编码。
- 本功能只在 `system_config` 增加一条 KV 记录 `tts_config`，**不新增表、不新增列**，无需改动 `SCHEMA_DDL` / `addedColumns`。
- 语音模式与文字模式共用同一会话、同一条消息流；切换模式不新建会话、不丢失上下文。
- 不破坏现有文字聊天、配额结算、SSE 流式链路；TTS 失败不得影响聊天消息落库与配额结算。

---

## 1. 总体设计

### 1.1 配置与数据模型

新增共享类型（`src/types.ts`）：

```ts
export interface TTSConfig {
  enabled: boolean;
  apiBaseUrl: string;   // 默认 DashScope CosyVoice HTTP 端点
  model: string;        // 默认 cosyvoice-v3-flash
  voice: string;        // 默认 longlaobo_v3（龙老伯）
  apiKey?: string;      // 仅运行时持有解密值，永不回传前端
  apiKeyConfigured?: boolean;
}
```

默认值放 `src/data/initialData.ts`（紧邻 `DEFAULT_LLM_CONFIG`）：

```ts
export const DEFAULT_TTS_CONFIG: TTSConfig = {
  enabled: false,
  apiBaseUrl: 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
  model: 'cosyvoice-v3-flash',
  voice: 'longlaobo_v3',
};
```

存储：`system_config` 表新增 `tts_config` 键，JSON 持久化；`apiKey` 复用 `server/services/security.ts` 的 `encryptSecret()` 做 AES-256-GCM 加密后落库，读取时解密，管理端视图剔除明文只返回 `apiKeyConfigured`。

`server/db.ts` 新增三个方法（与 LLM 配置同风格）：

- `getTTSConfig(): TTSConfig` —— 无记录时返回默认值；有记录时解密 Key、填充 `apiKeyConfigured`。
- `getAdminTTSConfigView(): TTSConfig` —— 去掉明文 `apiKey`。
- `saveTTSConfig(config: Partial<TTSConfig>, apiKey?: string | null): TTSConfig` —— 与当前值合并；`apiKey === undefined` 表示保持、`null` 表示清除、字符串表示替换；合并时显式丢弃客户端回传的 `apiKey` / `apiKeyConfigured`，防止明文或状态被覆盖。

`LLMConfig`（公开配置用）新增可选字段：

```ts
voiceModeEnabled?: boolean;  // = tts.enabled && apiKey 有效
```

### 1.2 服务端 API 与 TTS 服务

| 方法 | 路径 | 鉴权 | 请求 / 响应 | 说明 |
|------|------|------|-------------|------|
| POST | `/api/tts/synthesize` | `requireUser` + CSRF + 限流 60 次/分 | `{ text: string ≤500字 }` → `audio/mpeg` 二进制 | 按句合成；未配置 503 `TTS_NOT_CONFIGURED`，上游失败 502 `TTS_UNAVAILABLE` |
| GET | `/api/admin/tts-config` | `requireAdmin` | `{ ttsConfig }`（不含明文 Key） | 后台读取 |
| POST | `/api/admin/tts-config` | `requireAdmin` | `{ ttsConfig, apiKeyMode?: 'keep'\|'replace'\|'clear', apiKey? }` → `{ success, ttsConfig }` | 保存；`replace` 但无 Key → 400 `INVALID_API_KEY` |
| POST | `/api/admin/tts-test` | `requireAdmin` | 空体 → `audio/mpeg` 试听音频；失败 JSON `{ error, message }` | 用已保存配置合成一句固定测试语 |
| GET | `/api/config/public` | 公开 | `llmConfig.voiceModeEnabled: boolean` | 用户端据此显示「语音对话」入口 |

**TTS 服务**（新文件 `server/services/tts.ts`）：

1. 读取 `db.getTTSConfig()`，`!enabled` 或 Key 无效（复用 `isInvalidOrPlaceholderKey`）→ 抛 `TTS_NOT_CONFIGURED`。
2. 清洗文本（去 Markdown 标记，复用与前端相同的纯函数），空文本 → 400。
3. 调用 DashScope CosyVoice HTTP API（非流式）：

```http
POST {apiBaseUrl}
Authorization: Bearer <apiKey>
Content-Type: application/json

{
  "model": "cosyvoice-v3-flash",
  "input": { "text": "……", "voice": "longlaobo_v3", "format": "mp3", "sample_rate": 24000 }
}
```

4. 响应 `output.audio.url`（24 小时有效；若返回 `output.audio.data` base64 则直接解码）→ 服务端二次下载音频（≤15MB）→ 以 `audio/mpeg` 返回给前端并 `Cache-Control: no-store`。音频不落盘、不缓存。
5. 超时：合成 30 秒、下载 20 秒；上游非 2xx、响应缺音频、下载失败统一抛 `TTS_UNAVAILABLE` 并 `console.warn`（不记录 Key）。
6. 选型说明：CosyVoice 的老年系统音色（`longlaobo_v3` / `longlaoyi_v3`）属 v3 模型；HTTP 非流式接口用普通 `fetch` 即可，**无需新增 WebSocket 依赖**。

**CSP**：`server/app.ts` 的 helmet 指令增加 `mediaSrc: ["'self'", 'blob:']`（前端用 Blob URL 播放音频）。

**限流**：TTS 按句调用，单条长回复可能触发十几次请求，故独立限流桶放宽到 60 次/分（聊天端点仍为 30 次/分）。

**安全**：`/api/tts/synthesize` 必须登录；文本长度上限 500 字（前端每句远小于此）；不接客户端的模型/音色参数（只认后台配置）；Key 只进服务端日志之外的环节，pino redact 已覆盖 `req.body.apiKey`。

### 1.3 用户端交互设计

**模式切换**：聊天页顶部工具条左侧新增分段控件「文字对话 / 语音对话」（`MessageSquareText` / `AudioLines` 图标，米金色选中态，与现有胶囊按钮一致）。仅当 `llmConfig.voiceModeEnabled` 为真时显示语音入口；默认文字模式。切换模式不重置会话、不清空输入草稿。

**语音模式布局**（新组件 `src/components/VoiceChatView.tsx`，聊天头部与输入区仍由 `AiStudioWorkspace` 持有）：

- **左侧人物舞台**（约 38% 宽，`hidden md:flex`）：米色渐变背景 + 圆形人物形象 + 技能名称；播放时人物有呼吸/光环动效与「正在讲述…」状态，合成中显示「正在生成语音…」。形象先用内置占位 SVG（`VoiceCharacter` 组件），后期拿到正式 gif 后只替换该组件内的资源，不影响布局。
- **右侧**：只渲染最新一轮——用户提问以小号灰字气泡回显；AI 回复用 `MarkdownMessage` 大字号展示（流式时复用 `currentStreamingText`）；回复下方有「重播 / 停止」按钮；初始无提问时展示欢迎语与推荐问（点击即发送）。
- **输入框**：完全复用文字模式的输入卡片样式与交互（回车发送、草稿按会话隔离、生成中禁用），位于右侧底部。

**分句渐进播放**：

- 新增纯函数模块 `src/lib/voiceText.ts`：`markdownToSpeechText()`（去代码块、链接、标题、强调、表格符号等）、`takeCompleteSentences()`（从流式缓冲区提出完整句子，单段上限约 180 字，超长无标点时硬切）、`splitSpeechText()`（整段回复切分，用于重播）。
- 新增 Hook `src/lib/useVoicePlayback.ts`：维护文本队列与“预取下一句”的合成流水线；当前句播放时并行合成下一句，句间停顿最小化；`startStream / pushStream(fullText) / endStream(fullText)` 由 `handleSendMessage` 的 SSE 增量驱动；`speak(text)` 用于重播；`stop()` 在切换文字模式、新建/切换会话、发送新消息、组件卸载时调用，负责 abort 请求、暂停音频、释放 Blob URL。
- 合成失败不阻塞文字展示：失败句跳过并继续后续句子，同一轮只 toast 一次「语音暂时不可用」。
- 自动播放限制：首句播放发生在用户点击发送之后的异步回调中，主流浏览器允许；为稳妥起见回复旁始终提供手动「重播」按钮兜底。

### 1.4 后台交互设计

「模型配置」页签在现有模型卡片下方新增「语音对话（TTS）」卡片（中文硬编码）：

| 字段 | 控件 | 说明 |
|------|------|------|
| 启用语音对话 | 开关 | 关闭后用户端隐藏入口，接口返回 `TTS_NOT_CONFIGURED` |
| API 服务地址 | 文本输入 | 默认 DashScope SpeechSynthesizer 地址，兼容 workspace 专属域名 |
| API Key | 密码输入 + 已配置徽标 | 与 LLM Key 相同：留空保持、填写替换；不清空则不回显 |
| 模型 | 文本输入 | 默认 `cosyvoice-v3-flash` |
| 音色 | 下拉 | 龙老伯（沧桑岁月爷，男）`longlaobo_v3` / 龙老姨（烟火从容阿姨，女）`longlaoyi_v3` |
| 操作 | 保存 / 试听 | 试听使用已保存配置合成固定测试语并直接播放 |

---

## 2. 改动文件清单

| 文件 | 改动 |
|------|------|
| `src/types.ts` | 新增 `TTSConfig`；`LLMConfig` 增加 `voiceModeEnabled?` |
| `src/data/initialData.ts` | 新增 `DEFAULT_TTS_CONFIG` |
| `server/db.ts` | 新增 `getTTSConfig` / `getAdminTTSConfigView` / `saveTTSConfig` |
| `server/services/tts.ts` | 新增：DashScope CosyVoice HTTP 合成、音频下载、错误类型 |
| `server/routes/tts.ts` | 新增：`POST /api/tts/synthesize` |
| `server/routes/admin.ts` | 新增 tts-config GET/POST 与 tts-test |
| `server/routes/config.ts` | 公开配置增加 `voiceModeEnabled` |
| `server/app.ts` | 注册 TTS 路由；CSP 增加 `media-src blob:` |
| `src/lib/voiceText.ts` | 新增：Markdown 清洗、分句、流式取句纯函数 |
| `src/lib/useVoicePlayback.ts` | 新增：TTS 播放队列 Hook（预取、中止、重播） |
| `src/components/VoiceChatView.tsx` | 新增：左侧人物舞台 + 右侧最新一轮 + 输入框 |
| `src/components/VoiceCharacter.tsx` | 新增：人物占位形象（后期替换 gif 的唯一切换点） |
| `src/components/AiStudioWorkspace.tsx` | 模式切换、SSE 增量喂给播放 Hook、语音视图接入 |
| `src/components/AdminPanel.tsx` | 模型配置页新增 TTS 卡片与保存/试听逻辑 |
| `src/i18n/locales/zh-CN.ts` / `en.ts` / `zh-TW.ts` | 新增语音模式与错误码文案 |
| `src/i18n/serverMessage.ts` | 映射 `TTS_NOT_CONFIGURED` / `TTS_UNAVAILABLE` |
| `tests/voiceText.test.ts` | 新增：清洗与分句单测 |
| `tests/api.test.ts` | 新增：TTS 配置加密、鉴权、mock DashScope 合成链路 |
| `docs/DEV_HANDBOOK.md` / `CLAUDE.md` | 补充 TTS 配置、接口与排障条目 |

---

## 3. 关键实现细节

### 3.1 DashScope 请求与响应

- 非流式请求返回音频 URL；该 URL 在 24 小时后失效，服务端下载后立即转给前端，不持久化。
- 若账号返回的是 SSE（`X-DashScope-SSE` 未开启时不会），按 JSON 响应处理即可；实现里兼容 `output.audio.data` base64。
- 音色与模型必须成对匹配：`longlaobo_v3` / `longlaoyi_v3` 仅适用于 v3 系列模型（默认 `cosyvoice-v3-flash`）。后台可改模型与音色，避免区域或账号能力差异时无法切换。

### 3.2 文本清洗与分句

- 发送给 TTS 的文本必须去掉 Markdown：代码块、行内代码、图片、链接（保留链接文字）、标题井号、引用符号、列表符号、强调星号、表格竖线、HTML 标签。
- 分句边界：`。！？!?；;…` 与换行；英文 `.` 仅在空白/结尾时算句末。单段超过 180 字无标点时在 180 字处硬切，避免一句过长导致出声慢。
- 服务端再次清洗并限长，客户端清洗只是体验优化，不是安全边界。

### 3.3 播放队列与资源释放

- 队列规则：文本按序入队；合成保持最多 1 句预取，与当前播放并行。
- `stop()` 必须：递增代际号、abort 未完成的 fetch、清空队列、暂停并释放当前 Audio、回收全部 Blob URL；防止快速切换会话时旧音频串播或内存泄漏。
- 播放状态只影响人物动效与按钮文案，不阻塞输入与发送。

### 3.4 安全与限额

- TTS Key 只存服务端（AES-GCM 加密），管理端读取、公开配置、日志、错误响应均不出现明文。
- 合成接口只接受文本，模型/音色/地址只来自后台配置，防止被当作任意上游代理。
- 文本上限 500 字 + 60 次/分限流 + 必须登录，控制成本与滥用。
- 管理端 `apiBaseUrl` 由管理员控制（与 LLM 配置同信任级），仅校验 http(s) 前缀。

---

## 4. 任务拆解

1. **后端配置层**：类型、默认值、DB 加密存取、公开配置字段。
2. **后端 TTS 服务与接口**：`services/tts.ts`、`routes/tts.ts`、CSP、app 装配。
3. **后端管理接口**：tts-config 读写、试听；错误码。
4. **前端基础设施**：`voiceText.ts`、`useVoicePlayback.ts`。
5. **前端界面**：`VoiceCharacter`、`VoiceChatView`、`AiStudioWorkspace` 模式切换与 SSE 联动。
6. **后台界面**：`AdminPanel` TTS 卡片、保存、试听播放。
7. **i18n**：三份字典 + `serverMessage` 映射。
8. **测试**：`voiceText` 单测、API 集成（鉴权/未配置/加密/mock 合成成功）。
9. **文档**：DEV_HANDBOOK 接口与数据表条目、CLAUDE.md 结构表。
10. **验证**：`npm run lint && npm test`，再 `npm run build` 与 `npm run config:check`；用既有旧库启动一次确认无 schema 漂移。

## 5. 风险与对策

| 风险 | 对策 |
|------|------|
| DashScope 账号/区域不支持 v3 老年音色 | 模型、音色、地址全部后台可改；保存后先用试听验证 |
| 浏览器拦截自动播放 | 首句在用户点击发送后播放；每条回复提供手动重播按钮兜底 |
| 长回复 TTS 请求过多 | 每句 ≤180 字、后台限流 60 次/分，超限句跳过不影响文字 |
| Blob URL / Audio 泄漏 | `stop()` 统一回收；切换会话、卸载、发送新消息都会调用 |
| 上游慢或挂起拖住请求 | 合成/下载双超时，失败返回 `TTS_UNAVAILABLE`，聊天与配额不受影响 |
| 既有文字聊天回归 | 模式切换仅是视图分支；文字链路代码只增加“喂句子”调用，失败全部吞掉 |

## 6. 验收标准

- 后台可保存 DashScope Key（加密、不回显）、切换老年音色、关闭/开启语音入口；试听可播放。
- 用户端已登录用户可切换语音模式；左侧人物占位形象在播放时有动效；右侧只显示最新一轮，输入框可正常发送并复用会话历史。
- AI 回复流式生成时按句合成播放，句间可接受停顿；切换模式/会话/发送新消息会立即停止旧语音。
- 未配置 TTS 时用户端不显示语音入口，直接调接口返回 `TTS_NOT_CONFIGURED`。
- `npm run lint`、`npm test`、`npm run build`、`npm run config:check` 全部通过；旧库启动无「结构同步失败」。
