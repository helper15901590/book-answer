// 全局并发指标（供 /api/health 与 /api/admin/stats 使用）
export const metrics = {
  activeSseConnections: 0,
  totalRequestsServed: 0,
  requestsLastMinute: 0,
  peakConcurrentSse: 0,
  totalAiTokensEstimated: 0,
  startTime: Date.now(),
};

setInterval(() => {
  metrics.requestsLastMinute = 0;
}, 60000);
