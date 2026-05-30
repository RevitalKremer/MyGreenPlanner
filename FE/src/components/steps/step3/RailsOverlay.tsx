import { AMBER, RAIL_STROKE, RAIL_CONNECTOR, BLACK, BORDER_MID } from '../../../styles/colors'
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
  groupKeyToBeArea = {} as Record<number, any>,
  toSvg,
  sc,
  pixelToCmRatio,
  zoom = 1,
  layers = {} as Record<string, any>,
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
    // Per-row rails vs cross-row rails can be rendered independently so the
    // bases tab can paint cross-row rails AFTER the bases layer (otherwise
    // bases cover the orange lines). Default: render both.
    perRow: showPerRow = true,
    crossRow: showCrossRow = true,
  } = layers

  // ── Helpers ──────────────────────────────────────────────────────────────

  const beSegsFor = (i) => {
    // Resolve BE rails for this layout's area via the FE-unique areaGroupKey →
    // BE area mapping. Using areaGroupKey (a rectArea index) avoids both the
    // numeric collision with BE areaId in a string-keyed lookup AND the
    // assumption that areaLabel is unique.
    const rl = railLayouts[i]
    const pri = rl?._panelRowIdx ?? 0
    const areaKey = rowKeys[i]
    const beArea = groupKeyToBeArea[areaKey]
    const rowBeRails: Record<string, any> = {}
    for (const r of (beArea?.rails ?? [])) {
      if ((r._panelRowIdx ?? 0) === pri) rowBeRails[r.railId] = r
    }
    // Fallback for legacy data without _panelRowIdx: take whatever rails exist
    if (Object.keys(rowBeRails).length === 0) {
      for (const r of (beArea?.rails ?? [])) {
        if (!rowBeRails[r.railId]) rowBeRails[r.railId] = r
      }
    }
    // For multi-rail lines: all rails in the same lineIdx share stock segments,
    // so if exact railId match fails, use any rail from the same lineIdx
    const anySegsForLine: Record<string, any> = {}
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

  // Map railId → crrId for the layout at index `i`. Source rails of
  // a cross-row rail are kept in per-row data but rendered faded so the orange
  // cross-row line stands out on top.
  const concatLookupFor = (i: number) => {
    const rl = railLayouts[i]
    const pri = rl?._panelRowIdx ?? 0
    const areaKey = rowKeys[i]
    const beArea = groupKeyToBeArea[areaKey]
    const map: Record<string, string> = {}
    for (const r of (beArea?.rails ?? [])) {
      if ((r._panelRowIdx ?? 0) === pri && r.crrId) {
        map[r.railId] = r.crrId
      }
    }
    return (railId: string) => map[railId] ?? null
  }

  // ── Material summary (centered label per panel line) ─────────────────

  const renderMaterialSummary = (rl, beSegsFn, railProfile, prefix, concatLookup) => {
    if (!rl.rails.length || !rl.panelLocalRects || !rl.frame) return null
    // Dedupe by (lineIdx, segment-start) — split segments share a lineIdx but
    // each segment needs its own label at its own center; front+back rails of
    // the same segment share stock and should render only once. Virtual rails
    // (absorbed by a cross-row rail) are skipped — the cross-row pass labels them.
    const railBySegment: Record<string, any> = {}
    for (const rail of rl.rails) {
      if (concatLookup && concatLookup(rail.railId)) continue
      const key = `${rail.lineIdx}:${rail.localStart.x.toFixed(3)}`
      if (!(key in railBySegment)) railBySegment[key] = rail
    }
    const { center, angleRad } = rl.frame
    const fontSize = Math.max(9, 11 / zoom)
    const lineRects = {}
    for (const pr of rl.panelLocalRects) {
      if (!lineRects[pr.line]) lineRects[pr.line] = []
      lineRects[pr.line].push(pr)
    }
    return Object.entries(railBySegment).map(([key, segRail]) => {
      const segs = beSegsFn(segRail)
      if (!segs || !segs.length) return null
      const counts = {}
      for (const mm of segs) counts[mm] = (counts[mm] ?? 0) + 1
      const text = Object.entries(counts)
        .sort((a, b) => Number(b[0]) - Number(a[0]))
        .map(([mm, n]) => `${n}×${(Number(mm) / 1000).toFixed(3).replace(/\.?0+$/, '')}m`)
        .join(' +')
      // X center: the rail's own local midpoint (so split rails sit on their
      // own segment, not the line's centroid which would land in the gap).
      const midLX = (segRail.localStart.x + segRail.localEnd.x) / 2
      const rects = lineRects[segRail.lineIdx] ?? []
      const midLY = rects.length > 0
        ? (Math.min(...rects.map(r => r.localY)) + Math.max(...rects.map(r => r.localY + r.height))) / 2
        : segRail.localStart.y
      const sx = center.x + midLX * Math.cos(angleRad) - midLY * Math.sin(angleRad)
      const sy = center.y + midLX * Math.sin(angleRad) + midLY * Math.cos(angleRad)
      const [cx, cy] = toSvg(sx, sy)
      // Calculate rail angle for text rotation
      const [rx1, ry1] = toSvg(segRail.screenStart.x, segRail.screenStart.y)
      const [rx2, ry2] = toSvg(segRail.screenEnd.x, segRail.screenEnd.y)
      const ang = Math.atan2(ry2 - ry1, rx2 - rx1) * 180 / Math.PI
      const bgW = text.length * fontSize * 0.65 + 10 / zoom
      const bgH = fontSize + 6 / zoom
      return (
        <g key={`${prefix}-ms-${key}`} transform={`rotate(${ang}, ${cx}, ${cy})`} style={{ pointerEvents: 'none' }}>
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

  // ── Connector highlights (amber halos for the 'rail-cuts' highlight) ──
  // Drawn under the connector rect; mirrors the position math above so the
  // halo lines up exactly with each segment boundary.
  const renderConnectorHighlights = (rl, beSegsFn, railProfile, prefix) => {
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
      const haloW = Math.max(10, 14 / zoom)
      const haloH = Math.max(14, railProfile + 14 / zoom)
      let cumMm = 0
      return segs.slice(0, -1).map((segMm, si) => {
        cumMm += segMm
        const frac = cumMm / totalMm
        const cx = x1 + ux * frac * railLen, cy = y1 + uy * frac * railLen
        return <rect key={`${prefix}-conn-hl-${rail.railId}-${si}`}
          x={cx - haloW / 2} y={cy - haloH / 2}
          width={haloW} height={haloH} fill={AMBER} rx={2}
          transform={`rotate(${ang}, ${cx}, ${cy})`}
          style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />
      })
    })
  }

  // ── Segment labels (length in mm, first rail per line) ───────────────

  const renderSegmentLabels = (rl, beSegsFn, railProfile, prefix, concatLookup) => {
    if (!rl.panelLocalRects || !rl.frame) return null
    const { center, angleRad } = rl.frame

    // Group panel rects by line to find the edge Y per panel row
    const lineRects = {}
    for (const pr of rl.panelLocalRects) {
      if (!lineRects[pr.line]) lineRects[pr.line] = []
      lineRects[pr.line].push(pr)
    }
    // Cap font size so a 4-char label fits within one panel width
    const smallestPanelW = rl.panelLocalRects.reduce((min, pr) => Math.min(min, pr.width), Infinity)
    const dimMaxFs = isFinite(smallestPanelW) ? (smallestPanelW * sc) / (4 * 0.6) : undefined

    // Dedupe per (lineIdx, segment-start): each segment needs its own dimensions,
    // but front+back rails of the same segment should not double up. Virtual
    // rails are skipped — cross-row pass annotates them.
    const seenSegments = new Set<string>()
    return rl.rails.map(rail => {
      if (concatLookup && concatLookup(rail.railId)) return null
      const segKey = `${rail.lineIdx}:${rail.localStart.x.toFixed(3)}`
      if (seenSegments.has(segKey)) return null
      seenSegments.add(segKey)
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
          <DimensionAnnotation measurePts={measurePts} annPts={annPts} labels={labels} zoom={zoom} maxFontSize={dimMaxFs} />
        </g>
      )
    })
  }

  // ── Cross-row rails (area-level, concatenated across sub-rows) ──────────
  // Sources are NOT stored on the CR itself (no `sourceRails` array). Each
  // per-row rail tagged with `crrId == cr.railId` IS a source — we filter
  // beArea.rails by that flag and then look up the matching FE rail in
  // railLayouts to project its endpoints into screen space.

  const renderCrossRowRails = () => {
    const out: any[] = []
    const fontSize = Math.max(9, 11 / zoom)
    // Dedupe areas (BasesPlanTab has one rowKey per trap → multiple keys per area).
    const seenAreaIds = new Set<any>()
    rowKeys.forEach((areaKey, areaIdx) => {
      const beArea = groupKeyToBeArea[areaKey]
      if (!beArea) return
      const areaIdent = beArea.areaId ?? beArea.areaLabel
      if (seenAreaIds.has(areaIdent)) return
      seenAreaIds.add(areaIdent)
      const crossRails = (beArea.crossRowRails ?? []) as Array<any>
      if (!crossRails.length) return
      // Layouts belonging to this area: match by groupKeyToBeArea lookup
      const areaLayouts = railLayouts
        .map((rl, i) => ({ rl, beArea: groupKeyToBeArea[rowKeys[i]] }))
        .filter(({ beArea: ba }) => ba && (ba.areaId ?? ba.areaLabel) === areaIdent)
      for (const cr of crossRails) {
        // Resolve sources by filtering beArea.rails for crrId == cr.railId,
        // then map each (panelRowIdx, railId) to the matching FE rail layout.
        const sourceRefs = (beArea.rails ?? []).filter((r: any) => r.crrId === cr.railId)
        const sources: any[] = []
        for (const sr of sourceRefs) {
          const match = areaLayouts.find(({ rl }) => (rl?._panelRowIdx ?? 0) === (sr._panelRowIdx ?? 0))
          const sourceRail = match?.rl?.rails.find(r => r.railId === sr.railId)
          if (sourceRail) sources.push(sourceRail)
        }
        if (!sources.length) continue
        // Use the first source's axis. All cross-row source rails are parallel.
        const first = sources[0]
        const dx0 = first.screenEnd.x - first.screenStart.x
        const dy0 = first.screenEnd.y - first.screenStart.y
        const len0 = Math.sqrt(dx0 * dx0 + dy0 * dy0)
        if (len0 < 1) continue
        const ux = dx0 / len0, uy = dy0 / len0
        const ox = first.screenStart.x, oy = first.screenStart.y
        let minT = Infinity, maxT = -Infinity
        for (const s of sources) {
          for (const pt of [s.screenStart, s.screenEnd] as any[]) {
            const t = (pt.x - ox) * ux + (pt.y - oy) * uy
            if (t < minT) minT = t
            if (t > maxT) maxT = t
          }
        }
        const sx = ox + ux * minT, sy = oy + uy * minT
        const ex = ox + ux * maxT, ey = oy + uy * maxT
        const [x1, y1] = toSvg(sx, sy)
        const [x2, y2] = toSvg(ex, ey)
        const railProfile = railProfileFor(areaIdx)
        out.push(
          <line key={`cr-${areaIdx}-${cr.railId}`}
            x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={RAIL_STROKE} strokeWidth={railProfile} strokeLinecap="square"
            style={{ pointerEvents: 'none' }}
          />
        )

        // Material summary label centred on the cross-row rail (replaces what
        // the per-row pass would have drawn for the virtual source rails).
        const segs = (cr.stockSegmentsMm ?? []) as number[]
        if (showMaterialSummary && segs.length > 0) {
          const counts: Record<string, number> = {}
          for (const mm of segs) counts[String(mm)] = (counts[String(mm)] ?? 0) + 1
          const text = Object.entries(counts)
            .sort((a, b) => Number(b[0]) - Number(a[0]))
            .map(([mm, n]) => `${n}×${(Number(mm) / 1000).toFixed(3).replace(/\.?0+$/, '')}m`)
            .join(' +')
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
          const ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI
          const bgW = text.length * fontSize * 0.65 + 10 / zoom
          const bgH = fontSize + 6 / zoom
          out.push(
            <g key={`cr-${areaIdx}-${cr.railId}-ms`} transform={`rotate(${ang}, ${mx}, ${my})`} style={{ pointerEvents: 'none' }}>
              <rect x={mx - bgW / 2} y={my - bgH / 2} width={bgW} height={bgH}
                fill="white" fillOpacity={0.7} stroke={BORDER_MID} strokeWidth={0.5 / zoom} rx={1 / zoom} />
              <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle"
                fontSize={fontSize} fontWeight="700" fill={BLACK}>
                {text}
              </text>
            </g>
          )
        }

        // Segment-cut connectors along the cross-row rail — same shape and
        // dimensions as per-row rail connectors so CRs and Rs look identical.
        if (showConnectors && segs.length > 1) {
          const totalMm = segs.reduce((s, v) => s + v, 0)
          if (totalMm > 0) {
            const sweepDx = x2 - x1, sweepDy = y2 - y1
            const sweepLen = Math.sqrt(sweepDx * sweepDx + sweepDy * sweepDy)
            const uxs = sweepDx / sweepLen, uys = sweepDy / sweepLen
            const ang = Math.atan2(sweepDy, sweepDx) * 180 / Math.PI
            const connW = Math.max(3, 6 / zoom)
            const connH = Math.max(6, railProfile + 6 / zoom)
            let accMm = 0
            for (let si = 0; si < segs.length - 1; si++) {
              accMm += segs[si]
              const frac = accMm / totalMm
              const cx = x1 + uxs * frac * sweepLen
              const cy = y1 + uys * frac * sweepLen
              out.push(
                <rect key={`cr-${areaIdx}-${cr.railId}-cut-${si}`}
                  x={cx - connW / 2} y={cy - connH / 2}
                  width={connW} height={connH} fill={RAIL_CONNECTOR} rx={1}
                  transform={`rotate(${ang}, ${cx}, ${cy})`}
                  style={{ pointerEvents: 'none' }}
                />
              )
            }
          }
        }
      }
    })
    return out
  }

  // ── Render ───────────────────────────────────────────────────────────

  const perRowLayers = railLayouts.map((rl, i) => {
    if (!rl) return null
    const beSegs = beSegsFor(i)
    const concatLookup = concatLookupFor(i)
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
        {showMaterialSummary && renderMaterialSummary(rl, beSegs, railProfile, prefix, concatLookup)}
        {rl.rails.map(rail => {
          const [x1, y1] = toSvg(rail.screenStart.x, rail.screenStart.y)
          const [x2, y2] = toSvg(rail.screenEnd.x, rail.screenEnd.y)
          const dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy)
          if (len < 2) return null
          const ux = dx / len, uy = dy / len
          // Virtual if absorbed by a cross-row rail: render as a dashed
          // placeholder so the source line is visible but clearly subordinate
          // to the orange cross-row rail on top.
          const isConcatSource = !!concatLookup(rail.railId)
          const virtualDash = `${8 / zoom} ${4 / zoom}`
          return (
            <g key={`${prefix}-${rail.railId}`}>
              {showRails && (
                isConcatSource
                  ? <line x1={x1} y1={y1} x2={x2} y2={y2}
                      stroke={RAIL_STROKE} strokeWidth={Math.max(1, railProfile * 0.4)}
                      strokeLinecap="butt" strokeDasharray={virtualDash} opacity={0.45} />
                  : <line x1={x1} y1={y1} x2={x2} y2={y2}
                      stroke={RAIL_STROKE} strokeWidth={railProfile} strokeLinecap="square" />
              )}
              {hlRail && showRails && <>
                <line x1={x1} y1={y1} x2={x1 + ux * overhangSvg} y2={y1 + uy * overhangSvg} stroke={AMBER} strokeWidth={hlW} strokeLinecap="square" style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />
                <line x1={x2 - ux * overhangSvg} y1={y2 - uy * overhangSvg} x2={x2} y2={y2} stroke={AMBER} strokeWidth={hlW} strokeLinecap="square" style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />
              </>}
              {hlProfile && showRails && <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={AMBER} strokeWidth={hlW} strokeLinecap="square" style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />}
            </g>
          )
        })}
        {hlCuts && showRails && renderConnectorHighlights(rl, beSegs, railProfile, prefix)}
        {showConnectors && showRails && renderConnectors(rl, beSegs, railProfile, prefix)}
        {showDimensions && showRails && renderSegmentLabels(rl, beSegs, railProfile, prefix, concatLookup)}
      </g>
    )
  })

  return (
    <>
      {showPerRow && perRowLayers}
      {showRails && showCrossRow && <g key="cross-row-rails">{renderCrossRowRails()}</g>}
    </>
  )
}
