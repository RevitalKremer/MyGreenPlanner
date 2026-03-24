from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.user import User, UserRole
from app.routers import auth, projects, admin
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


@app.get("/health")
async def health():
    return {"status": "ok"}
