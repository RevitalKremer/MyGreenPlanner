/**
 * MGP Project Data Schema — format version 3.0
 *
 * TypeScript mirror of BE/mgp-service/app/schemas/project_data.py
 * Keep in sync — the BE Pydantic schema is the source of truth.
 *
 * Coordinate conventions:
 *   cm  — physical centimetres
 *   mm  — physical millimetres
 *   Depth — distance from rear edge (ridge side) toward front edge (eave side)
 *   lineIdx 0 = rearmost panel line; higher = toward eave
 */

// ── Step 2: Panel placement (FE-owned) ──────────────────────────────────────

export type CellCode = 'V' | 'H' | 'EV' | 'EH'
export type StartCorner = 'TL' | 'TR' | 'BL' | 'BR'

export interface PanelGrid {
  startCorner: StartCorner
  areaAngle: number
  rows: CellCode[][]
  rowPositions?: Record<string, number[]> | null
}

export interface PanelRowData {
  rowIndex: number
  panelGrid?: PanelGrid | null
  angleDeg?: number | null
  frontHeightCm?: number | null
}

export interface RoofSpec {
  type: string
  distanceBetweenPurlinsCm?: number
  installationOrientation?: string
}

export interface Step2Area {
  id: number
  label: string
  angleDeg?: number | null
  frontHeightCm?: number | null
  areaVertical?: boolean
  trapezoidIds: string[]
  panelRows: PanelRowData[]
  roofSpec?: RoofSpec | null
}

export interface Step2Trapezoid {
  id: string
  angleDeg: number
  frontHeightCm: number
  lineOrientations: string[]
}

export interface Step2Data {
  panelType: string
  panelWidthCm?: number | null
  panelLengthCm?: number | null
  defaultAngleDeg: number | null
  defaultFrontHeightCm: number | null
  trapezoids: Step2Trapezoid[]
  areas: Step2Area[]
}

// ── Step 3: Construction planning ───────────────────────────────────────────

/**
 * The first block of fields is intentionally shared with `CrossRowRail` so
 * consumers can treat both rail types uniformly. Rail-specific fields follow.
 */
export interface Rail {
  // ── shared with CrossRowRail ──────────────────────────────────────────
  railId: string
  startCm: number
  lengthCm: number
  offsetFromLineFrontCm: number
  offsetFromRearEdgeCm: number
  roundedLengthCm?: number | null
  stockSegmentsMm: number[]
  leftoverCm: number
  /** Absolute (parent-frame) span along the area's row-axis. Set only on
   * virtual source rails (per-row); always set on CRs (where coords are
   * already in parent-frame). */
  absStartCm?: number | null
  absEndCm?: number | null
  // ── Rail-specific ─────────────────────────────────────────────────────
  lineIdx: number
  /**
   * When set, this rail has been absorbed into an area-level CrossRowRail
   * with this ID — it's a source of that CR. The rail is preserved in per-row
   * data so the FE can reconstruct the cross-row span, but it should be faded
   * in the canvas and skipped by material summaries.
   */
  crrId?: string | null
  /** Mirror of `crrId !== null` — true iff this rail is virtual (absorbed by
   * a cross-row rail). Kept as a separate flag for cheap checks. */
  virtual?: boolean
}

/**
 * Rail formed by concatenating aligned rails across sibling sub-rows of the
 * same area. Lives at the area level (not keyed by panelRowIdx). Provenance
 * is one-way: find the source rails by filtering per-row `Rail[]` where
 * `crrId === cr.railId`.
 *
 * The first block of fields mirrors `Rail`. CR-specific fields follow.
 */
export interface CrossRowRail {
  // ── shared with Rail ──────────────────────────────────────────────────
  railId: string
  startCm: number
  lengthCm: number
  offsetFromLineFrontCm: number
  offsetFromRearEdgeCm: number
  roundedLengthCm?: number | null
  stockSegmentsMm: number[]
  leftoverCm: number
  absStartCm?: number | null
  absEndCm?: number | null
  // ── CR-specific ───────────────────────────────────────────────────────
  slopeYCm: number                      // area-frame slope-axis position
  areaAngleDeg?: number                 // screen rotation of the source rails (whole deg)
  mountAngleDeg?: number                // mounting tilt of the source rails (0.1° resolution)
}

