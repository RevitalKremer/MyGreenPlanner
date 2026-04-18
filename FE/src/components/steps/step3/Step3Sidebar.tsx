import { useState, useEffect, useRef } from 'react'
import { TEXT, TEXT_SECONDARY, TEXT_LIGHT, TEXT_VERY_LIGHT, TEXT_PLACEHOLDER, TEXT_FAINTEST, BORDER_LIGHT, BORDER_FAINT, BORDER, BG_SUBTLE, BG_FAINT, BG_MID, PRIMARY, PRIMARY_DARK, PRIMARY_BG_ALT, PRIMARY_BG_LIGHT, AMBER, WARNING_LIGHT, WARNING, BORDER_MID, WHITE, TAB_ACTIVE_COLOR, ROW_SELECTED_BG, TRAP_BADGE_BG, SECTION_HEADER_BG } from '../../../styles/colors'
import { isEmptyOrientation } from '../../../utils/trapezoidGeometry'
import { PANEL_H } from '../../../utils/panelCodes.js'
import { useLang } from '../../../i18n/LangContext'

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

function DebouncedArrayInput({ value, onCommit, onFocus, onBlur, placeholder, style }) {
  const [raw, setRaw] = useState((value || []).join(', '))
  const timerRef = useRef(null)
  const focusedRef = useRef(false)

  useEffect(() => {
    if (!focusedRef.current) setRaw((value || []).join(', '))
  }, [value])

  const commit = (str) => {
    clearTimeout(timerRef.current)
    const parsed = str.split(',').map(v => parseInt(v.trim(), 10)).filter(n => n > 0)
    onCommit(parsed)
  }

  return (
    <input type="text" value={raw} placeholder={placeholder} style={style}
      onFocus={() => { focusedRef.current = true; onFocus?.() }}
      onChange={e => { setRaw(e.target.value); clearTimeout(timerRef.current); timerRef.current = setTimeout(() => commit(e.target.value), 500) }}
      onBlur={e => { focusedRef.current = false; commit(e.target.value); onBlur?.() }}
    />
  )
}

