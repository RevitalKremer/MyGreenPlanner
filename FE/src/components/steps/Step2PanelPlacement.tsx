import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import {
  computePanelBackHeight,
} from '../../utils/trapezoidGeometry'
import { panelInsideRoof } from '../../utils/panelUtils'
import { computePolygonPanels } from '../../utils/rectPanelService'
import { PANEL_V, PANEL_H } from '../../utils/panelCodes'
import { allAreasTiles } from '../../utils/roofSpecUtils'
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
  appDefaults,
  paramLimits = {} as Record<string, any>,
  roofType,
  rowMounting,
  setRowMounting,
  areas = null,
  setAreas = null,
}) {
  const angLim = paramLimits.mountingAngleDeg
  const fhLim  = paramLimits.frontHeightCm
  // Mounting section hidden only for fully-tiles projects (no construction frame).
  // Mixed projects show mounting — per-area tiles hiding is handled in the sidebar.
  const showMounting = !allAreasTiles(roofType, [])
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

  // ── Auto-recalc trapezoids with 1s debounce ──
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
        }, 1000)
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

  const handleAddRectArea = useCallback((area) => {
    pendingNewAreaIdxRef.current = rectAreas.length
    const isAllLocked = rectAreas.length > 0 && rectAreas.every(a => a.mode === 'ylocked')
    const groupId = addRowToGroup
    onAddRectArea?.({ ...area, mode: isAllLocked ? 'ylocked' : 'free' }, groupId)
    if (groupId) setAddRowToGroup(null)  // reset after use
  }, [rectAreas, onAddRectArea, addRowToGroup])

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
    // put. Keep `rotation` as-is so the effective rotation
    // `(areaVertical?90:0)+rotation` follows the vertex change in lockstep —
    // toggling areaVertical contributes the +90°.
    const pivot = area.vertices[area.pivotIdx ?? 0]
    const cosR = Math.cos(Math.PI / 2), sinR = Math.sin(Math.PI / 2)
    const newVertices = area.vertices.map(v => ({
      x: pivot.x + (v.x - pivot.x) * cosR - (v.y - pivot.y) * sinR,
      y: pivot.y + (v.x - pivot.x) * sinR + (v.y - pivot.y) * cosR,
    }))
    const updatedArea = { ...area, vertices: newVertices, areaVertical: !(area.areaVertical ?? false) }

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
    // Update editMode only for tools that own a tab. The ruler ('measure')
    // is an overlay — it must not flip the Area/Panels tab.
    if (tool === 'area') setEditMode('area')
    else if (tool !== 'measure') setEditMode('panel')
    if (!keepSelection) setSelectedPanels([])
    setPendingAddNextTo(false)
    setAddError(null)
    if (tool === 'measure') setShowDistances(true)
  }

  const handleSetEditMode = (mode) => {
    if (mode === 'area') handleToolChange('area')
    else handleToolChange('move')
  }

  const togglePanelOrientation = () => {
    if (!selectedPanels.length) return
    // Find the area's pivot (start corner) to anchor the rotation
    const firstSel = panels.find(p => selectedPanels.includes(p.id))
    const areaIdx = firstSel?.area ?? 0
    const area = rectAreas[areaIdx]
    const pivot = area?.vertices?.[area?.pivotIdx ?? 0]
    const newPanels = panels.map(panel => {
      if (!selectedPanels.includes(panel.id)) return panel
      const cx = panel.x + panel.width / 2, cy = panel.y + panel.height / 2
      const newW = panel.height, newH = panel.width
      const isCurrentlyPortrait = (panel.heightCm ?? panelSpec.lengthCm) > (panelSpec.lengthCm + panelSpec.widthCm) / 2
      const newHeightCm = isCurrentlyPortrait ? panelSpec.widthCm : panelSpec.lengthCm
      if (pivot) {
        // Anchor to the start corner: find the panel's rotated corner nearest to pivot
        const r = (panel.rotation || 0) * Math.PI / 180
        const cosR = Math.cos(r), sinR = Math.sin(r)
        const hw = panel.width / 2, hh = panel.height / 2
        // 4 corners of the panel in screen space (rotated around cx,cy)
        const corners = [
          { dx: -hw, dy: -hh }, { dx: hw, dy: -hh },
          { dx: hw, dy: hh },   { dx: -hw, dy: hh },
        ].map(c => ({
          x: cx + c.dx * cosR - c.dy * sinR,
          y: cy + c.dx * sinR + c.dy * cosR,
          ldx: c.dx, ldy: c.dy,
        }))
        // Find corner nearest to pivot
        let nearest = corners[0], bestDist = Infinity
        corners.forEach(c => {
          const d = Math.hypot(c.x - pivot.x, c.y - pivot.y)
          if (d < bestDist) { bestDist = d; nearest = c }
        })
        // After swap: the same local corner position but with swapped half-dims
        const nhw = newW / 2, nhh = newH / 2
        const newLdx = Math.sign(nearest.ldx) * nhw
        const newLdy = Math.sign(nearest.ldy) * nhh
        // New corner position in screen space
        const newCornerX = cx + newLdx * cosR - newLdy * sinR
        const newCornerY = cy + newLdx * sinR + newLdy * cosR
        // Shift center so the nearest corner stays at the same screen position
        const newCx = cx + (nearest.x - newCornerX)
        const newCy = cy + (nearest.y - newCornerY)
        return { ...panel, width: newW, height: newH, heightCm: newHeightCm, x: newCx - newW / 2, y: newCy - newH / 2 }
      }
      return { ...panel, width: newW, height: newH, heightCm: newHeightCm, x: cx - newW / 2, y: cy - newH / 2 }
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
    const fH = parseFloat(rectAreas[areaKey]?.frontHeight) || parseFloat(panelFrontHeight) || 0
    const a  = parseFloat(rectAreas[areaKey]?.angle)       || parseFloat(panelAngle)       || 0

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
            cmPerPixel={cmPerPixel}
            panelSpec={panelSpec}
            rebuildPanelGrid={rebuildPanelGrid}
            recordPanelDeletion={recordPanelDeletion}
            panelGapCm={appDefaults?.panelGapCm}
            drawVertical={drawVertical}
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
            nudgeRow={nudgeRow} togglePanelOrientation={togglePanelOrientation}
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
          />
        )}
      </div>
    </>
  )
}
