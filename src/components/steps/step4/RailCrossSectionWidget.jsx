import { useRef, useState, useCallback } from 'react'
import { TEXT_SECONDARY, TEXT_VERY_LIGHT, BORDER, BORDER_MID, RAIL_STROKE, DANGER, CHART_BG, CHART_GRID, CHART_BG_ALT, RAIL_STROKE_HOVER } from '../../../styles/colors'
const BAR_W       = 18
const HANDLE_SIZE = 12
const PANEL_GAP_CM = 2.5

const snap = (v) => Math.round(v * 10) / 10
const clamp = (v, min, max) => Math.min(max, Math.max(min, v))

// lines: [{ orientation, depthCm, rails: [offsetCm, ...] }]
// barHeightPx: total visual height of the bar (synced with canvas zoom)
// onLineChange: (lineIdx, newRails) => void
export default function RailCrossSectionWidget({
  lines = [],
  barHeightPx = 240,
  keepSymmetry,
  onLineChange,
}) {
  const svgRef   = useRef(null)
  const dragging = useRef(null)
  const [hoverHandle, setHoverHandle] = useState(null)   // { lineIdx, railIdx }
  const [hoverY,      setHoverY]      = useState(null)   // { svgY, lineIdx }

  // Total depth of all lines + gaps
  const totalDepthCm = lines.reduce((s, l, i) => s + l.depthCm + (i > 0 ? PANEL_GAP_CM : 0), 0)

  // Start offset (cm) for each line within the combined bar
  const lineStartsCm = lines.map((_, i) =>
    lines.slice(0, i).reduce((s, l) => s + l.depthCm + PANEL_GAP_CM, 0)
  )

  const PAD_V = 16
  const svgH  = barHeightPx + PAD_V * 2
  const svgW  = 100
  const barX  = svgW / 2 - BAR_W / 2

  // cm → svg y  (0 cm = bottom, totalDepthCm = top)
  const toY  = (cm) => PAD_V + (1 - cm / totalDepthCm) * barHeightPx
  // svg y → cm within entire bar
  const toCm = (y)  => snap(clamp((1 - (y - PAD_V) / barHeightPx) * totalDepthCm, 0, totalDepthCm))

  // Given a global bar cm, return { lineIdx, localCm } or null if in a gap
  const globalToLocal = (globalCm) => {
    for (let i = 0; i < lines.length; i++) {
      const start = lineStartsCm[i]
      const end   = start + lines[i].depthCm
      if (globalCm >= start && globalCm <= end) {
        return { lineIdx: i, localCm: globalCm - start }
      }
    }
    return null   // in a gap
  }

  // ─── Drag ────────────────────────────────────────────────────────────────

  const onMouseDownHandle = useCallback((e, lineIdx, railIdx) => {
    e.preventDefault()
    e.stopPropagation()
    const svgRect = svgRef.current.getBoundingClientRect()
    dragging.current = { lineIdx, railIdx, startClientY: e.clientY, startRails: [...lines[lineIdx].rails], svgRect }

    const onMove = (me) => {
      const { lineIdx: li, railIdx: ri, startClientY, startRails, svgRect: rect } = dragging.current
      const deltaCm = -((me.clientY - startClientY) / rect.height) * (svgH / barHeightPx) * totalDepthCm
      const line     = lines[li]
      let newRails   = [...startRails]
      const moved    = snap(clamp(startRails[ri] + deltaCm, 0, line.depthCm))
      newRails[ri]   = moved

      if (keepSymmetry && newRails.length === 2) {
        const offsetFromEdge = ri === 0 ? moved : line.depthCm - moved
        newRails[0] = snap(clamp(offsetFromEdge, 0, line.depthCm / 2))
        newRails[1] = snap(clamp(line.depthCm - offsetFromEdge, line.depthCm / 2, line.depthCm))
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
  }, [lines, keepSymmetry, totalDepthCm, barHeightPx, svgH, onLineChange])

  // ─── Add / Remove ────────────────────────────────────────────────────────

  const onBarClick = useCallback((e) => {
    if (dragging.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const svgY = ((e.clientY - rect.top) / rect.height) * svgH
    const globalCm = toCm(svgY)
    const hit = globalToLocal(globalCm)
    if (!hit) return   // clicked in a gap
    const { lineIdx, localCm } = hit
    const existing = lines[lineIdx].rails
    if (existing.some(r => Math.abs(r - localCm) < 5)) return
    const newRails = [...existing, localCm].sort((a, b) => a - b)
    onLineChange(lineIdx, newRails)
    setHoverY(null)
  }, [lines, totalDepthCm, barHeightPx, svgH, onLineChange])

  const onBarMouseMove = useCallback((e) => {
    if (dragging.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const svgY = ((e.clientY - rect.top) / rect.height) * svgH
    const globalCm = toCm(svgY)
    const hit = globalToLocal(globalCm)
    if (!hit) { setHoverY(null); return }
    const { lineIdx, localCm } = hit
    const tooClose = lines[lineIdx].rails.some(r => Math.abs(r - localCm) < 5)
    setHoverY(tooClose ? null : { svgY, lineIdx })
  }, [lines, totalDepthCm, barHeightPx, svgH])

  const removeRail = useCallback((lineIdx, railIdx, e) => {
    e.preventDefault()
    e.stopPropagation()
    if (lines[lineIdx].rails.length <= 2) return
    const newRails = lines[lineIdx].rails.filter((_, i) => i !== railIdx)
    onLineChange(lineIdx, newRails)
    setHoverHandle(null)
  }, [lines, onLineChange])

  // ─── Render ───────────────────────────────────────────────────────────────

  if (!lines.length || totalDepthCm === 0) return null

  return (
    <div style={{ userSelect: 'none', width: `${svgW}px` }}>
      <svg
        ref={svgRef}
        width={svgW} height={svgH}
        style={{ display: 'block', cursor: 'crosshair' }}
        onClick={onBarClick}
        onMouseMove={onBarMouseMove}
        onMouseLeave={() => setHoverY(null)}
      >
        {/* Panel sections */}
        {lines.map((line, li) => {
          const y0 = toY(lineStartsCm[li])
          const y1 = toY(lineStartsCm[li] + line.depthCm)
          return (
            <rect key={`line-${li}`}
              x={barX} y={y0} width={BAR_W} height={y1 - y0}
              fill={CHART_BG} stroke={CHART_GRID} strokeWidth={1}
              style={{ pointerEvents: 'all' }}
            />
          )
        })}

        {/* Gap sections (lighter, no pointer events) */}
        {lines.slice(0, -1).map((line, li) => {
          const gapStart = toY(lineStartsCm[li] + line.depthCm)
          const gapEnd   = toY(lineStartsCm[li + 1])
          return (
            <rect key={`gap-${li}`}
              x={barX} y={gapStart} width={BAR_W} height={gapEnd - gapStart}
              fill={CHART_BG_ALT} stroke={CHART_GRID} strokeWidth={0.5} strokeDasharray="2 2"
              style={{ pointerEvents: 'none' }}
            />
          )
        })}

        {/* Edge labels: totalDepthCm at top, 0 at bottom */}
        <text x={barX - 4} y={PAD_V + 4}              textAnchor="end" fontSize={8} fill={TEXT_VERY_LIGHT}>{totalDepthCm}</text>
        <text x={barX - 4} y={PAD_V + barHeightPx + 1} textAnchor="end" fontSize={8} fill={TEXT_VERY_LIGHT}>0</text>

        {/* Add ghost */}
        {hoverY != null && (
          <g style={{ pointerEvents: 'none', opacity: 0.4 }}>
            <line x1={barX - 2} y1={hoverY.svgY} x2={barX + BAR_W + 2} y2={hoverY.svgY}
              stroke={RAIL_STROKE} strokeWidth={1.5} strokeDasharray="3 2" />
            <text x={barX + BAR_W + 5} y={hoverY.svgY + 4} fontSize={10} fill={RAIL_STROKE} fontWeight="700">+</text>
          </g>
        )}

        {/* Rails per line */}
        {lines.map((line, li) =>
          line.rails.map((localOffsetCm, ri) => {
            const globalCm  = lineStartsCm[li] + localOffsetCm
            const y         = toY(globalCm)
            const isHover   = hoverHandle?.lineIdx === li && hoverHandle?.railIdx === ri
            const canRemove = line.rails.length > 2

            return (
              <g key={`${li}-${ri}`}>
                <line
                  x1={barX} y1={y} x2={barX + BAR_W} y2={y}
                  stroke={RAIL_STROKE} strokeWidth={2}
                  style={{ pointerEvents: 'none' }}
                />
                <text x={barX - 4} y={y + 4} textAnchor="end" fontSize={8} fill={TEXT_SECONDARY}>
                  {localOffsetCm.toFixed(1)}
                </text>
                <g
                  onMouseEnter={() => setHoverHandle({ lineIdx: li, railIdx: ri })}
                  onMouseLeave={() => setHoverHandle(null)}
                >
                  <rect
                    x={barX + BAR_W / 2 - HANDLE_SIZE / 2}
                    y={y - HANDLE_SIZE / 2}
                    width={HANDLE_SIZE} height={HANDLE_SIZE}
                    rx={2}
                    fill={isHover ? RAIL_STROKE_HOVER : RAIL_STROKE}
                    stroke="white" strokeWidth={1.5}
                    style={{ cursor: 'ns-resize' }}
                    onMouseDown={(e) => onMouseDownHandle(e, li, ri)}
                  />
                  {isHover && canRemove && (
                    <g
                      transform={`translate(${barX + BAR_W / 2 - HANDLE_SIZE / 2}, ${y - HANDLE_SIZE / 2})`}
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => removeRail(li, ri, e)}
                    >
                      <rect x={0} y={0} width={HANDLE_SIZE} height={HANDLE_SIZE} rx={2}
                        fill={DANGER} stroke="white" strokeWidth={1.5} />
                      <text x={HANDLE_SIZE / 2} y={HANDLE_SIZE - 3} textAnchor="middle" fontSize={9} fill="white" fontWeight="700">✕</text>
                    </g>
                  )}
                </g>
              </g>
            )
          })
        )}

        {/* Spacing annotation between first and last rail within each line */}
        {lines.map((line, li) => {
          if (line.rails.length < 2) return null
          const y1      = toY(lineStartsCm[li] + line.rails[0])
          const y2      = toY(lineStartsCm[li] + line.rails[line.rails.length - 1])
          const spacing = snap(line.rails[line.rails.length - 1] - line.rails[0])
          const midY    = (y1 + y2) / 2
          const annX    = barX - 20
          return (
            <g key={`ann-${li}`} style={{ pointerEvents: 'none' }}>
              <line x1={annX + 4} y1={y1} x2={annX + 4} y2={y2} stroke={BORDER_MID} strokeWidth={1} />
              <line x1={annX} y1={y1} x2={annX + 8} y2={y1} stroke={BORDER_MID} strokeWidth={1} />
              <line x1={annX} y1={y2} x2={annX + 8} y2={y2} stroke={BORDER_MID} strokeWidth={1} />
              <rect x={annX - 16} y={midY - 8} width={22} height={16} rx={2} fill="white" stroke={BORDER} strokeWidth={0.5} />
              <text x={annX - 5} y={midY + 4} textAnchor="middle" fontSize={8} fill={TEXT_SECONDARY} fontWeight="700">
                {spacing}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
