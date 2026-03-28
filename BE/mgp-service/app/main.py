import logging
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("mgp")

from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal, get_db
from app.models.setting import AppSetting
from app.models.user import User, UserRole
from app.routers import auth, projects, admin, products
from app.services.auth import get_user_by_email, hash_password


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not settings.SYSADMIN_PASSWORD:
        print("⚠️  SYSADMIN_PASSWORD not set — skipping sysadmin bootstrap")
    else:
        async with AsyncSessionLocal() as db:
            sysadmin = await get_user_by_email(db, settings.SYSADMIN_EMAIL)
            if sysadmin:
                if not sysadmin.is_sysadmin:
                    sysadmin.is_sysadmin = True
                    sysadmin.role = UserRole.admin
                    sysadmin.is_verified = True
                    sysadmin.is_active = True
                    await db.commit()
            else:
                db.add(User(
                    email=settings.SYSADMIN_EMAIL,
                    hashed_password=hash_password(settings.SYSADMIN_PASSWORD),
                    full_name=settings.SYSADMIN_NAME,
                    role=UserRole.admin,
                    is_verified=True,
                    is_sysadmin=True,
                    is_active=True,
                ))
                await db.commit()
    yield


app = FastAPI(title="MyGreenPlanner Service", version="0.1.0", lifespan=lifespan)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    body = await request.body()
    body_preview = body[:500].decode("utf-8", errors="replace") if body else ""
    if len(body) > 500:
        body_preview += f" … (+{len(body) - 500} bytes)"

    logger.info(
        "%s %s | body: %s",
        request.method,
        request.url.path,
        body_preview or "(empty)",
    )

    start = time.perf_counter()
    response = await call_next(request)
    elapsed = (time.perf_counter() - start) * 1000

    logger.info(
        "%s %s → %d (%.0fms)",
        request.method,
        request.url.path,
        response.status_code,
        elapsed,
    )
    return response


origins = [o.strip() for o in settings.ALLOWED_ORIGINS.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(admin.router)
app.include_router(products.router)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/settings/defaults")
async def settings_defaults(db=Depends(get_db)):
    """Public endpoint — returns {key: value_json} for all app_settings."""
    rows = (await db.execute(select(AppSetting.key, AppSetting.value_json))).all()
    return {r.key: r.value_json for r in rows}
