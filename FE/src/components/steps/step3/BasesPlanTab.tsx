import { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react'
import { useLang } from '../../../i18n/LangContext'
import { TEXT_SECONDARY, TEXT_VERY_LIGHT, TEXT_PLACEHOLDER, BORDER_FAINT, BORDER_MID, BG_LIGHT, BG_FAINT, BLUE, BLUE_BG, BLUE_BORDER, BLUE_SELECTED, AMBER_DARK, AMBER, BLOCK_FILL, BLOCK_STROKE, AMBER_BG, AMBER_BORDER, L_PROFILE_STROKE, DIAGONAL_STROKE, DIAGONAL_LABEL, OMEGA_PURPLE, WHITE, PRIMARY, BEAM_CONNECTOR_FILL, BEAM_CONNECTOR_STROKE } from '../../../styles/colors'
import { consolidateAreaBases, buildTrapAreaMaps, computeExpandedBasePlans, buildAreaFrames, buildBasePlansMap } from '../../../utils/basePlanService'
import { computeRowRailLayout, buildLineRailsFromBE, buildLineSegmentsFromBE } from '../../../utils/railLayoutService'
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
import BaseEndpointGrips from './BaseEndpointGrips'
import BaseEditPanel from './BaseEditPanel'
import RailsOverlay from './RailsOverlay'
import RulerTool from '../../shared/RulerTool'
import DimensionAnnotation from './DimensionAnnotation'
import { resolveAreaContext, baseScreenCoords } from './basePlanHelpers'


export default function BasesPlanTab({ panels = [], refinedArea, areas = [], uploadedImageData, imageSrc, effectiveSelectedTrapId = null, selectedRowIdx = null, rowKeys = [] as number[], selectedPanelRowIdx = null, trapSettingsMap = {}, trapLineRailsMap = {}, trapRCMap = {}, beTrapezoidsData = null, beBasesData = null, beRailsData = null, highlightGroup = null, customBasesMap = {}, onBasesChange = null, onTrapExtend = null as null | ((op: any) => void), pendingTrapOps = [] as any[], onRequestExitEdit = null as null | (() => Promise<boolean>), onResetBases = null, printMode = false, printShowRoofImage = true, printSc = null, printBbox = null, roofType = 'concrete', purlinDistCm = 0, installationOrientation = null, globalRailConfig = null as { overhangCm?: number; stockLengths?: number[]; crossRailEdgeDistMm?: number } | null, areaByGroupKey = {} as Record<number, any>, onPanelClick = null as null | ((panel: any) => void) }) {
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
  const [showAnchors,    setShowAnchors]    = useState(true)
  const [showBlocks,     setShowBlocks]     = useState(true)
  const [showBaseIDs,    setShowBaseIDs]    = useState(true)
  const [showRailLines,  setShowRailLines]  = useState(true)
  const [showDimensions, setShowDimensions] = useState(true)
  const [showDiagonals,  setShowDiagonals]  = useState(true)
  // Edit mode replaces the "Edit Bar" layer toggle. Entering edit mode
  // simplifies the canvas to bases + rails + dimensions (hiding derived
  // layers like blocks, diagonals, anchors, base IDs that depend on BE-
  // recomputed state and would be misleading while edits are pending).
  // Exit via Save (applies pending edits) or Discard (drops them).
  const [editMode, setEditMode] = useState(false)

  // Op popover: shown after the user commits a base op on the edit bar.
  // Lets them refine (move only) and fan the change out across the
  // area. `kind` discriminates which branch the popover renders.
  const [moveEditor, setMoveEditor] = useState<null | {
    kind: 'move' | 'add' | 'delete'
    trapId: string
    rowIdx: number
    baseIdx: number       // for move/delete; -1 for add
    oldOffsetMm: number   // for move; equals newOffsetMm for add/delete
    newOffsetMm: number
    areaKey: string
  }>(null)
  const moveEditorTimerRef = useRef<number | null>(null)
  const dismissMoveEditorSoon = () => {
    if (moveEditorTimerRef.current != null) window.clearTimeout(moveEditorTimerRef.current)
    // Auto-dismiss after a few seconds of inactivity. Any mouseDown / keyDown
    // inside the popover refreshes the timer (see the foreignObject handlers
    // below) so an active user keeps it open.
    moveEditorTimerRef.current = window.setTimeout(() => {
      setMoveEditor(null)
      moveEditorTimerRef.current = null
    }, 3000) as unknown as number
  }
  useEffect(() => () => {
    if (moveEditorTimerRef.current != null) window.clearTimeout(moveEditorTimerRef.current)
  }, [])
  useEffect(() => {
    if (moveEditor) dismissMoveEditorSoon()
  }, [moveEditor?.trapId, moveEditor?.rowIdx, moveEditor?.baseIdx])  // eslint-disable-line react-hooks/exhaustive-deps
  // Base selected for the docked EXTEND panel (Layers widget). Set only by the
  // endpoint grips (extend); move/add/delete keep their own canvas popup.
  // Identified by (area, row, sorted-offset index) against the live base list.
  const [selectedExtendBase, setSelectedExtendBase] = useState<null | {
    areaKey: string; rowIdx: number; baseIdx: number
  }>(null)
  const [rulerActive,    setRulerActive]    = useState(false)
  const [tableOpen,      setTableOpen]      = useState(false)
  const initialMountRef = useRef(true)

  const { zoom, setZoom, panOffset, setPanOffset, panActive, containerRef, contentRef, startPan, handleMouseMove, stopPan, resetView, centerView, zoomAtCenter, MM_W, MM_H, panToMinimapPoint, getMinimapViewportRect } = useCanvasPanZoom()

  const pixelToCmRatio = refinedArea?.pixelToCmRatio ?? 1
  const svgRef = useRef(null)

  const { map: trapGroups, keys: trapIds } = useMemo(() => buildTrapezoidGroups(panels), [panels])

  const nonEmptyPanels = useMemo(() => panels.filter(p => !p.isEmpty), [panels])

  // Split each trapezoid group by panelRowIdx for multi-row areas
  const { expandedBasePlans: basePlans, expandedRailLayouts: railLayouts, expandedTrapIds } = useMemo(
    () => computeExpandedBasePlans({ trapIds, trapGroups, pixelToCmRatio, trapSettingsMap, customBasesMap, beRailsData, areas }),
    [trapIds, trapGroups, pixelToCmRatio, trapSettingsMap, trapLineRailsMap, customBasesMap, beRailsData, areas],
  )

  // Frameless-area rails (tiles, flat_installation): the trap-keyed pipeline above
  // produces nothing for frameless panels (no construction frame → trap settings
  // are absent). Detect frameless panels by their *area's* resolved roof type —
  // robust against legacy saves that defaulted trapezoidId to 'A' instead of
  // leaving it null. Group by (areaGroupKey, panelRowIdx) and feed
  // `computeRowRailLayout` with global rail settings + the area's BE-computed lineRails.
  const tileRailLayouts = useMemo(() => {
    if (roofType !== 'tiles' && roofType !== 'flat_installation' && roofType !== 'mixed') return [] as Array<{ rl: any; areaLabel: string }>
    const overhangCm = globalRailConfig?.overhangCm
    const stockLengths = globalRailConfig?.stockLengths
    if (!overhangCm || !stockLengths) return []

    const buckets: Record<string, { areaGroupKey: number; ri: number; panels: any[] }> = {}
    for (const p of panels) {
      const agk = p.areaGroupKey
      if (agk == null) continue
      const area = areaByGroupKey[agk]
      const areaType = area ? resolveAreaRoofSpec(roofType, area).type : null
      if (!area || (areaType !== 'tiles' && areaType !== 'flat_installation')) continue
      const ri = p.panelRowIdx ?? 0
      const key = `${agk}:${ri}`
      if (!buckets[key]) buckets[key] = { areaGroupKey: agk, ri, panels: [] }
      buckets[key].panels.push(p)
    }

    const out: Array<{ rl: any; areaLabel: string }> = []
    for (const { areaGroupKey, ri, panels: rowPanels } of Object.values(buckets)) {
      const area = areaByGroupKey[areaGroupKey]
      if (!area?.label) continue
      const lineRails = buildLineRailsFromBE(beRailsData, area.label, ri) ?? null
      const lineSegments = buildLineSegmentsFromBE(beRailsData, area.label, ri) ?? undefined
      const rl = computeRowRailLayout(rowPanels, pixelToCmRatio, { lineRails, overhangCm, stockLengths, lineSegments })
      if (rl) out.push({ rl, areaLabel: area.label })
    }
    return out
  }, [roofType, panels, beRailsData, pixelToCmRatio, globalRailConfig, areaByGroupKey])

  // Wait for BE data to be ready before rendering
  const dataReady = (beBasesData && beBasesData.length > 0) || printMode

  const { trapAreaMap, areaTrapsMap } = useMemo(
    () => buildTrapAreaMaps(trapIds, areas),
    [trapIds, areas],
  )

  // For cross-row rails rendering: each entry in railLayouts is keyed by an
  // expandedTrapId. Map each trapId → its area's BE rails data (which carries
  // crossRowRails). Multiple trapIds in the same area resolve to the SAME
  // beArea — renderCrossRowRails dedupes by areaId.
  const trapKeyToBeArea = useMemo(() => {
    const m: Record<string, any> = {}
    // `trapAreaMap[trapId]` returns an areaId (number) OR area label (string) —
    // never an area object. Match against both fields on beRailsData entries.
    for (const trapId of expandedTrapIds) {
      const aIdOrLabel = trapAreaMap[trapId]
      if (aIdOrLabel == null) continue
      const beArea = (beRailsData ?? []).find(a => a.areaId === aIdOrLabel || a.areaLabel === aIdOrLabel)
      if (beArea) m[trapId] = beArea
    }
    return m
  }, [expandedTrapIds, trapAreaMap, beRailsData])

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
    if (printMode && printBbox) return printBbox
    if (nonEmptyPanels.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 }
    const panelBbox = getPanelsBoundingBox(nonEmptyPanels)
    return expandBboxForImage(panelBbox, uploadedImageData)
  }, [printMode, printBbox, nonEmptyPanels, uploadedImageData])

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
  // In edit mode we force the canvas to the minimal editable set — bases,
  // rails, dimensions on; derived/decorative layers off — so the user
  // focuses on what they can manipulate. Anchors (frameless omega/hook marks)
  // stay ON so the planner sees each anchor's rail crossings while dragging
  // the bar; they follow the live edit via liveBeBasesData (hook positions
  // re-derive on the BE on save). Framed areas have no anchors → no effect.
  const sEditMode = !printMode && editMode
  const sBases    = sEditMode ? true  : (printMode || showBases)
  const sAnchors  = sEditMode ? true  : (printMode || showAnchors)
  const sBlocks   = sEditMode ? false : (printMode || showBlocks)
  const sBaseIDs  = sEditMode ? false : (printMode || showBaseIDs)

  // Anchor points are populated only on frameless-roof bases (tiles, flat_installation)
  // — one per rail × base intersection. Detect any non-empty hookOffsets to surface the toggle.
  const hasAnchors = (beBasesData ?? []).some(ad => (ad.bases ?? []).some(b => (b.hookOffsets?.length ?? 0) > 0))
  const sRails    = sEditMode ? true  : (!printMode && showRailLines)
  const sDiags    = sEditMode ? false : (printMode || showDiagonals)
  const sDims     = sEditMode ? true  : (printMode || showDimensions)

  // ── In-flight base override projection ────────────────────────────────────
  // While the user edits in the edit bar, `customBasesMap[trapId:rowIdx]` holds
  // the live mm offsets — possibly with bases ADDED, DELETED, or MOVED. To
  // render the whole base (line, label, blocks, diagonals, dims) in sync
  // with the bar BEFORE Apply, we diff the live array against the BE peers
  // per (trap, row) group and emit a derived `liveBeBasesData`:
  //   • move  → existing BE peer reused with new offsetFromStartCm
  //   • add   → synthetic base cloned from a neighbour (synthetic baseId
  //             so downstream lookups don't collide with real BE ids)
  //   • delete→ BE peer dropped from the array
  //
  // The 2-pointer diff below assumes sorted offsets (BasePlanOverlay
  // enforces this on every mutation). INSERT_GAP_CM defines when a live
  // offset is treated as a NEW insertion rather than a move of the current
  // BE peer — small enough to detect inserts, large enough to absorb
  // typical drag distances.
  // Move-vs-insert tolerance only matters when live and BE differ in
  // length; for length-equal cases we use index-based matching, since
  // the edit bar's clampOffset prevents reordering.
  const INSERT_GAP_MM = 5000
  const stripVariation = (tid: any): string => {
    const s = String(tid ?? '')
    const dot = s.indexOf('.')
    return dot >= 0 ? s.slice(0, dot) : s
  }
  const diffRowBases = (bePeers: any[], liveMm: number[]): any[] => {
    // bePeers already sorted ascending by offsetFromStartCm.
    const live = [...liveMm].sort((a, b) => a - b)
    const beMm = bePeers.map(b => Math.round((b.offsetFromStartCm ?? 0) * 10))
    const template = bePeers[0]

    const syntheticAt = (templateBase: any, liveMmI: number, idx: number) => ({
      ...templateBase,
      baseId: `__live__${templateBase?.trapezoidId ?? 't'}_${idx}_${liveMmI}`,
      offsetFromStartCm: liveMmI / 10,
      __synthetic: true,
    })

    // Length match → pure move (or no-op). Pair index-wise, override
    // offset only when it actually changed (mm-precision compare).
    if (live.length === bePeers.length) {
      const result: any[] = []
      for (let i = 0; i < bePeers.length; i++) {
        const b = bePeers[i]
        if (live[i] === beMm[i]) {
          result.push(b)
        } else {
          result.push({ ...b, offsetFromStartCm: live[i] / 10 })
        }
      }
      return result
    }

    // Single ADD: live has exactly one extra entry. Try skipping each
    // live index and pick the one with minimum total drift against the
    // BE peers — the skipped index is the newly added base. Without
    // this min-drift alignment, a naive two-pointer misreads an insert
    // in the middle of the row as "move the next existing base forward,
    // move the one after that, …, and tag the trailing one as new" —
    // which corrupts every downstream base's startCm / lengthCm
    // because each surviving base carries the SHAPE of its previous
    // neighbour.
    if (live.length === bePeers.length + 1) {
      let bestSkip = 0
      let bestDrift = Infinity
      for (let skipIdx = 0; skipIdx < live.length; skipIdx++) {
        let drift = 0
        let bi = 0
        for (let li = 0; li < live.length; li++) {
          if (li === skipIdx) continue
          drift += Math.abs(live[li] - beMm[bi])
          bi++
        }
        if (drift < bestDrift) {
          bestDrift = drift
          bestSkip = skipIdx
        }
      }
      const result: any[] = []
      let bi = 0
      for (let li = 0; li < live.length; li++) {
        if (li === bestSkip) {
          // Insert position falls between the previous and current BE
          // peer; use whichever exists as a shape template.
          const tpl = bePeers[bi] ?? bePeers[bi - 1] ?? template
          result.push(syntheticAt(tpl, live[li], li))
          continue
        }
        const b = bePeers[bi]
        result.push(live[li] === beMm[bi] ? b : { ...b, offsetFromStartCm: live[li] / 10 })
        bi++
      }
      return result
    }

    // Single DELETE: live has exactly one fewer entry. Try skipping
    // each BE index; the skipped one is the deleted base.
    if (live.length === bePeers.length - 1) {
      let bestSkip = 0
      let bestDrift = Infinity
      for (let skipIdx = 0; skipIdx < bePeers.length; skipIdx++) {
        let drift = 0
        let li = 0
        for (let bi = 0; bi < bePeers.length; bi++) {
          if (bi === skipIdx) continue
          drift += Math.abs(live[li] - beMm[bi])
          li++
        }
        if (drift < bestDrift) {
          bestDrift = drift
          bestSkip = skipIdx
        }
      }
      const result: any[] = []
      let li = 0
      for (let bi = 0; bi < bePeers.length; bi++) {
        if (bi === bestSkip) continue
        const b = bePeers[bi]
        result.push(live[li] === beMm[bi] ? b : { ...b, offsetFromStartCm: live[li] / 10 })
        li++
      }
      return result
    }

    // Multi-edit fallback — length differs by > 1. Best-effort two-
    // pointer with the gap heuristic.
    const result: any[] = []
    let bi = 0
    let li = 0
    let synthCount = 0
    while (li < live.length || bi < bePeers.length) {
      if (li >= live.length) { bi++; continue }
      const liveMmI = live[li]
      if (bi >= bePeers.length) {
        const tpl = bePeers[bi - 1] || template
        if (tpl) result.push(syntheticAt(tpl, liveMmI, synthCount++))
        li++
        continue
      }
      const beMmI = beMm[bi]
      if (live.length > bePeers.length && liveMmI + INSERT_GAP_MM < beMmI) {
        result.push(syntheticAt(bePeers[bi], liveMmI, synthCount++))
        li++
      } else if (live.length < bePeers.length && beMmI + INSERT_GAP_MM < liveMmI) {
        bi++
      } else {
        const b = bePeers[bi]
        result.push(liveMmI === beMmI ? b : { ...b, offsetFromStartCm: liveMmI / 10 })
        bi++
        li++
      }
    }
    return result
  }
  const liveBeBasesData = (beBasesData ?? []).map((ad: any) => {
    const bases = ad?.bases ?? []
    // Group bases by panelRowIdx — customBasesMap is per row (across
    // every sub-trap), so the diff runs once per row regardless of how
    // many sub-traps contribute bases there.
    const areaKey = ad?.areaId ?? ad?.areaLabel ?? ad?.label
    const peersByRow: Record<number, any[]> = {}
    const rowOrder: number[] = []
    for (const b of bases) {
      const ri = b._panelRowIdx ?? 0
      if (!peersByRow[ri]) { peersByRow[ri] = []; rowOrder.push(ri) }
      peersByRow[ri].push(b)
    }
    for (const ri of rowOrder) {
      peersByRow[ri].sort((a: any, b: any) => (a.offsetFromStartCm ?? 0) - (b.offsetFromStartCm ?? 0))
    }
    let nextBases: any[] = []
    for (const ri of rowOrder) {
      const peers = peersByRow[ri]
      const live = areaKey != null ? customBasesMap?.[`${areaKey}:${ri}`] : undefined
      if (!Array.isArray(live)) {
        nextBases.push(...peers)
        continue
      }
      nextBases.push(...diffRowBases(peers, live))
    }

    // Layer pending trap-extend ops on top so the canvas previews each
    // extension before save. For every base we find the LATEST pending
    // op whose `targets` list includes it (matched by areaId + rowIdx
    // + baseId). If the base already carried a variation suffix
    // ("A1.N") the corresponding extension is stripped from
    // startCm/lengthCm first so a new extension replaces (not stacks
    // on) the previous one.
    if (pendingTrapOps && pendingTrapOps.length) {
      nextBases = nextBases.map((b: any) => {
        if ((b.hookOffsets?.length ?? 0) > 0) return b   // frameless / virtual
        const bRow = Number(b._panelRowIdx ?? 0)
        let chosen: any = null
        for (const op of pendingTrapOps) {
          const hit = (op.targets ?? []).some((t: any) =>
            String(t.areaId) === String(areaKey)
            && Number(t.rowIdx) === bRow
            && t.baseId === b.baseId,
          )
          if (hit) chosen = op
        }
        if (!chosen) return b
        const parentTid = stripVariation(b.trapezoidId)
        const trap = beTrapezoidsData?.[parentTid]
        const angleDeg = Number(trap?.geometry?.angle ?? 0)
        const cosA = Math.cos((angleDeg * Math.PI) / 180) || 1
        // Strip the base's CURRENT variation extension from its shape.
        const curIdxMatch = String(b.trapezoidId ?? '').match(/\.(\d+)$/)
        const curIdx = curIdxMatch ? Number(curIdxMatch[1]) : 0
        const curExt = trap?.geometry?.extensions?.[curIdx] ?? { frontExtMm: 0, backExtMm: 0 }
        const curFrontCm = (Number(curExt?.frontExtMm) || 0) / 10 / cosA
        const curBackCm = (Number(curExt?.backExtMm) || 0) / 10 / cosA
        // Apply the pending extension.
        const newFrontCm = (Number(chosen?.frontExtMm) || 0) / 10 / cosA
        const newBackCm = (Number(chosen?.backExtMm) || 0) / 10 / cosA
        const round2 = (n: number) => Math.round(n * 100) / 100
        return {
          ...b,
          startCm: round2((b.startCm ?? 0) + curBackCm - newBackCm),
          lengthCm: round2(
            (b.lengthCm ?? 0)
            - curFrontCm - curBackCm
            + newFrontCm + newBackCm,
          ),
        }
      })
    }

    return { ...ad, bases: nextBases }
  })

  // Drop the extend selection when leaving edit mode or after a recompute.
  useEffect(() => { if (!sEditMode) setSelectedExtendBase(null) }, [sEditMode])

  // ── Selected-base EXTEND panel (docked in the Layers widget) ────────────
  // Only the endpoint grips set the selection (framed bases). Resolves the
  // base against the LIVE list, reads its effective extension (pending op wins
  // over applied geometry), and wires front/back + row/area fan-out — the same
  // extend-op flow the grip drag uses (one op per base via a shared session).
  const baseEditPanel = (() => {
    if (!sEditMode || !selectedExtendBase) return null
    const { areaKey, rowIdx, baseIdx } = selectedExtendBase
    const ad = liveBeBasesData.find((a: any) =>
      String(a.areaId) === areaKey || a.areaLabel === areaKey || a.label === areaKey)
    if (!ad) return null
    const rowBases = (ad.bases ?? [])
      .filter((b: any) => (b._panelRowIdx ?? 0) === rowIdx)
      .slice()
      .sort((a: any, b: any) => (a.offsetFromStartCm ?? 0) - (b.offsetFromStartCm ?? 0))
    const sb = rowBases[baseIdx]
    if (!sb || (sb.hookOffsets?.length ?? 0) > 0) return null   // none / frameless → no extend
    const baseId = sb.baseId
    const parentTrap = stripVariation(sb.trapezoidId)

    const curIdxMatch = String(sb.trapezoidId ?? '').match(/\.(\d+)$/)
    const applied = beTrapezoidsData?.[parentTrap]?.geometry?.extensions?.[curIdxMatch ? Number(curIdxMatch[1]) : 0]
      ?? beTrapezoidsData?.[parentTrap]?.geometry?.extensions?.[0]
      ?? { frontExtMm: 0, backExtMm: 0 }
    let frontExtMm = Math.round(Number(applied.frontExtMm) || 0)
    let backExtMm = Math.round(Number(applied.backExtMm) || 0)
    for (const op of (pendingTrapOps ?? [])) {
      const hit = (op?.targets ?? []).some((tt: any) =>
        String(tt.areaId) === String(ad.areaId) && Number(tt.rowIdx) === rowIdx && tt.baseId === baseId)
      if (hit) { frontExtMm = Math.round(Number(op.frontExtMm) || 0); backExtMm = Math.round(Number(op.backExtMm) || 0) }
    }

    // Fan-out targets: other framed bases in this row / area.
    const framed = (bs: any[]) => bs.filter((b: any) => (b.hookOffsets?.length ?? 0) === 0 && b.baseId && b.baseId !== baseId)
    const rowTargets = framed(rowBases).map((b: any) => ({ areaId: ad.areaId, rowIdx, baseId: b.baseId }))
    const areaTargets = framed(ad.bases ?? []).map((b: any) => ({ areaId: ad.areaId, rowIdx: b._panelRowIdx ?? 0, baseId: b.baseId }))

    const extSession = `ext:${ad.areaId}:${rowIdx}:${baseId}`
    const fireExtend = (f: number, bk: number, targets: any[]) => {
      if (!targets.length) return
      onTrapExtend?.({ op: 'extend', targets, frontExtMm: Math.max(0, Math.round(f)), backExtMm: Math.max(0, Math.round(bk)), _sessionId: extSession })
    }
    const self = { areaId: ad.areaId, rowIdx, baseId }
    const onExtendFront = (mm: number) => fireExtend(mm, backExtMm, [self])
    const onExtendBack = (mm: number) => fireExtend(frontExtMm, mm, [self])
    const onApplyRow = () => fireExtend(frontExtMm, backExtMm, [self, ...rowTargets])
    const onApplyArea = () => fireExtend(frontExtMm, backExtMm, [self, ...areaTargets])

    const info = {
      baseLabel: String(baseId ?? ''), frontExtMm, backExtMm,
      rowTargetCount: rowTargets.length, areaTargetCount: areaTargets.length,
    }
    return (
      <BaseEditPanel
        key={`${areaKey}:${rowIdx}:${baseId}`}
        info={info}
        onExtendFront={onExtendFront} onExtendBack={onExtendBack}
        onApplyRow={onApplyRow} onApplyArea={onApplyArea}
        onClose={() => setSelectedExtendBase(null)}
      />
    )
  })()

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
        onPanelClick={printMode ? null : onPanelClick}
      />

      {/* Purlin lines for parallel installation — parallel to bases, starting from first base.
          Per-area in mixed mode: each area uses its own roofSpec.type /
          distanceBetweenPurlinsCm / installationOrientation. Non-mixed
          projects fall through to the project-level scalar props. */}
      {liveBeBasesData.map((areaData, ai) => {
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

      {/* Z-order (bottom → top): 1. Blocks, 2. Rails (per-row, frameless, cross-row),
          3. Bases, 4. Base IDs, 4.5 Anchors, 5. Diagonals, 6. Connectors, 7. Dimensions/labels,
          then the Edit bar overlay on top. */}

                {/* 1. Blocks (bottom layer) */}
                {sBlocks && liveBeBasesData.map((areaData, ai) => {
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
                    // Filter blocks whose base-axis end falls within the trapezoid's full
                    // base-beam length (includes any variation extensions). Compare in
                    // base coords against geom.baseBeamLength — block.positionCm and
                    // geom.blockLengthCm are both in base coords, so this is unit-safe
                    // and naturally accommodates extension tip blocks beyond the slope
                    // beam (topBeamLength) without filtering them out.
                    const baseUpperCm = geom.baseBeamLength ?? sb.lengthCm
                    const trapBlocks = allBlocks.filter(blk => blk.positionCm + geom.blockLengthCm <= baseUpperCm + 1)
                    const blockWidthCm = trapSettingsMap[sb.trapezoidId]?.blockWidthCm
                    if (blockWidthCm == null) return null
                    const blockWSvg = (blockWidthCm / pixelToCmRatio) * sc
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

                {/* 2a. Per-row rails — above blocks, below bases. Material summary,
                    dimensions and connectors are disabled in the bases tab. */}
                <RailsOverlay
                  railLayouts={railLayouts}
                  rowKeys={expandedTrapIds}
                  rowGroups={trapGroups}
                  groupKeyToBeArea={trapKeyToBeArea}
                  toSvg={toSvg}
                  sc={sc}
                  pixelToCmRatio={pixelToCmRatio}
                  zoom={effZoom}
                  layers={{ rails: sRails, dimensions: false, materialSummary: false, connectors: false, perRow: true, crossRow: false }}
                  crossRailEdgeDistMm={trapSettingsMap[trapIds[0]]?.crossRailEdgeDistMm ?? 50}
                  selectedRowIdx={effTrapId ? trapIds.indexOf(effTrapId) : null}
                  trapSettingsMap={trapSettingsMap}
                />

                {/* 2b. Frameless-area rails (tiles, flat_installation) — independent of the trap-keyed pipeline. */}
                {tileRailLayouts.length > 0 && (
                  <RailsOverlay
                    railLayouts={tileRailLayouts.map(t => t.rl)}
                    rowKeys={tileRailLayouts.map(t => t.areaLabel)}
                    rowGroups={{}}
                    toSvg={toSvg}
                    sc={sc}
                    pixelToCmRatio={pixelToCmRatio}
                    zoom={effZoom}
                    layers={{ rails: sRails, dimensions: false, materialSummary: false, connectors: false }}
                    crossRailEdgeDistMm={globalRailConfig?.crossRailEdgeDistMm ?? 50}
                    trapSettingsMap={{}}
                  />
                )}

                {/* 2c. Cross-row rails — grouped with the other rails, above blocks and below bases. */}
                <RailsOverlay
                  railLayouts={railLayouts}
                  rowKeys={expandedTrapIds}
                  rowGroups={trapGroups}
                  groupKeyToBeArea={trapKeyToBeArea}
                  toSvg={toSvg}
                  sc={sc}
                  pixelToCmRatio={pixelToCmRatio}
                  zoom={effZoom}
                  layers={{ rails: sRails, dimensions: false, materialSummary: false, connectors: false, perRow: false, crossRow: true }}
                  crossRailEdgeDistMm={trapSettingsMap[trapIds[0]]?.crossRailEdgeDistMm ?? 50}
                  selectedRowIdx={effTrapId ? trapIds.indexOf(effTrapId) : null}
                  trapSettingsMap={trapSettingsMap}
                />

                {/* 3. Bases + 4. Base IDs */}
                {sBases && liveBeBasesData.map((areaData, ai) => {
                  const profThick = (4 / pixelToCmRatio) * sc
                  return (areaData.bases ?? []).map((sb, sbi) => {
                    const ctx = resolveAreaContext(areaData, areaFrames, areaTrapsMap, beTrapezoidsData, customBasesMap, sb._panelRowIdx)
                    if (!ctx) return null
                    const { af } = ctx
                    const { btx, bty, bbx, bby, la } = baseScreenCoords(sb, sbi, { af, pixelToCmRatio, toSvg })
                    const mx = (btx + bbx) / 2, my = (bty + bby) / 2
                    // Frameless-roof bases are virtual anchor lines (no physical beam) —
                    // their anchor points + rails carry the meaning, so the base line
                    // would only add visual noise. Detect via non-empty
                    // hookOffsets and skip the line/ID render.
                    const isFramelessBase = (sb.hookOffsets?.length ?? 0) > 0
                    if (isFramelessBase) return null
                    // Extension portions of the base beam (front/back) sit beyond the
                    // slope beam (topBeamLength). Bases-tab is a top view of the slope
                    // beam, so we dash the extension parts to make the boundary explicit.
                    const trapGeom = beTrapezoidsData?.[sb.trapezoidId]?.geometry
                    const topBeamCm = trapGeom?.topBeamLength
                    const ext = trapGeom?.extensions?.[0] ?? { frontExtMm: 0, backExtMm: 0 }
                    const frontExtMm = ext.frontExtMm || 0
                    const backExtMm  = ext.backExtMm || 0
                    const visibleExtCm = (topBeamCm != null) ? Math.max(0, sb.lengthCm - topBeamCm) : 0
                    const sumExtMm = frontExtMm + backExtMm
                    const hasExt = visibleExtCm > 0 && sumExtMm > 0
                    let segments: { x1:number, y1:number, x2:number, y2:number, dashed:boolean }[]
                    if (!hasExt) {
                      segments = [{ x1: btx, y1: bty, x2: bbx, y2: bby, dashed: false }]
                    } else {
                      const isBtt = !!af?.isBtt
                      // (rx,ry) = rear/back end, (fx,fy) = front end
                      const [rx, ry, fx, fy] = isBtt ? [bbx, bby, btx, bty] : [btx, bty, bbx, bby]
                      const backCm  = visibleExtCm * (backExtMm  / sumExtMm)
                      const frontCm = visibleExtCm * (frontExtMm / sumExtMm)
                      const fBack  = backCm  / sb.lengthCm
                      const fFront = frontCm / sb.lengthCm
                      const p1x = rx + (fx - rx) * fBack,         p1y = ry + (fy - ry) * fBack
                      const p2x = rx + (fx - rx) * (1 - fFront),  p2y = ry + (fy - ry) * (1 - fFront)
                      segments = []
                      if (backCm  > 0) segments.push({ x1: rx,  y1: ry,  x2: p1x, y2: p1y, dashed: true  })
                      segments.push({ x1: p1x, y1: p1y, x2: p2x, y2: p2y, dashed: false })
                      if (frontCm > 0) segments.push({ x1: p2x, y1: p2y, x2: fx,  y2: fy,  dashed: true  })
                    }
                    const dashLen = Math.max(4, 8 / effZoom)
                    return (
                      <g key={`base-${ai}-${sbi}`}>
                        {segments.map((s, si) => (
                          <line key={si} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
                                stroke={L_PROFILE_STROKE} strokeWidth={profThick}
                                strokeLinecap="square"
                                strokeDasharray={s.dashed ? `${dashLen} ${dashLen * 0.7}` : undefined} />
                        ))}
                        {sBaseIDs && <g transform={`rotate(${la} ${mx} ${my})`}><AreaLabel x={mx} y={my} label={sb.trapezoidId} fontSize={Math.max(6, Math.min(Math.max(14, 20 / effZoom), smallestPanelW / (2 * 0.6)))} showChevron={false} /></g>}
                      </g>
                    )
                  })
                })}

                {/* 4.5 Anchor points — frameless roofs: one mark per rail crossing each virtual base line */}
                {sAnchors && hasAnchors && liveBeBasesData.map((areaData, ai) => {
                  return (areaData.bases ?? []).map((sb, sbi) => {
                    const offsets = sb.hookOffsets ?? []
                    if (!offsets.length || !(sb.lengthCm > 0)) return null
                    const ctx = resolveAreaContext(areaData, areaFrames, areaTrapsMap, beTrapezoidsData, customBasesMap, sb._panelRowIdx)
                    if (!ctx) return null
                    const { af } = ctx
                    const { btx, bty, bbx, bby } = baseScreenCoords(sb, sbi, { af, pixelToCmRatio, toSvg })
                    const r = Math.max(2, 4 / effZoom)
                    // hookOffsets are measured from the base's REAR end. baseScreenCoords
                    // returns (btx,bty)=rear for TTB but swaps endpoints in BTT mode —
                    // pick the rear endpoint explicitly so anchors land correctly in both.
                    const isBtt = !!af?.isBtt
                    const [rx, ry, fx, fy] = isBtt ? [bbx, bby, btx, bty] : [btx, bty, bbx, bby]
                    return offsets.map((off, oi) => {
                      const frac = Math.max(0, Math.min(1, off / sb.lengthCm))
                      const hx = rx + (fx - rx) * frac
                      const hy = ry + (fy - ry) * frac
                      return (
                        <circle key={`anchor-${ai}-${sbi}-${oi}`} cx={hx} cy={hy} r={r}
                          fill={OMEGA_PURPLE} stroke={WHITE} strokeWidth={1.5 / effZoom} />
                      )
                    })
                  })
                })}

                {/* 5. External diagonals */}
                {sDiags && sBases && liveBeBasesData.map((areaData, ai) => {
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

                    // Y: both endpoints come from BE data — startBase/endBaseOffsetCm
                    // may be mid-base when paired bases differ in length, and
                    // baseA / baseB can sit on different panelLineIdx, so each
                    // endpoint resolves its own line frame.
                    // After the geometric lyB is computed, B is then shifted
                    // inward by one block length — purely visual, to separate
                    // the diagonal from the row-edge dimension labels.
                    const lineA = tLines?.find(l => l.lineIdx === baseA.panelLineIdx) ?? tLines?.[0]
                    const lineB = tLines?.find(l => l.lineIdx === baseB.panelLineIdx) ?? tLines?.[0]
                    const depthA = (baseA.startCm + (d.startBaseOffsetCm ?? 0)) / pixelToCmRatio
                    const depthB = (baseB.startCm + (d.endBaseOffsetCm   ?? 0)) / pixelToCmRatio
                    const lyA = tIsBtt ? (lineA?.maxY ?? tLB.maxY) - depthA : (lineA?.minY ?? tLB.minY) + depthA
                    const lyBgeom = tIsBtt ? (lineB?.maxY ?? tLB.maxY) - depthB : (lineB?.minY ?? tLB.minY) + depthB
                    const blockLen = (beTrapezoidsData?.[baseB.trapezoidId]?.geometry?.blockLengthCm ?? 50) / pixelToCmRatio
                    // Inward shift reference: the diagonal's OVERLAP region —
                    // the local-Y band where both bases coexist. Anything else
                    // (lineA's middle, the whole area's middle) can push lyB
                    // outside the overlap when paired bases differ in length
                    // or sit on different panelLineIdx (A1/A2, C1/C2, D1/D2).
                    const aRearLY = tIsBtt ? (lineA?.maxY ?? tLB.maxY) - baseA.startCm / pixelToCmRatio
                                           : (lineA?.minY ?? tLB.minY) + baseA.startCm / pixelToCmRatio
                    const aFrontLY = tIsBtt ? aRearLY - baseA.lengthCm / pixelToCmRatio
                                            : aRearLY + baseA.lengthCm / pixelToCmRatio
                    const bRearLY = tIsBtt ? (lineB?.maxY ?? tLB.maxY) - baseB.startCm / pixelToCmRatio
                                           : (lineB?.minY ?? tLB.minY) + baseB.startCm / pixelToCmRatio
                    const bFrontLY = tIsBtt ? bRearLY - baseB.lengthCm / pixelToCmRatio
                                            : bRearLY + baseB.lengthCm / pixelToCmRatio
                    const overlapMinLY = Math.max(Math.min(aRearLY, aFrontLY), Math.min(bRearLY, bFrontLY))
                    const overlapMaxLY = Math.min(Math.max(aRearLY, aFrontLY), Math.max(bRearLY, bFrontLY))
                    const overlapMidLY = (overlapMinLY + overlapMaxLY) / 2
                    const lyB = lyBgeom + (lyA < overlapMidLY ? blockLen : -blockLen)

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
                    // Light open arrowhead at endpoint B (the inward-shifted, lower
                    // end), pointing along the diagonal. Two barbs swept back from
                    // the tip; thin + reduced-opacity so it reads as a light marker.
                    const dirRad = ang * Math.PI / 180
                    const ahLen = Math.max(5, 9 / effZoom), ahBarb = 0.5
                    const ahx1 = x2 - ahLen * Math.cos(dirRad - ahBarb), ahy1 = y2 - ahLen * Math.sin(dirRad - ahBarb)
                    const ahx2 = x2 - ahLen * Math.cos(dirRad + ahBarb), ahy2 = y2 - ahLen * Math.sin(dirRad + ahBarb)
                    return (
                      <g key={`diag-${ai}-${di}`}>
                          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={DIAGONAL_STROKE} strokeWidth={PROFILE_THICK} />
                          <polyline points={`${ahx1},${ahy1} ${x2},${y2} ${ahx2},${ahy2}`}
                            fill="none" stroke={DIAGONAL_STROKE} strokeOpacity={0.55}
                            strokeWidth={Math.max(0.75, 1.2 / effZoom)} strokeLinecap="round" strokeLinejoin="round" />
                          <g transform={`rotate(${labelAngle} ${mx} ${my})`}>
                            <rect x={mx - bgW/2} y={my - bgH/2} width={bgW} height={bgH} fill="white" fillOpacity={0.45} stroke={BORDER_MID} strokeWidth={0.5/effZoom} rx={1/effZoom} />
                            <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle" fontSize={fs} fontWeight="700" fill={DIAGONAL_LABEL}>{diagLabel}</text>
                          </g>
                      </g>
                    )
                  })
                })}

                {/* 5b. External-diagonal contact-point highlight — pulses the
                    OUTER contact point (the diagonal's start, the no-arrowhead
                    end) when the extDiagMinHeightCm param is focused in the
                    sidebar. Independent of the diagonals layer toggle. */}
                {highlightGroup === 'ext-diagonal' && liveBeBasesData.map((areaData, ai) => {
                  const diags = areaData.diagonals ?? []
                  const allBases = areaData.bases ?? []
                  const basesByRow: Record<number, any[]> = {}
                  for (const b of allBases) {
                    const ri = b._panelRowIdx ?? 0
                    ;(basesByRow[ri] ||= []).push(b)
                  }
                  const r = Math.max(3, 6 / effZoom)
                  return (
                    <g key={`extdiag-hl-${ai}`} style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }}>
                      {diags.map((d, di) => {
                        const diagPri = d.panelRowIdx ?? 0
                        const ctx = resolveAreaContext(areaData, areaFrames, areaTrapsMap, beTrapezoidsData, customBasesMap, diagPri)
                        if (!ctx) return null
                        const { af } = ctx
                        const { frame: tFrame, lines: tLines, isRtl: tIsRtl, isBtt: tIsBtt } = af
                        const { angleRad: tAngle, localBounds: tLB } = tFrame
                        const rowBases = basesByRow[diagPri] ?? allBases
                        const baseA = rowBases[d.startBaseIdx]
                        if (!baseA) return null
                        // Diagonal START = outer base contact (no arrowhead end).
                        const lxA = tIsRtl
                          ? tLB.maxX - baseA.offsetFromStartCm / pixelToCmRatio
                          : tLB.minX + baseA.offsetFromStartCm / pixelToCmRatio
                        const lineA = tLines?.find(l => l.lineIdx === baseA.panelLineIdx) ?? tLines?.[0]
                        const depthA = (baseA.startCm + (d.startBaseOffsetCm ?? 0)) / pixelToCmRatio
                        const lyA = tIsBtt ? (lineA?.maxY ?? tLB.maxY) - depthA : (lineA?.minY ?? tLB.minY) + depthA
                        const pa = localToScreen({ x: lxA, y: lyA }, tFrame.center, tAngle)
                        const [x1, y1] = toSvg(pa.x, pa.y)
                        if (isNaN(x1) || isNaN(y1)) return null
                        return <circle key={`ed-hl-${di}`} cx={x1} cy={y1} r={r}
                          fill={AMBER} fillOpacity={0.3} stroke={AMBER} strokeWidth={2 / effZoom} />
                      })}
                    </g>
                  )
                })}

                {/* 6. Connectors (splice) — above the diagonals, below the labels.
                    Both beams' joints are shown, centered on the base line: slope joints
                    map directly (line is slope-axis), base joints are in BASE coords
                    so they're projected to the slope axis (÷cos, the basis the blocks
                    layer uses). Rendered ≈ the connector's 10 cm size along the beam. */}
                {sBases && liveBeBasesData.map((areaData, ai) => {
                  return (areaData.bases ?? []).map((sb, sbi) => {
                    const trapGeom = beTrapezoidsData?.[sb.trapezoidId]?.geometry
                    if (!trapGeom) return null
                    const topSegs = trapGeom.topBeamSegments, baseSegs = trapGeom.baseBeamSegments
                    const hasSlope = (topSegs?.length ?? 0) > 1, hasBase = (baseSegs?.length ?? 0) > 1
                    if (!hasSlope && !hasBase) return null
                    if ((sb.hookOffsets?.length ?? 0) > 0) return null
                    const ctx = resolveAreaContext(areaData, areaFrames, areaTrapsMap, beTrapezoidsData, customBasesMap, sb._panelRowIdx)
                    if (!ctx) return null
                    const { af } = ctx
                    const { la, lx } = baseScreenCoords(sb, sbi, { af, pixelToCmRatio, toSvg })
                    const profThick = (4 / pixelToCmRatio) * sc
                    const cosA = Math.cos(((trapGeom.angle ?? 0) * Math.PI) / 180) || 1
                    const tIsBtt = !!af?.isBtt
                    const cLine = af?.lines?.find(l => l.lineIdx === sb.panelLineIdx) ?? af?.lines?.[0]
                    const cty = tIsBtt
                      ? (cLine?.maxY ?? af.frame.localBounds.maxY) - sb.startCm / pixelToCmRatio - sb.lengthCm / pixelToCmRatio
                      : (cLine?.minY ?? af.frame.localBounds.minY) + sb.startCm / pixelToCmRatio
                    const cby = cty + sb.lengthCm / pixelToCmRatio
                    const connPt = (slopeAxisCm: number) => {
                      const depth = slopeAxisCm / pixelToCmRatio
                      const y = tIsBtt ? cby - depth : cty + depth
                      const sp = localToScreen({ x: lx, y }, af.frame.center, af.frame.angleRad)
                      const [cx, cy] = toSvg(sp.x, sp.y)
                      return { cx, cy }
                    }
                    const slopeConns = hasSlope ? topSegs.filter((s: any) => s.jointAtFrontCm != null).map((s: any) => connPt(s.jointAtFrontCm)) : []
                    const baseConns  = hasBase  ? baseSegs.filter((s: any) => s.jointAtFrontCm != null).map((s: any) => connPt(s.jointAtFrontCm / cosA)) : []
                    const connAlong  = Math.max(8, (5 / pixelToCmRatio) * sc)         // ≈ half the connector length
                    const connAcross = Math.max(5, (profThick + 5 / effZoom) / 2)     // ≈ half the beam width
                    const rect = (c: { cx: number; cy: number }, key: string) => (
                      <rect key={key} x={c.cx - connAlong / 2} y={c.cy - connAcross / 2}
                        width={connAlong} height={connAcross} rx={1.5}
                        fill={BEAM_CONNECTOR_FILL} stroke={BEAM_CONNECTOR_STROKE} strokeWidth={0.8 / effZoom}
                        opacity={0.75} transform={`rotate(${la} ${c.cx} ${c.cy})`} style={{ pointerEvents: 'none' }} />
                    )
                    return (
                      <g key={`conn-${ai}-${sbi}`}>
                        {slopeConns.map((c, ci) => rect(c, `s-${ci}`))}
                        {baseConns.map((c, ci) => rect(c, `b-${ci}`))}
                      </g>
                    )
                  })
                })}

                {/* 7. Dimensions / labels (top layer) — per panel row */}
                {sDims && liveBeBasesData.map((areaData, ai) => {
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
                        <DimensionAnnotation measurePts={measurePts} annPts={annPts} labels={labels} colors={segColors} zoom={effZoom} fontSizeOverride={Math.max(9, 11 / effZoom)} />
                      </g>
                    )
                  })
                })}

                {/* Edit bar */}
                {sEditMode && Object.entries(areaTrapsMap).map(([areaKey, areaTrapIds]) => {
                  const areaData = (beBasesData ?? []).find(ad => String(ad.areaId) === String(areaKey) || ad.areaLabel === areaKey || ad.label === areaKey)
                  if (!areaData?.bases?.length) return null
                  // areaFrames is keyed by area id (same as areaTrapsMap) now
                  // that buildAreaFrames no longer falls back to a label stem.
                  const af = areaFrames[areaKey] ?? areaFrames[String(areaKey)]
                  if (!af?.frame?.center) return null
                  // Selection filter. Framed: show only the selected area's bar.
                  // Frameless areas use a pseudo trap id that isn't in
                  // trapAreaMap, so the selection won't resolve — in that case
                  // show every frameless area's bar (each edits its own area)
                  // and hide framed areas.
                  const selectedArea = effTrapId ? trapAreaMap[effTrapId] : null
                  const selectionResolved = effTrapId == null || selectedArea != null
                  const isFramelessArea = (areaData.bases ?? []).some(b => (b.hookOffsets?.length ?? 0) > 0)
                  if (selectionResolved) {
                    if (effTrapId !== null && String(areaKey) !== String(selectedArea)) return null
                  } else if (!isFramelessArea) {
                    return null
                  }

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

                    // Sort by current offset so the bar's index aligns with
                    // sorted mm offsets — required for multi-sub-trap rows.
                    const rowBasesSorted = (areaData.bases ?? [])
                      .filter(sb => (sb._panelRowIdx ?? 0) === pri)
                      .slice()
                      .sort((a, b) => (a.offsetFromStartCm ?? 0) - (b.offsetFromStartCm ?? 0))
                    if (rowBasesSorted.length === 0) return null

                    // Settings: prefer the row's first sub-trap. Edge / spacing
                    // params on the row are usually uniform across sub-traps;
                    // when they aren't, the first sub-trap drives clamp limits
                    // — acceptable since the per-base BE recompute is final.
                    const firstSubTrapId = stripVariation(rowBasesSorted[0].trapezoidId) || areaTrapIds[0]
                    const trapS = trapSettingsMap[firstSubTrapId] ?? trapSettingsMap[rowBasesSorted[0].trapezoidId] ?? {}
                    // Frameless rows = virtual anchors (non-empty hookOffsets).
                    // They have no real trapezoid, so trapSettingsMap has no
                    // entry. Anchors are free-move (the BE re-derives hook
                    // crossings on save), so use permissive clamps: drag to the
                    // frame edge (edge 0) with no max-spacing constraint (the
                    // 100mm min-gap between bases still applies in the overlay).
                    const isFramelessRow = (rowBasesSorted[0]?.hookOffsets?.length ?? 0) > 0
                    const clampSpacingMm = isFramelessRow
                      ? Math.round(frameLengthPx * pixelToCmRatio * 10)
                      : trapS.spacingMm
                    const clampEdgeOffsetMm = isFramelessRow ? 0 : trapS.edgeOffsetMm

                    // Per-row customBasesMap key (`areaId:rowIdx`) — single
                    // entry per row spanning every sub-trap.
                    const rowKey = `${areaKey}:${pri}`
                    const liveOffsets = customBasesMap[rowKey]
                    const offsetSource = liveOffsets ?? rowBasesSorted.map(sb => Math.round(sb.offsetFromStartCm * 10))
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
                        spacingMm={clampSpacingMm}
                        edgeOffsetMm={clampEdgeOffsetMm}
                        isSelected={true}
                        overrideBarLocalY={barLocalY}
                        onBasesChange={onBasesChange ? (offsets) => onBasesChange(areaKey, offsets, pri) : null}
                        // Each commit just opens the popover. The save flow
                        // (App.tsx) derives the BaseOp list from the diff
                        // between customBasesMap and beBasesData — every
                        // user gesture has already updated customBasesMap
                        // via onBasesChange, so we don't push ops here.
                        onBaseMoveCommit={(info: any) => {
                          setMoveEditor({
                            kind: 'move',
                            trapId: firstSubTrapId,
                            rowIdx: pri,
                            baseIdx: info.baseIdx,
                            oldOffsetMm: info.oldOffsetMm,
                            newOffsetMm: info.newOffsetMm,
                            areaKey,
                          })
                        }}
                        onBaseAddCommit={(info: any) => {
                          setMoveEditor({
                            kind: 'add',
                            trapId: firstSubTrapId,
                            rowIdx: pri,
                            baseIdx: -1,
                            oldOffsetMm: info.offsetMm,
                            newOffsetMm: info.offsetMm,
                            areaKey,
                          })
                        }}
                        onBaseDeleteCommit={(info: any) => {
                          setMoveEditor({
                            kind: 'delete',
                            trapId: firstSubTrapId,
                            rowIdx: pri,
                            baseIdx: info.baseIdx,
                            oldOffsetMm: info.offsetMm,
                            newOffsetMm: info.offsetMm,
                            areaKey,
                          })
                        }}
                      />
                    )
                  })
                })}

                {/* 7b. Endpoint grips — front/back drag handles for the extend op.
                    Consumes `liveBeBasesData` so grips ride the moved/added base
                    and disappear on deleted ones, in sync with the rest of the
                    canvas while the user edits in the bar. */}
                {sEditMode && (
                  <BaseEndpointGrips
                    beBasesData={liveBeBasesData}
                    beTrapezoidsData={beTrapezoidsData}
                    areaFrames={areaFrames}
                    areaTrapsMap={areaTrapsMap}
                    trapAreaMap={trapAreaMap}
                    customBasesMap={customBasesMap}
                    effectiveSelectedTrapId={effTrapId}
                    pixelToCmRatio={pixelToCmRatio}
                    sc={sc}
                    zoom={effZoom}
                    toSvg={toSvg}
                    pendingTrapOps={pendingTrapOps}
                    onExtend={(op) => onTrapExtend?.(op)}
                    onSelect={(areaId, rowIdx, baseIdx) => setSelectedExtendBase({ areaKey: String(areaId), rowIdx, baseIdx })}
                  />
                )}

                {/* 7c. Move popover — opens on mouseup after a base drag.
                    Reuses the styling/idiom of BaseEndpointGrips's editor:
                    numeric mm input + "Apply to similar rows" fan-out. */}
                {sEditMode && moveEditor && (() => {
                  // Locate the area + row this base lives in.
                  const ad = (beBasesData ?? []).find((a: any) =>
                    String(a.areaId) === moveEditor.areaKey
                      || a.areaLabel === moveEditor.areaKey
                      || a.label === moveEditor.areaKey
                  )
                  if (!ad) return null
                  const af = areaFrames[moveEditor.areaKey]
                    ?? areaFrames[String(moveEditor.areaKey)]
                    ?? areaFrames[`${moveEditor.areaKey}:${moveEditor.rowIdx}`]
                  if (!af?.frame?.center) return null

                  // Anchor the popover at this base's CURRENT (post-move)
                  // SVG position. Use frame geometry to project offset → screen.
                  const { frame: tFrame, isRtl: afIsRtl } = af
                  const { angleRad: tAngle, localBounds: tLB } = tFrame
                  const offCm = moveEditor.newOffsetMm / 10
                  const lx = afIsRtl
                    ? tLB.maxX - offCm / pixelToCmRatio
                    : tLB.minX + offCm / pixelToCmRatio
                  const ly = (tLB.minY + tLB.maxY) / 2
                  const ps = localToScreen({ x: lx, y: ly }, tFrame.center, tAngle)
                  const [ax, ay] = toSvg(ps.x, ps.y)

                  // Identify rows in this area "similar" to the edited row —
                  // same number of bases with matching (trapezoidId stripped
                  // of variation suffix, offsetFromStartCm) sequences. The
                  // user can fan the same absolute offset out to those rows.
                  const allRowIdxs = ([...new Set((ad.bases ?? []).map((b: any) => b._panelRowIdx ?? 0))] as number[]).sort((a, b) => a - b)
                  const seqFor = (ri: number) =>
                    (ad.bases ?? [])
                      .filter((b: any) => (b._panelRowIdx ?? 0) === ri)
                      .slice()
                      .sort((a: any, b: any) => a.offsetFromStartCm - b.offsetFromStartCm)
                  const editedSeq = seqFor(moveEditor.rowIdx)
                  const similarRowIdxs = allRowIdxs.filter((ri) => {
                    if (ri === moveEditor.rowIdx) return false
                    const seq = seqFor(ri)
                    if (seq.length !== editedSeq.length) return false
                    for (let i = 0; i < seq.length; i++) {
                      if (stripVariation(seq[i].trapezoidId) !== stripVariation(editedSeq[i].trapezoidId)) return false
                      if (Math.abs(seq[i].offsetFromStartCm - editedSeq[i].offsetFromStartCm) > 0.1) return false
                    }
                    return true
                  })

                  // Every helper below just mutates customBasesMap (the
                  // FE's intended-state map). The save flow in App.tsx
                  // derives the BaseOp wire payload from the diff between
                  // customBasesMap and beBasesData, consolidating
                  // identical changes across rows into single ops with
                  // multiple targets — so no FE-side op tracking needed.
                  //
                  // customBasesMap is keyed PER ROW (`areaId:rowIdx`) —
                  // a row's entry is the sorted mm offsets ACROSS all
                  // sub-traps. The diff (baseOpsBuilder) carries
                  // trapezoidId on each emitted op for BE disambiguation.
                  const rowKey = (ri: number) => `${moveEditor.areaKey}:${ri}`
                  const commitOffset = (mm: number) => {
                    const arr = customBasesMap?.[rowKey(moveEditor.rowIdx)]
                      ?? editedSeq.map((b: any) => Math.round(b.offsetFromStartCm * 10))
                    const next = [...arr]
                    next[moveEditor.baseIdx] = mm
                    onBasesChange?.(moveEditor.areaKey, next, moveEditor.rowIdx)
                    setMoveEditor({ ...moveEditor, newOffsetMm: mm })
                    dismissMoveEditorSoon()
                  }
                  const applyToSimilar = () => {
                    for (const otherRi of similarRowIdxs) {
                      const otherSeq = seqFor(otherRi)
                      const arr = customBasesMap?.[rowKey(otherRi)]
                        ?? otherSeq.map((b: any) => Math.round(b.offsetFromStartCm * 10))
                      const next = [...arr]
                      next[moveEditor.baseIdx] = moveEditor.newOffsetMm
                      onBasesChange?.(moveEditor.areaKey, next, otherRi)
                    }
                    setMoveEditor(null)
                  }
                  const applyAddToArea = () => {
                    for (const otherRi of allRowIdxs) {
                      if (otherRi === moveEditor.rowIdx) continue
                      const otherSeq = seqFor(otherRi)
                      const arr = customBasesMap?.[rowKey(otherRi)]
                        ?? otherSeq.map((b: any) => Math.round(b.offsetFromStartCm * 10))
                      if (arr.some((o: number) => Math.abs(o - moveEditor.newOffsetMm) < 100)) continue
                      const next = [...arr, moveEditor.newOffsetMm].sort((a, b) => a - b)
                      onBasesChange?.(moveEditor.areaKey, next, otherRi)
                    }
                    setMoveEditor(null)
                  }
                  const applyDeleteToArea = () => {
                    for (const otherRi of allRowIdxs) {
                      if (otherRi === moveEditor.rowIdx) continue
                      const otherSeq = seqFor(otherRi)
                      const arr = customBasesMap?.[rowKey(otherRi)]
                        ?? otherSeq.map((b: any) => Math.round(b.offsetFromStartCm * 10))
                      if (moveEditor.baseIdx < 0 || moveEditor.baseIdx >= arr.length) continue
                      const next = arr.filter((_: number, i: number) => i !== moveEditor.baseIdx)
                      onBasesChange?.(moveEditor.areaKey, next, otherRi)
                    }
                    setMoveEditor(null)
                  }

                  const otherRowsCount = allRowIdxs.filter(ri => ri !== moveEditor.rowIdx).length
                  const w = 210 / effZoom
                  const h = (moveEditor.kind === 'move' ? 110 : 80) / effZoom
                  const fontSz = 10 / effZoom
                  const title =
                    moveEditor.kind === 'add' ? 'Base added (mm from start)' :
                    moveEditor.kind === 'delete' ? 'Base deleted' :
                    'Move base (mm from start)'
                  return (
                    <foreignObject x={ax + 10 / effZoom} y={ay - h / 2} width={w} height={h}>
                      <div
                        onMouseDown={(e) => { e.stopPropagation(); dismissMoveEditorSoon() }}
                        onKeyDown={(e) => { e.stopPropagation(); dismissMoveEditorSoon() }}
                        onWheel={(e) => e.stopPropagation()}
                        style={{
                          background: 'white', border: `1px solid ${BORDER_MID}`,
                          borderRadius: 4 / effZoom, padding: `${6 / effZoom}px ${8 / effZoom}px`,
                          fontSize: fontSz, fontFamily: 'inherit',
                          boxShadow: `0 ${2 / effZoom}px ${6 / effZoom}px rgba(0,0,0,0.15)`,
                          display: 'flex', flexDirection: 'column', gap: 4 / effZoom,
                        }}
                      >
                        <div style={{ fontWeight: 700, color: PRIMARY }}>{title}</div>
                        {moveEditor.kind === 'move' && (
                          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 / effZoom }}>
                            offset
                            <input
                              type="number" min={0} step={10}
                              value={moveEditor.newOffsetMm}
                              onChange={(e) => {
                                const v = Math.max(0, Math.round(Number(e.target.value) || 0))
                                setMoveEditor({ ...moveEditor, newOffsetMm: v })
                              }}
                              onBlur={() => commitOffset(moveEditor.newOffsetMm)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  commitOffset(moveEditor.newOffsetMm)
                                }
                              }}
                              style={{
                                width: 70 / effZoom, padding: `${2 / effZoom}px ${4 / effZoom}px`,
                                border: `1px solid ${BORDER_MID}`, borderRadius: 2 / effZoom,
                                fontSize: fontSz, textAlign: 'right',
                              }}
                            />
                          </label>
                        )}
                        <div style={{ borderTop: `1px solid ${BORDER_MID}`, paddingTop: 4 / effZoom }}>
                          {moveEditor.kind === 'move' && (
                            <button
                              type="button"
                              disabled={similarRowIdxs.length === 0}
                              onClick={applyToSimilar}
                              title={similarRowIdxs.length === 0
                                ? 'No other rows in this area match the edited row'
                                : `Will update rows ${similarRowIdxs.join(', ')}`}
                              style={{
                                width: '100%', padding: `${3 / effZoom}px ${6 / effZoom}px`,
                                border: `1px solid ${BORDER_MID}`,
                                borderRadius: 2 / effZoom,
                                background: similarRowIdxs.length === 0 ? '#f5f5f5' : 'white',
                                color: similarRowIdxs.length === 0 ? '#999' : 'inherit',
                                cursor: similarRowIdxs.length === 0 ? 'not-allowed' : 'pointer',
                                fontSize: fontSz, textAlign: 'left',
                              }}
                            >
                              Apply to similar rows
                              {similarRowIdxs.length > 0 && ` (${similarRowIdxs.length})`}
                            </button>
                          )}
                          {(moveEditor.kind === 'add' || moveEditor.kind === 'delete') && (
                            <button
                              type="button"
                              disabled={otherRowsCount === 0}
                              onClick={moveEditor.kind === 'add' ? applyAddToArea : applyDeleteToArea}
                              title={otherRowsCount === 0
                                ? 'No other rows in this area'
                                : `Will ${moveEditor.kind} the same base in ${otherRowsCount} other row(s)`}
                              style={{
                                width: '100%', padding: `${3 / effZoom}px ${6 / effZoom}px`,
                                border: `1px solid ${BORDER_MID}`,
                                borderRadius: 2 / effZoom,
                                background: otherRowsCount === 0 ? '#f5f5f5' : 'white',
                                color: otherRowsCount === 0 ? '#999' : 'inherit',
                                cursor: otherRowsCount === 0 ? 'not-allowed' : 'pointer',
                                fontSize: fontSz, textAlign: 'left',
                              }}
                            >
                              Apply to all rows
                              {otherRowsCount > 0 && ` (${otherRowsCount})`}
                            </button>
                          )}
                        </div>
                      </div>
                    </foreignObject>
                  )
                })()}

                {/* Base parameter highlights (top z-order) */}
                {(highlightGroup === 'base-spacing' || highlightGroup === 'base-edges' || highlightGroup === 'base-overhang') && liveBeBasesData.map((areaData, ai) => {
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
          layers={editMode ? [] : [
            { label: t('step3.layer.roofImage'),  checked: showRoofImage,  setter: setShowRoofImage },
            { label: t('step3.layer.bases'),      checked: showBases,      setter: setShowBases },
            { label: t('step3.layer.baseIDs'),    checked: showBaseIDs,    setter: setShowBaseIDs },
            { label: t('step3.layer.blocks'),     checked: showBlocks,     setter: setShowBlocks },
            ...(hasAnchors ? [{ label: t('step3.layer.anchors'), checked: showAnchors, setter: setShowAnchors }] : []),
            { label: t('step3.layer.railLines'),  checked: showRailLines,  setter: setShowRailLines },
            { label: t('step3.layer.diagonals'),  checked: showDiagonals,  setter: setShowDiagonals },
            { label: t('step3.layer.dimensions'), checked: showDimensions, setter: setShowDimensions },
          ]}
          editPanel={baseEditPanel}
          summary={editMode ? (
            <span>{(hasAnchors ? t('step3.editMode.hintAnchors') : t('step3.editMode.hint')) || 'Drag bases on the bar to move; click to add or ✕ to remove. Drag base endpoints to extend.'}</span>
          ) : null}
          actions={editMode ? [
            // In edit mode: only an "Exit" toggle. Save lives in the sidebar
            // (per-tab Apply Changes); the host's onRequestExitEdit handles
            // the unsaved-edits confirm dialog before letting us flip out.
            { label: (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 8.5l3 3 7-7" />
                  </svg>
                  {t('step3.editMode.exit')}
                </span>
              ),
              onClick: async () => {
                if (onRequestExitEdit) {
                  const ok = await onRequestExitEdit()
                  if (!ok) return
                }
                setEditMode(false)
              },
              style: {
                color: 'white', background: PRIMARY, border: `1px solid ${PRIMARY}`,
                padding: '0.45rem 0.6rem', fontSize: '0.78rem', fontWeight: 700,
              } },
            { label: rulerActive ? t('step3.layer.rulerOn') : t('step3.layer.ruler'),
              onClick: () => { if (rulerActive) RulerTool._clear?.(); setRulerActive(v => !v) },
              style: rulerActive ? { color: BLUE, background: BLUE_BG, border: `1px solid ${BLUE_BORDER}` } : {} },
          ] : [
            // Out of edit mode: prominent primary entry button with a thin
            // pencil glyph (inline SVG — emoji icons feel out of place in
            // an engineering tool).
            { label: (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M11.5 1.5l3 3-9 9H2.5v-3z" />
                    <path d="M10 3l3 3" />
                  </svg>
                  {hasAnchors ? t('step3.editMode.enterAnchors') : t('step3.editMode.enter')}
                </span>
              ),
              onClick: () => setEditMode(true),
              style: {
                color: 'white', background: PRIMARY, border: `1px solid ${PRIMARY}`,
                padding: '0.45rem 0.6rem', fontSize: '0.78rem', fontWeight: 700,
              } },
            ...(onResetBases ? [{ label: t('step3.layer.resetDefaults'), onClick: onResetBases, style: { color: AMBER_DARK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}` } }] : []),
            { label: rulerActive ? t('step3.layer.rulerOn') : t('step3.layer.ruler'), onClick: () => { if (rulerActive) RulerTool._clear?.(); setRulerActive(v => !v) }, style: rulerActive ? { color: BLUE, background: BLUE_BG, border: `1px solid ${BLUE_BORDER}` } : {} },
          ]}
        />

        <CanvasNavigator
          viewZoom={zoom}
          onZoomOut={() => { const nz = Math.max(0.3, zoom - 0.1); zoomAtCenter(zoom, nz); setZoom(nz) }}
          onZoomReset={resetView}
          onZoomIn={() => { const nz = Math.min(8, zoom + 0.1); zoomAtCenter(zoom, nz); setZoom(nz) }}
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
