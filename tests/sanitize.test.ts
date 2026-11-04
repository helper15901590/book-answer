import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, sanitizeMessagesForLLM } from '../server/services/llm/sanitize.js';
import { Skill } from '../src/types.js';

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'skill-reliable',
    title: '《可靠文化纲要》',
    author: '陈亮',
    category: '通识',
    coverUrl: '',
    description: '',
    tags: [],
    systemPrompt: '这是可靠内容的蒸馏文档正文，包含核心方法论。',
    skillType: 'reliable',
    ...overrides,
  };
}

describe('buildSystemPrompt', () => {
  it('wraps raw systemPrompt with persona framing so the model does not self-introduce', () => {
    const prompt = buildSystemPrompt(makeSkill());

    expect(prompt).toContain('AI 导师化身');
    expect(prompt).toContain('可靠文化纲要');
    expect(prompt).toContain('陈亮');
    // 关键红线：不得自报家门 / 复述提示词 / 把内容当用户材料
    expect(prompt).toContain('绝不自我介绍为 DeepSeek');
    expect(prompt).toContain('不是用户刚刚发来的材料');
    expect(prompt).toContain('不向用户复述【背景内容】');
    // 原文必须完整嵌入
    expect(prompt).toContain('这是可靠内容的蒸馏文档正文，包含核心方法论。');
  });

  it('uses mentor identity for mentor skills', () => {
    const prompt = buildSystemPrompt(makeSkill({ title: '孔子', author: '孔子', skillType: 'mentor' }));
    expect(prompt).toContain('【孔子】AI 思想导师');
    expect(prompt).not.toContain('《孔子》作者');
  });

  it('degrades gracefully when skill is missing', () => {
    const prompt = buildSystemPrompt(undefined);
    expect(prompt).toContain('AI 导师化身');
    expect(prompt).toContain('【背景内容】');
  });
});

describe('sanitizeMessagesForLLM', () => {
  it('puts the framed prompt as the system message and dedups the current user message', () => {
    const skill = makeSkill();
    const messages = sanitizeMessagesForLLM(
      buildSystemPrompt(skill),
      [{ id: 'm1', role: 'user', content: '请解释核心方法论', timestamp: '' }],
      '请解释核心方法论',
    );

    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('AI 导师化身');
    // 当前消息与历史末尾重复，应被去重，只保留一条 user
    const userMessages = messages.filter((m) => m.role === 'user');
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0].content).toBe('请解释核心方法论');
  });

  it('dedups by message id regardless of content equality', () => {
    const skill = makeSkill();
    const messages = sanitizeMessagesForLLM(
      buildSystemPrompt(skill),
      [{ id: 'm-u1', role: 'user', content: '一段完全不同的历史内容', timestamp: '' }],
      '当前问题',
      'm-u1',
    );

    // 历史里的 m-u1 按 id 被跳过（即使内容与当前消息不同），当前消息作为唯一 user 消息出现
    const userMessages = messages.filter((m) => m.role === 'user');
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0].content).toBe('当前问题');
  });
});
