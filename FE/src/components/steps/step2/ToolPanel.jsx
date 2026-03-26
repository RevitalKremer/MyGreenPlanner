import { useState } from 'react'
import { PRIMARY, TEXT, TEXT_SECONDARY, TEXT_VERY_LIGHT, TEXT_PLACEHOLDER, TEXT_FAINTEST, BORDER_LIGHT, BORDER_FAINT, BORDER, BORDER_MID, BG_SUBTLE, BG_FAINT, BG_MID, BLUE, BLUE_BG, BLUE_BORDER, ERROR, ERROR_DARK, ERROR_BG } from '../../../styles/colors'
import TrapezoidConfigEditor from './TrapezoidConfigEditor'
import { useLang } from '../../../i18n/LangContext'

const NUDGE_PX = 5

export default function ToolPanel({
  activeTool, handleToolChange,
  selectedPanels, selectedAreaLabel,
  nudgeRow, togglePanelOrientation, addManualPanel,
  distanceMeasurement, setDistanceMeasurement,
  selectedAreaTrapIds, selectedTrapezoidId,
  pendingAddNextTo, setPendingAddNextTo, addError, setAddError,
  reassignToTrapezoid,
  selectedRow, refinedArea, trapezoidConfigs,
  getAreaKey,
  resetTrapezoidConfig,
  panelFrontHeight, panelAngle,
  rectAreas, setRectAreas,
  showHGridlines, setShowHGridlines,
  showVGridlines, setShowVGridlines,
  snapToGridlines, setSnapToGridlines,
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
      position: 'absolute', top: '20px', right: '20px',
      width: collapsed ? '32px' : '225px', minHeight: '36px', overflow: 'hidden',
      maxHeight: collapsed ? 'none' : 'calc(100vh - 120px)', overflowY: collapsed ? 'hidden' : 'auto',
      padding: '1rem',
      background: 'white', borderRadius: '12px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
      border: `2px solid ${PRIMARY}`,
    }}>
      <button onClick={() => setCollapsed(c => !c)} style={{ position: 'absolute', top: '6px', right: '6px', width: '22px', height: '22px', padding: 0, background: BG_SUBTLE, border: `1px solid ${BORDER_LIGHT}`, borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', color: TEXT_PLACEHOLDER, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {collapsed ? '‹' : '›'}
      </button>
      {!collapsed && <>

      {/* Tool selector */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.7rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.45rem' }}>
          {t('step2.tool.title')}
        </div>
        <div style={{ display: 'flex', gap: '0.3rem' }}>
          <button style={toolBtnStyle('draw')} onClick={() => handleToolChange('draw')} title={t('step2.tool.drawArea')}>
            <span>▦</span>{toolLabel(t('step2.tool.draw'))}
          </button>
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
          <button style={toolBtnStyle('measure')} onClick={() => handleToolChange('measure')} title={t('step2.tool.measureDistance')}>
            <span style={{ fontSize: '0.85rem' }}>📏</span>{toolLabel(t('step2.tool.ruler'))}
          </button>
        </div>
      </div>

      {/* Gridlines + Snap */}
      <div style={{ marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        <div style={{ display: 'flex', gap: '0.3rem' }}>
          <button
            onClick={() => setShowHGridlines(!showHGridlines)}
            style={{ flex: 1, padding: '0.4rem 0.2rem', background: showHGridlines ? '#F3F9E6' : 'white', color: showHGridlines ? '#5a7a00' : TEXT_VERY_LIGHT, border: `1px solid ${showHGridlines ? PRIMARY : BORDER}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.72rem' }}
          >{t('step2.tool.hGrid')}</button>
          <button
            onClick={() => setShowVGridlines(!showVGridlines)}
            style={{ flex: 1, padding: '0.4rem 0.2rem', background: showVGridlines ? '#F3F9E6' : 'white', color: showVGridlines ? '#5a7a00' : TEXT_VERY_LIGHT, border: `1px solid ${showVGridlines ? PRIMARY : BORDER}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.72rem' }}
          >{t('step2.tool.vGrid')}</button>
          <button
            onClick={() => setSnapToGridlines(!snapToGridlines)}
            style={{ flex: 1, padding: '0.4rem 0.2rem', background: snapToGridlines ? '#e8f0ff' : 'white', color: snapToGridlines ? '#1a4fd6' : '#aaa', border: `1px solid ${snapToGridlines ? '#7baaf7' : '#ddd'}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.72rem' }}
          >{t('step2.tool.snap')}</button>
        </div>
      </div>

      {/* Context panel */}
      <div style={{ minHeight: '90px', marginBottom: '1rem', padding: '0.75rem', background: BG_FAINT, borderRadius: '8px', border: `1px solid ${BG_MID}` }}>

        {/* Move tool */}
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
                <button style={nudgeBtnStyle} onClick={() => nudgeRow(0, -NUDGE_PX)}>↑</button>
                <div />
                <button style={nudgeBtnStyle} onClick={() => nudgeRow(-NUDGE_PX, 0)}>←</button>
                <div style={{ ...nudgeBtnStyle, background: BG_MID, cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: BORDER_MID, display: 'block' }} />
                </div>
                <button style={nudgeBtnStyle} onClick={() => nudgeRow(NUDGE_PX, 0)}>→</button>
                <div />
                <button style={nudgeBtnStyle} onClick={() => nudgeRow(0, NUDGE_PX)}>↓</button>
                <div />
              </div>
              <div style={{ fontSize: '0.68rem', color: TEXT_FAINTEST, textAlign: 'center', marginTop: '0.4rem' }}>
                {t('step2.tool.orDragCanvas')}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '0.8rem', color: TEXT_FAINTEST, textAlign: 'center', paddingTop: '0.5rem', lineHeight: 1.6 }}>
              <div>{t('step2.tool.clickToSelect')}</div>
              <div style={{ fontSize: '0.7rem' }}>{t('step2.tool.boxSelect')}</div>
              <div style={{ fontSize: '0.7rem' }}>{t('step2.tool.shiftClick')}</div>
              <div style={{ marginTop: '0.5rem', fontSize: '0.68rem', color: BORDER_MID, borderTop: `1px solid ${BG_MID}`, paddingTop: '0.4rem' }}>
                {t('step2.tool.panHint')}
              </div>
            </div>
          )
        )}

        {/* Rotate tool */}
        {activeTool === 'rotate' && (
          selectedPanels.length > 0 ? (
            <div>
              <div style={{ fontSize: '0.82rem', fontWeight: '700', color: TEXT, marginBottom: '0.6rem' }}>
                {t('step2.tool.panelsSelected', { n: selectedPanels.length, s: selectedPanels.length !== 1 ? 's' : '' })}
              </div>
              <button
                onClick={togglePanelOrientation}
                style={{ width: '100%', padding: '0.5rem', background: 'white', color: TEXT_SECONDARY, border: `1px solid ${BORDER}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '0.85rem' }}
              >
                {t('step2.tool.rotate90')}
              </button>
              <div style={{ fontSize: '0.68rem', color: TEXT_FAINTEST, textAlign: 'center', marginTop: '0.35rem' }}>
                {t('step2.tool.rotate90Hint')}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '0.82rem', color: TEXT_FAINTEST, textAlign: 'center', paddingTop: '0.75rem' }}>
              {t('step2.tool.clickToSelectIt')}
            </div>
          )
        )}

        {/* Delete tool */}
        {activeTool === 'delete' && (
          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: '700', color: '#c62828', marginBottom: '0.35rem' }}>{t('step2.tool.cutDelete')}</div>
            <div style={{ fontSize: '0.78rem', color: TEXT_PLACEHOLDER, lineHeight: '1.5' }}>
              {t('step2.tool.deleteHint')}
            </div>
          </div>
        )}

        {/* Add tool */}
        {activeTool === 'add' && (
          <div>
            <button
              onClick={() => { setAddError(null); setPendingAddNextTo(p => !p) }}
              style={{ width: '100%', padding: '0.5rem', marginBottom: '0.4rem', background: pendingAddNextTo ? PRIMARY : 'white', color: pendingAddNextTo ? TEXT : TEXT_SECONDARY, border: `2px solid ${pendingAddNextTo ? PRIMARY : BORDER}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '0.82rem' }}
            >
              {t('step2.tool.addNext')}
            </button>
            {pendingAddNextTo && (
              <div style={{ fontSize: '0.72rem', color: TEXT_PLACEHOLDER, textAlign: 'center', marginBottom: '0.4rem' }}>
                {t('step2.tool.addNextHint')}
              </div>
            )}
            {addError && (
              <div style={{ fontSize: '0.72rem', color: ERROR_DARK, background: ERROR_BG, border: `1px solid ${ERROR}`, borderRadius: '5px', padding: '0.3rem 0.5rem', marginBottom: '0.4rem', textAlign: 'center' }}>
                {addError}
              </div>
            )}
            <button
              onClick={() => { setAddError(null); addManualPanel() }}
              style={{ width: '100%', padding: '0.5rem', background: 'white', color: TEXT_SECONDARY, border: `1px solid ${BORDER}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.82rem' }}
            >
              {t('step2.tool.addStandalone')}
            </button>
          </div>
        )}

        {/* Measure tool */}
        {activeTool === 'measure' && (
          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: '700', color: BLUE, marginBottom: '0.35rem' }}>📏 {t('step2.tool.measureDistance')}</div>
            <div style={{ fontSize: '0.78rem', color: TEXT_PLACEHOLDER, lineHeight: '1.5', marginBottom: '0.5rem' }}>
              {t('step2.tool.measureHint')}
            </div>
            {distanceMeasurement?.p2 && (
              <button
                onClick={() => setDistanceMeasurement(null)}
                style={{ width: '100%', padding: '0.4rem', background: 'white', color: '#2196F3', border: `1px solid ${BLUE_BORDER}`, borderRadius: '5px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '600' }}
              >
                {t('step2.tool.clearMeasurement')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Per-trapezoid config editor */}
      {selectedRow && activeTool !== 'measure' && (
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
        />
      )}

      {/* Clear ruler (always visible when measurement exists) */}
      {distanceMeasurement?.p2 && (
        <button
          onClick={() => setDistanceMeasurement(null)}
          style={{ width: '100%', padding: '0.5rem', marginBottom: '0.5rem', background: BLUE_BG, color: BLUE, border: `1px solid ${BLUE_BORDER}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.78rem' }}
        >
          {t('step2.tool.clearRuler')}
        </button>
      )}

      </>}
    </div>
  )
}
