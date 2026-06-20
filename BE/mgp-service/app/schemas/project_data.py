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
    # 2D offset of this sub-row's V0 from the PARENT area's V0, decomposed
    # along the area's row-axis and slope-axis (cm). Both are 0 for the
    # anchor sub-row. Non-anchor sub-rows of multi-row areas carry these so
    # cross-row concat can:
    #   - translate per-sub-row startCm into absolute row-axis positions
    #     (rowAxisOffsetCm) for adjacency math
    #   - distinguish sub-rows at different physical slope positions
    #     (slopeAxisOffsetCm) even when they happen to share frontHeightCm
    # Without slopeAxisOffsetCm two manually-drawn rows at the same
    # frontHeightCm but different physical Y would wrongly bucket as one
    # slope-Y level.
    rowAxisOffsetCm: float = 0
    slopeAxisOffsetCm: float = 0


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
    # Optional — null = "not set". FE Step 2 strict mode requires explicit
    # per-row a/h before advancing, so unfilled global defaults stay null.
    defaultAngleDeg: Optional[float] = None
    defaultFrontHeightCm: Optional[float] = None
    trapezoids: list[Step2Trapezoid] = Field(default_factory=list)
    areas: list[Step2Area] = Field(default_factory=list)


# ── Step 3: Construction planning ────────────────────────────────────────────

# Server-computed models (stored in step3.computedAreas / step3.computedTrapezoids)

class Rail(_StrictBase):
    """One physical rail computed by rail_service.

    The first block of fields is intentionally shared with `CrossRowRail` so
    both rail types can be consumed uniformly. Rail-specific fields follow.
    """
    # ── shared with CrossRowRail ──────────────────────────────────────────
    railId: str
    startCm: float
    lengthCm: float
    offsetFromLineFrontCm: float = 0
    offsetFromRearEdgeCm: float
    roundedLengthCm: Optional[float] = None
    stockSegmentsMm: list[int]
    leftoverCm: float
    # Absolute (parent-frame) span along the area's row-axis. For per-row rails
    # set only on virtual source rails (anchor V0 as origin). For CRs always
    # set (since CR coords are already in parent-frame).
    absStartCm: Optional[float] = None
    absEndCm: Optional[float] = None
    # ── Rail-specific ─────────────────────────────────────────────────────
    lineIdx: int
    # When set, this rail was absorbed into an area-level CrossRowRail with
    # this ID. The FE fades it visually and the material summary skips it.
    crrId: Optional[str] = None
    # Mirror of `crrId` — True iff this rail has been replaced by a cross-row
    # rail. Kept as a separate flag for cheap renderer / aggregator checks
    # (no string lookups).
    virtual: bool = False


class CrossRowRail(_StrictBase):
    """Rail formed by concatenating aligned rails from multiple sibling sub-rows
    of the same area. Lives at the area level (not keyed by panelRowIdx) since
    it spans across sub-rows.

    Provenance (which per-row rails were absorbed) lives on the source rails
    themselves via `Rail.crrId` — no separate sourceRails array needed.
    Resolve sources by filtering `ComputedArea.rails[*]` where `crrId == railId`.

    The first block of fields mirrors `Rail`. CR-specific fields follow.
    """
    # ── shared with Rail ──────────────────────────────────────────────────
    railId: str
    startCm: float
    lengthCm: float
    offsetFromLineFrontCm: float = 0
    offsetFromRearEdgeCm: float = 0
    roundedLengthCm: Optional[float] = None
    stockSegmentsMm: list[int]
    leftoverCm: float
    absStartCm: Optional[float] = None
    absEndCm: Optional[float] = None
    # ── CR-specific ───────────────────────────────────────────────────────
    slopeYCm: float                          # absolute slope-axis position within the area
    areaAngleDeg: float = 0                  # screen rotation of the source rails (whole degrees)
    mountAngleDeg: float = 0                 # mounting tilt of the source rails (0.1° resolution)


