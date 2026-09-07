import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db } from '../../src/db.js';
import { ADMIN_PHONE, ADMIN_PASSWORD } from '../config.js';

// 幂等确保存在管理员账号：优先环境变量，缺省生成随机 6 位数字密码并打印一次
export function ensureAdminSeed(): void {
  const admins = db.getUsers().filter((u) => u.role === 'admin' || u.isAdmin);
  if (admins.length > 0) return;

  const phone = ADMIN_PHONE || '13900000000';
  if (db.getUserByPhone(phone)) {
    console.warn(`⚠️ 手机号 ${phone} 已存在但非管理员，跳过管理员种子创建，请手动提权`);
    return;
  }

  // 前端 LoginModal 强校验 /^\d{6}$/，故种子密码必须为 6 位数字；否则回退随机生成
  let password: string;
  if (ADMIN_PASSWORD && /^\d{6}$/.test(ADMIN_PASSWORD)) {
    password = ADMIN_PASSWORD;
  } else {
    if (ADMIN_PASSWORD) {
      console.warn('⚠️ ADMIN_PASSWORD 密码须为6位数字，已回退随机生成');
    }
    password = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
  }

  db.saveUser({
    id: 'usr_' + crypto.randomUUID(),
    unionId: 'union_admin_' + crypto.randomUUID(),
    phone,
    password: bcrypt.hashSync(password, 10),
    nickname: '管理员',
    avatar: '',
    role: 'admin',
    membershipTier: 'yearly_member',
    isAdmin: true,
    dailyMaxChats: 9999,
    createdAt: new Date().toISOString(),
  } as any);

  console.log(`✅ 管理员种子账号已创建：手机号 ${phone} / 初始密码 ${password}（请立即登录后修改，本提示仅出现一次）`);
}
