import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import {
  computePanelBackHeight,
} from '../../utils/trapezoidGeometry'
import { panelInsideRoof } from '../../utils/panelUtils'
// panelSpec fallback: panelTypes is always provided by useProjectState (server-loaded),
// so this null sentinel should never actually be used at render time.
const _FALLBACK_PANEL_TYPE = null
import RowSidebar from './step2/RowSidebar'
import ToolPanel from './step2/ToolPanel'
import PanelCanvas from './step2/PanelCanvas'

export default function Step2PanelPlacement({
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
  appDefaults,
  roofType,
}) {
  const panelSpec = panelTypes.find(t => t.id === panelType) ?? panelTypes[0] ?? _FALLBACK_PANEL_TYPE
  const [activeTool, setActiveTool] = useState('area')
  const activeToolRef = useRef(activeTool)
  useEffect(() => { activeToolRef.current = activeTool }, [activeTool])
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

  const allYLocked = rectAreas.length > 0 && rectAreas.every(a => a.mode === 'ylocked')

  const handleToggleYLock = () => {
    const newLocked = !allYLocked
    setRectAreas(prev => prev.map(a => ({ ...a, mode: newLocked ? 'ylocked' : 'free' })))
  }

  const handleAddRectArea = useCallback((area) => {
    pendingNewAreaIdxRef.current = rectAreas.length
    const isAllLocked = rectAreas.length > 0 && rectAreas.every(a => a.mode === 'ylocked')
    onAddRectArea?.({ ...area, mode: isAllLocked ? 'ylocked' : 'free' })
  }, [rectAreas, onAddRectArea])

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

    // Re-derive selectedPanels from the stable area index
    if (selectedAreaIdxRef.current !== null) {
      const areaPanels = panels.filter(p => p.area === selectedAreaIdxRef.current).map(p => p.id)
      if (areaPanels.length > 0) {
        setSelectedPanels(prev => {
          // In move/rotate: if all selected panels still exist, keep exact selection (e.g. after drag)
          const tool = activeToolRef.current
          if ((tool === 'move' || tool === 'rotate') && prev.length > 0 && prev.every(id => areaPanels.includes(id))) return prev
          // Otherwise (draw mode, or recompute with new IDs) — re-sync to full area
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
  const canRecalcTrapezoids = typeof selectedAreaIdx === 'number' && !rectAreas[selectedAreaIdx]?.manualTrapezoids

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

  const handleSetEditMode = (mode) => {
    if (mode === 'area') handleToolChange('area')
    else handleToolChange('move')
  }

  const togglePanelOrientation = () => {
    if (!selectedPanels.length) return
    const newPanels = panels.map(panel => {
      if (!selectedPanels.includes(panel.id)) return panel
      const cx = panel.x + panel.width / 2, cy = panel.y + panel.height / 2
      const newW = panel.height, newH = panel.width
      const isCurrentlyPortrait = (panel.heightCm ?? panelSpec.lengthCm) > (panelSpec.lengthCm + panelSpec.widthCm) / 2
      const newHeightCm = isCurrentlyPortrait ? panelSpec.widthCm : panelSpec.lengthCm
      return { ...panel, width: newW, height: newH, heightCm: newHeightCm, x: cx - newW / 2, y: cy - newH / 2 }
    })
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
      p.heightCm > p.widthCm ? 'V' : 'H'
    )
    const fH = parseFloat(rectAreas[areaKey]?.frontHeight) || parseFloat(panelFrontHeight) || 0
    const a  = parseFloat(rectAreas[areaKey]?.angle)       || parseFloat(panelAngle)       || 0

    const current = trapezoidConfigs?.[selectedTrapezoidId] || {}
    if (
      JSON.stringify(current.lineOrientations) === JSON.stringify(autoOrients) &&
      current.angle === a &&
      current.frontHeight === fH
    ) return

    const bH = parseFloat(computePanelBackHeight(fH, a, autoOrients, appDefaults?.lineGapCm).toFixed(1))

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
      const defaultTrapId = `${rectAreas[aKey]?.label ?? String.fromCharCode(65 + aKey)}`
      const tId = p.trapezoidId || defaultTrapId
      if (!map[aKey]) map[aKey] = new Set()
      map[aKey].add(tId)
    })
    const result = {}
    Object.entries(map).forEach(([k, s]) => { result[k] = [...s].sort() })
    return result
  }, [panels, rectAreas])

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

  const reassignToTrapezoid = (trapId) => {
    const selIds = new Set(selectedPanels)
    setPanels(prev => prev.map(p => selIds.has(p.id) ? { ...p, trapezoidId: trapId } : p))
    setTrapIdOverride(trapId)
    // Lock auto-split for this area; store column→trapId mapping so recomputes respect it
    if (selectedRow) {
      const ak = getAreaKey(selectedRow[0])
      if (ak !== null && ak !== undefined) {
        const selPanels = panels.filter(p => selIds.has(p.id))
        const cols = [...new Set(selPanels.map(p => p.col).filter(c => c !== undefined))]
        setRectAreas(prev => prev.map((a, i) => {
          if (i !== ak) return a
          const newColMap = { ...(a.manualColTrapezoids || {}) }
          cols.forEach(c => { newColMap[String(c)] = trapId })
          return { ...a, manualTrapezoids: true, manualColTrapezoids: newColMap }
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
            areaLabel={areaLabel} getAreaKey={getAreaKey}
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
            selectedAreaLabel={selectedAreaLabel}
            selectedAreaTrapIds={selectedAreaTrapIds}
            refinedArea={refinedArea}
            resetTrapezoidConfig={resetTrapezoidConfig}
            reassignToTrapezoid={reassignToTrapezoid}
            panelGapCm={appDefaults?.panelGapCm}
            lineGapCm={appDefaults?.lineGapCm}
            roofType={roofType}
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
            onSetEditMode={handleSetEditMode}
            selectedAreaIdx={selectedAreaIdx}
            onDeleteArea={handleDeleteArea}
            onResetArea={regenerateSingleRowHandler}
            onRecalcTrapezoids={refreshAreaTrapezoids}
            canRecalcTrapezoids={canRecalcTrapezoids}
          />
        )}
      </div>
    </>
  )
}