export interface Base {
  baseId: string
  // Encodes the variation: "A1" = parent (default extension, idx 0);
  // "A1.N" = variation N. Parse with parseVariationTrapId() in
  // trapExtensionService.ts to recover (parentTrapId, idx).
  trapezoidId: string
  offsetFromStartCm: number
  panelLineIdx: number
  startCm: number
  lengthCm: number
}

export interface ExternalDiagonal {
  startBaseIdx: number
  endBaseIdx: number
  startBaseOffsetCm: number
  startBaseHeightCm: number
  endBaseOffsetCm: number
  endBaseHeightCm: number
  horizMm: number
  vertMm: number
  diagLengthMm: number
}

export interface TrapezoidGeometry {
  heightRear: number
  heightFront: number
  topBeamLength: number
  baseBeamLength: number
  baseLength: number
  angle: number
  panelFrontHeight: number
  panelRearHeightCm: number
  originCm: number
  panelEdgeToFirstRailCm: number
  panelEdgeToLastRailCm: number
  railToRailCm: number
  overhangCm: number
  beamThickCm: number
  panelThickCm: number
  crossRailHeightCm: number
  punchOverlapMarginCm: number
  punchInnerOffsetCm: number
  blockHeightCm?: number
  blockLengthCm?: number
  blockPunchCm?: number
  // Base-beam extension variants for this trap. [0] is the BE-default
  // extension (zero for concrete & parallel-purlin roofs; non-zero for
  // iskurit / insulated_panel perpendicular). [1..] are user-created
  // variations from Step 3 extend ops. Bases identify their variation via
  // `Base.trapezoidId` ("A1" → idx 0, "A1.N" → idx N). See
  // trapExtensionService.ts for helpers.
  extensions?: TrapExtension[]
  // Spliced-beam pieces — present only when a beam exceeds the largest
  // angleProfileStockLengths and is cut into multiple pieces (butt-joined,
  // bridged by an angle connector). Absent ⇒ single piece. Coordinates are in
  // the beam's rear→front frame (same as Punch.positionCm).
  baseBeamSegments?: BeamSegment[]
  topBeamSegments?: BeamSegment[]
  // Number of splice joints (= segments − 1) per beam; absent ⇒ 0.
  baseBeamConnectorCount?: number
  topBeamConnectorCount?: number
}

export interface BeamSegment {
  idx: number
  startCm: number
  endCm: number
  lengthCm: number
  lengthMm: number
  jointAtFrontCm?: number   // present on every non-final segment
}

export interface TrapExtension {
  frontExtMm: number
  backExtMm: number
}

export interface Leg {
  positionCm: number
  positionEndCm: number
  heightCm: number
  isDouble: boolean
  railPositionCm?: number
  virtual?: boolean
}

export interface Block {
  positionCm: number
  isEnd: boolean
  // Re-derived by the BE from positionCm + slope angle; absent on user-added
  // blocks until the next save round-trip.
  slopePositionCm?: number
}

export interface Punch {
  beamType: 'base' | 'slope'
  positionCm: number
  origin: 'outerLeg' | 'innerLeg' | 'rail' | 'diagonal' | 'block' | 'connector'
  reversedPositionCm?: number
  blockIdx?: number
  // On a spliced beam: which physical piece this punch is on, and its position
  // measured from that piece's own rear end. Absent ⇒ piece 0 / positionCm.
  segmentIdx?: number
  piecePositionCm?: number
}

export interface Diagonal {
  spanIdx: number
  topDistFromLegCm: number
  botDistFromLegCm: number
  punchSpanCm: number
  lengthCm: number
  isDouble: boolean
  disabled?: boolean
}

export interface ComputedArea {
  areaId: number
  label: string
  rails: Record<number, Rail[]>
  crossRowRails?: CrossRowRail[]
  bases: Record<number, Base[]>
  diagonals: ExternalDiagonal[]
  numLargeGaps: number
}

export interface ComputedTrapezoid {
  trapezoidId: string
  panelRowIdx?: number
  geometry: TrapezoidGeometry
  legs: Leg[]
  blocks: Block[]
  punches: Punch[]
  diagonals: Diagonal[]
}

