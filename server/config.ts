import dotenv from 'dotenv';
import path from 'path';

// 本地开发加载 .env.local / .env（生产由容器环境变量注入，文件不存在时静默跳过）
dotenv.config({ path: ['.env.local', '.env'] });

export const IS_PROD = process.env.NODE_ENV === 'production';
export const PORT = Number(process.env.PORT) || 3000;

// 运行数据根目录（数据库/上传素材/备份），容器部署时挂载持久卷
export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');

// JWT 签名密钥：任何环境都必须显式提供，否则拒绝启动（fail-fast）。
// 不设开发默认值：旧回落密钥随源码公开在仓库中，一旦裸机部署漏配 NODE_ENV
// 会静默启用它，攻击者可据此自签管理员 token
export const JWT_SECRET = (() => {
  const secret = (process.env.JWT_SECRET || '').trim();
  if (secret.length < 16) {
    console.error('FATAL: 必须设置 JWT_SECRET 环境变量（≥16 字符，openssl rand -hex 32 生成）');
    process.exit(1);
  }
  return secret;
})();

// 管理员种子账号（首次启动创建，见 Task 10）
export const ADMIN_PHONE = (process.env.ADMIN_PHONE || '').trim();
export const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').trim();

// 反向代理（Caddy）部署时置 1，使 express-rate-limit 以 X-Forwarded-For 计 IP；
// 直连部署严禁开启，否则客户端可伪造头绕过限流
export const TRUST_PROXY = process.env.TRUST_PROXY === '1';
