#!/usr/bin/env bash
set -uo pipefail
BASE="${BASE_URL:-${BASE:-http://127.0.0.1:3000}}"
# 把「请求发往哪里」（BASE）与「Origin 头写什么」（ORIGIN）分开，是为了支持在服务器本机自测：
# 阿里云等云主机的公网 IP 走 NAT 映射，实例从内部访问自己的公网 IP 会超时（无 hairpin NAT），
# 而 CSRF 校验只比对 Origin 头，因此可以「连 127.0.0.1、带公网 Origin」，与从外部访问等价。
ORIGIN="${ORIGIN:-$BASE}"
# 兼容旧写法：早期文档用的是 ADMIN_CODE，若只传它则当作管理员密码
ADMIN_PASSWORD="${ADMIN_PASSWORD:-${ADMIN_CODE:-}}"
PASS=0; FAIL=0
JAR="$(mktemp)"; trap 'rm -f "$JAR"' EXIT
check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  OK $1"; else FAIL=$((FAIL+1)); echo "  FAIL $1 expected=$2 actual=$3"; fi; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
csrf() { awk -F '\t' '$6=="book_answer_admin_csrf" {print $7}' "$JAR" | tail -1; }
echo "== smoke $BASE (Origin: $ORIGIN) =="
check "health 200" "200" "$(code "$BASE/api/health")"
check "public skills no systemPrompt" "0" "$(curl -s "$BASE/api/skills" | grep -c systemPrompt)"
check "unauthenticated sessions 401" "401" "$(code "$BASE/api/chat/sessions")"
check "forged userId still 401" "401" "$(code "$BASE/api/chat/sessions?userId=usr_forged")"
check "public questions endpoint removed" "404" "$(code -X POST "$BASE/api/skills/generate-questions" -H 'Content-Type: application/json' -d '{}')"
check "admin entry reachable" "1" "$(code -L "$BASE/leonchan1590" | grep -Ec '^(200|302)$')"
check "unknown API 404" "404" "$(code "$BASE/api/nonexistent")"
if [ -n "${ADMIN_PHONE:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
  LOGIN=$(curl -s -c "$JAR" -b "$JAR" -X POST "$BASE/api/admin/login" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d "{\"phone\":\"$ADMIN_PHONE\",\"password\":\"$ADMIN_PASSWORD\",\"secondPassword\":\"${ADMIN_SECOND_PASSWORD:-}\"}")
  if echo "$LOGIN" | grep -q 'mfaRequired\|mfaSetupRequired'; then
    if [ -z "${ADMIN_TOTP_CODE:-}" ]; then
      echo "  SKIP admin chain（服务端启用了动态验证码，需提供 ADMIN_TOTP_CODE）"
    else
      VERIFY=$(curl -s -c "$JAR" -b "$JAR" -X POST "$BASE/api/admin/mfa/verify" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d "{\"code\":\"$ADMIN_TOTP_CODE\"}")
      check "admin MFA login" "1" "$(echo "$VERIFY" | grep -c '\"role\":\"admin\"')"
    fi
  else
    check "admin login" "1" "$(echo "$LOGIN" | grep -c '\"role\":\"admin\"')"
  fi
  CSRF=$(csrf)
  if [ -z "$CSRF" ]; then
    echo "  SKIP admin chain（登录未成功，未取得 CSRF 令牌）"
  else
    check "admin stats wrapped in stats key" "1" "$(curl -s -b "$JAR" "$BASE/api/admin/stats" | grep -c '\"stats\":')"
    NEW_PHONE="199$(date +%s | tail -c 9)"
    CREATE=$(curl -s -b "$JAR" -X POST "$BASE/api/admin/users/create" -H "Origin: $ORIGIN" -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' -d "{\"phone\":\"$NEW_PHONE\",\"membershipTier\":\"free_member\"}")
    NEW_USER_ID=$(echo "$CREATE" | sed -n 's/.*\"id\":\"\([^\"]*\)\".*/\1/p')
    TEMP=$(echo "$CREATE" | sed -n 's/.*\"temporaryPassword\":\"\([^\"]*\)\".*/\1/p')
    check "admin creates user" "1" "$(echo "$CREATE" | grep -c '\"success\":true')"
    check "temporary password generated" "1" "$([ -n "$TEMP" ] && echo 1 || echo 0)"
    if [ -n "$NEW_USER_ID" ]; then
      curl -s -b "$JAR" -X DELETE "$BASE/api/admin/users/$NEW_USER_ID" -H "Origin: $ORIGIN" -H "X-CSRF-Token: $CSRF" >/dev/null
      check "test user cleaned" "0" "$(curl -s -b "$JAR" "$BASE/api/admin/users" | grep -c "$NEW_USER_ID")"
    fi
  fi
else
  echo "  SKIP admin chain（未提供 ADMIN_PHONE / ADMIN_PASSWORD）"
fi
echo "== result: $PASS passed / $FAIL failed =="
[ "$FAIL" -eq 0 ]