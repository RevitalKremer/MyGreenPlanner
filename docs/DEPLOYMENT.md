# Deployment (CI/CD)

Every push to **`master`** builds Docker images, pushes them to GHCR, and redeploys the EC2 stack automatically. No manual steps after the push.

Workflow file: [.github/workflows/deploy.yml](../.github/workflows/deploy.yml)

Production URL: **https://mygreenplanner.sadot-energy.co.il**

---

## What happens on each push

```
1. GHA runner checks out the code
2. Build-push job (ubuntu-24.04-arm, native ARM64):
     - Build ghcr.io/revitalkremer/mygreenplanner-mgp-service:latest (+ :<sha>)
     - Build ghcr.io/revitalkremer/mygreenplanner-mgp-webapp:latest  (+ :<sha>)
3. Deploy job (ubuntu-latest):
     - Assume AWS role `mgp-gha-deploy` via OIDC (no long-lived keys)
     - Upload DevOps/docker-compose.prod.yml and DevOps/Caddyfile to S3 (staging)
     - Send SSM Run Command to the EC2:
         * Pull compose file + Caddyfile from S3 into /opt/mgp/
         * docker compose pull
         * docker compose up -d --remove-orphans
         * docker system prune -f
     - Poll SSM until Success/Failed
     - Print stdout/stderr
```

End-to-end: ~2–3 minutes for code-only changes.

---

## How to trigger a deploy

| Trigger | How |
| --- | --- |
| Merge / push to `master` | Automatic on every push |
| Re-run without code changes | GitHub → Actions → "Build & Deploy to AWS" → **Run workflow** (workflow_dispatch) |
| Roll back | Change the image tag in `DevOps/docker-compose.prod.yml` from `:latest` to `:<sha>` of a known-good commit, commit & push |

---

## Prerequisites (one-time, already set up)

### GitHub repo secrets
Settings → Secrets and variables → Actions:

| Name | Value |
| --- | --- |
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::<account>:role/mgp-gha-deploy` |
| `AWS_REGION` | `eu-central-1` |
| `AWS_INSTANCE_ID` | `i-<instance>` |
| `AWS_DEPLOY_BUCKET` | `mgp-backups-<account>` |

### AWS side (created by [DevOps/aws/phase4-setup-oidc.sh](../DevOps/aws/phase4-setup-oidc.sh))
- GitHub OIDC identity provider (`token.actions.githubusercontent.com`)
- IAM role `mgp-gha-deploy` whose trust policy requires the token to come from `repo:RevitalKremer/MyGreenPlanner:ref:refs/heads/master`
- Inline policy on the role: `ssm:SendCommand` (scoped to the instance) + S3 access to the `deploy/*` prefix

### GHCR packages
Both image packages must be **public** so the EC2 can pull without login:
- https://github.com/RevitalKremer?tab=packages → click package → Package settings → Change visibility → Public
- This is one-time per package. If a package is ever deleted and recreated, it'll default back to private and the next deploy will fail on `docker compose pull`.

---

## Watching a deploy

- **Actions tab**: https://github.com/RevitalKremer/MyGreenPlanner/actions
- **Live container logs on the server** — open an SSM session and tail logs (see [OPS_ACCESS.md](OPS_ACCESS.md)):
  ```bash
  cd /opt/mgp
  sudo -u ubuntu docker compose --env-file .env logs -f --tail=100 mgp-service
  ```

---

## Troubleshooting

| Symptom | Where to look | Usual cause |
| --- | --- | --- |
| `build-push` fails on GHCR push | Actions → build-push logs | `GITHUB_TOKEN` missing `packages: write` — check workflow `permissions:` block |
| `deploy` fails on `docker compose pull` with "unauthorized" | Actions → deploy logs | One or both GHCR packages are private — set them public (see above) |
| `deploy` passes but the site still shows old code | Browser cache | Hard refresh (⌘⇧R). If still, verify new image tag with `docker images` via SSM |
| SSM command times out | Actions → deploy logs | Instance not reachable — check CloudWatch EC2 status, `aws ssm describe-instance-information` |
| Alembic migrations crash backend on start | `docker compose logs mgp-service` via SSM | Schema conflict — fix the migration, push again |

---

## Configuration files deployed each time

These three files are re-uploaded to the EC2 on every deploy (via S3, then SSM pull):

| Repo path | On EC2 | Purpose |
| --- | --- | --- |
| [DevOps/docker-compose.prod.yml](../DevOps/docker-compose.prod.yml) | `/opt/mgp/docker-compose.yml` | Service definitions (Postgres, mgp-service, mgp-webapp, caddy) |
| [DevOps/Caddyfile](../DevOps/Caddyfile) | `/opt/mgp/Caddyfile` | Reverse proxy + auto-TLS for `mygreenplanner.sadot-energy.co.il` |

The server-side `.env` (at `/opt/mgp/.env`) is **not** redeployed — it's managed out-of-band (see [OPS_ACCESS.md](OPS_ACCESS.md) for how to update secrets).
