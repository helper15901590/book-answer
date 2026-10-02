import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// 子路径部署：BASE_PATH 挂载后，前缀内的路由照常工作、前缀外不再可达。
// config.ts 在模块加载期求值 BASE_PATH，必须先 stub 环境变量再动态 import，
// 否则拿到的是 vitest.config 注入的根路径值（''）。
let app: any;
let db: any;

beforeAll(async () => {
  vi.stubEnv('BASE_PATH', '/bookanswer');
  vi.resetModules();
  ({ db } = await import('../server/db.js'));
  const { createApp } = await import('../server/app.js');
  app = await createApp();
});

afterAll(() => {
  db?.close();
  vi.unstubAllEnvs();
});

describe('BASE_PATH 子路径挂载', () => {
  it('前缀内的健康检查可达', async () => {
    const response = await request(app).get('/bookanswer/api/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('前缀外的旧根路径不再可达', async () => {
    await request(app).get('/api/health').expect(404);
  });

  it('CSRF 豁免端点在前缀下仍豁免来源校验', async () => {
    // 故意带不匹配的 Origin：豁免生效时来源校验被整体跳过，请求到达业务层（密码错误，非 403）；
    // 豁免表若没跟上前缀（baseUrl 含前缀而字面量没有），会被 ORIGIN_REJECTED 拦成 403——
    // 这正是子路径化漏改该表时的典型症状。
    const response = await request(app)
      .post('/bookanswer/api/auth/login')
      .set('Origin', 'http://evil.example')
      .send({ phone: '13800000000', password: 'totally-wrong' });
    expect(response.status).not.toBe(403);
  });
});
