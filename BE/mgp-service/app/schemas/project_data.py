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
    FE-owned keys:   globalSettings, areaSettings, basesCustomOffsets, customDiagonals
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
from pydantic import BaseModel, Field


# ── Step 2: Panel placement (FE-owned) ──────────────────────────────────────

class PanelGrid(BaseModel):
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


class Step2Area(BaseModel):
    """Basic area config set during panel placement. No computed data."""
    label: str                          # 'A', 'B', 'C', …
    angleDeg: Optional[float] = None
    frontHeightCm: Optional[float] = None
    trapezoidIds: list[str] = Field(default_factory=list)
    panelGrid: Optional[PanelGrid] = None


class Step2Trapezoid(BaseModel):
    """Basic trapezoid config detected during panel placement."""
    angleDeg: float = 0
    frontHeightCm: float = 0
    linesPerRow: int = 1
    lineOrientations: list[str] = Field(default_factory=lambda: ['vertical'])


class Step2Data(BaseModel):
    """Panel placement — FE-owned, locked after step 2."""
    panelType: str = 'AIKO-G670-MCH72Mw'
    panelWidthCm: float = 113.4
    panelLengthCm: float = 238.2
    defaultAngleDeg: float = 0
    defaultFrontHeightCm: float = 0
    trapezoids: dict[str, Step2Trapezoid] = Field(default_factory=dict)
    areas: list[Step2Area] = Field(default_factory=list)


# ── Step 3: Construction planning ────────────────────────────────────────────

# Server-computed models (stored in step3.computedAreas / step3.computedTrapezoids)

class Rail(BaseModel):
    """One physical rail computed by rail_service."""
    railId: str
    lineIdx: int
    offsetFromRearEdgeCm: float
    offsetFromLineFrontCm: float = 0
    startCm: float
    endCm: float
    lengthMm: int
    stockSegments: list[int]
    leftoverMm: int


class Base(BaseModel):
    """One base beam position computed by base_service."""
    baseId: str
    trapezoidId: str
    offsetFromStartCm: float
    topDepthCm: float
    bottomDepthCm: float
    lengthCm: float


class Diagonal(BaseModel):
    """Cross-brace connecting two adjacent base beams within an area."""
    fromBaseId: str
    toBaseId: str
    horizMm: int
    vertMm: int
    diagLengthMm: int


class ComputedArea(BaseModel):
    """Server-computed construction data for one area."""
    label: str                      # matches step2.areas[].label
    rails: list[Rail] = Field(default_factory=list)
    bases: list[Base] = Field(default_factory=list)
    diagonals: list[Diagonal] = Field(default_factory=list)
    numLargeGaps: int = 0


class ComputedTrapezoid(BaseModel):
    """Server-computed structural details for one trapezoid."""
    trapezoidId: str                # matches step2.trapezoids key and Base.trapezoidId
    geometry: dict = Field(default_factory=dict)
    # geometry keys:
    #   heightRear, heightFront          — structural leg heights (cm)
    #   topBeamLength, baseBeamLength    — slope / horizontal beam lengths (cm)
    #   baseLength                       — horizontal leg-to-leg span (cm)
    #   diagonalLength                   — simplified diagonal length (cm)
    #   angle                            — tilt angle (degrees)
    #   panelFrontHeight                 — panel lower edge height from floor (cm, step2 input)
    #   panelRearHeightCm                — panel lower edge height at ridge side (cm)
    #   originCm                         — coordinate origin in global panel coords (cm)
    #   panelEdgeToFirstRailCm, panelEdgeToLastRailCm, railToRailCm, overhangCm
    #   beamThickCm, panelThickCm, blockHeightCm, blockLengthCm, crossRailHeightCm
    legs: list[dict] = Field(default_factory=list)
    # legs[]: positionCm, heightCm, isInner, side, railPositionCm (inner only)
    blocks: list[dict] = Field(default_factory=list)
    # blocks[]: positionCm (left edge on base beam), isEnd, slopePositionCm, slopeLengthCm
    punches: list[dict] = Field(default_factory=list)
    # punches[]: beamType ('base'|'slope'), positionCm
    diagonals: list[dict] = Field(default_factory=list)
    # diagonals[]: spanIdx, topPct, botPct, lengthCm, isDouble, disabled


class Step3Data(BaseModel):
    """Construction planning — mixed FE-owned settings + server-computed results."""
    # FE-owned (user settings)
    globalSettings: Optional[dict] = None
    areaSettings: Optional[dict] = None
    basesCustomOffsets: Optional[dict] = None
    customDiagonals: Optional[dict] = None
    # Server-computed (never sent by FE, preserved during merge)
    computedAreas: list[ComputedArea] = Field(default_factory=list)
    computedTrapezoids: list[ComputedTrapezoid] = Field(default_factory=list)


# ── Step 4: Plan approval (server-owned) ─────────────────────────────────────

class ApprovalPerformedBy(BaseModel):
    userId: str
    email: str
    fullName: str


class PlanApproval(BaseModel):
    date: str               # ISO date string (YYYY-MM-DD)
    strictConsent: bool
    performedBy: ApprovalPerformedBy


class Step4Data(BaseModel):
    """Plan approval step."""
    planApproval: Optional[PlanApproval] = None


# ── Step 5: BOM deltas (FE-owned) ───────────────────────────────────────────
#
# The computed BOM lives in its own table (project_bom) — not in the JSONB.
# Only user-made adjustments (bomDeltas) are stored here as lightweight data.

class Step5Data(BaseModel):
    """BOM and PDF export step."""
    bomDeltas: Optional[dict] = None


# ── Root ──────────────────────────────────────────────────────────────────────

class ProjectData(BaseModel):
    """
    Root schema for the `data` JSONB column.
    Source of truth for all physical project data.
    """
    version: Literal['3.0'] = '3.0'
    step2: Step2Data = Field(default_factory=Step2Data)
    step3: Step3Data = Field(default_factory=Step3Data)
    step4: Step4Data = Field(default_factory=Step4Data)
    step5: Step5Data = Field(default_factory=Step5Data)
