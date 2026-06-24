from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.electrical_regulation import ElectricalRegulation

router = APIRouter(prefix="/electrical-regulations", tags=["electrical"])


class RegulationRead(BaseModel):
    key: str
    name_en: str
    name_he: str
    description_en: str | None = None
    description_he: str | None = None
    min_kw_ac: float | None = None
    max_kw_ac: float | None = None

    model_config = {"from_attributes": True}


@router.get("", response_model=list[RegulationRead])
async def list_regulations(db: AsyncSession = Depends(get_db)):
    """Active Israel grid regulatory tracks, ordered (public, no tariff data)."""
    result = await db.execute(
        select(ElectricalRegulation)
        .where(ElectricalRegulation.active == True)
        .order_by(ElectricalRegulation.display_order)
    )
    return list(result.scalars().all())