class Base(_StrictBase):
    """One base beam position computed by base_service.

    For concrete / iskurit / insulated-panel areas this is a physical base
    beam owned by a trapezoid. For tile-roof areas the same struct doubles
    as a *virtual* hook line — `trapezoidId` is None and `hookOffsets`
    holds the per-rail intersection positions along the line.
    """
    baseId: str
    trapezoidId: Optional[str] = None
    offsetFromStartCm: float
    panelLineIdx: int
    startCm: float
    lengthCm: float
    hookOffsets: list[float] = Field(default_factory=list)
    # Position of each rail along this base, measured from `startCm`.
    # Populated only for tile-roof areas.
    # Variation identity is encoded directly in `trapezoidId`:
    #   "A1"    → parent trap, default extension (index 0 of parent's geometry.extensions)
    #   "A1.N"  → variation N of parent A1 (index N of parent's geometry.extensions)
    # Bases for default-extension panels use the parent string ("A1"); bases on
    # user-created variations use the dotted form ("A1.1", "A1.2", ...).
    # Parse with split('.', 1) to recover (parent, idx); see trapExtensionService.ts.


class ExternalDiagonal(_StrictBase):
    """Cross-brace connecting two adjacent base beams at a frame edge."""
    # Owning panel-row index within the area. Required for multi-row areas
    # so the FE knows which row's bases the start/endBaseIdx refer to —
    # without it, idx=0 ambiguously matches every row's first base and
    # diagonals get rendered against the wrong row. Defaults to 0 for
    # legacy single-row data that never carried the field.
    panelRowIdx: int = 0
    startBaseIdx: int               # row-relative index of start base (high end)
    endBaseIdx: int                 # row-relative index of end base (low end)
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
    crossRowRails: list[CrossRowRail] = Field(default_factory=list)
    # Area-level rails formed by concatenating aligned rails across sibling sub-rows.
    bases: dict[int, list[Base]] = Field(default_factory=dict)
    # rowIndex → computed bases for that panel row
    diagonals: list[ExternalDiagonal] = Field(default_factory=list)
    numLargeGaps: int = 0


class TrapExtension(_StrictBase):
    """One front/back base-beam extension variant on a trapezoid.

    Stored append-only inside `ComputedTrapezoid.geometry["extensions"]`.
    Index 0 is always the trap's BE-computed default (zero for concrete and
    parallel-purlin roofs; non-zero for iskurit / insulated_panel with
    `perpendicular` orientation). Indices 1..N are user-created alternatives,
    appended in change order — never reordered, never re-indexed. Bases
    identify their variation through `Base.trapezoidId` ("A1" → idx 0,
    "A1.N" → idx N).

    This Pydantic model documents the dict shape and is also used directly in
    the wire schema for `TrapExtend` ops (SaveTabRequest.overrides.traps).
    """
    frontExtMm: float = 0
    backExtMm: float = 0


class ComputedTrapezoid(_StrictBase):
    """Server-computed structural details for one trapezoid."""
    trapezoidId: str                # matches step2.trapezoids key and Base.trapezoidId
    # Sub-trap variation parent. Set to the parent's trapezoidId (e.g.
    # "A") for variation entries ("A.1", "A.2", …); omitted on parent
    # / standalone traps. Variation entries carry their own
    # legs/blocks/punches/diagonals reflecting the extended base beam;
    # downstream consumers (Detail view, BOM, PDF) treat them like
    # normal traps. The parent reference lets the FE group variations
    # under their parent in the sidebar tree and propagate parent-
    # level setting changes to all variations.
    parentId: Optional[str] = None
    isFullTrap: bool = True         # False for trimmed sub-trapezoids (have empty EV/EH lines)
    # Index of the panelRow this trap lives in within its owning area — surfaced
    # so the FE can fetch the correct per-row rails when rendering the trap.
    panelRowIdx: int = 0
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
    #   baseBeamSegments, topBeamSegments — present only when a beam is longer than
    #                                      the largest angleProfileStockLengths and is
    #                                      cut into spliced pieces. list[dict]:
    #                                      {idx, startCm, endCm, lengthCm, lengthMm,
    #                                       jointAtFrontCm?(non-final)}. Absent ⇒ single
    #                                      piece. Coords are the beam's rear->front frame
    #                                      (same as punches[].positionCm).
    #   baseBeamConnectorCount, topBeamConnectorCount — len(segments)-1 (joints needing a
    #                                      splice connector); absent ⇒ 0.
    #   extensions                       — list[TrapExtension] (dict form: {frontExtMm, backExtMm}).
    #                                      Index 0 is the trap's BE-default base-beam extension
    #                                      (zero for concrete & parallel-purlin; non-zero for
    #                                      iskurit/insulated_panel perpendicular). Indices 1..N
    #                                      are user-created variations, append-only. Bases
    #                                      identify their variation via Base.trapezoidId
    #                                      ("A1" → idx 0, "A1.N" → idx N).
    legs: list[dict] = Field(default_factory=list)
    # legs[]: positionCm, heightCm, railPositionCm (inner only); sorted by positionCm, first/last are outer
    blocks: list[dict] = Field(default_factory=list)
    # blocks[]: positionCm (left edge on base beam), isEnd, slopePositionCm
    # (slope length is identical for every block — derive on consumers as
    # geometry.blockLengthCm / cos(geometry.angle))
    punches: list[dict] = Field(default_factory=list)
    # punches[]: beamType ('base'|'slope'), positionCm, origin ('outerLeg'|'innerLeg'|'rail'|'diagonal'|'block'|'connector')
    #   'connector' = splice bolt hole at a spliced-beam joint (2 per joint, one per piece).
    #   On spliced beams every punch also carries: segmentIdx (which physical piece) and
    #   piecePositionCm (position from that piece's rear end). Absent ⇒ segmentIdx 0, piecePositionCm == positionCm.
    diagonals: list[dict] = Field(default_factory=list)
    # diagonals[]: spanIdx, topDistFromLegCm, botDistFromLegCm, punchSpanCm (server-computed), lengthCm, isDouble, disabled


