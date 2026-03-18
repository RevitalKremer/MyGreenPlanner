import { isHorizontalOrientation, isEmptyOrientation } from '../../../utils/trapezoidGeometry'

export default function ScratchConfigPanel({
  panelFrontHeight, setPanelFrontHeight,
  panelAngle, setPanelAngle,
  linesPerRow, lineOrientations,
  handleLinesPerRowChange, handleToggleOrientation, handleToggleEmptyOrientation,
  referenceLine, referenceLineLengthCm,
}) {
  return (
    <>
      {/* Panel Front Height */}
      <div style={{ marginBottom: '1.1rem' }}>
        <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.4rem', fontSize: '0.88rem' }}>Panel Front Height (cm from floor)</label>
        <input type="number" min="0" step="0.1" value={panelFrontHeight}
          onChange={(e) => setPanelFrontHeight(e.target.value)}
          placeholder="Panel front edge height from floor"
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

      {/* Lines per Area */}
      <div style={{ marginBottom: '1.1rem' }}>
        <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem', fontSize: '0.88rem' }}>Lines per Area</label>
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
          {lineOrientations.map((o, idx) => {
            const isEmpty = isEmptyOrientation(o)
            const isH = isHorizontalOrientation(o)
            return (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span
                  onClick={() => handleToggleEmptyOrientation(idx)}
                  title="Click to mark/unmark line as empty (no panels)"
                  style={{ fontSize: '0.78rem', width: '46px', flexShrink: 0, cursor: 'pointer', userSelect: 'none', color: isEmpty ? '#bbb' : '#777', textDecoration: isEmpty ? 'line-through' : 'none' }}
                >Line {idx+1}</span>
                <button onClick={() => handleToggleOrientation(idx)}
                  style={{ flex: 1, padding: '0.35rem 0.5rem', background: isEmpty ? '#f5f5f5' : isH ? '#FFF3E0' : '#E3F2FD', color: isEmpty ? '#ccc' : isH ? '#E65100' : '#1565C0', border: `1.5px solid ${isEmpty ? '#ddd' : isH ? '#FFB74D' : '#90CAF9'}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '0.78rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', textDecoration: isEmpty ? 'line-through' : 'none' }}>
                  {isH ? '▬ Horizontal (landscape)' : '▮ Vertical (portrait)'}
                </button>
              </div>
            )
          })}
        </div>
      </div>

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
  )
}
