import { useState, useMemo, useRef, useEffect } from 'react'
import { computeRowBasePlan, consolidateAreaBases, DEFAULT_BASE_EDGE_OFFSET_MM, DEFAULT_BASE_SPACING_MM, DEFAULT_BASE_OVERHANG_CM } from '../../../utils/basePlanService'
import { computeRowRailLayout, localToScreen, screenToLocal, DEFAULT_RAIL_OVERHANG_CM, DEFAULT_STOCK_LENGTHS_MM } from '../../../utils/railLayoutService'
import CanvasNavigator from '../../shared/CanvasNavigator'
import { useCanvasPanZoom } from '../../../hooks/useCanvasPanZoom'
import { getPanelsBoundingBox, buildTrapezoidGroups } from './tabUtils'
import HatchedPanels from './HatchedPanels'
import LayersPanel from './LayersPanel'
import BasesTable from './BasesTable'
import BasePlanOverlay from './BasePlanOverlay'
import RulerTool from '../../shared/RulerTool'

const BASE_COLOR      = '#000000'
const RAIL_COLOR_FILL = '#642165'

export default function BasesPlanTab({ panels = [], refinedArea, effectiveSelectedTrapId = null, trapSettingsMap = {}, trapLineRailsMap = {}, trapRCMap = {}, highlightGroup = null, customBasesMap = {}, onBasesChange = null, onResetBases = null }) {
  const [showBases,      setShowBases]      = useState(true)
  const [showBlocks,     setShowBlocks]     = useState(true)
  const [showBaseIDs,    setShowBaseIDs]    = useState(true)
  const [showRailLines,  setShowRailLines]  = useState(true)
  const [showDimensions, setShowDimensions] = useState(true)
  const [showDiagonals,  setShowDiagonals]  = useState(true)
  const [showEditBar,    setShowEditBar]    = useState(true)
  const [rulerActive,    setRulerActive]    = useState(false)
  const [tableOpen,      setTableOpen]      = useState(false)

  const { zoom, setZoom, panOffset, setPanOffset, panActive, containerRef, contentRef, startPan, handleMouseMove, stopPan, resetView, MM_W, MM_H, panToMinimapPoint, getMinimapViewportRect } = useCanvasPanZoom()

  const pixelToCmRatio = refinedArea?.pixelToCmRatio ?? 1
  const svgRef = useRef(null)

  const { map: trapGroups, keys: trapIds } = useMemo(() => buildTrapezoidGroups(panels), [panels])

  const basePlans = useMemo(() =>
    trapIds.map(trapId => {
      const s = trapSettingsMap[trapId] ?? {}
      const railOverhangCm = s.railOverhangCm ?? DEFAULT_RAIL_OVERHANG_CM
      const lineRails = trapLineRailsMap[trapId] ?? null
      const cfg = {
        edgeOffsetMm: s.edgeOffsetMm ?? DEFAULT_BASE_EDGE_OFFSET_MM,
        spacingMm:    s.spacingMm    ?? DEFAULT_BASE_SPACING_MM,
      }
      const customOffsets = customBasesMap[trapId]
      if (customOffsets?.length > 0) cfg.customOffsets = customOffsets
      return computeRowBasePlan(trapGroups[trapId], pixelToCmRatio, { overhangCm: railOverhangCm, lineRails }, cfg)
    }),
    [trapIds, trapGroups, pixelToCmRatio, trapSettingsMap, trapLineRailsMap, customBasesMap]
  )

  const railLayouts = useMemo(() =>
    trapIds.map(trapId => {
      const s = trapSettingsMap[trapId] ?? {}
      const lineRails = trapLineRailsMap[trapId] ?? null
      return computeRowRailLayout(trapGroups[trapId], pixelToCmRatio, {
        lineRails,
        overhangCm:   s.railOverhangCm ?? DEFAULT_RAIL_OVERHANG_CM,
        stockLengths: s.stockLengths   ?? DEFAULT_STOCK_LENGTHS_MM,
      })
    }),
    [trapIds, trapGroups, pixelToCmRatio, trapSettingsMap, trapLineRailsMap]
  )

  // Map trapId → area key (strip trailing digits: "B1" → "B")
  const { trapAreaMap, areaTrapsMap } = useMemo(() => {
    const tam = {}, atm = {}
    for (const trapId of trapIds) {
      const area = trapId.replace(/\d+$/, '')
      tam[trapId] = area
      if (!atm[area]) atm[area] = []
      atm[area].push(trapId)
    }
    return { trapAreaMap: tam, areaTrapsMap: atm }
  }, [trapIds])

  // Object form of basePlans for consolidation lookup
  const basePlansMap = useMemo(() => {
    const m = {}
    trapIds.forEach((trapId, i) => { if (basePlans[i]) m[trapId] = basePlans[i] })
    return m
  }, [trapIds, basePlans])

  // Consolidated bases: bases from shallower sub-areas that fall within a deeper sub-area's
  // x-extent are removed. Result: { trapId: Base[] }
  const consolidatedBasesMap = useMemo(
    () => consolidateAreaBases(areaTrapsMap, basePlansMap),
    [areaTrapsMap, basePlansMap]
  )

  const totalBases = trapIds.reduce((s, trapId) => s + (consolidatedBasesMap[trapId]?.length ?? 0), 0)

  const bbox = useMemo(() => {
    if (panels.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 }
    return getPanelsBoundingBox(panels)
  }, [panels])

  const PAD  = 60, MAX_W = 900  // PAD=60 gives room for edit bars above/below the panel bbox
  const bboxW = bbox.maxX - bbox.minX, bboxH = bbox.maxY - bbox.minY
  const sc   = bboxW > 0 ? MAX_W / bboxW : 1

  // Auto-pan to selected trapezoid when selection changes
  useEffect(() => {
    if (effectiveSelectedTrapId == null) return
    const rowPanels = trapGroups[effectiveSelectedTrapId] ?? []
    if (rowPanels.length === 0) return
    const rb = getPanelsBoundingBox(rowPanels)
    const cx = PAD + ((rb.minX + rb.maxX) / 2 - bbox.minX) * sc
    const cy = PAD + ((rb.minY + rb.maxY) / 2 - bbox.minY) * sc
    const CONTENT_PAD = 20
    requestAnimationFrame(() => {
      if (!containerRef.current) return
      const { width: cw, height: ch } = containerRef.current.getBoundingClientRect()
      setPanOffset({
        x: cw / 2 - (cx + CONTENT_PAD) * zoom,
        y: ch / 2 - (cy + CONTENT_PAD) * zoom,
      })
    })
  }, [effectiveSelectedTrapId, trapGroups, bbox, sc, zoom]) // eslint-disable-line react-hooks/exhaustive-deps

  if (trapIds.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#aaa', fontSize: '0.95rem' }}>
        No panel rows found — complete Step 3 first.
      </div>
    )
  }
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
              <svg ref={svgRef} width={svgW} height={svgH} style={{ display: 'block' }}>
                <defs><style>{`@keyframes hlPulse { 0%,100%{opacity:0.15} 50%{opacity:0.9} }`}</style></defs>

                <HatchedPanels panels={panels} selectedTrapId={effectiveSelectedTrapId} toSvg={toSvg} sc={sc} pixelToCmRatio={pixelToCmRatio} clipIdPrefix="bcp" />

                {/* Per-trap: bases, rails, diagonals */}
                {basePlans.map((bp, i) => {
                  if (!bp) return null
                  const trapId     = trapIds[i]
                  const trapS      = trapSettingsMap[trapId] ?? {}
                  const trapLRails = trapLineRailsMap[trapId] ?? null
                  const trapOpacity = (effectiveSelectedTrapId === null || trapId === effectiveSelectedTrapId) ? 1 : 0.2
                  const { frame, lines } = bp
                  const bases = consolidatedBasesMap[trapId] ?? bp.bases
                  const { angleRad, localBounds } = frame

                  const rc                = trapRCMap[trapId]
                  const railOffsetCm      = trapLRails?.[0]?.[0] ?? 0
                  const crossRailOffsetCm = trapS.crossRailOffsetCm   ?? 5
                  const baseOverhangCm    = trapS.baseOverhangCm      ?? DEFAULT_BASE_OVERHANG_CM
                  const crossRailEdgeMm   = trapS.crossRailEdgeDistMm ?? 40
                  const railOffPx         = railOffsetCm    / pixelToCmRatio
                  const connOffPx         = crossRailOffsetCm / pixelToCmRatio
                  const baseOverhangPx    = baseOverhangCm  / pixelToCmRatio
                  const panelRearY        = lines && lines.length > 0 ? lines[0].minY : localBounds.minY
                  const rearLegY          = panelRearY + railOffPx
                  // frontLegY: last rail of last line (mirrors how rail layer is positioned)
                  let frontLegY = rearLegY
                  if (trapLRails && lines && lines.length > 0) {
                    for (const ln of lines) {
                      const lnRails = trapLRails[ln.lineIdx]
                      if (lnRails && lnRails.length > 0) {
                        const lastRailY = ln.minY + lnRails[lnRails.length - 1] / pixelToCmRatio
                        if (lastRailY > frontLegY) frontLegY = lastRailY
                      }
                    }
                  }
                  // Base extends baseOverhangPx past each rail on both ends
                  const baseTopY    = rearLegY  - baseOverhangPx
                  const baseBottomY = frontLegY + baseOverhangPx
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

                  const railProfileSvg = (crossRailEdgeMm / 10 / pixelToCmRatio) * sc

                  // Block positions along the base line (plan view)
                  const blockWidthCm   = trapS.blockWidthCm ?? 50
                  const blockDepthCm   = trapS.blockDepthCm ?? 50
                  const blockWidthLocal = blockWidthCm / pixelToCmRatio        // along-beam dimension (local frame)
                  const blockWidthSvg  = blockWidthLocal * sc                  // SVG pixels along beam
                  const blockDepthSvg  = (blockDepthCm / pixelToCmRatio) * sc // SVG pixels perpendicular to beam
                  const numBlocks = Math.max(2, (lines || []).reduce((sum, ln) => {
                    return sum + (ln.orientation === 'LANDSCAPE' ? 1 : 2)
                  }, 0))
                  const numCenterBlocks = numBlocks - 2
                  const innerRailYs = [...railLocalYs].sort((a, b) => a - b).slice(1, -1)
                  const centerBlockYs = numCenterBlocks === 0 ? [] : innerRailYs.slice(-numCenterBlocks)
                  const allBlockYCenters = [
                    baseTopY    + blockWidthLocal / 2,
                    ...centerBlockYs,
                    baseBottomY - blockWidthLocal / 2,
                  ]

                  return (
                    <g key={`bp-${trapId}`} opacity={trapOpacity}>
                      {/* Blocks — rendered first (below rails and diagonals) */}
                      {showBlocks && bases.map((base, bi) => {
                        const beamTop    = localToScreen({ x: base.localX, y: baseTopY    }, frame.center, angleRad)
                        const beamBottom = localToScreen({ x: base.localX, y: baseBottomY }, frame.center, angleRad)
                        const [btx, bty] = toSvg(beamTop.x, beamTop.y)
                        const [bbx, bby] = toSvg(beamBottom.x, beamBottom.y)
                        const lineAngle = Math.atan2(bby - bty, bbx - btx) * 180 / Math.PI
                        return allBlockYCenters.map((blockCenterY, bki) => {
                          const sp = localToScreen({ x: base.localX, y: blockCenterY }, frame.center, angleRad)
                          const [bkx, bky] = toSvg(sp.x, sp.y)
                          return (
                            <rect key={`blk-${bi}-${bki}`}
                              x={bkx - blockWidthSvg / 2} y={bky - blockDepthSvg / 2}
                              width={blockWidthSvg} height={blockDepthSvg}
                              fill="#c0c0c0" stroke="#777" strokeWidth={0.5 / zoom}
                              transform={`rotate(${lineAngle} ${bkx} ${bky})`}
                            />
                          )
                        })
                      })}
                      {/* Running rails — read-only layer */}
                      {showRailLines && railLayouts[i]?.rails.map(rail => {
                        const [rx1, ry1] = toSvg(rail.screenStart.x, rail.screenStart.y)
                        const [rx2, ry2] = toSvg(rail.screenEnd.x, rail.screenEnd.y)
                        return (
                          <line key={rail.railId} x1={rx1} y1={ry1} x2={rx2} y2={ry2}
                            stroke={RAIL_COLOR_FILL} strokeWidth={railProfileSvg} strokeLinecap="square" />
                        )
                      })}
                      {showBases && bases.map((base, bi) => {
                        const beamTop    = localToScreen({ x: base.localX, y: baseTopY    }, frame.center, angleRad)
                        const beamBottom = localToScreen({ x: base.localX, y: baseBottomY }, frame.center, angleRad)
                        const [btx, bty] = toSvg(beamTop.x, beamTop.y)
                        const [bbx, bby] = toSvg(beamBottom.x, beamBottom.y)
                        const lineAngle = Math.atan2(bby - bty, bbx - btx) * 180 / Math.PI
                        const isEdgeBase = bi === 0 || bi === bases.length - 1
                        const hlThisBase = (highlightGroup === 'base-edges' && isEdgeBase) || highlightGroup === 'trap-spacing'
                        const hlOverhang = highlightGroup === 'base-overhang'
                        // SVG coords of the rail intersection points (for overhang highlight)
                        const srear  = localToScreen({ x: base.localX, y: rearLegY  }, frame.center, angleRad)
                        const sfront = localToScreen({ x: base.localX, y: frontLegY }, frame.center, angleRad)
                        const [rtx, rty] = toSvg(srear.x,  srear.y)
                        const [rfx, rfy] = toSvg(sfront.x, sfront.y)
                        return (
                          <g key={`base-${bi}`}>
                            {hlThisBase && <line x1={btx} y1={bty} x2={bbx} y2={bby} stroke="#FFB300" strokeWidth={PROFILE_THICK + 8} strokeLinecap="square" style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />}
                            {hlOverhang && <>
                              <line x1={btx} y1={bty} x2={rtx} y2={rty} stroke="#FFB300" strokeWidth={PROFILE_THICK + 8} strokeLinecap="square" style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />
                              <line x1={rfx} y1={rfy} x2={bbx} y2={bby} stroke="#FFB300" strokeWidth={PROFILE_THICK + 8} strokeLinecap="square" style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />
                            </>}
                            <line x1={btx} y1={bty} x2={bbx} y2={bby} stroke={BASE_COLOR} strokeWidth={PROFILE_THICK} strokeLinecap="square" />
                            {showBaseIDs && (() => {
                              const bx = (btx + bbx) / 2, by = (bty + bby) / 2
                              return (
                                <g transform={`rotate(${lineAngle} ${bx} ${by})`}>
                                  <text x={bx} y={by} textAnchor="middle" dominantBaseline="middle" fontSize={28} fontWeight="700" fill="white" style={{ userSelect: 'none' }}>{trapId}</text>
                                </g>
                              )
                            })()}
                          </g>
                        )
                      })}

                      {showDiagonals && showBases && bases.length >= 2 && (() => {
                        const n = bases.length
                        const heightAtY_mm = (localY) => {
                          if (!rc || frontLegY <= rearLegY) return 0
                          const t = Math.max(0, Math.min(1, (localY - rearLegY) / (frontLegY - rearLegY)))
                          return (rc.heightRear + t * (rc.heightFront - rc.heightRear)) * 10
                        }
                        const pairs = n === 2 ? [[0, 1]] : [[0, 1], [n - 1, n - 2]]
                        return pairs.flatMap(([ai, bi], pi) => {
                          const ba = bases[ai], bb = bases[bi]
                          const horizMm = Math.abs(bb.localX - ba.localX) * pixelToCmRatio * 10
                          // Two lines: top-of-A→top-of-B and bottom-of-A→bottom-of-B (diagonals in vertical plane)
                          return [baseTopY, baseBottomY].map((edgeY, di) => {
                            const pa = localToScreen({ x: ba.localX, y: edgeY }, frame.center, angleRad)
                            const pb = localToScreen({ x: bb.localX, y: edgeY }, frame.center, angleRad)
                            const [x1, y1] = toSvg(pa.x, pa.y), [x2, y2] = toSvg(pb.x, pb.y)
                            const vertMm  = heightAtY_mm(edgeY)
                            const distMm  = Math.round(Math.sqrt(horizMm ** 2 + vertMm ** 2))
                            const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
                            const ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI
                            const labelAngle = ang > 90 || ang < -90 ? ang + 180 : ang
                            const fs = 11 / zoom, bgW = String(distMm).length * fs * 0.6 + 6 / zoom, bgH = fs + 4 / zoom, dotR = 7 / zoom
                            return (
                              <g key={`diag-${pi}-${di}`}>
                                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="cyan" strokeWidth={PROFILE_THICK} />
                                <circle cx={x1} cy={y1} r={dotR} fill="cyan" stroke="#006" strokeWidth={1/zoom} />
                                <circle cx={x2} cy={y2} r={dotR} fill="white" stroke="cyan" strokeWidth={2/zoom} />
                                <g transform={`rotate(${labelAngle} ${mx} ${my})`}>
                                  <rect x={mx - bgW/2} y={my - bgH/2} width={bgW} height={bgH} fill="white" stroke="#ccc" strokeWidth={0.5/zoom} rx={1/zoom} />
                                  <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle" fontSize={fs} fontWeight="700" fill="#000">{distMm}</text>
                                </g>
                              </g>
                            )
                          })
                        })
                      })()}

                    </g>
                  )
                })}

                {/* Edit bars — rendered separately so they are always fully visible.
                    Only shown for the selected area (all sub-areas of that area). */}
                {showEditBar && basePlans.map((bp, i) => {
                  if (!bp) return null
                  const trapId     = trapIds[i]
                  const selectedArea = effectiveSelectedTrapId?.replace(/\d+$/, '')
                  if (effectiveSelectedTrapId !== null && trapId.replace(/\d+$/, '') !== selectedArea) return null
                  const trapS      = trapSettingsMap[trapId] ?? {}
                  const { frame }  = bp
                  const { angleRad, localBounds } = frame
                  const areaBarLocalY = (() => {
                    const areaKey = trapId.replace(/\d+$/, '')
                    const areaTraps = areaTrapsMap[areaKey] ?? [trapId]
                    let extremeMinY = localBounds.minY
                    for (const tid of areaTraps) {
                      const otherBp = basePlansMap[tid]
                      if (!otherBp) continue
                      const cyOffset = screenToLocal(otherBp.frame.center, frame.center, angleRad).y
                      extremeMinY = Math.min(extremeMinY, cyOffset + otherBp.frame.localBounds.minY)
                    }
                    return extremeMinY - 20 / zoom
                  })()
                  return (
                    <BasePlanOverlay
                      key={`overlay-${trapId}`}
                      bp={bp}
                      zoom={zoom} pixelToCmRatio={pixelToCmRatio} sc={sc}
                      svgRef={svgRef} toSvg={toSvg}
                      spacingMm={trapS.spacingMm ?? DEFAULT_BASE_SPACING_MM}
                      edgeOffsetMm={trapS.edgeOffsetMm ?? DEFAULT_BASE_EDGE_OFFSET_MM}
                      isSelected={trapId === effectiveSelectedTrapId}
                      overrideBarLocalY={areaBarLocalY}
                      onBasesChange={onBasesChange ? (offsets) => onBasesChange(trapId, offsets) : null}
                    />
                  )
                })}

                {/* Per-area annotation bars — one bar per area at the outermost Y of the full area.
                    All consolidated bases shown; selected sub-area's bases highlighted. */}
                {showDimensions && Object.entries(areaTrapsMap).map(([areaKey, areaTrapIds]) => {
                  // Collect all consolidated bases for this area, tagging each with its trapId
                  const allBases = areaTrapIds.flatMap(tid => {
                    const bp2 = basePlansMap[tid]
                    const b2 = consolidatedBasesMap[tid] ?? bp2?.bases ?? []
                    return b2.map(b => ({ ...b, trapId: tid }))
                  })
                  if (allBases.length < 2) return null

                  // Use the first available trap as the reference frame
                  const refBp = basePlansMap[areaTrapIds.find(tid => basePlansMap[tid])]
                  if (!refBp) return null
                  const { frame: refFrame } = refBp
                  const { angleRad: refAngle, localBounds: refLB, center: refCenter } = refFrame

                  // Project every base into the reference frame's local X
                  const projected = allBases.map(b => ({
                    ...b,
                    localX: screenToLocal(b.screenTop, refCenter, refAngle).x,
                  })).sort((a, b) => a.localX - b.localX)

                  // outSign: which side of the area the annotation bar goes
                  const perpX = -Math.sin(refAngle), perpY = Math.cos(refAngle)
                  const [fcxSvg, fcySvg] = toSvg(refCenter.x, refCenter.y)
                  const outSign = ((fcxSvg - svgCentX) * perpX + (fcySvg - svgCentY) * perpY) >= 0 ? 1 : -1
                  const apX = outSign * perpX, apY = outSign * perpY

                  // Outermost Y across all traps in the area (in the reference frame's local space)
                  let extremeLocalY = outSign >= 0 ? refLB.maxY : refLB.minY
                  for (const tid of areaTrapIds) {
                    const otherBp = basePlansMap[tid]
                    if (!otherBp) continue
                    const cyOffset = screenToLocal(otherBp.frame.center, refCenter, refAngle).y
                    const yMin = cyOffset + otherBp.frame.localBounds.minY
                    const yMax = cyOffset + otherBp.frame.localBounds.maxY
                    extremeLocalY = outSign >= 0 ? Math.max(extremeLocalY, yMax) : Math.min(extremeLocalY, yMin)
                  }

                  const ANN_OFF = 16 / zoom, TICK = 4 / zoom, EXT_GAP = 2 / zoom, EXT_OVR = 3 / zoom
                  const edgeSvg = (lx) => { const s = localToScreen({ x: lx, y: extremeLocalY }, refCenter, refAngle); return toSvg(s.x, s.y) }
                  const annSvg  = (lx) => { const [ex, ey] = edgeSvg(lx); return [ex + apX * ANN_OFF, ey + apY * ANN_OFF] }

                  const selectedArea = effectiveSelectedTrapId?.replace(/\d+$/, '')
                  const isSelectedArea = areaKey === selectedArea
                  const areaOpacity = (effectiveSelectedTrapId === null || isSelectedArea) ? 1 : 0.2

                  const hlStyle = (isSelectedArea && highlightGroup === 'base-spacing')
                    ? { animation: 'hlPulse 0.75s ease-in-out infinite' } : {}

                  return (
                    <g key={`area-ann-${areaKey}`} opacity={areaOpacity} style={hlStyle}>
                      {projected.slice(0, -1).map((b1, si) => {
                        const b2 = projected[si + 1]
                        const distMm = Math.round(Math.abs(b2.localX - b1.localX) * pixelToCmRatio * 10)
                        const [ax1, ay1] = annSvg(b1.localX), [ax2, ay2] = annSvg(b2.localX)
                        const [fe1x, fe1y] = edgeSvg(b1.localX), [fe2x, fe2y] = edgeSvg(b2.localX)
                        const dx = ax2 - ax1, dy = ay2 - ay1, len = Math.sqrt(dx * dx + dy * dy)
                        if (len < 2) return null
                        const tx = (ax1 + ax2) / 2, ty = (ay1 + ay2) / 2
                        const angle = Math.atan2(dy, dx) * 180 / Math.PI
                        const labelAngle = angle > 90 || angle < -90 ? angle + 180 : angle
                        const fontSize = 11 / zoom
                        const label = `${distMm}`
                        const bgW = label.length * fontSize * 0.6 + 6 / zoom, bgH = fontSize + 4 / zoom
                        const px_t = -dy / len, py_t = dx / len
                        // Highlight segment if either base belongs to the selected sub-area
                        const segHighlight = isSelectedArea && (b1.trapId === effectiveSelectedTrapId || b2.trapId === effectiveSelectedTrapId)
                        const lineColor = segHighlight ? '#0056b3' : '#555'
                        const ex1s = [fe1x + apX * EXT_GAP, fe1y + apY * EXT_GAP], ex1e = [ax1 - apX * EXT_OVR, ay1 - apY * EXT_OVR]
                        const ex2s = [fe2x + apX * EXT_GAP, fe2y + apY * EXT_GAP], ex2e = [ax2 - apX * EXT_OVR, ay2 - apY * EXT_OVR]
                        return (
                          <g key={`ann-${si}`}>
                            <line x1={ex1s[0]} y1={ex1s[1]} x2={ex1e[0]} y2={ex1e[1]} stroke={lineColor} strokeWidth={0.8 / zoom} />
                            <line x1={ex2s[0]} y1={ex2s[1]} x2={ex2e[0]} y2={ex2e[1]} stroke={lineColor} strokeWidth={0.8 / zoom} />
                            <line x1={ax1} y1={ay1} x2={ax2} y2={ay2} stroke={lineColor} strokeWidth={1 / zoom} />
                            <line x1={ax1 - px_t * TICK} y1={ay1 - py_t * TICK} x2={ax1 + px_t * TICK} y2={ay1 + py_t * TICK} stroke={lineColor} strokeWidth={1.2 / zoom} />
                            <line x1={ax2 - px_t * TICK} y1={ay2 - py_t * TICK} x2={ax2 + px_t * TICK} y2={ay2 + py_t * TICK} stroke={lineColor} strokeWidth={1.2 / zoom} />
                            <g transform={`rotate(${labelAngle} ${tx} ${ty})`}>
                              <rect x={tx - bgW / 2} y={ty - bgH / 2} width={bgW} height={bgH} fill="white" stroke="#ccc" strokeWidth={0.5 / zoom} rx={1 / zoom} />
                              <text x={tx} y={ty} textAnchor="middle" dominantBaseline="middle" fontSize={fontSize} fontWeight="700" fill={lineColor}>{label}</text>
                            </g>
                          </g>
                        )
                      })}
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
            { label: 'Bases',       checked: showBases,      setter: setShowBases },
            { label: 'Blocks',      checked: showBlocks,     setter: setShowBlocks },
            { label: 'Base IDs',    checked: showBaseIDs,    setter: setShowBaseIDs },
            { label: 'Rail lines',  checked: showRailLines,  setter: setShowRailLines },
            { label: 'Edit bar',    checked: showEditBar,    setter: setShowEditBar },
            { label: 'Annotations', checked: showDimensions, setter: setShowDimensions },
            { label: 'Diagonals',   checked: showDiagonals,  setter: setShowDiagonals },
          ]}
          summary={null}
          actions={[
            ...(onResetBases ? [{ label: 'Reset to defaults', onClick: onResetBases, style: { color: '#b45309', background: '#fffbeb', border: '1px solid #fcd34d' } }] : []),
            { label: rulerActive ? '📏 Ruler ON' : '📏 Ruler', onClick: () => { if (rulerActive) RulerTool._clear?.(); setRulerActive(v => !v) }, style: rulerActive ? { color: '#1565c0', background: '#e3f2fd', border: '1px solid #90caf9' } : {} },
          ]}
        />

      </div>

      {/* Base Schedule table */}
      <div style={{ flexShrink: 0, borderTop: '1px solid #e8e8e8' }}>
        <button onClick={() => setTableOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 1.25rem', background: '#f8f9fa', border: 'none', cursor: 'pointer', fontSize: '0.72rem', fontWeight: '700', color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          <span style={{ fontSize: '0.6rem' }}>{tableOpen ? '▾' : '▸'}</span>
          Base Schedule
          <span style={{ marginLeft: '0.5rem', fontWeight: '400', color: '#888', textTransform: 'none', letterSpacing: 0 }}>
            ({totalBases} bases)
          </span>
        </button>
        {tableOpen && (
          <div style={{ overflowY: 'auto', maxHeight: '260px', padding: '0.5rem 1.25rem 1rem' }}>
            {trapIds.map((trapId, i) => <BasesTable key={trapId} bp={basePlans[i]} rowIdx={i} />)}
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
