import { ACCENT } from './constants'

const SECTIONS = [
  {
    tabKey: 'detail', label: 'Trapezoids',
    keys: ['railOffsetCm','connOffsetCm','panelLengthCm','blockHeightCm','blockWidthCm','connEdgeDistMm','connMinPortrait','connMinLandscape'],
    fields: [
      ['Rail Clamp Offset (cm)', 'railOffsetCm',    0.1, 0],
      ['Cross-Rail Offset (cm)', 'connOffsetCm',    0.5, 0],
      ['Panel Length (cm)',      'panelLengthCm',   0.1, 10],
      ['Block Height (cm)',      'blockHeightCm',   1,   1],
      ['Block Width (cm)',       'blockWidthCm',    1,   1],
      ['Rail Edge Dist (mm)',    'connEdgeDistMm',  5,   0],
      ['Min Rails Portrait',     'connMinPortrait', 1,   1],
      ['Min Rails Landscape',    'connMinLandscape',1,   1],
    ],
  },
  {
    tabKey: 'rails', label: 'Rails',
    keys: ['railOverhangCm','stockLengths'],
    fields: [
      ['Rail Overhang (cm)', 'railOverhangCm', 0.5, 0],
    ],
  },
  {
    tabKey: 'bases', label: 'Bases',
    keys: ['edgeOffsetMm','spacingMm','maxSpanCm'],
    fields: [
      ['Edge Offset (mm)',   'edgeOffsetMm', 10,  0],
      ['Base Spacing (mm)',  'spacingMm',    50, 100],
      ['Max Span (cm)',      'maxSpanCm',     5,  50],
    ],
  },
]