class TrapezoidGroup(_StrictBase):
    """A set of trapezoids whose materialized shape is identical.

    Built by `trapezoid_detail_service.group_identical_trapezoids` at the end
    of the trap-generation flow. Consumed by the PDF generator to render one
    page per distinct shape (e.g. groupIdx=0, trapIds=['A','B']).
    """
    groupIdx: int
    trapIds: list[str]


class Step3Data(_StrictBase):
    """Construction planning — mixed FE-owned settings + server-computed results."""
    # FE-owned (user settings)
    globalSettings: Optional[dict] = None
    areaSettings: Optional[dict] = None
    customBasesOffsets: Optional[dict] = None
    customDiagonals: Optional[dict] = None
    # User overrides for block positions, keyed by trapezoidId (concrete roofs only).
    # Shape: `{ trapId: [{ positionCm: float, isEnd: bool }, …] }`.
    # When set for a trap, `_compute_block_positions` skips BE placement and
    # uses this list verbatim. `slopePositionCm` is re-derived per compute.
    # `isEnd=true` (structural) blocks cannot be deleted by the user and are
    # constrained to remain the outermost on drag (enforced FE-side).
    customBlocks: Optional[dict] = None
    # User-created trap base-beam variations, keyed by parent trapezoidId.
    # Entries are USER additions only — index 0 (BE default) lives on each
    # ComputedTrapezoid.geometry.extensions[0] and is recomputed per pass.
    # The combined emitted list = [BE default] + trapExtensions[parent].
    # Persisted across saves; cleared by reset.
    trapExtensions: Optional[dict[str, list[TrapExtension]]] = None
    # Per-base variation assignment, parallel to `customBasesOffsets`:
    # `{ "{parentTrapId}:{rowIdx}": [extensionIdx, …] }`. The i-th value
    # is the variation idx for the i-th offset in the matching
    # customBasesOffsets entry — slot-based so add/delete-driven
    # baseId renumbering can't orphan a variation reference. idx 0 =
    # parent default; idx N > 0 = trapExtensions[parent][N-1].
    # `_apply_persisted_position_overrides` loads it onto each base as
    # `extensionIdx`, then `_apply_base_extensions` surfaces it onto
    # `trapezoidId` + `startCm` / `lengthCm`.
    customBaseVariations: Optional[dict[str, list[int]]] = None
    # Legacy sparse map: `{ areaId(str): { baseId: idx } }`. Kept for
    # one-release backward compatibility — projects saved before
    # customBaseVariations existed still read this on first compute and
    # migrate forward. New writes go to customBaseVariations only.
    baseVariations: Optional[dict[str, dict[str, int]]] = None
    # Server-computed (never sent by FE, preserved during merge)
    computedAreas: list[ComputedArea] = Field(default_factory=list)
    computedTrapezoids: list[ComputedTrapezoid] = Field(default_factory=list)
    trapezoidGroups: list[TrapezoidGroup] = Field(default_factory=list)


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
