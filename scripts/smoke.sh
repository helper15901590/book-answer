#!/usr/bin/env bash
# 部署后冒烟验证：BASE_URL=http://IP:PORT ADMIN_PHONE=xxx ADMIN_CODE=xxx ./scripts/smoke.sh
set -uo pipefail
BASE="${BASE_URL:-${BASE:-http://localhost:3000}}"
PASS=0; FAIL=0
check() { # check <名称> <预期> <实际>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✅ $1"; else FAIL=$((FAIL+1)); echo "  ❌ $1 (预期 $2, 实际 $3)"; fi
}
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

echo "== 冒烟验证 $BASE =="
check "health 200" "200" "$(code "$BASE/api/health")"
check "public 配置不含 apiKey/apiBaseUrl" "0" "$(curl -s "$BASE/api/config/public" | grep -Ec 'apiKey|apiBaseUrl')"
check "public 配置含 dailyLimits" "1" "$(curl -s "$BASE/api/config/public" | grep -c dailyLimits | sed 's/^0$/0/;s/^[1-9][0-9]*$/1/')"
check "游客访问 admin/stats 被拒" "403" "$(code "$BASE/api/admin/stats")"
check "游客访问 admin/llm-config 被拒" "403" "$(code "$BASE/api/admin/llm-config")"
check "游客清空用户被拒" "403" "$(code -X POST "$BASE/api/admin/users/clear-all")"
check "注册端点已移除" "404" "$(code -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' -d '{}')"
check "simulate-pay 已移除" "404" "$(code -X POST "$BASE/api/payment/simulate-pay")"
check "webhook 已移除" "404" "$(code -X POST "$BASE/api/payment/webhook")"
check "create-membership-order 已移除" "404" "$(code -X POST "$BASE/api/payment/create-membership-order" -H 'Content-Type: application/json' -d '{}')"
check "未知手机号登录被拒" "404" "$(code -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"phone":"19999999999","code":"123456"}')"

# SSE 流式端点（未认证游客载荷，离线兜底也应输出 data: 帧）
# 限流注意：匿名聊天限流 10 次/分/IP，本脚本匿名聊天请求仅此 1 次（管理员聊天链路带 token 被限流跳过），1 分钟内重跑无需等待
SSE_SESS="smoke-sse-$(date +%s)"
SSE_OUT=$(curl -sN --max-time 30 -X POST "$BASE/api/chat/stream" -H 'Content-Type: application/json' \
  -d "{\"sessionId\":\"$SSE_SESS\",\"skillId\":\"skill-santi\",\"messageText\":\"你好\"}")
check "SSE 流式端点返回 data: 帧" "1" "$(echo "$SSE_OUT" | grep -c '^data:' | sed 's/^0$/0/;s/^[1-9][0-9]*$/1/')"

if [ -n "${ADMIN_PHONE:-}" ] && [ -n "${ADMIN_CODE:-}" ]; then
  TOKEN=$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d "{\"phone\":\"$ADMIN_PHONE\",\"code\":\"$ADMIN_CODE\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
  if [ -n "$TOKEN" ]; then
    check "管理员登录成功" "1" "1"
    check "管理员访问 stats" "200" "$(code -H "Authorization: Bearer $TOKEN" "$BASE/api/admin/stats")"
    check "登录响应不含 password" "0" "$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d "{\"phone\":\"$ADMIN_PHONE\",\"code\":\"$ADMIN_CODE\"}" | grep -c '"password"')"
    SESS="smoke-$(date +%s)"
    REPLY=$(curl -s -X POST "$BASE/api/chat/send" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -d "{\"sessionId\":\"$SESS\",\"skillId\":\"skill-santi\",\"messageText\":\"你好\"}")
    check "聊天链路可用（含离线兜底）" "1" "$(echo "$REPLY" | grep -c assistantMessage | sed 's/^0$/0/;s/^[1-9][0-9]*$/1/')"
    # 管理员建号 → 手动升级会员链路（spec §6.2）
    NEW_PHONE="199$(date +%s | tail -c 9)"
    CREATE=$(curl -s -X POST "$BASE/api/admin/users/create" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -d "{\"phone\":\"$NEW_PHONE\",\"password\":\"123456\"}")
    NEW_UID=$(echo "$CREATE" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
    check "管理员建号成功" "1" "$(echo "$CREATE" | grep -c '"success":true' | sed 's/^0$/0/;s/^[1-9][0-9]*$/1/')"
    UPGRADE=$(curl -s -X POST "$BASE/api/admin/users/upgrade-tier" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -d "{\"userId\":\"$NEW_UID\",\"tier\":\"monthly_member\"}")
    check "手动升级会员成功" "1" "$(echo "$UPGRADE" | grep -c '"success":true' | sed 's/^0$/0/;s/^[1-9][0-9]*$/1/')"
    check "升级后 tier 生效" "1" "$(echo "$UPGRADE" | grep -c monthly_member | sed 's/^0$/0/;s/^[1-9][0-9]*$/1/')"
  else
    check "管理员登录成功" "1" "0"
  fi
else
  echo "  ⚠️ 跳过管理员链路（未提供 ADMIN_PHONE/ADMIN_CODE）"
fi
check "首页 200" "200" "$(code "$BASE/")"
check "/admin 入口 200/302" "1" "$(code -L "$BASE/admin" | grep -Ec '^(200|302)$' | sed 's/^0$/0/;s/^[1-9].*/1/')"
check "未知 API 返回 404" "404" "$(code "$BASE/api/nonexistent")"
check "未知 API 404 为 JSON" "1" "$(curl -s "$BASE/api/nonexistent" | grep -c '"error"' | sed 's/^0$/0/;s/^[1-9][0-9]*$/1/')"

echo "== 结果: $PASS 通过 / $FAIL 失败 =="
[ "$FAIL" -eq 0 ]
