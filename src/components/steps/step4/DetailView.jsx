import { DEFAULT_RAIL_OFFSET_CM } from '../../../utils/railLayoutService'
import { PANEL_WIDTH_CM } from '../../../utils/constructionCalculator'
import CanvasNavigator from '../../shared/CanvasNavigator'
import { useCanvasPanZoom } from '../../../hooks/useCanvasPanZoom'
import { PARAM_GROUP } from './constants'

export default function DetailView({ rc, panelLines = null, settings = {}, highlightParam = null }) {
  const {
    zoom, setZoom, panOffset, panActive,
    containerRef, contentRef,
    handleWheel, startPan, handleMouseMove, stopPan, resetView,
    MM_W, MM_H, panToMinimapPoint, getMinimapViewportRect,
  } = useCanvasPanZoom()

  const railOffsetCm  = settings.railOffsetCm  ?? DEFAULT_RAIL_OFFSET_CM
  const blockHeightCm = settings.blockHeightCm ?? 30
  const blockWidthCm  = settings.blockWidthCm  ?? 70
  const connOffsetCm  = settings.connOffsetCm  ?? 5
  const panelLengthCm = settings.panelLengthCm ?? 238.2
  const diagTopPct    = (settings.diagTopPct  ?? 25) / 100
  const diagBasePct   = (settings.diagBasePct ?? 90) / 100

  // Highlight helpers
  const hlGroup = PARAM_GROUP[highlightParam] ?? null
  const hl = (group) => hlGroup === group

  if (!rc) return <div style={{ padding: '2rem', color: '#aaa' }}>Select a row to see its trapezoid detail</div>

  const { heightRear, heightFront, baseLength, angle, topBeamLength } = rc

  const SC         = 2.2
  const RAIL_CM    = railOffsetCm
  const BLOCK_H_CM = blockHeightCm

  const angleRad = angle * Math.PI / 180
  const bW      = baseLength   * SC
  const hR      = heightRear   * SC
  const hF      = heightFront  * SC
  const railOffH = RAIL_CM * Math.cos(angleRad) * SC
  const railOffV = RAIL_CM * Math.sin(angleRad) * SC
  const blockH  = BLOCK_H_CM   * SC

  const segments = (panelLines && panelLines.length > 0)
    ? panelLines
    : [{ depthCm: panelLengthCm, gapBeforeCm: 0 }]
  const totalPanelDepthCm = segments.reduce((s, seg) => s + seg.gapBeforeCm + seg.depthCm, 0)

  const padL = Math.max(120, railOffH + 40)
  const panelExtCm = (totalPanelDepthCm - RAIL_CM) * Math.cos(angleRad) - baseLength
  const padR = Math.max(100, panelExtCm * SC + 70)
  const padT = 55
  const padB = blockH + 150

  const svgW = bW + padL + padR
  const svgH = hF + padT + padB

  const baseY     = hF + padT
  const topY0     = baseY - hR
  const topY1     = baseY - hF
  const blockBotY = baseY + blockH

  const x0 = padL
  const x1 = padL + bW

  const slope   = (topY1 - topY0) / bW
  const panelX1 = x0 - railOffH
  const panelY1 = topY0 + railOffV
  const atSlope = (dCm) => ({
    x: panelX1 + dCm * Math.cos(angleRad) * SC,
    y: panelY1 - dCm * Math.sin(angleRad) * SC,
  })
  const { x: panelX2, y: panelY2 } = atSlope(totalPanelDepthCm)

  const beamY = (x) => topY0 + slope * (x - x0)

  const beamOffX = connOffsetCm * SC * Math.cos(angleRad)
  const railXs = (() => {
    const xs = []
    let dCm = 0
    for (let si = 0; si < segments.length; si++) {
      const seg = segments[si]
      dCm += seg.gapBeforeCm
      const startX  = atSlope(dCm).x
      const endX    = atSlope(dCm + seg.depthCm).x
      const centerX = (startX + endX) / 2

      const leftEdge  = si === 0                    ? panelX1 : startX
      const rightEdge = si === segments.length - 1  ? panelX2 : endX

      let lcX = leftEdge  < x0 ? x0 + beamOffX : startX + beamOffX
      let rcX = rightEdge > x1 ? x1 - beamOffX : endX   - beamOffX

      const leftDist  = centerX - lcX
      const rightDist = rcX - centerX
      if (leftDist >= 0 && rightDist >= 0) {
        if (leftDist <= rightDist) {
          rcX = centerX + leftDist
        } else {
          lcX = centerX - rightDist
        }
      }

      xs.push(lcX)
      xs.push(rcX)
      dCm += seg.depthCm
    }
    return xs
  })()
  const rail1X = railXs[0] ?? x0
  const rail2X = railXs[railXs.length - 1] ?? x1

  const BEAM_THICK_PX = 4 * SC
  const PANEL_THICK_PX = 6
  const PANEL_OFFSET_PX = BEAM_THICK_PX / 2 + 10 + PANEL_THICK_PX / 2
  const panOffX = -Math.sin(angleRad) * PANEL_OFFSET_PX
  const panOffY = -Math.cos(angleRad) * PANEL_OFFSET_PX

  const blockW  = blockWidthCm * SC
  const lb_x = x0 - blockW / 2, lb_w = blockW
  const rb_x = x1 - blockW / 2, rb_w = blockW

  const DC = '#222'
  const TC = '#aaa'

  // Format to 1 decimal, stripping trailing ".0"
  const fmt = (v) => parseFloat(v.toFixed(1)).toString()

  const beamAngleDeg = Math.atan2(topY1 - topY0, x1 - x0) * 180 / Math.PI

  const diagTopX  = x0 + diagTopPct  * bW
  const diagBaseX = x0 + diagBasePct * bW
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
        onWheel={handleWheel}
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
              {rc.typeLetter}{rc.panelsPerSpan} — {angle}° · Panel Front {fmt(BLOCK_H_CM + heightRear - RAIL_CM * Math.sin(angleRad))} cm
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

              {/* ── Structure (40×40 mm profile → BEAM_THICK_PX stroke) ── */}
              <line x1={x0} y1={baseY} x2={x1} y2={baseY} stroke="#404040" strokeWidth={BEAM_THICK_PX} strokeLinecap="square" />
              {hR > 0 && <line x1={x0} y1={topY0} x2={x0} y2={baseY} stroke="#404040" strokeWidth={BEAM_THICK_PX} strokeLinecap="square" />}
              <line x1={x1} y1={topY1} x2={x1} y2={baseY} stroke="#404040" strokeWidth={BEAM_THICK_PX} strokeLinecap="square" />
              <line x1={x0} y1={topY0} x2={x1} y2={topY1} stroke="#404040" strokeWidth={BEAM_THICK_PX} strokeLinecap="square" />
              <line x1={diagTopX} y1={beamY(diagTopX)} x2={diagBaseX} y2={baseY}
                stroke="#606060" strokeWidth={BEAM_THICK_PX * 0.75} strokeLinecap="square" />
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

              {/* ── Cross-rails 40×40mm profile ── */}
              {railXs.map((cx, ci) => {
                const segIdx = Math.floor(ci / 2)
                const isEmptySeg = segments[segIdx]?.isEmpty
                const railFill   = '#7c3aed'
                const railStroke = isEmptySeg ? '#ddd' : '#642165'
                const cy = beamY(cx)
                const beamTop  = -BEAM_THICK_PX / 2
                const panBot   = -(PANEL_OFFSET_PX - PANEL_THICK_PX / 2)
                const RW = 4 * SC, RH = 4 * SC
                const midY = (beamTop + panBot) / 2
                const distCm = fmt((cx - x0) / (SC * Math.cos(angleRad)))
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
                    >{distCm}</text>
                  </g>
                )
              })}

              {/* ── Rail support profiles (vertical, beam → base) ── */}
              {railXs.slice(1, -1).map((cx, ci) => {
                const sx = cx - 4 * Math.cos(angleRad) * SC
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

              {/* ── Blocks ── */}
              <rect x={lb_x} y={baseY} width={lb_w} height={blockH} fill="#c0c0c0" stroke="#777" strokeWidth="1" />
              <rect x={rb_x} y={baseY} width={rb_w} height={blockH} fill="#c0c0c0" stroke="#777" strokeWidth="1" />
              {hl('blocks') && (
                <g style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }}>
                  <rect x={lb_x - 5} y={baseY - 5} width={lb_w + 10} height={blockH + 10}
                    fill="none" stroke="#FFB300" strokeWidth="2.5" rx="3" />
                  <rect x={rb_x - 5} y={baseY - 5} width={rb_w + 10} height={blockH + 10}
                    fill="none" stroke="#FFB300" strokeWidth="2.5" rx="3" />
                </g>
              )}

              {/* ── Green floor line ── */}
              <line x1={panelX1 - 10} y1={blockBotY} x2={panelX2 + 20} y2={blockBotY}
                stroke="#3a9e3a" strokeWidth="2.5" strokeLinecap="round" />

              {/* ── Angle label inside trapezoid ── */}
              <text x={x1 - 32} y={topY1 + 22} fontSize="9" fill="#444" fontWeight="700">{angle}°</text>

              {/* ── Dimension annotations ── */}
              <Dim ax1={x0} ay1={topY0} ax2={x1} ay2={topY1}
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

              {hR > 0 && <Dim ax1={x0} ay1={topY0} ax2={x0} ay2={baseY}
                label={fmt(heightRear)} off={55} />}

              <Dim ax1={panelX1 + panOffX} ay1={blockBotY}
                   ax2={panelX1 + panOffX} ay2={panelY1 + panOffY}
                label={fmt(BLOCK_H_CM + heightRear - RAIL_CM * Math.sin(angleRad))}
                off={-22} />

              <Dim ax1={lb_x} ay1={baseY} ax2={lb_x} ay2={blockBotY}
                label={fmt(BLOCK_H_CM)} off={-14} />

              <Dim ax1={x1} ay1={baseY} ax2={x1} ay2={topY1}
                label={fmt(heightFront)} off={38} />

              {(() => {
                const panelFrontHeight = BLOCK_H_CM + heightRear - RAIL_CM * Math.sin(angleRad)
                const panelBackHeight  = panelFrontHeight + totalPanelDepthCm * Math.sin(angleRad)
                return (
                  <Dim ax1={panelX2 + panOffX} ay1={blockBotY}
                       ax2={panelX2 + panOffX} ay2={panelY2 + panOffY}
                    label={fmt(panelBackHeight)} off={28} />
                )
              })()}

              {/* ── Base dimension ── */}
              <Dim ax1={x0} ay1={blockBotY + 18} ax2={x1} ay2={blockBotY + 18}
                label={fmt(baseLength)} off={14} />

              {/* ── TBD section ── */}
              {[0, 1].map(row => {
                const ry = blockBotY + 44 + row * 28
                return (
                  <g key={row}>
                    <rect x={x0 - railOffH} y={ry} width={bW + 2 * railOffH} height={22}
                      fill="#f6f6f6" stroke="#ccc" strokeWidth="1" strokeDasharray="4,3" rx="3" />
                    <text x={x0 - railOffH + (bW + 2 * railOffH) / 2} y={ry + 11}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize="9" fill="#bbb" fontWeight="700">TBD</text>
                  </g>
                )
              })}
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
                    ['Base beam',  rc.baseLength],
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
