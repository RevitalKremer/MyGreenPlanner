export default function Step2PVAreaRefinement({
  uploadedImageData,
  roofPolygon,
  imageRef,
  setImageRef,
  viewZoom,
  setViewZoom,
  isDrawingLine,
  setIsDrawingLine,
  lineStart,
  setLineStart,
  referenceLine,
  setReferenceLine,
  referenceLineLengthCm,
  setReferenceLineLengthCm,
  panelType,
  setPanelType,
  panelFrontHeight,
  setPanelFrontHeight,
  panelAngle,
  setPanelAngle,
  linesPerRow,
  setLinesPerRow,
  lineOrientations,
  setLineOrientations,
  computedBackHeight
}) {
  // When linesPerRow changes, keep existing orientations and pad/trim
  const handleLinesPerRowChange = (n) => {
    setLinesPerRow(n)
    setLineOrientations(prev => {
      const next = [...prev]
      while (next.length < n) next.push('vertical')
      return next.slice(0, n)
    })
  }

  const toggleOrientation = (idx) => {
    setLineOrientations(prev => {
      const next = [...prev]
      next[idx] = next[idx] === 'vertical' ? 'horizontal' : 'vertical'
      return next
    })
  }

  // Diagram computations
  const angle = parseFloat(panelAngle) || 0
  const frontH = parseFloat(panelFrontHeight) || 0
  const angleRad = angle * Math.PI / 180
  const backH = computedBackHeight || 0
  const lineDepths = lineOrientations.map(o => o === 'vertical' ? 238.2 : 113.4)
  const hasValues = panelFrontHeight !== '' && panelAngle !== ''

  // Scale the cross-section diagram to fit viewBox 300×180, groundY=160, startX=40
  const groundY = 160
  const startX = 40
  const totalSlope = lineDepths.reduce((s, d) => s + d, 0) + (linesPerRow - 1) * 2.5
  const totalHoriz = totalSlope * Math.cos(angleRad)
  const availW = 200
  const availH = Math.max(backH, 1)
  const scaleW = totalHoriz > 0 ? availW / totalHoriz : 1
  const scaleH = availH > 0 ? (groundY - 20) / availH : 1
  const scale = Math.min(scaleW, scaleH, 0.7)

  // Build diagram path segments
  const segments = []
  let cx = startX
  let cy = groundY - frontH * scale
  for (let i = 0; i < linesPerRow; i++) {
    const d = lineDepths[i]
    const gap = i < linesPerRow - 1 ? 2.5 : 0
    const dx = d * Math.cos(angleRad) * scale
    const dy = d * Math.sin(angleRad) * scale
    const gapDx = gap * Math.cos(angleRad) * scale
    const gapDy = gap * Math.sin(angleRad) * scale
    segments.push({ x1: cx, y1: cy, x2: cx + dx, y2: cy - dy, label: lineOrientations[i] === 'vertical' ? 'V' : 'H', idx: i })
    cx = cx + dx + gapDx
    cy = cy - dy - gapDy
  }
  const endX = cx
  const endY = cy

  return (
    <>
      <div className="step-content-area" style={{ position: 'relative' }}>
        {uploadedImageData && roofPolygon ? (
          <div className="uploaded-image-view" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%', overflow: 'auto' }}>
            <div
              className="uploaded-image-container"
              style={{ position: 'relative', display: 'inline-block', width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '100%' }}
              onWheel={(e) => {
                e.preventDefault()
                const delta = e.deltaY > 0 ? -0.1 : 0.1
                setViewZoom(Math.max(0.5, Math.min(3, viewZoom + delta)))
              }}
            >
              <img
                ref={(el) => setImageRef(el)}
                src={uploadedImageData.imageData}
                alt="Roof with polygon"
                onClick={(e) => {
                  if (isDrawingLine && imageRef) {
                    const rect = imageRef.getBoundingClientRect()
                    const x = ((e.clientX - rect.left) / rect.width) * imageRef.naturalWidth
                    const y = ((e.clientY - rect.top) / rect.height) * imageRef.naturalHeight
                    if (!lineStart) {
                      setLineStart({ x, y })
                    } else {
                      setReferenceLine({ start: lineStart, end: { x, y } })
                      setLineStart(null)
                      setIsDrawingLine(false)
                    }
                  }
                }}
                style={{
                  display: 'block',
                  transform: `rotate(${uploadedImageData.rotation}deg) scale(${uploadedImageData.scale * viewZoom})`,
                  maxWidth: '100%',
                  maxHeight: 'calc(100vh - 250px)',
                  width: 'auto',
                  height: 'auto',
                  cursor: isDrawingLine ? 'crosshair' : 'default'
                }}
              />
              {imageRef && (
                <svg
                  viewBox={`0 0 ${imageRef.naturalWidth} ${imageRef.naturalHeight}`}
                  preserveAspectRatio="xMidYMid meet"
                  style={{
                    position: 'absolute', top: 0, left: 0,
                    width: '100%', height: '100%',
                    pointerEvents: 'none',
                    transform: `rotate(${uploadedImageData.rotation}deg) scale(${uploadedImageData.scale * viewZoom})`
                  }}
                >
                  <defs>
                    <mask id="polygonMask">
                      <rect width="100%" height="100%" fill="white"/>
                      <polygon points={roofPolygon.coordinates.map(c => `${c[0]},${c[1]}`).join(' ')} fill="black"/>
                    </mask>
                  </defs>
                  <rect width="100%" height="100%" fill="rgba(0,0,0,0.6)" mask="url(#polygonMask)"/>
                  <polygon points={roofPolygon.coordinates.map(c => `${c[0]},${c[1]}`).join(' ')} fill="rgba(196,214,0,0.2)" stroke="#C4D600" strokeWidth="3"/>
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
                </svg>
              )}
            </div>
          </div>
        ) : (
          <div className="step-content">
            <div className="step-placeholder">
              <h2>No Roof Data</h2>
              <p>Please complete Step 1 first to identify the roof area.</p>
            </div>
          </div>
        )}

        {/* Left: Cross-section diagram */}
        {uploadedImageData && roofPolygon && (
          <div style={{
            position: 'absolute', top: '20px', left: '20px', width: '380px',
            padding: '1.25rem', background: 'white', borderRadius: '12px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)', border: '2px solid #C4D600',
            display: 'flex', flexDirection: 'column'
          }}>
            <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem', fontWeight: '600', color: '#555' }}>
              Row Cross-Section
            </h4>

            {/* Zoom */}
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.72rem', color: '#aaa', marginBottom: '0.35rem' }}>🔍 Zoom: {(viewZoom * 100).toFixed(0)}%</div>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                {['−', '100%', '+'].map((label, i) => (
                  <button key={i} onClick={() => setViewZoom(i === 0 ? Math.max(0.5, viewZoom - 0.1) : i === 2 ? Math.min(3, viewZoom + 0.1) : 1)}
                    style={{ flex: 1, padding: '0.4rem', background: 'white', color: '#666', border: '1px solid #C4D600', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: i === 1 ? '0.72rem' : '0.9rem' }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Diagram */}
            {hasValues ? (
              <svg viewBox="0 0 300 180" style={{ width: '100%', height: 'auto', background: '#f8f9fa', borderRadius: '6px' }}>
                {/* Ground line */}
                <line x1="10" y1={groundY} x2="290" y2={groundY} stroke="#bbb" strokeWidth="1.5"/>
                <text x="150" y="175" textAnchor="middle" fontSize="9" fill="#bbb">Roof surface</text>

                {/* Front post */}
                {frontH > 0 && (
                  <>
                    <line x1={startX} y1={groundY} x2={startX} y2={groundY - frontH * scale} stroke="#FF5722" strokeWidth="1.5" strokeDasharray="3,3"/>
                    <text x={startX - 3} y={groundY - frontH * scale / 2} textAnchor="end" fontSize="8" fill="#FF5722" fontWeight="600">{frontH}cm</text>
                  </>
                )}

                {/* Back post */}
                {backH > 0 && (
                  <>
                    <line x1={endX} y1={groundY} x2={endX} y2={groundY - backH * scale} stroke="#C4D600" strokeWidth="1.5" strokeDasharray="3,3"/>
                    <text x={endX + 3} y={groundY - backH * scale / 2} textAnchor="start" fontSize="8" fill="#888" fontWeight="600">{backH.toFixed(1)}cm</text>
                  </>
                )}

                {/* Panel line segments */}
                {segments.map((seg, i) => {
                  const midX = (seg.x1 + seg.x2) / 2
                  const midY = (seg.y1 + seg.y2) / 2
                  return (
                    <g key={i}>
                      <line x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2}
                        stroke={seg.label === 'H' ? '#FF9800' : '#1565C0'} strokeWidth="3.5" strokeLinecap="round"/>
                      {/* Label */}
                      <circle cx={midX} cy={midY - 8} r="7" fill={seg.label === 'H' ? '#FF9800' : '#1565C0'}/>
                      <text x={midX} y={midY - 8} textAnchor="middle" dominantBaseline="middle" fontSize="7.5" fill="white" fontWeight="700">{seg.label}</text>
                    </g>
                  )
                })}

                {/* Angle arc */}
                {angle > 0 && segments.length > 0 && (
                  <>
                    <path d={`M ${startX + 25} ${groundY} A 25 25 0 0 1 ${startX + 25 * Math.cos(angleRad)} ${groundY - 25 * Math.sin(angleRad)}`} stroke="#555" strokeWidth="1.2" fill="none"/>
                    <text x={startX + 32} y={groundY - 8} fontSize="8.5" fill="#555" fontWeight="600">{angle.toFixed(1)}°</text>
                  </>
                )}

                {/* Front height label */}
                {frontH === 0 && (
                  <circle cx={startX} cy={groundY} r="3" fill="#FF5722"/>
                )}
              </svg>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f9fa', borderRadius: '6px', padding: '2rem', textAlign: 'center', color: '#bbb', fontSize: '0.85rem' }}>
                Enter measurements to see diagram
              </div>
            )}

            {/* Legend */}
            {hasValues && linesPerRow > 1 && (
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem', justifyContent: 'center' }}>
                <span style={{ fontSize: '0.72rem', color: '#1565C0', fontWeight: '600' }}>■ Vertical</span>
                <span style={{ fontSize: '0.72rem', color: '#FF9800', fontWeight: '600' }}>■ Horizontal</span>
              </div>
            )}
          </div>
        )}

        {/* Right: Configuration Form */}
        {uploadedImageData && roofPolygon && (
          <div style={{
            position: 'absolute', top: '20px', right: '20px', width: '320px',
            background: 'white', padding: '1.5rem', borderRadius: '12px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            maxHeight: 'calc(100vh - 300px)', overflowY: 'auto',
            border: '2px solid #C4D600'
          }}>
            <h3 style={{ margin: '0 0 1rem 0', color: '#555', fontSize: '1.05rem', fontWeight: '600' }}>
              Panel Configuration
            </h3>

            {/* Panel Type */}
            <div style={{ marginBottom: '1.1rem' }}>
              <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.4rem', fontSize: '0.88rem' }}>Panel Type</label>
              <select value={panelType} onChange={(e) => setPanelType(e.target.value)}
                style={{ width: '100%', padding: '0.6rem', border: '2px solid #e0e0e0', borderRadius: '6px', fontSize: '0.88rem' }}>
                <option value="AIKO-G670-MCH72Mw">AIKO-G670-MCH72Mw (2382×1134×30mm)</option>
              </select>
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.72rem', color: '#999', fontStyle: 'italic' }}>
                238.2 cm (L) × 113.4 cm (W)
              </p>
            </div>

            {/* Reference Line */}
            <div style={{ marginBottom: '1.1rem', padding: '0.85rem', background: '#fcfdf7', borderRadius: '8px', border: '1px solid #C4D600' }}>
              <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.4rem', fontSize: '0.88rem' }}>Reference Line (scale)</label>
              <button
                onClick={() => { if (isDrawingLine) { setIsDrawingLine(false); setLineStart(null) } else { setIsDrawingLine(true); setReferenceLine(null) } }}
                style={{ width: '100%', padding: '0.6rem', background: isDrawingLine ? '#f44336' : '#C4D600', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.88rem', marginBottom: '0.6rem' }}
              >
                {isDrawingLine ? 'Cancel Drawing' : (referenceLine ? 'Redraw Line' : 'Draw Line on Image')}
              </button>
              {referenceLine && (
                <>
                  <label style={{ display: 'block', fontWeight: '500', marginBottom: '0.4rem', fontSize: '0.82rem', color: '#555' }}>Line Length (cm)</label>
                  <input type="number" min="0" step="0.1" value={referenceLineLengthCm}
                    onChange={(e) => setReferenceLineLengthCm(e.target.value)}
                    placeholder="Enter length in cm"
                    style={{ width: '100%', padding: '0.6rem', border: '2px solid #e0e0e0', borderRadius: '6px', fontSize: '0.88rem', boxSizing: 'border-box' }}
                  />
                  {referenceLineLengthCm && (
                    <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: '#666' }}>
                      Ratio: {(referenceLineLengthCm / Math.sqrt(Math.pow(referenceLine.end.x - referenceLine.start.x, 2) + Math.pow(referenceLine.end.y - referenceLine.start.y, 2))).toFixed(4)} cm/px
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Front Height */}
            <div style={{ marginBottom: '1.1rem' }}>
              <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.4rem', fontSize: '0.88rem' }}>Front Height (cm)</label>
              <input type="number" min="0" step="0.1" value={panelFrontHeight}
                onChange={(e) => setPanelFrontHeight(e.target.value)}
                placeholder="Elevation from roof surface"
                style={{ width: '100%', padding: '0.6rem', border: '2px solid #e0e0e0', borderRadius: '6px', fontSize: '0.88rem', boxSizing: 'border-box' }}
              />
            </div>

            {/* Angle */}
            <div style={{ marginBottom: '1.1rem' }}>
              <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.4rem', fontSize: '0.88rem' }}>Panel Angle (°)</label>
              <input type="number" min="0" max="30" step="0.1" value={panelAngle}
                onChange={(e) => {
                  const v = e.target.value
                  const n = parseFloat(v)
                  if (v === '' || (n >= 0 && n <= 30)) setPanelAngle(v)
                }}
                placeholder="0–30°"
                style={{ width: '100%', padding: '0.6rem', border: '2px solid #e0e0e0', borderRadius: '6px', fontSize: '0.88rem', boxSizing: 'border-box' }}
              />
            </div>

            {/* Lines per Row */}
            <div style={{ marginBottom: '1.1rem' }}>
              <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem', fontSize: '0.88rem' }}>Lines per Row</label>
              <div style={{ display: 'flex', gap: '0.3rem' }}>
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} onClick={() => handleLinesPerRowChange(n)}
                    style={{
                      flex: 1, padding: '0.5rem',
                      background: linesPerRow === n ? '#1565C0' : 'white',
                      color: linesPerRow === n ? 'white' : '#555',
                      border: `2px solid ${linesPerRow === n ? '#1565C0' : '#e0e0e0'}`,
                      borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '0.9rem'
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Per-line orientation */}
            <div style={{ marginBottom: '1.1rem' }}>
              <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem', fontSize: '0.88rem' }}>
                Line Orientations <span style={{ fontSize: '0.72rem', color: '#aaa', fontWeight: '400' }}>(front → back)</span>
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {lineOrientations.map((o, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.78rem', color: '#777', width: '46px', flexShrink: 0 }}>Line {idx + 1}</span>
                    <button
                      onClick={() => toggleOrientation(idx)}
                      style={{
                        flex: 1, padding: '0.35rem 0.5rem',
                        background: o === 'vertical' ? '#E3F2FD' : '#FFF3E0',
                        color: o === 'vertical' ? '#1565C0' : '#E65100',
                        border: `1.5px solid ${o === 'vertical' ? '#90CAF9' : '#FFB74D'}`,
                        borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '0.78rem',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem'
                      }}
                    >
                      {o === 'vertical' ? '▮ Vertical (portrait)' : '▬ Horizontal (landscape)'}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Back height display (read-only) */}
            {hasValues && (
              <div style={{ marginBottom: '1.1rem', padding: '0.6rem 0.75rem', background: '#f8f9fa', borderRadius: '6px', border: '1px solid #e8e8e8' }}>
                <span style={{ fontSize: '0.72rem', color: '#aaa', fontWeight: '600' }}>BACK HEIGHT (calculated)</span>
                <div style={{ fontSize: '1rem', fontWeight: '700', color: '#555', marginTop: '2px' }}>
                  {backH.toFixed(1)} cm
                </div>
              </div>
            )}

            {/* Validation */}
            <div style={{ padding: '0.85rem', background: referenceLine && referenceLineLengthCm && panelFrontHeight && panelAngle ? '#e8f5e9' : '#fff3cd', borderRadius: '8px', fontSize: '0.82rem' }}>
              <strong>Required:</strong>
              <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem' }}>
                <li style={{ color: referenceLine && referenceLineLengthCm ? '#4caf50' : '#ff9800' }}>Reference line with length</li>
                <li style={{ color: panelFrontHeight ? '#4caf50' : '#ff9800' }}>Front height</li>
                <li style={{ color: panelAngle ? '#4caf50' : '#ff9800' }}>Panel angle</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
