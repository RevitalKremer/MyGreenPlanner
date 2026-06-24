from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from itertools import groupby

from app.database import get_db
from app.models.product import Product, SADOT_EQUIPMENT_TYPES

router = APIRouter(prefix="/products", tags=["products"])


class PanelTypeRead(BaseModel):
    id: str
    type_key: str
    name: str
    # Dimensions / peak watts now live in params (lengthCm / widthCm / Wp);
    # still surfaced as these fields so the FE panelSpec shape is unchanged.
    length_cm: float | None = None
    width_cm: float | None = None
    kw_peak: int | None = None
    params: dict | None = None
    sadot_url: dict | None = None

    model_config = {"from_attributes": True}


@router.get("/panel-types", response_model=list[PanelTypeRead])
async def list_panel_types(db: AsyncSession = Depends(get_db)):
    """Return active panel products (public endpoint)."""
    result = await db.execute(
        select(Product)
        .where(
            Product.active == True,
            Product.product_type == 'panel',
        )
        .order_by(Product.name)
    )
    products = result.scalars().all()
    out = []
    for p in products:
        pr = p.params or {}
        out.append(PanelTypeRead(
            id=str(p.id),
            type_key=p.type_key,
            name=p.name,
            length_cm=pr.get('lengthCm'),
            width_cm=pr.get('widthCm'),
            kw_peak=pr.get('Wp'),
            params=p.params,
            sadot_url=p.sadot_url,
        ))
    return out


class MaterialRead(BaseModel):
    type_key: str
    name: str
    name_he: str | None = None
    part_number: str | None
    extra: str | None
    alt_group: int | None
    is_default: bool
    bundle: dict | None = None

    model_config = {"from_attributes": True}


@router.get("/materials", response_model=list[MaterialRead])
async def list_materials(db: AsyncSession = Depends(get_db)):
    """Return active construction material products (public endpoint).

    Excludes panels and Sadot Energy equipment (inverters/batteries/dongles)
    — those have their own catalog + electrical BOM stack."""
    result = await db.execute(
        select(Product)
        .where(
            Product.active == True,
            Product.product_type != 'panel',
            Product.product_type.notin_(SADOT_EQUIPMENT_TYPES),
        )
        .order_by(Product.name)
    )
    return list(result.scalars().all())


class SadotEquipmentRead(BaseModel):
    id: str
    type_key: str
    product_type: str          # 'inverter' | 'battery' | 'dongle' | …
    name: str
    name_he: str | None = None
    part_number: str | None = None
    price_ils: float | None = None
    params: dict | None = None
    sadot_url: dict | None = None

    model_config = {"from_attributes": True}


@router.get("/sadot-equipment", response_model=list[SadotEquipmentRead])
async def list_sadot_equipment(db: AsyncSession = Depends(get_db)):
    """Return active Sadot Energy equipment (inverters/batteries/dongles).

    Used by Step 6 (inverter selection) — the FE filters by product_type."""
    result = await db.execute(
        select(Product)
        .where(
            Product.active == True,
            Product.product_type.in_(SADOT_EQUIPMENT_TYPES),
        )
        .order_by(Product.product_type, Product.name)
    )
    products = result.scalars().all()
    return [
        SadotEquipmentRead(
            id=str(p.id),
            type_key=p.type_key,
            product_type=p.product_type,
            name=p.name,
            name_he=p.name_he,
            part_number=p.part_number,
            price_ils=p.price_ils,
            params=p.params,
            sadot_url=p.sadot_url,
        )
        for p in products
    ]


class AltMember(BaseModel):
    type_key: str
    name: str
    is_default: bool

class AltGroup(BaseModel):
    alt_group: int
    members: list[AltMember]


@router.get("/alt-groups", response_model=list[AltGroup])
async def list_alt_groups(db: AsyncSession = Depends(get_db)):
    """Return all active material products that belong to an alt_group."""
    result = await db.execute(
        select(Product)
        .where(
            Product.active == True,
            Product.product_type != 'panel',
            Product.alt_group.is_not(None),
        )
        .order_by(Product.alt_group, Product.is_default.desc(), Product.name)
    )
    products = result.scalars().all()
    groups = []
    for alt_group_id, members in groupby(products, key=lambda p: p.alt_group):
        groups.append(AltGroup(
            alt_group=alt_group_id,
            members=[AltMember(type_key=p.type_key, name=p.name, is_default=p.is_default) for p in members],
        ))
    return groups
