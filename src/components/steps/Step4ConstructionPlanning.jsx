import { useState, useMemo } from 'react'
import {
  computeRowConstruction,
  assignTypes,
  buildBOM,
  PANEL_WIDTH_CM,
  PANEL_GAP_CM,
  PANEL_LENGTH_CM
} from '../../utils/constructionCalculator'
import RailLayoutTab from './RailLayoutTab'

const ACCENT = '#C4D600'

// ─── SVG helpers ────────────────────────────────────────────────────────────

/** Draw a dimension arrow between two points with a label */
function DimArrow({ x1, y1, x2, y2, label, offset = 14, textOffset = 7, fontSize = 9 }) {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 2) return null
  const nx = -dy / len * offset, ny = dx / len * offset
  const lx1 = x1 + nx, ly1 = y1 + ny
  const lx2 = x2 + nx, ly2 = y2 + ny
  const lmx = mx + nx + (-dy / len) * textOffset
  const lmy = my + ny + (dx / len) * textOffset
  const angle = Math.atan2(dy, dx) * 180 / Math.PI

  return (
    <g>
      <line x1={lx1} y1={ly1} x2={lx2} y2={ly2} stroke="#17a9cf" strokeWidth="1" markerEnd="url(#arr)" markerStart="url(#arr)" />
      <line x1={x1} y1={y1} x2={lx1} y2={ly1} stroke="#17a9cf" strokeWidth="0.5" strokeDasharray="3,2" />
      <line x1={x2} y1={y2} x2={lx2} y2={ly2} stroke="#17a9cf" strokeWidth="0.5" strokeDasharray="3,2" />
      <text x={lmx} y={lmy} fontSize={fontSize} fill="#17a9cf" fontWeight="700" fontStyle="italic"
        textAnchor="middle" dominantBaseline="middle"
        transform={`rotate(${angle > 90 || angle < -90 ? angle + 180 : angle}, ${lmx}, ${lmy})`}
      >{label}</text>
    </g>
  )
}

function ArrowDefs() {
  return (
    <defs>
      <marker id="arr" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
        <path d="M0,0 L0,6 L6,3 z" fill="#17a9cf" />
      </marker>
    </defs>
  )
}

// ─── Trapezoid profile SVG (elevation side view) ────────────────────────────

function TrapProfile({ rc, sc = 1.2, showLabel = true, selected = false }) {
  const { heightRear, heightFront, baseLength, typeLetter, panelsPerSpan, diagonalLength } = rc
  const padL = 8, padR = 8, padT = 12, padB = 10
  const bW = baseLength * sc
  const hR = heightRear * sc
  const hF = heightFront * sc
  const W = bW + padL + padR
  const svgH = hF + padT + padB

  // Points (SVG y-down, so base is at svgH - padB)
  const baseY = svgH - padB
  const x0 = padL, x1 = padL + bW
  const topY0 = baseY - hR   // top of rear leg (short)
  const topY1 = baseY - hF   // top of front leg (tall)

  return (
    <svg width={W} height={svgH} style={{ display: 'block', overflow: 'visible' }}>
      {/* Frame */}
      <line x1={x0} y1={baseY} x2={x1} y2={baseY} stroke={selected ? ACCENT : '#333'} strokeWidth="2.5" />
      <line x1={x0} y1={topY0} x2={x0} y2={baseY} stroke={selected ? ACCENT : '#333'} strokeWidth="2.5" />
      <line x1={x1} y1={topY1} x2={x1} y2={baseY} stroke={selected ? ACCENT : '#333'} strokeWidth="2.5" />
      <line x1={x0} y1={topY0} x2={x1} y2={topY1} stroke={selected ? ACCENT : '#333'} strokeWidth="2" />
      {/* Diagonal brace */}
      <line x1={x0} y1={topY0} x2={x1} y2={baseY} stroke="#666" strokeWidth="1.5" strokeDasharray="none" />
      {/* Diagonal length label */}
      {showLabel && (
        <text x={(x0 + x1) / 2 - 6} y={(topY0 + baseY) / 2 - 4}
          fontSize="7" fill="#444" fontStyle="italic" fontWeight="600"
          transform={`rotate(${Math.atan2(baseY - topY0, x1 - x0) * 180 / Math.PI}, ${(x0+x1)/2}, ${(topY0+baseY)/2})`}
          textAnchor="middle"
        >{(diagonalLength / 100).toFixed(1)}</text>
      )}
      {/* Rear leg height */}
      {showLabel && hR > 0 && (
        <text x={x0 - 4} y={(topY0 + baseY) / 2} fontSize="7" fill="#333" textAnchor="end" dominantBaseline="middle" fontStyle="italic">{(heightRear / 100).toFixed(1)}</text>
      )}
      {/* Front leg height */}
      {showLabel && (
        <text x={x1 + 4} y={(topY1 + baseY) / 2} fontSize="7" fill="#333" textAnchor="start" dominantBaseline="middle" fontStyle="italic">{(heightFront / 100).toFixed(1)}</text>
      )}
      {/* Type label */}
      {showLabel && typeLetter && (
        <text x={(x0 + x1) / 2} y={topY1 + (topY0 - topY1) / 2 + (hF - hR) * sc / 4 + 4}
          fontSize="9" fill={selected ? ACCENT : '#555'} fontWeight="800" textAnchor="middle"
        >{typeLetter}{panelsPerSpan}</text>
      )}
    </svg>
  )
}

