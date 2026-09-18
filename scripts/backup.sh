#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="${DATA_DIR:-$ROOT/data}"
STAMP="$(date +%F_%H%M%S)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$DATA/backups"
sqlite3 "$DATA/commercial.sqlite" ".backup '$TMP/commercial.sqlite'"
sqlite3 "$TMP/commercial.sqlite" "PRAGMA integrity_check;" | grep -qx ok
if [ -d "$DATA/assets" ]; then cp -a "$DATA/assets" "$TMP/assets"; fi
tar -C "$TMP" -czf "$DATA/backups/book_answer-$STAMP.tar.gz" .
cp "$DATA/backups/book_answer-$STAMP.tar.gz" "$DATA/backups/latest.tar.gz"
find "$DATA/backups" -name 'book_answer-*.tar.gz' -mtime +7 -delete
if [ -n "${RESTIC_REPOSITORY:-}" ]; then
  restic backup "$TMP" --tag book_answer
  restic forget --keep-daily 30 --prune
fi
if [ -n "${HEALTHCHECK_PING_URL:-}" ]; then curl -fsS "$HEALTHCHECK_PING_URL" >/dev/null || true; fi
echo "backup done: $DATA/backups/book_answer-$STAMP.tar.gz"