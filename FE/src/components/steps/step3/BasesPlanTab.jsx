import { useState, useMemo, useRef, useEffect } from 'react'
import { useLang } from '../../../i18n/LangContext'
import { TEXT_SECONDARY, TEXT_VERY_LIGHT, TEXT_PLACEHOLDER, BORDER_FAINT, BORDER_MID, BG_LIGHT, BG_FAINT, BLUE, BLUE_BG, BLUE_BORDER, BLUE_SELECTED, AMBER_DARK, AMBER, BLACK, WHITE, BLOCK_FILL, BLOCK_STROKE, TEXT_DARKEST, AMBER_BG, AMBER_BORDER, L_PROFILE_STROKE } from '../../../styles/colors'
import { computeRowBasePlan, consolidateAreaBases } from '../../../utils/basePlanService'
import { computeRowRailLayout, computePanelFrame, localToScreen } from '../../../utils/railLayoutService'
import CanvasNavigator from '../../shared/CanvasNavigator'
import { useCanvasPanZoom } from '../../../hooks/useCanvasPanZoom'
import { getPanelsBoundingBox, buildTrapezoidGroups } from './tabUtils'
import HatchedPanels from './HatchedPanels'
import LayersPanel from './LayersPanel'
import BasesTable from './BasesTable'
import BasePlanOverlay from './BasePlanOverlay'
import RailsOverlay from './RailsOverlay'
import RulerTool from '../../shared/RulerTool'
import DimensionAnnotation from './DimensionAnnotation'


