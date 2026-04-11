import { useState, useRef, useEffect, useCallback } from 'react'

const MM_W = 180
const MM_H = 100

/**
 * Shared pan/zoom hook for top-view canvas tabs (BasesPlanTab, RailLayoutTab).
 * Manages zoom, pan offset, and minimap helpers.
 */
export function useCanvasPanZoom() {
  const [zoom, setZoom] = useState(1)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [panActive, setPanActive] = useState(false)
  const panRef = useRef(null)
  const containerRef = useRef(null)
  const contentRef = useRef(null)
  const hasAutoFit = useRef(false)

  const handleWheel = (e) => {
    e.preventDefault()
    setZoom(z => Math.max(0.3, Math.min(8, z + (e.deltaY > 0 ? -0.15 : 0.15))))
  }

  // Attach wheel listener with { passive: false } so preventDefault() works.
  // React's onWheel prop registers passive listeners in modern browsers.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  })

  const startPan = (e) => {
    panRef.current = { startX: e.clientX, startY: e.clientY, startPanX: panOffset.x, startPanY: panOffset.y }
  }

  const handleMouseMove = (e) => {
    if (!panRef.current) return
    const dx = e.clientX - panRef.current.startX
    const dy = e.clientY - panRef.current.startY
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      setPanActive(true)
      setPanOffset({ x: panRef.current.startPanX + dx, y: panRef.current.startPanY + dy })
    }
  }

  const stopPan = () => { panRef.current = null; setPanActive(false) }
  
  const resetView = useCallback(() => { 
    setZoom(1)
    setPanOffset({ x: 0, y: 0 })
  }, [])

  /**
   * Center view on content at 100% zoom (like Step 2).
   */
  const centerView = useCallback(() => {
    if (!contentRef.current || !containerRef.current) return
    const contentRect = contentRef.current.getBoundingClientRect()
    const containerRect = containerRef.current.getBoundingClientRect()
    
    if (contentRect.width <= 0 || contentRect.height <= 0) return
    if (containerRect.width <= 0 || containerRect.height <= 0) return
    
    // Center content in viewport at zoom=1
    const centeredX = (containerRect.width - contentRect.width) / 2
    const centeredY = (containerRect.height - contentRect.height) / 2
    
    setZoom(1)
    setPanOffset({ x: centeredX, y: centeredY })
    hasAutoFit.current = true
  }, [])

  const panToMinimapPoint = (mmX, mmY) => {
    if (!contentRef.current || !containerRef.current) return
    const naturalW = contentRef.current.getBoundingClientRect().width  / zoom
    const naturalH = contentRef.current.getBoundingClientRect().height / zoom
    if (naturalW <= 0 || naturalH <= 0) return
    const cr = containerRef.current.getBoundingClientRect()
    setPanOffset({
      x: cr.width  / 2 - (mmX / MM_W) * naturalW * zoom,
      y: cr.height / 2 - (mmY / MM_H) * naturalH * zoom,
    })
  }

  const getMinimapViewportRect = () => {
    if (!contentRef.current || !containerRef.current) return null
    const naturalW = contentRef.current.getBoundingClientRect().width  / zoom
    const naturalH = contentRef.current.getBoundingClientRect().height / zoom
    if (naturalW <= 0 || naturalH <= 0) return null
    const cr = containerRef.current.getBoundingClientRect()
    return {
      x: Math.max(0, (-panOffset.x / zoom) / naturalW * MM_W),
      y: Math.max(0, (-panOffset.y / zoom) / naturalH * MM_H),
      w: Math.min(MM_W, (cr.width  / zoom) / naturalW * MM_W),
      h: Math.min(MM_H, (cr.height / zoom) / naturalH * MM_H),
    }
  }

  return {
    zoom, setZoom,
    panOffset, setPanOffset,
    panActive,
    containerRef, contentRef,
    handleWheel, startPan, handleMouseMove, stopPan, resetView, centerView,
    MM_W, MM_H, panToMinimapPoint, getMinimapViewportRect,
  }
}
