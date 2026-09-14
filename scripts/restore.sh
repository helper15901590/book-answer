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
echo "restore complete: $DATA/commercial.sqlite"