export interface TrapezoidGroup {
  groupIdx: number
  trapIds: string[]
}

export interface Step3Data {
  globalSettings?: Record<string, unknown> | null
  areaSettings?: Record<string, unknown> | null
  customBasesOffsets?: Record<string, unknown> | null
  customDiagonals?: Record<string, unknown> | null
  computedAreas: ComputedArea[]
  computedTrapezoids: ComputedTrapezoid[]
  trapezoidGroups?: TrapezoidGroup[]
}

// ── Step 4: Plan approval (server-owned) ────────────────────────────────────

export interface ApprovalPerformedBy {
  userId: string
  email: string
  fullName: string
}

export interface PlanApproval {
  date: string
  strictConsent: boolean
  performedBy: ApprovalPerformedBy
}

export interface Step4Data {
  planApproval?: PlanApproval | null
}

// ── Step 5: BOM deltas (FE-owned) ──────────────────────────────────────────

export interface Step5Data {
  bomDeltas?: Record<string, unknown> | null
}

// ── FE-reshaped server data (from App.tsx applyBeResult) ────────────────────

/** Rail with panelRowIdx tag — flattened from ComputedArea.rails dict */
export interface FlatRail extends Rail {
  _panelRowIdx: number
}

/** Per-area rail data as consumed by FE hooks and utilities */
export interface BeRailsAreaData {
  areaId: number
  areaLabel: string
  rails: FlatRail[]
  crossRowRails?: CrossRowRail[]
  numLargeGaps: number
}

/** Per-area base data as consumed by FE hooks and utilities */
export interface BeBasesAreaData {
  areaId: number
  areaLabel: string
  bases: (Base & { _panelRowIdx: number })[]
  diagonals: ExternalDiagonal[]
  rails?: FlatRail[]
}

// ── Shared geometry types ────────────────────────────────────────────────────

export interface LocalBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export type LineRailsMap = Record<number | string, number[]>

export interface PanelSpec {
  lengthCm: number
  widthCm: number
}

// ── Parameter & configuration types ─────────────────────────────────────────

export interface ParamSchemaEntry {
  key: string
  default?: number
  min?: number
  max?: number
  section?: string    // 'rails' | 'bases' | 'detail'
  scope?: string      // 'global' | 'area' | 'trapezoid'
  type?: string       // 'rail-spacing' etc.
  highlightGroup?: string
  [k: string]: any
}

export interface RefinedArea {
  pixelToCmRatio?: number
  polygon?: any
  panelType?: string
  referenceLine?: any
  referenceLineLengthCm?: number
  panelConfig?: {
    angle?: number
    frontHeight?: number
    backHeight?: number
    lineOrientations?: string[]
    [k: string]: any
  }
  [k: string]: any
}

// ── Rail config (FE utility input) ──────────────────────────────────────────

export interface RailConfig {
  lineRails?: LineRailsMap | null
  overhangCm?: number
  stockLengths?: number[]
  railSpacingV?: number
  railSpacingH?: number
  /**
   * Per-line rail segments derived from BE rails. When present, the FE emits one rail
   * per segment per Y-offset (positioned via startCm/lengthCm in BE coords, anchored at
   * the leftmost real panel). Captures both per-segment overhang and split-at-holes —
   * the FE shouldn't duplicate BE logic, it just renders what the BE computed.
   */
  lineSegments?: Record<number, { startCm: number; lengthCm: number }[]>
  /**
   * Optional anchor panels for the lineMinX calc (BE coord 0). When the caller is
   * working with a panel subset (e.g. bases tab per-trap layout), pass the FULL row's
   * panels here so the rail anchor matches the BE's "leftmost real panel of the line
   * in the full row". Without this, a trap whose panels don't include the row's
   * leftmost panel renders its rails offset from the correct position.
   */
  anchorPanels?: PanelLayout[]
}

// ── FE layout geometry (computed by railLayoutService / basePlanService) ─────

export interface PanelLocalRect {
  id: number
  localX: number
  localY: number
  width: number
  height: number
  line: number
}

