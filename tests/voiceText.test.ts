import { describe, expect, it } from 'vitest';
import { markdownToSpeechText, splitSpeechText, takeCompleteSentences } from '../src/lib/voiceText';

describe('voiceText', () => {
  it('strips markdown markers before speaking', () => {
    const md = '## 标题\n\n**重点**：请阅读[原典](https://example.com)。\n\n```js\nconsole.log(1)\n```\n- 第一项\n- 第二项';
    const text = markdownToSpeechText(md);
    expect(text).not.toContain('##');
    expect(text).not.toContain('**');
    expect(text).not.toContain('```');
    expect(text).not.toContain('https://');
    expect(text).toContain('原典');
    expect(text).toContain('重点');
  });

  it('only emits complete sentences while streaming', () => {
    const first = takeCompleteSentences('你好，我是导师。今天想聊');
    expect(first.sentences).toEqual(['你好，我是导师。']);
    expect(first.rest).toBe('今天想聊');

    const second = takeCompleteSentences(`${first.rest}什么？`);
    expect(second.sentences).toEqual(['今天想聊什么？']);
    expect(second.rest).toBe('');
  });

  it('keeps an incomplete tail in rest', () => {
    const result = takeCompleteSentences('这段话还没有结束');
    expect(result.sentences).toEqual([]);
    expect(result.rest).toBe('这段话还没有结束');
  });

  it('hard-splits overlong text without punctuation', () => {
    const chunks = splitSpeechText('啊'.repeat(400), 100);
    expect(chunks).toHaveLength(4);
    expect(chunks.every((chunk) => chunk.length <= 100)).toBe(true);
  });

  it('splits whole replies and flushes the trailing fragment', () => {
    expect(splitSpeechText('第一句。第二句！最后没有标点')).toEqual(['第一句。第二句！', '最后没有标点']);
  });

  it('treats an English period as a boundary only with trailing whitespace', () => {
    // 3.14 这类小数点不切；"hello. " 后切
    expect(takeCompleteSentences('圆周率是3.14左右').sentences).toEqual([]);
    expect(takeCompleteSentences('Hello world. Next sentence').sentences).toEqual(['Hello world.']);
  });

  it('removes stray markdown markers left by streaming sentence splits', () => {
    // 流式分句可能落在 ** 中间，成对规则失效后必须把孤立标记也剔除
    expect(markdownToSpeechText('这是**重')).toBe('这是重');
    expect(markdownToSpeechText('重点`内容~结尾')).toBe('重点内容结尾');
  });
});
