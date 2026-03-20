import { useState, useEffect, useRef } from 'react'
import { ACCENT, PARAM_SCHEMA, PARAM_GROUP } from './constants'

const fmt = (v) => parseFloat(v.toFixed(1)).toString()

// Number input that lets the user finish typing before clamping/committing.
// Commits on blur immediately, or after 500 ms of no changes.
function DebouncedNumberInput({ value, min, max, step, onCommit, onFocus, onBlur, style }) {
  const [raw, setRaw] = useState(String(value))
  const timerRef = useRef(null)
  const focusedRef = useRef(false)

  // Sync display when external value changes and input is not focused
  useEffect(() => {
    if (!focusedRef.current) setRaw(String(value))
  }, [value])

  const commit = (str) => {
    clearTimeout(timerRef.current)
    let v = parseFloat(str)
    if (isNaN(v)) v = value
    if (min != null) v = Math.max(min, v)
    if (max != null) v = Math.min(max, v)
    setRaw(String(v))
    onCommit(v)
  }

  return (
    <input
      type="number"
      value={raw}
      step={step ?? 1}
      style={style}
      onFocus={() => { focusedRef.current = true; onFocus?.() }}
      onChange={(e) => {
        setRaw(e.target.value)
        clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => commit(e.target.value), 500)
      }}
      onBlur={(e) => { focusedRef.current = false; commit(e.target.value); onBlur?.() }}
    />
  )
}

