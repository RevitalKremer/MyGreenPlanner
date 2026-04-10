import { useState } from 'react'
import { PRIMARY, TEXT, TEXT_DARK, TEXT_SECONDARY, TEXT_VERY_LIGHT, TEXT_PLACEHOLDER, TEXT_FAINTEST, BORDER_LIGHT, BORDER_FAINT, BORDER, BORDER_MID, BG_SUBTLE, BG_FAINT, BG_MID, BLUE, BLUE_BG, BLUE_BORDER, ERROR, ERROR_DARK, ERROR_BG } from '../../../styles/colors'
import { useLang } from '../../../i18n/LangContext'

const NUDGE_CM = 2.5

export default function ToolPanel({
  activeTool, handleToolChange,
  selectedPanels,
  nudgeRow, togglePanelOrientation, addManualPanel,
  distanceMeasurement, setDistanceMeasurement,
  pendingAddNextTo, setPendingAddNextTo, addError, setAddError,
  showHGridlines, setShowHGridlines,
  showVGridlines, setShowVGridlines,
  snapToGridlines, setSnapToGridlines,
  yLocked, onToggleYLock, hasAreas,
  drawVertical, onToggleDrawVertical,
  onSetEditMode,
  selectedAreaIdx,
  selectedAreaLabel,
  onDeleteArea,
  onResetArea,
  onRotateArea90,
}) {
  const { t } = useLang()
  const [collapsed, setCollapsed] = useState(false)

  const toolBtnStyle = (tool) => ({
    flex: 1,
    padding: '0.45rem 0.15rem',
    background: activeTool === tool ? PRIMARY : 'white',
    color: activeTool === tool ? TEXT : TEXT_PLACEHOLDER,
    border: `2px solid ${activeTool === tool ? PRIMARY : BORDER_FAINT}`,
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: '700',
    fontSize: '1rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '1px',
    lineHeight: 1,
    transition: 'all 0.15s',
  })

  const toolLabel = (label) => (
    <span style={{ fontSize: '0.58rem', fontWeight: '600', color: 'inherit' }}>{label}</span>
  )

  const nudgeBtnStyle = {
    padding: '0.3rem', background: 'white', color: TEXT_SECONDARY,
    border: `1px solid ${BORDER}`, borderRadius: '5px', cursor: 'pointer',
    fontWeight: '700', fontSize: '0.85rem', textAlign: 'center', lineHeight: 1,
  }

  return (
    <div style={{
      position: 'absolute', top: '20px', left: '20px',
      width: collapsed ? '32px' : '225px', minHeight: '36px', overflow: 'hidden',
      maxHeight: collapsed ? 'none' : 'calc(100vh - 120px)', overflowY: collapsed ? 'hidden' : 'auto',
      padding: '1rem',
      background: 'white', borderRadius: '12px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
      border: `2px solid ${PRIMARY}`,
    }}>
      <button onClick={() => setCollapsed(c => !c)} style={{ position: 'absolute', top: '6px', right: '6px', width: '22px', height: '22px', padding: 0, background: BG_SUBTLE, border: `1px solid ${BORDER_LIGHT}`, borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', color: TEXT_PLACEHOLDER, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {collapsed ? '›' : '‹'}
      </button>
      {!collapsed && <>

      {/* Mode toggle: Areas / Panels */}
      {(() => {
        const editMode = activeTool === 'area' ? 'area' : 'panel'
        const modeTabStyle = (mode) => ({
          flex: 1, padding: '0.4rem 0.3rem',
          background: editMode === mode ? PRIMARY : BG_FAINT,
          color: editMode === mode ? 'white' : TEXT_VERY_LIGHT,
          border: 'none', borderRadius: '6px',
          cursor: 'pointer', fontWeight: '700', fontSize: '0.75rem',
          transition: 'all 0.15s',
        })
        const areaHasSelection = selectedAreaIdx !== null
        const areaActionStyle = (disabled) => ({
          flex: 1, padding: '0.4rem 0.2rem',
          background: 'white', color: disabled ? TEXT_VERY_LIGHT : TEXT_SECONDARY,
          border: `1px solid ${disabled ? BORDER_FAINT : BORDER}`,
          borderRadius: '6px', cursor: disabled ? 'default' : 'pointer',
          fontWeight: '600', fontSize: '0.72rem', opacity: disabled ? 0.5 : 1,
        })
        return (
          <>
            {/* Toggle row */}
            <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.75rem', background: BG_FAINT, borderRadius: '8px', padding: '3px' }}>
              <button style={modeTabStyle('area')} onClick={() => onSetEditMode('area')}>{t('step2.tool.modeAreas')}</button>
              <button style={modeTabStyle('panel')} onClick={() => onSetEditMode('panel')}>{t('step2.tool.modePanels')}</button>
            </div>

            {/* ── Area mode ── */}
            {editMode === 'area' && (
              <div style={{ marginBottom: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {/* Y-Lock */}
                <button
                  onClick={onToggleYLock}
                  disabled={!hasAreas}
                  title={yLocked ? 'Y-locked: drag inside area to rotate. Click to switch to free mode.' : 'Free mode: drag corners to resize. Click to enable Y-lock.'}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', padding: '0.4rem 0.5rem', background: yLocked ? BG_MID : 'white', color: yLocked ? TEXT_DARK : TEXT_VERY_LIGHT, border: `1px solid ${yLocked ? BORDER_MID : BORDER}`, borderRadius: '6px', cursor: hasAreas ? 'pointer' : 'default', fontWeight: '600', fontSize: '0.72rem', opacity: hasAreas ? 1 : 0.4 }}
                >
                  {yLocked ? (
                    <svg width="11" height="13" viewBox="0 0 11 13" fill="none" style={{ flexShrink: 0 }}>
                      <rect x="0.5" y="5.5" width="10" height="7" rx="1.5" fill={TEXT_DARK} />
                      <path d="M2.5 5.5V3.5a3 3 0 0 1 6 0v2" stroke={TEXT_DARK} strokeWidth="1.6" strokeLinecap="round" fill="none"/>
                    </svg>
                  ) : (
                    <svg width="11" height="13" viewBox="0 0 11 13" fill="none" style={{ flexShrink: 0 }}>
                      <rect x="0.5" y="5.5" width="10" height="7" rx="1.5" fill={TEXT_VERY_LIGHT} />
                      <path d="M2.5 5.5V3.5a3 3 0 0 1 6 0" stroke={TEXT_VERY_LIGHT} strokeWidth="1.6" strokeLinecap="round" fill="none"/>
                    </svg>
                  )}
                  {yLocked ? t('step2.tool.yLocked') : t('step2.tool.yFree')}
                </button>
                {/* V-Draw toggle */}
                <button
                  onClick={onToggleDrawVertical}
                  title={drawVertical ? t('step2.tool.drawVerticalOnTitle') : t('step2.tool.drawVerticalOffTitle')}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', padding: '0.4rem 0.5rem', background: drawVertical ? BG_MID : 'white', color: drawVertical ? TEXT_DARK : TEXT_VERY_LIGHT, border: `1px solid ${drawVertical ? BORDER_MID : BORDER}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.72rem' }}
                >
                  ⊞ {drawVertical ? t('step2.tool.drawVerticalOn') : t('step2.tool.drawVerticalOff')}
                </button>
                {/* Area selection hint / actions */}
                <div style={{ padding: '0.5rem 0.6rem', background: BG_FAINT, borderRadius: '7px', border: `1px solid ${BG_MID}` }}>
                  {areaHasSelection ? (
                    <>
                      <div style={{ fontSize: '0.72rem', color: TEXT_VERY_LIGHT, marginBottom: '0.4rem' }}>
                        {t('step2.tool.selectedArea', { label: selectedAreaLabel ?? selectedAreaIdx })}
                      </div>
                      <div style={{ display: 'flex', gap: '0.3rem' }}>
                        <button style={areaActionStyle(false)} onClick={() => onDeleteArea(selectedAreaIdx)} title={t('step2.tool.deleteAreaTitle')}>
                          🗑 {t('step2.tool.deleteArea')}
                        </button>
                        <button style={areaActionStyle(false)} onClick={() => onResetArea(selectedAreaIdx)} title={t('step2.tool.resetAreaTitle')}>
                          ↺ {t('step2.tool.resetArea')}
                        </button>
                        <button style={areaActionStyle(false)} onClick={() => onRotateArea90?.(selectedAreaIdx)} title={t('step2.tool.rotateArea90Title')}>
                          ↻ 90°
                        </button>
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: '0.78rem', color: TEXT_FAINTEST, textAlign: 'center', padding: '0.2rem 0' }}>
                      {t('step2.tool.clickAreaToSelect')}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Panel mode ── */}
            {editMode === 'panel' && (
              <>
                {/* Panel tool buttons */}
                <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.75rem' }}>
                  <button style={toolBtnStyle('move')} onClick={() => handleToolChange('move')} title={t('step2.tool.moveRow')}>
                    <span>✥</span>{toolLabel(t('step2.tool.move'))}
                  </button>
                  <button style={toolBtnStyle('rotate')} onClick={() => handleToolChange('rotate')} title={t('step2.tool.rotateRow')}>
                    <span>↻</span>{toolLabel(t('step2.tool.rotate'))}
                  </button>
                  <button style={toolBtnStyle('delete')} onClick={() => handleToolChange('delete')} title={t('step2.tool.deletePanel')}>
                    <span>✂</span>{toolLabel(t('step2.tool.delete'))}
                  </button>
                  <button style={toolBtnStyle('add')} onClick={() => handleToolChange('add')} title={t('step2.tool.addPanel')}>
                    <span>＋</span>{toolLabel(t('step2.tool.add'))}
                  </button>
                </div>

                {/* Context panel */}
                <div style={{ minHeight: '80px', marginBottom: '0.75rem', padding: '0.65rem', background: BG_FAINT, borderRadius: '8px', border: `1px solid ${BG_MID}` }}>
                  {activeTool === 'move' && (
                    selectedPanels.length > 0 ? (
                      <div>
                        <div style={{ fontSize: '0.82rem', fontWeight: '700', color: TEXT, marginBottom: '0.6rem' }}>
                          {t('step2.tool.panelsSelected', { n: selectedPanels.length, s: selectedPanels.length !== 1 ? 's' : '' })}
                          <span style={{ fontWeight: '400', color: TEXT_PLACEHOLDER, fontSize: '0.75rem' }}>{t('step2.tool.dragToMove')}</span>
                        </div>
                        <div style={{ fontSize: '0.7rem', color: TEXT_VERY_LIGHT, marginBottom: '0.35rem' }}>{t('step2.tool.fineAdjust')}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 30px)', gap: '0.2rem', justifyContent: 'center' }}>
                          <div />
                          <button style={nudgeBtnStyle} onClick={() => nudgeRow(0, -NUDGE_CM)}>↑</button>
                          <div />
                          <button style={nudgeBtnStyle} onClick={() => nudgeRow(-NUDGE_CM, 0)}>←</button>
                          <div style={{ ...nudgeBtnStyle, background: BG_MID, cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: BORDER_MID, display: 'block' }} />
                          </div>
                          <button style={nudgeBtnStyle} onClick={() => nudgeRow(NUDGE_CM, 0)}>→</button>
                          <div />
                          <button style={nudgeBtnStyle} onClick={() => nudgeRow(0, NUDGE_CM)}>↓</button>
                          <div />
                        </div>
                        <div style={{ fontSize: '0.68rem', color: TEXT_FAINTEST, textAlign: 'center', marginTop: '0.4rem' }}>
                          {t('step2.tool.orDragCanvas')}
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.8rem', color: TEXT_FAINTEST, textAlign: 'center', paddingTop: '0.4rem', lineHeight: 1.6 }}>
                        <div>{t('step2.tool.clickToSelect')}</div>
                        <div style={{ fontSize: '0.7rem' }}>{t('step2.tool.boxSelect')}</div>
                        <div style={{ fontSize: '0.7rem' }}>{t('step2.tool.shiftClick')}</div>
                        <div style={{ marginTop: '0.4rem', fontSize: '0.68rem', color: BORDER_MID, borderTop: `1px solid ${BG_MID}`, paddingTop: '0.4rem' }}>
                          {t('step2.tool.panHint')}
                        </div>
                      </div>
                    )
                  )}
                  {activeTool === 'rotate' && (
                    selectedPanels.length > 0 ? (
                      <div>
                        <div style={{ fontSize: '0.82rem', fontWeight: '700', color: TEXT, marginBottom: '0.6rem' }}>
                          {t('step2.tool.panelsSelected', { n: selectedPanels.length, s: selectedPanels.length !== 1 ? 's' : '' })}
                        </div>
                        <button onClick={togglePanelOrientation} style={{ width: '100%', padding: '0.5rem', background: 'white', color: TEXT_SECONDARY, border: `1px solid ${BORDER}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '0.85rem' }}>
                          {t('step2.tool.rotate90')}
                        </button>
                        <div style={{ fontSize: '0.68rem', color: TEXT_FAINTEST, textAlign: 'center', marginTop: '0.35rem' }}>
                          {t('step2.tool.rotate90Hint')}
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.82rem', color: TEXT_FAINTEST, textAlign: 'center', paddingTop: '0.6rem' }}>
                        {t('step2.tool.clickToSelectIt')}
                      </div>
                    )
                  )}
                  {activeTool === 'delete' && (
                    <div>
                      <div style={{ fontSize: '0.82rem', fontWeight: '700', color: '#c62828', marginBottom: '0.35rem' }}>{t('step2.tool.cutDelete')}</div>
                      <div style={{ fontSize: '0.78rem', color: TEXT_PLACEHOLDER, lineHeight: '1.5' }}>{t('step2.tool.deleteHint')}</div>
                    </div>
                  )}
                  {activeTool === 'add' && (
                    <div>
                      <button
                        onClick={() => { setAddError(null); setPendingAddNextTo(p => !p) }}
                        style={{ width: '100%', padding: '0.5rem', marginBottom: '0.4rem', background: pendingAddNextTo ? PRIMARY : 'white', color: pendingAddNextTo ? TEXT : TEXT_SECONDARY, border: `2px solid ${pendingAddNextTo ? PRIMARY : BORDER}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '0.82rem' }}
                      >{t('step2.tool.addNext')}</button>
                      {pendingAddNextTo && (
                        <div style={{ fontSize: '0.72rem', color: TEXT_PLACEHOLDER, textAlign: 'center', marginBottom: '0.4rem' }}>{t('step2.tool.addNextHint')}</div>
                      )}
                      {addError && (
                        <div style={{ fontSize: '0.72rem', color: ERROR_DARK, background: ERROR_BG, border: `1px solid ${ERROR}`, borderRadius: '5px', padding: '0.3rem 0.5rem', marginBottom: '0.4rem', textAlign: 'center' }}>{addError}</div>
                      )}
                      <button onClick={() => { setAddError(null); addManualPanel() }} style={{ width: '100%', padding: '0.5rem', background: 'white', color: TEXT_SECONDARY, border: `1px solid ${BORDER}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.82rem' }}>
                        {t('step2.tool.addStandalone')}
                      </button>
                    </div>
                  )}
                  {(activeTool === 'area' || activeTool === 'measure') && (
                    <div style={{ fontSize: '0.78rem', color: TEXT_FAINTEST, textAlign: 'center', paddingTop: '0.4rem' }}>
                      {t('step2.tool.selectPanelTool')}
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )
      })()}

      {/* View controls — always visible */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        <div style={{ display: 'flex', gap: '0.3rem' }}>
          <button onClick={() => setShowHGridlines(!showHGridlines)} style={{ flex: 1, padding: '0.4rem 0.2rem', background: showHGridlines ? '#F3F9E6' : 'white', color: showHGridlines ? '#5a7a00' : TEXT_VERY_LIGHT, border: `1px solid ${showHGridlines ? PRIMARY : BORDER}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.72rem' }}>{t('step2.tool.hGrid')}</button>
          <button onClick={() => setShowVGridlines(!showVGridlines)} style={{ flex: 1, padding: '0.4rem 0.2rem', background: showVGridlines ? '#F3F9E6' : 'white', color: showVGridlines ? '#5a7a00' : TEXT_VERY_LIGHT, border: `1px solid ${showVGridlines ? PRIMARY : BORDER}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.72rem' }}>{t('step2.tool.vGrid')}</button>
          <button onClick={() => setSnapToGridlines(!snapToGridlines)} style={{ flex: 1, padding: '0.4rem 0.2rem', background: snapToGridlines ? '#e8f0ff' : 'white', color: snapToGridlines ? '#1a4fd6' : '#aaa', border: `1px solid ${snapToGridlines ? '#7baaf7' : '#ddd'}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.72rem' }}>{t('step2.tool.snap')}</button>
          <button
            onClick={() => handleToolChange(activeTool === 'measure' ? 'area' : 'measure')}
            style={{ flex: 1, padding: '0.4rem 0.2rem', background: activeTool === 'measure' ? BLUE_BG : 'white', color: activeTool === 'measure' ? BLUE : TEXT_VERY_LIGHT, border: `1px solid ${activeTool === 'measure' ? BLUE_BORDER : BORDER}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.72rem' }}
          >📏</button>
        </div>
        {activeTool === 'measure' && (
          <div style={{ fontSize: '0.72rem', color: TEXT_PLACEHOLDER, textAlign: 'center' }}>
            {t('step2.tool.measureHint')}
          </div>
        )}
        {distanceMeasurement?.p2 && (
          <button onClick={() => setDistanceMeasurement(null)} style={{ width: '100%', padding: '0.4rem', background: BLUE_BG, color: BLUE, border: `1px solid ${BLUE_BORDER}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.75rem' }}>
            {t('step2.tool.clearRuler')}
          </button>
        )}
      </div>

      </>}
    </div>
  )
}
