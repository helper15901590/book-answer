import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { generateSync } from 'otplib';
import fs from 'node:fs';

let app: any;
let db: any;
let createApp: any;

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
    expect(login.body.mfaSetupRequired).toBe(true);

    const setup = await admin.post('/api/admin/mfa/setup').set('Origin', 'http://127.0.0.1:3000').send({}).expect(200);
    expect(setup.body.recoveryCodes).toHaveLength(8);
    const code = generateSync({ secret: setup.body.secret });
    const confirm = await admin.post('/api/admin/mfa/confirm').set('Origin', 'http://127.0.0.1:3000').send({ code }).expect(200);
    expect(confirm.body.user.role).toBe('admin');
    const adminCsrf = cookieValue(confirm, 'remix_admin_csrf');
    expect(adminCsrf).not.toBe('');    const llmView = await admin.get('/api/admin/llm-config').set('Origin', 'http://127.0.0.1:3000').expect(200);
    expect(llmView.body.llmConfig).not.toHaveProperty('apiKey');

    const created = await admin.post('/api/admin/users/create').set('Origin', 'http://127.0.0.1:3000').set('X-CSRF-Token', adminCsrf).send({ phone: '13900000000', membershipTier: 'free_member' }).expect(200);
    expect(created.body.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    expect(created.body.user.id).toMatch(/^usr_/);

    const user = request.agent(app);
    const firstLogin = await user.post('/api/auth/login').set('Origin', 'http://127.0.0.1:3000').send({ phone: '13900000000', password: created.body.temporaryPassword }).expect(200);
    expect(firstLogin.body.passwordChangeRequired).toBe(true);

    const changed = await user.post('/api/auth/change-password').set('Origin', 'http://127.0.0.1:3000').send({ currentPassword: created.body.temporaryPassword, newPassword: 'UserStrongPass123' }).expect(200);
    expect(changed.body.user.mustChangePassword).toBe(false);
    await user.get('/api/auth/me').expect(200);
    await user.get('/api/chat/sessions').expect(200);
  });

  it('requires a second factor for existing admin MFA', async () => {
    const admin = request.agent(app);
    const login = await admin.post('/api/admin/login').set('Origin', 'http://127.0.0.1:3000').send({ phone: '13800000000', password: 'AdminPass12345678!' }).expect(200);
    expect(login.body.mfaRequired).toBe(true);
  });
});