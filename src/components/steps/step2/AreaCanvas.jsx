import { useImagePanZoom } from '../../../hooks/useImagePanZoom'
import CanvasNavigator from '../../shared/CanvasNavigator'

export default function AreaCanvas({
  uploadedImageData, viewZoom, setViewZoom,
  imageRef, setImageRef,
  roofPolygon,
  referenceLine, isDrawingLine, lineStart,
  areas, projectMode,
  activeGroupId, baselineDrawStart,
  handleImageClick, isDrawingAnything,
}) {
  const { panOffset, setPanOffset, panActive, setPanActive, panRef, viewportRef, MM_W, MM_H, panToMinimapPoint, getMinimapViewportRect } = useImagePanZoom(imageRef)

  const labelFontSize = imageRef ? Math.max(12, Math.min(36, imageRef.naturalWidth * 0.012)) : 14

  const handleContainerMouseDown = (e) => {
    if (e.button !== 0 || isDrawingAnything) return
    panRef.current = { startX: e.clientX, startY: e.clientY, startPanX: panOffset.x, startPanY: panOffset.y }
  }

  const handleContainerMouseMove = (e) => {
    if (!panRef.current) return
    const dx = e.clientX - panRef.current.startX
    const dy = e.clientY - panRef.current.startY
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      if (!panActive) setPanActive(true)
      setPanOffset({ x: panRef.current.startPanX + dx, y: panRef.current.startPanY + dy })
    }
  }

  const handleContainerMouseUp = () => {
    panRef.current = null
    setPanActive(false)
  }

  return (
    <div className="uploaded-image-view" ref={viewportRef} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%', overflow: 'auto', position: 'relative' }}>
      <div
        className="uploaded-image-container"
        style={{ position: 'relative', display: 'inline-block', width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '100%', transform: `translate(${panOffset.x}px, ${panOffset.y}px)`, cursor: panActive ? 'grabbing' : (isDrawingAnything ? 'crosshair' : 'grab') }}
        onWheel={(e) => { e.preventDefault(); setViewZoom(Math.max(0.5, Math.min(3, viewZoom + (e.deltaY > 0 ? -0.1 : 0.1)))) }}
        onMouseDown={handleContainerMouseDown}
        onMouseMove={handleContainerMouseMove}
        onMouseUp={handleContainerMouseUp}
        onMouseLeave={handleContainerMouseUp}
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
                    <polygon points={roofPolygon.coordinates.map(c => `${c[0]},${c[1]}`).join(' ')} fill="black"/>
                  </mask>
                </defs>
                <rect width="100%" height="100%" fill="rgba(0,0,0,0.6)" mask="url(#polygonMask)"/>
                <polygon points={roofPolygon.coordinates.map(c => `${c[0]},${c[1]}`).join(' ')} fill="rgba(196,214,0,0.2)" stroke="#C4D600" strokeWidth="3"/>
              </>
            )}

            {/* Reference line */}
            {referenceLine && (
              <>
                <line x1={referenceLine.start.x} y1={referenceLine.start.y} x2={referenceLine.end.x} y2={referenceLine.end.y} stroke="#FF5722" strokeWidth="2" strokeDasharray="8,4"/>
                <circle cx={referenceLine.start.x} cy={referenceLine.start.y} r="4" fill="#FF5722" stroke="white" strokeWidth="1.5"/>
                <circle cx={referenceLine.end.x} cy={referenceLine.end.y} r="4" fill="#FF5722" stroke="white" strokeWidth="1.5"/>
              </>
            )}
            {isDrawingLine && lineStart && (
              <circle cx={lineStart.x} cy={lineStart.y} r="4" fill="#FF5722" stroke="white" strokeWidth="1.5"/>
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

            {/* Active group baseline first click */}
            {activeGroupId && baselineDrawStart && (
              <circle
                cx={baselineDrawStart[0]} cy={baselineDrawStart[1]}
                r={labelFontSize * 0.4}
                fill={areas.find(g => g.id === activeGroupId)?.color || '#fff'}
                stroke="white" strokeWidth="2"
              />
            )}
          </svg>
        )}

        {/* Drawing hint banner */}
        {isDrawingAnything && (
          <div style={{ position: 'absolute', top: '1rem', left: '50%', transform: 'translateX(-50%)', background: 'rgba(255,152,0,0.92)', color: 'white', padding: '0.5rem 1.25rem', borderRadius: '20px', fontSize: '0.85rem', fontWeight: '600', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
            {isDrawingLine
              ? (lineStart ? 'Click second point to finish reference line' : 'Click first point of reference line')
              : (baselineDrawStart ? 'Click second point to finish baseline' : `Click first point of baseline for ${areas.find(g => g.id === activeGroupId)?.label}`)}
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
