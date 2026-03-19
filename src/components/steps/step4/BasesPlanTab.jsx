import { useState, useMemo } from 'react'
import { computeRowBasePlan, DEFAULT_BASE_EDGE_OFFSET_MM, DEFAULT_BASE_SPACING_MM } from '../../../utils/basePlanService'
import { localToScreen, DEFAULT_RAIL_OVERHANG_CM } from '../../../utils/railLayoutService'
import CanvasNavigator from '../../shared/CanvasNavigator'
import { useCanvasPanZoom } from '../../../hooks/useCanvasPanZoom'
import { fmt, getPanelsBoundingBox, buildRowGroups } from './tabUtils'
import HatchedPanels from './HatchedPanels'
import LayersPanel from './LayersPanel'
import BasesTable from './BasesTable'

const BASE_COLOR = '#000000'

export default function BasesPlanTab({ panels = [], refinedArea, selectedRowIdx = null, rowConstructions = [], settings = {}, lineRails = null, highlightGroup = null }) {
  const edgeOffsetMm      = settings.edgeOffsetMm      ?? DEFAULT_BASE_EDGE_OFFSET_MM
  const spacingMm         = settings.spacingMm         ?? DEFAULT_BASE_SPACING_MM
  const railOverhangCm    = settings.railOverhangCm    ?? DEFAULT_RAIL_OVERHANG_CM
  const crossRailOffsetCm = settings.crossRailOffsetCm ?? 5
  // Derive rail offset from lineRails (first rail of first line), fall back to 0
  const railOffsetCm = lineRails?.[0]?.[0] ?? 0

  const [showBases,      setShowBases]      = useState(true)
  const [showBaseIDs,    setShowBaseIDs]    = useState(true)
  const [showRails,      setShowRails]      = useState(true)
  const [showDimensions, setShowDimensions] = useState(true)
  const [showDiagonals,  setShowDiagonals]  = useState(true)
  const [tableOpen,      setTableOpen]      = useState(true)

  const { zoom, setZoom, panOffset, panActive, containerRef, contentRef, handleWheel, startPan, handleMouseMove, stopPan, resetView, MM_W, MM_H, panToMinimapPoint, getMinimapViewportRect } = useCanvasPanZoom()

  const pixelToCmRatio = refinedArea?.pixelToCmRatio ?? 1
  const railConfig = useMemo(() => ({ overhangCm: railOverhangCm }), [railOverhangCm])
  const baseConfig = useMemo(() => ({ edgeOffsetMm, spacingMm }), [edgeOffsetMm, spacingMm])

  const { map: rowGroups, keys: rowKeys } = useMemo(() => buildRowGroups(panels), [panels])

  const basePlans = useMemo(() =>
    rowKeys.map(rowKey => computeRowBasePlan(rowGroups[rowKey], pixelToCmRatio, railConfig, baseConfig)),
    [rowKeys, rowGroups, pixelToCmRatio, railConfig, baseConfig]
  )

  const totalBases = basePlans.reduce((s, bp) => s + (bp?.baseCount ?? 0), 0)

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
  const sc   = bboxW > 0 ? MAX_W / bboxW : 1
  const svgW = MAX_W + PAD * 2
  const svgH = bboxH * sc + PAD * 2
  const toSvg = (sx, sy) => [PAD + (sx - bbox.minX) * sc, PAD + (sy - bbox.minY) * sc]
  const svgCentX = PAD + (bboxW / 2) * sc
  const svgCentY = PAD + (bboxH / 2) * sc

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'white', position: 'relative' }}>

      {/* Diagram canvas */}
      <div
        style={{ flex: '1 1 0', minHeight: 0, position: 'relative', overflow: 'hidden', background: '#fafafa', cursor: panActive ? 'grabbing' : 'grab' }}
        onMouseDown={startPan} onMouseMove={handleMouseMove} onMouseUp={stopPan} onMouseLeave={stopPan}
        ref={containerRef}
      >
        <div style={{ transform: `translate(${panOffset.x}px, ${panOffset.y}px)`, transformOrigin: 'top left' }}>
          <div ref={contentRef} style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
            <div style={{ padding: '1.25rem 1.25rem 0' }}>
              <svg width={svgW} height={svgH} style={{ display: 'block' }}>
                <defs><style>{`@keyframes hlPulse { 0%,100%{opacity:0.15} 50%{opacity:0.9} }`}</style></defs>

                <HatchedPanels panels={panels} rowKeys={rowKeys} selectedRowIdx={selectedRowIdx} toSvg={toSvg} sc={sc} pixelToCmRatio={pixelToCmRatio} clipIdPrefix="bcp" />

                {/* Frame outlines + bases + dimension annotations */}
                {basePlans.map((bp, i) => {
                  if (!bp) return null
                  const rowOpacity = (selectedRowIdx === null || i === selectedRowIdx) ? 1 : 0.2
                  const { frame, bases, lines } = bp
                  const { angleRad, localBounds, frameXMinPx, frameXMaxPx } = frame

                  const frameCorners = [
                    [frameXMinPx, localBounds.minY], [frameXMaxPx, localBounds.minY],
                    [frameXMaxPx, localBounds.maxY], [frameXMinPx, localBounds.maxY],
                  ].map(([lx, ly]) => toSvg(
                    localToScreen({ x: lx, y: ly }, frame.center, angleRad).x,
                    localToScreen({ x: lx, y: ly }, frame.center, angleRad).y,
                  ))

                  const perpX = -Math.sin(angleRad), perpY = Math.cos(angleRad)
                  const fcx = frameCorners.reduce((s, [x]) => s + x, 0) / 4
                  const fcy = frameCorners.reduce((s, [, y]) => s + y, 0) / 4
                  const outSign = ((fcx - svgCentX) * perpX + (fcy - svgCentY) * perpY) >= 0 ? 1 : -1
                  const apX = outSign * perpX, apY = outSign * perpY
                  const outerLocalY = outSign >= 0 ? localBounds.maxY : localBounds.minY

                  const ANN_OFF = 16 / zoom, TICK = 4 / zoom, EXT_GAP = 2 / zoom, EXT_OVR = 3 / zoom
                  const outerEdgeSvg = (localX) => { const s = localToScreen({ x: localX, y: outerLocalY }, frame.center, angleRad); return toSvg(s.x, s.y) }
                  const annBaseSvg  = (localX) => { const [ex, ey] = outerEdgeSvg(localX); return [ex + apX * ANN_OFF, ey + apY * ANN_OFF] }

                  const segAnnotations = bases.slice(0, -1).map((b1, si) => {
                    const p2 = bases[si + 1]
                    const distMm = Math.round((p2.localX - b1.localX) * pixelToCmRatio * 10)
                    const [ax1, ay1] = annBaseSvg(b1.localX), [ax2, ay2] = annBaseSvg(p2.localX)
                    const [fe1x, fe1y] = outerEdgeSvg(b1.localX), [fe2x, fe2y] = outerEdgeSvg(p2.localX)
                    const dx = ax2 - ax1, dy = ay2 - ay1, len = Math.sqrt(dx * dx + dy * dy)
                    if (len < 2) return null
                    const ux = dx / len, uy = dy / len, px = -uy, py = ux
                    const label = `${distMm}`, fontSize = 11 / zoom
                    const tx = (ax1 + ax2) / 2, ty = (ay1 + ay2) / 2
                    const angle = Math.atan2(dy, dx) * 180 / Math.PI
                    const labelAngle = angle > 90 || angle < -90 ? angle + 180 : angle
                    const bgW = label.length * fontSize * 0.6 + 6 / zoom, bgH = fontSize + 4 / zoom
                    const ex1s = [fe1x + apX * EXT_GAP, fe1y + apY * EXT_GAP], ex1e = [ax1 - apX * EXT_OVR, ay1 - apY * EXT_OVR]
                    const ex2s = [fe2x + apX * EXT_GAP, fe2y + apY * EXT_GAP], ex2e = [ax2 - apX * EXT_OVR, ay2 - apY * EXT_OVR]
                    return (
                      <g key={`ann-${si}`}>
                        <line x1={ex1s[0]} y1={ex1s[1]} x2={ex1e[0]} y2={ex1e[1]} stroke="#000" strokeWidth="0.8" />
                        <line x1={ex2s[0]} y1={ex2s[1]} x2={ex2e[0]} y2={ex2e[1]} stroke="#000" strokeWidth="0.8" />
                        <line x1={ax1} y1={ay1} x2={ax2} y2={ay2} stroke="#000" strokeWidth="1" />
                        <line x1={ax1 - px * TICK} y1={ay1 - py * TICK} x2={ax1 + px * TICK} y2={ay1 + py * TICK} stroke="#000" strokeWidth="1.2" />
                        <line x1={ax2 - px * TICK} y1={ay2 - py * TICK} x2={ax2 + px * TICK} y2={ay2 + py * TICK} stroke="#000" strokeWidth="1.2" />
                        <g transform={`rotate(${labelAngle} ${tx} ${ty})`}>
                          <rect x={tx - bgW / 2} y={ty - bgH / 2} width={bgW} height={bgH} fill="white" stroke="#ccc" strokeWidth={0.5 / zoom} rx={1 / zoom} />
                          <text x={tx} y={ty} textAnchor="middle" dominantBaseline="middle" fontSize={fontSize} fontWeight="700" fill="#000">{label}</text>
                        </g>
                      </g>
                    )
                  })

                  const rc = rowConstructions[i]
                  const railOffPx  = railOffsetCm / pixelToCmRatio
                  const connOffPx  = crossRailOffsetCm  / pixelToCmRatio
                  const topBeamPx  = rc ? rc.topBeamLength / pixelToCmRatio : 0
                  const panelRearY = lines && lines.length > 0 ? lines[0].minY : localBounds.minY
                  const rearLegY   = panelRearY + railOffPx
                  const frontLegY  = panelRearY + railOffPx + topBeamPx
                  const PROFILE_THICK = 4 / pixelToCmRatio * sc

                  const railLocalYs = [];
                  (lines || []).forEach((ln, si) => {
                    const lineCenterY = (ln.minY + ln.maxY) / 2
                    const leftEdgeY  = si === 0              ? panelRearY                  : ln.minY
                    const rightEdgeY = si === lines.length-1 ? lines[lines.length-1].maxY  : ln.maxY
                    let lcY = leftEdgeY  < rearLegY  ? rearLegY  + connOffPx : ln.minY + connOffPx
                    let rcY = rightEdgeY > frontLegY ? frontLegY - connOffPx : ln.maxY - connOffPx
                    const leftDist = lineCenterY - lcY, rightDist = rcY - lineCenterY
                    if (leftDist >= 0 && rightDist >= 0) {
                      if (leftDist <= rightDist) rcY = lineCenterY + leftDist
                      else lcY = lineCenterY - rightDist
                    }
                    railLocalYs.push(lcY, rcY)
                  })

                  return (
                    <g key={`bp-${i}`} opacity={rowOpacity}>
                      {showBases && bases.map((base, bi) => {
                        const beamTop    = localToScreen({ x: base.localX, y: rearLegY  }, frame.center, angleRad)
                        const beamBottom = localToScreen({ x: base.localX, y: frontLegY }, frame.center, angleRad)
                        const [btx, bty] = toSvg(beamTop.x, beamTop.y)
                        const [bbx, bby] = toSvg(beamBottom.x, beamBottom.y)
                        const lineAngle = Math.atan2(bby - bty, bbx - btx) * 180 / Math.PI
                        const isEdgeBase = bi === 0 || bi === bases.length - 1
                        const hlThisBase = (highlightGroup === 'base-edges' && isEdgeBase) || highlightGroup === 'trap-spacing'
                        return (
                          <g key={`base-${bi}`}>
                            {hlThisBase && <line x1={btx} y1={bty} x2={bbx} y2={bby} stroke="#FFB300" strokeWidth={PROFILE_THICK + 8} strokeLinecap="round" style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />}
                            <line x1={btx} y1={bty} x2={bbx} y2={bby} stroke={BASE_COLOR} strokeWidth={PROFILE_THICK} strokeLinecap="round" />
                            {showBaseIDs && (() => {
                              const bx = (btx + bbx) / 2, by = (bty + bby) / 2
                              return (
                                <g transform={`rotate(${lineAngle} ${bx} ${by})`}>
                                  <text x={bx} y={by} textAnchor="middle" dominantBaseline="middle" fontSize={10 / zoom} fontWeight="700" fill="white" style={{ userSelect: 'none' }}>{rc?.typeLetter ?? '?'}{rc?.panelsPerSpan ?? ''}</text>
                                </g>
                              )
                            })()}
                            {showRails && railLocalYs.map((localY, ci) => {
                              const sp = localToScreen({ x: base.localX, y: localY }, frame.center, frame.angleRad)
                              const [cx, cy] = toSvg(sp.x, sp.y)
                              const CW = 4 / pixelToCmRatio * sc, CH = 4 / pixelToCmRatio * sc
                              const hlRail = highlightGroup === 'cross-rails'
                              return (
                                <g key={`conn-${ci}`}>
                                  <g transform={`translate(${cx},${cy}) rotate(${lineAngle})`}>
                                    <rect x={-CW/2} y={-CH/2} width={CW} height={CH} fill="#d1e3f3" stroke="#642165" strokeWidth="1" />
                                    {hlRail && <rect x={-CW/2 - 4} y={-CH/2 - 4} width={CW + 8} height={CH + 8} fill="none" stroke="#FFB300" strokeWidth="2" rx="2" style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />}
                                  </g>
                                </g>
                              )
                            })}
                          </g>
                        )
                      })}

                      {showDiagonals && showBases && bases.length >= 2 && railLocalYs.length >= 2 && (() => {
                        const n = bases.length, C1 = railLocalYs[0], Cm = railLocalYs[railLocalYs.length - 1]
                        const heightAtY_mm = (localY) => {
                          if (!rc || frontLegY <= rearLegY) return 0
                          const t = Math.max(0, Math.min(1, (localY - rearLegY) / (frontLegY - rearLegY)))
                          return (rc.heightRear + t * (rc.heightFront - rc.heightRear)) * 10
                        }
                        const pairs = n === 2 ? [[0, 1]] : [[0, 1], [n - 1, n - 2]]
                        return pairs.flatMap(([ai, bi], pi) => {
                          const ba = bases[ai], bb = bases[bi]
                          return [C1, Cm].map((railY, di) => {
                            const pa = localToScreen({ x: ba.localX, y: railY }, frame.center, angleRad)
                            const pb = localToScreen({ x: bb.localX, y: railY }, frame.center, angleRad)
                            const [x1, y1] = toSvg(pa.x, pa.y), [x2, y2] = toSvg(pb.x, pb.y)
                            const horizMm = Math.abs(bb.localX - ba.localX) * pixelToCmRatio * 10
                            const vertMm  = heightAtY_mm(railY)
                            const distMm  = Math.round(Math.sqrt(horizMm ** 2 + vertMm ** 2))
                            const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
                            const ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI
                            const labelAngle = ang > 90 || ang < -90 ? ang + 180 : ang
                            const fs = 11 / zoom, bgW = String(distMm).length * fs * 0.6 + 6 / zoom, bgH = fs + 4 / zoom, dotR = 4 / zoom
                            return (
                              <g key={`diag-${pi}-${di}`}>
                                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="cyan" strokeWidth={PROFILE_THICK} />
                                <circle cx={x1} cy={y1} r={dotR} fill="cyan" stroke="#006" strokeWidth={0.5/zoom} />
                                <circle cx={x2} cy={y2} r={dotR} fill="white" stroke="cyan" strokeWidth={1/zoom} />
                                <g transform={`rotate(${labelAngle} ${mx} ${my})`}>
                                  <rect x={mx - bgW/2} y={my - bgH/2} width={bgW} height={bgH} fill="white" stroke="#ccc" strokeWidth={0.5/zoom} rx={1/zoom} />
                                  <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle" fontSize={fs} fontWeight="700" fill="#000">{distMm}</text>
                                </g>
                              </g>
                            )
                          })
                        })
                      })()}

                      {showDimensions && (
                        <g style={highlightGroup === 'base-spacing' ? { animation: 'hlPulse 0.75s ease-in-out infinite' } : {}}>
                          {segAnnotations}
                        </g>
                      )}
                    </g>
                  )
                })}
              </svg>
            </div>
          </div>
        </div>

        <LayersPanel
          layers={[
            { label: 'Bases',      checked: showBases,      setter: setShowBases },
            { label: 'Base IDs',   checked: showBaseIDs,    setter: setShowBaseIDs },
            { label: 'Rails',      checked: showRails,      setter: setShowRails },
            { label: 'Dimensions', checked: showDimensions, setter: setShowDimensions },
            { label: 'Diagonals',  checked: showDiagonals,  setter: setShowDiagonals },
          ]}
          summary={`${totalBases} bases total`}
        />

      </div>

      {/* Base Schedule table */}
      <div style={{ flexShrink: 0, borderTop: '1px solid #e8e8e8' }}>
        <button onClick={() => setTableOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 1.25rem', background: '#f8f9fa', border: 'none', cursor: 'pointer', fontSize: '0.72rem', fontWeight: '700', color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          <span style={{ fontSize: '0.6rem' }}>{tableOpen ? '▾' : '▸'}</span>
          Base Schedule
        </button>
        {tableOpen && (
          <div style={{ overflowY: 'auto', maxHeight: '260px', padding: '0.5rem 1.25rem 1rem' }}>
            {rowKeys.map((rowKey, i) => <BasesTable key={rowKey} bp={basePlans[i]} rowIdx={i} />)}
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
