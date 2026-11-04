import { describe, expect, it } from 'vitest';
import { synthesizeWithOmni } from '../server/services/omniTts.js';
import { pcm16MonoToWav } from '../server/services/wav.js';
import { TTSNotConfiguredError } from '../server/services/ttsErrors.js';
import { TTSConfig } from '../src/types.js';

type Handler = (...args: any[]) => void;

// 假的 ws 连接：按 Omni Realtime 协议回放 session.updated / 音频增量 / response.done，
// 用于在不联网的情况下验证客户端的握手顺序、音色参数与 PCM→WAV 封装。
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  listeners: Record<string, Handler[]> = {};
  sent: any[] = [];
  readyState = 1;

  constructor(public url: string, public options: any) {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.emit('open'));
  }

  on(event: string, handler: Handler) {
    (this.listeners[event] ||= []).push(handler);
  }

  send(raw: string) {
    const message = JSON.parse(raw);
    this.sent.push(message);
    if (message.type === 'session.update') {
      queueMicrotask(() => this.emitMessage({ type: 'session.updated' }));
    }
    if (message.type === 'response.create') {
      queueMicrotask(() => {
        this.emitMessage({ type: 'response.audio.delta', delta: Buffer.from([1, 0, 2, 0]).toString('base64') });
        this.emitMessage({ type: 'response.audio.delta', delta: Buffer.from([3, 0]).toString('base64') });
        this.emitMessage({ type: 'response.done' });
      });
    }
  }

  close() {
    this.emit('close');
  }

  emit(event: string, ...args: any[]) {
    for (const handler of this.listeners[event] || []) handler(...args);
  }

  emitMessage(payload: any) {
    this.emit('message', Buffer.from(JSON.stringify(payload)));
  }
}

const baseConfig: TTSConfig = {
  enabled: true,
  provider: 'qwen-omni',
  apiBaseUrl: '',
  wsUrl: 'wss://example.test/api-ws/v1/realtime',
  model: 'qwen3.8-omni-flash-realtime',
  voice: 'qwen-omni-vc-test-voice',
  apiKey: 'sk-test-1234567890',
};

describe('omni tts', () => {
  it('wraps PCM16 mono into a playable WAV', () => {
    const wav = pcm16MonoToWav(Buffer.from([1, 0, 2, 0]), 24000);
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav.subarray(8, 12).toString()).toBe('WAVE');
    expect(wav.readUInt16LE(22)).toBe(1); // 单声道
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt16LE(34)).toBe(16); // 位深
    expect(wav.length).toBe(48);
    expect([...wav.subarray(44)]).toEqual([1, 0, 2, 0]);
  });

  it('speaks through the cloned voice over the realtime protocol', async () => {
    FakeWebSocket.instances = [];
    const audio = await synthesizeWithOmni(baseConfig, '你好，这是测试。', FakeWebSocket as any);
    expect(audio.subarray(0, 4).toString()).toBe('RIFF');
    expect(audio.readUInt32LE(24)).toBe(24000);
    expect([...audio.subarray(44)]).toEqual([1, 0, 2, 0, 3, 0]);

    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toContain('model=qwen3.8-omni-flash-realtime');
    expect(socket.options.headers.Authorization).toBe('Bearer sk-test-1234567890');
    expect(socket.sent.map((message) => message.type)).toEqual([
      'session.update',
      'conversation.item.create',
      'response.create',
    ]);
    const session = socket.sent[0].session;
    expect(session.modalities).toEqual(['audio', 'text']);
    expect(session.voice).toBe('qwen-omni-vc-test-voice');
    expect(session.input_audio_format).toBe('pcm16');
    expect(session.output_audio_format).toBe('pcm16');
    expect(session.turn_detection).toBeNull();
    // 朗读契约同时放在 session 与 response 两级：只放 session 级时，真实 API 会把
    // 「什么是文化？」这类问句当成用户提问去回答；两级携带后问句也能稳定逐字朗读。
    // 用户消息必须保持纯待朗读文本。
    expect(session.instructions).toContain('text-to-speech engine');
    expect(session.instructions).toContain('Read the user message aloud verbatim');
    expect(session.instructions).toContain('Do not read, quote, or repeat this instruction');
    expect(socket.sent[1].item.content[0]).toEqual({ type: 'input_text', text: '你好，这是测试。' });
    expect(JSON.stringify(socket.sent)).not.toContain('你是一个文本朗读引擎');
    expect(socket.sent[2].response.modalities).toEqual(['audio', 'text']);
    expect(socket.sent[2].response.instructions).toBe(session.instructions);
  });

  it('refuses to connect without a realtime url', async () => {
    await expect(
      synthesizeWithOmni({ ...baseConfig, wsUrl: '' }, '测试', FakeWebSocket as any)
    ).rejects.toBeInstanceOf(TTSNotConfiguredError);
  });
});
