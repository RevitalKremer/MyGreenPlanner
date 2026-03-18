import { isHorizontalOrientation, isEmptyOrientation } from '../../../utils/trapezoidGeometry'

export default function PlanConfigPanel({
  areas,
  activeGroupId, setActiveGroupId,
  baselineDrawStart, setBaselineDrawStart,
  isDrawingLine, setIsDrawingLine, setLineStart,
  diagramGroupId, setDiagramGroupId,
  addGroup, updateGroup, removeGroup,
  updateGroupLinesPerRow, toggleGroupOrientation, toggleGroupEmptyOrientation,
  referenceLine, referenceLineLengthCm,
}) {
  return (
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
        const isActive = activeGroupId === group.id
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

              {/* Panel Front Height */}
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: '600', color: '#555', display: 'block', marginBottom: '0.25rem' }}>Panel Front Height (cm from floor)</label>
                <input type="number" min="0" step="0.1" value={group.frontHeight}
                  onChange={e => updateGroup(group.id, 'frontHeight', e.target.value)}
                  placeholder="cm from floor"
                  style={{ width: '100%', padding: '0.45rem', border: '1.5px solid #e0e0e0', borderRadius: '6px', fontSize: '0.85rem', boxSizing: 'border-box' }}
                />
              </div>

              {/* Lines per area */}
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: '600', color: '#555', display: 'block', marginBottom: '0.25rem' }}>Lines per Area</label>
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
                {group.lineOrientations.slice(0, group.linesPerRow).map((o, idx) => {
                  const isEmpty = isEmptyOrientation(o)
                  const isH = isHorizontalOrientation(o)
                  return (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span
                        onClick={() => toggleGroupEmptyOrientation(group.id, idx)}
                        title="Click to mark/unmark line as empty (no panels)"
                        style={{ fontSize: '0.72rem', width: '42px', flexShrink: 0, cursor: 'pointer', userSelect: 'none', color: isEmpty ? '#bbb' : '#777', textDecoration: isEmpty ? 'line-through' : 'none' }}
                      >Line {idx+1}</span>
                      <button onClick={() => toggleGroupOrientation(group.id, idx)}
                        style={{ flex: 1, padding: '0.3rem', background: isEmpty ? '#f5f5f5' : isH ? '#FFF3E0' : '#E3F2FD', color: isEmpty ? '#ccc' : isH ? '#E65100' : '#1565C0', border: `1.5px solid ${isEmpty ? '#ddd' : isH ? '#FFB74D' : '#90CAF9'}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '0.75rem', textDecoration: isEmpty ? 'line-through' : 'none' }}>
                        {isH ? '▬ Landscape' : '▮ Portrait'}
                      </button>
                    </div>
                  )
                })}
              </div>

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
  )
}
