import { useState } from 'react'
import { useLang } from '../../../i18n/LangContext'
import { PRIMARY, PRIMARY_DARK, PRIMARY_BG_ALT, PRIMARY_BG_LIGHT, TEXT_DARK, TEXT_SECONDARY, TEXT_MUTED, TEXT_LIGHT, TEXT_VERY_LIGHT, TEXT_PLACEHOLDER, BORDER_LIGHT, BORDER_FAINT, BORDER, BORDER_MID, BG_LIGHT, BG_FAINT, BG_MID, BLUE, BLUE_BG, BLUE_BORDER } from '../../../styles/colors'
// BLUE_BG, BLUE_BORDER kept for trapezoid badge (shared config indicator)
import TrapezoidConfigEditor from './TrapezoidConfigEditor'

export default function RowSidebar({
  panels,
  selectedPanels, setSelectedPanels, setTrapIdOverride,
  rows, areaGroups, areaLabel, getAreaKey, onMergeRowIntoArea,
  areaTrapezoidMap, sharedTrapIds, trapezoidConfigs,
  rectAreas = [],
  setRectAreas,
  panelTypes = [],
  panelType,
  setPanelType,
  panelFrontHeight,
  setPanelFrontHeight,
  panelAngle,
  setPanelAngle,
  selectedRow,
  selectedTrapezoidId,
  selectedAreaLabel,
  selectedAreaTrapIds,
  refinedArea,
  resetTrapezoidConfig,
  reassignToTrapezoid,
  panelGapCm,
  lineGapCm,
  showMounting = true,
  angleMin,
  angleMax,
  frontHeightMin,
  frontHeightMax,
  roofType = 'concrete',
}) {
  const { t } = useLang()
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
      position: 'absolute', top: '20px', right: '20px',
      width: collapsed ? '32px' : '255px', minHeight: '36px',
      overflowX: 'hidden', overflowY: collapsed ? 'hidden' : 'auto',
      maxHeight: 'calc(100% - 40px)',
      padding: '1.25rem',
      background: 'white', borderRadius: '12px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
      border: `2px solid ${PRIMARY}`,
    }}>
      <button onClick={() => setCollapsed(c => !c)} style={{ position: 'absolute', top: '6px', right: '6px', width: '22px', height: '22px', padding: 0, background: BG_FAINT, border: `1px solid ${BORDER_LIGHT}`, borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', color: TEXT_PLACEHOLDER, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {collapsed ? '‹' : '›'}
      </button>
      {!collapsed && <>
      <h3 style={{ margin: '0 0 1rem 0', color: TEXT_SECONDARY, fontSize: '1rem', fontWeight: '700' }}>
        {t('step2.sidebar.title')}
      </h3>

      {/* Panel type selector */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.72rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
          {t('step2.sidebar.panelType')}
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

      {/* Default mounting settings (visibility controlled by DB roof_types) */}
      {showMounting && (
        <div style={{ marginBottom: '1rem', padding: '0.6rem 0.7rem 0.5rem', background: BG_FAINT, borderRadius: '8px', border: `1px solid ${BORDER_FAINT}` }}>
          <div style={{ fontSize: '0.72rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>
            {t('step2.sidebar.defaultMounting')}
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.5rem' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.6rem', color: TEXT_VERY_LIGHT, marginBottom: '2px' }}>{t('step2.sidebar.angle')}</div>
              <input
                type="number" min={angleMin} max={angleMax} step="1"
                value={panelAngle ?? ''}
                onChange={e => setPanelAngle?.(e.target.value)}
                onBlur={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) setPanelAngle?.(String(Math.min(angleMax, Math.max(angleMin, v)))) }}
                style={{ width: '100%', padding: '0.28rem 0.35rem', boxSizing: 'border-box', border: `1px solid ${BORDER_LIGHT}`, borderRadius: '4px', fontSize: '0.78rem' }}
                placeholder={`${angleMin}–${angleMax}`}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.6rem', color: TEXT_VERY_LIGHT, marginBottom: '2px' }}>{t('step2.sidebar.frontH')}</div>
              <input
                type="number" min={frontHeightMin} max={frontHeightMax} step="1"
                value={panelFrontHeight ?? ''}
                onChange={e => setPanelFrontHeight?.(e.target.value)}
                onBlur={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) setPanelFrontHeight?.(String(Math.min(frontHeightMax, Math.max(frontHeightMin, v)))) }}
                style={{ width: '100%', padding: '0.28rem 0.35rem', boxSizing: 'border-box', border: `1px solid ${BORDER_LIGHT}`, borderRadius: '4px', fontSize: '0.78rem' }}
                placeholder={`${frontHeightMin}–${frontHeightMax}`}
              />
            </div>
          </div>
          {rectAreas.length > 0 && (
            <button
              onClick={applyDefaultsToAll}
              style={{ width: '100%', padding: '0.28rem 0', background: 'white', border: `1px solid ${BORDER}`, borderRadius: '4px', cursor: 'pointer', fontSize: '0.72rem', fontWeight: '600', color: TEXT_DARK }}
            >
              {t('step2.sidebar.applyToAll')}
            </button>
          )}
        </div>
      )}

      {panels.length === 0 && (
        <p style={{ fontSize: '0.82rem', color: TEXT_MUTED, margin: '0 0 0.5rem', lineHeight: 1.4 }}>
          {t('step2.sidebar.drawHint')}
        </p>
      )}

      {/* State: panels placed */}
      {panels.length > 0 && (
        <>

          {/* Area list with trapezoid sub-items — grouped by areaGroupId */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
              {t('step2.sidebar.areas')} ({(areaGroups || []).length || rows.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              {(areaGroups && areaGroups.length > 0 ? areaGroups : rows.map((row, i) => ({
                groupId: getAreaKey(row[0]), label: rectAreas[getAreaKey(row[0])]?.label, rows: [{ rowIdx: i, row, areaIdx: getAreaKey(row[0]), panelRowIndex: 0 }], areaIndices: [getAreaKey(row[0])],
              }))).map((group) => {
                const isMultiRow = group.rows.length > 1
                const allGroupPanels = group.rows.flatMap(r => r.row)
                const isGroupSelected = allGroupPanels.some(p => selectedPanels.includes(p.id))
                const firstAreaKey = group.areaIndices[0]
                const trapIds = areaTrapezoidMap[firstAreaKey] || []
                const hasMultiTrap = trapIds.length > 1
                const totalPanels = allGroupPanels.length

                return (
                  <div key={group.groupId}>
                    <div style={{
                      padding: '0.4rem 0.5rem 0.35rem 0.6rem',
                      background: isGroupSelected ? PRIMARY_BG_LIGHT : BG_LIGHT,
                      border: `2px solid ${isGroupSelected ? PRIMARY : 'transparent'}`,
                      borderRadius: '8px',
                      transition: 'all 0.12s',
                    }}>
                      {/* Top row: dot + name + panel count */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <span
                          onClick={() => { setSelectedPanels(allGroupPanels.map(p => p.id)); setTrapIdOverride(null) }}
                          style={{ width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0, background: isGroupSelected ? PRIMARY : BORDER_MID, cursor: 'pointer' }}
                        />
                        <input
                          value={rectAreas[firstAreaKey]?.label ?? areaLabel(firstAreaKey, 0)}
                          onChange={e => {
                            const newLabel = e.target.value
                            setRectAreas?.(prev => prev.map(a =>
                              (a.areaGroupId || a.label) === group.groupId ? { ...a, label: newLabel } : a
                            ))
                          }}
                          onClick={ev => { ev.stopPropagation(); setSelectedPanels(allGroupPanels.map(p => p.id)); setTrapIdOverride(null) }}
                          style={{ fontSize: '0.82rem', fontWeight: '600', color: TEXT_DARK, background: 'transparent', border: 'none', borderBottom: isGroupSelected ? `1px solid ${PRIMARY}` : '1px solid transparent', outline: 'none', padding: '0', minWidth: 0, flex: 1, cursor: 'text' }}
                        />
                        <span
                          onClick={() => { setSelectedPanels(allGroupPanels.map(p => p.id)); setTrapIdOverride(null) }}
                          style={{ fontSize: '0.72rem', color: TEXT_LIGHT, whiteSpace: 'nowrap', flexShrink: 0, cursor: 'pointer' }}
                        >
                          {isMultiRow && `${group.rows.length}r `}{totalPanels}p
                        </span>
                      </div>

                      {/* Multi-row: show sub-rows */}
                      {isMultiRow && (
                        <div style={{ marginTop: '0.25rem', paddingLeft: '13px', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                          {group.rows.map((r, ri) => {
                            const isSubSelected = r.row.some(p => selectedPanels.includes(p.id))
                            return (
                              <div
                                key={ri}
                                onClick={() => { setSelectedPanels(r.row.map(p => p.id)); setTrapIdOverride(null) }}
                                style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', padding: '0.1rem 0.2rem', borderRadius: '4px', background: isSubSelected ? PRIMARY_BG_ALT : 'transparent' }}
                              >
                                <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: isSubSelected ? PRIMARY : BORDER_LIGHT, flexShrink: 0 }} />
                                <span style={{ fontSize: '0.68rem', color: isSubSelected ? TEXT_DARK : TEXT_VERY_LIGHT }}>
                                  Row {ri + 1} — {r.row.length}p
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      )}

                      {/* Trapezoid badge(s) */}
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

                      {/* "Add to Area..." merge button — shown for single-row areas when other areas exist */}
                      {!isMultiRow && isGroupSelected && (() => {
                        const thisArea = rectAreas[firstAreaKey]
                        const thisAngle = parseFloat(thisArea?.angle) || 0
                        const thisFH = parseFloat(thisArea?.frontHeight) || 0
                        const allGroups = areaGroups || []
                        const compatibleTargets = allGroups.filter(g => {
                          if (g.groupId === group.groupId) return false
                          const targetArea = rectAreas[g.areaIndices[0]]
                          const tAngle = parseFloat(targetArea?.angle) || 0
                          const tFH = parseFloat(targetArea?.frontHeight) || 0
                          return Math.abs(tAngle - thisAngle) < 0.1 && Math.abs(tFH - thisFH) < 0.1
                        })
                        if (compatibleTargets.length === 0) return null
                        return (
                          <div style={{ marginTop: '0.3rem', paddingLeft: '13px' }}>
                            <select
                              defaultValue=""
                              onChange={e => {
                                if (e.target.value) {
                                  onMergeRowIntoArea?.(firstAreaKey, e.target.value)
                                  e.target.value = ''
                                }
                              }}
                              style={{ width: '100%', padding: '0.2rem 0.3rem', fontSize: '0.68rem', border: `1px solid ${BORDER}`, borderRadius: '4px', color: TEXT_SECONDARY, cursor: 'pointer', background: 'white' }}
                            >
                              <option value="" disabled>{t('step2.sidebar.addToArea')}</option>
                              {compatibleTargets.map(g => (
                                <option key={g.groupId} value={g.groupId}>
                                  {g.label} ({g.rows.flatMap(r => r.row).length}p)
                                </option>
                              ))}
                            </select>
                          </div>
                        )
                      })()}
                    </div>
                    {hasMultiTrap && (
                      <div style={{ borderLeft: `2px solid ${PRIMARY}`, marginLeft: '0.7rem', borderRadius: '0 0 6px 6px', background: BG_FAINT, borderBottom: `1px solid ${BORDER_FAINT}`, borderRight: `1px solid ${BORDER_FAINT}` }}>
                        {trapIds.map(trapId => {
                          const trapPanels = panels.filter(p => group.areaIndices.includes(p.area ?? p.row) && p.trapezoidId === trapId)
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
                                <span title={t('step2.sidebar.customConfig')} style={{ width: '5px', height: '5px', borderRadius: '50%', background: PRIMARY, flexShrink: 0 }} />
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

      {/* Trapezoid config — shown below areas when a row/trapezoid is selected (not tiles) */}
      {selectedRow && roofType !== 'tiles' && (
        <div style={{ marginTop: '0.75rem', borderTop: `1px solid ${BORDER_FAINT}`, paddingTop: '0.75rem' }}>
          <TrapezoidConfigEditor
            selectedRow={selectedRow}
            selectedTrapezoidId={selectedTrapezoidId}
            selectedAreaLabel={selectedAreaLabel}
            refinedArea={refinedArea}
            trapezoidConfigs={trapezoidConfigs}
            getAreaKey={getAreaKey}
            resetTrapezoidConfig={resetTrapezoidConfig}
            selectedAreaTrapIds={selectedAreaTrapIds}
            reassignToTrapezoid={reassignToTrapezoid}
            panelFrontHeight={panelFrontHeight}
            panelAngle={panelAngle}
            rectAreas={rectAreas}
            setRectAreas={setRectAreas}
            panelGapCm={panelGapCm}
            lineGapCm={lineGapCm}
            showMounting={showMounting}
            angleMin={angleMin}
            angleMax={angleMax}
            frontHeightMin={frontHeightMin}
            frontHeightMax={frontHeightMax}
            panelSpec={panelTypes.find(t => t.id === panelType) ?? panelTypes[0]}
          />
        </div>
      )}
      </>}
    </div>
  )
}
