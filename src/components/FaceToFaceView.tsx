import React, { useEffect, useRef, useState } from 'react';
import { ChatMessage, ChatSession } from '../types';
import { useI18n } from '../i18n';
import { MarkdownMessage } from './MarkdownMessage';
import facePortraitUrl from '../assets/face-portrait.png';
import './FaceToFaceView.css';

interface FaceToFaceViewProps {
  session: ChatSession | null;
  inputText: string;
  onInputChange: (text: string) => void;
  onSend: (overrideText?: string) => void;
  isGenerating: boolean;
  generatingHere: boolean;
  currentStreamingText: string;
  speaking: boolean;
  currentSpeechText: string;
  isRevealing: boolean;
  onReplay: (text: string) => void;
  onExit: () => void;
  onNotify: (message: string, type?: 'info' | 'warning' | 'success') => void;
}

// 「面对面」全屏界面（沉浸版）：底图四边渐隐铺满屏幕，左上返回、右上全屏，
// 音波下方只展示最新一轮对话；回复文字随语音逐句出现。
export const FaceToFaceView: React.FC<FaceToFaceViewProps> = ({
  session,
  inputText,
  onInputChange,
  onSend,
  isGenerating,
  generatingHere,
  currentStreamingText,
  speaking,
  currentSpeechText,
  isRevealing,
  onReplay,
  onExit,
  onNotify,
}) => {
  const { t } = useI18n();
  const [isFullscreen, setIsFullscreen] = useState<boolean>(Boolean(document.fullscreenElement));
  const messagesRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);

  const messages = (session?.messages || []).filter((message) => message.role !== 'system');
  const streaming = isGenerating && generatingHere;
  const lastAssistantMessage = [...messages].reverse().find((message) => message.role === 'assistant');
  const lastAssistantId = lastAssistantMessage?.id;

  // 面对面只展示 AI 回复，不回显用户提问；流式生成期间由下方 streaming 区块展示回复。
  const visibleMessages: ChatMessage[] = [];
  if (!streaming && lastAssistantMessage) {
    visibleMessages.push(lastAssistantMessage);
  }

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // 新消息与流式文字到达时滚动到底部
  useEffect(() => {
    const container = messagesRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages.length, currentStreamingText, generatingHere]);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      onNotify(t('workspace.faceFullscreenFailed'), 'warning');
    }
  };

  const exitToLetter = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      // 退出全屏失败不影响返回
    }
    onExit();
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!isGenerating && inputText.trim()) onSend();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (event.nativeEvent.isComposing || composingRef.current || event.keyCode === 229) return;
    event.preventDefault();
    if (!isGenerating && inputText.trim()) onSend();
  };

  return (
    <div className="face-overlay">
      <main className="face-stage" aria-label={t('workspace.voiceChatMode')}>
        <img className="face-portrait" src={facePortraitUrl} alt="" draggable={false} />
        <div className="face-shade" aria-hidden="true" />

        <header className="face-topbar">
          <button
            type="button"
            className="face-back-button"
            onClick={exitToLetter}
            aria-label={t('login.back')}
            title={t('login.back')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M19 12H5M11 18l-6-6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            className="face-fullscreen-button"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? t('workspace.faceExitFullscreen') : t('workspace.faceFullscreen')}
            title={isFullscreen ? t('workspace.faceExitFullscreen') : t('workspace.faceFullscreen')}
            aria-pressed={isFullscreen}
          >
            {isFullscreen ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5" />
              </svg>
            )}
            {/* 全屏时其余控件隐藏，只有这个按钮保留文字「退出全屏」，避免用户找不到退出口 */}
            {isFullscreen ? <span className="face-fullscreen-label">{t('workspace.faceExitFullscreen')}</span> : null}
          </button>
        </header>

        <section className="face-panel" aria-label={t('workspace.faceConversation')}>
          <div className={`face-sound-wave${speaking ? ' is-speaking' : ''}`} aria-hidden="true">
            {Array.from({ length: 23 }, (_, index) => (
              <span key={index} style={{ '--i': index } as React.CSSProperties} />
            ))}
          </div>

          <div className="face-messages" ref={messagesRef} role="log" aria-live="polite" aria-relevant="additions text">
            {visibleMessages.length === 0 && !streaming ? (
              <article className="face-welcome">
                <p className="face-hello">{t('workspace.faceWelcomeTitle')}</p>
                <p className="face-intro">{t('workspace.faceWelcomeBody')}</p>
              </article>
            ) : null}

            {visibleMessages.map((message) => {
              // 逐句朗读期间只展示当前正在读的一句（纯文本，避免流式分句把 ** 等标记切开后露出）；
              // 未在朗读时展示完整消息，交给 Markdown 渲染。
              const revealingLatest = message.id === lastAssistantId && isRevealing;
              const content = revealingLatest ? currentSpeechText : message.content;
              return (
                <article key={message.id} className="face-message face-message-assistant">
                  <div
                    className={isGenerating ? undefined : 'face-message-replay'}
                    onClick={isGenerating ? undefined : () => onReplay(message.content)}
                    title={isGenerating ? undefined : t('workspace.voiceReplay')}
                  >
                    {revealingLatest ? (
                      content ? (
                        <p className="face-speech-line">{content}</p>
                      ) : (
                        <p className="face-typing">{t('workspace.faceThinking')}</p>
                      )
                    ) : content ? (
                      <MarkdownMessage content={content} />
                    ) : (
                      <p className="face-typing">{t('workspace.faceThinking')}</p>
                    )}
                  </div>
                </article>
              );
            })}

            {streaming && (
              <article className="face-message face-message-assistant">
                {isRevealing ? (
                  currentSpeechText ? (
                    <p className="face-speech-line">{currentSpeechText}</p>
                  ) : (
                    <p className="face-typing">{t('workspace.faceThinking')}</p>
                  )
                ) : currentStreamingText ? (
                  <MarkdownMessage content={currentStreamingText} isStreaming />
                ) : (
                  <p className="face-typing">{t('workspace.faceThinking')}</p>
                )}
              </article>
            )}
          </div>

          <form className="face-composer-form" onSubmit={submit}>
            <div className="face-composer">
              <label className="face-composer-label" htmlFor="face-chat-input">
                {t('workspace.faceInputLabel')}
              </label>
              <textarea
                id="face-chat-input"
                value={inputText}
                rows={2}
                placeholder={isGenerating ? '' : t('workspace.faceInputPlaceholder')}
                onChange={(event) => onInputChange(event.target.value)}
                onKeyDown={handleKeyDown}
                onCompositionStart={() => {
                  composingRef.current = true;
                }}
                onCompositionEnd={() => {
                  composingRef.current = false;
                }}
              />
              <button
                type="submit"
                className="face-send"
                aria-label={t('workspace.faceSend')}
                disabled={!inputText.trim() || isGenerating}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 19V5M6 11l6-6 6 6" />
                </svg>
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
};
