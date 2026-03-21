import { useState, useRef } from 'react'
import { TEXT_SECONDARY, TEXT_DARKEST, TEXT_VERY_LIGHT, TEXT_PLACEHOLDER, BG_SUBTLE, BG_MID, BLUE, BLUE_BG, BLUE_BORDER, AMBER_DARK } from '../../../styles/colors'
import { PANEL_WIDTH_CM } from '../../../utils/constructionCalculator'
import CanvasNavigator from '../../shared/CanvasNavigator'
import { useCanvasPanZoom } from '../../../hooks/useCanvasPanZoom'
import { PARAM_GROUP } from './constants'
import LayersPanel from './LayersPanel'
import RulerTool from '../../shared/RulerTool'

export default function DetailView({ rc, panelLines = null, settings = {}, lineRails = null, highlightParam = null, onReset = null, onUpdateSetting = null }) {
  const [showAnnotations,  setShowAnnotations]  = useState(true)
  const [showPunches,      setShowPunches]      = useState(true)
  const [showDiagHandles,  setShowDiagHandles]  = useState(true)
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
  const panelLengthCm  = settings.panelLengthCm ?? 238.2
  const diagTopPct     = (settings.diagTopPct  ?? 25) / 100
  const diagBasePct    = (settings.diagBasePct ?? 90) / 100
  const diagOverrides  = settings.diagOverrides ?? {}

  // Highlight helpers
  const hlGroup = PARAM_GROUP[highlightParam] ?? null
  const hl = (group) => hlGroup === group

  if (!rc) return <div style={{ padding: '2rem', color: TEXT_VERY_LIGHT }}>Select a row to see its trapezoid detail</div>

  const baseOverhangCm = settings.baseOverhangCm ?? 0
  const { heightRear, heightFront, baseLength, baseBeamLength: rcBaseBeamLength, angle, topBeamLength } = rc
  const baseBeamLength = rcBaseBeamLength ?? (baseLength + 2 * baseOverhangCm)

  const SC         = 2.2
  const RAIL_CM    = railOffsetCm
  const BLOCK_H_CM = blockHeightCm

  const angleRad = angle * Math.PI / 180
  const bW      = baseLength   * SC   // leg-to-leg horizontal span
  // Overhang is along the slope; decompose into horizontal (OHx) and vertical (OHy) SVG components
  const OHx     = baseOverhangCm * Math.cos(angleRad) * SC
  const OHy     = baseOverhangCm * Math.sin(angleRad) * SC
  const hR      = heightRear   * SC
  const hF      = heightFront  * SC
  const railOffH = RAIL_CM * Math.cos(angleRad) * SC
  const railOffV = RAIL_CM * Math.sin(angleRad) * SC
  const blockH  = BLOCK_H_CM   * SC

  const segments = (panelLines && panelLines.length > 0)
    ? panelLines
    : [{ depthCm: panelLengthCm, gapBeforeCm: 0 }]
  const totalPanelDepthCm = segments.reduce((s, seg) => s + seg.gapBeforeCm + seg.depthCm, 0)

  const padL = Math.max(120, railOffH + OHx + 40)
  const panelExtCm = (totalPanelDepthCm - RAIL_CM) * Math.cos(angleRad) - baseLength
  const padR = Math.max(100, Math.max(panelExtCm * SC, OHx) + 70)
  const padT = 55
  const padB = blockH + 290

  const svgW = bW + padL + padR
  const svgH = hF + padT + padB

  const baseY     = hF + padT
  const topY0     = baseY - hR
  const topY1     = baseY - hF
  const x0 = padL
  const x1 = padL + bW

  const slope   = (topY1 - topY0) / bW
  // Slope beam extended endpoints: overhang is along the slope → decompose into OHx/OHy
  // Extending backward (rear side): x decreases, y increases (lower in SVG)
  // Extending forward (front side): x increases, y decreases (higher in SVG)
  const topExtX0 = x0 - OHx, topExtY0 = topY0 + OHy
  const topExtX1 = x1 + OHx, topExtY1 = topY1 - OHy
  // Leg positions at trapezoid ends (beam ends, including overhang)
  const legX0 = topExtX0
  const legX1 = topExtX1
  const legBW = bW + 2 * OHx
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
      dCm += seg.gapBeforeCm
      const segRails = lineRails?.[si] ?? []
      for (const offsetCm of segRails) {
        items.push({ cx: atSlope(dCm + offsetCm).x, segIdx: si, offsetCm, globalOffsetCm: dCm + offsetCm })
      }
      dCm += seg.depthCm
    }
    return items
  })()
  const railXs = railItems.map(r => r.cx)
  const rail1X = railXs[0] ?? x0
  const rail2X = railXs[railXs.length - 1] ?? x1

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
  const innerLegXs   = railXs.slice(1, -1).map(cx => cx - crossRailEdgeDistCm * Math.cos(angleRad) * SC)
  const allLegXs     = [legX0, ...innerLegXs, legX1]
  const diagonals = (() => {
    const SKIP_BELOW = 60, DOUBLE_ABOVE = 200
    const numSpans = allLegXs.length - 1
    const raw = allLegXs.slice(0, -1).map((xA, i) => {
      const xB       = allLegXs[i + 1]
      const hA       = legHeightAtX(xA)
      const hB       = legHeightAtX(xB)
      const spanW    = xB - xA
      const isDouble = hA >= DOUBLE_ABOVE || hB >= DOUBLE_ABOVE
      const ov       = diagOverrides[i] ?? {}
      // Skip rule, then apply explicit user override
      let   skip     = hA < SKIP_BELOW && hB < SKIP_BELOW
      if (ov.disabled === true)  skip = true
      if (ov.disabled === false) skip = false
      const reversed  = numSpans > 1 && i === 0
      const defTopPct = reversed ? (isDouble ? 0.90 : 1 - diagTopPct) : (isDouble ? 0.10 : diagTopPct)
      const defBotPct = reversed ? (1 - diagBasePct) : diagBasePct
      const topPct    = ov.topPct !== undefined ? ov.topPct : defTopPct
      const botPct    = ov.botPct !== undefined ? ov.botPct : defBotPct
      const topX      = xA + topPct * spanW
      const botX      = xA + botPct * spanW
      const topY      = beamY(topX)
      const lenCm     = Math.sqrt((botX - topX) ** 2 + (baseY - topY) ** 2) / SC
      return { xA, xB, hA, hB, spanW, topX, botX, topY, lenCm, isDouble, reversed, skip, spanIndex: i }
    })
    // Safety: if all skip, force-show the rightmost span not explicitly disabled by user
    const anyVisible = raw.some(s => !s.skip)
    if (!anyVisible) {
      for (let i = raw.length - 1; i >= 0; i--) {
        if ((diagOverrides[raw[i].spanIndex] ?? {}).disabled !== true) {
          raw[i] = { ...raw[i], skip: false }
          break
        }
      }
    }
    return raw.filter(s => !s.skip)
  })()

  // Spans with no diagonal (skipped by rules or user-deleted) — used for "add" affordance
  const activeSpanSet    = new Set(diagonals.map(d => d.spanIndex))
  const naturallySkipped = new Set(
    allLegXs.slice(0, -1).map((xA, i) => {
      const xB = allLegXs[i + 1]
      return legHeightAtX(xA) < 60 && legHeightAtX(xB) < 60 ? i : -1
    }).filter(i => i >= 0)
  )

  const lb_x = legX0,              lb_w = blockW  // left block aligns with rear leg (beam end)
  const rb_x = legX1 - blockW,     rb_w = blockW  // right block aligns with front leg (beam end)

  // Center blocks: 2 per vertical line, 1 per horizontal, min 2 total → numCenterBlocks = numBlocks - 2
  // Prefer rails with larger globalOffsetCm (closer to high/rear leg)
  const numBlocks = Math.max(2, segments.reduce((sum, seg) => {
    if (seg.isEmpty) return sum
    return sum + (seg.isHorizontal ? 1 : 2)
  }, 0))
  const numCenterBlocks = numBlocks - 2
  // Inner rails = exclude outermost first and last; prefer rails with larger globalOffsetCm (higher elevation = closer to high leg)
  const centerBlockXs = (() => {
    if (numCenterBlocks === 0) return []
    const innerRails = [...railItems]
      .sort((a, b) => a.globalOffsetCm - b.globalOffsetCm)
      .slice(1, -1)                        // exclude outermost first and last
    return innerRails
      .slice(-numCenterBlocks)             // take last N = highest globalOffsetCm = closest to high leg
      .sort((a, b) => a.cx - b.cx)        // re-sort left→right for rendering
      .map(r => legX0 + (r.globalOffsetCm - RAIL_CM + baseOverhangCm) * Math.cos(angleRad) * SC - blockW / 2)
  })()

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
        style={{ width: '100%', height: '100%', overflow: 'hidden', cursor: panActive ? 'grabbing' : 'grab' }}
        onMouseDown={startPan}
        onMouseMove={handleContainerMouseMove}
        onMouseUp={handleContainerMouseUp}
        onMouseLeave={handleContainerMouseLeave}
      >
        <div style={{ transform: `translate(${panOffset.x}px, ${panOffset.y}px)`, transformOrigin: 'top left' }}>
          <div ref={contentRef} style={{
            transform: `scale(${zoom})`,
            transformOrigin: 'top left',
            padding: '1rem 1.5rem',
            display: 'inline-block',
          }}>
            <div style={{ fontSize: '0.78rem', fontWeight: '700', color: TEXT_SECONDARY, marginBottom: '0.75rem' }}>
              {rc.typeLetter}{rc.panelsPerSpan} — {angle}° · Panel Front {fmt(BLOCK_H_CM + heightRear + crossRailEdgeDistCm * Math.cos(angleRad) - RAIL_CM * Math.sin(angleRad))} cm
              <span style={{ fontWeight: '400', color: TEXT_PLACEHOLDER, marginLeft: '0.5rem' }}>
                · Panel {fmt(panelLengthCm)}×{fmt(PANEL_WIDTH_CM)} cm
              </span>
            </div>

            <svg ref={svgRef} width={svgW} height={svgH} style={{ display: 'block', overflow: 'visible' }}>
              <defs>
                <marker id="arr-k" markerWidth="5" markerHeight="5" refX="2.5" refY="2.5" orient="auto">
                  <path d="M0,0 L0,5 L5,2.5 z" fill={DC} />
                </marker>
                <marker id="arr-t" markerWidth="5" markerHeight="5" refX="2.5" refY="2.5" orient="auto">
                  <path d="M0,0 L0,5 L5,2.5 z" fill={TC} />
                </marker>
                <style>{`@keyframes hlPulse { 0%,100%{opacity:0.15} 50%{opacity:0.9} }`}</style>
              </defs>

              {/* ── Blocks ── */}
              {(() => {
                const PUNCH_CM = blockPunchCm
                const punchOff = PUNCH_CM * SC
                const baseCm = (svgX) => fmt((svgX - legX0) / SC)
                // end blocks: punch 9 cm from outer (base-aligned) edge; center blocks: 9 cm from left edge
                const lbPunchX = lb_x + punchOff           // 9 cm from base start
                const rbPunchX = rb_x + rb_w - punchOff    // 9 cm from base end
                return (<>
                  <rect x={lb_x} y={blockTopY} width={lb_w} height={blockH} fill="#c0c0c0" stroke="#777" strokeWidth="1" />
                  {showPunches && <text x={lbPunchX} y={blockTopY + blockH / 2} textAnchor="middle" dominantBaseline="middle" fontSize="9" fontWeight="700" fill="#111">{baseCm(lbPunchX)}</text>}
                  {centerBlockXs.map((bx, i) => {
                    const px = bx + punchOff
                    return (
                      <g key={i}>
                        <rect x={bx} y={blockTopY} width={blockW} height={blockH} fill="#c0c0c0" stroke="#777" strokeWidth="1" />
                        {showPunches && <text x={px} y={blockTopY + blockH / 2} textAnchor="middle" dominantBaseline="middle" fontSize="9" fontWeight="700" fill="#111">{baseCm(px)}</text>}
                      </g>
                    )
                  })}
                  <rect x={rb_x} y={blockTopY} width={rb_w} height={blockH} fill="#c0c0c0" stroke="#777" strokeWidth="1" />
                  {showPunches && <text x={rbPunchX} y={blockTopY + blockH / 2} textAnchor="middle" dominantBaseline="middle" fontSize="9" fontWeight="700" fill="#111">{baseCm(rbPunchX)}</text>}
                </>)
              })()}

              {/* ── Structure: outer-face-aligned rects + inward-shifted top beam ── */}
              {/* Base beam: outer top face at baseY, extends DOWN — includes overhang */}
              <rect x={x0 - OHx} y={baseY} width={bW + 2*OHx} height={BEAM_THICK_PX} fill="#404040" />
              {/* Rear leg: aligned with trapezoid rear end (beam end), extends RIGHT (inward) */}
              {(hR - OHy) > 0 && <rect x={legX0} y={topExtY0} width={BEAM_THICK_PX} height={hR - OHy} fill="#404040" />}
              {/* Front leg: aligned with trapezoid front end (beam end), extends LEFT (inward) */}
              <rect x={legX1 - BEAM_THICK_PX} y={topExtY1} width={BEAM_THICK_PX} height={hF + OHy} fill="#404040" />
              {/* Top beam: extended by overhang on each side */}
              <line x1={topExtX0} y1={topExtY0} x2={topExtX1} y2={topExtY1}
                stroke="#404040" strokeWidth={BEAM_THICK_PX} strokeLinecap="butt" />
              {diagonals.map((d, di) => {
                const ang = Math.atan2(baseY - d.topY, d.botX - d.topX) * 180 / Math.PI
                return (
                  <g key={di}>
                    <line x1={d.topX} y1={d.topY} x2={d.botX} y2={baseY}
                      stroke="#606060" strokeWidth={BEAM_THICK_PX * 0.75} strokeLinecap="square" />
                    {d.isDouble && (<>
                      <line x1={d.topX} y1={d.topY} x2={d.botX} y2={baseY}
                        stroke="red" strokeWidth="1" strokeLinecap="square"
                        strokeDasharray="4,4" opacity="0.6" />
                      {[0.08, 0.5, 0.92].map((t, i) => {
                        const lx = d.topX + t * (d.botX - d.topX)
                        const ly = d.topY + t * (baseY - d.topY)
                        return (
                          <text key={i} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
                            fontSize="8" fontWeight="800" fill="red"
                            transform={`rotate(${ang}, ${lx}, ${ly})`}>×2</text>
                        )
                      })}
                    </>)}
                    {hl('diagonal') && (
                      <line x1={d.topX} y1={d.topY} x2={d.botX} y2={baseY}
                        stroke="#FFB300" strokeWidth={BEAM_THICK_PX * 2} strokeLinecap="round"
                        style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />
                    )}
                    {showAnnotations && <Dim ax1={d.topX} ay1={d.topY} ax2={d.botX} ay2={baseY}
                      label={fmt(d.lenCm)} off={-16} />}
                  </g>
                )
              })}
              {/* Rail-clamp offset highlight */}
              {hl('rail-clamp') && (
                <g style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }}>
                  <line x1={panelX1} y1={panelY1} x2={x0} y2={topY0}
                    stroke="#FFB300" strokeWidth="8" strokeLinecap="round" opacity="0.6" />
                  <circle cx={x0} cy={topY0} r={10} fill="none" stroke="#FFB300" strokeWidth="2.5" />
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
                  return (
                    <g key={idx}>
                      <rect
                        x={cx - len/2} y={cy - PANEL_THICK_PX/2}
                        width={len} height={PANEL_THICK_PX}
                        fill={seg.isEmpty ? 'white' : '#6a70ac'}
                        stroke={seg.isEmpty ? '#ddd' : '#293189'}
                        strokeWidth="1"
                        strokeDasharray={seg.isEmpty ? '4,3' : undefined}
                        transform={`rotate(${beamAngleDeg}, ${cx}, ${cy})`}
                      />
                      {hl('panel') && (
                        <rect
                          x={cx - len/2 - 5} y={cy - PANEL_THICK_PX/2 - 5}
                          width={len + 10} height={PANEL_THICK_PX + 10}
                          fill="none" stroke="#FFB300" strokeWidth="2.5" rx="3"
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
                const railFill   = '#7c3aed'
                const railStroke = isEmptySeg ? '#ddd' : '#642165'
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
                        fill={isEmptySeg ? 'white' : railFill}
                        stroke={isEmptySeg ? '#ddd' : railStroke}
                        strokeWidth="1"
                        strokeDasharray={isEmptySeg ? '3,2' : undefined} />
                      {hl('cross-rails') && (
                        <rect x={-RW/2 - 5} y={midY - RH/2 - 5} width={RW + 10} height={RH + 10}
                          fill="none" stroke="#FFB300" strokeWidth="2.5" rx="3"
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

              {/* ── Rail support profiles (vertical, beam → base) ── */}
              {railXs.slice(1, -1).map((cx, ci) => {
                const sx = cx - crossRailEdgeDistCm * Math.cos(angleRad) * SC
                const topY = beamY(sx)
                const lenCm = (baseY - topY) / SC
                return (
                  <g key={ci}>
                    <line x1={sx} y1={topY} x2={sx} y2={baseY}
                      stroke="#404040" strokeWidth={BEAM_THICK_PX} strokeLinecap="square" />
                    {showAnnotations && <Dim ax1={sx} ay1={topY} ax2={sx} ay2={baseY}
                      label={fmt(lenCm)} off={14} />}
                  </g>
                )
              })}

              {/* ── Punches on base beam ── */}
              {showPunches && [legX0 + 2 * SC, ...diagonals.map(d => d.botX), legX1 - 2 * SC].map((px, i) => (
                <circle key={i} cx={px} cy={baseY + BEAM_THICK_PX / 2} r={2}
                  fill="white" stroke={TEXT_SECONDARY} strokeWidth="1" />
              ))}

              {/* ── Punches on top (slope) beam ── */}
              {showPunches && (() => {
                const dx = topExtX1 - topExtX0, dy = topExtY1 - topExtY0
                const beamLenPx = Math.sqrt(dx * dx + dy * dy)
                const ux = dx / beamLenPx, uy = dy / beamLenPx
                const pts = [
                  { x: topExtX0 + 2 * SC * ux, y: topExtY0 + 2 * SC * uy },
                  ...diagonals.map(d => ({ x: d.topX, y: d.topY })),
                  { x: topExtX1 - 2 * SC * ux, y: topExtY1 - 2 * SC * uy },
                ]
                return pts.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={2}
                    fill="white" stroke={TEXT_SECONDARY} strokeWidth="1" />
                ))
              })()}

              {hl('blocks') && (
                <g style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }}>
                  <rect x={lb_x - 5} y={blockTopY - 5} width={lb_w + 10} height={blockH + 10}
                    fill="none" stroke="#FFB300" strokeWidth="2.5" rx="3" />
                  {centerBlockXs.map((bx, i) => (
                    <rect key={i} x={bx - 5} y={blockTopY - 5} width={blockW + 10} height={blockH + 10}
                      fill="none" stroke="#FFB300" strokeWidth="2.5" rx="3" />
                  ))}
                  <rect x={rb_x - 5} y={blockTopY - 5} width={rb_w + 10} height={blockH + 10}
                    fill="none" stroke="#FFB300" strokeWidth="2.5" rx="3" />
                </g>
              )}

              {/* ── Green floor line ── */}
              <line x1={panelX1 - 35} y1={blockBotY} x2={panelX2 + 45} y2={blockBotY}
                stroke="#3a9e3a" strokeWidth="2.5" strokeLinecap="round" />

              {/* ── Angle label inside trapezoid ── */}
              <text x={legX1 - 32} y={topExtY1 + 22} fontSize="9" fill={TEXT_SECONDARY} fontWeight="700">{angle}°</text>

              {/* ── Dimension annotations ── */}
              {showAnnotations && <>
                <Dim ax1={topExtX0} ay1={topExtY0} ax2={topExtX1} ay2={topExtY1}
                  label={fmt(topBeamLength)} off={-(PANEL_OFFSET_PX + 14)} />

                {(() => {
                  const splitOff = -(PANEL_OFFSET_PX + 30)
                  const toCm = (dx) => fmt(dx / SC / Math.cos(angleRad))
                  return (<>
                    <Dim ax1={panelX1} ay1={panelY1} ax2={rail1X} ay2={beamY(rail1X)}
                      label={toCm(rail1X - panelX1)} off={splitOff} />
                    <Dim ax1={rail1X} ay1={beamY(rail1X)} ax2={rail2X} ay2={beamY(rail2X)}
                      label={toCm(rail2X - rail1X)} off={splitOff} />
                    <Dim ax1={rail2X} ay1={beamY(rail2X)} ax2={panelX2} ay2={panelY2}
                      label={toCm(panelX2 - rail2X)} off={splitOff} />
                  </>)
                })()}

                {(hR - OHy) > 0 && <Dim ax1={legX0} ay1={topExtY0} ax2={legX0} ay2={blockTopY}
                  label={fmt((hR - OHy) / SC)} off={55} />}

                <Dim ax1={panelX1} ay1={blockBotY}
                     ax2={panelX1} ay2={panelY1 + panOffY + Math.cos(angleRad) * PANEL_THICK_PX / 2}
                  label={fmt(BLOCK_H_CM + heightRear + crossRailEdgeDistCm * Math.cos(angleRad) - RAIL_CM * Math.sin(angleRad))}
                  off={-22} />

                <Dim ax1={lb_x} ay1={blockTopY} ax2={lb_x} ay2={blockBotY}
                  label={fmt(BLOCK_H_CM)} off={-14} />

                <Dim ax1={legX1} ay1={blockTopY} ax2={legX1} ay2={topExtY1 + Math.cos(angleRad) * BEAM_THICK_PX / 2}
                  label={fmt((hF + OHy) / SC)} off={38} />

                {(() => {
                  const panelFrontHeight = BLOCK_H_CM + heightRear + crossRailEdgeDistCm * Math.cos(angleRad) - RAIL_CM * Math.sin(angleRad)
                  const panelBackHeight  = panelFrontHeight + totalPanelDepthCm * Math.sin(angleRad)
                  return (
                    <Dim ax1={panelX2} ay1={blockBotY}
                         ax2={panelX2} ay2={panelY2 + panOffY + Math.cos(angleRad) * PANEL_THICK_PX / 2}
                      label={fmt(panelBackHeight)} off={28} />
                  )
                })()}

                {/* ── Base dimension (full beam including overhang) ── */}
                <Dim ax1={x0 - OHx} ay1={blockBotY + 18} ax2={x1 + OHx} ay2={blockBotY + 18}
                  label={fmt(baseBeamLength)} off={14} />
              </>}

              {/* ── Base beam punch sketch ── */}
              {showPunches && (() => {
                const ry    = blockBotY + 130
                const barH  = 12
                const beamL = x0 - OHx
                const beamR = x1 + OHx
                const barW  = beamR - beamL
                const barCy = ry + barH / 2
                const punches       = [beamL + 2 * SC, ...diagonals.map(d => d.botX), beamR - 2 * SC]
                const punchLabelsCm = ['2', ...diagonals.map(d => fmt((d.botX - legX0) / SC)), fmt(baseBeamLength - 2)]
                // Ghost position: barHover on this bar, in a missing span, not near an existing handle
                const ghostX = (() => {
                  if (!showDiagHandles || barHover?.which !== 'bot') return null
                  const span = findSpan(barHover.svgX)
                  if (!span || activeSpanSet.has(span.spanIndex)) return null
                  if (diagonals.some(d => Math.abs(d.botX - barHover.svgX) < 8)) return null
                  return barHover.svgX
                })()
                return (
                  <g>
                    <text x={beamL} y={ry - 5} fontSize="8" fill={TEXT_PLACEHOLDER} fontWeight="600">Base beam — punch positions</text>
                    {/* interactive bar rect */}
                    <rect x={beamL} y={ry} width={barW} height={barH}
                      fill="#d8d8d8" stroke="#999" strokeWidth="1" rx="2"
                      style={{ cursor: showDiagHandles ? 'crosshair' : 'default' }}
                      onMouseMove={showDiagHandles ? (e) => handleBarMouseMove(e, 'bot') : undefined}
                      onMouseLeave={showDiagHandles ? () => setBarHover(null) : undefined}
                      onClick={showDiagHandles ? (e) => handleBarClick(e, 'bot') : undefined}
                    />
                    {/* fixed end punches */}
                    {[punches[0], punches[punches.length - 1]].map((px, i) => (
                      <g key={`ep-${i}`}>
                        <circle cx={px} cy={barCy} r={2} fill="white" stroke={TEXT_SECONDARY} strokeWidth="1" />
                        <text x={px} y={ry + barH + 10} textAnchor="middle" fontSize="8" fill={TEXT_SECONDARY} fontWeight="600">
                          {i === 0 ? punchLabelsCm[0] : punchLabelsCm[punchLabelsCm.length - 1]}
                        </text>
                      </g>
                    ))}
                    {/* diagonal handles (click=delete, drag=move) */}
                    {showDiagHandles && diagonals.map((d, di) => {
                      const isHov = hoverHandle?.which === 'bot' && hoverHandle?.spanIndex === d.spanIndex
                      return (
                        <g key={`bh-${di}`}>
                          <circle cx={d.botX} cy={barCy} r={5.5}
                            fill={isHov ? '#dc2626' : BLUE} stroke="white" strokeWidth="1.5"
                            style={{ cursor: 'pointer' }}
                            onMouseEnter={() => setHoverHandle({ which: 'bot', spanIndex: d.spanIndex })}
                            onMouseLeave={() => setHoverHandle(null)}
                            onMouseDown={(e) => startHandleDrag(e, 'bot', d)}
                          />
                          {isHov && <text x={d.botX} y={barCy} textAnchor="middle" dominantBaseline="middle" fontSize="8" fontWeight="900" fill="white" style={{ pointerEvents: 'none' }}>✕</text>}
                          <text x={d.botX} y={ry + barH + 10} textAnchor="middle" fontSize="8" fill={isHov ? '#dc2626' : TEXT_SECONDARY} fontWeight="600">
                            {fmt((d.botX - legX0) / SC)}
                          </text>
                        </g>
                      )
                    })}
                    {/* "+" ghost follower */}
                    {ghostX !== null && (
                      <g opacity="0.5" style={{ pointerEvents: 'none' }}>
                        <line x1={ghostX} y1={ry} x2={ghostX} y2={ry + barH} stroke="#22c55e" strokeWidth="1.5" strokeDasharray="3,2" />
                        <text x={ghostX + 5} y={barCy + 1} dominantBaseline="middle" fontSize="9" fontWeight="800" fill="#22c55e">+</text>
                      </g>
                    )}
                    <Dim ax1={beamL} ay1={ry + barH + 22} ax2={beamR} ay2={ry + barH + 22} label={fmt(baseBeamLength)} off={10} />
                  </g>
                )
              })()}

              {/* ── Slope beam punch sketch ── */}
              {showPunches && (() => {
                const ry    = blockBotY + 52
                const barH  = 12
                const beamL = x0 - OHx
                const beamR = x1 + OHx
                const barW  = beamR - beamL
                const barCy = ry + barH / 2
                const punches       = [beamL + (2 / topBeamLength) * barW, ...diagonals.map(d => d.topX), beamL + ((topBeamLength - 2) / topBeamLength) * barW]
                const punchLabelsCm = ['2', ...diagonals.map(d => fmt((d.topX - legX0) / legBW * topBeamLength)), fmt(topBeamLength - 2)]
                const ghostX = (() => {
                  if (!showDiagHandles || barHover?.which !== 'top') return null
                  const span = findSpan(barHover.svgX)
                  if (!span || activeSpanSet.has(span.spanIndex)) return null
                  if (diagonals.some(d => Math.abs(d.topX - barHover.svgX) < 8)) return null
                  return barHover.svgX
                })()
                return (
                  <g>
                    <text x={beamL} y={ry - 5} fontSize="8" fill={TEXT_PLACEHOLDER} fontWeight="600">Slope beam — punch positions</text>
                    <rect x={beamL} y={ry} width={barW} height={barH}
                      fill="#d8d8d8" stroke="#999" strokeWidth="1" rx="2"
                      style={{ cursor: showDiagHandles ? 'crosshair' : 'default' }}
                      onMouseMove={showDiagHandles ? (e) => handleBarMouseMove(e, 'top') : undefined}
                      onMouseLeave={showDiagHandles ? () => setBarHover(null) : undefined}
                      onClick={showDiagHandles ? (e) => handleBarClick(e, 'top') : undefined}
                    />
                    {[punches[0], punches[punches.length - 1]].map((px, i) => (
                      <g key={`ep-${i}`}>
                        <circle cx={px} cy={barCy} r={2} fill="white" stroke={TEXT_SECONDARY} strokeWidth="1" />
                        <text x={px} y={ry + barH + 10} textAnchor="middle" fontSize="8" fill={TEXT_SECONDARY} fontWeight="600">
                          {i === 0 ? punchLabelsCm[0] : punchLabelsCm[punchLabelsCm.length - 1]}
                        </text>
                      </g>
                    ))}
                    {showDiagHandles && diagonals.map((d, di) => {
                      const isHov = hoverHandle?.which === 'top' && hoverHandle?.spanIndex === d.spanIndex
                      return (
                        <g key={`sh-${di}`}>
                          <circle cx={d.topX} cy={barCy} r={5.5}
                            fill={isHov ? '#dc2626' : BLUE} stroke="white" strokeWidth="1.5"
                            style={{ cursor: 'pointer' }}
                            onMouseEnter={() => setHoverHandle({ which: 'top', spanIndex: d.spanIndex })}
                            onMouseLeave={() => setHoverHandle(null)}
                            onMouseDown={(e) => startHandleDrag(e, 'top', d)}
                          />
                          {isHov && <text x={d.topX} y={barCy} textAnchor="middle" dominantBaseline="middle" fontSize="8" fontWeight="900" fill="white" style={{ pointerEvents: 'none' }}>✕</text>}
                          <text x={d.topX} y={ry + barH + 10} textAnchor="middle" fontSize="8" fill={isHov ? '#dc2626' : TEXT_SECONDARY} fontWeight="600">
                            {fmt((d.topX - legX0) / legBW * topBeamLength)}
                          </text>
                        </g>
                      )
                    })}
                    {ghostX !== null && (
                      <g opacity="0.5" style={{ pointerEvents: 'none' }}>
                        <line x1={ghostX} y1={ry} x2={ghostX} y2={ry + barH} stroke="#22c55e" strokeWidth="1.5" strokeDasharray="3,2" />
                        <text x={ghostX + 5} y={barCy + 1} dominantBaseline="middle" fontSize="9" fontWeight="800" fill="#22c55e">+</text>
                      </g>
                    )}
                    <Dim ax1={beamL} ay1={ry + barH + 22} ax2={beamR} ay2={ry + barH + 22} label={fmt(topBeamLength)} off={10} />
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
                    ['Base beam',  baseBeamLength],
                    ['Top beam',   rc.topBeamLength],
                    ['Rear leg',   rc.heightRear],
                    ['Front leg',  rc.heightFront],
                    ...diagonals.map((d, i) => [
                      diagonals.length > 1
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

      <RulerTool active={rulerActive} zoom={zoom} pxPerCm={2.2} containerRef={containerRef} />

      {/* ── Layers panel ── */}
      <LayersPanel
        layers={[
          { label: 'Annotations',   checked: showAnnotations,  setter: setShowAnnotations  },
          { label: 'Punches',       checked: showPunches,      setter: setShowPunches      },
          { label: 'Edit Bar',      checked: showDiagHandles,  setter: setShowDiagHandles  },
        ]}
        actions={[
          ...(onReset ? [{ label: 'Reset to defaults', onClick: onReset, style: { color: AMBER_DARK, background: '#fffbeb', border: '1px solid #fcd34d' } }] : []),
          ...(Object.keys(diagOverrides).length > 0
            ? [{ label: 'Reset handles', onClick: () => onUpdateSetting?.('diagOverrides', {}), style: { color: BLUE, background: BLUE_BG, border: `1px solid ${BLUE_BORDER}` } }]
            : []),
          { label: rulerActive ? '📏 Ruler ON' : '📏 Ruler', onClick: () => { if (rulerActive) RulerTool._clear?.(); setRulerActive(v => !v) }, style: rulerActive ? { color: BLUE, background: BLUE_BG, border: `1px solid ${BLUE_BORDER}` } : {} },
        ]}
      />

      {/* ── Floating navigator ── */}
      <CanvasNavigator
        viewZoom={zoom}
        onZoomOut={() => setZoom(z => Math.max(0.25, z * 0.833))}
        onZoomReset={resetView}
        onZoomIn={() => setZoom(z => Math.min(6, z * 1.2))}
        mmWidth={MM_W}
        mmHeight={MM_H}
        onPanToPoint={panToMinimapPoint}
        viewportRect={getMinimapViewportRect()}
      />

    </div>
  )
}
