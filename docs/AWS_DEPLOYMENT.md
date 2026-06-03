# AWS Deployment & Operations

End-to-end reference for the production deployment of MyGreenPlanner on AWS. This document is the **single source of truth** for *what's running, where, and why*. For day-to-day commands, the deeper-dive docs below cover specifics:

| Doc | When to read |
| --- | --- |
| [RUN_LOCALLY.md](RUN_LOCALLY.md) | You want to run / test the app on your laptop |
| [DEPLOYMENT.md](DEPLOYMENT.md) | You want to understand or change the CI/CD pipeline |
| [OPS_ACCESS.md](OPS_ACCESS.md) | You need to shell into the server, tunnel to the DB, update secrets, or run backups manually |

Public URL: **https://mygreenplanner.sadot-energy.co.il**

---

## Architecture

```
                          Internet
                              │
                              │  HTTPS 443 / HTTP 80 (auto-redirect)
                              ▼
                      ┌───────────────┐
                      │     Caddy     │  TLS termination, Let's Encrypt auto-renew
                      └───────┬───────┘
                              │  Docker internal network
                              ▼
                      ┌───────────────┐
                      │  mgp-webapp   │  nginx + React; proxies /api/mgp/* internally
                      └───────┬───────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │         mgp-service           │  FastAPI (uvicorn :8000), Alembic
              └───────┬───────────────────────┘
                      │           ▲
                      ▼           │  loopback :5432 (host) for SSM-tunneled tools
              ┌───────────────┐   │
              │  db (Postgres)│───┘
              └───────┬───────┘
                      │
                      ▼  nightly pg_dump (cron 03:00 UTC)
              ┌────────────────────────────────┐
              │  S3: mgp-backups-<account>/    │
              │   postgres/   (Glacier IR 30d) │
              │   deploy/     (CI artifacts)   │
              └────────────────────────────────┘

  Admin access:  AWS SSM Session Manager → IAM-gated; no SSH, no key pair
  CI/CD:         GitHub Actions → assumes IAM role via OIDC (no long-lived keys)
```

**Why this shape:** cheapest possible AWS-native deployment for a personal project with few concurrent users. ~$13/mo total. One EC2, one volume, one S3 bucket, one IAM role for CI, one for the instance. Anything fancier (ECS, RDS, ALB) would multiply both cost and cognitive load with no benefit at this scale.

---

## AWS resources inventory

All in **`eu-central-1`** (Frankfurt — closest cheap-region to Israeli users).

| Resource | Name / ID location | Purpose |
| --- | --- | --- |
| EC2 instance | ID in `DevOps/aws/.instance-id` (gitignored) — `t4g.small` (ARM64), 20 GB encrypted gp3, IMDSv2 required | Runs the Docker Compose stack |
| Elastic IP | `52.57.128.134` (also in `DevOps/aws/.eip`) | Stable public IP — DNS A record points here |
| Security group | `mgp-ec2-sg` (ID in `DevOps/aws/.sg-id`) | Allows inbound 80 + 443 from `0.0.0.0/0` only; no SSH port |
| IAM role (EC2) | `mgp-ec2-role` (instance profile `mgp-ec2-profile`) | `AmazonSSMManagedInstanceCore` + scoped S3 access to the backup bucket |
| IAM role (CI) | `mgp-gha-deploy` (ARN in `DevOps/aws/.deploy-role-arn`) | Assumed by GitHub Actions via OIDC; scoped to SSM + S3 deploy prefix on this instance only |
| OIDC provider | `token.actions.githubusercontent.com` | Trust anchor so GHA can assume the role above without static keys |
| S3 bucket | `mgp-backups-<account>` (in `DevOps/aws/.bucket`) | Encrypted, versioned, public-access blocked. Holds `postgres/*` backups + `deploy/*` CI artifacts + `bootstrap/*` short-lived env stages |
| DNS | `mygreenplanner.sadot-energy.co.il` → A → `52.57.128.134` | Managed in **Cloudflare DNS**; proxy must stay **OFF** (grey cloud) for Let's Encrypt to work |

