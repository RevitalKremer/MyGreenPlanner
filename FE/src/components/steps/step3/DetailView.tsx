import { useState, useRef } from 'react'
import { useLang } from '../../../i18n/LangContext'
import { TEXT_SECONDARY, TEXT_DARKEST, TEXT_VERY_LIGHT, TEXT_PLACEHOLDER, BG_SUBTLE, BG_MID, BLUE, BLUE_BG, BLUE_BORDER, AMBER_DARK, AMBER, RAIL_STROKE, RAIL_FILL, DANGER, AMBER_BG, AMBER_BORDER, PRIMARY, ERROR, PANEL_FILL_HOVER_DELETE, CANVAS_DELETE_MARK, BLACK } from '../../../styles/colors'
import DimensionAnnotation from './DimensionAnnotation'
import CanvasNavigator from '../../shared/CanvasNavigator'
import { useCanvasPanZoom } from '../../../hooks/useCanvasPanZoom'
import { buildRailItems, buildDetailDiagonals, buildPunchPoints, computeActiveDepths, computeTrapStructureGeometry, computeLiveDiagPunchPositions } from '../../../utils/trapezoidGeometry'
import LayersPanel from './LayersPanel'
import DetailCorrugatedRoof from './DetailCorrugatedRoof'
import DetailGhostLayer from './DetailGhostLayer'
import TrapStructure, { type PositionedDiagonal } from './TrapStructure'
import DetailPunchSketch from './DetailPunchSketch'
import RulerTool from '../../shared/RulerTool'
import type { ComputedTrapezoid, TrapezoidGeometry, Leg, Block, Punch } from '../../../types/projectData'

