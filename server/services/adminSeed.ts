import { ADMIN_PHONE, ADMIN_PASSWORD, IS_PROD } from '../config.js';
import { validateStrongPassword, ADMIN_PASSWORD_MIN_LENGTH } from './password.js';

export function ensureAdminSeed(): void {
  if (!ADMIN_PHONE || !ADMIN_PASSWORD) {
    windowlessAdminWarning();
    return;
  }
  const error = validateStrongPassword(ADMIN_PASSWORD, ADMIN_PASSWORD_MIN_LENGTH, ADMIN_PHONE);
  if (error) {
    if (IS_PROD) throw new Error(`ADMIN_PASSWORD 不符合安全策略：${error}`);
    console.warn(`⚠️ 管理员密码不符合安全策略：${error}`);
  }
}

function windowlessAdminWarning(): void {
  const message = '⚠️ 管理员凭证未配置，管理后台将无法登录';
  if (IS_PROD) throw new Error('生产环境缺少 ADMIN_PHONE 或 ADMIN_PASSWORD');
  console.warn(message);
}