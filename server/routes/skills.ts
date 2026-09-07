import { Express, Response } from 'express';
import { db } from '../../src/db.js';
import { AuthRequest } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import { generateRecommendedQuestionsFromLLM } from '../services/llm/questions.js';
import { cleanBookTitle } from '../../src/types.js';

// generate-questions 共享处理体：canWrite 控制 skillId 推荐问题是否允许落库（防未授权篡改书籍数据）
async function invokeGenerateQuestions(req: AuthRequest, res: Response, canWrite: boolean): Promise<void> {
  const { systemPrompt, title, author, skillId } = req.body || {};
  if (!systemPrompt || typeof systemPrompt !== 'string' || !systemPrompt.trim()) {
    res.status(400).json({ error: '缺少有效的 Skill 原著文档内容 (systemPrompt)' });
    return;
  }

  try {
    const questions = await generateRecommendedQuestionsFromLLM({
      systemPrompt,
      title,
      author,
    });

    // If skillId provided, also update DB skill（仅具备写权限时生效）
    if (skillId && typeof skillId === 'string' && canWrite) {
      const skill = db.getSkillById(skillId);
      if (skill) {
        skill.sampleQuestions = questions;
        db.saveSkill(skill);
      }
    }

    res.json({ success: true, questions });
  } catch (err: any) {
    console.error('Error in /api/skills/generate-questions:', err);
    res.status(500).json({ error: err.message || '提炼推荐追问失败' });
  }
}

export function registerSkillsRoutes(app: Express): void {
  // 4. Skills & Distilled Books Market APIs
  app.get('/api/skills', (req, res) => {
    const { search, category } = req.query;
    let skills = db.getSkills();

    if (search && typeof search === 'string') {
      const q = search.toLowerCase().trim();
      const cleanQ = cleanBookTitle(q).toLowerCase();
      skills = skills.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          (cleanQ && s.title.toLowerCase().includes(cleanQ)) ||
          (cleanQ && cleanBookTitle(s.title).toLowerCase().includes(cleanQ)) ||
          (s.author && s.author.toLowerCase().includes(q)) ||
          (cleanQ && s.author && s.author.toLowerCase().includes(cleanQ))
      );
    }

    if (category && typeof category === 'string' && category !== '全部') {
      skills = skills.filter((s) => s.category === category);
    }

    res.json({ skills });
  });

  app.get('/api/skills/:id', (req, res) => {
    const skill = db.getSkillById(req.params.id);
    if (!skill) {
      return res.status(404).json({ error: 'Skill not found' });
    }
    res.json({ skill });
  });

  app.post('/api/skills/:id/click', (req, res) => {
    const skill = db.getSkillById(req.params.id);
    if (!skill) {
      return res.status(404).json({ error: 'Skill not found' });
    }
    skill.searchCount = (skill.searchCount || 0) + 1;
    db.saveSkill(skill);
    res.json({ success: true, skill });
  });

  // 公开路径：限流由 Task 13 挂载；skillId 落库仅管理员生效（防未授权篡改书籍数据）
  app.post('/api/skills/generate-questions', async (req: AuthRequest, res) => {
    const canWrite = req.user?.role === 'admin' || !!req.user?.isAdmin;
    await invokeGenerateQuestions(req, res, canWrite);
  });

  // 管理路径：requireAdmin 保护，允许落库
  app.post('/api/admin/skills/generate-questions', requireAdmin, async (req: AuthRequest, res) => {
    await invokeGenerateQuestions(req, res, true);
  });

  app.get('/api/tags', (req, res) => {
    const tags = db.getTags();
    res.json({ tags });
  });
}
