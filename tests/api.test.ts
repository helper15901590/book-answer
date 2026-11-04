import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import { createServer } from 'node:http';

let app: any;
let db: any;
let MAX_TAGS = 0;
let createApp: any;
let adminAgent: any;
let adminCsrf = '';
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

  // 自助注册：手机号 + 密码即可，成功即自动登录；重复号/管理员号/弱密码都要给出可翻译的错误码。
  it('supports self-service registration with automatic sign-in', async () => {
    const agent = request.agent(app);
    const registered = await agent.post('/api/auth/register')
      .set('Origin', 'http://127.0.0.1:3000')
      .send({ phone: '13900000099', password: 'UserPass123' })
      .expect(200);
    expect(registered.body.user.phone).toBe('13900000099');
    expect(registered.body.user.nickname).toBe('0099');
    expect(registered.body.user.membershipTier).toBe('free_member');
    expect(registered.body.user.password).toBeUndefined();
    expect(db.getUserByPhone('13900000099')).toBeTruthy();

    // 注册即登录：会话与 CSRF Cookie 已种下，可直接访问登录后接口
    expect(cookieValue(registered, 'book_answer_user_csrf')).not.toBe('');
    await agent.get('/api/auth/me').expect(200);
    await agent.get('/api/chat/sessions').expect(200);

    // 公开配置声明注册开放
    const publicConfig = await request(app).get('/api/config/public').expect(200);
    expect(publicConfig.body.authPolicy.registrationEnabled).toBe(true);

    // 同一手机号不可重复注册
    const duplicate = await request(app).post('/api/auth/register')
      .set('Origin', 'http://127.0.0.1:3000')
      .send({ phone: '13900000099', password: 'UserPass123' })
      .expect(400);
    expect(duplicate.body.error).toBe('PHONE_EXISTS');

    // 管理员手机号不落用户表
    const adminPhone = await request(app).post('/api/auth/register')
      .set('Origin', 'http://127.0.0.1:3000')
      .send({ phone: '13800000000', password: 'UserPass123' })
      .expect(400);
    expect(adminPhone.body.error).toBe('PHONE_EXISTS');

    // 密码策略：至少 6 位
    const weak = await request(app).post('/api/auth/register')
      .set('Origin', 'http://127.0.0.1:3000')
      .send({ phone: '13900000098', password: '12345' })
      .expect(400);
    expect(weak.body.error).toBe('INVALID_PASSWORD');
  });

  it('supports admin login, user provisioning, forced password change and session isolation', async () => {
    const admin = request.agent(app);
    const login = await admin.post('/api/admin/login').set('Origin', 'http://127.0.0.1:3000').send({ phone: '13800000000', password: 'AdminPass12345678!' }).expect(200);
    adminAgent = admin;
    // 管理员登录只校验账号 + 密码；MFA / 二次口令链路已移除
    expect(login.body.user.role).toBe('admin');
    adminCsrf = cookieValue(login, 'book_answer_admin_csrf');
    adminSessionMaxAge = cookieMaxAge(login, 'book_answer_admin_session');
    adminCsrfMaxAge = cookieMaxAge(login, 'book_answer_admin_csrf');
    expect(adminCsrf).not.toBe('');
    await request(app).post('/api/admin/mfa/verify').set('Origin', 'http://127.0.0.1:3000').send({}).expect(404);

    const llmView = await admin.get('/api/admin/llm-config').set('Origin', 'http://127.0.0.1:3000').expect(200);
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

  it('streams an authenticated chat through a mock LLM', async () => {
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
      const csrf = cookieValue(login, 'book_answer_admin_csrf');
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

  // 清空对话列表：只删除当前用户的全部会话，不能波及其他用户。
  it('clears all chat sessions of the current user only', async () => {
    await request(app).delete('/api/chat/sessions').expect(401);

    const before = await userAgent.get('/api/chat/sessions').expect(200);
    expect(before.body.sessions.length).toBeGreaterThan(0);

    // 另一个用户（自助注册用例创建）的会话作为隔离性对照组
    const otherUser = db.getUserByPhone('13900000099');
    expect(otherUser).toBeTruthy();
    db.saveChatSession({
      id: 'session-other-user-clear-test',
      userId: otherUser.id,
      skillId: 'skill-santi',
      skillTitle: '三体',
      skillAuthor: '刘慈欣',
      skillCoverUrl: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    });

    try {
      const cleared = await userAgent.delete('/api/chat/sessions')
        .set('Origin', 'http://127.0.0.1:3000')
        .set('X-CSRF-Token', userCsrf)
        .expect(200);
      expect(cleared.body.success).toBe(true);
      expect(cleared.body.deleted).toBeGreaterThan(0);

      const after = await userAgent.get('/api/chat/sessions').expect(200);
      expect(after.body.sessions).toEqual([]);
      expect(db.getChatSessions(otherUser.id).map((session: any) => session.id)).toContain('session-other-user-clear-test');
    } finally {
      db.deleteChatSession('session-other-user-clear-test', otherUser.id);
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

    // 注销前先关注一个技能：账号删除后关注关系必须一并清除（不能留下孤儿行）
    await agent.post('/api/follows').set('Origin', 'http://127.0.0.1:3000').set('X-CSRF-Token', csrf).send({ skillId: 'skill-santi' }).expect(200);
    expect(db.getUserFollows(created.body.user.id)).toHaveLength(1);

    // 未登录不能注销
    await request(app).post('/api/auth/delete-account').set('Origin', 'http://127.0.0.1:3000').send({ confirm: '我确认注销' }).expect(401);

    // 短语不匹配必须拒绝，且账号不能被误删
    const wrong = await agent.post('/api/auth/delete-account').set('Origin', 'http://127.0.0.1:3000').set('X-CSRF-Token', csrf).send({ confirm: '我确认' }).expect(400);
    expect(wrong.body.error).toBe('CONFIRMATION_MISMATCH');
    expect(db.getUserById(created.body.user.id)).toBeTruthy();

    // 三种语言的短语都接受，且忽略大小写（服务端与前端共用同一份定义）
    await agent.post('/api/auth/delete-account').set('Origin', 'http://127.0.0.1:3000').set('X-CSRF-Token', csrf).send({ confirm: 'Delete My Account' }).expect(200);

    // 删号后账号不存在、原会话失效、关注关系一并清除
    expect(db.getUserById(created.body.user.id)).toBeFalsy();
    expect(db.getUserFollows(created.body.user.id)).toHaveLength(0);
    await agent.get('/api/auth/me').expect(401);
  });

  // 两种拒绝曾经共用 CSRF_REJECTED：前端按错误码查表翻译，于是「APP_ORIGIN 配错」这类运维
  // 问题在界面上和「浏览器令牌不对」显示同一句话，排查只能靠猜。这两条分支此前零覆盖，
  // 钉住错误码才能防止将来又被合并回去。
  it('distinguishes a mismatched request origin from a bad CSRF token', async () => {
    // 来源不符：令牌完全正确也必须拒，且错误码要与令牌不符区分开
    const wrongOrigin = await userAgent.post('/api/chat/sessions')
      .set('Origin', 'http://wrong-origin.example')
      .set('X-CSRF-Token', userCsrf)
      .send({ skillId: 'skill-santi' })
      .expect(403);
    expect(wrongOrigin.body.error).toBe('ORIGIN_REJECTED');

    // 令牌不符：来源正确，但请求头没带令牌（服务端要求请求头与 Cookie 两侧都匹配）
    const noToken = await userAgent.post('/api/chat/sessions')
      .set('Origin', 'http://127.0.0.1:3000')
      .send({ skillId: 'skill-santi' })
      .expect(403);
    expect(noToken.body.error).toBe('CSRF_REJECTED');

    // 同一个请求带上正确令牌必须放行：否则上面两条 403 可能另有原因，断言就白写了
    await userAgent.post('/api/chat/sessions')
      .set('Origin', 'http://127.0.0.1:3000')
      .set('X-CSRF-Token', userCsrf)
      .send({ skillId: 'skill-santi' })
      .expect(200);
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

  it('requires login for follow endpoints', async () => {
    await request(app).get('/api/follows').expect(401);
    await request(app).post('/api/follows').set('Origin', 'http://127.0.0.1:3000').send({ skillId: 'skill-santi' }).expect(401);
    await request(app).delete('/api/follows/skill-santi').set('Origin', 'http://127.0.0.1:3000').expect(401);
  });

  it('persists follows per user, keeps them idempotent and exposes them to admin only', async () => {
    const follow = await userAgent.post('/api/follows')
      .set('Origin', 'http://127.0.0.1:3000')
      .set('X-CSRF-Token', userCsrf)
      .send({ skillId: 'skill-santi' })
      .expect(200);
    expect(follow.body.success).toBe(true);

    const list = await userAgent.get('/api/follows').expect(200);
    const followedIds = list.body.follows.map((skill: any) => skill.id);
    expect(followedIds).toContain('skill-santi');
    // 公开 DTO 约束同样适用于关注列表
    expect(list.body.follows[0]).not.toHaveProperty('systemPrompt');
    expect(typeof list.body.follows[0].followedAt).toBe('string');

    // 重复关注必须幂等，不产生重复行
    await userAgent.post('/api/follows')
      .set('Origin', 'http://127.0.0.1:3000')
      .set('X-CSRF-Token', userCsrf)
      .send({ skillId: 'skill-santi' })
      .expect(200);
    const listAgain = await userAgent.get('/api/follows').expect(200);
    expect(listAgain.body.follows.filter((skill: any) => skill.id === 'skill-santi')).toHaveLength(1);

    // 关注不存在的技能必须 404，且返回错误码供前端翻译
    const missing = await userAgent.post('/api/follows')
      .set('Origin', 'http://127.0.0.1:3000')
      .set('X-CSRF-Token', userCsrf)
      .send({ skillId: 'skill-not-exist' })
      .expect(404);
    expect(missing.body.error).toBe('SKILL_NOT_FOUND');

    // 后台可以查看该用户的关注列表与关注数
    const me = await userAgent.get('/api/auth/me').expect(200);
    const adminView = await adminAgent.get(`/api/admin/users/${me.body.user.id}/follows`).expect(200);
    expect(adminView.body.follows.map((skill: any) => skill.id)).toContain('skill-santi');
    const users = await adminAgent.get('/api/admin/users').expect(200);
    const meRow = users.body.users.find((row: any) => row.id === me.body.user.id);
    expect(meRow.followCount).toBeGreaterThanOrEqual(1);

    // 普通用户不能访问后台关注接口
    await userAgent.get(`/api/admin/users/${me.body.user.id}/follows`).expect(403);

    // 取消关注后列表不再包含该技能；重复取消同样幂等
    await userAgent.delete('/api/follows/skill-santi')
      .set('Origin', 'http://127.0.0.1:3000')
      .set('X-CSRF-Token', userCsrf)
      .expect(200);
    await userAgent.delete('/api/follows/skill-santi')
      .set('Origin', 'http://127.0.0.1:3000')
      .set('X-CSRF-Token', userCsrf)
      .expect(200);
    const afterUnfollow = await userAgent.get('/api/follows').expect(200);
    expect(afterUnfollow.body.follows.map((skill: any) => skill.id)).not.toContain('skill-santi');
  });

  it('supports the reliable skill type and cascades follows when a skill is deleted', async () => {
    const created = await adminAgent.post('/api/admin/skills')
      .set('Origin', 'http://127.0.0.1:3000')
      .set('X-CSRF-Token', adminCsrf)
      .send({
        skill: {
          title: '可靠测试内容',
          author: '测试作者',
          description: '用于验证可靠广场类型',
          category: '',
          tags: [],
          systemPrompt: '这是用于集成测试的可靠内容提示词。',
          skillType: 'reliable',
        },
      })
      .expect(200);
    const skillId = created.body.skill.id;
    expect(created.body.skill.skillType).toBe('reliable');

    const reliableList = await request(app).get('/api/skills?type=reliable').expect(200);
    expect(reliableList.body.skills.map((skill: any) => skill.id)).toContain(skillId);
    const bookList = await request(app).get('/api/skills?type=book').expect(200);
    expect(bookList.body.skills.map((skill: any) => skill.id)).not.toContain(skillId);

    // 关注该技能后由管理员删除：关注关系应随技能一起清理
    await userAgent.post('/api/follows')
      .set('Origin', 'http://127.0.0.1:3000')
      .set('X-CSRF-Token', userCsrf)
      .send({ skillId })
      .expect(200);
    const beforeDelete = await userAgent.get('/api/follows').expect(200);
    expect(beforeDelete.body.follows.map((skill: any) => skill.id)).toContain(skillId);

    await adminAgent.delete(`/api/admin/skills/${skillId}`)
      .set('Origin', 'http://127.0.0.1:3000')
      .set('X-CSRF-Token', adminCsrf)
      .expect(200);
    const afterDelete = await userAgent.get('/api/follows').expect(200);
    expect(afterDelete.body.follows.map((skill: any) => skill.id)).not.toContain(skillId);
    await request(app).get(`/api/skills/${skillId}`).expect(404);
  });

  // 语音合成链路：配置加密存储、错误码、mock DashScope 上游返回音频 URL 后再下载音频。
  // 上游两跳都用 fetch，因此一个本地 mock 服务即可同时扮演「合成接口」与「音频文件服务」。
  it('configures DashScope TTS, keeps the key secret and synthesizes audio', async () => {
    const audioBytes = Buffer.from('ID3-mock-tts-audio');
    const mock = createServer((req, res) => {
      if (req.url === '/audio.mp3') {
        res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
        res.end(audioBytes);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ output: { audio: { url: `http://127.0.0.1:${(mock.address() as any).port}/audio.mp3` } } }));
    });
    await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', () => resolve()));
    const port = (mock.address() as any).port;

    try {
      // 未配置：登录用户得到 TTS_NOT_CONFIGURED；匿名请求在 CSRF 中间件放行后由 requireUser 拦下
      const notConfigured = await userAgent.post('/api/tts/synthesize')
        .set('Origin', 'http://127.0.0.1:3000')
        .set('X-CSRF-Token', userCsrf)
        .send({ text: '你好' })
        .expect(503);
      expect(notConfigured.body.error).toBe('TTS_NOT_CONFIGURED');
      await request(app).post('/api/tts/synthesize')
        .set('Origin', 'http://127.0.0.1:3000')
        .send({ text: '你好' })
        .expect(401);

      // Key 加密落库：响应与后台读取都不得出现明文
      const saved = await adminAgent.post('/api/admin/tts-config')
        .set('Origin', 'http://127.0.0.1:3000')
        .set('X-CSRF-Token', adminCsrf)
        .send({
          apiKeyMode: 'replace',
          apiKey: 'sk-tts-test-1234567890',
          ttsConfig: {
            enabled: true,
            apiBaseUrl: `http://127.0.0.1:${port}/speech`,
            model: 'cosyvoice-v3-flash',
            voice: 'longlaobo_v3',
          },
        })
        .expect(200);
      expect(saved.body.ttsConfig.apiKeyConfigured).toBe(true);
      expect(JSON.stringify(saved.body)).not.toContain('sk-tts-test-1234567890');

      const adminView = await adminAgent.get('/api/admin/tts-config').set('Origin', 'http://127.0.0.1:3000').expect(200);
      expect(adminView.body.ttsConfig).not.toHaveProperty('apiKey');
      expect(JSON.stringify(adminView.body)).not.toContain('sk-tts-test-1234567890');

      // 公开配置只暴露布尔开关，绝不带 Key
      const publicConfig = await request(app).get('/api/config/public').expect(200);
      expect(publicConfig.body.llmConfig.voiceModeEnabled).toBe(true);
      expect(JSON.stringify(publicConfig.body)).not.toContain('sk-tts-test-1234567890');

      // 合成成功：Markdown 由服务端清洗后发给上游，返回的音频字节原样转给前端
      const synth = await userAgent.post('/api/tts/synthesize')
        .set('Origin', 'http://127.0.0.1:3000')
        .set('X-CSRF-Token', userCsrf)
        .send({ text: '## 你好\n\n**很高兴**与你对话。' })
        .expect(200);
      expect(synth.headers['content-type']).toContain('audio/mpeg');
      expect(Buffer.from(synth.body).equals(audioBytes)).toBe(true);

      // 纯空白文本清洗后为空，必须拒绝而不是向上游发空请求
      const empty = await userAgent.post('/api/tts/synthesize')
        .set('Origin', 'http://127.0.0.1:3000')
        .set('X-CSRF-Token', userCsrf)
        .send({ text: '   ' })
        .expect(400);
      expect(empty.body.error).toBe('INVALID_REQUEST');
    } finally {
      await new Promise<void>((resolve) => mock.close(() => resolve()));
    }
  });
});
