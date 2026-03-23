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

### Frontend

```bash
cd FE
npm install
cp .env.example .env      # add VITE_GOOGLE_MAPS_API_KEY if needed
npm run dev               # http://localhost:5173
```

### SAM Service

```bash
cd BE/sam-service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
# Download SAM2 checkpoint → BE/sam-service/checkpoints/sam2_hiera_large.pt
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

Checkpoint download: <https://github.com/facebookresearch/segment-anything-2>

### MGP Service

```bash
cd BE/mgp-service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # fill in DATABASE_URL and SECRET_KEY
alembic upgrade head      # run DB migrations
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

### Full Stack (Docker)

```bash
cd DevOps
cp .env.example .env      # fill in POSTGRES_PASSWORD, SECRET_KEY, FRONTEND_URL
docker-compose up --build
```

Frontend will be served at port 80. MGP service at `/api/mgp/`.

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
