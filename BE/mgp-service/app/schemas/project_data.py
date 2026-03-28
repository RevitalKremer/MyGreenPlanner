"""
MGP Project Data Schema — format version 2.0
=============================================

The `data` JSONB column on the projects table.
Source of truth for all physical project data.
No pixel coordinates — physical measurements only (cm, mm, degrees).

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


# ── Global settings ───────────────────────────────────────────────────────────

class GlobalSettings(BaseModel):
    stockLengths: list[int] = Field(default_factory=lambda: [6000, 4200, 3000])
    # Available rail stock lengths (mm), longest first
    crossRailEdgeDistMm: float = 40
    # Rail profile thickness used for rendering (mm)


# ── Project settings ──────────────────────────────────────────────────────────

class ProjectSettings(BaseModel):
    name: str
    location: Optional[str] = None
    panelType: str = 'AIKO-G670-MCH72Mw'
    panelWidthCm: float = 113.4     # short side (portrait width / landscape height)
    panelLengthCm: float = 238.2    # long side  (portrait height / landscape width)
    globalSettings: GlobalSettings = Field(default_factory=GlobalSettings)


# ── Trapezoids (locked step 2) ────────────────────────────────────────────────

class TrapezoidSettings(BaseModel):
    angleDeg: float = 0             # panel tilt from horizontal
    frontHeightCm: float = 0        # eave-edge mounting height (cm)
    edgeOffsetMm: float = 300       # distance from frame edge to first/last base (mm)
    spacingMm: float = 2000         # max spacing between bases (mm)
    baseOverhangCm: float = 15      # base extension beyond rear/front rail (cm)
    lineRails: dict[str, list[float]] = Field(default_factory=dict)
    # str(lineIdx) → [offsetFromRearEdgeCm, ...]
    # Input: user-configured rail positions within each panel line


class Block(BaseModel):
    """Mounting block position along a base beam. Same for all bases in the trapezoid."""
    depthCm: float          # distance from rear edge to block centre


class Punch(BaseModel):
    """Punch hole position along a base beam. Same for all bases in the trapezoid."""
    depthCm: float          # distance from rear edge to punch centre
    punchOffsetCm: float    # offset from block edge to punch hole centre


class Trapezoid(BaseModel):
    """
    One trapezoid shape. Keyed by trapezoid ID (e.g. 'A', 'A1', 'B2').
    May be referenced by multiple areas (shared config).
    """
    id: str
    settings: TrapezoidSettings = Field(default_factory=TrapezoidSettings)
    blocks: list[Block] = Field(default_factory=list)   # locked step 3
    punches: list[Punch] = Field(default_factory=list)  # locked step 3


# ── Panel grid (locked step 2) ────────────────────────────────────────────────

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
    # str(lineIdx) → [offsetCm, ...]


# ── Area settings (locked step 2) ─────────────────────────────────────────────

class AreaSettings(BaseModel):
    label: str                          # 'A', 'B', 'C', …
    angleDeg: Optional[float] = None    # default for trapezoids in this area
    frontHeightCm: Optional[float] = None
    trapezoidIds: list[str] = Field(default_factory=list)
    # Ordered list of trapezoid IDs belonging to this area


# ── Rails (locked step 3) ─────────────────────────────────────────────────────

class Rail(BaseModel):
    """
    One physical rail computed by computeRowRailLayout().
    Output — derived from lineRails + railOverhangCm + stockLengths.
    """
    railId: str                                     # 'R1', 'R2', …
    lineIdx: int
    offsetFromRearEdgeCm: float                     # position within its panel line
    orientation: Literal['PORTRAIT', 'LANDSCAPE']
    lengthMm: int                                   # total span including overhang
    stockSegments: list[int]                        # cut lengths (mm), greedy largest-first
    leftoverMm: int                                 # total waste mm


# ── Bases (locked step 3) ─────────────────────────────────────────────────────

class Base(BaseModel):
    """
    One base beam position computed by computeAreaBasesData().
    offsetFromStartCm is measured from the area's start corner.
    topDepthCm / bottomDepthCm are measured from the rear edge.
    """
    baseId: str                     # 'B1', 'B2', …
    trapezoidId: str                # which trapezoid this base belongs to
    offsetFromStartCm: float        # horizontal position from area start corner
    topDepthCm: float               # depth of base top edge (rear side)
    bottomDepthCm: float            # depth of base bottom edge (front side)
    lengthCm: float                 # physical beam length = bottomDepth − topDepth


# ── Diagonals (locked step 3) ─────────────────────────────────────────────────

class Diagonal(BaseModel):
    """Cross-brace connecting two adjacent base beams within an area."""
    fromBaseId: str
    toBaseId: str
    horizMm: int        # horizontal distance between the two bases
    vertMm: int         # vertical height difference (from RC heights)
    diagLengthMm: int   # 3D length = sqrt(horiz² + vert²)


# ── Area ──────────────────────────────────────────────────────────────────────

class Area(BaseModel):
    settings: AreaSettings                              # locked step 2
    panelGrid: Optional[PanelGrid] = None               # locked step 2
    rails: list[Rail] = Field(default_factory=list)     # locked step 3
    bases: list[Base] = Field(default_factory=list)     # locked step 3
    diagonals: list[Diagonal] = Field(default_factory=list)  # locked step 3


# ── Plan Approval (locked step 4) ────────────────────────────────────────────

class ApprovalPerformedBy(BaseModel):
    """The logged-in user who clicked Approve in the UI (auto-captured)."""
    userId: str             # UUID string of the authenticated user
    email: str
    fullName: str


class PlanApproval(BaseModel):
    """
    Constructor's sign-off before BOM and PDF generation.
    Two identities are recorded:
      - constructorName: manually entered by the user (the certified installer)
      - performedBy: auto-captured from the logged-in account
    Once set, the app allows proceeding to step 5 (BOM/PDF).
    """
    date: str               # ISO date string (YYYY-MM-DD)
    strictConsent: bool     # "I have reviewed and take full responsibility"
    performedBy: ApprovalPerformedBy  # logged-in user who submitted the approval


class Step4Data(BaseModel):
    """Plan approval step."""
    planApproval: Optional[PlanApproval] = None


# ── BOM (locked step 5) ───────────────────────────────────────────────────────

class BOMItem(BaseModel):
    itemId: str
    description: str
    unit: str           # 'pcs', 'm', 'kg', …
    quantity: float


class BOM(BaseModel):
    """
    Frozen BOM snapshot — source of truth for quotation.
    Regenerated when step 3 changes; frozen when user advances to step 5.
    bomDeltas store manual quantity adjustments on top of the computed items.
    """
    items: list[BOMItem] = Field(default_factory=list)
    bomDeltas: dict[str, float] = Field(default_factory=dict)
    # itemId → quantity adjustment (positive = add, negative = remove)


class Step5Data(BaseModel):
    """BOM and PDF export step."""
    bom: Optional[BOM] = None


# ── Root ──────────────────────────────────────────────────────────────────────

class ProjectData(BaseModel):
    """
    Root schema for the `data` JSONB column.
    Source of truth for all physical project data.
    """
    version: Literal['2.0'] = '2.0'
    settings: ProjectSettings = Field(default_factory=ProjectSettings)
    trapezoids: dict[str, Trapezoid] = Field(default_factory=dict)
    # trapezoidId → Trapezoid
    areas: list[Area] = Field(default_factory=list)
    step4: Step4Data = Field(default_factory=Step4Data)   # plan approval
    step5: Step5Data = Field(default_factory=Step5Data)   # BOM / PDF
