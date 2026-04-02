import { useState, useMemo, useRef, useEffect } from 'react'
import { useLang } from '../../../i18n/LangContext'
import { TEXT_SECONDARY, TEXT_VERY_LIGHT, TEXT_PLACEHOLDER, BORDER_FAINT, BORDER_MID, BG_LIGHT, BG_FAINT, BLUE, BLUE_BG, BLUE_BORDER, BLUE_SELECTED, AMBER_DARK, AMBER, BLACK, WHITE, RAIL_STROKE, BLOCK_FILL, BLOCK_STROKE, TEXT_DARKEST, AMBER_BG, AMBER_BORDER, L_PROFILE_STROKE } from '../../../styles/colors'
import { computeRowBasePlan, consolidateAreaBases } from '../../../utils/basePlanService'
import { computeRowRailLayout, localToScreen, screenToLocal } from '../../../utils/railLayoutService'
import CanvasNavigator from '../../shared/CanvasNavigator'
import { useCanvasPanZoom } from '../../../hooks/useCanvasPanZoom'
import { getPanelsBoundingBox, buildTrapezoidGroups } from './tabUtils'
import HatchedPanels from './HatchedPanels'
import LayersPanel from './LayersPanel'
import BasesTable from './BasesTable'
import BasePlanOverlay from './BasePlanOverlay'
import RulerTool from '../../shared/RulerTool'
import DimensionAnnotation from './DimensionAnnotation'


