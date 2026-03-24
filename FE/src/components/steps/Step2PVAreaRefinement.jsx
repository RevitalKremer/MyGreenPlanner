import { useState } from 'react'
import { PRIMARY, TEXT, TEXT_SECONDARY, TEXT_LIGHT, TEXT_PLACEHOLDER, BORDER_LIGHT, BG_SUBTLE, ERROR, WARNING, SUCCESS } from '../../styles/colors'
import {
  computePanelBackHeight,
  toggleOrientation, toggleEmptyOrientation,
} from '../../utils/trapezoidGeometry'
import AreaCanvas from './step2/AreaCanvas'
import CrossSectionPanel from './step2/CrossSectionPanel'
import ScratchConfigPanel from './step2/ScratchConfigPanel'
import PlanConfigPanel from './step2/PlanConfigPanel'

const GROUP_COLORS = ['#2196F3', '#FF5722', '#9C27B0', WARNING, SUCCESS, '#00BCD4']

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
  referenceLineLengthCm,
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
  const [activeGroupId, setActiveGroupId] = useState(null)
  const [baselineDrawStart, setBaselineDrawStart] = useState(null)
  const [diagramGroupId, setDiagramGroupId] = useState(null)
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false)

  // ── Scratch mode helpers ──────────────────────────────────────────────────
  const handleLinesPerRowChange = (n) => {
    setLinesPerRow(n)
    setLineOrientations(prev => {
      const next = [...prev]
      while (next.length < n) next.push('vertical')
      return next.slice(0, n)
    })
  }

  const handleToggleOrientation = (idx) => {
    setLineOrientations(prev => { const next = [...prev]; next[idx] = toggleOrientation(next[idx]); return next })
  }

  const handleToggleEmptyOrientation = (idx) => {
    setLineOrientations(prev => { const next = [...prev]; next[idx] = toggleEmptyOrientation(next[idx]); return next })
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
      next[idx] = toggleOrientation(next[idx])
      return { ...g, lineOrientations: next }
    }))
  }

  const toggleGroupEmptyOrientation = (id, idx) => {
    setAreas(prev => prev.map(g => {
      if (g.id !== id) return g
      const next = [...g.lineOrientations]
      next[idx] = toggleEmptyOrientation(next[idx])
      return { ...g, lineOrientations: next }
    }))
  }

  const getGroupBackHeight = (group) =>
    computePanelBackHeight(
      parseFloat(group.frontHeight) || 0,
      parseFloat(group.angle) || 0,
      group.lineOrientations,
      group.linesPerRow || 1
    )

  // ── Image click handler ──────────────────────────────────────────────────
  const handleImageClick = (e) => {
    if (!imageRef) return
    const rect = imageRef.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * imageRef.naturalWidth
    const y = ((e.clientY - rect.top) / rect.height) * imageRef.naturalHeight

    if (activeGroupId) {
      if (!baselineDrawStart) { setBaselineDrawStart([x, y]) }
      else {
        updateGroup(activeGroupId, 'baseline', { p1: baselineDrawStart, p2: [x, y] })
        setBaselineDrawStart(null)
        setActiveGroupId(null)
      }
    }
  }

  const isDrawingAnything = !!activeGroupId

  // ── Diagram data ──────────────────────────────────────────────────────────
  const dg = projectMode === 'plan'
    ? (areas.find(g => g.id === diagramGroupId) || areas[0] || null)
    : null

  const diagAngle   = dg ? (parseFloat(dg.angle) || 0)       : (parseFloat(panelAngle) || 0)
  const diagFrontH  = dg ? (parseFloat(dg.frontHeight) || 0) : (parseFloat(panelFrontHeight) || 0)
  const diagBackH   = dg ? getGroupBackHeight(dg)             : (computedBackHeight || 0)
  const diagLPR     = dg ? (dg.linesPerRow || 1)              : linesPerRow
  const diagOrients = dg ? (dg.lineOrientations || ['vertical']) : lineOrientations


  return (
    <>
      <div className="step-content-area" style={{ position: 'relative' }}>
        {uploadedImageData ? (
          <AreaCanvas
            uploadedImageData={uploadedImageData}
            viewZoom={viewZoom} setViewZoom={setViewZoom}
            imageRef={imageRef} setImageRef={setImageRef}
            roofPolygon={roofPolygon}
            areas={areas} projectMode={projectMode}
            activeGroupId={activeGroupId} baselineDrawStart={baselineDrawStart}
            handleImageClick={handleImageClick}
            isDrawingAnything={isDrawingAnything}
          />
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
          <CrossSectionPanel
            projectMode={projectMode} dg={dg}
            areas={areas} diagramGroupId={diagramGroupId} setDiagramGroupId={setDiagramGroupId}
            diagAngle={diagAngle} diagFrontH={diagFrontH} diagBackH={diagBackH}
            diagLPR={diagLPR} diagOrients={diagOrients}
          />
        )}

        {/* ── Right: Configuration ── */}
        {uploadedImageData && (
          <div style={{
            position: 'absolute', top: '20px', right: '20px',
            width: rightPanelCollapsed ? '32px' : '320px', minHeight: '36px', overflow: 'hidden',
            background: 'white', padding: '1.5rem', borderRadius: '12px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            maxHeight: rightPanelCollapsed ? 'none' : 'calc(100vh - 120px)', overflowY: rightPanelCollapsed ? 'hidden' : 'auto',
            border: `2px solid ${PRIMARY}`
          }}>
            <button onClick={() => setRightPanelCollapsed(c => !c)} style={{ position: 'absolute', top: '6px', right: '6px', width: '22px', height: '22px', padding: 0, background: BG_SUBTLE, border: `1px solid ${BORDER_LIGHT}`, borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', color: TEXT_PLACEHOLDER, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {rightPanelCollapsed ? '‹' : '›'}
            </button>
            {!rightPanelCollapsed && (
              <>
                <h3 style={{ margin: '0 0 1rem', color: TEXT_SECONDARY, fontSize: '1.05rem', fontWeight: '600' }}>
                  Panel Configuration
                </h3>

                {/* Panel Type (global, both modes) */}
                <div style={{ marginBottom: '1.1rem' }}>
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.4rem', fontSize: '0.88rem' }}>Panel Type</label>
                  <select value={panelType} onChange={(e) => setPanelType(e.target.value)}
                    style={{ width: '100%', padding: '0.6rem', border: `2px solid ${BORDER_LIGHT}`, borderRadius: '6px', fontSize: '0.88rem' }}>
                    <option value="AIKO-G670-MCH72Mw">AIKO-G670-MCH72Mw (2382×1134×30mm)</option>
                  </select>
                  <p style={{ margin: '0.35rem 0 0', fontSize: '0.72rem', color: TEXT_LIGHT, fontStyle: 'italic' }}>238.2 cm (L) × 113.4 cm (W)</p>
                </div>

                {/* Mode-specific config */}
                {projectMode === 'plan' ? (
                  <PlanConfigPanel
                    areas={areas}
                    activeGroupId={activeGroupId} setActiveGroupId={setActiveGroupId}
                    baselineDrawStart={baselineDrawStart} setBaselineDrawStart={setBaselineDrawStart}
                    isDrawingLine={isDrawingLine} setIsDrawingLine={setIsDrawingLine} setLineStart={setLineStart}
                    diagramGroupId={diagramGroupId} setDiagramGroupId={setDiagramGroupId}
                    addGroup={addGroup} updateGroup={updateGroup} removeGroup={removeGroup}
                    updateGroupLinesPerRow={updateGroupLinesPerRow}
                    toggleGroupOrientation={toggleGroupOrientation}
                    toggleGroupEmptyOrientation={toggleGroupEmptyOrientation}
                    referenceLine={referenceLine} referenceLineLengthCm={referenceLineLengthCm}
                  />
                ) : (
                  <ScratchConfigPanel
                    panelFrontHeight={panelFrontHeight} setPanelFrontHeight={setPanelFrontHeight}
                    panelAngle={panelAngle} setPanelAngle={setPanelAngle}
                    linesPerRow={linesPerRow} lineOrientations={lineOrientations}
                    handleLinesPerRowChange={handleLinesPerRowChange}
                    handleToggleOrientation={handleToggleOrientation}
                    handleToggleEmptyOrientation={handleToggleEmptyOrientation}
                    referenceLine={referenceLine} referenceLineLengthCm={referenceLineLengthCm}
                  />
                )}
              </>
            )}
          </div>
        )}
      </div>
    </>
  )
}
