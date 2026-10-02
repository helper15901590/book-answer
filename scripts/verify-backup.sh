#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="${DATA_DIR:-$ROOT/data}"
ARCHIVE="${1:-$DATA/backups/latest.tar.gz}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
tar -xzf "$ARCHIVE" -C "$TMP"
sqlite3 "$TMP/commercial.sqlite" "PRAGMA integrity_check;" | grep -qx ok
sqlite3 "$TMP/commercial.sqlite" "SELECT 'users=' || count(*) FROM users;"
echo "backup verified: $ARCHIVE"