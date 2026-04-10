import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import {
  PRIMARY, ERROR, BLACK, WARNING, SUCCESS,
  DRAW_COLOR,
  PANEL_MID, PANEL_DARK, PANEL_STROKE_MID, GRIDLINE_AREA,
  PANEL_FILL, PANEL_FILL_SELECTED, PANEL_FILL_HOVER_DELETE,
  PANEL_BADGE_DEFAULT, PANEL_BADGE_SELECTED, PANEL_BADGE_SEL_FILL, PANEL_BADGE_SEL_CHV,
  PANEL_MINI_DEFAULT, PANEL_MINI_SELECTED,
  TEXT_VERY_LIGHT,
  CANVAS_MASK, CANVAS_MINI_BG, CANVAS_AREA_HOVER,
  CANVAS_SEL_FILL, CANVAS_SEL_STROKE,
  CANVAS_LABEL_BG, CANVAS_LABEL_TEXT, CANVAS_DELETE_MARK,
} from '../../../styles/colors'
import { useImagePanZoom } from '../../../hooks/useImagePanZoom'
import CanvasNavigator from '../../shared/CanvasNavigator'
import { computeRectPanels, computePolygonPanels, fitPolygonToRectPanels } from '../../../utils/rectPanelService'

export default function PanelCanvas({
  uploadedImageData, imageSrc, viewZoom, setViewZoom,
  imageRef, setImageRef,
  roofPolygon, baseline,
  panels, setPanels,
  selectedPanels, setSelectedPanels,
  dragState, setDragState,
  rotationState, setRotationState,
  distanceMeasurement, setDistanceMeasurement,
  showBaseline, showDistances, showHGridlines, showVGridlines, snapToGridlines,
  refinedArea,
  activeTool,
  pendingAddNextTo, onAddNextToPanel, setPendingAddNextTo,
  rectAreas = [],
  setRectAreas,
  onAddRectArea,
  cmPerPixel,
  panelSpec,
  rebuildPanelGrid,
  recordPanelDeletion,
  panelGapCm,
  drawVertical = false,
}) {
  const { panOffset, setPanOffset, panActive, setPanActive, panRef, viewportRef, MM_W, MM_H, panToMinimapPoint, getMinimapViewportRect } = useImagePanZoom(imageRef)
  const imgRefCallback = useCallback((el) => { if (el) setImageRef(el) }, [])
  const [isSpaceDown, setIsSpaceDown] = useState(false)
  const [hoveredPanelId, setHoveredPanelId] = useState(null)
  const [rectSelect, setRectSelect] = useState(null)
  const [mousePos, setMousePos] = useState(null)
  const [drawRectStart, setDrawRectStart] = useState(null)
  const [drawRectEnd, setDrawRectEnd] = useState(null)
  const [yLockDragState, setYLockDragState] = useState(null)
  const [freeDragState, setFreeDragState]   = useState(null) // {areaIdx, cornerIdx, pivotX, pivotY, wdx, wdy, hdx, hdy, origWidthDist, origHeightDist}
  const [moveDragState, setMoveDragState]   = useState(null) // {areaIdx, startX, startY, origVertices}
  const [overYLockArea, setOverYLockArea]   = useState(false)
  const [snapGuideState, setSnapGuideState] = useState(null) // {pivotY, minX, maxX, snapping}

  const willDeselectRef = useRef(false)
  const wheelContainerRef = useRef(null)

  // Attach wheel listener as non-passive so preventDefault works
  useEffect(() => {
    const el = wheelContainerRef.current
    if (!el) return
    const handler = (e) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.1 : 0.1
      setViewZoom(z => Math.max(0.5, Math.min(3, z + delta)))
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  const ptInPoly = (px, py, verts) => {
    let inside = false
    for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
      const xi = verts[i].x, yi = verts[i].y, xj = verts[j].x, yj = verts[j].y
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
  }

  // Live panel preview while drawing a rect
  const drawPreviewPanels = useMemo(() => {
    if (!drawRectStart || !drawRectEnd || !cmPerPixel || panelGapCm == null) return []
    const dx = drawRectEnd.x - drawRectStart.x
    const dy = drawRectEnd.y - drawRectStart.y
    if (Math.abs(dx) < 2 || Math.abs(dy) < 2) return []
    const absDx = Math.abs(dx), absDy = Math.abs(dy)
    // For vertical draw: swap width/height AND swap xDir/yDir sources
    // so the fill algorithm starts from the draw start point in rotated frame
    const vd = drawVertical
    return computeRectPanels({
      cx: (drawRectStart.x + drawRectEnd.x) / 2,
      cy: (drawRectStart.y + drawRectEnd.y) / 2,
      width:  vd ? absDy : absDx,
      height: vd ? absDx : absDy,
      rotation: vd ? 90 : 0,
      // V-Draw: 90° rotation maps localX→screenY, localY→screen-X
      // xDir controls column fill along localX (→ screen Y after rotation)
      // yDir controls row stack along localY (→ screen -X after rotation, hence inverted)
      xDir: vd ? (dy >= 0 ? 'ltr' : 'rtl') : (dx >= 0 ? 'ltr' : 'rtl'),
      yDir: vd ? (dx >= 0 ? 'btt' : 'ttb') : (dy >= 0 ? 'ttb' : 'btt'),
    }, cmPerPixel, panelSpec, panelGapCm)
  }, [drawRectStart, drawRectEnd, cmPerPixel, panelSpec, panelGapCm, drawVertical])

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
    if (moveDragState) return 'grabbing'
    if (yLockDragState) return 'ns-resize'
    if (panActive || dragState) return 'grabbing'
    if (rectSelect) return 'crosshair'
    if (rotationState) return 'crosshair'
    if (overYLockArea) return overYLockArea === 'vertical' ? 'ew-resize' : 'ns-resize'
    switch (activeTool) {
      case 'move': return 'default'
      case 'rotate': return 'crosshair'
      case 'delete': return 'pointer'
      case 'add': return 'crosshair'
      case 'measure': return 'crosshair'
      case 'area': return 'crosshair'
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

    // Y-lock rotation: click inside a y-locked polygon starts rotation drag (area mode only)
    if (activeTool === 'area') {
      const selAreaIdx = selectedPanels.length > 0
        ? (panels.find(p => selectedPanels.includes(p.id))?.area ?? null)
        : null
      for (let areaIdx = 0; areaIdx < rectAreas.length; areaIdx++) {
        const area = rectAreas[areaIdx]
        if (area.mode !== 'ylocked' || !area.vertices?.length) continue
        if (areaIdx !== selAreaIdx) continue
        if (!ptInPoly(x, y, area.vertices)) continue
        const pIdx = area.pivotIdx ?? 0
        const pivot = area.vertices[pIdx]
        const adj = area.vertices[(pIdx + 1) % area.vertices.length]
        const refLength = Math.max(Math.hypot(adj.x - pivot.x, adj.y - pivot.y), 1)
        setYLockDragState({ areaIdx, startX: x, startY: y, startRotation: area.rotation ?? 0, pivotX: pivot.x, pivotY: pivot.y, refLength, origVertices: area.vertices, areaVertical: area.areaVertical ?? false })
        return
      }
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

    const hitTestPanel = (p, px, py) => {
      const cx = p.x + p.width / 2, cy = p.y + p.height / 2
      const rad = -(p.rotation || 0) * Math.PI / 180
      const dx = px - cx, dy = py - cy
      const lx = dx * Math.cos(rad) - dy * Math.sin(rad)
      const ly = dx * Math.sin(rad) + dy * Math.cos(rad)
      return Math.abs(lx) <= p.width / 2 && Math.abs(ly) <= p.height / 2
    }
    const clickedPanel = panels.find(p => hitTestPanel(p, x, y))

    if (activeTool === 'area') {
      if (clickedPanel) {
        // Select the entire area this panel belongs to
        const areaKey = clickedPanel.area ?? clickedPanel.row
        setSelectedPanels(panels.filter(p => (p.area ?? p.row) === areaKey).map(p => p.id))
      } else {
        setDrawRectStart({ x, y })
        setDrawRectEnd({ x, y })
      }
      return
    }

    if (activeTool === 'delete') {
      if (clickedPanel) {
        const newPanels = panels.filter(p => p.id !== clickedPanel.id)
        recordPanelDeletion?.(clickedPanel)
        setPanels(newPanels)
        rebuildPanelGrid?.(newPanels)
        setSelectedPanels([])
      } else startPan(e)
      return
    }

    if (activeTool === 'move' || activeTool === 'rotate') {
      if (clickedPanel) {
        if (e.shiftKey) {
          setSelectedPanels(prev => prev.includes(clickedPanel.id) ? prev.filter(id => id !== clickedPanel.id) : [...prev, clickedPanel.id])
          return
        }
        if (!selectedPanels.includes(clickedPanel.id)) {
          setSelectedPanels([clickedPanel.id])
        }
        if (activeTool === 'move') {
          const panelIds = selectedPanels.includes(clickedPanel.id) ? selectedPanels : [clickedPanel.id]
          const originalPositions = {}
          panelIds.forEach(id => { const p = panels.find(p => p.id === id); if (p) originalPositions[id] = { x: p.x, y: p.y } })
          setDragState({ panelIds, startX: x, startY: y, originalPositions })
        }
      } else {
        if (activeTool === 'move') setRectSelect({ startX: x, startY: y, endX: x, endY: y })
        else startPan(e)
      }
      return
    }

    if (activeTool === 'add') {
      if (pendingAddNextTo) {
        if (clickedPanel && !clickedPanel.isEmpty) onAddNextToPanel(clickedPanel)
        else setPendingAddNextTo(false)
      } else {
        if (!clickedPanel) startPan(e)
      }
      return
    }
  }

  const handleSVGMouseMove = (e) => {
    const { x, y } = svgCoords(e)
    // Only update mousePos when not in a drag — avoids re-render cascade during drags
    if (!yLockDragState && !moveDragState && !freeDragState && !dragState && !rotationState) {
      setMousePos({ x, y })
    }

    if (!yLockDragState && !moveDragState && !freeDragState) {
      const hoveredYLock = rectAreas.find(a => a.mode === 'ylocked' && a.vertices?.length && ptInPoly(x, y, a.vertices))
      setOverYLockArea(hoveredYLock ? (hoveredYLock.areaVertical ? 'vertical' : 'horizontal') : false)
    }

    if (activeTool === 'area' && drawRectStart) {
      setDrawRectEnd({ x, y })
      return
    }

    if (moveDragState) {
      const { areaIdx, startX, startY, origVertices } = moveDragState
      const dx = x - startX, dy = y - startY
      const newVertices = origVertices.map(v => ({ x: v.x + dx, y: v.y + dy }))
      setRectAreas(prev => prev.map((a, i) => i === areaIdx ? { ...a, vertices: newVertices } : a))
      return
    }

    if (freeDragState) {
      const { areaIdx, cornerIdx, pivotX, pivotY, wdx, wdy, hdx, hdy, origWidthDist, origHeightDist } = freeDragState
      const dx = x - pivotX, dy = y - pivotY
      // Project mouse onto local width / height axes
      const projW = dx * wdx + dy * wdy
      const projH = dx * hdx + dy * hdy
      // Each corner controls specific axes (pivot = v[0] fixed)
      // Minimum: area must fit at least 1 landscape panel (pLen × pWid)
      const minW = cmPerPixel > 0 && panelSpec ? panelSpec.lengthCm / cmPerPixel : 1
      const minH = cmPerPixel > 0 && panelSpec ? panelSpec.widthCm  / cmPerPixel : 1
      const newWidth  = cornerIdx === 3 ? origWidthDist  : Math.max(minW, projW)
      const newHeight = cornerIdx === 1 ? origHeightDist : Math.max(minH, projH)
      const newVertices = [
        { x: pivotX,                                           y: pivotY },
        { x: pivotX + newWidth * wdx,                         y: pivotY + newWidth * wdy },
        { x: pivotX + newWidth * wdx + newHeight * hdx,       y: pivotY + newWidth * wdy + newHeight * hdy },
        { x: pivotX + newHeight * hdx,                        y: pivotY + newHeight * hdy },
      ]
      setRectAreas(prev => prev.map((a, i) => i === areaIdx ? { ...a, vertices: newVertices } : a))
      return
    }

    if (yLockDragState) {
      const { areaIdx, cornerIdx: dragCornerIdx, startX, startY, startRotation, pivotX, pivotY, refLength, origVertices, origCornerX, origCornerY, areaVertical } = yLockDragState
      let deltaAngleDeg
      if (origCornerX !== undefined) {
        const pivotIdx = 0
        const isOppositeCorner = dragCornerIdx === ((pivotIdx + 2) % 4)

        // 1. Rotation from mouse position relative to pivot
        // Horizontal: Y displacement constrains, solve for X
        // Vertical:   X displacement constrains, solve for Y
        let newCornerX, newCornerY
        if (areaVertical) {
          const dxFromPivot = x - pivotX
          const dySq = refLength * refLength - dxFromPivot * dxFromPivot
          if (dySq < 0) return
          newCornerX = x
          newCornerY = pivotY + Math.sign(origCornerY - pivotY) * Math.sqrt(dySq)
        } else {
          const dyFromPivot = y - pivotY
          const dxSq = refLength * refLength - dyFromPivot * dyFromPivot
          if (dxSq < 0) return
          newCornerX = pivotX + Math.sign(origCornerX - pivotX) * Math.sqrt(dxSq)
          newCornerY = y
        }
        const origAngle = Math.atan2(origCornerY - pivotY, origCornerX - pivotX)
        const newAngle  = Math.atan2(newCornerY - pivotY, newCornerX - pivotX)
        deltaAngleDeg = (newAngle - origAngle) * 180 / Math.PI

        // Snap to 0° if within 3°, clamp to ±80°
        const rawRotation = startRotation + deltaAngleDeg
        const clamped = Math.max(-80, Math.min(80, rawRotation))
        deltaAngleDeg = clamped - startRotation
        const absRot = Math.abs(clamped)
        const snapping = absRot < 3
        if (snapping) deltaAngleDeg = -startRotation

        // 2. Rebuild polygon
        const rad = deltaAngleDeg * Math.PI / 180
        const cosA = Math.cos(rad), sinA = Math.sin(rad)

        const v1x = origVertices[1].x - pivotX, v1y = origVertices[1].y - pivotY
        const v3x = origVertices[3].x - pivotX, v3y = origVertices[3].y - pivotY

        // Detect which vector is height (locked) vs width
        const v1AbsY = Math.abs(v1y), v1AbsX = Math.abs(v1x)
        const v3AbsY = Math.abs(v3y), v3AbsX = Math.abs(v3x)
        const v1IsHeight = areaVertical ? (v1AbsX > v3AbsX) : (v1AbsY > v3AbsY)
        const owx = v1IsHeight ? v3x : v1x, owy = v1IsHeight ? v3y : v1y
        const ohx = v1IsHeight ? v1x : v3x, ohy = v1IsHeight ? v1y : v3y
        const hIsV1 = v1IsHeight
        const origWidthDist = Math.hypot(owx, owy)

        // Rotate both vectors
        const nhx = ohx * cosA - ohy * sinA
        const nhy = ohx * sinA + ohy * cosA
        const nwdx = (owx * cosA - owy * sinA) / origWidthDist
        const nwdy = (owx * sinA + owy * cosA) / origWidthDist

        let newWidth
        if (isOppositeCorner) {
          // v[2] drag: pure rotation — both height and width locked
          newWidth = origWidthDist
        } else {
          // v[1] or v[3] drag: rotation + width extension
          const minW = cmPerPixel > 0 && panelSpec ? panelSpec.lengthCm / cmPerPixel : 1
          newWidth = Math.max(minW, (x - pivotX) * nwdx + (y - pivotY) * nwdy)
        }

        // Reconstruct vertices
        const wVec = { x: newWidth * nwdx, y: newWidth * nwdy }
        const hVec = { x: nhx, y: nhy }
        const v1Vec = hIsV1 ? hVec : wVec
        const v3Vec = hIsV1 ? wVec : hVec
        const newVertices = [
          { x: pivotX,                          y: pivotY },
          { x: pivotX + v1Vec.x,                y: pivotY + v1Vec.y },
          { x: pivotX + v1Vec.x + v3Vec.x,     y: pivotY + v1Vec.y + v3Vec.y },
          { x: pivotX + v3Vec.x,                y: pivotY + v3Vec.y },
        ]
        const actualRotation = startRotation + deltaAngleDeg
        setRectAreas(prev => prev.map((a, i) => i === areaIdx ? { ...a, rotation: actualRotation, vertices: newVertices } : a))

        if (absRot < 10) {
          const xs = newVertices.map(v => v.x)
          setSnapGuideState({ pivotY, minX: Math.min(...xs), maxX: Math.max(...xs), snapping })
        } else {
          setSnapGuideState(null)
        }
      } else {
        // Body drag fallback: tilt axis only, fixed width
        // Horizontal: Y drives tilt. Vertical: X drives tilt.
        const bodyDisp = areaVertical ? (x - startX) : (y - startY)
        deltaAngleDeg = Math.atan2(bodyDisp, refLength) * (180 / Math.PI)
        const rawRotation = startRotation + deltaAngleDeg
        const clamped = Math.max(-80, Math.min(80, rawRotation))
        deltaAngleDeg = clamped - startRotation
        const absRot = Math.abs(clamped)
        const snapping = absRot < 3
        if (snapping) deltaAngleDeg = -startRotation
        const actualRotation = startRotation + deltaAngleDeg
        const rad = deltaAngleDeg * Math.PI / 180
        const cosA = Math.cos(rad), sinA = Math.sin(rad)
        const newVertices = origVertices.map(v => ({
          x: pivotX + (v.x - pivotX) * cosA - (v.y - pivotY) * sinA,
          y: pivotY + (v.x - pivotX) * sinA + (v.y - pivotY) * cosA,
        }))
        setRectAreas(prev => prev.map((a, i) => i === areaIdx ? { ...a, rotation: actualRotation, vertices: newVertices } : a))

        if (absRot < 10) {
          const xs = newVertices.map(v => v.x)
          setSnapGuideState({ pivotY, minX: Math.min(...xs), maxX: Math.max(...xs), snapping })
        } else {
          setSnapGuideState(null)
        }
      }
      return
    }


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
      const rawDx = x - dragState.startX, rawDy = y - dragState.startY
      let finalDx = rawDx, finalDy = rawDy

      const isDragging = Math.abs(rawDx) > 4 || Math.abs(rawDy) > 4
      if (isDragging && snapToGridlines && (showHGridlines || showVGridlines)) {
        const refId = dragState.panelIds[0]
        const refPanel = panels.find(p => p.id === refId)
        if (refPanel) {
          const areaKey = refPanel.area ?? refPanel.row
          // Sub-area detection: if all dragged panels share one trapezoidId, snap only to that sub-area
          const draggedTrapIds = [...new Set(dragState.panelIds.map(id => panels.find(p => p.id === id)?.trapezoidId).filter(Boolean))]
          const trapKey    = draggedTrapIds.length === 1 ? draggedTrapIds[0] : null
          const stationary = panels.filter(p => !dragState.panelIds.includes(p.id) && (p.area ?? p.row) === areaKey && !p.isEmpty && (trapKey ? p.trapezoidId === trapKey : true))
          if (stationary.length > 0) {
            const orig = dragState.originalPositions[refId]
            const cx = orig.x + refPanel.width / 2 + rawDx
            const cy = orig.y + refPanel.height / 2 + rawDy
            const r = (refPanel.rotation || 0) * Math.PI / 180
            const cosR = Math.cos(r), sinR = Math.sin(r)
            const ux = cosR, uy = sinR, vx = -sinR, vy = cosR
            const hw = refPanel.width / 2, hh = refPanel.height / 2
            const THRESH = Math.max(refPanel.width, refPanel.height) * 0.35
            if (showHGridlines) {
              const centerPerp = cx * vx + cy * vy
              const offsets = stationary.flatMap(p => { const pOff = (p.x + p.width/2) * vx + (p.y + p.height/2) * vy; return [pOff - p.height/2, pOff + p.height/2] })
              const candidates = offsets.flatMap(g => [g - hh, g + hh])
              const nearest = candidates.reduce((b, c) => Math.abs(c - centerPerp) < Math.abs(b - centerPerp) ? c : b)
              if (Math.abs(nearest - centerPerp) < THRESH) { finalDx += (nearest - centerPerp) * vx; finalDy += (nearest - centerPerp) * vy }
            }
            if (showVGridlines) {
              const cx2 = orig.x + refPanel.width / 2 + finalDx, cy2 = orig.y + refPanel.height / 2 + finalDy
              const centerPar = cx2 * ux + cy2 * uy
              const offsets = stationary.flatMap(p => { const pOff = (p.x + p.width/2) * ux + (p.y + p.height/2) * uy; return [pOff - p.width/2, pOff + p.width/2] })
              const candidates = offsets.flatMap(g => [g - hw, g + hw])
              const nearest = candidates.reduce((b, c) => Math.abs(c - centerPar) < Math.abs(b - centerPar) ? c : b)
              if (Math.abs(nearest - centerPar) < THRESH) { finalDx += (nearest - centerPar) * ux; finalDy += (nearest - centerPar) * uy }
            }
          }
        }
      }

      setPanels(prev => prev.map(panel => {
        if (!dragState.panelIds.includes(panel.id)) return panel
        return { ...panel, x: dragState.originalPositions[panel.id].x + finalDx, y: dragState.originalPositions[panel.id].y + finalDy }
      }))
    }
  }

  const handleSVGMouseUp = () => {
    if (moveDragState) {
      const { areaIdx } = moveDragState
      setMoveDragState(null)
      setRectAreas(prev => {
        const area = prev[areaIdx]
        if (!area?.vertices?.length || !cmPerPixel || panelGapCm == null) return prev
        const effRot = (area.areaVertical ? 90 : 0) + (area.rotation ?? 0)
        const panels = computePolygonPanels(area, cmPerPixel, panelSpec, panelGapCm)
        if (!panels.length) return prev
        const pivot = area.vertices[area.pivotIdx ?? 0]
        const fitted = fitPolygonToRectPanels(panels, effRot, pivot.x, pivot.y)
        if (!fitted) return prev
        return prev.map((a, i) => i === areaIdx ? { ...a, vertices: fitted } : a)
      })
      return
    }
    if (freeDragState) {
      const { areaIdx } = freeDragState
      setFreeDragState(null)
      setRectAreas(prev => {
        const area = prev[areaIdx]
        if (!area?.vertices?.length || !cmPerPixel || panelGapCm == null) return prev
        const effRot = (area.areaVertical ? 90 : 0) + (area.rotation ?? 0)
        const panels = computePolygonPanels(area, cmPerPixel, panelSpec, panelGapCm)
        if (!panels.length) return prev
        const pivot = area.vertices[area.pivotIdx ?? 0]
        const fitted = fitPolygonToRectPanels(panels, effRot, pivot.x, pivot.y)
        if (!fitted) return prev
        return prev.map((a, i) => i === areaIdx ? { ...a, vertices: fitted } : a)
      })
      return
    }
    if (yLockDragState) {
      const { areaIdx } = yLockDragState
      setYLockDragState(null)
      setSnapGuideState(null)
      setRectAreas(prev => {
        const area = prev[areaIdx]
        if (!area?.vertices?.length || !cmPerPixel || panelGapCm == null) return prev
        const effRot = (area.areaVertical ? 90 : 0) + (area.rotation ?? 0)
        const panels = computePolygonPanels(area, cmPerPixel, panelSpec, panelGapCm)
        if (!panels.length) return prev
        const pivot = area.vertices[area.pivotIdx ?? 0]
        const fitted = fitPolygonToRectPanels(panels, effRot, pivot.x, pivot.y)
        if (!fitted) return prev
        return prev.map((a, i) => i === areaIdx ? { ...a, vertices: fitted } : a)
      })
      return
    }

    if (drawRectStart && drawRectEnd) {
      const dx = drawRectEnd.x - drawRectStart.x
      const dy = drawRectEnd.y - drawRectStart.y
      if (Math.abs(dx) > 2 && Math.abs(dy) > 2 && drawPreviewPanels.length > 0) {
        const vd = drawVertical
        const xDir = vd ? (dy >= 0 ? 'ltr' : 'rtl') : (dx >= 0 ? 'ltr' : 'rtl')
        const yDir = vd ? (dx >= 0 ? 'btt' : 'ttb') : (dy >= 0 ? 'ttb' : 'btt')
        const baseRotation = drawVertical ? 90 : 0
        const vertices = fitPolygonToRectPanels(
          drawPreviewPanels, baseRotation, drawRectStart.x, drawRectStart.y
        )
        if (vertices) {
          onAddRectArea?.({ vertices, rotation: 0, yDir, xDir, pivotIdx: 0, mode: 'free', areaVertical: drawVertical })
        }
      }
      setDrawRectStart(null)
      setDrawRectEnd(null)
      return
    }

    if (rectSelect) {
      const minX = Math.min(rectSelect.startX, rectSelect.endX)
      const maxX = Math.max(rectSelect.startX, rectSelect.endX)
      const minY = Math.min(rectSelect.startY, rectSelect.endY)
      const maxY = Math.max(rectSelect.startY, rectSelect.endY)
      if (Math.max(maxX - minX, maxY - minY) > 8) {
        let hit = panels.filter(p => {
          const cx = p.x + p.width / 2, cy = p.y + p.height / 2
          return cx >= minX && cx <= maxX && cy >= minY && cy <= maxY
        })
        if (hit.length > 0) {
          // Restrict to the most-represented area
          const counts = {}
          hit.forEach(p => { counts[p.area] = (counts[p.area] || 0) + 1 })
          const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
          hit = hit.filter(p => String(p.area) === dominant)
        }
        setSelectedPanels(hit.map(p => p.id))
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
    setRectSelect(null); panRef.current = null; setPanActive(false); willDeselectRef.current = false; setDragState(null); setRotationState(null); setMousePos(null); setDrawRectStart(null); setDrawRectEnd(null); setYLockDragState(null); setFreeDragState(null); setMoveDragState(null); setSnapGuideState(null)
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
        ref={wheelContainerRef}
      >
        <img
          ref={imgRefCallback}
          src={imageSrc}
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
                  <polygon points={roofPolygon.coordinates.map(c => `${c[0]},${c[1]}`).join(' ')} fill={BLACK} />
                </mask>
              )}
              {showDistances && distanceMeasurement?.p2 && (
                <>
                  <marker id="dist-arrow-start" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                    <polygon points="3,1 3,5 1,3" fill={PRIMARY} />
                  </marker>
                  <marker id="dist-arrow-end" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                    <polygon points="3,1 3,5 5,3" fill={PRIMARY} />
                  </marker>
                </>
              )}
            </defs>

            {/* Roof polygon overlay */}
            {roofPolygon && (
              <>
                <rect width="100%" height="100%" fill={CANVAS_MASK} mask="url(#polygonMask)" />
                <polygon points={roofPolygon.coordinates.map(c => `${c[0]},${c[1]}`).join(' ')} fill="none" stroke={PRIMARY} strokeWidth="3" />
              </>
            )}

            {/* Baseline */}
            {showBaseline && baseline?.p1 && baseline?.p2 && (
              <>
                <line x1={baseline.p1[0]} y1={baseline.p1[1]} x2={baseline.p2[0]} y2={baseline.p2[1]} stroke={DRAW_COLOR} strokeWidth={lineW} strokeDasharray={dashArray} />
                <circle cx={baseline.p1[0]} cy={baseline.p1[1]} r={dotR} fill={DRAW_COLOR} />
                <circle cx={baseline.p2[0]} cy={baseline.p2[1]} r={dotR} fill={DRAW_COLOR} />
              </>
            )}
            {baseline?.p1 && !baseline?.p2 && (
              <>
                <circle cx={baseline.p1[0]} cy={baseline.p1[1]} r={dotR} fill={DRAW_COLOR} />
                {mousePos && (
                  <line x1={baseline.p1[0]} y1={baseline.p1[1]} x2={mousePos.x} y2={mousePos.y} stroke={DRAW_COLOR} strokeWidth={lineW} strokeDasharray={dashArray} />
                )}
              </>
            )}

            {/* Gridlines — dashed lines at panel edges, extended across canvas — selected area or sub-area */}
            {(showHGridlines || showVGridlines) && imageRef && (() => {
              const selAreaKey = selectedPanels.length > 0
                ? (() => { const sp = panels.find(p => selectedPanels.includes(p.id)); return sp ? (sp.area ?? sp.row) : null })()
                : null
              if (selAreaKey === null) return null
              // Sub-area detection: all selected panels share one trapezoidId → filter to that sub-area only
              const selTrapIds = [...new Set(panels.filter(p => selectedPanels.includes(p.id)).map(p => p.trapezoidId).filter(Boolean))]
              const selTrapId  = selTrapIds.length === 1 ? selTrapIds[0] : null
              return panels.filter(p => !p.isEmpty && (p.area ?? p.row) === selAreaKey && (selTrapId ? p.trapezoidId === selTrapId : true)).map(panel => {
                const cx = panel.x + panel.width / 2, cy = panel.y + panel.height / 2
                const r  = (panel.rotation || 0) * Math.PI / 180
                const cosR = Math.cos(r), sinR = Math.sin(r)
                const ext = Math.max(imageRef.naturalWidth, imageRef.naturalHeight) * 1.5
                const gapPx = refinedArea?.pixelToCmRatio ? panelGapCm / refinedArea.pixelToCmRatio : imageRef.naturalWidth * 0.001
                const gw  = Math.max(1, gapPx)
                const gd  = `${gapPx * 2} ${gapPx}`
                const ux = cosR, uy = sinR, vx = -sinR, vy = cosR
                const hw = panel.width / 2, hh = panel.height / 2
                // horizontal = top/bottom edges (run along panel width direction)
                // vertical   = left/right edges  (run along panel height direction)
                const edges = [
                  ...(showHGridlines ? [
                    { mx: cx - hh * vx, my: cy - hh * vy, dx: ux, dy: uy },
                    { mx: cx + hh * vx, my: cy + hh * vy, dx: ux, dy: uy },
                  ] : []),
                  ...(showVGridlines ? [
                    { mx: cx - hw * ux, my: cy - hw * uy, dx: vx, dy: vy },
                    { mx: cx + hw * ux, my: cy + hw * uy, dx: vx, dy: vy },
                  ] : []),
                ]
                return edges.map((e, ei) => (
                  <line key={`${panel.id}-gl${ei}`}
                    x1={e.mx - ext * e.dx} y1={e.my - ext * e.dy}
                    x2={e.mx + ext * e.dx} y2={e.my + ext * e.dy}
                    stroke={GRIDLINE_AREA} strokeWidth={gw} strokeDasharray={gd}
                    style={{ pointerEvents: 'none' }}
                  />
                ))
              })
            })()}

            {/* Gridlines — selected panels only, blue overlay */}
            {(showHGridlines || showVGridlines) && imageRef && selectedPanels.length > 0 && (() => {
              return panels.filter(p => !p.isEmpty && selectedPanels.includes(p.id)).map(panel => {
                const cx = panel.x + panel.width / 2, cy = panel.y + panel.height / 2
                const r  = (panel.rotation || 0) * Math.PI / 180
                const cosR = Math.cos(r), sinR = Math.sin(r)
                const ext = Math.max(imageRef.naturalWidth, imageRef.naturalHeight) * 1.5
                const gapPx = refinedArea?.pixelToCmRatio ? panelGapCm / refinedArea.pixelToCmRatio : imageRef.naturalWidth * 0.001
                const gw  = Math.max(1, gapPx) * 1.5
                const gd  = `${gapPx * 3} ${gapPx * 1.5}`
                const ux = cosR, uy = sinR, vx = -sinR, vy = cosR
                const hw = panel.width / 2, hh = panel.height / 2
                const edges = [
                  ...(showHGridlines ? [
                    { mx: cx - hh * vx, my: cy - hh * vy, dx: ux, dy: uy },
                    { mx: cx + hh * vx, my: cy + hh * vy, dx: ux, dy: uy },
                  ] : []),
                  ...(showVGridlines ? [
                    { mx: cx - hw * ux, my: cy - hw * uy, dx: vx, dy: vy },
                    { mx: cx + hw * ux, my: cy + hw * uy, dx: vx, dy: vy },
                  ] : []),
                ]
                return edges.map((e, ei) => (
                  <line key={`${panel.id}-sel-gl${ei}`}
                    x1={e.mx - ext * e.dx} y1={e.my - ext * e.dy}
                    x2={e.mx + ext * e.dx} y2={e.my + ext * e.dy}
                    stroke={PANEL_STROKE_MID} strokeOpacity={0.4} strokeWidth={gw} strokeDasharray={gd}
                    style={{ pointerEvents: 'none' }}
                  />
                ))
              })
            })()}

            {/* Polygon area outlines + corner handles */}
            {/* Active/selected area renders last so its corners are always on top */}
            {(() => {
              const selectedAreaIdx = selectedPanels.length > 0
                ? (panels.find(p => selectedPanels.includes(p.id))?.area ?? null)
                : null
              const activeAreaIdx =
                freeDragState?.areaIdx ??
                yLockDragState?.areaIdx ??
                moveDragState?.areaIdx ??
                selectedAreaIdx
              const order = rectAreas.map((_, i) => i).sort((a, b) =>
                a === activeAreaIdx ? 1 : b === activeAreaIdx ? -1 : 0
              )
              return order.map(areaIdx => {
              const area = rectAreas[areaIdx]
              if (!area.vertices?.length) return null
              const pts = area.vertices.map(v => `${v.x},${v.y}`).join(' ')
              const labelCx = area.vertices.reduce((s, v) => s + v.x, 0) / area.vertices.length
              const labelCy = area.vertices.reduce((s, v) => s + v.y, 0) / area.vertices.length
              const handleR = Math.max(5, (imageRef?.naturalWidth ?? 1000) * 0.006)
              const isYLocked = area.mode === 'ylocked'
              const pivotIdx = area.pivotIdx ?? 0
              return (
                <g key={area.id} style={{ pointerEvents: 'auto' }}>
                  <polygon
                    points={pts}
                    fill={`${area.color}15`}
                    stroke={area.color}
                    strokeWidth={lineW * 2}
                    strokeDasharray={isYLocked ? undefined : dashArray}
                    style={{ pointerEvents: 'none' }}
                  />
                  <text
                    x={labelCx} y={labelCy}
                    textAnchor="middle" dominantBaseline="middle"
                    fill={area.color}
                    fontSize={Math.max(10, (imageRef?.naturalWidth ?? 1000) * 0.012)}
                    fontWeight="700"
                    style={{ pointerEvents: 'none' }}
                  >
                    {area.label}{isYLocked ? ' ⊟' : ''}
                  </text>
                  {area.vertices.map((v, cornerIdx) => {
                    const isPivot = cornerIdx === pivotIdx
                    const isDraggable = !isPivot || isYLocked
                    const isVert = area.areaVertical ?? false
                    const cursor = isPivot && isYLocked ? 'move' : (isYLocked ? (isVert ? 'ew-resize' : 'ns-resize') : (isDraggable ? 'crosshair' : 'default'))
                    return (
                      <circle
                        key={cornerIdx}
                        cx={v.x} cy={v.y} r={handleR}
                        fill={isYLocked ? (isPivot ? 'white' : area.color) : 'white'}
                        stroke={area.color} strokeWidth={lineW * 1.5}
                        style={{ cursor, pointerEvents: isDraggable && areaIdx === selectedAreaIdx ? 'auto' : 'none' }}
                        onMouseDown={isDraggable ? (e) => {
                          e.stopPropagation()
                          const pivot = area.vertices[pivotIdx]
                          if (isPivot && isYLocked) {
                            // Use the vertex position as drag start (already in SVG coords)
                            setMoveDragState({ areaIdx, startX: v.x, startY: v.y, origVertices: area.vertices })
                          } else if (isYLocked) {
                            const refLength = Math.max(Math.hypot(v.x - pivot.x, v.y - pivot.y), 1)
                            setYLockDragState({ areaIdx, cornerIdx, startRotation: area.rotation ?? 0, pivotX: pivot.x, pivotY: pivot.y, refLength, origVertices: area.vertices, origCornerX: v.x, origCornerY: v.y, areaVertical: area.areaVertical ?? false })
                          } else {
                            const owx = area.vertices[1].x - pivot.x, owy = area.vertices[1].y - pivot.y
                            const ohx = area.vertices[3].x - pivot.x, ohy = area.vertices[3].y - pivot.y
                            const wd = Math.max(Math.hypot(owx, owy), 1)
                            const hd = Math.max(Math.hypot(ohx, ohy), 1)
                            setFreeDragState({ areaIdx, cornerIdx, pivotX: pivot.x, pivotY: pivot.y, wdx: owx / wd, wdy: owy / wd, hdx: ohx / hd, hdy: ohy / hd, origWidthDist: wd, origHeightDist: hd })
                          }
                        } : undefined}
                      />
                    )
                  })}
                </g>
              )
              })
            })()}
            {/* 0° snap guide (y-lock drag) */}
            {snapGuideState && (() => {
              const { pivotY, minX, maxX, snapping } = snapGuideState
              const guideColor = snapping ? SUCCESS : WARNING
              const guideW = lineW * 1.5
              const gd = `${lineW * 8} ${lineW * 4}`
              const labelSize = Math.max(8, (imageRef?.naturalWidth ?? 1000) * 0.012)
              return (
                <g style={{ pointerEvents: 'none' }}>
                  <line
                    x1={minX} y1={pivotY} x2={maxX} y2={pivotY}
                    stroke={guideColor} strokeWidth={guideW}
                    strokeDasharray={snapping ? undefined : gd}
                    opacity={snapping ? 1 : 0.75}
                  />
                  <text
                    x={maxX + lineW * 4} y={pivotY}
                    dominantBaseline="middle"
                    fill={guideColor}
                    fontSize={labelSize}
                    fontWeight="700"
                  >0°</text>
                </g>
              )
            })()}

            {/* Live draw preview */}
            {drawRectStart && drawRectEnd && (() => {
              const dx = drawRectEnd.x - drawRectStart.x
              const dy = drawRectEnd.y - drawRectStart.y
              if (Math.abs(dx) < 2 || Math.abs(dy) < 2) return null
              const cx = (drawRectStart.x + drawRectEnd.x) / 2
              const cy = (drawRectStart.y + drawRectEnd.y) / 2
              return (
                <g style={{ pointerEvents: 'none' }}>
                  <rect
                    x={cx - Math.abs(dx)/2} y={cy - Math.abs(dy)/2}
                    width={Math.abs(dx)} height={Math.abs(dy)}
                    fill={CANVAS_AREA_HOVER}
                    stroke={WARNING}
                    strokeWidth={lineW}
                    strokeDasharray={dashArray}
                  />
                  {drawPreviewPanels.map((p, i) => {
                    const pcx = p.x + p.width / 2, pcy = p.y + p.height / 2
                    const pibw = p.width * 0.012
                    const down = drawVertical ? dx < 0 : dy >= 0
                    const r = (p.rotation || 0) * Math.PI / 180
                    const rDeg = p.rotation || 0
                    const bh = Math.min(p.width, p.height) * 0.22
                    const bw = bh * 1.9
                    const scale = bw > p.width * 0.82 ? (p.width * 0.82) / bw : 1
                    const bwS = bw * scale, bhS = bh * scale
                    const cupW = bwS * 1.2, cupH = bhS * 0.9, cupDist = bhS * 1.1
                    const ldx = -Math.sin(r), ldy = Math.cos(r)
                    const cupSign = down ? -1 : 1
                    const cupX = pcx + ldx * cupSign * cupDist
                    const cupY = pcy + ldy * cupSign * cupDist
                    const pts = down
                      ? `0,${-cupH/2} ${-cupW/2},${cupH/2} ${cupW/2},${cupH/2}`
                      : `${-cupW/2},${-cupH/2} ${cupW/2},${-cupH/2} 0,${cupH/2}`
                    return (
                      <g key={i} style={{ pointerEvents: 'none' }}>
                        <g transform={`rotate(${rDeg} ${pcx} ${pcy})`}>
                          <rect x={p.x} y={p.y} width={p.width} height={p.height}
                            fill={PANEL_FILL} stroke="none" />
                          <rect x={p.x + pibw/2} y={p.y + pibw/2}
                            width={p.width - pibw} height={p.height - pibw}
                            fill="none" stroke={PANEL_MID} strokeWidth={pibw} />
                        </g>
                        <rect x={pcx - bwS/2} y={pcy - bhS/2} width={bwS} height={bhS} rx={bhS/2}
                          fill={PANEL_BADGE_DEFAULT} />
                        <g transform={`translate(${cupX},${cupY}) rotate(${rDeg})`}>
                          <polygon points={pts} fill="white" stroke={PANEL_BADGE_SELECTED} strokeWidth={cupH * 0.18} strokeLinejoin="round" />
                        </g>
                      </g>
                    )
                  })}
                </g>
              )
            })()}

            {/* Ghost panels (empty lines) */}
            {panels.filter(p => p.isEmpty).map(panel => {
              const cx = panel.x + panel.width / 2, cy = panel.y + panel.height / 2
              const ibw = panel.width * 0.004
              return (
                <g key={panel.id} transform={`rotate(${panel.rotation || 0} ${cx} ${cy})`} style={{ pointerEvents: 'none' }}>
                  <rect x={panel.x + ibw / 2} y={panel.y + ibw / 2} width={panel.width - ibw} height={panel.height - ibw}
                    fill="none" stroke={TEXT_VERY_LIGHT} strokeWidth={ibw} strokeDasharray={`${ibw * 6} ${ibw * 3}`} />
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
let fill, borderColor, ibw
              if (isHovered)       { fill = PANEL_FILL_HOVER_DELETE; borderColor = ERROR;      ibw = panel.width * 0.012 }
              else if (isSelected) { fill = PANEL_FILL_SELECTED;     borderColor = PANEL_DARK; ibw = panel.width * 0.025 }
              else                 { fill = PANEL_FILL;               borderColor = PANEL_MID;  ibw = panel.width * 0.012 }
              const opacity = hasSelection && !isSelected ? 0.45 : 1
              const bh = Math.min(panel.width, panel.height) * 0.22
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
                  {!isHovered && (() => {
                    const r = (panel.rotation || 0) * Math.PI / 180
                    const rDeg = panel.rotation || 0
                    const down = (panel.yDir ?? 'ttb') === 'ttb'
                    // Badge: centered at (cx, cy), capped to fit within panel width
                    const scale = bw > panel.width * 0.82 ? (panel.width * 0.82) / bw : 1
                    const bwS = bw * scale, fsS = fs * scale, bhS = bh * scale
                    // Chevron: positioned along local panel Y axis, above or below badge
                    const cupW = bwS * 1.2
                    const cupH = bhS * 0.9
                    const cupDist = bhS * 1.1
                    // Local-down direction in SVG space
                    const ldx = -Math.sin(r), ldy = Math.cos(r)
                    const cupSign = down ? -1 : 1
                    const cupX = cx + ldx * cupSign * cupDist
                    const cupY = cy + ldy * cupSign * cupDist
                    return (
                      <>
                        {/* Badge */}
                        <rect x={cx - bwS / 2} y={cy - bhS / 2} width={bwS} height={bhS} rx={bhS / 2}
                          fill={isSelected ? PANEL_BADGE_SEL_FILL : PANEL_BADGE_DEFAULT}
                          style={{ pointerEvents: 'none' }} />
                        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                          fontSize={fsS} fontWeight="600" fill="white"
                          style={{ pointerEvents: 'none', letterSpacing: '0.03em' }}>
                          {trapId}
                        </text>
                        {/* Slope chevron: ^ above badge (down) or V below badge (up) */}
                        {(() => {
                          const badgeFill = isSelected ? PANEL_BADGE_SEL_CHV : PANEL_BADGE_SELECTED
                          const pts = down
                            ? `0,${-cupH/2} ${-cupW/2},${cupH/2} ${cupW/2},${cupH/2}`
                            : `${-cupW/2},${-cupH/2} ${cupW/2},${-cupH/2} 0,${cupH/2}`
                          return (
                            <g transform={`translate(${cupX},${cupY}) rotate(${rDeg})`} style={{ pointerEvents: 'none' }}>
                              <polygon points={pts} fill="white" stroke={badgeFill} strokeWidth={cupH * 0.18} strokeLinejoin="round" />
                            </g>
                          )
                        })()}
                      </>
                    )
                  })()}
                  {isHovered && (
                    <>
                      <rect x={cx - bh / 2} y={cy - bh / 2} width={bh} height={bh} rx={bh / 2}
                        fill={CANVAS_DELETE_MARK} style={{ pointerEvents: 'none' }} />
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
                  <circle cx={p1[0]} cy={p1[1]} r={dotR} fill={PRIMARY} />
                  {mousePos && (
                    <line x1={p1[0]} y1={p1[1]} x2={mousePos.x} y2={mousePos.y}
                      stroke={PRIMARY} strokeWidth={lineW} strokeDasharray={dashArray} />
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
                    stroke={PRIMARY} strokeWidth={lineW} strokeDasharray={dashArray}
                    markerStart="url(#dist-arrow-start)" markerEnd="url(#dist-arrow-end)" />
                  <circle cx={p1[0]} cy={p1[1]} r={dotR} fill={PRIMARY} />
                  <circle cx={p2[0]} cy={p2[1]} r={dotR} fill={PRIMARY} />
                  <rect x={midX - lw/2} y={midY - lh/2} width={lw} height={lh} fill={CANVAS_LABEL_BG} rx={lh/2} />
                  <text x={midX} y={midY - fs*0.15} textAnchor="middle" fill="white" fontSize={fs} fontWeight="700" style={{ pointerEvents: 'none' }}>{distM} m</text>
                  <text x={midX} y={midY + fs*0.9} textAnchor="middle" fill={CANVAS_LABEL_TEXT} fontSize={fs * 0.75} fontWeight="400" style={{ pointerEvents: 'none' }}>{distCm.toFixed(0)} cm</text>
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
                  fill={CANVAS_SEL_FILL} stroke={CANVAS_SEL_STROKE} strokeWidth="1.5" strokeDasharray="6,3"
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
          imageData={imageSrc}
          mmWidth={MM_W}
          mmHeight={MM_H}
          onPanToPoint={panToMinimapPoint}
          viewportRect={getMinimapViewportRect()}
        >
          <rect width={MM_W} height={MM_H} fill={CANVAS_MINI_BG} />
          {panels.filter(p => !p.isEmpty).map(p => {
            const nw  = Math.max(imageRef.naturalWidth,  1)
            const nh  = Math.max(imageRef.naturalHeight, 1)
            const mmX = p.x      / nw * MM_W
            const mmY = p.y      / nh * MM_H
            const mmW = p.width  / nw * MM_W
            const mmH = p.height / nh * MM_H
            const cx = mmX + mmW / 2, cy = mmY + mmH / 2
            const isSel = selectedPanels.includes(p.id)
            return (
              <g key={p.id} transform={`rotate(${p.rotation || 0} ${cx} ${cy})`}>
                <rect x={mmX} y={mmY} width={mmW} height={mmH}
                  fill={isSel ? PANEL_MINI_SELECTED : PANEL_MINI_DEFAULT}
                  stroke={isSel ? PANEL_DARK : PANEL_MID} strokeWidth="0.5" />
              </g>
            )
          })}
        </CanvasNavigator>
      )}
    </div>
  )
}
