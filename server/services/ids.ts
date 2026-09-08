import { db } from '../db.js';

// 生成顺序用户 ID：usr_ + 10 位零填充序号，按自然顺序递增分配（现存最大序号 + 1）
export function newUserId(): string {
  let serial = db.getMaxUserSerial();
  for (let attempt = 0; attempt < 100; attempt++) {
    serial += 1;
    const id = 'usr_' + String(serial).padStart(10, '0');
    if (!db.getUserById(id)) return id;
  }
  // 理论上不可达：宁可失败也不产生重复 ID
  throw new Error('用户 ID 生成冲突，请重试');
}
