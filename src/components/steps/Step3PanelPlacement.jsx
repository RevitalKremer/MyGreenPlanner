import { useState, useMemo, useRef, useEffect } from 'react'
import {
  computePanelBackHeight,
} from '../../utils/trapezoidGeometry'
import { useImagePanZoom } from '../../hooks/useImagePanZoom'
import CanvasNavigator from '../shared/CanvasNavigator'
import RowSidebar from './step3/RowSidebar'
import ToolPanel from './step3/ToolPanel'

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
  const [hoveredPanelId, setHoveredPanelId] = useState(null)
  const { panOffset, setPanOffset, panActive, setPanActive, panRef, viewportRef, MM_W, MM_H, panToMinimapPoint, getMinimapViewportRect } = useImagePanZoom(imageRef)
  const [isSpaceDown, setIsSpaceDown] = useState(false)
  const willDeselectRef = useRef(false)
  const [rectSelect, setRectSelect] = useState(null)
  const [trapIdOverride, setTrapIdOverride] = useState(null)

  // Clear trapezoid override when panels are fully deselected
  useEffect(() => {
    if (selectedPanels.length === 0) setTrapIdOverride(null)
  }, [selectedPanels])

  // Space bar tracking for pan-anywhere
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.code === 'Space' && !e.repeat &&
          e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault()
        setIsSpaceDown(true)
      }
    }
    const onKeyUp = (e) => {
      if (e.code === 'Space') setIsSpaceDown(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  // ── Derived row data ────────────────────────────────────────────────────────
  // Group panels by their panel.row property (set at generation time).
  // This is more reliable than re-running detectRows, which can mis-group
  // rows that are close together in screen space.

  const rows = useMemo(() => {
    if (panels.length === 0) return []

    // Step 1: group by panel.area property (falls back to panel.row for old saves)
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
        // Skip spatial sub-split for multi-line rows — different lines will have
        // large cross-depth distances that would incorrectly trigger splits.
        const isMultiLine = rowPanels.some(p => p.line !== undefined && p.line > 0)
        if (rowPanels.length <= 1 || isMultiLine) { result.push(rowPanels); return }

        // Step 2: within same panel.area, split by spatial adjacency.
        // Panels separated by more than 2× panel widths are different clusters
        // (happens when an obstacle interrupts a row).
        const angle = (rowPanels[0].rotation || 0) * Math.PI / 180
        const dirX = Math.cos(angle), dirY = Math.sin(angle)
        const sorted = [...rowPanels].sort((a, b) => {
          const aCx = a.x + a.width / 2, aCy = a.y + a.height / 2
          const bCx = b.x + b.width / 2, bCy = b.y + b.height / 2
          return (aCx * dirX + aCy * dirY) - (bCx * dirX + bCy * dirY)
        })
        // Normal adjacent gap ≈ panel_width + small_gap ≈ 1× width.
        // After one deletion, center-to-center gap ≈ 2× width.
        // Threshold between these two values triggers a split correctly.
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
    setHoveredPanelId(null)
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
    const gap = refinedArea?.pixelToCmRatio ? 2.5 / refinedArea.pixelToCmRatio : 5
    const lastCx = last.x + last.width / 2, lastCy = last.y + last.height / 2
    const newCx = lastCx + (last.width + gap) * dirX
    const newCy = lastCy + (last.width + gap) * dirY
    const newId = panels.length > 0 ? Math.max(...panels.map(p => p.id)) + 1 : 1
    // If the area has no area key (manually-added panels), assign one now
    const areaKey = (sortedRow[0].area ?? sortedRow[0].row) !== undefined
      ? (sortedRow[0].area ?? sortedRow[0].row)
      : `m_${sortedRow[0].id}`
    const trapId = sortedRow[0].trapezoidId || 'A1'
    const selectedIds = selectedRow.map(p => p.id)
    const newPanel = { ...last, id: newId, area: areaKey, trapezoidId: trapId, x: newCx - last.width / 2, y: newCy - last.height / 2 }
    setPanels(prev => [
      ...prev.map(p => selectedIds.includes(p.id) ? { ...p, area: areaKey, trapezoidId: trapId } : p),
      newPanel
    ])
    setSelectedPanels(prev => [...prev, newId])
  }

  // ── Per-trapezoid config ──────────────────────────────────────────────────────

  const getAreaKey = (panel) =>
    (panel.area ?? panel.row) !== undefined ? (panel.area ?? panel.row) : `manual_${panel.id}`

  const selectedTrapezoidId = trapIdOverride ?? (selectedRow ? (selectedRow[0].trapezoidId || null) : null)

  // Area label: use area's label if available (e.g. "A")
  const areaLabel = (areaKey, i) => {
    const g = areas[areaKey]?.label
    return g ? `${g}` : `Area ${i + 1}`
  }
  const selectedAreaLabel = selectedRowIndex !== null ? areaLabel(getAreaKey(selectedRow[0]), selectedRowIndex) : '?'

  // ── Trapezoid management ──────────────────────────────────────────────────────

  // Map: areaKey → sorted array of trapezoidIds present in that area
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

  // Are all selected panels in the same area?
  const allSelectedSameArea = useMemo(() => {
    if (selectedPanels.length === 0) return false
    const sel = panels.filter(p => selectedPanels.includes(p.id))
    const areaKeys = new Set(sel.map(p => p.area ?? p.row ?? null))
    return areaKeys.size === 1
  }, [selectedPanels, panels])

  // Trapezoids that exist in the selected area
  const selectedAreaTrapIds = useMemo(() => {
    if (!allSelectedSameArea || !selectedRow) return []
    const ak = getAreaKey(selectedRow[0])
    return areaTrapezoidMap[ak] || []
  }, [allSelectedSameArea, selectedRow, areaTrapezoidMap])

  // Add a new trapezoid to the selected area, reassign selected panels to it
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
    // Inherit config from the current trapezoid
    const sourceConfig = trapezoidConfigs?.[selectedTrapezoidId] || {}
    setTrapezoidConfigs(prev => ({ ...prev, [newTrapId]: { ...sourceConfig } }))
    // Reassign selected panels
    const selIds = new Set(selectedPanels)
    setPanels(prev => prev.map(p => selIds.has(p.id) ? { ...p, trapezoidId: newTrapId } : p))
  }

  // Trapezoid IDs that are used by more than one area (shared configs)
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

  // Normalize panel.area values: if spatial sub-splitting creates more visual rows than
  // distinct panel.area keys, assign new sequential area values to the extra sub-groups.
  useEffect(() => {
    if (rows.length === 0 || panels.length === 0) return

    const distinctAreaKeys = new Set()
    panels.forEach(p => {
      const k = p.area ?? p.row
      if (k !== undefined && k !== null) distinctAreaKeys.add(k)
    })

    if (rows.length <= distinctAreaKeys.size) return // Already normalized

    // Group rows by their area key
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
      for (let gi = 1; gi < rowGroups.length; gi++) {
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

  // Reassign selected panels to an existing trapezoid
  const reassignToTrapezoid = (trapId) => {
    const selIds = new Set(selectedPanels)
    setPanels(prev => prev.map(p => selIds.has(p.id) ? { ...p, trapezoidId: trapId } : p))
  }

  const updateTrapezoidConfig = (field, rawValue) => {
    if (!selectedTrapezoidId || !refinedArea?.panelConfig) return

    const globalCfg = refinedArea.panelConfig
    const current = trapezoidConfigs[selectedTrapezoidId] || {}

    // For numeric fields, parse and validate
    if (field === 'angle' || field === 'frontHeight') {
      const value = parseFloat(rawValue)
      if (isNaN(value) || value < 0) return
    }

    let newOverride = { ...current, [field]: rawValue }

    // Recalculate backHeight whenever any relevant field changes
    const a     = field === 'angle'            ? parseFloat(rawValue)  : (current.angle            ?? globalCfg.angle            ?? 0)
    const fH    = field === 'frontHeight'      ? parseFloat(rawValue)  : (current.frontHeight      ?? globalCfg.frontHeight      ?? 0)
    const lpr   = field === 'linesPerRow'      ? rawValue              : (current.linesPerRow      ?? globalCfg.linesPerRow      ?? 1)
    const orients = field === 'lineOrientations' ? rawValue            : (current.lineOrientations ?? globalCfg.lineOrientations ?? ['vertical'])
    newOverride.backHeight = parseFloat(computePanelBackHeight(fH, a || 0, orients, lpr).toFixed(1))

    // For numeric fields, store parsed value
    if (field === 'angle' || field === 'frontHeight') newOverride[field] = parseFloat(rawValue)

    setTrapezoidConfigs(prev => ({ ...prev, [selectedTrapezoidId]: newOverride }))

    // Recompute panel heights when angle changes
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
    // Restore global panel height
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

  // ── SVG interaction ───────────────────────────────────────────────────────────

  const getSVGCursor = () => {
    if (isSpaceDown) return panActive ? 'grabbing' : 'grab'
    if (panActive || dragState) return 'grabbing'
    if (rectSelect) return 'crosshair'
    if (rotationState) return 'crosshair'
    switch (activeTool) {
      case 'move': return 'default'
      case 'rotate': return 'crosshair'
      case 'delete': return 'pointer'
      case 'add': return 'crosshair'
      case 'measure': return 'crosshair'
      default: return 'grab'
    }
  }

  const startPan = (e) => {
    panRef.current = { startX: e.clientX, startY: e.clientY, startPanX: panOffset.x, startPanY: panOffset.y }
    willDeselectRef.current = true
  }

  const handleSVGMouseDown = (e) => {
    // Middle mouse button OR Space + left click → pan from anywhere
    if (e.button === 1 || (e.button === 0 && isSpaceDown)) {
      e.preventDefault()
      startPan(e)
      return
    }

    const svg = e.currentTarget
    const rect = svg.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * imageRef.naturalWidth
    const y = ((e.clientY - rect.top) / rect.height) * imageRef.naturalHeight

    // Baseline drawing (scratch mode only, always first)
    if (projectMode !== 'plan' && (!baseline || baseline.p2 === null)) {
      if (!baseline) { setBaseline({ p1: [x, y], p2: null }); return }
      if (baseline.p2 === null) { setBaseline({ ...baseline, p2: [x, y] }); return }
    }

    // Measure tool
    if (activeTool === 'measure') {
      if (!distanceMeasurement || (distanceMeasurement.p1 && distanceMeasurement.p2)) {
        setDistanceMeasurement({ p1: [x, y], p2: null })
      } else if (distanceMeasurement.p2 === null) {
        setDistanceMeasurement({ ...distanceMeasurement, p2: [x, y] })
      }
      return
    }

    const clickedPanel = panels.find(p =>
      x >= p.x && x <= p.x + p.width && y >= p.y && y <= p.y + p.height
    )

    if (activeTool === 'delete') {
      if (clickedPanel) {
        setPanels(panels.filter(p => p.id !== clickedPanel.id))
        setSelectedPanels([])
      } else {
        startPan(e)
      }
      return
    }

    if (activeTool === 'move') {
      if (clickedPanel) {
        if (e.shiftKey) {
          // Shift+click: toggle individual panel in/out of selection
          setSelectedPanels(prev =>
            prev.includes(clickedPanel.id)
              ? prev.filter(id => id !== clickedPanel.id)
              : [...prev, clickedPanel.id]
          )
          return
        }
        // If clicked panel is already part of the selection, drag all selected panels
        // Otherwise select just this panel and drag it
        const panelIds = selectedPanels.includes(clickedPanel.id) && selectedPanels.length > 0
          ? selectedPanels
          : [clickedPanel.id]
        setSelectedPanels(panelIds)
        const originalPositions = {}
        panelIds.forEach(id => {
          const p = panels.find(p => p.id === id)
          if (p) originalPositions[id] = { x: p.x, y: p.y }
        })
        setDragState({ panelIds, startX: x, startY: y, originalPositions })
      } else {
        // Background: start rectangle selection
        setRectSelect({ startX: x, startY: y, endX: x, endY: y })
      }
      return
    }

    if (activeTool === 'rotate') {
      if (clickedPanel) {
        const rowIds = getRowPanelIds(clickedPanel.id)
        setSelectedPanels(rowIds)
        const rowPanels = panels.filter(p => rowIds.includes(p.id))
        const cx = rowPanels.reduce((s, p) => s + p.x + p.width / 2, 0) / rowPanels.length
        const cy = rowPanels.reduce((s, p) => s + p.y + p.height / 2, 0) / rowPanels.length
        const startAngle = Math.atan2(y - cy, x - cx) * (180 / Math.PI)
        const originalData = {}
        rowIds.forEach(id => {
          const p = panels.find(p => p.id === id)
          if (p) originalData[id] = {
            rotation: p.rotation || 0,
            centerX: p.x + p.width / 2,
            centerY: p.y + p.height / 2,
            x: p.x, y: p.y
          }
        })
        setRotationState({ panelIds: rowIds, anchorCenterX: cx, anchorCenterY: cy, startAngle, originalData })
      } else {
        startPan(e)
      }
      return
    }

    if (activeTool === 'add') {
      if (clickedPanel) {
        setSelectedPanels(getRowPanelIds(clickedPanel.id))
      } else {
        startPan(e)
      }
      return
    }
  }

  const handleSVGMouseMove = (e) => {
    const svg = e.currentTarget
    const rect = svg.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * imageRef.naturalWidth
    const y = ((e.clientY - rect.top) / rect.height) * imageRef.naturalHeight

    if (rectSelect) {
      setRectSelect(prev => ({ ...prev, endX: x, endY: y }))
      return
    }

    if (panRef.current && !dragState && !rotationState) {
      const dx = e.clientX - panRef.current.startX
      const dy = e.clientY - panRef.current.startY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        willDeselectRef.current = false
        if (!panActive) setPanActive(true)
        setPanOffset({ x: panRef.current.startPanX + dx, y: panRef.current.startPanY + dy })
      }
      return
    }

    if (rotationState) {
      const currentAngle = Math.atan2(y - rotationState.anchorCenterY, x - rotationState.anchorCenterX) * (180 / Math.PI)
      const angleDelta = currentAngle - rotationState.startAngle
      const angleRad = angleDelta * (Math.PI / 180)
      setPanels(prev => prev.map(panel => {
        if (!rotationState.panelIds.includes(panel.id)) return panel
        const od = rotationState.originalData[panel.id]
        const relX = od.centerX - rotationState.anchorCenterX
        const relY = od.centerY - rotationState.anchorCenterY
        const newCx = rotationState.anchorCenterX + relX * Math.cos(angleRad) - relY * Math.sin(angleRad)
        const newCy = rotationState.anchorCenterY + relX * Math.sin(angleRad) + relY * Math.cos(angleRad)
        return {
          ...panel,
          x: newCx - panel.width / 2,
          y: newCy - panel.height / 2,
          rotation: (od.rotation + angleDelta) % 360
        }
      }))
    } else if (dragState) {
      const dx = x - dragState.startX, dy = y - dragState.startY
      setPanels(prev => prev.map(panel => {
        if (!dragState.panelIds.includes(panel.id)) return panel
        return {
          ...panel,
          x: dragState.originalPositions[panel.id].x + dx,
          y: dragState.originalPositions[panel.id].y + dy
        }
      }))
    }
  }

  const handleSVGMouseUp = () => {
    if (rectSelect) {
      const minX = Math.min(rectSelect.startX, rectSelect.endX)
      const maxX = Math.max(rectSelect.startX, rectSelect.endX)
      const minY = Math.min(rectSelect.startY, rectSelect.endY)
      const maxY = Math.max(rectSelect.startY, rectSelect.endY)
      if (Math.max(maxX - minX, maxY - minY) > 8) {
        const hit = panels.filter(p => {
          const cx = p.x + p.width / 2
          const cy = p.y + p.height / 2
          return cx >= minX && cx <= maxX && cy >= minY && cy <= maxY
        }).map(p => p.id)
        setSelectedPanels(hit)
      } else {
        setSelectedPanels([])
      }
      setRectSelect(null)
      setDragState(null)
      setRotationState(null)
      return
    }

    if (willDeselectRef.current) {
      setSelectedPanels([])
      willDeselectRef.current = false
    }
    panRef.current = null
    setPanActive(false)
    // Do not snap whole rows — snapping stacks panels when every panel in a row
    // is moved together. Row positioning is intentional by the user.
    setDragState(null)
    setRotationState(null)
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="step-content-area" style={{ position: 'relative' }}>
        {uploadedImageData && (projectMode === 'plan' || (roofPolygon && refinedArea)) ? (
          <div
            className="uploaded-image-view"
            ref={viewportRef}
            style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%', overflow: 'auto', position: 'relative' }}
          >
            <div
              className="uploaded-image-container"
              style={{ position: 'relative', display: 'inline-block', width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '100%', transform: `translate(${panOffset.x}px, ${panOffset.y}px)` }}
              onWheel={(e) => {
                e.preventDefault()
                const delta = e.deltaY > 0 ? -0.1 : 0.1
                setViewZoom(Math.max(0.5, Math.min(3, viewZoom + delta)))
              }}
            >
              <img
                ref={(el) => { if (el) setImageRef(el) }}
                src={uploadedImageData.imageData}
                alt="Roof with panels"
                style={{
                  display: 'block',
                  transform: `rotate(${uploadedImageData.rotation ?? 0}deg) scale(${(uploadedImageData.scale ?? 1) * viewZoom})`,
                  maxWidth: '100%',
                  maxHeight: 'calc(100vh - 250px)',
                  width: 'auto',
                  height: 'auto',
                  cursor: 'default'
                }}
              />

              {imageRef && (
                <svg
                  viewBox={`0 0 ${imageRef.naturalWidth} ${imageRef.naturalHeight}`}
                  preserveAspectRatio="xMidYMid meet"
                  style={{
                    position: 'absolute',
                    top: 0, left: 0,
                    width: '100%', height: '100%',
                    pointerEvents: 'auto',
                    transform: `rotate(${uploadedImageData.rotation ?? 0}deg) scale(${(uploadedImageData.scale ?? 1) * viewZoom})`,
                    cursor: getSVGCursor()
                  }}
                  onMouseDown={handleSVGMouseDown}
                  onMouseMove={handleSVGMouseMove}
                  onMouseUp={handleSVGMouseUp}
                  onMouseLeave={() => { setRectSelect(null); panRef.current = null; setPanActive(false); willDeselectRef.current = false; setDragState(null); setRotationState(null) }}
                >
                  <defs>
                    {roofPolygon && (
                      <mask id="polygonMask">
                        <rect width="100%" height="100%" fill="white" />
                        <polygon
                          points={roofPolygon.coordinates.map(c => `${c[0]},${c[1]}`).join(' ')}
                          fill="black"
                        />
                      </mask>
                    )}
                    {showDistances && distanceMeasurement?.p2 && (
                      <>
                        <marker id="dist-arrow-start" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                          <polygon points="3,1 3,5 1,3" fill="rgba(255,255,255,0.9)" />
                        </marker>
                        <marker id="dist-arrow-end" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                          <polygon points="3,1 3,5 5,3" fill="rgba(255,255,255,0.9)" />
                        </marker>
                      </>
                    )}
                  </defs>

                  {/* Darken area outside polygon */}
                  {roofPolygon && (
                    <>
                      <rect width="100%" height="100%" fill="rgba(0,0,0,0.6)" mask="url(#polygonMask)" />
                      <polygon
                        points={roofPolygon.coordinates.map(c => `${c[0]},${c[1]}`).join(' ')}
                        fill="rgba(196,214,0,0.1)"
                        stroke="#C4D600"
                        strokeWidth="3"
                      />
                    </>
                  )}

                  {/* Baseline */}
                  {showBaseline && baseline?.p1 && baseline?.p2 && (
                    <>
                      <line
                        x1={baseline.p1[0]} y1={baseline.p1[1]}
                        x2={baseline.p2[0]} y2={baseline.p2[1]}
                        stroke="#FF0000" strokeWidth="2" strokeDasharray="8,4"
                      />
                      <circle cx={baseline.p1[0]} cy={baseline.p1[1]} r="4" fill="#FF0000" stroke="white" strokeWidth="1.5" />
                      <circle cx={baseline.p2[0]} cy={baseline.p2[1]} r="4" fill="#FF0000" stroke="white" strokeWidth="1.5" />
                    </>
                  )}
                  {baseline?.p1 && !baseline?.p2 && (
                    <circle cx={baseline.p1[0]} cy={baseline.p1[1]} r="4" fill="#FF0000" stroke="white" strokeWidth="1.5" />
                  )}

                  {/* Solar panels */}
                  {panels.map(panel => {
                    const isSelected = selectedPanels.includes(panel.id)
                    const hasSelection = selectedPanels.length > 0
                    const isHovered = activeTool === 'delete' && hoveredPanelId === panel.id
                    const cx = panel.x + panel.width / 2
                    const cy = panel.y + panel.height / 2
                    const trapId = panel.trapezoidId || 'A1'
                    const hasOverride = !!trapezoidConfigs?.[trapId]

                    let fill, stroke, strokeWidth
                    if (isHovered) {
                      fill = 'rgba(244, 67, 54, 0.65)'; stroke = '#f44336'; strokeWidth = '1'
                    } else if (isSelected) {
                      fill = 'rgba(209,227,243,0.2)'; stroke = '#003f7f'; strokeWidth = '1'
                    } else {
                      fill = 'rgba(135, 206, 235, 0.5)'; stroke = '#4682B4'; strokeWidth = '1'
                    }

                    const opacity = hasSelection && !isSelected ? 0.45 : 1

                    // Badge sizing proportional to the narrower panel dimension
                    const bh = panel.width * 0.36
                    const bw = bh * (trapId.length > 2 ? 2.8 : 1.9)
                    const fs = bh * 0.62

                    return (
                      <g key={panel.id} style={{ opacity }}>
                        {/* Rotated panel rectangle */}
                        <g transform={`rotate(${panel.rotation || 0} ${cx} ${cy})`}>
                          <rect
                            x={panel.x} y={panel.y}
                            width={panel.width} height={panel.height}
                            fill={fill} stroke={stroke} strokeWidth={strokeWidth}
                            style={{
                              cursor: activeTool === 'delete' ? 'pointer'
                                : activeTool === 'move' ? 'grab'
                                : 'default'
                            }}
                            onMouseEnter={() => activeTool === 'delete' && setHoveredPanelId(panel.id)}
                            onMouseLeave={() => setHoveredPanelId(null)}
                          />
                        </g>
                        {/* Row number pill badge — always upright, centered on panel */}
                        {!isHovered && (
                          <>
                            <rect
                              x={cx - bw / 2} y={cy - bh / 2}
                              width={bw} height={bh}
                              rx={bh / 2}
                              fill={isSelected ? 'rgba(0,60,140,0.72)' : 'rgba(15,15,15,0.55)'}
                              style={{ pointerEvents: 'none' }}
                            />
                            <text
                              x={cx} y={cy}
                              textAnchor="middle" dominantBaseline="middle"
                              fontSize={fs} fontWeight="600"
                              fill="white"
                              style={{ pointerEvents: 'none', letterSpacing: '0.03em' }}
                            >
                              {trapId}
                            </text>
                            {hasOverride && (
                              <circle
                                cx={cx + bw / 2 - bh * 0.18}
                                cy={cy - bh / 2 + bh * 0.18}
                                r={bh * 0.2}
                                fill="#FF9800"
                                style={{ pointerEvents: 'none' }}
                              />
                            )}
                          </>
                        )}
                        {/* Delete-hover indicator */}
                        {isHovered && (
                          <>
                            <rect
                              x={cx - bh / 2} y={cy - bh / 2}
                              width={bh} height={bh}
                              rx={bh / 2}
                              fill="rgba(200,0,0,0.75)"
                              style={{ pointerEvents: 'none' }}
                            />
                            <text
                              x={cx} y={cy}
                              textAnchor="middle" dominantBaseline="middle"
                              fontSize={fs * 1.1} fontWeight="700"
                              fill="white"
                              style={{ pointerEvents: 'none' }}
                            >
                              ✕
                            </text>
                          </>
                        )}
                      </g>
                    )
                  })}

                  {/* Distance measurement */}
                  {showDistances && distanceMeasurement && refinedArea && (() => {
                    const { pixelToCmRatio } = refinedArea
                    const { p1, p2 } = distanceMeasurement
                    if (!p2) return (
                      <circle cx={p1[0]} cy={p1[1]} r="3" fill="white" opacity="0.9" />
                    )
                    const distPx = Math.sqrt((p2[0] - p1[0]) ** 2 + (p2[1] - p1[1]) ** 2)
                    const distCm = distPx * pixelToCmRatio
                    const distM = (distCm / 100).toFixed(2)
                    const midX = (p1[0] + p2[0]) / 2, midY = (p1[1] + p2[1]) / 2
                    return (
                      <>
                        {/* Measurement line */}
                        <line
                          x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]}
                          stroke="rgba(255,255,255,0.85)" strokeWidth="1.5"
                          strokeDasharray="4,3"
                          markerStart="url(#dist-arrow-start)" markerEnd="url(#dist-arrow-end)"
                        />
                        {/* Endpoint dots */}
                        <circle cx={p1[0]} cy={p1[1]} r="3" fill="white" opacity="0.9" />
                        <circle cx={p2[0]} cy={p2[1]} r="3" fill="white" opacity="0.9" />
                        {/* Compact dark pill label */}
                        <rect
                          x={midX - 34} y={midY - 13}
                          width="68" height="26"
                          fill="rgba(15,15,15,0.78)" rx="13"
                        />
                        <text
                          x={midX} y={midY - 1}
                          textAnchor="middle"
                          fill="white" fontSize="10" fontWeight="700"
                          style={{ pointerEvents: 'none' }}
                        >
                          {distM} m
                        </text>
                        <text
                          x={midX} y={midY + 9}
                          textAnchor="middle"
                          fill="rgba(255,255,255,0.55)" fontSize="7.5" fontWeight="400"
                          style={{ pointerEvents: 'none' }}
                        >
                          {distCm.toFixed(0)} cm
                        </text>
                      </>
                    )
                  })()}

                  {/* Rectangle selection box */}
                  {rectSelect && (() => {
                    const rx = Math.min(rectSelect.startX, rectSelect.endX)
                    const ry = Math.min(rectSelect.startY, rectSelect.endY)
                    const rw = Math.abs(rectSelect.endX - rectSelect.startX)
                    const rh = Math.abs(rectSelect.endY - rectSelect.startY)
                    return (
                      <rect
                        x={rx} y={ry} width={rw} height={rh}
                        fill="rgba(100,160,255,0.10)"
                        stroke="#3399FF"
                        strokeWidth="1.5"
                        strokeDasharray="6,3"
                        style={{ pointerEvents: 'none' }}
                      />
                    )
                  })()}
                </svg>
              )}
            </div>

            {/* Floating navigator — zoom controls + minimap */}
            {imageRef && (
              <CanvasNavigator
                viewZoom={viewZoom}
                onZoomOut={() => setViewZoom(Math.max(0.5, viewZoom - 0.1))}
                onZoomReset={() => { setViewZoom(1); setPanOffset({ x: 0, y: 0 }) }}
                onZoomIn={() => setViewZoom(Math.min(3, viewZoom + 0.1))}
                imageData={uploadedImageData.imageData}
                mmWidth={MM_W}
                mmHeight={MM_H}
                onPanToPoint={panToMinimapPoint}
                viewportRect={getMinimapViewportRect()}
              >
                <rect width={MM_W} height={MM_H} fill="rgba(0,0,0,0.25)" />
                {panels.map(p => {
                  const mmX = p.x / imageRef.naturalWidth  * MM_W
                  const mmY = p.y / imageRef.naturalHeight * MM_H
                  const mmW = p.width  / imageRef.naturalWidth  * MM_W
                  const mmH = p.height / imageRef.naturalHeight * MM_H
                  const cx = mmX + mmW / 2, cy = mmY + mmH / 2
                  const isSel = selectedPanels.includes(p.id)
                  return (
                    <g key={p.id} transform={`rotate(${p.rotation || 0} ${cx} ${cy})`}>
                      <rect x={mmX} y={mmY} width={mmW} height={mmH} fill={isSel ? 'rgba(0,63,127,0.7)' : 'rgba(70,130,180,0.55)'} stroke={isSel ? '#003f7f' : '#4682B4'} strokeWidth="0.5" />
                    </g>
                  )
                })}
              </CanvasNavigator>
            )}
          </div>
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
          />
        )}
      </div>
    </>
  )
}
