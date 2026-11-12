#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"

if [ -f "$BACKEND_DIR/.env" ]; then
  set -a
  . "$BACKEND_DIR/.env"
  set +a
fi

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-healthcare_inventory}"
DB_USER="${DB_USER:-postgres}"
BACKUP_DIR="${BACKUP_DIR:-$BACKEND_DIR/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$BACKUP_DIR/${DB_NAME}-${TIMESTAMP}.dump"

if [ -n "${ohhDATABASE_URL:-}" ]; then
  pg_dump --no-owner --no-privileges --format=custom --file="$TARGET" "$DATABASE_URL"
else
  PGPASSWORD="${DB_PASSWORD:-}" pg_dump \
    --host="$DB_HOST" \
    --port="$DB_PORT" \
    --username="$DB_USER" \
    --no-owner \
    --no-privileges \
    --format=custom \
    --file="$TARGET" \
    "$DB_NAME"
fi

if [ ! -s "$TARGET" ]; then
  echo "Backup failed: $TARGET is empty" >&2
  exit 1
fi

echo "Backup written to $TARGET"

find "$BACKUP_DIR" -name "${DB_NAME}-*.dump" -type f -mtime "+$RETENTION_DAYS" -print -delete

echo "Backup retention: keeping files newer than $RETENTION_DAYS days"