export default function BasesPlanTab({ panels = [], refinedArea, areas = [], effectiveSelectedTrapId = null, trapSettingsMap = {}, trapLineRailsMap = {}, trapRCMap = {}, beTrapezoidsData = null, beBasesData = null, highlightGroup = null, customBasesMap = {}, onBasesChange = null, onResetBases = null, printMode = false, roofType = 'concrete', purlinDistCm = 0, installationOrientation = null }) {
  const { t } = useLang()
  const [showBases,      setShowBases]      = useState(true)
  const [showBlocks,     setShowBlocks]     = useState(true)
  const [showBaseIDs,    setShowBaseIDs]    = useState(true)
  const [showRailLines,  setShowRailLines]  = useState(true)
  const [showDimensions, setShowDimensions] = useState(true)
  const [showDiagonals,  setShowDiagonals]  = useState(true)
  const [showEditBar,    setShowEditBar]    = useState(false)
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

  // Wait for BE data to be ready before rendering
  const dataReady = (beBasesData && beBasesData.length > 0) || printMode

  // Map trapId → area key (strip trailing digits: "B1" → "B")
  // Build area maps from areas prop (id-based) with fallback to trapId stripping
  const { trapAreaMap, areaTrapsMap } = useMemo(() => {
    const tam = {}, atm = {}
    if (areas.length > 0) {
      // Use areas prop: key by area.id, map trapezoidIds to area id
      for (const area of areas) {
        const aid = area.id
        if (!atm[aid]) atm[aid] = []
        for (const tid of (area.trapezoidIds || [])) {
          tam[tid] = aid
          atm[aid].push(tid)
        }
      }
    } else {
      // Fallback for print mode (no areas prop): derive from trapezoidId
      for (const trapId of trapIds) {
        const area = trapId.replace(/\d+$/, '')
        tam[trapId] = area
        if (!atm[area]) atm[area] = []
        atm[area].push(trapId)
      }
    }
    return { trapAreaMap: tam, areaTrapsMap: atm }
  }, [trapIds, areas])

  // BE rail lookup keyed by trapId:railId (for RailsOverlay)
  const beRailByKey = useMemo(() => {
    const m = {}
    for (const areaData of (beBasesData ?? [])) {
      const areaTrapIds = areaTrapsMap[areaData.areaId] ?? areaTrapsMap[areaData.areaLabel] ?? areaTrapsMap[areaData.label] ?? []
      for (const r of (areaData.rails ?? [])) {
        for (const tid of areaTrapIds) {
          m[`${tid}:${r.railId}`] = r
        }
      }
    }
    return m
  }, [beBasesData, areaTrapsMap])

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

  // Per-area frame: computed from ALL panels in the area (covers all panel lines).
  // Keyed by area id (from trapAreaMap) when available, fallback to stripped trapezoidId.
  const areaFrames = useMemo(() => {
    const areaPanels = {}
    for (const p of panels) {
      const tid = p.trapezoidId ?? 'A1'
      const areaKey = trapAreaMap[tid] ?? tid.replace(/\d+$/, '')
      if (!areaPanels[areaKey]) areaPanels[areaKey] = []
      areaPanels[areaKey].push(p)
    }
    const map = {}
    for (const [areaKey, areaPnls] of Object.entries(areaPanels)) {
      const pf = computePanelFrame(areaPnls)
      if (!pf) continue
      const lineMap = {}
      for (const pr of pf.panelLocalRects) {
        const li = pr.line ?? 0
        if (!lineMap[li]) lineMap[li] = { lineIdx: li, minY: Infinity, maxY: -Infinity }
        lineMap[li].minY = Math.min(lineMap[li].minY, pr.localY)
        lineMap[li].maxY = Math.max(lineMap[li].maxY, pr.localY + pr.height)
      }
      const lines = Object.values(lineMap).sort((a, b) => a.minY - b.minY)
      const isRtl = areaPnls[0]?.xDir === 'rtl'
      const isBtt = areaPnls[0]?.yDir === 'btt'
      map[areaKey] = { frame: { center: pf.center, angleRad: pf.angleRad, localBounds: pf.localBounds }, lines, isRtl, isBtt }
    }
    // Also key by area label so beBasesData lookups work (label may differ from id)
    for (const area of areas) {
      const idKey = area.id
      if (idKey != null && map[idKey] && area.label && area.label !== String(idKey)) {
        map[area.label] = map[idKey]
      }
    }
    return map
  }, [panels, trapAreaMap, areas])


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

  if (!dataReady) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: TEXT_VERY_LIGHT, fontSize: '0.95rem' }}>
        {t('step3.bases.loading')}
      </div>
    )
  }

  // Print mode: all layers on, no selection, zoom=1, no edit bar
  const effTrapId = printMode ? null : effectiveSelectedTrapId
  const effZoom   = printMode ? 1 : zoom
  const sBases    = printMode || showBases
  const sBlocks   = printMode || showBlocks
  const sBaseIDs  = printMode || showBaseIDs
  const sRails    = printMode || showRailLines
  const sDiags    = printMode || showDiagonals
  const sDims     = printMode || showDimensions
  const sEditBar  = !printMode && showEditBar

  // ── SVG layers (shared by both print and interactive modes) ──
  const svgLayers = (
    <>
      <HatchedPanels panels={panels} selectedTrapId={effTrapId} toSvg={toSvg} sc={sc} pixelToCmRatio={pixelToCmRatio} clipIdPrefix="bcp" />

      {/* Purlin lines for parallel installation — parallel to bases, starting from first base */}
      {(roofType === 'iskurit' || roofType === 'insulated_panel') && installationOrientation === 'parallel' && purlinDistCm > 0 && (beBasesData ?? []).map((areaData, ai) => {
        const areaKey = areaData.areaId ?? areaData.areaLabel ?? areaData.label
        const af = areaFrames[areaKey] ?? areaFrames[areaData.areaLabel] ?? areaFrames[areaData.label]
        if (!af) return null
        const { frame: tFrame, lines: tLines, isRtl: tIsRtl } = af
        const { angleRad: tAngle, localBounds: tLB } = tFrame
        const allBases = areaData.bases ?? []
        if (!allBases.length) return null
        // First base position as anchor
        const firstBaseOffsetCm = allBases[0].offsetFromStartCm
        const purlinStepPx = purlinDistCm / pixelToCmRatio
        // Base depth extent (Y range) for line length
        const firstLine = tLines?.[0]
        const yMin = firstLine?.minY ?? tLB.minY
        const yMax = firstLine?.maxY ?? tLB.maxY
        const yPad = 15 / pixelToCmRatio
        const pLines = []
        // Draw lines at purlin intervals from first base, in both directions
        const firstBasePx = firstBaseOffsetCm / pixelToCmRatio
        const anchorX = tIsRtl ? tLB.maxX - firstBasePx : tLB.minX + firstBasePx
        for (let step = 0; ; step++) {
          const offsetPx = step * purlinStepPx
          const lx = tIsRtl ? anchorX + offsetPx : anchorX - offsetPx
          if (lx < tLB.minX - yPad && step > 0) break
          if (lx > tLB.maxX + yPad && step > 0) break
          const p1 = localToScreen({ x: lx, y: yMin - yPad }, tFrame.center, tAngle)
          const p2 = localToScreen({ x: lx, y: yMax + yPad }, tFrame.center, tAngle)
          const [x1, y1] = toSvg(p1.x, p1.y)
          const [x2, y2] = toSvg(p2.x, p2.y)
          if (!isNaN(x1) && !isNaN(y1)) pLines.push({ x1, y1, x2, y2 })
          if (step === 0) continue  // anchor drawn, now go forward
        }
        // Also draw forward from anchor
        for (let step = 1; ; step++) {
          const offsetPx = step * purlinStepPx
          const lx = tIsRtl ? anchorX - offsetPx : anchorX + offsetPx
          if (lx < tLB.minX - yPad) break
          if (lx > tLB.maxX + yPad) break
          const p1 = localToScreen({ x: lx, y: yMin - yPad }, tFrame.center, tAngle)
          const p2 = localToScreen({ x: lx, y: yMax + yPad }, tFrame.center, tAngle)
          const [x1, y1] = toSvg(p1.x, p1.y)
          const [x2, y2] = toSvg(p2.x, p2.y)
          if (!isNaN(x1) && !isNaN(y1)) pLines.push({ x1, y1, x2, y2 })
        }
        return pLines.map((l, i) => (
          <line key={`purlin-${ai}-${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
            stroke="#4a7c59" strokeWidth={1.5 / effZoom} strokeDasharray={`${4 / effZoom} ${3 / effZoom}`} opacity={0.5} />
        ))
      })}

      {/* Z-order: 0. Panels, 1. Rails, 2. Blocks, 3. Bases, 4. Base IDs, 5. Diagonals, 6. Dimensions, 7. Edit bar */}

                {/* 1. Rails */}
                <RailsOverlay
                  railLayouts={railLayouts}
                  rowKeys={trapIds}
                  rowGroups={trapGroups}
                  beRailByKey={beRailByKey}
                  toSvg={toSvg}
                  sc={sc}
                  pixelToCmRatio={pixelToCmRatio}
                  zoom={effZoom}
                  layers={{ rails: sRails, dimensions: false, materialSummary: false, connectors: false }}
                  crossRailEdgeDistMm={trapSettingsMap[trapIds[0]]?.crossRailEdgeDistMm ?? 50}
                  selectedRowIdx={effTrapId ? trapIds.indexOf(effTrapId) : null}
                  trapSettingsMap={trapSettingsMap}
                />

                {/* 2. Blocks */}
                {sBlocks && (beBasesData ?? []).map((areaData, ai) => {
                  const areaKey = areaData.areaId ?? areaData.areaLabel ?? areaData.label
                  const af = areaFrames[areaKey] ?? areaFrames[areaData.areaLabel] ?? areaFrames[areaData.label]
                  if (!af) return null
                  const { frame: tFrame, lines: tLines, isRtl: tIsRtl, isBtt: tIsBtt } = af
                  const { angleRad: tAngle, localBounds: tLB } = tFrame
                  const areaTrapIds = areaTrapsMap[areaKey] ?? areaTrapsMap[areaData.areaLabel] ?? []
                  const fullTrapId = areaTrapIds.find(tid => beTrapezoidsData?.[tid]?.isFullTrap) ?? areaTrapIds[0]
                  const liveOffsets = customBasesMap[fullTrapId]
                  return (areaData.bases ?? []).map((sb, sbi) => {
                    const line = tLines?.find(l => l.lineIdx === sb.panelLineIdx) ?? tLines?.[0]
                    const offsetCm = liveOffsets?.[sbi] != null ? liveOffsets[sbi] / 10 : sb.offsetFromStartCm
                    const lx = tIsRtl ? tLB.maxX - offsetCm / pixelToCmRatio : tLB.minX + offsetCm / pixelToCmRatio
                    const depthPx = sb.startCm / pixelToCmRatio
                    const lenPx = sb.lengthCm / pixelToCmRatio
                    const ty = tIsBtt ? (line?.maxY ?? tLB.maxY) - depthPx - lenPx : (line?.minY ?? tLB.minY) + depthPx
                    const by = ty + lenPx
                    const st = localToScreen({ x: lx, y: ty }, tFrame.center, tAngle)
                    const sbo = localToScreen({ x: lx, y: by }, tFrame.center, tAngle)
                    const [btx, bty] = toSvg(st.x, st.y)
                    const [bbx, bby] = toSvg(sbo.x, sbo.y)
                    const la = Math.atan2(bby - bty, bbx - btx) * 180 / Math.PI
                    // Only render blocks that fit within this base's actual length
                    const trapBlocks = (beTrapezoidsData?.[sb.trapezoidId]?.blocks ?? [])
                      .filter(blk => (blk.slopePositionCm ?? 0) + (blk.slopeLengthCm ?? 51) <= sb.lengthCm + 1)
                    const blockWSvg = ((trapSettingsMap[sb.trapezoidId]?.blockWidthCm ?? 24) / pixelToCmRatio) * sc
                    return trapBlocks.map((blk, bki) => {
                      const slSvg = ((blk.slopeLengthCm ?? 51) / pixelToCmRatio) * sc
                      const blkOffsetPx = ((blk.slopePositionCm ?? 0) + (blk.slopeLengthCm ?? 51) / 2) / pixelToCmRatio
                      const bcy = tIsBtt ? by - blkOffsetPx : ty + blkOffsetPx
                      const sp = localToScreen({ x: lx, y: bcy }, tFrame.center, tAngle)
                      const [bkx, bky] = toSvg(sp.x, sp.y)
                      return <rect key={`blk-${ai}-${sbi}-${bki}`} x={bkx - slSvg / 2} y={bky - blockWSvg / 2} width={slSvg} height={blockWSvg} fill={BLOCK_FILL} stroke={BLOCK_STROKE} strokeWidth={0.5 / effZoom} transform={`rotate(${la} ${bkx} ${bky})`} />
                    })
                  })
                })}

                {/* 3. Bases + 4. Base IDs */}
                {sBases && (beBasesData ?? []).map((areaData, ai) => {
                  const areaKey = areaData.areaId ?? areaData.areaLabel ?? areaData.label
                  const af = areaFrames[areaKey] ?? areaFrames[areaData.areaLabel] ?? areaFrames[areaData.label]
                  if (!af) return null
                  const { frame: tFrame, lines: tLines, isRtl: tIsRtl, isBtt: tIsBtt } = af
                  const { angleRad: tAngle, localBounds: tLB } = tFrame
                  const profThick = (4 / pixelToCmRatio) * sc
                  const areaTrapIds = areaTrapsMap[areaKey] ?? areaTrapsMap[areaData.areaLabel] ?? []
                  const fullTrapId = areaTrapIds.find(tid => beTrapezoidsData?.[tid]?.isFullTrap) ?? areaTrapIds[0]
                  const liveOffsets = customBasesMap[fullTrapId]
                  return (areaData.bases ?? []).map((sb, sbi) => {
                    const line = tLines?.find(l => l.lineIdx === sb.panelLineIdx) ?? tLines?.[0]
                    const offsetCm = liveOffsets?.[sbi] != null ? liveOffsets[sbi] / 10 : sb.offsetFromStartCm
                    const lx = tIsRtl ? tLB.maxX - offsetCm / pixelToCmRatio : tLB.minX + offsetCm / pixelToCmRatio
                    const depthPx = sb.startCm / pixelToCmRatio
                    const lenPx = sb.lengthCm / pixelToCmRatio
                    const ty = tIsBtt ? (line?.maxY ?? tLB.maxY) - depthPx - lenPx : (line?.minY ?? tLB.minY) + depthPx
                    const by = ty + lenPx
                    const st = localToScreen({ x: lx, y: ty }, tFrame.center, tAngle)
                    const sbo = localToScreen({ x: lx, y: by }, tFrame.center, tAngle)
                    const [btx, bty] = toSvg(st.x, st.y)
                    const [bbx, bby] = toSvg(sbo.x, sbo.y)
                    const la = Math.atan2(bby - bty, bbx - btx) * 180 / Math.PI
                    const mx = (btx + bbx) / 2, my = (bty + bby) / 2
                    return (
                      <g key={`base-${ai}-${sbi}`}>
                        <line x1={btx} y1={bty} x2={bbx} y2={bby} stroke={L_PROFILE_STROKE} strokeWidth={profThick} strokeLinecap="square" />
                        {sBaseIDs && <g transform={`rotate(${la} ${mx} ${my})`}><text x={mx} y={my} textAnchor="middle" dominantBaseline="middle" fontSize={28} fontWeight="700" fill={WHITE} stroke={BLACK} strokeWidth={0.5/zoom} paintOrder="stroke" style={{ userSelect: 'none' }}>{sb.trapezoidId}</text></g>}
                      </g>
                    )
                  })
                })}

                {/* 5. External diagonals */}
                {sDiags && sBases && (beBasesData ?? []).map((areaData, ai) => {
                  const areaKey = areaData.areaId ?? areaData.areaLabel ?? areaData.label
                  const af = areaFrames[areaKey] ?? areaFrames[areaData.areaLabel] ?? areaFrames[areaData.label]
                  if (!af) return null
                  const { frame: tFrame, lines: tLines, isRtl: tIsRtl, isBtt: tIsBtt } = af
                  const { angleRad: tAngle, localBounds: tLB } = tFrame
                  const PROFILE_THICK = (4 / pixelToCmRatio) * sc
                  const diags = areaData.diagonals ?? []
                  const allBases = areaData.bases ?? []
                  const areaTids = areaTrapsMap[areaKey] ?? areaTrapsMap[areaData.areaLabel] ?? []
                  const fullTrapId = areaTids.find(tid => beTrapezoidsData?.[tid]?.isFullTrap) ?? areaTids[0]
                  const liveOffsets = customBasesMap[fullTrapId]

                  // Derive each connection point from its base position + diagonal offset
                  return diags.map((d, di) => {
                    const baseA = allBases[d.startBaseIdx]
                    const baseB = allBases[d.endBaseIdx]
                    if (!baseA || !baseB) return null

                    // X: base offsetFromStartCm (with live drag override)
                    const xA = (liveOffsets?.[d.startBaseIdx] != null ? liveOffsets[d.startBaseIdx] / 10 : baseA.offsetFromStartCm)
                    const xB = (liveOffsets?.[d.endBaseIdx] != null ? liveOffsets[d.endBaseIdx] / 10 : baseB.offsetFromStartCm)
                    const lxA = tIsRtl ? tLB.maxX - xA / pixelToCmRatio : tLB.minX + xA / pixelToCmRatio
                    const lxB = tIsRtl ? tLB.maxX - xB / pixelToCmRatio : tLB.minX + xB / pixelToCmRatio

                    // Y: base startCm + diagonal offset along the base beam
                    const lineA = tLines?.find(l => l.lineIdx === baseA.panelLineIdx) ?? tLines?.[0]
                    const lineB = tLines?.find(l => l.lineIdx === baseB.panelLineIdx) ?? tLines?.[0]
                    const depthA = (baseA.startCm + (d.startBaseOffsetCm ?? 0)) / pixelToCmRatio
                    const depthB = (baseB.startCm + (d.endBaseOffsetCm ?? 0)) / pixelToCmRatio
                    const lyA = tIsBtt ? (lineA?.maxY ?? tLB.maxY) - depthA : (lineA?.minY ?? tLB.minY) + depthA
                    const lyB = tIsBtt ? (lineB?.maxY ?? tLB.maxY) - depthB : (lineB?.minY ?? tLB.minY) + depthB

                    const pa = localToScreen({ x: lxA, y: lyA }, tFrame.center, tAngle)
                    const pb = localToScreen({ x: lxB, y: lyB }, tFrame.center, tAngle)
                    const [x1, y1] = toSvg(pa.x, pa.y)
                    const [x2, y2] = toSvg(pb.x, pb.y)
                    if (isNaN(x1) || isNaN(y1)) return null

                    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
                    const ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI
                    const labelAngle = ang > 90 || ang < -90 ? ang + 180 : ang
                    const diagLabel = (d.diagLengthMm / 1000).toFixed(2)
                    const fs = 11 / effZoom, bgW = diagLabel.length * fs * 0.55 + 6 / effZoom, bgH = fs + 4 / effZoom, dotR = 7 / effZoom

                    return (
                      <g key={`diag-${ai}-${di}`}>
                          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={BLUE} strokeWidth={PROFILE_THICK} />
                          <circle cx={x1} cy={y1} r={dotR} fill={BLUE} stroke={TEXT_DARKEST} strokeWidth={1/effZoom} />
                          <circle cx={x2} cy={y2} r={dotR} fill={WHITE} stroke={BLUE} strokeWidth={2/effZoom} />
                          <g transform={`rotate(${labelAngle} ${mx} ${my})`}>
                            <rect x={mx - bgW/2} y={my - bgH/2} width={bgW} height={bgH} fill={WHITE} stroke={BORDER_MID} strokeWidth={0.5/effZoom} rx={1/effZoom} />
                            <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle" fontSize={fs} fontWeight="700" fill={BLACK}>{diagLabel}</text>
                          </g>
                      </g>
                    )
                  })
                })}

                {/* 6. Dimensions */}
                {sDims && Object.entries(areaTrapsMap).map(([areaKey, areaTrapIds]) => {
                  const af = areaFrames[areaKey]
                  if (!af) return null
                  const { frame: refFrame, isRtl: afIsRtl } = af
                  const { angleRad: refAngle, localBounds: refLB, center: refCenter } = refFrame

                  const areaData = (beBasesData ?? []).find(ad => String(ad.areaId) === String(areaKey) || ad.areaLabel === areaKey || ad.label === areaKey)
                  const allBases = (areaData?.bases ?? []).map(sb => ({
                    ...sb, trapId: sb.trapezoidId,
                    localX: afIsRtl ? refLB.maxX - sb.offsetFromStartCm / pixelToCmRatio : refLB.minX + sb.offsetFromStartCm / pixelToCmRatio,
                  }))
                  if (allBases.length < 2) return null

                  const projected = allBases.sort((a, b) => a.localX - b.localX)

                  const isBtt = af.isBtt
                  const perpX = -Math.sin(refAngle), perpY = Math.cos(refAngle)
                  const outSign = isBtt ? -1 : 1
                  const apX = outSign * perpX, apY = outSign * perpY

                  const extremeLocalY = outSign >= 0 ? refLB.maxY : refLB.minY

                  const ANN_OFF = 16 / effZoom, EXT_GAP = 2 / effZoom
                  const edgeSvg = (lx) => { const s = localToScreen({ x: lx, y: extremeLocalY }, refCenter, refAngle); return toSvg(s.x, s.y) }
                  const annSvg  = (lx) => { const [ex, ey] = edgeSvg(lx); return [ex + apX * ANN_OFF, ey + apY * ANN_OFF] }

                  const selectedArea = effTrapId ? trapAreaMap[effTrapId] : null
                  const isSelectedArea = areaKey === selectedArea
                  const hlStyle = (isSelectedArea && highlightGroup === 'base-spacing')
                    ? { animation: 'hlPulse 0.75s ease-in-out infinite' } : {}

                  const measurePts = projected.map(b => { const [ex, ey] = edgeSvg(b.localX); return [ex + apX * EXT_GAP, ey + apY * EXT_GAP] })
                  const annPts    = projected.map(b => annSvg(b.localX))
                  const labels    = projected.slice(0, -1).map((b1, si) => String(Math.round(Math.abs(projected[si + 1].localX - b1.localX) * pixelToCmRatio * 10)))
                  const segColors = projected.slice(0, -1).map((b1, si) => {
                    const b2 = projected[si + 1]
                    return (isSelectedArea && (b1.trapId === effTrapId || b2.trapId === effTrapId)) ? BLUE_SELECTED : TEXT_SECONDARY
                  })

                  return (
                    <g key={`area-ann-${areaKey}`} style={hlStyle}>
                      <DimensionAnnotation measurePts={measurePts} annPts={annPts} labels={labels} colors={segColors} zoom={effZoom} />
                    </g>
                  )
                })}

                {/* 7. Edit bar */}
                {sEditBar && Object.entries(areaTrapsMap).map(([areaKey, areaTrapIds]) => {
                  const af = areaFrames[areaKey]
                  if (!af?.frame?.center) return null
                  const selectedArea = effTrapId ? trapAreaMap[effTrapId] : null
                  if (effTrapId !== null && String(areaKey) !== String(selectedArea)) return null
                  const { frame: areaFrame, isRtl: afIsRtl, isBtt: afIsBtt } = af
                  const areaData = (beBasesData ?? []).find(ad => String(ad.areaId) === String(areaKey) || ad.areaLabel === areaKey || ad.label === areaKey)
                  if (!areaData?.bases?.length) return null
                  const fullTrapId = areaTrapIds.find(tid => beTrapezoidsData?.[tid]?.isFullTrap) ?? areaTrapIds[0]
                  const trapS = trapSettingsMap[fullTrapId] ?? {}
                  const { center, angleRad, localBounds } = areaFrame
                  const frameLengthPx = localBounds.maxX - localBounds.minX
                  const liveOffsets = customBasesMap[fullTrapId]
                  const syntheticBases = areaData.bases.map((sb, sbi) => {
                    const offMm = liveOffsets?.[sbi] ?? Math.round(sb.offsetFromStartCm * 10)
                    const offCm = offMm / 10
                    const lx = afIsRtl
                      ? localBounds.maxX - offCm / pixelToCmRatio
                      : localBounds.minX + offCm / pixelToCmRatio
                    return { offsetFromStartMm: offMm, localX: lx }
                  })
                  const syntheticBp = {
                    frame: { center, angleRad, localBounds, frameXMinPx: localBounds.minX, frameXMaxPx: localBounds.maxX },
                    bases: syntheticBases,
                    frameLengthMm: Math.round(frameLengthPx * pixelToCmRatio * 10),
                    isRtl: afIsRtl,
                  }
                  const barLocalY = afIsBtt ? localBounds.maxY + 20 / effZoom : localBounds.minY - 20 / effZoom
                  return (
                    <BasePlanOverlay
                      key={`overlay-${areaKey}`}
                      bp={syntheticBp}
                      zoom={effZoom} pixelToCmRatio={pixelToCmRatio} sc={sc}
                      svgRef={svgRef} toSvg={toSvg}
                      spacingMm={trapS.spacingMm}
                      edgeOffsetMm={trapS.edgeOffsetMm}
                      isSelected={true}
                      overrideBarLocalY={barLocalY}
                      onBasesChange={onBasesChange ? (offsets) => onBasesChange(fullTrapId, offsets) : null}
                    />
                  )
                })}
    </>
  )

  // ── Print mode: just the SVG, no interactive chrome ──
  if (printMode) {
    return (
      <svg width={svgW} height={svgH} style={{ display: 'block' }}>
        {svgLayers}
      </svg>
    )
  }

  // ── Interactive mode: pan/zoom wrapper + layers panel ──
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'white', position: 'relative' }}>
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
                {svgLayers}
              </svg>
            </div>
          </div>
        </div>

        <RulerTool active={rulerActive} zoom={zoom} pxPerCm={sc / pixelToCmRatio} containerRef={containerRef} />

        <LayersPanel
          layers={[
            { label: t('step3.layer.bases'),      checked: showBases,      setter: setShowBases },
            { label: t('step3.layer.baseIDs'),    checked: showBaseIDs,    setter: setShowBaseIDs },
            { label: t('step3.layer.blocks'),     checked: showBlocks,     setter: setShowBlocks },
            { label: t('step3.layer.railLines'),  checked: showRailLines,  setter: setShowRailLines },
            { label: t('step3.layer.diagonals'),  checked: showDiagonals,  setter: setShowDiagonals },
            { label: t('step3.layer.dimensions'), checked: showDimensions, setter: setShowDimensions },
            { label: t('step3.layer.editBar'),    checked: showEditBar,    setter: setShowEditBar },
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
          {t('step3.bases.scheduleTitle')}
          <span style={{ marginLeft: '0.5rem', fontWeight: '400', color: TEXT_PLACEHOLDER, textTransform: 'none', letterSpacing: 0 }}>
            ({t('step3.bases.count', { n: totalBases, s: totalBases === 1 ? '' : 's' })})
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
