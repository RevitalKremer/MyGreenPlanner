# Run Locally

Two supported paths: **Docker Compose** (one command, closest to production) or **individual services with npm / uvicorn** (fastest feedback loop while developing a single service).

All commands below assume your shell is at the repo root.

---

## Option A — Full stack with Docker Compose

Simplest — starts Postgres, backend, frontend in one command.

```bash
cd DevOps
cp .env.example .env      # fill in at minimum POSTGRES_PASSWORD, SECRET_KEY
docker compose up --build
```

Services after startup:

| Service | URL | Notes |
| --- | --- | --- |
| Frontend (nginx) | http://localhost | Serves React build + proxies `/api/mgp/*` to backend |
| `mgp-service` API | http://localhost/api/mgp/ | FastAPI, reachable only through the frontend's nginx |
| Postgres | localhost:5432 | Credentials from `.env` |
| `sam-service` API | http://localhost/api/sam/ | Optional — requires SAM2 checkpoint (see below) |

Rebuild a single service after code changes:

```bash
docker compose up --build mgp-service -d
```

Tear down:

```bash
docker compose down                 # keep data
docker compose down -v              # wipe Postgres volume too
```

### Useful commands

Run from `DevOps/` (where the compose file lives). Service names match `docker-compose.yml`: `mgp-postgres`, `mgp-service`, `sam-service`, `mgp-webapp`.

Stream logs for one service (live tail):

```bash
docker compose logs -f mgp-service          # follow
docker compose logs -f --tail=200 mgp-service   # last 200 lines, then follow
docker compose logs -f mgp-service mgp-postgres # multiple services
```

Run Alembic inside the running backend container:

```bash
docker compose exec mgp-service alembic upgrade head       # apply new migrations
docker compose exec mgp-service alembic current            # show current revision
docker compose exec mgp-service alembic history --verbose  # list all revisions
docker compose exec mgp-service alembic downgrade -1       # roll back one
```

(The backend runs `alembic upgrade head` on container start, so normally a restart — `docker compose up -d mgp-service` — is enough. Use the explicit commands when you want to inspect state or downgrade.)

Open a `psql` shell against the local DB:

```bash
docker compose exec mgp-postgres psql -U mgp -d mgp
```

Shell into a container:

```bash
docker compose exec mgp-service bash
```

### SAM service (optional)

Used in Step 1 (roof segmentation). If you don't need it locally, leave the container off and the UI falls back to manual tracing.

To enable: download the SAM2 checkpoint to `BE/sam-service/checkpoints/sam2_hiera_large.pt` (see [README](../README.md#sam-service-besam-service) for the model source), then re-run compose.

---

## Option B — Services individually

Use when you're iterating on one service and want fast reloads.

### Frontend (Vite dev server)

```bash
cd FE
npm install
cp .env.example .env               # add VITE_GOOGLE_MAPS_API_KEY if you want Google tiles
npm run dev                        # http://localhost:5173
```

The Vite config in [FE/vite.config.js](../FE/vite.config.js) proxies `/api/*` → `http://localhost`, so it expects the backend to be reachable on port 80 (i.e., run the Docker stack for backend, or run `mgp-service` on port 80).

### MGP service (FastAPI)

```bash
cd BE/mgp-service
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env               # fill DATABASE_URL, SECRET_KEY
alembic upgrade head               # run migrations
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

You'll need a running Postgres — simplest is `docker compose up -d db` from `DevOps/`.

### SAM service (FastAPI + PyTorch)

```bash
cd BE/sam-service
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
# Put sam2_hiera_large.pt in ./checkpoints/
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

---

## Environment variables

### Frontend — `FE/.env`

| Var | Default | Notes |
| --- | --- | --- |
| `VITE_MGP_API_URL` | `/api/mgp` (relative) | Override only if backend is on a different origin |
| `VITE_BACKEND_URL` | `http://localhost:8000` | SAM service URL |
| `VITE_GOOGLE_MAPS_API_KEY` | *(empty)* | Optional — enables Google Satellite tiles |
| `VITE_GOVMAP_API_KEY` | *(empty)* | Optional — enables GovMap tiles (Israel) |

### MGP service — `BE/mgp-service/.env`

| Var | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | `postgresql+asyncpg://user:pass@host:5432/mgp` |
| `SECRET_KEY` | yes | Long random string (JWT signing) |
| `ALGORITHM` | no | Default `HS256` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | no | Default `60` |
| `REFRESH_TOKEN_EXPIRE_DAYS` | no | Default `30` |
| `ALLOWED_ORIGINS` | no | Comma-separated list for CORS |
| `SMTP_*` | no | Leave `SMTP_HOST` empty in dev; emails log to stdout instead |
| `SYSADMIN_EMAIL` / `SYSADMIN_PASSWORD` / `SYSADMIN_NAME` | no | Bootstraps the first admin on empty DB |

### Docker Compose — `DevOps/.env`

Same keys as above plus `POSTGRES_PASSWORD` (the compose file passes these through as container env).

---

## Common issues

**"Port 5432 already in use"** — you have a local Postgres running. Either stop it (`brew services stop postgresql`) or change the compose file's DB port mapping.

**Frontend shows CORS errors** — the frontend must be served from the same origin as the backend, or `ALLOWED_ORIGINS` on the backend must include your dev origin. Simplest in local: use the full Docker stack (Option A) — everything is on `http://localhost`.

**Alembic can't find `alembic.ini`** — run the `alembic` command from inside `BE/mgp-service/`, not the repo root.

**Frontend doesn't start after a repo restructure**

```bash
cd FE && rm -rf node_modules && npm install
```

Old top-level `node_modules` from before the restructure can be deleted.
