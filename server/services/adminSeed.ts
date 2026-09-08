import { db } from '../db.js';
import { ADMIN_PHONE, ADMIN_PASSWORD } from '../config.js';

// 管理员账号不入库：后台登录（/api/admin/login）直接比对环境变量凭证，身份由 JWT 合成。
// 启动时仅做两件事：校验凭证可用性、清理库中历史管理员行（旧版本曾种子入库）。
export function ensureAdminSeed(): void {
  if (!ADMIN_PHONE || !/^\d{6}$/.test(ADMIN_PASSWORD)) {
    console.warn('⚠️ 管理员凭证未配置或 ADMIN_PASSWORD 不是6位数字，管理后台将无法登录（.env: ADMIN_PHONE/ADMIN_PASSWORD）');
  }
  const removed = db.removeAdminUsers();
  if (removed > 0) {
    console.log(`✅ 已清理库中历史管理员账号 ${removed} 个（管理员身份不再入库）`);
  }
}
