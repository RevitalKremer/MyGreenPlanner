import { useState } from 'react'
import { BLACK, PRIMARY, WARNING } from '../../../styles/colors'
import { useImagePanZoom } from '../../../hooks/useImagePanZoom'
import CanvasNavigator from '../../shared/CanvasNavigator'

export default function AreaCanvas({
  uploadedImageData, viewZoom, setViewZoom,
  imageRef, setImageRef,
  roofPolygon,
  areas, projectMode,
  activeGroupId, baselineDrawStart,
  handleImageClick, isDrawingAnything,
}) {
  const { panOffset, setPanOffset, panActive, setPanActive, panRef, viewportRef, MM_W, MM_H, panToMinimapPoint, getMinimapViewportRect } = useImagePanZoom(imageRef)
  const [mousePos, setMousePos] = useState(null)

  const labelFontSize = imageRef ? Math.max(12, Math.min(36, imageRef.naturalWidth * 0.012)) : 14
  const dotR     = imageRef ? Math.max(2, imageRef.naturalWidth * 0.002) : 2
  const lineW    = imageRef ? Math.max(1, imageRef.naturalWidth * 0.001) : 1
  const dashArray = imageRef
    ? `${Math.max(6, imageRef.naturalWidth * 0.006)},${Math.max(3, imageRef.naturalWidth * 0.003)}`
    : '6,3'

  const toImageCoords = (e) => {
    if (!imageRef) return null
    const rect = imageRef.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * imageRef.naturalWidth,
      y: ((e.clientY - rect.top) / rect.height) * imageRef.naturalHeight,
    }
  }

  const handleContainerMouseDown = (e) => {
    if (e.button !== 0 || isDrawingAnything) return
    panRef.current = { startX: e.clientX, startY: e.clientY, startPanX: panOffset.x, startPanY: panOffset.y }
  }

  const handleContainerMouseMove = (e) => {
    if (panRef.current) {
      const dx = e.clientX - panRef.current.startX
      const dy = e.clientY - panRef.current.startY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        if (!panActive) setPanActive(true)
        setPanOffset({ x: panRef.current.startPanX + dx, y: panRef.current.startPanY + dy })
      }
    }
    if (isDrawingAnything) {
      const pos = toImageCoords(e)
      if (pos) setMousePos(pos)
    }
  }

  const handleContainerMouseUp = () => {
    panRef.current = null
    setPanActive(false)
  }

  const handleContainerMouseLeave = () => {
    panRef.current = null
    setPanActive(false)
    setMousePos(null)
  }

  const activeGroup = activeGroupId ? areas.find(g => g.id === activeGroupId) : null

  return (
    <div className="uploaded-image-view" ref={viewportRef} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%', overflow: 'auto', position: 'relative' }}>
      <div
        className="uploaded-image-container"
        style={{ position: 'relative', display: 'inline-block', width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '100%', transform: `translate(${panOffset.x}px, ${panOffset.y}px)`, cursor: panActive ? 'grabbing' : (isDrawingAnything ? 'crosshair' : 'grab') }}
        onWheel={(e) => { e.preventDefault(); setViewZoom(Math.max(0.5, Math.min(3, viewZoom + (e.deltaY > 0 ? -0.1 : 0.1)))) }}
        onMouseDown={handleContainerMouseDown}
        onMouseMove={handleContainerMouseMove}
        onMouseUp={handleContainerMouseUp}
        onMouseLeave={handleContainerMouseLeave}
      >
        <img
          ref={(el) => { if (el) setImageRef(el) }}
          src={uploadedImageData.imageData}
          alt="Roof"
          onClick={handleImageClick}
          style={{
            display: 'block',
            transform: `rotate(${uploadedImageData.rotation ?? 0}deg) scale(${(uploadedImageData.scale ?? 1) * viewZoom})`,
            maxWidth: '100%', maxHeight: 'calc(100vh - 250px)',
            width: 'auto', height: 'auto',
            cursor: isDrawingAnything ? 'crosshair' : 'default'
          }}
        />

        {imageRef && (
          <svg
            viewBox={`0 0 ${imageRef.naturalWidth} ${imageRef.naturalHeight}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', transform: `rotate(${uploadedImageData.rotation ?? 0}deg) scale(${(uploadedImageData.scale ?? 1) * viewZoom})` }}
          >
            {/* Roof polygon overlay */}
            {roofPolygon && (
              <>
                <defs>
                  <mask id="polygonMask">
                    <rect width="100%" height="100%" fill="white"/>
                    <polygon points={roofPolygon.coordinates.map(c => `${c[0]},${c[1]}`).join(' ')} fill={BLACK}/>
                  </mask>
                </defs>
                <rect width="100%" height="100%" fill="rgba(0,0,0,0.6)" mask="url(#polygonMask)"/>
                <polygon points={roofPolygon.coordinates.map(c => `${c[0]},${c[1]}`).join(' ')} fill="none" stroke={PRIMARY} strokeWidth="3"/>
              </>
            )}

            {/* Group baselines (plan mode) */}
            {projectMode === 'plan' && areas.map(group => (
              group.baseline && (
                <g key={group.id}>
                  <line
                    x1={group.baseline.p1[0]} y1={group.baseline.p1[1]}
                    x2={group.baseline.p2[0]} y2={group.baseline.p2[1]}
                    stroke={group.color} strokeWidth={Math.max(2, labelFontSize * 0.15)}
                  />
                  <circle cx={group.baseline.p1[0]} cy={group.baseline.p1[1]} r={labelFontSize * 0.4} fill={group.color}/>
                  <circle cx={group.baseline.p2[0]} cy={group.baseline.p2[1]} r={labelFontSize * 0.4} fill={group.color}/>
                  <text
                    x={group.baseline.p1[0] + labelFontSize * 0.6}
                    y={group.baseline.p1[1] - labelFontSize * 0.6}
                    fill={group.color} fontSize={labelFontSize} fontWeight="700"
                    style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}
                  >{group.label}</text>
                </g>
              )
            ))}

            {/* Baseline: first click dot */}
            {activeGroup && baselineDrawStart && (
              <circle
                cx={baselineDrawStart[0]} cy={baselineDrawStart[1]}
                r={dotR}
                fill={activeGroup.color}
              />
            )}

            {/* Baseline: live preview */}
            {activeGroup && baselineDrawStart && mousePos && (
              <line
                x1={baselineDrawStart[0]} y1={baselineDrawStart[1]}
                x2={mousePos.x} y2={mousePos.y}
                stroke={activeGroup.color}
                strokeWidth={lineW}
                strokeDasharray={dashArray}
              />
            )}
          </svg>
        )}

        {/* Drawing hint banner */}
        {isDrawingAnything && (
          <div style={{ position: 'absolute', top: '1rem', left: '50%', transform: 'translateX(-50%)', background: `${WARNING}eb`, color: 'white', padding: '0.5rem 1.25rem', borderRadius: '20px', fontSize: '0.85rem', fontWeight: '600', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
            {baselineDrawStart ? 'Click second point to finish baseline' : `Click first point of baseline for ${activeGroup?.label}`}
          </div>
        )}
      </div>

      {/* Floating navigator */}
      {imageRef && (
        <CanvasNavigator
          viewZoom={viewZoom}
          onZoomOut={() => setViewZoom(Math.max(0.5, viewZoom - 0.1))}
          onZoomReset={() => { setViewZoom(1); setPanOffset({ x: 0, y: 0 }) }}
          onZoomIn={() => setViewZoom(Math.min(3, viewZoom + 0.1))}
          imageData={uploadedImageData.imageData}
          mmWidth={MM_W} mmHeight={MM_H}
          onPanToPoint={panToMinimapPoint}
          viewportRect={getMinimapViewportRect()}
        >
          <rect width={MM_W} height={MM_H} fill="rgba(0,0,0,0.2)" />
        </CanvasNavigator>
      )}
    </div>
  )
}
