import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { generateSync } from 'otplib';
import fs from 'node:fs';
import { createServer } from 'node:http';

let app: any;
let db: any;
let createApp: any;
let adminAgent: any;
let adminCsrf = '';
let adminTotpSecret = '';
let userAgent: any;
let userCsrf = '';
const userPassword = 'UserStrongPass123';

function cookieValue(response: request.Response, name: string): string {
  const header = response.headers['set-cookie'];
  const values = Array.isArray(header) ? header : header ? [header] : [];
  const item = values.find((value: string) => value.startsWith(`${name}=`));
  return item ? item.split(';')[0].slice(name.length + 1) : '';
}

beforeAll(async () => {
  fs.rmSync('./.test-runtime', { recursive: true, force: true });
  ({ db } = await import('../server/db.js'));
  db.clearAllUsers();
  ({ createApp } = await import('../server/app.js'));
  app = await createApp();
});

afterAll(() => {
  db?.close();
});

describe('commercial MVP API', () => {
  it('keeps public skill DTO free of internal content', async () => {
    const response = await request(app).get('/api/skills').expect(200);
    expect(response.body.skills.length).toBeGreaterThan(0);
    expect(response.body.skills[0]).not.toHaveProperty('systemPrompt');
    expect(response.body.skills[0]).not.toHaveProperty('bookContent');
  });

  it('requires login for chat sessions and ignores client user IDs', async () => {
    await request(app).get('/api/chat/sessions').expect(401);
    await request(app).get('/api/chat/sessions?userId=usr_0000000001').expect(401);
  });

  it('supports admin MFA, user provisioning, forced password change and session isolation', async () => {
    const admin = request.agent(app);
    const login = await admin.post('/api/admin/login').set('Origin', 'http://127.0.0.1:3000').send({ phone: '13800000000', password: 'AdminPass12345678!' }).expect(200);
    adminAgent = admin;
    expect(login.body.mfaSetupRequired).toBe(true);

    const setup = await admin.post('/api/admin/mfa/setup').set('Origin', 'http://127.0.0.1:3000').send({}).expect(200);
    expect(setup.body.recoveryCodes).toHaveLength(8);
    adminTotpSecret = setup.body.secret;
    const code = generateSync({ secret: setup.body.secret });
    const confirm = await admin.post('/api/admin/mfa/confirm').set('Origin', 'http://127.0.0.1:3000').send({ code }).expect(200);
    expect(confirm.body.user.role).toBe('admin');
    adminCsrf = cookieValue(confirm, 'remix_admin_csrf');
    expect(adminCsrf).not.toBe('');    const llmView = await admin.get('/api/admin/llm-config').set('Origin', 'http://127.0.0.1:3000').expect(200);
    expect(llmView.body.llmConfig).not.toHaveProperty('apiKey');

    const created = await admin.post('/api/admin/users/create').set('Origin', 'http://127.0.0.1:3000').set('X-CSRF-Token', adminCsrf).send({ phone: '13900000000', membershipTier: 'free_member' }).expect(200);
    expect(created.body.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    expect(created.body.user.id).toMatch(/^usr_/);

    const user = request.agent(app);
    userAgent = user;
    const firstLogin = await user.post('/api/auth/login').set('Origin', 'http://127.0.0.1:3000').send({ phone: '13900000000', password: created.body.temporaryPassword }).expect(200);
    expect(firstLogin.body.passwordChangeRequired).toBe(true);

    const changed = await user.post('/api/auth/change-password').set('Origin', 'http://127.0.0.1:3000').send({ currentPassword: created.body.temporaryPassword, newPassword: userPassword }).expect(200);
    userCsrf = cookieValue(changed, 'remix_user_csrf');
    expect(changed.body.user.mustChangePassword).toBe(false);
    await user.get('/api/auth/me').expect(200);
    await user.get('/api/chat/sessions').expect(200);
  });

  it('requires MFA and streams an authenticated chat through a mock LLM', async () => {
    let failNext = false;
    const mock = createServer((_req, res) => {
      if (failNext) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end('{"error":"mock failure"}');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"测试回复"}}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });
    await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', () => resolve()));
    const address = mock.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      const admin = request.agent(app);
      const login = await admin.post('/api/admin/login').set('Origin', 'http://127.0.0.1:3000').send({ phone: '13800000000', password: 'AdminPass12345678!' }).expect(200);
      expect(login.body.mfaRequired).toBe(true);
      const verify = await admin.post('/api/admin/mfa/verify').set('Origin', 'http://127.0.0.1:3000').send({ code: generateSync({ secret: adminTotpSecret }) }).expect(200);
      const csrf = cookieValue(verify, 'remix_admin_csrf');
      const llmResponse = await admin.post('/api/admin/llm-config').set('Origin', 'http://127.0.0.1:3000').set('X-CSRF-Token', csrf).send({
        apiKeyMode: 'replace',
        apiKey: 'sk-test-1234567890',
        llmConfig: { apiBaseUrl: `http://127.0.0.1:${port}/v1`, primaryModel: 'mock-model' },
      });
      expect(llmResponse.status, JSON.stringify(llmResponse.body)).toBe(200);

      const session = await userAgent.post('/api/chat/sessions').set('Origin', 'http://127.0.0.1:3000').set('X-CSRF-Token', userCsrf).send({ skillId: 'skill-santi' }).expect(200);
      const stream = await userAgent.post('/api/chat/stream').set('Origin', 'http://127.0.0.1:3000').set('X-CSRF-Token', userCsrf).send({ sessionId: session.body.session.id, skillId: 'skill-santi', messageText: '请给出一个观点' }).expect(200);
      expect(stream.text).toContain('测试回复');
      expect(stream.text).toContain('"done":true');

      failNext = true;
      const failedStream = await userAgent.post('/api/chat/stream').set('Origin', 'http://127.0.0.1:3000').set('X-CSRF-Token', userCsrf).send({ sessionId: session.body.session.id, skillId: 'skill-santi', messageText: '这次应当失败' }).expect(200);
      expect(failedStream.text).toContain('AI 服务暂时不可用');
      const me = await userAgent.get('/api/auth/me').expect(200);
      expect(me.body.user.dailyUsedCount).toBe(1);
    } finally {
      await new Promise<void>((resolve) => mock.close(() => resolve()));
    }
  });
});