// Small "?" bubble that shows default / min / max on hover
function InfoTooltip({ param }) {
  const [show, setShow] = useState(false)
  const lines = []
  if (param.default != null) {
    const d = Array.isArray(param.default) ? param.default.join(', ') : String(param.default)
    lines.push(`Default: ${d}`)
  }
  if (param.min != null) lines.push(`Min: ${param.min}`)
  if (param.max != null) lines.push(`Max: ${param.max}`)
  if (lines.length === 0) return null
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
      <span
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        style={{
          width: '12px', height: '12px', borderRadius: '50%',
          background: '#e0e0e0', color: '#777',
          fontSize: '0.5rem', fontWeight: '700',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'default', lineHeight: 1,
        }}
      >?</span>
      {show && (
        <div style={{
          position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)',
          background: '#333', color: '#fff',
          fontSize: '0.6rem', lineHeight: 1.6,
          padding: '4px 8px', borderRadius: '4px',
          whiteSpace: 'nowrap', zIndex: 200,
          pointerEvents: 'none',
          boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        }}>
          {lines.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
    </span>
  )
}

const SECTIONS = [
  { tabKey: 'rails',  label: 'Rails' },
  { tabKey: 'bases',  label: 'Bases' },
  { tabKey: 'detail', label: 'Trapezoids' },
]

export default function Step4Sidebar({
  rowConstructions, rowKeys, areaTrapezoidMap, areaLabel,
  selectedRowIdx, setSelectedRowIdx,
  setSelectedTrapezoidId, effectiveSelectedTrapId,
  trapezoidConfigs, panels,
  activeTab, setActiveTab,
  selectedRC, getSettings, updateSetting, applySection,
  highlightParam, setHighlightParam,
  areaSettings,
  globalSettings,
  updateGlobalSetting,
  derivedRailSpacings,
  lineOrientations,
  panelDepthsCm,
  onRailSpacingChange,
  onApplyRailsToAllAreas,
  getTrapBasesSettings,
  updateTrapBaseSetting,
  applyBasesToAll,
}) {
  const [settingsCollapsed, setSettingsCollapsed] = useState(false)

  const isOverride = (key) => !!(areaSettings[selectedRowIdx] && key in areaSettings[selectedRowIdx])

  // ── renderParam: schema-driven input renderer ─────────────────────────────
  const renderParam = (param) => {
    const { key, label, type, scope, orientation, min, max, step, highlightGroup } = param
    const hlKey    = highlightGroup ?? key
    const isActive = PARAM_GROUP[highlightParam] === hlKey

    const labelNode = (
      <div style={{
        display: 'flex', alignItems: 'center', gap: '5px',
        fontSize: '0.65rem',
        color: isActive ? '#d97706' : '#888',
        fontWeight: isActive ? '700' : '400',
        marginBottom: '2px', transition: 'color 0.2s',
      }}>
        {isActive && (
          <span style={{
            width: '6px', height: '6px', borderRadius: '50%',
            background: '#FFB300', display: 'inline-block',
            flexShrink: 0, animation: 'hlPulse 0.75s ease-in-out infinite',
          }} />
        )}
        {label}
        <InfoTooltip param={param} />
        {scope === 'global' && (
          <span style={{ marginLeft: 'auto', fontSize: '0.55rem', color: '#b0b0b0', fontWeight: '600', letterSpacing: '0.04em' }}>
            GLOBAL
          </span>
        )}
      </div>
    )

    const baseInputStyle = {
      width: '100%', padding: '0.22rem 0.4rem',
      boxSizing: 'border-box', borderRadius: '4px', fontSize: '0.78rem',
    }

    // ── rail-spacing: derived from lineRails, written via onRailSpacingChange
    if (type === 'rail-spacing') {
      const isH = orientation === 'horizontal'
      const hasLine = isH
        ? lineOrientations?.some(o => o === 'horizontal')
        : lineOrientations?.some(o => o !== 'horizontal' && o !== 'empty')
      if (!hasLine) return null

      const panelDepth = panelDepthsCm?.find((_, i) => {
        const o = lineOrientations?.[i]
        return isH ? o === 'horizontal' : (o !== 'horizontal' && o !== 'empty')
      }) ?? (isH ? 113.4 : 238.2)
      const maxVal = Math.round(0.9 * panelDepth)
      const value  = (isH ? derivedRailSpacings?.horizontal : derivedRailSpacings?.vertical) ?? param.default

      return (
        <div key={key} style={{ marginBottom: '0.45rem' }}>
          {labelNode}
          <input type="number" value={value} step={1} min={min} max={maxVal}
            onChange={e => onRailSpacingChange(orientation, Math.min(maxVal, Math.max(min, parseFloat(e.target.value) || min)))}
            onFocus={() => setHighlightParam(key)}
            onBlur={() => setHighlightParam(null)}
            style={{ ...baseInputStyle, border: `1px solid ${isActive ? '#FFB300' : '#ddd'}` }} />
        </div>
      )
    }

    // ── boolean: toggle switch
    if (type === 'boolean') {
      const s   = getSettings(selectedRowIdx)
      const val = s[key] ?? param.default
      return (
        <div key={key} style={{ marginBottom: '0.45rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.65rem', color: '#888', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>{label}<InfoTooltip param={param} /></span>
          <label style={{ position: 'relative', display: 'inline-block', width: '32px', height: '18px', cursor: 'pointer' }}>
            <input type="checkbox" checked={val}
              onChange={e => updateSetting(selectedRowIdx, key, e.target.checked)}
              style={{ opacity: 0, width: 0, height: 0 }} />
            <span style={{ position: 'absolute', inset: 0, borderRadius: '18px', transition: '0.2s', background: val ? ACCENT : '#ccc' }} />
            <span style={{ position: 'absolute', top: '2px', left: val ? '16px' : '2px', width: '14px', height: '14px', borderRadius: '50%', background: 'white', transition: '0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
          </label>
        </div>
      )
    }

    // ── array: comma-separated text input (always global in current schema)
    if (type === 'array') {
      const val = globalSettings?.[key] ?? param.default
      return (
        <div key={key} style={{ marginBottom: '0.45rem' }}>
          {labelNode}
          <input type="text"
            value={(val || []).join(', ')}
            onChange={e => updateGlobalSetting(key,
              e.target.value.split(',').map(v => parseInt(v.trim(), 10)).filter(n => n > 0))}
            onFocus={() => setHighlightParam(key)}
            onBlur={() => setHighlightParam(null)}
            placeholder="e.g. 4800, 6000"
            style={{ ...baseInputStyle, border: `1px solid ${isActive ? '#FFB300' : '#ddd'}` }} />
        </div>
      )
    }

    // ── number · global
    if (scope === 'global') {
      const val = globalSettings?.[key] ?? param.default
      return (
        <div key={key} style={{ marginBottom: '0.45rem' }}>
          {labelNode}
          <DebouncedNumberInput
            value={val} min={min} max={max} step={step}
            onCommit={v => updateGlobalSetting(key, v)}
            onFocus={() => setHighlightParam(key)}
            onBlur={() => setHighlightParam(null)}
            style={{ ...baseInputStyle, border: `1px solid ${isActive ? '#FFB300' : '#ddd'}` }} />
        </div>
      )
    }

    // ── number · trapezoid (per-subarea bases settings)
    if (scope === 'trapezoid') {
      const trapSettings = getTrapBasesSettings?.(effectiveSelectedTrapId) ?? {}
      const val = trapSettings[key] ?? param.default
      const overridden = !!(effectiveSelectedTrapId && trapezoidConfigs[effectiveSelectedTrapId] && key in trapezoidConfigs[effectiveSelectedTrapId])
      return (
        <div key={key} style={{ marginBottom: '0.45rem' }}>
          {labelNode}
          <DebouncedNumberInput
            value={val} min={min} max={max} step={step}
            onCommit={v => updateTrapBaseSetting?.(effectiveSelectedTrapId, key, v)}
            onFocus={() => setHighlightParam(key)}
            onBlur={() => setHighlightParam(null)}
            style={{
              ...baseInputStyle,
              border: `1px solid ${isActive ? '#FFB300' : overridden ? '#FFB74D' : '#ddd'}`,
              fontWeight: overridden ? '700' : '400',
            }} />
        </div>
      )
    }

    // ── number · area (default)
    const s          = getSettings(selectedRowIdx)
    const overridden = isOverride(key)
    return (
      <div key={key} style={{ marginBottom: '0.45rem' }}>
        {labelNode}
        <DebouncedNumberInput
          value={s[key] ?? param.default} min={min} max={max} step={step}
          onCommit={v => updateSetting(selectedRowIdx, key, v)}
          onFocus={() => setHighlightParam(key)}
          onBlur={() => setHighlightParam(null)}
          style={{
            ...baseInputStyle,
            border: `1px solid ${isActive ? '#FFB300' : overridden ? '#FFB74D' : '#ddd'}`,
            fontWeight: overridden ? '700' : '400',
          }} />
      </div>
    )
  }

  // ── Apply button ───────────────────────────────────────────────────────────
  const applyBtn = (onClick) => (
    <button onClick={onClick}
      style={{
        width: '100%', marginTop: '0.35rem', padding: '0.2rem',
        fontSize: '0.65rem', fontWeight: '600', color: '#888',
        background: '#f5f5f5', border: '1px solid #e0e0e0',
        borderRadius: '4px', cursor: 'pointer',
      }}>
      Apply to all areas
    </button>
  )

  // ── Render ────────────────────────────────────────────────────────────────
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
                  Rail: {fmt(rc.rowLength / 100)} m
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

      {/* Settings collapse toggle */}
      {selectedRC && (
        <div
          onClick={() => setSettingsCollapsed(c => !c)}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.35rem 1rem', cursor: 'pointer', borderTop: '1px solid #e8e8e8', background: '#f5f5f5' }}
        >
          <span style={{ fontSize: '0.62rem', fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Settings</span>
          <span style={{ fontSize: '0.7rem', color: '#bbb' }}>{settingsCollapsed ? '▲' : '▼'}</span>
        </div>
      )}

      {/* Settings sections — fully schema-driven */}
      {selectedRC && !settingsCollapsed && SECTIONS.map(sec => {
        const isOpen     = activeTab === sec.tabKey
        const areaParams = PARAM_SCHEMA.filter(p => p.section === sec.tabKey && p.scope === 'area')
        const globalParams = PARAM_SCHEMA.filter(p => p.section === sec.tabKey && p.scope === 'global')
        const areaKeys   = areaParams.filter(p => p.type !== 'rail-spacing').map(p => p.key)

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
                {/* Per-area params */}
                {areaParams.map(p => renderParam(p))}
                {/* Apply button */}
                {applyBtn(
                  sec.tabKey === 'rails'  ? onApplyRailsToAllAreas :
                  sec.tabKey === 'bases'  ? applyBasesToAll :
                  () => applySection(selectedRowIdx, areaKeys)
                )}
                {/* Global params — rendered after the apply button */}
                {globalParams.length > 0 && (
                  <div style={{ marginTop: '0.5rem' }}>
                    {globalParams.map(p => renderParam(p))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
