import { PRIMARY, TEXT_SECONDARY, TEXT_PLACEHOLDER, TEXT_FAINTEST, BG_LIGHT, BLUE, WARNING, BORDER_MID } from '../../../styles/colors'
import {
  computeTotalSlopeDepth,
  isHorizontalOrientation,
  isEmptyOrientation,
} from '../../../utils/trapezoidGeometry'

/**
 * Cross-section side-view SVG for a single row configuration.
 * Computes all geometry internally from config props.
 */
export default function CrossSectionDiagram({ angle = 0, frontHeight = 0, backHeight = 0, linesPerRow = 1, orientations = ['vertical'], projectMode = 'scratch' }) {
  const hasValues = frontHeight > 0 || angle > 0

  const angleRad   = angle * Math.PI / 180
  const lineDepths = orientations.slice(0, linesPerRow).map(o => isHorizontalOrientation(o) ? 113.4 : 238.2)
  const groundY    = 160
  const startX     = 40
  const totalSlope = computeTotalSlopeDepth(orientations, linesPerRow)
  const totalHoriz = totalSlope * Math.cos(angleRad)
  const availW     = 200
  const scaleW     = totalHoriz > 0 ? availW / totalHoriz : 1
  const scaleH     = backHeight > 0 ? (groundY - 20) / backHeight : 1
  const sc         = Math.min(scaleW, scaleH, 0.7)

  const segments = []
  let cx = startX, cy = groundY - frontHeight * sc
  for (let i = 0; i < linesPerRow; i++) {
    const d   = lineDepths[i]
    const gap = i < linesPerRow - 1 ? 2.5 : 0
    const dx  = d * Math.cos(angleRad) * sc
    const dy  = d * Math.sin(angleRad) * sc
    const dO   = orientations[i]
    const dEmp = isEmptyOrientation(dO)
    const dLabel = dEmp ? 'Ø' : isHorizontalOrientation(dO) ? 'H' : 'V'
    segments.push({ x1: cx, y1: cy, x2: cx + dx, y2: cy - dy, label: dLabel, isEmpty: dEmp })
    cx += dx + gap * Math.cos(angleRad) * sc
    cy -= dy + gap * Math.sin(angleRad) * sc
  }
  const endX = cx

  if (!hasValues) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: BG_LIGHT, borderRadius: '6px', padding: '2rem', textAlign: 'center', color: TEXT_FAINTEST, fontSize: '0.85rem' }}>
        {projectMode === 'plan' ? 'Add a group and enter measurements' : 'Enter measurements to see diagram'}
      </div>
    )
  }

  return (
    <>
      <svg viewBox="0 0 300 180" style={{ width: '100%', height: 'auto', background: BG_LIGHT, borderRadius: '6px' }}>
        <line x1="10" y1={groundY} x2="290" y2={groundY} stroke={TEXT_FAINTEST} strokeWidth="1.5"/>
        <text x="150" y="175" textAnchor="middle" fontSize="9" fill={TEXT_FAINTEST}>Roof surface</text>
        {frontHeight > 0 && (
          <>
            <line x1={startX} y1={groundY} x2={startX} y2={groundY - frontHeight * sc} stroke="#FF5722" strokeWidth="1.5" strokeDasharray="3,3"/>
            <text x={startX - 3} y={groundY - frontHeight * sc / 2} textAnchor="end" fontSize="8" fill="#FF5722" fontWeight="600">{frontHeight}cm</text>
          </>
        )}
        {backHeight > 0 && (
          <>
            <line x1={endX} y1={groundY} x2={endX} y2={groundY - backHeight * sc} stroke={PRIMARY} strokeWidth="1.5" strokeDasharray="3,3"/>
            <text x={endX + 3} y={groundY - backHeight * sc / 2} textAnchor="start" fontSize="8" fill={TEXT_PLACEHOLDER} fontWeight="600">{backHeight.toFixed(1)}cm</text>
          </>
        )}
        {segments.map((seg, i) => {
          const midX = (seg.x1 + seg.x2) / 2
          const midY = (seg.y1 + seg.y2) / 2
          return (
            <g key={i}>
              <line x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2} stroke={seg.isEmpty ? BORDER_MID : seg.label === 'H' ? WARNING : BLUE} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={seg.isEmpty ? '4 3' : undefined}/>
              <circle cx={midX} cy={midY - 8} r="7" fill={seg.isEmpty ? BORDER_MID : seg.label === 'H' ? WARNING : BLUE}/>
              <text x={midX} y={midY - 8} textAnchor="middle" dominantBaseline="middle" fontSize="7.5" fill="white" fontWeight="700">{seg.label}</text>
            </g>
          )
        })}
        {angle > 0 && segments.length > 0 && (
          <>
            <path d={`M ${startX + 25} ${groundY} A 25 25 0 0 1 ${startX + 25 * Math.cos(angleRad)} ${groundY - 25 * Math.sin(angleRad)}`} stroke={TEXT_SECONDARY} strokeWidth="1.2" fill="none"/>
            <text x={startX + 32} y={groundY - 8} fontSize="8.5" fill={TEXT_SECONDARY} fontWeight="600">{angle.toFixed(1)}°</text>
          </>
        )}
        {frontHeight === 0 && <circle cx={startX} cy={groundY} r="3" fill="#FF5722"/>}
      </svg>
      {linesPerRow > 1 && (
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem', justifyContent: 'center' }}>
          <span style={{ fontSize: '0.72rem', color: BLUE, fontWeight: '600' }}>■ Vertical</span>
          <span style={{ fontSize: '0.72rem', color: WARNING, fontWeight: '600' }}>■ Horizontal</span>
        </div>
      )}
    </>
  )
}
