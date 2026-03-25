import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import {
  computePanelBackHeight,
} from '../../utils/trapezoidGeometry'
import { panelInsideRoof } from '../../utils/panelUtils'
import { PANEL_TYPES, DEFAULT_PANEL_TYPE } from '../../data/panelTypes'
import RowSidebar from './step3/RowSidebar'
import ToolPanel from './step3/ToolPanel'
import PanelCanvas from './step3/PanelCanvas'

export default function Step3PanelPlacement({
  projectMode = 'scratch',
  uploadedImageData,
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
  generatePanelLayoutHandler,
  regeneratePlanPanelsHandler,
  regenerateSingleRowHandler,
  areas = [],
  setAreas,
  addManualPanel,
  trapezoidConfigs,
  setTrapezoidConfigs,
  rectAreas = [],
  setRectAreas,
  onAddRectArea,
  cmPerPixel,
  panelType,
  setPanelType,
  panelFrontHeight,
  setPanelFrontHeight,
  panelAngle,
  setPanelAngle,
}) {
  const panelSpec = PANEL_TYPES.find(t => t.id === panelType) ?? DEFAULT_PANEL_TYPE
  const [activeTool, setActiveTool] = useState(projectMode === 'scratch' ? 'draw' : 'move')
  const [trapIdOverride, setTrapIdOverride] = useState(null)
  const [showHGridlines, setShowHGridlines] = useState(false)
  const [showVGridlines, setShowVGridlines] = useState(false)
  const [snapToGridlines, setSnapToGridlines] = useState(false)

  // Clear trapezoid override whenever selection changes
  useEffect(() => {
    setTrapIdOverride(null)
  }, [selectedPanels])

  // Track newly drawn area index so we can select it once panels are computed
  const pendingNewAreaIdxRef = useRef(null)
  // Stable area index — survives panel ID changes across recomputes
  const selectedAreaIdxRef = useRef(null)

  const handleAddRectArea = useCallback((area) => {
    pendingNewAreaIdxRef.current = rectAreas.length
    onAddRectArea?.(area)
  }, [rectAreas.length, onAddRectArea])

  const handleDeleteArea = useCallback((areaKey) => {
    // After deletion, indices shift: next area lands at same index, or previous if it was last
    const nextIdx = areaKey < rectAreas.length - 1 ? areaKey : areaKey - 1
    selectedAreaIdxRef.current = nextIdx >= 0 ? nextIdx : null
    setPanels(prev => prev.filter(p => (p.area ?? p.row) !== areaKey))
    setRectAreas(prev => prev.filter((_, idx) => idx !== areaKey))
    setSelectedPanels([])
  }, [rectAreas.length, setPanels, setRectAreas, setSelectedPanels])

  // Keep selectedAreaIdxRef in sync whenever selectedPanels changes (panels are still fresh here)
  useEffect(() => {
    if (selectedPanels.length === 0) { selectedAreaIdxRef.current = null; return }
    const found = panels.find(p => selectedPanels.includes(p.id))
    if (found != null) selectedAreaIdxRef.current = found.area ?? null
  }, [selectedPanels])

  // Re-sync selectedPanels after panels recompute (IDs change but area index is stable)
  useEffect(() => {
    if (projectMode !== 'scratch' || panels.length === 0) return

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

    // Re-derive selectedPanels from the stable area index
    if (selectedAreaIdxRef.current !== null) {
      const areaPanels = panels.filter(p => p.area === selectedAreaIdxRef.current).map(p => p.id)
      if (areaPanels.length > 0) {
        setSelectedPanels(prev => {
          // If all selected panels still exist (e.g. after a move drag), keep exact selection
          if (prev.length > 0 && prev.every(id => areaPanels.includes(id))) return prev
          // Otherwise panels were recomputed with new IDs — re-sync to full area
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
  }, [panels, projectMode])

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
        // Scratch mode: rect areas are already one group — never sub-split
        if (projectMode === 'scratch') { result.push(rowPanels); return }

        const isMultiLine = rowPanels.some(p => p.line !== undefined && p.line > 0)
        if (rowPanels.length <= 1 || isMultiLine) { result.push(rowPanels); return }

        const angle = (rowPanels[0].rotation || 0) * Math.PI / 180
        const dirX = Math.cos(angle), dirY = Math.sin(angle)
        const sorted = [...rowPanels].sort((a, b) => {
          const aCx = a.x + a.width / 2, aCy = a.y + a.height / 2
          const bCx = b.x + b.width / 2, bCy = b.y + b.height / 2
          return (aCx * dirX + aCy * dirY) - (bCx * dirX + bCy * dirY)
        })
        const GAP_THRESHOLD = sorted[0].width * 1.5
        const subGroups = [[sorted[0]]]
        for (let i = 1; i < sorted.length; i++) {
          const prev = sorted[i - 1], curr = sorted[i]
          const dx = (curr.x + curr.width / 2) - (prev.x + prev.width / 2)
          const dy = (curr.y + curr.height / 2) - (prev.y + prev.height / 2)
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist > GAP_THRESHOLD) subGroups.push([curr])
          else subGroups[subGroups.length - 1].push(curr)
        }
        subGroups.forEach(g => result.push(g))
      })

    return result
  }, [panels, projectMode])

  const panelToRowMap = useMemo(() => {
    const map = new Map()
    rows.forEach((row, i) => row.forEach(p => map.set(p.id, i)))
    return map
  }, [rows])

  const selectedRowIndex = selectedPanels.length > 0
    ? (panelToRowMap.get(selectedPanels[0]) ?? null)
    : null

  const selectedRow = (selectedRowIndex !== null) ? rows[selectedRowIndex] : null

  // ── Tool helpers ─────────────────────────────────────────────────────────────

  const handleToolChange = (tool) => {
    const keepSelection = (tool === 'move' || tool === 'rotate') &&
                          (activeTool === 'move' || activeTool === 'rotate')
    setActiveTool(tool)
    if (!keepSelection) setSelectedPanels([])
    setPendingAddNextTo(false)
    setAddError(null)
    if (tool === 'measure') setShowDistances(true)
  }

  const togglePanelOrientation = () => {
    if (!selectedPanels.length) return
    setPanels(prev => prev.map(panel => {
      if (!selectedPanels.includes(panel.id)) return panel
      const cx = panel.x + panel.width / 2
      const cy = panel.y + panel.height / 2
      const newW = panel.height
      const newH = panel.width
      const isCurrentlyPortrait = (panel.heightCm ?? panelSpec.lengthCm) > (panelSpec.lengthCm + panelSpec.widthCm) / 2
      const newHeightCm = isCurrentlyPortrait ? panelSpec.widthCm : panelSpec.lengthCm
      return {
        ...panel,
        width: newW,
        height: newH,
        heightCm: newHeightCm,
        x: cx - newW / 2,
        y: cy - newH / 2,
      }
    }))
  }

  const nudgeRow = (dx, dy) => {
    setPanels(prev => prev.map(p =>
      selectedPanels.includes(p.id) ? { ...p, x: p.x + dx, y: p.y + dy } : p
    ))
  }

  const [pendingAddNextTo, setPendingAddNextTo] = useState(false)
  const [addError, setAddError] = useState(null)

  const addNextToPanel = (anchor) => {
    const angle = (anchor.rotation || 0) * Math.PI / 180
    const dirX = Math.cos(angle), dirY = Math.sin(angle)
    const stepPx = refinedArea?.pixelToCmRatio ? 2.5 / refinedArea.pixelToCmRatio : 5
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

    // Try right first, then left — exactly 2.5 cm gap each time
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

  // Auto-derive linesPerRow + lineOrientations from panel rows (scratch mode only).
  // Must be after selectedRow and getAreaKey are defined.
  const defaultScratchTrapId = projectMode === 'scratch' && selectedRow
    ? `${rectAreas[getAreaKey(selectedRow[0])]?.label ?? String.fromCharCode(65 + getAreaKey(selectedRow[0]))}1`
    : null

  const selectedTrapezoidId = trapIdOverride ?? (
    selectedPanels.length > 0
      ? (panels.find(p => p.id === selectedPanels[0])?.trapezoidId || defaultScratchTrapId)
      : null
  )

  // Pre-compute stable primitives for the auto-derive effect deps
  const _scratchAreaKey = projectMode === 'scratch' && selectedRow ? getAreaKey(selectedRow[0]) : null
  const _scratchFH = _scratchAreaKey !== null ? (parseFloat(rectAreas[_scratchAreaKey]?.frontHeight) || 0) : 0
  const _scratchAngle = _scratchAreaKey !== null ? (parseFloat(rectAreas[_scratchAreaKey]?.angle) || 0) : 0

  useEffect(() => {
    if (projectMode !== 'scratch' || !selectedRow || !selectedTrapezoidId) return

    const rowMap = new Map()
    selectedRow.forEach(p => {
      const r = p.row ?? 0
      if (!rowMap.has(r)) rowMap.set(r, p)
    })
    const sortedRows = [...rowMap.entries()].sort(([a], [b]) => Number(a) - Number(b))
    if (sortedRows.length === 0) return

    const autoOrients = sortedRows.map(([, p]) =>
      (p.heightCm ?? 238.2) > 150 ? 'vertical' : 'horizontal'
    )
    const autoLPR = sortedRows.length

    // Source of truth for angle/frontH is rectAreas[areaKey], fall back to global defaults
    const areaKey = getAreaKey(selectedRow[0])
    const fH = parseFloat(rectAreas[areaKey]?.frontHeight) || parseFloat(panelFrontHeight) || 0
    const a  = parseFloat(rectAreas[areaKey]?.angle)       || parseFloat(panelAngle)       || 0

    const current = trapezoidConfigs?.[selectedTrapezoidId] || {}
    if (
      current.linesPerRow === autoLPR &&
      JSON.stringify(current.lineOrientations) === JSON.stringify(autoOrients) &&
      current.angle === a &&
      current.frontHeight === fH
    ) return

    const bH = parseFloat(computePanelBackHeight(fH, a, autoOrients, autoLPR).toFixed(1))

    setTrapezoidConfigs(prev => ({
      ...prev,
      [selectedTrapezoidId]: { ...current, linesPerRow: autoLPR, lineOrientations: autoOrients, backHeight: bH, angle: a, frontHeight: fH },
    }))
  }, [selectedRow, selectedTrapezoidId, projectMode, _scratchFH, _scratchAngle]) // eslint-disable-line react-hooks/exhaustive-deps

  const areaLabel = (areaKey, i) => {
    const g = areas[areaKey]?.label
    return g ? `${g}` : `Area ${i + 1}`
  }
  const selectedAreaLabel = selectedRowIndex !== null ? areaLabel(getAreaKey(selectedRow[0]), selectedRowIndex) : '?'

  // ── Trapezoid management ──────────────────────────────────────────────────────

  const areaTrapezoidMap = useMemo(() => {
    const map = {}
    panels.forEach(p => {
      const aKey = p.area ?? p.row
      if (aKey === undefined || aKey === null) return
      const defaultTrapId = projectMode === 'scratch'
        ? `${rectAreas[aKey]?.label ?? String.fromCharCode(65 + aKey)}1`
        : 'A1'
      const tId = p.trapezoidId || defaultTrapId
      if (!map[aKey]) map[aKey] = new Set()
      map[aKey].add(tId)
    })
    const result = {}
    Object.entries(map).forEach(([k, s]) => { result[k] = [...s].sort() })
    return result
  }, [panels, projectMode, rectAreas])

  const allSelectedSameArea = useMemo(() => {
    if (selectedPanels.length === 0) return false
    const sel = panels.filter(p => selectedPanels.includes(p.id))
    const areaKeys = new Set(sel.map(p => p.area ?? p.row ?? null))
    return areaKeys.size === 1
  }, [selectedPanels, panels])

  const selectedAreaTrapIds = useMemo(() => {
    if (!allSelectedSameArea || !selectedRow) return []
    const ak = getAreaKey(selectedRow[0])
    return areaTrapezoidMap[ak] || []
  }, [allSelectedSameArea, selectedRow, areaTrapezoidMap])


  const addTrapezoid = () => {
    if (!allSelectedSameArea || !selectedRow) return
    const areaKey = getAreaKey(selectedRow[0])
    const areaIdx = typeof areaKey === 'number' ? areaKey : 0
    const areaPrefix = areas[areaKey]?.label || String.fromCharCode(65 + areaIdx)
    const existingNums = selectedAreaTrapIds
      .map(id => parseInt(id.slice(areaPrefix.length)))
      .filter(n => !isNaN(n))
    const nextNum = Math.max(...existingNums, 0) + 1
    const newTrapId = `${areaPrefix}${nextNum}`
    const sourceConfig = trapezoidConfigs?.[selectedTrapezoidId] || {}
    setTrapezoidConfigs(prev => ({ ...prev, [newTrapId]: { ...sourceConfig } }))
    const selIds = new Set(selectedPanels)
    setPanels(prev => prev.map(p => selIds.has(p.id) ? { ...p, trapezoidId: newTrapId } : p))
    setTrapIdOverride(newTrapId)
  }

  const sharedTrapIds = useMemo(() => {
    const trapToAreas = {}
    Object.entries(areaTrapezoidMap).forEach(([areaKey, trapIds]) => {
      trapIds.forEach(trapId => {
        if (!trapToAreas[trapId]) trapToAreas[trapId] = []
        trapToAreas[trapId].push(areaKey)
      })
    })
    const shared = new Set()
    Object.entries(trapToAreas).forEach(([trapId, areaKeys]) => {
      if (areaKeys.length > 1) shared.add(trapId)
    })
    return shared
  }, [areaTrapezoidMap])

  useEffect(() => {
    if (projectMode === 'scratch') return  // scratch panels are rect-bound; don't auto-split
    if (rows.length === 0 || panels.length === 0) return

    const distinctAreaKeys = new Set()
    panels.forEach(p => {
      const k = p.area ?? p.row
      if (k !== undefined && k !== null) distinctAreaKeys.add(k)
    })

    if (rows.length <= distinctAreaKeys.size) return

    const areaKeyToRows = new Map()
    rows.forEach(row => {
      if (row.length === 0) return
      const aKey = row[0].area ?? row[0].row
      if (!areaKeyToRows.has(aKey)) areaKeyToRows.set(aKey, [])
      areaKeyToRows.get(aKey).push(row)
    })

    let nextAreaKey = Math.max(0, ...[...distinctAreaKeys]) + 1
    const panelUpdates = new Map()

    areaKeyToRows.forEach(rowGroups => {
      if (rowGroups.length <= 1) return
      const seenTrapIds = new Set(rowGroups[0].map(p => p.trapezoidId).filter(Boolean))
      for (let gi = 1; gi < rowGroups.length; gi++) {
        const thisTrapIds = rowGroups[gi].map(p => p.trapezoidId).filter(Boolean)
        // If all panels in this physical subgroup have trapezoidIds not seen in any
        // prior subgroup, they are already distinguished — don't create a new area key.
        const hasOverlap = thisTrapIds.some(t => seenTrapIds.has(t))
        if (!hasOverlap && thisTrapIds.length > 0) {
          thisTrapIds.forEach(t => seenTrapIds.add(t))
          continue
        }
        thisTrapIds.forEach(t => seenTrapIds.add(t))
        const newKey = nextAreaKey++
        rowGroups[gi].forEach(panel => panelUpdates.set(panel.id, newKey))
      }
    })

    if (panelUpdates.size > 0) {
      setPanels(prev => prev.map(p => {
        const newArea = panelUpdates.get(p.id)
        return newArea !== undefined ? { ...p, area: newArea } : p
      }))
    }
  }, [rows.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const reassignToTrapezoid = (trapId) => {
    const selIds = new Set(selectedPanels)
    setPanels(prev => prev.map(p => selIds.has(p.id) ? { ...p, trapezoidId: trapId } : p))
    setTrapIdOverride(trapId)
  }

  const updateTrapezoidConfig = (field, rawValue) => {
    if (!selectedTrapezoidId) return

    const globalCfg = refinedArea?.panelConfig || {
      angle: parseFloat(panelAngle) || 0,
      frontHeight: parseFloat(panelFrontHeight) || 0,
      linesPerRow: 1,
      lineOrientations: ['vertical'],
    }
    const current = trapezoidConfigs[selectedTrapezoidId] || {}

    if (field === 'angle' || field === 'frontHeight') {
      const value = parseFloat(rawValue)
      if (isNaN(value) || value < 0) return
    }

    let newOverride = { ...current, [field]: rawValue }

    const a       = field === 'angle'            ? parseFloat(rawValue)  : (current.angle            ?? globalCfg.angle            ?? 0)
    const fH      = field === 'frontHeight'      ? parseFloat(rawValue)  : (current.frontHeight      ?? globalCfg.frontHeight      ?? 0)
    const lpr     = field === 'linesPerRow'      ? rawValue              : (current.linesPerRow      ?? globalCfg.linesPerRow      ?? 1)
    const orients = field === 'lineOrientations' ? rawValue              : (current.lineOrientations ?? globalCfg.lineOrientations ?? ['vertical'])
    newOverride.backHeight = parseFloat(computePanelBackHeight(fH, a || 0, orients, lpr).toFixed(1))

    if (field === 'angle' || field === 'frontHeight') newOverride[field] = parseFloat(rawValue)

    setTrapezoidConfigs(prev => ({ ...prev, [selectedTrapezoidId]: newOverride }))

    if (field === 'angle' && refinedArea.pixelToCmRatio) {
      const angleVal = newOverride.angle
      if (angleVal !== undefined) {
        const rowIds = selectedRow.map(p => p.id)
        setPanels(prev => prev.map(p => {
          if (!rowIds.includes(p.id)) return p
          const depthCm = p.heightCm || 238.2
          const newH = (depthCm * Math.cos(angleVal * Math.PI / 180)) / refinedArea.pixelToCmRatio
          const cy = p.y + p.height / 2
          return { ...p, height: newH, y: cy - newH / 2 }
        }))
      }
    }
  }

  const resetTrapezoidConfig = () => {
    if (!selectedTrapezoidId) return
    setTrapezoidConfigs(prev => {
      const next = { ...prev }
      delete next[selectedTrapezoidId]
      return next
    })
    if (!refinedArea?.pixelToCmRatio) {
      // scratch mode — reset angle/frontH back to global defaults
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
      const depthCm = p.heightCm || 238.2
      const newH = (depthCm * Math.cos(angleRad)) / refinedArea.pixelToCmRatio
      const cy = p.y + p.height / 2
      return { ...p, height: newH, y: cy - newH / 2 }
    }))
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="step-content-area" style={{ position: 'relative' }}>
        {uploadedImageData && (projectMode === 'plan' || projectMode === 'scratch' || (roofPolygon && refinedArea)) ? (
          <PanelCanvas
            uploadedImageData={uploadedImageData}
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
            activeTool={activeTool} projectMode={projectMode}
            pendingAddNextTo={pendingAddNextTo} onAddNextToPanel={addNextToPanel} setPendingAddNextTo={setPendingAddNextTo}
            rectAreas={rectAreas}
            setRectAreas={setRectAreas}
            onAddRectArea={handleAddRectArea}
            cmPerPixel={cmPerPixel}
            panelSpec={panelSpec}
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
        {uploadedImageData && (projectMode === 'plan' || projectMode === 'scratch' || (roofPolygon && refinedArea)) && (
          <RowSidebar
            projectMode={projectMode}
            baseline={baseline} setBaseline={setBaseline}
            panels={panels} setPanels={setPanels}
            selectedPanels={selectedPanels} setSelectedPanels={setSelectedPanels}
            setTrapIdOverride={setTrapIdOverride}
            rows={rows} areas={areas} setAreas={setAreas}
            areaLabel={areaLabel} getAreaKey={getAreaKey}
            areaTrapezoidMap={areaTrapezoidMap} sharedTrapIds={sharedTrapIds}
            trapezoidConfigs={trapezoidConfigs}
            regenerateSingleRowHandler={regenerateSingleRowHandler}
            generatePanelLayoutHandler={generatePanelLayoutHandler}
            regeneratePlanPanelsHandler={regeneratePlanPanelsHandler}
            rectAreas={rectAreas}
            setRectAreas={setRectAreas}
            panelType={panelType}
            setPanelType={setPanelType}
            panelFrontHeight={panelFrontHeight}
            setPanelFrontHeight={setPanelFrontHeight}
            panelAngle={panelAngle}
            setPanelAngle={setPanelAngle}
            onDeleteArea={handleDeleteArea}
          />
        )}

        {/* ── RIGHT PANEL ─────────────────────────────────────────────────────── */}
        {uploadedImageData && (projectMode === 'plan' || projectMode === 'scratch' || (roofPolygon && refinedArea)) && (panels.length > 0 || projectMode === 'scratch') && (
          <ToolPanel
            activeTool={activeTool} handleToolChange={handleToolChange}
            selectedPanels={selectedPanels} selectedAreaLabel={selectedAreaLabel}
            nudgeRow={nudgeRow} togglePanelOrientation={togglePanelOrientation}
            addManualPanel={() => { if (!addManualPanel()) setAddError('No valid position found inside roof') }}
            pendingAddNextTo={pendingAddNextTo} setPendingAddNextTo={setPendingAddNextTo}
            addError={addError} setAddError={setAddError}
            distanceMeasurement={distanceMeasurement} setDistanceMeasurement={setDistanceMeasurement}
            allSelectedSameArea={allSelectedSameArea} selectedAreaTrapIds={selectedAreaTrapIds}
            selectedTrapezoidId={selectedTrapezoidId}
            reassignToTrapezoid={reassignToTrapezoid} addTrapezoid={addTrapezoid}
            selectedRow={selectedRow} refinedArea={refinedArea}
            trapezoidConfigs={trapezoidConfigs} setTrapezoidConfigs={setTrapezoidConfigs}
            projectMode={projectMode} areas={areas} getAreaKey={getAreaKey}
            updateTrapezoidConfig={updateTrapezoidConfig} resetTrapezoidConfig={resetTrapezoidConfig}
            panelFrontHeight={panelFrontHeight} panelAngle={panelAngle}
            rectAreas={rectAreas} setRectAreas={setRectAreas}
            showHGridlines={showHGridlines} setShowHGridlines={setShowHGridlines}
            showVGridlines={showVGridlines} setShowVGridlines={setShowVGridlines}
            snapToGridlines={snapToGridlines} setSnapToGridlines={setSnapToGridlines}
          />
        )}
      </div>
    </>
  )
}
