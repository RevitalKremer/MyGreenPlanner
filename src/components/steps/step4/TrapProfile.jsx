import { ACCENT } from './constants'

export default function TrapProfile({ rc, sc = 1.2, showLabel = true, selected = false }) {
  const { heightRear, heightFront, baseLength, typeLetter, panelsPerSpan, diagonalLength } = rc
  const padL = 8, padR = 8, padT = 12, padB = 10
  const bW = baseLength * sc
  const hR = heightRear * sc
  const hF = heightFront * sc
  const W = bW + padL + padR
  const svgH = hF + padT + padB

  const baseY = svgH - padB
  const x0 = padL, x1 = padL + bW
  const topY0 = baseY - hR
  const topY1 = baseY - hF

  return (
    <svg width={W} height={svgH} style={{ display: 'block', overflow: 'visible' }}>
      {/* Frame */}
      <line x1={x0} y1={baseY} x2={x1} y2={baseY} stroke={selected ? ACCENT : '#333'} strokeWidth="2.5" />
      <line x1={x0} y1={topY0} x2={x0} y2={baseY} stroke={selected ? ACCENT : '#333'} strokeWidth="2.5" />
      <line x1={x1} y1={topY1} x2={x1} y2={baseY} stroke={selected ? ACCENT : '#333'} strokeWidth="2.5" />
      <line x1={x0} y1={topY0} x2={x1} y2={topY1} stroke={selected ? ACCENT : '#333'} strokeWidth="2" />
      {/* Diagonal brace */}
      <line x1={x0} y1={topY0} x2={x1} y2={baseY} stroke="#666" strokeWidth="1.5" />
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