export default function Step4Sidebar({
  rowConstructions, rowKeys, areaTrapezoidMap, areaLabel,
  selectedRowIdx, setSelectedRowIdx,
  selectedTrapezoidId, setSelectedTrapezoidId, effectiveSelectedTrapId,
  trapezoidConfigs, panels,
  activeTab, setActiveTab,
  selectedRC, getSettings, updateSetting, applySection,
  highlightParam, setHighlightParam,
  areaSettings,
}) {
  const isOverride = (key) => !!(areaSettings[selectedRowIdx] && key in areaSettings[selectedRowIdx])

  const numInput = (key, step, min) => {
    const s = getSettings(selectedRowIdx)
    return (
      <input type="number" value={s[key]} step={step} min={min}
        onChange={e => updateSetting(selectedRowIdx, key, parseFloat(e.target.value) || 0)}
        onFocus={() => setHighlightParam(key)}
        onBlur={() => setHighlightParam(null)}
        style={{ width: '100%', padding: '0.22rem 0.4rem', boxSizing: 'border-box',
          border: `1px solid ${isOverride(key) ? '#FFB74D' : '#ddd'}`,
          borderRadius: '4px', fontSize: '0.78rem', fontWeight: isOverride(key) ? '700' : '400' }} />
    )
  }

  const field = (label, key, step, min) => {
    const isActive = highlightParam === key
    return (
      <div key={key} style={{ marginBottom: '0.45rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.65rem', color: isActive ? '#d97706' : '#888', fontWeight: isActive ? '700' : '400', marginBottom: '2px', transition: 'color 0.2s' }}>
          {isActive && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#FFB300', display: 'inline-block', flexShrink: 0, animation: 'hlPulse 0.75s ease-in-out infinite' }} />}
          {label}
        </div>
        {numInput(key, step, min)}
      </div>
    )
  }

  const applyBtn = (keys) => (
    <button onClick={() => applySection(selectedRowIdx, keys)}
      style={{ width: '100%', marginTop: '0.35rem', padding: '0.2rem',
        fontSize: '0.65rem', fontWeight: '600', color: '#888',
        background: '#f5f5f5', border: '1px solid #e0e0e0',
        borderRadius: '4px', cursor: 'pointer' }}>
      Apply to all rows
    </button>
  )

  return (
    <div style={{ width: '260px', flexShrink: 0, borderRight: '1px solid #e8e8e8', display: 'flex', flexDirection: 'column', overflowY: 'auto', background: '#fafafa' }}>
      <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e8e8e8' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Areas</div>
      </div>

      {/* Area / trapezoid hierarchy list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {rowConstructions.map((rc, i) => {
          const areaKey = rowKeys[i]
          const trapIds = areaTrapezoidMap[areaKey] || []
          const isAreaSelected = selectedRowIdx === i
          return (
            <div key={i}>
              <div
                onClick={() => { setSelectedRowIdx(i); setSelectedTrapezoidId(areaTrapezoidMap[areaKey]?.[0] ?? null) }}
                style={{ padding: '0.6rem 1rem', cursor: 'pointer', borderBottom: trapIds.length > 1 ? 'none' : '1px solid #f0f0f0', background: isAreaSelected ? '#f4f9e4' : 'transparent', borderLeft: `3px solid ${isAreaSelected ? ACCENT : 'transparent'}`, transition: 'all 0.12s' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.84rem', fontWeight: '700', color: isAreaSelected ? '#333' : '#555' }}>
                    {areaLabel(areaKey, i)}
                  </span>
                  <span style={{ fontSize: '0.72rem', fontWeight: '800', color: 'white', background: '#555', borderRadius: '4px', padding: '1px 6px' }}>
                    {rc.typeLetter}{rc.panelsPerSpan}
                  </span>
                </div>
                <div style={{ fontSize: '0.72rem', color: '#888', marginTop: '2px' }}>
                  {rc.panelCount} panels · {rc.angle}° · {rc.numTrapezoids} frames
                </div>
                <div style={{ fontSize: '0.72rem', color: '#888' }}>
                  Rail: {(rc.rowLength / 100).toFixed(2)} m
                </div>
              </div>

              {/* Trapezoid children */}
              {trapIds.length > 1 && isAreaSelected && (
                <div style={{ borderBottom: '1px solid #f0f0f0', background: '#f5f7f0' }}>
                  {trapIds.map(trapId => {
                    const isTrapSelected = effectiveSelectedTrapId === trapId
                    const count = panels.filter(p => (p.area ?? p.row) === areaKey && p.trapezoidId === trapId).length
                    return (
                      <div
                        key={trapId}
                        onClick={e => { e.stopPropagation(); setSelectedTrapezoidId(trapId) }}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 1rem 0.35rem 1.5rem', cursor: 'pointer', borderLeft: `3px solid ${isTrapSelected ? ACCENT : 'transparent'}`, background: isTrapSelected ? '#edf5d8' : 'transparent', transition: 'all 0.1s' }}
                      >
                        <span style={{ fontSize: '0.72rem', fontWeight: '700', color: isTrapSelected ? '#5a6600' : '#888', background: isTrapSelected ? '#ddeea0' : '#e8e8e8', padding: '1px 7px', borderRadius: '10px' }}>
                          {trapId}
                        </span>
                        <span style={{ fontSize: '0.7rem', color: '#aaa' }}>{count} panels</span>
                        {!!trapezoidConfigs[trapId] && (
                          <span title="Custom config" style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#FF9800', marginLeft: 'auto', flexShrink: 0 }} />
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

      {/* Settings sections (per-row, one per tab) */}
      {selectedRC && SECTIONS.map(sec => {
        const isOpen = activeTab === sec.tabKey
        const s = getSettings(selectedRowIdx)
        return (
          <div key={sec.tabKey} style={{ borderTop: '1px solid #e8e8e8' }}>
            <div
              onClick={() => setActiveTab(isOpen ? activeTab : sec.tabKey)}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 1rem', cursor: 'pointer', background: isOpen ? '#f0f4e8' : '#fafafa' }}
            >
              <span style={{ fontSize: '0.7rem', fontWeight: '700', color: isOpen ? '#5a6600' : '#888', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{sec.label}</span>
              <span style={{ fontSize: '0.8rem', color: '#aaa' }}>{isOpen ? '▲' : '▼'}</span>
            </div>
            {isOpen && (
              <div style={{ padding: '0.6rem 1rem 0.75rem' }}>
                {sec.fields.map(([lbl, key, step, min]) => field(lbl, key, step, min))}
                {sec.tabKey === 'rails' && (
                  <div style={{ marginBottom: '0.45rem' }}>
                    <div style={{ fontSize: '0.65rem', color: '#888', marginBottom: '2px' }}>Stock Lengths (mm)</div>
                    <input type="text"
                      value={(s.stockLengths || []).join(', ')}
                      onChange={e => updateSetting(selectedRowIdx, 'stockLengths',
                        e.target.value.split(',').map(v => parseInt(v.trim(), 10)).filter(n => n > 0))}
                      onFocus={() => setHighlightParam('stockLengths')}
                      onBlur={() => setHighlightParam(null)}
                      placeholder="e.g. 4800, 6000"
                      style={{ width: '100%', padding: '0.22rem 0.4rem', boxSizing: 'border-box',
                        border: `1px solid ${isOverride('stockLengths') ? '#FFB74D' : '#ddd'}`,
                        borderRadius: '4px', fontSize: '0.78rem' }} />
                  </div>
                )}
                {applyBtn(sec.keys)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
