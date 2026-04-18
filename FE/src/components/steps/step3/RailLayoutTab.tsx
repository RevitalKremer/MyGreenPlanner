import { useState, useMemo, useRef, useCallback, useLayoutEffect } from 'react'
import { useLang } from '../../../i18n/LangContext'
import { TEXT_VERY_LIGHT, TEXT_PLACEHOLDER, TEXT_SECONDARY, BORDER_FAINT, BG_LIGHT, BG_FAINT, BLUE, BLUE_BG, BLUE_BORDER, AMBER_DARK, AMBER_BG, AMBER_BORDER } from '../../../styles/colors'
import { buildBeRailLookup, buildGroupKeyToLabelMap, computeAllRowRailLayouts } from '../../../utils/railLayoutService'
import CanvasNavigator from '../../shared/CanvasNavigator'
import { useCanvasPanZoom } from '../../../hooks/useCanvasPanZoom'
import { getPanelsBoundingBox, expandBboxForImage, buildRowGroups } from './tabUtils'
import HatchedPanels from './HatchedPanels'
import RailsOverlay from './RailsOverlay'
import LayersPanel from './LayersPanel'
import BackgroundImageLayer from './BackgroundImageLayer'
import RailsTable from './RailsTable'
import RailCrossSectionOverlay from './RailCrossSectionOverlay'
import RulerTool from '../../shared/RulerTool'