// ─── Layout view ─────────────────────────────────────────────────────────────

function LayoutView({ rowConstructions, selectedIdx, onSelectRow }) {
  return (
    <div style={{ padding: '1.5rem', overflowY: 'auto' }}>
      {rowConstructions.map((rc, i) => {
        const sc = 1.2
        const profileW = rc.baseLength * sc + 16
        const spacing_mm = Math.round(rc.spacing * 10)
        const totalW = rc.numTrapezoids * profileW + (rc.numTrapezoids - 1) * 20 + 60

        return (
          <div key={i}
            onClick={() => onSelectRow(i)}
            style={{
              marginBottom: '1.5rem', cursor: 'pointer',
              border: `2px solid ${selectedIdx === i ? ACCENT : '#eee'}`,
              borderRadius: '10px', padding: '0.75rem 1rem',
              background: selectedIdx === i ? '#f8fce8' : 'white',
              transition: 'all 0.15s'
            }}
          >
            <div style={{ fontSize: '0.75rem', fontWeight: '700', color: '#888', marginBottom: '0.5rem' }}>
              Row {i + 1} · {rc.panelCount} panels · {rc.angle}° · {rc.typeLetter}{rc.panelsPerSpan} type
            </div>
            <div style={{ overflowX: 'auto' }}>
              <svg width={totalW} height={140} style={{ display: 'block' }}>
                <ArrowDefs />
                {Array.from({ length: rc.numTrapezoids }, (_, j) => {
                  const x = 30 + j * (profileW + 20)
                  const isLast = j === rc.numTrapezoids - 1
                  return (
                    <g key={j} transform={`translate(${x}, 10)`}>
                      <TrapProfile rc={rc} sc={sc} showLabel={true} selected={selectedIdx === i} />
                      {/* Spacing arrow at bottom */}
                      {!isLast && (
                        <g transform={`translate(0, 115)`}>
                          <line x1={rc.baseLength * sc + 16} y1={5} x2={rc.baseLength * sc + 16 + 20} y2={5} stroke="#17a9cf" strokeWidth="1" markerEnd="url(#arr)" markerStart="url(#arr)" />
                          <text x={rc.baseLength * sc + 16 + 10} y={14} fontSize="8" fill="#17a9cf" fontWeight="700" fontStyle="italic" textAnchor="middle">{spacing_mm}</text>
                        </g>
                      )}
                    </g>
                  )
                })}
              </svg>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Rows (top view) ─────────────────────────────────────────────────────────

function RowsView({ rowConstructions }) {
  const maxLen = Math.max(...rowConstructions.map(r => r.rowLength), 1)
  const maxW = 580
  const sc = maxW / maxLen

  return (
    <div style={{ padding: '1.5rem', overflowY: 'auto' }}>
      {rowConstructions.map((rc, i) => {
        const W = rc.rowLength * sc
        const panelDepth = PANEL_LENGTH_CM * Math.cos(rc.angle * Math.PI / 180)
        const depthSc = Math.min(60, panelDepth * sc)
        const railLabel = `${2}×${(rc.rowLength / 100).toFixed(1)}m`
        const totalH = depthSc + 48
        const svgW = W + 70

        return (
          <div key={i} style={{ marginBottom: '2rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: '700', color: '#888', marginBottom: '4px' }}>Row {i + 1}</div>
            <svg width={svgW} height={totalH} style={{ display: 'block', overflow: 'visible' }}>
              <ArrowDefs />
              {/* Row width arrow */}
              <line x1={30} y1={8} x2={30 + W} y2={8} stroke="#222" strokeWidth="1" markerEnd="url(#arr)" markerStart="url(#arr)" />
              <text x={30 + W / 2} y={5} fontSize="9" fontWeight="700" fill="#222" textAnchor="middle">{Math.round(rc.rowLength * 10)}</text>
              {/* Rectangle */}
              <rect x={30} y={20} width={W} height={depthSc}
                fill="#cfe3f5" stroke="#3a6ea5" strokeWidth="1.5" />
              {/* Hatch lines */}
              {Array.from({ length: Math.floor(W / 18) }, (_, k) => (
                <line key={k} x1={30 + k * 18} y1={20} x2={30 + k * 18 + depthSc * 0.6} y2={20 + depthSc}
                  stroke="#9bbcd4" strokeWidth="0.5" />
              ))}
              {/* Trapezoid positions (vertical lines) */}
              {Array.from({ length: rc.numTrapezoids }, (_, j) => {
                const tx = 30 + (rc.spareLeft + j * rc.spacing) * sc
                return <line key={j} x1={tx} y1={20} x2={tx} y2={20 + depthSc} stroke="#3a6ea5" strokeWidth="1.5" />
              })}
              {/* Label */}
              <text x={30 + W / 2} y={20 + depthSc / 2 + 4} fontSize="13" fontWeight="800" fill="#1a3a5c"
                textAnchor="middle">{railLabel}</text>
              {/* Depth arrow on right */}
              <line x1={30 + W + 10} y1={20} x2={30 + W + 10} y2={20 + depthSc} stroke="#222" strokeWidth="1" markerEnd="url(#arr)" markerStart="url(#arr)" />
              <text x={30 + W + 22} y={20 + depthSc / 2} fontSize="9" fontWeight="700" fill="#222" dominantBaseline="middle">{Math.round(panelDepth * 10)}</text>
            </svg>
          </div>
        )
      })}
    </div>
  )
}

// ─── Detail view (side elevation sketch) ─────────────────────────────────────

function DetailView({ rc }) {
  if (!rc) return <div style={{ padding: '2rem', color: '#aaa' }}>Select a row to see its trapezoid detail</div>

  const { heightRear, heightFront, baseLength, topBeamLength, diagonalLength, angle } = rc

  const sc = 2.2
  const padL = 70, padR = 60, padT = 30, padB = 70
  const bW = baseLength * sc
  const hR = heightRear * sc
  const hF = heightFront * sc
  const W = bW + padL + padR
  const H = hF + padT + padB + 20

  const baseY = H - padB
  const x0 = padL, x1 = padL + bW
  const topY0 = baseY - hR
  const topY1 = baseY - hF
  const foundH = 12, foundW = 24

  return (
    <div style={{ padding: '1.5rem', overflowY: 'auto' }}>
      <div style={{ fontSize: '0.8rem', fontWeight: '700', color: '#555', marginBottom: '1rem' }}>
        Type {rc.typeLetter} — {angle}° tilt · Base {baseLength.toFixed(0)} cm · Front H {heightFront.toFixed(1)} cm
      </div>

      <svg width={W + 40} height={H + 20} style={{ display: 'block', overflow: 'visible' }}>
        <ArrowDefs />

        {/* Foundation blocks */}
        <rect x={x0 - foundW / 2} y={baseY} width={foundW} height={foundH} fill="#aaa" rx="2" />
        <rect x={x1 - foundW / 2} y={baseY} width={foundW} height={foundH} fill="#aaa" rx="2" />

        {/* Base beam */}
        <line x1={x0} y1={baseY} x2={x1} y2={baseY} stroke="#444" strokeWidth="4" strokeLinecap="round" />

        {/* Rear leg */}
        {hR > 0 && <line x1={x0} y1={topY0} x2={x0} y2={baseY} stroke="#444" strokeWidth="4" strokeLinecap="round" />}

        {/* Front leg */}
        <line x1={x1} y1={topY1} x2={x1} y2={baseY} stroke="#444" strokeWidth="4" strokeLinecap="round" />

        {/* Top beam (sloped) */}
        <line x1={x0} y1={topY0} x2={x1} y2={topY1} stroke="#3060b0" strokeWidth="5" strokeLinecap="round" />

        {/* Panel overhang indicators */}
        <line x1={x0 - 18} y1={topY0 - 3} x2={x1 + 18} y2={topY1 - 3} stroke="#3060b0" strokeWidth="3" strokeLinecap="round" opacity="0.4" />

        {/* Diagonal brace */}
        <line x1={x0} y1={topY0} x2={x1} y2={baseY} stroke="#666" strokeWidth="3" strokeLinecap="round" />

        {/* Angle indicator at top-right */}
        <path d={`M ${x1} ${topY1 + 22} A 22 22 0 0 0 ${x1 - 22 * Math.sin(angle * Math.PI / 180)} ${topY1 + 22 - 22 * (1 - Math.cos(angle * Math.PI / 180))}`}
          fill="none" stroke="#444" strokeWidth="1" />
        <text x={x1 - 28} y={topY1 + 30} fontSize="10" fill="#444" fontWeight="700">{angle}°</text>

        {/* ── Dimension lines ── */}
        {/* Base */}
        <DimArrow x1={x0} y1={baseY + 30} x2={x1} y2={baseY + 30} label={`${baseLength.toFixed(0)}`} offset={0} textOffset={-10} />

        {/* Rear leg height */}
        {hR > 0 && <DimArrow x1={x0 - 40} y1={topY0} x2={x0 - 40} y2={baseY} label={`${heightRear.toFixed(1)}`} offset={0} textOffset={-10} />}

        {/* Front leg height */}
        <DimArrow x1={x1 + 32} y1={topY1} x2={x1 + 32} y2={baseY} label={`${heightFront.toFixed(1)}`} offset={0} textOffset={-10} />

        {/* Top beam length */}
        <DimArrow x1={x0} y1={topY0 - 16} x2={x1} y2={topY1 - 16} label={`${topBeamLength.toFixed(1)}`} offset={0} textOffset={-8} />

        {/* Diagonal length */}
        <text
          x={(x0 + x1) / 2 + 8} y={(topY0 + baseY) / 2 - 8}
          fontSize="9" fill="#17a9cf" fontStyle="italic" fontWeight="700"
          transform={`rotate(${Math.atan2(baseY - topY0, x1 - x0) * 180 / Math.PI}, ${(x0 + x1) / 2}, ${(topY0 + baseY) / 2})`}
          textAnchor="middle"
        >{diagonalLength.toFixed(1)}</text>
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
              ['Base beam',   rc.baseLength],
              ['Top beam',    rc.topBeamLength],
              ['Rear leg',    rc.heightRear],
              ['Front leg',   rc.heightFront],
              ['Diagonal',    rc.diagonalLength],
            ].map(([name, val]) => (
              <tr key={name} style={{ borderTop: '1px solid #f0f0f0' }}>
                <td style={{ padding: '0.3rem 0.5rem', color: '#444' }}>{name}</td>
                <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', fontWeight: '600', color: '#222' }}>{val.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── BOM view ────────────────────────────────────────────────────────────────

function BOMView({ rowConstructions }) {
  const bom = useMemo(() => buildBOM(rowConstructions), [rowConstructions])
  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ fontSize: '0.7rem', fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>Bill of Materials</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
        <thead>
          <tr style={{ background: '#f5f5f5' }}>
            <th style={{ textAlign: 'left', padding: '0.4rem 0.75rem', fontWeight: '700', color: '#444' }}>Element</th>
            <th style={{ textAlign: 'right', padding: '0.4rem 0.75rem', fontWeight: '700', color: '#444' }}>Length (cm)</th>
            <th style={{ textAlign: 'right', padding: '0.4rem 0.75rem', fontWeight: '700', color: '#444' }}>Qty</th>
            <th style={{ textAlign: 'right', padding: '0.4rem 0.75rem', fontWeight: '700', color: '#444' }}>Total (cm)</th>
          </tr>
        </thead>
        <tbody>
          {bom.map((item, i) => (
            <tr key={i} style={{ borderTop: '1px solid #f0f0f0', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
              <td style={{ padding: '0.4rem 0.75rem', color: '#333' }}>{item.type}</td>
              <td style={{ padding: '0.4rem 0.75rem', textAlign: 'right', color: '#555' }}>{item.lengthCm.toFixed(1)}</td>
              <td style={{ padding: '0.4rem 0.75rem', textAlign: 'right', fontWeight: '700', color: '#222' }}>{item.quantity}</td>
              <td style={{ padding: '0.4rem 0.75rem', textAlign: 'right', fontWeight: '600', color: '#5a6600' }}>{(item.lengthCm * item.quantity / 100).toFixed(2)} m</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ background: '#f0f0f0', fontWeight: '700' }}>
            <td colSpan={3} style={{ padding: '0.4rem 0.75rem', color: '#333' }}>Total linear meters</td>
            <td style={{ padding: '0.4rem 0.75rem', textAlign: 'right', color: '#222' }}>
              {(bom.reduce((s, r) => s + r.lengthCm * r.quantity, 0) / 100).toFixed(2)} m
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ─── Main Step4 component ────────────────────────────────────────────────────

export default function Step4ConstructionPlanning({ panels = [], refinedArea, rowConfigs = {} }) {
  const [selectedRowIdx, setSelectedRowIdx] = useState(0)
  const [activeTab, setActiveTab] = useState('layout')
  const [rowUserConfigs, setRowUserConfigs] = useState({})  // per-row overrides: { [rowIdx]: { spareLeft, spareRight, maxSpan, baseLength } }

  // Group panels by row index
  const rowPanelCounts = useMemo(() => {
    const map = {}
    panels.forEach(p => {
      const key = p.row ?? 'unassigned'
      map[key] = (map[key] || 0) + 1
    })
    return map
  }, [panels])

  const rowKeys = useMemo(() =>
    Object.keys(rowPanelCounts).filter(k => k !== 'unassigned').map(Number).sort((a, b) => a - b),
    [rowPanelCounts]
  )

  // Compute construction for each row
  const rowConstructions = useMemo(() => {
    const rcs = rowKeys.map((rowKey, i) => {
      const panelCount = rowPanelCounts[rowKey] || 1
      const globalCfg = refinedArea?.panelConfig || {}
      const override = rowConfigs[rowKey] || {}
      const angle = override.angle ?? globalCfg.angle ?? 0
      const frontHeight = globalCfg.frontHeight ?? 0
      const userCfg = rowUserConfigs[i] || {}
      return computeRowConstruction(panelCount, angle, frontHeight, userCfg)
    })
    return assignTypes(rcs)
  }, [rowKeys, rowPanelCounts, refinedArea, rowConfigs, rowUserConfigs])

  const selectedRC = rowConstructions[selectedRowIdx] ?? null

  const tabs = [
    { key: 'layout', label: 'Trapezoid Layout' },
    { key: 'rows',   label: 'Row Dimensions' },
    { key: 'detail', label: 'Detail Sketch' },
    { key: 'bom',    label: 'Bill of Materials' },
    { key: 'rails',  label: 'Rail Layout' },
  ]

  const updateUserConfig = (rowIdx, field, value) => {
    setRowUserConfigs(prev => ({
      ...prev,
      [rowIdx]: { ...(prev[rowIdx] || {}), [field]: parseFloat(value) || 0 }
    }))
  }

  if (rowKeys.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#aaa', fontSize: '0.95rem' }}>
        No panel rows found — complete Step 3 first.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: 'white' }}>

      {/* ── Left sidebar ── */}
      <div style={{
        width: '260px', flexShrink: 0, borderRight: '1px solid #e8e8e8',
        display: 'flex', flexDirection: 'column', overflowY: 'auto',
        background: '#fafafa'
      }}>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e8e8e8' }}>
          <div style={{ fontSize: '0.65rem', fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Rows</div>
        </div>

        {/* Row list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {rowConstructions.map((rc, i) => (
            <div
              key={i}
              onClick={() => setSelectedRowIdx(selectedRowIdx === i ? null : i)}
              style={{
                padding: '0.6rem 1rem', cursor: 'pointer',
                borderBottom: '1px solid #f0f0f0',
                background: selectedRowIdx === i ? '#f4f9e4' : 'transparent',
                borderLeft: `3px solid ${selectedRowIdx === i ? ACCENT : 'transparent'}`,
                transition: 'all 0.12s'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.84rem', fontWeight: '700', color: selectedRowIdx === i ? '#333' : '#555' }}>
                  Row {i + 1}
                </span>
                <span style={{
                  fontSize: '0.72rem', fontWeight: '800', color: 'white',
                  background: '#555', borderRadius: '4px', padding: '1px 6px'
                }}>{rc.typeLetter}{rc.panelsPerSpan}</span>
              </div>
              <div style={{ fontSize: '0.72rem', color: '#888', marginTop: '2px' }}>
                {rc.panelCount} panels · {rc.angle}° · {rc.numTrapezoids} frames
              </div>
              <div style={{ fontSize: '0.72rem', color: '#888' }}>
                Rail: {(rc.rowLength / 100).toFixed(2)} m
              </div>
            </div>
          ))}
        </div>

        {/* Config panel for selected row */}
        {selectedRC && (
          <div style={{ borderTop: '1px solid #e8e8e8', padding: '0.75rem 1rem' }}>
            <div style={{ fontSize: '0.65rem', fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.6rem' }}>
              Row {selectedRowIdx + 1} Config
            </div>
            {[
              ['Spare Left (cm)', 'spareLeft', selectedRC.spareLeft],
              ['Spare Right (cm)', 'spareRight', selectedRC.spareRight],
              ['Max Span (cm)', 'maxSpan', selectedRC.spacing],
              ['Base Length (cm)', 'baseLength', selectedRC.baseLength],
            ].map(([label, field, def]) => (
              <div key={field} style={{ marginBottom: '0.5rem' }}>
                <div style={{ fontSize: '0.68rem', color: '#777', marginBottom: '2px' }}>{label}</div>
                <input
                  type="number"
                  defaultValue={Math.round(def)}
                  onChange={e => updateUserConfig(selectedRowIdx, field, e.target.value)}
                  style={{
                    width: '100%', padding: '0.25rem 0.4rem', boxSizing: 'border-box',
                    border: '1px solid #ddd', borderRadius: '5px', fontSize: '0.8rem'
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Tab bar */}
        <div style={{
          display: 'flex', borderBottom: '2px solid #e8e8e8',
          background: '#f8f9fa', padding: '0 1rem', gap: '0.25rem'
        }}>
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '0.55rem 1rem', border: 'none', cursor: 'pointer',
                fontSize: '0.8rem', fontWeight: '600',
                background: activeTab === tab.key ? 'white' : 'transparent',
                color: activeTab === tab.key ? '#333' : '#888',
                borderBottom: activeTab === tab.key ? `2px solid ${ACCENT}` : '2px solid transparent',
                marginBottom: '-2px', transition: 'all 0.15s'
              }}
            >{tab.label}</button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {activeTab === 'layout' && <LayoutView rowConstructions={rowConstructions} selectedIdx={selectedRowIdx} onSelectRow={i => { setSelectedRowIdx(i) }} />}
          {activeTab === 'rows'   && <RowsView rowConstructions={rowConstructions} />}
          {activeTab === 'detail' && <DetailView rc={selectedRC} />}
          {activeTab === 'bom'    && <BOMView rowConstructions={rowConstructions} />}
          {activeTab === 'rails'  && <RailLayoutTab panels={panels} refinedArea={refinedArea} selectedRowIdx={selectedRowIdx} />}
        </div>
      </div>
    </div>
  )
}
