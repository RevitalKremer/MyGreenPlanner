import uuid
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.user import User, UserRole
from app.models.product import Product
from app.models.setting import AppSetting
from app.schemas.user import UserRead, UserUpdate
from app.schemas.product import ProductCreate, ProductUpdate, ProductRead
from app.schemas.setting import SettingRead, SettingUpdate
from app.routers.deps import require_admin

router = APIRouter(prefix="/admin", tags=["admin"])


# ── Users ──────────────────────────────────────────────────────────────────────

@router.get("/users", response_model=list[UserRead])
async def list_users(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).order_by(User.created_at))
    return list(result.scalars().all())


@router.put("/users/{user_id}", response_model=UserRead)
async def update_user(
    user_id: str,
    payload: UserUpdate,
    current_admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.is_sysadmin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot modify the system administrator")
    if user.id == current_admin.id and payload.role is not None and payload.role != current_admin.role:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot change your own role")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(user, field, value)
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: str,
    current_admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.is_sysadmin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delete the system administrator")
    if user.id == current_admin.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delete your own account")
    if user.role == UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delete other admin accounts")
    await db.delete(user)
    await db.commit()


# ── Products ───────────────────────────────────────────────────────────────────

@router.get("/products", response_model=list[ProductRead])
async def list_products(
    product_type: str | None = Query(None, description="Filter by product_type: 'panel' or 'material'"),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    q = select(Product)
    if product_type is not None:
        q = q.where(Product.product_type == product_type)
    result = await db.execute(q.order_by(Product.name))
    return list(result.scalars().all())


@router.post("/products", response_model=ProductRead, status_code=status.HTTP_201_CREATED)
async def create_product(
    payload: ProductCreate,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(select(Product).where(Product.type_key == payload.type_key))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="type_key already exists")
    product = Product(**payload.model_dump())
    db.add(product)
    await db.commit()
    await db.refresh(product)
    return product


@router.put("/products/{product_id}", response_model=ProductRead)
async def update_product(
    product_id: str,
    payload: ProductUpdate,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Product).where(Product.id == uuid.UUID(product_id)))
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(product, field, value)
    await db.commit()
    await db.refresh(product)
    return product


@router.delete("/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(
    product_id: str,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Product).where(Product.id == uuid.UUID(product_id)))
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    await db.delete(product)
    await db.commit()


# ── Settings ───────────────────────────────────────────────────────────────────

@router.get("/settings", response_model=list[SettingRead])
async def list_settings(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(AppSetting).order_by(AppSetting.section, AppSetting.key))
    return list(result.scalars().all())


@router.patch("/settings/{key}", response_model=SettingRead)
async def update_setting(
    key: str,
    payload: SettingUpdate,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(AppSetting).where(AppSetting.key == key))
    setting = result.scalar_one_or_none()
    if not setting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Setting not found")
    setting.value_json = payload.value_json
    if payload.min_val is not None:
        setting.min_val = payload.min_val
    if payload.max_val is not None:
        setting.max_val = payload.max_val
    if payload.step_val is not None:
        setting.step_val = payload.step_val
    await db.commit()
    await db.refresh(setting)
    return setting
