import { useRef, useState } from 'react'

/**
 * Minimap navigator widget — shown when zoomed in.
 * Manages its own collapsed state internally.
 *
 * @param {string}   imageData     - background image URL
 * @param {number}   width         - minimap pixel width (MM_W)
 * @param {number}   height        - minimap pixel height (MM_H)
 * @param {function} onPanToPoint  - called with (mmX, mmY) on click/drag
 * @param {ReactNode} children     - SVG overlay content (rects, polygons, etc.)
 */
export default function MinimapView({ imageData = null, width, height, onPanToPoint, children = null }) {
  const [collapsed, setCollapsed] = useState(false)
  const dragRef = useRef(false)

  return (
    <div style={{ marginBottom: '0.6rem' }}>
      <div
        onClick={() => setCollapsed(c => !c)}
        style={{ fontSize: '0.62rem', fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.25rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
      >
        <span>Navigator</span>
        <span style={{ fontSize: '0.55rem' }}>{collapsed ? '▲' : '▼'}</span>
      </div>
      {!collapsed && (
        <div
          style={{ width, height, borderRadius: '6px', overflow: 'hidden', cursor: 'crosshair', boxShadow: '0 1px 6px rgba(0,0,0,0.2)', position: 'relative' }}
          onMouseDown={(e) => { dragRef.current = true; const r = e.currentTarget.getBoundingClientRect(); onPanToPoint(e.clientX - r.left, e.clientY - r.top) }}
          onMouseMove={(e) => { if (!dragRef.current) return; const r = e.currentTarget.getBoundingClientRect(); onPanToPoint(e.clientX - r.left, e.clientY - r.top) }}
          onMouseUp={() => { dragRef.current = false }}
          onMouseLeave={() => { dragRef.current = false }}
        >
          <img src={imageData} alt="" style={{ position: 'absolute', top: 0, left: 0, width, height, objectFit: 'fill', pointerEvents: 'none' }} />
          <svg width={width} height={height} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
            {children}
          </svg>
        </div>
      )}
    </div>
  )
}
