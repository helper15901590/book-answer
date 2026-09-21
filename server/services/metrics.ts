// 全局并发指标（供 /api/health 与 /api/admin/stats 使用）
export const metrics = {
  activeSseConnections: 0,
  totalRequestsServed: 0,
  requestsLastMinute: 0,
  peakConcurrentSse: 0,
  totalAiTokensEstimated: 0,
  // CSRF 拒绝按原因分开计数。两者成因完全不同（前者是 APP_ORIGIN 配错这类运维问题，
  // 后者是浏览器 Cookie 与会话对不上），合在一起就只能看出「有拒绝」，看不出该找谁修。
  csrfOriginRejected: 0,
  csrfTokenRejected: 0,
  startTime: Date.now(),
};

// 在线用户判定：进程内记录登录用户最近一次 API 活动时间，窗口内有活动即视为在线
const ONLINE_WINDOW_MS = 10 * 60 * 1000;
const userLastSeen = new Map<string, number>();

export function touchUser(userId: string) {
  userLastSeen.set(userId, Date.now());
}

export function onlineUsers(): number {
  const cutoff = Date.now() - ONLINE_WINDOW_MS;
  let count = 0;
  for (const seen of userLastSeen.values()) {
    if (seen >= cutoff) count++;
  }
  return count;
}

setInterval(() => {
  metrics.requestsLastMinute = 0;
  // 顺带清理过期打点，避免 Map 随用户量无界增长
  const cutoff = Date.now() - ONLINE_WINDOW_MS;
  for (const [userId, seen] of userLastSeen) {
    if (seen < cutoff) userLastSeen.delete(userId);
  }
}, 60000);
