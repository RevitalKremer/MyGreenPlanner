import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useLang } from '../../../i18n/LangContext'
import { TEXT_VERY_LIGHT, TEXT_PLACEHOLDER, TEXT_SECONDARY, BORDER_FAINT, BG_LIGHT, BG_FAINT, BLUE, BLUE_BG, BLUE_BORDER, AMBER_DARK, AMBER_BG, AMBER_BORDER } from '../../../styles/colors'
import { computeRowRailLayout } from '../../../utils/railLayoutService'
import CanvasNavigator from '../../shared/CanvasNavigator'
import { useCanvasPanZoom } from '../../../hooks/useCanvasPanZoom'
import { getPanelsBoundingBox, buildRowGroups } from './tabUtils'
import HatchedPanels from './HatchedPanels'
import RailsOverlay from './RailsOverlay'
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
  const [showEditBar,    setShowEditBar]    = useState(false)
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

  // BE rail lookup: keyed by areaLabel:panelRowIdx:railId (and legacy variants)
  const beRailByKey = useMemo(() => {
    const m = {}
    ;(beRailsData ?? []).forEach((area, idx) => {
      for (const r of (area.rails ?? [])) {
        const pri = r._panelRowIdx ?? 0
        m[`${idx}:${pri}:${r.railId}`] = r
        m[`${area.areaLabel}:${pri}:${r.railId}`] = r
        if (area.areaId != null) m[`${area.areaId}:${pri}:${r.railId}`] = r
        // Legacy fallback (single-row areas)
        if (!m[`${idx}:${r.railId}`]) m[`${idx}:${r.railId}`] = r
        if (!m[`${area.areaLabel}:${r.railId}`]) m[`${area.areaLabel}:${r.railId}`] = r
      }
    })
    return m
  }, [beRailsData])

  // Map areaGroupKey → area label (for BE rail lookup resolution)
  const groupKeyToLabel = useMemo(() => {
    const m = {}
    for (const p of panels) {
      if (p.areaGroupKey != null && p.trapezoidId && !m[p.areaGroupKey]) {
        m[p.areaGroupKey] = p.trapezoidId.replace(/\d+$/, '')
      }
    }
    return m
  }, [panels])

  // Compute rail layouts — one per physical panel row (multi-row areas expand to multiple entries)
  const { railLayouts, railLayoutKeys } = useMemo(() => {
    if (railLayoutsProp) return { railLayouts: railLayoutsProp, railLayoutKeys: rowKeys }
    const layouts = []
    const layoutKeys = []  // parallel array: rowKey for each layout entry (for BE lookup)
    rowKeys.forEach((rowKey, i) => {
      const areaPanels = rowGroups[rowKey] ?? []
      const firstTrapId = areaPanels[0]?.trapezoidId
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
      // Split panels by panelRowIdx so each physical row gets its own rail layout
      const panelRowGroups = {}
      for (const p of areaPanels) {
        const ri = p.panelRowIdx ?? 0
        if (!panelRowGroups[ri]) panelRowGroups[ri] = []
        panelRowGroups[ri].push(p)
      }
      const rowIdxKeys = Object.keys(panelRowGroups).map(Number).sort((a, b) => a - b)
      if (rowIdxKeys.length <= 1) {
        const rl = computeRowRailLayout(areaPanels, pixelToCmRatio, cfg)
        if (rl) rl._panelRowIdx = 0
        layouts.push(rl)
        layoutKeys.push(rowKey)
      } else {
        for (const ri of rowIdxKeys) {
          const rl = computeRowRailLayout(panelRowGroups[ri], pixelToCmRatio, cfg)
          if (rl) rl._panelRowIdx = ri
          layouts.push(rl)
          layoutKeys.push(rowKey)  // all sub-rows map to the same area rowKey
        }
      }
    })
    return { railLayouts: layouts, railLayoutKeys: layoutKeys }
  }, [railLayoutsProp, rowKeys, rowGroups, pixelToCmRatio, railConfig, selectedRowIdx, trapLineRailsMap, trapSettingsMap, printMode])

  const totalRails    = railLayouts.reduce((s, rl) => s + (rl?.rails.length ?? 0), 0)
  const totalLeftover = railLayouts.reduce((s, rl) => s + (rl?.rails.reduce((rs, r) => rs + (r.leftoverCm ?? 0), 0) ?? 0), 0)

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

  const overlayProps = {
    railLayouts, rowKeys: railLayoutKeys, rowGroups, beRailByKey, groupKeyToLabel,
    sc, pixelToCmRatio, crossRailEdgeDistMm, railOverhangCm, trapSettingsMap,
  }

  if (printMode) {
    const PM_PAD = 24
    const svgW_pm  = MAX_W + PM_PAD * 2
    const toSvg_pm = (sx, sy) => [PM_PAD + (sx - bbox.minX) * sc, PAD + (sy - bbox.minY) * sc]

    return (
      <svg width={svgW_pm} height={svgH} style={{ display: 'block' }}>
        <HatchedPanels panels={panels} selectedTrapId={null} toSvg={toSvg_pm} sc={sc} pixelToCmRatio={pixelToCmRatio} clipIdPrefix="rcp-pm" />
        <RailsOverlay {...overlayProps} toSvg={toSvg_pm} zoom={1}
          layers={{ rails: true, dimensions: true, materialSummary: true, connectors: true }} />
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

                  <HatchedPanels panels={panels} selectedArea={rowKeys.length <= 1 || selectedRowIdx == null ? null : rowKeys[selectedRowIdx]} toSvg={toSvg} sc={sc} pixelToCmRatio={pixelToCmRatio} clipIdPrefix="rcp" />

                  {/* Rails + layers */}
                  <RailsOverlay {...overlayProps} toSvg={toSvg} zoom={zoom}
                    selectedRowIdx={selectedRowIdx} highlightGroup={highlightGroup}
                    layers={{ rails: showRails, dimensions: showDimensions, materialSummary: showMaterialSummary, connectors: showConnectors }} />

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
              { label: t('step3.layer.connectors'),      checked: showConnectors,      setter: setShowConnectors },
              { label: t('step3.layer.materialSummary'), checked: showMaterialSummary, setter: setShowMaterialSummary },
              { label: t('step3.layer.dimensions'),      checked: showDimensions,      setter: setShowDimensions },
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
