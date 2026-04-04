import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useLang } from '../../../i18n/LangContext'
import { TEXT_SECONDARY, TEXT_VERY_LIGHT, TEXT_PLACEHOLDER, BORDER_FAINT, BORDER, BG_LIGHT, BG_FAINT, BG_MID, BLUE, BLUE_BG, BLUE_BORDER, AMBER_DARK, AMBER, RAIL_STROKE, RAIL_CONNECTOR, AMBER_BG, AMBER_BORDER } from '../../../styles/colors'
import { computeRowRailLayout } from '../../../utils/railLayoutService'
import CanvasNavigator from '../../shared/CanvasNavigator'
import { useCanvasPanZoom } from '../../../hooks/useCanvasPanZoom'
import { getPanelsBoundingBox, buildRowGroups } from './tabUtils'
import HatchedPanels from './HatchedPanels'
import LayersPanel from './LayersPanel'
import RailsTable from './RailsTable'
import RailCrossSectionOverlay from './RailCrossSectionOverlay'
import RulerTool from '../../shared/RulerTool'


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
  railLayouts: railLayoutsProp = null,  // pre-computed per-area layouts from parent
  railsComputing = false,
  beRailsData = null,
}) {
  const { t } = useLang()
  const railOverhangCm      = settings.railOverhangCm      
  const stockLengths        = settings.stockLengths        
  const crossRailEdgeDistMm = settings.crossRailEdgeDistMm 

  const svgRef = useRef(null)

  const [showRails,           setShowRails]           = useState(true)
  const [showDimensions,      setShowDimensions]      = useState(true)
  const [showMaterialSummary, setShowMaterialSummary] = useState(true)
  const [showConnectors,      setShowConnectors]      = useState(true)
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

  // BE rail lookup by area index + railId (for interactive mode) and areaLabel + railId (for print mode)
  const beRailByKey = useMemo(() => {
    const m = {}
    ;(beRailsData ?? []).forEach((area, idx) => {
      for (const r of (area.rails ?? [])) {
        m[`${idx}:${r.railId}`] = r
        m[`${area.areaLabel}:${r.railId}`] = r
      }
    })
    return m
  }, [beRailsData])

  const railLayouts = useMemo(() => {
    if (railLayoutsProp) return railLayoutsProp
    return rowKeys.map((rowKey, i) => {
      const firstTrapId = rowGroups[rowKey]?.[0]?.trapezoidId
      // For the selected row in edit mode, use live lineRails; otherwise use stored per-area data
      const useStored = i !== selectedRowIdx || printMode
      let areaLineRails = lineRails
      if (useStored && firstTrapId && trapLineRailsMap[firstTrapId]) {
        areaLineRails = trapLineRailsMap[firstTrapId]
      }
      const areaSettings = (firstTrapId && trapSettingsMap[firstTrapId]) ?? {}
      const cfg = {
        lineRails: areaLineRails,
        overhangCm: useStored ? (areaSettings.railOverhangCm ?? railOverhangCm) : railOverhangCm,
        stockLengths: useStored ? (areaSettings.stockLengths ?? stockLengths) : stockLengths,
      }
      return computeRowRailLayout(rowGroups[rowKey], pixelToCmRatio, cfg)
    })
  }, [railLayoutsProp, rowKeys, rowGroups, pixelToCmRatio, railConfig, selectedRowIdx, trapLineRailsMap, trapSettingsMap, printMode])

  const totalRails    = railLayouts.reduce((s, rl) => s + (rl?.rails.length ?? 0), 0)
  const totalLeftover = railLayouts.reduce((s, rl) => s + (rl?.rails.reduce((rs, r) => rs + r.leftoverCm, 0) ?? 0), 0)

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

  // ── Shared rail layer renderers (used in both interactive and print modes) ──
  const renderMaterialSummary = (rl, beSegsFn, toSvgFn, fontSize, prefix) => {
    if (!rl.rails.length || !rl.panelLocalRects || !rl.frame) return null
    const railByLine = {}
    for (const rail of rl.rails) {
      if (!(rail.lineIdx in railByLine)) railByLine[rail.lineIdx] = rail
    }
    const { center, angleRad } = rl.frame
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
      const [cx, cy] = toSvgFn(sx, sy)
      return (
        <text key={`${prefix}-ms-${li}`} x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
          fontSize={fontSize} fontWeight="600" fill={RAIL_STROKE} style={{ pointerEvents: 'none' }}>
          {text}
        </text>
      )
    })
  }

  const renderConnectors = (rl, beSegsFn, toSvgFn, railProfile, z, prefix) => {
    return rl.rails.map(rail => {
      const segs = beSegsFn(rail)
      if (!segs || segs.length < 2) return null
      const [x1, y1] = toSvgFn(rail.screenStart.x, rail.screenStart.y)
      const [x2, y2] = toSvgFn(rail.screenEnd.x, rail.screenEnd.y)
      const dx = x2 - x1, dy = y2 - y1, railLen = Math.sqrt(dx * dx + dy * dy)
      if (railLen < 2) return null
      const ux = dx / railLen, uy = dy / railLen
      const totalMm = segs.reduce((s, v) => s + v, 0)
      const ang = Math.atan2(dy, dx) * 180 / Math.PI
      const connW = Math.max(3, 6 / z), connH = Math.max(6, railProfile + 6 / z)
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

  const renderSegmentLabels = (rl, beSegsFn, toSvgFn, railProfile, fontSize, z, prefix) => {
    const seenLines = new Set()
    return rl.rails.map(rail => {
      if (seenLines.has(rail.lineIdx)) return null
      seenLines.add(rail.lineIdx)
      const segs = beSegsFn(rail)
      if (!segs || segs.length < 1) return null
      const [x1, y1] = toSvgFn(rail.screenStart.x, rail.screenStart.y)
      const [x2, y2] = toSvgFn(rail.screenEnd.x, rail.screenEnd.y)
      const dx = x2 - x1, dy = y2 - y1, railLen = Math.sqrt(dx * dx + dy * dy)
      if (railLen < 2) return null
      const ux = dx / railLen, uy = dy / railLen
      const totalMm = segs.reduce((s, v) => s + v, 0)
      const perpX = -uy, perpY = ux
      const labelOff = railProfile / 2 + 8 / z
      const ang = Math.atan2(dy, dx) * 180 / Math.PI
      let cumMm = 0
      return (
        <g key={`${prefix}-segs-${rail.railId}`}>
          {segs.map((segMm, si) => {
            const segStart = cumMm / totalMm * railLen
            cumMm += segMm
            const segEnd = cumMm / totalMm * railLen
            const midPx = (segStart + segEnd) / 2
            const mx = x1 + ux * midPx + perpX * labelOff
            const my = y1 + uy * midPx + perpY * labelOff
            return (
              <text key={si} x={mx} y={my} textAnchor="middle" dominantBaseline="middle"
                fontSize={fontSize} fontWeight="600" fill={RAIL_STROKE}
                transform={`rotate(${ang}, ${mx}, ${my})`}
                style={{ pointerEvents: 'none' }}>
                {String(segMm)}
              </text>
            )
          })}
        </g>
      )
    })
  }

  // ── Shared rail group renderer (used in both interactive and print modes) ──
  const renderRailGroup = ({ rl, i, beSegsFn, toSvgFn, railProfile, z, prefix, layers, extras }) => {
    if (!rl) return null
    const { summary = true, connectors: showConn = true, dimensions: showDim = true, rails: showR = true } = layers
    return (
      <g key={i} opacity={extras?.opacity ?? 1}>
        {extras?.spacingGaps}
        {summary && renderMaterialSummary(rl, beSegsFn, toSvgFn, Math.max(20, 25 / z), prefix)}
        {showConn && showR && renderConnectors(rl, beSegsFn, toSvgFn, railProfile, z, prefix)}
        {showDim && showR && renderSegmentLabels(rl, beSegsFn, toSvgFn, railProfile, Math.max(12, 18 / z), z, prefix)}
        {rl.rails.map(rail => {
          const [x1, y1] = toSvgFn(rail.screenStart.x, rail.screenStart.y)
          const [x2, y2] = toSvgFn(rail.screenEnd.x, rail.screenEnd.y)
          const dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy)
          if (len < 2) return null
          const ux = dx / len, uy = dy / len
          return (
            <g key={`${prefix}-${rail.railId}`}>
              {showR && <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={RAIL_STROKE} strokeWidth={railProfile} strokeLinecap="square" />}
              {extras?.hlRail && showR && <>
                <line x1={x1} y1={y1} x2={x1 + ux * extras.overhangSvg} y2={y1 + uy * extras.overhangSvg} stroke={AMBER} strokeWidth={extras.hlW} strokeLinecap="square" style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />
                <line x1={x2 - ux * extras.overhangSvg} y1={y2 - uy * extras.overhangSvg} x2={x2} y2={y2} stroke={AMBER} strokeWidth={extras.hlW} strokeLinecap="square" style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />
              </>}
              {extras?.hlCuts && showR && <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={AMBER} strokeWidth={extras.hlW} strokeLinecap="square" style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />}
              {extras?.hlProfile && showR && <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={AMBER} strokeWidth={extras.hlW} strokeLinecap="square" style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />}
            </g>
          )
        })}
      </g>
    )
  }

  if (printMode) {
    const PM_PAD = 24
    const svgW_pm  = MAX_W + PM_PAD * 2
    const toSvg_pm = (sx, sy) => [PM_PAD + (sx - bbox.minX) * sc, PAD + (sy - bbox.minY) * sc]

    return (
      <svg width={svgW_pm} height={svgH} style={{ display: 'block' }}>
        <HatchedPanels panels={panels} selectedTrapId={null} toSvg={toSvg_pm} sc={sc} pixelToCmRatio={pixelToCmRatio} clipIdPrefix="rcp-pm" />
        {railLayouts.map((rl, i) => {
          if (!rl) return null
          const beSegs = (rail) => { const be = beRailByKey[`${rowKeys[i]}:${rail.railId}`]; return be?.stockSegmentsMm ?? rail.stockSegmentsMm }
          const firstTrapId = rowGroups[rowKeys[i]]?.[0]?.trapezoidId
          const pmCrossRail = crossRailEdgeDistMm ?? trapSettingsMap[firstTrapId]?.crossRailEdgeDistMm ?? 50
          const railProfileSvg = (pmCrossRail / 10 / pixelToCmRatio) * sc
          return renderRailGroup({
            rl, i, beSegsFn: beSegs, toSvgFn: toSvg_pm, railProfile: railProfileSvg,
            z: 1, prefix: `pm-${i}`,
            layers: { summary: true, connectors: true, dimensions: true, rails: true },
            extras: null,
          })
        })}
      </svg>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'white', position: 'relative' }}>
      {railsComputing && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'rgba(255,255,255,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'all' }}>
          <span style={{ fontSize: '0.9rem', color: '#555', fontWeight: 500 }}>Computing rails…</span>
        </div>
      )}

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

                  <HatchedPanels panels={panels} selectedTrapId={rowKeys.length <= 1 || selectedRowIdx == null ? null : rowKeys[selectedRowIdx]} toSvg={toSvg} sc={sc} pixelToCmRatio={pixelToCmRatio} clipIdPrefix="rcp" />

                  {/* Rails + dimension annotations */}
                  {railLayouts.map((rl, i) => {
                    if (!rl) return null
                    const beSegs = (rail) => { const be = beRailByKey[`${rowKeys[i]}:${rail.railId}`]; return be?.stockSegmentsMm ?? rail.stockSegmentsMm }
                    const railOpacity    = (selectedRowIdx === null || i === selectedRowIdx) ? 1 : 0.2
                    const railProfileSvg = (crossRailEdgeDistMm / 10 / pixelToCmRatio) * sc
                    const overhangSvg    = (railOverhangCm / pixelToCmRatio) * sc
                    const hlW            = railProfileSvg + 6
                    const hlRail         = highlightGroup === 'rail-ends'
                    const hlCuts         = highlightGroup === 'rail-cuts'
                    const hlProfile      = highlightGroup === 'cross-rails'
                    const hlSpacingV     = highlightGroup === 'railSpacingV'
                    const hlSpacingH     = highlightGroup === 'railSpacingH'

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

                    return renderRailGroup({
                      rl, i, beSegsFn: beSegs, toSvgFn: toSvg, railProfile: railProfileSvg,
                      z: zoom, prefix: `e-${i}`,
                      layers: { summary: showMaterialSummary, connectors: showConnectors, dimensions: showDimensions, rails: showRails },
                      extras: { opacity: railOpacity, spacingGaps, hlRail, hlCuts, hlProfile, hlW, overhangSvg },
                    })
                  })}

                  {/* Edit bar — rendered last so it draws on top of all rails */}
                  {showEditBar && (
                    <RailCrossSectionOverlay
                      rl={activeCrossSectionRl}
                      lineRails={lineRails}
                      panelDepthsCm={panelDepthsCm}
                      keepSymmetry={keepSymmetry}
                      toSvg={toSvg}
                      pixelToCmRatio={pixelToCmRatio}
                      sc={sc}
                      zoom={zoom}
                      svgRef={svgRef}
                      onLineChange={handleLineRailsChange}
                    />
                  )}
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
              { label: t('step3.layer.connectors'),      checked: showConnectors,      setter: setShowConnectors },
              { label: t('step3.layer.editBar'),         checked: showEditBar,         setter: setShowEditBar },
            ]}
            summary={null}
            actions={[
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
            {(beRailsData ?? []).map((areaData, i) => (
              <RailsTable key={areaData.areaLabel} areaLabel={areaData.areaLabel} rails={areaData.rails ?? []} />
            ))}
          </div>
        )}
      </div>

    </div>
  )
}
