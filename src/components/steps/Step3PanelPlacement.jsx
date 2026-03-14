import { useState, useMemo } from 'react'

export default function Step3PanelPlacement({
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
  addManualPanel,
  rowConfigs,
  setRowConfigs
}) {
  const [activeTool, setActiveTool] = useState('move')
  const [hoveredPanelId, setHoveredPanelId] = useState(null)

  const NUDGE_PX = 5

  // ── Derived row data ────────────────────────────────────────────────────────
  // Group panels by their panel.row property (set at generation time).
  // This is more reliable than re-running detectRows, which can mis-group
  // rows that are close together in screen space.

  const rows = useMemo(() => {
    if (panels.length === 0) return []

    // Step 1: group by panel.row property
    const rowMap = new Map()
    panels.forEach(panel => {
      const key = panel.row !== undefined ? panel.row : `manual_${panel.id}`
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

        // Step 2: within same panel.row, split by spatial adjacency.
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
    // If the row has no row key (manually-added panels), assign one now based on the
    // lowest panel ID in the group so it's stable across re-renders.
    const rowKey = sortedRow[0].row !== undefined
      ? sortedRow[0].row
      : `m_${sortedRow[0].id}`
    const selectedIds = selectedRow.map(p => p.id)
    const newPanel = { ...last, id: newId, row: rowKey, x: newCx - last.width / 2, y: newCy - last.height / 2 }
    setPanels(prev => [
      ...prev.map(p => selectedIds.includes(p.id) ? { ...p, row: rowKey } : p),
      newPanel
    ])
    setSelectedPanels(prev => [...prev, newId])
  }

  // ── Per-row trapezoid ─────────────────────────────────────────────────────────

  const getRowKey = (panel) =>
    panel.row !== undefined ? panel.row : `manual_${panel.id}`

  const selectedRowKey = selectedRow ? getRowKey(selectedRow[0]) : null

  const updateRowTrapezoid = (field, rawValue) => {
    if (!selectedRowKey || !refinedArea?.panelConfig) return
    const value = parseFloat(rawValue)
    if (isNaN(value) || value < 0) return

    const globalCfg = refinedArea.panelConfig
    const current = rowConfigs[selectedRowKey] || {}
    const PANEL_LENGTH = 238.2
    const frontH = globalCfg.frontHeight || 0

    let newOverride = { ...current, [field]: value }
    // Two-way sync
    if (field === 'angle') {
      newOverride.backHeight = parseFloat((frontH + PANEL_LENGTH * Math.sin(value * Math.PI / 180)).toFixed(1))
    } else if (field === 'backHeight') {
      const derived = Math.asin((value - frontH) / PANEL_LENGTH) * 180 / Math.PI
      if (!isNaN(derived) && derived >= 0 && derived <= 30) {
        newOverride.angle = parseFloat(derived.toFixed(1))
      }
    }

    setRowConfigs(prev => ({ ...prev, [selectedRowKey]: newOverride }))

    // Recompute panel heights for this row when angle changes
    const effectiveAngle = newOverride.angle ?? globalCfg.angle
    if (effectiveAngle !== undefined && refinedArea.pixelToCmRatio) {
      const rowIds = selectedRow.map(p => p.id)
      setPanels(prev => prev.map(p => {
        if (!rowIds.includes(p.id)) return p
        const depthCm = p.heightCm || PANEL_LENGTH
        const newH = (depthCm * Math.cos(effectiveAngle * Math.PI / 180)) / refinedArea.pixelToCmRatio
        const cy = p.y + p.height / 2
        return { ...p, height: newH, y: cy - newH / 2 }
      }))
    }
  }

  const resetRowTrapezoid = () => {
    if (!selectedRowKey || !refinedArea?.panelConfig) return
    const globalCfg = refinedArea.panelConfig
    setRowConfigs(prev => {
      const next = { ...prev }
      delete next[selectedRowKey]
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
    if (dragState) return 'grabbing'
    if (rotationState) return 'crosshair'
    switch (activeTool) {
      case 'move': return 'grab'
      case 'rotate': return 'crosshair'
      case 'delete': return 'pointer'
      case 'add': return 'crosshair'
      case 'measure': return 'crosshair'
      default: return 'default'
    }
  }

  const handleSVGMouseDown = (e) => {
    const svg = e.currentTarget
    const rect = svg.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * imageRef.naturalWidth
    const y = ((e.clientY - rect.top) / rect.height) * imageRef.naturalHeight

    // Baseline drawing (always first)
    if (!baseline) { setBaseline({ p1: [x, y], p2: null }); return }
    if (baseline.p2 === null) { setBaseline({ ...baseline, p2: [x, y] }); return }

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
      }
      return
    }

    if (activeTool === 'move') {
      if (clickedPanel) {
        const rowIds = getRowPanelIds(clickedPanel.id)
        setSelectedPanels(rowIds)
        const originalPositions = {}
        rowIds.forEach(id => {
          const p = panels.find(p => p.id === id)
          if (p) originalPositions[id] = { x: p.x, y: p.y }
        })
        setDragState({ panelIds: rowIds, startX: x, startY: y, originalPositions })
      } else {
        setSelectedPanels([])
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
        setSelectedPanels([])
      }
      return
    }

    if (activeTool === 'add') {
      if (clickedPanel) {
        setSelectedPanels(getRowPanelIds(clickedPanel.id))
      } else {
        setSelectedPanels([])
      }
      return
    }
  }

  const handleSVGMouseMove = (e) => {
    const svg = e.currentTarget
    const rect = svg.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * imageRef.naturalWidth
    const y = ((e.clientY - rect.top) / rect.height) * imageRef.naturalHeight

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
        {uploadedImageData && roofPolygon && refinedArea ? (
          <div
            className="uploaded-image-view"
            style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%', overflow: 'auto' }}
          >
            <div
              className="uploaded-image-container"
              style={{ position: 'relative', display: 'inline-block', width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '100%' }}
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
                  transform: `rotate(${uploadedImageData.rotation}deg) scale(${uploadedImageData.scale * viewZoom})`,
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
                    transform: `rotate(${uploadedImageData.rotation}deg) scale(${uploadedImageData.scale * viewZoom})`,
                    cursor: getSVGCursor()
                  }}
                  onMouseDown={handleSVGMouseDown}
                  onMouseMove={handleSVGMouseMove}
                  onMouseUp={handleSVGMouseUp}
                  onMouseLeave={() => { setDragState(null); setRotationState(null) }}
                >
                  <defs>
                    <mask id="polygonMask">
                      <rect width="100%" height="100%" fill="white" />
                      <polygon
                        points={roofPolygon.coordinates.map(c => `${c[0]},${c[1]}`).join(' ')}
                        fill="black"
                      />
                    </mask>
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
                  <rect width="100%" height="100%" fill="rgba(0,0,0,0.6)" mask="url(#polygonMask)" />
                  <polygon
                    points={roofPolygon.coordinates.map(c => `${c[0]},${c[1]}`).join(' ')}
                    fill="rgba(196,214,0,0.1)"
                    stroke="#C4D600"
                    strokeWidth="3"
                  />

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
                    const rowNum = (panelToRowMap.get(panel.id) ?? 0) + 1
                    const rowKey = getRowKey(panel)
                    const hasOverride = !!rowConfigs[rowKey]

                    let fill, stroke, strokeWidth
                    if (isHovered) {
                      fill = 'rgba(244, 67, 54, 0.65)'; stroke = '#f44336'; strokeWidth = '1'
                    } else if (isSelected) {
                      fill = 'rgba(100, 180, 255, 0.75)'; stroke = '#0066CC'; strokeWidth = '2'
                    } else {
                      fill = 'rgba(135, 206, 235, 0.5)'; stroke = '#4682B4'; strokeWidth = '1'
                    }

                    const opacity = hasSelection && !isSelected ? 0.45 : 1

                    // Badge sizing proportional to the narrower panel dimension
                    const bh = panel.width * 0.36
                    const bw = bh * (rowNum >= 10 ? 2.4 : 1.9)
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
                              {rowNum}
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
        {uploadedImageData && roofPolygon && refinedArea && (
          <div style={{
            position: 'absolute', top: '20px', left: '20px', width: '255px',
            padding: '1.25rem',
            background: 'white', borderRadius: '12px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            border: '2px solid #C4D600',
            maxHeight: 'calc(100vh - 120px)', overflowY: 'auto'
          }}>
            <h3 style={{ margin: '0 0 1rem 0', color: '#555', fontSize: '1rem', fontWeight: '700' }}>
              Panel Layout
            </h3>

            {/* State: drawing baseline */}
            {(!baseline || !baseline.p2) && (
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

            {/* State: baseline ready, no panels */}
            {baseline?.p2 && panels.length === 0 && (
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

                {/* Row list */}
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{
                    fontSize: '0.72rem', fontWeight: '700', color: '#aaa',
                    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem'
                  }}>
                    Rows ({rows.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                    {rows.map((row, i) => {
                      const isRowSelected = selectedRowIndex === i
                      const rowKey = getRowKey(row[0])
                      const hasOverride = !!rowConfigs[rowKey]
                      return (
                        <button
                          key={i}
                          onClick={() => setSelectedPanels(row.map(p => p.id))}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                            padding: '0.45rem 0.7rem',
                            background: isRowSelected ? '#f4f9e4' : '#f8f9fa',
                            border: `2px solid ${isRowSelected ? '#C4D600' : 'transparent'}`,
                            borderRadius: '8px', cursor: 'pointer', textAlign: 'left',
                            transition: 'all 0.12s'
                          }}
                        >
                          <span style={{
                            width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
                            background: isRowSelected ? '#C4D600' : '#ccc'
                          }} />
                          <span style={{ fontSize: '0.82rem', fontWeight: '600', color: '#444' }}>
                            Row {i + 1}
                          </span>
                          {hasOverride && (
                            <span title="Custom trapezoid" style={{
                              width: '6px', height: '6px', borderRadius: '50%',
                              background: '#FF9800', flexShrink: 0
                            }} />
                          )}
                          <span style={{ fontSize: '0.75rem', color: '#999', marginLeft: 'auto' }}>
                            {row.length} panels
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Layout actions */}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => { setBaseline(null); setPanels([]); setSelectedPanels([]) }}
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
                    onClick={generatePanelLayoutHandler}
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
          </div>
        )}

        {/* ── RIGHT PANEL ─────────────────────────────────────────────────────── */}
        {uploadedImageData && roofPolygon && refinedArea && baseline?.p2 && (
          <div style={{
            position: 'absolute', top: '20px', right: '20px', width: '225px',
            padding: '1rem',
            background: 'white', borderRadius: '12px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            border: '2px solid #C4D600'
          }}>

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
                      Row {selectedRowIndex !== null ? selectedRowIndex + 1 : '?'}
                      <span style={{ fontWeight: '400', color: '#888' }}> · {selectedPanels.length} panels</span>
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
                  </div>
                ) : (
                  <div style={{ fontSize: '0.82rem', color: '#bbb', textAlign: 'center', paddingTop: '0.75rem' }}>
                    Click a row to select it
                  </div>
                )
              )}

              {/* Rotate tool */}
              {activeTool === 'rotate' && (
                selectedPanels.length > 0 ? (
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: '700', color: '#333', marginBottom: '0.4rem' }}>
                      Row {selectedRowIndex !== null ? selectedRowIndex + 1 : '?'}
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
                    Click a row to select it
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
                      Row {selectedRowIndex !== null ? selectedRowIndex + 1 : '?'}
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
                      ＋ Add to Row {selectedRowIndex !== null ? selectedRowIndex + 1 : ''}
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

            {/* Per-row trapezoid editor */}
            {selectedRow && activeTool !== 'measure' && (() => {
              const globalCfg = refinedArea?.panelConfig || {}
              const override = rowConfigs[selectedRowKey] || {}
              const isOverridden = !!rowConfigs[selectedRowKey]
              const angle = override.angle ?? globalCfg.angle ?? 0
              const backHeight = override.backHeight ?? globalCfg.backHeight ?? 0
              const frontHeight = globalCfg.frontHeight ?? 0

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
                      Row {(selectedRowIndex ?? 0) + 1} Trapezoid
                    </span>
                    {isOverridden && (
                      <button
                        onClick={resetRowTrapezoid}
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
                    const globalCfg2 = refinedArea?.panelConfig || {}
                    const effectiveLinesPerRow = globalCfg2.linesPerRow || 1
                    const effectiveLineOrientations = globalCfg2.lineOrientations || ['vertical']
                    const lineDepths = effectiveLineOrientations.slice(0, effectiveLinesPerRow)
                      .map(o => o === 'vertical' ? 238.2 : 113.4)
                    const angleRad2 = angle * Math.PI / 180
                    const totalSlope = lineDepths.reduce((s, d) => s + d, 0) + (effectiveLinesPerRow - 1) * 2.5
                    const totalHoriz = totalSlope * Math.cos(angleRad2)
                    const scaleW2 = totalHoriz > 0 ? (W - 30) / totalHoriz : 1
                    const scaleH2 = backHeight > 0 ? (H - 18) / backHeight : 1
                    const sc = Math.min(scaleW2, scaleH2)
                    // Build segments
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
                    const finalX = sx, finalTopY = sy
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

                  {/* Inputs */}
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.65rem', color: '#aaa', marginBottom: '2px' }}>Angle (°)</div>
                      <input
                        type="number" min="0" max="30" step="0.5"
                        value={angle}
                        onChange={e => updateRowTrapezoid('angle', e.target.value)}
                        style={{
                          width: '100%', padding: '0.3rem 0.4rem', boxSizing: 'border-box',
                          border: `1px solid ${isOverridden ? '#FFB74D' : '#ddd'}`,
                          borderRadius: '5px', fontSize: '0.82rem', fontWeight: '600'
                        }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.65rem', color: '#aaa', marginBottom: '2px' }}>Back H (cm)</div>
                      <input
                        type="number" min="0" step="0.5"
                        value={backHeight}
                        onChange={e => updateRowTrapezoid('backHeight', e.target.value)}
                        style={{
                          width: '100%', padding: '0.3rem 0.4rem', boxSizing: 'border-box',
                          border: `1px solid ${isOverridden ? '#FFB74D' : '#ddd'}`,
                          borderRadius: '5px', fontSize: '0.82rem', fontWeight: '600'
                        }}
                      />
                    </div>
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
                  onClick={() => setViewZoom(1)}
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
          </div>
        )}
      </div>
    </>
  )
}
