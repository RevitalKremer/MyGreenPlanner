import { useRef, useState, useCallback } from 'react'
import { TEXT_SECONDARY, BORDER } from '../../../styles/colors'
import { localToScreen } from '../../../utils/railLayoutService'

const BASE_COLOR = '#000000'
const BAR_H      = 14   // unzoomed SVG px
const HANDLE_SZ  = 12   // unzoomed SVG px

const snapMm = (v) => Math.round(v)
const clamp  = (v, mn, mx) => Math.min(mx, Math.max(mn, v))

// In-canvas overlay for base positions.
// Renders as <g> inside the parent SVG, placing a bar below each row frame.
// isSelected: only the selected row is interactive.
export default function BasePlanOverlay({
  bp,
  zoom,
  pixelToCmRatio,
  sc,
  svgRef,
  spacingMm,
  edgeOffsetMm,
  toSvg,
  isSelected,
  overrideBarLocalY,
  onBasesChange,
}) {
  const dragging   = useRef(null)
  const didDrag    = useRef(false)
  const [hoverHandle, setHoverHandle] = useState(null)
  const [ghostOffset, setGhostOffset] = useState(null)

  if (!bp) return null

  const { frame, bases } = bp
  const { center, angleRad, localBounds, frameXMinPx, frameXMaxPx } = frame
  const { frameLengthMm } = bp
  const offsets = bases.map(b => b.offsetFromStartMm)

  const cosA = Math.cos(angleRad)
  const sinA = Math.sin(angleRad)

  const barH     = BAR_H     / zoom
  const handleSz = HANDLE_SZ / zoom

  // Bar Y: use area-wide override if provided, otherwise default to above this trap's panels
  const barLocalY = overrideBarLocalY ?? localBounds.minY - 20 / zoom

  const lxToSvg = (localX) => {
    const s = localToScreen({ x: localX, y: barLocalY }, center, angleRad)
    return toSvg(s.x, s.y)
  }

  const [barX0, barY0] = lxToSvg(frameXMinPx)
  const [barX1, barY1] = lxToSvg(frameXMaxPx)

  const offsetToLocalX = (offsetMm) =>
    frameXMinPx + (offsetMm / 10) / pixelToCmRatio

  // Project SVG position onto bar → offsetMm
  const svgPosToOffset = (svgX, svgY) => {
    const dx = barX1 - barX0, dy = barY1 - barY0
    const len2 = dx * dx + dy * dy
    if (len2 < 0.01) return null
    const t = clamp(((svgX - barX0) * dx + (svgY - barY0) * dy) / len2, 0, 1)
    return snapMm(t * frameLengthMm)
  }

  // Client drag delta → delta offsetMm along frame X
  const dClientToOffsetMm = (dClientX, dClientY) =>
    ((dClientX * cosA + dClientY * sinA) / (sc * zoom)) * pixelToCmRatio * 10

  // Clamp a moved offset: respect edges, min 100mm gap between bases, max = spacingMm
  const clampOffset = (raw, idx, refs) => {
    let o = clamp(raw, edgeOffsetMm, frameLengthMm - edgeOffsetMm)
    if (idx > 0)               o = Math.max(o, refs[idx - 1] + 100)
    if (idx < refs.length - 1) o = Math.min(o, refs[idx + 1] - 100)
    if (idx > 0)               o = Math.min(o, refs[idx - 1] + spacingMm)
    if (idx < refs.length - 1) o = Math.max(o, refs[idx + 1] - spacingMm)
    return snapMm(o)
  }

  // ─── Drag ────────────────────────────────────────────────────────────────
  const onMouseDown = useCallback((e, bi) => {
    if (!isSelected) return
    e.preventDefault(); e.stopPropagation()
    didDrag.current = false
    const startX = e.clientX, startY = e.clientY
    const startOffsets = [...offsets]
    dragging.current = { bi, startX, startY, startOffsets }

    const onMove = (me) => {
      if (Math.abs(me.clientX - startX) > 2 || Math.abs(me.clientY - startY) > 2)
        didDrag.current = true
      const dMm = dClientToOffsetMm(me.clientX - startX, me.clientY - startY)
      const next = [...startOffsets]
      next[bi] = clampOffset(startOffsets[bi] + dMm, bi, startOffsets)
      onBasesChange(next)
    }
    const onUp = () => {
      dragging.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [offsets, spacingMm, edgeOffsetMm, frameLengthMm, zoom, sc, pixelToCmRatio, cosA, sinA, isSelected, onBasesChange])

  // ─── Delete on handle click ───────────────────────────────────────────────
  const onHandleClick = useCallback((e, bi) => {
    if (!isSelected || didDrag.current || bases.length <= 2) return
    e.stopPropagation()
    onBasesChange(offsets.filter((_, i) => i !== bi))
  }, [isSelected, bases.length, offsets, onBasesChange])

  // ─── Add on bar click ─────────────────────────────────────────────────────
  const onBarClick = useCallback((e) => {
    if (!isSelected || dragging.current) return
    e.stopPropagation()
    const rect = svgRef.current.getBoundingClientRect()
    const offsetMm = svgPosToOffset(
      (e.clientX - rect.left) / zoom,
      (e.clientY - rect.top)  / zoom,
    )
    if (offsetMm == null) return
    if (offsets.some(o => Math.abs(o - offsetMm) < 100)) return
    onBasesChange([...offsets, offsetMm].sort((a, b) => a - b))
    setGhostOffset(null)
  }, [isSelected, offsets, zoom, svgRef, onBasesChange, barX0, barY0, barX1, barY1, frameLengthMm])

  const onBarMove = useCallback((e) => {
    if (!isSelected || dragging.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const offsetMm = svgPosToOffset(
      (e.clientX - rect.left) / zoom,
      (e.clientY - rect.top)  / zoom,
    )
    if (offsetMm == null) { setGhostOffset(null); return }
    setGhostOffset(offsets.some(o => Math.abs(o - offsetMm) < 100) ? null : offsetMm)
  }, [isSelected, offsets, zoom, svgRef, barX0, barY0, barX1, barY1, frameLengthMm])

  // ─── Render ───────────────────────────────────────────────────────────────
  // Bar direction in SVG: (cosA, sinA)
  // Perpendicular toward panels (decreasing localY): (sinA, -cosA)

  return (
    <g>
      {/* Bar fill — clickable area */}
      <line
        x1={barX0} y1={barY0} x2={barX1} y2={barY1}
        stroke="#e8f0f8" strokeWidth={barH} strokeLinecap="square"
        style={{ pointerEvents: isSelected ? 'all' : 'none', cursor: isSelected ? 'crosshair' : 'default' }}
        onClick={onBarClick}
        onMouseMove={onBarMove}
        onMouseLeave={() => setGhostOffset(null)}
      />
      {/* Bar border */}
      <line
        x1={barX0} y1={barY0} x2={barX1} y2={barY1}
        stroke="#b0c4d8" strokeWidth={0.8 / zoom} strokeLinecap="square"
        style={{ pointerEvents: 'none' }}
      />

      {/* Ghost: add-position indicator */}
      {ghostOffset != null && (() => {
        const [gx, gy] = lxToSvg(offsetToLocalX(ghostOffset))
        return (
          <g style={{ pointerEvents: 'none', opacity: 0.45 }}>
            <line
              x1={gx + sinA * barH / 2} y1={gy - cosA * barH / 2}
              x2={gx - sinA * barH / 2} y2={gy + cosA * barH / 2}
              stroke={BASE_COLOR} strokeWidth={1.5 / zoom}
              strokeDasharray={`${3 / zoom} ${2 / zoom}`}
            />
            <text x={gx - sinA * (barH / 2 + 8 / zoom)} y={gy + cosA * (barH / 2 + 8 / zoom)}
              textAnchor="middle" dominantBaseline="middle"
              fontSize={8 / zoom} fill={BASE_COLOR} fontWeight="700"
              style={{ pointerEvents: 'none' }}>+</text>
          </g>
        )
      })()}

      {/* Base handles */}
      {bases.map((base, bi) => {
        const [hx, hy] = lxToSvg(base.localX)
        const isHover   = hoverHandle === bi
        const canRemove = isSelected && bases.length > 2

        return (
          <g key={bi}
            onMouseEnter={() => setHoverHandle(bi)}
            onMouseLeave={() => setHoverHandle(null)}
            onMouseDown={(e) => onMouseDown(e, bi)}
            onClick={(e) => onHandleClick(e, bi)}
            style={{
              pointerEvents: isSelected ? 'all' : 'none',
              cursor: isSelected ? (canRemove && isHover ? 'pointer' : 'ew-resize') : 'default',
            }}
          >
            {/* Tick across bar */}
            <line
              x1={hx + sinA * barH / 2} y1={hy - cosA * barH / 2}
              x2={hx - sinA * barH / 2} y2={hy + cosA * barH / 2}
              stroke={BASE_COLOR} strokeWidth={1.5 / zoom}
              style={{ pointerEvents: 'none' }}
            />
            {/* Handle square */}
            <rect
              x={hx - handleSz / 2} y={hy - handleSz / 2}
              width={handleSz} height={handleSz} rx={2 / zoom}
              fill={isHover && canRemove ? '#dc2626' : BASE_COLOR}
              stroke="white" strokeWidth={1.5 / zoom}
            />
            {isHover && canRemove && (
              <text x={hx} y={hy + 3 / zoom} textAnchor="middle" fontSize={8 / zoom}
                fill="white" fontWeight="700" style={{ pointerEvents: 'none' }}>✕</text>
            )}
          </g>
        )
      })}

      {/* Spacing annotations between adjacent bases */}
      {bases.slice(0, -1).map((b1, bi) => {
        const b2 = bases[bi + 1]
        const [x1, y1] = lxToSvg(b1.localX)
        const [x2, y2] = lxToSvg(b2.localX)
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
        const spacingVal = b2.offsetFromStartMm - b1.offsetFromStartMm
        const annDist = barH / 2 + 14 / zoom
        // Place annotation toward panels (direction: sinA, -cosA)
        const ax = mx + sinA * annDist
        const ay = my - cosA * annDist
        const fs = 9 / zoom
        const lbl = String(spacingVal)
        const bgW = lbl.length * fs * 0.6 + 6 / zoom
        const bgH = fs + 4 / zoom
        return (
          <g key={bi} style={{ pointerEvents: 'none' }}>
            <rect x={ax - bgW / 2} y={ay - bgH / 2} width={bgW} height={bgH}
              rx={1 / zoom} fill="white" stroke={BORDER} strokeWidth={0.5 / zoom} />
            <text x={ax} y={ay} textAnchor="middle" dominantBaseline="middle"
              fontSize={fs} fontWeight="700" fill={TEXT_SECONDARY}>{lbl}</text>
          </g>
        )
      })}
    </g>
  )
}
