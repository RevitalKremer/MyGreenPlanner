import { useState, useRef, useEffect } from 'react'
import { useImagePanZoom } from '../../../hooks/useImagePanZoom'
import CanvasNavigator from '../../shared/CanvasNavigator'

export default function PanelCanvas({
  uploadedImageData, viewZoom, setViewZoom,
  imageRef, setImageRef,
  roofPolygon, baseline, setBaseline,
  panels, setPanels,
  selectedPanels, setSelectedPanels,
  dragState, setDragState,
  rotationState, setRotationState,
  distanceMeasurement, setDistanceMeasurement,
  showBaseline, showDistances,
  refinedArea, trapezoidConfigs,
  activeTool, projectMode,
  getRowPanelIds,
}) {
  const { panOffset, setPanOffset, panActive, setPanActive, panRef, viewportRef, MM_W, MM_H, panToMinimapPoint, getMinimapViewportRect } = useImagePanZoom(imageRef)
  const [isSpaceDown, setIsSpaceDown] = useState(false)
  const [hoveredPanelId, setHoveredPanelId] = useState(null)
  const [rectSelect, setRectSelect] = useState(null)
  const [mousePos, setMousePos] = useState(null)
  const willDeselectRef = useRef(false)

  // Space bar for pan-anywhere
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.code === 'Space' && !e.repeat &&
          e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault()
        setIsSpaceDown(true)
      }
    }
    const onKeyUp = (e) => { if (e.code === 'Space') setIsSpaceDown(false) }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp) }
  }, [])

  // ── Interaction helpers ───────────────────────────────────────────────────

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

  const svgCoords = (e) => {
    const svg = e.currentTarget
    const rect = svg.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * imageRef.naturalWidth,
      y: ((e.clientY - rect.top) / rect.height) * imageRef.naturalHeight,
    }
  }

  const handleSVGMouseDown = (e) => {
    if (e.button === 1 || (e.button === 0 && isSpaceDown)) { e.preventDefault(); startPan(e); return }

    const { x, y } = svgCoords(e)

    // Baseline drawing (scratch mode)
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

    const clickedPanel = panels.find(p => x >= p.x && x <= p.x + p.width && y >= p.y && y <= p.y + p.height)

    if (activeTool === 'delete') {
      if (clickedPanel) { setPanels(panels.filter(p => p.id !== clickedPanel.id)); setSelectedPanels([]) }
      else startPan(e)
      return
    }

    if (activeTool === 'move') {
      if (clickedPanel) {
        if (e.shiftKey) {
          setSelectedPanels(prev => prev.includes(clickedPanel.id) ? prev.filter(id => id !== clickedPanel.id) : [...prev, clickedPanel.id])
          return
        }
        const panelIds = selectedPanels.includes(clickedPanel.id) && selectedPanels.length > 0 ? selectedPanels : [clickedPanel.id]
        setSelectedPanels(panelIds)
        const originalPositions = {}
        panelIds.forEach(id => { const p = panels.find(p => p.id === id); if (p) originalPositions[id] = { x: p.x, y: p.y } })
        setDragState({ panelIds, startX: x, startY: y, originalPositions })
      } else {
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
          if (p) originalData[id] = { rotation: p.rotation || 0, centerX: p.x + p.width / 2, centerY: p.y + p.height / 2, x: p.x, y: p.y }
        })
        setRotationState({ panelIds: rowIds, anchorCenterX: cx, anchorCenterY: cy, startAngle, originalData })
      } else {
        startPan(e)
      }
      return
    }

    if (activeTool === 'add') {
      if (clickedPanel) setSelectedPanels(getRowPanelIds(clickedPanel.id))
      else startPan(e)
      return
    }
  }

  const handleSVGMouseMove = (e) => {
    const { x, y } = svgCoords(e)
    setMousePos({ x, y })

    if (rectSelect) { setRectSelect(prev => ({ ...prev, endX: x, endY: y })); return }

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
        return { ...panel, x: newCx - panel.width / 2, y: newCy - panel.height / 2, rotation: (od.rotation + angleDelta) % 360 }
      }))
    } else if (dragState) {
      const dx = x - dragState.startX, dy = y - dragState.startY
      setPanels(prev => prev.map(panel => {
        if (!dragState.panelIds.includes(panel.id)) return panel
        return { ...panel, x: dragState.originalPositions[panel.id].x + dx, y: dragState.originalPositions[panel.id].y + dy }
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
          const cx = p.x + p.width / 2, cy = p.y + p.height / 2
          return cx >= minX && cx <= maxX && cy >= minY && cy <= maxY
        }).map(p => p.id)
        setSelectedPanels(hit)
      } else {
        setSelectedPanels([])
      }
      setRectSelect(null); setDragState(null); setRotationState(null)
      return
    }

    if (willDeselectRef.current) { setSelectedPanels([]); willDeselectRef.current = false }
    panRef.current = null
    setPanActive(false)
    setDragState(null)
    setRotationState(null)
  }

  const handleMouseLeave = () => {
    setRectSelect(null); panRef.current = null; setPanActive(false); willDeselectRef.current = false; setDragState(null); setRotationState(null); setMousePos(null)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="uploaded-image-view"
      ref={viewportRef}
      style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%', overflow: 'auto', position: 'relative' }}
    >
      <div
        className="uploaded-image-container"
        style={{ position: 'relative', display: 'inline-block', width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '100%', transform: `translate(${panOffset.x}px, ${panOffset.y}px)` }}
        onWheel={(e) => { e.preventDefault(); const delta = e.deltaY > 0 ? -0.1 : 0.1; setViewZoom(Math.max(0.5, Math.min(3, viewZoom + delta))) }}
      >
        <img
          ref={(el) => { if (el) setImageRef(el) }}
          src={uploadedImageData.imageData}
          alt="Roof with panels"
          style={{
            display: 'block',
            transform: `rotate(${uploadedImageData.rotation ?? 0}deg) scale(${(uploadedImageData.scale ?? 1) * viewZoom})`,
            maxWidth: '100%', maxHeight: 'calc(100vh - 250px)',
            width: 'auto', height: 'auto', cursor: 'default'
          }}
        />

        {imageRef && (() => {
          const dotR     = Math.max(2, imageRef.naturalWidth * 0.002)
          const lineW    = Math.max(1, imageRef.naturalWidth * 0.001)
          const dashArray = `${Math.max(6, imageRef.naturalWidth * 0.006)},${Math.max(3, imageRef.naturalWidth * 0.003)}`
          return (<svg
            viewBox={`0 0 ${imageRef.naturalWidth} ${imageRef.naturalHeight}`}
            preserveAspectRatio="xMidYMid meet"
            style={{
              position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
              pointerEvents: 'auto',
              transform: `rotate(${uploadedImageData.rotation ?? 0}deg) scale(${(uploadedImageData.scale ?? 1) * viewZoom})`,
              cursor: getSVGCursor()
            }}
            onMouseDown={handleSVGMouseDown}
            onMouseMove={handleSVGMouseMove}
            onMouseUp={handleSVGMouseUp}
            onMouseLeave={handleMouseLeave}
          >
            <defs>
              {roofPolygon && (
                <mask id="polygonMask">
                  <rect width="100%" height="100%" fill="white" />
                  <polygon points={roofPolygon.coordinates.map(c => `${c[0]},${c[1]}`).join(' ')} fill="black" />
                </mask>
              )}
              {showDistances && distanceMeasurement?.p2 && (
                <>
                  <marker id="dist-arrow-start" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                    <polygon points="3,1 3,5 1,3" fill="#C4D600" />
                  </marker>
                  <marker id="dist-arrow-end" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                    <polygon points="3,1 3,5 5,3" fill="#C4D600" />
                  </marker>
                </>
              )}
            </defs>

            {/* Roof polygon overlay */}
            {roofPolygon && (
              <>
                <rect width="100%" height="100%" fill="rgba(0,0,0,0.6)" mask="url(#polygonMask)" />
                <polygon points={roofPolygon.coordinates.map(c => `${c[0]},${c[1]}`).join(' ')} fill="rgba(196,214,0,0.1)" stroke="#C4D600" strokeWidth="3" />
              </>
            )}

            {/* Baseline */}
            {showBaseline && baseline?.p1 && baseline?.p2 && (
              <>
                <line x1={baseline.p1[0]} y1={baseline.p1[1]} x2={baseline.p2[0]} y2={baseline.p2[1]} stroke="#FF00FF" strokeWidth={lineW} strokeDasharray={dashArray} />
                <circle cx={baseline.p1[0]} cy={baseline.p1[1]} r={dotR} fill="#FF00FF" />
                <circle cx={baseline.p2[0]} cy={baseline.p2[1]} r={dotR} fill="#FF00FF" />
              </>
            )}
            {baseline?.p1 && !baseline?.p2 && (
              <>
                <circle cx={baseline.p1[0]} cy={baseline.p1[1]} r={dotR} fill="#FF00FF" />
                {mousePos && (
                  <line x1={baseline.p1[0]} y1={baseline.p1[1]} x2={mousePos.x} y2={mousePos.y} stroke="#FF00FF" strokeWidth={lineW} strokeDasharray={dashArray} />
                )}
              </>
            )}

            {/* Ghost panels (empty lines) */}
            {panels.filter(p => p.isEmpty).map(panel => {
              const cx = panel.x + panel.width / 2, cy = panel.y + panel.height / 2
              const ibw = panel.width * 0.004
              return (
                <g key={panel.id} transform={`rotate(${panel.rotation || 0} ${cx} ${cy})`} style={{ pointerEvents: 'none' }}>
                  <rect x={panel.x + ibw / 2} y={panel.y + ibw / 2} width={panel.width - ibw} height={panel.height - ibw}
                    fill="none" stroke="#aaaaaa" strokeWidth={ibw} strokeDasharray={`${ibw * 6} ${ibw * 3}`} />
                </g>
              )
            })}

            {/* Solar panels */}
            {panels.filter(p => !p.isEmpty).map(panel => {
              const isSelected = selectedPanels.includes(panel.id)
              const hasSelection = selectedPanels.length > 0
              const isHovered = activeTool === 'delete' && hoveredPanelId === panel.id
              const cx = panel.x + panel.width / 2, cy = panel.y + panel.height / 2
              const trapId = panel.trapezoidId || 'A1'
              const hasOverride = !!trapezoidConfigs?.[trapId]
              let fill, borderColor, ibw
              if (isHovered)       { fill = 'rgba(244, 67, 54, 0.65)'; borderColor = '#f44336'; ibw = panel.width * 0.012 }
              else if (isSelected) { fill = 'rgba(0,62,126,0.18)';     borderColor = '#003e7e'; ibw = panel.width * 0.025 }
              else                 { fill = 'rgba(135, 206, 235, 0.35)'; borderColor = '#4682B4'; ibw = panel.width * 0.012 }
              const opacity = hasSelection && !isSelected ? 0.45 : 1
              const bh = Math.min(panel.width, panel.height) * 0.36
              const bw = bh * (trapId.length > 2 ? 2.8 : 1.9)
              const fs = bh * 0.62
              return (
                <g key={panel.id} style={{ opacity }}>
                  <g transform={`rotate(${panel.rotation || 0} ${cx} ${cy})`}>
                    <rect
                      x={panel.x} y={panel.y} width={panel.width} height={panel.height}
                      fill={fill} stroke="none"
                      style={{ cursor: activeTool === 'delete' ? 'pointer' : activeTool === 'move' ? 'grab' : 'default' }}
                      onMouseEnter={() => activeTool === 'delete' && setHoveredPanelId(panel.id)}
                      onMouseLeave={() => setHoveredPanelId(null)}
                    />
                    <rect
                      x={panel.x + ibw / 2} y={panel.y + ibw / 2}
                      width={panel.width - ibw} height={panel.height - ibw}
                      fill="none" stroke={borderColor} strokeWidth={ibw}
                      style={{ pointerEvents: 'none' }}
                    />
                  </g>
                  {!isHovered && (
                    <>
                      <rect x={cx - bw / 2} y={cy - bh / 2} width={bw} height={bh} rx={bh / 2}
                        fill={isSelected ? 'rgba(0,62,126,0.82)' : 'rgba(15,15,15,0.55)'}
                        style={{ pointerEvents: 'none' }} />
                      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                        fontSize={fs} fontWeight="600" fill="white"
                        style={{ pointerEvents: 'none', letterSpacing: '0.03em' }}>
                        {trapId}
                      </text>
                      {hasOverride && (
                        <circle cx={cx + bw / 2 - bh * 0.18} cy={cy - bh / 2 + bh * 0.18}
                          r={bh * 0.2} fill="#FF9800" style={{ pointerEvents: 'none' }} />
                      )}
                    </>
                  )}
                  {isHovered && (
                    <>
                      <rect x={cx - bh / 2} y={cy - bh / 2} width={bh} height={bh} rx={bh / 2}
                        fill="rgba(200,0,0,0.75)" style={{ pointerEvents: 'none' }} />
                      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                        fontSize={fs * 1.1} fontWeight="700" fill="white"
                        style={{ pointerEvents: 'none' }}>✕</text>
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
                <>
                  <circle cx={p1[0]} cy={p1[1]} r={dotR} fill="#C4D600" />
                  {mousePos && (
                    <line x1={p1[0]} y1={p1[1]} x2={mousePos.x} y2={mousePos.y}
                      stroke="#C4D600" strokeWidth={lineW} strokeDasharray={dashArray} />
                  )}
                </>
              )
              const distPx = Math.sqrt((p2[0] - p1[0]) ** 2 + (p2[1] - p1[1]) ** 2)
              const distCm = distPx * pixelToCmRatio
              const distM = (distCm / 100).toFixed(2)
              const midX = (p1[0] + p2[0]) / 2, midY = (p1[1] + p2[1]) / 2
              const fs = Math.max(10, imageRef.naturalWidth * 0.012)
              const lw = fs * 7, lh = fs * 2.8
              return (
                <>
                  <line x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]}
                    stroke="#C4D600" strokeWidth={lineW} strokeDasharray={dashArray}
                    markerStart="url(#dist-arrow-start)" markerEnd="url(#dist-arrow-end)" />
                  <circle cx={p1[0]} cy={p1[1]} r={dotR} fill="#C4D600" />
                  <circle cx={p2[0]} cy={p2[1]} r={dotR} fill="#C4D600" />
                  <rect x={midX - lw/2} y={midY - lh/2} width={lw} height={lh} fill="rgba(15,15,15,0.78)" rx={lh/2} />
                  <text x={midX} y={midY - fs*0.15} textAnchor="middle" fill="white" fontSize={fs} fontWeight="700" style={{ pointerEvents: 'none' }}>{distM} m</text>
                  <text x={midX} y={midY + fs*0.9} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize={fs * 0.75} fontWeight="400" style={{ pointerEvents: 'none' }}>{distCm.toFixed(0)} cm</text>
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
                <rect x={rx} y={ry} width={rw} height={rh}
                  fill="rgba(100,160,255,0.10)" stroke="#3399FF" strokeWidth="1.5" strokeDasharray="6,3"
                  style={{ pointerEvents: 'none' }} />
              )
            })()}
          </svg>)
        })()}
      </div>

      {/* Floating navigator */}
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
          {panels.filter(p => !p.isEmpty).map(p => {
            const mmX = p.x / imageRef.naturalWidth  * MM_W
            const mmY = p.y / imageRef.naturalHeight * MM_H
            const mmW = p.width  / imageRef.naturalWidth  * MM_W
            const mmH = p.height / imageRef.naturalHeight * MM_H
            const cx = mmX + mmW / 2, cy = mmY + mmH / 2
            const isSel = selectedPanels.includes(p.id)
            return (
              <g key={p.id} transform={`rotate(${p.rotation || 0} ${cx} ${cy})`}>
                <rect x={mmX} y={mmY} width={mmW} height={mmH}
                  fill={isSel ? 'rgba(0,62,126,0.7)' : 'rgba(70,130,180,0.55)'}
                  stroke={isSel ? '#003e7e' : '#4682B4'} strokeWidth="0.5" />
              </g>
            )
          })}
        </CanvasNavigator>
      )}
    </div>
  )
}
