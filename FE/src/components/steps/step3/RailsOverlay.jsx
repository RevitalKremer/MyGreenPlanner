import { AMBER, RAIL_STROKE, RAIL_CONNECTOR, BLACK } from '../../../styles/colors'
import DimensionAnnotation from './DimensionAnnotation'

/**
 * RailsOverlay — renders rail lines, material summary, connectors,
 * segment labels, and highlight overlays for a list of rail layouts.
 *
 * Shared by both edit and print modes of RailLayoutTab.
 */
export default function RailsOverlay({
  railLayouts,
  rowKeys,
  rowGroups,
  beRailByKey = {},
  groupKeyToLabel = {},
  toSvg,
  sc,
  pixelToCmRatio,
  zoom = 1,
  layers = {},
  crossRailEdgeDistMm = 50,
  railOverhangCm = 10,
  selectedRowIdx = null,
  highlightGroup = null,
  trapSettingsMap = {},
}) {
  const {
    rails: showRails = true,
    dimensions: showDimensions = true,
    materialSummary: showMaterialSummary = true,
    connectors: showConnectors = true,
  } = layers

  // ── Helpers ──────────────────────────────────────────────────────────────

  const beSegsFor = (i) => {
    // Pre-resolve: find ALL BE rails for this layout's area + panelRowIdx
    const rl = railLayouts[i]
    const pri = rl?._panelRowIdx ?? 0
    const areaKey = rowKeys[i]
    const areaLabel = groupKeyToLabel[areaKey] ?? areaKey
    // Collect all BE rails matching this area + row, keyed by railId
    // Try both numeric areaKey and resolved label
    const rowBeRails = {}
    for (const [k, v] of Object.entries(beRailByKey)) {
      if (k === `${areaKey}:${pri}:${v.railId}` || k === `${areaLabel}:${pri}:${v.railId}`) rowBeRails[v.railId] = v
    }
    // Also try legacy keys as fallback
    if (Object.keys(rowBeRails).length === 0) {
      for (const [k, v] of Object.entries(beRailByKey)) {
        if (k === `${areaKey}:${v.railId}` || k === `${areaLabel}:${v.railId}`) rowBeRails[v.railId] = v
      }
    }
    // For multi-rail lines: all rails in the same lineIdx share stock segments,
    // so if exact railId match fails, use any rail from the same lineIdx
    const anySegsForLine = {}
    for (const v of Object.values(rowBeRails)) {
      if (!anySegsForLine[v.lineIdx]) anySegsForLine[v.lineIdx] = v.stockSegmentsMm
    }

    return (rail) => {
      const be = rowBeRails[rail.railId]
      if (be) return be.stockSegmentsMm ?? []
      // Fallback: any BE rail from the same line
      return anySegsForLine[rail.lineIdx] ?? []
    }
  }

  const railProfileFor = (i) => {
    const firstTrapId = rowGroups[rowKeys[i]]?.[0]?.trapezoidId
    const crd = crossRailEdgeDistMm ?? trapSettingsMap[firstTrapId]?.crossRailEdgeDistMm ?? 50
    return (crd / 10 / pixelToCmRatio) * sc
  }

  // ── Material summary (centered label per panel line) ─────────────────

  const renderMaterialSummary = (rl, beSegsFn, railProfile, prefix) => {
    if (!rl.rails.length || !rl.panelLocalRects || !rl.frame) return null
    const railByLine = {}
    for (const rail of rl.rails) {
      if (!(rail.lineIdx in railByLine)) railByLine[rail.lineIdx] = rail
    }
    const { center, angleRad } = rl.frame
    const fontSize = Math.max(9, 11 / zoom)
    const lineRects = {}
    for (const pr of rl.panelLocalRects) {
      if (!lineRects[pr.line]) lineRects[pr.line] = []
      lineRects[pr.line].push(pr)
    }
    return Object.entries(lineRects).map(([li, rects]) => {
      const lineRail = railByLine[li]
      if (!lineRail) return null
      const segs = beSegsFn(lineRail)
      if (!segs || !segs.length) return null
      const counts = {}
      for (const mm of segs) counts[mm] = (counts[mm] ?? 0) + 1
      const text = Object.entries(counts)
        .sort((a, b) => Number(b[0]) - Number(a[0]))
        .map(([mm, n]) => `${n}×${(Number(mm) / 1000).toFixed(3).replace(/\.?0+$/, '')}m`)
        .join(' +')
      const midLX = (Math.min(...rects.map(r => r.localX)) + Math.max(...rects.map(r => r.localX + r.width))) / 2
      const midLY = (Math.min(...rects.map(r => r.localY)) + Math.max(...rects.map(r => r.localY + r.height))) / 2
      const sx = center.x + midLX * Math.cos(angleRad) - midLY * Math.sin(angleRad)
      const sy = center.y + midLX * Math.sin(angleRad) + midLY * Math.cos(angleRad)
      const [cx, cy] = toSvg(sx, sy)
      // Calculate rail angle for text rotation
      const [rx1, ry1] = toSvg(lineRail.screenStart.x, lineRail.screenStart.y)
      const [rx2, ry2] = toSvg(lineRail.screenEnd.x, lineRail.screenEnd.y)
      const ang = Math.atan2(ry2 - ry1, rx2 - rx1) * 180 / Math.PI
      const bgW = text.length * fontSize * 0.65 + 10 / zoom
      const bgH = fontSize + 6 / zoom
      return (
        <g key={`${prefix}-ms-${li}`} transform={`rotate(${ang}, ${cx}, ${cy})`} style={{ pointerEvents: 'none' }}>
          <rect x={cx - bgW / 2} y={cy - bgH / 2} width={bgW} height={bgH}
            fill="white" fillOpacity={0.7} stroke="#ccc" strokeWidth={0.5 / zoom} rx={1 / zoom} />
          <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
            fontSize={fontSize} fontWeight="700" fill={BLACK}>
            {text}
          </text>
        </g>
      )
    })
  }

  // ── Connectors (cyan rects at segment boundaries, all rails) ─────────

  const renderConnectors = (rl, beSegsFn, railProfile, prefix) => {
    return rl.rails.map(rail => {
      const segs = beSegsFn(rail)
      if (!segs || segs.length < 2) return null
      const [x1, y1] = toSvg(rail.screenStart.x, rail.screenStart.y)
      const [x2, y2] = toSvg(rail.screenEnd.x, rail.screenEnd.y)
      const dx = x2 - x1, dy = y2 - y1, railLen = Math.sqrt(dx * dx + dy * dy)
      if (railLen < 2) return null
      const ux = dx / railLen, uy = dy / railLen
      const totalMm = segs.reduce((s, v) => s + v, 0)
      const ang = Math.atan2(dy, dx) * 180 / Math.PI
      const connW = Math.max(3, 6 / zoom), connH = Math.max(6, railProfile + 6 / zoom)
      let cumMm = 0
      return segs.slice(0, -1).map((segMm, si) => {
        cumMm += segMm
        const frac = cumMm / totalMm
        const cx = x1 + ux * frac * railLen, cy = y1 + uy * frac * railLen
        return <rect key={`${prefix}-conn-${rail.railId}-${si}`}
          x={cx - connW / 2} y={cy - connH / 2}
          width={connW} height={connH} fill={RAIL_CONNECTOR} rx={1}
          transform={`rotate(${ang}, ${cx}, ${cy})`}
          style={{ pointerEvents: 'none' }} />
      })
    })
  }

  // ── Segment labels (length in mm, first rail per line) ───────────────

  const renderSegmentLabels = (rl, beSegsFn, railProfile, prefix) => {
    if (!rl.panelLocalRects || !rl.frame) return null
    const { center, angleRad } = rl.frame

    // Group panel rects by line to find the edge Y per panel row
    const lineRects = {}
    for (const pr of rl.panelLocalRects) {
      if (!lineRects[pr.line]) lineRects[pr.line] = []
      lineRects[pr.line].push(pr)
    }

    const seenLines = new Set()
    return rl.rails.map(rail => {
      if (seenLines.has(rail.lineIdx)) return null
      seenLines.add(rail.lineIdx)
      const segs = beSegsFn(rail)
      if (!segs || segs.length < 1) return null
      const [x1, y1] = toSvg(rail.screenStart.x, rail.screenStart.y)
      const [x2, y2] = toSvg(rail.screenEnd.x, rail.screenEnd.y)
      const dx = x2 - x1, dy = y2 - y1, railLen = Math.sqrt(dx * dx + dy * dy)
      if (railLen < 2) return null
      const ux = dx / railLen, uy = dy / railLen
      const totalMm = segs.reduce((s, v) => s + v, 0)

      // Place annotation on the panel row edge (maxY in local coords),
      // not offset from the rail, so labels don't overlap adjacent rows.
      const rects = lineRects[rail.lineIdx] ?? []
      const edgeLocalY = rects.length > 0
        ? Math.max(...rects.map(r => r.localY + r.height))
        : null

      const boundsMm = [0]
      let acc = 0
      for (const segMm of segs) { acc += segMm; boundsMm.push(acc) }

      const measurePts = boundsMm.map(mm => {
        const dPx = (mm / totalMm) * railLen
        return [x1 + ux * dPx, y1 + uy * dPx]
      })

      // Annotation points: project each rail X position onto the panel row edge Y
      // so labels sit on the edge and don't overlap adjacent rows.
      const lsX = rail.localStart.x, leX = rail.localEnd.x
      const annPts = edgeLocalY != null
        ? boundsMm.map(mm => {
            const frac = mm / totalMm
            const lx = lsX + frac * (leX - lsX)
            const sx = center.x + lx * Math.cos(angleRad) - edgeLocalY * Math.sin(angleRad)
            const sy = center.y + lx * Math.sin(angleRad) + edgeLocalY * Math.cos(angleRad)
            return toSvg(sx, sy)
          })
        : measurePts.map(([px, py]) => {
            const perpX = -uy, perpY = ux
            const off = railProfile / 2 + 18 + zoom * 2
            return [px + perpX * off, py + perpY * off]
          })

      const labels = segs.map(mm => String(mm))

      return (
        <g key={`${prefix}-segs-${rail.railId}`}>
          <DimensionAnnotation measurePts={measurePts} annPts={annPts} labels={labels} zoom={zoom} />
        </g>
      )
    })
  }

  // ── Render ───────────────────────────────────────────────────────────

  return railLayouts.map((rl, i) => {
    if (!rl) return null
    const beSegs = beSegsFor(i)
    const railProfile = railProfileFor(i)
    const overhangSvg = (railOverhangCm / pixelToCmRatio) * sc
    const hlW = railProfile + 6
    const hlRail    = highlightGroup === 'rail-ends'
    const hlCuts    = highlightGroup === 'rail-cuts'
    const hlProfile = highlightGroup === 'cross-rails'
    const hlSpacingV = highlightGroup === 'railSpacingV'
    const hlSpacingH = highlightGroup === 'railSpacingH'
    const railOpacity = 1
    const prefix = `rl-${i}`

    // Gap polygons between adjacent rails of the highlighted orientation
    const spacingGaps = (hlSpacingV || hlSpacingH) && showRails ? (() => {
      const targetOrientation = hlSpacingV ? 'PORTRAIT' : 'LANDSCAPE'
      const sorted = rl.rails
        .filter(r => r.orientation === targetOrientation)
        .map(r => {
          const [x1, y1] = toSvg(r.screenStart.x, r.screenStart.y)
          const [x2, y2] = toSvg(r.screenEnd.x, r.screenEnd.y)
          return { x1, y1, x2, y2, midPerp: hlSpacingV ? (x1 + x2) / 2 : (y1 + y2) / 2 }
        })
        .sort((a, b) => a.midPerp - b.midPerp)
      if (sorted.length < 2) return null
      const sw = 6 / zoom
      const r = sorted[0], n = sorted[1]
      const mx1 = (r.x1 + r.x2) / 2, my1 = (r.y1 + r.y2) / 2
      const mx2 = (n.x1 + n.x2) / 2, my2 = (n.y1 + n.y2) / 2
      return (
        <line key="gap-0"
          x1={mx1} y1={my1} x2={mx2} y2={my2}
          stroke={AMBER} strokeWidth={sw} strokeDasharray={`${6/zoom} ${3/zoom}`}
          style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }}
        />
      )
    })() : null

    return (
      <g key={i} opacity={railOpacity}>
        {spacingGaps}
        {showMaterialSummary && renderMaterialSummary(rl, beSegs, railProfile, prefix)}
        {rl.rails.map(rail => {
          const [x1, y1] = toSvg(rail.screenStart.x, rail.screenStart.y)
          const [x2, y2] = toSvg(rail.screenEnd.x, rail.screenEnd.y)
          const dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy)
          if (len < 2) return null
          const ux = dx / len, uy = dy / len
          return (
            <g key={`${prefix}-${rail.railId}`}>
              {showRails && <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={RAIL_STROKE} strokeWidth={railProfile} strokeLinecap="square" />}
              {hlRail && showRails && <>
                <line x1={x1} y1={y1} x2={x1 + ux * overhangSvg} y2={y1 + uy * overhangSvg} stroke={AMBER} strokeWidth={hlW} strokeLinecap="square" style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />
                <line x1={x2 - ux * overhangSvg} y1={y2 - uy * overhangSvg} x2={x2} y2={y2} stroke={AMBER} strokeWidth={hlW} strokeLinecap="square" style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />
              </>}
              {hlCuts && showRails && <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={AMBER} strokeWidth={hlW} strokeLinecap="square" style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />}
              {hlProfile && showRails && <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={AMBER} strokeWidth={hlW} strokeLinecap="square" style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />}
            </g>
          )
        })}
        {showConnectors && showRails && renderConnectors(rl, beSegs, railProfile, prefix)}
        {showDimensions && showRails && renderSegmentLabels(rl, beSegs, railProfile, prefix)}
      </g>
    )
  })
}
