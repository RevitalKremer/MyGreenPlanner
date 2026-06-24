# MyGreenPlanner

Solar PV roof planning application — from satellite imagery to construction BOM and PDF reports.

---

## What it does

MyGreenPlanner guides a solar installer through a full 5-step planning workflow:

| Step | Name | What happens |
| --- | --- | --- |
| 1 | Roof Allocation | Mark roof areas on satellite map using SAM2 AI segmentation |
| 2 | PV Area Refinement | Trim and fine-tune each roof polygon |
| 3 | Panel Placement | Auto-place solar panels, adjust rows and trapezoids |
| 4 | Construction Planning | Configure rails, bases, and hardware; preview structural layout |
| 5 | PDF / Excel Export | Generate technical drawing package + BOM spreadsheet |

---

## Repository Structure

```text
MyGreenPlanner/
├── FE/                    # React frontend (Vite + PWA)
│   ├── src/
│   ├── public/
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
│
├── BE/
│   ├── sam-service/       # SAM2 image segmentation API (Python / FastAPI)
│   └── mgp-service/       # MyGreenPlanner API — auth, projects, admin (Python / FastAPI + PostgreSQL)
│
└── DevOps/                # Docker build files and compose
    ├── docker-compose.yml
    ├── Dockerfile.frontend
    ├── Dockerfile.mgp-service
    └── nginx.conf
```

---

## Technology Stack

### Frontend

- React 18, Vite, PWA (vite-plugin-pwa)
- Leaflet + React-Leaflet for satellite map
- jsPDF + html2canvas for PDF export
- SheetJS (xlsx) for Excel export

### SAM Service (`BE/sam-service`)

- FastAPI, PyTorch, SAM2 (Meta), OpenCV, Pillow

### MGP Service (`BE/mgp-service`)

- FastAPI (async), SQLAlchemy 2 (async), PostgreSQL, Alembic
- JWT authentication (access + refresh tokens), role-based access (admin / user)
- JSONB project storage

---

## Getting Started

Quickest path — full stack in Docker:

```bash
cd DevOps
cp .env.example .env       # fill POSTGRES_PASSWORD, SECRET_KEY
docker compose up --build  # frontend on http://localhost
```

Full per-service setup (Vite dev server, local uvicorn, env vars, common issues) is in **[docs/RUN_LOCALLY.md](docs/RUN_LOCALLY.md)**.

---

## Deployment & Ops

The production stack runs on a single AWS EC2 and deploys automatically on every push to `master`.

- **[docs/AWS_DEPLOYMENT.md](docs/AWS_DEPLOYMENT.md)** — start here. Architecture diagram, AWS resource inventory, security model, cost, day-2 ops cheatsheet, gotchas, recovery scenarios
- **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — GitHub Actions CI/CD: what the workflow does, how to trigger / roll back / troubleshoot
- **[docs/OPS_ACCESS.md](docs/OPS_ACCESS.md)** — SSM shell access, port-forwarding Postgres to TablePlus, updating secrets, running on-demand backups

Production URL: https://mygreenplanner.sadot-energy.co.il

### Live logs

Production runs on EC2 reachable only via **SSM Session Manager** (no SSH). The app lives in `/opt/mgp` and runs under Docker Compose (services: `db`, `mgp-service`, `mgp-webapp`, `caddy`).

**Prerequisites:** AWS CLI v2, the `session-manager-plugin`, and a configured `mgp` profile (see [docs/OPS_ACCESS.md](docs/OPS_ACCESS.md)).

**1. Open an interactive session on the instance:**

```bash
cd /path/to/MyGreenPlanner
aws ssm start-session \
  --target $(cat "DevOps/aws/.instance-id") \
  --profile mgp --region eu-central-1
```

**2. Follow the logs live** (`-f` streams new lines until you `Ctrl-C`):

```bash
cd /opt/mgp
sudo -u ubuntu docker compose --env-file .env logs -f --tail=100 mgp-service   # backend / app errors
sudo -u ubuntu docker compose --env-file .env logs -f --tail=100 caddy         # routing / TLS
sudo -u ubuntu docker compose --env-file .env logs -f --tail=100               # all services
```

