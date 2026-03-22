import { useState, useMemo, useEffect } from 'react'
import {
  computePanelBackHeight,
} from '../../utils/trapezoidGeometry'
import { panelInsideRoof } from '../../utils/panelUtils'
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
  setShowBaseline,
  showDistances,
  setShowDistances,
  distanceMeasurement,
  setDistanceMeasurement,
  generatePanelLayoutHandler,
  regeneratePlanPanelsHandler,
  regenerateSingleRowHandler,
  areas = [],
  addManualPanel,
  trapezoidConfigs,
  setTrapezoidConfigs
}) {
  const [activeTool, setActiveTool] = useState('move')
  const [trapIdOverride, setTrapIdOverride] = useState(null)
  const [showHGridlines, setShowHGridlines] = useState(false)
  const [showVGridlines, setShowVGridlines] = useState(false)
  const [snapToGridlines, setSnapToGridlines] = useState(false)

  // Clear trapezoid override whenever selection changes
  useEffect(() => {
    setTrapIdOverride(null)
  }, [selectedPanels])

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
  }, [panels])

  const panelToRowMap = useMemo(() => {
    const map = new Map()
    rows.forEach((row, i) => row.forEach(p => map.set(p.id, i)))
    return map
  }, [rows])

  const getRowPanelIds = (panelId) => {
    const rowIndex = panelToRowMap.get(panelId)
    if (rowIndex === undefined) return [panelId]
    return rows[rowIndex].map(p => p.id)
  }

  const selectedRowIndex = selectedPanels.length > 0
    ? (panelToRowMap.get(selectedPanels[0]) ?? null)
    : null

  const selectedRow = (selectedRowIndex !== null) ? rows[selectedRowIndex] : null

  const selectedRowAngle = selectedPanels.length > 0
    ? (panels.find(p => selectedPanels.includes(p.id))?.rotation || 0)
    : 0

  // ── Tool helpers ─────────────────────────────────────────────────────────────

  const handleToolChange = (tool) => {
    setActiveTool(tool)
    setSelectedPanels([])
    if (tool === 'measure') setShowDistances(true)
  }

  const rotateSelectedRow = (deltaDeg) => {
    if (!selectedPanels.length) return
    const rowPanels = panels.filter(p => selectedPanels.includes(p.id))
    const cx = rowPanels.reduce((s, p) => s + p.x + p.width / 2, 0) / rowPanels.length
    const cy = rowPanels.reduce((s, p) => s + p.y + p.height / 2, 0) / rowPanels.length
    const rad = deltaDeg * (Math.PI / 180)
    setPanels(prev => prev.map(panel => {
      if (!selectedPanels.includes(panel.id)) return panel
      const pcx = panel.x + panel.width / 2
      const pcy = panel.y + panel.height / 2
      const dx = pcx - cx, dy = pcy - cy
      const newCx = cx + dx * Math.cos(rad) - dy * Math.sin(rad)
      const newCy = cy + dx * Math.sin(rad) + dy * Math.cos(rad)
      return {
        ...panel,
        x: newCx - panel.width / 2,
        y: newCy - panel.height / 2,
        rotation: ((panel.rotation || 0) + deltaDeg) % 360
      }
    }))
  }

  const nudgeRow = (dx, dy) => {
    setPanels(prev => prev.map(p =>
      selectedPanels.includes(p.id) ? { ...p, x: p.x + dx, y: p.y + dy } : p
    ))
  }

  const addPanelToRow = () => {
    if (!selectedRow || selectedRow.length === 0) { addManualPanel(); return }
    const angle = (selectedRow[0].rotation || 0) * Math.PI / 180
    const dirX = Math.cos(angle), dirY = Math.sin(angle)
    const sortedRow = [...selectedRow].sort((a, b) => {
      const aCx = a.x + a.width / 2, aCy = a.y + a.height / 2
      const bCx = b.x + b.width / 2, bCy = b.y + b.height / 2
      return (aCx * dirX + aCy * dirY) - (bCx * dirX + bCy * dirY)
    })
    const last = sortedRow[sortedRow.length - 1]
    const stepPx = refinedArea?.pixelToCmRatio ? 2.5 / refinedArea.pixelToCmRatio : 5
    const lastCx = last.x + last.width / 2, lastCy = last.y + last.height / 2
    const naturalCx = lastCx + (last.width + stepPx) * dirX
    const naturalCy = lastCy + (last.width + stepPx) * dirY
    const hw = last.width / 2, hh = last.height / 2
    const polyCoords = roofPolygon?.coordinates || []

    // Find valid position: try natural spot, then shift ±2.5 cm along row direction
    let finalCx = null, finalCy = null
    const MAX_STEPS = 80
    for (let s = 0; s <= MAX_STEPS; s++) {
      for (const sign of (s === 0 ? [1] : [1, -1])) {
        const cx = naturalCx + sign * s * stepPx * dirX
        const cy = naturalCy + sign * s * stepPx * dirY
        if (panelInsideRoof(cx, cy, hw, hh, last.rotation || 0, polyCoords)) {
          finalCx = cx; finalCy = cy; break
        }
      }
      if (finalCx !== null) break
    }
    if (finalCx === null) return  // no valid position inside roof

    const newId = panels.length > 0 ? Math.max(...panels.map(p => p.id)) + 1 : 1
    const areaKey = (sortedRow[0].area ?? sortedRow[0].row) !== undefined
      ? (sortedRow[0].area ?? sortedRow[0].row)
      : `m_${sortedRow[0].id}`
    const trapId = sortedRow[0].trapezoidId || 'A1'
    const selectedIds = selectedRow.map(p => p.id)
    const newPanel = { ...last, id: newId, area: areaKey, trapezoidId: trapId, x: finalCx - hw, y: finalCy - hh }
    setPanels(prev => [
      ...prev.map(p => selectedIds.includes(p.id) ? { ...p, area: areaKey, trapezoidId: trapId } : p),
      newPanel
    ])
    setSelectedPanels(prev => [...prev, newId])
  }

  // ── Per-trapezoid config ──────────────────────────────────────────────────────

  const getAreaKey = (panel) =>
    (panel.area ?? panel.row) !== undefined ? (panel.area ?? panel.row) : `manual_${panel.id}`

  const selectedTrapezoidId = trapIdOverride ?? (
    selectedPanels.length > 0
      ? (panels.find(p => p.id === selectedPanels[0])?.trapezoidId || null)
      : null
  )

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
      const tId = p.trapezoidId || 'A1'
      if (!map[aKey]) map[aKey] = new Set()
      map[aKey].add(tId)
    })
    const result = {}
    Object.entries(map).forEach(([k, s]) => { result[k] = [...s].sort() })
    return result
  }, [panels])

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
    if (!selectedTrapezoidId || !refinedArea?.panelConfig) return

    const globalCfg = refinedArea.panelConfig
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
    if (!selectedTrapezoidId || !refinedArea?.panelConfig) return
    const globalCfg = refinedArea.panelConfig
    setTrapezoidConfigs(prev => {
      const next = { ...prev }
      delete next[selectedTrapezoidId]
      return next
    })
    const angleRad = (globalCfg.angle || 0) * Math.PI / 180
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
        {uploadedImageData && (projectMode === 'plan' || (roofPolygon && refinedArea)) ? (
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
            refinedArea={refinedArea} trapezoidConfigs={trapezoidConfigs}
            activeTool={activeTool} projectMode={projectMode}
            getRowPanelIds={getRowPanelIds}
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
        {uploadedImageData && (projectMode === 'plan' || (roofPolygon && refinedArea)) && (
          <RowSidebar
            projectMode={projectMode}
            baseline={baseline} setBaseline={setBaseline}
            panels={panels} setPanels={setPanels}
            selectedPanels={selectedPanels} setSelectedPanels={setSelectedPanels}
            setTrapIdOverride={setTrapIdOverride}
            rows={rows} areas={areas}
            areaLabel={areaLabel} getAreaKey={getAreaKey}
            areaTrapezoidMap={areaTrapezoidMap} sharedTrapIds={sharedTrapIds}
            trapezoidConfigs={trapezoidConfigs}
            regenerateSingleRowHandler={regenerateSingleRowHandler}
            generatePanelLayoutHandler={generatePanelLayoutHandler}
            regeneratePlanPanelsHandler={regeneratePlanPanelsHandler}
          />
        )}

        {/* ── RIGHT PANEL ─────────────────────────────────────────────────────── */}
        {uploadedImageData && (projectMode === 'plan' || (roofPolygon && refinedArea)) && (projectMode === 'plan' ? panels.length > 0 : baseline?.p2) && (
          <ToolPanel
            activeTool={activeTool} handleToolChange={handleToolChange}
            selectedPanels={selectedPanels} selectedAreaLabel={selectedAreaLabel} selectedRowAngle={selectedRowAngle}
            nudgeRow={nudgeRow} rotateSelectedRow={rotateSelectedRow}
            addPanelToRow={addPanelToRow} addManualPanel={addManualPanel}
            distanceMeasurement={distanceMeasurement} setDistanceMeasurement={setDistanceMeasurement}
            allSelectedSameArea={allSelectedSameArea} selectedAreaTrapIds={selectedAreaTrapIds}
            selectedTrapezoidId={selectedTrapezoidId}
            reassignToTrapezoid={reassignToTrapezoid} addTrapezoid={addTrapezoid}
            selectedRow={selectedRow} refinedArea={refinedArea}
            trapezoidConfigs={trapezoidConfigs} setTrapezoidConfigs={setTrapezoidConfigs}
            projectMode={projectMode} areas={areas} getAreaKey={getAreaKey}
            updateTrapezoidConfig={updateTrapezoidConfig} resetTrapezoidConfig={resetTrapezoidConfig}
            showBaseline={showBaseline} setShowBaseline={setShowBaseline}
            showHGridlines={showHGridlines} setShowHGridlines={setShowHGridlines}
            showVGridlines={showVGridlines} setShowVGridlines={setShowVGridlines}
            snapToGridlines={snapToGridlines} setSnapToGridlines={setSnapToGridlines}
          />
        )}
      </div>
    </>
  )
}
