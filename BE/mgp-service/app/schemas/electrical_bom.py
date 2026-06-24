import uuid
from datetime import datetime
from pydantic import BaseModel


class ElectricalBOMItemRead(BaseModel):
    areaLabel: str                       # 'System' for project-wide equipment
    element: str                         # product type_key (or synthetic key)
    section: str | None = None           # 'inverter' | 'battery' | 'cable' | …
    qty: float
    productId: str | None = None
    partNumber: str | None = None
    name: str | None = None
    nameHe: str | None = None
    priceIls: float | None = None
    sadotUrl: str | None = None


class ElectricalBOMRead(BaseModel):
    id: uuid.UUID
    projectId: uuid.UUID
    items: list[ElectricalBOMItemRead]
    isStale: bool
    createdAt: datetime
    updatedAt: datetime


class ElectricalBOMDeltasUpdate(BaseModel):
    """Payload for saving electrical bomDeltas to project.data.step9.bomDeltas."""
    overrides: dict = {}
    additions: list = []
    alternatives: dict = {}


class ElectricalBOMEffectiveRead(BaseModel):
    items: list[dict]
    createdAt: datetime
    updatedAt: datetime
