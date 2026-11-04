import { Express } from 'express';
import { db } from '../db.js';
import { ADMIN_PASSWORD_MIN_LENGTH, USER_PASSWORD_MIN_LENGTH } from '../services/password.js';
import { isTTSConfigured } from '../services/tts.js';

export function registerConfigRoutes(app: Express): void {
  app.get('/api/config/public', (_req, res) => {
    const config = db.getLLMConfig();
    res.json({
      llmConfig: {
        timeoutSec: config.timeoutSec,
        dailyLimits: config.dailyLimits,
        membershipPlans: config.membershipPlans,
        agreements: config.agreements,
        // 只下发「语音模式是否可用」这一个布尔值，Key/模型/音色永远不进公开配置
        voiceModeEnabled: isTTSConfigured(),
      },
      authPolicy: {
        userMinLength: USER_PASSWORD_MIN_LENGTH,
        adminMinLength: ADMIN_PASSWORD_MIN_LENGTH,
        // 自助注册始终开放（产品决策 2026-11-02）；保留字段便于将来加后台开关
        registrationEnabled: true,
      },
    });
  });
}