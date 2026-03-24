import { useState, useRef, useEffect } from 'react'
import { PRIMARY, TEXT, TEXT_LIGHT, TEXT_VERY_LIGHT, TEXT_SECONDARY, TEXT_MUTED, BORDER_LIGHT, ERROR, DRAW_COLOR } from '../../styles/colors'
import { useImagePanZoom } from '../../hooks/useImagePanZoom'
import CanvasNavigator from '../shared/CanvasNavigator'
import RoofMapper from '../RoofMapper'
import ImageUploader from '../ImageUploader'

const ACCENT = PRIMARY
const POLY_COLOR = PRIMARY

const IconMap = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
    <line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>
  </svg>
)
const IconImage = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
    <polyline points="21 15 16 10 5 21"/>
  </svg>
)
const IconAuto = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/>
  </svg>
)
const IconPen = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
  </svg>
)

export default function Step1RoofAllocation({
  uploadedImageMode,
  setUploadedImageMode,
  backendStatus,
  uploadedImageData,
  setUploadedImageData,
  handleImageUploaded,
  imageRef,
  setImageRef,
  handleImageClick,
  roofPolygon,
  selectedPoint,
  setSelectedPoint,
  setRoofPolygon,
  handlePointSelect,
  onWhiteboardStart,
  projectMode,
  isDrawingLine,
  setIsDrawingLine,
  lineStart,
  setLineStart,
  referenceLine,
  setReferenceLine,
  referenceLineLengthCm,
  setReferenceLineLengthCm,
}) {
  const [drawMode, setDrawMode]           = useState('auto')   // 'auto' | 'draw'
  const [isDrawing, setIsDrawing]         = useState(false)
  const [drawingPoints, setDrawingPoints] = useState([])
  const [mousePos, setMousePos]           = useState(null)
  const [addRoofImage, setAddRoofImage]   = useState(false)
  const [viewZoom, setViewZoom]           = useState(1)

  const { panOffset, setPanOffset, panActive, setPanActive, panRef, viewportRef, MM_W, MM_H, panToMinimapPoint, getMinimapViewportRect } = useImagePanZoom(imageRef)

  const isAnyDrawing = isDrawing || isDrawingLine

  const handleContainerMouseDown = (e) => {
    if (e.button !== 0 || isAnyDrawing) return
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
  const handleContainerMouseUp    = () => { panRef.current = null; setPanActive(false) }
  const handleContainerMouseLeave = () => { panRef.current = null; setPanActive(false) }

  const refDotR     = imageRef ? Math.max(2, imageRef.naturalWidth * 0.002) : 2
  const refLineW    = imageRef ? Math.max(1, imageRef.naturalWidth * 0.001) : 1
  const refDashArray = imageRef
    ? `${Math.max(6, imageRef.naturalWidth * 0.006)},${Math.max(3, imageRef.naturalWidth * 0.003)}`
    : '6,3'

  const isScratch = projectMode === 'scratch'

  const handleAddRoofImageToggle = (checked) => {
    setAddRoofImage(checked)
    if (checked) {
      // Clear white canvas so ImageUploader is shown
      if (uploadedImageData?.isScratch) setUploadedImageData(null)
      setRoofPolygon(null)
      setUploadedImageMode(true)
    } else {
      onWhiteboardStart()
    }
  }

  const handleSourceToggle = (imageMode) => {
    setUploadedImageMode(imageMode)
    setRoofPolygon(null)
    if (!imageMode && uploadedImageData?.isScratch) setUploadedImageData(null)
  }

  const localImgRef = useRef(null)

  // Escape cancels drawing
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && isDrawing) {
        setIsDrawing(false)
        setDrawingPoints([])
        setMousePos(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isDrawing])

  // Reset drawing state whenever the image changes
  useEffect(() => {
    setIsDrawing(false)
    setDrawingPoints([])
    setMousePos(null)
  }, [uploadedImageData])

  const getImageCoords = (e) => {
    const img = localImgRef.current
    if (!img || !uploadedImageData) return null
    const rect = img.getBoundingClientRect()
    return {
      x: Math.round((e.clientX - rect.left) * (img.naturalWidth  / rect.width)),
      y: Math.round((e.clientY - rect.top)  * (img.naturalHeight / rect.height))
    }
  }

  const closeDistance = uploadedImageData
    ? Math.max(10, Math.min(30, uploadedImageData.width * 0.02))
    : 20

  const isNearFirst = (pt) => {
    if (drawingPoints.length < 3) return false
    const [fx, fy] = drawingPoints[0]
    return Math.hypot(pt.x - fx, pt.y - fy) < closeDistance
  }

  const commitPolygon = (pts) => {
    setRoofPolygon({ coordinates: pts, area: null, confidence: 1 })
    setIsDrawing(false)
    setDrawingPoints([])
    setMousePos(null)
  }

  const handleSVGClick = (e) => {
    if (isDrawingLine) {
      const coords = getImageCoords(e)
      if (!coords) return
      if (!lineStart) { setLineStart(coords) }
      else { setReferenceLine({ start: lineStart, end: coords }); setLineStart(null); setIsDrawingLine(false) }
      return
    }
    if (!isDrawing) {
      // In auto mode, pass through to SAM2 handler on the img below
      return
    }
    const coords = getImageCoords(e)
    if (!coords) return
    if (e.detail >= 2 || isNearFirst(coords)) {
      if (drawingPoints.length >= 3) commitPolygon(drawingPoints)
      return
    }
    setDrawingPoints(prev => [...prev, [coords.x, coords.y]])
  }

  const handleSVGMouseMove = (e) => {
    if (!isDrawing && !isDrawingLine) return
    const coords = getImageCoords(e)
    if (coords) setMousePos(coords)
  }

  const startDrawing = () => {
    setRoofPolygon(null)
    setSelectedPoint(null)
    setDrawingPoints([])
    setMousePos(null)
    setIsDrawing(true)
  }

  const hint = isScratch && !addRoofImage
    ? 'White canvas ready — click Next to set scale, or add a roof image using the panel'
    : !uploadedImageMode
      ? 'Click anywhere on the roof — SAM2 will detect its outline'
      : drawMode === 'draw'
        ? isDrawing
          ? 'Click to add vertices · double-click or click first point to close · Esc to cancel'
          : 'Press "Start Drawing" then click to trace the roof outline'
        : 'Click anywhere on the roof — SAM2 will detect its boundary'

  return (
    <>
      {/* ── Toolbar ── */}
      <div className="step-options">

        {/* Source: Map vs Image — only shown in plan mode (scratch uses floating panel) */}
        {!isScratch && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '0.62rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Source</span>
            <div className="seg-control">
              <button className={`seg-btn${!uploadedImageMode ? ' seg-active' : ''}`} onClick={() => handleSourceToggle(false)}>
                <IconMap /> Map
              </button>
              <button className={`seg-btn${uploadedImageMode ? ' seg-active' : ''}`} onClick={() => handleSourceToggle(true)}>
                <IconImage /> Image
              </button>
            </div>
          </div>
        )}


        {/* Hint text */}
        <div style={{ flex: 1, padding: '0 0.75rem', fontSize: '0.8rem', color: TEXT_LIGHT, fontStyle: 'italic', alignSelf: 'flex-end', paddingBottom: '2px' }}>
          {hint}
        </div>

        {/* SAM2 status */}
        <div className="step-status" style={{ alignSelf: 'flex-end', paddingBottom: '2px' }}>
          {backendStatus.status === 'checking' && <span className="status-badge status-checking">Checking</span>}
          {backendStatus.status === 'running' && backendStatus.model_loaded && <span className="status-badge status-ready">SAM2 Ready</span>}
          {backendStatus.status === 'running' && !backendStatus.model_loaded && <span className="status-badge status-warning">Loading</span>}
          {backendStatus.status === 'offline' && <span className="status-badge status-offline">Offline</span>}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="step-content-area" style={{ position: 'relative' }}>
        {uploadedImageMode ? (
          uploadedImageData ? (
            <div className="uploaded-image-view" ref={viewportRef} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%', overflow: 'auto', position: 'relative' }}>
              <div
                className="uploaded-image-container"
                style={{ position: 'relative', display: 'inline-block', width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '100%', transform: `translate(${panOffset.x}px, ${panOffset.y}px)`, cursor: isAnyDrawing ? 'crosshair' : panActive ? 'grabbing' : 'grab' }}
                onWheel={(e) => { e.preventDefault(); setViewZoom(z => Math.max(0.5, Math.min(3, z + (e.deltaY > 0 ? -0.1 : 0.1)))) }}
                onMouseDown={handleContainerMouseDown}
                onMouseMove={handleContainerMouseMove}
                onMouseUp={handleContainerMouseUp}
                onMouseLeave={handleContainerMouseLeave}
              >
                <img
                  ref={(el) => { localImgRef.current = el; setImageRef(el) }}
                  src={uploadedImageData.imageData}
                  alt="Uploaded roof"
                  onClick={drawMode === 'auto' && !isDrawingLine ? handleImageClick : undefined}
                  style={{
                    display: 'block',
                    transform: `rotate(${uploadedImageData.rotation ?? 0}deg) scale(${(uploadedImageData.scale ?? 1) * viewZoom})`,
                    maxWidth: '100%',
                    maxHeight: 'calc(100vh - 250px)',
                    width: 'auto',
                    height: 'auto',
                    cursor: isAnyDrawing ? 'crosshair' : 'default'
                  }}
                />

                {/* SVG overlay — handles drawing and displays polygon */}
                {imageRef && (
                  <svg
                    viewBox={`0 0 ${imageRef.naturalWidth} ${imageRef.naturalHeight}`}
                    preserveAspectRatio="xMidYMid meet"
                    style={{
                      position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                      pointerEvents: drawMode === 'draw' || isDrawingLine ? 'all' : 'none',
                      cursor: isDrawing || isDrawingLine ? 'crosshair' : 'default',
                      transform: `rotate(${uploadedImageData.rotation ?? 0}deg) scale(${(uploadedImageData.scale ?? 1) * viewZoom})`
                    }}
                    onClick={handleSVGClick}
                    onMouseMove={handleSVGMouseMove}
                  >
                    {/* Confirmed polygon */}
                    {roofPolygon?.coordinates && (
                      <polygon
                        points={roofPolygon.coordinates.map(c => `${c[0]},${c[1]}`).join(' ')}
                        fill="none"
                        stroke={POLY_COLOR}
                        strokeWidth="3"
                      />
                    )}

                    {/* In-progress polygon drawing */}
                    {isDrawing && drawingPoints.length > 0 && (() => {
                      const pts = drawingPoints
                      const nearFirst = mousePos && isNearFirst(mousePos)

                      const lines = []
                      for (let i = 1; i < pts.length; i++) {
                        lines.push(
                          <line key={i}
                            x1={pts[i-1][0]} y1={pts[i-1][1]}
                            x2={pts[i][0]}   y2={pts[i][1]}
                            stroke={POLY_COLOR} strokeWidth={2} strokeDasharray="6,4" />
                        )
                      }
                      const liveLine = mousePos && (
                        <line
                          x1={pts[pts.length-1][0]} y1={pts[pts.length-1][1]}
                          x2={mousePos.x} y2={mousePos.y}
                          stroke={POLY_COLOR} strokeWidth={1.5} strokeDasharray="4,4" opacity={0.7} />
                      )
                      const closePreview = nearFirst && mousePos && (
                        <line x1={mousePos.x} y1={mousePos.y} x2={pts[0][0]} y2={pts[0][1]}
                          stroke={ACCENT} strokeWidth={2} strokeDasharray="4,4" />
                      )
                      const dots = pts.map(([vx, vy], idx) => (
                        <circle key={`v${idx}`} cx={vx} cy={vy}
                          r={idx === 0 ? 8 : 5}
                          fill={idx === 0 ? (nearFirst ? ACCENT : 'white') : POLY_COLOR}
                          stroke={POLY_COLOR} strokeWidth={2} />
                      ))
                      return <>{lines}{liveLine}{closePreview}{dots}</>
                    })()}

                    {/* Reference line (confirmed) */}
                    {referenceLine && (
                      <>
                        <line x1={referenceLine.start.x} y1={referenceLine.start.y} x2={referenceLine.end.x} y2={referenceLine.end.y} stroke={DRAW_COLOR} strokeWidth={refLineW} strokeDasharray={refDashArray}/>
                        <circle cx={referenceLine.start.x} cy={referenceLine.start.y} r={refDotR} fill={DRAW_COLOR}/>
                        <circle cx={referenceLine.end.x} cy={referenceLine.end.y} r={refDotR} fill={DRAW_COLOR}/>
                      </>
                    )}
                    {/* Reference line: first click dot */}
                    {isDrawingLine && lineStart && (
                      <circle cx={lineStart.x} cy={lineStart.y} r={refDotR} fill={DRAW_COLOR}/>
                    )}
                    {/* Reference line: live preview */}
                    {isDrawingLine && lineStart && mousePos && (
                      <line x1={lineStart.x} y1={lineStart.y} x2={mousePos.x} y2={mousePos.y} stroke={DRAW_COLOR} strokeWidth={refLineW} strokeDasharray={refDashArray}/>
                    )}
                  </svg>
                )}

                {/* Reference line drawing banner */}
                {isDrawingLine && (
                  <div style={{ position: 'absolute', top: '1rem', left: '50%', transform: 'translateX(-50%)', background: `${PRIMARY}eb`, color: 'white', padding: '0.5rem 1.25rem', borderRadius: '20px', fontSize: '0.85rem', fontWeight: '600', pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 10 }}>
                    {lineStart ? 'Click second point to finish reference line' : 'Click first point of reference line'}
                  </div>
                )}

                {/* SAM2 click-point marker */}
                {drawMode === 'auto' && selectedPoint && imageRef && (
                  <div
                    className="selected-point-marker"
                    style={{
                      position: 'absolute',
                      left: `calc(50% + ${(selectedPoint.x - imageRef.naturalWidth / 2) * (imageRef.width / imageRef.naturalWidth)}px)`,
                      top:  `calc(50% + ${(selectedPoint.y - imageRef.naturalHeight / 2) * (imageRef.height / imageRef.naturalHeight)}px)`,
                      width: '20px', height: '20px', borderRadius: '50%',
                      border: '3px solid #FF5722', background: 'rgba(255,87,34,0.5)',
                      transform: `translate(-50%,-50%) rotate(${uploadedImageData.rotation ?? 0}deg) scale(${uploadedImageData.scale ?? 1})`,
                      transformOrigin: 'center', pointerEvents: 'none', zIndex: 10
                    }}
                  />
                )}

                {/* Draw mode controls */}
                {drawMode === 'draw' && (
                  <div style={{ position: 'absolute', bottom: '1rem', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '0.5rem' }}>
                    {!isDrawing && (
                      <button onClick={startDrawing}
                        style={{ padding: '0.5rem 1.2rem', background: ACCENT, color: TEXT, border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: '0.88rem' }}>
                        {roofPolygon ? 'Re-draw' : 'Start Drawing'}
                      </button>
                    )}
                    {isDrawing && drawingPoints.length >= 3 && (
                      <button onClick={() => commitPolygon(drawingPoints)}
                        style={{ padding: '0.5rem 1.2rem', background: ACCENT, color: TEXT, border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: '0.88rem' }}>
                        Close ({drawingPoints.length} pts)
                      </button>
                    )}
                    {isDrawing && (
                      <button onClick={() => { setIsDrawing(false); setDrawingPoints([]); setMousePos(null) }}
                        style={{ padding: '0.5rem 1.2rem', background: 'white', color: ERROR, border: `1.5px solid ${ERROR}`, borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: '0.88rem' }}>
                        Cancel
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Floating navigator */}
              {imageRef && (
                <CanvasNavigator
                  viewZoom={viewZoom}
                  onZoomOut={() => setViewZoom(z => Math.max(0.5, z - 0.1))}
                  onZoomReset={() => { setViewZoom(1); setPanOffset({ x: 0, y: 0 }) }}
                  onZoomIn={() => setViewZoom(z => Math.min(3, z + 0.1))}
                  imageData={uploadedImageData.imageData}
                  mmWidth={MM_W}
                  mmHeight={MM_H}
                  onPanToPoint={panToMinimapPoint}
                  viewportRect={getMinimapViewportRect()}
                >
                  <rect width={MM_W} height={MM_H} fill="rgba(0,0,0,0.2)" />
                </CanvasNavigator>
              )}
            </div>
          ) : (
            <ImageUploader onImageUploaded={handleImageUploaded} onClose={() => {}} />
          )
        ) : (
          <RoofMapper
            onPointSelect={handlePointSelect}
            selectedPoint={selectedPoint}
            roofPolygon={roofPolygon}
          />
        )}

        {/* Unified floating panel */}
        {(() => {
          const hasRealImage = uploadedImageMode && uploadedImageData && !uploadedImageData.isScratch
          const showPanel = isScratch || hasRealImage || selectedPoint || (drawMode === 'draw' && roofPolygon) || (roofPolygon && uploadedImageMode && uploadedImageData)
          if (!showPanel) return null

          return (
          <div className="info-panel">

            {/* Add roof image — scratch mode only */}
            {isScratch && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: addRoofImage ? '0.85rem' : 0 }}>
                  <input
                    type="checkbox"
                    id="addRoofImage"
                    checked={addRoofImage}
                    onChange={e => handleAddRoofImageToggle(e.target.checked)}
                    style={{ width: '15px', height: '15px', cursor: 'pointer', accentColor: PRIMARY }}
                  />
                  <label htmlFor="addRoofImage" style={{ fontSize: '0.85rem', fontWeight: '600', color: '#555', cursor: 'pointer' }}>
                    Add roof image
                  </label>
                </div>
                {addRoofImage && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div>
                      <div style={{ fontSize: '0.62rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>Source</div>
                      <div className="seg-control">
                        <button className={`seg-btn${uploadedImageMode ? ' seg-active' : ''}`} onClick={() => handleSourceToggle(true)}>
                          <IconImage /> Image
                        </button>
                        <button className={`seg-btn${!uploadedImageMode ? ' seg-active' : ''}`} onClick={() => handleSourceToggle(false)}>
                          <IconMap /> Map
                        </button>
                      </div>
                    </div>
                    {uploadedImageMode && uploadedImageData && !uploadedImageData.isScratch && (
                      <div>
                        <div style={{ fontSize: '0.62rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>Detection</div>
                        <div className="seg-control">
                          <button className={`seg-btn${drawMode === 'auto' ? ' seg-active' : ''}`} onClick={() => { setDrawMode('auto'); setIsDrawing(false); setDrawingPoints([]); setMousePos(null) }}>
                            <IconAuto /> Auto (SAM2)
                          </button>
                          <button className={`seg-btn${drawMode === 'draw' ? ' seg-active seg-accent' : ''}`} onClick={() => setDrawMode('draw')}>
                            <IconPen /> Draw Polygon
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {(!isScratch || addRoofImage) && (selectedPoint || (drawMode === 'draw' && roofPolygon)) && (
                  <hr style={{ border: 'none', borderTop: '1px solid #f0f0f0', margin: '0.85rem 0' }} />
                )}
              </>
            )}

            {/* Detection — plan mode only (scratch mode shows it inside the addRoofImage block) */}
            {!isScratch && uploadedImageMode && uploadedImageData && !uploadedImageData.isScratch && (
              <div style={{ marginBottom: '0.75rem' }}>
                <div style={{ fontSize: '0.62rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>Detection</div>
                <div className="seg-control">
                  <button className={`seg-btn${drawMode === 'auto' ? ' seg-active' : ''}`} onClick={() => { setDrawMode('auto'); setIsDrawing(false); setDrawingPoints([]); setMousePos(null) }}>
                    <IconAuto /> Auto (SAM2)
                  </button>
                  <button className={`seg-btn${drawMode === 'draw' ? ' seg-active seg-accent' : ''}`} onClick={() => setDrawMode('draw')}>
                    <IconPen /> Draw Polygon
                  </button>
                </div>
              </div>
            )}

            {/* Polygon / location info — hidden in scratch mode when no roof image is added */}
            {(!isScratch || addRoofImage) && (selectedPoint || (drawMode === 'draw' && roofPolygon)) && (
              <>
                <h3>{drawMode === 'draw' ? 'Drawn Polygon' : 'Selected Location'}</h3>
                {drawMode === 'auto' && selectedPoint && (
                  uploadedImageMode
                    ? <><p>Pixel X: {selectedPoint.x}</p><p>Pixel Y: {selectedPoint.y}</p></>
                    : <><p>Latitude: {selectedPoint.lat?.toFixed(6)}</p><p>Longitude: {selectedPoint.lng?.toFixed(6)}</p></>
                )}
                {roofPolygon && (
                  <div>
                    <h4>Roof Polygon Created</h4>
                    {roofPolygon.area && <p>Area: {roofPolygon.area.toLocaleString()} {uploadedImageMode ? 'pixels' : 'm²'}</p>}
                    {roofPolygon.confidence && roofPolygon.confidence < 1 && <p>Confidence: {(roofPolygon.confidence * 100).toFixed(1)}%</p>}
                    {roofPolygon.coordinates && <p>Points: {roofPolygon.coordinates.length}</p>}
                    <div style={{ marginTop: '1rem' }}>
                      <button
                        onClick={() => { setSelectedPoint(null); setRoofPolygon(null) }}
                        style={{ background: ERROR, color: 'white', border: 'none', padding: '0.75rem 1rem', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', width: '100%' }}
                      >
                        Clear & Try Again
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Reference Line (scale calibration) — shown when image + polygon are ready */}
            {uploadedImageMode && uploadedImageData && roofPolygon && (
              <>
                <hr style={{ border: 'none', borderTop: '1px solid #f0f0f0', margin: '0.85rem 0' }} />
                <div style={{ padding: '0.85rem', background: '#fcfdf7', borderRadius: '8px', border: `1px solid ${PRIMARY}` }}>
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.4rem', fontSize: '0.88rem' }}>Reference Line (scale)</label>
                  <button
                    onClick={() => { if (isDrawingLine) { setIsDrawingLine(false); setLineStart(null) } else { setIsDrawingLine(true); setReferenceLine(null) } }}
                    style={{ width: '100%', padding: '0.6rem', background: isDrawingLine ? ERROR : PRIMARY, color: isDrawingLine ? 'white' : TEXT, border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.88rem', marginBottom: '0.6rem' }}
                  >
                    {isDrawingLine ? 'Cancel Drawing' : (referenceLine ? 'Redraw Line' : 'Draw Line on Image')}
                  </button>
                  {referenceLine && (
                    <>
                      <label style={{ display: 'block', fontWeight: '500', marginBottom: '0.4rem', fontSize: '0.82rem', color: TEXT_SECONDARY }}>Line Length (cm)</label>
                      <input type="number" min="0" step="0.1" value={referenceLineLengthCm}
                        onChange={(e) => setReferenceLineLengthCm(e.target.value)}
                        placeholder="Enter length in cm"
                        style={{ width: '100%', padding: '0.6rem', border: `2px solid ${BORDER_LIGHT}`, borderRadius: '6px', fontSize: '0.88rem', boxSizing: 'border-box' }}
                      />
                      {referenceLineLengthCm && (
                        <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: TEXT_MUTED }}>
                          Ratio: {(referenceLineLengthCm / Math.sqrt(Math.pow(referenceLine.end.x - referenceLine.start.x, 2) + Math.pow(referenceLine.end.y - referenceLine.start.y, 2))).toFixed(4)} cm/px
                        </p>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
          )
        })()}
      </div>
    </>
  )
}
