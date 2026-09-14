import pino from 'pino';
import { APP_VERSION, IS_PROD, IS_TEST } from '../config.js';

export const logger = pino({
  level: IS_TEST ? 'silent' : (process.env.LOG_LEVEL || (IS_PROD ? 'info' : 'debug')),
  base: { service: 'remix-api', version: APP_VERSION },
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.body.password',
      'req.body.currentPassword',
      'req.body.newPassword',
      'req.body.code',
      'req.body.recoveryCode',
      'req.body.apiKey',
      'req.body.fileData',
    ],
    censor: '[REDACTED]',
  },
});