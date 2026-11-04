import { TTSConfig } from '../../src/types.js';
import { markdownToSpeechText } from '../../src/lib/voiceText.js';
import { db } from '../db.js';
import { isInvalidOrPlaceholderKey } from './llm/sanitize.js';
import { synthesizeWithOmni } from './omniTts.js';
import { TTSInvalidTextError, TTSNotConfiguredError, TTSUpstreamError } from './ttsErrors.js';

// 错误类型从 ttsErrors 再导出，保持既有调用方（routes/admin）的 import 路径不变
export { TTSInvalidTextError, TTSNotConfiguredError, TTSUpstreamError } from './ttsErrors.js';

// 单次合成请求接受的最大文本长度。前端按句调用（每句远小于此），
// 这里只是服务端兜底，防止接口被当作任意长文本的合成通道。
const MAX_TTS_TEXT_LENGTH = 500;
const SYNTH_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 20_000;
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

// 管理后台「试听」使用的固定测试语（含中文标点，能验证音色与链路）
export const TTS_TEST_TEXT = '你好，我是你的AI思想导师。愿我的回答，能为你带来一点新的启发。';

export interface SynthesizedAudio {
  buffer: Buffer;
  mime: string;
}

// 语音模式可用的判定：开关打开、Key 有效，且当前引擎所需的关键字段齐全。
// 用户端公开配置与管理接口共用这一处口径，避免多个地方各写一套。
export function isTTSConfigured(config: TTSConfig = db.getTTSConfig()): boolean {
  if (!config.enabled || !config.apiKey || isInvalidOrPlaceholderKey(config.apiKey)) return false;
  if (!config.model || !config.voice) return false;
  return config.provider === 'qwen-omni' ? Boolean(config.wsUrl) : Boolean(config.apiBaseUrl);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// 调用 DashScope CosyVoice HTTP 非流式接口合成语音，返回 mp3 音频字节。
// 上游返回的是 24 小时有效的音频 URL，由服务端下载后转给前端（音频不落盘、不缓存）。
async function synthesizeWithCosyVoice(config: TTSConfig, text: string): Promise<Buffer> {
  const upstream = await fetchWithTimeout(config.apiBaseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      input: {
        text,
        voice: config.voice,
        format: 'mp3',
        sample_rate: 24000,
      },
    }),
  }, SYNTH_TIMEOUT_MS).catch((err: any) => {
    console.warn('TTS 上游请求异常:', err?.message || err);
    throw new TTSUpstreamError('TTS_UNAVAILABLE');
  });

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '');
    console.warn(`TTS 上游失败 (HTTP ${upstream.status}): ${errText.slice(0, 200)}`);
    throw new TTSUpstreamError('TTS_UNAVAILABLE');
  }

  const json: any = await upstream.json().catch(() => ({}));
  const audio = json?.output?.audio || {};

  // 非流式接口正常返回 URL；兼容返回 base64 数据的变体。
  if (typeof audio.data === 'string' && audio.data) {
    const buffer = Buffer.from(audio.data, 'base64');
    if (!buffer.length || buffer.length > MAX_AUDIO_BYTES) throw new TTSUpstreamError('TTS_UNAVAILABLE');
    return buffer;
  }

  const audioUrl = typeof audio.url === 'string' ? audio.url : '';
  if (!/^https?:\/\//i.test(audioUrl)) {
    console.warn('TTS 响应缺少音频地址');
    throw new TTSUpstreamError('TTS_UNAVAILABLE');
  }

  const download = await fetchWithTimeout(audioUrl, {}, DOWNLOAD_TIMEOUT_MS).catch((err: any) => {
    console.warn('TTS 音频下载异常:', err?.message || err);
    throw new TTSUpstreamError('TTS_UNAVAILABLE');
  });
  if (!download.ok) {
    console.warn(`TTS 音频下载失败 (HTTP ${download.status})`);
    throw new TTSUpstreamError('TTS_UNAVAILABLE');
  }
  const bytes = Buffer.from(await download.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) throw new TTSUpstreamError('TTS_UNAVAILABLE');
  return bytes;
}

// 按后台配置的引擎分流：cosyvoice → HTTP mp3；qwen-omni → Realtime WAV（复刻音色）。
export async function synthesizeSpeech(text: string): Promise<SynthesizedAudio> {
  const config = db.getTTSConfig();
  if (!isTTSConfigured(config)) throw new TTSNotConfiguredError('TTS_NOT_CONFIGURED');

  const cleanText = markdownToSpeechText(text).slice(0, MAX_TTS_TEXT_LENGTH).trim();
  if (!cleanText) throw new TTSInvalidTextError('EMPTY_TEXT');

  if (config.provider === 'qwen-omni') {
    return { buffer: await synthesizeWithOmni(config, cleanText), mime: 'audio/wav' };
  }
  return { buffer: await synthesizeWithCosyVoice(config, cleanText), mime: 'audio/mpeg' };
}
