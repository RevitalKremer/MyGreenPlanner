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
  }
}