export default function RailLayoutTab({
  panels = [], refinedArea, selectedRowIdx = null, selectedPanelRowIdx = 0,
  uploadedImageData, imageSrc,
  settings = {},
  lineRails,           // { [lineIdx]: [offsetCm, ...] }
  panelDepthsCm,       // [depthCm, ...]
  keepSymmetry,
  onLineRailsChange,   // (newLineRails) => void
  onApplyRailsToAll,
  onResetRails,
  highlightGroup = null,
  printMode = false,
  printShowRoofImage = true,
  printSc = null,   // pre-computed scale to maximize page fit (PDF only)
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

  const [showRoofImage,       setShowRoofImage]       = useState(true)
  const [showRails,           setShowRails]           = useState(true)
  const [showDimensions,      setShowDimensions]      = useState(true)
  const [showMaterialSummary, setShowMaterialSummary] = useState(true)
  const [showConnectors,      setShowConnectors]      = useState(true)
  const [showEditBar,    setShowEditBar]    = useState(false)
  const [rulerActive,         setRulerActive]         = useState(false)
  const [tableOpen,           setTableOpen]           = useState(false)
  const initialMountRef = useRef(true)

  const { zoom, setZoom, panOffset, setPanOffset, panActive, containerRef, contentRef, startPan, handleMouseMove, stopPan, resetView, centerView, MM_W, MM_H, panToMinimapPoint, getMinimapViewportRect } = useCanvasPanZoom()

  const pixelToCmRatio = refinedArea?.pixelToCmRatio ?? 1
  const railConfig = useMemo(() => ({
    lineRails,
    overhangCm: railOverhangCm,
    stockLengths,
  }), [lineRails, railOverhangCm, stockLengths])

  const { map: rowGroups, keys: rowKeys } = useMemo(() => buildRowGroups(panels), [panels])

  const nonEmptyPanels = useMemo(() => panels.filter(p => !p.isEmpty), [panels])

  const beRailByKey = useMemo(() => buildBeRailLookup(beRailsData), [beRailsData])

  const groupKeyToLabel = useMemo(
    () => buildGroupKeyToLabelMap(panels, rowKeys, beRailsData),
    [panels, rowKeys, beRailsData],
  )

  // Compute rail layouts — one per physical panel row (multi-row areas expand to multiple entries)
  const { railLayouts, railLayoutKeys } = useMemo(() => {
    if (railLayoutsProp) return { railLayouts: railLayoutsProp, railLayoutKeys: rowKeys }
    return computeAllRowRailLayouts({
      rowKeys, rowGroups, pixelToCmRatio,
      selectedRowIdx, selectedPanelRowIdx, printMode,
      lineRails, trapSettingsMap, railOverhangCm, stockLengths,
      beRailsData, groupKeyToLabel,
    })
  }, [railLayoutsProp, rowKeys, rowGroups, pixelToCmRatio, railConfig, selectedRowIdx, trapLineRailsMap, trapSettingsMap, printMode])

  const totalRails    = railLayouts.reduce((s, rl) => s + (rl?.rails.length ?? 0), 0)
  const totalLeftover = railLayouts.reduce((s, rl) => s + (rl?.rails.reduce((rs, r) => rs + (r.leftoverCm ?? 0), 0) ?? 0), 0)

  const bbox = useMemo(() => {
    if (nonEmptyPanels.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 }
    const panelBbox = getPanelsBoundingBox(nonEmptyPanels)
    return expandBboxForImage(panelBbox, uploadedImageData)
  }, [nonEmptyPanels, uploadedImageData])

  const PAD = 24, PAD_LEFT = 180, MAX_W = 851  // edit-mode width target
  const bboxW = bbox.maxX - bbox.minX, bboxH = bbox.maxY - bbox.minY
  const sc = printMode && printSc != null
    ? printSc
    : (bboxW > 0 ? MAX_W / bboxW : 1)
  const svgW = MAX_W + PAD_LEFT + PAD, svgH = bboxH * sc + PAD * 2
  const toSvgFn = (sx, sy) => [PAD_LEFT + (sx - bbox.minX) * sc, PAD + (sy - bbox.minY) * sc]

  // Center view on initial mount at 100% zoom (like Step 2)
  // Use layoutEffect to run before paint and avoid flicker
  useLayoutEffect(() => {
    centerView()
    initialMountRef.current = false
  }, [centerView])

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
  // Cross-section overlay uses the FIRST row of the selected area (rails are per-trapezoid, shared across rows)
  const activeLayoutIdx = useMemo(() => {
    if (selectedRowIdx == null) return 0
    const selectedKey = rowKeys[selectedRowIdx]
    const firstIdx = railLayoutKeys.findIndex(k => k === selectedKey)
    return firstIdx >= 0 ? firstIdx : 0
  }, [selectedRowIdx, rowKeys, railLayoutKeys])
  const activeCrossSectionRl = railLayouts[activeLayoutIdx] ?? railLayouts[0] ?? null

  const overlayProps = {
    railLayouts, rowKeys: railLayoutKeys, rowGroups, beRailByKey, groupKeyToLabel,
    sc, pixelToCmRatio, crossRailEdgeDistMm, railOverhangCm, trapSettingsMap,
  }

  // Effective layer toggles — print forces all layers on; edit uses panel state.
  const sRoofImage      = printMode ? printShowRoofImage : showRoofImage
  const sRails          = printMode ? true : showRails
  const sDimensions     = printMode ? true : showDimensions
  const sMaterialSummary = printMode ? true : showMaterialSummary
  const sConnectors     = printMode ? true : showConnectors

  const renderSvgLayers = (toSvgFn, zoomVal, clipPrefix) => (
    <>
      {sRoofImage && <BackgroundImageLayer
        imageSrc={imageSrc}
        uploadedImageData={uploadedImageData}
        bbox={bbox}
        toSvg={toSvgFn}
        sc={sc}
      />}
      <HatchedPanels
        panels={panels}
        selectedTrapId={null}
        selectedArea={!printMode && rowKeys.length > 1 && selectedRowIdx != null ? rowKeys[selectedRowIdx] : null}
        toSvg={toSvgFn}
        sc={sc}
        pixelToCmRatio={pixelToCmRatio}
        clipIdPrefix={clipPrefix}
      />
      <RailsOverlay {...overlayProps} toSvg={toSvgFn} zoom={zoomVal}
        selectedRowIdx={printMode ? null : selectedRowIdx}
        highlightGroup={printMode ? null : highlightGroup}
        layers={{ rails: sRails, dimensions: sDimensions, materialSummary: sMaterialSummary, connectors: sConnectors }} />
    </>
  )

  if (printMode) {
    const PM_PAD = 24
    const svgW_pm  = bboxW * sc + PM_PAD * 2
    const svgH_pm  = bboxH * sc + PM_PAD * 2
    const toSvg_pm = (sx, sy) => [PM_PAD + (sx - bbox.minX) * sc, PM_PAD + (sy - bbox.minY) * sc]

    return (
      <svg width={svgW_pm} height={svgH_pm} style={{ display: 'block' }}>
        {renderSvgLayers(toSvg_pm, 1, 'rcp-pm')}
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

                  {renderSvgLayers(toSvg, zoom, 'rcp')}

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
              { label: t('step3.layer.roofImage'),       checked: showRoofImage,       setter: setShowRoofImage },
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
