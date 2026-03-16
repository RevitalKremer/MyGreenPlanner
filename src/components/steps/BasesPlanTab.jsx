import { useState, useMemo, useRef } from 'react'
import {
  computeRowBasePlan,
  DEFAULT_BASE_EDGE_OFFSET_MM, DEFAULT_BASE_SPACING_MM,
} from '../../utils/basePlanService'
import { localToScreen, DEFAULT_RAIL_OVERHANG_CM, DEFAULT_RAIL_OFFSET_CM } from '../../utils/railLayoutService'

const PANEL_FILL   = '#cfe3f5'


const BASE_COLOR   = '#000000'

function getPanelsBoundingBox(panels) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of panels) {
    const cx = p.x + p.width / 2, cy = p.y + p.height / 2
    const ar = (p.rotation || 0) * Math.PI / 180
    const hw = p.width / 2, hh = p.height / 2
    const cos = Math.cos(ar), sin = Math.sin(ar)
    const corners = [
      { x: cx - hw * cos + hh * sin, y: cy - hw * sin - hh * cos },
      { x: cx + hw * cos + hh * sin, y: cy + hw * sin - hh * cos },
      { x: cx + hw * cos - hh * sin, y: cy + hw * sin + hh * cos },
      { x: cx - hw * cos - hh * sin, y: cy - hw * sin + hh * cos },
    ]
    for (const c of corners) {
      minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x)
      minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y)
    }
  }
  return { minX, maxX, minY, maxY }
}

const fmt = n => n.toLocaleString('en-US')

