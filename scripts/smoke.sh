#!/usr/bin/env bash
set -uo pipefail
BASE="${BASE_URL:-http://127.0.0.1:3000}"
PASS=0; FAIL=0
JAR="$(mktemp)"; trap 'rm -f "$JAR"' EXIT
check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  OK $1"; else FAIL=$((FAIL+1)); echo "  FAIL $1 expected=$2 actual=$3"; fi; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
csrf() { awk -F '\t' '$6=="remix_admin_csrf" {print $7}' "$JAR" | tail -1; }
echo "== smoke $BASE =="
check "health 200" "200" "$(code "$BASE/api/health")"
check "public skills no systemPrompt" "0" "$(curl -s "$BASE/api/skills" | grep -c systemPrompt)"
check "public skills no bookContent" "0" "$(curl -s "$BASE/api/skills" | grep -c bookContent)"
check "unauthenticated sessions 401" "401" "$(code "$BASE/api/chat/sessions")"
check "forged userId still 401" "401" "$(code "$BASE/api/chat/sessions?userId=usr_forged")"
check "public questions endpoint removed" "404" "$(code -X POST "$BASE/api/skills/generate-questions" -H 'Content-Type: application/json' -d '{}')"
check "admin entry reachable" "1" "$(code -L "$BASE/leonchan1590" | grep -Ec '^(200|302)$')"
check "unknown API 404" "404" "$(code "$BASE/api/nonexistent")"
if [ -n "${ADMIN_PHONE:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ] && [ -n "${ADMIN_TOTP_CODE:-}" ]; then
  LOGIN=$(curl -s -c "$JAR" -b "$JAR" -X POST "$BASE/api/admin/login" -H "Origin: $BASE" -H 'Content-Type: application/json' -d "{\"phone\":\"$ADMIN_PHONE\",\"password\":\"$ADMIN_PASSWORD\"}")
  check "admin password step" "1" "$(echo "$LOGIN" | grep -c 'mfaRequired')"
  VERIFY=$(curl -s -c "$JAR" -b "$JAR" -X POST "$BASE/api/admin/mfa/verify" -H "Origin: $BASE" -H 'Content-Type: application/json' -d "{\"code\":\"$ADMIN_TOTP_CODE\"}")
  check "admin MFA" "1" "$(echo "$VERIFY" | grep -c '\"role\":\"admin\"')"
  CSRF=$(csrf)
  NEW_PHONE="199$(date +%s | tail -c 9)"
  CREATE=$(curl -s -b "$JAR" -X POST "$BASE/api/admin/users/create" -H "Origin: $BASE" -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' -d "{\"phone\":\"$NEW_PHONE\",\"membershipTier\":\"free_member\"}")
  UID=$(echo "$CREATE" | sed -n 's/.*\"id\":\"\([^\"]*\)\".*/\1/p')
  TEMP=$(echo "$CREATE" | sed -n 's/.*\"temporaryPassword\":\"\([^\"]*\)\".*/\1/p')
  check "admin creates user" "1" "$(echo "$CREATE" | grep -c '\"success\":true')"
  check "temporary password generated" "1" "$([ -n "$TEMP" ] && echo 1 || echo 0)"
  if [ -n "$UID" ]; then
    curl -s -b "$JAR" -X DELETE "$BASE/api/admin/users/$UID" -H "Origin: $BASE" -H "X-CSRF-Token: $CSRF" >/dev/null
    check "test user cleaned" "0" "$(curl -s -b "$JAR" "$BASE/api/admin/users" | grep -c "$UID")"
  fi
else
  echo "  SKIP admin MFA chain"
fi
echo "== result: $PASS passed / $FAIL failed =="
[ "$FAIL" -eq 0 ]