import uuid
from datetime import datetime
from pydantic import BaseModel


class BOMItemRead(BaseModel):
    areaLabel: str
    element: str
    totalLengthM: float | None = None
    qty: int
    productId: str | None = None
    partNumber: str | None = None
    name: str | None = None
    extraPct: str | None = None
    altGroup: int | None = None


class BOMRead(BaseModel):
    id: uuid.UUID
    projectId: uuid.UUID
    items: list[BOMItemRead]
    isStale: bool
    createdAt: datetime
    updatedAt: datetime


class BOMDeltasUpdate(BaseModel):
    """Payload for saving bomDeltas to project.data.step5.bomDeltas."""
    overrides: dict = {}
    additions: list = []
    alternatives: dict = {}


class BOMEffectiveRead(BaseModel):
    """Effective BOM = base items + deltas applied."""
    items: list[dict]
    createdAt: datetime
    updatedAt: datetime