export interface PanelFrame {
  center: Point
  angleRad: number
  localBounds: LocalBounds
  panelLocalRects: PanelLocalRect[]
}

export interface FERail {
  railId: string
  lineIdx: number
  orientation: string
  localStart: Point
  localEnd: Point
  screenStart: Point
  screenEnd: Point
  lengthCm: number
}

export interface RowRailLayout {
  frame: { center: Point; angleRad: number; localBounds: LocalBounds }
  panelLocalRects: PanelLocalRect[]
  rails: FERail[]
  _panelRowIdx?: number
}

export interface LineInfo {
  lineIdx: number
  minY: number
  maxY: number
  orientation: string | null
}

export interface BasePlanBase {
  localX: number
  screenTop: Point
  screenBottom: Point
  offsetFromStartMm: number
}

export interface BasePlanFrame {
  center: Point
  angleRad: number
  localBounds: LocalBounds
  frameXMinPx: number
  frameXMaxPx: number
}

export interface RowBasePlan {
  frame: BasePlanFrame
  lines: LineInfo[]
  bases: BasePlanBase[]
  frameLengthMm: number
  baseCount: number
  spacingMm: number
  isRtl: boolean
}

export interface BaseConfig {
  customOffsets?: number[]
  edgeOffsetMm?: number
  spacingMm?: number
}

// ── Panel line segments (used by FE geometry helpers) ───────────────────────

export interface PanelLineSegment {
  depthCm: number
  gapBeforeCm: number
  isEmpty: boolean
  isHorizontal?: boolean
}

// ── Root ────────────────────────────────────────────────────────────────────

export interface ProjectData {
  version: '3.0'
  step2: Step2Data
  step3: Step3Data
  step4: Step4Data
  step5: Step5Data
}

// ── Layout (pixel-space UI state) ──────────────────────────────────────────
// Mirror of BE/mgp-service/app/schemas/project_layout.py

export interface Point {
  x: number
  y: number
}

export interface LineSegment {
  start: Point
  end: Point
}

export interface UploadedImageData {
  imageData: string
  width: number
  height: number
  rotation?: number
  scale?: number
  isWhiteboard?: boolean
  imageRef?: string
}

export interface RectAreaLayout {
  id: string
  vertices: Point[]
  rotation?: number
  mode?: 'free' | 'ylocked'
  color?: string | null
  xDir?: 'ltr' | 'rtl'
  yDir?: string | null
  manualTrapezoids?: boolean
  manualColTrapezoids?: Record<string, string>
  areaGroupId?: string | null
  rowIndex?: number
  label?: string
  areaVertical?: boolean
  angle?: string
  frontHeight?: string
  roofSpec?: RoofSpec | null
}

export interface PanelLayout {
  id: number
  x: number
  y: number
  cx: number
  cy: number
  width: number
  height: number
  rotation?: number
  widthCm: number
  heightCm: number
  row: number
  col: number
  line?: number
  coveredCols?: number[]
  area: number
  trapezoidId: string
  xDir?: string | null
  yDir?: string | null
  isEmpty?: boolean
  panelRowIdx?: number
  areaGroupKey?: number
}

export interface ProjectLayout {
  currentStep?: number
  uploadedImageData?: UploadedImageData | null
  roofPolygon?: Record<string, unknown> | null
  referenceLine?: LineSegment | null
  referenceLineLengthCm?: number | null
  pixelToCmRatio?: number | null
  rectAreas: RectAreaLayout[]
  panels: PanelLayout[]
  deletedPanelKeys?: Record<string, string[]>
  baseline?: Record<string, unknown> | null
}

// ── Project (top-level API object) ─────────────────────────────────────────

export type RoofType = 'concrete' | 'tiles' | 'flat_installation' | 'iskurit' | 'insulated_panel' | 'mixed'

export interface ProjectRoofSpec {
  type: RoofType
  distanceBetweenPurlinsCm?: number | null
  installationOrientation?: 'perpendicular' | 'parallel' | null
}

export interface Project {
  id: string
  name: string
  location: string | null
  roof_spec: ProjectRoofSpec
  navigation: { step?: number; tab?: string | null }
  layout: ProjectLayout
  data: ProjectData
  created_at: string
  updated_at: string
}
