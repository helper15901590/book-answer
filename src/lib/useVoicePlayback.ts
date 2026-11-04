import { useEffect, useRef, useState } from 'react';
import { apiFetch } from './apiFetch';
import { markdownToSpeechText, splitSpeechText, takeCompleteSentences } from './voiceText';

interface UseVoicePlaybackOptions {
  // 合成失败时回调一次（同一轮只报一次，避免长回复逐句弹窗）
  onError?: () => void;
}

export interface VoicePlaybackController {
  /** 正在播放音频 */
  isSpeaking: boolean;
  /** 已收到句子、正在合成、尚未出声 */
  isPreparing: boolean;
  /** 当前正在朗读的一句文字（新一句开始时替换上一句，不累积） */
  currentSpeechText: string;
  /** 是否处于「随音频显示当前句」状态（开始播放到 stop 为止） */
  isRevealing: boolean;
  /** 开始接收一条新的流式回复（会中断上一轮语音） */
  startStream: () => void;
  /** 喂入当前完整流式文本；内部按增量取句并排队合成 */
  pushStream: (fullText: string) => void;
  /** 流式结束：把最后没有句末标点的尾巴也送去合成 */
  endStream: (fullText: string) => void;
  /** 重播一整段回复（历史消息使用，不触发逐句显示） */
  speak: (messageText: string) => void;
  /** 立即停止并清空（切换模式/会话、发送新消息、卸载时调用） */
  stop: () => void;
}

// 合成预取深度：1 句在播 + 最多 2 句在合成，给上游抖动留出缓冲，减少句停顿。
// 再大意义有限：上游按句计费，积压过多也会让停止响应变慢。
const PREFETCH_DEPTH = 3;
const RETRY_DELAY_MS = 500;

interface SpeechChunk {
  // 已去掉 Markdown 标记的纯文本：既用于合成，也用于界面逐句字幕
  text: string;
}

interface InflightChunk {
  promise: Promise<Blob | null>;
  text: string;
}

