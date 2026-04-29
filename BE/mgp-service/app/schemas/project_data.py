"""
MGP Project Data Schema — format version 3.0
=============================================

The `data` JSONB column on the projects table.
Source of truth for all physical project data.
No pixel coordinates — physical measurements only (cm, mm, degrees).

Data ownership
--------------
  Each step writes ONLY to its own node (data.stepN).
  step2 — FE-owned: panel placement, area/trapezoid basic config
  step3 — mixed: FE-owned user settings + server-computed results
    FE-owned keys:   globalSettings, areaSettings, customBasesOffsets, customDiagonals
    Server-computed: computedAreas, computedTrapezoids
  step4 — server-owned: plan approval
  step5 — FE-owned: BOM user adjustments (bomDeltas)

Step locking
------------
  locked step 2 → set during panel placement; regenerated if step 1 changes
  locked step 3 → set during construction planning; regenerated if step 2 changes
  locked step 4 → plan approval; unlocked if step 3 changes
  locked step 5 → frozen BOM snapshot; regenerated if step 3 changes

Coordinate conventions
----------------------
  cm  — physical centimetres
  mm  — physical millimetres
  Depth — distance from rear edge (ridge side) toward front edge (eave side)
  lineIdx 0 = rearmost panel line; higher = toward eave
"""

from __future__ import annotations
from typing import Literal, Optional
from pydantic import BaseModel, ConfigDict, Field, field_validator


class _StrictBase(BaseModel):
    """Base for all project data models — silently drops unknown fields."""
    model_config = ConfigDict(extra='ignore')


# ── Step 2: Panel placement (FE-owned) ──────────────────────────────────────

class PanelGrid(_StrictBase):
    """
    Logical panel grid for one area.

    rows[lineIdx][colIdx] — cell code:
      'V'  real panel, portrait
      'H'  real panel, landscape
      'EV' ghost slot, portrait column
      'EH' ghost slot, landscape column

    lineIdx 0 = rearmost line (closest to ridge).
    rowPositions[lineIdx] = panel left-edge offsets in cm from area start corner.
    """
    startCorner: Literal['TL', 'TR', 'BL', 'BR']
    areaAngle: float = 0
    rows: list[list[str]]
    rowPositions: Optional[dict[str, list[float]]] = None


class PanelRowData(_StrictBase):
    """One panel row within an area. Each row has its own panel grid and
    physical mounting (angle/front-height). Row a/h is the source of truth;
    trap a/h is computed from the owning row."""
    rowIndex: int = 0
    panelGrid: Optional[PanelGrid] = None
    angleDeg: Optional[float] = None       # row-level mounting angle (deg)
    frontHeightCm: Optional[float] = None  # row-level front-edge height (cm)


class Step2Area(_StrictBase):
    """Basic area config set during panel placement. No computed data."""
    id: int                             # permanent numeric id, assigned by BE, never changes
    label: str                          # user-editable display label: 'A', 'B', 'C', …
    angleDeg: Optional[float] = None
    frontHeightCm: Optional[float] = None
    areaVertical: bool = False          # 90° rotated area (e.g. tile roof side faces)
    trapezoidIds: list[str] = Field(default_factory=list)
    panelRows: list[PanelRowData] = Field(default_factory=list)
    # Each entry = one drawn panel row; single-row area = list of length 1

    @field_validator("panelRows", mode="before")
    @classmethod
    def _strip_null_rows(cls, v):
        """JS sparse arrays serialize holes as null — drop them."""
        if isinstance(v, list):
            return [x for x in v if x is not None]
        return v
    # Per-area roof spec — only used when project.roof_spec.type == 'mixed'.
    # Shape matches RoofSpec (type / distanceBetweenPurlinsCm / installationOrientation).
    # When absent on a mixed project, the resolver defaults to concrete.
    roofSpec: Optional[dict] = None


class Step2Trapezoid(_StrictBase):
    """Basic trapezoid config detected during panel placement."""
    id: str
    angleDeg: float = 0
    frontHeightCm: float = 0
    lineOrientations: list[str] = Field(default_factory=lambda: ['vertical'])


class Step2Data(_StrictBase):
    """Panel placement — FE-owned, locked after step 2."""
    panelType: str = 'AIKO-G670-MCH72Mw'
    panelWidthCm: float | None = None
    panelLengthCm: float | None = None
    defaultAngleDeg: float = 0
    defaultFrontHeightCm: float = 0
    trapezoids: list[Step2Trapezoid] = Field(default_factory=list)
    areas: list[Step2Area] = Field(default_factory=list)


# ── Step 3: Construction planning ────────────────────────────────────────────

# Server-computed models (stored in step3.computedAreas / step3.computedTrapezoids)

class Rail(_StrictBase):
    """One physical rail computed by rail_service."""
    railId: str
    lineIdx: int
    offsetFromRearEdgeCm: float
    offsetFromLineFrontCm: float = 0
    startCm: float
    lengthCm: float
    roundedLengthCm: Optional[float] = None
    stockSegmentsMm: list[int]
    leftoverCm: float


class Base(_StrictBase):
    """One base beam position computed by base_service."""
    baseId: str
    trapezoidId: str
    offsetFromStartCm: float
    panelLineIdx: int
    startCm: float
    lengthCm: float


