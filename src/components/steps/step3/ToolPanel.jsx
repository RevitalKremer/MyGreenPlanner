import { useState } from 'react'
import { PRIMARY, TEXT, TEXT_SECONDARY, TEXT_VERY_LIGHT, TEXT_PLACEHOLDER, TEXT_FAINTEST, BORDER_LIGHT, BORDER_FAINT, BORDER, BORDER_MID, BG_SUBTLE, BG_FAINT, BG_MID, BLUE, BLUE_BG, BLUE_BORDER, WARNING_DARK } from '../../../styles/colors'
import TrapezoidConfigEditor from './TrapezoidConfigEditor'

const NUDGE_PX = 5

export default function ToolPanel({
  activeTool, handleToolChange,
  selectedPanels, selectedAreaLabel, selectedRowAngle,
  nudgeRow, rotateSelectedRow, addPanelToRow, addManualPanel,
  distanceMeasurement, setDistanceMeasurement,
  allAreaTrapIds, selectedTrapezoidId,
  reassignToTrapezoid, addTrapezoid,
  selectedRow, refinedArea, trapezoidConfigs, setTrapezoidConfigs,
  projectMode, areas, getAreaKey,
  updateTrapezoidConfig, resetTrapezoidConfig,
  showBaseline, setShowBaseline,
  showHGridlines, setShowHGridlines,
  showVGridlines, setShowVGridlines,
  snapToGridlines, setSnapToGridlines,
}) {
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

  const rotBtnStyle = {
    flex: 1, padding: '0.35rem 0.1rem', background: 'white', color: TEXT_SECONDARY,
    border: `1px solid ${BORDER}`, borderRadius: '5px', cursor: 'pointer',
    fontWeight: '600', fontSize: '0.68rem', textAlign: 'center',
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
          Tool
        </div>
        <div style={{ display: 'flex', gap: '0.3rem' }}>
          <button style={toolBtnStyle('move')} onClick={() => handleToolChange('move')} title="Move row">
            <span>✥</span>{toolLabel('Move')}
          </button>
          <button style={toolBtnStyle('rotate')} onClick={() => handleToolChange('rotate')} title="Rotate row">
            <span>↻</span>{toolLabel('Rotate')}
          </button>
          <button style={toolBtnStyle('delete')} onClick={() => handleToolChange('delete')} title="Delete panel">
            <span>✂</span>{toolLabel('Delete')}
          </button>
          <button style={toolBtnStyle('add')} onClick={() => handleToolChange('add')} title="Add panel">
            <span>＋</span>{toolLabel('Add')}
          </button>
          <button style={toolBtnStyle('measure')} onClick={() => handleToolChange('measure')} title="Measure distance">
            <span style={{ fontSize: '0.85rem' }}>📏</span>{toolLabel('Ruler')}
          </button>
        </div>
      </div>

      {/* Gridlines + Snap */}
      <div style={{ marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        <div style={{ display: 'flex', gap: '0.3rem' }}>
          <button
            onClick={() => setShowHGridlines(!showHGridlines)}
            style={{ flex: 1, padding: '0.4rem 0.2rem', background: showHGridlines ? '#F3F9E6' : 'white', color: showHGridlines ? '#5a7a00' : TEXT_VERY_LIGHT, border: `1px solid ${showHGridlines ? PRIMARY : BORDER}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.72rem' }}
          >⊟ H-Grid</button>
          <button
            onClick={() => setShowVGridlines(!showVGridlines)}
            style={{ flex: 1, padding: '0.4rem 0.2rem', background: showVGridlines ? '#F3F9E6' : 'white', color: showVGridlines ? '#5a7a00' : TEXT_VERY_LIGHT, border: `1px solid ${showVGridlines ? PRIMARY : BORDER}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.72rem' }}
          >⊞ V-Grid</button>
          <button
            onClick={() => setSnapToGridlines(!snapToGridlines)}
            style={{ flex: 1, padding: '0.4rem 0.2rem', background: snapToGridlines ? '#e8f0ff' : 'white', color: snapToGridlines ? '#1a4fd6' : '#aaa', border: `1px solid ${snapToGridlines ? '#7baaf7' : '#ddd'}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.72rem' }}
          >⌖ Snap</button>
        </div>
      </div>

      {/* Context panel */}
      <div style={{ minHeight: '90px', marginBottom: '1rem', padding: '0.75rem', background: BG_FAINT, borderRadius: '8px', border: `1px solid ${BG_MID}` }}>

        {/* Move tool */}
        {activeTool === 'move' && (
          selectedPanels.length > 0 ? (
            <div>
              <div style={{ fontSize: '0.82rem', fontWeight: '700', color: TEXT, marginBottom: '0.6rem' }}>
                {selectedPanels.length} panel{selectedPanels.length !== 1 ? 's' : ''} selected
                <span style={{ fontWeight: '400', color: TEXT_PLACEHOLDER, fontSize: '0.75rem' }}> — drag to move</span>
              </div>
              <div style={{ fontSize: '0.7rem', color: TEXT_VERY_LIGHT, marginBottom: '0.35rem' }}>Fine adjust</div>
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
                or drag on canvas
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '0.8rem', color: TEXT_FAINTEST, textAlign: 'center', paddingTop: '0.5rem', lineHeight: 1.6 }}>
              <div>Click a panel to select</div>
              <div style={{ fontSize: '0.7rem' }}>Drag empty area to box-select</div>
              <div style={{ fontSize: '0.7rem' }}>Shift+click to add/remove</div>
              <div style={{ marginTop: '0.5rem', fontSize: '0.68rem', color: BORDER_MID, borderTop: `1px solid ${BG_MID}`, paddingTop: '0.4rem' }}>
                Hold <kbd style={{ background: BG_MID, border: `1px solid ${BORDER}`, borderRadius: '3px', padding: '0 4px', fontSize: '0.65rem', color: '#666' }}>Space</kbd> + drag to pan · Middle-click drag to pan
              </div>
            </div>
          )
        )}

        {/* Rotate tool */}
        {activeTool === 'rotate' && (
          selectedPanels.length > 0 ? (
            <div>
              <div style={{ fontSize: '0.82rem', fontWeight: '700', color: TEXT, marginBottom: '0.4rem' }}>
                {selectedAreaLabel}
                <span style={{ fontWeight: '400', color: TEXT_PLACEHOLDER }}> · {selectedPanels.length} panels</span>
              </div>
              <div style={{ fontSize: '0.72rem', color: TEXT_PLACEHOLDER, marginBottom: '0.5rem' }}>
                Angle: <strong style={{ color: TEXT_SECONDARY }}>{selectedRowAngle.toFixed(1)}°</strong>
              </div>
              <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.3rem' }}>
                <button onClick={() => rotateSelectedRow(-5)} style={rotBtnStyle}>◁◁ 5°</button>
                <button onClick={() => rotateSelectedRow(-1)} style={rotBtnStyle}>◁ 1°</button>
                <button onClick={() => rotateSelectedRow(1)} style={rotBtnStyle}>1° ▷</button>
                <button onClick={() => rotateSelectedRow(5)} style={rotBtnStyle}>5° ▷▷</button>
              </div>
              <div style={{ fontSize: '0.68rem', color: TEXT_FAINTEST, textAlign: 'center' }}>or drag on canvas</div>
            </div>
          ) : (
            <div style={{ fontSize: '0.82rem', color: TEXT_FAINTEST, textAlign: 'center', paddingTop: '0.75rem' }}>
              Click an area to select it
            </div>
          )
        )}

        {/* Delete tool */}
        {activeTool === 'delete' && (
          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: '700', color: '#c62828', marginBottom: '0.35rem' }}>✂ Delete Panel</div>
            <div style={{ fontSize: '0.78rem', color: TEXT_PLACEHOLDER, lineHeight: '1.5' }}>
              Click any panel to remove it. The row splits automatically if needed.
            </div>
          </div>
        )}

        {/* Add tool */}
        {activeTool === 'add' && (
          selectedPanels.length > 0 ? (
            <div>
              <div style={{ fontSize: '0.82rem', fontWeight: '700', color: TEXT, marginBottom: '0.6rem' }}>
                {selectedAreaLabel}
                <span style={{ fontWeight: '400', color: TEXT_PLACEHOLDER }}> · {selectedPanels.length} panels</span>
              </div>
              <button
                onClick={addPanelToRow}
                style={{ width: '100%', padding: '0.5rem', marginBottom: '0.4rem', background: PRIMARY, color: TEXT, border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '0.82rem' }}
              >
                ＋ Add to {selectedAreaLabel || '?'}
              </button>
              <button
                onClick={addManualPanel}
                style={{ width: '100%', padding: '0.4rem', background: 'white', color: TEXT_PLACEHOLDER, border: `1px solid ${BORDER}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.75rem' }}
              >
                ＋ Add Standalone
              </button>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: '0.78rem', color: TEXT_VERY_LIGHT, marginBottom: '0.6rem' }}>Select a row first, or:</div>
              <button
                onClick={addManualPanel}
                style={{ width: '100%', padding: '0.55rem', background: PRIMARY, color: TEXT, border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '0.82rem' }}
              >
                ＋ Add Standalone Panel
              </button>
            </div>
          )
        )}

        {/* Measure tool */}
        {activeTool === 'measure' && (
          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: '700', color: BLUE, marginBottom: '0.35rem' }}>📏 Measure Distance</div>
            <div style={{ fontSize: '0.78rem', color: TEXT_PLACEHOLDER, lineHeight: '1.5', marginBottom: '0.5rem' }}>
              Click two points on the canvas to measure.
            </div>
            {distanceMeasurement?.p2 && (
              <button
                onClick={() => setDistanceMeasurement(null)}
                style={{ width: '100%', padding: '0.4rem', background: 'white', color: '#2196F3', border: `1px solid ${BLUE_BORDER}`, borderRadius: '5px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '600' }}
              >
                🗑️ Clear Measurement
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
          setTrapezoidConfigs={setTrapezoidConfigs}
          projectMode={projectMode}
          areas={areas}
          getAreaKey={getAreaKey}
          updateTrapezoidConfig={updateTrapezoidConfig}
          resetTrapezoidConfig={resetTrapezoidConfig}
          selectedAreaTrapIds={allAreaTrapIds}
          reassignToTrapezoid={reassignToTrapezoid}
          addTrapezoid={addTrapezoid}
        />
      )}

      {/* Clear ruler (always visible when measurement exists) */}
      {distanceMeasurement?.p2 && (
        <button
          onClick={() => setDistanceMeasurement(null)}
          style={{ width: '100%', padding: '0.5rem', marginBottom: '0.5rem', background: BLUE_BG, color: BLUE, border: `1px solid ${BLUE_BORDER}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.78rem' }}
        >
          🗑️ Clear Ruler
        </button>
      )}

      {/* Baseline toggle */}
      <button
        onClick={() => setShowBaseline(!showBaseline)}
        style={{ width: '100%', padding: '0.5rem', background: showBaseline ? '#FFF8E1' : 'white', color: showBaseline ? WARNING_DARK : TEXT_VERY_LIGHT, border: `1px solid ${showBaseline ? '#FFCC02' : BORDER}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.78rem' }}
      >
        {showBaseline ? '👁 Baseline visible' : '👁 Show Baseline'}
      </button>
      </>}
    </div>
  )
}
