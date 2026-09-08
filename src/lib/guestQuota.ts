import { UserProfile } from '../types';
import { GUEST_USER } from '../data/initialData';

// 游客额度按日计算：匿名态在服务端无用户记录，用 localStorage 以自然日为周期持久化当日已用次数。
// 日期格式与服务端 getTodayString 保持一致（本地时区 YYYY-MM-DD）。
const GUEST_QUOTA_KEY = 'guest_quota_daily';

function todayString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 读取游客初始状态：携带今日已用次数（跨天自动归零）
export function loadGuestUser(): UserProfile {
  try {
    const raw = localStorage.getItem(GUEST_QUOTA_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.date === todayString() && typeof parsed.count === 'number') {
        return { ...GUEST_USER, guestUsedCount: parsed.count };
      }
    }
  } catch {
    // 数据损坏时忽略，按 0 处理
  }
  return GUEST_USER;
}

// 记录游客当日已用次数
export function rememberGuestCount(count: number): void {
  try {
    localStorage.setItem(GUEST_QUOTA_KEY, JSON.stringify({ date: todayString(), count }));
  } catch {
    // 存储不可用时静默降级为内存计数
  }
}
