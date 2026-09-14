import { Express } from 'express';
import { db } from '../db.js';
import { ADMIN_PASSWORD_MIN_LENGTH, USER_PASSWORD_MIN_LENGTH } from '../services/password.js';

export function registerConfigRoutes(app: Express): void {
  app.get('/api/config/public', (_req, res) => {
    const config = db.getLLMConfig();
    res.json({
      llmConfig: {
        timeoutSec: config.timeoutSec,
        dailyLimits: config.dailyLimits,
        membershipPlans: config.membershipPlans,
        agreements: config.agreements,
      },
      authPolicy: {
        userMinLength: USER_PASSWORD_MIN_LENGTH,
        adminMinLength: ADMIN_PASSWORD_MIN_LENGTH,
        registrationEnabled: false,
      },
    });
  });
}