// Small "?" bubble that shows default / min / max on hover
function InfoTooltip({ param }) {
  const [show, setShow] = useState(false)
  const lines = []
  const { t } = useLang()
  if (param.default != null) {
    const d = Array.isArray(param.default) ? param.default.join(', ') : String(param.default)
    lines.push(`${t('step3.sidebar.default')}${d}`)
  }
  if (param.min != null) lines.push(`${t('step3.sidebar.min')}${param.min}`)
  if (param.max != null) lines.push(`${t('step3.sidebar.max')}${param.max}`)
  if (lines.length === 0) return null
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
      <span
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        style={{
          width: '12px', height: '12px', borderRadius: '50%',
          background: BORDER_LIGHT, color: TEXT_LIGHT,
          fontSize: '0.5rem', fontWeight: '700',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'default', lineHeight: 1,
        }}
      >?</span>
      {show && (
        <div style={{
          position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)',
          background: TEXT, color: WHITE,
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

// SECTIONS labels are resolved via t() at render time below
const SECTIONS = [
  { tabKey: 'rails',  labelKey: 'step3.sidebar.rails' },
  { tabKey: 'bases',  labelKey: 'step3.sidebar.bases' },
  { tabKey: 'detail', labelKey: 'step3.sidebar.trapezoids' },
]

export default function Step3Sidebar({
  rowConstructions, rowKeys, areaTrapezoidMap, areaLabel,
  selectedRowIdx, setSelectedRowIdx,
  selectedPanelRowIdx, setSelectedPanelRowIdx,
  selectedTrapezoidId = null, setSelectedTrapezoidId, effectiveSelectedTrapId,
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
  paramSchema: PARAM_SCHEMA = [],
  paramGroup: PARAM_GROUP = {},
  onApplyChanges,
}) {
  const { t } = useLang()
  const [settingsCollapsed, setSettingsCollapsed] = useState(false)

  const isOverride = (key) => !!(areaSettings[selectedRowIdx] && key in areaSettings[selectedRowIdx])

  // ── renderParam: schema-driven input renderer ─────────────────────────────
  const renderParam = (param) => {
    // Skip parameters marked as not visible (admin-only)
    if (param.visible === false) return null

    const { key, label, type, scope, orientation, min, max, step, highlightGroup } = param
    const hlKey    = highlightGroup ?? key
    const isActive = PARAM_GROUP[highlightParam] === hlKey

    // Use translated label - t() returns the key if translation not found, so we use label as final fallback
    const translationKey = `step3.param.${key}`
    const translatedLabel = t(translationKey)
    const displayLabel = translatedLabel === translationKey ? label : translatedLabel

    const labelNode = (
      <div style={{
        display: 'flex', alignItems: 'center', gap: '5px',
        fontSize: '0.65rem',
        color: isActive ? TAB_ACTIVE_COLOR : TEXT_PLACEHOLDER,
        fontWeight: isActive ? '700' : '400',
        marginBottom: '2px', transition: 'color 0.2s',
      }}>
        {isActive && (
          <span style={{
            width: '6px', height: '6px', borderRadius: '50%',
            background: AMBER, display: 'inline-block',
            flexShrink: 0, animation: 'hlPulse 0.75s ease-in-out infinite',
          }} />
        )}
        {displayLabel}
        <InfoTooltip param={param} />
        {scope === 'global' && (
          <span style={{ marginLeft: 'auto', fontSize: '0.55rem', color: TEXT_FAINTEST, fontWeight: '600', letterSpacing: '0.04em' }}>
            {t('step3.sidebar.global')}
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
      const isH = orientation === PANEL_H

      const s = getSettings(selectedRowIdx)
      const panelDepth = panelDepthsCm?.find((_, i) => {
        const o = lineOrientations?.[i]
        return isH ? o === PANEL_H : (o !== PANEL_H && !isEmptyOrientation(o))
      }) ?? (isH ? s.panelWidthCm : s.panelLengthCm)
      const maxVal = Math.round(0.9 * panelDepth)
      const value  = (isH ? derivedRailSpacings?.horizontal : derivedRailSpacings?.vertical) ?? param.default

      return (
        <div key={key} style={{ marginBottom: '0.45rem' }}>
          {labelNode}
          <DebouncedNumberInput
            value={value} step={1} min={min} max={maxVal}
            onCommit={v => onRailSpacingChange(orientation, v)}
            onFocus={() => setHighlightParam(key)}
            onBlur={() => setHighlightParam(null)}
            style={{ ...baseInputStyle, border: `1px solid ${isActive ? AMBER : BORDER}` }} />
        </div>
      )
    }

    // ── boolean: toggle switch
    if (type === 'boolean') {
      const val = scope === 'global'
        ? (globalSettings?.[key] ?? param.default)
        : scope === 'trapezoid'
        ? (getTrapBasesSettings?.(effectiveSelectedTrapId)?.[key] ?? param.default)
        : (getSettings(selectedRowIdx)[key] ?? param.default)
      const onToggle = scope === 'global'
        ? (v) => updateGlobalSetting(key, v)
        : scope === 'trapezoid'
        ? (v) => updateTrapBaseSetting?.(effectiveSelectedTrapId, key, v)
        : (v) => updateSetting(selectedRowIdx, key, v)
      return (
        <div key={key} style={{ marginBottom: '0.45rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.65rem', color: TEXT_PLACEHOLDER, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            {label}<InfoTooltip param={param} />
            {scope === 'global' && (
              <span style={{ fontSize: '0.55rem', color: TEXT_FAINTEST, fontWeight: '600', letterSpacing: '0.04em' }}>
                {t('step3.sidebar.global')}
              </span>
            )}
          </span>
          <label style={{ position: 'relative', display: 'inline-block', width: '32px', height: '18px', cursor: 'pointer' }}>
            <input type="checkbox" checked={val}
              onChange={e => onToggle(e.target.checked)}
              style={{ opacity: 0, width: 0, height: 0 }} />
            <span style={{ position: 'absolute', inset: 0, borderRadius: '18px', transition: '0.2s', background: val ? PRIMARY : BORDER_MID }} />
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
          <DebouncedArrayInput
            value={val}
            onCommit={v => updateGlobalSetting(key, v)}
            onFocus={() => setHighlightParam(key)}
            onBlur={() => setHighlightParam(null)}
            placeholder={t('step3.sidebar.stockLengthsPlaceholder')}
            style={{ ...baseInputStyle, border: `1px solid ${isActive ? AMBER : BORDER}` }} />
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
            style={{ ...baseInputStyle, border: `1px solid ${isActive ? AMBER : BORDER}` }} />
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
              border: `1px solid ${isActive ? AMBER : overridden ? WARNING_LIGHT : BORDER}`,
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
            border: `1px solid ${isActive ? AMBER : overridden ? WARNING_LIGHT : BORDER}`,
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
        fontSize: '0.65rem', fontWeight: '600', color: TEXT_PLACEHOLDER,
        background: BG_SUBTLE, border: `1px solid ${BORDER_LIGHT}`,
        borderRadius: '4px', cursor: 'pointer',
      }}>
      {t('step3.sidebar.applyToAll')}
    </button>
  )

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ width: '260px', flexShrink: 0, borderRight: `1px solid ${BORDER_FAINT}`, display: 'flex', flexDirection: 'column', overflowY: 'auto', background: BG_FAINT }}>
      <div style={{ padding: '0.75rem 1rem', borderBottom: `1px solid ${BORDER_FAINT}` }}>
        <div style={{ fontSize: '0.65rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('step3.sidebar.areas')}</div>
      </div>

      {/* Area / trapezoid hierarchy list — sorted by area label */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {rowConstructions.map((rc, i) => ({ rc, i }))
          .sort((a, b) => (areaLabel(rowKeys[a.i], a.i)).localeCompare(areaLabel(rowKeys[b.i], b.i)))
          .map(({ rc, i }) => {
          const areaKey = rowKeys[i]
          const trapIds = areaTrapezoidMap[areaKey] || []
          const isAreaSelected = selectedRowIdx === i
          return (
            <div key={i}>
              <div
                onClick={() => {
                  setSelectedRowIdx(i)
                  // Bases tab: no trap pre-selection (show all traps in area)
                  // Rails/trapezoids tabs: select first trap
                  setSelectedTrapezoidId(activeTab === 'bases' ? null : (areaTrapezoidMap[areaKey]?.[0] ?? null))
                }}
                style={{ padding: '0.6rem 1rem', cursor: 'pointer', borderBottom: trapIds.length > 1 ? 'none' : `1px solid ${BG_MID}`, background: isAreaSelected ? PRIMARY_BG_LIGHT : 'transparent', borderLeft: `3px solid ${isAreaSelected ? PRIMARY : 'transparent'}`, transition: 'all 0.12s' }}
              >
                <div style={{ fontSize: '0.84rem', fontWeight: '700', color: isAreaSelected ? TEXT : TEXT_SECONDARY }}>
                  {areaLabel(areaKey, i)}
                </div>
                <div style={{ fontSize: '0.72rem', color: TEXT_PLACEHOLDER, marginTop: '2px' }}>
                  {rc.panelCount} panels · {rc.angle}° · {rc.numTrapezoids} frames
                </div>
                <div style={{ fontSize: '0.72rem', color: TEXT_PLACEHOLDER }}>
                  Rail: {fmt(rc.rowLength / 100)} m
                </div>
              </div>

              {/* Sub-items: separate lists for trapezoids and rows when area is selected */}
              {isAreaSelected && (() => {
                const areaPanels = panels.filter(p => (p.areaGroupKey ?? p.area) === areaKey)
                const rowIdxSet = new Set()
                areaPanels.forEach(p => rowIdxSet.add(p.panelRowIdx ?? 0))
                const panelRowIdxs = ([...rowIdxSet] as number[]).sort((a, b) => a - b)
                const hasMultiTraps = trapIds.length > 1
                const hasMultiRows = panelRowIdxs.length > 1
                if (!hasMultiTraps && !hasMultiRows) return null
                return (
                  <div style={{ borderBottom: `1px solid ${BG_MID}`, background: PRIMARY_BG_LIGHT }}>
                    {/* Trapezoid sub-items (shown on all tabs except areas when multi-trap) */}
                    {hasMultiTraps && activeTab !== 'areas' && trapIds.map(trapId => {
                      const isTrapSelected = effectiveSelectedTrapId === trapId
                      const count = areaPanels.filter(p => p.trapezoidId === trapId).length
                      return (
                        <div
                          key={`t-${trapId}`}
                          onClick={e => { e.stopPropagation(); setSelectedTrapezoidId(trapId) }}
                          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 1rem 0.35rem 1.5rem', cursor: 'pointer', borderLeft: `3px solid ${isTrapSelected ? PRIMARY : 'transparent'}`, background: isTrapSelected ? ROW_SELECTED_BG : 'transparent', transition: 'all 0.1s' }}
                        >
                          <span style={{ fontSize: '0.72rem', fontWeight: '700', color: isTrapSelected ? PRIMARY_DARK : TEXT_PLACEHOLDER, background: isTrapSelected ? TRAP_BADGE_BG : BORDER_FAINT, padding: '1px 7px', borderRadius: '10px' }}>
                            {trapId}
                          </span>
                          <span style={{ fontSize: '0.7rem', color: TEXT_VERY_LIGHT }}>{count}p</span>
                          {!!trapezoidConfigs[trapId] && (
                            <span title="Custom config" style={{ width: '5px', height: '5px', borderRadius: '50%', background: WARNING, marginLeft: 'auto', flexShrink: 0 }} />
                          )}
                        </div>
                      )
                    })}
                    {/* Separator between traps and rows */}
                    {hasMultiTraps && hasMultiRows && activeTab !== 'areas' && (
                      <div style={{ borderTop: `1px dashed ${BORDER_FAINT}`, margin: '0.15rem 1rem 0.15rem 1.5rem' }} />
                    )}
                    {/* Row sub-items (shown on bases & rails tabs when multi-row).
                        Phase A: rails differ per row when row line counts differ
                        (e.g. one row V-only, another V+H), so the user needs
                        per-row picking on the rails tab too. */}
                    {hasMultiRows && (activeTab === 'bases' || activeTab === 'rails') && panelRowIdxs.map((ri, idx) => {
                      const isRowSelected = selectedPanelRowIdx === ri
                      const count = areaPanels.filter(p => (p.panelRowIdx ?? 0) === ri).length
                      return (
                        <div
                          key={`r-${ri}`}
                          onClick={e => { e.stopPropagation(); setSelectedPanelRowIdx?.(ri) }}
                          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 1rem 0.35rem 1.5rem', cursor: 'pointer', borderLeft: `3px solid ${isRowSelected ? PRIMARY : 'transparent'}`, background: isRowSelected ? ROW_SELECTED_BG : 'transparent', transition: 'all 0.1s' }}
                        >
                          <span style={{ fontSize: '0.72rem', fontWeight: '600', color: isRowSelected ? PRIMARY_DARK : TEXT_PLACEHOLDER }}>
                            Row {idx + 1}
                          </span>
                          <span style={{ fontSize: '0.7rem', color: TEXT_VERY_LIGHT }}>{count}p</span>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
          )
        })}
      </div>

      {/* Settings collapse toggle */}
      {selectedRC && (
        <div
          onClick={() => setSettingsCollapsed(c => !c)}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.35rem 1rem', cursor: 'pointer', borderTop: `1px solid ${BORDER_FAINT}`, background: BG_SUBTLE }}
        >
          <span style={{ fontSize: '0.62rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Settings</span>
          <span style={{ fontSize: '0.7rem', color: TEXT_FAINTEST }}>{settingsCollapsed ? '▲' : '▼'}</span>
        </div>
      )}

      {/* Settings sections — fully schema-driven */}
      {selectedRC && !settingsCollapsed && SECTIONS.map(sec => {
        const secLabel   = t(sec.labelKey)
        const isOpen     = activeTab === sec.tabKey
        const areaParams = PARAM_SCHEMA.filter(p => p.section === sec.tabKey && (p.scope === 'area' || p.scope === 'trapezoid'))
        const globalParams = PARAM_SCHEMA.filter(p => p.section === sec.tabKey && p.scope === 'global')
        const areaKeys   = areaParams.filter(p => p.type !== 'rail-spacing' && p.scope === 'area').map(p => p.key)

        return (
          <div key={sec.tabKey} style={{ borderTop: `1px solid ${BORDER_FAINT}` }}>
            <div
              onClick={() => setActiveTab(isOpen ? activeTab : sec.tabKey)}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 1rem', cursor: 'pointer', background: isOpen ? SECTION_HEADER_BG : BG_FAINT }}
            >
              <span style={{ fontSize: '0.7rem', fontWeight: '700', color: isOpen ? PRIMARY_DARK : TEXT_PLACEHOLDER, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{secLabel}</span>
              <span style={{ fontSize: '0.8rem', color: TEXT_VERY_LIGHT }}>{isOpen ? '▲' : '▼'}</span>
            </div>

            {isOpen && (
              <div style={{ padding: '0.6rem 1rem 0.75rem' }}>
                {/* Per-area params */}
                {areaParams.map(p => renderParam(p))}
                {/* Apply button */}
                {applyBtn(
                  sec.tabKey === 'rails'  ? () => { onApplyRailsToAllAreas(); onApplyChanges?.(sec.tabKey) } :
                  sec.tabKey === 'bases'  ? () => { applyBasesToAll(); onApplyChanges?.(sec.tabKey) } :
                  () => { applySection(selectedRowIdx, areaKeys); onApplyChanges?.(sec.tabKey) }
                )}
                {/* Global params — rendered after the apply button */}
                {globalParams.length > 0 && (
                  <div style={{ marginTop: '0.5rem' }}>
                    {globalParams.map(p => renderParam(p))}
                  </div>
                )}
                {/* Apply Changes — save to server and recalculate */}
                {onApplyChanges && (
                  <button onClick={() => onApplyChanges(sec.tabKey)}
                    style={{
                      width: '100%', marginTop: '0.35rem', padding: '0.2rem',
                      fontSize: '0.65rem', fontWeight: '600', color: PRIMARY_DARK,
                      background: PRIMARY_BG_ALT, border: `1px solid ${PRIMARY}`,
                      borderRadius: '4px', cursor: 'pointer',
                    }}>
                    {t('step3.sidebar.applyChanges')}
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
