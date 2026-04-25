import { useState, useRef, useEffect } from 'react'
import { PRIMARY, TEXT, TEXT_LIGHT, TEXT_VERY_LIGHT, TEXT_SECONDARY, TEXT_MUTED, BORDER_LIGHT, ERROR, DRAW_COLOR } from '../../styles/colors'
import { useLang } from '../../i18n/LangContext'
import { useImagePanZoom } from '../../hooks/useImagePanZoom'
import { blobToImagePayload } from '../../utils/imagePayload'
import CanvasNavigator from '../shared/CanvasNavigator'
import RoofMapper from '../RoofMapper'
import ImageUploader from '../ImageUploader'

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
const IconCanvas = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
  </svg>
)

const W_CANVAS = 3000, H_CANVAS = 2000

const buildWhiteCanvas = () => {
  const c = document.createElement('canvas')
  c.width = W_CANVAS
  c.height = H_CANVAS
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W_CANVAS, H_CANVAS)
  return { imageData: c.toDataURL('image/png'), width: W_CANVAS, height: H_CANVAS, rotation: 0, scale: 1, isWhiteboard: true }
}

export default function Step1RoofAllocation({
  roofSource,
  setRoofSource,
  uploadedImageData,
  imageSrc,
  setUploadedImageData,
  handleImageUploaded,
  imageRef,
  setImageRef,
  roofPolygon,
  setRoofPolygon,
  isDrawingLine,
  setIsDrawingLine,
  lineStart,
  setLineStart,
  referenceLine,
  setReferenceLine,
  referenceLineLengthCm,
  setReferenceLineLengthCm,
}) {
  const { t } = useLang()
  const [mousePos, setMousePos] = useState(null)
  const [viewZoom, setViewZoom] = useState(1)

  const { panOffset, setPanOffset, panActive, setPanActive, panRef, viewportRef, MM_W, MM_H, panToMinimapPoint, getMinimapViewportRect } = useImagePanZoom(imageRef)

  const handleContainerMouseDown = (e) => {
    if (e.button !== 0 || isDrawingLine) return
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

  const handleSourceChange = (next) => {
    if (next === roofSource) return
    setReferenceLine(null)
    setReferenceLineLengthCm('')
    if (next === 'canvas') {
      const data = buildWhiteCanvas()
      setUploadedImageData(data)
      setRoofPolygon({ coordinates: [[0, 0], [data.width, 0], [data.width, data.height], [0, data.height]], area: data.width * data.height, confidence: 1 })
    } else {
      // 'image' or 'map' — clear current data; ImageUploader / RoofMapper takes over
      setUploadedImageData(null)
      setRoofPolygon(null)
    }
    setRoofSource(next)
  }

  const localImgRef = useRef(null)
  const imgContainerRef = useRef(null)

  // Attach non-passive wheel listener to allow preventDefault (Chrome marks React onWheel as passive)
  useEffect(() => {
    const el = imgContainerRef.current
    if (!el) return
    const handler = (e) => { e.preventDefault(); setViewZoom(z => Math.max(0.5, Math.min(3, z + (e.deltaY > 0 ? -0.1 : 0.1)))) }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [setViewZoom])

  // Paste from clipboard while in image mode — Cmd/Ctrl+V (replaces current image).
  // Listens on document; only fires when no editable element has focus.
  useEffect(() => {
    if (roofSource !== 'image') return
    const onPaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items || items.length === 0) return
      let imageBlob: Blob | null = null
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          imageBlob = item.getAsFile()
          if (imageBlob) break
        }
      }
      if (!imageBlob) return
      e.preventDefault()
      try {
        const payload = await blobToImagePayload(imageBlob, 'pasted_image.png')
        handleImageUploaded(payload)
      } catch (err) {
        console.error('Paste image failed:', err)
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [roofSource, handleImageUploaded])


  const getImageCoords = (e) => {
    const img = localImgRef.current
    if (!img || !uploadedImageData) return null
    const rect = img.getBoundingClientRect()
    return {
      x: Math.round((e.clientX - rect.left) * (img.naturalWidth  / rect.width)),
      y: Math.round((e.clientY - rect.top)  * (img.naturalHeight / rect.height))
    }
  }

  const handleSVGClick = (e) => {
    if (!isDrawingLine) return
    const coords = getImageCoords(e)
    if (!coords) return
    if (!lineStart) { setLineStart(coords) }
    else { setReferenceLine({ start: lineStart, end: coords }); setLineStart(null); setIsDrawingLine(false) }
  }

  const handleSVGMouseMove = (e) => {
    if (!isDrawingLine) return
    const coords = getImageCoords(e)
    if (coords) setMousePos(coords)
  }

  const hint = roofSource === 'map'
    ? t('step1.hintMap')
    : roofSource === 'canvas'
      ? t('step1.hintWhiteboard')
      : uploadedImageData
        ? t('step1.hintImage')
        : t('step1.hintUpload')

  const showImageView = (roofSource === 'canvas' || roofSource === 'image') && uploadedImageData
  const showUploader  = roofSource === 'image' && !uploadedImageData
  const showMap       = roofSource === 'map'

  return (
    <>
      {/* ── Toolbar (hint only) ── */}
      <div className="step-options">
        <div style={{ flex: 1, padding: '0 0.75rem', fontSize: '0.8rem', color: TEXT_LIGHT, fontStyle: 'italic', alignSelf: 'flex-end', paddingBottom: '2px' }}>
          {hint}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="step-content-area" style={{ position: 'relative' }}>
        {showImageView ? (
            <div className="uploaded-image-view" ref={viewportRef} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%', overflow: 'auto', position: 'relative' }}>
              <div
                className="uploaded-image-container"
                ref={imgContainerRef}
                style={{ position: 'relative', display: 'inline-block', width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '100%', transform: `translate(${panOffset.x}px, ${panOffset.y}px)`, cursor: isDrawingLine ? 'crosshair' : panActive ? 'grabbing' : 'grab' }}
                onMouseDown={handleContainerMouseDown}
                onMouseMove={handleContainerMouseMove}
                onMouseUp={handleContainerMouseUp}
                onMouseLeave={handleContainerMouseLeave}
              >
                <img
                  ref={(el) => { localImgRef.current = el; setImageRef(el) }}
                  src={imageSrc}
                  alt="Uploaded roof"
                  style={{
                    display: 'block',
                    transform: `rotate(${uploadedImageData.rotation ?? 0}deg) scale(${(uploadedImageData.scale ?? 1) * viewZoom})`,
                    maxWidth: '100%',
                    maxHeight: 'calc(100vh - 250px)',
                    width: 'auto',
                    height: 'auto',
                    cursor: isDrawingLine ? 'crosshair' : 'default'
                  }}
                />

                {/* SVG overlay — reference-line drawing only */}
                {imageRef && (
                  <svg
                    viewBox={`0 0 ${imageRef.naturalWidth || uploadedImageData.width} ${imageRef.naturalHeight || uploadedImageData.height}`}
                    preserveAspectRatio="xMidYMid meet"
                    style={{
                      position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                      pointerEvents: isDrawingLine ? 'all' : 'none',
                      cursor: isDrawingLine ? 'crosshair' : 'default',
                      transform: `rotate(${uploadedImageData.rotation ?? 0}deg) scale(${(uploadedImageData.scale ?? 1) * viewZoom})`
                    }}
                    onClick={handleSVGClick}
                    onMouseMove={handleSVGMouseMove}
                  >
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
                      <line x1={lineStart.x} y1={lineStart.y} x2={(mousePos as any).x} y2={(mousePos as any).y} stroke={DRAW_COLOR} strokeWidth={refLineW} strokeDasharray={refDashArray}/>
                    )}
                  </svg>
                )}

                {/* Reference line drawing banner */}
                {isDrawingLine && (
                  <div style={{ position: 'absolute', top: '1rem', left: '50%', transform: 'translateX(-50%)', background: `${PRIMARY}eb`, color: 'white', padding: '0.5rem 1.25rem', borderRadius: '20px', fontSize: '0.85rem', fontWeight: '600', pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 10 }}>
                    {lineStart ? t('step1.clickSecondPoint') : t('step1.clickFirstPoint')}
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
                  imageData={imageSrc}
                  mmWidth={MM_W}
                  mmHeight={MM_H}
                  onPanToPoint={panToMinimapPoint}
                  viewportRect={getMinimapViewportRect()}
                >
                  <rect width={MM_W} height={MM_H} fill="rgba(0,0,0,0.2)" />
                </CanvasNavigator>
              )}
            </div>
        ) : showUploader ? (
          <ImageUploader onImageUploaded={handleImageUploaded} onClose={() => {}} />
        ) : showMap ? (
          <RoofMapper onCapture={handleImageUploaded} />
        ) : null}

        {/* Floating panel */}
        <div className="info-panel">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div>
              <div style={{ fontSize: '0.62rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>{t('step1.source')}</div>
              <div className="seg-control">
                <button className={`seg-btn${roofSource === 'canvas' ? ' seg-active' : ''}`} onClick={() => handleSourceChange('canvas')}>
                  <IconCanvas /> {t('step1.plainCanvas')}
                </button>
                <button className={`seg-btn${roofSource === 'image' ? ' seg-active' : ''}`} onClick={() => handleSourceChange('image')}>
                  <IconImage /> {t('step1.image')}
                </button>
                <button className={`seg-btn${roofSource === 'map' ? ' seg-active' : ''}`} onClick={() => handleSourceChange('map')}>
                  <IconMap /> {t('step1.map')}
                </button>
              </div>
            </div>
          </div>

          {/* Reference Line (scale calibration) — shown when image + polygon are ready */}
          {uploadedImageData && roofPolygon && (
            <>
              <hr style={{ border: 'none', borderTop: '1px solid #f0f0f0', margin: '0.85rem 0' }} />
              <div style={{ padding: '0.85rem', background: '#fcfdf7', borderRadius: '8px', border: `1px solid ${PRIMARY}` }}>
                <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.4rem', fontSize: '0.88rem' }}>{t('step1.referenceLine')}</label>
                <button
                  onClick={() => { if (isDrawingLine) { setIsDrawingLine(false); setLineStart(null) } else { setIsDrawingLine(true); setReferenceLine(null) } }}
                  style={{ width: '100%', padding: '0.6rem', background: isDrawingLine ? ERROR : PRIMARY, color: isDrawingLine ? 'white' : TEXT, border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.88rem', marginBottom: '0.6rem' }}
                >
                  {isDrawingLine ? t('step1.cancelDrawing') : (referenceLine ? t('step1.redrawLine') : t('step1.drawLine'))}
                </button>
                {referenceLine && (
                  <>
                    <label style={{ display: 'block', fontWeight: '500', marginBottom: '0.4rem', fontSize: '0.82rem', color: TEXT_SECONDARY }}>{t('step1.lineLength')}</label>
                    <input type="number" min="0" step="0.1" value={referenceLineLengthCm}
                      onChange={(e) => setReferenceLineLengthCm(e.target.value)}
                      placeholder={t('step1.lineLengthPlaceholder')}
                      style={{ width: '100%', padding: '0.6rem', border: `2px solid ${BORDER_LIGHT}`, borderRadius: '6px', fontSize: '0.88rem', boxSizing: 'border-box' }}
                    />
                    {referenceLineLengthCm && (
                      <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: TEXT_MUTED }}>
                        {t('step1.ratio')}{(referenceLineLengthCm / Math.sqrt(Math.pow(referenceLine.end.x - referenceLine.start.x, 2) + Math.pow(referenceLine.end.y - referenceLine.start.y, 2))).toFixed(4)} cm/px
                      </p>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
