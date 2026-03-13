import React from 'react'

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
  panelBackHeight,
  setPanelBackHeight,
  panelAngle,
  setPanelAngle
}) {
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
                const newZoom = Math.max(0.5, Math.min(3, viewZoom + delta))
                setViewZoom(newZoom)
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
              
              {/* SVG overlay for polygon mask and reference line */}
              {imageRef && (
                <svg
                  viewBox={`0 0 ${imageRef.naturalWidth} ${imageRef.naturalHeight}`}
                  preserveAspectRatio="xMidYMid meet"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                    transform: `rotate(${uploadedImageData.rotation}deg) scale(${uploadedImageData.scale * viewZoom})`
                  }}
                >
                  {/* Mask: darken everything outside polygon */}
                  <defs>
                    <mask id="polygonMask">
                      <rect width="100%" height="100%" fill="white"/>
                      <polygon
                        points={roofPolygon.coordinates.map(coord => `${coord[0]},${coord[1]}`).join(' ')}
                        fill="black"
                      />
                    </mask>
                  </defs>
                  
                  {/* Semi-transparent overlay outside polygon */}
                  <rect 
                    width="100%" 
                    height="100%" 
                    fill="rgba(0, 0, 0, 0.6)" 
                    mask="url(#polygonMask)"
                  />
                  
                  {/* Polygon outline */}
                  <polygon
                    points={roofPolygon.coordinates.map(coord => `${coord[0]},${coord[1]}`).join(' ')}
                    fill="rgba(196, 214, 0, 0.2)"
                    stroke="#C4D600"
                    strokeWidth="3"
                  />
                  
                  {/* Reference line */}
                  {referenceLine && (
                    <>
                      <line
                        x1={referenceLine.start.x}
                        y1={referenceLine.start.y}
                        x2={referenceLine.end.x}
                        y2={referenceLine.end.y}
                        stroke="#FF5722"
                        strokeWidth="2"
                        strokeDasharray="8,4"
                      />
                      <circle 
                        cx={referenceLine.start.x} 
                        cy={referenceLine.start.y} 
                        r="4" 
                        fill="#FF5722" 
                        stroke="white"
                        strokeWidth="1.5"
                      />
                      <circle 
                        cx={referenceLine.end.x} 
                        cy={referenceLine.end.y} 
                        r="4" 
                        fill="#FF5722"
                        stroke="white"
                        strokeWidth="1.5"
                      />
                    </>
                  )}
                  
                  {/* Line being drawn */}
                  {isDrawingLine && lineStart && (
                    <circle 
                      cx={lineStart.x} 
                      cy={lineStart.y} 
                      r="4" 
                      fill="#FF5722"
                      stroke="white"
                      strokeWidth="1.5"
                    />
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

        {/* Left: Panel Side View Diagram */}
        {uploadedImageData && roofPolygon && (
          <div style={{ 
            position: 'absolute',
            top: '20px',
            left: '20px',
            width: '400px',
            padding: '1.5rem', 
            background: 'white',
            borderRadius: '12px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            border: '2px solid #C4D600',
            minHeight: '200px',
            display: 'flex',
            flexDirection: 'column'
          }}>
              <h4 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: '600', color: '#666' }}>
                Panel Side View
              </h4>
              
              {/* Zoom Controls */}
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '0.5rem', fontWeight: '600' }}>
                  🔍 Zoom: {(viewZoom * 100).toFixed(0)}%
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <button
                    onClick={() => setViewZoom(Math.max(0.5, viewZoom - 0.1))}
                    style={{
                      flex: 1,
                      padding: '0.5rem',
                      background: 'white',
                      color: '#666',
                      border: '2px solid #C4D600',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: '600',
                      fontSize: '0.9rem'
                    }}
                  >
                    −
                  </button>
                  <button
                    onClick={() => setViewZoom(1)}
                    style={{
                      flex: 1,
                      padding: '0.5rem',
                      background: 'white',
                      color: '#666',
                      border: '2px solid #C4D600',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: '600',
                      fontSize: '0.75rem'
                    }}
                  >
                    100%
                  </button>
                  <button
                    onClick={() => setViewZoom(Math.min(3, viewZoom + 0.1))}
                    style={{
                      flex: 1,
                      padding: '0.5rem',
                      background: 'white',
                      color: '#666',
                      border: '2px solid #C4D600',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: '600',
                      fontSize: '0.9rem'
                    }}
                  >
                    +
                  </button>
                </div>
                <div style={{ fontSize: '0.7rem', color: '#999', marginTop: '0.25rem' }}>
                  💡 Use mouse wheel to zoom
                </div>
              </div>
              {panelFrontHeight && panelBackHeight && panelAngle ? (
                <svg 
                  viewBox="0 0 300 180" 
                  style={{ 
                    width: '100%', 
                    height: 'auto',
                    background: '#f8f9fa',
                    borderRadius: '6px',
                    padding: '1rem'
                  }}
                >
                  {/* Roof line */}
                  <line x1="20" y1="140" x2="280" y2="140" stroke="#666" strokeWidth="2" />
                  <text x="150" y="160" textAnchor="middle" fontSize="10" fill="#999">Roof</text>
                  
                  {/* Front height (LEFT side) */}
                  <line x1="50" y1="140" x2="50" y2={140 - parseFloat(panelFrontHeight) * 0.5} stroke="#FF5722" strokeWidth="2" strokeDasharray="3,3" />
                  <text x="30" y={140 - parseFloat(panelFrontHeight) * 0.25} textAnchor="middle" fontSize="9" fill="#FF5722" fontWeight="600">
                    {panelFrontHeight}cm
                  </text>
                  <text x="30" y={140 - parseFloat(panelFrontHeight) * 0.25 + 12} textAnchor="middle" fontSize="8" fill="#FF5722">
                    (front)
                  </text>
                  
                  {/* Back height (RIGHT side) */}
                  <line 
                    x1={50 + 238.2 * 0.5 * Math.cos(parseFloat(panelAngle) * Math.PI / 180)} 
                    y1="140" 
                    x2={50 + 238.2 * 0.5 * Math.cos(parseFloat(panelAngle) * Math.PI / 180)} 
                    y2={140 - parseFloat(panelBackHeight) * 0.5} 
                    stroke="#C4D600" 
                    strokeWidth="2" 
                    strokeDasharray="3,3" 
                  />
                  <text 
                    x={50 + 238.2 * 0.5 * Math.cos(parseFloat(panelAngle) * Math.PI / 180) + 25} 
                    y={140 - parseFloat(panelBackHeight) * 0.25} 
                    textAnchor="start" 
                    fontSize="9" 
                    fill="#C4D600" 
                    fontWeight="600"
                  >
                    {panelBackHeight}cm
                  </text>
                  <text 
                    x={50 + 238.2 * 0.5 * Math.cos(parseFloat(panelAngle) * Math.PI / 180) + 25} 
                    y={140 - parseFloat(panelBackHeight) * 0.25 + 12} 
                    textAnchor="start" 
                    fontSize="8" 
                    fill="#C4D600"
                  >
                    (back)
                  </text>
                  
                  {/* Panel (angled line) */}
                  <line 
                    x1="50" 
                    y1={140 - parseFloat(panelFrontHeight) * 0.5} 
                    x2={50 + 238.2 * 0.5 * Math.cos(parseFloat(panelAngle) * Math.PI / 180)} 
                    y2={140 - parseFloat(panelBackHeight) * 0.5} 
                    stroke="#666666" 
                    strokeWidth="4" 
                  />
                  
                  {/* Panel length label */}
                  <text 
                    x={50 + 238.2 * 0.25 * Math.cos(parseFloat(panelAngle) * Math.PI / 180)} 
                    y={140 - (parseFloat(panelFrontHeight) + parseFloat(panelBackHeight)) * 0.25 - 15} 
                    textAnchor="middle" 
                    fontSize="10" 
                    fill="#666666" 
                    fontWeight="700"
                  >
                    Panel: 238.2cm
                  </text>
                  
                  {/* Roof projection (horizontal distance) */}
                  <line 
                    x1="50" 
                    y1="145" 
                    x2={50 + 238.2 * 0.5 * Math.cos(parseFloat(panelAngle) * Math.PI / 180)} 
                    y2="145" 
                    stroke="#2196F3" 
                    strokeWidth="2" 
                    strokeDasharray="5,3"
                  />
                  <text 
                    x={50 + 238.2 * 0.25 * Math.cos(parseFloat(panelAngle) * Math.PI / 180)} 
                    y="158" 
                    textAnchor="middle" 
                    fontSize="9" 
                    fill="#2196F3" 
                    fontWeight="600"
                  >
                    Projection: {(238.2 * Math.cos(parseFloat(panelAngle) * Math.PI / 180)).toFixed(1)}cm
                  </text>
                  
                  {/* Angle arc */}
                  <path 
                    d={`M ${50 + 30} 140 A 30 30 0 0 1 ${50 + 30 * Math.cos(parseFloat(panelAngle) * Math.PI / 180)} ${140 - 30 * Math.sin(parseFloat(panelAngle) * Math.PI / 180)}`} 
                    stroke="#666666" 
                    strokeWidth="1.5" 
                    fill="none" 
                  />
                  <text 
                    x={50 + 40} 
                    y={135} 
                    fontSize="9" 
                    fill="#666666" 
                    fontWeight="600"
                  >
                    {parseFloat(panelAngle).toFixed(1)}°
                  </text>
                </svg>
              ) : (
                <div style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#f8f9fa',
                  borderRadius: '6px',
                  padding: '2rem',
                  textAlign: 'center',
                  color: '#999'
                }}>
                  <p style={{ margin: 0, fontSize: '0.9rem' }}>
                    Enter panel measurements to see diagram
                  </p>
                </div>
              )}
            </div>
          )}

        {/* Right: Panel Configuration Form */}
        {uploadedImageData && roofPolygon && (
            <div style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              width: '320px',
              background: 'white',
              padding: '1.5rem',
              borderRadius: '12px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
              maxHeight: 'calc(100vh - 300px)',
              overflowY: 'auto',
              border: '2px solid #C4D600'
            }}>
              <h3 style={{ margin: '0 0 1rem 0', color: '#666666', fontSize: '1.1rem' }}>
                Panel Configuration
              </h3>

            {/* Panel Type */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                Panel Type
              </label>
              <select 
                value={panelType}
                onChange={(e) => setPanelType(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.65rem',
                  border: '2px solid #e0e0e0',
                  borderRadius: '6px',
                  fontSize: '0.9rem'
                }}
              >
                <option value="AIKO-G670-MCH72Mw">AIKO-G670-MCH72Mw (2382×1134×30mm)</option>
              </select>
              <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.75rem', color: '#666', fontStyle: 'italic' }}>
                Panel: 238.2 cm (L) × 113.4 cm (W) × 3.0 cm (H)
              </p>
            </div>

            {/* Reference Line */}
            <div style={{ marginBottom: '1.25rem', padding: '1rem', background: '#fcfdf7', borderRadius: '8px', border: '1px solid #C4D600' }}>
              <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                Reference Line (for scale)
              </label>
              <button
                onClick={() => {
                  if (isDrawingLine) {
                    setIsDrawingLine(false)
                    setLineStart(null)
                  } else {
                    setIsDrawingLine(true)
                    setReferenceLine(null)
                  }
                }}
                style={{
                  width: '100%',
                  padding: '0.65rem',
                  background: isDrawingLine ? '#f44336' : '#C4D600',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '0.9rem',
                  marginBottom: '0.75rem'
                }}
              >
                {isDrawingLine ? 'Cancel Drawing' : (referenceLine ? 'Redraw Line' : 'Draw Line on Image')}
              </button>
              
              {referenceLine && (
                <>
                  <label style={{ display: 'block', fontWeight: '500', marginBottom: '0.5rem', fontSize: '0.85rem', color: '#666' }}>
                    Line Length (cm)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={referenceLineLengthCm}
                    onChange={(e) => setReferenceLineLengthCm(e.target.value)}
                    placeholder="Enter length in cm"
                    style={{
                      width: '100%',
                      padding: '0.65rem',
                      border: '2px solid #e0e0e0',
                      borderRadius: '6px',
                      fontSize: '0.9rem'
                    }}
                  />
                  {referenceLineLengthCm && (
                    <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: '#666' }}>
                      Pixel length: {Math.round(Math.sqrt(
                        Math.pow(referenceLine.end.x - referenceLine.start.x, 2) + 
                        Math.pow(referenceLine.end.y - referenceLine.start.y, 2)
                      ))}px
                      <br/>
                      Ratio: {(referenceLineLengthCm / Math.sqrt(
                        Math.pow(referenceLine.end.x - referenceLine.start.x, 2) + 
                        Math.pow(referenceLine.end.y - referenceLine.start.y, 2)
                      )).toFixed(4)} cm/px
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Panel Front Height */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                Panel Front Height (cm)
              </label>
              <input
                type="number"
                min="0"
                step="0.1"
                value={panelFrontHeight}
                onChange={(e) => setPanelFrontHeight(e.target.value)}
                placeholder="Elevation from roof"
                style={{
                  width: '100%',
                  padding: '0.65rem',
                  border: '2px solid #e0e0e0',
                  borderRadius: '6px',
                  fontSize: '0.9rem'
                }}
              />
            </div>

            {/* Panel Back Height */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                Panel Back Height (cm)
              </label>
              <input
                type="number"
                min="0"
                step="0.1"
                value={panelBackHeight}
                onChange={(e) => {
                  const backHeight = e.target.value
                  setPanelBackHeight(backHeight)
                  
                  // Auto-calculate angle from back height
                  // back_height = front_height + panel_length × sin(angle)
                  // Therefore: angle = asin((back_height - front_height) / panel_length)
                  if (backHeight !== '' && parseFloat(backHeight) >= 0 && panelFrontHeight !== '' && parseFloat(panelFrontHeight) >= 0) {
                    const panelLengthCm = 238.2
                    const backHeightVal = parseFloat(backHeight)
                    const frontHeightVal = parseFloat(panelFrontHeight)
                    
                    const verticalRise = backHeightVal - frontHeightVal
                    
                    // Vertical rise must be positive and can't exceed panel length
                    if (verticalRise >= 0 && verticalRise <= panelLengthCm) {
                      const angleRadians = Math.asin(verticalRise / panelLengthCm)
                      const angleDegrees = angleRadians * (180 / Math.PI)
                      
                      // Only update if within valid range (0-30°)
                      if (angleDegrees >= 0 && angleDegrees <= 30) {
                        setPanelAngle(angleDegrees.toFixed(2))
                      }
                    }
                  }
                }}
                placeholder="front_height + panel_length × sin(angle)"
                style={{
                  width: '100%',
                  padding: '0.65rem',
                  border: '2px solid #e0e0e0',
                  borderRadius: '6px',
                  fontSize: '0.9rem'
                }}
              />
              {panelFrontHeight && (
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.75rem', color: '#999' }}>
                  Max: {(parseFloat(panelFrontHeight) + 238.2 * Math.sin(30 * Math.PI / 180)).toFixed(1)} cm (at 30°)
                </p>
              )}
            </div>

            {/* Panel Angle */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                Panel Angle (degrees)
              </label>
              <input
                type="number"
                min="0"
                max="30"
                step="0.1"
                value={panelAngle}
                onChange={(e) => {
                  const angle = e.target.value
                  const angleVal = parseFloat(angle)
                  
                  if (angle === '' || (angleVal >= 0 && angleVal <= 30)) {
                    setPanelAngle(angle)
                    
                    // Auto-calculate back height from angle
                    // back_height = front_height + panel_length × sin(angle)
                    // Panel length: 238.2 cm (AIKO-G670-MCH72Mw: 2382mm)
                    if (angle !== '' && angleVal >= 0 && angleVal <= 30 && panelFrontHeight !== '' && parseFloat(panelFrontHeight) >= 0) {
                      const panelLengthCm = 238.2
                      const frontHeightVal = parseFloat(panelFrontHeight)
                      const angleRadians = angleVal * (Math.PI / 180)
                      const backHeight = frontHeightVal + panelLengthCm * Math.sin(angleRadians)
                      setPanelBackHeight(backHeight.toFixed(2))
                    }
                  }
                }}
                placeholder="0-30°"
                style={{
                  width: '100%',
                  padding: '0.65rem',
                  border: '2px solid #e0e0e0',
                  borderRadius: '6px',
                  fontSize: '0.9rem'
                }}
              />
            </div>

            {/* Validation Summary */}
            <div style={{ 
              padding: '1rem', 
              background: referenceLine && referenceLineLengthCm && panelFrontHeight && panelBackHeight && panelAngle ? '#e8f5e9' : '#fff3cd',
              borderRadius: '8px',
              fontSize: '0.85rem'
            }}>
              <strong>Required:</strong>
              <ul style={{ margin: '0.5rem 0 0 0', paddingLeft: '1.25rem' }}>
                <li style={{ color: referenceLine && referenceLineLengthCm ? '#4caf50' : '#ff9800' }}>
                  Reference line with length
                </li>
                <li style={{ color: panelFrontHeight ? '#4caf50' : '#ff9800' }}>
                  Panel front height
                </li>
                <li style={{ color: panelBackHeight ? '#4caf50' : '#ff9800' }}>
                  Panel back height
                </li>
                <li style={{ color: panelAngle ? '#4caf50' : '#ff9800' }}>
                  Panel angle
                </li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
