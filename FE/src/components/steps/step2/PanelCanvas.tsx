import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import {
  PRIMARY, ERROR, BLACK, WARNING, SUCCESS, WHITE,
  DRAW_COLOR,
  PANEL_MID, PANEL_DARK, PANEL_STROKE_MID, GRIDLINE_AREA,
  PANEL_FILL, PANEL_FILL_SELECTED, PANEL_FILL_HOVER_DELETE, PANEL_FILL_HOVER_ROTATE,
  PANEL_DIR_FILL, PANEL_DIR_HALO,
  BLUE,
  PANEL_BADGE_DEFAULT, PANEL_BADGE_SEL_FILL,
  PANEL_MINI_DEFAULT, PANEL_MINI_SELECTED,
  TEXT_VERY_LIGHT,
  CANVAS_MASK, CANVAS_MINI_BG, CANVAS_AREA_HOVER,
  CANVAS_SEL_FILL, CANVAS_SEL_STROKE,
  CANVAS_LABEL_BG, CANVAS_LABEL_TEXT, CANVAS_DELETE_MARK,
} from '../../../styles/colors'
import { useImagePanZoom } from '../../../hooks/useImagePanZoom'
import CanvasNavigator from '../../shared/CanvasNavigator'
import { computeRectPanels, computePolygonPanels, fitPolygonToRectPanels } from '../../../utils/rectPanelService'

// Panel direction indicator. A large triangle spanning the panel in its LOCAL
// frame: apex on the facing edge, base on the opposite edge. The caller wraps
// this in the panel's rotate() transform, so it inherits the exact same
// direction semantics as the slope chevron it replaced (apexUp === `down`).
function dirTrianglePoints(x: number, y: number, w: number, h: number, apexUp: boolean) {
  const iw = w * 0.13, ih = h * 0.13
  const cxv = x + w / 2
  const top = y + ih, bot = y + h - ih
  const left = x + iw, right = x + w - iw
  return apexUp
    ? `${cxv},${top} ${left},${bot} ${right},${bot}`   // apex at top, base at bottom
    : `${cxv},${bot} ${left},${top} ${right},${top}`   // apex at bottom, base at top
}

