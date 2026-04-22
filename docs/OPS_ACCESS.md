# Ops Access — SSM Sessions & Tunnels

No SSH, no key pair, no VPN. All admin access to the production EC2 and its private services (Postgres, webapp) goes through **AWS SSM Session Manager**. Access is gated by your IAM credentials, sessions are audited in CloudTrail, and no inbound ports (other than 80/443 for Caddy) are open to the internet.

---

## One-time setup (per workstation)

```bash
# AWS CLI v2 (usually already installed)
aws --version

# Session Manager plugin — required for interactive shells + port-forwarding
brew install --cask session-manager-plugin
# or: https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html

# AWS credentials profile named `mgp` (personal account)
aws configure --profile mgp
# Region: eu-central-1
```

Verify:

```bash
session-manager-plugin --version
aws sts get-caller-identity --profile mgp
```

---

## 1. Interactive shell on the EC2

```bash
cd /path/to/MyGreenPlanner
aws ssm start-session \
  --target $(cat "DevOps/aws/.instance-id") \
  --profile mgp --region eu-central-1
```

You land in a shell on the instance. Useful commands once inside:

```bash
cd /opt/mgp
sudo -u ubuntu docker compose --env-file .env ps              # container status
sudo -u ubuntu docker compose --env-file .env logs --tail=100 mgp-service
sudo -u ubuntu docker compose --env-file .env logs -f caddy   # watch TLS events live
cat /etc/cron.d/mgp-backup                                    # scheduled backup
tail -n 50 /var/log/mgp-backup.log                            # backup history
exit
```

---

## 2. Port-forward Postgres → TablePlus / psql

Opens a secure tunnel from **your Mac's `localhost:15432` → EC2's `localhost:5432`**. Postgres stays unreachable from the internet; only your authenticated SSM session can talk to it.

### Open the tunnel (leave this tab running)

```bash
aws ssm start-session \
  --target $(cat "DevOps/aws/.instance-id") \
  --profile mgp --region eu-central-1 \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["5432"],"localPortNumber":["15432"]}'
```

Expected: `Port 15432 opened for sessionId ...`. Keep the tab open; Ctrl+C to close.

> Local port `15432` is intentionally non-standard so it won't clash with a local Postgres you may be running on `5432`.

### TablePlus connection (save as **"MGP Prod (via SSM)"**)

| Field | Value |
| --- | --- |
| Host | `127.0.0.1` |
| Port | `15432` |
| User | `mgp` |
| Database | `mgp` |
| Password | `POSTGRES_PASSWORD` line in `DevOps/aws/.env.prod.local` (gitignored, your Mac only) |
| SSL Mode | Prefer |

### psql from the command line

```bash
PGPASSWORD="$(grep '^POSTGRES_PASSWORD=' DevOps/aws/.env.prod.local | cut -d= -f2)" \
  psql -h 127.0.0.1 -p 15432 -U mgp -d mgp
```

---

## 3. Port-forward the webapp (optional)

For smoke-testing without exposing anything publicly (useful during a rollback or when Caddy is misbehaving). Currently the webapp is fronted by Caddy and not separately bound to a host port, so this is only used if you add a temporary `127.0.0.1:8080:80` binding to the webapp service.

```bash
aws ssm start-session \
  --target $(cat "DevOps/aws/.instance-id") \
  --profile mgp --region eu-central-1 \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["8080"],"localPortNumber":["8443"]}'
# Then open http://localhost:8443 in a browser
```

---

## 4. Updating secrets on the server

Direct edits on the server are possible but awkward. The recommended flow pushes a new `.env` from your Mac to the EC2 via a short-lived, encrypted S3 object — so the secret never appears in SSM command history.

```bash
INSTANCE_ID=$(cat "DevOps/aws/.instance-id")
BUCKET=$(cat "DevOps/aws/.bucket")
S3_KEY="bootstrap/$(openssl rand -hex 8).env"

# 1) Stage encrypted
aws s3 cp --profile mgp --region eu-central-1 --sse AES256 \
  DevOps/aws/.env.prod.local "s3://$BUCKET/$S3_KEY" --only-show-errors

# 2) Instance pulls it, sets perms, you verify (no secrets echoed)
aws ssm send-command --profile mgp --region eu-central-1 \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --parameters "commands=[
    \"/snap/bin/aws s3 cp s3://$BUCKET/$S3_KEY /opt/mgp/.env --region eu-central-1 --only-show-errors\",
    \"chmod 600 /opt/mgp/.env\",
    \"chown ubuntu:ubuntu /opt/mgp/.env\",
    \"grep -c '^[A-Z_]\\+=' /opt/mgp/.env\"
  ]"

# 3) Clean up
aws s3 rm --profile mgp --region eu-central-1 "s3://$BUCKET/$S3_KEY" --only-show-errors

# 4) Restart the backend so it picks up the new env
aws ssm send-command --profile mgp --region eu-central-1 \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["cd /opt/mgp","sudo -u ubuntu docker compose --env-file .env up -d"]'
```

---

## 5. Running an on-demand DB backup

```bash
aws ssm start-session \
  --target $(cat "DevOps/aws/.instance-id") \
  --profile mgp --region eu-central-1
# Inside:
sudo -u ubuntu MGP_BACKUP_BUCKET=$(cat /etc/cron.d/mgp-backup | grep MGP_BACKUP_BUCKET | cut -d= -f2) \
             AWS_DEFAULT_REGION=eu-central-1 \
             /usr/local/bin/mgp-backup-db.sh
```

Lists current backups from your Mac:

```bash
aws s3 ls --profile mgp --region eu-central-1 "s3://$(cat DevOps/aws/.bucket)/postgres/"
```

### Restoring from a backup

```bash
# From your Mac, pick a dump:
aws s3 ls --profile mgp --region eu-central-1 "s3://$(cat DevOps/aws/.bucket)/postgres/"

# On the EC2 (via SSM session):
BACKUP=pg-mgp-YYYYMMDDTHHMMSSZ.sql.gz
cd /opt/mgp
/snap/bin/aws s3 cp "s3://$(grep MGP_BACKUP_BUCKET /etc/cron.d/mgp-backup | cut -d= -f2)/postgres/$BACKUP" - \
  | gunzip \
  | sudo -u ubuntu docker compose --env-file .env exec -T db psql -U mgp -d mgp
```

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `SessionManagerPlugin is not found` | `brew install --cask session-manager-plugin` |
| `An error occurred (TargetNotConnected)` | Instance is stopped or SSM agent is offline. Check `aws ssm describe-instance-information --profile mgp` |
| `Port 15432 already in use` | Another tunnel tab is still open. Kill it, or pick a different `localPortNumber` |
| `AccessDeniedException` on `StartSession` | Your `mgp` profile lacks `ssm:StartSession`. Attach `AmazonSSMFullAccess` or a narrower custom policy to the IAM user |
