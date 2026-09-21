import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { generateSync } from 'otplib';
import fs from 'node:fs';
import { createServer } from 'node:http';

let app: any;
let db: any;
let MAX_TAGS = 0;
let createApp: any;
let adminAgent: any;
let adminCsrf = '';
let adminTotpSecret = '';
// 管理员两个 Cookie 的 Max-Age，在用例三建立管理员会话时采集。
// 不另开一次登录来取：管理员鉴权端点是 10 次/分钟的限流，而整个测试文件共享同一个 IP。
let adminSessionMaxAge = 0;
let adminCsrfMaxAge = 0;
let userAgent: any;
let userCsrf = '';
const userPassword = 'UserStrongPass123';

// 取出响应里指定名字的 Set-Cookie 原始头，找不到返回空串。
function setCookieHeader(response: request.Response, name: string): string {
  const header = response.headers['set-cookie'];
  const values = Array.isArray(header) ? header : header ? [header] : [];
  return values.find((value: string) => value.startsWith(`${name}=`)) || '';
}

function cookieValue(response: request.Response, name: string): string {
  return setCookieHeader(response, name).split(';')[0].slice(name.length + 1);
}

// 取某个 Cookie 的 Max-Age；会话级 Cookie（不带 Max-Age）返回 0。
function cookieMaxAge(response: request.Response, name: string): number {
  const match = setCookieHeader(response, name).match(/Max-Age=(\d+)/);
  return match ? Number(match[1]) : 0;
}

