import { Express, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../db.js';
import { AuthRequest, requireAdmin } from '../middleware/auth.js';
import { generateRecommendedQuestionsFromLLM } from '../services/llm/questions.js';
import { PublicSkill, Skill, cleanBookTitle } from '../../src/types.js';

const questionsLimiter = rateLimit({ windowMs: 60_000, limit: 10, message: { error: '请求过于频繁，请稍后再试' } });

export function toPublicSkill(skill: Skill): PublicSkill {
  return {
    id: skill.id,
    title: skill.title,
    author: skill.author,
    category: skill.category,
    coverUrl: skill.coverUrl,
    description: skill.description,
    tags: skill.tags || [],
    chatCount: skill.chatCount,
    searchCount: skill.searchCount,
    hotScore: skill.hotScore,
    sampleQuestions: skill.sampleQuestions,
    skillType: skill.skillType,
  };
}

async function generateQuestions(req: AuthRequest, res: Response): Promise<void> {
  const { systemPrompt, title, author, skillId } = req.body || {};
  if (!systemPrompt || typeof systemPrompt !== 'string' || !systemPrompt.trim()) {
    res.status(400).json({ error: '缺少有效的 Skill 原著文档内容' });
    return;
  }
  try {
    const questions = await generateRecommendedQuestionsFromLLM({ systemPrompt, title, author });
    if (skillId && typeof skillId === 'string') {
      const skill = db.getSkillById(skillId);
      // 空结果必须跳过写回：上游超时、超限或输出解析失败时本函数返回 []，
      // 直接落库会把管理员既有的推荐追问清空，而前端只显示「提炼失败」，无从察觉原内容已丢失。
      if (skill && questions.length > 0) {
        skill.sampleQuestions = questions;
        db.saveSkill(skill);
      }
    }
    res.json({ success: true, questions });
  } catch (err: any) {
    console.error('生成推荐问题失败:', err);
    res.status(500).json({ error: '提炼推荐追问失败' });
  }
}

export function registerSkillsRoutes(app: Express): void {
  app.get('/api/skills', (req, res) => {
    const { search, category, type } = req.query;
    let skills = db.getSkills();
    if (type && typeof type === 'string' && (type === 'book' || type === 'mentor')) {
      skills = skills.filter((skill) => (skill.skillType || 'book') === type);
    }
    if (search && typeof search === 'string') {
      const query = cleanBookTitle(search.toLowerCase().trim());
      skills = skills.filter((skill) =>
        skill.title.toLowerCase().includes(query) ||
        cleanBookTitle(skill.title).toLowerCase().includes(query) ||
        skill.author?.toLowerCase().includes(query)
      );
    }
    if (category && typeof category === 'string' && category !== '全部') {
      skills = skills.filter((skill) => skill.category === category);
    }
    res.json({ skills: skills.map(toPublicSkill) });
  });

  app.get('/api/skills/:id', (req, res) => {
    const skill = db.getSkillById(req.params.id);
    if (!skill) return res.status(404).json({ error: 'Skill not found' });
    res.json({ skill: toPublicSkill(skill) });
  });

  app.post('/api/skills/:id/click', (req, res) => {
    const skill = db.getSkillById(req.params.id);
    if (!skill) return res.status(404).json({ error: 'Skill not found' });
    db.incrementSkillSearchCount(skill.id);
    res.json({ success: true, skill: { ...toPublicSkill(skill), searchCount: (skill.searchCount || 0) + 1 } });
  });

  app.post('/api/admin/skills/generate-questions', requireAdmin, questionsLimiter, async (req: AuthRequest, res: Response) => {
    await generateQuestions(req, res);
  });

  app.get('/api/tags', (_req, res) => res.json({ tags: db.getTags() }));
}