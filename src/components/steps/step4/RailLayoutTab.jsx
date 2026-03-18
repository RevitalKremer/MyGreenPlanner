import { useState, useMemo } from 'react'
import { computeRowRailLayout, DEFAULT_RAIL_OFFSET_CM, DEFAULT_RAIL_OVERHANG_CM, DEFAULT_STOCK_LENGTHS_MM } from '../../../utils/railLayoutService'
import CanvasNavigator from '../../shared/CanvasNavigator'
import { useCanvasPanZoom } from '../../../hooks/useCanvasPanZoom'
import { fmt, getPanelsBoundingBox, buildRowGroups } from './tabUtils'
import HatchedPanels from './HatchedPanels'
import LayersPanel from './LayersPanel'
import RailsTable from './RailsTable'

const RAIL_COLOR_FILL = '#642165'

export default function RailLayoutTab({ panels = [], refinedArea, selectedRowIdx = null, settings = {}, highlightGroup = null }) {
  const railOffsetCm   = settings.railOffsetCm   ?? DEFAULT_RAIL_OFFSET_CM
  const railOverhangCm = settings.railOverhangCm ?? DEFAULT_RAIL_OVERHANG_CM
  const stockLengths   = settings.stockLengths   ?? DEFAULT_STOCK_LENGTHS_MM

  const [showRails,      setShowRails]      = useState(true)
  const [showDimensions, setShowDimensions] = useState(true)
  const [tableOpen,      setTableOpen]      = useState(true)

  const { zoom, setZoom, panOffset, panActive, containerRef, contentRef, handleWheel, startPan, handleMouseMove, stopPan, resetView, MM_W, MM_H, panToMinimapPoint, getMinimapViewportRect } = useCanvasPanZoom()

  const pixelToCmRatio = refinedArea?.pixelToCmRatio ?? 1
  const railConfig = useMemo(() => ({ offsetFromPanelEdge: railOffsetCm, overhangCm: railOverhangCm, stockLengths }), [railOffsetCm, railOverhangCm, stockLengths])

  const { map: rowGroups, keys: rowKeys } = useMemo(() => buildRowGroups(panels), [panels])

  const railLayouts = useMemo(() =>
    rowKeys.map(rowKey => computeRowRailLayout(rowGroups[rowKey], pixelToCmRatio, railConfig)),
    [rowKeys, rowGroups, pixelToCmRatio, railConfig]
  )

  const totalRails   = railLayouts.reduce((s, rl) => s + (rl?.rails.length ?? 0), 0)
  const totalLeftover = railLayouts.reduce((s, rl) => s + (rl?.rails.reduce((rs, r) => rs + r.leftoverMm, 0) ?? 0), 0)

  const bbox = useMemo(() => {
    if (panels.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 }
    return getPanelsBoundingBox(panels)
  }, [panels])

  if (rowKeys.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#aaa', fontSize: '0.95rem' }}>
        No panel rows found — complete Step 3 first.
      </div>
    )
  }

  const PAD = 24, MAX_W = 900
  const bboxW = bbox.maxX - bbox.minX, bboxH = bbox.maxY - bbox.minY
  const sc = bboxW > 0 ? MAX_W / bboxW : 1
  const svgW = MAX_W + PAD * 2, svgH = bboxH * sc + PAD * 2
  const toSvg = (sx, sy) => [PAD + (sx - bbox.minX) * sc, PAD + (sy - bbox.minY) * sc]
  const svgCentX = PAD + (bboxW / 2) * sc, svgCentY = PAD + (bboxH / 2) * sc

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'white' }}>

      {/* Diagram canvas */}
      <div
        style={{ flex: '1 1 0', minHeight: 0, position: 'relative', overflow: 'hidden', background: '#fafafa', cursor: panActive ? 'grabbing' : 'grab' }}
        onWheel={handleWheel} onMouseDown={startPan} onMouseMove={handleMouseMove} onMouseUp={stopPan} onMouseLeave={stopPan}
        ref={containerRef}
      >
        <div style={{ transform: `translate(${panOffset.x}px, ${panOffset.y}px)`, transformOrigin: 'top left' }}>
          <div ref={contentRef} style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
            <div style={{ padding: '1.25rem 1.25rem 0' }}>
              <svg width={svgW} height={svgH} style={{ display: 'block' }}>
                <defs><style>{`@keyframes hlPulse { 0%,100%{opacity:0.15} 50%{opacity:0.9} }`}</style></defs>

                <HatchedPanels panels={panels} rowKeys={rowKeys} selectedRowIdx={selectedRowIdx} toSvg={toSvg} sc={sc} pixelToCmRatio={pixelToCmRatio} clipIdPrefix="rcp" />

                {/* Rails + CAD dimension annotations */}
                {railLayouts.map((rl, i) => {
                  if (!rl) return null
                  const railOpacity = (selectedRowIdx === null || i === selectedRowIdx) ? 1 : 0.2

                  const annotatedLines = new Set(), annotatedRailIds = new Set()
                  for (const rail of rl.rails) {
                    if (!annotatedLines.has(rail.lineIdx)) { annotatedLines.add(rail.lineIdx); annotatedRailIds.add(rail.railId) }
                  }

                  return rl.rails.map(rail => {
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
                    const railOffsetSvg = (railOffsetCm / pixelToCmRatio) * sc
                    const DIM_GAP = 4 / zoom, EXT = railOffsetSvg + DIM_GAP
                    const TICK = 4 / zoom, EXT_OVR = 3 / zoom
                    const pe1x = x1 + apX * railOffsetSvg, pe1y = y1 + apY * railOffsetSvg
                    const pe2x = x2 + apX * railOffsetSvg, pe2y = y2 + apY * railOffsetSvg
                    const ann1x = x1 + apX * EXT, ann1y = y1 + apY * EXT
                    const ann2x = x2 + apX * EXT, ann2y = y2 + apY * EXT

                    let cumMm = 0
                    const segAnnotations = rail.stockSegments.map((segMm, si) => {
                      const startFrac = cumMm / rail.lengthMm
                      cumMm += segMm
                      const endFrac = Math.min(cumMm / rail.lengthMm, 1)
                      const midFrac = (startFrac + endFrac) / 2
                      const tx = x1 + dx * midFrac + apX * EXT, ty = y1 + dy * midFrac + apY * EXT
                      const label = String(segMm), fontSize = 11 / zoom
                      const bgW = label.length * fontSize * 0.6 + 6 / zoom, bgH = fontSize + 4 / zoom
                      const boundary = endFrac < 0.999 ? (
                        <g key={`ib-${si}`}>
                          <line x1={x1 + dx * endFrac + apX * railOffsetSvg} y1={y1 + dy * endFrac + apY * railOffsetSvg} x2={x1 + dx * endFrac + apX * (EXT + EXT_OVR)} y2={y1 + dy * endFrac + apY * (EXT + EXT_OVR)} stroke="#000" strokeWidth={0.8 / zoom} />
                          <line x1={x1 + dx * endFrac + apX * EXT - perpUX * TICK} y1={y1 + dy * endFrac + apY * EXT - perpUY * TICK} x2={x1 + dx * endFrac + apX * EXT + perpUX * TICK} y2={y1 + dy * endFrac + apY * EXT + perpUY * TICK} stroke="#000" strokeWidth={1.2 / zoom} />
                        </g>
                      ) : null
                      return (
                        <g key={`seg-${si}`}>
                          {boundary}
                          <g transform={`rotate(${labelAngle} ${tx} ${ty})`}>
                            <rect x={tx - bgW / 2} y={ty - bgH / 2} width={bgW} height={bgH} fill="white" stroke="#ccc" strokeWidth={0.5 / zoom} rx={1 / zoom} />
                            <text x={tx} y={ty} textAnchor="middle" dominantBaseline="middle" fontSize={fontSize} fontWeight="700" fill="#000">{label}</text>
                          </g>
                        </g>
                      )
                    })

                    const showAnnotation = annotatedRailIds.has(rail.railId)
                    const hlRail = highlightGroup === 'rail-ends', hlCuts = highlightGroup === 'rail-cuts'

                    return (
                      <g key={`${i}-${rail.railId}`} opacity={railOpacity}>
                        {showRails && <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={RAIL_COLOR_FILL} strokeWidth={4 / pixelToCmRatio * sc} strokeLinecap="round" />}
                        {hlRail && showRails && <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#FFB300" strokeWidth={(4 / pixelToCmRatio * sc) + 6} strokeLinecap="round" style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />}
                        {showAnnotation && showDimensions && <>
                          <line x1={pe1x} y1={pe1y} x2={x1 + apX * (EXT + EXT_OVR)} y2={y1 + apY * (EXT + EXT_OVR)} stroke="#000" strokeWidth={0.8 / zoom} />
                          <line x1={pe2x} y1={pe2y} x2={x2 + apX * (EXT + EXT_OVR)} y2={y2 + apY * (EXT + EXT_OVR)} stroke="#000" strokeWidth={0.8 / zoom} />
                          <line x1={ann1x} y1={ann1y} x2={ann2x} y2={ann2y} stroke="#000" strokeWidth={1 / zoom} />
                          <line x1={ann1x - perpUX * TICK} y1={ann1y - perpUY * TICK} x2={ann1x + perpUX * TICK} y2={ann1y + perpUY * TICK} stroke="#000" strokeWidth={1.2 / zoom} />
                          <line x1={ann2x - perpUX * TICK} y1={ann2y - perpUY * TICK} x2={ann2x + perpUX * TICK} y2={ann2y + perpUY * TICK} stroke="#000" strokeWidth={1.2 / zoom} />
                          <g style={hlCuts ? { animation: 'hlPulse 0.75s ease-in-out infinite' } : {}}>{segAnnotations}</g>
                        </>}
                      </g>
                    )
                  })
                })}
              </svg>
            </div>
          </div>
        </div>

        <LayersPanel
          layers={[
            { label: 'Rails',      checked: showRails,      setter: setShowRails },
            { label: 'Dimensions', checked: showDimensions, setter: setShowDimensions },
          ]}
          summary={
            <>
              {totalRails} rails
              {totalLeftover > 0 && <div style={{ color: '#b45309', marginTop: '0.15rem' }}>{fmt(totalLeftover)} mm leftover</div>}
            </>
          }
        />

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

      {/* Rail Schedule table */}
      <div style={{ flexShrink: 0, borderTop: '1px solid #e8e8e8' }}>
        <button onClick={() => setTableOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 1.25rem', background: '#f8f9fa', border: 'none', cursor: 'pointer', fontSize: '0.72rem', fontWeight: '700', color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          <span style={{ fontSize: '0.6rem' }}>{tableOpen ? '▾' : '▸'}</span>
          Rail Schedule
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
