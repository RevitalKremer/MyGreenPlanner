import { useState } from 'react'
import { PANEL_TYPES } from '../../../data/panelTypes'
import { PRIMARY, PRIMARY_DARK, PRIMARY_BG_ALT, PRIMARY_BG_LIGHT, TEXT_DARK, TEXT_SECONDARY, TEXT_MUTED, TEXT_LIGHT, TEXT_VERY_LIGHT, TEXT_PLACEHOLDER, BORDER_LIGHT, BORDER_FAINT, BORDER, BORDER_MID, BG_LIGHT, BG_FAINT, BG_MID, BLUE, BLUE_BG, BLUE_BORDER, ERROR } from '../../../styles/colors'
// BLUE_BG, BLUE_BORDER kept for trapezoid badge (shared config indicator)

export default function RowSidebar({
  panels, setPanels,
  selectedPanels, setSelectedPanels, setTrapIdOverride,
  rows, areas, setAreas, areaLabel, getAreaKey,
  areaTrapezoidMap, sharedTrapIds, trapezoidConfigs,
  regenerateSingleRowHandler,
  refreshAreaTrapezoids,
  rectAreas = [],
  setRectAreas,
  panelTypes = PANEL_TYPES,
  panelType,
  setPanelType,
  panelFrontHeight,
  setPanelFrontHeight,
  panelAngle,
  setPanelAngle,
  onDeleteArea,
}) {
  const [collapsed, setCollapsed] = useState(false)

  const applyDefaultsToAll = () => {
    setRectAreas?.(prev => prev.map(a => ({
      ...a,
      frontHeight: panelFrontHeight ?? '',
      angle: panelAngle ?? '',
    })))
  }

  return (
    <div style={{
      position: 'absolute', top: '20px', left: '20px',
      width: collapsed ? '32px' : '255px', minHeight: '36px',
      overflowX: 'hidden', overflowY: collapsed ? 'hidden' : 'auto',
      maxHeight: 'calc(100% - 40px)',
      padding: '1.25rem',
      background: 'white', borderRadius: '12px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
      border: `2px solid ${PRIMARY}`,
    }}>
      <button onClick={() => setCollapsed(c => !c)} style={{ position: 'absolute', top: '6px', right: '6px', width: '22px', height: '22px', padding: 0, background: BG_FAINT, border: `1px solid ${BORDER_LIGHT}`, borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', color: TEXT_PLACEHOLDER, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {collapsed ? '›' : '‹'}
      </button>
      {!collapsed && <>
      <h3 style={{ margin: '0 0 1rem 0', color: TEXT_SECONDARY, fontSize: '1rem', fontWeight: '700' }}>
        Panel Layout
      </h3>

      {/* Panel type selector */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.72rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
          Panel Type
        </div>
        <select
          value={panelType ?? ''}
          onChange={e => setPanelType?.(e.target.value)}
          style={{ width: '100%', padding: '0.35rem 0.5rem', border: `1px solid ${BORDER_LIGHT}`, borderRadius: '6px', fontSize: '0.82rem', color: TEXT_DARK, background: 'white', cursor: 'pointer' }}
        >
          {panelTypes.map(t => (
            <option key={t.id} value={t.id}>
              {t.name} — {t.kw}W ({t.lengthCm}×{t.widthCm} cm)
            </option>
          ))}
        </select>
      </div>

      {/* Default mounting settings */}
      {(
        <div style={{ marginBottom: '1rem', padding: '0.6rem 0.7rem 0.5rem', background: BG_FAINT, borderRadius: '8px', border: `1px solid ${BORDER_FAINT}` }}>
          <div style={{ fontSize: '0.72rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>
            Default Mounting
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.5rem' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.6rem', color: TEXT_VERY_LIGHT, marginBottom: '2px' }}>Front H (cm)</div>
              <input
                type="number" min="0" max="200" step="1"
                value={panelFrontHeight ?? ''}
                onChange={e => setPanelFrontHeight?.(e.target.value)}
                style={{ width: '100%', padding: '0.28rem 0.35rem', boxSizing: 'border-box', border: `1px solid ${BORDER_LIGHT}`, borderRadius: '4px', fontSize: '0.78rem' }}
                placeholder="e.g. 35"
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.6rem', color: TEXT_VERY_LIGHT, marginBottom: '2px' }}>Angle (°)</div>
              <input
                type="number" min="0" max="30" step="1"
                value={panelAngle ?? ''}
                onChange={e => setPanelAngle?.(e.target.value)}
                style={{ width: '100%', padding: '0.28rem 0.35rem', boxSizing: 'border-box', border: `1px solid ${BORDER_LIGHT}`, borderRadius: '4px', fontSize: '0.78rem' }}
                placeholder="0–30"
              />
            </div>
          </div>
          {rectAreas.length > 0 && (
            <button
              onClick={applyDefaultsToAll}
              style={{ width: '100%', padding: '0.28rem 0', background: 'white', border: `1px solid ${BORDER}`, borderRadius: '4px', cursor: 'pointer', fontSize: '0.72rem', fontWeight: '600', color: TEXT_DARK }}
            >
              Apply to All Areas
            </button>
          )}
        </div>
      )}

      {panels.length === 0 && (
        <p style={{ fontSize: '0.82rem', color: TEXT_MUTED, margin: '0 0 0.5rem', lineHeight: 1.4 }}>
          Select the <strong>Draw</strong> tool and drag on the canvas to create a panel area.
        </p>
      )}

      {/* State: panels placed */}
      {panels.length > 0 && (
        <>

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
                      padding: '0.4rem 0.5rem 0.35rem 0.6rem',
                      background: isRowSelected ? PRIMARY_BG_LIGHT : BG_LIGHT,
                      border: `2px solid ${isRowSelected ? PRIMARY : 'transparent'}`,
                      borderRadius: '8px',
                      transition: 'all 0.12s',
                    }}>
                      {/* Top row: dot + name + panel count + buttons */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <span
                          onClick={() => { setSelectedPanels(row.map(p => p.id)); setTrapIdOverride(null) }}
                          style={{ width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0, background: isRowSelected ? PRIMARY : BORDER_MID, cursor: 'pointer' }}
                        />
                        <input
                          value={areas[areaKey]?.label ?? areaLabel(areaKey, i)}
                          onChange={e => setAreas?.(prev => prev.map((a, idx) => idx === areaKey ? { ...a, label: e.target.value } : a))}
                          onClick={ev => { ev.stopPropagation(); setSelectedPanels(row.map(p => p.id)); setTrapIdOverride(null) }}
                          style={{ fontSize: '0.82rem', fontWeight: '600', color: TEXT_DARK, background: 'transparent', border: 'none', borderBottom: isRowSelected ? `1px solid ${PRIMARY}` : '1px solid transparent', outline: 'none', padding: '0', minWidth: 0, flex: 1, cursor: 'text' }}
                        />
                        <span
                          onClick={() => { setSelectedPanels(row.map(p => p.id)); setTrapIdOverride(null) }}
                          style={{ fontSize: '0.72rem', color: TEXT_LIGHT, whiteSpace: 'nowrap', flexShrink: 0, cursor: 'pointer' }}
                        >
                          {row.length}p
                        </span>
                        {(() => {
                          const isLocked = rectAreas[areaKey]?.mode === 'ylocked'
                          return (
                            <button
                              onClick={() => {
                                setSelectedPanels(row.map(p => p.id))
                                setRectAreas?.(prev => prev.map((a, idx) =>
                                  idx === areaKey ? { ...a, mode: isLocked ? 'free' : 'ylocked' } : a
                                ))
                              }}
                              title={isLocked ? 'Y-locked: drag Y to rotate. Click for free mode.' : 'Free mode: drag corners to resize. Click to lock.'}
                              style={{ padding: '2px 4px', flexShrink: 0, background: isLocked ? BG_MID : 'none', border: `1px solid ${isLocked ? BORDER_MID : BORDER_LIGHT}`, borderRadius: '4px', cursor: 'pointer', lineHeight: 0, display: 'flex', alignItems: 'center' }}
                            >
                              {isLocked ? (
                                <svg width="11" height="13" viewBox="0 0 11 13" fill="none">
                                  <rect x="0.5" y="5.5" width="10" height="7" rx="1.5" fill={TEXT_DARK} />
                                  <path d="M2.5 5.5V3.5a3 3 0 0 1 6 0v2" stroke={TEXT_DARK} strokeWidth="1.6" strokeLinecap="round" fill="none"/>
                                </svg>
                              ) : (
                                <svg width="11" height="13" viewBox="0 0 11 13" fill="none">
                                  <rect x="0.5" y="5.5" width="10" height="7" rx="1.5" fill={TEXT_VERY_LIGHT} />
                                  <path d="M2.5 5.5V3.5a3 3 0 0 1 6 0" stroke={TEXT_VERY_LIGHT} strokeWidth="1.6" strokeLinecap="round" fill="none"/>
                                </svg>
                              )}
                            </button>
                          )
                        })()}
                        <button
                          onClick={() => {
                            if (onDeleteArea) {
                              onDeleteArea(areaKey)
                            } else {
                              setPanels(prev => prev.filter(p => (p.area ?? p.row) !== areaKey))
                              setSelectedPanels([])
                            }
                          }}
                          title={`Delete area ${areaLabel(areaKey, i)}`}
                          style={{ padding: '1px 5px', flexShrink: 0, background: 'none', border: `1px solid ${ERROR}`, borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', color: ERROR, lineHeight: 1 }}
                        >✕</button>
                        <button
                          onClick={() => { setSelectedPanels(row.map(p => p.id)); regenerateSingleRowHandler(areaKey) }}
                          title={`Regenerate ${areaLabel(areaKey, i)}`}
                          style={{ padding: '1px 5px', flexShrink: 0, background: 'none', border: `1px solid ${BORDER}`, borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', color: TEXT_VERY_LIGHT, lineHeight: 1 }}
                        >↺</button>
                        {typeof areaKey === 'number' && refreshAreaTrapezoids && !rectAreas[areaKey]?.manualTrapezoids && (
                          <button
                            onClick={() => refreshAreaTrapezoids(areaKey)}
                            title="Re-split trapezoids based on current panel layout"
                            style={{ padding: '1px 5px', flexShrink: 0, background: 'none', border: `1px solid ${BORDER}`, borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', color: TEXT_VERY_LIGHT, lineHeight: 1 }}
                          >⟳</button>
                        )}
                      </div>
                      {/* Second row: trapezoid badge(s) */}
                      {!hasMultiTrap && trapIds.length === 1 && (
                        <div style={{ marginTop: '0.2rem', paddingLeft: '13px' }}>
                          <span
                            title={sharedTrapIds.has(trapIds[0]) ? 'Shared config — changes affect all areas using this trapezoid' : trapIds[0]}
                            style={{
                              fontSize: '0.6rem', fontWeight: '700',
                              padding: '1px 5px', borderRadius: '8px',
                              background: sharedTrapIds.has(trapIds[0]) ? BLUE_BG : BG_MID,
                              color: sharedTrapIds.has(trapIds[0]) ? BLUE : TEXT_PLACEHOLDER,
                              border: sharedTrapIds.has(trapIds[0]) ? `1px solid ${BLUE_BORDER}` : '1px solid transparent',
                              cursor: 'default',
                            }}
                          >
                            {trapIds[0]}{sharedTrapIds.has(trapIds[0]) && ' ⇄'}
                          </span>
                        </div>
                      )}
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

        </>
      )}
      </>}
    </div>
  )
}
