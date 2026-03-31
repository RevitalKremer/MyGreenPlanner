import { useState, useRef } from 'react'
import { useLang } from '../../../i18n/LangContext'
import { TEXT_SECONDARY, TEXT_DARKEST, TEXT_VERY_LIGHT, TEXT_PLACEHOLDER, BG_SUBTLE, BG_MID, BLUE, BLUE_BG, BLUE_BORDER, AMBER_DARK, GHOST_FILL, GHOST_STROKE, GHOST_DASH, AMBER, RAIL_STROKE, L_PROFILE_FILL, L_PROFILE_STROKE, BLOCK_FILL, BLOCK_STROKE, PANEL_BAR_FILL, PANEL_BAR_STROKE, RAIL_FILL, PUNCH_BAR_FILL, PUNCH_BAR_STROKE, DANGER, ADD_GREEN, BORDER, GROUND_LINE, AMBER_BG, AMBER_BORDER } from '../../../styles/colors'
import CanvasNavigator from '../../shared/CanvasNavigator'
import { useCanvasPanZoom } from '../../../hooks/useCanvasPanZoom'
import LayersPanel from './LayersPanel'
import RulerTool from '../../shared/RulerTool'

export default function DetailView({ rc, trapId = null, panelLines = null, settings = {}, lineRails = null, highlightParam = null, beDetailData = null, fullTrapGhost = null, paramGroup: PARAM_GROUP = {}, onReset = null, onUpdateSetting = null, printMode = false }) {
  const { t } = useLang()
  const [_showAnnotations, setShowAnnotations]  = useState(true)
  const [_showPunches,     setShowPunches]      = useState(true)
  const [_showDiagHandles, setShowDiagHandles]  = useState(true)
  const [showGhost,        setShowGhost]        = useState(true)
  const showAnnotations = _showAnnotations
  const showPunches     = _showPunches
  const showDiagHandles = _showDiagHandles
  const [rulerActive,      setRulerActive]      = useState(false)
  const [barHover,         setBarHover]         = useState(null) // { which: 'top'|'bot', svgX } | null
  const [hoverHandle,      setHoverHandle]      = useState(null) // { which, spanIndex } | null

  const svgRef      = useRef(null)
  const diagDragRef = useRef(null) // { which, spanIndex, xA, spanW, startClientX, didDrag }

  const {
    zoom, setZoom, panOffset, panActive,
    containerRef, contentRef,
    startPan, handleMouseMove, stopPan, resetView,
    MM_W, MM_H, panToMinimapPoint, getMinimapViewportRect,
  } = useCanvasPanZoom()

  // Rail offset = first rail of first line (derived from lineRails)
  const railOffsetCm   = lineRails?.[0]?.[0] ?? 0
  const blockHeightCm  = settings.blockHeightCm  ?? 30
  const blockLengthCm   = settings.blockLengthCm   ?? 50
  const blockPunchCm   = Math.min(settings.blockPunchCm ?? 9, blockLengthCm)
  const crossRailEdgeDistCm = (settings.crossRailEdgeDistMm ?? 40) / 10
  const panelLengthCm  = settings.panelLengthCm
  const diagTopPct     = (settings.diagTopPct  ?? 25) / 100
  const diagBasePct    = (settings.diagBasePct ?? 90) / 100
  const diagOverrides  = settings.diagOverrides ?? {}

  // Highlight helpers
  const hlGroup = PARAM_GROUP[highlightParam] ?? null
  const hl = (group) => hlGroup === group

  // Use BE-computed geometry when available, fall back to FE rc
  const geom = beDetailData?.geometry ?? rc
  if (!geom) return <div style={{ padding: '2rem', color: TEXT_VERY_LIGHT }}>{t('step3.empty.selectRow')}</div>

  const baseOverhangCm = settings.baseOverhangCm ?? 0
  const { heightRear, heightFront, baseLength, angle, topBeamLength } = geom

  const SC         = 2.2
  const RAIL_CM    = railOffsetCm
  const BLOCK_H_CM = blockHeightCm

  const angleRad = angle * Math.PI / 180
  const bW      = baseLength   * SC   // leg-to-leg horizontal span
  const OHx     = baseOverhangCm * Math.cos(angleRad) * SC
  const hR      = heightRear   * SC
  const hF      = heightFront  * SC
  const railOffH = RAIL_CM * Math.cos(angleRad) * SC
  const railOffV = RAIL_CM * Math.sin(angleRad) * SC
  const blockH  = BLOCK_H_CM   * SC

  const segments = (panelLines && panelLines.length > 0)
    ? panelLines
    : [{ depthCm: panelLengthCm ?? 0, gapBeforeCm: 0 }]
  const totalPanelDepthCm = segments.reduce((s, seg) => s + (seg.gapBeforeCm ?? 0) + (seg.depthCm ?? 0), 0)

  const padL = Math.max(120, railOffH + OHx + 40)
  const panelExtCm = (totalPanelDepthCm - RAIL_CM) * Math.cos(angleRad) - baseLength
  const padR = Math.max(100, Math.max(panelExtCm * SC, OHx) + 70)
  const _panelOffsetApprox = 2 * SC + 10 + 3
  const _slopeAbove = bW > 0 ? (hR - hF) * railOffH / bW : 0
  const _annotAbove = Math.cos(angleRad) * (_panelOffsetApprox + 30)
  const padT = printMode ? Math.max(55, hR - hF + _slopeAbove + _annotAbove + 40) : 55
  const padB = blockH + 290

  const svgW = bW + padL + padR
  const svgH = hF + padT + padB

  const baseY     = hF + padT
  const topY0     = baseY - hR
  const topY1     = baseY - hF
  const x0 = padL
  const x1 = padL + bW

  const slope   = bW > 0 ? (topY1 - topY0) / bW : 0
  // Slope beam extended endpoints: overhang is along the slope → decompose into OHx/OHy
  // Leg positions at trapezoid ends — will be overridden by BE data below
  let legX0 = x0 - OHx
  let legX1 = x1 + OHx
  let legBW = bW + 2 * OHx
  const panelX1 = x0 - railOffH
  const panelY1 = topY0 + railOffV
  const atSlope = (dCm) => ({
    x: panelX1 + dCm * Math.cos(angleRad) * SC,
    y: panelY1 - dCm * Math.sin(angleRad) * SC,
  })
  const { x: panelX2, y: panelY2 } = atSlope(totalPanelDepthCm)

  const beamY = (x) => topY0 + slope * (x - x0)

  // Build rail items from lineRails: each entry carries the SVG x position,
  // segment index, and the offset-within-segment in cm.
  const railItems = (() => {
    const items = []
    let dCm = 0
    for (let si = 0; si < segments.length; si++) {
      const seg = segments[si]
      dCm += (seg.gapBeforeCm ?? 0)
      const segRails = lineRails?.[si] ?? []
      for (const offsetCm of segRails) {
        items.push({ cx: atSlope(dCm + offsetCm).x, segIdx: si, offsetCm, globalOffsetCm: dCm + offsetCm })
      }
      dCm += (seg.depthCm ?? 0)
    }
    return items
  })()
  const BEAM_THICK_PX = 4 * SC
  const blockTopY = baseY + BEAM_THICK_PX   // blocks sit below the outer bottom face of the base beam
  const blockBotY = blockTopY + blockH
  const PANEL_THICK_PX = 6
  const PANEL_OFFSET_PX = BEAM_THICK_PX / 2 + 10 + PANEL_THICK_PX / 2
  const panOffX = -Math.sin(angleRad) * PANEL_OFFSET_PX
  const panOffY = -Math.cos(angleRad) * PANEL_OFFSET_PX

  const blockW  = blockLengthCm * SC
  // ── Multi-diagonal logic ──────────────────────────────────────────────────
  const legHeightAtX = (x) => (baseY - beamY(x)) / SC

  // Per-segment rail ordering: sort each segment's rails by offsetCm and record position
  const segSortedIndices = {}   // segIdx -> globalRailIdx[] sorted by offsetCm
  railItems.forEach((r, i) => {
    if (!segSortedIndices[r.segIdx]) segSortedIndices[r.segIdx] = []
    segSortedIndices[r.segIdx].push(i)
  })
  Object.values(segSortedIndices).forEach(arr =>
    arr.sort((a, b) => railItems[a].offsetCm - railItems[b].offsetCm)
  )
  // globalRailIdx -> { pos (0-indexed within segment), N (total in segment) }
  const railPosInSeg = new Map()
  Object.values(segSortedIndices).forEach(arr =>
    arr.forEach((globalIdx, pos) => railPosInSeg.set(globalIdx, { pos, N: arr.length }))
  )
  // Leg X positions and heights: use BE data when available
  const beLegs = beDetailData?.legs
  const allLegXs = (() => {
    if (beLegs && beLegs.length >= 2) {
      return beLegs.map(leg => atSlope(leg.positionCm).x)
    }
    // Fallback: compute from rail items
    const innerLegXsFallback = railItems.slice(1, -1).map((r, ci) => {
      const offset = crossRailEdgeDistCm * Math.cos(angleRad) * SC
      const { pos, N } = railPosInSeg.get(ci + 1) ?? { pos: 0, N: 1 }
      return (N > 1 && pos > Math.floor((N - 1) / 2)) ? r.cx + offset : r.cx - offset
    })
    return [legX0, ...innerLegXsFallback, legX1]
  })()
  // Leg heights in px: from BE or from beamY interpolation
  const allLegHeights = beLegs
    ? beLegs.map(leg => leg.heightCm * SC)
    : allLegXs.map(lx => baseY - beamY(lx))
  // Leg top Y positions (where slope beam meets the leg)
  const allLegTopYs = allLegHeights.map((lh, i) => baseY - lh)
  const innerLegXs = allLegXs.slice(1, -1)
  // Override beam-end leg positions from BE data
  if (beLegs && beLegs.length >= 2) {
    legX0 = allLegXs[0]
    legX1 = allLegXs[allLegXs.length - 1]
    legBW = legX1 - legX0
  }
  // Build diagonal data: use BE decisions (topPct, botPct, isDouble, disabled) when available,
  // but always compute pixel positions (topX, botX, topY, botY) from leg positions.
  // No per-element ghost flags — ghost is rendered as a separate SVG overlay
  const innerRailItems  = railItems.slice(1, -1)
  const innerLegIsGhost = innerRailItems.map(() => false)
  const legIsGhostFull  = allLegXs.map(() => false)
  const firstActiveSegIdx = 0
  const lastActiveSegIdx  = segments.length - 1

  // Diagonals — always from BE data, FE only computes pixel positions
  const diagonals = (() => {
    const beDiags = beDetailData?.diagonals ?? []
    const numSpans = allLegXs.length - 1
    const raw = beDiags.map(d => {
      if (d.spanIdx >= numSpans) return null
      const xA = allLegXs[d.spanIdx], xB = allLegXs[d.spanIdx + 1]
      const spanW = xB - xA
      const topX = xA + d.topPct * spanW
      const botX = xA + d.botPct * spanW
      // Interpolate slope Y from leg heights at span endpoints
      const hATopY = allLegTopYs[d.spanIdx], hBTopY = allLegTopYs[d.spanIdx + 1]
      const topY = hATopY + d.topPct * (hBTopY - hATopY)
      const botY = baseY + BEAM_THICK_PX / 2
      const _dx = botX - topX, _dy = botY - topY
      const _len = Math.sqrt(_dx * _dx + _dy * _dy)
      const ux = _len > 0 ? _dx / _len : 0, uy = _len > 0 ? _dy / _len : 0
      const halfCap = BEAM_THICK_PX * 0.75 / 2
      const reversed = numSpans > 1 && d.spanIdx === 0
      return {
        xA, xB, spanW, topX, botX, topY, botY, ux, uy, halfCap,
        lenCm: d.lengthCm, isDouble: d.isDouble, reversed, skip: d.disabled,
        spanIndex: d.spanIdx,
        hA: allLegHeights[d.spanIdx] / SC, hB: allLegHeights[d.spanIdx + 1] / SC,
      }
    }).filter(Boolean)
    return raw.filter(s => !s.skip)
  })()

  // Active beam boundary: first and last non-ghost leg indices
  const _fali = legIsGhostFull.findIndex(g => !g)
  const firstActiveLegIdx = _fali < 0 ? 0 : _fali
  const _laliRev = [...legIsGhostFull].reverse().findIndex(g => !g)
  const lastActiveLegIdx  = _laliRev < 0 ? legIsGhostFull.length - 1 : (legIsGhostFull.length - 1 - _laliRev)
  const hasActiveZone = firstActiveLegIdx <= lastActiveLegIdx
  const activeBeamL = hasActiveZone ? allLegXs[firstActiveLegIdx] : legX0
  const activeBeamR = hasActiveZone ? allLegXs[lastActiveLegIdx]  : legX0
  // Outer edges of active beam ends: outer legs already at edge; inner legs are center-based so offset by half thickness
  const activeBoundL = hasActiveZone ? (firstActiveLegIdx === 0 ? activeBeamL : activeBeamL - BEAM_THICK_PX / 2) : legX0
  const activeBoundR = hasActiveZone ? (lastActiveLegIdx === allLegXs.length - 1 ? activeBeamR : activeBeamR + BEAM_THICK_PX / 2) : legX0

  // Ghost style: all rendered as rects using centralized ghost colors
  const ghostRect = (props) => <rect {...props} fill={GHOST_FILL} stroke={GHOST_STROKE} strokeWidth="1" strokeDasharray={GHOST_DASH} />
  const ghostLine = ({ x1, y1, x2, y2, strokeWidth: sw }) => {
    const dx = x2 - x1, dy = y2 - y1
    const len = Math.sqrt(dx * dx + dy * dy)
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
    const ang = Math.atan2(dy, dx) * 180 / Math.PI
    return ghostRect({ x: -len / 2, y: -(sw || 1) / 2, width: len, height: sw || 1, transform: `translate(${mx},${my}) rotate(${ang})` })
  }
  // Renders a thick line as a rotated rect so fill + stroke border work correctly with semi-transparent fill
  const lProfileLine = ({ x1, y1, x2, y2, strokeWidth: sw, capExtend: cap = 0 }) => {
    const dx = x2 - x1, dy = y2 - y1
    const len = Math.sqrt(dx * dx + dy * dy)
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
    const ang = Math.atan2(dy, dx) * 180 / Math.PI
    const h = sw || 1
    return <rect x={-(len / 2 + cap)} y={-h / 2} width={len + 2 * cap} height={h}
      fill={L_PROFILE_FILL} stroke={L_PROFILE_STROKE} strokeWidth="1"
      transform={`translate(${mx},${my}) rotate(${ang})`} />
  }

  // Diagonals with both legs in the active zone (used for punch sketches + annotations)
  const activeDiags          = diagonals.filter(d => !legIsGhostFull[d.spanIndex] && !legIsGhostFull[d.spanIndex + 1])
  const activeSlopeBeamLenCm = (activeBoundR - activeBoundL) / legBW * topBeamLength
  const activeBaseBeamLenCm  = (activeBoundR - activeBoundL) / SC

  // Slope positions at the edges of the active panel area
  const activePanelStart = (() => {
    if (firstActiveSegIdx < 0 || firstActiveSegIdx >= segments.length) return { x: panelX1, y: panelY1 }
    let d = 0
    for (let i = 0; i < firstActiveSegIdx; i++) d += (segments[i].gapBeforeCm ?? 0) + (segments[i].depthCm ?? 0)
    d += segments[firstActiveSegIdx].gapBeforeCm ?? 0
    return atSlope(d)
  })()
  const activePanelEnd = (() => {
    if (lastActiveSegIdx < 0 || lastActiveSegIdx >= segments.length) return { x: panelX2, y: panelY2 }
    let d = 0
    for (let i = 0; i <= lastActiveSegIdx; i++) d += (segments[i].gapBeforeCm ?? 0) + (segments[i].depthCm ?? 0)
    return atSlope(d)
  })()

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
    const { topPct, botPct, ...rest } = diagOverrides[spanIndex] ?? {}  // eslint-disable-line no-unused-vars
    onUpdateSetting?.('diagOverrides', { ...diagOverrides, [spanIndex]: { ...rest, disabled: true } })
  }

  // ── Handle drag (window-listener based, click-vs-drag) ────────────────────
  const startHandleDrag = (e, which, d) => {
    e.stopPropagation()
    const startClientX = e.clientX
    const initialPct   = which === 'top'
      ? (diagOverrides[d.spanIndex]?.topPct ?? (d.spanW > 0 ? (d.topX - d.xA) / d.spanW : 0.25))
      : (diagOverrides[d.spanIndex]?.botPct ?? (d.spanW > 0 ? (d.botX - d.xA) / d.spanW : 0.90))
    const capturedOv   = { ...diagOverrides }
    let didDrag        = false

    const onMove = (me) => {
      if (Math.abs(me.clientX - startClientX) > 3) didDrag = true
      if (!didDrag) return
      const deltaSvgX = (me.clientX - startClientX) / zoom
      const pct = Math.max(0.05, Math.min(0.95, initialPct + deltaSvgX / d.spanW))
      const key = which === 'top' ? 'topPct' : 'botPct'
      const existing = capturedOv[d.spanIndex] ?? {}
      onUpdateSetting?.('diagOverrides', { ...capturedOv, [d.spanIndex]: { ...existing, [key]: pct } })
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
    const clickedPct = Math.max(0.05, Math.min(0.95, (svgX - span.xA) / span.spanW))
    const topPct = which === 'top' ? clickedPct : 0.5
    const botPct = which === 'bot' ? clickedPct : 0.5
    const entry  = naturallySkipped.has(span.spanIndex)
      ? { disabled: false, topPct, botPct }
      : { topPct, botPct }
    onUpdateSetting?.('diagOverrides', { ...diagOverrides, [span.spanIndex]: entry })
  }

  const handleContainerMouseMove = (e) => handleMouseMove(e)
  const handleContainerMouseUp   = (e) => { stopPan(e) }
  const handleContainerMouseLeave = (e) => { stopPan(e) }

  const DC = TEXT_DARKEST
  const TC = TEXT_VERY_LIGHT

  // Format to 1 decimal, stripping trailing ".0"
  const fmt = (v) => parseFloat(v.toFixed(1)).toString()

  const beamAngleDeg = Math.atan2(topY1 - topY0, x1 - x0) * 180 / Math.PI

  const Dim = ({ ax1, ay1, ax2, ay2, label, off = 12, tbd = false, fs = 8 }) => {
    const col = tbd ? TC : DC
    const mk  = tbd ? 't' : 'k'
    const dx = ax2 - ax1, dy = ay2 - ay1
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < 2) return null
    const nx = -dy / len * off, ny = dx / len * off
    const lx1 = ax1 + nx, ly1 = ay1 + ny
    const lx2 = ax2 + nx, ly2 = ay2 + ny
    const mx = (lx1 + lx2) / 2, my = (ly1 + ly2) / 2
    const ang = Math.atan2(dy, dx) * 180 / Math.PI
    const ta = ang > 90 || ang < -90 ? ang + 180 : ang
    return (
      <g>
        <line x1={ax1} y1={ay1} x2={lx1} y2={ly1} stroke={col} strokeWidth="0.5" />
        <line x1={ax2} y1={ay2} x2={lx2} y2={ly2} stroke={col} strokeWidth="0.5" />
        <line x1={lx1} y1={ly1} x2={lx2} y2={ly2} stroke={col} strokeWidth="0.8"
          markerStart={`url(#arr-${mk})`} markerEnd={`url(#arr-${mk})`} />
        <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle"
          fontSize={fs} fontWeight="600" fill={col}
          transform={`rotate(${ta} ${mx} ${my})`}
        >{tbd ? 'TBD' : label}</text>
      </g>
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
            <div style={{ fontSize: '0.78rem', fontWeight: '700', color: TEXT_SECONDARY, marginBottom: '0.75rem' }}>
              {trapId ?? `${rc.typeLetter}${rc.panelsPerSpan}`} — {angle}° · Panel Front {fmt(BLOCK_H_CM + heightRear + crossRailEdgeDistCm * Math.cos(angleRad) - RAIL_CM * Math.sin(angleRad))} cm
              <span style={{ fontWeight: '400', color: TEXT_PLACEHOLDER, marginLeft: '0.5rem' }}>
                · Panel {fmt(panelLengthCm)}×{fmt(settings.panelWidthCm)} cm
              </span>
            </div>

            <svg ref={svgRef} width={svgW} height={svgH}
              style={{ display: 'block', overflow: 'visible' }}>

              {/* ── Ghost layer: full trap structural outline drawn in ghost style ── */}
              {showGhost && fullTrapGhost?.beDetailData?.geometry && (() => {
                const gGeom = fullTrapGhost.beDetailData.geometry
                const gAngleRad = gGeom.angle * Math.PI / 180
                const gHR = gGeom.heightRear * SC
                // Align at panel start: same base line, shift so rear leg tops match
                const gBaseY = baseY + (hR - gHR)
                const gBlockTopY = gBaseY + BEAM_THICK_PX

                // Ghost style helpers — same as original ghost rendering (filled rects with dashed stroke)
                const GR = (props) => <rect {...props} fill={GHOST_FILL} stroke={GHOST_STROKE} strokeWidth="1" strokeDasharray={GHOST_DASH} />
                const GL = ({ x1: lx1, y1: ly1, x2: lx2, y2: ly2, sw }) => {
                  const dx = lx2 - lx1, dy = ly2 - ly1
                  const len = Math.sqrt(dx * dx + dy * dy)
                  const mx = (lx1 + lx2) / 2, my = (ly1 + ly2) / 2
                  const ang = Math.atan2(dy, dx) * 180 / Math.PI
                  return GR({ x: -len / 2, y: -(sw || 1) / 2, width: len, height: sw || 1, transform: `translate(${mx},${my}) rotate(${ang})` })
                }

                const gDiags = (fullTrapGhost.beDetailData.diagonals ?? []).filter(d => !d.disabled)
                const gLegs = fullTrapGhost.beDetailData.legs ?? []
                // Ghost atSlope: same panel origin as real trap, converts positionCm to SVG x
                const gAtSlope = (dCm) => ({
                  x: panelX1 + dCm * Math.cos(gAngleRad) * SC,
                  y: panelY1 - dCm * Math.sin(gAngleRad) * SC,
                })
                const gAllLegXs = gLegs.map(leg => gAtSlope(leg.positionCm).x)
                // Use actual leg positions for beam ends (not geometry-based gLegX0/gLegX1)
                const gActualX0 = gAllLegXs[0] ?? legX0
                const gActualX1 = gAllLegXs[gAllLegXs.length - 1] ?? legX1
                // Leg heights from BE data
                const gLegHeights = gLegs.map(leg => leg.heightCm * SC)

                return (
                  <g pointerEvents="none">
                    {/* Ghost base beam */}
                    {GR({ x: gActualX0, y: gBaseY, width: gActualX1 - gActualX0, height: BEAM_THICK_PX })}
                    {/* Ghost slope beam */}
                    {GL({ x1: gActualX0, y1: gBaseY - gLegHeights[0], x2: gActualX1, y2: gBaseY - gLegHeights[gLegHeights.length - 1], sw: BEAM_THICK_PX })}
                    {/* Ghost rear leg */}
                    {GL({ x1: gActualX0 + BEAM_THICK_PX / 2, y1: gBaseY - gLegHeights[0], x2: gActualX0 + BEAM_THICK_PX / 2, y2: gBaseY + BEAM_THICK_PX, sw: BEAM_THICK_PX })}
                    {/* Ghost front leg */}
                    {GL({ x1: gActualX1 - BEAM_THICK_PX / 2, y1: gBaseY - gLegHeights[gLegHeights.length - 1], x2: gActualX1 - BEAM_THICK_PX / 2, y2: gBaseY + BEAM_THICK_PX, sw: BEAM_THICK_PX })}
                    {/* Ghost inner legs */}
                    {gAllLegXs.slice(1, -1).map((lx, ci) => {
                      const lh = gLegHeights[ci + 1] ?? 0
                      return GL({ key: `gl${ci}`, x1: lx, y1: gBaseY - lh, x2: lx, y2: gBaseY + BEAM_THICK_PX, sw: BEAM_THICK_PX * 0.6 })
                    })}
                    {/* Ghost diagonals */}
                    {gDiags.map((d, di) => {
                      if (d.spanIdx >= gAllLegXs.length - 1) return null
                      const xA = gAllLegXs[d.spanIdx], xB = gAllLegXs[d.spanIdx + 1]
                      const spanW = xB - xA
                      const topX = xA + d.topPct * spanW
                      const botX = xA + d.botPct * spanW
                      // Interpolate slope Y from leg heights at span endpoints
                      const hA = gLegHeights[d.spanIdx] ?? 0, hB = gLegHeights[d.spanIdx + 1] ?? 0
                      const topFrac = d.topPct
                      const topY = gBaseY - (hA + topFrac * (hB - hA))
                      return GL({ key: `gd${di}`, x1: topX, y1: topY, x2: botX, y2: gBaseY + BEAM_THICK_PX / 2, sw: BEAM_THICK_PX * 0.75 })
                    })}
                    {/* Ghost blocks */}
                    {(fullTrapGhost.beDetailData.blocks ?? []).map((blk, bi) => {
                      const bx = gAtSlope(blk.positionCm).x - blockW / 2
                      return GR({ key: `gb${bi}`, x: bx, y: gBlockTopY, width: blockW, height: blockH })
                    })}
                    {/* Ghost panels (along the slope) */}
                    {(fullTrapGhost.panelLines ?? []).map((seg, si) => {
                      let dCm = 0
                      for (let j = 0; j < si; j++) dCm += (fullTrapGhost.panelLines[j].gapBeforeCm ?? 0) + (fullTrapGhost.panelLines[j].depthCm ?? 0)
                      dCm += (seg.gapBeforeCm ?? 0)
                      const gPanelOffX = -Math.sin(gAngleRad) * (BEAM_THICK_PX / 2 + 10 + 3)
                      const gPanelOffY = -Math.cos(gAngleRad) * (BEAM_THICK_PX / 2 + 10 + 3)
                      const p1 = gAtSlope(dCm)
                      const p2 = gAtSlope(dCm + (seg.depthCm ?? 0))
                      const p1x = p1.x + gPanelOffX, p1y = p1.y + gPanelOffY
                      const p2x = p2.x + gPanelOffX, p2y = p2.y + gPanelOffY
                      const dx = p2x - p1x, dy = p2y - p1y
                      const len = Math.sqrt(dx * dx + dy * dy)
                      const mx = (p1x + p2x) / 2, my = (p1y + p2y) / 2
                      const ang = Math.atan2(dy, dx) * 180 / Math.PI
                      return GR({ key: `gp${si}`, x: -len / 2, y: -3, width: len, height: 6, transform: `translate(${mx},${my}) rotate(${ang})` })
                    })}
                    {/* Ghost ground line */}
                    <line x1={gActualX0 - 20} y1={gBlockTopY + blockH} x2={gActualX1 + 20} y2={gBlockTopY + blockH} stroke={GHOST_STROKE} strokeWidth="1.5" strokeDasharray={GHOST_DASH} />
                  </g>
                )
              })()}
              <defs>
                <marker id="arr-k" markerWidth="5" markerHeight="5" refX="2.5" refY="2.5" orient="auto">
                  <path d="M0,0 L0,5 L5,2.5 z" fill={DC} />
                </marker>
                <marker id="arr-t" markerWidth="5" markerHeight="5" refX="2.5" refY="2.5" orient="auto">
                  <path d="M0,0 L0,5 L5,2.5 z" fill={TC} />
                </marker>
                <style>{`@keyframes hlPulse { 0%,100%{opacity:0.15} 50%{opacity:0.9} }`}</style>
              </defs>

              {/* ── Blocks — rendered from BE data ── */}
              {(() => {
                const beBlocks = beDetailData?.blocks ?? []
                const punchOff = blockPunchCm * SC
                const baseCm = (svgX) => fmt((svgX - legX0) / SC)
                return (<>
                  {beBlocks.map((blk, bi) => {
                    const bx = atSlope(blk.positionCm).x - blockW / 2
                    const px = blk.isEnd
                      ? (bi === 0 ? bx + punchOff : bx + blockW - punchOff)  // end blocks: punch from outer edge
                      : bx + punchOff                                          // center blocks: punch from left edge
                    return (
                      <g key={bi}>
                        <rect x={bx} y={blockTopY} width={blockW} height={blockH} fill={BLOCK_FILL} stroke={BLOCK_STROKE} strokeWidth="1" />
                        {showPunches && <text x={px} y={blockTopY + blockH / 2} textAnchor="middle" dominantBaseline="middle" fontSize="9" fontWeight="700" fill={TEXT_DARKEST}>{baseCm(px)}</text>}
                      </g>
                    )
                  })}
                </>)
              })()}

              {/* ── Structure: 4 main beams — always fully rendered ── */}
              {/* ── Base beam: ghost left / active / ghost right ── */}
              {legIsGhostFull[0] && ghostRect({ x: legX0, y: baseY, width: activeBoundL - legX0, height: BEAM_THICK_PX })}
              <rect x={activeBoundL} y={baseY} width={activeBoundR - activeBoundL} height={BEAM_THICK_PX} fill={L_PROFILE_FILL} stroke={L_PROFILE_STROKE} strokeWidth="1" />
              {legIsGhostFull[allLegXs.length - 1] && ghostRect({ x: activeBoundR, y: baseY, width: legX1 - activeBoundR, height: BEAM_THICK_PX })}

              {/* ── Rear leg ── */}
              {(() => {
                const legTopY = allLegTopYs[0]
                const legH    = baseY + BEAM_THICK_PX - legTopY
                return legH > 0 && (
                  <rect x={legX0} y={legTopY} width={BEAM_THICK_PX} height={legH} fill={L_PROFILE_FILL} stroke={L_PROFILE_STROKE} strokeWidth="1" />
                )
              })()}

              {/* ── Front leg ── */}
              {(() => {
                const legTopY = allLegTopYs[allLegTopYs.length - 1]
                const legH    = baseY + BEAM_THICK_PX - legTopY
                return legH > 0 && (
                  <rect x={legX1 - BEAM_THICK_PX} y={legTopY} width={BEAM_THICK_PX} height={legH} fill={L_PROFILE_FILL} stroke={L_PROFILE_STROKE} strokeWidth="1" />
                )
              })()}

              {/* ── Slope beam ── */}
              {lProfileLine({ x1: legX0, y1: allLegTopYs[0], x2: legX1, y2: allLegTopYs[allLegTopYs.length - 1], strokeWidth: BEAM_THICK_PX })}
              {diagonals.map((d, di) => {
                const ang = Math.atan2(d.botY - d.topY, d.botX - d.topX) * 180 / Math.PI
                const isDiagGhost = legIsGhostFull[d.spanIndex] || legIsGhostFull[d.spanIndex + 1]
                return (
                  <g key={di}>
                    {isDiagGhost
                      ? ghostLine({ x1: d.topX, y1: d.topY, x2: d.botX, y2: d.botY, strokeWidth: BEAM_THICK_PX * 0.75, strokeLinecap: 'square' })
                      : lProfileLine({ x1: d.topX, y1: d.topY, x2: d.botX, y2: d.botY, strokeWidth: BEAM_THICK_PX * 0.75, capExtend: d.halfCap })
                    }
                    {!isDiagGhost && d.isDouble && (<>
                      <line x1={d.topX} y1={d.topY} x2={d.botX} y2={d.botY}
                        stroke={DANGER} strokeWidth="1" strokeLinecap="square"
                        strokeDasharray="4,4" opacity="0.6" />
                      {[0.08, 0.5, 0.92].map((t, i) => {
                        const lx = d.topX + t * (d.botX - d.topX)
                        const ly = d.topY + t * (d.botY - d.topY)
                        return (
                          <text key={i} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
                            fontSize="8" fontWeight="800" fill={DANGER}
                            transform={`rotate(${ang}, ${lx}, ${ly})`}>×2</text>
                        )
                      })}
                    </>)}
                    {hl('diagonal') && (
                      <line x1={d.topX} y1={d.topY} x2={d.botX} y2={d.botY}
                        stroke={AMBER} strokeWidth={BEAM_THICK_PX * 2} strokeLinecap="round"
                        style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />
                    )}
                    {!isDiagGhost && showAnnotations && <Dim
                      ax1={d.topX - d.ux * d.halfCap} ay1={d.topY - d.uy * d.halfCap}
                      ax2={d.botX + d.ux * d.halfCap} ay2={d.botY + d.uy * d.halfCap}
                      label={fmt(d.lenCm)} off={-16} />}
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

              {/* ── Panel bars (one per line, offset above beam+rails) ── */}
              {(() => {
                let dCm = 0
                return segments.map((seg, idx) => {
                  dCm += seg.gapBeforeCm
                  const start = atSlope(dCm)
                  dCm += seg.depthCm
                  const end = atSlope(dCm)
                  const cx  = (start.x + end.x) / 2 + panOffX
                  const cy  = (start.y + end.y) / 2 + panOffY
                  const len = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2)
                  const isGhosted = idx < firstActiveSegIdx || idx > lastActiveSegIdx
                  return (
                    <g key={idx}>
                      <rect
                        x={cx - len/2} y={cy - PANEL_THICK_PX/2}
                        width={len} height={PANEL_THICK_PX}
                        fill={isGhosted ? GHOST_FILL : seg.isEmpty ? 'white' : PANEL_BAR_FILL}
                        stroke={isGhosted ? GHOST_STROKE : seg.isEmpty ? BORDER : PANEL_BAR_STROKE}
                        strokeWidth="1"
                        strokeDasharray={isGhosted || seg.isEmpty ? GHOST_DASH : undefined}
                        transform={`rotate(${beamAngleDeg}, ${cx}, ${cy})`}
                      />
                      {hl('panel') && (
                        <rect
                          x={cx - len/2 - 5} y={cy - PANEL_THICK_PX/2 - 5}
                          width={len + 10} height={PANEL_THICK_PX + 10}
                          fill="none" stroke={AMBER} strokeWidth="2.5" rx="3"
                          transform={`rotate(${beamAngleDeg}, ${cx}, ${cy})`}
                          style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }}
                        />
                      )}
                    </g>
                  )
                })
              })()}

              {/* ── Cross-rails profile (size from crossRailEdgeDistMm) ── */}
              {railItems.map(({ cx, segIdx, globalOffsetCm }, ci) => {
                const isEmptySeg = segments[segIdx]?.isEmpty
                const isGhosted  = segIdx < firstActiveSegIdx || segIdx > lastActiveSegIdx
                const railFill   = RAIL_FILL
                const railStroke = isEmptySeg ? BORDER : RAIL_STROKE
                const cy = beamY(cx)
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
                        fill={isGhosted ? GHOST_FILL : isEmptySeg ? 'white' : railFill}
                        stroke={isGhosted ? GHOST_STROKE : isEmptySeg ? BORDER : railStroke}
                        strokeWidth="1"
                        strokeDasharray={isGhosted || isEmptySeg ? GHOST_DASH : undefined} />
                      {hl('cross-rails') && (
                        <rect x={-RW/2 - 5} y={midY - RH/2 - 5} width={RW + 10} height={RH + 10}
                          fill="none" stroke={AMBER} strokeWidth="2.5" rx="3"
                          style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />
                      )}
                    </g>
                    {showPunches && <text x={lx} y={ly}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize="7.5" fontWeight="700" fill={railStroke}
                      transform={`rotate(${beamAngleDeg}, ${lx}, ${ly})`}
                    >{fmt(globalOffsetCm - RAIL_CM + baseOverhangCm)}</text>}
                  </g>
                )
              })}

              {/* ── Rail support profiles (L-bracket: slope-top → base-bottom, overlaps both beams) ── */}
              {innerLegXs.map((sx, ci) => {
                const slopeTopY = allLegTopYs[ci + 1]   // inner legs are at index 1..n-2 in allLegTopYs
                const lenCm     = (blockTopY - slopeTopY) / SC
                const isGhost   = innerLegIsGhost[ci] ?? false
                return (
                  <g key={ci}>
                    {isGhost
                      ? ghostLine({ x1: sx, y1: slopeTopY, x2: sx, y2: blockTopY, strokeWidth: BEAM_THICK_PX, strokeLinecap: 'butt' })
                      : lProfileLine({ x1: sx, y1: slopeTopY, x2: sx, y2: blockTopY, strokeWidth: BEAM_THICK_PX })
                    }
                    {!isGhost && showAnnotations && <Dim ax1={sx} ay1={slopeTopY} ax2={sx} ay2={blockTopY} label={fmt(lenCm)} off={14} />}
                  </g>
                )
              })}

              {/* ── Punches — rendered from BE data ── */}
              {showPunches && (beDetailData?.punches ?? []).map((p, i) => {
                const px = atSlope(p.positionCm).x
                if (p.beamType === 'base') {
                  return <circle key={i} cx={px} cy={baseY + BEAM_THICK_PX / 2} r={2}
                    fill="white" stroke={TEXT_SECONDARY} strokeWidth="1" />
                }
                // slope beam: Y at this X along the slope from first to last leg
                const slopeY = allLegTopYs[0] + (px - legX0) / (legBW || 1) * (allLegTopYs[allLegTopYs.length - 1] - allLegTopYs[0])
                return <circle key={i} cx={px} cy={slopeY} r={2}
                  fill="white" stroke={TEXT_SECONDARY} strokeWidth="1" />
              })}

              {hl('blocks') && (
                <g style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }}>
                  {(beDetailData?.blocks ?? []).map((blk, bi) => {
                    const bx = atSlope(blk.positionCm).x - blockW / 2
                    return <rect key={bi} x={bx - 5} y={blockTopY - 5} width={blockW + 10} height={blockH + 10}
                      fill="none" stroke={AMBER} strokeWidth="2.5" rx="3" />
                  })}
                </g>
              )}

              {/* ── Green floor line ── */}
              <line x1={panelX1 - 35} y1={blockBotY} x2={panelX2 + 45} y2={blockBotY}
                stroke={GROUND_LINE} strokeWidth="2.5" strokeLinecap="round" />

              {/* ── Angle label inside trapezoid ── */}
              <text x={activeBeamR - 32} y={beamY(activeBeamR) + 22} fontSize="9" fill={TEXT_SECONDARY} fontWeight="700">{angle}°</text>

              {/* ── Dimension annotations ── */}
              {showAnnotations && <>
                {/* Slope beam: active portion only */}
                <Dim ax1={activeBoundL} ay1={beamY(activeBoundL)} ax2={activeBoundR} ay2={beamY(activeBoundR)}
                  label={fmt(activeSlopeBeamLenCm)} off={-(PANEL_OFFSET_PX + 14)} />

                {(() => {
                  if (!hasActiveZone) return null
                  const splitOff = -(PANEL_OFFSET_PX + 30)
                  const toCm = (dx) => fmt(dx / SC / Math.cos(angleRad))
                  const activeRailItems = railItems.filter(r => r.segIdx >= firstActiveSegIdx && r.segIdx <= lastActiveSegIdx)
                  const aRail1X = activeRailItems[0]?.cx ?? activePanelStart.x
                  const aRail2X = activeRailItems[activeRailItems.length - 1]?.cx ?? activePanelEnd.x
                  return (<>
                    <Dim ax1={activePanelStart.x} ay1={activePanelStart.y} ax2={aRail1X} ay2={beamY(aRail1X)}
                      label={toCm(aRail1X - activePanelStart.x)} off={splitOff} />
                    <Dim ax1={aRail1X} ay1={beamY(aRail1X)} ax2={aRail2X} ay2={beamY(aRail2X)}
                      label={toCm(aRail2X - aRail1X)} off={splitOff} />
                    <Dim ax1={aRail2X} ay1={beamY(aRail2X)} ax2={activePanelEnd.x} ay2={activePanelEnd.y}
                      label={toCm(activePanelEnd.x - aRail2X)} off={splitOff} />
                  </>)
                })()}

                {/* Left leg height: only when main rear leg is active (not ghosted to an inner leg) */}
                {!legIsGhostFull[0] && beamY(activeBeamL) < baseY && (() => {
                  const slopeTopY = beamY(activeBeamL) - Math.cos(angleRad) * BEAM_THICK_PX / 2
                  return <Dim ax1={activeBeamL} ay1={slopeTopY} ax2={activeBeamL} ay2={blockTopY}
                    label={fmt((blockTopY - slopeTopY) / SC)} off={-55} />
                })()}

                <Dim ax1={activePanelStart.x} ay1={blockBotY}
                     ax2={activePanelStart.x} ay2={activePanelStart.y + panOffY + Math.cos(angleRad) * PANEL_THICK_PX / 2}
                  label={fmt((blockBotY - activePanelStart.y - panOffY - Math.cos(angleRad) * PANEL_THICK_PX / 2) / SC)}
                  off={-22} />

                <Dim ax1={legX0} ay1={blockTopY} ax2={legX0} ay2={blockBotY}
                  label={fmt(BLOCK_H_CM)} off={-14} />

                {/* Right leg height: only when main front leg is active (not ghosted to an inner leg) */}
                {!legIsGhostFull[allLegXs.length - 1] && (() => {
                  const slopeTopY = beamY(activeBeamR) - Math.cos(angleRad) * BEAM_THICK_PX / 2
                  return <Dim ax1={activeBeamR} ay1={slopeTopY} ax2={activeBeamR} ay2={blockTopY}
                    label={fmt((blockTopY - slopeTopY) / SC)} off={38} />
                })()}

                <Dim ax1={activePanelEnd.x} ay1={blockBotY}
                     ax2={activePanelEnd.x} ay2={activePanelEnd.y + panOffY + Math.cos(angleRad) * PANEL_THICK_PX / 2}
                  label={fmt((blockBotY - activePanelEnd.y - panOffY - Math.cos(angleRad) * PANEL_THICK_PX / 2) / SC)}
                  off={28} />

                {/* Base beam: active portion only */}
                <Dim ax1={activeBoundL} ay1={blockBotY + 18} ax2={activeBoundR} ay2={blockBotY + 18}
                  label={fmt(activeBaseBeamLenCm)} off={14} />
              </>}

              {/* ── Base beam punch sketch ── */}
              {showPunches && (() => {
                const ry    = blockBotY + 130
                const barH  = 12
                const barCy = ry + barH / 2
                const activeBeamLenCm   = (activeBoundR - activeBoundL) / SC
                const activeInnerLegXs = innerLegXs.filter((_, ci) => !innerLegIsGhost[ci])
                const baseMiddle = [
                  ...activeDiags.map(d => ({ x: d.botX, label: fmt((d.botX - activeBoundL) / SC) })),
                  ...activeInnerLegXs.map(sx => ({ x: sx, label: fmt((sx - activeBoundL) / SC) })),
                ].sort((a, b) => a.x - b.x)
                const punches       = [activeBoundL + 2 * SC, ...baseMiddle.map(e => e.x), activeBoundR - 2 * SC]
                const punchLabelsCm = ['2', ...baseMiddle.map(e => e.label), fmt(activeBeamLenCm - 2)]
                const ghostX = (() => {
                  if (!showDiagHandles || barHover?.which !== 'bot') return null
                  const span = findSpan(barHover.svgX)
                  if (!span || activeSpanSet.has(span.spanIndex)) return null
                  if (activeDiags.some(d => Math.abs(d.botX - barHover.svgX) < 8)) return null
                  return barHover.svgX
                })()
                return (
                  <g>
                    <text x={activeBoundL} y={ry - 5} fontSize="8" fill={TEXT_PLACEHOLDER} fontWeight="600">Base beam — punch positions</text>
                    {/* ghost left extension */}
                    {legIsGhostFull[0] && ghostRect({ x: legX0, y: ry, width: activeBoundL - legX0, height: barH })}
                    {/* interactive active bar */}
                    <rect x={activeBoundL} y={ry} width={activeBoundR - activeBoundL} height={barH}
                      fill={PUNCH_BAR_FILL} stroke={PUNCH_BAR_STROKE} strokeWidth="1" rx="2"
                      style={{ cursor: showDiagHandles ? 'crosshair' : 'default' }}
                      onMouseMove={showDiagHandles ? (e) => handleBarMouseMove(e, 'bot') : undefined}
                      onMouseLeave={showDiagHandles ? () => setBarHover(null) : undefined}
                      onClick={showDiagHandles ? (e) => handleBarClick(e, 'bot') : undefined}
                    />
                    {/* ghost right extension */}
                    {legIsGhostFull[allLegXs.length - 1] && ghostRect({ x: activeBoundR, y: ry, width: legX1 - activeBoundR, height: barH })}
                    {/* all punch circles + labels — Punches layer */}
                    {punches.map((px, i) => (
                      <g key={`wp-${i}`}>
                        <circle cx={px} cy={barCy} r={2} fill="white" stroke={TEXT_SECONDARY} strokeWidth="1" />
                        <text x={px} y={ry + barH + 10} textAnchor="middle" fontSize="8" fill={TEXT_SECONDARY} fontWeight="600">
                          {punchLabelsCm[i]}
                        </text>
                      </g>
                    ))}
                    {/* diagonal handles — Edit Bar layer (blue circles on top, no duplicate labels) */}
                    {showDiagHandles && !printMode && activeDiags.map((d, di) => {
                      const isHov = hoverHandle?.which === 'bot' && hoverHandle?.spanIndex === d.spanIndex
                      return (
                        <g key={`bh-${di}`}>
                          <circle cx={d.botX} cy={barCy} r={5.5}
                            fill={isHov ? DANGER : BLUE} stroke="white" strokeWidth="1.5"
                            style={{ cursor: 'pointer' }}
                            onMouseEnter={() => setHoverHandle({ which: 'bot', spanIndex: d.spanIndex })}
                            onMouseLeave={() => setHoverHandle(null)}
                            onMouseDown={(e) => startHandleDrag(e, 'bot', d)}
                          />
                          {isHov && <text x={d.botX} y={barCy} textAnchor="middle" dominantBaseline="middle" fontSize="8" fontWeight="900" fill="white" style={{ pointerEvents: 'none' }}>✕</text>}
                        </g>
                      )
                    })}
                    {/* "+" ghost follower */}
                    {ghostX !== null && (
                      <g opacity="0.5" style={{ pointerEvents: 'none' }}>
                        <line x1={ghostX} y1={ry} x2={ghostX} y2={ry + barH} stroke={ADD_GREEN} strokeWidth="1.5" strokeDasharray="3,2" />
                        <text x={ghostX + 5} y={barCy + 1} dominantBaseline="middle" fontSize="9" fontWeight="800" fill={ADD_GREEN}>+</text>
                      </g>
                    )}
                    <Dim ax1={activeBoundL} ay1={ry + barH + 22} ax2={activeBoundR} ay2={ry + barH + 22} label={fmt(activeBeamLenCm)} off={10} />
                  </g>
                )
              })()}

              {/* ── Slope beam punch sketch ── */}
              {showPunches && (() => {
                const ry    = blockBotY + 52
                const barH  = 12
                const barCy = ry + barH / 2
                const activeSlopeBeamLenCm = (activeBoundR - activeBoundL) / legBW * topBeamLength
                // End punches: 2cm from active beam ends, using same x-scale as full slope beam
                const leftEndX  = activeBoundL + (2 / topBeamLength) * legBW
                const rightEndX = activeBoundR - (2 / topBeamLength) * legBW
                const activeInnerLegXs = innerLegXs.filter((_, ci) => !innerLegIsGhost[ci])
                const slopeMiddle = [
                  ...activeDiags.map(d => ({ x: d.topX, label: fmt((d.topX - activeBoundL) / legBW * topBeamLength) })),
                  ...activeInnerLegXs.map(sx => ({ x: sx, label: fmt((sx - activeBoundL) / legBW * topBeamLength) })),
                ].sort((a, b) => a.x - b.x)
                const punches       = [leftEndX, ...slopeMiddle.map(e => e.x), rightEndX]
                const punchLabelsCm = ['2', ...slopeMiddle.map(e => e.label), fmt(activeSlopeBeamLenCm - 2)]
                const ghostX = (() => {
                  if (!showDiagHandles || barHover?.which !== 'top') return null
                  const span = findSpan(barHover.svgX)
                  if (!span || activeSpanSet.has(span.spanIndex)) return null
                  if (activeDiags.some(d => Math.abs(d.topX - barHover.svgX) < 8)) return null
                  return barHover.svgX
                })()
                return (
                  <g>
                    <text x={activeBoundL} y={ry - 5} fontSize="8" fill={TEXT_PLACEHOLDER} fontWeight="600">Slope beam — punch positions</text>
                    {/* ghost left extension */}
                    {legIsGhostFull[0] && ghostRect({ x: legX0, y: ry, width: activeBoundL - legX0, height: barH })}
                    {/* interactive active bar */}
                    <rect x={activeBoundL} y={ry} width={activeBoundR - activeBoundL} height={barH}
                      fill={PUNCH_BAR_FILL} stroke={PUNCH_BAR_STROKE} strokeWidth="1" rx="2"
                      style={{ cursor: showDiagHandles ? 'crosshair' : 'default' }}
                      onMouseMove={showDiagHandles ? (e) => handleBarMouseMove(e, 'top') : undefined}
                      onMouseLeave={showDiagHandles ? () => setBarHover(null) : undefined}
                      onClick={showDiagHandles ? (e) => handleBarClick(e, 'top') : undefined}
                    />
                    {/* ghost right extension */}
                    {legIsGhostFull[allLegXs.length - 1] && ghostRect({ x: activeBoundR, y: ry, width: legX1 - activeBoundR, height: barH })}
                    {/* all punch circles + labels — Punches layer */}
                    {punches.map((px, i) => (
                      <g key={`wp-${i}`}>
                        <circle cx={px} cy={barCy} r={2} fill="white" stroke={TEXT_SECONDARY} strokeWidth="1" />
                        <text x={px} y={ry + barH + 10} textAnchor="middle" fontSize="8" fill={TEXT_SECONDARY} fontWeight="600">
                          {punchLabelsCm[i]}
                        </text>
                      </g>
                    ))}
                    {/* diagonal handles — Edit Bar layer (blue circles on top, no duplicate labels) */}
                    {showDiagHandles && !printMode && activeDiags.map((d, di) => {
                      const isHov = hoverHandle?.which === 'top' && hoverHandle?.spanIndex === d.spanIndex
                      return (
                        <g key={`sh-${di}`}>
                          <circle cx={d.topX} cy={barCy} r={5.5}
                            fill={isHov ? DANGER : BLUE} stroke="white" strokeWidth="1.5"
                            style={{ cursor: 'pointer' }}
                            onMouseEnter={() => setHoverHandle({ which: 'top', spanIndex: d.spanIndex })}
                            onMouseLeave={() => setHoverHandle(null)}
                            onMouseDown={(e) => startHandleDrag(e, 'top', d)}
                          />
                          {isHov && <text x={d.topX} y={barCy} textAnchor="middle" dominantBaseline="middle" fontSize="8" fontWeight="900" fill="white" style={{ pointerEvents: 'none' }}>✕</text>}
                        </g>
                      )
                    })}
                    {ghostX !== null && (
                      <g opacity="0.5" style={{ pointerEvents: 'none' }}>
                        <line x1={ghostX} y1={ry} x2={ghostX} y2={ry + barH} stroke={ADD_GREEN} strokeWidth="1.5" strokeDasharray="3,2" />
                        <text x={ghostX + 5} y={barCy + 1} dominantBaseline="middle" fontSize="9" fontWeight="800" fill={ADD_GREEN}>+</text>
                      </g>
                    )}
                    <Dim ax1={activeBoundL} ay1={ry + barH + 22} ax2={activeBoundR} ay2={ry + barH + 22} label={fmt(activeSlopeBeamLenCm)} off={10} />
                  </g>
                )
              })()}

            </svg>

            {/* Members table */}
            <div style={{ marginTop: '1.5rem', maxWidth: '340px' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>Members per trapezoid</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ background: BG_SUBTLE }}>
                    <th style={{ textAlign: 'left', padding: '0.3rem 0.5rem', fontWeight: '700', color: TEXT_SECONDARY }}>Element</th>
                    <th style={{ textAlign: 'right', padding: '0.3rem 0.5rem', fontWeight: '700', color: TEXT_SECONDARY }}>Length (cm)</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Base beam',  activeBaseBeamLenCm],
                    ['Top beam',   activeSlopeBeamLenCm],
                    ['Rear leg',   (baseY - beamY(activeBeamL)) / SC],
                    ['Front leg',  (baseY - beamY(activeBeamR)) / SC],
                    ...activeDiags.map((d, i) => [
                      activeDiags.length > 1
                        ? `Diagonal ${i + 1}${d.isDouble ? ' ×2' : ''}`
                        : `Diagonal${d.isDouble ? ' ×2' : ''}`,
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
            </div>
          </div>
        </div>
      </div>

      {!printMode && <RulerTool active={rulerActive} zoom={zoom} pxPerCm={2.2} containerRef={containerRef} />}

      {/* ── Layers panel ── */}
      {!printMode && <LayersPanel
        layers={[
          { label: 'Annotations',   checked: _showAnnotations, setter: setShowAnnotations  },
          { label: 'Punches',       checked: _showPunches,     setter: setShowPunches      },
          { label: 'Edit Bar',      checked: _showDiagHandles, setter: setShowDiagHandles  },
          ...(fullTrapGhost ? [{ label: 'Ghost', checked: showGhost, setter: setShowGhost }] : []),
        ]}
        actions={[
          ...(onReset ? [{ label: 'Reset to defaults', onClick: onReset, style: { color: AMBER_DARK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}` } }] : []),
          ...(Object.keys(diagOverrides).length > 0
            ? [{ label: 'Reset handles', onClick: () => onUpdateSetting?.('diagOverrides', {}), style: { color: BLUE, background: BLUE_BG, border: `1px solid ${BLUE_BORDER}` } }]
            : []),
          { label: rulerActive ? '📏 Ruler ON' : '📏 Ruler', onClick: () => { if (rulerActive) RulerTool._clear?.(); setRulerActive(v => !v) }, style: rulerActive ? { color: BLUE, background: BLUE_BG, border: `1px solid ${BLUE_BORDER}` } : {} },
        ]}
      />}

      {/* ── Floating navigator ── */}
      {!printMode && <CanvasNavigator
        viewZoom={zoom}
        onZoomOut={() => setZoom(z => Math.max(0.25, z * 0.833))}
        onZoomReset={resetView}
        onZoomIn={() => setZoom(z => Math.min(6, z * 1.2))}
        mmWidth={MM_W}
        mmHeight={MM_H}
        onPanToPoint={panToMinimapPoint}
        viewportRect={getMinimapViewportRect()}
        left={276}
      />}

    </div>
  )
}
