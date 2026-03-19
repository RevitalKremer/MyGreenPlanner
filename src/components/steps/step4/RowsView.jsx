import { PANEL_LENGTH_CM } from '../../../utils/constructionCalculator'
import { PARAM_GROUP } from './constants'

function ArrowDefs() {
  return (
    <defs>
      <marker id="arr" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
        <path d="M0,0 L0,6 L6,3 z" fill="#17a9cf" />
      </marker>
    </defs>
  )
}

export default function RowsView({ rowConstructions, rowLabels = [], highlightParam = null }) {
  const maxLen = Math.max(...rowConstructions.map(r => r.rowLength), 1)
  const maxW = 580
  const sc = maxW / maxLen
  const hlEnds = PARAM_GROUP[highlightParam] === 'rail-ends'

  return (
    <div style={{ padding: '1.5rem', overflowY: 'auto' }}>
      {hlEnds && <style>{`@keyframes hlPulse { 0%,100%{opacity:0.15} 50%{opacity:0.9} }`}</style>}
      {rowConstructions.map((rc, i) => {
        const W = rc.rowLength * sc
        const panelDepth = PANEL_LENGTH_CM * Math.cos(rc.angle * Math.PI / 180)
        const depthSc = Math.min(60, panelDepth * sc)
        const railLabel = `${2}×${(rc.rowLength / 100).toFixed(1)}m`
        const totalH = depthSc + 48
        const svgW = W + 70
        const widthArrowColor = hlEnds ? '#FFB300' : '#17a9cf'

        return (
          <div key={i} style={{ marginBottom: '2rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: '700', color: '#888', marginBottom: '4px' }}>{rowLabels[i] ?? `Area ${i + 1}`}</div>
            <svg width={svgW} height={totalH} style={{ display: 'block', overflow: 'visible' }}>
              <ArrowDefs />
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
                const tx = 30 + (rc.railOverhang + j * rc.spacing) * sc
                return <line key={j} x1={tx} y1={20} x2={tx} y2={20 + depthSc} stroke="#3a6ea5" strokeWidth="1.5" />
              })}
              {/* Label */}
              <text x={30 + W / 2} y={20 + depthSc / 2 + 4} fontSize="13" fontWeight="800" fill="#1a3a5c"
                textAnchor="middle">{railLabel}</text>
              {/* Row width dimension ON the top border */}
              <g style={hlEnds ? { animation: 'hlPulse 0.75s ease-in-out infinite' } : {}}>
                {/* Tick marks at both ends */}
                <line x1={30}     y1={14} x2={30}     y2={26} stroke={widthArrowColor} strokeWidth={hlEnds ? 2 : 1.2} />
                <line x1={30 + W} y1={14} x2={30 + W} y2={26} stroke={widthArrowColor} strokeWidth={hlEnds ? 2 : 1.2} />
                {/* Span line along the top border */}
                <line x1={30} y1={20} x2={30 + W} y2={20}
                  stroke={widthArrowColor} strokeWidth={hlEnds ? 2 : 1} />
                {/* Label on a white background, centered */}
                <rect x={30 + W / 2 - 20} y={12} width={40} height={11} fill="white" />
                <text x={30 + W / 2} y={21} fontSize="9" fontWeight="700"
                  fill={widthArrowColor} textAnchor="middle" dominantBaseline="auto">
                  {Math.round(rc.rowLength * 10)}
                </text>
              </g>
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