class ExternalDiagonal(_StrictBase):
    """Cross-brace connecting two adjacent base beams at a frame edge."""
    startBaseIdx: int               # area-wide index of start base (high end)
    endBaseIdx: int                 # area-wide index of end base (low end)
    startBaseOffsetCm: float        # offset along start base beam to connection point
    startBaseHeightCm: float        # installation height at start connection (leg height)
    endBaseOffsetCm: float          # offset along end base beam to connection point
    endBaseHeightCm: float          # installation height at end connection (0 = ground)
    horizMm: int                    # horizontal span between bases (mm)
    vertMm: int                     # vertical height difference (mm)
    diagLengthMm: int               # diagonal length = sqrt(horiz² + vert²) (mm)


class ComputedArea(_StrictBase):
    """Server-computed construction data for one area.

    rails/bases are keyed by panel row index (int) within the area.
    Single-row areas use key 0.
    """
    areaId: int                     # matches step2.areas[].id (permanent)
    label: str                      # matches step2.areas[].label (display)
    rails: dict[int, list[Rail]] = Field(default_factory=dict)
    # rowIndex → computed rails for that panel row
    bases: dict[int, list[Base]] = Field(default_factory=dict)
    # rowIndex → computed bases for that panel row
    diagonals: list[ExternalDiagonal] = Field(default_factory=list)
    numLargeGaps: int = 0


class ComputedTrapezoid(_StrictBase):
    """Server-computed structural details for one trapezoid."""
    trapezoidId: str                # matches step2.trapezoids key and Base.trapezoidId
    isFullTrap: bool = True         # False for trimmed sub-trapezoids (have empty EV/EH lines)
    geometry: dict = Field(default_factory=dict)
    # geometry keys:
    #   heightRear, heightFront          — structural leg heights (cm)
    #   topBeamLength, baseBeamLength    — slope / horizontal beam lengths (cm)
    #   baseLength                       — horizontal leg-to-leg span (cm)
    #   angle                            — tilt angle (degrees)
    #   panelFrontHeight                 — panel lower edge height from floor (cm, step2 input)
    #   panelRearHeightCm                — panel lower edge height at ridge side (cm)
    #   originCm                         — coordinate origin in global panel coords (cm)
    #   panelEdgeToFirstRailCm, panelEdgeToLastRailCm, railToRailCm, overhangCm
    #   beamThickCm, panelThickCm, blockHeightCm, blockLengthCm, crossRailHeightCm
    legs: list[dict] = Field(default_factory=list)
    # legs[]: positionCm, heightCm, railPositionCm (inner only); sorted by positionCm, first/last are outer
    blocks: list[dict] = Field(default_factory=list)
    # blocks[]: positionCm (left edge on base beam), isEnd, slopePositionCm
    # (slope length is identical for every block — derive on consumers as
    # geometry.blockLengthCm / cos(geometry.angle))
    punches: list[dict] = Field(default_factory=list)
    # punches[]: beamType ('base'|'slope'), positionCm, origin ('outerLeg'|'innerLeg'|'rail'|'diagonal'|'block')
    diagonals: list[dict] = Field(default_factory=list)
    # diagonals[]: spanIdx, topPct, botPct, lengthCm, isDouble, disabled


class Step3Data(_StrictBase):
    """Construction planning — mixed FE-owned settings + server-computed results."""
    # FE-owned (user settings)
    globalSettings: Optional[dict] = None
    areaSettings: Optional[dict] = None
    customBasesOffsets: Optional[dict] = None
    customDiagonals: Optional[dict] = None
    # Server-computed (never sent by FE, preserved during merge)
    computedAreas: list[ComputedArea] = Field(default_factory=list)
    computedTrapezoids: list[ComputedTrapezoid] = Field(default_factory=list)


# ── Step 4: Plan approval (server-owned) ─────────────────────────────────────

class ApprovalPerformedBy(_StrictBase):
    userId: str
    email: str
    fullName: str


class PlanApproval(_StrictBase):
    date: str               # ISO date string (YYYY-MM-DD)
    strictConsent: bool
    performedBy: ApprovalPerformedBy


class Step4Data(_StrictBase):
    """Plan approval step."""
    planApproval: Optional[PlanApproval] = None


# ── Step 5: BOM deltas (FE-owned) ───────────────────────────────────────────
#
# The computed BOM lives in its own table (project_bom) — not in the JSONB.
# Only user-made adjustments (bomDeltas) are stored here as lightweight data.

class Step5Data(_StrictBase):
    """BOM and PDF export step."""
    bomDeltas: Optional[dict] = None


# ── Root ──────────────────────────────────────────────────────────────────────

class ProjectData(_StrictBase):
    """
    Root schema for the `data` JSONB column.
    Source of truth for all physical project data.
    """
    version: Literal['3.0'] = '3.0'
    step2: Step2Data = Field(default_factory=Step2Data)
    step3: Step3Data = Field(default_factory=Step3Data)
    step4: Step4Data = Field(default_factory=Step4Data)
    step5: Step5Data = Field(default_factory=Step5Data)