The `DevOps/aws/.*` state files are written by the provisioning scripts and gitignored. They're the canonical lookup for IDs when running ops commands.

---

## How the stack got there (one-time scripts, idempotent)

Two bash scripts under `DevOps/aws/` recreate everything if you ever need to rebuild from scratch:

| Script | What it provisions |
| --- | --- |
| [phase1-provision.sh](../DevOps/aws/phase1-provision.sh) | VPC lookup, security group, S3 bucket (with lifecycle prereqs), IAM role + instance profile, EC2 instance with user-data bootstrap (Docker, fail2ban, unattended-upgrades), Elastic IP |
| [phase4-setup-oidc.sh](../DevOps/aws/phase4-setup-oidc.sh) | GitHub OIDC identity provider, `mgp-gha-deploy` IAM role with scoped trust + inline policy |
| [phase5-setup-backups.sh](../DevOps/aws/phase5-setup-backups.sh) | Installs `mgp-backup-db.sh` + cron on the EC2, applies S3 lifecycle (Glacier IR at 30d, expire at 365d) |

Each script is safe to re-run: it checks for existence before creating. Override profile/region with `AWS_PROFILE_OVERRIDE` / `AWS_REGION_OVERRIDE` env vars.

---

## Security model

| Layer | Control |
| --- | --- |
| **Network** | Only ports 80 + 443 open to internet. Postgres bound to `127.0.0.1` on EC2 host — reachable only via SSM tunnel. Backend (`mgp-service`) reachable only on Docker internal network. |
| **Admin access** | No SSH, no key pair. SSM Session Manager only; gated by IAM (your `mgp` profile). Every session is auditable in CloudTrail. |
| **Server patching** | `unattended-upgrades` enabled. `fail2ban` enabled (protects the surface area that exists — there's currently no SSH to brute-force). |
| **Instance metadata** | IMDSv2-only (`HttpTokens=required`). Mitigates SSRF → credential theft. |
| **Data at rest** | EBS volume encrypted (AES256). S3 bucket SSE-S3. |
| **Data in transit** | Public traffic on TLS 1.2+ via Caddy (Let's Encrypt). Internal Docker network is plain HTTP (acceptable — within the host). |
| **Secrets** | `/opt/mgp/.env` only — mode 600, owner `ubuntu`. **Never in GitHub**, never in container images, never in SSM command text. Updates flow via short-lived encrypted S3 staging (see [OPS_ACCESS.md § 4](OPS_ACCESS.md#4-updating-secrets-on-the-server)). |
| **CI/CD auth** | GitHub OIDC → AWS IAM role. No long-lived `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in GitHub secrets. Role's trust policy is scoped to exact `repo:RevitalKremer/MyGreenPlanner:ref:refs/heads/master`. |
| **Backups** | Nightly `pg_dump` → S3. Encrypted at rest, versioned. Lifecycle transitions to Glacier IR at 30d, deletes at 365d. |

---

## Cost (~$13/month)

| Item | Monthly cost |
| --- | --- |
| `t4g.small` EC2 (ARM) | ~$12.00 |
| 20 GB gp3 EBS | ~$1.60 |
| Elastic IP (while attached) | $0.00 |
| S3 backups (a few MB) | ~$0.02 |
| Data transfer (low traffic) | ~$0.10 |
| GitHub Actions + GHCR (public repo) | $0.00 |
| **Total** | **~$13–15** |

Check your **first month's bill** around 20 days after launch — if it's noticeably higher, something's wrong (most likely an attached EBS volume from a previous instance, or unused snapshots). Investigate with Cost Explorer.

---

## CI/CD overview

Every push to **`master`** triggers [.github/workflows/deploy.yml](../.github/workflows/deploy.yml):

1. Build `mgp-service` and `mgp-webapp` images on `ubuntu-24.04-arm` (native ARM, fast)
2. Push to `ghcr.io/revitalkremer/mygreenplanner-*` (tagged `:latest` + `:<sha>`)
3. Assume `mgp-gha-deploy` via OIDC
4. Upload `DevOps/docker-compose.prod.yml` + `DevOps/Caddyfile` to S3
5. SSM Run Command on the EC2: pull both files, `docker compose pull`, `docker compose up -d --remove-orphans`
6. Poll SSM until success, print stdout/stderr

End-to-end: ~2–3 min. Roll back by changing image tag from `:latest` to `:<sha>` in [DevOps/docker-compose.prod.yml](../DevOps/docker-compose.prod.yml) and pushing. Full details: [DEPLOYMENT.md](DEPLOYMENT.md).

---

## Day-2 operations — quick reference

| Task | Where |
| --- | --- |
| View server logs | [OPS_ACCESS.md § 1](OPS_ACCESS.md#1-interactive-shell-on-the-ec2) |
| SSM shell into EC2 | [OPS_ACCESS.md § 1](OPS_ACCESS.md#1-interactive-shell-on-the-ec2) |
| Connect TablePlus / psql to prod Postgres | [OPS_ACCESS.md § 2](OPS_ACCESS.md#2-port-forward-postgres--tableplus--psql) |
| Add or update a secret/env var | [Adding a new env var](#adding-a-new-env-var) (below) + [OPS_ACCESS.md § 4](OPS_ACCESS.md#4-updating-secrets-on-the-server) |
| Run a backup on demand | [OPS_ACCESS.md § 5](OPS_ACCESS.md#5-running-an-on-demand-db-backup) |
| Restore from a backup | [OPS_ACCESS.md § 5 — Restoring](OPS_ACCESS.md#restoring-from-a-backup) |
| Trigger a deploy / re-run / rollback | [DEPLOYMENT.md § How to trigger a deploy](DEPLOYMENT.md#how-to-trigger-a-deploy) |
| Change DNS / TLS config | Edit [DevOps/Caddyfile](../DevOps/Caddyfile), commit, push to master |

### Adding a new env var

1. **Declare it in code** — add the field to `Settings` in [BE/mgp-service/app/config.py](../BE/mgp-service/app/config.py) (with a sensible default so local dev doesn't break).
2. **Wire it through Compose** — add to the `environment:` block in both [DevOps/docker-compose.prod.yml](../DevOps/docker-compose.prod.yml) and [DevOps/docker-compose.yml](../DevOps/docker-compose.yml). Use `KEY: ${KEY}` syntax.
3. **Set the value** in [DevOps/aws/.env.prod.local](../DevOps/aws/.env.prod.local) on your Mac (gitignored — never committed). Put comments on **their own line** — inline `# ...` after a value confuses `.env` parsers.
4. **Sync to the server** using the encrypted S3 + SSM flow in [OPS_ACCESS.md § 4](OPS_ACCESS.md#4-updating-secrets-on-the-server). Restart `mgp-service`.
5. **Commit the code** (`config.py` + compose files). Pushing to master triggers a normal CI deploy — the new image already knows about the var, and `/opt/mgp/.env` has the value, so it picks up immediately.

---

## Gotchas learned the hard way

| Issue | What to remember |
| --- | --- |
| **Multiple GitHub accounts** | `RevitalKremer` (personal) owns this repo. Use `gh auth switch --user RevitalKremer` before pushing here. |
| **`workflow` scope** | Pushing changes under `.github/workflows/` requires a token with the `workflow` scope. `gh auth refresh --hostname github.com --scopes repo,workflow` grants it. |
| **Embedded PAT in git remote** | `git remote get-url origin` may reveal an embedded token. Clean URLs only: `git remote set-url origin https://github.com/RevitalKremer/MyGreenPlanner.git`. Let `gh` provide auth via its credential helper. |
| **GHCR packages default to private** | After first push, each package must be made **public** (one-time, in GitHub package settings). Otherwise the EC2 can't pull and the deploy fails with `unauthorized`. |
| **Cloudflare proxy off** | Caddy's Let's Encrypt HTTP-01 challenge requires the public DNS to resolve to the EC2 IP directly. The DNS A record's cloud icon **must stay grey** ("DNS only"), not orange. If you want CDN later, switch to a Cloudflare Origin Cert instead. |
| **Gmail SMTP `From:`** | The `From` address must match the authenticated Gmail account, or be a configured "Send mail as" alias verified via DKIM/SPF. `SMTP_FROM=noreply@some-other-domain` will silently fail or land in spam. |
| **`.env` inline comments** | Some parsers strip `#`, some don't. Put each comment on its own line above the variable. |
| **Don't paste secrets in chat / terminal output** | This includes `cat .env`, `git credential fill`, `gh auth token`. If a secret leaks into chat, **revoke and rotate immediately** — assume any value seen in chat is compromised. |
| **Local vs prod data are separate** | Local `docker compose` uses its own Mac-side volume; prod uses the EC2's `pg_data` volume. They never share data. `psql` to `localhost:5432` from your Mac talks to **local** Postgres unless you've opened an SSM tunnel to a non-`5432` local port (e.g. `15432`). |
| **`git push origin master` deploys** | There's no staging gate. Push to master = ship to prod in ~3 min. Use feature branches and merge intentionally. |

---

## Recovery scenarios

| Scenario | How to recover |
| --- | --- |
| EC2 instance terminated / unreachable | Re-run [phase1-provision.sh](../DevOps/aws/phase1-provision.sh) — creates a fresh instance with a new EIP. Update DNS to the new EIP. Re-upload `/opt/mgp/.env` from [DevOps/aws/.env.prod.local](../DevOps/aws/.env.prod.local). Restore latest DB backup ([OPS_ACCESS.md § 5](OPS_ACCESS.md#restoring-from-a-backup)). Push a deploy. |
| Disk corruption / DB lost | The Postgres volume is on EBS gp3 — gone with the instance. Restore from the most recent `s3://mgp-backups-<account>/postgres/*` dump. |
| Caddy cert renewal fails | Caddy emails the address in [DevOps/Caddyfile](../DevOps/Caddyfile) (`rrevital@gmail.com`) ~14 days before expiry. SSM in and `docker compose logs caddy` to see the error. Usually DNS-related (e.g. someone re-enabled Cloudflare proxy). |
| Lost AWS console access | The `revital-admin` IAM user has admin. Recover via root account password reset at `https://signin.aws.amazon.com/`. |
| Lost GitHub access | Both accounts use 2FA — recover via SMS / authenticator. The `mgp-gha-deploy` IAM role's trust policy is scoped to `RevitalKremer/MyGreenPlanner@master` — if the repo moves, update the trust policy via [phase4-setup-oidc.sh](../DevOps/aws/phase4-setup-oidc.sh). |
| Compromised secret in `.env` | Rotate the underlying credential at its source (Google, Monday, etc.), update [DevOps/aws/.env.prod.local](../DevOps/aws/.env.prod.local), sync to server. If `SECRET_KEY` is rotated, all existing JWTs invalidate — users will need to log in again. |

---

## Glossary

- **SSM** — AWS Systems Manager. Lets you run commands and open shells on EC2 instances without SSH. Authorized via IAM, audited via CloudTrail.
- **OIDC** — OpenID Connect. Lets GitHub Actions exchange a short-lived JWT for AWS credentials, removing the need for long-lived `AWS_ACCESS_KEY_ID` secrets.
- **Caddy** — Web server / reverse proxy with automatic Let's Encrypt TLS. Replaces nginx + certbot.
- **GHCR** — GitHub Container Registry. Free Docker registry hosted alongside the repo.
- **EIP** — Elastic IP. A stable public IPv4 address you can detach/attach across EC2 instances.
- **IMDSv2** — Instance Metadata Service v2. Hardened token-required version that mitigates SSRF attacks reaching instance credentials.
