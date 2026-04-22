#!/usr/bin/env bash
# Phase 5 — install nightly Postgres -> S3 backups and apply bucket lifecycle.
set -euo pipefail

PROFILE="${AWS_PROFILE_OVERRIDE:-mgp}"
REGION="${AWS_REGION_OVERRIDE:-eu-central-1}"
SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

aws_() { aws --profile "$PROFILE" --region "$REGION" "$@"; }
log()  { printf "\n\033[1;34m==> %s\033[0m\n" "$*"; }

INSTANCE_ID=$(cat "$SCRIPT_DIR/.instance-id")
BUCKET_NAME=$(cat "$SCRIPT_DIR/.bucket")

log "Uploading backup script + cron file to S3 (temp)"
STAGE_PREFIX="bootstrap/phase5-$(openssl rand -hex 6)"
aws_ s3 cp "$SCRIPT_DIR/files/mgp-backup-db.sh" "s3://${BUCKET_NAME}/${STAGE_PREFIX}/mgp-backup-db.sh" --sse AES256 --only-show-errors
aws_ s3 cp "$SCRIPT_DIR/files/mgp-backup.cron"  "s3://${BUCKET_NAME}/${STAGE_PREFIX}/mgp-backup.cron"  --sse AES256 --only-show-errors

log "Instructing EC2 to install them"
CMD_ID=$(aws_ ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --timeout-seconds 600 \
  --parameters "commands=[
    \"set -eux\",
    \"/snap/bin/aws s3 cp s3://${BUCKET_NAME}/${STAGE_PREFIX}/mgp-backup-db.sh /usr/local/bin/mgp-backup-db.sh --region ${REGION}\",
    \"chmod 0755 /usr/local/bin/mgp-backup-db.sh\",
    \"chown root:root /usr/local/bin/mgp-backup-db.sh\",
    \"/snap/bin/aws s3 cp s3://${BUCKET_NAME}/${STAGE_PREFIX}/mgp-backup.cron /etc/cron.d/mgp-backup --region ${REGION}\",
    \"sed -i 's|^MGP_BACKUP_BUCKET=.*$||; s|^AWS_DEFAULT_REGION=.*$||' /etc/cron.d/mgp-backup\",
    \"sed -i \\\"2i MGP_BACKUP_BUCKET=${BUCKET_NAME}\\\" /etc/cron.d/mgp-backup\",
    \"sed -i \\\"3i AWS_DEFAULT_REGION=${REGION}\\\" /etc/cron.d/mgp-backup\",
    \"chmod 0644 /etc/cron.d/mgp-backup\",
    \"chown root:root /etc/cron.d/mgp-backup\",
    \"touch /var/log/mgp-backup.log\",
    \"chown ubuntu:ubuntu /var/log/mgp-backup.log\",
    \"systemctl restart cron\",
    \"echo --- installed cron: ---\",
    \"cat /etc/cron.d/mgp-backup\",
    \"echo --- running backup once, live ---\",
    \"sudo -u ubuntu MGP_BACKUP_BUCKET=${BUCKET_NAME} AWS_DEFAULT_REGION=${REGION} /usr/local/bin/mgp-backup-db.sh\"
  ]" \
  --query 'Command.CommandId' --output text)

echo "SSM command: $CMD_ID"
for i in $(seq 1 60); do
  STATUS=$(aws_ ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" --query 'Status' --output text 2>/dev/null || echo "Pending")
  printf "."
  case "$STATUS" in Success|Failed|TimedOut|Cancelled) break ;; esac
  sleep 3
done
echo ""
echo "=== STATUS: $STATUS ==="
aws_ ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" --query 'StandardOutputContent' --output text | tail -40
echo "--- STDERR ---"
aws_ ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" --query 'StandardErrorContent' --output text | tail -20

log "Cleaning up staged files"
aws_ s3 rm "s3://${BUCKET_NAME}/${STAGE_PREFIX}" --recursive --only-show-errors

log "Applying S3 lifecycle (Glacier IR after 30d, delete after 365d)"
LIFECYCLE_JSON=$(cat <<'JSON'
{
  "Rules": [
    {
      "ID": "postgres-backup-rotation",
      "Status": "Enabled",
      "Filter": { "Prefix": "postgres/" },
      "Transitions": [
        { "Days": 30, "StorageClass": "GLACIER_IR" }
      ],
      "Expiration": { "Days": 365 },
      "NoncurrentVersionExpiration": { "NoncurrentDays": 30 }
    },
    {
      "ID": "abort-stuck-multipart",
      "Status": "Enabled",
      "Filter": { "Prefix": "" },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
    }
  ]
}
JSON
)
aws_ s3api put-bucket-lifecycle-configuration --bucket "$BUCKET_NAME" --lifecycle-configuration "$LIFECYCLE_JSON"

log "Listing current backups"
aws_ s3 ls "s3://${BUCKET_NAME}/postgres/"

cat <<'SUMMARY'

============================================================
  PHASE 5 COMPLETE
============================================================
  Backup script:  /usr/local/bin/mgp-backup-db.sh  (root-owned)
  Cron:           /etc/cron.d/mgp-backup           (daily 03:00 UTC)
  Log:            /var/log/mgp-backup.log
  Lifecycle:      postgres/* -> Glacier IR at 30d, delete at 365d
  On-demand run:  aws ssm start-session --target <instance> \
                  then: sudo -u ubuntu /usr/local/bin/mgp-backup-db.sh
  Restore test:   aws s3 cp s3://<bucket>/postgres/<file> - \
                  | gunzip | docker compose --env-file .env exec -T db psql -U mgp -d mgp
============================================================
SUMMARY
