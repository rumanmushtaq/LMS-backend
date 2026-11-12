#!/usr/bin/env bash
# Step 0 — back up BOTH databases before touching anything.
#   bash migration/backup.sh
#
# Source MySQL dump is taken on the server over SSH (no port needed locally).
# Target MongoDB dump uses mongodump against MONGO_URI/MONGO_DB.
set -euo pipefail

cd "$(dirname "$0")"
set -a; [ -f .env ] && . ./.env; set +a

: "${SSH_USER:?set SSH_USER in migration/.env}"
: "${SSH_HOST:?set SSH_HOST}"
: "${MYSQL_DB:?set MYSQL_DB}"
: "${MYSQL_USER:?set MYSQL_USER}"
: "${MONGO_URI:?set MONGO_URI}"
: "${MONGO_DB:?set MONGO_DB}"

TS="$(date +%Y%m%d-%H%M%S)"
OUT="backups/${TS}"
mkdir -p "$OUT"

SSH_OPTS=(-p "${SSH_PORT:-22}")
[ -n "${SSH_PRIVATE_KEY_PATH:-}" ] && SSH_OPTS+=(-i "$SSH_PRIVATE_KEY_PATH")

echo "[backup] mysqldump ${MYSQL_DB} over SSH → ${OUT}/${MYSQL_DB}.sql"
# --single-transaction + --skip-lock-tables = consistent read-only dump.
ssh "${SSH_OPTS[@]}" "${SSH_USER}@${SSH_HOST}" \
  "mysqldump --single-transaction --skip-lock-tables -u'${MYSQL_USER}' -p'${MYSQL_PASSWORD:-}' '${MYSQL_DB}'" \
  > "${OUT}/${MYSQL_DB}.sql"

echo "[backup] mongodump ${MONGO_DB} → ${OUT}/mongo"
mongodump --uri "${MONGO_URI}" --db "${MONGO_DB}" --out "${OUT}/mongo"

echo "[backup] done → ${OUT}"