**3.** `Ctrl-C` stops following; `exit` closes the session.

The session stays open while logs stream (following counts as activity, so it won't idle out). If it drops, just re-run step 1 — nothing is harmed. To survive brief disconnects without re-typing, wrap the tail in a restart loop:

```bash
while true; do sudo -u ubuntu docker compose --env-file .env logs -f --tail=50 mgp-service; sleep 2; done
```

**Resolving the instance ID** — `DevOps/aws/.instance-id` is a snapshot from provisioning time. If the instance was ever recreated, look it up live by tag instead:

```bash
aws ec2 describe-instances --profile mgp --region eu-central-1 \
  --filters "Name=tag:Name,Values=mygreenplanner" "Name=instance-state-name,Values=running" \
  --query 'Reservations[].Instances[].InstanceId' --output text
```

---

## API Reference

### SAM Service (port 8000)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/` | Health check + model status |
| POST | `/segment-roof-coordinates` | Segment a roof from map tile image + lat/lng |

### MGP Service (port 8001)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Health check |
| POST | `/auth/register` | Create account |
| POST | `/auth/login` | Login → access + refresh tokens |
| POST | `/auth/refresh` | Refresh access token |
| GET | `/auth/me` | Current user profile |
| GET | `/projects` | List user's projects |
| POST | `/projects` | Create project |
| GET | `/projects/{id}` | Get project (with full data) |
| PUT | `/projects/{id}` | Save / update project |
| DELETE | `/projects/{id}` | Delete project |
| GET | `/admin/users` | List all users (admin only) |
| PUT | `/admin/users/{id}` | Update user role / active state (admin only) |

---

## Map Tile Sources

Optimised for the Israeli market:

| Source | API Key | Max Zoom | Notes |
| --- | --- | --- | --- |
| GovMap | None | 22 | Israeli government orthophoto — best quality |
| Mapi (Survey of Israel) | None | 20 | Official Israeli mapping authority |
| Google Satellite | Optional | 22 | Good fallback |
| Mapbox Satellite | Demo token | 22 | |
| Esri World Imagery | None | 19 | Lower resolution fallback |

See [ISRAELI_GIS_GUIDE.md](ISRAELI_GIS_GUIDE.md) for details.

---

## Developer Docs

| Doc | Description |
| --- | --- |
| [docs/AWS_DEPLOYMENT.md](docs/AWS_DEPLOYMENT.md) | Production deployment reference — architecture, AWS resources, security, cost, day-2 ops, gotchas, recovery |
| [docs/RUN_LOCALLY.md](docs/RUN_LOCALLY.md) | Run the stack locally — Docker Compose or per-service with npm / uvicorn |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | CI/CD pipeline, manual triggers, rollback, troubleshooting |
| [docs/OPS_ACCESS.md](docs/OPS_ACCESS.md) | SSM shell sessions, DB port-forward for TablePlus, on-demand backups |
| [CLAUDE.md](CLAUDE.md) | Coding rules — colors, parameters, imports, help text |
| [docs/step3-scratch-gestures.md](docs/step3-scratch-gestures.md) | Step 3 scratch mode — full gestures reference & verification table |

---

## Environment Variables

### Frontend (FE/.env)

```env
VITE_GOOGLE_MAPS_API_KEY=   # optional
VITE_BACKEND_URL=http://localhost:8000
VITE_MGP_API_URL=http://localhost:8001
```

### MGP Service (BE/mgp-service/.env)

```env
DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/mgp
SECRET_KEY=<long random string>
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=30
ALLOWED_ORIGINS=["http://localhost:5173"]
```

---

## Troubleshooting

**Frontend doesn't start after repo restructure**

```bash
cd FE && npm install
```

The `node_modules` at the old repo root can be deleted.

**SAM2 model not loading**

- Download `sam2_hiera_large.pt` and place in `BE/sam-service/checkpoints/`
- Verify PyTorch installed: `python3 -c "import torch; print(torch.__version__)"`

**mgp-service DB connection error**

- Ensure PostgreSQL is running and `DATABASE_URL` in `.env` is correct
- Run `alembic upgrade head` from `BE/mgp-service/`

---

## License

MIT
