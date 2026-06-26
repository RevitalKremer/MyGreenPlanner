import { useEffect, useState } from 'react'
import { PRIMARY, PRIMARY_DARK, WHITE } from '../../styles/colors'

/**
 * Reusable ruler/distance measurement tool overlay.
 *
 * Props:
 *  active      – boolean, is ruler mode on
 *  zoom        – current canvas zoom level
 *  pxPerCm     – SVG/content pixels per cm (without zoom factor)
 *  containerRef – ref to the pan container div (screen coords base)
 */
function RulerTool({ active, zoom, pxPerCm, containerRef }) {
  const [pts, setPts] = useState([])
  const [dragging, setDragging] = useState(false)

  // Toggling the ruler off clears any drawn measurement, and starting a new
  // drag replaces the old one — so no separate "clear" button is needed.
  useEffect(() => {
    if (!active) { setPts([]); setDragging(false) }
  }, [active])

  const coordsOf = (e) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return null
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  // Drag-to-draw (consistent with Step1 reference line + Step2 PanelCanvas):
  // press to set the start point, drag to preview, release to set the end.
  const handleMouseDown = (e) => {
    if (!active || e.button !== 0) return
    e.stopPropagation()
    const c = coordsOf(e)
    if (!c) return
    setPts([c])
    setDragging(true)
  }
  const handleMouseMove = (e) => {
    if (!active || !dragging) return
    const c = coordsOf(e)
    if (c) setPts(prev => (prev.length ? [prev[0], c] : prev))
  }
  const handleMouseUp = (e) => {
    if (!active || !dragging) return
    e.stopPropagation()
    setDragging(false)
    const c = coordsOf(e)
    const start = pts[0]
    // Ignore a stray click / micro-drag so we never commit a zero-length line.
    if (!c || !start || Math.hypot(c.x - start.x, c.y - start.y) < 8) {
      setPts([])
      return
    }
    setPts([start, c])
  }

  // expose clear so parent can call it when ruler is toggled off
  RulerTool._clear = () => setPts([])

  const p1 = pts[0], p2 = pts[1]
  let distLabel = null
  if (p1 && p2) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y
    const screenDist = Math.sqrt(dx * dx + dy * dy)
    const distCm = screenDist / zoom / pxPerCm
    distLabel = distCm >= 100
      ? `${(distCm / 100).toFixed(2)} m`
      : `${distCm.toFixed(1)} cm`
  }

  if (!active && pts.length === 0) return null

  const midX = p1 && p2 ? (p1.x + p2.x) / 2 : 0
  const midY = p1 && p2 ? (p1.y + p2.y) / 2 : 0

  return (
    <div
      style={{
        position: 'absolute', inset: 0,
        pointerEvents: active ? 'auto' : 'none',
        cursor: active ? 'crosshair' : 'default',
        zIndex: 8,
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >

      {/* SVG overlay */}
      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}
      >
        {p1 && p2 && (
          <line
            x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
            stroke={PRIMARY} strokeWidth={2.5} strokeDasharray="6,4"
          />
        )}
        {p1 && <circle cx={p1.x} cy={p1.y} r={5} fill={PRIMARY} stroke={WHITE} strokeWidth={1.5} />}
        {p2 && <circle cx={p2.x} cy={p2.y} r={5} fill={PRIMARY} stroke={WHITE} strokeWidth={1.5} />}
        {distLabel && (
          <g>
            <rect
              x={midX - distLabel.length * 4 - 6} y={midY - 11}
              width={distLabel.length * 8 + 12} height={18}
              fill={WHITE} stroke={PRIMARY} strokeWidth={1} rx={4}
            />
            <text
              x={midX} y={midY + 0.5}
              textAnchor="middle" dominantBaseline="middle"
              fontSize={11} fontWeight="700" fill={PRIMARY_DARK}
            >{distLabel}</text>
          </g>
        )}
      </svg>
    </div>
  )
}

RulerTool._clear = null as (() => void) | null

export default RulerTool