export function useVoicePlayback(options: UseVoicePlaybackOptions = {}): VoicePlaybackController {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [currentSpeechText, setCurrentSpeechText] = useState('');
  const [isRevealing, setIsRevealing] = useState(false);

  const onErrorRef = useRef(options.onError);
  useEffect(() => {
    onErrorRef.current = options.onError;
  }, [options.onError]);

  // 每轮播放一个代际号：stop 后旧异步任务据此丢弃结果，避免串播
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<SpeechChunk[]>([]);
  const inflightRef = useRef<InflightChunk[]>([]);
  const pumpingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playResolveRef = useRef<(() => void) | null>(null);
  const consumedRef = useRef(0);
  const errorReportedRef = useRef(false);

  function stop(): void {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    queueRef.current = [];
    inflightRef.current = [];
    consumedRef.current = 0;
    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      audio.pause();
      audio.src = '';
    }
    playResolveRef.current?.();
    playResolveRef.current = null;
    setIsSpeaking(false);
    setIsPreparing(false);
    setCurrentSpeechText('');
    setIsRevealing(false);
  }

  function beginSession(): void {
    stop();
    abortRef.current = new AbortController();
    errorReportedRef.current = false;
  }

  async function synthesize(text: string, generation: number): Promise<Blob | null> {
    const reportError = () => {
      if (errorReportedRef.current) return;
      errorReportedRef.current = true;
      onErrorRef.current?.();
    };
    // 上游偶发 5xx / 网络抖动重试一次；配置错误与限流不重试（重试也只会再失败）
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await apiFetch('/api/tts/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
          signal: abortRef.current?.signal,
        });
        if (generation !== generationRef.current) return null;
        if (res.ok) return await res.blob();
        const data = await res.json().catch(() => ({}));
        const code = (data as any)?.error;
        if (attempt === 0 && res.status >= 500 && code !== 'TTS_NOT_CONFIGURED') {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
          continue;
        }
        console.warn('语音合成失败:', code || res.status);
        reportError();
        return null;
      } catch (err: any) {
        if (err?.name === 'AbortError' || generation !== generationRef.current) return null;
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
          continue;
        }
        console.warn('语音合成异常:', err?.message || err);
        reportError();
        return null;
      }
    }
    return null;
  }

  // 播放一段音频，直到播完/出错/被 stop 打断才 resolve
  function playBlob(blob: Blob, generation: number): Promise<void> {
    return new Promise((resolve) => {
      if (generation !== generationRef.current) {
        resolve();
        return;
      }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (playResolveRef.current === finish) playResolveRef.current = null;
        if (audioRef.current === audio) audioRef.current = null;
        URL.revokeObjectURL(url);
        setIsSpeaking(false);
        resolve();
      };
      playResolveRef.current = finish;
      audio.onended = finish;
      audio.onerror = finish;
      setIsPreparing(false);
      setIsSpeaking(true);
      audio.play().catch((err) => {
        // 浏览器拦截自动播放：停止本轮，文字与手动「重播」仍然可用
        console.warn('语音播放失败:', err?.message || err);
        stop();
        finish();
      });
    });
  }

  async function pump(): Promise<void> {
    if (pumpingRef.current) return;
    pumpingRef.current = true;
    const generation = generationRef.current;
    try {
      while (generation === generationRef.current) {
        // 维持最多 PREFETCH_DEPTH 个在途合成，当前句播放时下一句已经在合成
        while (queueRef.current.length && inflightRef.current.length < PREFETCH_DEPTH) {
          const item = queueRef.current.shift()!;
          inflightRef.current.push({ promise: synthesize(item.text, generation), text: item.text });
        }
        if (!inflightRef.current.length) break;
        setIsPreparing(true);
        const item = inflightRef.current.shift()!;
        const blob = await item.promise;
        if (generation !== generationRef.current) break;
        // 只显示当前句：新一句开始时直接替换，上一句自动消失；合成失败也照常推进文字
        setCurrentSpeechText(item.text);
        if (blob) await playBlob(blob, generation);
      }
    } finally {
      pumpingRef.current = false;
      // stop 后立刻又开始了新一轮时，旧 pump 退出后必须接力，否则新队列永远不出声
      if (queueRef.current.length || inflightRef.current.length) {
        void pump();
      } else if (generation === generationRef.current) {
        setIsPreparing(false);
      }
    }
  }

  function pushText(raw: string): void {
    const clean = markdownToSpeechText(raw);
    if (!clean) return;
    queueRef.current.push({ text: clean });
    void pump();
  }

  function startStream(): void {
    beginSession();
    setIsRevealing(true);
  }

  function pushStream(fullText: string): void {
    if (!abortRef.current) return;
    const pending = (fullText || '').slice(consumedRef.current);
    if (!pending) return;
    const { sentences, rest } = takeCompleteSentences(pending);
    consumedRef.current = (fullText || '').length - rest.length;
    for (const sentence of sentences) pushText(sentence);
  }

  function endStream(fullText: string): void {
    if (!abortRef.current) return;
    const pending = (fullText || '').slice(consumedRef.current);
    consumedRef.current = (fullText || '').length;
    if (pending.trim()) {
      for (const chunk of splitSpeechText(pending)) pushText(chunk);
    }
    // 推动一次 pump，保证没有尾巴时也能正常收尾
    void pump();
  }

  function speak(messageText: string): void {
    beginSession();
    setIsRevealing(true);
    const chunks = splitSpeechText(markdownToSpeechText(messageText || ''));
    if (!chunks.length) {
      setIsRevealing(false);
      return;
    }
    queueRef.current.push(...chunks.map((chunk) => ({ text: chunk })));
    void pump();
  }

  // 卸载时释放音频与在途请求；refs 稳定，闭包捕获首轮的 stop 仍能正确清理
  useEffect(() => {
    return () => {
      generationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      audioRef.current?.pause();
      playResolveRef.current?.();
    };
  }, []);

  return {
    isSpeaking,
    isPreparing,
    currentSpeechText,
    isRevealing,
    startStream,
    pushStream,
    endStream,
    speak,
    stop,
  };
}
