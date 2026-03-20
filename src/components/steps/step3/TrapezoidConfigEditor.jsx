import {
  computePanelBackHeight, computeTotalSlopeDepth,
  toggleOrientation, toggleEmptyOrientation,
  isHorizontalOrientation, isEmptyOrientation,
} from '../../../utils/trapezoidGeometry'

export default function TrapezoidConfigEditor({
  selectedRow, selectedTrapezoidId, selectedAreaLabel,
  refinedArea, trapezoidConfigs, setTrapezoidConfigs,
  projectMode, areas, getAreaKey,
  updateTrapezoidConfig, resetTrapezoidConfig,
  selectedAreaTrapIds, reassignToTrapezoid, addTrapezoid,
}) {
  if (!selectedRow) return null

  const globalCfg = refinedArea?.panelConfig || {}
  const override = trapezoidConfigs?.[selectedTrapezoidId] || {}
  const isOverridden = !!(selectedTrapezoidId && trapezoidConfigs?.[selectedTrapezoidId])
  const angle = override.angle ?? globalCfg.angle ?? 0
  const backHeight = override.backHeight ?? globalCfg.backHeight ?? 0
  const frontHeight = override.frontHeight ?? globalCfg.frontHeight ?? 0

  const selectedAreaKey = getAreaKey(selectedRow[0])
  const planArea = projectMode === 'plan' && selectedAreaKey !== null
    ? areas[selectedAreaKey] ?? null
    : null
  const effectiveLinesPerRow = (override.linesPerRow ?? planArea?.linesPerRow ?? globalCfg.linesPerRow) || 1
  const effectiveLineOrientations = (override.lineOrientations ?? planArea?.lineOrientations ?? globalCfg.lineOrientations) || ['vertical']
  const totalSlope = computeTotalSlopeDepth(effectiveLineOrientations, effectiveLinesPerRow)

  // Cross-section SVG geometry
  const W = 130, H = 62, groundY = H - 8, fX = 15
  const lineDepths = effectiveLineOrientations.slice(0, effectiveLinesPerRow)
    .map(o => isHorizontalOrientation(o) ? 113.4 : 238.2)
  const angleRad = angle * Math.PI / 180
  const totalHoriz = totalSlope * Math.cos(angleRad)
  const scaleW = totalHoriz > 0 ? (W - 30) / totalHoriz : 1
  const scaleH = backHeight > 0 ? (H - 18) / backHeight : 1
  const sc = Math.min(scaleW, scaleH)
  const segs = []
  let sx = fX, sy = groundY - frontHeight * sc
  for (let li = 0; li < lineDepths.length; li++) {
    const d = lineDepths[li]
    const gap = li < lineDepths.length - 1 ? 2.5 : 0
    const sdx = d * Math.cos(angleRad) * sc
    const sdy = d * Math.sin(angleRad) * sc
    const gdx = gap * Math.cos(angleRad) * sc
    const gdy = gap * Math.sin(angleRad) * sc
    const liO = effectiveLineOrientations[li]
    segs.push({ x1: sx, y1: sy, x2: sx + sdx, y2: sy - sdy, isH: isHorizontalOrientation(liO), isEmp: isEmptyOrientation(liO) })
    sx = sx + sdx + gdx
    sy = sy - sdy - gdy
  }
  const finalX = sx

  return (
    <div style={{
      marginBottom: '0.85rem', padding: '0.6rem',
      background: isOverridden ? '#F8FAE8' : '#fafafa',
      borderRadius: '8px',
      border: `1px solid ${isOverridden ? '#C4D600' : '#f0f0f0'}`,
    }}>

      {/* Row 1: trapezoid selector */}
      <div style={{ marginBottom: '0.35rem' }}>
        <div style={{ fontSize: '0.6rem', color: '#aaa', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '3px' }}>Trapezoid</div>
        {selectedAreaTrapIds?.length > 1 ? (
          <select
            value={selectedTrapezoidId || ''}
            onChange={e => reassignToTrapezoid?.(e.target.value)}
            style={{ width: '100%', padding: '3px 6px', fontSize: '0.78rem', fontWeight: '700', color: '#5a6600', background: '#e8f2b0', border: '1px solid #C4D600', borderRadius: '6px', cursor: 'pointer' }}
          >
            {selectedAreaTrapIds.map(tid => (
              <option key={tid} value={tid}>{tid}</option>
            ))}
          </select>
        ) : (
          <div style={{ fontSize: '0.78rem', fontWeight: '700', color: '#5a6600', background: '#e8f2b0', padding: '3px 8px', borderRadius: '6px', display: 'inline-block' }}>
            {selectedTrapezoidId || '—'}
          </div>
        )}
      </div>

      {/* Row 2: actions */}
      <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.5rem' }}>
        {addTrapezoid && (
          <button
            onClick={addTrapezoid}
            style={{ flex: 1, padding: '0.28rem 0.4rem', fontSize: '0.68rem', fontWeight: '600', background: '#f0f4e8', color: '#5a6600', border: '1px solid #C4D600', borderRadius: '5px', cursor: 'pointer' }}
          >
            + New Trapezoid
          </button>
        )}
        {isOverridden && (
          <button
            onClick={resetTrapezoidConfig}
            style={{ flex: 1, padding: '0.28rem 0.4rem', fontSize: '0.68rem', fontWeight: '600', background: 'white', color: '#888', border: '1px solid #ddd', borderRadius: '5px', cursor: 'pointer' }}
          >
            ↺ Reset to Defaults
          </button>
        )}
      </div>

      {/* Cross-section preview */}
      <svg width={W} height={H} style={{ display: 'block', margin: '0 auto 0.4rem' }}>
        <line x1="0" y1={groundY} x2={W} y2={groundY} stroke="#ddd" strokeWidth="1"/>
        <line x1={fX} y1={groundY} x2={fX} y2={groundY - frontHeight * sc} stroke="#aaa" strokeWidth="1.5"/>
        <line x1={finalX} y1={groundY} x2={finalX} y2={groundY - backHeight * sc} stroke="#aaa" strokeWidth="1.5"/>
        {segs.map((seg, i) => (
          <line key={i} x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2}
            stroke={seg.isEmp ? '#ccc' : seg.isH ? '#FF9800' : '#1565C0'}
            strokeWidth="2.5" strokeLinecap="round"
            strokeDasharray={seg.isEmp ? '4 3' : undefined}
          />
        ))}
        <text x={fX - 2} y={(groundY + groundY - frontHeight * sc) / 2} textAnchor="end" fill="#888" fontSize="8">{frontHeight.toFixed(0)}</text>
        <text x={finalX + 3} y={(groundY + groundY - backHeight * sc) / 2} fill="#888" fontSize="8">{backHeight.toFixed(1)}</text>
        <text x={(fX + finalX) / 2} y={H - 1} textAnchor="middle" fill="#555" fontSize="7.5" fontWeight="700">{angle.toFixed(1)}°</text>
      </svg>

      {/* Angle + Front Height inputs */}
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.5rem' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.6rem', color: '#aaa', marginBottom: '2px' }}>Angle (°)</div>
          <input
            key={`${selectedTrapezoidId}-angle`}
            type="number" min="0" max="30" step="0.5"
            defaultValue={angle}
            onChange={e => updateTrapezoidConfig('angle', e.target.value)}
            style={{ width: '100%', padding: '0.28rem 0.4rem', boxSizing: 'border-box', border: `1px solid ${isOverridden ? '#C4D600' : '#ddd'}`, borderRadius: '5px', fontSize: '0.82rem', fontWeight: '600' }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.6rem', color: '#aaa', marginBottom: '2px' }}>Front H (cm)</div>
          <input
            key={`${selectedTrapezoidId}-frontH`}
            type="number" min="0" step="0.5"
            defaultValue={frontHeight}
            onChange={e => updateTrapezoidConfig('frontHeight', e.target.value)}
            style={{ width: '100%', padding: '0.28rem 0.4rem', boxSizing: 'border-box', border: `1px solid ${isOverridden ? '#C4D600' : '#ddd'}`, borderRadius: '5px', fontSize: '0.82rem', fontWeight: '600' }}
          />
        </div>
      </div>

      {/* Lines per Area — inline */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.45rem' }}>
        <span style={{ fontSize: '0.7rem', fontWeight: '600', color: '#777', whiteSpace: 'nowrap' }}>Lines:</span>
        <div style={{ display: 'flex', gap: '0.25rem', flex: 1 }}>
          {[1,2,3,4,5].map(n => (
            <button key={n}
              onClick={() => {
                if (!selectedTrapezoidId || !refinedArea?.panelConfig) return
                const gCfg = refinedArea.panelConfig
                const cur = trapezoidConfigs?.[selectedTrapezoidId] || {}
                const newOrients = [...effectiveLineOrientations]
                while (newOrients.length < n) newOrients.push('vertical')
                const slicedOrients = newOrients.slice(0, n)
                const a  = cur.angle       ?? gCfg.angle       ?? 0
                const fH = cur.frontHeight ?? gCfg.frontHeight ?? 0
                const bH = parseFloat(computePanelBackHeight(fH, a || 0, slicedOrients, n).toFixed(1))
                setTrapezoidConfigs(prev => ({ ...prev, [selectedTrapezoidId]: { ...cur, linesPerRow: n, lineOrientations: slicedOrients, backHeight: bH } }))
              }}
              style={{ flex: 1, padding: '0.3rem 0', background: effectiveLinesPerRow === n ? '#1565C0' : 'white', color: effectiveLinesPerRow === n ? 'white' : '#555', border: `2px solid ${effectiveLinesPerRow === n ? '#1565C0' : '#e0e0e0'}`, borderRadius: '5px', cursor: 'pointer', fontWeight: '700', fontSize: '0.8rem' }}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Line Orientations */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        {effectiveLineOrientations.slice(0, effectiveLinesPerRow).map((o, idx) => {
          const isEmpty = isEmptyOrientation(o)
          const isH = isHorizontalOrientation(o)
          return (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <span
                onClick={() => {
                  const newOrients = [...effectiveLineOrientations]
                  newOrients[idx] = toggleEmptyOrientation(newOrients[idx])
                  updateTrapezoidConfig('lineOrientations', newOrients)
                }}
                title="Click to mark/unmark as empty"
                style={{ fontSize: '0.65rem', width: '14px', flexShrink: 0, cursor: 'pointer', userSelect: 'none', color: isEmpty ? '#ccc' : '#999', fontWeight: '700', textAlign: 'center' }}
              >{idx + 1}</span>
              <button
                onClick={() => {
                  const newOrients = [...effectiveLineOrientations]
                  newOrients[idx] = toggleOrientation(newOrients[idx])
                  updateTrapezoidConfig('lineOrientations', newOrients)
                }}
                style={{ flex: 1, padding: '0.28rem 0.4rem', background: isEmpty ? '#f5f5f5' : isH ? '#FFF3E0' : '#E3F2FD', color: isEmpty ? '#ccc' : isH ? '#E65100' : '#1565C0', border: `1.5px solid ${isEmpty ? '#ddd' : isH ? '#FFB74D' : '#90CAF9'}`, borderRadius: '5px', cursor: 'pointer', fontWeight: '700', fontSize: '0.72rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem', textDecoration: isEmpty ? 'line-through' : 'none' }}
              >
                {isH ? '▬ Landscape' : '| Portrait'}
              </button>
            </div>
          )
        })}
      </div>

    </div>
  )
}
