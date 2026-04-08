import { useState, useRef } from 'react'
import { useLang } from '../../../i18n/LangContext'
import { TEXT_SECONDARY, TEXT_DARKEST, TEXT_VERY_LIGHT, TEXT_PLACEHOLDER, BG_SUBTLE, BG_MID, BLUE, BLUE_BG, BLUE_BORDER, AMBER_DARK, GHOST_FILL, GHOST_STROKE, GHOST_DASH, AMBER, RAIL_STROKE, L_PROFILE_FILL, L_PROFILE_STROKE, BLOCK_FILL, BLOCK_STROKE, PANEL_BAR_FILL, PANEL_BAR_STROKE, RAIL_FILL, PUNCH_BAR_FILL, PUNCH_BAR_STROKE, DANGER, ADD_GREEN, AMBER_BG, AMBER_BORDER } from '../../../styles/colors'
import CanvasNavigator from '../../shared/CanvasNavigator'
import { useCanvasPanZoom } from '../../../hooks/useCanvasPanZoom'
import LayersPanel from './LayersPanel'
import DetailCorrugatedRoof from './DetailCorrugatedRoof'
import RulerTool from '../../shared/RulerTool'

export default function DetailView({ rc, trapId = null, panelLines = null, settings = {}, lineRails = null, highlightParam = null, beDetailData = null, fullTrapGhost = null, paramGroup: PARAM_GROUP = {}, reverseBlockPunches = true, onReset = null, onUpdateSetting = null, printMode = false, roofType = 'concrete', purlinDistCm = 0, installationOrientation = null }) {
  const { t } = useLang()
  const [showDimensions,  setShowDimensions]  = useState(true)
  const [showPunches,     setShowPunches]      = useState(true)
  const [showDiagHandles, setShowDiagHandles]  = useState(false)
  const [showGhost,       setShowGhost]        = useState(true)
  const [showRoofLine,    setShowRoofLine]     = useState(true)
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
  const railOffsetCm   = lineRails?.[0]?.[0] ?? lineRails?.['0']?.[0] ?? 0
  const panelLengthCm  = settings.panelLengthCm
  const diagOverrides  = settings.diagOverrides ?? {}

  // Highlight helpers
  const hlGroup = PARAM_GROUP[highlightParam] ?? null
  const hl = (group) => hlGroup === group

  // Use BE-computed geometry when available, fall back to FE rc
  // Require BE data — geometry and legs must come from server
  if (!beDetailData?.geometry || !beDetailData?.legs?.length) return <div style={{ padding: '2rem', color: TEXT_VERY_LIGHT }}>{t('step3.empty.selectRow')}</div>
  const geom = beDetailData.geometry

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

  const rearExtPx = (geom.rearExtensionCm ?? 0) * SC
  const padL = Math.max(120, railOffH + OHx + (geom.frontExtensionCm ?? 0) * SC + 40)
  const panelExtCm = (totalPanelDepthCm - RAIL_CM) * Math.cos(angleRad) - baseLength
  const padR = Math.max(100, Math.max(panelExtCm * SC, OHx, rearExtPx) + 70)
  const _panelOffsetApprox = 2 * SC + 10 + 3
  const _slopeAbove = bW > 0 ? (hR - hF) * railOffH / bW : 0
  const _annotAbove = Math.cos(angleRad) * (_panelOffsetApprox + 30)
  const padT = printMode ? Math.max(55, hR - hF + _slopeAbove + _annotAbove + 40) : 55
  const padB = blockH + 290

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

  // Build rail items from lineRails for cross-rail profile rendering.
  const railItems = (() => {
    const items = []
    let dCm = 0
    for (let si = 0; si < segments.length; si++) {
      const seg = segments[si]
      dCm += (seg.gapBeforeCm ?? 0)
      if (seg.isEmpty) { dCm += (seg.depthCm ?? 0); continue }
      const segRails = lineRails?.[si] ?? lineRails?.[String(si)] ?? []
      for (const offsetCm of segRails) {
        items.push({ cx: atSlope(dCm + offsetCm).x, segIdx: si, offsetCm, globalOffsetCm: dCm + offsetCm })
      }
      dCm += (seg.depthCm ?? 0)
    }
    return items
  })()
  const BEAM_THICK_PX = beamThickCm * SC
  const blockTopY = baseY + BEAM_THICK_PX   // blocks sit below the outer bottom face of the base beam
  const blockBotY = blockTopY + blockH
  const PANEL_THICK_PX = panelThickCm * SC
  const CROSS_RAIL_GAP_PX = crossRailEdgeDistCm * SC  // cross rail profile height in px
  const PANEL_OFFSET_PX = BEAM_THICK_PX / 2 + CROSS_RAIL_GAP_PX + PANEL_THICK_PX / 2


  // ── Leg positions and heights — always from BE data ─────────────────────
  // positionCm = left edge of profile, positionEndCm = right edge
  // With beam extension, server shifts leg positions into base beam coords (firstLeg > 0).
  // Subtract firstLegPos so legs render in trap coords (aligned with panels/rails).
  const beLegs = beDetailData?.legs ?? []
  const firstLegPos = beLegs[0]?.positionCm ?? 0
  const allLegXs = beLegs.map(leg => atTrap(leg.positionCm - firstLegPos).x)
  const allLegEndXs = beLegs.map(leg => atTrap((leg.positionEndCm ?? (leg.positionCm + beamThickCm)) - firstLegPos).x)
  const allLegHeights = beLegs.map(leg => leg.heightCm * SC)
  const allLegTopYs = allLegHeights.map(h => baseY - h)
  let legX0 = allLegXs[0] ?? (x0 - OHx)
  let legX1 = allLegEndXs[allLegEndXs.length - 1] ?? (x1 + OHx)
  let legBW = legX1 - legX0

  // Beam Y interpolation from leg positions (pure rendering logic)
  const beamYFromLegs = (x) => {
    if (legBW <= 0) return allLegTopYs[0] ?? baseY
    return allLegTopYs[0] + (x - legX0) / legBW * ((allLegTopYs[allLegTopYs.length - 1] ?? allLegTopYs[0]) - allLegTopYs[0])
  }
  const legHeightAtX = (x) => (baseY - beamYFromLegs(x)) / SC
  // Build diagonal data: use BE decisions (topPct, botPct, isDouble, disabled) when available,
  // but always compute pixel positions (topX, botX, topY, botY) from leg positions.

  // Diagonals — always from BE data, FE only computes pixel positions
  const diagonals = (() => {
    const beDiags = beDetailData?.diagonals ?? []
    const numSpans = allLegXs.length - 1
    const raw = beDiags.map(d => {
      if (d.spanIdx >= numSpans) return null
      const ov = diagOverrides[d.spanIdx] ?? {}
      const topPct = ov.topPct ?? d.topPct
      const botPct = ov.botPct ?? d.botPct
      // Diagonal spans the gap: right edge of leg A to left edge of leg B
      const xA = allLegEndXs[d.spanIdx], xB = allLegXs[d.spanIdx + 1]
      const spanW = xB - xA
      const topX = xA + topPct * spanW
      const botX = xA + botPct * spanW
      // Interpolate slope Y between the two legs
      const hATopY = allLegTopYs[d.spanIdx], hBTopY = allLegTopYs[d.spanIdx + 1]
      const topY = hATopY + topPct * (hBTopY - hATopY)
      const botY = baseY + BEAM_THICK_PX / 2
      const _dx = botX - topX, _dy = botY - topY
      const _len = Math.sqrt(_dx * _dx + _dy * _dy)
      const ux = _len > 0 ? _dx / _len : 0, uy = _len > 0 ? _dy / _len : 0
      const halfCap = BEAM_THICK_PX * 0.75 / 2
      return {
        xA, xB, spanW, topX, botX, topY, botY, ux, uy, halfCap,
        lenCm: d.lengthCm, isDouble: d.isDouble, skip: ov.disabled ?? d.disabled,
        spanIndex: d.spanIdx,
        hA: allLegHeights[d.spanIdx] / SC, hB: allLegHeights[d.spanIdx + 1] / SC,
      }
    }).filter(Boolean)
    return raw.filter(s => !s.skip)
  })()

  // All legs are active (ghost handled by overlay)
  const firstActiveLegIdx = 0
  const lastActiveLegIdx  = allLegXs.length - 1
  const hasActiveZone = firstActiveLegIdx <= lastActiveLegIdx
  const activeBeamL = hasActiveZone ? allLegXs[firstActiveLegIdx] : legX0
  const activeBeamR = hasActiveZone ? allLegEndXs[lastActiveLegIdx] : legX0
  const activeBoundL = activeBeamL
  const activeBoundR = activeBeamR

  // Ghost style: all rendered as rects using centralized ghost colors
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

  // Diagonals with both legs in the active zone (used for punch sketches + dimensions)
  const activeDiags          = diagonals
  const activeSlopeBeamLenCm = topBeamLength
  const activeBaseBeamLenCm  = geom.baseBeamLength ?? (legBW / SC)

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

  const beamAngleDeg = legBW > 0
    ? Math.atan2(allLegTopYs[allLegTopYs.length - 1] - allLegTopYs[0], legX1 - legX0) * 180 / Math.PI
    : 0

  // Panel start/end positions — includes perpendicular offset to match rendered panel bar
  // Panel bottom surface positions for height dimensions
  const panelBottomPos = (dCm) => {
    const sx = atSlope(dCm).x
    return { x: sx, y: beamYFromLegs(sx) - (PANEL_OFFSET_PX - PANEL_THICK_PX / 2) }
  }
  // Find depth to first active (non-empty) panel line
  const firstActiveDepth = (() => {
    let d = 0
    for (const seg of segments) {
      d += seg.gapBeforeCm ?? 0
      if (!seg.isEmpty) return d
      d += seg.depthCm ?? 0
    }
    return 0
  })()
  const activePanelStartBot = panelBottomPos(firstActiveDepth)
  // Find depth at end of last active (non-empty) panel line
  const lastActiveDepth = (() => {
    let d = 0, lastEnd = totalPanelDepthCm
    for (const seg of segments) {
      d += seg.gapBeforeCm ?? 0
      d += seg.depthCm ?? 0
      if (!seg.isEmpty) lastEnd = d
    }
    return lastEnd
  })()
  const activePanelEndBot   = panelBottomPos(lastActiveDepth)

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
              {trapId ?? `${rc.typeLetter}${Math.max(...(rc.panelsPerLine?.length ? rc.panelsPerLine : [1]))}`} — {angle}° · Panel Front {fmt(geom.panelFrontHeight ?? 0)} cm
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
                // Same base beam level — side view looks through both traps at ground plane
                const gBaseY = baseY
                const gBlockTopY = gBaseY + BEAM_THICK_PX

                // Ghost style helpers — same as original ghost rendering (filled rects with dashed stroke)
                const GR = ({ key, ...props }) => <rect key={key} {...props} fill={GHOST_FILL} stroke={GHOST_STROKE} strokeWidth="1" strokeDasharray={GHOST_DASH} />
                const GL = ({ key, x1: lx1, y1: ly1, x2: lx2, y2: ly2, sw }) => {
                  const dx = lx2 - lx1, dy = ly2 - ly1
                  const len = Math.sqrt(dx * dx + dy * dy)
                  const mx = (lx1 + lx2) / 2, my = (ly1 + ly2) / 2
                  const ang = Math.atan2(dy, dx) * 180 / Math.PI
                  return GR({ key, x: -len / 2, y: -(sw || 1) / 2, width: len, height: sw || 1, transform: `translate(${mx},${my}) rotate(${ang})` })
                }

                const gDiags = (fullTrapGhost.beDetailData.diagonals ?? []).filter(d => !d.disabled)
                const gLegs = fullTrapGhost.beDetailData.legs ?? []
                // Ghost atSlope: offset from real trap's origin by the difference in originCm
                const gOriginCm = fullTrapGhost.beDetailData.geometry?.originCm ?? 0
                const gFirstLegPos = gLegs[0]?.positionCm ?? 0
                const originDelta = (gOriginCm - originCm) * Math.cos(gAngleRad) * SC
                const gLegHeights = gLegs.map(leg => leg.heightCm * SC)
                const gLegXPositions = gLegs.map(leg => legX0 + originDelta + (leg.positionCm - gFirstLegPos) * Math.cos(gAngleRad) * SC)
                const gLegEndXPositions = gLegs.map(leg => legX0 + originDelta + ((leg.positionEndCm ?? (leg.positionCm + beamThickCm)) - gFirstLegPos) * Math.cos(gAngleRad) * SC)
                const gActualX0 = gLegXPositions[0] ?? legX0
                const gActualX1 = gLegEndXPositions[gLegEndXPositions.length - 1] ?? legX1
                const gLegBW = gActualX1 - gActualX0
                // Interpolate Y from ghost leg heights (matches beamYFromLegs for real trap)
                const gBeamY = (x) => {
                  if (gLegBW <= 0) return gBaseY - (gLegHeights[0] ?? 0)
                  const frac = (x - gActualX0) / gLegBW
                  const h0 = gLegHeights[0] ?? 0, h1 = gLegHeights[gLegHeights.length - 1] ?? 0
                  return gBaseY - (h0 + frac * (h1 - h0))
                }
                const gAtTrap = (posCm) => {
                  const x = legX0 + originDelta + (posCm - gFirstLegPos) * Math.cos(gAngleRad) * SC
                  return { x, y: gBeamY(x) }
                }
                // gAtSlope works in panel coords (no leg offset subtraction)
                const gAtSlope = (dCm) => {
                  const x = legX0 + originDelta + (dCm - gOriginCm) * Math.cos(gAngleRad) * SC
                  return { x, y: gBeamY(x) }
                }

                return (
                  <g pointerEvents="none">
                    {/* Ghost base beam */}
                    {GR({ key: 'g-base', x: gActualX0, y: gBaseY, width: gActualX1 - gActualX0, height: BEAM_THICK_PX })}
                    {/* Ghost slope beam */}
                    {GL({ key: 'g-slope', x1: gActualX0, y1: gBaseY - gLegHeights[0], x2: gActualX1, y2: gBaseY - gLegHeights[gLegHeights.length - 1], sw: BEAM_THICK_PX })}
                    {/* Ghost legs — uniform rendering */}
                    {gLegs.map((_, li) => {
                      const lx = gLegXPositions[li], lxEnd = gLegEndXPositions[li]
                      const lw = lxEnd - lx
                      const lh = gLegHeights[li] ?? 0
                      return GR({ key: `gl${li}`, x: lx, y: gBaseY - lh, width: lw, height: lh + BEAM_THICK_PX })
                    })}
                    {/* Ghost diagonals — span gap between legs */}
                    {gDiags.map((d, di) => {
                      if (d.spanIdx >= gLegs.length - 1) return null
                      const xA = gLegEndXPositions[d.spanIdx], xB = gLegXPositions[d.spanIdx + 1]
                      const spanW = xB - xA
                      const topX = xA + d.topPct * spanW
                      const botX = xA + d.botPct * spanW
                      const hA = gLegHeights[d.spanIdx] ?? 0, hB = gLegHeights[d.spanIdx + 1] ?? 0
                      const topY = gBaseY - (hA + d.topPct * (hB - hA))
                      return GL({ key: `gd${di}`, x1: topX, y1: topY, x2: botX, y2: gBaseY + BEAM_THICK_PX / 2, sw: BEAM_THICK_PX * 0.75 })
                    })}
                    {/* Ghost blocks — positionCm is left edge, no centering */}
                    {/* Ghost blocks — base-beam coords */}
                    {(() => {
                      const gBaseBeamLen = fullTrapGhost.beDetailData.geometry?.baseBeamLength || 1
                      const gBW = gActualX1 - gActualX0
                      const gAtBase = (posCm) => gActualX0 + (posCm / gBaseBeamLen) * gBW
                      const gbw = (blockLengthCm / gBaseBeamLen) * gBW
                      return (fullTrapGhost.beDetailData.blocks ?? []).map((blk, bi) =>
                        GR({ key: `gb${bi}`, x: gAtBase(blk.positionCm), y: gBlockTopY, width: gbw, height: blockH })
                      )
                    })()}
                    {/* Ghost panels (along the slope) — vertical offset, matching main panel rendering */}
                    {(() => {
                      const gBW = gActualX1 - gActualX0
                      const gTopY0 = gBaseY - gLegHeights[0], gTopYN = gBaseY - gLegHeights[gLegHeights.length - 1]
                      const gBeamY = (x) => gBW > 0 ? gTopY0 + (x - gActualX0) / gBW * (gTopYN - gTopY0) : gTopY0
                      const gBeamDeg = gBW > 0 ? Math.atan2(gTopYN - gTopY0, gBW) * 180 / Math.PI : 0
                      let dCm = 0
                      return (fullTrapGhost.panelLines ?? []).map((seg, si) => {
                        dCm += (seg.gapBeforeCm ?? 0)
                        const sx = gAtSlope(dCm).x
                        const ex = gAtSlope(dCm + (seg.depthCm ?? 0)).x
                        dCm += (seg.depthCm ?? 0)
                        const sy = gBeamY(sx), ey = gBeamY(ex)
                        const cx = (sx + ex) / 2
                        const cy = (sy + ey) / 2 - PANEL_OFFSET_PX
                        const dx = ex - sx, dy = ey - sy
                        const len = Math.sqrt(dx * dx + dy * dy)
                        return GR({ key: `gp${si}`, x: -len / 2, y: -PANEL_THICK_PX / 2, width: len, height: PANEL_THICK_PX, transform: `translate(${cx},${cy}) rotate(${gBeamDeg})` })
                      })
                    })()}
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

              {/* ── Blocks — positionCm is base-beam coords from server ── */}
              {(() => {
                const beBlocks = beDetailData?.blocks ?? []
                const blockPunches = (beDetailData?.punches ?? []).filter(p => p.origin === 'block')
                const baseBeamLen = geom.baseBeamLength || 1
                const baseBeamX0 = legX0 - firstLegPos * SC
                const atBase = (posCm) => baseBeamX0 + (posCm / baseBeamLen) * (baseBeamLen * SC)
                const bw = blockLengthCm * SC
                return (<>
                  {beBlocks.map((blk, bi) => {
                    const bx = atBase(blk.positionCm)
                    const blkPunch = blockPunches.find(p => p.blockIdx === bi)
                    const label = blkPunch ? fmt(reverseBlockPunches && blkPunch.reversedPositionCm != null ? blkPunch.reversedPositionCm : blkPunch.positionCm) : ''
                    return (
                      <g key={bi}>
                        <rect x={bx} y={blockTopY} width={bw} height={blockH} fill={BLOCK_FILL} stroke={BLOCK_STROKE} strokeWidth="1" />
                        {showPunches && label && (
                          <text x={bx + bw / 2} y={blockTopY + blockH / 2} textAnchor="middle" dominantBaseline="middle" fontSize="9" fontWeight="700" fill={TEXT_DARKEST}>{label}</text>
                        )}
                      </g>
                    )
                  })}
                </>)
              })()}

              {/* ── Base beam — uses full baseBeamLength (includes extensions for purlin types) ── */}
              {(() => {
                const baseBeamW = (geom.baseBeamLength ?? (legBW / SC)) * SC
                const firstLegPos = (beLegs[0]?.positionCm ?? 0) * SC
                return <rect x={legX0 - firstLegPos} y={baseY} width={baseBeamW} height={BEAM_THICK_PX} fill={L_PROFILE_FILL} stroke={L_PROFILE_STROKE} strokeWidth="1" />
              })()}

              {/* ── All legs — uniform: rect from positionCm to positionEndCm ── */}
              {beLegs.map((leg, li) => {
                const lx = allLegXs[li]
                const lxEnd = allLegEndXs[li]
                const lw = lxEnd - lx
                const slopeTopY = allLegTopYs[li] - Math.cos(angleRad) * BEAM_THICK_PX / 2
                const legH = baseY + BEAM_THICK_PX - slopeTopY
                if (legH <= 0) return null
                return (
                  <g key={`leg-${li}`}>
                    <rect x={lx} y={slopeTopY} width={lw} height={legH} fill={L_PROFILE_FILL} stroke={L_PROFILE_STROKE} strokeWidth="1" />
                    {leg.isDouble && (<>
                      <line x1={lx + lw / 2} y1={slopeTopY} x2={lx + lw / 2} y2={slopeTopY + legH}
                        stroke={DANGER} strokeWidth="1" strokeLinecap="square"
                        strokeDasharray="4,4" opacity="0.6" />
                      <text x={lx + lw / 2} y={slopeTopY + legH / 2} textAnchor="middle" dominantBaseline="middle" fontSize="9" fontWeight="900" fill={DANGER}>×2</text>
                    </>)}
                  </g>
                )
              })}

              {/* ── Slope beam ── */}
              {lProfileLine({ x1: legX0, y1: allLegTopYs[0], x2: legX1, y2: allLegTopYs[allLegTopYs.length - 1], strokeWidth: BEAM_THICK_PX })}
              {diagonals.map((d, di) => {
                const ang = Math.atan2(d.botY - d.topY, d.botX - d.topX) * 180 / Math.PI
                return (
                  <g key={di}>
                    {lProfileLine({ x1: d.topX, y1: d.topY, x2: d.botX, y2: d.botY, strokeWidth: BEAM_THICK_PX * 0.75, capExtend: d.halfCap })}
                    {d.isDouble && (<>
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
                    {showDimensions && <Dim
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
                // Panel bars: vertical offset above beam (no horizontal shift in side view)
                let dCm = 0
                return segments.map((seg, idx) => {
                  dCm += seg.gapBeforeCm
                  const sx = atSlope(dCm).x
                  dCm += seg.depthCm
                  if (seg.isEmpty) return null
                  const ex = atSlope(dCm).x
                  const sy = beamYFromLegs(sx), ey = beamYFromLegs(ex)
                  const cx  = (sx + ex) / 2
                  const cy  = (sy + ey) / 2 - PANEL_OFFSET_PX
                  const len = Math.sqrt((ex - sx) ** 2 + (ey - sy) ** 2)
                  return (
                    <g key={idx}>
                      <rect
                        x={cx - len/2} y={cy - PANEL_THICK_PX/2}
                        width={len} height={PANEL_THICK_PX}
                        fill={PANEL_BAR_FILL}
                        stroke={PANEL_BAR_STROKE}
                        strokeWidth="1"
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
                    {showPunches && <text x={lx} y={ly}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize="7.5" fontWeight="700" fill={railStroke}
                      transform={`rotate(${beamAngleDeg}, ${lx}, ${ly})`}
                    >{fmt(globalOffsetCm - originCm)}</text>}
                  </g>
                )
              })}

              {/* ── Inner leg height dimensions ── */}
              {showDimensions && beLegs.slice(1, -1).map((leg, ci) => {
                const lx = allLegXs[ci + 1]
                const lxEnd = allLegEndXs[ci + 1]
                const mx = (lx + lxEnd) / 2
                const slopeTopY = allLegTopYs[ci + 1] - Math.cos(angleRad) * BEAM_THICK_PX / 2
                return <Dim key={`ilh-${ci}`} ax1={mx} ay1={slopeTopY} ax2={mx} ay2={blockTopY} label={fmt(leg.heightCm)} off={14} />
              })}

              {/* ── Punches on beams — non-diagonal from BE, diagonal from local activeDiags ── */}
              {showPunches && <>
                {(beDetailData?.punches ?? []).filter(p => p.origin !== 'diagonal').map((p, i) => {
                  if (p.beamType === 'base') {
                    const bbX0 = legX0 - firstLegPos * SC
                    const px = bbX0 + p.positionCm * SC
                    return <circle key={`p-${i}`} cx={px} cy={baseY + BEAM_THICK_PX / 2} r={2}
                      fill="white" stroke={TEXT_SECONDARY} strokeWidth="1" />
                  }
                  const px = legX0 + (p.positionCm / (topBeamLength || 1)) * legBW
                  const slopeY = allLegTopYs[0] + (px - legX0) / (legBW || 1) * (allLegTopYs[allLegTopYs.length - 1] - allLegTopYs[0])
                  return <circle key={`p-${i}`} cx={px} cy={slopeY} r={2}
                    fill="white" stroke={TEXT_SECONDARY} strokeWidth="1" />
                })}
                {activeDiags.map((d, di) => {
                  const slopeY = allLegTopYs[0] + (d.topX - legX0) / (legBW || 1) * (allLegTopYs[allLegTopYs.length - 1] - allLegTopYs[0])
                  return (<g key={`dp-${di}`}>
                    <circle cx={d.topX} cy={slopeY} r={2.5} fill="white" stroke={BLUE} strokeWidth="1" />
                    <circle cx={d.botX} cy={baseY + BEAM_THICK_PX / 2} r={2.5} fill="white" stroke={BLUE} strokeWidth="1" />
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

              {hl('extension') && (geom.frontExtensionCm > 0 || geom.rearExtensionCm > 0) && (
                <g style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }}>
                  {geom.frontExtensionCm > 0 && (() => {
                    const extW = firstLegPos * SC
                    return <rect x={legX0 - extW - 3} y={baseY - 3} width={extW + 6} height={BEAM_THICK_PX + 6}
                      fill="none" stroke={AMBER} strokeWidth="2.5" rx="3" />
                  })()}
                  {geom.rearExtensionCm > 0 && (() => {
                    const bbEnd = legX0 - firstLegPos * SC + (geom.baseBeamLength ?? 0) * SC
                    const rearExtW = (geom.rearExtensionCm ?? 0) * SC
                    return <rect x={bbEnd - rearExtW - 3} y={baseY - 3} width={rearExtW + 6} height={BEAM_THICK_PX + 6}
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
              <text x={activeBeamR - 32} y={beamYFromLegs(activeBeamR) + 22} fontSize="9" fill={TEXT_SECONDARY} fontWeight="700">{angle}°</text>

              {/* ── Dimension dimensions ── */}
              {showDimensions && <>
                {/* Slope beam: active portion only */}
                <Dim ax1={activeBoundL} ay1={beamYFromLegs(activeBoundL)} ax2={activeBoundR} ay2={beamYFromLegs(activeBoundR)}
                  label={fmt(activeSlopeBeamLenCm)} off={-(PANEL_OFFSET_PX + 14)} />

                {(() => {
                  if (!hasActiveZone) return null
                  // Panel distance dimensions: all on the beam line (parallel to panel)
                  const panelOff = -(PANEL_OFFSET_PX + 28)
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

                {/* Left leg height: from BE data, annotation on OUTSIDE (left) */}
                {(() => {
                  const legH = beLegs[0]?.heightCm ?? 0
                  const slopeTopY = allLegTopYs[0] - Math.cos(angleRad) * BEAM_THICK_PX / 2
                  return <Dim ax1={activeBeamL} ay1={slopeTopY} ax2={activeBeamL} ay2={baseY + BEAM_THICK_PX}
                    label={fmt(legH)} off={-18} />
                })()}

                <Dim ax1={activePanelStartBot.x} ay1={blockBotY}
                     ax2={activePanelStartBot.x} ay2={activePanelStartBot.y}
                  label={fmt(geom.panelFrontHeight ?? 0)}
                  off={-22} />

                {BLOCK_H_CM > 0 && <Dim ax1={legX0} ay1={blockTopY} ax2={legX0} ay2={blockBotY}
                  label={fmt(BLOCK_H_CM)} off={-14} />}

                {/* Right leg height: from BE data, annotation on OUTSIDE (right) */}
                {(() => {
                  const legH = beLegs[beLegs.length - 1]?.heightCm ?? 0
                  const slopeTopY = allLegTopYs[allLegTopYs.length - 1] - Math.cos(angleRad) * BEAM_THICK_PX / 2
                  return <Dim ax1={activeBeamR} ay1={slopeTopY} ax2={activeBeamR} ay2={baseY + BEAM_THICK_PX}
                    label={fmt(legH)} off={18} />
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
              {showPunches && (() => {
                const ry    = blockBotY + 130
                const barH  = 12
                const barCy = ry + barH / 2
                const baseBeamLen = activeBaseBeamLenCm
                const firstLegPos = beLegs[0]?.positionCm ?? 0
                const baseBarX0 = legX0 - firstLegPos * SC
                const baseBarW = baseBeamLen * SC
                const atBase = (posCm) => baseBarX0 + (posCm / baseBeamLen) * baseBarW
                const nonDiagBasePunches = (beDetailData?.punches ?? [])
                  .filter(p => p.beamType === 'base' && p.origin !== 'block' && p.origin !== 'diagonal')
                  .map(p => ({ x: atBase(p.positionCm), label: fmt(p.positionCm), origin: p.origin }))
                const diagBasePunches = activeDiags.map(d => ({
                  x: d.botX, label: fmt((d.botX - baseBarX0) / SC), origin: 'diagonal',
                }))
                const basePunches = [...nonDiagBasePunches, ...diagBasePunches].sort((a, b) => a.x - b.x)
                const ghostX = (() => {
                  if (!showDiagHandles || barHover?.which !== 'bot') return null
                  const span = findSpan(barHover.svgX)
                  if (!span || activeSpanSet.has(span.spanIndex)) return null
                  if (activeDiags.some(d => Math.abs(d.botX - barHover.svgX) < 8)) return null
                  return barHover.svgX
                })()
                return (
                  <g>
                    <text x={baseBarX0} y={ry - 5} fontSize="8" fill={TEXT_PLACEHOLDER} fontWeight="600">{t('step3.detail.baseBeamPunches')}</text>
                    <rect x={baseBarX0} y={ry} width={baseBarW} height={barH}
                      fill={PUNCH_BAR_FILL} stroke={PUNCH_BAR_STROKE} strokeWidth="1" rx="2"
                      style={{ cursor: showDiagHandles ? 'crosshair' : 'default' }}
                      onMouseMove={showDiagHandles ? (e) => handleBarMouseMove(e, 'bot') : undefined}
                      onMouseLeave={showDiagHandles ? () => setBarHover(null) : undefined}
                      onClick={showDiagHandles ? (e) => handleBarClick(e, 'bot') : undefined}
                    />
                    {/* all punch circles + labels — Punches layer */}
                    {basePunches.map((p, i) => {
                      const isDiag = p.origin === 'diagonal'
                      return (
                        <g key={`wp-${i}`}>
                          <circle cx={p.x} cy={barCy} r={isDiag ? 2.5 : 2} fill="white" stroke={isDiag ? BLUE : TEXT_SECONDARY} strokeWidth="1" />
                          <text x={p.x} y={ry + barH + 10} textAnchor="middle" fontSize="8" fill={isDiag ? BLUE : TEXT_SECONDARY} fontWeight="600">
                            {p.label}
                          </text>
                        </g>
                      )
                    })}
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
                    <Dim ax1={baseBarX0} ay1={ry + barH + 22} ax2={baseBarX0 + baseBarW} ay2={ry + barH + 22} label={fmt(baseBeamLen)} off={10} />
                  </g>
                )
              })()}

              {/* ── Slope beam punch sketch ── */}
              {showPunches && (() => {
                const ry    = blockBotY + 52
                const barH  = 12
                const barCy = ry + barH / 2
                const activeSlopeBeamLenCm = topBeamLength
                const atSlope2 = (posCm) => legX0 + (posCm / activeSlopeBeamLenCm) * legBW
                const nonDiagSlopePunches = (beDetailData?.punches ?? [])
                  .filter(p => p.beamType === 'slope' && p.origin !== 'rail' && p.origin !== 'diagonal')
                  .map(p => ({ x: atSlope2(p.positionCm), label: fmt(reverseBlockPunches && p.reversedPositionCm != null ? p.reversedPositionCm : p.positionCm), origin: p.origin }))
                const diagSlopePunches = activeDiags.map(d => {
                  const pos = (d.topX - legX0) / SC
                  const reversed = topBeamLength - pos
                  return { x: d.topX, label: fmt(reverseBlockPunches ? reversed : pos), origin: 'diagonal' }
                })
                const slopePunches = [...nonDiagSlopePunches, ...diagSlopePunches].sort((a, b) => a.x - b.x)
                const ghostX = (() => {
                  if (!showDiagHandles || barHover?.which !== 'top') return null
                  const span = findSpan(barHover.svgX)
                  if (!span || activeSpanSet.has(span.spanIndex)) return null
                  if (activeDiags.some(d => Math.abs(d.topX - barHover.svgX) < 8)) return null
                  return barHover.svgX
                })()
                return (
                  <g>
                    <text x={activeBoundL} y={ry - 5} fontSize="8" fill={TEXT_PLACEHOLDER} fontWeight="600">{t('step3.detail.slopeBeamPunches')}</text>
                    <rect x={legX0} y={ry} width={legBW} height={barH}
                      fill={PUNCH_BAR_FILL} stroke={PUNCH_BAR_STROKE} strokeWidth="1" rx="2"
                      style={{ cursor: showDiagHandles ? 'crosshair' : 'default' }}
                      onMouseMove={showDiagHandles ? (e) => handleBarMouseMove(e, 'top') : undefined}
                      onMouseLeave={showDiagHandles ? () => setBarHover(null) : undefined}
                      onClick={showDiagHandles ? (e) => handleBarClick(e, 'top') : undefined}
                    />
                    {/* all punch circles + labels — Punches layer */}
                    {slopePunches.map((p, i) => {
                      const isDiag = p.origin === 'diagonal'
                      return (
                        <g key={`wp-${i}`}>
                          <circle cx={p.x} cy={barCy} r={isDiag ? 2.5 : 2} fill="white" stroke={isDiag ? BLUE : TEXT_SECONDARY} strokeWidth="1" />
                          <text x={p.x} y={ry + barH + 10} textAnchor="middle" fontSize="8" fill={isDiag ? BLUE : TEXT_SECONDARY} fontWeight="600">
                            {p.label}
                          </text>
                        </g>
                      )
                    })}
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
                    [t('step3.detail.rearLeg'),   beLegs[0]?.heightCm ?? 0],
                    [t('step3.detail.frontLeg'),  beLegs[beLegs.length - 1]?.heightCm ?? 0],
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
        layers={[
          { label: t('step3.layer.punches'),       checked: showPunches,      setter: setShowPunches      },
          { label: t('step3.layer.dimensions'),   checked: showDimensions,  setter: setShowDimensions  },
          { label: t('step3.layer.editBar'),      checked: showDiagHandles, setter: setShowDiagHandles  },
          { label: t('step3.layer.roofLine'),   checked: showRoofLine,    setter: setShowRoofLine     },
          ...(fullTrapGhost ? [{ label: t('step3.layer.ghost'), checked: showGhost, setter: setShowGhost }] : []),
        ]}
        actions={[
          ...(onReset ? [{ label: t('step3.layer.resetDefaults'), onClick: onReset, style: { color: AMBER_DARK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}` } }] : []),
          ...(Object.keys(diagOverrides).length > 0
            ? [{ label: t('step3.layer.resetHandles'), onClick: () => onUpdateSetting?.('diagOverrides', {}), style: { color: BLUE, background: BLUE_BG, border: `1px solid ${BLUE_BORDER}` } }]
            : []),
          { label: rulerActive ? t('step3.layer.rulerOn') : t('step3.layer.ruler'), onClick: () => { if (rulerActive) RulerTool._clear?.(); setRulerActive(v => !v) }, style: rulerActive ? { color: BLUE, background: BLUE_BG, border: `1px solid ${BLUE_BORDER}` } : {} },
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
