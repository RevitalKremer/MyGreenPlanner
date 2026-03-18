import { ACCENT, PARAM_GROUP } from './constants'
import TrapProfile from './TrapProfile'

function ArrowDefs() {
  return (
    <defs>
      <marker id="arr" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
        <path d="M0,0 L0,6 L6,3 z" fill="#17a9cf" />
      </marker>
    </defs>
  )
}

export default function LayoutView({ rowConstructions, rowLabels = [], selectedIdx, onSelectRow, highlightParam = null }) {
  const hlSpacing = PARAM_GROUP[highlightParam] === 'trap-spacing'
  return (
    <div style={{ padding: '1.5rem', overflowY: 'auto' }}>
      {hlSpacing && <style>{`@keyframes hlPulse { 0%,100%{opacity:0.15} 50%{opacity:0.9} }`}</style>}
      {rowConstructions.map((rc, i) => {
        const sc = 1.2
        const profileW = rc.baseLength * sc + 16
        const spacing_mm = Math.round(rc.spacing * 10)
        const totalW = rc.numTrapezoids * profileW + (rc.numTrapezoids - 1) * 20 + 60
        const arrowColor = hlSpacing ? '#FFB300' : '#17a9cf'

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
              {rowLabels[i] ?? `Area ${i + 1}`} · {rc.panelCount} panels · {rc.angle}° · {rc.typeLetter}{rc.panelsPerSpan} type
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
                      {!isLast && (
                        <g transform={`translate(0, 115)`}
                          style={hlSpacing ? { animation: 'hlPulse 0.75s ease-in-out infinite' } : {}}>
                          <line x1={rc.baseLength * sc + 16} y1={5} x2={rc.baseLength * sc + 16 + 20} y2={5}
                            stroke={arrowColor} strokeWidth={hlSpacing ? 2 : 1}
                            markerEnd="url(#arr)" markerStart="url(#arr)" />
                          <text x={rc.baseLength * sc + 16 + 10} y={14} fontSize="8"
                            fill={arrowColor} fontWeight="700" fontStyle="italic" textAnchor="middle">{spacing_mm}</text>
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
