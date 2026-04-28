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
  defaultAngleDeg: number
  defaultFrontHeightCm: number
  trapezoids: Step2Trapezoid[]
  areas: Step2Area[]
}

// ── Step 3: Construction planning ───────────────────────────────────────────

export interface Rail {
  railId: string
  lineIdx: number
  offsetFromRearEdgeCm: number
  offsetFromLineFrontCm: number
  startCm: number
  lengthCm: number
  roundedLengthCm?: number | null
  stockSegmentsMm: number[]
  leftoverCm: number
}

export interface Base {
  baseId: string
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
  frontExtensionCm?: number
  rearExtensionCm?: number
}

export interface Leg {
  positionCm: number
  positionEndCm: number
  heightCm: number
  isDouble: boolean
  railPositionCm?: number
}

export interface Block {
  positionCm: number
  isEnd: boolean
  slopePositionCm: number
}

export interface Punch {
  beamType: 'base' | 'slope'
  positionCm: number
  origin: 'outerLeg' | 'innerLeg' | 'rail' | 'diagonal' | 'block'
  reversedPositionCm?: number
  blockIdx?: number
}

export interface Diagonal {
  spanIdx: number
  topPct: number
  botPct: number
  lengthCm: number
  isDouble: boolean
  disabled?: boolean
}

export interface ComputedArea {
  areaId: number
  label: string
  rails: Record<number, Rail[]>
  bases: Record<number, Base[]>
  diagonals: ExternalDiagonal[]
  numLargeGaps: number
}

export interface ComputedTrapezoid {
  trapezoidId: string
  geometry: TrapezoidGeometry
  legs: Leg[]
  blocks: Block[]
  punches: Punch[]
  diagonals: Diagonal[]
}

export interface Step3Data {
  globalSettings?: Record<string, unknown> | null
  areaSettings?: Record<string, unknown> | null
  customBasesOffsets?: Record<string, unknown> | null
  customDiagonals?: Record<string, unknown> | null
  computedAreas: ComputedArea[]
  computedTrapezoids: ComputedTrapezoid[]
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

export type RoofType = 'concrete' | 'tiles' | 'iskurit' | 'insulated_panel' | 'mixed'

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