export default function BasesPlanTab({ panels = [], refinedArea, effectiveSelectedTrapId = null, trapSettingsMap = {}, trapLineRailsMap = {}, trapRCMap = {}, beTrapezoidsData = null, beBasesData = null, highlightGroup = null, customBasesMap = {}, onBasesChange = null, onResetBases = null, printMode = false }) {
  const { t } = useLang()
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

  const basePlans = useMemo(() => {
    return trapIds.map(trapId => {
      const s = trapSettingsMap[trapId] ?? {}
      const railOverhangCm = s.railOverhangCm
      const lineRails = trapLineRailsMap[trapId] ?? null
      const cfg = {
        edgeOffsetMm: s.edgeOffsetMm,
        spacingMm:    s.spacingMm   ,
      }
      // customBasesMap is always seeded from BE data — user edits update it directly
      const customOffsets = customBasesMap[trapId]
      if (customOffsets?.length > 0) cfg.customOffsets = customOffsets
      return computeRowBasePlan(trapGroups[trapId], pixelToCmRatio, { overhangCm: railOverhangCm, stockLengths: s.stockLengths, lineRails }, cfg)
    })
  },
    [trapIds, trapGroups, pixelToCmRatio, trapSettingsMap, trapLineRailsMap, customBasesMap]
  )

  const railLayouts = useMemo(() => {
    return trapIds.map(trapId => {
      const s = trapSettingsMap[trapId] ?? {}
      const lineRails = trapLineRailsMap[trapId] ?? null
      return computeRowRailLayout(trapGroups[trapId], pixelToCmRatio, {
        lineRails,
        overhangCm:   s.railOverhangCm,
        stockLengths: s.stockLengths,
      })
    })
  },
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

  // Per-area frame lookup: use the FULL trap's frame (covers all panel lines).
  // All bases in an area share the same coordinate system (startCorner, direction).
  const areaFrames = useMemo(() => {
    const map = {}
    trapIds.forEach((trapId, i) => {
      const bp = basePlans[i]
      if (!bp) return
      const areaKey = trapId.replace(/\d+$/, '')
      // Prefer the full trap (isFullTrap) — it has the widest panel coverage
      const isFullTrap = beTrapezoidsData?.[trapId]?.isFullTrap
      if (!map[areaKey] || isFullTrap) {
        map[areaKey] = { frame: bp.frame, lines: bp.lines, isRtl: bp.isRtl }
      }
    })
    return map
  }, [basePlans, trapIds, beTrapezoidsData])


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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: TEXT_VERY_LIGHT, fontSize: '0.95rem' }}>
        {t('step3.empty.noRows')}
      </div>
    )
  }
  const svgW = MAX_W + PAD * 2
  const svgH = bboxH * sc + PAD * 2
  const toSvg = (sx, sy) => [PAD + (sx - bbox.minX) * sc, PAD + (sy - bbox.minY) * sc]
  const svgCentX = PAD + (bboxW / 2) * sc
  const svgCentY = PAD + (bboxH / 2) * sc

  if (printMode) {
    return (
      <svg width={svgW} height={svgH} style={{ display: 'block' }}>
        <HatchedPanels panels={panels} selectedTrapId={null} toSvg={toSvg} sc={sc} pixelToCmRatio={pixelToCmRatio} clipIdPrefix="bcp-pm" />

        {/* Server-data bases + blocks — each base uses its trapezoidId's frame */}
        {(beBasesData ?? []).map(areaData => areaData.bases?.map((sb, sbi) => {
          const tf = areaFrames[sb.trapezoidId?.replace(/\d+$/, '')]
          if (!tf) return null
          const { frame: tFrame, lines: tLines, isRtl: tIsRtl } = tf
          const { angleRad: tAngle, localBounds: tLB } = tFrame
          const lineY = (tLines?.find(l => l.lineIdx === sb.panelLineIdx) ?? tLines?.[0])?.minY ?? tLB.minY
          const profThick = (4 / pixelToCmRatio) * sc
          const blockWSvg = ((trapSettingsMap[sb.trapezoidId]?.blockWidthCm ?? 24) / pixelToCmRatio) * sc

          const lx = tIsRtl ? tLB.maxX - sb.offsetFromStartCm / pixelToCmRatio : tLB.minX + sb.offsetFromStartCm / pixelToCmRatio
          const ty = lineY + sb.startCm / pixelToCmRatio
          const by = ty + sb.lengthCm / pixelToCmRatio
          const trapBlocks = beTrapezoidsData?.[sb.trapezoidId]?.blocks ?? []
          const st = localToScreen({ x: lx, y: ty }, tFrame.center, tAngle)
          const sbo = localToScreen({ x: lx, y: by }, tFrame.center, tAngle)
          const [btx, bty] = toSvg(st.x, st.y)
          const [bbx, bby] = toSvg(sbo.x, sbo.y)
          const la = Math.atan2(bby - bty, bbx - btx) * 180 / Math.PI
          const mx = (btx + bbx) / 2, my = (bty + bby) / 2

          return (
            <g key={`sb-${areaData.areaLabel}-${sbi}`}>
              {trapBlocks.map((blk, bki) => {
                const slSvg = ((blk.slopeLengthCm ?? 51) / pixelToCmRatio) * sc
                const bcy = ty + ((blk.slopePositionCm ?? blk.positionCm) + (blk.slopeLengthCm ?? 51) / 2) / pixelToCmRatio
                const sp = localToScreen({ x: lx, y: bcy }, tFrame.center, tAngle)
                const [bkx, bky] = toSvg(sp.x, sp.y)
                return <rect key={`blk-${sbi}-${bki}`} x={bkx - slSvg / 2} y={bky - blockWSvg / 2} width={slSvg} height={blockWSvg} fill={BLOCK_FILL} stroke={BLOCK_STROKE} strokeWidth={0.5} transform={`rotate(${la} ${bkx} ${bky})`} />
              })}
              <line x1={btx} y1={bty} x2={bbx} y2={bby} stroke={L_PROFILE_STROKE} strokeWidth={profThick} strokeLinecap="square" />
              <g transform={`rotate(${la} ${mx} ${my})`}>
                <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle" fontSize={28} fontWeight="700" fill="red" style={{ userSelect: 'none' }}>{sb.trapezoidId}</text>
              </g>
            </g>
          )
        }))}

        {basePlans.map((bp, i) => {
          if (!bp) return null
          const trapId     = trapIds[i]
          const trapS      = trapSettingsMap[trapId] ?? {}
          const trapLRails = trapLineRailsMap[trapId] ?? null
          const { frame, lines } = bp
          const bases = consolidatedBasesMap[trapId] ?? bp.bases
          const { angleRad, localBounds } = frame
          const rc = trapRCMap[trapId]
          const rearLineIdx    = lines && lines.length > 0 ? lines[0].lineIdx : 0
          const railOffsetCm   = trapLRails?.[rearLineIdx]?.[0] ?? 0
          const crossRailOffsetCm = trapS.crossRailOffsetCm
          const baseOverhangCm = trapS.baseOverhangCm
          const crossRailEdgeMm = trapS.crossRailEdgeDistMm ?? 40
          const railOffPx      = railOffsetCm / pixelToCmRatio
          const connOffPx      = crossRailOffsetCm / pixelToCmRatio
          const baseOverhangPx = baseOverhangCm / pixelToCmRatio
          const panelRearY     = lines && lines.length > 0 ? lines[0].minY : localBounds.minY
          const rearLegY       = panelRearY + railOffPx
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
          const baseTopY    = rearLegY - baseOverhangPx
          const baseBottomY = frontLegY + baseOverhangPx
          const PROFILE_THICK = 4 / pixelToCmRatio * sc
          const railLocalYs = []
          ;(lines || []).forEach((ln, si) => {
            const lineCenterY = (ln.minY + ln.maxY) / 2
            const leftEdgeY  = si === 0              ? panelRearY               : ln.minY
            const rightEdgeY = si === lines.length-1 ? lines[lines.length-1].maxY : ln.maxY
            let lcY = leftEdgeY  < rearLegY  ? rearLegY  + connOffPx : ln.minY + connOffPx
            let rcY = rightEdgeY > frontLegY ? frontLegY - connOffPx : ln.maxY - connOffPx
            const leftDist = lineCenterY - lcY, rightDist = rcY - lineCenterY
            if (leftDist >= 0 && rightDist >= 0) {
              if (leftDist <= rightDist) rcY = lineCenterY + leftDist
              else lcY = lineCenterY - rightDist
            }
            railLocalYs.push(lcY, rcY)
          })
          const railProfileSvg  = (crossRailEdgeMm / 10 / pixelToCmRatio) * sc
          return (
            <g key={`bp-${trapId}`}>
              {/* Rails only — bases and blocks rendered in area-level loop above */}
              {railLayouts[i]?.rails.map(rail => {
                const [rx1, ry1] = toSvg(rail.screenStart.x, rail.screenStart.y)
                const [rx2, ry2] = toSvg(rail.screenEnd.x, rail.screenEnd.y)
                return <line key={rail.railId} x1={rx1} y1={ry1} x2={rx2} y2={ry2} stroke={RAIL_STROKE} strokeWidth={railProfileSvg} strokeLinecap="square" />
              })}
              {bases.length >= 2 && (() => {
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
                  return [baseTopY, baseBottomY].map((edgeY, di) => {
                    const pa = localToScreen({ x: ba.localX, y: edgeY }, frame.center, angleRad)
                    const pb = localToScreen({ x: bb.localX, y: edgeY }, frame.center, angleRad)
                    const [x1, y1] = toSvg(pa.x, pa.y), [x2, y2] = toSvg(pb.x, pb.y)
                    const vertMm  = heightAtY_mm(edgeY)
                    const distMm  = Math.round(Math.sqrt(horizMm ** 2 + vertMm ** 2))
                    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
                    const ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI
                    const labelAngle = ang > 90 || ang < -90 ? ang + 180 : ang
                    const fs = 11, bgW = String(distMm).length * fs * 0.6 + 6, bgH = fs + 4, dotR = 7
                    return (
                      <g key={`diag-${pi}-${di}`}>
                        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={BLUE} strokeWidth={PROFILE_THICK} />
                        <circle cx={x1} cy={y1} r={dotR} fill={BLUE} stroke={TEXT_DARKEST} strokeWidth={1} />
                        <circle cx={x2} cy={y2} r={dotR} fill={WHITE} stroke={BLUE} strokeWidth={2} />
                        <g transform={`rotate(${labelAngle} ${mx} ${my})`}>
                          <rect x={mx - bgW / 2} y={my - bgH / 2} width={bgW} height={bgH} fill={WHITE} stroke={BORDER_MID} strokeWidth={0.5} rx={1} />
                          <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle" fontSize={fs} fontWeight="700" fill={BLACK}>{distMm}</text>
                        </g>
                      </g>
                    )
                  })
                })
              })()}
            </g>
          )
        })}
        {Object.entries(areaTrapsMap).map(([areaKey, areaTrapIds]) => {
          const allBases = areaTrapIds.flatMap(tid => {
            const bp2 = basePlansMap[tid]
            const b2  = consolidatedBasesMap[tid] ?? bp2?.bases ?? []
            return b2.map(b => ({ ...b, trapId: tid }))
          })
          if (allBases.length < 2) return null
          const refBp = basePlansMap[areaTrapIds.find(tid => basePlansMap[tid])]
          if (!refBp) return null
          const { frame: refFrame } = refBp
          const { angleRad: refAngle, localBounds: refLB, center: refCenter } = refFrame
          const projected = allBases.map(b => ({
            ...b, localX: screenToLocal(b.screenTop, refCenter, refAngle).x,
          })).sort((a, b) => a.localX - b.localX)
          const perpX = -Math.sin(refAngle), perpY = Math.cos(refAngle)
          const [fcxSvg, fcySvg] = toSvg(refCenter.x, refCenter.y)
          const outSign = ((fcxSvg - svgCentX) * perpX + (fcySvg - svgCentY) * perpY) >= 0 ? 1 : -1
          const apX = outSign * perpX, apY = outSign * perpY
          let extremeLocalY = outSign >= 0 ? refLB.maxY : refLB.minY
          for (const tid of areaTrapIds) {
            const otherBp = basePlansMap[tid]
            if (!otherBp) continue
            const cyOffset = screenToLocal(otherBp.frame.center, refCenter, refAngle).y
            extremeLocalY = outSign >= 0
              ? Math.max(extremeLocalY, cyOffset + otherBp.frame.localBounds.maxY)
              : Math.min(extremeLocalY, cyOffset + otherBp.frame.localBounds.minY)
          }
          const ANN_OFF = 16, EXT_GAP = 2
          const edgeSvg = (lx) => { const s = localToScreen({ x: lx, y: extremeLocalY }, refCenter, refAngle); return toSvg(s.x, s.y) }
          const annSvg  = (lx) => { const [ex, ey] = edgeSvg(lx); return [ex + apX * ANN_OFF, ey + apY * ANN_OFF] }
          const measurePts = projected.map(b => { const [ex, ey] = edgeSvg(b.localX); return [ex + apX * EXT_GAP, ey + apY * EXT_GAP] })
          const annPts  = projected.map(b => annSvg(b.localX))
          const labels  = projected.slice(0, -1).map((b1, si) => String(Math.round(Math.abs(projected[si + 1].localX - b1.localX) * pixelToCmRatio * 10)))
          return (
            <g key={`area-ann-${areaKey}`}>
              <DimensionAnnotation measurePts={measurePts} annPts={annPts} labels={labels} zoom={1} color={TEXT_SECONDARY} />
            </g>
          )
        })}
      </svg>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'white', position: 'relative' }}>

      {/* Diagram canvas */}
      <div
        style={{ flex: '1 1 0', minHeight: 0, position: 'relative', overflow: 'hidden', background: BG_FAINT, cursor: panActive ? 'grabbing' : 'grab' }}
        onMouseDown={startPan} onMouseMove={handleMouseMove} onMouseUp={stopPan} onMouseLeave={stopPan}
        ref={containerRef}
      >
        <div style={{ transform: `translate(${panOffset.x}px, ${panOffset.y}px)`, transformOrigin: 'top left' }}>
          <div ref={contentRef} style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
            <div style={{ padding: '1.25rem 1.25rem 0' }}>
              <svg ref={svgRef} width={svgW} height={svgH} style={{ display: 'block' }}>
                <defs><style>{`@keyframes hlPulse { 0%,100%{opacity:0.15} 50%{opacity:0.9} }`}</style></defs>

                <HatchedPanels panels={panels} selectedTrapId={effectiveSelectedTrapId} toSvg={toSvg} sc={sc} pixelToCmRatio={pixelToCmRatio} clipIdPrefix="bcp" />

                {/* Server-data bases + blocks — each base uses its trapezoidId's frame */}
                {(beBasesData ?? []).map(areaData => areaData.bases?.map((sb, sbi) => {
                  const tf = areaFrames[sb.trapezoidId?.replace(/\d+$/, '')]
                  if (!tf) return null
                  const { frame: tFrame, lines: tLines, isRtl: tIsRtl } = tf
                  const { angleRad: tAngle, localBounds: tLB } = tFrame
                  const lineY = (tLines?.find(l => l.lineIdx === sb.panelLineIdx) ?? tLines?.[0])?.minY ?? tLB.minY
                  const profThick = (4 / pixelToCmRatio) * sc
                  const blockWSvg = ((trapSettingsMap[sb.trapezoidId]?.blockWidthCm ?? 24) / pixelToCmRatio) * sc

                  const lx = tIsRtl ? tLB.maxX - sb.offsetFromStartCm / pixelToCmRatio : tLB.minX + sb.offsetFromStartCm / pixelToCmRatio
                  const ty = lineY + sb.startCm / pixelToCmRatio
                  const by = ty + sb.lengthCm / pixelToCmRatio
                  const trapBlocks = beTrapezoidsData?.[sb.trapezoidId]?.blocks ?? []
                  const st = localToScreen({ x: lx, y: ty }, tFrame.center, tAngle)
                  const sbo = localToScreen({ x: lx, y: by }, tFrame.center, tAngle)
                  const [btx, bty] = toSvg(st.x, st.y)
                  const [bbx, bby] = toSvg(sbo.x, sbo.y)
                  const la = Math.atan2(bby - bty, bbx - btx) * 180 / Math.PI
                  const mx = (btx + bbx) / 2, my = (bty + bby) / 2

                  return (
                    <g key={`sb-${areaData.areaLabel}-${sbi}`}>
                      {showBlocks && trapBlocks.map((blk, bki) => {
                        const slSvg = ((blk.slopeLengthCm ?? 51) / pixelToCmRatio) * sc
                        const bcy = ty + ((blk.slopePositionCm ?? blk.positionCm) + (blk.slopeLengthCm ?? 51) / 2) / pixelToCmRatio
                        const sp = localToScreen({ x: lx, y: bcy }, tFrame.center, tAngle)
                        const [bkx, bky] = toSvg(sp.x, sp.y)
                        return <rect key={`blk-${sbi}-${bki}`} x={bkx - slSvg / 2} y={bky - blockWSvg / 2} width={slSvg} height={blockWSvg} fill={BLOCK_FILL} stroke={BLOCK_STROKE} strokeWidth={0.5 / zoom} transform={`rotate(${la} ${bkx} ${bky})`} />
                      })}
                      {showBases && <>
                        <line x1={btx} y1={bty} x2={bbx} y2={bby} stroke={L_PROFILE_STROKE} strokeWidth={profThick} strokeLinecap="square" />
                        {showBaseIDs && <g transform={`rotate(${la} ${mx} ${my})`}><text x={mx} y={my} textAnchor="middle" dominantBaseline="middle" fontSize={28} fontWeight="700" fill="white" style={{ userSelect: 'none' }}>{sb.trapezoidId}</text></g>}
                      </>}
                    </g>
                  )
                }))}

                {/* Per-trap: rails, diagonals, edit bar */}
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
                  const rearLineIdx       = lines && lines.length > 0 ? lines[0].lineIdx : 0
                  const railOffsetCm      = trapLRails?.[rearLineIdx]?.[0] ?? 0
                  const crossRailOffsetCm = trapS.crossRailOffsetCm   ?? 5
                  const baseOverhangCm    = trapS.baseOverhangCm
                  const crossRailEdgeMm   = trapS.crossRailEdgeDistMm
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
                  return (
                    <g key={`bp-${trapId}`} opacity={trapOpacity}>
                      {/* Rails only — bases and blocks rendered in area-level loop above */}
                      {showRailLines && railLayouts[i]?.rails.map(rail => {
                        const [rx1, ry1] = toSvg(rail.screenStart.x, rail.screenStart.y)
                        const [rx2, ry2] = toSvg(rail.screenEnd.x, rail.screenEnd.y)
                        return (
                          <line key={rail.railId} x1={rx1} y1={ry1} x2={rx2} y2={ry2}
                            stroke={RAIL_STROKE} strokeWidth={railProfileSvg} strokeLinecap="square" />
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
                                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={BLUE} strokeWidth={PROFILE_THICK} />
                                <circle cx={x1} cy={y1} r={dotR} fill={BLUE} stroke={TEXT_DARKEST} strokeWidth={1/zoom} />
                                <circle cx={x2} cy={y2} r={dotR} fill={WHITE} stroke={BLUE} strokeWidth={2/zoom} />
                                <g transform={`rotate(${labelAngle} ${mx} ${my})`}>
                                  <rect x={mx - bgW/2} y={my - bgH/2} width={bgW} height={bgH} fill={WHITE} stroke={BORDER_MID} strokeWidth={0.5/zoom} rx={1/zoom} />
                                  <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle" fontSize={fs} fontWeight="700" fill={BLACK}>{distMm}</text>
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
                      spacingMm={trapS.spacingMm}
                      edgeOffsetMm={trapS.edgeOffsetMm}
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

                  const ANN_OFF = 16 / zoom, EXT_GAP = 2 / zoom
                  const edgeSvg = (lx) => { const s = localToScreen({ x: lx, y: extremeLocalY }, refCenter, refAngle); return toSvg(s.x, s.y) }
                  const annSvg  = (lx) => { const [ex, ey] = edgeSvg(lx); return [ex + apX * ANN_OFF, ey + apY * ANN_OFF] }

                  const selectedArea = effectiveSelectedTrapId?.replace(/\d+$/, '')
                  const isSelectedArea = areaKey === selectedArea
                  const areaOpacity = (effectiveSelectedTrapId === null || isSelectedArea) ? 1 : 0.2
                  const hlStyle = (isSelectedArea && highlightGroup === 'base-spacing')
                    ? { animation: 'hlPulse 0.75s ease-in-out infinite' } : {}

                  const measurePts = projected.map(b => { const [ex, ey] = edgeSvg(b.localX); return [ex + apX * EXT_GAP, ey + apY * EXT_GAP] })
                  const annPts    = projected.map(b => annSvg(b.localX))
                  const labels    = projected.slice(0, -1).map((b1, si) => String(Math.round(Math.abs(projected[si + 1].localX - b1.localX) * pixelToCmRatio * 10)))
                  const segColors = projected.slice(0, -1).map((b1, si) => {
                    const b2 = projected[si + 1]
                    return (isSelectedArea && (b1.trapId === effectiveSelectedTrapId || b2.trapId === effectiveSelectedTrapId)) ? BLUE_SELECTED : TEXT_SECONDARY
                  })

                  return (
                    <g key={`area-ann-${areaKey}`} opacity={areaOpacity} style={hlStyle}>
                      <DimensionAnnotation measurePts={measurePts} annPts={annPts} labels={labels} colors={segColors} zoom={zoom} />
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
            { label: t('step3.layer.bases'),      checked: showBases,      setter: setShowBases },
            { label: t('step3.layer.blocks'),     checked: showBlocks,     setter: setShowBlocks },
            { label: t('step3.layer.baseIDs'),    checked: showBaseIDs,    setter: setShowBaseIDs },
            { label: t('step3.layer.railLines'),  checked: showRailLines,  setter: setShowRailLines },
            { label: t('step3.layer.editBar'),    checked: showEditBar,    setter: setShowEditBar },
            { label: t('step3.layer.dimensions'), checked: showDimensions, setter: setShowDimensions },
            { label: t('step3.layer.diagonals'),  checked: showDiagonals,  setter: setShowDiagonals },
          ]}
          summary={null}
          actions={[
            ...(onResetBases ? [{ label: t('step3.layer.resetDefaults'), onClick: onResetBases, style: { color: AMBER_DARK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}` } }] : []),
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

      {/* Base Schedule table */}
      <div style={{ flexShrink: 0, borderTop: `1px solid ${BORDER_FAINT}` }}>
        <button onClick={() => setTableOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 1.25rem', background: BG_LIGHT, border: 'none', cursor: 'pointer', fontSize: '0.72rem', fontWeight: '700', color: TEXT_SECONDARY, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          <span style={{ fontSize: '0.6rem' }}>{tableOpen ? '▾' : '▸'}</span>
          Base Schedule
          <span style={{ marginLeft: '0.5rem', fontWeight: '400', color: TEXT_PLACEHOLDER, textTransform: 'none', letterSpacing: 0 }}>
            ({totalBases} bases)
          </span>
        </button>
        {tableOpen && (
          <div style={{ overflowY: 'auto', maxHeight: '260px', padding: '0.5rem 1.25rem 1rem' }}>
            {trapIds.map((trapId, i) => <BasesTable key={trapId} bp={basePlans[i]} rowIdx={i} />)}
          </div>
        )}
      </div>

    </div>
  )
}
