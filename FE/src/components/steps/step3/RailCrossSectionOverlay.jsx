import { useRef, useCallback, useState } from 'react'
import { TEXT_SECONDARY, BORDER, BORDER_MID, RAIL_STROKE, DANGER, CHART_BG, CHART_GRID } from '../../../styles/colors'
import { localToScreen } from '../../../utils/railLayoutService'

const BAR_W   = 14  // SVG pixels wide
const BAR_GAP = 6   // SVG pixels gap between panels and bar
const HANDLE_W = 10
const HANDLE_H = 10

const snap  = (v) => Math.round(v * 10) / 10
const clamp = (v, mn, mx) => Math.min(mx, Math.max(mn, v))

// Rendered as <g> elements inside the parent SVG.
// Bar is drawn along the area's local Y axis (slope direction), adjacent to
// the left edge of the panels in local X.
//
// Units: panelLocalRects.localX/Y are in SCREEN PIXELS (same frame as center).
// Rail offsets (lineRails) are in cm. Conversions:
//   screen px → cm:  * pixelToCmRatio
//   cm → screen px:  / pixelToCmRatio
//   SVG px → screen px: / sc
//   screen px → SVG px: * sc
export default function RailCrossSectionOverlay({
  rl,
  lineRails,
  panelDepthsCm,
  keepSymmetry,
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
  if (!frame || !panelLocalRects?.length) return null

  const { center, angleRad } = frame
  const cosA = Math.cos(angleRad), sinA = Math.sin(angleRad)

  // Bar dimensions in screen pixels (matching the local-frame unit)
  const barW_sc   = BAR_W   / sc   // SVG px → screen px
  const barGap_sc = BAR_GAP / sc

  // Convert local-frame (screen px) coords to SVG coords
  const toSvgLocal = (lx_sc, ly_sc) => {
    const s = localToScreen({ x: lx_sc, y: ly_sc }, center, angleRad)
    return toSvg(s.x, s.y)
  }

  // ─── Per-line local extents (screen pixels) from panelLocalRects ──────────
  // Convention (from computeRowRailLayout):
  //   Larger localY = front of panel (lower on slope).
  //   lineLocalExtents[li].maxY = front edge, .minY = back edge.
  //   depth = (maxY - minY) * pixelToCmRatio
  const lineLocalExtents = {}
  for (const pr of panelLocalRects) {
    const li = pr.line
    if (!lineLocalExtents[li]) {
      lineLocalExtents[li] = {
        minX: pr.localX,               maxX: pr.localX + pr.width,
        minY: pr.localY,               maxY: pr.localY + pr.height,
      }
    } else {
      lineLocalExtents[li].minX = Math.min(lineLocalExtents[li].minX, pr.localX)
      lineLocalExtents[li].maxX = Math.max(lineLocalExtents[li].maxX, pr.localX + pr.width)
      lineLocalExtents[li].minY = Math.min(lineLocalExtents[li].minY, pr.localY)
      lineLocalExtents[li].maxY = Math.max(lineLocalExtents[li].maxY, pr.localY + pr.height)
    }
  }

  const lineIdxs = Object.keys(lineLocalExtents).map(Number).sort((a, b) => a - b)

  // ─── Drag ─────────────────────────────────────────────────────────────────
  const onMouseDownHandle = useCallback((e, lineIdx, railIdx) => {
    e.preventDefault()
    e.stopPropagation()
    const depthCm = panelDepthsCm?.[lineIdx] ?? 238.2
    const rails   = lineRails?.[lineIdx] ?? []

    dragging.current = {
      lineIdx, railIdx,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startRails: [...rails],
      depthCm,
    }

    const onMove = (me) => {
      const { lineIdx: li, railIdx: ri, startClientX, startClientY, startRails, depthCm: d } = dragging.current
      // Project mouse movement (client px) onto local Y axis direction (-sinA, cosA).
      // client px / zoom = SVG px; SVG px / sc = screen px; screen px * pixelToCmRatio = cm.
      // Moving toward front (+localY) decreases offsetCm → negate.
      const deltaAlongY_clientPx = (me.clientX - startClientX) * (-sinA) + (me.clientY - startClientY) * cosA
      const deltaCm = -(deltaAlongY_clientPx / zoom / sc) * pixelToCmRatio
      let newRails  = [...startRails]
      const moved   = snap(clamp(startRails[ri] + deltaCm, 0, d))
      newRails[ri]  = moved

      if (keepSymmetry && newRails.length === 2) {
        const offsetFromEdge = ri === 0 ? moved : d - moved
        newRails[0] = snap(clamp(offsetFromEdge,     0,   d / 2))
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
  }, [rl, lineRails, panelDepthsCm, keepSymmetry, zoom, pixelToCmRatio, sc, onLineChange])  // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Add rail (click on bar) ──────────────────────────────────────────────
  const onBarClick = useCallback((e, lineIdx) => {
    if (dragging.current) return
    e.stopPropagation()
    const svgRect = svgRef.current.getBoundingClientRect()
    const ext     = lineLocalExtents[lineIdx]
    const depthCm = panelDepthsCm?.[lineIdx] ?? 238.2
    const rails   = lineRails?.[lineIdx] ?? []

    // Click in SVG coordinates (account for CSS zoom scale on container)
    const svgX = (e.clientX - svgRect.left) / zoom
    const svgY = (e.clientY - svgRect.top)  / zoom

    // Project SVG click onto local Y axis.
    // Reference: top of bar at (barRight_sc, ext.minY) in local frame.
    const barRight_sc = ext.minX - barGap_sc
    const [refX, refY] = toSvgLocal(barRight_sc, ext.minY)
    const deltaAlongY_svgPx = (svgX - refX) * (-sinA) + (svgY - refY) * cosA
    // Convert SVG px delta to local screen-pixel delta, then to cm offset
    const localY_sc = ext.minY + deltaAlongY_svgPx / sc
    const localOffsetCm = snap(clamp((ext.maxY - localY_sc) * pixelToCmRatio, 0, depthCm))

    if (rails.some(r => Math.abs(r - localOffsetCm) < 5)) return
    onLineChange(lineIdx, [...rails, localOffsetCm].sort((a, b) => a - b))
  }, [rl, lineRails, panelDepthsCm, zoom, svgRef, onLineChange])  // eslint-disable-line react-hooks/exhaustive-deps

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
        const ext    = lineLocalExtents[li]
        const stored = lineRails?.[li] ?? []

        // Bar: to the left of panels in local X (screen px units)
        const barRight = ext.minX - barGap_sc
        const barLeft  = barRight - barW_sc
        const barMidX  = (barLeft + barRight) / 2

        // Four corners of bar polygon (local screen px → SVG)
        const [tlx, tly]  = toSvgLocal(barLeft,  ext.minY)   // back-left
        const [trx, try_] = toSvgLocal(barRight, ext.minY)   // back-right
        const [brx, bry]  = toSvgLocal(barRight, ext.maxY)   // front-right
        const [blx, bly]  = toSvgLocal(barLeft,  ext.maxY)   // front-left

        // Rail at offsetCm is at localY = ext.maxY - offsetCm/pixelToCmRatio
        // (front edge at ext.maxY → offset=0; back edge at ext.minY → offset=depthCm)
        const labelOffset = 3 / sc   // 3 SVG px in screen px
        const railPositions = stored.map((offsetCm) => {
          const localY = ext.maxY - offsetCm / pixelToCmRatio
          return {
            offsetCm,
            left:  toSvgLocal(barLeft,           localY),
            right: toSvgLocal(barRight,          localY),
            mid:   toSvgLocal(barMidX,           localY),
            label: toSvgLocal(barLeft - labelOffset, localY),
          }
        })

        return (
          <g key={li}>
            {/* Panel depth bar (rotated polygon along area Y axis) */}
            <polygon
              points={`${tlx},${tly} ${trx},${try_} ${brx},${bry} ${blx},${bly}`}
              fill={CHART_BG} stroke={CHART_GRID} strokeWidth={0.8}
              style={{ cursor: 'crosshair' }}
              onClick={(e) => onBarClick(e, li)}
            />

            {/* Rail lines and handles */}
            {railPositions.map((rp, ri) => {
              const canRemove = stored.length > 2
              return (
                <g key={ri} style={{ cursor: 'ns-resize' }}>
                  <line
                    x1={rp.left[0]} y1={rp.left[1]} x2={rp.right[0]} y2={rp.right[1]}
                    stroke={RAIL_STROKE} strokeWidth={1.5}
                    style={{ pointerEvents: 'none' }}
                  />
                  <text
                    x={rp.label[0]} y={rp.label[1] + 3}
                    textAnchor="end" fontSize={8} fill={TEXT_SECONDARY}
                    style={{ pointerEvents: 'none' }}
                  >
                    {rp.offsetCm?.toFixed(1)}
                  </text>
                  <DeleteHandle
                    x={rp.mid[0] - HANDLE_W / 2}
                    y={rp.mid[1] - HANDLE_H / 2}
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
              const r0 = railPositions[0]
              const rN = railPositions[stored.length - 1]
              if (!r0 || !rN) return null
              const spacing = snap(stored[stored.length - 1] - stored[0])
              const annX    = barLeft - 18 / sc   // 18 SVG px in screen px
              const tickW   = 3 / sc               // 3 SVG px in screen px
              const [a0x, a0y] = toSvgLocal(annX, ext.maxY - stored[0]             / pixelToCmRatio)
              const [aNx, aNy] = toSvgLocal(annX, ext.maxY - stored[stored.length - 1] / pixelToCmRatio)
              const [t0ax, t0ay] = toSvgLocal(annX - tickW, ext.maxY - stored[0]             / pixelToCmRatio)
              const [t0bx, t0by] = toSvgLocal(annX + tickW, ext.maxY - stored[0]             / pixelToCmRatio)
              const [tNax, tNay] = toSvgLocal(annX - tickW, ext.maxY - stored[stored.length - 1] / pixelToCmRatio)
              const [tNbx, tNby] = toSvgLocal(annX + tickW, ext.maxY - stored[stored.length - 1] / pixelToCmRatio)
              const midX = (a0x + aNx) / 2
              const midY = (a0y + aNy) / 2
              return (
                <g style={{ pointerEvents: 'none' }}>
                  <line x1={a0x} y1={a0y} x2={aNx} y2={aNy} stroke={BORDER_MID} strokeWidth={0.8} />
                  <line x1={t0ax} y1={t0ay} x2={t0bx} y2={t0by} stroke={BORDER_MID} strokeWidth={0.8} />
                  <line x1={tNax} y1={tNay} x2={tNbx} y2={tNby} stroke={BORDER_MID} strokeWidth={0.8} />
                  <rect x={midX - 9} y={midY - 7} width={18} height={14} rx={2} fill="white" stroke={BORDER} strokeWidth={0.5} />
                  <text x={midX} y={midY + 3} textAnchor="middle" fontSize={7} fill={TEXT_SECONDARY} fontWeight="700">
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

// ─── Handle: drag to move, click (without drag) to delete ────────────────────
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
        fill={hover && canRemove ? DANGER : RAIL_STROKE}
        stroke="white" strokeWidth={1}
      />
      {hover && canRemove && (
        <text x={x + w / 2} y={y + h - 2} textAnchor="middle" fontSize={8} fill="white" fontWeight="700"
          style={{ pointerEvents: 'none' }}>✕</text>
      )}
    </g>
  )
}
