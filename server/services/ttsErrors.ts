// 语音合成错误类型。单独成文件，供 CosyVoice（HTTP）与 Qwen-Omni（Realtime）
// 两个实现共用，避免相互 import 造成循环依赖。
export class TTSNotConfiguredError extends Error {}
export class TTSInvalidTextError extends Error {}
export class TTSUpstreamError extends Error {}
