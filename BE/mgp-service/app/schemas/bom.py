import uuid
from datetime import datetime
from pydantic import BaseModel


class BOMItemRead(BaseModel):
    areaLabel: str
    element: str
    section: str | None = None           # logical section for grouping (e.g. 'trapezoids', 'diagonals_external')
    pieceLengthM: float | None = None    # length of one piece (length-bearing rows only)
    totalLengthM: float | None = None    # qty × pieceLengthM (length-bearing rows only)
    qty: int
    productId: str | None = None
    partNumber: str | None = None
    name: str | None = None
    extraPct: str | None = None
    altGroup: int | None = None
    # Set on rows derived from a bundle expansion. `bundleParent` is the
    # parent's effective type_key (post alt-resolution); the multiplier is
    # what was applied. UI nests the row under the parent and locks edits.
    bundleParent: str | None = None
    bundleMultiplier: int | None = None


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
