import { useState, useRef } from 'react'
import { BORDER_MID } from '../../styles/colors'

/**
 * Floating navigator panel — always visible in the bottom-right of the canvas.
 * Contains zoom controls and a minimap. Can be hidden to a small icon button.
 *
 * @param {number}   viewZoom      - current zoom level (e.g. 1.2)
 * @param {function} onZoomIn      - () => void
 * @param {function} onZoomOut     - () => void
 * @param {function} onZoomReset   - () => void  (also resets pan)
 * @param {string}   [imageData]   - background image URL; when absent the minimap
 *                                   shows a dark background (vector diagram mode)
 * @param {number}   mmWidth       - minimap pixel width
 * @param {number}   mmHeight      - minimap pixel height
 * @param {function} onPanToPoint  - (mmX, mmY) => void
 * @param {{x,y,w,h}|null} [viewportRect] - current visible region in minimap coords;
 *                                          rendered as a white dashed rectangle
 * @param {ReactNode} [children]   - extra SVG overlay content (dim rect, panel rects, etc.)
 */
export default function CanvasNavigator({
  viewZoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  imageData,
  mmWidth,
  mmHeight,
  onPanToPoint,
  viewportRect,
  children,
  left = 16,
}) {
  const [hidden, setHidden] = useState(false)
  const dragRef = useRef(false)

  const zoomPct = (viewZoom * 100).toFixed(0) + '%'

  const panelStyle = {
    position: 'fixed', bottom: 88, left,  // 72px wizard toolbar + 16px gap
    zIndex: 1000,
    userSelect: 'none',
  }

  if (hidden) {
    return (
      <div style={panelStyle}>
        <button
          onClick={() => setHidden(false)}
          title="Show navigator"
          style={{
            background: 'rgba(20,20,20,0.78)',
            backdropFilter: 'blur(6px)',
            color: BORDER_MID,
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: '8px',
            padding: '0.45rem 0.7rem',
            cursor: 'pointer',
            fontSize: '0.72rem',
            fontWeight: '700',
            letterSpacing: '0.04em',
          }}
        >
          ◀ Display
        </button>
      </div>
    )
  }

  return (
    <div
      style={{
        ...panelStyle,
        background: 'rgba(20,20,20,0.82)',
        backdropFilter: 'blur(8px)',
        borderRadius: '10px',
        padding: '0.6rem 0.7rem 0.65rem',
        color: 'white',
        width: mmWidth + 14,
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        border: '1px solid rgba(255,255,255,0.1)',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '0.62rem', fontWeight: '700', color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Display
        </span>
        <button
          onClick={() => setHidden(true)}
          title="Hide"
          style={{ background: 'none', border: 'none', color: '#777', cursor: 'pointer', fontSize: '0.7rem', padding: 0, lineHeight: 1 }}
        >
          ▶
        </button>
      </div>

      {/* Zoom row */}
      <div style={{ marginBottom: '0.55rem' }}>
        <div style={{ fontSize: '0.6rem', color: '#777', marginBottom: '0.22rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Zoom — {zoomPct}
        </div>
        <div style={{ display: 'flex', gap: '0.3rem' }}>
          {[['−', onZoomOut], [zoomPct, onZoomReset], ['+', onZoomIn]].map(([label, fn], i) => (
            <button
              key={i}
              onClick={fn}
              style={{
                flex: 1, padding: '0.32rem 0',
                background: 'rgba(255,255,255,0.1)',
                color: '#e0e0e0',
                border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: '5px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: i === 1 ? '0.62rem' : '0.88rem',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Minimap — always shown; imageData optional (dark bg when absent) */}
      <div style={{ fontSize: '0.6rem', color: '#777', marginBottom: '0.22rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Navigator
      </div>
      <div
        style={{ width: mmWidth, height: mmHeight, borderRadius: '5px', overflow: 'hidden', cursor: 'crosshair', position: 'relative', background: imageData ? undefined : '#1e2433' }}
        onMouseDown={(e) => { dragRef.current = true; const r = e.currentTarget.getBoundingClientRect(); onPanToPoint(e.clientX - r.left, e.clientY - r.top) }}
        onMouseMove={(e) => { if (!dragRef.current) return; const r = e.currentTarget.getBoundingClientRect(); onPanToPoint(e.clientX - r.left, e.clientY - r.top) }}
        onMouseUp={() => { dragRef.current = false }}
        onMouseLeave={() => { dragRef.current = false }}
      >
        {imageData && <img src={imageData} alt="" style={{ position: 'absolute', top: 0, left: 0, width: mmWidth, height: mmHeight, objectFit: 'fill', pointerEvents: 'none' }} />}
        <svg width={mmWidth} height={mmHeight} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
          {children}
          {viewportRect && (
            <rect x={viewportRect.x} y={viewportRect.y} width={viewportRect.w} height={viewportRect.h}
              fill="rgba(255,255,255,0.10)" stroke="white" strokeWidth="1.5" strokeDasharray="3,2" />
          )}
        </svg>
      </div>
    </div>
  )
}
