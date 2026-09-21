#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="${DATA_DIR:-$ROOT/data}"
ARCHIVE="${1:-}"
if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ]; then echo "usage: $0 <backup.tar.gz>"; exit 1; fi
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
tar -xzf "$ARCHIVE" -C "$TMP"
sqlite3 "$TMP/commercial.sqlite" "PRAGMA integrity_check;" | grep -qx ok
cp "$DATA/commercial.sqlite" "$DATA/commercial.sqlite.before-restore" 2>/dev/null || true
cp "$TMP/commercial.sqlite" "$DATA/commercial.sqlite"
rm -f "$DATA/commercial.sqlite-wal" "$DATA/commercial.sqlite-shm"
if [ -d "$TMP/assets" ]; then rm -rf "$DATA/assets"; cp -a "$TMP/assets" "$DATA/assets"; fi
# 恢复后归还属主：容器以 uid 1000 运行，若以 root 执行本脚本会把文件变成 root 所有，
# 容器内随即报 readonly database，登录与建号全部失败
chown -R 1000:1000 "$DATA" 2>/dev/null || true
echo "restore complete: $DATA/commercial.sqlite"