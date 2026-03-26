from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from itertools import groupby

from app.database import get_db
from app.models.product import Product

router = APIRouter(prefix="/products", tags=["products"])


class PanelTypeRead(BaseModel):
    id: str
    type_key: str
    name: str
    length_cm: float
    width_cm: float
    kw_peak: int

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
    return [
        PanelTypeRead(
            id=str(p.id),
            type_key=p.type_key,
            name=p.name,
            length_cm=p.length_cm,
            width_cm=p.width_cm,
            kw_peak=p.kw_peak,
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
            Product.product_type == 'material',
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
