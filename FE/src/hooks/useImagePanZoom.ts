import { useState, useRef } from 'react'

/**
 * Manages pan offset, pan-active state, and minimap helpers for image canvas views.
 * @param {HTMLImageElement|null} imageRef - the displayed image element
 */
export function useImagePanZoom(imageRef) {
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [panActive, setPanActive] = useState(false)
  const panRef     = useRef(null)
  const viewportRef = useRef(null)

  const MM_W = 180
  const MM_H = imageRef
    ? Math.min(120, Math.round(MM_W * imageRef.naturalHeight / Math.max(imageRef.naturalWidth, 1)))
    : 100

  // Cursor-anchored zoom: keep the point under (clientX, clientY) fixed on
  // screen while zooming from oldZoom → newZoom. The image + SVG scale around
  // their center (default transform-origin) inside a viewport-centered
  // container, so content-center = viewportCenter + panOffset; we solve for
  // the panOffset that holds the cursor point in place. Pass the viewport
  // center as the point to zoom around the middle (used by the +/- buttons).
  const zoomAtPoint = (clientX, clientY, oldZoom, newZoom) => {
    const vp = viewportRef.current
    if (!vp || oldZoom === newZoom) return
    const rect = vp.getBoundingClientRect()
    const qx = (clientX - rect.left) - rect.width / 2
    const qy = (clientY - rect.top) - rect.height / 2
    const ratio = newZoom / oldZoom
    setPanOffset(prev => ({
      x: qx - (qx - prev.x) * ratio,
      y: qy - (qy - prev.y) * ratio,
    }))
  }

  // Zoom around the viewport center (for the +/- buttons — no cursor).
  const zoomAtCenter = (oldZoom, newZoom) => {
    const vp = viewportRef.current
    if (!vp) return
    const rect = vp.getBoundingClientRect()
    zoomAtPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, oldZoom, newZoom)
  }

  const panToMinimapPoint = (mmX, mmY) => {
    if (!imageRef || !viewportRef.current) return
    const imgRect = imageRef.getBoundingClientRect()
    const vpRect  = viewportRef.current.getBoundingClientRect()
    const screenX = imgRect.left + (mmX / MM_W) * imgRect.width
    const screenY = imgRect.top  + (mmY / MM_H) * imgRect.height
    setPanOffset(prev => ({
      x: prev.x + (vpRect.left + vpRect.width  / 2) - screenX,
      y: prev.y + (vpRect.top  + vpRect.height / 2) - screenY,
    }))
  }

  const getMinimapViewportRect = () => {
    if (!imageRef || !viewportRef.current) return null
    const imgRect = imageRef.getBoundingClientRect()
    const vpRect  = viewportRef.current.getBoundingClientRect()
    const ol = Math.max(vpRect.left,   imgRect.left)
    const or = Math.min(vpRect.right,  imgRect.right)
    const ot = Math.max(vpRect.top,    imgRect.top)
    const ob = Math.min(vpRect.bottom, imgRect.bottom)
    if (or <= ol || ob <= ot) return null
    return {
      x: (ol - imgRect.left) / imgRect.width  * MM_W,
      y: (ot - imgRect.top)  / imgRect.height * MM_H,
      w: (or - ol)           / imgRect.width  * MM_W,
      h: (ob - ot)           / imgRect.height * MM_H,
    }
  }

  return {
    panOffset, setPanOffset,
    panActive, setPanActive,
    panRef,
    viewportRef,
    MM_W, MM_H,
    panToMinimapPoint,
    getMinimapViewportRect,
    zoomAtPoint,
    zoomAtCenter,
  }
}