export default function DetailView({ rc, trapId = null, twinIds = [] as string[], panelLines = null, settings = {} as Record<string, any>, lineRails = null, highlightParam = null, beDetailData = null as ComputedTrapezoid | null, effectiveDetailSettings = null, fullTrapGhost = null, paramGroup: PARAM_GROUP = {} as Record<string, any>, reverseBlockPunches = true, onReset = null, onUpdateSetting = null, printMode = false, roofType = 'concrete', purlinDistCm = 0, installationOrientation = null, customBlocks = null as Block[] | null, onCustomBlocksChange = null as null | ((blocks: Block[] | null) => void), onRequestExitEdit = null as null | (() => Promise<boolean>),
  // Punch marks (block numbers, beam holes, base/slope punch bars) are factory
  // manufacturing data — admin-only. Non-admins get no "Punches" layer toggle
  // and never see them. Gates the showPunches default and the LayersPanel toggle.
  // In the Step-5 PDF (printMode) the toggle is hidden, so an admin's generated
  // plan — the file pushed to the Monday item — always includes the punches.
  canViewPunches = false }) {
  const { t } = useLang()
  const [showDimensions,  setShowDimensions]  = useState(true)
  const [showPunches,     setShowPunches]      = useState(canViewPunches)
  // In the interactive view punches follow the (admin-only) layer toggle; in
  // printMode (the Step-5 PDF capture) they follow canViewPunches directly so
  // the Monday-bound file can force them on regardless of the on-screen role.
  const punchesVisible = printMode ? canViewPunches : showPunches
  // Unified edit mode for the trap detail view. When on, diagonal handles are
  // draggable / clickable, the empty beam zones accept new-block clicks, and
  // block rects become movable / deletable. Mirrors the BasesPlanTab pattern.
  const [editMode, setEditMode] = useState(false)
  const [showGhost,       setShowGhost]        = useState(true)
  const [showRoofLine,    setShowRoofLine]     = useState(true)
  const [rulerActive,      setRulerActive]      = useState(false)
  const [barHover,         setBarHover]         = useState(null) // { which: 'top'|'bot', svgX } | null
  const [hoverHandle,      setHoverHandle]      = useState(null) // { which, spanIndex } | null
  const [blockHoverIdx,    setBlockHoverIdx]    = useState<number | null>(null)
  const [blockGhostCm,     setBlockGhostCm]     = useState<number | null>(null) // hover position for add ghost

  const svgRef      = useRef(null)
  const diagDragRef = useRef(null) // { which, spanIndex, xA, spanW, startClientX, didDrag }
  const blockDragRef = useRef<null | { idx: number; startClientX: number; initialPosCm: number; didDrag: boolean }>(null)

  const {
    zoom, setZoom, panOffset, panActive,
    containerRef, contentRef,
    startPan, handleMouseMove, stopPan, resetView, zoomAtCenter,
    MM_W, MM_H, panToMinimapPoint, getMinimapViewportRect,
  } = useCanvasPanZoom()

  // Rail offset = first rail of first line (derived from lineRails).
  // Dual key fallback: lineRails keys are numeric from FE hooks, but may become
  // string keys after JSON round-tripping (e.g. from BE responses or localStorage).
  const railOffsetCm   = lineRails?.[0]?.[0] ?? lineRails?.['0']?.[0] ?? 0
  const panelLengthCm  = settings.panelLengthCm
  // Diagonal overrides are scoped PER TRAP: settings.diagOverrides is keyed by
  // trapId so a trimmed trap's edit doesn't leak onto its full twin (both share
  // the area-level settings object). `diagOverrides` below is the flat span map
  // for THIS trap — all downstream logic keeps using it unchanged; only the
  // read (here) and writes (commitDiagOverrides) are trap-scoped.
  const diagTrapKey    = trapId ?? '_default'
  const diagByTrap     = settings.diagOverrides ?? {}
  const diagOverrides  = diagByTrap[diagTrapKey] ?? {}
  const commitDiagOverrides = (spanMap) =>
    onUpdateSetting?.('diagOverrides', { ...diagByTrap, [diagTrapKey]: spanMap })

  // Highlight helpers
  const hlGroup = PARAM_GROUP[highlightParam] ?? null
  const hl = (group) => hlGroup === group

  // Use BE-computed geometry when available, fall back to FE rc
  // Require BE data — geometry and legs must come from server
  if (!beDetailData?.geometry || !beDetailData?.legs?.length) return <div style={{ padding: '2rem', color: TEXT_VERY_LIGHT }}>{t('step3.empty.selectRow')}</div>
  const geom = beDetailData.geometry
  // Trap's BE-default base-beam extension lives at geometry.extensions[0]
  // (zero for concrete & parallel-purlin; non-zero for iskurit / insulated_panel
  // perpendicular). Variations 1..N are user-created. DetailView renders the
  // parent trap, so we use [0].
  const defaultExt = geom.extensions?.[0] ?? { frontExtMm: 0, backExtMm: 0 }
  const defaultFrontExtCm = (defaultExt.frontExtMm ?? 0) / 10
  const defaultRearExtCm = (defaultExt.backExtMm ?? 0) / 10

  const baseOverhangCm = settings.baseOverhangCm
  const { heightRear, heightFront, baseLength, angle, topBeamLength } = geom
  // Origin offset: BE positions are relative to rear outer leg (positionCm=0).
  // atSlope() works in global panel coords. Add originCm to convert.
  const originCm = geom.originCm ?? 0

  // All physical dimensions from server geometry (cm), converted to px via SC
  const SC         = 2.2
  const RAIL_CM    = railOffsetCm
  const BLOCK_H_CM = geom.blockHeightCm ?? 0
  const blockLengthCm = geom.blockLengthCm ?? 0
  const crossRailEdgeDistCm = geom.crossRailHeightCm
  const beamThickCm = geom.beamThickCm
  const panelThickCm = geom.panelThickCm

  const angleRad = angle * Math.PI / 180
  const bW      = baseLength   * SC   // leg-to-leg horizontal span
  const OHx     = baseOverhangCm * Math.cos(angleRad) * SC
  const hR      = heightRear   * SC
  const hF      = heightFront  * SC
  const railOffH = RAIL_CM * Math.cos(angleRad) * SC
  const blockH  = BLOCK_H_CM   * SC

  const segments = (panelLines && panelLines.length > 0)
    ? panelLines
    : [{ depthCm: panelLengthCm ?? 0, gapBeforeCm: 0 }]
  const totalPanelDepthCm = segments.reduce((s, seg) => s + (seg.gapBeforeCm ?? 0) + (seg.depthCm ?? 0), 0)

  // Back extension shifts leg 0 forward and extends the beam past it on the
  // LEFT (leg-0 side); front extension extends the beam past the front leg
  // on the RIGHT — match each side's padding to what actually sits there.
  const frontExtPx = defaultFrontExtCm * SC
  const backExtPx  = defaultRearExtCm * SC
  const padL = Math.max(120, railOffH + OHx + backExtPx + 40)
  const panelExtCm = (totalPanelDepthCm - RAIL_CM) * Math.cos(angleRad) - baseLength
  const padR = Math.max(100, Math.max(panelExtCm * SC, OHx, frontExtPx) + 70)
  const _panelOffsetApprox = 2 * SC + 10 + 3
  const _slopeAbove = bW > 0 ? (hR - hF) * railOffH / bW : 0
  const _annotAbove = Math.cos(angleRad) * (_panelOffsetApprox + 40)
  const padT = Math.max(55, hR - hF + _slopeAbove + _annotAbove + 30)
  const padB = blockH + 230

  const svgW = bW + padL + padR
  const svgH = hF + padT + padB

  const baseY     = hF + padT
  const topY0     = baseY - hR
  const x0 = padL
  const x1 = padL + bW

  const panelX1 = x0 - railOffH
  // panelY1: atSlope(originCm) must give the slope beam Y at the rear outer leg = topY0
  const panelY1 = topY0 + originCm * Math.sin(angleRad) * SC
  const atSlope = (dCm) => ({
    x: panelX1 + dCm * Math.cos(angleRad) * SC,
    y: panelY1 - dCm * Math.sin(angleRad) * SC,
  })
  // Convert BE positions (relative to rear outer leg) to SVG coords
  const atTrap = (posCm) => atSlope(posCm + originCm)
  const { x: panelX2 } = atSlope(totalPanelDepthCm)

  const railItems = buildRailItems(segments, lineRails, atSlope)
  const BEAM_THICK_PX = beamThickCm * SC
  const blockTopY = baseY + BEAM_THICK_PX   // blocks sit below the outer bottom face of the base beam
  const blockBotY = blockTopY + blockH
  const PANEL_THICK_PX = panelThickCm * SC
  const CROSS_RAIL_GAP_PX = crossRailEdgeDistCm * SC  // cross rail profile height in px
  const PANEL_OFFSET_PX = BEAM_THICK_PX / 2 + CROSS_RAIL_GAP_PX + PANEL_THICK_PX / 2


  // ── Live blocks: prefer the user's customBlocks override when set so
  //    drag/add/delete gestures render optimistically before the next BE
  //    round-trip. Falls back to the BE-computed blocks otherwise.
  const liveBlocks: Block[] = customBlocks ?? beDetailData?.blocks ?? []

  // ── Structural geometry — single source of truth (shared with DetailGhostLayer) ──
  const beLegs = beDetailData?.legs ?? []
  const structGeo = computeTrapStructureGeometry({
    beLegs,
    baseBeamLengthCm: geom.baseBeamLength ?? 0,
    atTrapX: (posCm) => atTrap(posCm).x,
    baseY,
    beamThickPx: BEAM_THICK_PX,
    SC,
  })
  const {
    legXs: allLegXs, legEndXs: allLegEndXs, legHeights: allLegHeights, legTopYs: allLegTopYs,
    legCenterXs, beamYAt: beamYFromLegs, beamAngleDeg, firstLegPos,
  } = structGeo
  let legX0 = structGeo.legX0 || (x0 - OHx)
  let legX1 = structGeo.legX1 || (x1 + OHx)
  let legBW = legX1 - legX0
  const legHeightAtX = (x) => (baseY + 3 * BEAM_THICK_PX / 2 - beamYFromLegs(x)) / SC
  // Build diagonal data: use BE decisions (topDistFromLegCm, botDistFromLegCm from server) combined with user overrides.
  // Always compute pixel positions from current leg geometry.

  const diagonals = buildDetailDiagonals(beDetailData, diagOverrides, allLegXs, allLegEndXs, allLegHeights, baseY, BEAM_THICK_PX)

  // All legs are active (ghost handled by overlay)
  const firstActiveLegIdx = 0
  const lastActiveLegIdx  = allLegXs.length - 1
  const hasActiveZone = firstActiveLegIdx <= lastActiveLegIdx
  const activeBeamL = hasActiveZone ? allLegXs[firstActiveLegIdx] : legX0
  const activeBeamR = hasActiveZone ? allLegEndXs[lastActiveLegIdx] : legX0
  const activeBoundL = activeBeamL
  const activeBoundR = activeBeamR

  // Diagonals with both legs in the active zone (used for punch sketches + dimensions)
  const activeDiags          = diagonals
  const activeSlopeBeamLenCm = topBeamLength
  const activeBaseBeamLenCm  = geom.baseBeamLength ?? (legBW / SC)

  // Live diagonal punch positions: recomputed from current pct values (including overrides)
  // so punch circles and labels update immediately when the user drags a handle.
  const beDiags = beDetailData?.diagonals ?? []
  const legOffsetCm = defaultRearExtCm
  const liveDiagPunches = computeLiveDiagPunchPositions(
    beDiags, diagOverrides, beLegs, beamThickCm, angleRad, legOffsetCm
  ).filter(d => activeDiags.some(a => a.spanIndex === d.spanIndex))

  // Spans with no diagonal (skipped by rules or user-deleted) — used for "add" affordance
  const activeSpanSet    = new Set(diagonals.map(d => d.spanIndex))
  const naturallySkipped = new Set(
    allLegXs.slice(0, -1).map((xA, i) => {
      const xB = allLegXs[i + 1]
      return legHeightAtX(xA) < 60 && legHeightAtX(xB) < 60 ? i : -1
    }).filter(i => i >= 0)
  )

  // Block computation removed — blocks now rendered from beDetailData.blocks

  // ── Diagonal handle helpers ───────────────────────────────────────────────
  const toSvgX = (clientX) => {
    const rect = svgRef.current?.getBoundingClientRect()
    return rect ? (clientX - rect.left) / zoom : 0
  }
  const findSpan = (svgX) => {
    for (let i = 0; i < allLegXs.length - 1; i++) {
      if (svgX >= allLegXs[i] && svgX <= allLegXs[i + 1])
        return { spanIndex: i, xA: allLegXs[i], spanW: allLegXs[i + 1] - allLegXs[i] }
    }
    return null
  }

  const deleteDiagonal = (spanIndex) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { topDistFromLegCm: _td, botDistFromLegCm: _bd, ...rest } = diagOverrides[spanIndex] ?? {}
    commitDiagOverrides({ ...diagOverrides, [spanIndex]: { ...rest, disabled: true } })
  }

  const _spanCmForIdx = (spanIndex: number) => {
    const ph = BEAM_THICK_PX / (2 * SC)
    const leg = beLegs[spanIndex], nextLeg = beLegs[spanIndex + 1]
    return leg && nextLeg ? (nextLeg.positionEndCm - ph) - (leg.positionCm + ph) : null
  }

  // Snap a diagonal endpoint drag so the punch position shown on the bar lands
  // on a whole cm. The BE already emits integer punch positions, so this keeps
  // the live preview WYSIWYG (no jump on save). Rounding is done in DISPLAYED-
  // punch space — mirrors computeLiveDiagPunchPositions and honors the slope
  // bar's reversed direction. Inverts back to a distance-from-leg value.
  const snapDiagDistToRoundPunch = (which: 'top' | 'bot', d: any, distCm: number) => {
    const leg = beLegs[d.spanIndex]
    if (!leg) return distCm
    const ph = beamThickCm / 2
    const ps = leg.positionCm + ph
    if (which === 'top') {
      const topPos = ps + distCm - legOffsetCm
      const displayed = reverseBlockPunches ? topBeamLength - topPos : topPos
      const newTopPos = reverseBlockPunches ? topBeamLength - Math.round(displayed) : Math.round(displayed)
      return newTopPos + legOffsetCm - ps
    }
    const cosA = Math.cos(angleRad) || 1
    const botPos = legOffsetCm + ph + (ps + distCm - legOffsetCm - ph) * cosA
    const newBotSlope = (Math.round(botPos) - legOffsetCm - ph) / cosA + legOffsetCm + ph
    return newBotSlope - ps
  }

  // ── Handle drag (window-listener based, click-vs-drag) ────────────────────
  const startHandleDrag = (e, which, d) => {
    e.stopPropagation()
    const startClientX = e.clientX
    const span_cm      = _spanCmForIdx(d.spanIndex) ?? d.spanW / SC
    const initialDist  = which === 'top'
      ? (diagOverrides[d.spanIndex]?.topDistFromLegCm ?? (d.spanW > 0 ? (d.topX - d.xA) / SC : 0.25 * span_cm))
      : (diagOverrides[d.spanIndex]?.botDistFromLegCm ?? (d.spanW > 0 ? (d.botX - d.xA) / SC : 0.90 * span_cm))
    const capturedOv   = { ...diagOverrides }
    let didDrag        = false

    const onMove = (me) => {
      if (Math.abs(me.clientX - startClientX) > 3) didDrag = true
      if (!didDrag) return
      const deltaCm = (me.clientX - startClientX) / zoom / SC
      const rawDist = Math.max(0.05 * span_cm, Math.min(0.95 * span_cm, initialDist + deltaCm))
      // Snap to a whole-cm punch position (per the displayed bar number).
      const distCm  = Math.max(0.05 * span_cm, Math.min(0.95 * span_cm, snapDiagDistToRoundPunch(which, d, rawDist)))
      const existing = capturedOv[d.spanIndex] ?? {}
      // Persist BOTH endpoints. The BE override path requires top + bot
      // together; a single-key override is dropped by the saveTab payload
      // builder and the diagonal stays at its default position.
      const dragKey  = which === 'top' ? 'topDistFromLegCm' : 'botDistFromLegCm'
      const otherKey = which === 'top' ? 'botDistFromLegCm' : 'topDistFromLegCm'
      const otherCurrent = existing[otherKey] ?? (which === 'top'
        ? (d.spanW > 0 ? (d.botX - d.xA) / SC : 0.90 * span_cm)
        : (d.spanW > 0 ? (d.topX - d.xA) / SC : 0.25 * span_cm))
      commitDiagOverrides({
        ...capturedOv,
        [d.spanIndex]: { ...existing, [dragKey]: distCm, [otherKey]: otherCurrent },
      })
    }
    const onUp = () => {
      if (!didDrag) deleteDiagonal(d.spanIndex)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // ── Bar hover + click-to-add ──────────────────────────────────────────────
  const handleBarMouseMove = (e, which) => {
    if (diagDragRef.current) return
    setBarHover({ which, svgX: toSvgX(e.clientX) })
  }
  const handleBarClick = (e, which) => {
    const svgX = toSvgX(e.clientX)
    const span = findSpan(svgX)
    if (!span || activeSpanSet.has(span.spanIndex)) return
    const span_cm    = _spanCmForIdx(span.spanIndex) ?? span.spanW / SC
    const clickedDist = Math.max(0.05 * span_cm, Math.min(0.95 * span_cm, (svgX - span.xA) / SC))
    const topDist = which === 'top' ? clickedDist : 0.5 * span_cm
    const botDist = which === 'bot' ? clickedDist : 0.5 * span_cm
    const entry  = naturallySkipped.has(span.spanIndex)
      ? { disabled: false, topDistFromLegCm: topDist, botDistFromLegCm: botDist }
      : { topDistFromLegCm: topDist, botDistFromLegCm: botDist }
    commitDiagOverrides({ ...diagOverrides, [span.spanIndex]: entry })
  }

  // ── Block edit handlers (edit-mode only) ─────────────────────────────────
  // Live blocks are kept sorted by positionCm. The min-gap clamp is order-
  // preserving so structural (isEnd) blocks remain outermost automatically.
  //
  // Structural-block overhang: a leg footprint occupies 2 × beamThickCm + the
  // block punch offset on top of the block; the remainder is the maximum
  // amount the block can hang OUTSIDE its outer leg without leaving the
  // leg/punch unsupported. With defaults this is 50 − (2×4 + 9) = 33 cm.
  const baseBeamLengthCm = geom.baseBeamLength ?? 0
  const blockPunchCm = geom.blockPunchCm ?? 0
  const maxStructuralOverhangCm = Math.max(0, blockLengthCm - (2 * beamThickCm + blockPunchCm))

  const commitBlocks = (next: Block[] | null) => {
    if (!onCustomBlocksChange) return
    if (next && next.length === 0) onCustomBlocksChange(null)
    else onCustomBlocksChange(next)
  }

  const clampedBlockPos = (sorted: Block[], idx: number, candidateCm: number): number => {
    const target = sorted[idx]
    const isStructural = !!target?.isEnd
    // Left bound: respect previous-neighbour min-gap, otherwise the beam start
    // (or, for the outermost structural block, allow the legal overhang past it).
    const minNeighbor = idx > 0
      ? sorted[idx - 1].positionCm + blockLengthCm
      : (isStructural ? -maxStructuralOverhangCm : 0)
    // Right bound: respect next-neighbour min-gap, otherwise the beam end
    // (or, for the outermost structural block, allow the legal overhang past it).
    const maxNeighbor = idx < sorted.length - 1
      ? sorted[idx + 1].positionCm - blockLengthCm
      : (isStructural
          ? baseBeamLengthCm - blockLengthCm + maxStructuralOverhangCm
          : baseBeamLengthCm - blockLengthCm)
    return Math.max(minNeighbor, Math.min(maxNeighbor, candidateCm))
  }

  const deleteBlockAt = (idx: number) => {
    const sorted = liveBlocks.slice().sort((a, b) => a.positionCm - b.positionCm)
    if (sorted[idx]?.isEnd) return  // structural: locked
    sorted.splice(idx, 1)
    commitBlocks(sorted)
  }

  const startBlockDrag = (e: React.MouseEvent, idx: number) => {
    if (!editMode) return
    e.preventDefault()
    e.stopPropagation()
    const sorted = liveBlocks.slice().sort((a, b) => a.positionCm - b.positionCm)
    blockDragRef.current = {
      idx,
      startClientX: e.clientX,
      initialPosCm: sorted[idx].positionCm,
      didDrag: false,
    }
    const onMove = (me: MouseEvent) => {
      const drag = blockDragRef.current
      if (!drag) return
      if (Math.abs(me.clientX - drag.startClientX) > 3) drag.didDrag = true
      if (!drag.didDrag) return
      const deltaCm = (me.clientX - drag.startClientX) / zoom / SC
      const next = liveBlocks.slice().sort((a, b) => a.positionCm - b.positionCm)
      const newPos = Math.round(clampedBlockPos(next, drag.idx, drag.initialPosCm + deltaCm))
      if (next[drag.idx].positionCm !== newPos) {
        next[drag.idx] = { ...next[drag.idx], positionCm: newPos }
        commitBlocks(next)
      }
    }
    const onUp = () => {
      const drag = blockDragRef.current
      blockDragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      // Pure click on a non-structural block → delete (no drag detected).
      if (drag && !drag.didDrag) {
        const sorted2 = liveBlocks.slice().sort((a, b) => a.positionCm - b.positionCm)
        if (!sorted2[drag.idx]?.isEnd) deleteBlockAt(drag.idx)
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Convert an SVG x-coordinate on the base beam into a positionCm value.
  const beamSvgXToPosCm = (svgX: number): number => {
    const bbX0 = structGeo.baseBeamX0 ?? 0
    return (svgX - bbX0) / SC
  }

  // True when a new block would fit at posCm: in-bounds and respects 50cm
  // min-gap to existing blocks (existing structural ones remain outermost).
  const canAddBlockAt = (posCm: number): boolean => {
    if (posCm < 0 || posCm > baseBeamLengthCm - blockLengthCm) return false
    for (const b of liveBlocks) {
      if (posCm < b.positionCm + blockLengthCm && b.positionCm < posCm + blockLengthCm) return false
    }
    return true
  }

  const addBlockAt = (posCm: number) => {
    if (!canAddBlockAt(posCm)) return
    const sorted = liveBlocks.slice().sort((a, b) => a.positionCm - b.positionCm)
    sorted.push({ positionCm: Math.round(posCm), isEnd: false })
    sorted.sort((a, b) => a.positionCm - b.positionCm)
    commitBlocks(sorted)
  }

  const handleContainerMouseMove = (e) => handleMouseMove(e)
  const handleContainerMouseUp   = () => { stopPan() }
  const handleContainerMouseLeave = () => { stopPan() }

  // Marks a structural profile (leg or diagonal) as doubled: dashed red
  // outline of the profile rectangle plus three "×2" labels along its length.
  const DoubleProfileMarker = ({ x1, y1, x2, y2, thickness }) => {
    const dx = x2 - x1, dy = y2 - y1
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < 1) return null
    const ang = Math.atan2(dy, dx) * 180 / Math.PI
    return (
      <g transform={`rotate(${ang}, ${x1}, ${y1})`}>
        <rect x={x1} y={y1 - thickness / 2} width={len} height={thickness}
          fill="none" stroke={DANGER} strokeWidth="2" strokeDasharray="5,3" />
        {[0.08, 0.5, 0.92].map((t, i) => (
          <text key={i} x={x1 + t * len} y={y1} textAnchor="middle" dominantBaseline="middle"
            fontSize="11" fontWeight="800" fill={DANGER}>×2</text>
        ))}
      </g>
    )
  }

  const DC = TEXT_DARKEST
  const TC = TEXT_VERY_LIGHT

  // Format to 1 decimal, stripping trailing ".0"
  const fmt = (v) => parseFloat(v.toFixed(1)).toString()

  const punches = beDetailData?.punches ?? []
  const makePunchPoints = (beamType, excludeOrigin, atFn, labelFor, liveDiagPoints?) =>
    buildPunchPoints(punches, beamType, excludeOrigin, atFn, labelFor, liveDiagPoints)

  // For a spliced beam, convert a full-beam cm position to its per-piece label:
  // forward distance from the piece's rear end, or (reversed) from its far end.
  // Used for live diagonal punch labels so they match the per-piece convention
  // the static punches already use via piecePositionCm.
  const pieceLabelCm = (posCm, segs, reversed) => {
    const list = segs ?? []
    const seg = list.find(s => posCm >= s.startCm - 0.05 && posCm <= s.endCm + 0.05) ?? list[list.length - 1]
    if (!seg) return posCm
    const piecePos = posCm - seg.startCm
    return reversed ? (seg.lengthCm - piecePos) : piecePos
  }

  // Panel start/end positions — includes perpendicular offset to match rendered panel bar
  const panelBottomPos = (dCm) => {
    const sx = atSlope(dCm).x
    return { x: sx, y: beamYFromLegs(sx) - (PANEL_OFFSET_PX - PANEL_THICK_PX / 2) }
  }
  const { firstActiveDepth, lastActiveDepth } = computeActiveDepths(segments)
  const activePanelStartBot = panelBottomPos(firstActiveDepth)
  const activePanelEndBot   = panelBottomPos(lastActiveDepth)

  const Dim = ({ ax1, ay1, ax2, ay2, label, off = 12, tbd = false }) => {
    const dx = ax2 - ax1, dy = ay2 - ay1
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < 2) return null
    const nx = -dy / len * off, ny = dx / len * off
    const measurePts = [[ax1, ay1], [ax2, ay2]]
    const annPts     = [[ax1 + nx, ay1 + ny], [ax2 + nx, ay2 + ny]]
    const col = tbd ? TC : DC
    return (
      <DimensionAnnotation
        measurePts={measurePts}
        annPts={annPts}
        labels={[tbd ? 'TBD' : label]}
        zoom={1}
        color={col}
      />
    )
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>

      {/* ── Zoom / pan area ── */}
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', overflow: 'hidden', cursor: printMode ? 'default' : (panActive ? 'grabbing' : 'grab'), pointerEvents: printMode ? 'none' : 'auto' }}
        onMouseDown={printMode ? undefined : startPan}
        onMouseMove={printMode ? undefined : handleContainerMouseMove}
        onMouseUp={printMode ? undefined : handleContainerMouseUp}
        onMouseLeave={printMode ? undefined : handleContainerMouseLeave}
      >
        <div style={{ transform: `translate(${panOffset.x}px, ${panOffset.y}px)`, transformOrigin: 'top left' }}>
          <div ref={contentRef} style={{
            transform: `scale(${zoom})`,
            transformOrigin: 'top left',
            padding: '1rem 1.5rem',
            display: 'inline-block',
          }}>
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: '700', color: TEXT_SECONDARY }}>
                {trapId ?? `${rc.typeLetter}${Math.max(...(rc.panelsPerLine?.length ? rc.panelsPerLine : [1]))}`} — {angle}° · Panel Front{' '}
                <span style={effectiveDetailSettings?.shortFrontLeg ? { color: AMBER_DARK } : undefined}>
                  {fmt(geom.panelFrontHeight ?? 0)} cm
                </span>
                {effectiveDetailSettings?.shortFrontLeg && (
                  <span title={t('step3.detail.shortFrontLegTooltip')} style={{ marginLeft: '0.3rem', fontSize: '0.7rem', color: AMBER_DARK, fontWeight: '600' }}>
                    ↑ {t('step3.detail.adjusted')}
                  </span>
                )}
                <span style={{ fontWeight: '400', color: TEXT_PLACEHOLDER, marginLeft: '0.5rem' }}>
                  · Panel {fmt(panelLengthCm)}×{fmt(settings.panelWidthCm)} cm
                </span>
              </div>
              {twinIds.length > 0 && (
                <div style={{ marginTop: '0.15rem', fontSize: '0.68rem', fontWeight: '600', color: BLUE }}>
                  ≡ identical to {twinIds.join(', ')}
                </div>
              )}
            </div>

            <svg ref={svgRef} width={svgW} height={svgH}
              style={{ display: 'block', overflow: 'visible' }}>

              {/* ── Ghost layer: full trap structural outline drawn in ghost style ── */}
              {showGhost && fullTrapGhost?.beDetailData?.geometry && (
                <DetailGhostLayer
                  fullTrapGhost={fullTrapGhost} originCm={originCm}
                  legX0={legX0} baseY={baseY}
                  BEAM_THICK_PX={BEAM_THICK_PX} PANEL_OFFSET_PX={PANEL_OFFSET_PX} PANEL_THICK_PX={PANEL_THICK_PX}
                  SC={SC} blockLengthCm={blockLengthCm} blockH={blockH}
                />
              )}
              <defs>
                <style>{`@keyframes hlPulse { 0%,100%{opacity:0.15} 50%{opacity:0.9} }`}</style>
              </defs>

              {/* ── Structural primitives (shared with DetailGhostLayer via TrapStructure) ── */}
              <TrapStructure
                variant="main"
                geometry={structGeo}
                beLegs={beLegs}
                blocks={liveBlocks}
                diagonals={diagonals.map((d): PositionedDiagonal => ({
                  topX: d.topX, topY: d.topY, botX: d.botX, botY: d.botY, halfCap: d.halfCap,
                }))}
                panelLines={segments}
                atSlopeX={(dCm) => atSlope(dCm).x}
                baseY={baseY}
                beamThickPx={BEAM_THICK_PX}
                blockH={blockH}
                blockLengthCm={blockLengthCm}
                panelOffsetPx={PANEL_OFFSET_PX}
                panelThickPx={PANEL_THICK_PX}
                SC={SC}
                baseBeamSegments={geom.baseBeamSegments}
                topBeamSegments={geom.topBeamSegments}
                baseBeamLengthCm={baseBeamLengthCm}
                topBeamLengthCm={topBeamLength}
              />

              {/* ── Block punch labels (decoration on top of block rects) ── */}
              {/* Hidden while in edit mode — punch labels are tied to the BE-
                  computed block list and would drift as the user drags. */}
              {punchesVisible && !editMode && (() => {
                const blockPunches = (beDetailData?.punches ?? []).filter(p => p.origin === 'block')
                const bw = blockLengthCm * SC
                return (beDetailData?.blocks ?? []).map((blk, bi) => {
                  const blkPunch = blockPunches.find(p => p.blockIdx === bi)
                  if (!blkPunch) return null
                  const label = fmt(reverseBlockPunches && blkPunch.reversedPositionCm != null ? blkPunch.reversedPositionCm : blkPunch.positionCm)
                  const bx = structGeo.baseBeamX0 + blk.positionCm * SC
                  return (
                    <text key={`blbl-${bi}`} x={bx + bw / 2} y={blockTopY + blockH / 2}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize="12" fontWeight="700" fill={TEXT_DARKEST}>{label}</text>
                  )
                })
              })()}

              {/* ── Block edit overlay (edit mode only) ───────────────────────
                  Renders ON TOP of the block rects drawn by TrapStructure:
                    - per-block drag handle (click = delete for non-structural)
                    - structural-block marker (amber outline, locked from delete)
                    - empty-beam click target + ghost-preview rect for adding
              */}
              {editMode && (() => {
                const bw = blockLengthCm * SC
                const bbX0 = structGeo.baseBeamX0
                const bbW = baseBeamLengthCm * SC
                const sorted = liveBlocks.slice().sort((a, b) => a.positionCm - b.positionCm)
                const handleBeamMove = (e: React.MouseEvent) => {
                  if (blockDragRef.current) return
                  const rect = svgRef.current?.getBoundingClientRect()
                  if (!rect) return
                  const svgX = (e.clientX - rect.left) / zoom
                  const beamCm = beamSvgXToPosCm(svgX) - blockLengthCm / 2  // centre the ghost on the cursor
                  const snapped = Math.round(beamCm)
                  setBlockGhostCm(canAddBlockAt(snapped) ? snapped : null)
                }
                const handleBeamLeave = () => setBlockGhostCm(null)
                const handleBeamClick = (e: React.MouseEvent) => {
                  const rect = svgRef.current?.getBoundingClientRect()
                  if (!rect) return
                  const svgX = (e.clientX - rect.left) / zoom
                  const beamCm = beamSvgXToPosCm(svgX) - blockLengthCm / 2
                  addBlockAt(Math.round(beamCm))
                  setBlockGhostCm(null)
                }
                return (
                  <g>
                    {/* Beam click target — sits BENEATH the block rects so a click
                        ON a block goes to the drag/delete handler, not to add. */}
                    <rect x={bbX0} y={blockTopY} width={bbW} height={blockH}
                      fill="transparent" style={{ cursor: blockGhostCm != null ? 'copy' : 'default' }}
                      onMouseMove={handleBeamMove}
                      onMouseLeave={handleBeamLeave}
                      onClick={handleBeamClick} />
                    {/* Ghost preview at hover position */}
                    {blockGhostCm != null && (
                      <rect x={bbX0 + blockGhostCm * SC} y={blockTopY}
                        width={bw} height={blockH}
                        fill={PRIMARY} fillOpacity={0.18}
                        stroke={PRIMARY} strokeDasharray="4 3" strokeWidth="1.5"
                        pointerEvents="none" />
                    )}
                    {/* Per-block interaction handles */}
                    {sorted.map((blk, idx) => {
                      const bx = bbX0 + blk.positionCm * SC
                      const isHovered = blockHoverIdx === idx
                      const isStructural = !!blk.isEnd
                      return (
                        <g key={`blk-edit-${idx}`}
                          onMouseEnter={() => setBlockHoverIdx(idx)}
                          onMouseLeave={() => setBlockHoverIdx(prev => prev === idx ? null : prev)}>
                          {/* Drag-grip rect on top of the block — handles drag-to-move
                              and pure-click-to-delete (non-structural only). */}
                          <rect x={bx} y={blockTopY} width={bw} height={blockH}
                            fill="transparent"
                            style={{ cursor: 'move' }}
                            onMouseDown={(e) => startBlockDrag(e, idx)}>
                            <title>
                              {isStructural
                                ? (t('step3.editMode.blockStructural') || 'Structural block — cannot delete (drag to move)')
                                : (t('step3.editMode.blockHint') || 'Drag to move, click to delete')}
                            </title>
                          </rect>
                          {/* Structural marker — black outline (drag-only, no delete).
                              Inset by half the stroke width so the border sits fully
                              INSIDE the block footprint and doesn't enlarge the shape. */}
                          {isStructural && (
                            <rect x={bx + 1} y={blockTopY + 1} width={bw - 2} height={blockH - 2}
                              fill="none" stroke={BLACK} strokeWidth="2"
                              pointerEvents="none" />
                          )}
                          {/* Delete affordance on hover (non-structural only).
                              Matches the step 2 panel-delete L&D: red translucent
                              overlay + ERROR border + central ✕ in a red disc. */}
                          {!isStructural && isHovered && (() => {
                            const cxCenter = bx + bw / 2
                            const cyCenter = blockTopY + blockH / 2
                            const markR = Math.min(bw, blockH) * 0.3
                            return (
                              <g pointerEvents="none">
                                <rect x={bx} y={blockTopY} width={bw} height={blockH}
                                  fill={PANEL_FILL_HOVER_DELETE} stroke={ERROR} strokeWidth="2" />
                                <circle cx={cxCenter} cy={cyCenter} r={markR}
                                  fill={CANVAS_DELETE_MARK} />
                                <text x={cxCenter} y={cyCenter}
                                  textAnchor="middle" dominantBaseline="central"
                                  fontSize={markR * 1.3} fontWeight="700" fill="white">×</text>
                              </g>
                            )
                          })()}
                        </g>
                      )
                    })}
                  </g>
                )
              })()}

              {/* ── Double-leg ×2 markers (decoration on top of leg rects) ── */}
              {beLegs.map((leg, li) => {
                if (leg.virtual || !leg.isDouble) return null
                const lx = allLegXs[li], lxEnd = allLegEndXs[li]
                const lw = lxEnd - lx
                const slopeTopY = beamYFromLegs(legCenterXs[li]) - BEAM_THICK_PX / 2
                const legH = (baseY + BEAM_THICK_PX) - slopeTopY
                if (legH <= 0) return null
                return (
                  <DoubleProfileMarker key={`lm-${li}`}
                    x1={lx + lw / 2} y1={slopeTopY}
                    x2={lx + lw / 2} y2={slopeTopY + legH}
                    thickness={lw} />
                )
              })}

              {/* ── Diagonal decorations: ×2 markers, highlights, dimensions ── */}
              {diagonals.map((d, di) => (
                <g key={`ddec-${di}`}>
                  {d.isDouble && (
                    <DoubleProfileMarker
                      x1={d.topX} y1={d.topY}
                      x2={d.botX} y2={d.botY}
                      thickness={BEAM_THICK_PX * 0.75} />
                  )}
                  {hl('diagonal') && (
                    <line x1={d.topX} y1={d.topY} x2={d.botX} y2={d.botY}
                      stroke={AMBER} strokeWidth={BEAM_THICK_PX * 2} strokeLinecap="round"
                      style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />
                  )}
                  {showDimensions && <Dim
                    ax1={d.topX - d.ux * d.halfCap} ay1={d.topY - d.uy * d.halfCap}
                    ax2={d.botX + d.ux * d.halfCap} ay2={d.botY + d.uy * d.halfCap}
                    label={fmt(d.lenCm)} off={-16} />}
                </g>
              ))}

              {/* ── Diagonal-position handles (edit mode) ──
                  Draggable endpoints sit on each beam where the diagonal lands:
                  drag to reposition, click to delete (✕ on hover). Lives in the
                  structure — not the punch bar — so non-admins (who never see the
                  admin-only punch bar) can adjust diagonals too. */}
              {editMode && !printMode && activeDiags.map((d, di) => {
                const handle = (which: 'top' | 'bot', hx: number, hy: number) => {
                  const isHov = hoverHandle?.which === which && hoverHandle?.spanIndex === d.spanIndex
                  return (
                    <g key={`${which}`}>
                      <circle cx={hx} cy={hy} r={5.5}
                        fill={isHov ? DANGER : BLUE} stroke="white" strokeWidth="1.5"
                        style={{ cursor: 'move' }}
                        onMouseEnter={() => setHoverHandle({ which, spanIndex: d.spanIndex })}
                        onMouseLeave={() => setHoverHandle(null)}
                        onMouseDown={(e) => startHandleDrag(e, which, d)} />
                      {isHov && <text x={hx} y={hy} textAnchor="middle" dominantBaseline="middle"
                        fontSize="8" fontWeight="900" fill="white" style={{ pointerEvents: 'none' }}>✕</text>}
                    </g>
                  )
                }
                return (
                  <g key={`diag-h-${di}`}>
                    {handle('top', d.topX, d.topY)}
                    {handle('bot', d.botX, d.botY)}
                  </g>
                )
              })}

              {/* Rail-clamp offset highlight */}
              {hl('rail-clamp') && (
                <g style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }}>
                  <line x1={panelX1} y1={panelY1} x2={x0} y2={topY0}
                    stroke={AMBER} strokeWidth="8" strokeLinecap="round" opacity="0.6" />
                  <circle cx={x0} cy={topY0} r={10} fill="none" stroke={AMBER} strokeWidth="2.5" />
                </g>
              )}

              {/* ── Panel highlight pulses (decoration on top of panel rects) ── */}
              {hl('panel') && (() => {
                let dCm = 0
                return segments.map((seg, idx) => {
                  dCm += seg.gapBeforeCm
                  const sx = atSlope(dCm).x
                  dCm += seg.depthCm
                  if (seg.isEmpty) return null
                  const ex = atSlope(dCm).x
                  const sy = beamYFromLegs(sx), ey = beamYFromLegs(ex)
                  const beamRad = beamAngleDeg * Math.PI / 180
                  const cx  = (sx + ex) / 2 + PANEL_OFFSET_PX * Math.sin(beamRad)
                  const cy  = (sy + ey) / 2 - PANEL_OFFSET_PX * Math.cos(beamRad)
                  const len = Math.sqrt((ex - sx) ** 2 + (ey - sy) ** 2)
                  return (
                    <rect key={`phl-${idx}`}
                      x={cx - len/2 - 5} y={cy - PANEL_THICK_PX/2 - 5}
                      width={len + 10} height={PANEL_THICK_PX + 10}
                      fill="none" stroke={AMBER} strokeWidth="2.5" rx="3"
                      transform={`rotate(${beamAngleDeg}, ${cx}, ${cy})`}
                      style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }}
                    />
                  )
                })
              })()}

              {/* ── Cross-rails profile (size from crossRailEdgeDistMm) ── */}
              {railItems.map(({ cx, segIdx, globalOffsetCm }, ci) => {
                const railFill   = RAIL_FILL
                const railStroke = RAIL_STROKE
                const cy = beamYFromLegs(cx)
                const beamTop  = -BEAM_THICK_PX / 2
                const panBot   = -(PANEL_OFFSET_PX - PANEL_THICK_PX / 2)
                const RW = crossRailEdgeDistCm * SC
                const RH = crossRailEdgeDistCm * SC
                const midY = (beamTop + panBot) / 2
                const labelOffPx = PANEL_OFFSET_PX + PANEL_THICK_PX + 10
                const lx = cx + (-Math.sin(angleRad)) * labelOffPx
                const ly = cy + (-Math.cos(angleRad)) * labelOffPx
                return (
                  <g key={ci}>
                    <g transform={`translate(${cx}, ${cy}) rotate(${beamAngleDeg})`}>
                      <rect x={-RW/2} y={midY - RH/2} width={RW} height={RH}
                        fill={railFill} stroke={railStroke} strokeWidth="1" />
                      {hl('cross-rails') && (
                        <rect x={-RW/2 - 5} y={midY - RH/2 - 5} width={RW + 10} height={RH + 10}
                          fill="none" stroke={AMBER} strokeWidth="2.5" rx="3"
                          style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />
                      )}
                    </g>
                    {punchesVisible && <text x={lx} y={ly}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize="10" fontWeight="700" fill={railStroke}
                      transform={`rotate(${beamAngleDeg}, ${lx}, ${ly})`}
                    >{fmt(globalOffsetCm - originCm)}</text>}
                  </g>
                )
              })}

              {/* ── Inner leg height dimensions ── */}
              {showDimensions && beLegs.slice(1, -1).map((_leg, ci) => {
                if (_leg.virtual) return null
                const lx = allLegXs[ci + 1]
                const lxEnd = allLegEndXs[ci + 1]
                const mx = (lx + lxEnd) / 2
                const slopeTopY = beamYFromLegs(legCenterXs[ci + 1]) - BEAM_THICK_PX / 2
                const legHCm = ((baseY + BEAM_THICK_PX) - slopeTopY) / SC
                return <Dim key={`ilh-${ci}`} ax1={mx} ay1={slopeTopY} ax2={mx} ay2={blockTopY} label={fmt(legHCm)} off={14} />
              })}

              {/* ── Punches on beams — non-diagonal from BE, diagonal from local activeDiags ── */}
              {punchesVisible && <>
                {(beDetailData?.punches ?? []).filter(p => p.origin !== 'diagonal').map((p, i) => {
                  const isBlock = p.origin === 'block'
                  const r = isBlock ? 3.5 : 2
                  if (p.beamType === 'base') {
                    const bbX0 = legX0 - firstLegPos * SC
                    const px = bbX0 + p.positionCm * SC
                    return <circle key={`p-${i}`} cx={px} cy={baseY + BEAM_THICK_PX / 2} r={r}
                      fill="white" stroke={TEXT_SECONDARY} strokeWidth="1" />
                  }
                  const px = legX0 + (p.positionCm / (topBeamLength || 1)) * legBW
                  const slopeY = beamYFromLegs(px)
                  return <circle key={`p-${i}`} cx={px} cy={slopeY} r={r}
                    fill="white" stroke={TEXT_SECONDARY} strokeWidth="1" />
                })}
                {activeDiags.map((d, di) => {
                  const slopeY = beamYFromLegs(d.topX)
                  return (<g key={`dp-${di}`}>
                    <circle cx={d.topX} cy={slopeY} r={2} fill="white" stroke={TEXT_SECONDARY} strokeWidth="1" />
                    <circle cx={d.botX} cy={baseY + BEAM_THICK_PX / 2} r={2} fill="white" stroke={TEXT_SECONDARY} strokeWidth="1" />
                  </g>)
                })}
              </>}

              {hl('blocks') && (
                <g style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }}>
                  {(beDetailData?.blocks ?? []).map((blk, bi) => {
                    const bbX0_hl = legX0 - firstLegPos * SC
                    const bx = bbX0_hl + blk.positionCm * SC
                    const bw = blockLengthCm * SC
                    return <rect key={bi} x={bx - 5} y={blockTopY - 5} width={bw + 10} height={blockH + 10}
                      fill="none" stroke={AMBER} strokeWidth="2.5" rx="3" />
                  })}
                </g>
              )}

              {hl('extension') && (defaultFrontExtCm > 0 || defaultRearExtCm > 0) && (
                <g style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }}>
                  {defaultRearExtCm > 0 && (() => {
                    // Back extension (beam-REAR): drawing-LEFT, between bbX0 and leg 0
                    const extW = firstLegPos * SC
                    return <rect x={legX0 - extW - 3} y={baseY - 3} width={extW + 6} height={BEAM_THICK_PX + 6}
                      fill="none" stroke={AMBER} strokeWidth="2.5" rx="3" />
                  })()}
                  {defaultFrontExtCm > 0 && (() => {
                    // Front extension (beam-FRONT): drawing-RIGHT, last `frontExtCm` of the beam
                    const bbEnd = legX0 - firstLegPos * SC + (geom.baseBeamLength ?? 0) * SC
                    const frontExtW = defaultFrontExtCm * SC
                    return <rect x={bbEnd - frontExtW - 3} y={baseY - 3} width={frontExtW + 6} height={BEAM_THICK_PX + 6}
                      fill="none" stroke={AMBER} strokeWidth="2.5" rx="3" />
                  })()}
                </g>
              )}

              {/* ── Green floor / roof surface line ── */}
              {(showRoofLine && !printMode) && (
                <DetailCorrugatedRoof
                  roofType={roofType} installationOrientation={installationOrientation} purlinDistCm={purlinDistCm}
                  panelX1={panelX1} panelX2={panelX2} blockBotY={blockBotY} baseY={baseY}
                  BEAM_THICK_PX={BEAM_THICK_PX} SC={SC} legX0={legX0} firstLegPos={firstLegPos} geom={geom} legBW={legBW}
                />
              )}

              {/* ── Angle label inside trapezoid ── */}
              <text x={activeBeamR - 32} y={beamYFromLegs(activeBeamR) + 22} fontSize="12" fill={TEXT_SECONDARY} fontWeight="700">{angle}°</text>

              {/* ── Dimension dimensions ── */}
              {showDimensions && <>
                {/* Slope beam: active portion only */}
                <Dim ax1={activeBoundL} ay1={beamYFromLegs(activeBoundL)} ax2={activeBoundR} ay2={beamYFromLegs(activeBoundR)}
                  label={fmt(activeSlopeBeamLenCm)} off={-(PANEL_OFFSET_PX + 14)} />

                {(() => {
                  if (!hasActiveZone) return null
                  // Panel distance dimensions: all on the beam line (parallel to panel)
                  const panelOff = -(PANEL_OFFSET_PX + 38)
                  const psx = atSlope(firstActiveDepth).x
                  const pex = atSlope(lastActiveDepth).x
                  const r1x = railItems[0]?.cx ?? psx
                  const r2x = railItems[railItems.length - 1]?.cx ?? pex
                  return (<>
                    <Dim ax1={psx} ay1={beamYFromLegs(psx)} ax2={r1x} ay2={beamYFromLegs(r1x)}
                      label={fmt(geom.panelEdgeToFirstRailCm ?? 0)} off={panelOff} />
                    <Dim ax1={r1x} ay1={beamYFromLegs(r1x)} ax2={r2x} ay2={beamYFromLegs(r2x)}
                      label={fmt(geom.railToRailCm ?? 0)} off={panelOff} />
                    <Dim ax1={r2x} ay1={beamYFromLegs(r2x)} ax2={pex} ay2={beamYFromLegs(pex)}
                      label={fmt(geom.panelEdgeToLastRailCm ?? 0)} off={panelOff} />
                  </>)
                })()}

                {/* Left leg height: annotation on OUTSIDE (left) */}
                {!beLegs[0]?.virtual && (() => {
                  const slopeTopY = beamYFromLegs(legCenterXs[0]) - BEAM_THICK_PX / 2
                  const legHCm = ((baseY + BEAM_THICK_PX) - slopeTopY) / SC
                  return <Dim ax1={activeBeamL} ay1={slopeTopY} ax2={activeBeamL} ay2={baseY + BEAM_THICK_PX}
                    label={fmt(legHCm)} off={18} />
                })()}

                <Dim ax1={activePanelStartBot.x} ay1={blockBotY}
                     ax2={activePanelStartBot.x} ay2={activePanelStartBot.y}
                  label={fmt(geom.panelFrontHeight ?? 0)}
                  off={-22} />

                {/* Right leg height: annotation on OUTSIDE (right) */}
                {!beLegs[beLegs.length - 1]?.virtual && (() => {
                  const lastIdx = legCenterXs.length - 1
                  const slopeTopY = beamYFromLegs(legCenterXs[lastIdx]) - BEAM_THICK_PX / 2
                  const legHCm = ((baseY + BEAM_THICK_PX) - slopeTopY) / SC
                  return <Dim ax1={activeBeamR} ay1={slopeTopY} ax2={activeBeamR} ay2={baseY + BEAM_THICK_PX}
                    label={fmt(legHCm)} off={-18} />
                })()}

                <Dim ax1={activePanelEndBot.x} ay1={blockBotY}
                     ax2={activePanelEndBot.x} ay2={activePanelEndBot.y}
                  label={fmt(geom.panelRearHeightCm ?? 0)}
                  off={28} />

                {/* Base beam: full length including extensions */}
                {(() => {
                  const firstLegPos = (beLegs[0]?.positionCm ?? 0) * SC
                  const bbX0 = legX0 - firstLegPos
                  const bbX1 = bbX0 + activeBaseBeamLenCm * SC
                  return <Dim ax1={bbX0} ay1={blockBotY + 18} ax2={bbX1} ay2={blockBotY + 18}
                    label={fmt(activeBaseBeamLenCm)} off={14} />
                })()}
              </>}

              {/* ── Base beam punch sketch ── */}
              {punchesVisible && (() => {
                const baseBeamLen = activeBaseBeamLenCm
                const flp = beLegs[0]?.positionCm ?? 0
                const bbX0 = legX0 - flp * SC
                const bbW = baseBeamLen * SC
                const atBase = (posCm) => bbX0 + (posCm / baseBeamLen) * bbW
                // Spliced base: label each punch by its position along its own
                // piece (matches the per-piece puncher sheet); break the bar.
                const baseSegs = geom.baseBeamSegments
                const isBaseSplit = (baseSegs?.length ?? 0) > 1
                const baseLabel = (p) => fmt(isBaseSplit && p.piecePositionCm != null ? p.piecePositionCm : p.positionCm)
                const baseLiveDiag = liveDiagPunches.map(d => ({ x: atBase(d.botPosCm), label: fmt(isBaseSplit ? pieceLabelCm(d.botPosCm, baseSegs, false) : d.botPosCm), origin: 'diagonal' }))
                const points = makePunchPoints('base', 'block', atBase, baseLabel, baseLiveDiag)
                const segments = isBaseSplit
                  ? baseSegs.map(s => ({ x0: atBase(s.startCm), x1: atBase(s.endCm), lengthCm: s.lengthCm }))
                  : undefined
                return <DetailPunchSketch which="bot" ry={blockBotY + 150}
                  barX0={bbX0} barW={bbW} beamLenCm={baseBeamLen}
                  punches={points} activeDiags={activeDiags}
                  showDiagHandles={editMode} printMode={printMode}
                  barHover={barHover} setBarHover={setBarHover}
                  handleBarMouseMove={handleBarMouseMove} handleBarClick={handleBarClick}
                  findSpan={findSpan} activeSpanSet={activeSpanSet}
                  activeBoundL={bbX0} activeBoundR={bbX0 + bbW}
                  fmt={fmt} Dim={Dim} t={t} labelKey="step3.detail.baseBeamPunches" segments={segments} />
              })()}

              {/* ── Slope beam punch sketch ── */}
              {punchesVisible && (() => {
                const slopeLen = topBeamLength
                const atSlope2 = (posCm) => legX0 + (posCm / slopeLen) * legBW
                const slopeSegs = geom.topBeamSegments
                const isSlopeSplit = (slopeSegs?.length ?? 0) > 1
                const slopeSegLen = isSlopeSplit
                  ? Object.fromEntries(slopeSegs.map(s => [s.idx, s.lengthCm]))
                  : {}
                // Spliced slope: label per piece, honoring the reverse setting
                // (segment length − piecePositionCm); else full-beam position.
                const slopeLabel = (p) => {
                  if (isSlopeSplit && p.piecePositionCm != null) {
                    const segLen = slopeSegLen[p.segmentIdx ?? 0] ?? slopeLen
                    return fmt(reverseBlockPunches ? segLen - p.piecePositionCm : p.piecePositionCm)
                  }
                  return fmt(reverseBlockPunches && p.reversedPositionCm != null ? p.reversedPositionCm : p.positionCm)
                }
                // Diagonal punches must honor the reverse setting too — mirror the BE
                // slope reverse (top_beam_length - positionCm) so they match the rail punches.
                const slopeLiveDiag = liveDiagPunches.map(d => ({ x: atSlope2(d.topPosCm), label: fmt(isSlopeSplit ? pieceLabelCm(d.topPosCm, slopeSegs, reverseBlockPunches) : (reverseBlockPunches ? slopeLen - d.topPosCm : d.topPosCm)), origin: 'diagonal' }))
                const points = makePunchPoints('slope', 'rail', atSlope2, slopeLabel, slopeLiveDiag)
                const segments = isSlopeSplit
                  ? slopeSegs.map(s => ({ x0: atSlope2(s.startCm), x1: atSlope2(s.endCm), lengthCm: s.lengthCm }))
                  : undefined
                return <DetailPunchSketch which="top" ry={blockBotY + 72}
                  barX0={legX0} barW={legBW} beamLenCm={slopeLen}
                  punches={points} activeDiags={activeDiags}
                  showDiagHandles={editMode} printMode={printMode}
                  barHover={barHover} setBarHover={setBarHover}
                  handleBarMouseMove={handleBarMouseMove} handleBarClick={handleBarClick}
                  findSpan={findSpan} activeSpanSet={activeSpanSet}
                  activeBoundL={activeBoundL} activeBoundR={activeBoundR}
                  fmt={fmt} Dim={Dim} t={t} labelKey="step3.detail.slopeBeamPunches" segments={segments} />
              })()}

            </svg>

            {/* Members table */}
            {!printMode && <div style={{ marginTop: '1.5rem', maxWidth: '340px' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>{t('step3.detail.membersTitle')}</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ background: BG_SUBTLE }}>
                    <th style={{ textAlign: 'left', padding: '0.3rem 0.5rem', fontWeight: '700', color: TEXT_SECONDARY }}>{t('step3.detail.element')}</th>
                    <th style={{ textAlign: 'right', padding: '0.3rem 0.5rem', fontWeight: '700', color: TEXT_SECONDARY }}>{t('step3.detail.length')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    [t('step3.detail.baseBeam'),  activeBaseBeamLenCm],
                    [t('step3.detail.topBeam'),   activeSlopeBeamLenCm],
                    ...(!beLegs[0]?.virtual ? [[t('step3.detail.rearLeg'), beLegs[0]?.heightCm ?? 0]] : []),
                    ...(!beLegs[beLegs.length - 1]?.virtual ? [[t('step3.detail.frontLeg'), beLegs[beLegs.length - 1]?.heightCm ?? 0]] : []),
                    ...activeDiags.map((d, i) => [
                      activeDiags.length > 1
                        ? `${t('step3.detail.diagonal')} ${i + 1}${d.isDouble ? ' ×2' : ''}`
                        : `${t('step3.detail.diagonal')}${d.isDouble ? ' ×2' : ''}`,
                      d.lenCm,
                    ]),
                  ].map(([name, val]) => (
                    <tr key={name} style={{ borderTop: `1px solid ${BG_MID}` }}>
                      <td style={{ padding: '0.3rem 0.5rem', color: TEXT_SECONDARY }}>{name}</td>
                      <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', fontWeight: '600', color: TEXT_DARKEST }}>{fmt(val)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
          </div>
        </div>
      </div>

      {!printMode && <RulerTool active={rulerActive} zoom={zoom} pxPerCm={2.2} containerRef={containerRef} />}

      {/* ── Layers panel ── */}
      {!printMode && <LayersPanel
        layers={editMode ? [] : [
          ...(canViewPunches ? [{ label: t('step3.layer.punches'), checked: showPunches, setter: setShowPunches }] : []),
          { label: t('step3.layer.dimensions'),   checked: showDimensions,  setter: setShowDimensions  },
          { label: t('step3.layer.roofLine'),   checked: showRoofLine,    setter: setShowRoofLine     },
          ...(fullTrapGhost ? [{ label: t('step3.layer.ghost'), checked: showGhost, setter: setShowGhost }] : []),
        ]}
        summary={editMode ? (
          <span>{t('step3.editMode.detailHint') || 'Drag handles to move; click empty beam to add a block, ✕ to remove. Drag diagonal endpoints to reposition.'}</span>
        ) : null}
        actions={editMode ? [
          { label: (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 8.5l3 3 7-7" />
                </svg>
                {t('step3.editMode.exit')}
              </span>
            ),
            onClick: async () => {
              // Host (Step3) gates the exit on unsaved edits: prompts user
              // to apply / discard / cancel. Returns false to keep edit mode
              // open. Matches the BasesPlanTab exit-confirm flow.
              if (onRequestExitEdit) {
                const ok = await onRequestExitEdit()
                if (!ok) return
              }
              setEditMode(false)
            },
            style: {
              color: 'white', background: PRIMARY, border: `1px solid ${PRIMARY}`,
              padding: '0.45rem 0.6rem', fontSize: '0.78rem', fontWeight: 700,
            } },
          { label: rulerActive ? t('step3.layer.rulerOn') : t('step3.layer.ruler'),
            onClick: () => { if (rulerActive) RulerTool._clear?.(); setRulerActive(v => !v) },
            style: rulerActive ? { color: BLUE, background: BLUE_BG, border: `1px solid ${BLUE_BORDER}` } : {} },
        ] : [
          { label: (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M11.5 1.5l3 3-9 9H2.5v-3z" />
                  <path d="M10 3l3 3" />
                </svg>
                {t('step3.editMode.detailEnter') || 'Edit trap'}
              </span>
            ),
            onClick: () => setEditMode(true),
            style: {
              color: 'white', background: PRIMARY, border: `1px solid ${PRIMARY}`,
              padding: '0.45rem 0.6rem', fontSize: '0.78rem', fontWeight: 700,
            } },
          // Unified "Reset to defaults" wipes settings + diagOverrides +
          // customBlocks for the selected trap. The former "Reset handles"
          // action was redundant once the unified reset clears diagOverrides.
          ...(onReset ? [{ label: t('step3.layer.resetDefaults'), onClick: onReset, style: { color: AMBER_DARK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}` } }] : []),
          { label: rulerActive ? t('step3.layer.rulerOn') : t('step3.layer.ruler'), onClick: () => { if (rulerActive) RulerTool._clear?.(); setRulerActive(v => !v) }, style: rulerActive ? { color: BLUE, background: BLUE_BG, border: `1px solid ${BLUE_BORDER}` } : {} },
        ]}
      />}

      {/* ── Floating navigator ── */}
      {!printMode && <CanvasNavigator
        viewZoom={zoom}
        onZoomOut={() => { const nz = Math.max(0.25, zoom * 0.833); zoomAtCenter(zoom, nz); setZoom(nz) }}
        onZoomReset={resetView}
        onZoomIn={() => { const nz = Math.min(6, zoom * 1.2); zoomAtCenter(zoom, nz); setZoom(nz) }}
        mmWidth={MM_W}
        mmHeight={MM_H}
        onPanToPoint={panToMinimapPoint}
        viewportRect={getMinimapViewportRect()}
        left={276}
      />}

    </div>
  )
}
