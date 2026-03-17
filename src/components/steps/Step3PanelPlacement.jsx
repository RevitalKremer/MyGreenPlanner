import { useState, useMemo, useRef, useEffect } from 'react'

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
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [panActive, setPanActive] = useState(false)
  const panRef = useRef(null)
  const willDeselectRef = useRef(false)
  const [rectSelect, setRectSelect] = useState(null) // { startX, startY, endX, endY }
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false)
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false)

  const NUDGE_PX = 5

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

  const selectedTrapezoidId = selectedRow ? (selectedRow[0].trapezoidId || null) : null

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
    const letter = String.fromCharCode(65 + areaIdx)
    const existingNums = selectedAreaTrapIds
      .map(id => parseInt(id.slice(letter.length)))
      .filter(n => !isNaN(n))
    const nextNum = Math.max(...existingNums, 0) + 1
    const newTrapId = `${letter}${nextNum}`
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
    const lineDepths = (orients || ['vertical']).slice(0, lpr).map(o => o === 'vertical' ? 238.2 : 113.4)
    const totalSlope = lineDepths.reduce((s, d) => s + d, 0) + (lpr - 1) * 2.5
    newOverride.backHeight = parseFloat((fH + totalSlope * Math.sin((a || 0) * Math.PI / 180)).toFixed(1))

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

  // ── Style helpers ─────────────────────────────────────────────────────────────

  const toolBtnStyle = (tool) => ({
    flex: 1,
    padding: '0.45rem 0.15rem',
    background: activeTool === tool ? '#C4D600' : 'white',
    color: activeTool === tool ? '#333' : '#888',
    border: `2px solid ${activeTool === tool ? '#C4D600' : '#e8e8e8'}`,
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: '700',
    fontSize: '1rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '1px',
    lineHeight: 1,
    transition: 'all 0.15s'
  })

  const toolLabel = (label) => (
    <span style={{ fontSize: '0.58rem', fontWeight: '600', color: 'inherit' }}>{label}</span>
  )

  const nudgeBtnStyle = {
    padding: '0.3rem',
    background: 'white',
    color: '#555',
    border: '1px solid #ddd',
    borderRadius: '5px',
    cursor: 'pointer',
    fontWeight: '700',
    fontSize: '0.85rem',
    textAlign: 'center',
    lineHeight: 1
  }

  const rotBtnStyle = {
    flex: 1,
    padding: '0.35rem 0.1rem',
    background: 'white',
    color: '#555',
    border: '1px solid #ddd',
    borderRadius: '5px',
    cursor: 'pointer',
    fontWeight: '600',
    fontSize: '0.68rem',
    textAlign: 'center'
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="step-content-area" style={{ position: 'relative' }}>
        {uploadedImageData && (projectMode === 'plan' || (roofPolygon && refinedArea)) ? (
          <div
            className="uploaded-image-view"
            style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%', overflow: 'auto' }}
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
                ref={(el) => setImageRef(el)}
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
          <div style={{
            position: 'absolute', top: '20px', left: '20px',
            width: leftPanelCollapsed ? '32px' : '255px', minHeight: '36px', overflow: 'hidden',
            padding: '1.25rem',
            background: 'white', borderRadius: '12px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            border: '2px solid #C4D600',
            maxHeight: leftPanelCollapsed ? 'none' : 'calc(100vh - 120px)', overflowY: leftPanelCollapsed ? 'hidden' : 'auto'
          }}>
            <button onClick={() => setLeftPanelCollapsed(c => !c)} style={{ position: 'absolute', top: '6px', right: '6px', width: '22px', height: '22px', padding: 0, background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {leftPanelCollapsed ? '›' : '‹'}
            </button>
            {!leftPanelCollapsed && <>
            <h3 style={{ margin: '0 0 1rem 0', color: '#555', fontSize: '1rem', fontWeight: '700' }}>
              Panel Layout
            </h3>

            {/* State: drawing baseline (scratch mode only) */}
            {projectMode !== 'plan' && (!baseline || !baseline.p2) && (
              <div style={{
                padding: '1rem', background: '#FFF3E0',
                borderRadius: '8px', border: '2px solid #FF9800'
              }}>
                <h4 style={{ margin: '0 0 0.5rem 0', color: '#E65100', fontSize: '0.9rem' }}>
                  📍 Draw Baseline
                </h4>
                <p style={{ fontSize: '0.82rem', color: '#666', margin: '0 0 0.5rem 0' }}>
                  Click <strong>two points</strong> to define the first row baseline:
                </p>
                <ol style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.82rem', color: '#666' }}>
                  <li style={{ marginBottom: '0.2rem' }}>Starting point (SW corner)</li>
                  <li>Ending point (SE corner)</li>
                </ol>
                {baseline?.p1 && !baseline.p2 && (
                  <p style={{ fontSize: '0.82rem', color: '#FF9800', margin: '0.5rem 0 0', fontWeight: '600' }}>
                    ✓ First point set — click the second point.
                  </p>
                )}
              </div>
            )}

            {/* State: baseline ready, no panels (scratch mode only) */}
            {projectMode !== 'plan' && baseline?.p2 && panels.length === 0 && (
              <>
                <div style={{
                  padding: '0.75rem', background: '#E8F5E9',
                  borderRadius: '8px', border: '2px solid #4CAF50', marginBottom: '1rem'
                }}>
                  <p style={{ fontSize: '0.82rem', color: '#1B5E20', margin: 0, fontWeight: '600' }}>
                    ✓ Baseline drawn!
                  </p>
                </div>
                <button
                  onClick={() => { setBaseline(null); setPanels([]) }}
                  style={{
                    width: '100%', padding: '0.5rem', marginBottom: '0.5rem',
                    background: 'white', color: '#666',
                    border: '2px solid #ddd', borderRadius: '6px',
                    cursor: 'pointer', fontWeight: '600', fontSize: '0.82rem'
                  }}
                >
                  🔄 Redraw Baseline
                </button>
                <button
                  onClick={generatePanelLayoutHandler}
                  style={{
                    width: '100%', padding: '0.75rem',
                    background: '#C4D600', color: '#333',
                    border: 'none', borderRadius: '6px',
                    cursor: 'pointer', fontWeight: '700', fontSize: '0.95rem'
                  }}
                >
                  Generate Panel Layout
                </button>
              </>
            )}

            {/* State: plan mode, panels cleared */}
            {projectMode === 'plan' && panels.length === 0 && (
              <div style={{ padding: '1rem', background: '#FFF3E0', borderRadius: '8px', border: '2px solid #FF9800' }}>
                <p style={{ fontSize: '0.82rem', color: '#666', margin: '0 0 0.75rem 0' }}>
                  Panels were cleared. Regenerate from the baselines defined in Step 2.
                </p>
                <button
                  onClick={regeneratePlanPanelsHandler}
                  style={{
                    width: '100%', padding: '0.75rem',
                    background: '#C4D600', color: '#333',
                    border: 'none', borderRadius: '6px',
                    cursor: 'pointer', fontWeight: '700', fontSize: '0.95rem'
                  }}
                >
                  ↺ Regenerate from Baselines
                </button>
              </div>
            )}

            {/* State: panels placed */}
            {panels.length > 0 && (
              <>
                {/* Stats grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1rem' }}>
                  <div style={{ padding: '0.65rem', background: '#f8f9fa', borderRadius: '8px', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#C4D600', lineHeight: 1 }}>
                      {panels.length}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#999', marginTop: '2px' }}>Panels</div>
                  </div>
                  <div style={{ padding: '0.65rem', background: '#f8f9fa', borderRadius: '8px', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#C4D600', lineHeight: 1 }}>
                      {(panels.length * 0.67).toFixed(1)}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#999', marginTop: '2px' }}>kW</div>
                  </div>
                  <div style={{
                    padding: '0.5rem', background: '#f8f9fa', borderRadius: '8px',
                    textAlign: 'center', gridColumn: 'span 2'
                  }}>
                    <div style={{ fontSize: '1.1rem', fontWeight: '700', color: '#666' }}>
                      {(panels.length * 238.2 * 113.4 / 10000).toFixed(1)} m²
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#999' }}>Roof Coverage</div>
                  </div>
                </div>

                {/* Area list with trapezoid sub-items */}
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{
                    fontSize: '0.72rem', fontWeight: '700', color: '#aaa',
                    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem'
                  }}>
                    Areas ({rows.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                    {rows.map((row, i) => {
                      const isRowSelected = row.some(p => selectedPanels.includes(p.id))
                      const areaKey = getAreaKey(row[0])
                      const trapIds = areaTrapezoidMap[areaKey] || []
                      const hasMultiTrap = trapIds.length > 1
                      return (
                        <div key={i}>
                          {/* Area header row */}
                          <div
                            style={{
                              display: 'flex', alignItems: 'center',
                              padding: '0.45rem 0.5rem 0.45rem 0.7rem',
                              background: isRowSelected ? '#f4f9e4' : '#f8f9fa',
                              border: `2px solid ${isRowSelected ? '#C4D600' : 'transparent'}`,
                              borderRadius: hasMultiTrap ? '8px 8px 0 0' : '8px',
                              transition: 'all 0.12s'
                            }}
                          >
                            <div
                              onClick={() => setSelectedPanels(row.map(p => p.id))}
                              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, cursor: 'pointer' }}
                            >
                              <span style={{
                                width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
                                background: isRowSelected ? '#C4D600' : '#ccc'
                              }} />
                              <span style={{ fontSize: '0.82rem', fontWeight: '600', color: '#444' }}>
                                {areaLabel(areaKey, i)}
                              </span>
                              {/* Trapezoid badge (single-trap areas only) */}
                              {!hasMultiTrap && trapIds.length === 1 && (
                                <span
                                  title={sharedTrapIds.has(trapIds[0]) ? 'Shared config — changes affect all areas using this trapezoid' : trapIds[0]}
                                  style={{
                                    fontSize: '0.62rem', fontWeight: '700',
                                    padding: '1px 5px', borderRadius: '8px',
                                    background: sharedTrapIds.has(trapIds[0]) ? '#E3F2FD' : '#f0f0f0',
                                    color: sharedTrapIds.has(trapIds[0]) ? '#1565C0' : '#888',
                                    border: sharedTrapIds.has(trapIds[0]) ? '1px solid #90CAF9' : '1px solid transparent',
                                    cursor: 'default'
                                  }}
                                >
                                  {trapIds[0]}{sharedTrapIds.has(trapIds[0]) && ' ⇄'}
                                </span>
                              )}
                              <span style={{ fontSize: '0.75rem', color: '#999', marginLeft: 'auto' }}>
                                {row.length} panels
                              </span>
                            </div>
                            <button
                              onClick={() => regenerateSingleRowHandler(areaKey)}
                              title={`Regenerate ${areaLabel(areaKey, i)}`}
                              style={{
                                marginLeft: '0.4rem', padding: '2px 6px', flexShrink: 0,
                                background: 'none', border: '1px solid #ddd', borderRadius: '4px',
                                cursor: 'pointer', fontSize: '0.8rem', color: '#aaa', lineHeight: 1
                              }}
                            >↺</button>
                          </div>
                          {/* Trapezoid sub-rows (shown when area has multiple trapezoids) */}
                          {hasMultiTrap && (
                            <div style={{
                              borderLeft: '2px solid #C4D600', marginLeft: '0.7rem',
                              borderRadius: '0 0 6px 6px', background: '#fafafa',
                              borderBottom: '1px solid #e8e8e8', borderRight: '1px solid #e8e8e8'
                            }}>
                              {trapIds.map(trapId => {
                                const trapPanels = panels.filter(p =>
                                  (p.area ?? p.row) === areaKey && p.trapezoidId === trapId
                                )
                                const isTrapSelected = trapPanels.length > 0 &&
                                  trapPanels.every(p => selectedPanels.includes(p.id))
                                return (
                                  <div
                                    key={trapId}
                                    onClick={() => setSelectedPanels(trapPanels.map(p => p.id))}
                                    style={{
                                      display: 'flex', alignItems: 'center', gap: '0.4rem',
                                      padding: '0.3rem 0.5rem 0.3rem 0.75rem',
                                      cursor: 'pointer',
                                      background: isTrapSelected ? '#f0f9e4' : 'transparent',
                                      borderBottom: '1px solid #f0f0f0'
                                    }}
                                  >
                                    <span style={{
                                      fontSize: '0.72rem', fontWeight: '700',
                                      color: isTrapSelected ? '#5a6600' : '#888',
                                      background: isTrapSelected ? '#e8f2b0' : '#f0f0f0',
                                      padding: '1px 6px', borderRadius: '10px', letterSpacing: '0.02em'
                                    }}>{trapId}</span>
                                    <span style={{ fontSize: '0.72rem', color: '#aaa', marginLeft: 'auto' }}>
                                      {trapPanels.length} panels
                                    </span>
                                    {!!trapezoidConfigs?.[trapId] && (
                                      <span title="Custom config" style={{
                                        width: '5px', height: '5px', borderRadius: '50%',
                                        background: '#FF9800', flexShrink: 0
                                      }} />
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Layout actions */}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => {
                      if (projectMode === 'plan') { setPanels([]); setSelectedPanels([]) }
                      else { setBaseline(null); setPanels([]); setSelectedPanels([]) }
                    }}
                    style={{
                      flex: 1, padding: '0.5rem',
                      background: 'white', color: '#888',
                      border: '2px solid #e8e8e8', borderRadius: '6px',
                      cursor: 'pointer', fontSize: '0.78rem', fontWeight: '600'
                    }}
                  >
                    🔄 Reset
                  </button>
                  <button
                    onClick={projectMode === 'plan' ? regeneratePlanPanelsHandler : generatePanelLayoutHandler}
                    style={{
                      flex: 1, padding: '0.5rem',
                      background: '#666', color: 'white',
                      border: 'none', borderRadius: '6px',
                      cursor: 'pointer', fontSize: '0.78rem', fontWeight: '600'
                    }}
                  >
                    ↺ Regenerate
                  </button>
                </div>
              </>
            )}
            </>}
          </div>
        )}

        {/* ── RIGHT PANEL ─────────────────────────────────────────────────────── */}
        {uploadedImageData && (projectMode === 'plan' || (roofPolygon && refinedArea)) && (projectMode === 'plan' ? panels.length > 0 : baseline?.p2) && (
          <div style={{
            position: 'absolute', top: '20px', right: '20px',
            width: rightPanelCollapsed ? '32px' : '225px', minHeight: '36px', overflow: 'hidden',
            maxHeight: rightPanelCollapsed ? 'none' : 'calc(100vh - 120px)', overflowY: rightPanelCollapsed ? 'hidden' : 'auto',
            padding: '1rem',
            background: 'white', borderRadius: '12px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            border: '2px solid #C4D600'
          }}>
            <button onClick={() => setRightPanelCollapsed(c => !c)} style={{ position: 'absolute', top: '6px', right: '6px', width: '22px', height: '22px', padding: 0, background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {rightPanelCollapsed ? '‹' : '›'}
            </button>
            {!rightPanelCollapsed && <>

            {/* Tool selector */}
            <div style={{ marginBottom: '1rem' }}>
              <div style={{
                fontSize: '0.7rem', fontWeight: '700', color: '#aaa',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.45rem'
              }}>
                Tool
              </div>
              <div style={{ display: 'flex', gap: '0.3rem' }}>
                <button style={toolBtnStyle('move')} onClick={() => handleToolChange('move')} title="Move row">
                  <span>✥</span>{toolLabel('Move')}
                </button>
                <button style={toolBtnStyle('rotate')} onClick={() => handleToolChange('rotate')} title="Rotate row">
                  <span>↻</span>{toolLabel('Rotate')}
                </button>
                <button style={toolBtnStyle('delete')} onClick={() => handleToolChange('delete')} title="Delete panel">
                  <span>✂</span>{toolLabel('Delete')}
                </button>
                <button style={toolBtnStyle('add')} onClick={() => handleToolChange('add')} title="Add panel">
                  <span>＋</span>{toolLabel('Add')}
                </button>
                <button style={toolBtnStyle('measure')} onClick={() => handleToolChange('measure')} title="Measure distance">
                  <span style={{ fontSize: '0.85rem' }}>📏</span>{toolLabel('Ruler')}
                </button>
              </div>
            </div>

            {/* Context panel */}
            <div style={{
              minHeight: '90px', marginBottom: '1rem',
              padding: '0.75rem', background: '#fafafa',
              borderRadius: '8px', border: '1px solid #f0f0f0'
            }}>
              {/* Move tool */}
              {activeTool === 'move' && (
                selectedPanels.length > 0 ? (
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: '700', color: '#333', marginBottom: '0.6rem' }}>
                      {selectedPanels.length} panel{selectedPanels.length !== 1 ? 's' : ''} selected
                      <span style={{ fontWeight: '400', color: '#888', fontSize: '0.75rem' }}> — drag to move</span>
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#aaa', marginBottom: '0.35rem' }}>Fine adjust</div>
                    <div style={{
                      display: 'grid', gridTemplateColumns: 'repeat(3, 30px)',
                      gap: '0.2rem', justifyContent: 'center'
                    }}>
                      <div />
                      <button style={nudgeBtnStyle} onClick={() => nudgeRow(0, -NUDGE_PX)}>↑</button>
                      <div />
                      <button style={nudgeBtnStyle} onClick={() => nudgeRow(-NUDGE_PX, 0)}>←</button>
                      <div style={{ ...nudgeBtnStyle, background: '#f0f0f0', cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#ccc', display: 'block' }} />
                      </div>
                      <button style={nudgeBtnStyle} onClick={() => nudgeRow(NUDGE_PX, 0)}>→</button>
                      <div />
                      <button style={nudgeBtnStyle} onClick={() => nudgeRow(0, NUDGE_PX)}>↓</button>
                      <div />
                    </div>
                    <div style={{ fontSize: '0.68rem', color: '#bbb', textAlign: 'center', marginTop: '0.4rem' }}>
                      or drag on canvas
                    </div>
                    {/* ── Trapezoid assignment (shown when same-area panels selected) ── */}
                    {allSelectedSameArea && selectedAreaTrapIds.length > 0 && (
                      <div style={{ marginTop: '0.65rem', borderTop: '1px solid #f0f0f0', paddingTop: '0.55rem' }}>
                        <div style={{ fontSize: '0.65rem', color: '#aaa', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
                          Trapezoid
                        </div>
                        {/* Current trapezoid badge + reassign dropdown */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.4rem' }}>
                          <span style={{
                            fontSize: '0.75rem', fontWeight: '700', color: '#5a6600',
                            background: '#e8f2b0', padding: '2px 8px', borderRadius: '10px'
                          }}>{selectedTrapezoidId || '—'}</span>
                          {selectedAreaTrapIds.length > 1 && (
                            <select
                              value={selectedTrapezoidId || ''}
                              onChange={e => reassignToTrapezoid(e.target.value)}
                              style={{
                                flex: 1, padding: '0.2rem 0.3rem', fontSize: '0.72rem',
                                border: '1px solid #ddd', borderRadius: '4px',
                                background: 'white', cursor: 'pointer'
                              }}
                            >
                              {selectedAreaTrapIds.map(tid => (
                                <option key={tid} value={tid}>{tid}</option>
                              ))}
                            </select>
                          )}
                        </div>
                        {/* Add Trapezoid button */}
                        <button
                          onClick={addTrapezoid}
                          style={{
                            width: '100%', padding: '0.35rem',
                            background: '#f0f4e8', color: '#5a6600',
                            border: '1px solid #C4D600', borderRadius: '5px',
                            cursor: 'pointer', fontWeight: '700', fontSize: '0.75rem'
                          }}
                        >
                          ＋ New Trapezoid for Selection
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.8rem', color: '#bbb', textAlign: 'center', paddingTop: '0.5rem', lineHeight: 1.6 }}>
                    <div>Click a panel to select</div>
                    <div style={{ fontSize: '0.7rem' }}>Drag empty area to box-select</div>
                    <div style={{ fontSize: '0.7rem' }}>Shift+click to add/remove</div>
                  </div>
                )
              )}

              {/* Rotate tool */}
              {activeTool === 'rotate' && (
                selectedPanels.length > 0 ? (
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: '700', color: '#333', marginBottom: '0.4rem' }}>
                      {selectedAreaLabel}
                      <span style={{ fontWeight: '400', color: '#888' }}> · {selectedPanels.length} panels</span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#888', marginBottom: '0.5rem' }}>
                      Angle: <strong style={{ color: '#444' }}>{selectedRowAngle.toFixed(1)}°</strong>
                    </div>
                    <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.3rem' }}>
                      <button onClick={() => rotateSelectedRow(-5)} style={rotBtnStyle}>◁◁ 5°</button>
                      <button onClick={() => rotateSelectedRow(-1)} style={rotBtnStyle}>◁ 1°</button>
                      <button onClick={() => rotateSelectedRow(1)} style={rotBtnStyle}>1° ▷</button>
                      <button onClick={() => rotateSelectedRow(5)} style={rotBtnStyle}>5° ▷▷</button>
                    </div>
                    <div style={{ fontSize: '0.68rem', color: '#bbb', textAlign: 'center' }}>
                      or drag on canvas
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: '0.82rem', color: '#bbb', textAlign: 'center', paddingTop: '0.75rem' }}>
                    Click an area to select it
                  </div>
                )
              )}

              {/* Delete tool */}
              {activeTool === 'delete' && (
                <div>
                  <div style={{ fontSize: '0.82rem', fontWeight: '700', color: '#c62828', marginBottom: '0.35rem' }}>
                    ✂ Delete Panel
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#888', lineHeight: '1.5' }}>
                    Click any panel to remove it. The row splits automatically if needed.
                  </div>
                </div>
              )}

              {/* Add tool */}
              {activeTool === 'add' && (
                selectedPanels.length > 0 ? (
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: '700', color: '#333', marginBottom: '0.6rem' }}>
                      {selectedAreaLabel}
                      <span style={{ fontWeight: '400', color: '#888' }}> · {selectedPanels.length} panels</span>
                    </div>
                    <button
                      onClick={addPanelToRow}
                      style={{
                        width: '100%', padding: '0.5rem', marginBottom: '0.4rem',
                        background: '#C4D600', color: '#333',
                        border: 'none', borderRadius: '6px',
                        cursor: 'pointer', fontWeight: '700', fontSize: '0.82rem'
                      }}
                    >
                      ＋ Add to {selectedAreaLabel || '?'}
                    </button>
                    <button
                      onClick={addManualPanel}
                      style={{
                        width: '100%', padding: '0.4rem',
                        background: 'white', color: '#888',
                        border: '1px solid #ddd', borderRadius: '6px',
                        cursor: 'pointer', fontWeight: '600', fontSize: '0.75rem'
                      }}
                    >
                      ＋ Add Standalone
                    </button>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: '0.78rem', color: '#aaa', marginBottom: '0.6rem' }}>
                      Select a row first, or:
                    </div>
                    <button
                      onClick={addManualPanel}
                      style={{
                        width: '100%', padding: '0.55rem',
                        background: '#C4D600', color: '#333',
                        border: 'none', borderRadius: '6px',
                        cursor: 'pointer', fontWeight: '700', fontSize: '0.82rem'
                      }}
                    >
                      ＋ Add Standalone Panel
                    </button>
                  </div>
                )
              )}

              {/* Measure tool */}
              {activeTool === 'measure' && (
                <div>
                  <div style={{ fontSize: '0.82rem', fontWeight: '700', color: '#1565C0', marginBottom: '0.35rem' }}>
                    📏 Measure Distance
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#888', lineHeight: '1.5', marginBottom: '0.5rem' }}>
                    Click two points on the canvas to measure.
                  </div>
                  {distanceMeasurement?.p2 && (
                    <button
                      onClick={() => setDistanceMeasurement(null)}
                      style={{
                        width: '100%', padding: '0.4rem',
                        background: 'white', color: '#2196F3',
                        border: '1px solid #90CAF9', borderRadius: '5px',
                        cursor: 'pointer', fontSize: '0.75rem', fontWeight: '600'
                      }}
                    >
                      🗑️ Clear Measurement
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Per-trapezoid config editor */}
            {selectedRow && activeTool !== 'measure' && (() => {
              const globalCfg = refinedArea?.panelConfig || {}
              const override = trapezoidConfigs?.[selectedTrapezoidId] || {}
              const isOverridden = !!(selectedTrapezoidId && trapezoidConfigs?.[selectedTrapezoidId])
              const angle = override.angle ?? globalCfg.angle ?? 0
              const backHeight = override.backHeight ?? globalCfg.backHeight ?? 0
              const frontHeight = override.frontHeight ?? globalCfg.frontHeight ?? 0

              // Compute totalSlope — override > plan area > global config
              const selectedAreaKey = selectedRow ? getAreaKey(selectedRow[0]) : null
              const _planArea = projectMode === 'plan' && selectedAreaKey !== null
                ? areas[selectedAreaKey] ?? null
                : null
              const _effectiveLinesPerRow = (override.linesPerRow ?? _planArea?.linesPerRow ?? globalCfg.linesPerRow) || 1
              const _effectiveLineOrientations = (override.lineOrientations ?? _planArea?.lineOrientations ?? globalCfg.lineOrientations) || ['vertical']
              const _lineDepths = _effectiveLineOrientations.slice(0, _effectiveLinesPerRow)
                .map(o => o === 'vertical' ? 238.2 : 113.4)
              const totalSlope = _lineDepths.reduce((s, d) => s + d, 0) + (_effectiveLinesPerRow - 1) * 2.5

              // Trapezoid cross-section geometry
              const W = 130, H = 62, groundY = H - 8
              const fX = 15

              return (
                <div style={{
                  marginBottom: '0.85rem', padding: '0.7rem',
                  background: isOverridden ? '#FFF8E1' : '#fafafa',
                  borderRadius: '8px',
                  border: `1px solid ${isOverridden ? '#FFD54F' : '#f0f0f0'}`
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: '700', color: isOverridden ? '#E65100' : '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1 }}>
                      {selectedAreaLabel} Trapezoid
                    </span>
                    {isOverridden && (
                      <button
                        onClick={resetTrapezoidConfig}
                        title="Reset to global defaults"
                        style={{
                          padding: '2px 6px', fontSize: '0.65rem', fontWeight: '600',
                          background: 'white', color: '#E65100',
                          border: '1px solid #FFB74D', borderRadius: '4px', cursor: 'pointer'
                        }}
                      >
                        Reset
                      </button>
                    )}
                  </div>

                  {/* Cross-section preview — multi-line aware */}
                  {(() => {
                    const planArea = projectMode === 'plan' && selectedAreaKey !== null
                      ? areas[selectedAreaKey] ?? null
                      : null
                    const effectiveLinesPerRow = (override.linesPerRow ?? planArea?.linesPerRow ?? globalCfg.linesPerRow) || 1
                    const effectiveLineOrientations = (override.lineOrientations ?? planArea?.lineOrientations ?? globalCfg.lineOrientations) || ['vertical']
                    const lineDepths = effectiveLineOrientations.slice(0, effectiveLinesPerRow)
                      .map(o => o === 'vertical' ? 238.2 : 113.4)
                    const angleRad2 = angle * Math.PI / 180
                    const totalSlopePrev = lineDepths.reduce((s, d) => s + d, 0) + (effectiveLinesPerRow - 1) * 2.5
                    const totalHoriz = totalSlopePrev * Math.cos(angleRad2)
                    const scaleW2 = totalHoriz > 0 ? (W - 30) / totalHoriz : 1
                    const scaleH2 = backHeight > 0 ? (H - 18) / backHeight : 1
                    const sc = Math.min(scaleW2, scaleH2)
                    const segs = []
                    let sx = fX, sy = groundY - frontHeight * sc
                    for (let li = 0; li < effectiveLinesPerRow; li++) {
                      const d = lineDepths[li]
                      const gap = li < effectiveLinesPerRow - 1 ? 2.5 : 0
                      const sdx = d * Math.cos(angleRad2) * sc
                      const sdy = d * Math.sin(angleRad2) * sc
                      const gdx = gap * Math.cos(angleRad2) * sc
                      const gdy = gap * Math.sin(angleRad2) * sc
                      const isH = effectiveLineOrientations[li] === 'horizontal'
                      segs.push({ x1: sx, y1: sy, x2: sx + sdx, y2: sy - sdy, isH })
                      sx = sx + sdx + gdx
                      sy = sy - sdy - gdy
                    }
                    const finalX = sx
                    return (
                      <svg width={W} height={H} style={{ display: 'block', margin: '0 auto 0.5rem' }}>
                        <line x1="0" y1={groundY} x2={W} y2={groundY} stroke="#ddd" strokeWidth="1"/>
                        <line x1={fX} y1={groundY} x2={fX} y2={groundY - frontHeight * sc} stroke="#aaa" strokeWidth="1.5"/>
                        <line x1={finalX} y1={groundY} x2={finalX} y2={groundY - backHeight * sc} stroke="#aaa" strokeWidth="1.5"/>
                        {segs.map((seg, i) => (
                          <line key={i} x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2}
                            stroke={seg.isH ? '#FF9800' : '#1565C0'} strokeWidth="2.5" strokeLinecap="round"/>
                        ))}
                        <text x={fX - 2} y={(groundY + groundY - frontHeight * sc) / 2} textAnchor="end" fill="#888" fontSize="8">{frontHeight.toFixed(0)}</text>
                        <text x={finalX + 3} y={(groundY + groundY - backHeight * sc) / 2} fill="#888" fontSize="8">{backHeight.toFixed(1)}</text>
                        <text x={(fX + finalX) / 2} y={H - 1} textAnchor="middle" fill="#555" fontSize="7.5" fontWeight="700">{angle.toFixed(1)}°</text>
                      </svg>
                    )
                  })()}

                  {/* Inputs — angle + front H editable, back H calculated */}
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.65rem', color: '#aaa', marginBottom: '2px' }}>Angle (°)</div>
                      <input
                        key={`${selectedTrapezoidId}-angle`}
                        type="number" min="0" max="30" step="0.5"
                        defaultValue={angle}
                        onChange={e => updateTrapezoidConfig('angle', e.target.value)}
                        style={{
                          width: '100%', padding: '0.3rem 0.4rem', boxSizing: 'border-box',
                          border: `1px solid ${isOverridden ? '#FFB74D' : '#ddd'}`,
                          borderRadius: '5px', fontSize: '0.82rem', fontWeight: '600'
                        }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.65rem', color: '#aaa', marginBottom: '2px' }}>Front H (cm)</div>
                      <input
                        key={`${selectedTrapezoidId}-frontH`}
                        type="number" min="0" step="0.5"
                        defaultValue={frontHeight}
                        onChange={e => updateTrapezoidConfig('frontHeight', e.target.value)}
                        style={{
                          width: '100%', padding: '0.3rem 0.4rem', boxSizing: 'border-box',
                          border: `1px solid ${isOverridden ? '#FFB74D' : '#ddd'}`,
                          borderRadius: '5px', fontSize: '0.82rem', fontWeight: '600'
                        }}
                      />
                    </div>
                  </div>
                  {/* Lines per Row — same L&F as Step 2 */}
                  <div style={{ marginBottom: '0.75rem', marginTop: '0.6rem' }}>
                    <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.4rem', fontSize: '0.82rem' }}>Lines per Row</label>
                    <div style={{ display: 'flex', gap: '0.3rem' }}>
                      {[1,2,3,4,5].map(n => (
                        <button key={n} onClick={() => {
                          const newOrients = [..._effectiveLineOrientations]
                          while (newOrients.length < n) newOrients.push('vertical')
                          updateTrapezoidConfig('linesPerRow', n)
                          updateTrapezoidConfig('lineOrientations', newOrients.slice(0, n))
                        }}
                          style={{ flex: 1, padding: '0.4rem', background: _effectiveLinesPerRow === n ? '#1565C0' : 'white', color: _effectiveLinesPerRow === n ? 'white' : '#555', border: `2px solid ${_effectiveLinesPerRow === n ? '#1565C0' : '#e0e0e0'}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '0.85rem' }}>
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Line Orientations — same L&F as Step 2 */}
                  <div style={{ marginBottom: '0.75rem' }}>
                    <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.4rem', fontSize: '0.82rem' }}>
                      Line Orientations <span style={{ fontSize: '0.68rem', color: '#aaa', fontWeight: '400' }}>(front → back)</span>
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                      {_effectiveLineOrientations.slice(0, _effectiveLinesPerRow).map((o, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontSize: '0.75rem', color: '#777', width: '46px', flexShrink: 0 }}>Line {idx + 1}</span>
                          <button onClick={() => {
                            const newOrients = [..._effectiveLineOrientations]
                            newOrients[idx] = newOrients[idx] === 'vertical' ? 'horizontal' : 'vertical'
                            updateTrapezoidConfig('lineOrientations', newOrients)
                          }}
                            style={{ flex: 1, padding: '0.32rem 0.5rem', background: o === 'vertical' ? '#E3F2FD' : '#FFF3E0', color: o === 'vertical' ? '#1565C0' : '#E65100', border: `1.5px solid ${o === 'vertical' ? '#90CAF9' : '#FFB74D'}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}>
                            {o === 'vertical' ? '▮ Vertical (portrait)' : '▬ Horizontal (landscape)'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ marginTop: '0.35rem', padding: '0.3rem 0.5rem', background: '#f8f9fa', borderRadius: '5px', fontSize: '0.75rem', color: '#777', display: 'flex', gap: '1rem' }}>
                    <span>Back height: <strong style={{ color: '#555' }}>{backHeight.toFixed(1)} cm</strong></span>
                    <span>Slope depth: <strong style={{ color: '#555' }}>{totalSlope.toFixed(1)} cm</strong></span>
                  </div>
                </div>
              )
            })()}

            {/* Divider */}
            <div style={{ borderTop: '1px solid #f0f0f0', marginBottom: '0.85rem' }} />

            {/* Zoom controls */}
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.7rem', color: '#aaa', fontWeight: '600', marginBottom: '0.35rem' }}>
                🔍 Zoom: {(viewZoom * 100).toFixed(0)}%
              </div>
              <div style={{ display: 'flex', gap: '0.3rem' }}>
                <button
                  onClick={() => setViewZoom(Math.max(0.5, viewZoom - 0.1))}
                  style={{
                    flex: 1, padding: '0.4rem',
                    background: 'white', color: '#666',
                    border: '1px solid #ddd', borderRadius: '6px',
                    cursor: 'pointer', fontWeight: '600', fontSize: '0.9rem'
                  }}
                >−</button>
                <button
                  onClick={() => { setViewZoom(1); setPanOffset({ x: 0, y: 0 }) }}
                  style={{
                    flex: 1, padding: '0.4rem',
                    background: 'white', color: '#666',
                    border: '1px solid #ddd', borderRadius: '6px',
                    cursor: 'pointer', fontWeight: '600', fontSize: '0.7rem'
                  }}
                >100%</button>
                <button
                  onClick={() => setViewZoom(Math.min(3, viewZoom + 0.1))}
                  style={{
                    flex: 1, padding: '0.4rem',
                    background: 'white', color: '#666',
                    border: '1px solid #ddd', borderRadius: '6px',
                    cursor: 'pointer', fontWeight: '600', fontSize: '0.9rem'
                  }}
                >+</button>
              </div>
              <div style={{ fontSize: '0.68rem', color: '#ccc', marginTop: '0.25rem' }}>
                Mouse wheel to zoom
              </div>
            </div>

            {/* Clear ruler (always visible when measurement exists) */}
            {distanceMeasurement?.p2 && (
              <button
                onClick={() => setDistanceMeasurement(null)}
                style={{
                  width: '100%', padding: '0.5rem', marginBottom: '0.5rem',
                  background: '#E3F2FD', color: '#1565C0',
                  border: '1px solid #90CAF9', borderRadius: '6px',
                  cursor: 'pointer', fontWeight: '600', fontSize: '0.78rem'
                }}
              >
                🗑️ Clear Ruler
              </button>
            )}

            {/* Baseline toggle */}
            <button
              onClick={() => setShowBaseline(!showBaseline)}
              style={{
                width: '100%', padding: '0.5rem',
                background: showBaseline ? '#FFF8E1' : 'white',
                color: showBaseline ? '#E65100' : '#aaa',
                border: `1px solid ${showBaseline ? '#FFCC02' : '#ddd'}`,
                borderRadius: '6px', cursor: 'pointer',
                fontWeight: '600', fontSize: '0.78rem'
              }}
            >
              {showBaseline ? '👁 Baseline visible' : '👁 Show Baseline'}
            </button>
            </>}
          </div>
        )}
      </div>
    </>
  )
}
