import React from 'react'
import { detectRows, snapPanelsToRows } from '../../utils/panelUtils'

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
  addManualPanel
}) {
  return (
    <>
      <div className="step-content-area" style={{ position: 'relative' }}>
        {uploadedImageData && roofPolygon && refinedArea ? (
          <div className="uploaded-image-view" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%', overflow: 'auto' }}>
            <div 
              className="uploaded-image-container" 
              style={{ position: 'relative', display: 'inline-block', width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '100%' }}
              onWheel={(e) => {
                e.preventDefault()
                const delta = e.deltaY > 0 ? -0.1 : 0.1
                const newZoom = Math.max(0.5, Math.min(3, viewZoom + delta))
                setViewZoom(newZoom)
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
              
              {/* SVG overlay for polygon and panels */}
              {imageRef && (
                <svg
                  viewBox={`0 0 ${imageRef.naturalWidth} ${imageRef.naturalHeight}`}
                  preserveAspectRatio="xMidYMid meet"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'auto',
                    transform: `rotate(${uploadedImageData.rotation}deg) scale(${uploadedImageData.scale * viewZoom})`,
                    cursor: dragState ? 'move' : 'default'
                  }}
                  onMouseDown={(e) => {
                    const svg = e.currentTarget
                    const rect = svg.getBoundingClientRect()
                    const x = ((e.clientX - rect.left) / rect.width) * imageRef.naturalWidth
                    const y = ((e.clientY - rect.top) / rect.height) * imageRef.naturalHeight
                    
                    // If baseline is not complete, capture baseline points
                    if (!baseline) {
                      setBaseline({ p1: [x, y], p2: null })
                      return
                    }
                    if (baseline && baseline.p2 === null) {
                      setBaseline({ ...baseline, p2: [x, y] })
                      return
                    }
                    
                    // If Ctrl/Cmd key is held, capture distance measurement points
                    if ((e.ctrlKey || e.metaKey) && showDistances) {
                      if (!distanceMeasurement) {
                        setDistanceMeasurement({ p1: [x, y], p2: null })
                        return
                      }
                      if (distanceMeasurement && distanceMeasurement.p2 === null) {
                        setDistanceMeasurement({ ...distanceMeasurement, p2: [x, y] })
                        return
                      }
                    }
                    
                    // Check if clicking on a rotation icon (top-right corner of selected panels)
                    let clickedRotationHandle = null
                    const iconSize = 10
                    const iconPadding = 3
                    
                    for (const panel of panels) {
                      if (selectedPanels.includes(panel.id)) {
                        const centerX = panel.x + panel.width / 2
                        const centerY = panel.y + panel.height / 2
                        const rotation = (panel.rotation || 0) * Math.PI / 180
                        
                        // Icon position in unrotated space (top-right corner)
                        const iconLocalX = panel.x + panel.width - iconPadding - iconSize / 2
                        const iconLocalY = panel.y + iconPadding + iconSize / 2
                        
                        // Rotate icon position around panel center
                        const dx = iconLocalX - centerX
                        const dy = iconLocalY - centerY
                        const iconX = centerX + dx * Math.cos(rotation) - dy * Math.sin(rotation)
                        const iconY = centerY + dx * Math.sin(rotation) + dy * Math.cos(rotation)
                        
                        const distance = Math.sqrt(Math.pow(x - iconX, 2) + Math.pow(y - iconY, 2))
                        if (distance <= iconSize / 2) {
                          clickedRotationHandle = panel
                          break
                        }
                      }
                    }
                    
                    if (clickedRotationHandle) {
                      // Start group rotation - anchor panel is the one whose handle was clicked
                      const anchorCenterX = clickedRotationHandle.x + clickedRotationHandle.width / 2
                      const anchorCenterY = clickedRotationHandle.y + clickedRotationHandle.height / 2
                      const startAngle = Math.atan2(y - anchorCenterY, x - anchorCenterX) * (180 / Math.PI)
                      
                      // Store original rotations and positions for all selected panels
                      const originalData = {}
                      selectedPanels.forEach(id => {
                        const panel = panels.find(p => p.id === id)
                        if (panel) {
                          const panelCenterX = panel.x + panel.width / 2
                          const panelCenterY = panel.y + panel.height / 2
                          originalData[id] = {
                            rotation: panel.rotation || 0,
                            centerX: panelCenterX,
                            centerY: panelCenterY,
                            x: panel.x,
                            y: panel.y
                          }
                        }
                      })
                      
                      setRotationState({
                        anchorPanelId: clickedRotationHandle.id,
                        panelIds: selectedPanels,
                        anchorCenterX,
                        anchorCenterY,
                        startAngle,
                        originalData
                      })
                      return
                    }
                    
                    // Check if clicking on a panel
                    const clickedPanel = panels.find(panel => 
                      x >= panel.x && x <= panel.x + panel.width &&
                      y >= panel.y && y <= panel.y + panel.height
                    )
                    
                    if (clickedPanel) {
                      // Handle multi-select with Shift key
                      if (e.shiftKey) {
                        if (selectedPanels.includes(clickedPanel.id)) {
                          setSelectedPanels(selectedPanels.filter(id => id !== clickedPanel.id))
                        } else {
                          setSelectedPanels([...selectedPanels, clickedPanel.id])
                        }
                      } else {
                        // Single select (or start drag)
                        const panelsToMove = selectedPanels.includes(clickedPanel.id) 
                          ? selectedPanels 
                          : [clickedPanel.id]
                        
                        setSelectedPanels(panelsToMove)
                        
                        // Start drag
                        const originalPositions = {}
                        panelsToMove.forEach(id => {
                          const panel = panels.find(p => p.id === id)
                          if (panel) {
                            originalPositions[id] = { x: panel.x, y: panel.y }
                          }
                        })
                        
                        setDragState({
                          panelIds: panelsToMove,
                          startX: x,
                          startY: y,
                          originalPositions
                        })
                      }
                    } else {
                      // Clicked on empty space - deselect all
                      if (!e.shiftKey) {
                        setSelectedPanels([])
                      }
                    }
                  }}
                  onMouseMove={(e) => {
                    if (rotationState) {
                      const svg = e.currentTarget
                      const rect = svg.getBoundingClientRect()
                      const x = ((e.clientX - rect.left) / rect.width) * imageRef.naturalWidth
                      const y = ((e.clientY - rect.top) / rect.height) * imageRef.naturalHeight
                      
                      // Calculate current angle relative to anchor center
                      const currentAngle = Math.atan2(y - rotationState.anchorCenterY, x - rotationState.anchorCenterX) * (180 / Math.PI)
                      const angleDelta = currentAngle - rotationState.startAngle
                      const angleRad = angleDelta * (Math.PI / 180)
                      
                      // Update panel rotations AND positions (group rotation around anchor)
                      setPanels(prevPanels => prevPanels.map(panel => {
                        if (rotationState.panelIds.includes(panel.id)) {
                          const originalData = rotationState.originalData[panel.id]
                          
                          // Calculate relative position from anchor center
                          const relX = originalData.centerX - rotationState.anchorCenterX
                          const relY = originalData.centerY - rotationState.anchorCenterY
                          
                          // Rotate the relative position
                          const rotatedRelX = relX * Math.cos(angleRad) - relY * Math.sin(angleRad)
                          const rotatedRelY = relX * Math.sin(angleRad) + relY * Math.cos(angleRad)
                          
                          // Calculate new center position
                          const newCenterX = rotationState.anchorCenterX + rotatedRelX
                          const newCenterY = rotationState.anchorCenterY + rotatedRelY
                          
                          // Calculate new top-left position
                          const newX = newCenterX - panel.width / 2
                          const newY = newCenterY - panel.height / 2
                          
                          return {
                            ...panel,
                            x: newX,
                            y: newY,
                            rotation: (originalData.rotation + angleDelta) % 360
                          }
                        }
                        return panel
                      }))
                    } else if (dragState) {
                      const svg = e.currentTarget
                      const rect = svg.getBoundingClientRect()
                      const x = ((e.clientX - rect.left) / rect.width) * imageRef.naturalWidth
                      const y = ((e.clientY - rect.top) / rect.height) * imageRef.naturalHeight
                      
                      const deltaX = x - dragState.startX
                      const deltaY = y - dragState.startY
                      
                      // Update panel positions
                      setPanels(prevPanels => prevPanels.map(panel => {
                        if (dragState.panelIds.includes(panel.id)) {
                          return {
                            ...panel,
                            x: dragState.originalPositions[panel.id].x + deltaX,
                            y: dragState.originalPositions[panel.id].y + deltaY
                          }
                        }
                        return panel
                      }))
                    }
                  }}
                  onMouseUp={() => {
                    // Apply row snapping if panels were dragged
                    if (dragState && dragState.panelIds && refinedArea && refinedArea.pixelToCmRatio) {
                      const snappedPanels = snapPanelsToRows(panels, dragState.panelIds, refinedArea.pixelToCmRatio)
                      setPanels(snappedPanels)
                    }
                    
                    setDragState(null)
                    setRotationState(null)
                  }}
                  onMouseLeave={() => {
                    setDragState(null)
                    setRotationState(null)
                  }}
                >
                  {/* Mask: darken everything outside polygon */}
                  <defs>
                    <mask id="polygonMask">
                      <rect width="100%" height="100%" fill="white"/>
                      <polygon
                        points={roofPolygon.coordinates.map(coord => `${coord[0]},${coord[1]}`).join(' ')}
                        fill="black"
                      />
                    </mask>
                  </defs>
                  
                  {/* Semi-transparent overlay outside polygon */}
                  <rect 
                    width="100%" 
                    height="100%" 
                    fill="rgba(0, 0, 0, 0.6)" 
                    mask="url(#polygonMask)"
                  />
                  
                  {/* Polygon outline */}
                  <polygon
                    points={roofPolygon.coordinates.map(coord => `${coord[0]},${coord[1]}`).join(' ')}
                    fill="rgba(196, 214, 0, 0.1)"
                    stroke="#C4D600"
                    strokeWidth="3"
                  />
                  
                  {/* User-drawn baseline */}
                  {showBaseline && baseline && baseline.p1 && baseline.p2 && (
                    <>
                      <line
                        x1={baseline.p1[0]}
                        y1={baseline.p1[1]}
                        x2={baseline.p2[0]}
                        y2={baseline.p2[1]}
                        stroke="#FF0000"
                        strokeWidth="2"
                        strokeDasharray="8,4"
                      />
                      {/* Start point marker */}
                      <circle
                        cx={baseline.p1[0]}
                        cy={baseline.p1[1]}
                        r="4"
                        fill="#FF0000"
                        stroke="white"
                        strokeWidth="1.5"
                      />
                      {/* End point marker */}
                      <circle
                        cx={baseline.p2[0]}
                        cy={baseline.p2[1]}
                        r="4"
                        fill="#FF0000"
                        stroke="white"
                        strokeWidth="1.5"
                      />
                    </>
                  )}
                  
                  {/* Temporary baseline point while drawing */}
                  {baseline && baseline.p1 && !baseline.p2 && (
                    <circle
                      cx={baseline.p1[0]}
                      cy={baseline.p1[1]}
                      r="4"
                      fill="#FF0000"
                      stroke="white"
                      strokeWidth="1.5"
                    />
                  )}
                  
                  {/* Baseline length measurement - shown with baseline */}
                  {showBaseline && showDistances && baseline && baseline.p1 && baseline.p2 && refinedArea && (() => {
                    const { pixelToCmRatio } = refinedArea
                    const baselineLengthPx = Math.sqrt(
                      Math.pow(baseline.p2[0] - baseline.p1[0], 2) +
                      Math.pow(baseline.p2[1] - baseline.p1[1], 2)
                    )
                    const baselineLengthCm = baselineLengthPx * pixelToCmRatio
                    const midX = (baseline.p1[0] + baseline.p2[0]) / 2
                    const midY = (baseline.p1[1] + baseline.p2[1]) / 2
                    
                    return (
                      <g>
                        <rect
                          x={midX - 40}
                          y={midY + 15}
                          width="80"
                          height="24"
                          fill="white"
                          stroke="#FF0000"
                          strokeWidth="1.5"
                          rx="4"
                        />
                        <text
                          x={midX}
                          y={midY + 32}
                          textAnchor="middle"
                          fill="#FF0000"
                          fontSize="12"
                          fontWeight="600"
                        >
                          {baselineLengthCm.toFixed(0)} cm
                        </text>
                      </g>
                    )
                  })()}
                  
                  {/* Solar panels */}
                  {(() => {
                    // Calculate rows for debugging
                    const rows = refinedArea && refinedArea.pixelToCmRatio ? detectRows(panels, refinedArea.pixelToCmRatio) : []
                    const panelToRowMap = new Map()
                    rows.forEach((row, rowIndex) => {
                      row.forEach(panel => {
                        panelToRowMap.set(panel.id, rowIndex + 1)
                      })
                    })
                    
                    return panels.map(panel => {
                      const centerX = panel.x + panel.width / 2
                      const centerY = panel.y + panel.height / 2
                      const rotation = panel.rotation || 0
                      const iconSize = 10 // Size of rotation icon (reduced)
                      const iconPadding = 3 // Distance from corner
                      const rowNumber = panelToRowMap.get(panel.id) || '?'
                      
                      return (
                        <g key={panel.id} transform={`rotate(${rotation} ${centerX} ${centerY})`}>
                          {/* Panel rectangle */}
                          <rect
                            x={panel.x}
                            y={panel.y}
                            width={panel.width}
                            height={panel.height}
                            fill={selectedPanels.includes(panel.id) ? 'rgba(100, 180, 255, 0.7)' : 'rgba(135, 206, 235, 0.6)'}
                            stroke={selectedPanels.includes(panel.id) ? '#0066CC' : '#4682B4'}
                            strokeWidth={selectedPanels.includes(panel.id) ? '3' : '1.5'}
                            style={{ cursor: 'move' }}
                          />
                          
                          {/* Row number label for debugging */}
                          <text
                            x={panel.x + panel.width / 2}
                            y={panel.y + panel.height / 2}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fontSize="12"
                            fontWeight="bold"
                            fill="white"
                            stroke="black"
                            strokeWidth="0.5"
                            style={{ pointerEvents: 'none' }}
                          >
                            {rowNumber}
                          </text>
                          
                          {/* Rotation icon in top-right corner */}
                          {selectedPanels.includes(panel.id) && (
                          <g>
                            {/* Icon background circle */}
                            <circle
                              cx={panel.x + panel.width - iconPadding - iconSize / 2}
                              cy={panel.y + iconPadding + iconSize / 2}
                              r={iconSize / 2}
                              fill="#FF9800"
                              stroke="white"
                              strokeWidth="1.5"
                              style={{ cursor: 'grab' }}
                            />
                            {/* Circular arrow icon */}
                            <path
                              d={`M ${panel.x + panel.width - iconPadding - iconSize / 2 - 3} ${panel.y + iconPadding + iconSize / 2} A 3 3 0 1 1 ${panel.x + panel.width - iconPadding - iconSize / 2 + 3} ${panel.y + iconPadding + iconSize / 2}`}
                              fill="none"
                              stroke="white"
                              strokeWidth="1"
                              strokeLinecap="round"
                              style={{ cursor: 'grab', pointerEvents: 'none' }}
                            />
                            {/* Arrow head */}
                            <path
                              d={`M ${panel.x + panel.width - iconPadding - iconSize / 2 + 3} ${panel.y + iconPadding + iconSize / 2} l -1.5 -1.5 m 1.5 1.5 l 1.5 -1.5`}
                              fill="none"
                              stroke="white"
                              strokeWidth="1"
                              strokeLinecap="round"
                              style={{ pointerEvents: 'none' }}
                            />
                          </g>
                        )}
                      </g>
                    )
                  })})()}
                  
                  {/* Distance measurement - user drawn */}
                  {showDistances && distanceMeasurement && refinedArea && (() => {
                    const { pixelToCmRatio } = refinedArea
                    const { p1, p2 } = distanceMeasurement
                    
                    if (!p2) {
                      // Show first point only
                      return (
                        <circle
                          cx={p1[0]}
                          cy={p1[1]}
                          r="4"
                          fill="#2196F3"
                          stroke="white"
                          strokeWidth="2"
                        />
                      )
                    }
                    
                    // Calculate distance
                    const distancePx = Math.sqrt(
                      Math.pow(p2[0] - p1[0], 2) + Math.pow(p2[1] - p1[1], 2)
                    )
                    const distanceCm = distancePx * pixelToCmRatio
                    const distanceM = (distanceCm / 100).toFixed(2)
                    
                    const midX = (p1[0] + p2[0]) / 2
                    const midY = (p1[1] + p2[1]) / 2
                    
                    return (
                      <>
                        <defs>
                          <marker
                            id="distance-arrow-start"
                            markerWidth="10"
                            markerHeight="10"
                            refX="5"
                            refY="5"
                            orient="auto"
                          >
                            <polygon points="5,2 5,8 2,5" fill="#2196F3" />
                          </marker>
                          <marker
                            id="distance-arrow-end"
                            markerWidth="10"
                            markerHeight="10"
                            refX="5"
                            refY="5"
                            orient="auto"
                          >
                            <polygon points="5,2 5,8 8,5" fill="#2196F3" />
                          </marker>
                        </defs>
                        
                        {/* Distance line with arrows */}
                        <line
                          x1={p1[0]}
                          y1={p1[1]}
                          x2={p2[0]}
                          y2={p2[1]}
                          stroke="#2196F3"
                          strokeWidth="3"
                          markerStart="url(#distance-arrow-start)"
                          markerEnd="url(#distance-arrow-end)"
                        />
                        
                        {/* Endpoint circles */}
                        <circle
                          cx={p1[0]}
                          cy={p1[1]}
                          r="4"
                          fill="#2196F3"
                          stroke="white"
                          strokeWidth="2"
                        />
                        <circle
                          cx={p2[0]}
                          cy={p2[1]}
                          r="4"
                          fill="#2196F3"
                          stroke="white"
                          strokeWidth="2"
                        />
                        
                        {/* Distance label */}
                        <g>
                          <rect
                            x={midX - 45}
                            y={midY - 18}
                            width="90"
                            height="36"
                            fill="white"
                            stroke="#2196F3"
                            strokeWidth="2"
                            rx="6"
                          />
                          <text
                            x={midX}
                            y={midY - 2}
                            textAnchor="middle"
                            fill="#2196F3"
                            fontSize="14"
                            fontWeight="700"
                          >
                            {distanceCm.toFixed(0)} cm
                          </text>
                          <text
                            x={midX}
                            y={midY + 12}
                            textAnchor="middle"
                            fill="#666"
                            fontSize="11"
                            fontWeight="600"
                          >
                            ({distanceM} m)
                          </text>
                        </g>
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

        {/* Left Panel: Statistics */}
        {uploadedImageData && roofPolygon && refinedArea && (
          <div style={{ 
            position: 'absolute',
            top: '20px',
            left: '20px',
            width: '300px',
            padding: '1.5rem', 
            background: 'white',
            borderRadius: '12px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            border: '2px solid #C4D600'
          }}>
            <h3 style={{ margin: '0 0 1rem 0', color: '#666666', fontSize: '1.1rem' }}>
              Panel Layout
            </h3>
            
            {!baseline || !baseline.p2 ? (
              <>
                <div style={{ 
                  padding: '1rem', 
                  background: '#FFF3E0',
                  borderRadius: '8px',
                  marginBottom: '1rem',
                  border: '2px solid #FF9800'
                }}>
                  <h4 style={{ margin: '0 0 0.5rem 0', color: '#E65100', fontSize: '0.95rem' }}>
                    📍 Step 1: Draw Baseline
                  </h4>
                  <p style={{ fontSize: '0.85rem', color: '#666', margin: '0 0 0.75rem 0' }}>
                    Click <strong>two points</strong> on the roof to define the baseline for the first row of panels:
                  </p>
                  <ol style={{ margin: '0', paddingLeft: '1.25rem', fontSize: '0.85rem', color: '#666' }}>
                    <li style={{ marginBottom: '0.25rem' }}>Click the <strong>starting point</strong> (usually southwest corner)</li>
                    <li>Click the <strong>ending point</strong> (usually southeast corner)</li>
                  </ol>
                  {baseline && baseline.p1 && !baseline.p2 && (
                    <p style={{ fontSize: '0.85rem', color: '#FF9800', margin: '0.75rem 0 0 0', fontWeight: '600' }}>
                      ✓ First point set. Click the second point.
                    </p>
                  )}
                </div>
              </>
            ) : panels.length === 0 ? (
              <>
                <div style={{ 
                  padding: '1rem', 
                  background: '#E8F5E9',
                  borderRadius: '8px',
                  marginBottom: '1rem',
                  border: '2px solid #4CAF50'
                }}>
                  <p style={{ fontSize: '0.85rem', color: '#1B5E20', margin: '0', fontWeight: '600' }}>
                    ✓ Baseline drawn successfully!
                  </p>
                </div>
                <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>
                  Click the button below to automatically generate the panel layout based on your baseline.
                </p>
                <button
                  onClick={() => {
                    setBaseline(null)
                    setPanels([])
                  }}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    background: 'white',
                    color: '#666',
                    border: '2px solid #ddd',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: '600',
                    fontSize: '0.85rem',
                    marginBottom: '0.75rem'
                  }}
                >
                  🔄 Redraw Baseline
                </button>
                <button
                  onClick={() => setShowBaseline(!showBaseline)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    background: showBaseline ? '#FF0000' : 'white',
                    color: showBaseline ? 'white' : '#666',
                    border: '2px solid #FF0000',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: '600',
                    fontSize: '0.85rem',
                    marginBottom: '0.75rem'
                  }}
                >
                  {showBaseline ? '👁️ Hide Baseline' : '👁️ Show Baseline'}
                </button>
                <button
                  onClick={generatePanelLayoutHandler}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    background: '#C4D600',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: '600',
                    fontSize: '0.95rem'
                  }}
                >
                  Generate Panel Layout
                </button>
              </>
            ) : (
              <>
                <div style={{ 
                  padding: '1rem', 
                  background: '#f8f9fa',
                  borderRadius: '8px',
                  marginBottom: '1rem'
                }}>
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.25rem' }}>Total Panels</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#C4D600' }}>{panels.length}</div>
                  </div>
                  
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.25rem' }}>System Capacity</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#C4D600' }}>
                      {(panels.length * 0.67).toFixed(2)} kW
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#999' }}>670W per panel</div>
                  </div>
                  
                  <div>
                    <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.25rem' }}>Roof Coverage</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: '700', color: '#666' }}>
                      {(panels.length * 238.2 * 113.4 / 10000).toFixed(1)} m²
                    </div>
                  </div>
                </div>
                
                <button
                  onClick={() => {
                    setBaseline(null)
                    setPanels([])
                    setSelectedPanels([])
                  }}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    background: 'white',
                    color: '#666',
                    border: '2px solid #ddd',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: '600',
                    fontSize: '0.9rem',
                    marginBottom: '0.75rem'
                  }}
                >
                  🔄 Redraw Baseline & Reset
                </button>
                
                <div style={{ fontSize: '0.8rem', color: '#999', lineHeight: '1.4' }}>
                  <strong>Tips:</strong>
                  <ul style={{ margin: '0.5rem 0 0 0', paddingLeft: '1.25rem' }}>
                    <li>Click to select panels</li>
                    <li>Shift+click for multi-select</li>
                    <li>Drag panels to move</li>
                    <li>Click rotation icon to rotate</li>
                    <li>Use "Add Panel" for extra panels</li>
                  </ul>
                </div>
                
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                  <button
                    onClick={generatePanelLayoutHandler}
                    style={{
                      flex: 1,
                      padding: '0.65rem',
                      background: '#666',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      fontWeight: '600'
                    }}
                  >
                    🔄 Regenerate
                  </button>
                  <button
                    onClick={addManualPanel}
                    style={{
                      flex: 1,
                      padding: '0.65rem',
                      background: '#C4D600',
                      color: '#333',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      fontWeight: '600'
                    }}
                  >
                    ➕ Add Panel
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Right Panel: Controls */}
        {uploadedImageData && roofPolygon && refinedArea && baseline && baseline.p2 && (
          <div style={{ 
            position: 'absolute',
            top: '20px',
            right: '20px',
            width: '200px',
            padding: '1rem', 
            background: 'white',
            borderRadius: '12px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            border: '2px solid #C4D600'
          }}>
            <h3 style={{ margin: '0 0 1rem 0', color: '#666666', fontSize: '1rem' }}>
              Display Controls
            </h3>
            
            {/* Zoom Controls */}
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '0.5rem', fontWeight: '600' }}>
                🔍 Zoom: {(viewZoom * 100).toFixed(0)}%
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <button
                  onClick={() => setViewZoom(Math.max(0.5, viewZoom - 0.1))}
                  style={{
                    flex: 1,
                    padding: '0.5rem',
                    background: 'white',
                    color: '#666',
                    border: '2px solid #C4D600',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: '600',
                    fontSize: '0.9rem'
                  }}
                >
                  −
                </button>
                <button
                  onClick={() => setViewZoom(1)}
                  style={{
                    flex: 1,
                    padding: '0.5rem',
                    background: 'white',
                    color: '#666',
                    border: '2px solid #C4D600',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: '600',
                    fontSize: '0.75rem'
                  }}
                >
                  100%
                </button>
                <button
                  onClick={() => setViewZoom(Math.min(3, viewZoom + 0.1))}
                  style={{
                    flex: 1,
                    padding: '0.5rem',
                    background: 'white',
                    color: '#666',
                    border: '2px solid #C4D600',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: '600',
                    fontSize: '0.9rem'
                  }}
                >
                  +
                </button>
              </div>
              <div style={{ fontSize: '0.7rem', color: '#999', marginTop: '0.25rem' }}>
                💡 Use mouse wheel to zoom
              </div>
            </div>
            
            {/* Baseline & Distance Toggles */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
              <button
                onClick={() => setShowBaseline(!showBaseline)}
                style={{
                  padding: '0.65rem',
                  background: showBaseline ? '#FF0000' : 'white',
                  color: showBaseline ? 'white' : '#666',
                  border: '2px solid #FF0000',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '0.85rem'
                }}
              >
                {showBaseline ? '👁️ Baseline' : '👁️ Baseline'}
              </button>
              <button
                onClick={() => setShowDistances(!showDistances)}
                style={{
                  padding: '0.65rem',
                  background: showDistances ? '#2196F3' : 'white',
                  color: showDistances ? 'white' : '#666',
                  border: '2px solid #2196F3',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '0.85rem'
                }}
              >
                {showDistances ? '📏 Measure Distance' : '📏 Measure Distance'}
              </button>
              {showDistances && (
                <div style={{
                  padding: '0.75rem',
                  background: '#E3F2FD',
                  borderRadius: '6px',
                  border: '1px solid #2196F3',
                  fontSize: '0.75rem',
                  color: '#1565C0'
                }}>
                  <div style={{ fontWeight: '600', marginBottom: '0.25rem' }}>
                    💡 How to measure:
                  </div>
                  <div>
                    Hold {navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? 'Cmd' : 'Ctrl'} + click two points
                  </div>
                  {distanceMeasurement && distanceMeasurement.p2 && (
                    <button
                      onClick={() => setDistanceMeasurement(null)}
                      style={{
                        marginTop: '0.5rem',
                        width: '100%',
                        padding: '0.4rem',
                        background: 'white',
                        color: '#2196F3',
                        border: '1px solid #2196F3',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '0.75rem',
                        fontWeight: '600'
                      }}
                    >
                      🗑️ Clear Measurement
                    </button>
                  )}
                </div>
              )}
            </div>
            
            {/* Delete Selected Panel */}
            {selectedPanels.length > 0 && (
              <div style={{ 
                padding: '0.75rem', 
                background: '#ffebee',
                borderRadius: '8px',
                border: '1px solid #f44336'
              }}>
                <div style={{ fontSize: '0.85rem', color: '#c62828', fontWeight: '600', marginBottom: '0.5rem' }}>
                  {selectedPanels.length} selected
                </div>
                <button
                  onClick={() => {
                    setPanels(panels.filter(p => !selectedPanels.includes(p.id)))
                    setSelectedPanels([])
                  }}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    background: '#f44336',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: '600'
                  }}
                >
                  🗑️ Delete
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
