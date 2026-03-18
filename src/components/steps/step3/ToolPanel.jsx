import { useState } from 'react'
import TrapezoidConfigEditor from './TrapezoidConfigEditor'

const NUDGE_PX = 5

export default function ToolPanel({
  activeTool, handleToolChange,
  selectedPanels, selectedAreaLabel, selectedRowAngle,
  nudgeRow, rotateSelectedRow, addPanelToRow, addManualPanel,
  distanceMeasurement, setDistanceMeasurement,
  allSelectedSameArea, selectedAreaTrapIds, selectedTrapezoidId,
  reassignToTrapezoid, addTrapezoid,
  selectedRow, refinedArea, trapezoidConfigs, setTrapezoidConfigs,
  projectMode, areas, getAreaKey,
  updateTrapezoidConfig, resetTrapezoidConfig,
  showBaseline, setShowBaseline,
}) {
  const [collapsed, setCollapsed] = useState(false)

  const toolBtnStyle = (tool) => ({
    flex: 1,
    padding: '0.45rem 0.15rem',
    background: activeTool === tool ? '#C4D600' : 'white',
    color: activeTool === tool ? '#333' : '#888',
    border: `2px solid ${activeTool === tool ? '#C4D600' : '#e8e8e8'}`,
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
    padding: '0.3rem', background: 'white', color: '#555',
    border: '1px solid #ddd', borderRadius: '5px', cursor: 'pointer',
    fontWeight: '700', fontSize: '0.85rem', textAlign: 'center', lineHeight: 1,
  }

  const rotBtnStyle = {
    flex: 1, padding: '0.35rem 0.1rem', background: 'white', color: '#555',
    border: '1px solid #ddd', borderRadius: '5px', cursor: 'pointer',
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
      border: '2px solid #C4D600',
    }}>
      <button onClick={() => setCollapsed(c => !c)} style={{ position: 'absolute', top: '6px', right: '6px', width: '22px', height: '22px', padding: 0, background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {collapsed ? '‹' : '›'}
      </button>
      {!collapsed && <>

      {/* Tool selector */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.7rem', fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.45rem' }}>
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

      {/* Context panel */}
      <div style={{ minHeight: '90px', marginBottom: '1rem', padding: '0.75rem', background: '#fafafa', borderRadius: '8px', border: '1px solid #f0f0f0' }}>

        {/* Move tool */}
        {activeTool === 'move' && (
          selectedPanels.length > 0 ? (
            <div>
              <div style={{ fontSize: '0.82rem', fontWeight: '700', color: '#333', marginBottom: '0.6rem' }}>
                {selectedPanels.length} panel{selectedPanels.length !== 1 ? 's' : ''} selected
                <span style={{ fontWeight: '400', color: '#888', fontSize: '0.75rem' }}> — drag to move</span>
              </div>
              <div style={{ fontSize: '0.7rem', color: '#aaa', marginBottom: '0.35rem' }}>Fine adjust</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 30px)', gap: '0.2rem', justifyContent: 'center' }}>
                <div />
                <button style={nudgeBtnStyle} onClick={() => nudgeRow(0, -NUDGE_PX)}>↑</button>
                <div />
                <button style={nudgeBtnStyle} onClick={() => nudgeRow(-NUDGE_PX, 0)}>←</button>
                <div style={{ ...nudgeBtnStyle, background: '#f0f0f0', cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#ccc', display: 'block' }} />
                </div>
                <button style={nudgeBtnStyle} onClick={() => nudgeRow(NUDGE_PX, 0)}>→</button>
                <div />
                <button style={nudgeBtnStyle} onClick={() => nudgeRow(0, NUDGE_PX)}>↓</button>
                <div />
              </div>
              <div style={{ fontSize: '0.68rem', color: '#bbb', textAlign: 'center', marginTop: '0.4rem' }}>
                or drag on canvas
              </div>
              {/* Trapezoid assignment */}
              {allSelectedSameArea && selectedAreaTrapIds.length > 0 && (
                <div style={{ marginTop: '0.65rem', borderTop: '1px solid #f0f0f0', paddingTop: '0.55rem' }}>
                  <div style={{ fontSize: '0.65rem', color: '#aaa', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
                    Trapezoid
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: '700', color: '#5a6600', background: '#e8f2b0', padding: '2px 8px', borderRadius: '10px' }}>{selectedTrapezoidId || '—'}</span>
                    {selectedAreaTrapIds.length > 1 && (
                      <select
                        value={selectedTrapezoidId || ''}
                        onChange={e => reassignToTrapezoid(e.target.value)}
                        style={{ flex: 1, padding: '0.2rem 0.3rem', fontSize: '0.72rem', border: '1px solid #ddd', borderRadius: '4px', background: 'white', cursor: 'pointer' }}
                      >
                        {selectedAreaTrapIds.map(tid => (
                          <option key={tid} value={tid}>{tid}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  <button
                    onClick={addTrapezoid}
                    style={{ width: '100%', padding: '0.35rem', background: '#f0f4e8', color: '#5a6600', border: '1px solid #C4D600', borderRadius: '5px', cursor: 'pointer', fontWeight: '700', fontSize: '0.75rem' }}
                  >
                    ＋ New Trapezoid for Selection
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: '0.8rem', color: '#bbb', textAlign: 'center', paddingTop: '0.5rem', lineHeight: 1.6 }}>
              <div>Click a panel to select</div>
              <div style={{ fontSize: '0.7rem' }}>Drag empty area to box-select</div>
              <div style={{ fontSize: '0.7rem' }}>Shift+click to add/remove</div>
              <div style={{ marginTop: '0.5rem', fontSize: '0.68rem', color: '#ccc', borderTop: '1px solid #f0f0f0', paddingTop: '0.4rem' }}>
                Hold <kbd style={{ background: '#f0f0f0', border: '1px solid #ddd', borderRadius: '3px', padding: '0 4px', fontSize: '0.65rem', color: '#666' }}>Space</kbd> + drag to pan · Middle-click drag to pan
              </div>
            </div>
          )
        )}

        {/* Rotate tool */}
        {activeTool === 'rotate' && (
          selectedPanels.length > 0 ? (
            <div>
              <div style={{ fontSize: '0.82rem', fontWeight: '700', color: '#333', marginBottom: '0.4rem' }}>
                {selectedAreaLabel}
                <span style={{ fontWeight: '400', color: '#888' }}> · {selectedPanels.length} panels</span>
              </div>
              <div style={{ fontSize: '0.72rem', color: '#888', marginBottom: '0.5rem' }}>
                Angle: <strong style={{ color: '#444' }}>{selectedRowAngle.toFixed(1)}°</strong>
              </div>
              <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.3rem' }}>
                <button onClick={() => rotateSelectedRow(-5)} style={rotBtnStyle}>◁◁ 5°</button>
                <button onClick={() => rotateSelectedRow(-1)} style={rotBtnStyle}>◁ 1°</button>
                <button onClick={() => rotateSelectedRow(1)} style={rotBtnStyle}>1° ▷</button>
                <button onClick={() => rotateSelectedRow(5)} style={rotBtnStyle}>5° ▷▷</button>
              </div>
              <div style={{ fontSize: '0.68rem', color: '#bbb', textAlign: 'center' }}>or drag on canvas</div>
            </div>
          ) : (
            <div style={{ fontSize: '0.82rem', color: '#bbb', textAlign: 'center', paddingTop: '0.75rem' }}>
              Click an area to select it
            </div>
          )
        )}

        {/* Delete tool */}
        {activeTool === 'delete' && (
          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: '700', color: '#c62828', marginBottom: '0.35rem' }}>✂ Delete Panel</div>
            <div style={{ fontSize: '0.78rem', color: '#888', lineHeight: '1.5' }}>
              Click any panel to remove it. The row splits automatically if needed.
            </div>
          </div>
        )}

        {/* Add tool */}
        {activeTool === 'add' && (
          selectedPanels.length > 0 ? (
            <div>
              <div style={{ fontSize: '0.82rem', fontWeight: '700', color: '#333', marginBottom: '0.6rem' }}>
                {selectedAreaLabel}
                <span style={{ fontWeight: '400', color: '#888' }}> · {selectedPanels.length} panels</span>
              </div>
              <button
                onClick={addPanelToRow}
                style={{ width: '100%', padding: '0.5rem', marginBottom: '0.4rem', background: '#C4D600', color: '#333', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '0.82rem' }}
              >
                ＋ Add to {selectedAreaLabel || '?'}
              </button>
              <button
                onClick={addManualPanel}
                style={{ width: '100%', padding: '0.4rem', background: 'white', color: '#888', border: '1px solid #ddd', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.75rem' }}
              >
                ＋ Add Standalone
              </button>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: '0.78rem', color: '#aaa', marginBottom: '0.6rem' }}>Select a row first, or:</div>
              <button
                onClick={addManualPanel}
                style={{ width: '100%', padding: '0.55rem', background: '#C4D600', color: '#333', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '0.82rem' }}
              >
                ＋ Add Standalone Panel
              </button>
            </div>
          )
        )}

        {/* Measure tool */}
        {activeTool === 'measure' && (
          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: '700', color: '#1565C0', marginBottom: '0.35rem' }}>📏 Measure Distance</div>
            <div style={{ fontSize: '0.78rem', color: '#888', lineHeight: '1.5', marginBottom: '0.5rem' }}>
              Click two points on the canvas to measure.
            </div>
            {distanceMeasurement?.p2 && (
              <button
                onClick={() => setDistanceMeasurement(null)}
                style={{ width: '100%', padding: '0.4rem', background: 'white', color: '#2196F3', border: '1px solid #90CAF9', borderRadius: '5px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '600' }}
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
        />
      )}

      {/* Clear ruler (always visible when measurement exists) */}
      {distanceMeasurement?.p2 && (
        <button
          onClick={() => setDistanceMeasurement(null)}
          style={{ width: '100%', padding: '0.5rem', marginBottom: '0.5rem', background: '#E3F2FD', color: '#1565C0', border: '1px solid #90CAF9', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.78rem' }}
        >
          🗑️ Clear Ruler
        </button>
      )}

      {/* Baseline toggle */}
      <button
        onClick={() => setShowBaseline(!showBaseline)}
        style={{ width: '100%', padding: '0.5rem', background: showBaseline ? '#FFF8E1' : 'white', color: showBaseline ? '#E65100' : '#aaa', border: `1px solid ${showBaseline ? '#FFCC02' : '#ddd'}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.78rem' }}
      >
        {showBaseline ? '👁 Baseline visible' : '👁 Show Baseline'}
      </button>
      </>}
    </div>
  )
}
