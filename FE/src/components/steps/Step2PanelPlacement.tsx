import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import {
  computePanelBackHeight,
} from '../../utils/trapezoidGeometry'
import { panelInsideRoof, hasVoidAreas } from '../../utils/panelUtils'
import { computePolygonPanels } from '../../utils/rectPanelService'
import { PANEL_V, PANEL_H } from '../../utils/panelCodes'
import { allAreasFrameless } from '../../utils/roofSpecUtils'
// panelSpec fallback: panelTypes is always provided by useProjectState (server-loaded),
// so this null sentinel should never actually be used at render time.
const _FALLBACK_PANEL_TYPE = null
import RowSidebar from './step2/RowSidebar'
import ToolPanel from './step2/ToolPanel'
import PanelCanvas from './step2/PanelCanvas'

export default function Step2PanelPlacement({
  uploadedImageData,
  imageSrc,
  roofPolygon,
  refinedArea,
  imageRef,
  setImageRef,
  baseline,
  setBaseline,
  panels,
  setPanels,
  selectedPanels,
  setSelectedPanels,
  dragState,
  setDragState,
  rotationState,
  setRotationState,
  viewZoom,
  setViewZoom,
  showBaseline,
  showDistances,
  setShowDistances,
  distanceMeasurement,
  setDistanceMeasurement,
  regenerateSingleRowHandler,
  addManualPanel,
  trapezoidConfigs,
  setTrapezoidConfigs,
  rectAreas = [],
  setRectAreas,
  onAddRectArea,
  cmPerPixel,
  panelTypes = [],
  panelType,
  setPanelType,
  panelFrontHeight,
  setPanelFrontHeight,
  panelAngle,
  setPanelAngle,
  refreshAreaTrapezoids,
  rebuildPanelGrid,
  recordPanelDeletion,
  clearDeletedPanelsForArea,
  deletedPanelKeys,
  setDeletedPanelKeys,
  skipNextRecompute,
  appDefaults,
  paramLimits = {} as Record<string, any>,
  roofType,
  rowMounting,
  setRowMounting,
  roofAxis = null,
  setRoofAxis,
  roofAxisEnabled = false,
  setRoofAxisEnabled,
  areas = null,
  setAreas = null,
}) {
  const angLim = paramLimits.mountingAngleDeg
  const fhLim  = paramLimits.frontHeightCm
  // Mounting section hidden only for fully-frameless projects (no construction frame).
  // Mixed projects show mounting — per-area frameless hiding is handled in the sidebar.
  const showMounting = !allAreasFrameless(roofType, [])
  const panelSpec = panelTypes.find(t => t.id === panelType) ?? panelTypes[0] ?? _FALLBACK_PANEL_TYPE
  const [activeTool, setActiveTool] = useState('area')
  const activeToolRef = useRef(activeTool)
  useEffect(() => { activeToolRef.current = activeTool }, [activeTool])
  // Edit mode (Area / Panels tab) is tracked separately from activeTool so
  // that activating overlay tools like the ruler doesn't flip the tab.
  const [editMode, setEditMode] = useState<'area' | 'panel'>('area')
  const [trapIdOverride, setTrapIdOverride] = useState(null)
  const [drawVertical, setDrawVertical] = useState(false)
  const [showHGridlines, setShowHGridlines] = useState(false)
  const [showVGridlines, setShowVGridlines] = useState(false)
  const [snapToGridlines, setSnapToGridlines] = useState(false)
  // Multi-row: when set, the next drawn area will be added to this areaGroupId
  const [addRowToGroup, setAddRowToGroup] = useState(null)

  // Clear trapezoid override when selection changes to something that isn't
  // the override's trap. Needed so a canvas/panel click drops the override,
  // but explicit trap clicks (which set both selectedPanels and trapIdOverride
  // in the same render) are preserved.
  useEffect(() => {
    if (!trapIdOverride) return
    if (selectedPanels.length === 0) { setTrapIdOverride(null); return }
    const trapPanelIds = new Set(
      panels.filter(p => p.trapezoidId === trapIdOverride).map(p => p.id)
    )
    const allSelectedBelongToTrap = selectedPanels.every(id => trapPanelIds.has(id))
    if (!allSelectedBelongToTrap) setTrapIdOverride(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPanels])

  // ── Auto-recalc trapezoids with 600ms debounce ──
  // Build a fingerprint per area from panel positions/orientations + area vertices.
  // When it changes for a specific area, debounce and recalc that area's trapezoids.
  // Uses a ref-based timer so that unrelated re-renders don't cancel pending recalcs.
  const prevFingerprintRef = useRef({})
  const pendingRecalcRef = useRef({})  // { [areaIdx]: timerId }
  useEffect(() => {
    const fp = {}
    rectAreas.forEach((area, idx) => {
      if (area.manualTrapezoids) return
      const areaPanels = panels.filter(p => p.area === idx)
      const verts = area.vertices?.map(v => `${Math.round(v.x)},${Math.round(v.y)}`).join(';') ?? ''
      const panelFp = areaPanels.map(p => `${p.id}:${Math.round(p.x)},${Math.round(p.y)},${p.width},${p.height},${p.heightCm},${p.widthCm}`).join('|')
      fp[idx] = `${verts}#${areaPanels.length}#${panelFp}#${area.rotation ?? 0}#${area.angle ?? ''}#${area.frontHeight ?? ''}`
    })

    for (const idx of Object.keys(fp)) {
      if (prevFingerprintRef.current[idx] !== fp[idx] && prevFingerprintRef.current[idx] !== undefined) {
        const areaIdx = Number(idx)
        // Reset debounce timer for this area
        if (pendingRecalcRef.current[areaIdx]) clearTimeout(pendingRecalcRef.current[areaIdx])
        pendingRecalcRef.current[areaIdx] = setTimeout(() => {
          delete pendingRecalcRef.current[areaIdx]
          refreshAreaTrapezoids(areaIdx)
        }, 600)
      }
    }
    prevFingerprintRef.current = fp
  }, [panels, rectAreas, refreshAreaTrapezoids])

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => { Object.values(pendingRecalcRef.current).forEach(clearTimeout) }
  }, [])

  // Track newly drawn area index so we can select it once panels are computed
  const pendingNewAreaIdxRef = useRef(null)
  // Stable area index(es) — survive panel ID changes across recomputes.
  // Single value for normal selection; array for multi-area marquee selections.
  const selectedAreaIdxRef = useRef(null)
  const selectedAreaIdxsRef = useRef(null)  // null or [idx, idx, ...]

  const allYLocked = rectAreas.length > 0 && rectAreas.every(a => a.mode === 'ylocked')

  const handleToggleYLock = () => {
    const newLocked = !allYLocked
    setRectAreas(prev => prev.map(a => ({ ...a, mode: newLocked ? 'ylocked' : 'free' })))
  }

  // Reactive recompute for Recalc-created derived rows: whenever the anchor
  // row's a/h changes (rowMounting edit, applyDefaultsToAll, etc.), update
  // the derived rectArea's frontHeight. Each derived rectArea carries:
  //   - anchorRowIndex: the rowIndex of its anchor in the same group
  //   - deltaAlongSlopeCm: slope-axis distance from anchor's front to here
  // Formula: derived.H = anchor.H + deltaAlongSlopeCm × sin(anchor.angle)
  useEffect(() => {
    if (!setRectAreas || !rectAreas?.length) return
    let needsUpdate = false
    const next = rectAreas.map((ra: any) => {
      if (!ra?.frontHeightDerived || ra.anchorRowIndex == null) return ra
      const groupId = ra.areaGroupId
      const anchor = rectAreas.find((r: any) => r.areaGroupId === groupId && r.rowIndex === ra.anchorRowIndex)
      if (!anchor) return ra
      const anchorLabel = anchor.label || String(anchor.id ?? '')
      const anchorRm = (rowMounting?.[anchorLabel] || [])[ra.anchorRowIndex] || {}
      const anchorH = anchorRm.frontHeightCm ?? parseFloat(anchor.frontHeight ?? '0') ?? 0
      const anchorAng = anchorRm.angleDeg ?? parseFloat(anchor.angle ?? '0') ?? 0
      const delta = ra.deltaAlongSlopeCm ?? 0
      const newH = anchorH + delta * Math.sin((anchorAng * Math.PI) / 180)
      const currH = parseFloat(ra.frontHeight ?? '0') || 0
      const currAng = parseFloat(ra.angle ?? '0') || 0
      const hChanged = Math.abs(newH - currH) > 0.05
      const angChanged = Math.abs(anchorAng - currAng) > 0.05
      if (!hChanged && !angChanged) return ra
      needsUpdate = true
      return { ...ra, frontHeight: newH, angle: anchorAng }
    })
    if (needsUpdate) setRectAreas(next)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowMounting])

  const handleAddRectArea = useCallback((area) => {
    pendingNewAreaIdxRef.current = rectAreas.length
    const isAllLocked = rectAreas.length > 0 && rectAreas.every(a => a.mode === 'ylocked')
    const groupId = addRowToGroup
    onAddRectArea?.({ ...area, mode: isAllLocked ? 'ylocked' : 'free' }, groupId)
    if (groupId) setAddRowToGroup(null)  // reset after use
  }, [rectAreas, onAddRectArea, addRowToGroup])

  // Recalc rows: PHASE 1 algorithm
  //   Step 1: identify columns containing rotated panels
  //   Step 2: remove those columns from the row → remaining contiguous column
  //           ranges each become a new sub-row (clean axis-aligned grid)
  //   Step 3: for each removed rotated-column range, split its panels by
  //           vertical voids (gaps > lineGap) → each contiguous group is a
  //           new sub-row
  // Detection + logs only for now; state mutation lands next.
  const handleRecalcRows = useCallback(() => {
    console.log('[recalc-rows] start')
    const lineGapPx = cmPerPixel ? (appDefaults?.lineGapCm ?? 5) / cmPerPixel : 8
    const colsOf = (p: any) => (p.coveredCols?.length > 0 ? p.coveredCols : [p.col ?? 0])
    const orientOf = (p: any) => p.heightCm > p.widthCm ? PANEL_V : PANEL_H
    // Collected per-area mutations: each entry says "split this area's panels
    // into these sub-rows". Applied atomically after detection.
    type MutationSubRow = { kind: 'clean' | 'rotated'; colRange: string; firstCol: number; panels: any[] }
    const mutations: { areaIdx: number; parentArea: any; subRows: MutationSubRow[]; colCenters: Map<number, number> }[] = []

    rectAreas.forEach((area, areaIdx) => {
      const areaPanels = panels.filter(p => p.area === areaIdx && !p.isEmpty)
      if (areaPanels.length === 0) return
      // Axis selection: for axis-aligned vertical areas (areaVertical=true,
      // effectiveRotation=90°), cols are laid out along screen Y and lines
      // along screen X. For horizontal areas, vice versa. (Arbitrary rotations
      // are not handled in phase 1.)
      const av = !!area?.areaVertical
      const colCenterOf = (p: any) => av ? p.y + p.height / 2 : p.x + p.width / 2
      const colStartOf  = (p: any) => av ? p.y : p.x
      const colEndOf    = (p: any) => av ? p.y + p.height : p.x + p.width
      const rowStartOf  = (p: any) => av ? p.x : p.y
      const rowEndOf    = (p: any) => av ? p.x + p.width : p.y + p.height

      // Per-line majority orientation = expected orientation for the row
      const lineGroups = new Map<number, any[]>()
      areaPanels.forEach(p => {
        const ln = p.row ?? 0
        if (!lineGroups.has(ln)) lineGroups.set(ln, [])
        lineGroups.get(ln)!.push(p)
      })
      const lineExpected = new Map<number, string>()
      for (const [ln, ps] of lineGroups) {
        const vCount = ps.filter(p => p.heightCm > p.widthCm).length
        lineExpected.set(ln, vCount >= ps.length / 2 ? PANEL_V : PANEL_H)
      }

      // Step 1: identify rotated panels and the columns they sit in.
      // togglePanelOrientation swaps W/H but doesn't update coveredCols, so a
      // rotated H panel still reports coveredCols=[1] even though it now
      // physically spans cols 1–2. Determine column coverage GEOMETRICALLY by
      // overlapping x-ranges against neighbour panels' cols.
      const rotatedPanels = areaPanels.filter(p => orientOf(p) !== lineExpected.get(p.row ?? 0))

      // A col has a "middle void" if there's a gap > 1 between consecutive
      // line indices WITHIN that col's own min/max. Use coveredCols — a
      // multi-col panel at line N "fills" all the cols it covers at that
      // line. Together with anchored panels in the same col, this gives the
      // true stack used for void detection.
      const colLines = new Map<number, Set<number>>()
      areaPanels.forEach(p => {
        const ln = p.row ?? 0
        colsOf(p).forEach((c: number) => {
          if (!colLines.has(c)) colLines.set(c, new Set())
          colLines.get(c)!.add(ln)
        })
      })
      const voidCols = new Set<number>()
      for (const [col, linesSet] of colLines) {
        const sorted = [...linesSet].sort((a, b) => a - b)
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i] - sorted[i - 1] > 1) { voidCols.add(col); break }
        }
      }

      // Nothing to do for this area if no rotations and no voids
      if (rotatedPanels.length === 0 && voidCols.size === 0) return

      const rotatedXRanges = rotatedPanels.map(p => ({ x1: colStartOf(p), x2: colEndOf(p) }))
      // Canonical col → center map (in col axis — screen-x for horizontal
      // areas, screen-y for vertical). Derived only from single-col panels;
      // multi-col panels would skew the center.
      const colCenters = new Map<number, number>()
      areaPanels.forEach(p => {
        const cs = colsOf(p)
        if (cs.length !== 1) return
        if (!colCenters.has(cs[0])) colCenters.set(cs[0], colCenterOf(p))
      })
      // TEMP DEBUG: rotation geometry + derived col centers (axis-aware)
      console.log(`  area ${areaIdx} (${area.label}) areaVertical=${av}`)
      console.log('  rotated panel geometry:', rotatedPanels.map(p => ({
        id: p.id, col: p.col, coveredCols: p.coveredCols, line: p.row,
        xRange: `[${p.x.toFixed(1)}..${(p.x + p.width).toFixed(1)}]`,
        yRange: `[${p.y.toFixed(1)}..${(p.y + p.height).toFixed(1)}]`,
        colAxisRange: `[${colStartOf(p).toFixed(1)}..${colEndOf(p).toFixed(1)}]`,
      })))
      console.log('  canonical col centers (col axis):', [...colCenters.entries()].sort((a, b) => a[0] - b[0]))
      // A col is "rotated" iff its canonical center is INSIDE the H's x range
      const rotatedCols = new Set<number>()
      for (const [col, cx] of colCenters) {
        if (rotatedXRanges.some(r => cx > r.x1 && cx < r.x2)) rotatedCols.add(col)
      }

      const omittedCols = new Set<number>([...rotatedCols, ...voidCols])
      const allCols = new Set<number>()
      areaPanels.forEach(p => colsOf(p).forEach((c: number) => allCols.add(c)))
      const cleanCols = [...allCols].filter(c => !omittedCols.has(c)).sort((a, b) => a - b)
      const rotCols = [...omittedCols].sort((a, b) => a - b)

      console.log(`[recalc-rows] area ${areaIdx} (${area.label}): ${rotatedPanels.length} rotated panel(s); rotated cols [${[...rotatedCols].sort((a, b) => a - b).join(',')}], void cols [${[...voidCols].sort((a, b) => a - b).join(',')}], omitted [${rotCols.join(',')}]`)

      // Helper: group an ordered list of column indices into contiguous ranges
      const groupContiguous = (cols: number[]) => {
        const out: number[][] = []
        let run: number[] = []
        for (const c of cols) {
          if (run.length === 0 || c === run[run.length - 1] + 1) run.push(c)
          else { out.push(run); run = [c] }
        }
        if (run.length > 0) out.push(run)
        return out
      }

      // Each panel belongs to the row containing its anchor col (p.col, =
      // min(coveredCols) for left-anchored multi-col panels). A panel that
      // visually spans into another row's column still lives in its anchor
      // col's row — no double-counting.
      const belongsTo = (p: any, range: number[]) => range.includes(p.col ?? 0)

      // Build sub-rows with their actual panels (for mutation)
      type SubRow = { kind: 'clean' | 'rotated'; colRange: string; firstCol: number; panels: any[] }
      const subRows: SubRow[] = []

      // Step 2: clean column ranges → one new sub-row each. Panels assigned
      // by anchor col (p.col). ALL panels — including multi-col ones — stay
      // in their anchor col's sub-row. The skipNextRecompute() call before
      // setRectAreas prevents polygon-fill from regenerating panels, so the
      // original panel positions (including multi-col spans) are preserved.
      const cleanRanges = groupContiguous(cleanCols)
      cleanRanges.forEach(range => {
        const ps = areaPanels.filter(p => belongsTo(p, range))
        if (ps.length === 0) return
        subRows.push({ kind: 'clean', colRange: `${range[0]}-${range[range.length - 1]}`, firstCol: range[0], panels: ps })
      })
      console.log(`  → step 2: ${subRows.filter(s => s.kind === 'clean').length} clean row(s)`,
        subRows.filter(s => s.kind === 'clean').map(s => ({ colRange: s.colRange, panelCount: s.panels.length })))

      // Step 3: rotated column ranges → split each by void along the ROW axis
      // (screen-y for horizontal areas, screen-x for vertical).
      const rotRanges = groupContiguous(rotCols)
      rotRanges.forEach(range => {
        const rangePanels = areaPanels
          .filter(p => belongsTo(p, range))
          .sort((a, b) => rowStartOf(a) - rowStartOf(b))
        let group: any[] = []
        const flush = () => {
          if (group.length === 0) return
          subRows.push({
            kind: 'rotated',
            colRange: `${range[0]}-${range[range.length - 1]}`,
            firstCol: range[0],
            panels: group,
          })
          group = []
        }
        for (const p of rangePanels) {
          if (group.length === 0) { group.push(p); continue }
          const maxEnd = group.reduce((m, x) => Math.max(m, rowEndOf(x)), -Infinity)
          const gap = rowStartOf(p) - maxEnd
          if (gap <= lineGapPx + 2) group.push(p)
          else { flush(); group.push(p) }
        }
        flush()
      })
      console.log(`  → step 3: ${subRows.filter(s => s.kind === 'rotated').length} rotated row(s) (split by void)`,
        subRows.filter(s => s.kind === 'rotated').map(s => ({
          colRange: s.colRange,
          panelCount: s.panels.length,
          lines: s.panels.map(p => ({ line: p.row, orient: orientOf(p) })),
        })))

      mutations.push({ areaIdx, parentArea: area, subRows, colCenters })
    })

    if (mutations.length === 0) {
      console.log('[recalc-rows] done — no changes needed')
      return
    }

    // ─── Apply mutations ─────────────────────────────────────────────────
    // Bbox X range comes from canonical col centers — tight, won't bleed into
    // adjacent cols (e.g. when a multi-col panel anchors at col 0 but spans
    // into col 1, the col 0 sub-row's x range stays at col 0's edges).
    // Axis-aware bbox. For horizontal areas: col axis = screen-x, row axis =
    // screen-y. For vertical areas: col axis = screen-y, row axis = screen-x.
    // colCenters values are in the area's col axis; bbox returned in screen.
    const bboxFromColsAndPanels = (subRow: MutationSubRow, colCenters: Map<number, number>, areaVertical: boolean) => {
      const sortedCenters = [...colCenters.entries()].sort((a, b) => a[0] - b[0])
      const fallbackPanelDim = areaVertical ? (subRow.panels[0]?.height ?? 50) : (subRow.panels[0]?.width ?? 50)
      const colWidth = sortedCenters.length >= 2
        ? Math.abs(sortedCenters[1][1] - sortedCenters[0][1])
        : fallbackPanelDim
      // Use coveredCols so multi-col panels (e.g. an H spanning 2 cols)
      // extend the sub-row's bbox to cover their full extent — otherwise the
      // bbox is too narrow and polygon-fill places the panel at the start
      // corner, making it look "aligned to left".
      const subCols = [...new Set(
        subRow.panels.flatMap((p: any) => p.coveredCols?.length > 0 ? p.coveredCols : [p.col ?? 0])
      )] as number[]
      const colCenterVals = subCols.map(c => colCenters.get(c)).filter((x): x is number => x !== undefined)
      // Col-axis extent (along col axis)
      let colMin: number, colMax: number
      if (colCenterVals.length === 0) {
        if (areaVertical) {
          colMin = Math.min(...subRow.panels.map(p => p.y))
          colMax = Math.max(...subRow.panels.map(p => p.y + p.height))
        } else {
          colMin = Math.min(...subRow.panels.map(p => p.x))
          colMax = Math.max(...subRow.panels.map(p => p.x + p.width))
        }
      } else {
        colMin = Math.min(...colCenterVals) - colWidth / 2
        colMax = Math.max(...colCenterVals) + colWidth / 2
      }
      // Row-axis extent (along row axis)
      let rowMin = Infinity, rowMax = -Infinity
      for (const p of subRow.panels) {
        if (areaVertical) {
          rowMin = Math.min(rowMin, p.x)
          rowMax = Math.max(rowMax, p.x + p.width)
        } else {
          rowMin = Math.min(rowMin, p.y)
          rowMax = Math.max(rowMax, p.y + p.height)
        }
      }
      // Map col/row axes back to screen X/Y
      const minX = areaVertical ? rowMin : colMin
      const maxX = areaVertical ? rowMax : colMax
      const minY = areaVertical ? colMin : rowMin
      const maxY = areaVertical ? colMax : rowMax
      return { minX, minY, maxX, maxY }
    }

    // Match parent vertex ordering so pivotIdx/yDir/xDir stay consistent
    // (axis-aligned assumption — for rotated areas we'd need local frame).
    const verticesMatchingParent = (parentVerts: any[], bbox: { minX: number; minY: number; maxX: number; maxY: number }) => {
      const pMinX = Math.min(...parentVerts.map((v: any) => v.x))
      const pMinY = Math.min(...parentVerts.map((v: any) => v.y))
      return parentVerts.map((v: any) => ({
        x: v.x === pMinX ? bbox.minX : bbox.maxX,
        y: v.y === pMinY ? bbox.minY : bbox.maxY,
      }))
    }

    // Sub-row's preferredOrientations — sorted by line index ascending so
    // polygon-fill produces panels matching the existing layout (incl. the
    // rotated H sitting where the V used to be).
    const preferredOrientationsOf = (subRow: MutationSubRow) => {
      const byLine = new Map<number, string>()
      for (const p of subRow.panels) {
        const ln = p.row ?? 0
        if (!byLine.has(ln)) byLine.set(ln, p.heightCm > p.widthCm ? PANEL_V : PANEL_H)
      }
      const lines = [...byLine.keys()].sort((a, b) => a - b)
      return lines.map(l => byLine.get(l)!)
    }

    const newRectAreas = [...rectAreas]
    const panelReassignments = new Map<number, number>()
    let nextId = Math.min(0, ...newRectAreas.map(a => a.id ?? 0)) - 1
    // Carries enough info per new sub-area to remap deletedPanelKeys after the
    // sub-areas are placed: target index, the original cols/rows it covers,
    // and the minOrigCol/minOrigRow to subtract for the new grid.
    type RemapEntry = { areaIdx: number; origCols: Set<number>; origRows: Set<number>; minOrigCol: number; minOrigRow: number }
    const remapTable: Array<{ originalAreaIdx: number; subAreaInfo: RemapEntry[] }> = []

    mutations.forEach(({ areaIdx, parentArea, subRows, colCenters }) => {
      if (subRows.length === 0) return
      // Ensure parent has an areaGroupId — promotes a standalone area into a group
      const groupId = parentArea.areaGroupId ?? parentArea.id ?? -(areaIdx + 1)
      newRectAreas[areaIdx] = { ...newRectAreas[areaIdx], areaGroupId: groupId }
      const sorted = [...subRows].sort((a, b) => a.firstCol - b.firstCol)
      const groupRows = newRectAreas.filter(a => a.areaGroupId === groupId)
      let nextRowIndex = Math.max(...groupRows.map(a => a.rowIndex ?? 0), -1) + 1
      const inheritedClean = { manualTrapezoids: false, manualColTrapezoids: {} }

      // Front-height derivation: a sub-area positioned UP the slope from the
      // parent's front gets a higher frontHeight. Formula:
      //   subAreaFrontHeight = parent.frontHeight + delta_along_slope * sin(angle)
      // where delta_along_slope is the screen distance (cm) from the parent's
      // front line to the sub-area's front line, taken in the slope-back
      // direction (yDir-aware). Only applied to horizontal areas for now —
      // vertical-area H derivation is a separate TODO.
      const parentAngleDeg = parseFloat(parentArea.angle ?? '0') || 0
      const parentAngleRad = parentAngleDeg * Math.PI / 180
      const parentFrontHeightVal = parseFloat(parentArea.frontHeight ?? '0') || 0
      const yDir = parentArea.yDir ?? 'ttb'
      const av = !!parentArea?.areaVertical
      const frontPosOf = (ps: any[]) => {
        if (av) return yDir === 'btt'
          ? Math.max(...ps.map((p: any) => p.x + p.width))
          : Math.min(...ps.map((p: any) => p.x))
        return yDir === 'btt'
          ? Math.max(...ps.map((p: any) => p.y + p.height))
          : Math.min(...ps.map((p: any) => p.y))
      }
      const areaPanelsForFH = panels.filter(p => p.area === areaIdx && !p.isEmpty)
      const parentFrontPos = areaPanelsForFH.length > 0 ? frontPosOf(areaPanelsForFH) : 0
      const yDirSign = yDir === 'btt' ? -1 : 1
      // Return both the final H and the slope-axis delta in cm. The delta is
      // stored on derived rectAreas so reactive recompute (when anchor's a/h
      // changes) is a simple multiply-by-sin without re-reading vertices.
      const computeFrontHeightAndDelta = (subPanels: any[]) => {
        if (parentAngleRad === 0 || subPanels.length === 0) {
          return { fh: parentFrontHeightVal, deltaCm: 0 }
        }
        const subFrontPos = frontPosOf(subPanels)
        const deltaPx = (subFrontPos - parentFrontPos) * yDirSign
        const deltaCm = deltaPx * (cmPerPixel ?? 1)
        return { fh: parentFrontHeightVal + deltaCm * Math.sin(parentAngleRad), deltaCm }
      }
      const remapForThisArea: RemapEntry[] = []
      const remapEntryFor = (subRow: MutationSubRow, targetIdx: number): RemapEntry => {
        const origCols = new Set<number>(subRow.panels.map(p => p.col ?? 0))
        const origRows = new Set<number>(subRow.panels.map(p => p.row ?? 0))
        return {
          areaIdx: targetIdx,
          origCols, origRows,
          minOrigCol: Math.min(...origCols),
          minOrigRow: Math.min(...origRows),
        }
      }
      // First sub-row → shrink parent in place; remaining → append.
      // The first sub-row contains the parent's front line (delta=0), so its
      // frontHeight equals the user-defined parent value — keep it as a
      // user-defined row. Appended sub-rows are positioned UP the slope and
      // get derived frontHeight + frontHeightDerived: true flag so the BE
      // (and FE-side gating) treats them as view-only.
      const firstSubRow = sorted[0]
      const firstBbox = bboxFromColsAndPanels(firstSubRow, colCenters, !!parentArea?.areaVertical)
      newRectAreas[areaIdx] = {
        ...newRectAreas[areaIdx],
        vertices: verticesMatchingParent(parentArea.vertices, firstBbox),
        preferredOrientations: preferredOrientationsOf(firstSubRow),
        frontHeight: computeFrontHeightAndDelta(firstSubRow.panels).fh,
        ...inheritedClean,
      }
      firstSubRow.panels.forEach(p => panelReassignments.set(p.id, areaIdx))
      remapForThisArea.push(remapEntryFor(firstSubRow, areaIdx))
      // The anchor row is the first sub-row (parent in place — it kept the
      // user-defined H). Derived rows reference it so the FE can recompute
      // their H reactively when the anchor's a/h changes.
      const anchorRowIndex = newRectAreas[areaIdx].rowIndex ?? 0
      sorted.slice(1).forEach(subRow => {
        const bbox = bboxFromColsAndPanels(subRow, colCenters, !!parentArea?.areaVertical)
        const { fh: subFh, deltaCm } = computeFrontHeightAndDelta(subRow.panels)
        // Sub-rows whose derived H equals the parent's H (typically those at
        // the same slope position as the parent's front line) stay as
        // user-defined — they're not constrained by geometry, the user can
        // edit them freely.
        const isDerived = Math.abs(subFh - parentFrontHeightVal) > 0.5
        const newArea = {
          ...parentArea,
          vertices: verticesMatchingParent(parentArea.vertices, bbox),
          id: nextId--,
          areaGroupId: groupId,
          rowIndex: nextRowIndex++,
          preferredOrientations: preferredOrientationsOf(subRow),
          frontHeight: subFh,
          ...(isDerived ? { frontHeightDerived: true, anchorRowIndex, deltaAlongSlopeCm: deltaCm } : {}),
          ...inheritedClean,
        }
        const newAreaIdx = newRectAreas.length
        newRectAreas.push(newArea)
        subRow.panels.forEach(p => panelReassignments.set(p.id, newAreaIdx))
        remapForThisArea.push(remapEntryFor(subRow, newAreaIdx))
      })
      remapTable.push({ originalAreaIdx: areaIdx, subAreaInfo: remapForThisArea })
    })

    // Remap deletedPanelKeys: each original deletion is keyed `row_col` within
    // the original area's grid. After splitting, the new sub-area's grid is
    // 0-indexed from its own min row/col, so we remap `row-minOrigRow_col-minOrigCol`
    // into the target sub-area's bucket. Without this remap, the auto-recompute
    // on setRectAreas refills previously-deleted cells.
    const newDeletedPanelKeys: Record<number, string[]> = { ...(deletedPanelKeys ?? {}) }
    remapTable.forEach(({ originalAreaIdx, subAreaInfo }) => {
      const origKeys = newDeletedPanelKeys[originalAreaIdx] || []
      if (origKeys.length === 0) return
      // Clear original area's keys — they refer to the pre-split grid.
      // Sub-areas inherit the relevant ones below.
      delete newDeletedPanelKeys[originalAreaIdx]
      for (const k of origKeys) {
        const [origRow, origCol] = k.split('_').map(Number)
        const target = subAreaInfo.find(e => e.origCols.has(origCol) && e.origRows.has(origRow))
        if (!target) continue  // deletion fell outside all sub-areas (shouldn't happen normally)
        const newKey = `${origRow - target.minOrigRow}_${origCol - target.minOrigCol}`
        if (!newDeletedPanelKeys[target.areaIdx]) newDeletedPanelKeys[target.areaIdx] = []
        if (!newDeletedPanelKeys[target.areaIdx].includes(newKey)) {
          newDeletedPanelKeys[target.areaIdx] = [...newDeletedPanelKeys[target.areaIdx], newKey]
        }
      }
    })
    console.log('[recalc-rows] deletedPanelKeys remap:', { before: deletedPanelKeys, after: newDeletedPanelKeys })
    setDeletedPanelKeys?.(newDeletedPanelKeys)

    console.log(`[recalc-rows] applying: ${newRectAreas.length - rectAreas.length} new rectArea(s); ${panelReassignments.size} panel(s) reassigned`)
    console.log('[recalc-rows] new rectAreas:', newRectAreas.map((a, i) => {
      const xs = (a.vertices ?? []).map((v: any) => v.x).filter((v: any) => typeof v === 'number')
      const ys = (a.vertices ?? []).map((v: any) => v.y).filter((v: any) => typeof v === 'number')
      return {
        idx: i, id: a.id, groupId: a.areaGroupId, rowIndex: a.rowIndex,
        areaVertical: !!a.areaVertical,
        bboxX: xs.length ? `${Math.min(...xs).toFixed(1)}..${Math.max(...xs).toFixed(1)}` : '?',
        bboxY: ys.length ? `${Math.min(...ys).toFixed(1)}..${Math.max(...ys).toFixed(1)}` : '?',
        preferredOrientations: a.preferredOrientations,
        frontHeight: a.frontHeight,
        frontHeightDerived: !!a.frontHeightDerived,
        angle: a.angle,
      }
    }))

    // Sync rowMounting and trapezoidConfigs for affected sub-areas so the
    // sidebar's row list (reads rowMounting) and traps list (reads
    // trapezoidConfigs) show the derived front-height values without
    // requiring a full polygon-fill recompute.
    const affectedIdxs = new Set<number>()
    mutations.forEach(({ areaIdx }) => affectedIdxs.add(areaIdx))
    for (let i = rectAreas.length; i < newRectAreas.length; i++) affectedIdxs.add(i)

    const newRowMounting = { ...(rowMounting ?? {}) }
    const newTrapezoidConfigs = { ...(trapezoidConfigs ?? {}) }
    // Reassign each panel to its new sub-area AND update panelRowIdx to match
    // the sub-area's rowIndex — without this, downstream lookups (e.g. the
    // trap editor's rowMounting lookup keyed by panelRowIdx) still resolve
    // against the pre-split row.
    const newPanelsArr = panels.map(p => {
      const newAreaIdx = panelReassignments.get(p.id)
      if (newAreaIdx === undefined) return p
      const newAreaRowIdx = newRectAreas[newAreaIdx]?.rowIndex ?? p.panelRowIdx ?? 0
      return { ...p, area: newAreaIdx, panelRowIdx: newAreaRowIdx }
    })

    for (const idx of affectedIdxs) {
      const a = newRectAreas[idx]
      if (!a) continue
      const areaLabelStr = String(a.label || a.id || `area-${idx}`)
      const ri = a.rowIndex ?? 0
      const angle = parseFloat(a.angle ?? '0') || 0
      const frontHeight = parseFloat(a.frontHeight ?? '0') || 0
      // rowMounting represents USER-DEFINED rows only. Skip derived rows so
      // BE knows to recompute their H. The sidebar's display falls back to
      // rectArea.frontHeight (which we DO populate above).
      if (!a.frontHeightDerived) {
        if (!newRowMounting[areaLabelStr]) newRowMounting[areaLabelStr] = []
        newRowMounting[areaLabelStr] = [...newRowMounting[areaLabelStr]]
        newRowMounting[areaLabelStr][ri] = { angleDeg: angle, frontHeightCm: frontHeight }
      }
      // trapezoidConfigs: refresh the a/h of trapIds touching this sub-area
      // so the trap detail panel reflects the new value (even for derived
      // rows — display only, BE owns the source of truth).
      const subPanels = newPanelsArr.filter((p: any) => p.area === idx && !p.isEmpty)
      const trapIdsSet = new Set<string>()
      for (const p of subPanels as any[]) {
        if (typeof p.trapezoidId === 'string') trapIdsSet.add(p.trapezoidId)
      }
      for (const tid of trapIdsSet) {
        if (newTrapezoidConfigs[tid]) {
          newTrapezoidConfigs[tid] = {
            ...newTrapezoidConfigs[tid],
            angle, frontHeight,
            lineOrientations: a.preferredOrientations || newTrapezoidConfigs[tid].lineOrientations,
          }
        }
      }
    }

    // Remap each panel's row/col to LOCAL-to-sub-area indices (0-based).
    // panel.row/col were inherited from the parent area's grid; the new
    // sub-area's grid has its own 0-based axes. Without this remap,
    // buildPanelGrid (which keys filtered panels by row/col) wouldn't
    // recognize them and would emit all EV/EH ghost slots.
    const remapMaps = new Map<number, { rows: Map<number, number>; cols: Map<number, number> }>()
    for (const idx of affectedIdxs) {
      const subPanels = newPanelsArr.filter((p: any) => p.area === idx && !p.isEmpty)
      if (subPanels.length === 0) continue
      const uniqueRows = [...new Set(subPanels.map((p: any) => p.row ?? 0))].sort((a, b) => (a as number) - (b as number)) as number[]
      const colSet = new Set<number>()
      subPanels.forEach((p: any) => {
        const cs = (p.coveredCols?.length > 0 ? p.coveredCols : [p.col ?? 0]) as number[]
        cs.forEach(c => colSet.add(c))
      })
      const uniqueCols = [...colSet].sort((a, b) => a - b)
      remapMaps.set(idx, {
        rows: new Map(uniqueRows.map((r, i) => [r, i])),
        cols: new Map(uniqueCols.map((c, i) => [c, i])),
      })
    }
    const remappedPanels = newPanelsArr.map((p: any) => {
      const maps = remapMaps.get(p.area)
      if (!maps) return p
      const newRow = maps.rows.get(p.row ?? 0) ?? p.row
      const newCol = maps.cols.get(p.col ?? 0) ?? p.col
      // p.line mirrors p.row in rectPanelService.ts — remap both so railLayoutService
      // (which keys lineGroups by p.line) lines up with BE rails keyed by the sub-area's
      // local lineIdx. Without this, sub-rows fall to the default-spacing branch with
      // spacing=0 and both rails collapse to the panel midpoint, rendering as one rail.
      const newLine = maps.rows.get(p.line ?? p.row ?? 0) ?? p.line ?? newRow
      const newCoveredCols = p.coveredCols?.map((c: number) => maps.cols.get(c) ?? c) ?? undefined
      return { ...p, row: newRow, line: newLine, col: newCol, ...(newCoveredCols ? { coveredCols: newCoveredCols } : {}) }
    })

    // Suppress the auto-recompute that fires on rectAreas change — we've
    // already curated the panel list (originals preserved, area field
    // reassigned). Polygon-fill regeneration would clobber multi-col panel
    // positions and re-fill deleted cells.
    skipNextRecompute?.()
    setRectAreas(newRectAreas)
    setPanels(remappedPanels)
    setRowMounting?.(newRowMounting)
    setTrapezoidConfigs?.(newTrapezoidConfigs)
    // Rebuild panelGrid for the new multi-row structure. Pass newRectAreas
    // explicitly so the rebuild sees the post-Recalc layout — closured
    // rectAreas inside the hook still points at pre-Recalc state.
    rebuildPanelGrid?.(remappedPanels, { rectAreas: newRectAreas })
    console.log('[recalc-rows] done')
  }, [rectAreas, panels, appDefaults, cmPerPixel, setRectAreas, setPanels, deletedPanelKeys, setDeletedPanelKeys, skipNextRecompute, rowMounting, setRowMounting, trapezoidConfigs, setTrapezoidConfigs])

  const handleDeleteArea = useCallback((areaKey) => {
    // After deletion, indices shift: next area lands at same index, or previous if it was last
    const nextIdx = areaKey < rectAreas.length - 1 ? areaKey : areaKey - 1
    selectedAreaIdxRef.current = nextIdx >= 0 ? nextIdx : null
    selectedAreaIdxsRef.current = null
    setPanels(prev => prev.filter(p => (p.area ?? p.row) !== areaKey))
    setRectAreas(prev => prev.filter((_, idx) => idx !== areaKey))
    clearDeletedPanelsForArea?.(areaKey)
    setSelectedPanels([])
  }, [rectAreas.length, setPanels, setRectAreas, setSelectedPanels, clearDeletedPanelsForArea])

  const handleRotateArea90 = useCallback((areaIdx) => {
    if (areaIdx == null || areaIdx >= rectAreas.length) return
    const area = rectAreas[areaIdx]
    if (!area?.vertices?.length) return

    // Rotate the polygon 90° around V0 (the pivot/start corner) so V0 stays
    // put. Add 90° to `rotation` so the effective rotation
    // `(areaVertical?90:0)+rotation` follows the vertex change in lockstep
    // ACROSS multiple clicks — two clicks must yield 180°, not cycle back to
    // 0° (the previous `areaVertical` toggle gave only 2 states for a 4-step
    // rotation cycle).
    const pivot = area.vertices[area.pivotIdx ?? 0]
    const cosR = Math.cos(Math.PI / 2), sinR = Math.sin(Math.PI / 2)
    const newVertices = area.vertices.map(v => ({
      x: pivot.x + (v.x - pivot.x) * cosR - (v.y - pivot.y) * sinR,
      y: pivot.y + (v.x - pivot.x) * sinR + (v.y - pivot.y) * cosR,
    }))
    const newRotation = (((area.rotation ?? 0) + 90) % 360 + 360) % 360
    const updatedArea = { ...area, vertices: newVertices, rotation: newRotation }

    setRectAreas(prev => prev.map((a, i) => i === areaIdx ? updatedArea : a))

    // Re-lay out panels inside the rotated polygon so they follow the area's
    // new orientation. CRITICAL: capture existing panel orientations first
    // and pass them as preferredOrientations — rotation must NOT silently
    // flip lines V↔H. Greedy fill in the new bbox can pick differently from
    // before, so we anchor the choice to what the user already had.
    if (cmPerPixel && panelSpec) {
      // Collect existing line orientations in row-index order. Row 0 is
      // already the V0 side (computePolygonPanels derives yDir/xDir from V0),
      // so the resulting list maps directly onto preferredOrientations
      // indexes used after the rotation.
      const existingPanels = panels.filter(p => (p.area ?? p.row) === areaIdx && !p.isEmpty)
      const lineMap = new Map()
      existingPanels.forEach(p => {
        const r = p.row ?? 0
        if (!lineMap.has(r)) lineMap.set(r, p.heightCm > p.widthCm ? PANEL_V : PANEL_H)
      })
      const inferredOrients = [...lineMap.entries()].sort(([a], [b]) => a - b).map(([, o]) => o)
      const orientationsToUse = area.preferredOrientations ?? (inferredOrients.length ? inferredOrients : null)

      // Persist inferred orientations on the area so subsequent rotations
      // also see them (otherwise inference re-runs against potentially
      // already-changed panels).
      if (!area.preferredOrientations && inferredOrients.length) {
        setRectAreas(prev => prev.map((a, i) => i === areaIdx ? { ...a, preferredOrientations: inferredOrients } : a))
      }

      const newPanelLayout = computePolygonPanels(updatedArea, cmPerPixel, panelSpec, appDefaults?.panelGapCm, orientationsToUse)
      if (newPanelLayout.length) {
        clearDeletedPanelsForArea?.(areaIdx)
        const otherPanels = panels.filter(p => (p.area ?? p.row) !== areaIdx)
        const maxId = Math.max(0, ...panels.map(p => p.id))
        const regenerated = newPanelLayout.map((p, i) => ({
          ...p,
          id: maxId + 1 + i,
          area: areaIdx,
          areaGroupKey: areaIdx,
          panelRowIdx: area.rowIndex ?? 0,
        }))
        const newPanels = [...otherPanels, ...regenerated]
        setPanels(newPanels)
        rebuildPanelGrid?.(newPanels)
      }
    }
  }, [rectAreas, setRectAreas, cmPerPixel, panelSpec, appDefaults, panels, setPanels, rebuildPanelGrid, clearDeletedPanelsForArea])

  // Keep selectedAreaIdxRef in sync whenever selectedPanels changes (panels are still fresh here)
  useEffect(() => {
    if (selectedPanels.length === 0) {
      selectedAreaIdxRef.current = null
      selectedAreaIdxsRef.current = null
      return
    }
    const selAreas = [...new Set(panels.filter(p => selectedPanels.includes(p.id)).map(p => p.area))]
    selectedAreaIdxRef.current = selAreas[0] ?? null
    selectedAreaIdxsRef.current = selAreas.length > 1 ? selAreas : null
  }, [selectedPanels])

  // Re-sync selectedPanels after panels recompute (IDs change but area index is stable)
  useEffect(() => {
    if (panels.length === 0) return

    // Pending new area — select it once it's computed
    if (pendingNewAreaIdxRef.current !== null) {
      const newPanels = panels.filter(p => p.area === pendingNewAreaIdxRef.current)
      if (newPanels.length > 0) {
        selectedAreaIdxRef.current = pendingNewAreaIdxRef.current
        setSelectedPanels(newPanels.map(p => p.id))
        pendingNewAreaIdxRef.current = null
      }
      return
    }

    // Re-derive selectedPanels from the stable area index(es)
    if (selectedAreaIdxRef.current !== null) {
      // Multi-area selection (marquee): re-sync across all selected areas
      const idxs = selectedAreaIdxsRef.current || [selectedAreaIdxRef.current]
      const idxSet = new Set(idxs)
      const areaPanels = panels.filter(p => idxSet.has(p.area)).map(p => p.id)
      if (areaPanels.length > 0) {
        setSelectedPanels(prev => {
          const areaPanelSet = new Set(areaPanels)
          if (prev.length > 0 && prev.every(id => areaPanelSet.has(id))) return prev
          const same = prev.length === areaPanels.length && areaPanels.every(id => prev.includes(id))
          return same ? prev : areaPanels
        })
        return
      }
    }

    // Auto-select single area when nothing is selected
    const areaKeys = [...new Set(panels.map(p => p.area))]
    if (areaKeys.length === 1 && selectedAreaIdxRef.current === null) {
      selectedAreaIdxRef.current = areaKeys[0]
      setSelectedPanels(panels.map(p => p.id))
    }
  }, [panels])

  // ── Derived row data ────────────────────────────────────────────────────────

  const rows = useMemo(() => {
    if (panels.length === 0) return []

    const rowMap = new Map()
    panels.forEach(panel => {
      const key = (panel.area ?? panel.row) !== undefined ? (panel.area ?? panel.row) : `manual_${panel.id}`
      if (!rowMap.has(key)) rowMap.set(key, [])
      rowMap.get(key).push(panel)
    })

    const result = []

    Array.from(rowMap.entries())
      .sort(([a], [b]) => {
        const na = typeof a === 'number' ? a : 9999
        const nb = typeof b === 'number' ? b : 9999
        return na - nb
      })
      .forEach(([, rowPanels]) => {
        result.push(rowPanels)
      })

    return result
  }, [panels])

  // Group rows by areaGroupId for multi-row display
  const areaGroups = useMemo(() => {
    const groups = new Map()  // areaGroupId → { label, color, areaIndices: [], rows: [] }
    rows.forEach((row, rowIdx) => {
      const areaIdx = row[0]?.area
      if (areaIdx == null) return
      const area = rectAreas[areaIdx]
      if (!area) return
      const groupId = area.areaGroupId
      if (!groups.has(groupId)) {
        groups.set(groupId, { groupId, label: area.label, color: area.color, areaIndices: [], rows: [] })
      }
      const g = groups.get(groupId)
      g.areaIndices.push(areaIdx)
      g.rows.push({ rowIdx, row, areaIdx, panelRowIndex: area.rowIndex ?? 0 })
    })
    return [...groups.values()]
  }, [rows, rectAreas])

  const panelToRowMap = useMemo(() => {
    const map = new Map()
    rows.forEach((row, i) => row.forEach(p => map.set(p.id, i)))
    return map
  }, [rows])

  const selectedRowIndex = selectedPanels.length > 0
    ? (panelToRowMap.get(selectedPanels[0]) ?? null)
    : null

  const selectedRow = (selectedRowIndex !== null) ? rows[selectedRowIndex] : null
  const selectedAreaIdx = selectedRow?.length ? (selectedRow[0].area ?? selectedRow[0].row ?? null) : null

  // ── Tool helpers ─────────────────────────────────────────────────────────────

  const handleToolChange = (tool) => {
    const keepSelection = (tool === 'move' || tool === 'rotate') &&
                          (activeTool === 'move' || activeTool === 'rotate')
    setActiveTool(tool)
    // Update editMode only for tools that own a tab. Overlay tools like the
    // ruler ('measure') and the roof-axis tool ('roofAxis') must not flip
    // the Area/Panels tab.
    if (tool === 'area') setEditMode('area')
    else if (tool !== 'measure' && tool !== 'roofAxis') setEditMode('panel')
    if (!keepSelection) setSelectedPanels([])
    setPendingAddNextTo(false)
    setAddError(null)
    if (tool === 'measure') setShowDistances(true)
  }

  const handleSetEditMode = (mode) => {
    if (mode === 'area') handleToolChange('area')
    else handleToolChange('move')
  }

  // Per-panel rotation: swap each panel's width/height and shift its
  // position so the corner nearest the area's V0 stays put. Does not
  // touch area.preferredOrientations (rotation is a single-panel,
  // manual override).
  const togglePanelOrientation = (panelIds = selectedPanels) => {
    if (!panelIds.length) return
    const idSet = new Set(panelIds)
    const firstSel = panels.find(p => idSet.has(p.id))
    const areaIdx = firstSel?.area ?? 0
    const area = rectAreas[areaIdx]
    const pivot = area?.vertices?.[area?.pivotIdx ?? 0]
    const newPanels = panels.map(panel => {
      if (!idSet.has(panel.id)) return panel
      const cx = panel.x + panel.width / 2, cy = panel.y + panel.height / 2
      const newW = panel.height, newH = panel.width
      const isCurrentlyPortrait = (panel.heightCm ?? panelSpec.lengthCm) > (panelSpec.lengthCm + panelSpec.widthCm) / 2
      const newHeightCm = isCurrentlyPortrait ? panelSpec.widthCm : panelSpec.lengthCm
      const newWidthCm  = isCurrentlyPortrait ? panelSpec.lengthCm : panelSpec.widthCm
      if (pivot) {
        const r = (panel.rotation || 0) * Math.PI / 180
        const cosR = Math.cos(r), sinR = Math.sin(r)
        const hw = panel.width / 2, hh = panel.height / 2
        const corners = [
          { dx: -hw, dy: -hh }, { dx: hw, dy: -hh },
          { dx: hw, dy: hh },   { dx: -hw, dy: hh },
        ].map(c => ({
          x: cx + c.dx * cosR - c.dy * sinR,
          y: cy + c.dx * sinR + c.dy * cosR,
          ldx: c.dx, ldy: c.dy,
        }))
        let nearest = corners[0], bestDist = Infinity
        corners.forEach(c => {
          const d = Math.hypot(c.x - pivot.x, c.y - pivot.y)
          if (d < bestDist) { bestDist = d; nearest = c }
        })
        const nhw = newW / 2, nhh = newH / 2
        const newLdx = Math.sign(nearest.ldx) * nhw
        const newLdy = Math.sign(nearest.ldy) * nhh
        const newCornerX = cx + newLdx * cosR - newLdy * sinR
        const newCornerY = cy + newLdx * sinR + newLdy * cosR
        const newCx = cx + (nearest.x - newCornerX)
        const newCy = cy + (nearest.y - newCornerY)
        return { ...panel, width: newW, height: newH, widthCm: newWidthCm, heightCm: newHeightCm, x: newCx - newW / 2, y: newCy - newH / 2 }
      }
      return { ...panel, width: newW, height: newH, widthCm: newWidthCm, heightCm: newHeightCm, x: cx - newW / 2, y: cy - newH / 2 }
    })
    setPanels(newPanels)
    rebuildPanelGrid?.(newPanels)
  }

  // Toggle one line's orientation and regenerate the area with the new layout
  const toggleLineOrientation = (lineIdx) => {
    if (!selectedRow?.length || !cmPerPixel) return
    const areaKey = getAreaKey(selectedRow[0])
    const area = rectAreas[areaKey]
    if (!area?.vertices?.length) return

    // Derive current orientations from panels
    const rowMap = new Map()
    selectedRow.forEach(p => { if (!rowMap.has(p.row ?? 0)) rowMap.set(p.row ?? 0, p) })
    const sortedLines = [...rowMap.keys()].sort((a, b) => a - b)
    const currentOrients = sortedLines.map(r => {
      const p = rowMap.get(r)
      return p.heightCm > p.widthCm ? PANEL_V : PANEL_H
    })

    // Toggle the target line
    const targetPos = sortedLines.indexOf(lineIdx)
    if (targetPos < 0) return
    currentOrients[targetPos] = currentOrients[targetPos] === PANEL_V ? PANEL_H : PANEL_V

    // Store preferred orientations on the area so all recompute paths use them
    setRectAreas(prev => prev.map((a, i) => i === areaKey ? { ...a, preferredOrientations: currentOrients } : a))
    const updatedArea = { ...area, preferredOrientations: currentOrients }

    // Regenerate panels for this area with new orientations. preferredOrientations
    // is a hard cap on the row count — toggling orientation never adds rows.
    // Each row gets at least one panel (forced via computePolygonPanels), so
    // the line count always matches currentOrients even when an H panel
    // overflows the bbox.
    const newComputed = computePolygonPanels(updatedArea, cmPerPixel, panelSpec, appDefaults?.panelGapCm, currentOrients)
    if (!newComputed.length) return

    // Full reset: remove ALL existing panels for this area and clear deleted-panel history
    clearDeletedPanelsForArea?.(areaKey)
    const otherPanels = panels.filter(p => p.area !== areaKey)
    const maxId = Math.max(0, ...panels.map(p => p.id))
    const regenerated = newComputed.map((p, i) => ({
      ...p,
      id: maxId + 1 + i,
      area: areaKey,
      areaGroupKey: areaKey,
      panelRowIdx: area.rowIndex ?? 0,
    }))
    const newPanels = [...otherPanels, ...regenerated]
    setPanels(newPanels)
    rebuildPanelGrid?.(newPanels)
  }

  const nudgeRow = (alongCm, acrossCm) => {
    if (!selectedPanels.length) return
    const ratio = refinedArea?.pixelToCmRatio
    if (!ratio || ratio <= 0) return
    const firstPanel = panels.find(p => selectedPanels.includes(p.id))
    const areaIdx = firstPanel?.area ?? 0
    const rotDeg = rectAreas[areaIdx]?.rotation ?? 0
    const rotRad = rotDeg * Math.PI / 180
    const cosR = Math.cos(rotRad), sinR = Math.sin(rotRad)
    const dx = (alongCm * cosR - acrossCm * sinR) / ratio
    const dy = (alongCm * sinR + acrossCm * cosR) / ratio
    setPanels(prev => prev.map(p =>
      selectedPanels.includes(p.id) ? { ...p, x: p.x + dx, y: p.y + dy } : p
    ))
  }

  const [pendingAddNextTo, setPendingAddNextTo] = useState(false)
  const [addError, setAddError] = useState(null)

  const addNextToPanel = (anchor) => {
    const angle = (anchor.rotation || 0) * Math.PI / 180
    const dirX = Math.cos(angle), dirY = Math.sin(angle)
    const gapCm = appDefaults?.panelGapCm
    const stepPx = refinedArea?.pixelToCmRatio ? gapCm / refinedArea.pixelToCmRatio : 5
    const anchorCx = anchor.x + anchor.width / 2, anchorCy = anchor.y + anchor.height / 2
    const hw = anchor.width / 2, hh = anchor.height / 2
    const polyCoords = roofPolygon?.coordinates || []

    const noOverlap = (cx, cy) => panels.every(p => {
      if (p.isEmpty || p.id === anchor.id) return true
      const pcx = p.x + p.width / 2, pcy = p.y + p.height / 2
      const dRow = Math.abs((cx - pcx) * dirX + (cy - pcy) * dirY)
      const dPerp = Math.abs(-(cx - pcx) * dirY + (cy - pcy) * dirX)
      return dRow >= (hw + p.width / 2) || dPerp >= (hh + p.height / 2)
    })

    // Try right first, then left — exact panel gap in each time
    let finalCx = null, finalCy = null
    for (const dir of [1, -1]) {
      const cx = anchorCx + dir * (anchor.width + stepPx) * dirX
      const cy = anchorCy + dir * (anchor.width + stepPx) * dirY
      if (panelInsideRoof(cx, cy, hw, hh, anchor.rotation || 0, polyCoords) && noOverlap(cx, cy)) {
        finalCx = cx; finalCy = cy; break
      }
    }
    if (finalCx === null) { setAddError('No free space found on either side'); setPendingAddNextTo(false); return }

    const newId = panels.length > 0 ? Math.max(...panels.map(p => p.id)) + 1 : 1
    const areaKey = (anchor.area ?? anchor.row) !== undefined ? (anchor.area ?? anchor.row) : `m_${anchor.id}`
    const newPanel = { ...anchor, id: newId, area: areaKey, isEmpty: false, x: finalCx - hw, y: finalCy - hh }
    setPanels(prev => [...prev, newPanel])
    setSelectedPanels([newId])
    setAddError(null)
    setPendingAddNextTo(false)
  }

  // ── Per-trapezoid config ──────────────────────────────────────────────────────

  const getAreaKey = (panel) =>
    (panel.area ?? panel.row) !== undefined ? (panel.area ?? panel.row) : `manual_${panel.id}`

  // Auto-derive lineOrientations from panel rows.
  // Must be after selectedRow and getAreaKey are defined.
  const defaultTrapId = selectedRow
    ? `${rectAreas[getAreaKey(selectedRow[0])]?.label ?? String.fromCharCode(65 + getAreaKey(selectedRow[0]))}`
    : null

  const selectedTrapezoidId = trapIdOverride ?? (
    selectedPanels.length > 0
      ? (panels.find(p => p.id === selectedPanels[0])?.trapezoidId || defaultTrapId)
      : null
  )

  // Pre-compute stable primitives for the auto-derive effect deps
  const _areaKey = selectedRow ? getAreaKey(selectedRow[0]) : null
  const _frontH = _areaKey !== null ? (parseFloat(rectAreas[_areaKey]?.frontHeight) || 0) : 0
  const _angle  = _areaKey !== null ? (parseFloat(rectAreas[_areaKey]?.angle)       || 0) : 0

  useEffect(() => {
    if (!selectedRow || !selectedTrapezoidId) return

    // Auto-split areas have their trapezoid configs set by computePanels (which includes
    // empty orientations for ghost rows). Don't overwrite them here.
    const areaKey = getAreaKey(selectedRow[0])
    if (!rectAreas[areaKey]?.manualTrapezoids) return

    const rowMap = new Map()
    selectedRow.forEach(p => {
      const r = p.row ?? 0
      if (!rowMap.has(r)) rowMap.set(r, p)
    })
    const sortedRows = [...rowMap.entries()].sort(([a], [b]) => Number(a) - Number(b))
    if (sortedRows.length === 0) return

    const autoOrients = sortedRows.map(([, p]) =>
      p.heightCm > p.widthCm ? PANEL_V : PANEL_H
    )
    // Explicit empty-string check — '0' is a real user choice, must not fall
    // back to the global default via `||`.
    const fH = parseFloat((rectAreas[areaKey]?.frontHeight !== '' && rectAreas[areaKey]?.frontHeight != null) ? rectAreas[areaKey].frontHeight : panelFrontHeight) || 0
    const a  = parseFloat((rectAreas[areaKey]?.angle       !== '' && rectAreas[areaKey]?.angle       != null) ? rectAreas[areaKey].angle       : panelAngle)       || 0

    const current = trapezoidConfigs?.[selectedTrapezoidId] || {}
    if (
      JSON.stringify(current.lineOrientations) === JSON.stringify(autoOrients) &&
      current.angle === a &&
      current.frontHeight === fH
    ) return

    const bH = parseFloat(computePanelBackHeight(fH, a, autoOrients, appDefaults?.lineGapCm, panelSpec.lengthCm, panelSpec.widthCm).toFixed(1))

    setTrapezoidConfigs(prev => ({
      ...prev,
      [selectedTrapezoidId]: { ...current, lineOrientations: autoOrients, backHeight: bH, angle: a, frontHeight: fH },
    }))
  }, [selectedRow, selectedTrapezoidId, _frontH, _angle]) // eslint-disable-line react-hooks/exhaustive-deps

  const areaLabel = (areaKey, i) => {
    const g = rectAreas[areaKey]?.label
    return g ? `${g}` : `Area ${i + 1}`
  }
  const selectedAreaLabel = selectedRowIndex !== null ? areaLabel(getAreaKey(selectedRow[0]), selectedRowIndex) : '?'

  // ── Trapezoid management ──────────────────────────────────────────────────────

  const areaTrapezoidMap = useMemo(() => {
    const map = {}
    panels.forEach(p => {
      const aKey = p.area ?? p.row
      if (aKey === undefined || aKey === null) return
      // Tiles panels have trapezoidId=null (no construction frame) → skip.
      if (!p.trapezoidId) return
      if (!map[aKey]) map[aKey] = new Set()
      map[aKey].add(p.trapezoidId)
    })
    const result = {};
    (Object.entries(map) as [string, Set<string>][]).forEach(([k, s]) => { result[k] = [...s].sort() })
    return result
  }, [panels, rectAreas])

  const sharedTrapIds = useMemo(() => {
    // A trap is "shared" only if it appears in ≥ 2 distinct area GROUPS
    // (areaGroupId). Multi-row areas have multiple rectArea indices sharing
    // one areaGroupId — traps spanning rows of the same area should NOT be
    // marked as shared.
    const trapToGroups = {};
    (Object.entries(areaTrapezoidMap) as [string, string[]][]).forEach(([areaKey, trapIds]) => {
      const groupId = rectAreas[areaKey]?.areaGroupId ?? areaKey
      trapIds.forEach(trapId => {
        if (!trapToGroups[trapId]) trapToGroups[trapId] = new Set()
        trapToGroups[trapId].add(groupId)
      })
    })
    const shared = new Set();
    (Object.entries(trapToGroups) as [string, Set<any>][]).forEach(([trapId, groups]) => {
      if (groups.size > 1) shared.add(trapId)
    })
    return shared
  }, [areaTrapezoidMap, rectAreas])

  const resetTrapezoidConfig = () => {
    if (!selectedTrapezoidId) return
    setTrapezoidConfigs(prev => {
      const next = { ...prev }
      delete next[selectedTrapezoidId]
      return next
    })
    if (!refinedArea?.pixelToCmRatio) {
      // reset angle/frontH back to global defaults
      if (selectedRow && setRectAreas) {
        const aKey = getAreaKey(selectedRow[0])
        if (aKey !== null) {
          setRectAreas(prev => prev.map((a, i) => i === aKey
            ? { ...a, angle: String(parseFloat(panelAngle) || 0), frontHeight: String(parseFloat(panelFrontHeight) || 0) }
            : a
          ))
        }
      }
      return
    }
    const globalAngle = refinedArea?.panelConfig?.angle || 0
    const angleRad = globalAngle * Math.PI / 180
    const rowIds = selectedRow.map(p => p.id)
    setPanels(prev => prev.map(p => {
      if (!rowIds.includes(p.id)) return p
      const depthCm = p.heightCm
      const newH = (depthCm * Math.cos(angleRad)) / refinedArea.pixelToCmRatio
      const cy = p.y + p.height / 2
      return { ...p, height: newH, y: cy - newH / 2 }
    }))
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="step-content-area" style={{ position: 'relative' }}>
        {uploadedImageData ? (
          <PanelCanvas
            uploadedImageData={uploadedImageData}
            imageSrc={imageSrc}
            viewZoom={viewZoom} setViewZoom={setViewZoom}
            imageRef={imageRef} setImageRef={setImageRef}
            roofPolygon={roofPolygon}
            baseline={baseline} setBaseline={setBaseline}
            panels={panels} setPanels={setPanels}
            selectedPanels={selectedPanels} setSelectedPanels={setSelectedPanels}
            dragState={dragState} setDragState={setDragState}
            rotationState={rotationState} setRotationState={setRotationState}
            distanceMeasurement={distanceMeasurement} setDistanceMeasurement={setDistanceMeasurement}
            showBaseline={showBaseline} showDistances={showDistances}
            showHGridlines={showHGridlines} showVGridlines={showVGridlines}
            snapToGridlines={snapToGridlines}
            refinedArea={refinedArea}
            activeTool={activeTool}
            pendingAddNextTo={pendingAddNextTo} onAddNextToPanel={addNextToPanel} setPendingAddNextTo={setPendingAddNextTo}
            rectAreas={rectAreas}
            setRectAreas={setRectAreas}
            onAddRectArea={handleAddRectArea}
            onDeleteArea={handleDeleteArea}
            cmPerPixel={cmPerPixel}
            panelSpec={panelSpec}
            rebuildPanelGrid={rebuildPanelGrid}
            recordPanelDeletion={recordPanelDeletion}
            panelGapCm={appDefaults?.panelGapCm}
            drawVertical={drawVertical}
            roofAxis={roofAxis}
            setRoofAxis={setRoofAxis}
            roofAxisEnabled={roofAxisEnabled}
            togglePanelOrientation={togglePanelOrientation}
          />
        ) : (
          <div className="step-content">
            <div className="step-placeholder">
              <h2>No Configuration Data</h2>
              <p>Please complete Steps 1 and 2 first.</p>
            </div>
          </div>
        )}

        {/* ── LEFT PANEL ──────────────────────────────────────────────────────── */}
        {uploadedImageData && (
          <RowSidebar
            baseline={baseline} setBaseline={setBaseline}
            panels={panels}
            selectedPanels={selectedPanels} setSelectedPanels={setSelectedPanels}
            setTrapIdOverride={setTrapIdOverride}
            rows={rows}
            areaGroups={areaGroups}
            areaLabel={areaLabel} getAreaKey={getAreaKey}
            onMergeRowIntoArea={(rowAreaIdx, targetGroupId) => {
              setRectAreas(prev => {
                const targetRows = prev.filter(a => a.areaGroupId === targetGroupId)
                const targetArea = targetRows[0]
                const nextRowIndex = targetRows.length
                return prev.map((a, idx) => {
                  if (idx !== rowAreaIdx) return a
                  return {
                    ...a,
                    areaGroupId: targetGroupId,
                    label: targetArea?.label ?? targetGroupId,
                    rowIndex: nextRowIndex,
                    angle: targetArea?.angle ?? a.angle,
                    frontHeight: targetArea?.frontHeight ?? a.frontHeight,
                    color: targetArea?.color ?? a.color,
                    // Merged row inherits the target area's roof spec
                    roofSpec: targetArea?.roofSpec ?? a.roofSpec ?? null,
                  }
                })
              })
            }}
            onDetachRowToNewArea={() => {
              // Opposite of group: take the single selected row out of its
              // multi-row area and give it its own areaGroupId + label.
              const selectedAreaIdxs = [...new Set(
                panels.filter(p => selectedPanels.includes(p.id)).map(p => p.area)
              )] as any[]
              if (selectedAreaIdxs.length !== 1) return
              const rowAreaIdx = selectedAreaIdxs[0]
              setRectAreas(prev => {
                const row = prev[rowAreaIdx]
                if (!row) return prev
                // Only meaningful when the parent group has ≥ 2 rows
                const siblings = prev.filter(a => a.areaGroupId === row.areaGroupId)
                if (siblings.length < 2) return prev
                // Next temp groupId = one less than current min (always unique)
                const minGid = Math.min(0, ...prev.map(a => a.areaGroupId ?? 0))
                const newGroupId = minGid - 1
                // Next available single-letter label
                const used = new Set(prev.map(a => a.label).filter(Boolean))
                let newLabel = null
                for (let i = 0; i < 26; i++) {
                  const l = String.fromCharCode(65 + i)
                  if (!used.has(l)) { newLabel = l; break }
                }
                if (!newLabel) newLabel = `A${Date.now() % 1000}`
                return prev.map((a, idx) => {
                  if (idx !== rowAreaIdx) return a
                  return {
                    ...a,
                    areaGroupId: newGroupId,
                    label: newLabel,
                    rowIndex: 0,
                  }
                })
              })
            }}
            onGroupSelectedRowsIntoArea={() => {
              // Take every rectArea index that owns at least one selected panel
              // and re-point all of them to a single areaGroupId (the first
              // one in document order "wins"). Preserves each row's own a/h.
              const selectedAreaIdxs = new Set(
                panels
                  .filter(p => selectedPanels.includes(p.id))
                  .map(p => p.area)
              )
              if (selectedAreaIdxs.size < 2) return
              setRectAreas(prev => {
                const groupIds = [...new Set(
                  ([...selectedAreaIdxs] as any[])
                    .map(i => prev[i]?.areaGroupId)
                    .filter(g => g != null)
                )] as any[]
                if (groupIds.length < 2) return prev  // already one group
                const targetGroupId = groupIds[0]
                const targetArea = prev.find(a => a.areaGroupId === targetGroupId)
                const targetLabel = targetArea?.label ?? String(targetGroupId)
                let nextRowIndex = prev.filter(a => a.areaGroupId === targetGroupId).length
                return prev.map((a, idx) => {
                  if (!selectedAreaIdxs.has(idx)) return a
                  if (a.areaGroupId === targetGroupId) return a
                  const updated = {
                    ...a,
                    areaGroupId: targetGroupId,
                    label: targetLabel,
                    rowIndex: nextRowIndex,
                    color: targetArea?.color ?? a.color,
                    // Grouped rows inherit the target area's roof spec
                    roofSpec: targetArea?.roofSpec ?? a.roofSpec ?? null,
                  }
                  nextRowIndex++
                  return updated
                })
              })
            }}
            areaTrapezoidMap={areaTrapezoidMap} sharedTrapIds={sharedTrapIds}
            trapezoidConfigs={trapezoidConfigs}
            rectAreas={rectAreas}
            setRectAreas={setRectAreas}
            panelTypes={panelTypes}
            panelType={panelType}
            setPanelType={setPanelType}
            panelFrontHeight={panelFrontHeight}
            setPanelFrontHeight={setPanelFrontHeight}
            panelAngle={panelAngle}
            setPanelAngle={setPanelAngle}
            selectedRow={selectedRow}
            selectedTrapezoidId={selectedTrapezoidId}
            trapIdOverride={trapIdOverride}
            selectedAreaLabel={selectedAreaLabel}
            refinedArea={refinedArea}
            resetTrapezoidConfig={resetTrapezoidConfig}
            panelGapCm={appDefaults?.panelGapCm}
            lineGapCm={appDefaults?.lineGapCm}
            onLineOrientationToggle={toggleLineOrientation}
            showMounting={showMounting}
            angleMin={angLim.min}
            angleMax={angLim.max}
            frontHeightMin={fhLim.min}
            frontHeightMax={fhLim.max}
            roofType={roofType}
            rowMounting={rowMounting}
            setRowMounting={setRowMounting}
          />
        )}

        {/* ── RIGHT PANEL ─────────────────────────────────────────────────────── */}
        {uploadedImageData && (
          <ToolPanel
            activeTool={activeTool} handleToolChange={handleToolChange}
            selectedPanels={selectedPanels}
            nudgeRow={nudgeRow}
            addManualPanel={() => { if (!addManualPanel()) setAddError('No valid position found inside roof') }}
            pendingAddNextTo={pendingAddNextTo} setPendingAddNextTo={setPendingAddNextTo}
            addError={addError} setAddError={setAddError}
            distanceMeasurement={distanceMeasurement} setDistanceMeasurement={setDistanceMeasurement}
            showHGridlines={showHGridlines} setShowHGridlines={setShowHGridlines}
            showVGridlines={showVGridlines} setShowVGridlines={setShowVGridlines}
            snapToGridlines={snapToGridlines} setSnapToGridlines={setSnapToGridlines}
            yLocked={allYLocked} onToggleYLock={handleToggleYLock} hasAreas={rectAreas.length > 0}
            drawVertical={drawVertical} onToggleDrawVertical={() => setDrawVertical(v => !v)}
            onSetEditMode={handleSetEditMode}
            editMode={editMode}
            selectedAreaIdx={selectedAreaIdx}
            selectedAreaLabel={typeof selectedAreaIdx === 'number' ? (rectAreas[selectedAreaIdx]?.label || String(selectedAreaIdx)) : null}
            onDeleteArea={handleDeleteArea}
            onResetArea={regenerateSingleRowHandler}
            onRotateArea90={handleRotateArea90}
            addRowToGroup={addRowToGroup}
            onAddRowToArea={() => {
              if (selectedAreaIdx == null) return
              const area = rectAreas[selectedAreaIdx]
              const groupId = area?.areaGroupId
              if (groupId) {
                setAddRowToGroup(groupId)
                setActiveTool('area')  // switch to area draw mode
              }
            }}
            onCancelAddRow={() => setAddRowToGroup(null)}
            roofAxisEnabled={roofAxisEnabled}
            setRoofAxisEnabled={setRoofAxisEnabled}
            roofAxis={roofAxis}
            setRoofAxis={setRoofAxis}
            hasRotations={hasVoidAreas(panels)}
            onRecalcRows={handleRecalcRows}
          />
        )}
      </div>
    </>
  )
}