export default function PanelCanvas({
  uploadedImageData, imageSrc, viewZoom, setViewZoom,
  imageRef, setImageRef,
  roofPolygon, baseline, setBaseline = null,
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
  onDeleteArea,
  cmPerPixel,
  panelSpec,
  rebuildPanelGrid,
  recordPanelDeletion,
  panelGapCm,
  lineGapCm,
  drawVertical = false,
  roofAxis = null,
  setRoofAxis,
  roofAxisEnabled = false,
  togglePanelOrientation,
}) {
  const { panOffset, setPanOffset, panActive, setPanActive, panRef, viewportRef, MM_W, MM_H, panToMinimapPoint, getMinimapViewportRect, zoomAtPoint, zoomAtCenter } = useImagePanZoom(imageRef)
  const imgRefCallback = useCallback((el) => { if (el) setImageRef(el) }, [])
  const [isSpaceDown, setIsSpaceDown] = useState(false)
  const [hoveredPanelId, setHoveredPanelId] = useState(null)
  const [rectSelect, setRectSelect] = useState(null)
  const [mousePos, setMousePos] = useState(null)
  const [drawRectStart, setDrawRectStart] = useState(null)
  const [drawRectEnd, setDrawRectEnd] = useState(null)
  // Group-rows marquee (Ctrl/Cmd + drag in area tool): selects all rows whose
  // panels fall inside the rectangle, so they can be merged into one area.
  const [groupRowsRect, setGroupRowsRect] = useState(null)
  const [yLockDragState, setYLockDragState] = useState(null)
  const [freeDragState, setFreeDragState]   = useState(null) // {areaIdx, cornerIdx, pivotX, pivotY, wdx, wdy, hdx, hdy, origWidthDist, origHeightDist}
  const [moveDragState, setMoveDragState]   = useState(null) // {areaIdx, startX, startY, origVertices}
  const [snapGuideState, setSnapGuideState] = useState(null) // {pivotY, minX, maxX, snapping}
  // While the user is drawing/editing the roof axis, the WIP line lives here.
  // null = inactive. {start, end, dragging: 'new'|'p1'|'p2'} = active.
  const [roofAxisDraft, setRoofAxisDraft] = useState(null)
  // True when the cursor is over a roof-axis endpoint handle — switches the
  // cursor to "move" so it reads as "drag this end" vs "draw a new area".
  const [axisHandleHover, setAxisHandleHover] = useState(false)

  // Roof-axis local frame for area-draw alignment. Only active when the
  // user has enabled roof-axis mode via the compass toggle — when disabled,
  // newly drawn rows fall back to screen 0° (rotation snap still targets
  // the stored axis though, that path reads `roofAxis` directly).
  // angleDeg is normalised to ±90 (the axis is bidirectional). e* =
  // along-axis unit vector, n* = perpendicular unit vector.
  const roofAxisFrame = useMemo(() => {
    if (!roofAxisEnabled) return null
    if (!roofAxis?.start || !roofAxis?.end) return null
    const adx = roofAxis.end.x - roofAxis.start.x
    const ady = roofAxis.end.y - roofAxis.start.y
    if (Math.abs(adx) < 1e-6 && Math.abs(ady) < 1e-6) return null
    let angleDeg = Math.atan2(ady, adx) * 180 / Math.PI
    while (angleDeg > 90) angleDeg -= 180
    while (angleDeg < -90) angleDeg += 180
    const rad = angleDeg * Math.PI / 180
    return {
      angleDeg,
      ex:  Math.cos(rad), ey: Math.sin(rad),
      nx: -Math.sin(rad), ny: Math.cos(rad),
    }
  }, [roofAxis, roofAxisEnabled])

  // Default-axis seeding: when the user enables roof-axis mode for the
  // first time, drop a horizontal 0° line near the bottom of the image,
  // centred horizontally and spanning roughly the floating tool widget's
  // width — so it's clear of the panels and easy to grab. The user can then
  // drag the endpoints to align it with the roof edge.
  //
  // Computed directly in image-pixel coords (centre = natW/2) so it's
  // independent of pan/scroll. Only the line length is derived from the
  // widget's screen width via the displayed image's scale.
  useEffect(() => {
    if (!roofAxisEnabled || !setRoofAxis) return
    if (roofAxis?.start && roofAxis?.end) {
      const adx = roofAxis.end.x - roofAxis.start.x
      const ady = roofAxis.end.y - roofAxis.start.y
      if (Math.hypot(adx, ady) > 1) return  // already has a real axis
    }
    const img = imageRef
    const natW = img?.naturalWidth ?? 0
    const natH = img?.naturalHeight ?? 0
    if (!natW || !natH) return
    const imgRect = img.getBoundingClientRect()
    const scaleX = imgRect.width ? natW / imgRect.width : 1
    const scaleY = imgRect.height ? natH / imgRect.height : 1

    const widget = document.querySelector('[data-step2-toolpanel]')
    const widgetWScreen = widget ? widget.getBoundingClientRect().width : 225
    const lenImg = Math.min(natW * 0.9, widgetWScreen * scaleX)
    const cx = natW / 2
    const y = Math.max(0, natH - 40 * scaleY)  // ~40 screen px above the bottom
    setRoofAxis({ start: { x: cx - lenImg / 2, y }, end: { x: cx + lenImg / 2, y } })
  }, [roofAxisEnabled, roofAxis, imageRef, setRoofAxis])

  // Project a screen-space drag delta into the roof-axis local frame.
  // Returns dx/dy unchanged when no axis is set, so callers keep their
  // existing screen-axis logic in that path.
  const projectDrag = (dx, dy) => {
    if (!roofAxisFrame) return { localDx: dx, localDy: dy }
    return {
      localDx: dx * roofAxisFrame.ex + dy * roofAxisFrame.ey,
      localDy: dx * roofAxisFrame.nx + dy * roofAxisFrame.ny,
    }
  }

  const willDeselectRef = useRef(false)
  const wheelContainerRef = useRef(null)

  // Attach wheel listener as non-passive so preventDefault works.
  // Cursor-anchored zoom: keep the point under the cursor fixed while zooming.
  // Re-runs on viewZoom change so the handler reads the current zoom.
  useEffect(() => {
    const el = wheelContainerRef.current
    if (!el) return
    const handler = (e) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.1 : 0.1
      const newZoom = Math.max(0.5, Math.min(3, viewZoom + delta))
      if (newZoom === viewZoom) return
      zoomAtPoint(e.clientX, e.clientY, viewZoom, newZoom)
      setViewZoom(newZoom)
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [viewZoom, zoomAtPoint, setViewZoom])

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
    // Project the screen-space drag into the roof-axis local frame so the
    // preview rect aligns to the axis when one is set. With no axis the
    // projection is the identity, preserving the pre-roof-axis behavior.
    const { localDx, localDy } = projectDrag(dx, dy)
    const absLDx = Math.abs(localDx), absLDy = Math.abs(localDy)
    if (absLDx < 2 || absLDy < 2) return []
    // For vertical draw: swap width/height AND swap xDir/yDir sources
    // so the fill algorithm starts from the draw start point in rotated frame
    const vd = drawVertical
    const baseRotation = (roofAxisFrame?.angleDeg ?? 0) + (vd ? 90 : 0)
    return computeRectPanels({
      cx: (drawRectStart.x + drawRectEnd.x) / 2,
      cy: (drawRectStart.y + drawRectEnd.y) / 2,
      width:  vd ? absLDy : absLDx,
      height: vd ? absLDx : absLDy,
      rotation: baseRotation,
      // V-Draw: 90° rotation maps localX→screenY, localY→screen-X
      // xDir controls column fill along localX (→ screen Y after rotation)
      // yDir controls row stack along localY (→ screen -X after rotation, hence inverted)
      xDir: vd ? (localDy >= 0 ? 'ltr' : 'rtl') : (localDx >= 0 ? 'ltr' : 'rtl'),
      yDir: vd ? (localDx >= 0 ? 'btt' : 'ttb') : (localDy >= 0 ? 'ttb' : 'btt'),
    }, cmPerPixel, panelSpec, panelGapCm)
  }, [drawRectStart, drawRectEnd, cmPerPixel, panelSpec, panelGapCm, drawVertical, roofAxisFrame])

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
    if (yLockDragState) return 'grabbing'
    if (panActive || dragState) return 'grabbing'
    if (rectSelect) return 'crosshair'
    if (rotationState) return 'crosshair'
    switch (activeTool) {
      case 'move': return 'default'
      case 'rotate': return 'crosshair'
      case 'delete': return 'pointer'
      case 'add': return 'crosshair'
      case 'measure': return 'crosshair'
      case 'roofAxis': return (roofAxisDraft || axisHandleHover) ? 'move' : 'crosshair'
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

    const hitTestPanel = (p, px, py) => {
      const cx = p.x + p.width / 2, cy = p.y + p.height / 2
      const rad = -(p.rotation || 0) * Math.PI / 180
      const dx = px - cx, dy = py - cy
      const lx = dx * Math.cos(rad) - dy * Math.sin(rad)
      const ly = dx * Math.sin(rad) + dy * Math.cos(rad)
      return Math.abs(lx) <= p.width / 2 && Math.abs(ly) <= p.height / 2
    }
    const clickedPanel = panels.find(p => hitTestPanel(p, x, y))

    // In the area and roofAxis tools, drawing rows shares the same gesture.
    // (In roofAxis mode the axis itself is edited only by dragging its
    // endpoints — handled below — so empty-space clicks create rows.)
    const isAreaDraw = activeTool === 'area' || activeTool === 'roofAxis'

    // Roof axis editing: when an axis endpoint is clicked, drag it. This is
    // the ONLY axis-mutating gesture — empty-space clicks fall through to the
    // area-draw path below so they create a new row instead of redrawing the
    // axis. Checked before the Y-lock body select so grabbing an endpoint
    // that overlaps a locked area still edits the axis.
    if (activeTool === 'roofAxis' && roofAxis?.start && roofAxis?.end) {
      const HANDLE_HIT_PX = Math.max(8, (imageRef?.naturalWidth ?? 1000) * 0.012)
      const d1 = Math.hypot(x - roofAxis.start.x, y - roofAxis.start.y)
      const d2 = Math.hypot(x - roofAxis.end.x,   y - roofAxis.end.y)
      if (d1 < HANDLE_HIT_PX && d1 <= d2) {
        e.preventDefault()
        setRoofAxisDraft({ start: { x, y }, end: { ...roofAxis.end }, dragging: 'p1' })
        return
      }
      if (d2 < HANDLE_HIT_PX) {
        e.preventDefault()
        setRoofAxisDraft({ start: { ...roofAxis.start }, end: { x, y }, dragging: 'p2' })
        return
      }
    }

    // Y-lock body click: select the area (its panels). Rotation is corner-only
    // — body drag intentionally does nothing to avoid an over-eager gesture.
    if (isAreaDraw && !e.ctrlKey && !e.metaKey) {
      for (let areaIdx = 0; areaIdx < rectAreas.length; areaIdx++) {
        const area = rectAreas[areaIdx]
        if (area.mode !== 'ylocked' || !area.vertices?.length) continue
        if (!ptInPoly(x, y, area.vertices)) continue
        const areaPanelIds = panels.filter(p => (p.area ?? p.row) === areaIdx).map(p => p.id)
        setSelectedPanels(areaPanelIds)
        return
      }
    }

    // Measure tool — drag-to-draw: press sets the start, release sets the end
    // (finalized in handleSVGMouseUp). Consistent with the roof-axis / ruler /
    // Step1 reference-line gestures.
    if (activeTool === 'measure') {
      setDistanceMeasurement({ p1: [x, y], p2: null })
      return
    }

    if (isAreaDraw) {
      // Ctrl/Cmd + drag → group-areas marquee (works from any position).
      // preventDefault stops the browser from kicking in its native drag
      // (which on macOS Cmd+drag can swallow the mouseup event).
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        setGroupRowsRect({ startX: x, startY: y, endX: x, endY: y })
        return
      }
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
        // If the deleted panel was the last non-empty one in its area,
        // remove the (now-empty) area too — empty areas just clutter the
        // canvas and block step3.
        const areaKey = clickedPanel.area ?? clickedPanel.row
        if (areaKey != null && !newPanels.some(p => !p.isEmpty && (p.area ?? p.row) === areaKey)) {
          onDeleteArea?.(areaKey)
        }
      } else startPan(e)
      return
    }

    if (activeTool === 'rotate') {
      // Click-to-act, mirroring delete: rotate the clicked panel 90° on
      // mousedown. No selection state, no commit button.
      if (clickedPanel) {
        togglePanelOrientation?.([clickedPanel.id])
        setSelectedPanels([])
      } else startPan(e)
      return
    }

    if (activeTool === 'move') {
      if (clickedPanel) {
        if (e.shiftKey) {
          setSelectedPanels(prev => prev.includes(clickedPanel.id) ? prev.filter(id => id !== clickedPanel.id) : [...prev, clickedPanel.id])
          return
        }
        // Preserve multi-selection on click into the group so the upcoming
        // drag moves all of them together.
        if (!selectedPanels.includes(clickedPanel.id)) {
          setSelectedPanels([clickedPanel.id])
        }
        const panelIds = selectedPanels.includes(clickedPanel.id) ? selectedPanels : [clickedPanel.id]
        const originalPositions = {}
        panelIds.forEach(id => { const p = panels.find(p => p.id === id); if (p) originalPositions[id] = { x: p.x, y: p.y } })
        setDragState({ panelIds, startX: x, startY: y, originalPositions })
      } else {
        setRectSelect({ startX: x, startY: y, endX: x, endY: y })
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

    // Roof-axis endpoint hover → "move" cursor (mirrors the mousedown hit-test).
    if (activeTool === 'roofAxis' && roofAxis?.start && roofAxis?.end && !roofAxisDraft && !drawRectStart) {
      const HANDLE_HIT_PX = Math.max(8, (imageRef?.naturalWidth ?? 1000) * 0.012)
      const d1 = Math.hypot(x - roofAxis.start.x, y - roofAxis.start.y)
      const d2 = Math.hypot(x - roofAxis.end.x,   y - roofAxis.end.y)
      const overHandle = d1 < HANDLE_HIT_PX || d2 < HANDLE_HIT_PX
      if (overHandle !== axisHandleHover) setAxisHandleHover(overHandle)
    } else if (axisHandleHover) {
      setAxisHandleHover(false)
    }

    if ((activeTool === 'area' || activeTool === 'roofAxis') && drawRectStart) {
      setDrawRectEnd({ x, y })
      return
    }

    if (roofAxisDraft) {
      if (roofAxisDraft.dragging === 'p1') {
        setRoofAxisDraft({ ...roofAxisDraft, start: { x, y } })
      } else {
        setRoofAxisDraft({ ...roofAxisDraft, end: { x, y } })
      }
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
      const { areaIdx, startRotation, pivotX, pivotY, origVertices, origCornerX, origCornerY } = yLockDragState

      // Y-lock corner drag = pure rotation around the pivot. The dragged
      // corner follows the cursor's direction from the pivot; both X and Y
      // of the cursor contribute. Distance from pivot is preserved
      // automatically by rotating every original vertex around the pivot.
      const dxFromPivot = x - pivotX
      const dyFromPivot = y - pivotY
      const distFromPivot = Math.hypot(dxFromPivot, dyFromPivot)
      if (distFromPivot < 1) return  // too close to pivot, direction undefined
      const newAngle  = Math.atan2(dyFromPivot, dxFromPivot)
      const origAngle = Math.atan2(origCornerY - pivotY, origCornerX - pivotX)
      // Normalise delta into (-180, 180] so wrap-around at ±π doesn't jump.
      let deltaAngleDeg = (newAngle - origAngle) * 180 / Math.PI
      if (deltaAngleDeg > 180) deltaAngleDeg -= 360
      else if (deltaAngleDeg < -180) deltaAngleDeg += 360

      // Clamp to ±80°; snap to roof axis (or screen-0° if no axis is set)
      // when Cmd/Ctrl is held and the rotation is within 5° of the target.
      const rawRotation = startRotation + deltaAngleDeg
      const clamped = Math.max(-80, Math.min(80, rawRotation))
      deltaAngleDeg = clamped - startRotation
      // Roof axis target is the angle where the area's "0° reference line"
      // aligns with the user-defined roof. The 0° line is parallel to the
      // panels' width for horizontal areas, and along the panels' height
      // (perpendicular to lines) for vertical areas. Since panels' height
      // direction in screen ≡ panels' width rotated 90° via areaVertical,
      // both flavours snap when rotation === roofAngleDeg (lines bidirectional,
      // so we normalise into ±90).
      let snapTarget = 0
      if (roofAxis?.start && roofAxis?.end) {
        const roofAngleDeg = Math.atan2(
          roofAxis.end.y - roofAxis.start.y,
          roofAxis.end.x - roofAxis.start.x,
        ) * 180 / Math.PI
        snapTarget = roofAngleDeg
        while (snapTarget > 90) snapTarget -= 180
        while (snapTarget < -90) snapTarget += 180
      }
      const snapping = Math.abs(clamped - snapTarget) < 5 && (e.metaKey || e.ctrlKey)
      if (snapping) deltaAngleDeg = snapTarget - startRotation

      // Rotate every vertex around the pivot
      const rad = deltaAngleDeg * Math.PI / 180
      const cosA = Math.cos(rad), sinA = Math.sin(rad)
      const newVertices = origVertices.map(v => ({
        x: pivotX + (v.x - pivotX) * cosA - (v.y - pivotY) * sinA,
        y: pivotY + (v.x - pivotX) * sinA + (v.y - pivotY) * cosA,
      }))
      const actualRotation = startRotation + deltaAngleDeg
      setRectAreas(prev => prev.map((a, i) => i === areaIdx ? { ...a, rotation: actualRotation, vertices: newVertices } : a))

      if (Math.abs(clamped - snapTarget) < 10) {
        const xs = newVertices.map(v => v.x)
        const reach = Math.max(...newVertices.map(v => Math.hypot(v.x - pivotX, v.y - pivotY))) * 1.05
        // Pre-compute the inward-pointing axis sign so the snap guide
        // always emerges from V0 toward the polygon's body, regardless of
        // which way the roof axis happens to point in screen.
        const cxAvg = newVertices.reduce((s, v) => s + v.x, 0) / newVertices.length
        const cyAvg = newVertices.reduce((s, v) => s + v.y, 0) / newVertices.length
        let inwardSign = 1
        if (roofAxis?.start && roofAxis?.end) {
          const rdx = roofAxis.end.x - roofAxis.start.x
          const rdy = roofAxis.end.y - roofAxis.start.y
          const rlen = Math.hypot(rdx, rdy) || 1
          const rax = rdx / rlen, ray = rdy / rlen
          inwardSign = (rax * (cxAvg - pivotX) + ray * (cyAvg - pivotY)) >= 0 ? 1 : -1
        }
        setSnapGuideState({ pivotX, pivotY, minX: Math.min(...xs), maxX: Math.max(...xs), reach, snapping, inwardSign })
      } else {
        setSnapGuideState(null)
      }
      return
    }


    if (rectSelect) { setRectSelect(prev => ({ ...prev, endX: x, endY: y })); return }
    if (groupRowsRect) { setGroupRowsRect(prev => ({ ...prev, endX: x, endY: y })); return }

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
      // Snap is decoupled from gridline visibility — gridlines are a visual aid,
      // snap is a drag behaviour. When snap is on, snap in BOTH axes regardless
      // of which gridlines are shown.
      if (isDragging && snapToGridlines) {
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
            // Snap candidates per stationary panel edge `g`:
            //   g - hh - gap → dragged sits `gap` BEFORE g (side-by-side, with gap)
            //   g + hh       → dragged near-edge aligned with g (edge-aligned)
            // Applied separately to each of the stationary panel's two edges,
            // yielding both gap-spaced and edge-aligned snap targets. Gap is
            // lineGapCm across rows (H axis) and panelGapCm along rows (V axis).
            const lineGapPx = (lineGapCm ?? 0) / (refinedArea?.pixelToCmRatio ?? 1)
            const panelGapPx = (panelGapCm ?? 0) / (refinedArea?.pixelToCmRatio ?? 1)
            {
              const centerPerp = cx * vx + cy * vy
              const candidates = stationary.flatMap(p => {
                const pOff = (p.x + p.width/2) * vx + (p.y + p.height/2) * vy
                const top = pOff - p.height/2, bot = pOff + p.height/2
                return [
                  top - hh - lineGapPx,   // gap above stationary
                  top + hh,               // top-aligned
                  bot - hh,               // bottom-aligned
                  bot + hh + lineGapPx,   // gap below stationary
                ]
              })
              const nearest = candidates.reduce((b, c) => Math.abs(c - centerPerp) < Math.abs(b - centerPerp) ? c : b)
              if (Math.abs(nearest - centerPerp) < THRESH) { finalDx += (nearest - centerPerp) * vx; finalDy += (nearest - centerPerp) * vy }
            }
            {
              const cx2 = orig.x + refPanel.width / 2 + finalDx, cy2 = orig.y + refPanel.height / 2 + finalDy
              const centerPar = cx2 * ux + cy2 * uy
              const candidates = stationary.flatMap(p => {
                const pOff = (p.x + p.width/2) * ux + (p.y + p.height/2) * uy
                const left = pOff - p.width/2, right = pOff + p.width/2
                return [
                  left - hw - panelGapPx,  // gap to the left of stationary
                  left + hw,               // left-aligned
                  right - hw,              // right-aligned
                  right + hw + panelGapPx, // gap to the right of stationary
                ]
              })
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
    // Measure tool: finalize the end point at the current cursor position.
    if (activeTool === 'measure' && distanceMeasurement?.p1 && !distanceMeasurement?.p2) {
      const p1 = distanceMeasurement.p1
      const minDist = Math.max(5, (imageRef?.naturalWidth ?? 1000) * 0.01)
      if (mousePos && Math.hypot(mousePos.x - p1[0], mousePos.y - p1[1]) >= minDist) {
        setDistanceMeasurement({ p1, p2: [mousePos.x, mousePos.y] })
      } else {
        setDistanceMeasurement(null)
      }
      return
    }
    if (roofAxisDraft) {
      const len = Math.hypot(
        roofAxisDraft.end.x - roofAxisDraft.start.x,
        roofAxisDraft.end.y - roofAxisDraft.start.y,
      )
      // Discard tiny drags (a click without movement).
      if (len > 8) {
        setRoofAxis?.({ start: roofAxisDraft.start, end: roofAxisDraft.end })
      }
      setRoofAxisDraft(null)
      return
    }
    if (moveDragState) {
      const { areaIdx } = moveDragState
      setMoveDragState(null)
      setRectAreas(prev => {
        const area = prev[areaIdx]
        if (!area?.vertices?.length || !cmPerPixel || panelGapCm == null) return prev
        const effRot = (area.areaVertical ? 90 : 0) + (area.rotation ?? 0)
        const panels = computePolygonPanels(area, cmPerPixel, panelSpec, panelGapCm, area.preferredOrientations ?? null)
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
        // Resize "regenerates" the layout — drop any locked preferredOrientations
        // so the new bbox can grow new rows / fall back to greedy fill.
        const resized = { ...area, preferredOrientations: undefined }
        const panels = computePolygonPanels(resized, cmPerPixel, panelSpec, panelGapCm, null)
        if (!panels.length) return prev
        const pivot = resized.vertices[resized.pivotIdx ?? 0]
        const fitted = fitPolygonToRectPanels(panels, effRot, pivot.x, pivot.y)
        if (!fitted) return prev
        return prev.map((a, i) => i === areaIdx ? { ...resized, vertices: fitted } : a)
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
        const panels = computePolygonPanels(area, cmPerPixel, panelSpec, panelGapCm, area.preferredOrientations ?? null)
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
        // Match drawPreviewPanels: drive xDir/yDir and the area's natural
        // rotation from the drag projected into the roof-axis local frame.
        const { localDx, localDy } = projectDrag(dx, dy)
        const xDir = vd ? (localDy >= 0 ? 'ltr' : 'rtl') : (localDx >= 0 ? 'ltr' : 'rtl')
        const yDir = vd ? (localDx >= 0 ? 'btt' : 'ttb') : (localDy >= 0 ? 'ttb' : 'btt')
        const roofRotation = roofAxisFrame?.angleDeg ?? 0
        const baseRotation = roofRotation + (vd ? 90 : 0)
        const vertices = fitPolygonToRectPanels(
          drawPreviewPanels, baseRotation, drawRectStart.x, drawRectStart.y
        )
        if (vertices) {
          // `rotation` is the area-level rotation beyond the natural
          // orientation set by `areaVertical` (see panelGridService.ts
          // and the rotation snap in PanelCanvas). Stamp the roof-axis
          // angle here so subsequent rotations track correctly.
          onAddRectArea?.({ vertices, rotation: roofRotation, yDir, xDir, pivotIdx: 0, mode: 'free', areaVertical: drawVertical })
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
          const dominant = (Object.entries(counts) as [string, number][]).sort((a, b) => b[1] - a[1])[0][0]
          hit = hit.filter(p => String(p.area) === dominant)
        }
        setSelectedPanels(hit.map(p => p.id))
      } else {
        setSelectedPanels([])
      }
      setRectSelect(null); setDragState(null); setRotationState(null)
      return
    }

    if (groupRowsRect) {
      const minX = Math.min(groupRowsRect.startX, groupRowsRect.endX)
      const maxX = Math.max(groupRowsRect.startX, groupRowsRect.endX)
      const minY = Math.min(groupRowsRect.startY, groupRowsRect.endY)
      const maxY = Math.max(groupRowsRect.startY, groupRowsRect.endY)
      if (Math.max(maxX - minX, maxY - minY) > 8) {
        // Any panel whose center is inside the marquee contributes its area.
        // We then select EVERY panel of every such area — the sidebar shows
        // each whole area highlighted, not partial.
        const areasHit = new Set()
        panels.forEach(p => {
          if (p.isEmpty) return
          const cx = p.x + p.width / 2, cy = p.y + p.height / 2
          if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) {
            areasHit.add(p.area ?? p.row ?? 0)
          }
        })
        if (areasHit.size > 0) {
          const selected = panels.filter(p => !p.isEmpty && areasHit.has(p.area ?? p.row ?? 0))
          setSelectedPanels(selected.map(p => p.id))
        }
      }
      setGroupRowsRect(null)
      return
    }

    if (willDeselectRef.current) { setSelectedPanels([]); willDeselectRef.current = false }
    panRef.current = null
    setPanActive(false)
    setDragState(null)
    setRotationState(null)
  }

  const handleMouseLeave = () => {
    setRectSelect(null); panRef.current = null; setPanActive(false); willDeselectRef.current = false; setDragState(null); setRotationState(null); setMousePos(null); setDrawRectStart(null); setDrawRectEnd(null); setYLockDragState(null); setFreeDragState(null); setMoveDragState(null); setSnapGuideState(null); setGroupRowsRect(null); setRoofAxisDraft(null)
  }

  // Window-level mouseup safety net: if the user releases outside the SVG
  // (or the browser swallows the mouseup, as Cmd+drag sometimes does on
  // macOS), still finalise the marquee. Without this the gesture state
  // stays open and the rect "follows" the cursor on subsequent moves.
  // Leaving the measure tool clears the measurement (drawing/redrawing is just
  // press-drag-release; a new drag replaces the old one — so no clear button).
  useEffect(() => {
    if (activeTool !== 'measure' && distanceMeasurement) setDistanceMeasurement(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool])

  const measureInProgress = activeTool === 'measure' && !!distanceMeasurement?.p1 && !distanceMeasurement?.p2
  useEffect(() => {
    if (!groupRowsRect && !measureInProgress) return
    const onWindowUp = () => handleSVGMouseUp()
    window.addEventListener('mouseup', onWindowUp)
    return () => window.removeEventListener('mouseup', onWindowUp)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupRowsRect, measureInProgress])

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
          draggable={false}
          style={{
            display: 'block',
            transform: `rotate(${uploadedImageData.rotation ?? 0}deg) scale(${(uploadedImageData.scale ?? 1) * viewZoom})`,
            maxWidth: '100%', maxHeight: 'calc(100vh - 250px)',
            width: 'auto', height: 'auto', cursor: 'default'
          }}
        />

        {imageRef && (() => {
          const lineW    = Math.max(1, imageRef.naturalWidth * 0.001)
          const dashArray = `${Math.max(6, imageRef.naturalWidth * 0.006)},${Math.max(3, imageRef.naturalWidth * 0.003)}`
          // Unified style for user-drawn overlay lines + endpoint handles
          // (baseline, distance measure, roof axis). Dot/ring proportions match
          // RulerTool exactly: dot radius = 2× line width, ring = 0.6× line width.
          const drawnLineW = lineW * 3.5
          const dotR = drawnLineW * 2
          const handleRingW = drawnLineW * 0.6
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
                <line x1={baseline.p1[0]} y1={baseline.p1[1]} x2={baseline.p2[0]} y2={baseline.p2[1]} stroke={DRAW_COLOR} strokeWidth={drawnLineW} strokeDasharray={dashArray} />
                <circle cx={baseline.p1[0]} cy={baseline.p1[1]} r={dotR} fill={DRAW_COLOR} stroke={WHITE} strokeWidth={handleRingW} />
                <circle cx={baseline.p2[0]} cy={baseline.p2[1]} r={dotR} fill={DRAW_COLOR} stroke={WHITE} strokeWidth={handleRingW} />
              </>
            )}
            {baseline?.p1 && !baseline?.p2 && (
              <>
                <circle cx={baseline.p1[0]} cy={baseline.p1[1]} r={dotR} fill={DRAW_COLOR} stroke={WHITE} strokeWidth={handleRingW} />
                {mousePos && (
                  <line x1={baseline.p1[0]} y1={baseline.p1[1]} x2={mousePos.x} y2={mousePos.y} stroke={DRAW_COLOR} strokeWidth={drawnLineW} strokeDasharray={dashArray} />
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
              // Multi-row: only show label on the first row (rowIndex 0) of each group
              const isSubRow = (area.rowIndex ?? 0) > 0
              const groupId = area.areaGroupId
              void groupId // used for future convex hull rendering
              return (
                <g key={`${area.id}-${areaIdx}`} style={{ pointerEvents: 'auto' }}>
                  <polygon
                    points={pts}
                    fill={`${area.color}15`}
                    stroke={area.color}
                    strokeWidth={isSubRow ? lineW : lineW * 2}
                    strokeDasharray={isYLocked ? undefined : dashArray}
                    style={{ pointerEvents: 'none' }}
                  />
                  {/* Only show label on primary row (rowIndex 0) */}
                  {!isSubRow && (
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
                  )}
                  {area.vertices.map((v, cornerIdx) => {
                    const isPivot = cornerIdx === pivotIdx
                    const isDraggable = !isPivot || isYLocked
                    const cursor = isPivot && isYLocked ? 'move' : (isYLocked ? 'grab' : (isDraggable ? 'crosshair' : 'default'))
                    // Free mode: V0 is the anchor — not draggable. Render it
                    // as a small dimmed dot so the user sees it but reads it
                    // as non-interactive (other 3 corners are full handles).
                    const isFreePivot = isPivot && !isYLocked
                    return (
                      <circle
                        key={cornerIdx}
                        cx={v.x} cy={v.y} r={isFreePivot ? handleR * 0.45 : handleR}
                        fill={isFreePivot ? area.color : (isYLocked ? (isPivot ? 'white' : area.color) : 'white')}
                        stroke={area.color} strokeWidth={isFreePivot ? lineW * 0.75 : lineW * 1.5}
                        opacity={isFreePivot ? 0.5 : 1}
                        style={{ cursor, pointerEvents: isDraggable && areaIdx === selectedAreaIdx ? 'auto' : 'none' }}
                        onMouseDown={isDraggable ? (e) => {
                          e.stopPropagation()
                          const pivot = area.vertices[pivotIdx]
                          if (isPivot && isYLocked) {
                            // Use the vertex position as drag start (already in SVG coords)
                            setMoveDragState({ areaIdx, startX: v.x, startY: v.y, origVertices: area.vertices })
                          } else if (isYLocked) {
                            setYLockDragState({ areaIdx, cornerIdx, startRotation: area.rotation ?? 0, pivotX: pivot.x, pivotY: pivot.y, origVertices: area.vertices, origCornerX: v.x, origCornerY: v.y, areaVertical: area.areaVertical ?? false })
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
            {/* 0° snap guide (y-lock drag). Anchored at V0 (the rotation
                pivot), drawn one-sided along the roof axis when set;
                otherwise screen-horizontal across the polygon. Direction +
                start match the per-area preview line in the roof-axis tool. */}
            {snapGuideState && (() => {
              const { pivotX, pivotY, minX, maxX, reach, snapping, inwardSign = 1 } = snapGuideState
              const guideColor = snapping ? SUCCESS : WARNING
              const guideW = lineW * 1.5
              const gd = `${lineW * 8} ${lineW * 4}`
              const labelSize = Math.max(8, (imageRef?.naturalWidth ?? 1000) * 0.012)
              let p1x, p1y, p2x, p2y, dirX = 1, dirY = 0
              if (roofAxis?.start && roofAxis?.end) {
                const dx = roofAxis.end.x - roofAxis.start.x
                const dy = roofAxis.end.y - roofAxis.start.y
                const len = Math.hypot(dx, dy) || 1
                dirX = (dx / len) * inwardSign
                dirY = (dy / len) * inwardSign
                const r = reach ?? Math.max(maxX - minX, 1) / 2
                p1x = pivotX; p1y = pivotY
                p2x = pivotX + dirX * r; p2y = pivotY + dirY * r
              } else {
                p1x = minX; p1y = pivotY
                p2x = maxX; p2y = pivotY
              }
              return (
                <g style={{ pointerEvents: 'none' }}>
                  <line
                    x1={p1x} y1={p1y} x2={p2x} y2={p2y}
                    stroke={guideColor} strokeWidth={guideW}
                    strokeDasharray={snapping ? undefined : gd}
                    opacity={snapping ? 1 : 0.75}
                  />
                  <text
                    x={p2x + dirX * lineW * 4} y={p2y + dirY * lineW * 4}
                    dominantBaseline="middle"
                    textAnchor={dirX >= 0 ? 'start' : 'end'}
                    fill={guideColor}
                    fontSize={labelSize}
                    fontWeight="700"
                  >{snapping ? '0°' : '0°  ⌘ to snap'}</text>
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
              // Rotate the outline rect to the roof-axis frame so it matches
              // the panels rendered inside it. Width/height come from the
              // drag projected into that frame (identity when no axis).
              const { localDx, localDy } = projectDrag(dx, dy)
              const rectW = Math.abs(localDx), rectH = Math.abs(localDy)
              const rectRot = roofAxisFrame?.angleDeg ?? 0
              return (
                <g style={{ pointerEvents: 'none' }}>
                  <g transform={`rotate(${rectRot} ${cx} ${cy})`}>
                    <rect
                      x={cx - rectW/2} y={cy - rectH/2}
                      width={rectW} height={rectH}
                      fill={CANVAS_AREA_HOVER}
                      stroke={WARNING}
                      strokeWidth={lineW}
                      strokeDasharray={dashArray}
                    />
                  </g>
                  {drawPreviewPanels.map((p, i) => {
                    const pcx = p.x + p.width / 2, pcy = p.y + p.height / 2
                    const pibw = p.width * 0.012
                    // Drag direction in the roof-axis local frame so the cup
                    // orientation matches the rotated rect (identity when no
                    // axis is set).
                    const down = drawVertical ? localDx < 0 : localDy >= 0
                    const rDeg = p.rotation || 0
                    const bh = Math.min(p.width, p.height) * 0.22
                    const bw = bh * 1.9
                    const scale = bw > p.width * 0.82 ? (p.width * 0.82) / bw : 1
                    const bwS = bw * scale, bhS = bh * scale
                    const triPts = dirTrianglePoints(p.x, p.y, p.width, p.height, down)
                    const triW = Math.min(p.width, p.height) * 0.045
                    return (
                      <g key={i} style={{ pointerEvents: 'none' }}>
                        <g transform={`rotate(${rDeg} ${pcx} ${pcy})`}>
                          <rect x={p.x} y={p.y} width={p.width} height={p.height}
                            fill={PANEL_FILL} stroke="none" />
                          <rect x={p.x + pibw/2} y={p.y + pibw/2}
                            width={p.width - pibw} height={p.height - pibw}
                            fill="none" stroke={PANEL_MID} strokeWidth={pibw} />
                          {/* Direction triangle (matches the committed panels) */}
                          <polygon points={triPts} fill={PANEL_DIR_FILL} stroke={PANEL_DIR_HALO} strokeWidth={triW * 1.9} strokeLinejoin="round" />
                          <polygon points={triPts} fill="none" stroke={PANEL_MID} strokeWidth={triW} strokeLinejoin="round" />
                        </g>
                        <rect x={pcx - bwS/2} y={pcy - bhS/2} width={bwS} height={bhS} rx={bhS/2}
                          fill={PANEL_BADGE_DEFAULT} />
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
              const isActionHover = (activeTool === 'delete' || activeTool === 'rotate') && hoveredPanelId === panel.id
              const cx = panel.x + panel.width / 2, cy = panel.y + panel.height / 2
              const trapId = panel.trapezoidId || 'A1'
              let fill, borderColor, ibw
              if (isActionHover && activeTool === 'delete') { fill = PANEL_FILL_HOVER_DELETE; borderColor = ERROR; ibw = panel.width * 0.012 }
              else if (isActionHover && activeTool === 'rotate') { fill = PANEL_FILL_HOVER_ROTATE; borderColor = BLUE; ibw = panel.width * 0.012 }
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
                      style={{ cursor: (activeTool === 'delete' || activeTool === 'rotate') ? 'pointer' : activeTool === 'move' ? 'grab' : 'default' }}
                      onMouseEnter={() => (activeTool === 'delete' || activeTool === 'rotate') && setHoveredPanelId(panel.id)}
                      onMouseLeave={() => setHoveredPanelId(null)}
                    />
                    <rect
                      x={panel.x + ibw / 2} y={panel.y + ibw / 2}
                      width={panel.width - ibw} height={panel.height - ibw}
                      fill="none" stroke={borderColor} strokeWidth={ibw}
                      style={{ pointerEvents: 'none' }}
                    />
                  </g>
                  {!isActionHover && (() => {
                    const rDeg = panel.rotation || 0
                    const down = (panel.yDir ?? 'ttb') === 'ttb'
                    // Badge: centered at (cx, cy), capped to fit within panel width
                    const scale = bw > panel.width * 0.82 ? (panel.width * 0.82) / bw : 1
                    const bwS = bw * scale, fsS = fs * scale, bhS = bh * scale
                    // Direction triangle: spans the panel in its local frame,
                    // apex on the facing edge. Same direction as the old chevron
                    // (apexUp === `down`); rotation maps it to up/down/left/right.
                    const dirColor = isSelected ? PANEL_DARK : PANEL_MID
                    const triPts = dirTrianglePoints(panel.x, panel.y, panel.width, panel.height, down)
                    const triW = Math.min(panel.width, panel.height) * 0.045
                    return (
                      <>
                        {/* Direction triangle (rendered under the badge): white
                            fill + halo give contrast over dark roof photos */}
                        <g transform={`rotate(${rDeg} ${cx} ${cy})`} style={{ pointerEvents: 'none' }}>
                          <polygon points={triPts} fill={PANEL_DIR_FILL} stroke={PANEL_DIR_HALO} strokeWidth={triW * 1.9} strokeLinejoin="round" />
                          <polygon points={triPts} fill="none" stroke={dirColor} strokeWidth={triW} strokeLinejoin="round" />
                        </g>
                        {/* Badge */}
                        <rect x={cx - bwS / 2} y={cy - bhS / 2} width={bwS} height={bhS} rx={bhS / 2}
                          fill={isSelected ? PANEL_BADGE_SEL_FILL : PANEL_BADGE_DEFAULT}
                          style={{ pointerEvents: 'none' }} />
                        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                          fontSize={fsS} fontWeight="600" fill="white"
                          style={{ pointerEvents: 'none', letterSpacing: '0.03em' }}>
                          {trapId}
                        </text>
                      </>
                    )
                  })()}
                  {isActionHover && activeTool === 'delete' && (
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
                  <circle cx={p1[0]} cy={p1[1]} r={dotR} fill={PRIMARY} stroke={WHITE} strokeWidth={handleRingW} />
                  {mousePos && (
                    <line x1={p1[0]} y1={p1[1]} x2={mousePos.x} y2={mousePos.y}
                      stroke={PRIMARY} strokeWidth={drawnLineW} strokeDasharray={dashArray} />
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
                    stroke={PRIMARY} strokeWidth={drawnLineW} strokeDasharray={dashArray} />
                  <circle cx={p1[0]} cy={p1[1]} r={dotR} fill={PRIMARY} stroke={WHITE} strokeWidth={handleRingW} />
                  <circle cx={p2[0]} cy={p2[1]} r={dotR} fill={PRIMARY} stroke={WHITE} strokeWidth={handleRingW} />
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

            {/* Roof axis line. Shown whenever roof-axis mode is enabled (not
                just while the roofAxis tool is active) — either the committed
                axis with draggable handles, or the WIP draft mid-drag. */}
            {roofAxisEnabled && (() => {
              const axis = roofAxisDraft ?? roofAxis
              if (!axis?.start || !axis?.end) return null
              const dx = axis.end.x - axis.start.x
              const dy = axis.end.y - axis.start.y
              const len = Math.hypot(dx, dy) || 1
              const ax = dx / len, ay = dy / len
              const guideW = drawnLineW
              const gd = `${lineW * 8} ${lineW * 4}`
              const labelSize = Math.max(8, (imageRef?.naturalWidth ?? 1000) * 0.012)
              // Roof axis angle in screen coords, normalised to (−90°, 90°].
              let axisDeg = Math.atan2(dy, dx) * 180 / Math.PI
              while (axisDeg > 90) axisDeg -= 180
              while (axisDeg <= -90) axisDeg += 180
              const axisLabel = `${axisDeg.toFixed(1)}°`
              return (
                <g style={{ pointerEvents: 'none' }}>
                  {/* Blinks a few times when roof-axis mode is toggled on
                      (this <g> mounts fresh on toggle, so the finite-iteration
                      animation plays once), drawing the eye to the line. */}
                  <style>{`@keyframes roofAxisBlink { 0%,100%{opacity:1} 50%{opacity:0.1} }`}</style>
                  {/* The user-drawn roof axis. The per-area 0° preview lines
                      were dropped — the single axis line plus the rotation
                      snap guide (shown while dragging near the axis) are
                      enough now that roof-axis mode is explicit. */}
                  <line
                    x1={axis.start.x} y1={axis.start.y}
                    x2={axis.end.x}   y2={axis.end.y}
                    stroke={WARNING} strokeWidth={guideW}
                    strokeDasharray={gd}
                    opacity={0.85}
                    style={{ animation: 'roofAxisBlink 0.4s ease-in-out 3' }}
                  />
                  <circle cx={axis.start.x} cy={axis.start.y} r={dotR}
                    fill={WARNING} stroke={WHITE} strokeWidth={handleRingW} />
                  <circle cx={axis.end.x} cy={axis.end.y} r={dotR}
                    fill={WARNING} stroke={WHITE} strokeWidth={handleRingW} />
                  <text
                    x={axis.end.x + ax * lineW * 4}
                    y={axis.end.y + ay * lineW * 4}
                    fill={WARNING} fontSize={labelSize} fontWeight="700"
                    dominantBaseline="middle"
                    textAnchor={ax >= 0 ? 'start' : 'end'}
                  >{axisLabel}</text>
                </g>
              )
            })()}

            {/* Group-rows marquee (Ctrl/Cmd + drag in area tool) */}
            {groupRowsRect && (() => {
              const rx = Math.min(groupRowsRect.startX, groupRowsRect.endX)
              const ry = Math.min(groupRowsRect.startY, groupRowsRect.endY)
              const rw = Math.abs(groupRowsRect.endX - groupRowsRect.startX)
              const rh = Math.abs(groupRowsRect.endY - groupRowsRect.startY)
              return (
                <rect x={rx} y={ry} width={rw} height={rh}
                  fill={CANVAS_SEL_FILL} stroke={CANVAS_SEL_STROKE} strokeWidth="2" strokeDasharray="10,5"
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
          onZoomOut={() => { const nz = Math.max(0.5, viewZoom - 0.1); zoomAtCenter(viewZoom, nz); setViewZoom(nz) }}
          onZoomReset={() => { setViewZoom(1); setPanOffset({ x: 0, y: 0 }) }}
          onZoomIn={() => { const nz = Math.min(3, viewZoom + 0.1); zoomAtCenter(viewZoom, nz); setViewZoom(nz) }}
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
