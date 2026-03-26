import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useLang } from '../../../i18n/LangContext'
import { TEXT_SECONDARY, TEXT_VERY_LIGHT, TEXT_PLACEHOLDER, BORDER_FAINT, BORDER, BG_LIGHT, BG_FAINT, BG_MID, BLUE, BLUE_BG, BLUE_BORDER, BLUE_SELECTED, AMBER_DARK, AMBER, RAIL_STROKE, AMBER_BG, AMBER_BORDER } from '../../../styles/colors'
import { computeRowRailLayout, localToScreen, screenToLocal, DEFAULT_RAIL_OVERHANG_CM, DEFAULT_STOCK_LENGTHS_MM } from '../../../utils/railLayoutService'
import CanvasNavigator from '../../shared/CanvasNavigator'
import { useCanvasPanZoom } from '../../../hooks/useCanvasPanZoom'
import { getPanelsBoundingBox, buildRowGroups, buildTrapezoidGroups } from './tabUtils'
import HatchedPanels from './HatchedPanels'
import LayersPanel from './LayersPanel'
import RailsTable from './RailsTable'
import RailCrossSectionOverlay from './RailCrossSectionOverlay'
import RulerTool from '../../shared/RulerTool'
import DimensionAnnotation from './DimensionAnnotation'


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
  printMode = false,
  trapSettingsMap = {},
  trapLineRailsMap = {},
}) {
  const { t } = useLang()
  const railOverhangCm      = settings.railOverhangCm      ?? DEFAULT_RAIL_OVERHANG_CM
  const stockLengths        = settings.stockLengths        ?? DEFAULT_STOCK_LENGTHS_MM
  const crossRailEdgeDistMm = settings.crossRailEdgeDistMm ?? 40

  const svgRef = useRef(null)

  const [showRails,           setShowRails]           = useState(true)
  const [showDimensions,      setShowDimensions]      = useState(true)
  const [showMaterialSummary, setShowMaterialSummary] = useState(true)
  const [showEditBar,    setShowEditBar]    = useState(true)
  const [rulerActive,         setRulerActive]         = useState(false)
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: TEXT_VERY_LIGHT, fontSize: '0.95rem' }}>
        {t('step3.empty.noRows')}
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

  if (printMode) {
    // Per-trap rail layouts using per-area settings
    const { map: trapGroups, keys: trapIds } = buildTrapezoidGroups(panels)
    const printRailLayouts = trapIds.map(trapId => {
      const s = trapSettingsMap[trapId] ?? {}
      return computeRowRailLayout(trapGroups[trapId], pixelToCmRatio, {
        lineRails:    trapLineRailsMap[trapId] ?? null,
        overhangCm:   s.railOverhangCm ?? DEFAULT_RAIL_OVERHANG_CM,
        stockLengths: s.stockLengths   ?? DEFAULT_STOCK_LENGTHS_MM,
      })
    })
    // Reduced left pad — no cross-section bar
    const PM_PAD = 24
    const svgW_pm  = MAX_W + PM_PAD * 2
    const toSvg_pm = (sx, sy) => [PM_PAD + (sx - bbox.minX) * sc, PAD + (sy - bbox.minY) * sc]
    const svgCentX_pm = PM_PAD + (bboxW / 2) * sc

    return (
      <svg width={svgW_pm} height={svgH} style={{ display: 'block' }}>
        <HatchedPanels panels={panels} rowKeys={rowKeys} selectedRowIdx={null} toSvg={toSvg_pm} sc={sc} pixelToCmRatio={pixelToCmRatio} clipIdPrefix="rcp-pm" />
        {printRailLayouts.map((rl, i) => {
          if (!rl) return null
          const railProfileSvg = (crossRailEdgeDistMm / 10 / pixelToCmRatio) * sc
          const annotatedLines = new Set(), annotatedRailIds = new Set()
          for (const rail of rl.rails) {
            if (!annotatedLines.has(rail.lineIdx)) { annotatedLines.add(rail.lineIdx); annotatedRailIds.add(rail.railId) }
          }
          const dimAnnotations = rl.frame ? (() => {
            const { center: fc, angleRad: ar, localBounds: lb } = rl.frame
            const perpX = -Math.sin(ar), perpY = Math.cos(ar)
            const [fcxSvg, fcySvg] = toSvg_pm(fc.x, fc.y)
            const outSign = ((fcxSvg - svgCentX_pm) * perpX + (fcySvg - svgCentY) * perpY) >= 0 ? 1 : -1
            const apX = outSign * perpX, apY = outSign * perpY
            const extremeLocalY = outSign >= 0 ? lb.maxY : lb.minY
            const ANN_OFF = 16, EXT_GAP = 2
            const edgeSvgFn = (lx) => { const s = localToScreen({ x: lx, y: extremeLocalY }, fc, ar); return toSvg_pm(s.x, s.y) }
            const annSvgFn  = (lx) => { const [ex, ey] = edgeSvgFn(lx); return [ex + apX * ANN_OFF, ey + apY * ANN_OFF] }
            return rl.rails
              .filter(rail => annotatedRailIds.has(rail.railId))
              .map(rail => {
                const lxStart = screenToLocal(rail.screenStart, fc, ar).x
                const lxEnd   = screenToLocal(rail.screenEnd,   fc, ar).x
                const [esx, esy] = edgeSvgFn(lxStart), [eex, eey] = edgeSvgFn(lxEnd)
                const measurePts = [[esx + apX * EXT_GAP, esy + apY * EXT_GAP], [eex + apX * EXT_GAP, eey + apY * EXT_GAP]]
                const annPts     = [annSvgFn(lxStart), annSvgFn(lxEnd)]
                return (
                  <DimensionAnnotation key={`dim-${rail.railId}`}
                    measurePts={measurePts} annPts={annPts}
                    labels={[String(Math.round(rail.lengthMm))]}
                    zoom={1} color={TEXT_SECONDARY}
                  />
                )
              })
          })() : null
          const materialSummary = (() => {
            const refRail = rl.rails[0]
            if (!refRail || !rl.panelLocalRects || !rl.frame) return null
            const counts = {}
            for (const mm of refRail.stockSegments) counts[mm] = (counts[mm] ?? 0) + 1
            const text = Object.entries(counts)
              .sort((a, b) => Number(b[0]) - Number(a[0]))
              .map(([mm, n]) => `${n}×${(Number(mm) / 1000).toFixed(3).replace(/\.?0+$/, '')}m`)
              .join(' + ')
            const { center, angleRad } = rl.frame
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
              const [cx, cy] = toSvg_pm(sx, sy)
              return (
                <text key={li} x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                  fontSize={10} fontWeight="600" fill={RAIL_STROKE} style={{ pointerEvents: 'none' }}>
                  {text}
                </text>
              )
            })
          })()
          return (
            <g key={i}>
              {materialSummary}
              {rl.rails.map(rail => {
                const [x1, y1] = toSvg_pm(rail.screenStart.x, rail.screenStart.y)
                const [x2, y2] = toSvg_pm(rail.screenEnd.x, rail.screenEnd.y)
                const dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy)
                if (len < 2) return null
                return (
                  <line key={`${i}-${rail.railId}`}
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={RAIL_STROKE} strokeWidth={railProfileSvg} strokeLinecap="square"
                  />
                )
              })}
              {dimAnnotations}
            </g>
          )
        })}
      </svg>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'white', position: 'relative' }}>

      <div style={{ display: 'flex', flex: '1 1 0', minHeight: 0, overflow: 'hidden' }}>

        {/* ── Diagram canvas ── */}
        <div
          style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden', background: BG_FAINT, cursor: panActive ? 'grabbing' : 'grab' }}
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
                  {showEditBar && (
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

                    // First rail per lineIdx — one dimension annotation per line
                    const annotatedLines = new Set(), annotatedRailIds = new Set()
                    for (const rail of rl.rails) {
                      if (!annotatedLines.has(rail.lineIdx)) { annotatedLines.add(rail.lineIdx); annotatedRailIds.add(rail.railId) }
                    }

                    // Outward-perpendicular positioning (same logic as BasesPlanTab)
                    const dimAnnotations = showDimensions && rl.frame ? (() => {
                      const { center: fc, angleRad: ar, localBounds: lb } = rl.frame
                      const perpX = -Math.sin(ar), perpY = Math.cos(ar)
                      const [fcxSvg, fcySvg] = toSvg(fc.x, fc.y)
                      const outSign = ((fcxSvg - svgCentX) * perpX + (fcySvg - svgCentY) * perpY) >= 0 ? 1 : -1
                      const apX = outSign * perpX, apY = outSign * perpY
                      const extremeLocalY = outSign >= 0 ? lb.maxY : lb.minY
                      const ANN_OFF = 16 / zoom, EXT_GAP = 2 / zoom
                      const edgeSvgFn = (lx) => { const s = localToScreen({ x: lx, y: extremeLocalY }, fc, ar); return toSvg(s.x, s.y) }
                      const annSvgFn  = (lx) => { const [ex, ey] = edgeSvgFn(lx); return [ex + apX * ANN_OFF, ey + apY * ANN_OFF] }
                      const isSelected = selectedRowIdx === null || i === selectedRowIdx
                      const color = isSelected ? BLUE_SELECTED : TEXT_SECONDARY

                      return rl.rails
                        .filter(rail => annotatedRailIds.has(rail.railId))
                        .map(rail => {
                          const lxStart = screenToLocal(rail.screenStart, fc, ar).x
                          const lxEnd   = screenToLocal(rail.screenEnd,   fc, ar).x
                          const [esx, esy] = edgeSvgFn(lxStart), [eex, eey] = edgeSvgFn(lxEnd)
                          const measurePts = [[esx + apX * EXT_GAP, esy + apY * EXT_GAP], [eex + apX * EXT_GAP, eey + apY * EXT_GAP]]
                          const annPts     = [annSvgFn(lxStart), annSvgFn(lxEnd)]
                          return (
                            <DimensionAnnotation key={`dim-${rail.railId}`}
                              measurePts={measurePts} annPts={annPts}
                              labels={[String(Math.round(rail.lengthMm))]}
                              zoom={zoom} color={color}
                            />
                          )
                        })
                    })() : null

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
                            fill={AMBER} fillOpacity={0.35} stroke="none"
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
                            fontSize={fontSize} fontWeight="600" fill={RAIL_STROKE}
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
                          return (
                            <g key={`${i}-${rail.railId}`}>
                              {showRails && <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={RAIL_STROKE} strokeWidth={railProfileSvg} strokeLinecap="square" />}
                              {hlRail && showRails && <>
                                <line x1={x1} y1={y1} x2={x1 + ux * overhangSvg} y2={y1 + uy * overhangSvg} stroke={AMBER} strokeWidth={hlW} strokeLinecap="square" style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />
                                <line x1={x2 - ux * overhangSvg} y1={y2 - uy * overhangSvg} x2={x2} y2={y2} stroke={AMBER} strokeWidth={hlW} strokeLinecap="square" style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />
                              </>}
                              {hlCuts    && showRails && <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={AMBER} strokeWidth={hlW} strokeLinecap="square" style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />}
                              {hlProfile && showRails && <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={AMBER} strokeWidth={hlW} strokeLinecap="square" style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />}
                            </g>
                          )
                        })}
                        {dimAnnotations}
                      </g>
                    )
                  })}
                </svg>
              </div>
            </div>
          </div>

          <RulerTool active={rulerActive} zoom={zoom} pxPerCm={sc / pixelToCmRatio} containerRef={containerRef} />

          <LayersPanel
            layers={[
              { label: t('step3.layer.rails'),           checked: showRails,           setter: setShowRails },
              { label: t('step3.layer.dimensions'),      checked: showDimensions,      setter: setShowDimensions },
              { label: t('step3.layer.materialSummary'), checked: showMaterialSummary, setter: setShowMaterialSummary },
              { label: t('step3.layer.editBar'),         checked: showEditBar,         setter: setShowEditBar },
            ]}
            summary={null}
            actions={[
              { label: t('step3.layer.applyToAll'),    onClick: onApplyRailsToAll, style: { color: TEXT_SECONDARY, background: BG_MID, border: `1px solid ${BORDER}` } },
              { label: t('step3.layer.resetDefaults'), onClick: onResetRails,      style: { color: AMBER_DARK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}` } },
              { label: rulerActive ? t('step3.layer.rulerOn') : t('step3.layer.ruler'), onClick: () => { if (rulerActive) RulerTool._clear?.(); setRulerActive(v => !v) }, style: rulerActive ? { color: BLUE, background: BLUE_BG, border: `1px solid ${BLUE_BORDER}` } : {} },
            ]}
          />

          <CanvasNavigator
            viewZoom={zoom}
            onZoomOut={() => setZoom(z => Math.max(0.3, z - 0.1))}
            onZoomReset={resetView}
            onZoomIn={() => setZoom(z => Math.min(8, z + 0.1))}
            mmWidth={MM_W} mmHeight={MM_H}
            onPanToPoint={panToMinimapPoint}
            viewportRect={getMinimapViewportRect()}
            left={276}
          />
        </div>
      </div>

      {/* Rail Schedule table */}
      <div style={{ flexShrink: 0, borderTop: `1px solid ${BORDER_FAINT}` }}>
        <button onClick={() => setTableOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 1.25rem', background: BG_LIGHT, border: 'none', cursor: 'pointer', fontSize: '0.72rem', fontWeight: '700', color: TEXT_SECONDARY, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          <span style={{ fontSize: '0.6rem' }}>{tableOpen ? '▾' : '▸'}</span>
          Rail Schedule
          <span style={{ marginLeft: '0.5rem', fontWeight: '400', color: TEXT_PLACEHOLDER, textTransform: 'none', letterSpacing: 0 }}>
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

    </div>
  )
}
