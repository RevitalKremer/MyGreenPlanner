#!/usr/bin/env bash
# MyGreenPlanner — Postgres backup to S3.
# Runs `pg_dump` inside the `db` container, gzips, uploads to S3 under the
# `postgres/` prefix. AWS creds come from the EC2 instance role, so nothing
# sensitive lives on disk here.
#
# Required env (set in /etc/cron.d/mgp-backup):
#   MGP_BACKUP_BUCKET      — S3 bucket name
#   AWS_DEFAULT_REGION     — AWS region
set -euo pipefail

: "${MGP_BACKUP_BUCKET:?set MGP_BACKUP_BUCKET}"
: "${AWS_DEFAULT_REGION:?set AWS_DEFAULT_REGION}"

TS=$(date -u +%Y%m%dT%H%M%SZ)
FILENAME="pg-mgp-${TS}.sql.gz"
TMPFILE=$(mktemp /tmp/mgp-backup-XXXXXX.sql.gz)
trap 'rm -f "$TMPFILE"' EXIT

cd /opt/mgp

docker compose --env-file .env exec -T db \
  pg_dump -U mgp -d mgp --clean --if-exists \
  | gzip -9 > "$TMPFILE"

SIZE=$(stat -c%s "$TMPFILE")
if [ "$SIZE" -lt 512 ]; then
  echo "ERROR: backup file is implausibly small (${SIZE} bytes) — aborting upload" >&2
  exit 1
fi

/snap/bin/aws s3 cp "$TMPFILE" "s3://${MGP_BACKUP_BUCKET}/postgres/${FILENAME}" \
  --region "${AWS_DEFAULT_REGION}" \
  --storage-class STANDARD_IA \
  --only-show-errors

echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') backup OK ${FILENAME} (${SIZE} bytes)"