// ─── Per-row base schedule table ─────────────────────────────────────────────
function BasesTable({ bp, rowIdx }) {
  const [expanded, setExpanded] = useState(false)
  if (!bp) return null
  const tdBase = { padding: '0.3rem 0.5rem' }
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ fontSize: '0.68rem', fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.4rem' }}>
        Row {rowIdx + 1}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
        <thead>
          <tr style={{ background: '#f5f5f5' }}>
            <th style={{ ...tdBase, width: '28px' }} />
            {['Frame Length (mm)', 'Bases', 'Edge Offset (mm)', 'Spacing (mm)', 'Last Gap (mm)'].map(h => (
              <th key={h} style={{ ...tdBase, textAlign: 'left', fontWeight: '700', color: '#555', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr
            onClick={() => setExpanded(e => !e)}
            style={{ borderTop: '1px solid #e0e0e0', background: '#f8fce8', cursor: 'pointer' }}
          >
            <td style={{ ...tdBase, textAlign: 'center', fontSize: '0.7rem', color: '#888' }}>
              {expanded ? '▾' : '▸'}
            </td>
            <td style={{ ...tdBase, fontWeight: '700', color: '#333' }}>{fmt(bp.frameLengthMm)}</td>
            <td style={{ ...tdBase, fontWeight: '700', color: '#222' }}>{bp.baseCount}</td>
            <td style={{ ...tdBase, color: '#555' }}>{fmt(bp.edgeOffsetMm)}</td>
            <td style={{ ...tdBase, color: '#555' }}>{fmt(bp.spacingMm)}</td>
            <td style={{ ...tdBase, fontWeight: '700', color: bp.lastGapMm > bp.spacingMm * 0.5 ? '#b45309' : '#666' }}>
              {fmt(bp.lastGapMm)}
            </td>
          </tr>
          {expanded && bp.bases.map((base, i) => (
            <tr key={i} style={{ borderTop: '1px solid #f0f0f0', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
              <td style={tdBase} />
              <td style={{ ...tdBase, fontWeight: '600', color: '#444' }}>B{i + 1}</td>
              <td style={{ ...tdBase, color: '#666' }} colSpan={4}>{fmt(base.offsetFromStartMm)} mm from left edge</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function BasesPlanTab({ panels = [], refinedArea, selectedRowIdx = null, rowConstructions = [], settings = {}, highlightGroup = null }) {
  const edgeOffsetMm   = settings.edgeOffsetMm   ?? DEFAULT_BASE_EDGE_OFFSET_MM
  const spacingMm      = settings.spacingMm      ?? DEFAULT_BASE_SPACING_MM
  const railOverhangCm = settings.railOverhangCm ?? DEFAULT_RAIL_OVERHANG_CM
  const railOffsetCm   = settings.railOffsetCm   ?? DEFAULT_RAIL_OFFSET_CM
  const connOffsetCm   = settings.connOffsetCm   ?? 5

  const [showBases,       setShowBases]       = useState(true)
  const [showBaseIDs,     setShowBaseIDs]     = useState(true)
  const [showConnectors,  setShowConnectors]  = useState(true)
  const [showDimensions,  setShowDimensions]  = useState(true)
  const [showDiagonals,   setShowDiagonals]   = useState(true)

  const [tableOpen, setTableOpen] = useState(true)
  const [panelCollapsed, setPanelCollapsed] = useState(false)

  const [zoom,      setZoom]      = useState(1)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [panActive, setPanActive] = useState(false)
  const panRef = useRef(null)

  const handleWheel = (e) => {
    e.preventDefault()
    setZoom(z => Math.max(0.3, Math.min(8, z + (e.deltaY > 0 ? -0.15 : 0.15))))
  }
  const startPan = (e) => {
    panRef.current = { startX: e.clientX, startY: e.clientY, startPanX: panOffset.x, startPanY: panOffset.y }
  }
  const handleMouseMove = (e) => {
    if (!panRef.current) return
    const dx = e.clientX - panRef.current.startX, dy = e.clientY - panRef.current.startY
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      setPanActive(true)
      setPanOffset({ x: panRef.current.startPanX + dx, y: panRef.current.startPanY + dy })
    }
  }
  const stopPan   = () => { panRef.current = null; setPanActive(false) }
  const resetView = () => { setZoom(1); setPanOffset({ x: 0, y: 0 }) }

  const pixelToCmRatio = refinedArea?.pixelToCmRatio ?? 1
  const railConfig = useMemo(() => ({ overhangCm: railOverhangCm }), [railOverhangCm])
  const baseConfig = useMemo(() => ({ edgeOffsetMm, spacingMm }), [edgeOffsetMm, spacingMm])

  const rowGroups = useMemo(() => {
    const map = {}
    for (const p of panels) {
      const key = p.row ?? 0
      if (!map[key]) map[key] = []
      map[key].push(p)
    }
    return map
  }, [panels])

  const rowKeys = useMemo(() =>
    Object.keys(rowGroups).map(Number).sort((a, b) => a - b),
    [rowGroups]
  )

  const basePlans = useMemo(() =>
    rowKeys.map(rowKey => computeRowBasePlan(rowGroups[rowKey], pixelToCmRatio, railConfig, baseConfig)),
    [rowKeys, rowGroups, pixelToCmRatio, railConfig, baseConfig]
  )

  const totalBases = basePlans.reduce((s, bp) => s + (bp?.baseCount ?? 0), 0)

  const bbox = useMemo(() => {
    if (panels.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 }
    return getPanelsBoundingBox(panels)
  }, [panels])

  if (rowKeys.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#aaa', fontSize: '0.95rem' }}>
        No panel rows found — complete Step 3 first.
      </div>
    )
  }

  const PAD = 24, MAX_W = 900
  const bboxW = bbox.maxX - bbox.minX, bboxH = bbox.maxY - bbox.minY
  const sc   = bboxW > 0 ? MAX_W / bboxW : 1
  const svgW = MAX_W + PAD * 2
  const svgH = bboxH * sc + PAD * 2

  const toSvg = (sx, sy) => [PAD + (sx - bbox.minX) * sc, PAD + (sy - bbox.minY) * sc]
  const svgCentX = PAD + (bboxW / 2) * sc
  const svgCentY = PAD + (bboxH / 2) * sc

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'white' }}>

      {/* Diagram canvas */}
      <div
        style={{ flex: '1 1 0', minHeight: 0, position: 'relative', overflow: 'hidden', background: '#fafafa', cursor: panActive ? 'grabbing' : 'grab' }}
        onWheel={handleWheel}
        onMouseDown={startPan}
        onMouseMove={handleMouseMove}
        onMouseUp={stopPan}
        onMouseLeave={stopPan}
      >
        <div style={{ transform: `translate(${panOffset.x}px, ${panOffset.y}px)`, transformOrigin: 'top left' }}>
          <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
            <div style={{ padding: '1.25rem 1.25rem 0' }}>
              <svg width={svgW} height={svgH} style={{ display: 'block' }}>
                <defs><style>{`@keyframes hlPulse { 0%,100%{opacity:0.15} 50%{opacity:0.9} }`}</style></defs>

                {/* Panels */}
                {panels.map(panel => {
                  const [sx, sy] = toSvg(panel.x, panel.y)
                  const sw = panel.width * sc, sh = panel.height * sc
                  const scx = sx + sw / 2, scy = sy + sh / 2
                  const rowKey = rowKeys.indexOf(panel.row ?? 0)
                  const isSelected = selectedRowIdx === null || rowKey === selectedRowIdx
                  const opacity = isSelected ? 1 : 0.25
                  const fill   = isSelected ? '#d1e3f3' : PANEL_FILL
                  const stroke = '#003f7f'
                  const strokeWidth = 4 / pixelToCmRatio * sc  // 4 cm physical border

                  const hatchLines = []
                  const step = 8
                  const inset = 2  // px gap from panel edges
                  for (let k = 0; k * step < sw + sh; k++) {
                    hatchLines.push(
                      <line key={k}
                        x1={Math.min(k * step, sw)} y1={Math.max(0, k * step - sw)}
                        x2={Math.max(0, k * step - sh)} y2={Math.min(k * step, sh)}
                        stroke="white" strokeWidth="0.5" opacity="0.7" />
                    )
                  }

                  return (
                    <g key={panel.id} opacity={opacity} transform={`rotate(${panel.rotation || 0} ${scx} ${scy})`}>
                      <rect x={sx} y={sy} width={sw} height={sh} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
                      <g transform={`translate(${sx}, ${sy})`}>
                        <clipPath id={`bcp-${panel.id}`}><rect x={inset} y={inset} width={sw - inset * 2} height={sh - inset * 2} /></clipPath>
                        <g clipPath={`url(#bcp-${panel.id})`}>{hatchLines}</g>
                      </g>
                    </g>
                  )
                })}

                {/* Frame outlines + bases + dimension annotations */}
                {basePlans.map((bp, i) => {
                  if (!bp) return null
                  const rowOpacity = (selectedRowIdx === null || i === selectedRowIdx) ? 1 : 0.2
                  const { frame, bases, lines } = bp
                  const { angleRad, localBounds, frameXMinPx, frameXMaxPx } = frame

                  // Frame corners in SVG space
                  const frameCorners = [
                    [frameXMinPx, localBounds.minY],
                    [frameXMaxPx, localBounds.minY],
                    [frameXMaxPx, localBounds.maxY],
                    [frameXMinPx, localBounds.maxY],
                  ].map(([lx, ly]) => toSvg(
                    localToScreen({ x: lx, y: ly }, frame.center, angleRad).x,
                    localToScreen({ x: lx, y: ly }, frame.center, angleRad).y,
                  ))
                  // Determine outward annotation direction (perpendicular to row axis)
                  const perpX = -Math.sin(angleRad), perpY = Math.cos(angleRad)
                  const fcx = frameCorners.reduce((s, [x]) => s + x, 0) / 4
                  const fcy = frameCorners.reduce((s, [, y]) => s + y, 0) / 4
                  const outSign = ((fcx - svgCentX) * perpX + (fcy - svgCentY) * perpY) >= 0 ? 1 : -1
                  const apX = outSign * perpX, apY = outSign * perpY

                  // Outer frame edge Y in local coords (the side facing away from scene center)
                  const outerLocalY = outSign >= 0 ? localBounds.maxY : localBounds.minY

                  // Annotation constants — divided by zoom so they stay at constant screen size
                  const ANN_OFF = 16 / zoom   // gap from row outer edge to dim line
                  const TICK    = 4  / zoom   // half-length of perpendicular CAD tick mark
                  const EXT_GAP = 2  / zoom   // gap between frame edge and extension line start
                  const EXT_OVR = 3  / zoom   // extension line overshoot past dim baseline

                  // Helper: SVG coords of a point at localX on the outer frame edge
                  const outerEdgeSvg = (localX) => {
                    const s = localToScreen({ x: localX, y: outerLocalY }, frame.center, angleRad)
                    return toSvg(s.x, s.y)
                  }
                  // Helper: annotation baseline point at same localX
                  const annBaseSvg = (localX) => {
                    const [ex, ey] = outerEdgeSvg(localX)
                    return [ex + apX * ANN_OFF, ey + apY * ANN_OFF]
                  }

                  // Annotation segments: only between consecutive trapezoid bases
                  const segAnnotations = bases.slice(0, -1).map((b1, si) => {
                    const p1 = b1, p2 = bases[si + 1]
                    const distMm = Math.round((p2.localX - p1.localX) * pixelToCmRatio * 10)
                    const [ax1, ay1] = annBaseSvg(p1.localX)
                    const [ax2, ay2] = annBaseSvg(p2.localX)
                    const [fe1x, fe1y] = outerEdgeSvg(p1.localX)
                    const [fe2x, fe2y] = outerEdgeSvg(p2.localX)

                    const dx = ax2 - ax1, dy = ay2 - ay1
                    const len = Math.sqrt(dx * dx + dy * dy)
                    if (len < 2) return null
                    const ux = dx / len, uy = dy / len
                    // Perpendicular unit vector (for ticks + extension lines)
                    const px = -uy, py = ux

                    const label = `${distMm}`
                    const fontSize = 11 / zoom   // constant screen size
                    const tx = (ax1 + ax2) / 2, ty = (ay1 + ay2) / 2
                    const angle = Math.atan2(dy, dx) * 180 / Math.PI
                    const labelAngle = angle > 90 || angle < -90 ? angle + 180 : angle
                    const bgW = label.length * fontSize * 0.6 + 6 / zoom
                    const bgH = fontSize + 4 / zoom

                    // Extension line: from frame edge (+ small gap) to dim baseline (+ overshoot)
                    const ex1s = [fe1x + apX * EXT_GAP, fe1y + apY * EXT_GAP]
                    const ex1e = [ax1  - apX * EXT_OVR, ay1  - apY * EXT_OVR]
                    const ex2s = [fe2x + apX * EXT_GAP, fe2y + apY * EXT_GAP]
                    const ex2e = [ax2  - apX * EXT_OVR, ay2  - apY * EXT_OVR]

                    return (
                      <g key={`ann-${si}`}>
                        {/* Extension lines */}
                        <line x1={ex1s[0]} y1={ex1s[1]} x2={ex1e[0]} y2={ex1e[1]} stroke="#000" strokeWidth="0.8" />
                        <line x1={ex2s[0]} y1={ex2s[1]} x2={ex2e[0]} y2={ex2e[1]} stroke="#000" strokeWidth="0.8" />
                        {/* Dimension line */}
                        <line x1={ax1} y1={ay1} x2={ax2} y2={ay2} stroke="#000" strokeWidth="1" />
                        {/* CAD tick marks: perpendicular to dim line at each endpoint */}
                        <line x1={ax1 - px * TICK} y1={ay1 - py * TICK} x2={ax1 + px * TICK} y2={ay1 + py * TICK} stroke="#000" strokeWidth="1.2" />
                        <line x1={ax2 - px * TICK} y1={ay2 - py * TICK} x2={ax2 + px * TICK} y2={ay2 + py * TICK} stroke="#000" strokeWidth="1.2" />
                        {/* Label: black text on white background */}
                        <g transform={`rotate(${labelAngle} ${tx} ${ty})`}>
                          <rect x={tx - bgW / 2} y={ty - bgH / 2} width={bgW} height={bgH} fill="white" stroke="#ccc" strokeWidth={0.5 / zoom} rx={1 / zoom} />
                          <text x={tx} y={ty} textAnchor="middle" dominantBaseline="middle" fontSize={fontSize} fontWeight="700" fill="#000">{label}</text>
                        </g>
                      </g>
                    )
                  })

                  // Per-row beam geometry (same for all bases in this row)
                  const rc           = rowConstructions[i]
                  const railOffPx    = railOffsetCm / pixelToCmRatio
                  const connOffPx    = connOffsetCm / pixelToCmRatio
                  const topBeamPx    = rc ? rc.topBeamLength / pixelToCmRatio : 0
                  const panelRearY   = lines && lines.length > 0 ? lines[0].minY : localBounds.minY
                  const rearLegY     = panelRearY + railOffPx
                  const frontLegY    = panelRearY + railOffPx + topBeamPx
                  // Profile thickness: 40×40 mm section → 4 cm, scaled to SVG px
                  const PROFILE_THICK = 4 / pixelToCmRatio * sc

                  // Connector local-Y positions — same for every base in this row
                  const connLocalYs = [];
                  (lines || []).forEach((ln, si) => {
                    const lineMinY    = ln.minY
                    const lineMaxY    = ln.maxY
                    const lineCenterY = (lineMinY + lineMaxY) / 2
                    const leftEdgeY   = si === 0              ? panelRearY                        : lineMinY
                    const rightEdgeY  = si === lines.length-1 ? lines[lines.length-1].maxY : lineMaxY

                    let lcY = leftEdgeY  < rearLegY  ? rearLegY  + connOffPx : lineMinY + connOffPx
                    let rcY = rightEdgeY > frontLegY ? frontLegY - connOffPx : lineMaxY - connOffPx

                    const leftDist  = lineCenterY - lcY
                    const rightDist = rcY - lineCenterY
                    if (leftDist >= 0 && rightDist >= 0) {
                      if (leftDist <= rightDist) rcY = lineCenterY + leftDist
                      else lcY = lineCenterY - rightDist
                    }

                    connLocalYs.push(lcY, rcY)
                  })

                  return (
                    <g key={`bp-${i}`} opacity={rowOpacity}>
                      {/* Base markers */}
                      {showBases && bases.map((base, bi) => {
                        // Brown bar = top beam: spans rearLegY → frontLegY in local Y
                        const beamTop    = localToScreen({ x: base.localX, y: rearLegY  }, frame.center, angleRad)
                        const beamBottom = localToScreen({ x: base.localX, y: frontLegY }, frame.center, angleRad)
                        const [btx, bty] = toSvg(beamTop.x,    beamTop.y)
                        const [bbx, bby] = toSvg(beamBottom.x, beamBottom.y)
                        // Rotation angle of the base line
                        const lineAngle = Math.atan2(bby - bty, bbx - btx) * 180 / Math.PI

                        // Determine if this base should be highlighted
                        const isEdgeBase = bi === 0 || bi === bases.length - 1
                        const hlThisBase = (highlightGroup === 'base-edges' && isEdgeBase)
                          || highlightGroup === 'trap-spacing'

                        return (
                          <g key={`base-${bi}`}>
                            {/* Highlight glow behind the bar */}
                            {hlThisBase && (
                              <line x1={btx} y1={bty} x2={bbx} y2={bby}
                                stroke="#FFB300" strokeWidth={PROFILE_THICK + 8} strokeLinecap="round"
                                style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />
                            )}
                            <line x1={btx} y1={bty} x2={bbx} y2={bby} stroke={BASE_COLOR} strokeWidth={PROFILE_THICK} strokeLinecap="round" />
                            {showBaseIDs && (() => {
                              // Midpoint of brown bar, tilted along bar direction
                              const bx = (btx + bbx) / 2
                              const by = (bty + bby) / 2
                              return (
                                <g transform={`rotate(${lineAngle} ${bx} ${by})`}>
                                  <text x={bx} y={by}
                                    textAnchor="middle" dominantBaseline="middle"
                                    fontSize={10 / zoom} fontWeight="700" fill="white"
                                    style={{ userSelect: 'none' }}
                                  >{rc?.typeLetter ?? '?'}{rc?.panelsPerSpan ?? ''}</text>
                                </g>
                              )
                            })()}
                            {showConnectors && connLocalYs.map((localY, ci) => {
                              const sp = localToScreen({ x: base.localX, y: localY }, frame.center, frame.angleRad)
                              const [cx, cy] = toSvg(sp.x, sp.y)
                              // Simple rectangle connector (top view), purple to match detail view
                              // Dimensions in physical cm → SVG px via (cm / pixelToCmRatio * sc)
                              const CW = 9   / pixelToCmRatio * sc  // 9 cm along slope (long edge)
                              const CH = 4.5 / pixelToCmRatio * sc  // 4.5 cm along row  (2:1 ratio)
                              return (
                                <g key={`conn-${ci}`}>
                                  <g transform={`translate(${cx},${cy}) rotate(${lineAngle})`}>
                                    <rect x={-CW/2} y={-CH/2} width={CW} height={CH}
                                      fill="#d1e3f3" stroke="#642165" strokeWidth="1" />
                                  </g>
                                </g>
                              )
                            })}
                          </g>
                        )
                      })}

                      {/* End diagonals: B1↔B2 and Bn↔B(n-1), using connector positions */}
                      {showDiagonals && showBases && bases.length >= 2 && connLocalYs.length >= 2 && (() => {
                        const n   = bases.length
                        const C1  = connLocalYs[0]
                        const C2  = connLocalYs[1] ?? C1
                        const Cm  = connLocalYs[connLocalYs.length - 1]
                        const Cm1 = connLocalYs[connLocalYs.length - 2] ?? Cm
                        // Two end pairs: [B1,B2] and [Bn,B(n-1)]; skip second if same as first
                        const pairs = n === 2
                          ? [[0, 1]]
                          : [[0, 1], [n - 1, n - 2]]
                        return pairs.flatMap(([ai, bi], pi) => {
                          const ba = bases[ai], bb = bases[bi]
                          return [[C1, C2], [Cm, Cm1]].map(([ya, yb], di) => {
                            const pa = localToScreen({ x: ba.localX, y: ya }, frame.center, angleRad)
                            const pb = localToScreen({ x: bb.localX, y: yb }, frame.center, angleRad)
                            const [x1, y1] = toSvg(pa.x, pa.y)
                            const [x2, y2] = toSvg(pb.x, pb.y)
                            const distMm = Math.round(
                              Math.sqrt((bb.localX - ba.localX) ** 2 + (yb - ya) ** 2) * pixelToCmRatio * 10
                            )
                            const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
                            const ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI
                            const labelAngle = ang > 90 || ang < -90 ? ang + 180 : ang
                            const fs = 11 / zoom
                            const bgW = String(distMm).length * fs * 0.6 + 6 / zoom
                            const bgH = fs + 4 / zoom
                            return (
                              <g key={`diag-${pi}-${di}`}>
                                <line x1={x1} y1={y1} x2={x2} y2={y2}
                                  stroke="cyan" strokeWidth={PROFILE_THICK} />
                                <g transform={`rotate(${labelAngle} ${mx} ${my})`}>
                                  <rect x={mx - bgW/2} y={my - bgH/2} width={bgW} height={bgH}
                                    fill="white" stroke="#ccc" strokeWidth={0.5/zoom} rx={1/zoom} />
                                  <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle"
                                    fontSize={fs} fontWeight="700" fill="#000">{distMm}</text>
                                </g>
                              </g>
                            )
                          })
                        })
                      })()}

                      {/* Spacing dimension annotations */}
                      {showDimensions && (
                        <g style={highlightGroup === 'base-spacing' ? { animation: 'hlPulse 0.75s ease-in-out infinite' } : {}}>
                          {segAnnotations}
                        </g>
                      )}
                    </g>
                  )
                })}

              </svg>
            </div>
          </div>
        </div>

        {/* ── Floating right panel ── */}
        <div style={{
          position: 'absolute', top: '16px', right: '16px', zIndex: 10,
          width: panelCollapsed ? '36px' : '190px',
          background: 'white', borderRadius: '10px',
          boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
          border: '1px solid #e0e0e0', overflow: 'hidden',
          transition: 'width 0.18s',
        }} onMouseDown={e => e.stopPropagation()}>
          <div onClick={() => setPanelCollapsed(c => !c)} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '0.5rem 0.65rem', cursor: 'pointer', background: '#fafafa',
            borderBottom: panelCollapsed ? 'none' : '1px solid #f0f0f0',
          }}>
            {!panelCollapsed && <span style={{ fontSize: '0.68rem', fontWeight: '700', color: '#555', whiteSpace: 'nowrap' }}>Display</span>}
            <span style={{ fontSize: '0.75rem', color: '#aaa', marginLeft: 'auto' }}>{panelCollapsed ? '◀' : '▶'}</span>
          </div>
          {!panelCollapsed && (
            <div style={{ padding: '0.6rem 0.75rem' }}>
              <div style={{ fontSize: '0.63rem', fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>Layers</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginBottom: '0.7rem' }}>
                {[['Bases', showBases, setShowBases], ['Base IDs', showBaseIDs, setShowBaseIDs], ['Connectors', showConnectors, setShowConnectors], ['Dimensions', showDimensions, setShowDimensions], ['Diagonals', showDiagonals, setShowDiagonals]].map(([label, checked, setter]) => (
                  <label key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.79rem', color: checked ? '#333' : '#aaa', fontWeight: '500' }}>
                    <input type="checkbox" checked={checked} onChange={e => setter(e.target.checked)} style={{ accentColor: '#2b6a99', cursor: 'pointer', width: '13px', height: '13px' }} />
                    {label}
                  </label>
                ))}
              </div>
              <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: '0.6rem', marginBottom: '0.3rem' }}>
                <div style={{ fontSize: '0.63rem', fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.35rem' }}>Zoom — {(zoom * 100).toFixed(0)}%</div>
                <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.2rem' }}>
                  {[['−', () => setZoom(z => Math.max(0.3, z - 0.1))], ['100%', resetView], ['+', () => setZoom(z => Math.min(8, z + 0.1))]].map(([lbl, fn]) => (
                    <button key={lbl} onClick={fn} style={{ flex: 1, padding: '0.3rem 0', background: 'white', color: '#666', border: '1px solid #ddd', borderRadius: '5px', cursor: 'pointer', fontWeight: '600', fontSize: '0.72rem' }}>{lbl}</button>
                  ))}
                </div>
                <div style={{ fontSize: '0.63rem', color: '#ccc' }}>Scroll to zoom</div>
              </div>
              <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: '0.5rem', marginTop: '0.5rem', fontSize: '0.73rem', color: '#888' }}>
                {totalBases} bases total
              </div>
            </div>
          )}
        </div>

      </div>

      {/* Base Schedule table — collapsible */}
      <div style={{ flexShrink: 0, borderTop: '1px solid #e8e8e8' }}>
        <button
          onClick={() => setTableOpen(o => !o)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: '0.4rem',
            padding: '0.45rem 1.25rem', background: '#f8f9fa', border: 'none',
            cursor: 'pointer', fontSize: '0.72rem', fontWeight: '700',
            color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em',
          }}
        >
          <span style={{ fontSize: '0.6rem' }}>{tableOpen ? '▾' : '▸'}</span>
          Base Schedule
        </button>
        {tableOpen && (
          <div style={{ overflowY: 'auto', maxHeight: '260px', padding: '0.5rem 1.25rem 1rem' }}>
            {rowKeys.map((rowKey, i) => (
              <BasesTable key={rowKey} bp={basePlans[i]} rowIdx={i} />
            ))}
          </div>
        )}
      </div>

    </div>
  )
}
