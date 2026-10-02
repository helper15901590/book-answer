process.env.NODE_ENV ||= 'test';
process.env.APP_ENCRYPTION_KEY ||= 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=';
process.env.APP_ORIGIN ||= 'http://localhost:3000';
process.env.DATA_DIR ||= './.config-check-runtime';

const fs = (await import('node:fs')).default;
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
const { APP_ORIGIN, IS_PROD, DATA_DIR } = await import('../server/config.js');
const { db } = await import('../server/db.js');
if (!db.ping()) throw new Error('数据库健康检查失败');
console.log(JSON.stringify({ ok: true, mode: IS_PROD ? 'production' : 'development/test', appOrigin: APP_ORIGIN, dataDir: DATA_DIR }, null, 2));
db.close();
fs.rmSync(DATA_DIR, { recursive: true, force: true });