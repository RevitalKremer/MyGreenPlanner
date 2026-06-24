// Panel facing arrow — a triangle centered at (x, y) pointing in the panel's
// in-plane facing (screen rotation + row direction yDir). Tilt does NOT affect
// it. Shared so every panel rendering shows the same direction glyph.
export default function DirectionArrow({
  x, y, rotation = 0, yDir = 'ttb', size,
  fill = 'white', fillOpacity = 1, stroke = undefined as string | undefined, strokeWidth = 0,
}: {
  x: number; y: number; rotation?: number; yDir?: string; size: number
  fill?: string; fillOpacity?: number; stroke?: string; strokeWidth?: number
}) {
  const r = (rotation || 0) * Math.PI / 180
  const sign = (yDir || 'ttb') === 'ttb' ? 1 : -1
  const fx = -Math.sin(r) * sign, fy = Math.cos(r) * sign   // facing (down-slope) in screen space
  const px = -fy, py = fx, w = size * 0.6
  const pts = `${x + fx * size},${y + fy * size} ` +
    `${x - fx * size * 0.5 + px * w},${y - fy * size * 0.5 + py * w} ` +
    `${x - fx * size * 0.5 - px * w},${y - fy * size * 0.5 - py * w}`
  return (
    <polygon points={pts} fill={fill} fillOpacity={fillOpacity} stroke={stroke}
      strokeWidth={strokeWidth} strokeLinejoin="round" style={{ pointerEvents: 'none' }} />
  )
}
