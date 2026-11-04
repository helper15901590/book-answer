// 语音合成用的文本处理：把 Markdown 回复转成适合朗读的纯文本，并按句切分。
// 纯函数、零依赖，前端播放队列与服务端兜底清洗共用同一份规则。

// 句末标点（中英文）。英文句号单独处理，避免拆开 3.14、example.com 这类写法。
const SENTENCE_END_CHARS = '。！？!?；;…';
export const MAX_SPEECH_SEGMENT_LENGTH = 180;

// Markdown → 朗读文本：代码、图片不读，链接只读文字，去掉标题/引用/列表/强调/表格符号。
export function markdownToSpeechText(markdown: string): string {
  if (!markdown) return '';
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.、]\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    // 流式分句会在强调标记中间切断（如「这是**重点」），成对替换后仍会残留孤立标记，
    // 这些字符朗读出来也没有意义，统一剔除
    .replace(/[*`~]/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\|/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 找出窗口内最靠后的可切分位置（句末标点/换行之后），返回切分点下标；找不到返回 0。
// allowTrailingDot=true 时，结尾处的英文句号也算句末（整段最终切分时使用）。
function findBoundaryEnd(text: string, allowTrailingDot: boolean): number {
  let boundary = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (SENTENCE_END_CHARS.includes(ch) || ch === '\n') {
      boundary = i + 1;
    } else if (ch === '.' && (i + 1 < text.length ? /\s/.test(text[i + 1]) : allowTrailingDot)) {
      boundary = i + 1;
    }
  }
  return boundary;
}

// 从流式缓冲区中切出已完整的句子块，返回切好的句子与仍需等待后续文本的尾巴。
// 单块超过 maxLength 且没有标点时硬切，保证长句也能尽快出声。
export function takeCompleteSentences(
  buffer: string,
  maxLength: number = MAX_SPEECH_SEGMENT_LENGTH
): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let cursor = 0;
  while (buffer.length - cursor > maxLength) {
    const window = buffer.slice(cursor, cursor + maxLength);
    const boundary = findBoundaryEnd(window, false);
    const cut = boundary > 0 ? boundary : maxLength;
    sentences.push(buffer.slice(cursor, cursor + cut));
    cursor += cut;
  }
  const remainder = buffer.slice(cursor);
  const boundary = findBoundaryEnd(remainder, false);
  if (boundary > 0) {
    sentences.push(remainder.slice(0, boundary));
    return { sentences, rest: remainder.slice(boundary) };
  }
  return { sentences, rest: remainder };
}

// 整段文本切分（重播历史回复时使用）：反复取完整句，最后把剩余无标点尾巴也作为一段。
export function splitSpeechText(text: string, maxLength: number = MAX_SPEECH_SEGMENT_LENGTH): string[] {
  const result: string[] = [];
  let remainder = (text || '').trim();
  while (remainder) {
    const { sentences, rest } = takeCompleteSentences(remainder, maxLength);
    if (!sentences.length) {
      result.push(rest);
      break;
    }
    result.push(...sentences);
    remainder = rest.trim();
  }
  return result.map((sentence) => sentence.trim()).filter(Boolean);
}
