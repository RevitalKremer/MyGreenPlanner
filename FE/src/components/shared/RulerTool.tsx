import { useState } from 'react'
import { ERROR_DARK } from '../../styles/colors'
import { useLang } from '../../i18n/LangContext'

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
  const { t } = useLang()
  const [pts, setPts] = useState([])

  const handleClick = (e) => {
    if (!active) return
    e.stopPropagation()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setPts(prev => prev.length >= 2 ? [{ x, y }] : [...prev, { x, y }])
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
      : `${Math.round(distCm)} cm`
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
      onClick={handleClick}
    >
      {/* Clear button */}
      {pts.length > 0 && (
        <button
          onClick={e => { e.stopPropagation(); setPts([]) }}
          style={{
            position: 'absolute', top: 12, left: 12,
            padding: '0.22rem 0.55rem', fontSize: '0.65rem', fontWeight: '600',
            background: '#fff3f3', color: ERROR_DARK, border: '1px solid #f5b7b1',
            borderRadius: '5px', cursor: 'pointer', zIndex: 9,
          }}
        >
          {t('ruler.clear')}
        </button>
      )}

      {/* SVG overlay */}
      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}
      >
        {p1 && p2 && (
          <line
            x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
            stroke="#E53935" strokeWidth={1.5} strokeDasharray="6,4"
          />
        )}
        {p1 && <circle cx={p1.x} cy={p1.y} r={5} fill="#E53935" stroke="white" strokeWidth={1.5} />}
        {p2 && <circle cx={p2.x} cy={p2.y} r={5} fill="#E53935" stroke="white" strokeWidth={1.5} />}
        {distLabel && (
          <g>
            <rect
              x={midX - distLabel.length * 4 - 6} y={midY - 11}
              width={distLabel.length * 8 + 12} height={18}
              fill="white" stroke="#E53935" strokeWidth={1} rx={4}
            />
            <text
              x={midX} y={midY + 0.5}
              textAnchor="middle" dominantBaseline="middle"
              fontSize={11} fontWeight="700" fill="#C62828"
            >{distLabel}</text>
          </g>
        )}
      </svg>
    </div>
  )
}

RulerTool._clear = null as (() => void) | null

export default RulerTool