beforeAll(async () => {
  fs.rmSync('./.test-runtime', { recursive: true, force: true });
  ({ db, MAX_TAGS } = await import('../server/db.js'));
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
    adminCsrf = cookieValue(confirm, 'book_answer_admin_csrf');
    adminSessionMaxAge = cookieMaxAge(confirm, 'book_answer_admin_session');
    adminCsrfMaxAge = cookieMaxAge(confirm, 'book_answer_admin_csrf');
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
    userCsrf = cookieValue(changed, 'book_answer_user_csrf');
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
      const csrf = cookieValue(verify, 'book_answer_admin_csrf');
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
      // SSE 错误帧回传的是错误码，由前端按当前界面语言翻译后再展示（见 src/i18n/serverMessage.ts）
      expect(failedStream.text).toContain('AI_UNAVAILABLE');
      const me = await userAgent.get('/api/auth/me').expect(200);
      expect(me.body.user.dailyUsedCount).toBe(1);
    } finally {
      await new Promise<void>((resolve) => mock.close(() => resolve()));
    }
  });

  it('aligns CSRF cookie lifetime with the session and supports self-service account deletion', async () => {
    const created = await adminAgent.post('/api/admin/users/create').set('Origin', 'http://127.0.0.1:3000').set('X-CSRF-Token', adminCsrf).send({ phone: '13900000002', membershipTier: 'free_member' }).expect(200);

    const agent = request.agent(app);
    await agent.post('/api/auth/login').set('Origin', 'http://127.0.0.1:3000').send({ phone: '13900000002', password: created.body.temporaryPassword }).expect(200);
    const changed = await agent.post('/api/auth/change-password').set('Origin', 'http://127.0.0.1:3000').send({ currentPassword: created.body.temporaryPassword, newPassword: userPassword }).expect(200);

    // CSRF Cookie 必须与会话 Cookie 同寿命。此前它是会话级、而会话 Cookie 是持久级：
    // 浏览器完整退出后 CSRF Cookie 消失、会话仍在，而登出请求同样受 CSRF 保护，
    // 于是必定 403，用户从界面上再也退不出来。
    const sessionMaxAge = cookieMaxAge(changed, 'book_answer_user_session');
    const csrfMaxAge = cookieMaxAge(changed, 'book_answer_user_csrf');
    expect(csrfMaxAge).toBe(sessionMaxAge);
    expect(csrfMaxAge).toBeGreaterThan(0);

    // 管理员端走的是同一个 setCsrfCookie，也断言一次：否则将来只改回一边也不会有测试报错。
    // 数据取自用例三建立管理员会话时的响应，不在这里重新登录一次。
    expect(adminCsrfMaxAge).toBe(adminSessionMaxAge);
    expect(adminCsrfMaxAge).toBeGreaterThan(0);

    const csrf = cookieValue(changed, 'book_answer_user_csrf');

    // 未登录不能注销
    await request(app).post('/api/auth/delete-account').set('Origin', 'http://127.0.0.1:3000').send({ confirm: '我确认注销' }).expect(401);

    // 短语不匹配必须拒绝，且账号不能被误删
    const wrong = await agent.post('/api/auth/delete-account').set('Origin', 'http://127.0.0.1:3000').set('X-CSRF-Token', csrf).send({ confirm: '我确认' }).expect(400);
    expect(wrong.body.error).toBe('CONFIRMATION_MISMATCH');
    expect(db.getUserById(created.body.user.id)).toBeTruthy();

    // 三种语言的短语都接受，且忽略大小写（服务端与前端共用同一份定义）
    await agent.post('/api/auth/delete-account').set('Origin', 'http://127.0.0.1:3000').set('X-CSRF-Token', csrf).send({ confirm: 'Delete My Account' }).expect(200);

    // 删号后账号不存在、原会话失效
    expect(db.getUserById(created.body.user.id)).toBeFalsy();
    await agent.get('/api/auth/me').expect(401);
  });

  it('refuses to empty the tag list and cascades tag renames to skills', async () => {
    const before: string[] = db.getTags();
    expect(before.length).toBeGreaterThan(0);
    // 断言必须落在库中真实行上：getSkills() 在 skills 表为空时会回落到种子数据，
    // 用它做循环会一圈不转地通过，等于什么都没验证。
    const persisted = () => db.getPersistedSkills();
    expect(persisted().length).toBeGreaterThan(0);

    const target = before[0];
    const renamed = `${target}-已改名`;
    const renamedTags = before.map((tag) => (tag === target ? renamed : tag));

    try {
      // 超出上限必须显式拒绝：此前是静默截断，被丢掉的标签下所有书籍会被回落到第一个分类，
      // 而调用方只看到 success。
      const tooMany = await adminAgent.post('/api/admin/tags')
        .set('Origin', 'http://127.0.0.1:3000')
        .set('X-CSRF-Token', adminCsrf)
        .send({ tags: Array.from({ length: MAX_TAGS + 1 }, (_, i) => `标签${i}`) })
        .expect(400);
      expect(tooMany.body.error).toBe('TOO_MANY_TAGS');
      expect(db.getTags()).toEqual(before);

      // 标签是全平台的分类主键。提交空数组此前会被接受，并把每个技能的 category 写成空串，
      // 前台随即多出一个没有名字的分类——必须拒绝，且不能留下任何改动。
      const rejected = await adminAgent.post('/api/admin/tags')
        .set('Origin', 'http://127.0.0.1:3000')
        .set('X-CSRF-Token', adminCsrf)
        .send({ tags: [], deletedTags: before })
        .expect(400);
      expect(rejected.body.error).toBe('EMPTY_TAGS');
      expect(db.getTags()).toEqual(before);
      for (const skill of persisted()) {
        expect(skill.category).not.toBe('');
      }
      // 被拒的破坏性写入也要留档，否则反复试探清空分类在 audit_logs 里毫无痕迹。
      // 服务端没有对外暴露读审计表的接口，这里直连同一个库文件确认落盘结果。
      const auditDb = new Database('./.test-runtime/commercial.sqlite', { readonly: true });
      const rejectedAudit = auditDb.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'tags_update_rejected'").get() as { count: number };
      auditDb.close();
      expect(rejectedAudit.count).toBeGreaterThan(0);

      // 正常改名：提交的 tags 里已是新名字（前端就是这么构造的），renamedMap 用于级联改写技能
      const updated = await adminAgent.post('/api/admin/tags')
        .set('Origin', 'http://127.0.0.1:3000')
        .set('X-CSRF-Token', adminCsrf)
        .send({ tags: renamedTags, renamedMap: { [target]: renamed } })
        .expect(200);
      expect(updated.body.tags).toContain(renamed);
      expect(db.getTags()).toEqual(renamedTags);
      for (const skill of persisted()) {
        expect(skill.category).not.toBe(target);
      }
    } finally {
      // 中途任何一步断言失败都要还原：改名留在库里会污染同一运行目录下的后续运行。
      // 还原本身幂等——改名映射找不到目标标签时不会改动任何数据。
      if (adminCsrf) {
        await adminAgent.post('/api/admin/tags')
          .set('Origin', 'http://127.0.0.1:3000')
          .set('X-CSRF-Token', adminCsrf)
          .send({ tags: before, renamedMap: { [renamed]: target } });
      }
    }
    expect(db.getTags()).toEqual(before);
  });
});
