import { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react'
import { useLang } from '../../../i18n/LangContext'
import { TEXT_SECONDARY, TEXT_VERY_LIGHT, TEXT_PLACEHOLDER, BORDER_FAINT, BORDER_MID, BG_LIGHT, BG_FAINT, BLUE, BLUE_BG, BLUE_BORDER, BLUE_SELECTED, AMBER_DARK, AMBER, BLACK, BLOCK_FILL, BLOCK_STROKE, AMBER_BG, AMBER_BORDER, L_PROFILE_STROKE, DIAGONAL_STROKE } from '../../../styles/colors'
import { consolidateAreaBases, buildTrapAreaMaps, buildBasePlanBeRailLookup, computeExpandedBasePlans, buildAreaFrames, buildBasePlansMap } from '../../../utils/basePlanService'
import AreaLabel from '../../shared/AreaLabel'
import { localToScreen } from '../../../utils/railLayoutService'
import CanvasNavigator from '../../shared/CanvasNavigator'
import { useCanvasPanZoom } from '../../../hooks/useCanvasPanZoom'
import { getPanelsBoundingBox, expandBboxForImage, buildTrapezoidGroups } from './tabUtils'
import HatchedPanels from './HatchedPanels'
import { resolveAreaRoofSpec } from '../../../utils/roofSpecUtils'
import LayersPanel from './LayersPanel'
import BackgroundImageLayer from './BackgroundImageLayer'
import BasesTable from './BasesTable'
import BasePlanOverlay from './BasePlanOverlay'
import RailsOverlay from './RailsOverlay'
import RulerTool from '../../shared/RulerTool'
import DimensionAnnotation from './DimensionAnnotation'
import { resolveAreaContext, baseScreenCoords } from './basePlanHelpers'


export default function BasesPlanTab({ panels = [], refinedArea, areas = [], uploadedImageData, imageSrc, effectiveSelectedTrapId = null, selectedRowIdx = null, rowKeys = [] as number[], selectedPanelRowIdx = null, trapSettingsMap = {}, trapLineRailsMap = {}, trapRCMap = {}, beTrapezoidsData = null, beBasesData = null, beRailsData = null, highlightGroup = null, customBasesMap = {}, onBasesChange = null, onResetBases = null, printMode = false, printShowRoofImage = true, printSc = null, roofType = 'concrete', purlinDistCm = 0, installationOrientation = null }) {
  // Resolve each area's effective roof spec using the shared helper.
  const resolveAreaRoof = (areaData) => {
    if (roofType !== 'mixed') return { type: roofType, purlinDistCm, installationOrientation }
    const aid = areaData?.areaId
    const lbl = areaData?.areaLabel ?? areaData?.label
    const a = (areas || []).find(ar => ar.id === aid) || (areas || []).find(ar => ar.label === lbl)
    return resolveAreaRoofSpec(roofType, a)
  }
  const { t } = useLang()
  const [showRoofImage,   setShowRoofImage]   = useState(true)
  const [showBases,      setShowBases]      = useState(true)
  const [showBlocks,     setShowBlocks]     = useState(true)
  const [showBaseIDs,    setShowBaseIDs]    = useState(true)
  const [showRailLines,  setShowRailLines]  = useState(true)
  const [showDimensions, setShowDimensions] = useState(true)
  const [showDiagonals,  setShowDiagonals]  = useState(true)
  const [showEditBar,    setShowEditBar]    = useState(false)
  const [rulerActive,    setRulerActive]    = useState(false)
  const [tableOpen,      setTableOpen]      = useState(false)
  const initialMountRef = useRef(true)

  const { zoom, setZoom, panOffset, setPanOffset, panActive, containerRef, contentRef, startPan, handleMouseMove, stopPan, resetView, centerView, MM_W, MM_H, panToMinimapPoint, getMinimapViewportRect } = useCanvasPanZoom()

  const pixelToCmRatio = refinedArea?.pixelToCmRatio ?? 1
  const svgRef = useRef(null)

  const { map: trapGroups, keys: trapIds } = useMemo(() => buildTrapezoidGroups(panels), [panels])

  const nonEmptyPanels = useMemo(() => panels.filter(p => !p.isEmpty), [panels])

  // Split each trapezoid group by panelRowIdx for multi-row areas
  const { expandedBasePlans: basePlans, expandedRailLayouts: railLayouts, expandedTrapIds } = useMemo(
    () => computeExpandedBasePlans({ trapIds, trapGroups, pixelToCmRatio, trapSettingsMap, customBasesMap, beRailsData, areas }),
    [trapIds, trapGroups, pixelToCmRatio, trapSettingsMap, trapLineRailsMap, customBasesMap, beRailsData, areas],
  )

  // Wait for BE data to be ready before rendering
  const dataReady = (beBasesData && beBasesData.length > 0) || printMode

  const { trapAreaMap, areaTrapsMap } = useMemo(
    () => buildTrapAreaMaps(trapIds, areas),
    [trapIds, areas],
  )

  const beRailByKey = useMemo(
    () => buildBasePlanBeRailLookup(beBasesData, areaTrapsMap),
    [beBasesData, areaTrapsMap],
  )

  const basePlansMap = useMemo(
    () => buildBasePlansMap(expandedTrapIds, basePlans),
    [expandedTrapIds, basePlans],
  )

  // Consolidated bases: bases from shallower sub-areas that fall within a deeper sub-area's
  // x-extent are removed. Result: { trapId: Base[] }
  const consolidatedBasesMap = useMemo(
    () => consolidateAreaBases(areaTrapsMap, basePlansMap),
    [areaTrapsMap, basePlansMap]
  )

  const totalBases = trapIds.reduce((s, trapId) => s + (consolidatedBasesMap[trapId]?.length ?? 0), 0)

  const areaFrames = useMemo(
    () => buildAreaFrames(panels, trapAreaMap, areas),
    [panels, trapAreaMap, areas],
  )


  const bbox = useMemo(() => {
    if (nonEmptyPanels.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 }
    const panelBbox = getPanelsBoundingBox(nonEmptyPanels)
    return expandBboxForImage(panelBbox, uploadedImageData)
  }, [nonEmptyPanels, uploadedImageData])

  const PAD = printMode ? 12 : 60  // edit needs room for edit bars; print is tight
  const MAX_W = 779  // edit-mode width target
  const bboxW = bbox.maxX - bbox.minX, bboxH = bbox.maxY - bbox.minY
  const sc   = printMode && printSc != null
    ? printSc
    : (bboxW > 0 ? MAX_W / bboxW : 1)

  // Center view on initial mount at 100% zoom (like Step 2)
  // Use layoutEffect to run before paint and avoid flicker
  useLayoutEffect(() => {
    centerView()
    initialMountRef.current = false
  }, [centerView])

  // Auto-pan to selected panel row (don't change zoom, only pan)
  useEffect(() => {
    if (initialMountRef.current || selectedPanelRowIdx == null || !containerRef.current) return
    // Find panels for the selected row within the selected area
    const rowPanels = panels.filter(p => (p.panelRowIdx ?? 0) === selectedPanelRowIdx &&
      (effectiveSelectedTrapId ? p.trapezoidId === effectiveSelectedTrapId : true))
    if (rowPanels.length === 0) return
    const rb = getPanelsBoundingBox(rowPanels)
    const cx = PAD + ((rb.minX + rb.maxX) / 2 - bbox.minX) * sc
    const cy = PAD + ((rb.minY + rb.maxY) / 2 - bbox.minY) * sc
    const containerRect = containerRef.current.getBoundingClientRect()
    const targetX = containerRect.width / 2 - cx * zoom
    const targetY = containerRect.height / 2 - cy * zoom
    setPanOffset({ x: targetX, y: targetY })
  }, [selectedPanelRowIdx]) // eslint-disable-line react-hooks/exhaustive-deps

  if (trapIds.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: TEXT_VERY_LIGHT, fontSize: '0.95rem' }}>
        {t('step3.empty.noRows')}
      </div>
    )
  }
  const svgW = printMode ? bboxW * sc + PAD * 2 : MAX_W + PAD * 2
  const svgH = bboxH * sc + PAD * 2
  const toSvg = (sx, sy) => [PAD + (sx - bbox.minX) * sc, PAD + (sy - bbox.minY) * sc]

  // Cap dimension font size so a 4-char label fits within one panel width
  const smallestPanelW = nonEmptyPanels.reduce((min, p) => Math.min(min, Math.min(p.width, p.height) * sc), Infinity)
  const dimMaxFontSize = isFinite(smallestPanelW) ? smallestPanelW / (4 * 0.6) : undefined

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
  const sRails    = !printMode && showRailLines
  const sDiags    = printMode || showDiagonals
  const sDims     = printMode || showDimensions
  const sEditBar  = !printMode && showEditBar

  // ── SVG layers (shared by both print and interactive modes) ──
  const svgLayers = (
    <>
      {(printMode ? printShowRoofImage : showRoofImage) && <BackgroundImageLayer 
        imageSrc={imageSrc}
        uploadedImageData={uploadedImageData}
        bbox={bbox}
        toSvg={toSvg}
        sc={sc}
      />}

      <HatchedPanels
        panels={panels}
        selectedTrapId={null}
        selectedArea={!printMode && rowKeys.length > 1 && selectedRowIdx != null ? rowKeys[selectedRowIdx] : null}
        selectedPanelRowIdx={selectedPanelRowIdx}
        toSvg={toSvg} sc={sc} pixelToCmRatio={pixelToCmRatio} clipIdPrefix="bcp"
      />

      {/* Purlin lines for parallel installation — parallel to bases, starting from first base.
          Per-area in mixed mode: each area uses its own roofSpec.type /
          distanceBetweenPurlinsCm / installationOrientation. Non-mixed
          projects fall through to the project-level scalar props. */}
      {(beBasesData ?? []).map((areaData, ai) => {
        const areaRoof = resolveAreaRoof(areaData)
        if (areaRoof.type !== 'iskurit' && areaRoof.type !== 'insulated_panel') return null
        if (areaRoof.installationOrientation !== 'parallel') return null
        if (!(areaRoof.purlinDistCm > 0)) return null
        const areaKey = areaData.areaId ?? areaData.areaLabel ?? areaData.label
        const af = areaFrames[areaKey] ?? areaFrames[areaData.areaLabel] ?? areaFrames[areaData.label]
        if (!af) return null
        const { frame: tFrame, lines: tLines, isRtl: tIsRtl } = af
        const { angleRad: tAngle, localBounds: tLB } = tFrame
        const allBases = areaData.bases ?? []
        if (!allBases.length) return null
        // First base position as anchor
        const firstBaseOffsetCm = allBases[0].offsetFromStartCm
        const purlinStepPx = areaRoof.purlinDistCm / pixelToCmRatio
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
                  rowKeys={expandedTrapIds}
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
                  return (areaData.bases ?? []).map((sb, sbi) => {
                    const trapDetail = beTrapezoidsData?.[sb.trapezoidId]
                    const allBlocks = trapDetail?.blocks ?? []
                    if (allBlocks.length === 0) return null
                    // Slope length is identical for every block in a trapezoid:
                    // blockLengthCm / cos(angle). BE only emits blocks for
                    // concrete roofs, where both fields are guaranteed.
                    const geom = trapDetail!.geometry
                    if (geom.blockLengthCm == null) return null
                    const slopeBlockLengthCm = geom.blockLengthCm / Math.cos(geom.angle * Math.PI / 180)

                    const ctx = resolveAreaContext(areaData, areaFrames, areaTrapsMap, beTrapezoidsData, customBasesMap, sb._panelRowIdx)
                    if (!ctx) return null
                    const { af } = ctx
                    const { isBtt: tIsBtt } = af
                    const { lx, la } = baseScreenCoords(sb, sbi, { af, pixelToCmRatio, toSvg })
                    const line = af.lines?.find(l => l.lineIdx === sb.panelLineIdx) ?? af.lines?.[0]
                    const depthPx = sb.startCm / pixelToCmRatio
                    const lenPx = sb.lengthCm / pixelToCmRatio
                    const ty = tIsBtt ? (line?.maxY ?? af.frame.localBounds.maxY) - depthPx - lenPx : (line?.minY ?? af.frame.localBounds.minY) + depthPx
                    const by = ty + lenPx
                    // Only render blocks that fit within this base's actual length
                    const trapBlocks = allBlocks.filter(blk => blk.slopePositionCm + slopeBlockLengthCm <= sb.lengthCm + 1)
                    const blockWSvg = (trapSettingsMap[sb.trapezoidId].blockWidthCm / pixelToCmRatio) * sc
                    const slSvg = (slopeBlockLengthCm / pixelToCmRatio) * sc
                    return trapBlocks.map((blk, bki) => {
                      const blkOffsetPx = (blk.slopePositionCm + slopeBlockLengthCm / 2) / pixelToCmRatio
                      const bcy = tIsBtt ? by - blkOffsetPx : ty + blkOffsetPx
                      const sp = localToScreen({ x: lx, y: bcy }, af.frame.center, af.frame.angleRad)
                      const [bkx, bky] = toSvg(sp.x, sp.y)
                      return <rect key={`blk-${ai}-${sbi}-${bki}`} x={bkx - slSvg / 2} y={bky - blockWSvg / 2} width={slSvg} height={blockWSvg} fill={BLOCK_FILL} stroke={BLOCK_STROKE} strokeWidth={0.5 / effZoom} transform={`rotate(${la} ${bkx} ${bky})`} />
                    })
                  })
                })}

                {/* 3. Bases + 4. Base IDs */}
                {sBases && (beBasesData ?? []).map((areaData, ai) => {
                  const profThick = (4 / pixelToCmRatio) * sc
                  return (areaData.bases ?? []).map((sb, sbi) => {
                    const ctx = resolveAreaContext(areaData, areaFrames, areaTrapsMap, beTrapezoidsData, customBasesMap, sb._panelRowIdx)
                    if (!ctx) return null
                    const { af } = ctx
                    const { btx, bty, bbx, bby, la } = baseScreenCoords(sb, sbi, { af, pixelToCmRatio, toSvg })
                    const mx = (btx + bbx) / 2, my = (bty + bby) / 2
                    return (
                      <g key={`base-${ai}-${sbi}`}>
                        <line x1={btx} y1={bty} x2={bbx} y2={bby} stroke={L_PROFILE_STROKE} strokeWidth={profThick} strokeLinecap="square" />
                        {sBaseIDs && <g transform={`rotate(${la} ${mx} ${my})`}><AreaLabel x={mx} y={my} label={sb.trapezoidId} fontSize={Math.max(6, Math.min(Math.max(14, 20 / effZoom), smallestPanelW / (2 * 0.6)))} showChevron={false} /></g>}
                      </g>
                    )
                  })
                })}

                {/* 5. External diagonals */}
                {sDiags && sBases && (beBasesData ?? []).map((areaData, ai) => {
                  const PROFILE_THICK = (4 / pixelToCmRatio) * sc
                  const diags = areaData.diagonals ?? []
                  const allBases = areaData.bases ?? []

                  // Group bases by panelRowIdx for per-row base index lookup
                  const basesByRow = {}
                  for (const b of allBases) {
                    const ri = b._panelRowIdx ?? 0
                    if (!basesByRow[ri]) basesByRow[ri] = []
                    basesByRow[ri].push(b)
                  }

                  return diags.map((d, di) => {
                    // Resolve frame for this diagonal's row
                    const diagPri = d.panelRowIdx ?? 0
                    const ctx = resolveAreaContext(areaData, areaFrames, areaTrapsMap, beTrapezoidsData, customBasesMap, diagPri)
                    if (!ctx) return null
                    const { af } = ctx
                    const { frame: tFrame, lines: tLines, isRtl: tIsRtl, isBtt: tIsBtt } = af
                    const { angleRad: tAngle, localBounds: tLB } = tFrame

                    // Base indices are relative to THIS row's bases (from per-row diagonal computation)
                    const rowBases = basesByRow[diagPri] ?? allBases
                    const baseA = rowBases[d.startBaseIdx]
                    const baseB = rowBases[d.endBaseIdx]
                    if (!baseA || !baseB) return null

                    // X: base offsetFromStartCm
                    const xA = baseA.offsetFromStartCm
                    const xB = baseB.offsetFromStartCm
                    const lxA = tIsRtl ? tLB.maxX - xA / pixelToCmRatio : tLB.minX + xA / pixelToCmRatio
                    const lxB = tIsRtl ? tLB.maxX - xB / pixelToCmRatio : tLB.minX + xB / pixelToCmRatio

                    // Y: start point at exact depth on base A.
                    // Endpoint shifts inward by one block length (to the block's inner edge
                    // on base B), separating diagonals from dimension labels visually.
                    const lineA = tLines?.find(l => l.lineIdx === baseA.panelLineIdx) ?? tLines?.[0]
                    const depthA = (baseA.startCm + (d.startBaseOffsetCm ?? 0)) / pixelToCmRatio
                    const lyA = tIsBtt ? (lineA?.maxY ?? tLB.maxY) - depthA : (lineA?.minY ?? tLB.minY) + depthA
                    const blockLen = (beTrapezoidsData?.[baseB.trapezoidId]?.geometry?.blockLengthCm ?? 50) / pixelToCmRatio
                    const areaMiddleY = ((lineA?.minY ?? tLB.minY) + (lineA?.maxY ?? tLB.maxY)) / 2
                    const lyB = lyA + (lyA < areaMiddleY ? blockLen : -blockLen)

                    const pa = localToScreen({ x: lxA, y: lyA }, tFrame.center, tAngle)
                    const pb = localToScreen({ x: lxB, y: lyB }, tFrame.center, tAngle)
                    const [x1, y1] = toSvg(pa.x, pa.y)
                    const [x2, y2] = toSvg(pb.x, pb.y)
                    if (isNaN(x1) || isNaN(y1)) return null

                    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
                    const ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI
                    const labelAngle = ang > 90 || ang < -90 ? ang + 180 : ang
                    const diagLabel = (d.diagLengthMm / 1000).toFixed(2)
                    const fs = Math.max(4, dimMaxFontSize != null ? Math.min(11 / effZoom, dimMaxFontSize) : 11 / effZoom)
                    const bgW = diagLabel.length * fs * 0.55 + 6 / effZoom, bgH = fs + 4 / effZoom
                    return (
                      <g key={`diag-${ai}-${di}`}>
                          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={DIAGONAL_STROKE} strokeWidth={PROFILE_THICK} />
                          <g transform={`rotate(${labelAngle} ${mx} ${my})`}>
                            <rect x={mx - bgW/2} y={my - bgH/2} width={bgW} height={bgH} fill="white" fillOpacity={0.45} stroke={BORDER_MID} strokeWidth={0.5/effZoom} rx={1/effZoom} />
                            <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle" fontSize={fs} fontWeight="700" fill={BLACK}>{diagLabel}</text>
                          </g>
                      </g>
                    )
                  })
                })}

                {/* 6. Dimensions — per panel row */}
                {sDims && (beBasesData ?? []).map((areaData, ai) => {
                  // Group bases by panelRowIdx
                  const basesByRow = {}
                  for (const b of (areaData.bases ?? [])) {
                    const ri = b._panelRowIdx ?? 0
                    if (!basesByRow[ri]) basesByRow[ri] = []
                    basesByRow[ri].push(b)
                  }

                  const selectedArea = effTrapId ? trapAreaMap[effTrapId] : null

                  return (Object.entries(basesByRow) as [string, any[]][]).map(([riStr, rowBases]) => {
                    const ri = Number(riStr)
                    const ctx = resolveAreaContext(areaData, areaFrames, areaTrapsMap, beTrapezoidsData, customBasesMap, ri)
                    if (!ctx) return null
                    const { af } = ctx
                    const { frame: refFrame, isRtl: afIsRtl } = af
                    const { angleRad: refAngle, localBounds: refLB, center: refCenter } = refFrame

                    const allBases = rowBases.map(sb => ({
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

                    const EXT_GAP = 2 / effZoom
                    const edgeSvg = (lx) => { const s = localToScreen({ x: lx, y: extremeLocalY }, refCenter, refAngle); return toSvg(s.x, s.y) }
                    // Place annotation line exactly on the row edge (no outward offset)
                    const annSvg  = edgeSvg

                    const areaKey = String(areaData.areaId ?? areaData.areaLabel ?? ai)
                    const isSelectedArea = areaKey === String(selectedArea)
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
                      <g key={`area-ann-${ai}-r${ri}`} style={hlStyle}>
                        <DimensionAnnotation measurePts={measurePts} annPts={annPts} labels={labels} colors={segColors} zoom={effZoom} maxFontSize={dimMaxFontSize} />
                      </g>
                    )
                  })
                })}

                {/* 7. Edit bar */}
                {sEditBar && Object.entries(areaTrapsMap).map(([areaKey, areaTrapIds]) => {
                  const af = areaFrames[areaKey]
                  if (!af?.frame?.center) return null
                  const selectedArea = effTrapId ? trapAreaMap[effTrapId] : null
                  if (effTrapId !== null && String(areaKey) !== String(selectedArea)) return null
                  const areaData = (beBasesData ?? []).find(ad => String(ad.areaId) === String(areaKey) || ad.areaLabel === areaKey || ad.label === areaKey)
                  if (!areaData?.bases?.length) return null
                  const fullTrapId = areaTrapIds.find(tid => beTrapezoidsData?.[tid]?.isFullTrap) ?? areaTrapIds[0]
                  const trapS = trapSettingsMap[fullTrapId] ?? {}

                  // Determine which panel rows to render
                  const allRowIdxs = ([...new Set((areaData.bases ?? []).map(sb => sb._panelRowIdx ?? 0))] as number[]).sort((a, b) => a - b)
                  const rowIdxsToShow = selectedPanelRowIdx != null ? [selectedPanelRowIdx] : allRowIdxs

                  return rowIdxsToShow.map(pri => {
                    const rowCtx = resolveAreaContext(areaData, areaFrames, areaTrapsMap, beTrapezoidsData, customBasesMap, pri)
                    if (!rowCtx) return null
                    const { af: rowAf } = rowCtx
                    const { frame: rowFrame, isRtl: afIsRtl, isBtt: afIsBtt } = rowAf
                    const { center, angleRad, localBounds } = rowFrame
                    const frameLengthPx = localBounds.maxX - localBounds.minX

                    const rowBases = (areaData.bases ?? []).filter(sb => (sb._panelRowIdx ?? 0) === pri)
                    if (rowBases.length === 0) return null

                    const liveOffsets = customBasesMap[`${fullTrapId}:${pri}`]
                    const offsetSource = liveOffsets ?? rowBases.map(sb => Math.round(sb.offsetFromStartCm * 10))
                    const syntheticBases = offsetSource.map((offMm) => {
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
                        key={`overlay-${areaKey}-r${pri}`}
                        bp={syntheticBp}
                        zoom={effZoom} pixelToCmRatio={pixelToCmRatio} sc={sc}
                        svgRef={svgRef} toSvg={toSvg}
                        spacingMm={trapS.spacingMm}
                        edgeOffsetMm={trapS.edgeOffsetMm}
                        isSelected={true}
                        overrideBarLocalY={barLocalY}
                        onBasesChange={onBasesChange ? (offsets) => onBasesChange(fullTrapId, offsets, pri) : null}
                      />
                    )
                  })
                })}

                {/* Base parameter highlights (top z-order) */}
                {(highlightGroup === 'base-spacing' || highlightGroup === 'base-edges' || highlightGroup === 'base-overhang') && (beBasesData ?? []).map((areaData, ai) => {
                  const firstBasePri = (areaData.bases ?? [])[0]?._panelRowIdx
                  const ctx = resolveAreaContext(areaData, areaFrames, areaTrapsMap, beTrapezoidsData, customBasesMap, firstBasePri)
                  if (!ctx) return null
                  const { af } = ctx
                  const { frame: tFrame, isRtl: tIsRtl } = af
                  const { angleRad: tAngle, localBounds: tLB } = tFrame
                  const allBases = areaData.bases ?? []
                  const sw = 6 / effZoom

                  const baseScreenPos = allBases.map((sb, sbi) =>
                    baseScreenCoords(sb, sbi, { af, pixelToCmRatio, toSvg })
                  )

                  return (
                    <g key={`hl-${ai}`} style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }}>
                      {highlightGroup === 'base-spacing' && baseScreenPos.length >= 2 && (() => {
                        const b1 = baseScreenPos[0], b2 = baseScreenPos[1]
                        const mx1 = (b1.btx + b1.bbx) / 2, my1 = (b1.bty + b1.bby) / 2
                        const mx2 = (b2.btx + b2.bbx) / 2, my2 = (b2.bty + b2.bby) / 2
                        return <line x1={mx1} y1={my1} x2={mx2} y2={my2} stroke={AMBER} strokeWidth={sw} strokeDasharray={`${6/effZoom} ${3/effZoom}`} />
                      })()}
                      {highlightGroup === 'base-edges' && baseScreenPos.length >= 1 && (() => {
                        const b1 = baseScreenPos[0]
                        const edgeLx = tIsRtl ? tLB.maxX : tLB.minX
                        const edgeP = localToScreen({ x: edgeLx, y: (tLB.minY + tLB.maxY) / 2 }, tFrame.center, tAngle)
                        const [ex, ey] = toSvg(edgeP.x, edgeP.y)
                        const mx1 = (b1.btx + b1.bbx) / 2, my1 = (b1.bty + b1.bby) / 2
                        return <line x1={ex} y1={ey} x2={mx1} y2={my1} stroke={AMBER} strokeWidth={sw} strokeDasharray={`${6/effZoom} ${3/effZoom}`} />
                      })()}
                      {highlightGroup === 'base-overhang' && baseScreenPos.map((b, bi) => {
                        const dx = b.bbx - b.btx, dy = b.bby - b.bty
                        const len = Math.sqrt(dx * dx + dy * dy)
                        const ux = len > 0 ? dx / len : 0, uy = len > 0 ? dy / len : 0
                        const ovPx = 8 / effZoom
                        return <g key={`boh-${bi}`}>
                          <line x1={b.btx} y1={b.bty} x2={b.btx + ux * ovPx} y2={b.bty + uy * ovPx}
                            stroke={AMBER} strokeWidth={sw} strokeLinecap="square" />
                          <line x1={b.bbx - ux * ovPx} y1={b.bby - uy * ovPx} x2={b.bbx} y2={b.bby}
                            stroke={AMBER} strokeWidth={sw} strokeLinecap="square" />
                        </g>
                      })}
                    </g>
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
            { label: t('step3.layer.roofImage'),  checked: showRoofImage,  setter: setShowRoofImage },
            { label: t('step3.layer.bases'),      checked: showBases,      setter: setShowBases },
            { label: t('step3.layer.baseIDs'),    checked: showBaseIDs,    setter: setShowBaseIDs },
            { label: t('step3.layer.blocks'),     checked: showBlocks,     setter: setShowBlocks },
            { label: t('step3.layer.railLines'),  checked: showRailLines,  setter: setShowRailLines },
            { label: t('step3.layer.diagonals'),  checked: showDiagonals,  setter: setShowDiagonals },
            { label: t('step3.layer.dimensions'), checked: showDimensions, setter: setShowDimensions },
            // Edit Bar — hidden until bases edit-bar alignment + per-trap fan-out is finished. See backlog.
            // { label: t('step3.layer.editBar'),    checked: showEditBar,    setter: setShowEditBar },
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
            {expandedTrapIds.map((trapId, i) => <BasesTable key={`${trapId}-${i}`} bp={basePlans[i]} rowIdx={i} />)}
          </div>
        )}
      </div>

    </div>
  )
}
