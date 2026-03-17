import { useState, useRef } from 'react'

const GROUP_COLORS = ['#2196F3', '#FF5722', '#9C27B0', '#FF9800', '#4CAF50', '#00BCD4']

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
  computedBackHeight,
  projectMode = 'scratch',
  areas = [],
  setAreas,
}) {
  // Plan mode local state
  const [activeGroupId, setActiveGroupId] = useState(null)
  const [baselineDrawStart, setBaselineDrawStart] = useState(null)
  const [diagramGroupId, setDiagramGroupId] = useState(null)
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false)
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false)

  // Pan state
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [panActive, setPanActive] = useState(false)
  const panRef = useRef(null)

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

  // ── Scratch mode helpers ──────────────────────────────────────────────────
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

  // ── Plan mode helpers ────────────────────────────────────────────────────
  const addGroup = () => {
    const id = Date.now()
    const newGroup = {
      id,
      label: String.fromCharCode(65 + areas.length),
      color: GROUP_COLORS[areas.length % GROUP_COLORS.length],
      baseline: null,
      angle: '',
      frontHeight: '',
      linesPerRow: 1,
      lineOrientations: ['vertical'],
    }
    setAreas(prev => [...prev, newGroup])
    setDiagramGroupId(id)
  }

  const updateGroup = (id, field, value) => {
    setAreas(prev => prev.map(g => g.id === id ? { ...g, [field]: value } : g))
  }

  const removeGroup = (id) => {
    setAreas(prev => {
      const remaining = prev.filter(g => g.id !== id)
      if (diagramGroupId === id) setDiagramGroupId(remaining[0]?.id ?? null)
      return remaining
    })
    if (activeGroupId === id) { setActiveGroupId(null); setBaselineDrawStart(null) }
  }

  const updateGroupLinesPerRow = (id, n) => {
    setAreas(prev => prev.map(g => {
      if (g.id !== id) return g
      const orientations = [...g.lineOrientations]
      while (orientations.length < n) orientations.push('vertical')
      return { ...g, linesPerRow: n, lineOrientations: orientations.slice(0, n) }
    }))
  }

  const toggleGroupOrientation = (id, idx) => {
    setAreas(prev => prev.map(g => {
      if (g.id !== id) return g
      const next = [...g.lineOrientations]
      next[idx] = next[idx] === 'vertical' ? 'horizontal' : 'vertical'
      return { ...g, lineOrientations: next }
    }))
  }

  const getGroupBackHeight = (group) => {
    const angle = parseFloat(group.angle) || 0
    const frontH = parseFloat(group.frontHeight) || 0
    const angleRad = angle * Math.PI / 180
    const n = group.linesPerRow || 1
    const orients = (group.lineOrientations || ['vertical']).slice(0, n)
    const totalSlope = orients.reduce((s, o) => s + (o === 'vertical' ? 238.2 : 113.4), 0) + (n - 1) * 2.5
    return frontH + totalSlope * Math.sin(angleRad)
  }

  // ── Unified image click handler ──────────────────────────────────────────
  const handleImageClick = (e) => {
    if (!imageRef) return
    const rect = imageRef.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * imageRef.naturalWidth
    const y = ((e.clientY - rect.top) / rect.height) * imageRef.naturalHeight

    if (isDrawingLine) {
      if (!lineStart) { setLineStart({ x, y }) }
      else { setReferenceLine({ start: lineStart, end: { x, y } }); setLineStart(null); setIsDrawingLine(false) }
    } else if (activeGroupId) {
      if (!baselineDrawStart) { setBaselineDrawStart([x, y]) }
      else {
        updateGroup(activeGroupId, 'baseline', { p1: baselineDrawStart, p2: [x, y] })
        setBaselineDrawStart(null)
        setActiveGroupId(null)
      }
    }
  }

  const isDrawingAnything = isDrawingLine || !!activeGroupId

  // ── Diagram data (plan: selected group; scratch: global config) ──────────
  const dg = projectMode === 'plan'
    ? (areas.find(g => g.id === diagramGroupId) || areas[0] || null)
    : null

  const diagAngle   = dg ? (parseFloat(dg.angle) || 0)       : (parseFloat(panelAngle) || 0)
  const diagFrontH  = dg ? (parseFloat(dg.frontHeight) || 0) : (parseFloat(panelFrontHeight) || 0)
  const diagBackH   = dg ? getGroupBackHeight(dg)             : (computedBackHeight || 0)
  const diagLPR     = dg ? (dg.linesPerRow || 1)              : linesPerRow
  const diagOrients = dg ? (dg.lineOrientations || ['vertical']) : lineOrientations
  const hasValues   = diagFrontH > 0 || diagAngle > 0

  // Cross-section diagram computations (same formulas as before, using diag* values)
  const angleRad    = diagAngle * Math.PI / 180
  const lineDepths  = diagOrients.slice(0, diagLPR).map(o => o === 'vertical' ? 238.2 : 113.4)
  const groundY = 160, startX = 40
  const totalSlope  = lineDepths.reduce((s, d) => s + d, 0) + (diagLPR - 1) * 2.5
  const totalHoriz  = totalSlope * Math.cos(angleRad)
  const availW = 200
  const scaleW = totalHoriz > 0 ? availW / totalHoriz : 1
  const scaleH = diagBackH > 0 ? (groundY - 20) / diagBackH : 1
  const diagramScale = Math.min(scaleW, scaleH, 0.7)

  const segments = []
  let cx = startX, cy = groundY - diagFrontH * diagramScale
  for (let i = 0; i < diagLPR; i++) {
    const d = lineDepths[i]
    const gap = i < diagLPR - 1 ? 2.5 : 0
    const dx = d * Math.cos(angleRad) * diagramScale
    const dy = d * Math.sin(angleRad) * diagramScale
    segments.push({ x1: cx, y1: cy, x2: cx + dx, y2: cy - dy, label: diagOrients[i] === 'vertical' ? 'V' : 'H' })
    cx += dx + gap * Math.cos(angleRad) * diagramScale
    cy -= dy + gap * Math.sin(angleRad) * diagramScale
  }
  const endX = cx, endY = cy

  // Font size for SVG labels (scales with image width)
  const labelFontSize = imageRef ? Math.max(12, Math.min(36, imageRef.naturalWidth * 0.012)) : 14

  return (
    <>
      <div className="step-content-area" style={{ position: 'relative' }}>
        {uploadedImageData ? (
          <div className="uploaded-image-view" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%', overflow: 'auto' }}>
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
                ref={(el) => setImageRef(el)}
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
                  style={{
                    position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                    pointerEvents: 'none',
                    transform: `rotate(${uploadedImageData.rotation ?? 0}deg) scale(${(uploadedImageData.scale ?? 1) * viewZoom})`
                  }}
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
          </div>
        ) : (
          <div className="step-content">
            <div className="step-placeholder">
              <h2>No Roof Data</h2>
              <p>Please complete Step 1 first.</p>
            </div>
          </div>
        )}

        {/* ── Left: Cross-section diagram ── */}
        {uploadedImageData && (
          <div style={{
            position: 'absolute', top: '20px', left: '20px',
            width: leftPanelCollapsed ? '32px' : '340px', minHeight: '36px', overflow: 'hidden',
            maxHeight: leftPanelCollapsed ? 'none' : 'calc(100vh - 120px)', overflowY: leftPanelCollapsed ? 'hidden' : 'auto',
            padding: '1.25rem', background: 'white', borderRadius: '12px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)', border: '2px solid #C4D600',
            display: 'flex', flexDirection: 'column'
          }}>
            <button onClick={() => setLeftPanelCollapsed(c => !c)} style={{ position: 'absolute', top: '6px', right: '6px', width: '22px', height: '22px', padding: 0, background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {leftPanelCollapsed ? '›' : '‹'}
            </button>
            {!leftPanelCollapsed && <>
            <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', fontWeight: '600', color: '#555' }}>
              Row Cross-Section
              {projectMode === 'plan' && dg && (
                <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: dg.color, fontWeight: '700' }}>— {dg.label}</span>
              )}
            </h4>

            {/* Group selector (plan mode, multiple groups) */}
            {projectMode === 'plan' && areas.length > 1 && (
              <select
                value={diagramGroupId ?? areas[0]?.id ?? ''}
                onChange={e => setDiagramGroupId(Number(e.target.value))}
                style={{ marginBottom: '0.6rem', padding: '0.4rem', border: '1px solid #ddd', borderRadius: '6px', fontSize: '0.82rem' }}
              >
                {areas.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
              </select>
            )}

            {/* Zoom */}
            <div style={{ marginBottom: '0.6rem' }}>
              <div style={{ fontSize: '0.72rem', color: '#aaa', marginBottom: '0.3rem' }}>🔍 Zoom: {(viewZoom * 100).toFixed(0)}%</div>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                {['−', '100%', '+'].map((label, i) => (
                  <button key={i}
                    onClick={() => { const z = i === 0 ? Math.max(0.5, viewZoom - 0.1) : i === 2 ? Math.min(3, viewZoom + 0.1) : 1; setViewZoom(z); if (i === 1) setPanOffset({ x: 0, y: 0 }) }}
                    style={{ flex: 1, padding: '0.4rem', background: 'white', color: '#666', border: '1px solid #C4D600', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: i === 1 ? '0.72rem' : '0.9rem' }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {hasValues ? (
              <svg viewBox="0 0 300 180" style={{ width: '100%', height: 'auto', background: '#f8f9fa', borderRadius: '6px' }}>
                <line x1="10" y1={groundY} x2="290" y2={groundY} stroke="#bbb" strokeWidth="1.5"/>
                <text x="150" y="175" textAnchor="middle" fontSize="9" fill="#bbb">Roof surface</text>
                {diagFrontH > 0 && (
                  <>
                    <line x1={startX} y1={groundY} x2={startX} y2={groundY - diagFrontH * diagramScale} stroke="#FF5722" strokeWidth="1.5" strokeDasharray="3,3"/>
                    <text x={startX - 3} y={groundY - diagFrontH * diagramScale / 2} textAnchor="end" fontSize="8" fill="#FF5722" fontWeight="600">{diagFrontH}cm</text>
                  </>
                )}
                {diagBackH > 0 && (
                  <>
                    <line x1={endX} y1={groundY} x2={endX} y2={groundY - diagBackH * diagramScale} stroke="#C4D600" strokeWidth="1.5" strokeDasharray="3,3"/>
                    <text x={endX + 3} y={groundY - diagBackH * diagramScale / 2} textAnchor="start" fontSize="8" fill="#888" fontWeight="600">{diagBackH.toFixed(1)}cm</text>
                  </>
                )}
                {segments.map((seg, i) => {
                  const midX = (seg.x1 + seg.x2) / 2
                  const midY = (seg.y1 + seg.y2) / 2
                  return (
                    <g key={i}>
                      <line x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2} stroke={seg.label === 'H' ? '#FF9800' : '#1565C0'} strokeWidth="3.5" strokeLinecap="round"/>
                      <circle cx={midX} cy={midY - 8} r="7" fill={seg.label === 'H' ? '#FF9800' : '#1565C0'}/>
                      <text x={midX} y={midY - 8} textAnchor="middle" dominantBaseline="middle" fontSize="7.5" fill="white" fontWeight="700">{seg.label}</text>
                    </g>
                  )
                })}
                {diagAngle > 0 && segments.length > 0 && (
                  <>
                    <path d={`M ${startX + 25} ${groundY} A 25 25 0 0 1 ${startX + 25 * Math.cos(angleRad)} ${groundY - 25 * Math.sin(angleRad)}`} stroke="#555" strokeWidth="1.2" fill="none"/>
                    <text x={startX + 32} y={groundY - 8} fontSize="8.5" fill="#555" fontWeight="600">{diagAngle.toFixed(1)}°</text>
                  </>
                )}
                {diagFrontH === 0 && <circle cx={startX} cy={groundY} r="3" fill="#FF5722"/>}
              </svg>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f9fa', borderRadius: '6px', padding: '2rem', textAlign: 'center', color: '#bbb', fontSize: '0.85rem' }}>
                {projectMode === 'plan' ? 'Add a group and enter measurements' : 'Enter measurements to see diagram'}
              </div>
            )}
            {hasValues && diagLPR > 1 && (
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem', justifyContent: 'center' }}>
                <span style={{ fontSize: '0.72rem', color: '#1565C0', fontWeight: '600' }}>■ Vertical</span>
                <span style={{ fontSize: '0.72rem', color: '#FF9800', fontWeight: '600' }}>■ Horizontal</span>
              </div>
            )}
            </>}
          </div>
        )}

        {/* ── Right: Configuration ── */}
        {uploadedImageData && (
          <div style={{
            position: 'absolute', top: '20px', right: '20px',
            width: rightPanelCollapsed ? '32px' : '320px', minHeight: '36px', overflow: 'hidden',
            background: 'white', padding: '1.5rem', borderRadius: '12px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            maxHeight: rightPanelCollapsed ? 'none' : 'calc(100vh - 120px)', overflowY: rightPanelCollapsed ? 'hidden' : 'auto',
            border: '2px solid #C4D600'
          }}>
            <button onClick={() => setRightPanelCollapsed(c => !c)} style={{ position: 'absolute', top: '6px', right: '6px', width: '22px', height: '22px', padding: 0, background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {rightPanelCollapsed ? '‹' : '›'}
            </button>
            {!rightPanelCollapsed && <>
            <h3 style={{ margin: '0 0 1rem', color: '#555', fontSize: '1.05rem', fontWeight: '600' }}>
              Panel Configuration
            </h3>

            {/* Panel Type (global, both modes) */}
            <div style={{ marginBottom: '1.1rem' }}>
              <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.4rem', fontSize: '0.88rem' }}>Panel Type</label>
              <select value={panelType} onChange={(e) => setPanelType(e.target.value)}
                style={{ width: '100%', padding: '0.6rem', border: '2px solid #e0e0e0', borderRadius: '6px', fontSize: '0.88rem' }}>
                <option value="AIKO-G670-MCH72Mw">AIKO-G670-MCH72Mw (2382×1134×30mm)</option>
              </select>
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.72rem', color: '#999', fontStyle: 'italic' }}>238.2 cm (L) × 113.4 cm (W)</p>
            </div>

            {/* Reference Line (global, both modes) */}
            <div style={{ marginBottom: '1.1rem', padding: '0.85rem', background: '#fcfdf7', borderRadius: '8px', border: '1px solid #C4D600' }}>
              <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.4rem', fontSize: '0.88rem' }}>Reference Line (scale)</label>
              <button
                onClick={() => { if (isDrawingLine) { setIsDrawingLine(false); setLineStart(null) } else { setIsDrawingLine(true); setActiveGroupId(null); setBaselineDrawStart(null); setReferenceLine(null) } }}
                style={{ width: '100%', padding: '0.6rem', background: isDrawingLine ? '#f44336' : '#C4D600', color: isDrawingLine ? 'white' : '#333', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.88rem', marginBottom: '0.6rem' }}
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

            {/* ── PLAN MODE: Areas ── */}
            {projectMode === 'plan' ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <label style={{ fontWeight: '600', fontSize: '0.88rem' }}>Areas</label>
                  <button onClick={addGroup}
                    style={{ padding: '0.35rem 0.75rem', background: '#C4D600', color: '#333', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '0.82rem' }}>
                    + Add Area
                  </button>
                </div>

                {areas.length === 0 && (
                  <p style={{ fontSize: '0.82rem', color: '#aaa', textAlign: 'center', padding: '1rem 0' }}>
                    Click "+ Add Area" to define an area.
                  </p>
                )}

                {areas.map(group => {
                  const groupBackH = getGroupBackHeight(group)
                  const isActive = activeGroupId === group.id
                  const groupLineDepths = group.lineOrientations.slice(0, group.linesPerRow).map(o => o === 'vertical' ? 238.2 : 113.4)
                  const groupTotalSlope = groupLineDepths.reduce((s, d) => s + d, 0) + (group.linesPerRow - 1) * 2.5
                  return (
                    <div key={group.id} style={{ marginBottom: '0.75rem', border: `2px solid ${group.color}`, borderRadius: '8px', overflow: 'hidden' }}>
                      {/* Group header */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 0.75rem', background: `${group.color}18`, cursor: 'pointer' }}
                        onClick={() => setDiagramGroupId(group.id)}>
                        <div style={{ width: 12, height: 12, borderRadius: '50%', background: group.color, flexShrink: 0 }}/>
                        <input
                          type="text"
                          value={group.label}
                          onChange={e => updateGroup(group.id, 'label', e.target.value)}
                          onClick={e => e.stopPropagation()}
                          style={{ fontWeight: '700', fontSize: '0.85rem', flex: 1, color: '#333', border: 'none', background: 'transparent', outline: 'none', cursor: 'text', minWidth: 0, padding: 0 }}
                        />
                        <span style={{ fontSize: '0.72rem', color: group.baseline ? '#4caf50' : '#ff9800', fontWeight: '600' }}>
                          {group.baseline ? '✓ baseline' : '⚠ no baseline'}
                        </span>
                        <button onClick={(e) => { e.stopPropagation(); removeGroup(group.id) }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#bbb', fontSize: '1rem', lineHeight: 1, padding: '0 2px' }}>✕</button>
                      </div>

                      {/* Group body */}
                      <div style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                        {/* Baseline */}
                        <button
                          onClick={() => {
                            if (isActive) { setActiveGroupId(null); setBaselineDrawStart(null) }
                            else { setActiveGroupId(group.id); setBaselineDrawStart(null); setIsDrawingLine(false); setLineStart(null) }
                          }}
                          style={{ padding: '0.45rem', background: isActive ? group.color : 'white', color: isActive ? '#333' : group.color, border: `1.5px solid ${group.color}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '0.82rem' }}
                        >
                          {isActive
                            ? (baselineDrawStart ? 'Click 2nd point…' : 'Click 1st point…')
                            : (group.baseline ? 'Redraw Baseline' : 'Draw Baseline on Image')}
                        </button>

                        {/* Angle */}
                        <div>
                          <label style={{ fontSize: '0.78rem', fontWeight: '600', color: '#555', display: 'block', marginBottom: '0.25rem' }}>Angle (°)</label>
                          <input type="number" min="0" max="30" step="0.1" value={group.angle}
                            onChange={e => { const v = e.target.value; const n = parseFloat(v); if (v === '' || (n >= 0 && n <= 30)) updateGroup(group.id, 'angle', v) }}
                            placeholder="0–30°"
                            style={{ width: '100%', padding: '0.45rem', border: '1.5px solid #e0e0e0', borderRadius: '6px', fontSize: '0.85rem', boxSizing: 'border-box' }}
                          />
                        </div>

                        {/* Front Height */}
                        <div>
                          <label style={{ fontSize: '0.78rem', fontWeight: '600', color: '#555', display: 'block', marginBottom: '0.25rem' }}>Front Height (cm)</label>
                          <input type="number" min="0" step="0.1" value={group.frontHeight}
                            onChange={e => updateGroup(group.id, 'frontHeight', e.target.value)}
                            placeholder="cm"
                            style={{ width: '100%', padding: '0.45rem', border: '1.5px solid #e0e0e0', borderRadius: '6px', fontSize: '0.85rem', boxSizing: 'border-box' }}
                          />
                        </div>

                        {/* Lines per row */}
                        <div>
                          <label style={{ fontSize: '0.78rem', fontWeight: '600', color: '#555', display: 'block', marginBottom: '0.25rem' }}>Lines per Row</label>
                          <div style={{ display: 'flex', gap: '0.25rem' }}>
                            {[1,2,3,4,5].map(n => (
                              <button key={n} onClick={() => updateGroupLinesPerRow(group.id, n)}
                                style={{ flex: 1, padding: '0.35rem', background: group.linesPerRow === n ? '#1565C0' : 'white', color: group.linesPerRow === n ? 'white' : '#555', border: `1.5px solid ${group.linesPerRow === n ? '#1565C0' : '#e0e0e0'}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '0.82rem' }}>
                                {n}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Orientations */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          {group.lineOrientations.slice(0, group.linesPerRow).map((o, idx) => (
                            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              <span style={{ fontSize: '0.72rem', color: '#777', width: '42px', flexShrink: 0 }}>Line {idx+1}</span>
                              <button onClick={() => toggleGroupOrientation(group.id, idx)}
                                style={{ flex: 1, padding: '0.3rem', background: o === 'vertical' ? '#E3F2FD' : '#FFF3E0', color: o === 'vertical' ? '#1565C0' : '#E65100', border: `1.5px solid ${o === 'vertical' ? '#90CAF9' : '#FFB74D'}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '0.75rem' }}>
                                {o === 'vertical' ? '▮ Portrait' : '▬ Landscape'}
                              </button>
                            </div>
                          ))}
                        </div>

                        {/* Back height + slope depth (calculated) */}
                        {group.frontHeight !== '' && group.angle !== '' && (
                          <div style={{ padding: '0.4rem 0.6rem', background: '#f8f9fa', borderRadius: '6px', fontSize: '0.75rem', color: '#777', display: 'flex', gap: '1rem' }}>
                            <span>Back height: <strong style={{ color: '#555' }}>{groupBackH.toFixed(1)} cm</strong></span>
                            <span>Slope depth: <strong style={{ color: '#555' }}>{groupTotalSlope.toFixed(1)} cm</strong></span>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}

                {/* Validation summary */}
                <div style={{ padding: '0.75rem', background: (referenceLine && referenceLineLengthCm && areas.length > 0 && areas.every(g => g.baseline && g.angle && g.frontHeight)) ? '#e8f5e9' : '#fff3cd', borderRadius: '8px', fontSize: '0.82rem', marginTop: '0.5rem' }}>
                  <strong>Required:</strong>
                  <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem' }}>
                    <li style={{ color: (referenceLine && referenceLineLengthCm) ? '#4caf50' : '#ff9800' }}>Reference line with length</li>
                    <li style={{ color: areas.length > 0 ? '#4caf50' : '#ff9800' }}>At least one area</li>
                    <li style={{ color: areas.length > 0 && areas.every(g => g.baseline) ? '#4caf50' : '#ff9800' }}>All groups have a baseline</li>
                    <li style={{ color: areas.length > 0 && areas.every(g => g.angle && g.frontHeight) ? '#4caf50' : '#ff9800' }}>All groups have angle + front height</li>
                  </ul>
                </div>
              </div>
            ) : (
              /* ── SCRATCH MODE: existing single config ── */
              <>
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
                    onChange={(e) => { const v = e.target.value; const n = parseFloat(v); if (v === '' || (n >= 0 && n <= 30)) setPanelAngle(v) }}
                    placeholder="0–30°"
                    style={{ width: '100%', padding: '0.6rem', border: '2px solid #e0e0e0', borderRadius: '6px', fontSize: '0.88rem', boxSizing: 'border-box' }}
                  />
                </div>

                {/* Lines per Row */}
                <div style={{ marginBottom: '1.1rem' }}>
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem', fontSize: '0.88rem' }}>Lines per Row</label>
                  <div style={{ display: 'flex', gap: '0.3rem' }}>
                    {[1,2,3,4,5].map(n => (
                      <button key={n} onClick={() => handleLinesPerRowChange(n)}
                        style={{ flex: 1, padding: '0.5rem', background: linesPerRow === n ? '#1565C0' : 'white', color: linesPerRow === n ? 'white' : '#555', border: `2px solid ${linesPerRow === n ? '#1565C0' : '#e0e0e0'}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '0.9rem' }}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Orientations */}
                <div style={{ marginBottom: '1.1rem' }}>
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem', fontSize: '0.88rem' }}>
                    Line Orientations <span style={{ fontSize: '0.72rem', color: '#aaa', fontWeight: '400' }}>(front → back)</span>
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    {lineOrientations.map((o, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.78rem', color: '#777', width: '46px', flexShrink: 0 }}>Line {idx+1}</span>
                        <button onClick={() => toggleOrientation(idx)}
                          style={{ flex: 1, padding: '0.35rem 0.5rem', background: o === 'vertical' ? '#E3F2FD' : '#FFF3E0', color: o === 'vertical' ? '#1565C0' : '#E65100', border: `1.5px solid ${o === 'vertical' ? '#90CAF9' : '#FFB74D'}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '0.78rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}>
                          {o === 'vertical' ? '▮ Vertical (portrait)' : '▬ Horizontal (landscape)'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Back height + slope depth display */}
                {(panelFrontHeight !== '' && panelAngle !== '') && (
                  <div style={{ marginBottom: '1.1rem', padding: '0.6rem 0.75rem', background: '#f8f9fa', borderRadius: '6px', border: '1px solid #e8e8e8' }}>
                    <span style={{ fontSize: '0.72rem', color: '#aaa', fontWeight: '600' }}>BACK HEIGHT (calculated)</span>
                    <div style={{ fontSize: '1rem', fontWeight: '700', color: '#555', marginTop: '2px' }}>{(computedBackHeight || 0).toFixed(1)} cm</div>
                    <div style={{ marginTop: '0.4rem', borderTop: '1px solid #e8e8e8', paddingTop: '0.4rem', fontSize: '0.72rem', color: '#aaa', fontWeight: '600' }}>SLOPE DEPTH (total)</div>
                    <div style={{ fontSize: '1rem', fontWeight: '700', color: '#555', marginTop: '2px' }}>{totalSlope.toFixed(1)} cm</div>
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
              </>
            )}
            </>}
          </div>
        )}
      </div>
    </>
  )
}
