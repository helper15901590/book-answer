import { Express } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { AuthRequest, requireUser } from '../middleware/auth.js';
import { FollowedSkill } from '../../src/types.js';
import { toPublicSkill } from './skills.js';

const followSchema = z.object({ skillId: z.string().min(1).max(128) });

export function registerFollowRoutes(app: Express): void {
  app.get('/api/follows', requireUser, (req: AuthRequest, res) => {
    const follows: FollowedSkill[] = db.getUserFollows(req.user!.id).map(({ skill, followedAt }) => ({
      ...toPublicSkill(skill),
      followedAt,
    }));
    res.json({ follows });
  });

  // 关注是幂等操作：重复关注同一技能直接成功，不报错也不产生重复行。
  app.post('/api/follows', requireUser, (req: AuthRequest, res) => {
    const parsed = followSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_REQUEST', message: '请提供有效的技能标识' });
    const skill = db.getSkillById(parsed.data.skillId);
    if (!skill) return res.status(404).json({ error: 'SKILL_NOT_FOUND', message: '未找到该技能，可能已被下架' });
    db.followSkill(req.user!.id, skill.id);
    return res.json({ success: true });
  });

  // 取消关注同样幂等：目标不存在时也返回成功，前端无需区分「本来就没关注」。
  app.delete('/api/follows/:skillId', requireUser, (req: AuthRequest, res) => {
    db.unfollowSkill(req.user!.id, req.params.skillId);
    res.json({ success: true });
  });
}
