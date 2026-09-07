import { Express } from 'express';
import { db } from '../../src/db.js';

// 公开配置端点：仅暴露前端启动所需的非敏感配置，绝不返回 apiKey / apiBaseUrl
export function registerConfigRoutes(app: Express): void {
  app.get('/api/config/public', (req, res) => {
    const c = db.getLLMConfig();
    res.json({
      llmConfig: {
        timeoutSec: c.timeoutSec,
        dailyLimits: c.dailyLimits,
        membershipPlans: c.membershipPlans,
        agreements: c.agreements,
      },
    });
  });
}
