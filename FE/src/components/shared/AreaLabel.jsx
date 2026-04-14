import { BLACK, BLUE, WHITE } from '../../styles/colors'

/**
 * AreaLabel — SVG label with optional slope-direction chevron.
 * Used for area names in AreasTab and trapezoid IDs in BasesPlanTab.
 *
 * Props:
 *   x, y        — center position
 *   label       — text to render
 *   fontSize    — base font size in SVG units
 *   rotation    — rotation angle in degrees (0 = no rotation)
 *   yDir        — 'ttb' | 'btt' — slope direction for chevron
 *   showChevron — whether to render the slope chevron (default true)
 */
export default function AreaLabel({ x, y, label, fontSize, rotation = 0, yDir = 'ttb', showChevron = true }) {
  const fs = fontSize
  const down = yDir === 'ttb'
  const r = rotation * Math.PI / 180
  const chevW = fs * 1.0
  const chevH = fs * 0.6
  const dist = fs * 1.1
  const ldx = -Math.sin(r), ldy = Math.cos(r)
  const cupSign = down ? -1 : 1
  const chevX = x + ldx * cupSign * dist
  const chevY = y + ldy * cupSign * dist
  const chevPts = down
    ? `0,${-chevH / 2} ${-chevW / 2},${chevH / 2} ${chevW / 2},${chevH / 2}`
    : `${-chevW / 2},${-chevH / 2} ${chevW / 2},${-chevH / 2} 0,${chevH / 2}`

  return (
    <g style={{ pointerEvents: 'none', userSelect: 'none' }}>
      <text x={x} y={y}
        textAnchor="middle" dominantBaseline="middle"
        fill={WHITE} fontSize={fs} fontWeight="800"
        stroke={BLACK} strokeWidth={fs * 0.08} paintOrder="stroke"
      >{label}</text>
      {showChevron && (
        <g transform={`translate(${chevX},${chevY}) rotate(${rotation})`}>
          <polygon points={chevPts} fill={WHITE} fillOpacity={0.85} stroke={BLACK} strokeWidth={chevH * 0.07} strokeLinejoin="round" />
        </g>
      )}
    </g>
  )
}
