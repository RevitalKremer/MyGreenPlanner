import { useState } from 'react'
import { PRIMARY, PRIMARY_DARK, PRIMARY_BG_ALT, PRIMARY_BG_LIGHT, TEXT, TEXT_DARK, TEXT_SECONDARY, TEXT_MUTED, TEXT_LIGHT, TEXT_VERY_LIGHT, TEXT_PLACEHOLDER, BORDER_LIGHT, BORDER_FAINT, BORDER, BORDER_MID, BG_LIGHT, BG_FAINT, BG_MID, WARNING, WARNING_DARK, WARNING_BG, SUCCESS, SUCCESS_DARK, SUCCESS_BG, BLUE, BLUE_BG, BLUE_BORDER } from '../../../styles/colors'

export default function RowSidebar({
  projectMode, baseline, setBaseline, panels, setPanels,
  selectedPanels, setSelectedPanels, setTrapIdOverride,
  rows, areas, setAreas, areaLabel, getAreaKey,
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
      border: `2px solid ${PRIMARY}`,
      maxHeight: collapsed ? 'none' : 'calc(100vh - 120px)', overflowY: collapsed ? 'hidden' : 'auto',
    }}>
      <button onClick={() => setCollapsed(c => !c)} style={{ position: 'absolute', top: '6px', right: '6px', width: '22px', height: '22px', padding: 0, background: BG_FAINT, border: `1px solid ${BORDER_LIGHT}`, borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', color: TEXT_PLACEHOLDER, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {collapsed ? '›' : '‹'}
      </button>
      {!collapsed && <>
      <h3 style={{ margin: '0 0 1rem 0', color: TEXT_SECONDARY, fontSize: '1rem', fontWeight: '700' }}>
        Panel Layout
      </h3>

      {/* State: drawing baseline (scratch mode only) */}
      {projectMode !== 'plan' && (!baseline || !baseline.p2) && (
        <div style={{ padding: '1rem', background: WARNING_BG, borderRadius: '8px', border: `2px solid ${WARNING}` }}>
          <h4 style={{ margin: '0 0 0.5rem 0', color: WARNING_DARK, fontSize: '0.9rem' }}>
            📍 Draw Baseline
          </h4>
          <p style={{ fontSize: '0.82rem', color: TEXT_MUTED, margin: '0 0 0.5rem 0' }}>
            Click <strong>two points</strong> to define the first row baseline:
          </p>
          <ol style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.82rem', color: TEXT_MUTED }}>
            <li style={{ marginBottom: '0.2rem' }}>Starting point (SW corner)</li>
            <li>Ending point (SE corner)</li>
          </ol>
          {baseline?.p1 && !baseline.p2 && (
            <p style={{ fontSize: '0.82rem', color: WARNING, margin: '0.5rem 0 0', fontWeight: '600' }}>
              ✓ First point set — click the second point.
            </p>
          )}
        </div>
      )}

      {/* State: baseline ready, no panels (scratch mode only) */}
      {projectMode !== 'plan' && baseline?.p2 && panels.length === 0 && (
        <>
          <div style={{ padding: '0.75rem', background: SUCCESS_BG, borderRadius: '8px', border: `2px solid ${SUCCESS}`, marginBottom: '1rem' }}>
            <p style={{ fontSize: '0.82rem', color: SUCCESS_DARK, margin: 0, fontWeight: '600' }}>
              ✓ Baseline drawn!
            </p>
          </div>
          <button
            onClick={() => { setBaseline(null); setPanels([]) }}
            style={{ width: '100%', padding: '0.5rem', marginBottom: '0.5rem', background: 'white', color: TEXT_MUTED, border: `2px solid ${BORDER}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.82rem' }}
          >
            🔄 Redraw Baseline
          </button>
          <button
            onClick={generatePanelLayoutHandler}
            style={{ width: '100%', padding: '0.75rem', background: PRIMARY, color: TEXT, border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '0.95rem' }}
          >
            Generate Panel Layout
          </button>
        </>
      )}

      {/* State: plan mode, panels cleared */}
      {projectMode === 'plan' && panels.length === 0 && (
        <div style={{ padding: '1rem', background: WARNING_BG, borderRadius: '8px', border: `2px solid ${WARNING}` }}>
          <p style={{ fontSize: '0.82rem', color: TEXT_MUTED, margin: '0 0 0.75rem 0' }}>
            Panels were cleared. Regenerate from the baselines defined in Step 2.
          </p>
          <button
            onClick={regeneratePlanPanelsHandler}
            style={{ width: '100%', padding: '0.75rem', background: PRIMARY, color: TEXT, border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '0.95rem' }}
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
              <div style={{ fontSize: '1.5rem', fontWeight: '700', color: PRIMARY, lineHeight: 1 }}>{panels.length}</div>
              <div style={{ fontSize: '0.7rem', color: TEXT_LIGHT, marginTop: '2px' }}>Panels</div>
            </div>
            <div style={{ padding: '0.65rem', background: BG_LIGHT, borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: '700', color: PRIMARY, lineHeight: 1 }}>{(panels.length * 0.67).toFixed(1)}</div>
              <div style={{ fontSize: '0.7rem', color: TEXT_LIGHT, marginTop: '2px' }}>kW</div>
            </div>
            <div style={{ padding: '0.5rem', background: BG_LIGHT, borderRadius: '8px', textAlign: 'center', gridColumn: 'span 2' }}>
              <div style={{ fontSize: '1.1rem', fontWeight: '700', color: TEXT_MUTED }}>{(panels.length * 238.2 * 113.4 / 10000).toFixed(1)} m²</div>
              <div style={{ fontSize: '0.7rem', color: TEXT_LIGHT }}>Roof Coverage</div>
            </div>
          </div>

          {/* Area list with trapezoid sub-items */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
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
                      background: isRowSelected ? PRIMARY_BG_LIGHT : BG_LIGHT,
                      border: `2px solid ${isRowSelected ? PRIMARY : 'transparent'}`,
                      borderRadius: hasMultiTrap ? '8px 8px 0 0' : '8px',
                      transition: 'all 0.12s',
                    }}>
                      <div
                        onClick={() => { setSelectedPanels(row.map(p => p.id)); setTrapIdOverride(null) }}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, cursor: 'pointer' }}
                      >
                        <span style={{ width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0, background: isRowSelected ? PRIMARY : BORDER_MID }} />
                        <input
                          value={areas[areaKey]?.label ?? areaLabel(areaKey, i)}
                          onChange={e => setAreas?.(prev => prev.map((a, idx) => idx === areaKey ? { ...a, label: e.target.value } : a))}
                          onClick={ev => { ev.stopPropagation(); setSelectedPanels(row.map(p => p.id)); setTrapIdOverride(null) }}
                          style={{ fontSize: '0.82rem', fontWeight: '600', color: TEXT_DARK, background: 'transparent', border: 'none', borderBottom: isRowSelected ? `1px solid ${PRIMARY}` : '1px solid transparent', outline: 'none', padding: '0', width: '80px', cursor: 'text' }}
                        />
                        {!hasMultiTrap && trapIds.length === 1 && (
                          <span
                            title={sharedTrapIds.has(trapIds[0]) ? 'Shared config — changes affect all areas using this trapezoid' : trapIds[0]}
                            style={{
                              fontSize: '0.62rem', fontWeight: '700',
                              padding: '1px 5px', borderRadius: '8px',
                              background: sharedTrapIds.has(trapIds[0]) ? BLUE_BG : BG_MID,
                              color: sharedTrapIds.has(trapIds[0]) ? BLUE : TEXT_PLACEHOLDER,
                              border: sharedTrapIds.has(trapIds[0]) ? `1px solid ${BLUE_BORDER}` : '1px solid transparent',
                              cursor: 'default',
                            }}
                          >
                            {trapIds[0]}{sharedTrapIds.has(trapIds[0]) && ' ⇄'}
                          </span>
                        )}
                        <span style={{ fontSize: '0.75rem', color: TEXT_LIGHT, marginLeft: 'auto' }}>
                          {row.length} panels
                        </span>
                      </div>
                      <button
                        onClick={() => regenerateSingleRowHandler(areaKey)}
                        title={`Regenerate ${areaLabel(areaKey, i)}`}
                        style={{ marginLeft: '0.4rem', padding: '2px 6px', flexShrink: 0, background: 'none', border: `1px solid ${BORDER}`, borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', color: TEXT_VERY_LIGHT, lineHeight: 1 }}
                      >↺</button>
                    </div>
                    {hasMultiTrap && (
                      <div style={{ borderLeft: `2px solid ${PRIMARY}`, marginLeft: '0.7rem', borderRadius: '0 0 6px 6px', background: BG_FAINT, borderBottom: `1px solid ${BORDER_FAINT}`, borderRight: `1px solid ${BORDER_FAINT}` }}>
                        {trapIds.map(trapId => {
                          const trapPanels = panels.filter(p => (p.area ?? p.row) === areaKey && p.trapezoidId === trapId)
                          const isTrapSelected = trapPanels.length > 0 && trapPanels.every(p => selectedPanels.includes(p.id))
                          return (
                            <div
                              key={trapId}
                              onClick={() => { setSelectedPanels(trapPanels.map(p => p.id)); setTrapIdOverride(trapId) }}
                              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.5rem 0.3rem 0.75rem', cursor: 'pointer', background: isTrapSelected ? '#f0f9e4' : 'transparent', borderBottom: `1px solid ${BG_MID}` }}
                            >
                              <span style={{ fontSize: '0.72rem', fontWeight: '700', color: isTrapSelected ? PRIMARY_DARK : TEXT_PLACEHOLDER, background: isTrapSelected ? PRIMARY_BG_ALT : BG_MID, padding: '1px 6px', borderRadius: '10px', letterSpacing: '0.02em' }}>{trapId}</span>
                              <span style={{ fontSize: '0.72rem', color: TEXT_VERY_LIGHT, marginLeft: 'auto' }}>{trapPanels.length} panels</span>
                              {!!trapezoidConfigs?.[trapId] && (
                                <span title="Custom config" style={{ width: '5px', height: '5px', borderRadius: '50%', background: PRIMARY, flexShrink: 0 }} />
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
              style={{ flex: 1, padding: '0.5rem', background: 'white', color: TEXT_PLACEHOLDER, border: `2px solid ${BORDER_FAINT}`, borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: '600' }}
            >
              🔄 Reset
            </button>
            <button
              onClick={projectMode === 'plan' ? regeneratePlanPanelsHandler : generatePanelLayoutHandler}
              style={{ flex: 1, padding: '0.5rem', background: TEXT_MUTED, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: '600' }}
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
