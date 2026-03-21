import { useRef, useCallback, useState } from 'react'
import { TEXT_SECONDARY, BORDER } from '../../../styles/colors'

const RAIL_COLOR = '#642165'
const BAR_W      = 14
const HANDLE_W   = 10
const HANDLE_H   = 10

const snap  = (v) => Math.round(v * 10) / 10
const clamp = (v, mn, mx) => Math.min(mx, Math.max(mn, v))

// Rendered as <g> elements inside the parent SVG.
// barRightX: SVG x position of the bar's right edge (placed left of panel area).
// rl:        result of computeRowRailLayout for the selected row.
// lineRails: { [lineIdx]: [offsetCm, ...] }
// panelDepthsCm: [cm, ...] per line
// pixelToCmRatio, sc: for converting drag deltas to cm
// zoom: CSS scale applied to the SVG container (for drag conversion)
// svgRef: ref to the outer <svg> element
export default function RailCrossSectionOverlay({
  rl,
  lineRails,
  panelDepthsCm,
  keepSymmetry,
  barRightX,
  toSvg,
  pixelToCmRatio,
  sc,
  zoom,
  svgRef,
  onLineChange,
}) {
  const dragging = useRef(null)

  if (!rl) return null

  const { frame, panelLocalRects } = rl
  const { center, angleRad } = frame

  // ─── Compute per-line SVG y-extents from panelLocalRects ─────────────────
  // localToScreen: (lx, ly) → screen (sx, sy)
  // screen_y = center.y + lx * sin(θ) + ly * cos(θ)
  const lineYExtents = {}
  for (const pr of panelLocalRects) {
    const li = pr.line
    // Four corners in local frame
    const corners = [
      [pr.localX,            pr.localY],
      [pr.localX + pr.width, pr.localY],
      [pr.localX,            pr.localY + pr.height],
      [pr.localX + pr.width, pr.localY + pr.height],
    ]
    for (const [lx, ly] of corners) {
      const sy = center.y + lx * Math.sin(angleRad) + ly * Math.cos(angleRad)
      const [, svgY] = toSvg(0, sy)
      if (!lineYExtents[li]) lineYExtents[li] = { minY: svgY, maxY: svgY }
      else {
        lineYExtents[li].minY = Math.min(lineYExtents[li].minY, svgY)
        lineYExtents[li].maxY = Math.max(lineYExtents[li].maxY, svgY)
      }
    }
  }

  const lineIdxs = Object.keys(lineYExtents).map(Number).sort((a, b) => a - b)

  // ─── Rail SVG y positions (from actual computed rail screen coords) ────────
  // Group rails by lineIdx, map to SVG y (use midpoint of start/end)
  const railsByLine = {}
  for (const rail of rl.rails) {
    const midY = (rail.screenStart.y + rail.screenEnd.y) / 2
    const [, svgY] = toSvg(0, midY)
    if (!railsByLine[rail.lineIdx]) railsByLine[rail.lineIdx] = []
    railsByLine[rail.lineIdx].push({ ...rail, svgY })
  }

  const barX = barRightX - BAR_W

  // ─── Drag ─────────────────────────────────────────────────────────────────
  const onMouseDownHandle = useCallback((e, lineIdx, railIdx) => {
    e.preventDefault()
    e.stopPropagation()
    const svgRect  = svgRef.current.getBoundingClientRect()
    const ext      = lineYExtents[lineIdx]
    const depthCm  = panelDepthsCm?.[lineIdx] ?? 238.2
    const rails    = lineRails?.[lineIdx] ?? []

    dragging.current = {
      lineIdx, railIdx,
      startClientY: e.clientY,
      startRails: [...rails],
      svgRect, ext, depthCm,
    }

    const onMove = (me) => {
      const { lineIdx: li, railIdx: ri, startClientY, startRails, svgRect: rect, ext: e2, depthCm: d } = dragging.current
      // 1 client px = 1/zoom SVG px; 1 SVG px = 1/sc screen px; 1 screen px = pixelToCmRatio cm
      // bar is flipped: dragging DOWN → offset decreases
      const deltaCm = -((me.clientY - startClientY) / zoom) * (pixelToCmRatio / sc)
      let newRails  = [...startRails]
      const moved   = snap(clamp(startRails[ri] + deltaCm, 0, d))
      newRails[ri]  = moved

      if (keepSymmetry && newRails.length === 2) {
        const offsetFromEdge = ri === 0 ? moved : d - moved
        newRails[0] = snap(clamp(offsetFromEdge, 0, d / 2))
        newRails[1] = snap(clamp(d - offsetFromEdge, d / 2, d))
      }

      onLineChange(li, [...newRails].sort((a, b) => a - b))
    }
    const onUp = () => {
      dragging.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [rl, lineRails, panelDepthsCm, keepSymmetry, zoom, pixelToCmRatio, sc, svgRef, onLineChange])

  // ─── Add rail ─────────────────────────────────────────────────────────────
  const onBarClick = useCallback((e, lineIdx) => {
    if (dragging.current) return
    e.stopPropagation()
    const svgRect = svgRef.current.getBoundingClientRect()
    const ext     = lineYExtents[lineIdx]
    const depthCm = panelDepthsCm?.[lineIdx] ?? 238.2
    const rails   = lineRails?.[lineIdx] ?? []
    // Convert click to cm (flipped: top = max, bottom = 0)
    const svgY = (e.clientY - svgRect.top) * (rl.frame ? 1 / zoom : 1)
    const localOffsetCm = snap(clamp(
      (ext.maxY - svgY) / (ext.maxY - ext.minY) * depthCm,
      0, depthCm,
    ))
    if (rails.some(r => Math.abs(r - localOffsetCm) < 5)) return
    onLineChange(lineIdx, [...rails, localOffsetCm].sort((a, b) => a - b))
  }, [rl, lineRails, panelDepthsCm, zoom, svgRef, onLineChange])

  // ─── Remove rail ──────────────────────────────────────────────────────────
  const removeRail = useCallback((lineIdx, railIdx, e) => {
    e.stopPropagation()
    const rails = lineRails?.[lineIdx] ?? []
    if (rails.length <= 2) return
    onLineChange(lineIdx, rails.filter((_, i) => i !== railIdx))
  }, [lineRails, onLineChange])

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <g>
      {lineIdxs.map(li => {
        const ext     = lineYExtents[li]
        const barH    = ext.maxY - ext.minY
        const rails   = railsByLine[li] ?? []
        const stored  = lineRails?.[li] ?? []

        return (
          <g key={li}>
            {/* Panel depth bar */}
            <rect
              x={barX} y={ext.minY} width={BAR_W} height={barH}
              fill="#e8f0f8" stroke="#b0c4d8" strokeWidth={0.8}
              style={{ cursor: 'crosshair' }}
              onClick={(e) => onBarClick(e, li)}
            />

            {/* Rails */}
            {rails.map((rail, ri) => {
              const y         = rail.svgY
              const offsetCm  = stored[ri]
              const canRemove = stored.length > 2

              return (
                <g key={ri}
                  onMouseEnter={() => {}}
                  style={{ cursor: 'ns-resize' }}
                >
                  {/* Rail line across bar */}
                  <line
                    x1={barX} y1={y} x2={barX + BAR_W} y2={y}
                    stroke={RAIL_COLOR} strokeWidth={1.5}
                    style={{ pointerEvents: 'none' }}
                  />

                  {/* Offset label */}
                  <text
                    x={barX - 3} y={y + 3}
                    textAnchor="end" fontSize={8} fill={TEXT_SECONDARY}
                    style={{ pointerEvents: 'none' }}
                  >
                    {offsetCm?.toFixed(1)}
                  </text>

                  {/* Draggable + delete handle group */}
                  <DeleteHandle
                    x={barX + BAR_W / 2 - HANDLE_W / 2}
                    y={y - HANDLE_H / 2}
                    w={HANDLE_W} h={HANDLE_H}
                    canRemove={canRemove}
                    onMouseDown={(e) => onMouseDownHandle(e, li, ri)}
                    onDelete={(e) => removeRail(li, ri, e)}
                  />
                </g>
              )
            })}

            {/* Spacing annotation between outermost rails */}
            {stored.length >= 2 && (() => {
              const y1      = rails[0]?.svgY
              const y2      = rails[stored.length - 1]?.svgY
              if (y1 == null || y2 == null) return null
              const spacing = snap(stored[stored.length - 1] - stored[0])
              const midY    = (y1 + y2) / 2
              const annX    = barX - 18
              return (
                <g style={{ pointerEvents: 'none' }}>
                  <line x1={annX + 3} y1={y1} x2={annX + 3} y2={y2} stroke="#ccc" strokeWidth={0.8} />
                  <line x1={annX}     y1={y1} x2={annX + 6} y2={y1} stroke="#ccc" strokeWidth={0.8} />
                  <line x1={annX}     y1={y2} x2={annX + 6} y2={y2} stroke="#ccc" strokeWidth={0.8} />
                  <rect x={annX - 14} y={midY - 7} width={18} height={14} rx={2} fill="white" stroke={BORDER} strokeWidth={0.5} />
                  <text x={annX - 5} y={midY + 3} textAnchor="middle" fontSize={7} fill={TEXT_SECONDARY} fontWeight="700">
                    {spacing}
                  </text>
                </g>
              )
            })()}
          </g>
        )
      })}
    </g>
  )
}

// Handle: drag to move, click (without drag) to delete.
function DeleteHandle({ x, y, w, h, canRemove, onMouseDown, onDelete }) {
  const [hover, setHover] = useState(false)
  const didDrag = useRef(false)

  const handleMouseDown = (e) => {
    didDrag.current = false
    const startY = e.clientY
    const onMove = (me) => { if (Math.abs(me.clientY - startY) > 3) didDrag.current = true }
    const onUp   = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    onMouseDown(e)
  }

  const handleClick = (e) => {
    if (!canRemove || didDrag.current) return
    onDelete(e)
  }

  return (
    <g
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      style={{ cursor: canRemove && hover ? 'pointer' : 'ns-resize' }}
    >
      <rect
        x={x} y={y} width={w} height={h} rx={2}
        fill={hover && canRemove ? '#dc2626' : RAIL_COLOR}
        stroke="white" strokeWidth={1}
      />
      {hover && canRemove && (
        <text x={x + w / 2} y={y + h - 2} textAnchor="middle" fontSize={8} fill="white" fontWeight="700"
          style={{ pointerEvents: 'none' }}>✕</text>
      )}
    </g>
  )
}
