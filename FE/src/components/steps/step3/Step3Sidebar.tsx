import { useState, useEffect, useRef } from 'react'
import { TEXT, TEXT_SECONDARY, TEXT_LIGHT, TEXT_VERY_LIGHT, TEXT_PLACEHOLDER, TEXT_FAINTEST, BORDER_LIGHT, BORDER_FAINT, BORDER, BG_SUBTLE, BG_FAINT, BG_MID, PRIMARY, PRIMARY_DARK, PRIMARY_BG_ALT, PRIMARY_BG_LIGHT, AMBER, WARNING_LIGHT, WARNING, WARNING_BG, WARNING_DARK, BORDER_MID, WHITE, TAB_ACTIVE_COLOR, ROW_SELECTED_BG, TRAP_BADGE_BG, SECTION_HEADER_BG } from '../../../styles/colors'
import { isEmptyOrientation } from '../../../utils/trapezoidGeometry'
import { PANEL_H } from '../../../utils/panelCodes.js'
import { parseVariationTrapId } from '../../../utils/trapExtensionService'
import { useLang } from '../../../i18n/LangContext'

// Trap-scoped settings belong to the parent trap; a selected variation
// ("A1.2") shares them. Strip the ".N" suffix to the parent id.
const stripVariation = (trapId: any): string => parseVariationTrapId(String(trapId ?? '')).parentTrapId

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
  selectedAreaFrameless = false,
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
  effectiveDiagSettings = null,
  effectiveBasesSettings = null,
  dirty = { rails: false, bases: false, detail: false } as { rails: boolean; bases: boolean; detail: boolean },
  isOverride: isOverrideProp = null as null | ((path: any) => boolean),
  // Per-trap user variation lists: { parentTrapId: TrapExtension[] }. Used
  // to expand each trap into A1.0 (= A1), A1.1, A1.2, ... entries in the
  // tree so the user can select an individual variation.
  trapExtensions = {} as Record<string, Array<{ frontExtMm: number; backExtMm: number }>>,
  // Per parent trap, the set of variation indices actually used by a base
  // ("A1" → 0, "A1.2" → 2). Variation rows whose index isn't here are orphans
  // (no base references them) and are hidden. Index 0 (the parent) is always
  // shown regardless.
  usedVariationsByTrap = {} as Record<string, Set<number>>,
  // Base count per trap instance, keyed by full trapezoidId ("A1", "A1.2").
  // Shown on each variation row (same as the parent's panel count chip).
  baseCountByInstance = {} as Record<string, number>,
}) {
  const { t } = useLang()
  const [settingsCollapsed, setSettingsCollapsed] = useState(false)

  // First trap INSTANCE actually shown in the detail tree for an area — i.e.
  // the first in-use instance (parent idx 0 if used, else its first in-use
  // variation), walking traps in order. The parent default (idx 0) can be
  // orphaned and hidden, so selecting the area must land on a real row, not a
  // dead idx 0. Mirrors the `instanceIdxs` logic in the tree render below.
  const firstInUseTrapInstance = (areaKey: string | number): string | null => {
    const trapIds = areaTrapezoidMap[areaKey] || []
    for (const trapId of trapIds) {
      const usedSet = usedVariationsByTrap[trapId]
      if (!usedSet || usedSet.has(0)) return trapId
      const userVars = trapExtensions[trapId] || []
      for (let i = 0; i < userVars.length; i++) {
        if (usedSet.has(i + 1)) return `${trapId}.${i + 1}`
      }
      // no in-use instance for this trap → try the next one
    }
    return trapIds[0] ?? null
  }

  // Orange border = the stored value differs from the next-level fallback.
  // Prefer the canonical isOverride from useStep3Settings (single source of
  // truth) and fall back to a local implementation for back-compat.
  const sameValue = (a, b) => {
    if (a === b) return true
    if (a == null || b == null) return false
    if (typeof a !== 'object' || typeof b !== 'object') return false
    try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false }
  }
  const schemaDefaultOf = (key) => (PARAM_SCHEMA || []).find(p => p.key === key)?.default
  const isOverride = (key) => {
    if (isOverrideProp) return isOverrideProp({ scope: 'area', anchor: selectedRowIdx, key })
    const stored = areaSettings[selectedRowIdx]?.[key]
    if (stored === undefined) return false
    const fallback = globalSettings?.[key] ?? schemaDefaultOf(key)
    return !sameValue(stored, fallback)
  }

  // ── renderParam: schema-driven input renderer ─────────────────────────────
  const renderParam = (param) => {
    // Skip parameters marked as not visible (admin-only)
    if (param.visible === false) return null

    const { key, label, type, scope: rawScope, orientation, min, max, step, highlightGroup } = param
    // A variation trap ("A1.2") carries its OWN absolute front/back extension
    // (set via the base-endpoint grips / edit panel), so the params that only
    // drive the DEFAULT extension — the extend-beam toggles and the purlin
    // buffer that feeds the default extension length — don't apply. Hide them
    // (UI only) when a variation is selected. The parent trap still shows them.
    const isVariationSelected = !!effectiveSelectedTrapId
      && stripVariation(effectiveSelectedTrapId) !== effectiveSelectedTrapId
    if (isVariationSelected && (key === 'extendFront' || key === 'extendRear' || key === 'purlinBufferCm')) return null
    // Trap-scoped bases params (e.g. spacingMm) have no real trapezoid on
    // frameless areas (tiles, flat_installation) — they get a pseudo-trap-id
    // (the area letter), so effectiveSelectedTrapId is truthy. Detect frameless
    // by roof type and fall back to AREA scope there so the value is stored
    // per-area and reaches the frameless base computation (omega/hook line
    // spacing). Framed areas keep their per-trap scope.
    const scope = (rawScope === 'trapezoid' && selectedAreaFrameless) ? 'area' : rawScope
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
      // Trap settings live on the PARENT trap; a selected variation ("A1.2")
      // shares them, so resolve the override against the parent id.
      const parentTrapId = stripVariation(effectiveSelectedTrapId)
      // Override = stored value differs from the schema default. Routes
      // through the canonical isOverride when available so trap-scope and
      // area-scope share the same rule.
      const overridden = (() => {
        if (!parentTrapId) return false
        if (isOverrideProp) return isOverrideProp({ scope: 'trap', anchor: parentTrapId, key })
        const stored = trapezoidConfigs?.[parentTrapId]?.[key]
        if (stored === undefined) return false
        return !sameValue(stored, param.default)
      })()
      const effectiveTrapMax = (() => {
        if (key === 'edgeOffsetMm' && effectiveBasesSettings?.maxEdgeOffsetMm != null) return effectiveBasesSettings.maxEdgeOffsetMm
        if (key === 'spacingMm' && effectiveBasesSettings?.maxSpacingMm != null) return effectiveBasesSettings.maxSpacingMm
        return max
      })()
      const isTrapClamped = (key === 'edgeOffsetMm' && !!effectiveBasesSettings?.edgeOffsetClamped)
        || (key === 'spacingMm' && !!effectiveBasesSettings?.spacingClamped)
      const clampedVal = key === 'edgeOffsetMm' ? effectiveBasesSettings?.maxEdgeOffsetMm
        : key === 'spacingMm' ? effectiveBasesSettings?.maxSpacingMm : null
      return (
        <div key={key} style={{ marginBottom: '0.45rem' }}>
          {labelNode}
          <DebouncedNumberInput
            value={val} min={min} max={effectiveTrapMax} step={step}
            onCommit={v => updateTrapBaseSetting?.(effectiveSelectedTrapId, key, v)}
            onFocus={() => setHighlightParam(key)}
            onBlur={() => setHighlightParam(null)}
            style={{
              ...baseInputStyle,
              border: `1px solid ${isActive ? AMBER : overridden ? WARNING_LIGHT : BORDER}`,
              fontWeight: overridden ? '700' : '400',
            }} />
          {isTrapClamped && clampedVal != null && (
            <div style={{ fontSize: '0.6rem', color: WARNING, marginTop: '2px' }}>
              {t('step3.sidebar.clampedTo')} {fmt(clampedVal)}
            </div>
          )}
        </div>
      )
    }

    // ── number · area (default)
    const s          = getSettings(selectedRowIdx)
    const overridden = isOverride(key)

    const effectiveMax = (() => {
      if (key === 'diagDistFromLegCm' && effectiveDiagSettings?.maxDistFromLegCm != null) return effectiveDiagSettings.maxDistFromLegCm
      return max
    })()
    const isClamped = (key === 'diagDistFromLegCm' && !!effectiveDiagSettings?.distClamped)

    return (
      <div key={key} style={{ marginBottom: '0.45rem' }}>
        {labelNode}
        <DebouncedNumberInput
          value={s[key] ?? param.default} min={min} max={effectiveMax} step={step}
          onCommit={v => updateSetting(selectedRowIdx, key, v)}
          onFocus={() => setHighlightParam(key)}
          onBlur={() => setHighlightParam(null)}
          style={{
            ...baseInputStyle,
            border: `1px solid ${isActive ? AMBER : overridden ? WARNING_LIGHT : BORDER}`,
            fontWeight: overridden ? '700' : '400',
          }} />
        {isClamped && (() => {
          const clampedVal = key === 'diagDistFromLegCm' ? effectiveDiagSettings?.distFromLegCm : null
          return clampedVal != null ? (
            <div style={{ fontSize: '0.6rem', color: WARNING, marginTop: '2px' }}>
              {t('step3.sidebar.clampedTo')} {fmt(clampedVal)}
            </div>
          ) : null
        })()}
      </div>
    )
  }

  // ── Apply-to-all button ────────────────────────────────────────────────
  // Mirrors the Apply Changes styling: when this tab has unsaved edits the
  // button turns orange + bolded + halo + `●` so the user sees both Apply
  // options as actionable at the same time.
  const applyBtn = (onClick, tabKey) => {
    const isDirty = !!dirty[tabKey]
    return (
      <button onClick={onClick}
        style={{
          width: '100%', marginTop: '0.35rem', padding: '0.2rem',
          fontSize: '0.65rem', fontWeight: isDirty ? 700 : 600,
          color: isDirty ? '#fff' : TEXT_PLACEHOLDER,
          background: isDirty ? WARNING_DARK : BG_SUBTLE,
          border: `1px solid ${isDirty ? WARNING_DARK : BORDER_LIGHT}`,
          borderRadius: '4px', cursor: 'pointer',
          boxShadow: isDirty ? `0 0 0 3px ${WARNING_BG}` : undefined,
        }}>
        {isDirty
          ? `● ${t('step3.sidebar.applyToAll')}`
          : t('step3.sidebar.applyToAll')}
      </button>
    )
  }

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
                  // Area click: detail tab → first IN-USE trap instance (the
                  // parent idx 0 may be orphaned/hidden); rails/bases → all rows
                  // (null); areas → no effect
                  if (activeTab === 'detail') {
                    setSelectedTrapezoidId(firstInUseTrapInstance(areaKey))
                  } else {
                    setSelectedTrapezoidId(null)
                  }
                }}
                style={{ padding: '0.6rem 1rem', cursor: 'pointer', borderBottom: trapIds.length > 1 ? 'none' : `1px solid ${BG_MID}`, background: isAreaSelected ? PRIMARY_BG_LIGHT : 'transparent', borderLeft: `3px solid ${isAreaSelected ? PRIMARY : 'transparent'}`, transition: 'all 0.12s' }}
              >
                <div style={{ fontSize: '0.84rem', fontWeight: '700', color: isAreaSelected ? TEXT : TEXT_SECONDARY }}>
                  {areaLabel(areaKey, i)}
                </div>
                <div style={{ fontSize: '0.72rem', color: TEXT_PLACEHOLDER, marginTop: '2px' }}>
                  {rc.panelCount} panels · {rc.angle}°
                </div>
                <div style={{ fontSize: '0.72rem', color: TEXT_PLACEHOLDER }}>
                  Rail: {fmt(rc.rowLength / 100)} m
                </div>
              </div>

              {/* Sub-items by tab: areas=none, bases/rails=rows, detail=traps */}
              {isAreaSelected && activeTab !== 'areas' && (() => {
                const areaPanels = panels.filter(p => (p.areaGroupKey ?? p.area) === areaKey)
                // Only count variations actually in use (a base references idx
                // ≥ 1) — orphaned ones are hidden and shouldn't force the tree open.
                const hasVariations = trapIds.some(tid =>
                  (trapExtensions[tid] || []).some((_, idx) => usedVariationsByTrap[tid]?.has(idx + 1)))
                const showTraps = activeTab === 'detail' && (trapIds.length > 1 || hasVariations)
                const rowIdxSet = new Set()
                areaPanels.forEach(p => rowIdxSet.add(p.panelRowIdx ?? 0))
                const panelRowIdxs = ([...rowIdxSet] as number[]).sort((a, b) => a - b)
                const showRows = (activeTab === 'bases' || activeTab === 'rails') && panelRowIdxs.length > 1
                if (!showTraps && !showRows) return null
                return (
                  <div style={{ borderBottom: `1px solid ${BG_MID}`, background: PRIMARY_BG_LIGHT }}>
                    {showTraps && trapIds.flatMap(trapId => {
                      // FLAT list of this trap's IN-USE instances, all at the
                      // same level: the original (idx 0) plus each used variation
                      // (idx 1..N). Instances no base references (the original
                      // included) are hidden. Until usage is known, fall back to
                      // showing the original so the tree isn't briefly empty.
                      const userVars = trapExtensions[trapId] || []
                      const usedSet = usedVariationsByTrap[trapId]
                      const hasCustomConfig = !!trapezoidConfigs[trapId]
                      const count = areaPanels.filter(p => p.trapezoidId === trapId).length
                      const instanceIdxs: number[] = []
                      if (!usedSet) {
                        instanceIdxs.push(0)
                      } else {
                        if (usedSet.has(0)) instanceIdxs.push(0)
                        userVars.forEach((_, i) => { if (usedSet.has(i + 1)) instanceIdxs.push(i + 1) })
                      }
                      return instanceIdxs.map(idx => {
                        const id = idx === 0 ? trapId : `${trapId}.${idx}`
                        const isSel = effectiveSelectedTrapId === id
                        return (
                          <div
                            key={`ti-${id}`}
                            onClick={e => { e.stopPropagation(); setSelectedTrapezoidId(id) }}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 1rem 0.35rem 1.5rem', cursor: 'pointer', borderLeft: `3px solid ${isSel ? PRIMARY : 'transparent'}`, background: isSel ? ROW_SELECTED_BG : 'transparent', transition: 'all 0.1s' }}
                          >
                            <span style={{ fontSize: '0.72rem', fontWeight: idx === 0 ? '700' : '600', color: isSel ? PRIMARY_DARK : TEXT_PLACEHOLDER, background: isSel ? TRAP_BADGE_BG : (idx === 0 ? BORDER_FAINT : 'transparent'), padding: '1px 7px', borderRadius: '10px', border: idx === 0 ? 'none' : `1px solid ${isSel ? PRIMARY : BORDER_FAINT}` }}>
                              {id}
                            </span>
                            <span style={{ fontSize: '0.7rem', color: TEXT_VERY_LIGHT }}>
                              {idx === 0 ? count : (baseCountByInstance[id] ?? 0)}p
                            </span>
                            {hasCustomConfig && (
                              <span title="Custom config" style={{ width: '5px', height: '5px', borderRadius: '50%', background: WARNING, marginLeft: 'auto', flexShrink: 0 }} />
                            )}
                          </div>
                        )
                      })
                    })}
                    {showRows && panelRowIdxs.map((ri, idx) => {
                      const isRowSelected = selectedPanelRowIdx === null || selectedPanelRowIdx === ri
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
                {/* Global params — directly under area params so user sees
                    the full set before reaching the action buttons. */}
                {globalParams.length > 0 && (
                  <div style={{ marginTop: '0.5rem' }}>
                    {globalParams.map(p => renderParam(p))}
                  </div>
                )}
                {/* Apply Changes first — primary save action. Highlights
                    when this tab has unsaved edits so the user knows where
                    the staged changes will land. */}
                {onApplyChanges && (() => {
                  const isDirty = !!dirty[sec.tabKey]
                  return (
                    <button onClick={() => onApplyChanges(sec.tabKey)}
                      style={{
                        width: '100%', marginTop: '0.35rem', padding: '0.2rem',
                        fontSize: '0.65rem', fontWeight: isDirty ? 700 : 600,
                        color: isDirty ? '#fff' : PRIMARY_DARK,
                        background: isDirty ? WARNING_DARK : PRIMARY_BG_ALT,
                        border: `1px solid ${isDirty ? WARNING_DARK : PRIMARY}`,
                        borderRadius: '4px', cursor: 'pointer',
                        boxShadow: isDirty ? `0 0 0 3px ${WARNING_BG}` : undefined,
                      }}>
                      {isDirty
                        ? `● ${t('step3.sidebar.applyChanges')}`
                        : t('step3.sidebar.applyChanges')}
                    </button>
                  )
                })()}
                {/* Apply-to-all — secondary action; click also triggers the
                    standard Apply Changes save so global edits ride along. */}
                {applyBtn(
                  sec.tabKey === 'rails'  ? () => { onApplyRailsToAllAreas(); onApplyChanges?.(sec.tabKey) } :
                  sec.tabKey === 'bases'  ? () => { applyBasesToAll(); onApplyChanges?.(sec.tabKey) } :
                  () => { applySection(selectedRowIdx, areaKeys); onApplyChanges?.(sec.tabKey) },
                  sec.tabKey,
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
