import { useState, useMemo, useRef } from 'react'
import {
  computeRowRailLayout,
  DEFAULT_RAIL_OFFSET_CM,
  DEFAULT_RAIL_OVERHANG_CM,
  DEFAULT_STOCK_LENGTHS_MM
} from '../../utils/railLayoutService'

const PANEL_FILL = '#cfe3f5'
const PANEL_STROKE = '#3a6ea5'
const HATCH_COLOR = '#9bbcd4'
const RAIL_COLOR_FILL = '#3f79a5'

// ─── Compute bounding box of all panels in screen space (accounting for rotation)
function getPanelsBoundingBox(panels) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of panels) {
    const cx = p.x + p.width / 2
    const cy = p.y + p.height / 2
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

// Compress repeated segments: [6000,6000,6000,2356] → "3×6000mm + 2356mm"
function formatStockPieces(segments) {
  const groups = []
  for (const mm of segments) {
    const last = groups[groups.length - 1]
    if (last && last.mm === mm) last.count++
    else groups.push({ mm, count: 1 })
  }
  return groups.map(g => g.count > 1 ? `${g.count}×${fmt(g.mm)}mm` : `${fmt(g.mm)}mm`).join(' + ')
}

// ─── Rail summary table (per row, expandable) ────────────────────────────────
function RailsTable({ rails, rowIdx }) {
  const [expanded, setExpanded] = useState(false)
  if (!rails || rails.length === 0) return null

  const totalLengthMm = rails.reduce((s, r) => s + r.lengthMm, 0)
  const totalPieces   = rails.reduce((s, r) => s + r.stockSegments.length, 0)
  const totalLeftover = rails.reduce((s, r) => s + r.leftoverMm, 0)

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
            {['Rail', 'Line', 'Type', 'Length (mm)', 'Stock pieces', 'Leftover (mm)'].map(h => (
              <th key={h} style={{ ...tdBase, textAlign: 'left', fontWeight: '700', color: '#555', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Total / summary row */}
          <tr
            onClick={() => setExpanded(e => !e)}
            style={{ borderTop: '1px solid #e0e0e0', background: '#f8fce8', cursor: 'pointer' }}
          >
            <td style={{ ...tdBase, textAlign: 'center', fontSize: '0.7rem', color: '#888' }}>
              {expanded ? '▾' : '▸'}
            </td>
            <td style={{ ...tdBase, fontWeight: '700', color: '#333' }}>Total</td>
            <td style={{ ...tdBase, color: '#555' }}>—</td>
            <td style={{ ...tdBase, color: '#555' }}>—</td>
            <td style={{ ...tdBase, fontWeight: '700', color: '#222' }}>{fmt(totalLengthMm)}</td>
            <td style={{ ...tdBase, fontWeight: '700', color: '#333' }}>{totalPieces} pcs</td>
            <td style={{ ...tdBase, fontWeight: '700', color: totalLeftover > 0 ? '#b45309' : '#666' }}>{fmt(totalLeftover)}</td>
          </tr>

          {/* Detail rows — shown when expanded */}
          {expanded && rails.map((rail, i) => (
            <tr key={rail.railId} style={{ borderTop: '1px solid #f0f0f0', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
              <td style={tdBase} />
              <td style={{ ...tdBase, fontWeight: '600', color: '#444' }}>{rail.railId}</td>
              <td style={{ ...tdBase, color: '#666' }}>L{rail.lineIdx + 1}</td>
              <td style={{ ...tdBase, color: '#666' }}>{rail.orientation}</td>
              <td style={{ ...tdBase, color: '#333' }}>{fmt(rail.lengthMm)}</td>
              <td style={{ ...tdBase, color: '#333' }}>{formatStockPieces(rail.stockSegments)}</td>
              <td style={{ ...tdBase, color: rail.leftoverMm > 0 ? '#b45309' : '#aaa' }}>{fmt(rail.leftoverMm)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function RailLayoutTab({ panels = [], refinedArea, selectedRowIdx = null }) {
  const [railOffsetCm, setRailOffsetCm] = useState(DEFAULT_RAIL_OFFSET_CM)
  const [railOverhangCm, setRailOverhangCm] = useState(DEFAULT_RAIL_OVERHANG_CM)
  const [stockInput, setStockInput] = useState(DEFAULT_STOCK_LENGTHS_MM.join(', '))

  // Layer visibility
  const [showRails, setShowRails] = useState(true)
  const [showDimensions, setShowDimensions] = useState(true)

  // Table collapse
  const [tableOpen, setTableOpen] = useState(true)
  const [panelCollapsed, setPanelCollapsed] = useState(false)

  const stockLengths = useMemo(() =>
    stockInput.split(',').map(s => parseInt(s.trim(), 10)).filter(n => n > 0),
    [stockInput]
  )

  const pixelToCmRatio = refinedArea?.pixelToCmRatio ?? 1

  const railConfig = useMemo(() => ({
    offsetFromPanelEdge: railOffsetCm,
    overhangCm: railOverhangCm,
    stockLengths,
  }), [railOffsetCm, railOverhangCm, stockLengths])

  // Zoom / pan state
  const [zoom, setZoom] = useState(1)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [panActive, setPanActive] = useState(false)
  const panRef = useRef(null)

  const handleWheel = (e) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.15 : 0.15
    setZoom(z => Math.max(0.3, Math.min(8, z + delta)))
  }

  const startPan = (e) => {
    panRef.current = { startX: e.clientX, startY: e.clientY, startPanX: panOffset.x, startPanY: panOffset.y }
  }

  const handleMouseMove = (e) => {
    if (!panRef.current) return
    const dx = e.clientX - panRef.current.startX
    const dy = e.clientY - panRef.current.startY
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      setPanActive(true)
      setPanOffset({ x: panRef.current.startPanX + dx, y: panRef.current.startPanY + dy })
    }
  }

  const stopPan = () => { panRef.current = null; setPanActive(false) }

  const resetView = () => { setZoom(1); setPanOffset({ x: 0, y: 0 }) }

  // Group panels by row
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

  const railLayouts = useMemo(() =>
    rowKeys.map(rowKey => computeRowRailLayout(rowGroups[rowKey], pixelToCmRatio, railConfig)),
    [rowKeys, rowGroups, pixelToCmRatio, railConfig]
  )

  // Totals
  const totalRails = railLayouts.reduce((s, rl) => s + (rl?.rails.length ?? 0), 0)
  const totalLeftover = railLayouts.reduce((s, rl) =>
    s + (rl?.rails.reduce((rs, r) => rs + r.leftoverMm, 0) ?? 0), 0)

  // Screen-space bounding box of all panels
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

  // SVG canvas setup
  const PAD = 24
  const MAX_W = 900
  const bboxW = bbox.maxX - bbox.minX
  const bboxH = bbox.maxY - bbox.minY
  const sc = bboxW > 0 ? MAX_W / bboxW : 1
  const svgW = MAX_W + PAD * 2
  const svgH = bboxH * sc + PAD * 2

  // Convert a screen-space point to SVG canvas coords
  const toSvg = (sx, sy) => [
    PAD + (sx - bbox.minX) * sc,
    PAD + (sy - bbox.minY) * sc,
  ]

  // SVG centroid of all panels — used to determine "outward" annotation direction per rail
  const svgCentX = PAD + (bboxW / 2) * sc
  const svgCentY = PAD + (bboxH / 2) * sc

  const sectionLabel = (text) => (
    <div style={{ fontSize: '0.68rem', fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.45rem' }}>
      {text}
    </div>
  )

  const fieldRow = (label, input) => (
    <div style={{ marginBottom: '0.6rem' }}>
      <div style={{ fontSize: '0.7rem', fontWeight: '600', color: '#666', marginBottom: '0.25rem' }}>{label}</div>
      {input}
    </div>
  )

  const inputStyle = { width: '100%', padding: '0.3rem 0.5rem', border: '1px solid #ddd', borderRadius: '6px', fontSize: '0.8rem', boxSizing: 'border-box' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'white' }}>

      {/* Diagram canvas */}
      <div
        style={{
          flex: '1 1 0', minHeight: 0, position: 'relative',
          overflow: 'hidden', background: '#fafafa',
          cursor: panActive ? 'grabbing' : 'grab',
        }}
        onWheel={handleWheel}
        onMouseDown={startPan}
        onMouseMove={handleMouseMove}
        onMouseUp={stopPan}
        onMouseLeave={stopPan}
      >
        {/* Panned + zoomed content */}
        <div style={{ transform: `translate(${panOffset.x}px, ${panOffset.y}px)`, transformOrigin: 'top left' }}>
          <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
        <div style={{ padding: '1.25rem 1.25rem 0' }}>
          <svg width={svgW} height={svgH} style={{ display: 'block' }}>

            {/* Panels — drawn as rotated rectangles, selected row highlighted */}
            {panels.map(panel => {
              const [sx, sy] = toSvg(panel.x, panel.y)
              const sw = panel.width * sc
              const sh = panel.height * sc
              const scx = sx + sw / 2
              const scy = sy + sh / 2

              const rowKey = rowKeys.indexOf(panel.row ?? 0)
              const isSelected = selectedRowIdx === null || rowKey === selectedRowIdx
              const opacity = isSelected ? 1 : 0.25
              const fill   = isSelected ? 'rgba(100, 180, 255, 0.75)' : PANEL_FILL
              const stroke = isSelected ? '#0066CC' : PANEL_STROKE
              const strokeWidth = isSelected ? '1.5' : '0.8'

              // Hatch lines clipped to panel rect
              const hatchLines = []
              const step = 8
              for (let k = 0; k * step < sw + sh; k++) {
                hatchLines.push(
                  <line key={k}
                    x1={Math.min(k * step, sw)} y1={Math.max(0, k * step - sw)}
                    x2={Math.max(0, k * step - sh)} y2={Math.min(k * step, sh)}
                    stroke={HATCH_COLOR} strokeWidth="0.6" />
                )
              }

              return (
                <g key={panel.id} opacity={opacity} transform={`rotate(${panel.rotation || 0} ${scx} ${scy})`}>
                  <rect x={sx} y={sy} width={sw} height={sh}
                    fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
                  <g transform={`translate(${sx}, ${sy})`}>
                    <clipPath id={`cp-${panel.id}`}>
                      <rect x={0} y={0} width={sw} height={sh} />
                    </clipPath>
                    <g clipPath={`url(#cp-${panel.id})`}>{hatchLines}</g>
                  </g>
                </g>
              )
            })}

            {/* Rails + CAD dimension annotations */}
            {railLayouts.map((rl, i) => {
              if (!rl) return null
              const railOpacity = (selectedRowIdx === null || i === selectedRowIdx) ? 1 : 0.2

              // Only annotate the first rail per lineIdx (all rails in a line share the same length)
              const annotatedLines = new Set()
              const annotatedRailIds = new Set()
              for (const rail of rl.rails) {
                if (!annotatedLines.has(rail.lineIdx)) {
                  annotatedLines.add(rail.lineIdx)
                  annotatedRailIds.add(rail.railId)
                }
              }

              return rl.rails.map(rail => {
                const [x1, y1] = toSvg(rail.screenStart.x, rail.screenStart.y)
                const [x2, y2] = toSvg(rail.screenEnd.x, rail.screenEnd.y)
                const dx = x2 - x1, dy = y2 - y1
                const len = Math.sqrt(dx * dx + dy * dy)
                if (len < 2) return null

                const ux = dx / len, uy = dy / len          // unit along rail
                const perpUX = -dy / len, perpUY = dx / len  // unit perpendicular

                // Determine outward direction (away from panel group centroid)
                const railMidX = (x1 + x2) / 2, railMidY = (y1 + y2) / 2
                const outDot = (railMidX - svgCentX) * perpUX + (railMidY - svgCentY) * perpUY
                const outSign = outDot >= 0 ? 1 : -1
                const apX = outSign * perpUX, apY = outSign * perpUY  // annotation perp unit

                const angle = Math.atan2(dy, dx) * 180 / Math.PI
                const labelAngle = angle > 90 || angle < -90 ? angle + 180 : angle

                // Dimension line sits 2px beyond the panel outer edge (= railOffset away from rail)
                const railOffsetSvg = (railOffsetCm / pixelToCmRatio) * sc
                const DIM_GAP = 2
                const EXT = railOffsetSvg + DIM_GAP  // total offset from rail to dim line
                const TICK = 3   // half-length of end tick marks

                // Panel outer edge positions (start of extension lines)
                const pe1x = x1 + apX * railOffsetSvg, pe1y = y1 + apY * railOffsetSvg
                const pe2x = x2 + apX * railOffsetSvg, pe2y = y2 + apY * railOffsetSvg

                // Dimension line endpoints
                const ann1x = x1 + apX * EXT, ann1y = y1 + apY * EXT
                const ann2x = x2 + apX * EXT, ann2y = y2 + apY * EXT

                // Per-segment labels and internal boundary ticks
                let cumMm = 0
                const segAnnotations = rail.stockSegments.map((segMm, si) => {
                  const startFrac = cumMm / rail.lengthMm
                  cumMm += segMm
                  const endFrac = Math.min(cumMm / rail.lengthMm, 1)
                  const midFrac = (startFrac + endFrac) / 2

                  // Text sits ON the dimension line with a white background knockout
                  const tx = x1 + dx * midFrac + apX * EXT
                  const ty = y1 + dy * midFrac + apY * EXT
                  const label = String(segMm)
                  // Font size capped by segment length in SVG px (each char ~0.6× fontSize wide)
                  const segLenSvg = (endFrac - startFrac) * len
                  const maxFontSize = segLenSvg / (label.length * 0.62)
                  const fontSize = Math.min(5.5, maxFontSize)
                  const bgW = label.length * fontSize * 0.62 + 4
                  const bgH = fontSize + 3

                  // Internal boundary: extension line from panel edge + tick at dim line
                  const boundary = endFrac < 0.999 ? (
                    <g key={`ib-${si}`}>
                      <line
                        x1={x1 + dx * endFrac + apX * railOffsetSvg} y1={y1 + dy * endFrac + apY * railOffsetSvg}
                        x2={x1 + dx * endFrac + apX * (EXT + 2)} y2={y1 + dy * endFrac + apY * (EXT + 2)}
                        stroke="#000" strokeWidth="1" />
                      <line
                        x1={x1 + dx * endFrac + apX * EXT - ux * TICK} y1={y1 + dy * endFrac + apY * EXT - uy * TICK}
                        x2={x1 + dx * endFrac + apX * EXT + ux * TICK} y2={y1 + dy * endFrac + apY * EXT + uy * TICK}
                        stroke="#000" strokeWidth="1" />
                    </g>
                  ) : null

                  return (
                    <g key={`seg-${si}`}>
                      {boundary}
                      <g transform={`rotate(${labelAngle} ${tx} ${ty})`}>
                        <rect x={tx - bgW / 2} y={ty - bgH / 2} width={bgW} height={bgH} fill="white" />
                        <text x={tx} y={ty}
                          textAnchor="middle" dominantBaseline="middle"
                          fontSize={fontSize} fontWeight="600" fill="#000"
                        >{label}</text>
                      </g>
                    </g>
                  )
                })

                const showAnnotation = annotatedRailIds.has(rail.railId)

                return (
                  <g key={`${i}-${rail.railId}`} opacity={railOpacity}>
                    {/* Rail line: 3px border (#105689) + 1px fill (#3f79a5) center */}
                    {showRails && (
                      <line x1={x1} y1={y1} x2={x2} y2={y2}
                        stroke={RAIL_COLOR_FILL} strokeWidth="1" strokeLinecap="round" />
                    )}

                    {/* CAD annotation — one per line only */}
                    {showAnnotation && showDimensions && <>
                      {/* Extension lines: from panel outer edge outward past dim line */}
                      <line x1={pe1x} y1={pe1y} x2={x1 + apX * (EXT + 2)} y2={y1 + apY * (EXT + 2)}
                        stroke="#000" strokeWidth="1" />
                      <line x1={pe2x} y1={pe2y} x2={x2 + apX * (EXT + 2)} y2={y2 + apY * (EXT + 2)}
                        stroke="#000" strokeWidth="1" />

                      {/* Dimension line */}
                      <line x1={ann1x} y1={ann1y} x2={ann2x} y2={ann2y}
                        stroke="#000" strokeWidth="1" />

                      {/* End tick marks */}
                      <line x1={ann1x - ux * TICK} y1={ann1y - uy * TICK} x2={ann1x + ux * TICK} y2={ann1y + uy * TICK}
                        stroke="#000" strokeWidth="1" />
                      <line x1={ann2x - ux * TICK} y1={ann2y - uy * TICK} x2={ann2x + ux * TICK} y2={ann2y + uy * TICK}
                        stroke="#000" strokeWidth="1" />

                      {/* Segment labels + internal ticks */}
                      {segAnnotations}
                    </>}
                  </g>
                )
              })
            })}

          </svg>
          </div>
        </div>
        </div>

        {/* ── Floating right panel ─────────────────────────────────────── */}
        <div style={{
          position: 'absolute', top: '16px', right: '16px',
          width: panelCollapsed ? '32px' : '210px', minHeight: '36px', overflow: 'hidden',
          maxHeight: panelCollapsed ? 'none' : 'calc(100vh - 100px)', overflowY: panelCollapsed ? 'hidden' : 'auto',
          padding: '1rem',
          background: 'white', borderRadius: '12px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          border: '2px solid #C4D600',
          pointerEvents: 'all',
        }} onMouseDown={e => e.stopPropagation()}>
          <button onClick={() => setPanelCollapsed(c => !c)} style={{ position: 'absolute', top: '6px', right: '6px', width: '22px', height: '22px', padding: 0, background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {panelCollapsed ? '‹' : '›'}
          </button>
          {!panelCollapsed && <>

          {/* Rail settings */}
          {sectionLabel('Rail Settings')}
          {fieldRow('Clamp Offset (cm)',
            <input type="number" value={railOffsetCm} step="0.1"
              onChange={e => setRailOffsetCm(parseFloat(e.target.value) || DEFAULT_RAIL_OFFSET_CM)}
              style={inputStyle} />
          )}
          {fieldRow('Rail Overhang (cm)',
            <input type="number" value={railOverhangCm} step="0.5" min="0"
              onChange={e => setRailOverhangCm(parseFloat(e.target.value) || 0)}
              style={inputStyle} />
          )}
          {fieldRow('Stock Lengths (mm)',
            <input type="text" value={stockInput}
              onChange={e => setStockInput(e.target.value)}
              placeholder="e.g. 4800, 6000"
              style={inputStyle} />
          )}

          <div style={{ borderTop: '1px solid #f0f0f0', margin: '0.75rem 0' }} />

          {/* Layers */}
          {sectionLabel('Layers')}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '0.85rem' }}>
            {[
              ['Rails', showRails, setShowRails],
              ['Dimensions', showDimensions, setShowDimensions],
            ].map(([label, checked, setter]) => (
              <label key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer', fontSize: '0.8rem', color: checked ? '#333' : '#aaa', fontWeight: '500' }}>
                <input type="checkbox" checked={checked} onChange={e => setter(e.target.checked)}
                  style={{ accentColor: '#2b6a99', cursor: 'pointer', width: '13px', height: '13px' }} />
                {label}
              </label>
            ))}
          </div>

          <div style={{ borderTop: '1px solid #f0f0f0', margin: '0.75rem 0' }} />

          {/* Zoom */}
          <div style={{ fontSize: '0.7rem', color: '#aaa', fontWeight: '600', marginBottom: '0.35rem' }}>
            🔍 Zoom: {(zoom * 100).toFixed(0)}%
          </div>
          <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.25rem' }}>
            {[
              ['−', () => setZoom(z => Math.max(0.3, z - 0.1)), '0.9rem'],
              ['100%', resetView, '0.7rem'],
              ['+', () => setZoom(z => Math.min(8, z + 0.1)), '0.9rem'],
            ].map(([label, fn, fs]) => (
              <button key={label} onClick={fn} style={{
                flex: 1, padding: '0.4rem',
                background: 'white', color: '#666',
                border: '1px solid #ddd', borderRadius: '6px',
                cursor: 'pointer', fontWeight: '600', fontSize: fs
              }}>{label}</button>
            ))}
          </div>
          <div style={{ fontSize: '0.68rem', color: '#ccc' }}>Mouse wheel to zoom</div>

          <div style={{ borderTop: '1px solid #f0f0f0', margin: '0.75rem 0' }} />

          {/* Summary */}
          <div style={{ fontSize: '0.75rem', color: '#888' }}>
            {totalRails} rails
          </div>
          {totalLeftover > 0 && (
            <div style={{ fontSize: '0.75rem', color: '#b45309', marginTop: '0.2rem' }}>
              {fmt(totalLeftover)} mm leftover
            </div>
          )}
          </>}
        </div>

      </div>

      {/* Summary tables — collapsible */}
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
          Rail Schedule
        </button>
        {tableOpen && (
          <div style={{ overflowY: 'auto', maxHeight: '260px', padding: '0.5rem 1.25rem 1rem' }}>
            {rowKeys.map((rowKey, i) => {
              const rl = railLayouts[i]
              if (!rl) return null
              return <RailsTable key={rowKey} rails={rl.rails} rowIdx={i} />
            })}
          </div>
        )}
      </div>

    </div>
  )
}
