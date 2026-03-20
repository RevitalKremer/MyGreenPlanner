import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { computeRowRailLayout, DEFAULT_RAIL_OVERHANG_CM, DEFAULT_STOCK_LENGTHS_MM } from '../../../utils/railLayoutService'
import CanvasNavigator from '../../shared/CanvasNavigator'
import { useCanvasPanZoom } from '../../../hooks/useCanvasPanZoom'
import { getPanelsBoundingBox, buildRowGroups } from './tabUtils'
import HatchedPanels from './HatchedPanels'
import LayersPanel from './LayersPanel'
import RailsTable from './RailsTable'
import RailCrossSectionOverlay from './RailCrossSectionOverlay'

const RAIL_COLOR_FILL = '#642165'

export default function RailLayoutTab({
  panels = [], refinedArea, selectedRowIdx = null,
  settings = {},
  lineRails,           // { [lineIdx]: [offsetCm, ...] }
  panelDepthsCm,       // [depthCm, ...]
  keepSymmetry,
  onLineRailsChange,   // (newLineRails) => void
  onApplyRailsToAll,
  onResetRails,
  highlightGroup = null,
}) {
  const railOverhangCm      = settings.railOverhangCm      ?? DEFAULT_RAIL_OVERHANG_CM
  const stockLengths        = settings.stockLengths        ?? DEFAULT_STOCK_LENGTHS_MM
  const crossRailEdgeDistMm = settings.crossRailEdgeDistMm ?? 40

  const svgRef = useRef(null)

  const [showRails,           setShowRails]           = useState(true)
  const [showDimensions,      setShowDimensions]      = useState(true)
  const [showMaterialSummary, setShowMaterialSummary] = useState(true)
  const [showCrossSection,    setShowCrossSection]    = useState(true)
  const [tableOpen,           setTableOpen]           = useState(false)

  const { zoom, setZoom, panOffset, setPanOffset, panActive, containerRef, contentRef, startPan, handleMouseMove, stopPan, resetView, MM_W, MM_H, panToMinimapPoint, getMinimapViewportRect } = useCanvasPanZoom()

  const pixelToCmRatio = refinedArea?.pixelToCmRatio ?? 1
  const railConfig = useMemo(() => ({
    lineRails,
    overhangCm: railOverhangCm,
    stockLengths,
  }), [lineRails, railOverhangCm, stockLengths])

  const { map: rowGroups, keys: rowKeys } = useMemo(() => buildRowGroups(panels), [panels])

  const railLayouts = useMemo(() =>
    rowKeys.map(rowKey => computeRowRailLayout(rowGroups[rowKey], pixelToCmRatio, railConfig)),
    [rowKeys, rowGroups, pixelToCmRatio, railConfig]
  )

  const totalRails    = railLayouts.reduce((s, rl) => s + (rl?.rails.length ?? 0), 0)
  const totalLeftover = railLayouts.reduce((s, rl) => s + (rl?.rails.reduce((rs, r) => rs + r.leftoverMm, 0) ?? 0), 0)

  const bbox = useMemo(() => {
    if (panels.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 }
    return getPanelsBoundingBox(panels)
  }, [panels])

  const PAD = 24, PAD_LEFT = 180, MAX_W = 900
  const bboxW = bbox.maxX - bbox.minX, bboxH = bbox.maxY - bbox.minY
  const sc = bboxW > 0 ? MAX_W / bboxW : 1
  const svgW = MAX_W + PAD_LEFT + PAD, svgH = bboxH * sc + PAD * 2
  const toSvgFn = (sx, sy) => [PAD_LEFT + (sx - bbox.minX) * sc, PAD + (sy - bbox.minY) * sc]

  // Auto-pan to the selected row when selectedRowIdx changes
  useEffect(() => {
    if (selectedRowIdx == null) return
    const selectedKey = rowKeys[selectedRowIdx]
    const rowPanels   = rowGroups[selectedKey] ?? []
    if (rowPanels.length === 0) return
    const rb = getPanelsBoundingBox(rowPanels)
    const cx = PAD_LEFT + ((rb.minX + rb.maxX) / 2 - bbox.minX) * sc
    const cy = PAD     + ((rb.minY + rb.maxY) / 2 - bbox.minY) * sc
    const CONTENT_PAD = 20   // 1.25rem padding around svg
    requestAnimationFrame(() => {
      if (!containerRef.current) return
      const { width: cw, height: ch } = containerRef.current.getBoundingClientRect()
      setPanOffset({
        x: cw / 2 - (cx + CONTENT_PAD) * zoom,
        y: ch / 2 - (cy + CONTENT_PAD) * zoom,
      })
    })
  }, [selectedRowIdx, rowKeys, rowGroups, bbox, sc, zoom])   // eslint-disable-line react-hooks/exhaustive-deps

  if (rowKeys.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#aaa', fontSize: '0.95rem' }}>
        No panel rows found — complete Step 3 first.
      </div>
    )
  }

  const toSvg = toSvgFn
  const svgCentX = PAD_LEFT + (bboxW / 2) * sc, svgCentY = PAD + (bboxH / 2) * sc


  // Keep a stable ref to the latest lineRails so the overlay's drag closure always
  // merges with current values even if it captured a stale handleLineRailsChange.
  const lineRailsRef = useRef(lineRails)
  lineRailsRef.current = lineRails

  // Handler: update one line's rail offsets
  const handleLineRailsChange = useCallback((lineIdx, newOffsets) => {
    onLineRailsChange({ ...lineRailsRef.current, [lineIdx]: newOffsets })
  }, [onLineRailsChange])

  // Pick the active row layout for cross-section overlay
  const activeCrossSectionRl = railLayouts[selectedRowIdx ?? 0] ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'white', position: 'relative' }}>

      <div style={{ display: 'flex', flex: '1 1 0', minHeight: 0, overflow: 'hidden' }}>

        {/* ── Diagram canvas ── */}
        <div
          style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden', background: '#fafafa', cursor: panActive ? 'grabbing' : 'grab' }}
          onMouseDown={startPan} onMouseMove={handleMouseMove} onMouseUp={stopPan} onMouseLeave={stopPan}
          ref={containerRef}
        >
          <div style={{ transform: `translate(${panOffset.x}px, ${panOffset.y}px)`, transformOrigin: 'top left' }}>
            <div ref={contentRef} style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
              <div style={{ padding: '1.25rem 1.25rem 0' }}>
                <svg ref={svgRef} width={svgW} height={svgH} style={{ display: 'block' }}>
                  <defs><style>{`@keyframes hlPulse { 0%,100%{opacity:0.15} 50%{opacity:0.9} }`}</style></defs>

                  <HatchedPanels panels={panels} rowKeys={rowKeys} selectedRowIdx={selectedRowIdx} toSvg={toSvg} sc={sc} pixelToCmRatio={pixelToCmRatio} clipIdPrefix="rcp" />

                  {/* Cross-section overlay */}
                  {showCrossSection && (
                    <RailCrossSectionOverlay
                      rl={activeCrossSectionRl}
                      lineRails={lineRails}
                      panelDepthsCm={panelDepthsCm}
                      keepSymmetry={keepSymmetry}
                      barRightX={PAD_LEFT - 100}
                      toSvg={toSvg}
                      pixelToCmRatio={pixelToCmRatio}
                      sc={sc}
                      zoom={zoom}
                      svgRef={svgRef}
                      onLineChange={handleLineRailsChange}
                    />
                  )}

                  {/* Rails + dimension annotations */}
                  {railLayouts.map((rl, i) => {
                    if (!rl) return null
                    const railOpacity    = (selectedRowIdx === null || i === selectedRowIdx) ? 1 : 0.2
                    const railProfileSvg = (crossRailEdgeDistMm / 10 / pixelToCmRatio) * sc
                    const overhangSvg    = (railOverhangCm / pixelToCmRatio) * sc
                    const hlW            = railProfileSvg + 6
                    const hlRail         = highlightGroup === 'rail-ends'
                    const hlCuts         = highlightGroup === 'rail-cuts'
                    const hlProfile      = highlightGroup === 'cross-rails'
                    const hlSpacingV     = highlightGroup === 'railSpacingV'
                    const hlSpacingH     = highlightGroup === 'railSpacingH'

                    const annotatedLines = new Set(), annotatedRailIds = new Set()
                    for (const rail of rl.rails) {
                      if (!annotatedLines.has(rail.lineIdx)) { annotatedLines.add(rail.lineIdx); annotatedRailIds.add(rail.railId) }
                    }

                    // Group lineIdxs into visual strips (overlapping localY ranges → same strip)
                    // Each strip gets one annotation line spanning all its rails.
                    const ANN_GAP = 12 / zoom
                    const lineToAnnY = {}   // lineIdx → annotation SVG Y
                    const stripSpanLines = [] // [{annY, minX, maxX}]
                    if (rl.panelLocalRects && rl.frame) {
                      const { center: fc, angleRad: ar } = rl.frame
                      const lineLocalYRange = {}
                      for (const pr of rl.panelLocalRects) {
                        if (!lineLocalYRange[pr.line]) lineLocalYRange[pr.line] = { min: pr.localY, max: pr.localY + pr.height }
                        else {
                          lineLocalYRange[pr.line].min = Math.min(lineLocalYRange[pr.line].min, pr.localY)
                          lineLocalYRange[pr.line].max = Math.max(lineLocalYRange[pr.line].max, pr.localY + pr.height)
                        }
                      }
                      const sortedLines = Object.entries(lineLocalYRange).sort(([,a],[,b]) => a.min - b.min)
                      const strips = []
                      for (const [liStr, range] of sortedLines) {
                        const li = Number(liStr)
                        const last = strips[strips.length - 1]
                        if (!last || range.min >= last.maxLocalY) strips.push({ lineIdxs: [li], maxLocalY: range.max })
                        else { last.lineIdxs.push(li); last.maxLocalY = Math.max(last.maxLocalY, range.max) }
                      }
                      for (const strip of strips) {
                        // Compute strip's min SVG Y from top panel corners
                        let minSvgY = Infinity
                        for (const pr of rl.panelLocalRects) {
                          if (!strip.lineIdxs.includes(pr.line)) continue
                          for (const [lx, ly] of [[pr.localX, pr.localY], [pr.localX + pr.width, pr.localY]]) {
                            const sy = fc.y + lx * Math.sin(ar) + ly * Math.cos(ar)
                            minSvgY = Math.min(minSvgY, toSvg(0, sy)[1])
                          }
                        }
                        const annY = minSvgY - ANN_GAP
                        for (const li of strip.lineIdxs) lineToAnnY[li] = annY
                        // Collect first-rail per lineIdx to compute overall span
                        const seen = new Set()
                        const xs = []
                        for (const rail of rl.rails) {
                          if (!strip.lineIdxs.includes(rail.lineIdx) || seen.has(rail.lineIdx)) continue
                          seen.add(rail.lineIdx)
                          const [rx1] = toSvg(rail.screenStart.x, rail.screenStart.y)
                          const [rx2] = toSvg(rail.screenEnd.x, rail.screenEnd.y)
                          xs.push(rx1, rx2)
                        }
                        if (xs.length > 0) stripSpanLines.push({ annY, minX: Math.min(...xs), maxX: Math.max(...xs) })
                      }
                    }

                    // Gap polygons between adjacent rails of the highlighted orientation
                    const spacingGaps = (hlSpacingV || hlSpacingH) && showRails ? (() => {
                      const targetOrientation = hlSpacingV ? 'vertical' : 'horizontal'
                      const sorted = rl.rails
                        .filter(r => r.orientation === targetOrientation)
                        .map(r => {
                          const [x1, y1] = toSvg(r.screenStart.x, r.screenStart.y)
                          const [x2, y2] = toSvg(r.screenEnd.x, r.screenEnd.y)
                          return { x1, y1, x2, y2, midPerp: hlSpacingV ? (x1 + x2) / 2 : (y1 + y2) / 2 }
                        })
                        .sort((a, b) => a.midPerp - b.midPerp)
                      return sorted.slice(0, -1).map((r, ri) => {
                        const n = sorted[ri + 1]
                        return (
                          <polygon key={`gap-${ri}`}
                            points={`${r.x1},${r.y1} ${r.x2},${r.y2} ${n.x2},${n.y2} ${n.x1},${n.y1}`}
                            fill="#FFB300" fillOpacity={0.35} stroke="none"
                            style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }}
                          />
                        )
                      })
                    })() : null

                    // Material summary label — one per panel line, centered in that line's area
                    const materialSummary = (() => {
                      const refRail = rl.rails[0]
                      if (!refRail || !showMaterialSummary || !rl.panelLocalRects || !rl.frame) return null
                      const counts = {}
                      for (const mm of refRail.stockSegments) counts[mm] = (counts[mm] ?? 0) + 1
                      const text = Object.entries(counts)
                        .sort((a, b) => Number(b[0]) - Number(a[0]))
                        .map(([mm, n]) => `${n}×${(Number(mm) / 1000).toFixed(3).replace(/\.?0+$/, '')}m`)
                        .join(' + ')
                      const { center, angleRad } = rl.frame
                      const fontSize = Math.max(9, 13 / zoom)
                      // Group panelLocalRects by line index
                      const lineRects = {}
                      for (const pr of rl.panelLocalRects) {
                        if (!lineRects[pr.line]) lineRects[pr.line] = []
                        lineRects[pr.line].push(pr)
                      }
                      return Object.entries(lineRects).map(([li, rects]) => {
                        const midLX = (Math.min(...rects.map(r => r.localX)) + Math.max(...rects.map(r => r.localX + r.width))) / 2
                        const midLY = (Math.min(...rects.map(r => r.localY)) + Math.max(...rects.map(r => r.localY + r.height))) / 2
                        const sx = center.x + midLX * Math.cos(angleRad) - midLY * Math.sin(angleRad)
                        const sy = center.y + midLX * Math.sin(angleRad) + midLY * Math.cos(angleRad)
                        const [cx, cy] = toSvg(sx, sy)
                        return (
                          <text key={li} x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                            fontSize={fontSize} fontWeight="600" fill="#642165"
                            style={{ pointerEvents: 'none' }}>
                            {text}
                          </text>
                        )
                      })
                    })()

                    return (
                      <g key={i} opacity={railOpacity}>
                        {spacingGaps}
                        {materialSummary}
                        {rl.rails.map(rail => {
                          const [x1, y1] = toSvg(rail.screenStart.x, rail.screenStart.y)
                          const [x2, y2] = toSvg(rail.screenEnd.x, rail.screenEnd.y)
                          const dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy)
                          if (len < 2) return null

                          const ux = dx / len, uy = dy / len
                          const perpUX = -dy / len, perpUY = dx / len
                          const railMidX = (x1 + x2) / 2, railMidY = (y1 + y2) / 2
                          const outDot = (railMidX - svgCentX) * perpUX + (railMidY - svgCentY) * perpUY
                          const outSign = outDot >= 0 ? 1 : -1
                          const apX = outSign * perpUX, apY = outSign * perpUY

                          const angle = Math.atan2(dy, dx) * 180 / Math.PI
                          const labelAngle = angle > 90 || angle < -90 ? angle + 180 : angle

                          const railOffsetCm  = lineRails?.[rail.lineIdx]?.[0] ?? railOverhangCm
                          const railOffsetSvg = (railOffsetCm / pixelToCmRatio) * sc
                          const TICK = 4 / zoom, EXT_OVR = 3 / zoom
                          const pe1x = x1 + apX * railOffsetSvg, pe1y = y1 + apY * railOffsetSvg
                          const pe2x = x2 + apX * railOffsetSvg, pe2y = y2 + apY * railOffsetSvg

                          // Anchor annotation line to this strip's top SVG Y
                          const useTopAnchor = Math.abs(apY) > 0.3
                          const annY = lineToAnnY[rail.lineIdx] ?? (PAD - ANN_GAP)
                          const ann1x = useTopAnchor ? x1 : x1 + apX * (railOffsetSvg + 4 / zoom)
                          const ann1y = useTopAnchor ? annY : y1 + apY * (railOffsetSvg + 4 / zoom)
                          const ann2x = useTopAnchor ? x2 : x2 + apX * (railOffsetSvg + 4 / zoom)
                          const ann2y = useTopAnchor ? annY : y2 + apY * (railOffsetSvg + 4 / zoom)

                          let cumMm = 0
                          const segFracs = rail.stockSegments.map(segMm => {
                            const startFrac = cumMm / rail.lengthMm
                            cumMm += segMm
                            return { startFrac, endFrac: Math.min(cumMm / rail.lengthMm, 1) }
                          })

                          const segAnnotations = rail.stockSegments.map((segMm, si) => {
                            const { startFrac, endFrac } = segFracs[si]
                            const midFrac = (startFrac + endFrac) / 2
                            const tx = x1 + dx * midFrac + (useTopAnchor ? 0 : apX * (railOffsetSvg + 4 / zoom))
                            const ty = useTopAnchor ? annY : y1 + dy * midFrac + apY * (railOffsetSvg + 4 / zoom)
                            const label = String(segMm), fontSize = 11 / zoom
                            const bgW = label.length * fontSize * 0.6 + 6 / zoom, bgH = fontSize + 4 / zoom
                            const boundary = endFrac < 0.999 ? (() => {
                              const bx = x1 + dx * endFrac, by = y1 + dy * endFrac
                              if (useTopAnchor) {
                                return (
                                  <g key={`ib-${si}`}>
                                    <line x1={bx} y1={by} x2={bx} y2={annY + EXT_OVR} stroke="#000" strokeWidth={0.8 / zoom} />
                                    <line x1={bx - TICK} y1={annY} x2={bx + TICK} y2={annY} stroke="#000" strokeWidth={1.2 / zoom} />
                                  </g>
                                )
                              }
                              const EXT = railOffsetSvg + 4 / zoom
                              return (
                                <g key={`ib-${si}`}>
                                  <line x1={bx + apX * railOffsetSvg} y1={by + apY * railOffsetSvg} x2={bx + apX * (EXT + EXT_OVR)} y2={by + apY * (EXT + EXT_OVR)} stroke="#000" strokeWidth={0.8 / zoom} />
                                  <line x1={bx + apX * EXT - perpUX * TICK} y1={by + apY * EXT - perpUY * TICK} x2={bx + apX * EXT + perpUX * TICK} y2={by + apY * EXT + perpUY * TICK} stroke="#000" strokeWidth={1.2 / zoom} />
                                </g>
                              )
                            })() : null
                            const effectiveLabelAngle = useTopAnchor ? 0 : labelAngle
                            return (
                              <g key={`seg-${si}`}>
                                {boundary}
                                <g transform={`rotate(${effectiveLabelAngle} ${tx} ${ty})`}>
                                  <rect x={tx - bgW / 2} y={ty - bgH / 2} width={bgW} height={bgH} fill="white" stroke="#ccc" strokeWidth={0.5 / zoom} rx={1 / zoom} />
                                  <text x={tx} y={ty} textAnchor="middle" dominantBaseline="middle" fontSize={fontSize} fontWeight="700" fill="#000">{label}</text>
                                </g>
                              </g>
                            )
                          })

                          const showAnnotation = annotatedRailIds.has(rail.railId)

                          return (
                            <g key={`${i}-${rail.railId}`}>
                              {showRails && <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={RAIL_COLOR_FILL} strokeWidth={railProfileSvg} strokeLinecap="square" />}
                              {hlRail && showRails && <>
                                <line x1={x1} y1={y1} x2={x1 + ux * overhangSvg} y2={y1 + uy * overhangSvg} stroke="#FFB300" strokeWidth={hlW} strokeLinecap="square" style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />
                                <line x1={x2 - ux * overhangSvg} y1={y2 - uy * overhangSvg} x2={x2} y2={y2} stroke="#FFB300" strokeWidth={hlW} strokeLinecap="square" style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />
                              </>}
                              {hlCuts    && showRails && <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#FFB300" strokeWidth={hlW} strokeLinecap="square" style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />}
                              {hlProfile && showRails && <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#FFB300" strokeWidth={hlW} strokeLinecap="square" style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />}
                              {showAnnotation && showDimensions && <>
                                {useTopAnchor ? <>
                                  {/* Extension lines from rail endpoints up to strip annotation line */}
                                  <line x1={x1} y1={y1} x2={x1} y2={annY + EXT_OVR} stroke="#000" strokeWidth={0.8 / zoom} />
                                  <line x1={x2} y1={y2} x2={x2} y2={annY + EXT_OVR} stroke="#000" strokeWidth={0.8 / zoom} />
                                </> : <>
                                  <line x1={pe1x} y1={pe1y} x2={x1 + apX * (railOffsetSvg + 4 / zoom + EXT_OVR)} y2={y1 + apY * (railOffsetSvg + 4 / zoom + EXT_OVR)} stroke="#000" strokeWidth={0.8 / zoom} />
                                  <line x1={pe2x} y1={pe2y} x2={x2 + apX * (railOffsetSvg + 4 / zoom + EXT_OVR)} y2={y2 + apY * (railOffsetSvg + 4 / zoom + EXT_OVR)} stroke="#000" strokeWidth={0.8 / zoom} />
                                  <line x1={ann1x} y1={ann1y} x2={ann2x} y2={ann2y} stroke="#000" strokeWidth={1 / zoom} />
                                  <line x1={ann1x - perpUX * TICK} y1={ann1y - perpUY * TICK} x2={ann1x + perpUX * TICK} y2={ann1y + perpUY * TICK} stroke="#000" strokeWidth={1.2 / zoom} />
                                  <line x1={ann2x - perpUX * TICK} y1={ann2y - perpUY * TICK} x2={ann2x + perpUX * TICK} y2={ann2y + perpUY * TICK} stroke="#000" strokeWidth={1.2 / zoom} />
                                </>}
                                <g>{segAnnotations}</g>
                              </>}
                            </g>
                          )
                        })}
                        {/* Per-strip annotation lines — one per visual panel strip */}
                        {showDimensions && stripSpanLines.map((span, si) => (
                          <g key={`strip-span-${si}`}>
                            <line x1={span.minX} y1={span.annY} x2={span.maxX} y2={span.annY} stroke="#000" strokeWidth={1 / zoom} />
                            <line x1={span.minX - 4 / zoom} y1={span.annY} x2={span.minX + 4 / zoom} y2={span.annY} stroke="#000" strokeWidth={1.2 / zoom} />
                            <line x1={span.maxX - 4 / zoom} y1={span.annY} x2={span.maxX + 4 / zoom} y2={span.annY} stroke="#000" strokeWidth={1.2 / zoom} />
                          </g>
                        ))}
                      </g>
                    )
                  })}
                </svg>
              </div>
            </div>
          </div>

          <LayersPanel
            layers={[
              { label: 'Rails',            checked: showRails,           setter: setShowRails },
              { label: 'Dimensions',       checked: showDimensions,      setter: setShowDimensions },
              { label: 'Material summary', checked: showMaterialSummary, setter: setShowMaterialSummary },
              { label: 'Edit bar',         checked: showCrossSection,    setter: setShowCrossSection },
            ]}
            summary={null}
            actions={[
              { label: 'Apply to all areas', onClick: onApplyRailsToAll, style: { color: '#555', background: '#f0f0f0', border: '1px solid #ddd' } },
              { label: 'Reset to defaults',  onClick: onResetRails,      style: { color: '#b45309', background: '#fffbeb', border: '1px solid #fcd34d' } },
            ]}
          />
        </div>
      </div>

      {/* Rail Schedule table */}
      <div style={{ flexShrink: 0, borderTop: '1px solid #e8e8e8' }}>
        <button onClick={() => setTableOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 1.25rem', background: '#f8f9fa', border: 'none', cursor: 'pointer', fontSize: '0.72rem', fontWeight: '700', color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          <span style={{ fontSize: '0.6rem' }}>{tableOpen ? '▾' : '▸'}</span>
          Rail Schedule
          <span style={{ marginLeft: '0.5rem', fontWeight: '400', color: '#888', textTransform: 'none', letterSpacing: 0 }}>
            ({totalRails} rails{totalLeftover > 0 ? `, ${totalLeftover.toLocaleString('en-US')} mm leftover` : ''})
          </span>
        </button>
        {tableOpen && (
          <div style={{ overflowY: 'auto', maxHeight: '260px', padding: '0.5rem 1.25rem 1rem' }}>
            {rowKeys.map((rowKey, i) => {
              const rl = railLayouts[i]
              if (!rl) return null
              return <RailsTable key={rowKey} rails={rl.rails} rowIdx={i} />
            })}
          </div>
        )}
      </div>

      <CanvasNavigator
        viewZoom={zoom}
        onZoomOut={() => setZoom(z => Math.max(0.3, z - 0.1))}
        onZoomReset={resetView}
        onZoomIn={() => setZoom(z => Math.min(8, z + 0.1))}
        mmWidth={MM_W} mmHeight={MM_H}
        onPanToPoint={panToMinimapPoint}
        viewportRect={getMinimapViewportRect()}
      />
    </div>
  )
}
