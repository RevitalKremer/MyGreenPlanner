import { PANEL_WIDTH_CM } from '../../../utils/constructionCalculator'
import CanvasNavigator from '../../shared/CanvasNavigator'
import { useCanvasPanZoom } from '../../../hooks/useCanvasPanZoom'
import { PARAM_GROUP } from './constants'

export default function DetailView({ rc, panelLines = null, settings = {}, lineRails = null, highlightParam = null }) {
  const {
    zoom, setZoom, panOffset, panActive,
    containerRef, contentRef,
    startPan, handleMouseMove, stopPan, resetView,
    MM_W, MM_H, panToMinimapPoint, getMinimapViewportRect,
  } = useCanvasPanZoom()

  // Rail offset = first rail of first line (derived from lineRails)
  const railOffsetCm   = lineRails?.[0]?.[0] ?? 0
  const blockHeightCm  = settings.blockHeightCm  ?? 30
  const blockWidthCm   = settings.blockWidthCm   ?? 70
  const blockPunchCm   = Math.min(settings.blockPunchCm ?? 9, blockWidthCm)
  const crossRailEdgeDistCm = (settings.crossRailEdgeDistMm ?? 40) / 10
  const panelLengthCm  = settings.panelLengthCm ?? 238.2
  const diagTopPct     = (settings.diagTopPct  ?? 25) / 100
  const diagBasePct    = (settings.diagBasePct ?? 90) / 100

  // Highlight helpers
  const hlGroup = PARAM_GROUP[highlightParam] ?? null
  const hl = (group) => hlGroup === group

  if (!rc) return <div style={{ padding: '2rem', color: '#aaa' }}>Select a row to see its trapezoid detail</div>

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

  const blockW  = blockWidthCm * SC
  const diagTopX  = legX0 + diagTopPct  * legBW
  const diagBaseX = legX0 + diagBasePct * legBW
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

  const DC = '#222'
  const TC = '#aaa'

  // Format to 1 decimal, stripping trailing ".0"
  const fmt = (v) => parseFloat(v.toFixed(1)).toString()

  const beamAngleDeg = Math.atan2(topY1 - topY0, x1 - x0) * 180 / Math.PI

  const diagLenCm = Math.sqrt((diagBaseX - diagTopX) ** 2 + (baseY - beamY(diagTopX)) ** 2) / SC

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
        onMouseMove={handleMouseMove}
        onMouseUp={stopPan}
        onMouseLeave={stopPan}
      >
        <div style={{ transform: `translate(${panOffset.x}px, ${panOffset.y}px)`, transformOrigin: 'top left' }}>
          <div ref={contentRef} style={{
            transform: `scale(${zoom})`,
            transformOrigin: 'top left',
            padding: '1rem 1.5rem',
            display: 'inline-block',
          }}>
            <div style={{ fontSize: '0.78rem', fontWeight: '700', color: '#555', marginBottom: '0.75rem' }}>
              {rc.typeLetter}{rc.panelsPerSpan} — {angle}° · Panel Front {fmt(BLOCK_H_CM + heightRear + crossRailEdgeDistCm * Math.cos(angleRad) - RAIL_CM * Math.sin(angleRad))} cm
              <span style={{ fontWeight: '400', color: '#999', marginLeft: '0.5rem' }}>
                · Panel {fmt(panelLengthCm)}×{fmt(PANEL_WIDTH_CM)} cm
              </span>
            </div>

            <svg width={svgW} height={svgH} style={{ display: 'block', overflow: 'visible' }}>
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
                  <text x={lbPunchX} y={blockTopY + blockH / 2} textAnchor="middle" dominantBaseline="middle" fontSize="9" fontWeight="700" fill="#111">{baseCm(lbPunchX)}</text>
                  {centerBlockXs.map((bx, i) => {
                    const px = bx + punchOff
                    return (
                      <g key={i}>
                        <rect x={bx} y={blockTopY} width={blockW} height={blockH} fill="#c0c0c0" stroke="#777" strokeWidth="1" />
                        <text x={px} y={blockTopY + blockH / 2} textAnchor="middle" dominantBaseline="middle" fontSize="9" fontWeight="700" fill="#111">{baseCm(px)}</text>
                      </g>
                    )
                  })}
                  <rect x={rb_x} y={blockTopY} width={rb_w} height={blockH} fill="#c0c0c0" stroke="#777" strokeWidth="1" />
                  <text x={rbPunchX} y={blockTopY + blockH / 2} textAnchor="middle" dominantBaseline="middle" fontSize="9" fontWeight="700" fill="#111">{baseCm(rbPunchX)}</text>
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
              <line x1={diagTopX} y1={beamY(diagTopX)} x2={diagBaseX} y2={baseY}
                stroke="#606060" strokeWidth={BEAM_THICK_PX * 0.75} strokeLinecap="square" />
              {hl('diagonal') && (
                <line x1={diagTopX} y1={beamY(diagTopX)} x2={diagBaseX} y2={baseY}
                  stroke="#FFB300" strokeWidth={BEAM_THICK_PX * 2} strokeLinecap="round"
                  style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />
              )}
              <Dim ax1={diagTopX} ay1={beamY(diagTopX)} ax2={diagBaseX} ay2={baseY}
                label={fmt(diagLenCm)} off={-16} />
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
                    <text x={lx} y={ly}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize="7.5" fontWeight="700" fill={railStroke}
                      transform={`rotate(${beamAngleDeg}, ${lx}, ${ly})`}
                    >{fmt(globalOffsetCm - RAIL_CM + baseOverhangCm)}</text>
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
                    <Dim ax1={sx} ay1={topY} ax2={sx} ay2={baseY}
                      label={fmt(lenCm)} off={14} />
                  </g>
                )
              })}

              {/* ── Punches on base beam ── */}
              {[legX0 + 2 * SC, diagBaseX, legX1 - 2 * SC].map((px, i) => (
                <circle key={i} cx={px} cy={baseY + BEAM_THICK_PX / 2} r={2}
                  fill="white" stroke="#555" strokeWidth="1" />
              ))}

              {/* ── Punches on top (slope) beam ── */}
              {(() => {
                const dx = topExtX1 - topExtX0, dy = topExtY1 - topExtY0
                const beamLenPx = Math.sqrt(dx * dx + dy * dy)
                const ux = dx / beamLenPx, uy = dy / beamLenPx
                const pts = [
                  { x: topExtX0 + 2 * SC * ux, y: topExtY0 + 2 * SC * uy },
                  { x: diagTopX, y: beamY(diagTopX) },
                  { x: topExtX1 - 2 * SC * ux, y: topExtY1 - 2 * SC * uy },
                ]
                return pts.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={2}
                    fill="white" stroke="#555" strokeWidth="1" />
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
              <text x={legX1 - 32} y={topExtY1 + 22} fontSize="9" fill="#444" fontWeight="700">{angle}°</text>

              {/* ── Dimension annotations ── */}
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

              {/* ── Base beam punch sketch ── */}
              {(() => {
                const ry       = blockBotY + 130
                const barH     = 12
                const beamL    = x0 - OHx
                const beamR    = x1 + OHx
                const barW     = beamR - beamL
                const barCy    = ry + barH / 2
                const punches  = [beamL + 2 * SC, x0 + diagBasePct * bW, beamR - 2 * SC]
                const punchLabelsCm = [
                  2,
                  fmt(baseOverhangCm * Math.cos(angleRad) + diagBasePct * baseLength),
                  fmt(baseBeamLength - 2),
                ]
                const totalCm = fmt(baseBeamLength)
                return (
                  <g>
                    {/* label */}
                    <text x={beamL} y={ry - 5}
                      fontSize="8" fill="#888" fontWeight="600">Base beam — punch positions</text>
                    {/* profile bar */}
                    <rect x={beamL} y={ry} width={barW} height={barH}
                      fill="#d8d8d8" stroke="#999" strokeWidth="1" rx="2" />
                    {/* punch circles */}
                    {punches.map((px, i) => (
                      <circle key={i} cx={px} cy={barCy} r={2}
                        fill="white" stroke="#555" strokeWidth="1" />
                    ))}
                    {/* position labels */}
                    {punches.map((px, i) => (
                      <text key={i} x={px} y={ry + barH + 10}
                        textAnchor="middle" fontSize="8" fill="#555" fontWeight="600">
                        {punchLabelsCm[i]}
                      </text>
                    ))}
                    {/* total length dim */}
                    <Dim ax1={beamL} ay1={ry + barH + 22} ax2={beamR} ay2={ry + barH + 22}
                      label={totalCm} off={10} />
                  </g>
                )
              })()}

              {/* ── Slope beam punch sketch ── */}
              {(() => {
                const ry       = blockBotY + 52
                const barH     = 12
                const beamL    = x0 - OHx
                const beamR    = x1 + OHx
                const barW     = beamR - beamL
                const barCy    = ry + barH / 2
                const punches  = [
                  beamL + (2 / topBeamLength) * barW,
                  beamL + diagTopPct * barW,
                  beamL + ((topBeamLength - 2) / topBeamLength) * barW,
                ]
                const punchLabelsCm = [2, fmt(diagTopPct * topBeamLength), fmt(topBeamLength - 2)]
                return (
                  <g>
                    <text x={beamL} y={ry - 5}
                      fontSize="8" fill="#888" fontWeight="600">Slope beam — punch positions</text>
                    <rect x={beamL} y={ry} width={barW} height={barH}
                      fill="#d8d8d8" stroke="#999" strokeWidth="1" rx="2" />
                    {punches.map((px, i) => (
                      <circle key={i} cx={px} cy={barCy} r={2}
                        fill="white" stroke="#555" strokeWidth="1" />
                    ))}
                    {punches.map((px, i) => (
                      <text key={i} x={px} y={ry + barH + 10}
                        textAnchor="middle" fontSize="8" fill="#555" fontWeight="600">
                        {punchLabelsCm[i]}
                      </text>
                    ))}
                    <Dim ax1={beamL} ay1={ry + barH + 22} ax2={beamR} ay2={ry + barH + 22}
                      label={fmt(topBeamLength)} off={10} />
                  </g>
                )
              })()}

            </svg>

            {/* Members table */}
            <div style={{ marginTop: '1.5rem', maxWidth: '340px' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>Members per trapezoid</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ background: '#f5f5f5' }}>
                    <th style={{ textAlign: 'left', padding: '0.3rem 0.5rem', fontWeight: '700', color: '#555' }}>Element</th>
                    <th style={{ textAlign: 'right', padding: '0.3rem 0.5rem', fontWeight: '700', color: '#555' }}>Length (cm)</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Base beam',  baseBeamLength],
                    ['Top beam',   rc.topBeamLength],
                    ['Rear leg',   rc.heightRear],
                    ['Front leg',  rc.heightFront],
                    ['Diagonal',   diagLenCm],
                  ].map(([name, val]) => (
                    <tr key={name} style={{ borderTop: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '0.3rem 0.5rem', color: '#444' }}>{name}</td>
                      <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', fontWeight: '600', color: '#222' }}>{fmt(val)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

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
