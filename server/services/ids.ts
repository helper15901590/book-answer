import crypto from 'crypto';
import { db } from '../db.js';

// 生成 10 位短用户 ID：固定前缀 usr_ + 6 位随机小写字母数字（36^6 ≈ 21 亿组合，内测规模下碰撞概率可忽略）
const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newUserId(): string {
  for (let attempt = 0; attempt < 10; attempt++) {
    let suffix = '';
    for (let i = 0; i < 6; i++) {
      suffix += ID_CHARS[crypto.randomInt(ID_CHARS.length)];
    }
    const id = 'usr_' + suffix;
    if (!db.getUserById(id)) return id;
  }
  // 理论上不可达：连续 10 次碰撞说明系统状态异常，宁可失败也不产生超长 ID
  throw new Error('用户 ID 生成冲突，请重试');
}
