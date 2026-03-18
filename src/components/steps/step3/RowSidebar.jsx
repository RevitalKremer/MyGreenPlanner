import { useState } from 'react'

export default function RowSidebar({
  projectMode, baseline, setBaseline, panels, setPanels,
  selectedPanels, setSelectedPanels, setTrapIdOverride,
  rows, areas, areaLabel, getAreaKey,
  areaTrapezoidMap, sharedTrapIds, trapezoidConfigs,
  regenerateSingleRowHandler, generatePanelLayoutHandler, regeneratePlanPanelsHandler,
}) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div style={{
      position: 'absolute', top: '20px', left: '20px',
      width: collapsed ? '32px' : '255px', minHeight: '36px', overflow: 'hidden',
      padding: '1.25rem',
      background: 'white', borderRadius: '12px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
      border: '2px solid #C4D600',
      maxHeight: collapsed ? 'none' : 'calc(100vh - 120px)', overflowY: collapsed ? 'hidden' : 'auto',
    }}>
      <button onClick={() => setCollapsed(c => !c)} style={{ position: 'absolute', top: '6px', right: '6px', width: '22px', height: '22px', padding: 0, background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {collapsed ? '›' : '‹'}
      </button>
      {!collapsed && <>
      <h3 style={{ margin: '0 0 1rem 0', color: '#555', fontSize: '1rem', fontWeight: '700' }}>
        Panel Layout
      </h3>

      {/* State: drawing baseline (scratch mode only) */}
      {projectMode !== 'plan' && (!baseline || !baseline.p2) && (
        <div style={{ padding: '1rem', background: '#FFF3E0', borderRadius: '8px', border: '2px solid #FF9800' }}>
          <h4 style={{ margin: '0 0 0.5rem 0', color: '#E65100', fontSize: '0.9rem' }}>
            📍 Draw Baseline
          </h4>
          <p style={{ fontSize: '0.82rem', color: '#666', margin: '0 0 0.5rem 0' }}>
            Click <strong>two points</strong> to define the first row baseline:
          </p>
          <ol style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.82rem', color: '#666' }}>
            <li style={{ marginBottom: '0.2rem' }}>Starting point (SW corner)</li>
            <li>Ending point (SE corner)</li>
          </ol>
          {baseline?.p1 && !baseline.p2 && (
            <p style={{ fontSize: '0.82rem', color: '#FF9800', margin: '0.5rem 0 0', fontWeight: '600' }}>
              ✓ First point set — click the second point.
            </p>
          )}
        </div>
      )}

      {/* State: baseline ready, no panels (scratch mode only) */}
      {projectMode !== 'plan' && baseline?.p2 && panels.length === 0 && (
        <>
          <div style={{ padding: '0.75rem', background: '#E8F5E9', borderRadius: '8px', border: '2px solid #4CAF50', marginBottom: '1rem' }}>
            <p style={{ fontSize: '0.82rem', color: '#1B5E20', margin: 0, fontWeight: '600' }}>
              ✓ Baseline drawn!
            </p>
          </div>
          <button
            onClick={() => { setBaseline(null); setPanels([]) }}
            style={{ width: '100%', padding: '0.5rem', marginBottom: '0.5rem', background: 'white', color: '#666', border: '2px solid #ddd', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.82rem' }}
          >
            🔄 Redraw Baseline
          </button>
          <button
            onClick={generatePanelLayoutHandler}
            style={{ width: '100%', padding: '0.75rem', background: '#C4D600', color: '#333', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '0.95rem' }}
          >
            Generate Panel Layout
          </button>
        </>
      )}

      {/* State: plan mode, panels cleared */}
      {projectMode === 'plan' && panels.length === 0 && (
        <div style={{ padding: '1rem', background: '#FFF3E0', borderRadius: '8px', border: '2px solid #FF9800' }}>
          <p style={{ fontSize: '0.82rem', color: '#666', margin: '0 0 0.75rem 0' }}>
            Panels were cleared. Regenerate from the baselines defined in Step 2.
          </p>
          <button
            onClick={regeneratePlanPanelsHandler}
            style={{ width: '100%', padding: '0.75rem', background: '#C4D600', color: '#333', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '0.95rem' }}
          >
            ↺ Regenerate from Baselines
          </button>
        </div>
      )}

      {/* State: panels placed */}
      {panels.length > 0 && (
        <>
          {/* Stats grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1rem' }}>
            <div style={{ padding: '0.65rem', background: '#f8f9fa', borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#C4D600', lineHeight: 1 }}>{panels.length}</div>
              <div style={{ fontSize: '0.7rem', color: '#999', marginTop: '2px' }}>Panels</div>
            </div>
            <div style={{ padding: '0.65rem', background: '#f8f9fa', borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#C4D600', lineHeight: 1 }}>{(panels.length * 0.67).toFixed(1)}</div>
              <div style={{ fontSize: '0.7rem', color: '#999', marginTop: '2px' }}>kW</div>
            </div>
            <div style={{ padding: '0.5rem', background: '#f8f9fa', borderRadius: '8px', textAlign: 'center', gridColumn: 'span 2' }}>
              <div style={{ fontSize: '1.1rem', fontWeight: '700', color: '#666' }}>{(panels.length * 238.2 * 113.4 / 10000).toFixed(1)} m²</div>
              <div style={{ fontSize: '0.7rem', color: '#999' }}>Roof Coverage</div>
            </div>
          </div>

          {/* Area list with trapezoid sub-items */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
              Areas ({rows.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              {rows.map((row, i) => {
                const isRowSelected = row.some(p => selectedPanels.includes(p.id))
                const areaKey = getAreaKey(row[0])
                const trapIds = areaTrapezoidMap[areaKey] || []
                const hasMultiTrap = trapIds.length > 1
                return (
                  <div key={i}>
                    <div style={{
                      display: 'flex', alignItems: 'center',
                      padding: '0.45rem 0.5rem 0.45rem 0.7rem',
                      background: isRowSelected ? '#f4f9e4' : '#f8f9fa',
                      border: `2px solid ${isRowSelected ? '#C4D600' : 'transparent'}`,
                      borderRadius: hasMultiTrap ? '8px 8px 0 0' : '8px',
                      transition: 'all 0.12s',
                    }}>
                      <div
                        onClick={() => { setSelectedPanels(row.map(p => p.id)); setTrapIdOverride(null) }}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, cursor: 'pointer' }}
                      >
                        <span style={{ width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0, background: isRowSelected ? '#C4D600' : '#ccc' }} />
                        <span style={{ fontSize: '0.82rem', fontWeight: '600', color: '#444' }}>
                          {areaLabel(areaKey, i)}
                        </span>
                        {!hasMultiTrap && trapIds.length === 1 && (
                          <span
                            title={sharedTrapIds.has(trapIds[0]) ? 'Shared config — changes affect all areas using this trapezoid' : trapIds[0]}
                            style={{
                              fontSize: '0.62rem', fontWeight: '700',
                              padding: '1px 5px', borderRadius: '8px',
                              background: sharedTrapIds.has(trapIds[0]) ? '#E3F2FD' : '#f0f0f0',
                              color: sharedTrapIds.has(trapIds[0]) ? '#1565C0' : '#888',
                              border: sharedTrapIds.has(trapIds[0]) ? '1px solid #90CAF9' : '1px solid transparent',
                              cursor: 'default',
                            }}
                          >
                            {trapIds[0]}{sharedTrapIds.has(trapIds[0]) && ' ⇄'}
                          </span>
                        )}
                        <span style={{ fontSize: '0.75rem', color: '#999', marginLeft: 'auto' }}>
                          {row.length} panels
                        </span>
                      </div>
                      <button
                        onClick={() => regenerateSingleRowHandler(areaKey)}
                        title={`Regenerate ${areaLabel(areaKey, i)}`}
                        style={{ marginLeft: '0.4rem', padding: '2px 6px', flexShrink: 0, background: 'none', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', color: '#aaa', lineHeight: 1 }}
                      >↺</button>
                    </div>
                    {hasMultiTrap && (
                      <div style={{ borderLeft: '2px solid #C4D600', marginLeft: '0.7rem', borderRadius: '0 0 6px 6px', background: '#fafafa', borderBottom: '1px solid #e8e8e8', borderRight: '1px solid #e8e8e8' }}>
                        {trapIds.map(trapId => {
                          const trapPanels = panels.filter(p => (p.area ?? p.row) === areaKey && p.trapezoidId === trapId)
                          const isTrapSelected = trapPanels.length > 0 && trapPanels.every(p => selectedPanels.includes(p.id))
                          return (
                            <div
                              key={trapId}
                              onClick={() => { setSelectedPanels(trapPanels.map(p => p.id)); setTrapIdOverride(trapId) }}
                              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.5rem 0.3rem 0.75rem', cursor: 'pointer', background: isTrapSelected ? '#f0f9e4' : 'transparent', borderBottom: '1px solid #f0f0f0' }}
                            >
                              <span style={{ fontSize: '0.72rem', fontWeight: '700', color: isTrapSelected ? '#5a6600' : '#888', background: isTrapSelected ? '#e8f2b0' : '#f0f0f0', padding: '1px 6px', borderRadius: '10px', letterSpacing: '0.02em' }}>{trapId}</span>
                              <span style={{ fontSize: '0.72rem', color: '#aaa', marginLeft: 'auto' }}>{trapPanels.length} panels</span>
                              {!!trapezoidConfigs?.[trapId] && (
                                <span title="Custom config" style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#FF9800', flexShrink: 0 }} />
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Layout actions */}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => {
                if (projectMode === 'plan') { setPanels([]); setSelectedPanels([]) }
                else { setBaseline(null); setPanels([]); setSelectedPanels([]) }
              }}
              style={{ flex: 1, padding: '0.5rem', background: 'white', color: '#888', border: '2px solid #e8e8e8', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: '600' }}
            >
              🔄 Reset
            </button>
            <button
              onClick={projectMode === 'plan' ? regeneratePlanPanelsHandler : generatePanelLayoutHandler}
              style={{ flex: 1, padding: '0.5rem', background: '#666', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: '600' }}
            >
              ↺ Regenerate
            </button>
          </div>
        </>
      )}
      </>}
    </div>
  )
}
