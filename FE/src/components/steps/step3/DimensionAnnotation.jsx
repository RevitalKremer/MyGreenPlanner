import { TEXT_SECONDARY } from '../../../styles/colors'

/**
 * DimensionAnnotation — reusable SVG dimension-line component.
 *
 * Props:
 *   measurePts  [[x,y], ...]   — start of each extension line (panel-edge side)
 *   annPts      [[x,y], ...]   — end of each extension line / points on annotation line
 *   labels      [string, ...]  — one label per gap (length = measurePts.length - 1)
 *   zoom        number
 *   color       string         — default colour for all segments
 *   colors      [string, ...]  — optional per-segment colour override
 */
export default function DimensionAnnotation({ measurePts, annPts, labels, zoom, color = TEXT_SECONDARY, colors = null }) {
  const TICK = 4 / zoom
  const fontSize = 14 / zoom

  return (
    <g>
      {/* Extension lines */}
      {measurePts.map(([mx, my], i) => {
        const [ax, ay] = annPts[i]
        const c = colors?.[i] ?? color
        return (
          <line key={`ext-${i}`}
            x1={mx} y1={my} x2={ax} y2={ay}
            stroke={c} strokeWidth={0.8 / zoom}
          />
        )
      })}

      {/* Annotation segments: line + tick marks + label */}
      {annPts.slice(0, -1).map(([ax1, ay1], i) => {
        const [ax2, ay2] = annPts[i + 1]
        const dx = ax2 - ax1, dy = ay2 - ay1
        const len = Math.sqrt(dx * dx + dy * dy)
        if (len < 2) return null
        const px = -dy / len, py = dx / len   // perpendicular to annotation line
        const mx = (ax1 + ax2) / 2, my = (ay1 + ay2) / 2
        const angle = Math.atan2(dy, dx) * 180 / Math.PI
        const labelAngle = angle > 90 || angle < -90 ? angle + 180 : angle
        const label = labels[i]
        const bgW = label.length * fontSize * 0.6 + 6 / zoom
        const bgH = fontSize + 4 / zoom
        const c = colors?.[i] ?? color
        return (
          <g key={`seg-${i}`}>
            <line x1={ax1} y1={ay1} x2={ax2} y2={ay2} stroke={c} strokeWidth={1 / zoom} />
            <line x1={ax1 - px * TICK} y1={ay1 - py * TICK} x2={ax1 + px * TICK} y2={ay1 + py * TICK} stroke={c} strokeWidth={1.2 / zoom} />
            <line x1={ax2 - px * TICK} y1={ay2 - py * TICK} x2={ax2 + px * TICK} y2={ay2 + py * TICK} stroke={c} strokeWidth={1.2 / zoom} />
            <g transform={`rotate(${labelAngle} ${mx} ${my})`}>
              <rect x={mx - bgW / 2} y={my - bgH / 2} width={bgW} height={bgH} fill="white" stroke="#ccc" strokeWidth={0.5 / zoom} rx={1 / zoom} />
              <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle" fontSize={fontSize} fontWeight="700" fill={c}>{label}</text>
            </g>
          </g>
        )
      })}
    </g>
  )
}
