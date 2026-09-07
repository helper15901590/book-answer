#!/usr/bin/env bash
# 每日热备份 SQLite（宿主机 crontab 调用，需 apt install sqlite3）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="${DATA_DIR:-$ROOT/data}"
KEEP_DAYS=14
mkdir -p "$DATA/backups"
sqlite3 "$DATA/commercial.sqlite" ".backup '$DATA/backups/db-$(date +%F).sqlite'"
find "$DATA/backups" -name 'db-*.sqlite' -mtime +"$KEEP_DAYS" -delete
echo "backup done: $DATA/backups/db-$(date +%F).sqlite"
