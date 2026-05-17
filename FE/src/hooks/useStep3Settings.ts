import { useState, useCallback, useRef, useEffect } from 'react'
import { useLang } from '../i18n/LangContext'

/**
 * Manages Step 3 hierarchical settings: global → area → trapezoid.
 * Returns getters, setters, and apply/reset helpers.
 */
export default function useStep3Settings({
  initialGlobalSettings, initialAreaSettings, SETTINGS_DEFAULTS, PARAM_SCHEMA,
  appDefaults, panelSpec, trapezoidConfigs, setTrapezoidConfigs, areas,
  areaByGroupKey,
  onTabSave, onTabReset, onSettingsChange,
}) {
  const { t } = useLang()
  const panelLengthCm = panelSpec.lengthCm
  const panelWidthCm  = panelSpec.widthCm

  const [globalSettings, setGlobalSettings] = useState(() =>
    initialGlobalSettings ? { ...SETTINGS_DEFAULTS, ...initialGlobalSettings } : SETTINGS_DEFAULTS
  )
  const [areaSettings, setAreaSettings] = useState(() => initialAreaSettings ?? {})

  // ── Synchronous mirror refs ─────────────────────────────────────────────
  // setParam writes to BOTH state (async, drives re-render) and these refs
  // (sync). Reads inside setParam and downstream apply-to-all helpers go
  // through the refs so a series of writes within one event tick see each
  // other's values — without this, applying to all areas right after a typed
  // blur reads stale state and silently no-ops every destination.
  const globalSettingsRef = useRef(globalSettings)
  const areaSettingsRef = useRef(areaSettings)
  const trapezoidConfigsRef = useRef(trapezoidConfigs)
  // Keep refs in sync with state when changes come from outside setParam
  // (project load, reset, applyBeResult, etc.).
  useEffect(() => { globalSettingsRef.current = globalSettings }, [globalSettings])
  useEffect(() => { areaSettingsRef.current = areaSettings }, [areaSettings])
  useEffect(() => { trapezoidConfigsRef.current = trapezoidConfigs }, [trapezoidConfigs])

  // ── Dirty tracking per tab ──────────────────────────────────────────────
  // Every sidebar input + drag mutation marks its tab dirty so the canvas can
  // signal "preview is stale until Apply." Cleared on a successful saveTab.
  const [dirty, setDirty] = useState<{ rails: boolean; bases: boolean; detail: boolean }>({
    rails: false, bases: false, detail: false,
  })
  const markDirty = useCallback((tab: 'rails' | 'bases' | 'detail') => {
    setDirty(prev => prev[tab] ? prev : { ...prev, [tab]: true })
  }, [])
  const markClean = useCallback((tab: 'rails' | 'bases' | 'detail') => {
    setDirty(prev => prev[tab] ? { ...prev, [tab]: false } : prev)
  }, [])

  // ── Per-key dirty tracking ──────────────────────────────────────────────
  // Records which params were touched this session, scoped by (scope, anchor).
  // Used by saveTab to send a minimal payload — only the keys the user
  // actually changed — so the BE doesn't receive unrelated defaults.
  // A revert-to-default still goes through setParam, so the key remains in
  // the set and the BE learns about the revert via the partial payload.
  type DirtyParamsState = {
    global: Record<string, true>
    area: Record<number, Record<string, true>>
    trap: Record<string, Record<string, true>>
  }
  const dirtyParamsRef = useRef<DirtyParamsState>({ global: {}, area: {}, trap: {} })
  const recordDirtyParam = useCallback((path: { scope: 'global' | 'area' | 'trap'; anchor?: any; key: string }) => {
    const cur = dirtyParamsRef.current
    if (path.scope === 'global') {
      if (!cur.global[path.key]) cur.global = { ...cur.global, [path.key]: true }
    } else if (path.scope === 'area') {
      const a = cur.area[path.anchor] || {}
      if (!a[path.key]) cur.area = { ...cur.area, [path.anchor]: { ...a, [path.key]: true } }
    } else {
      const t = cur.trap[path.anchor] || {}
      if (!t[path.key]) cur.trap = { ...cur.trap, [path.anchor]: { ...t, [path.key]: true } }
    }
  }, [])
  const paramTab = useCallback((key: string): 'rails' | 'bases' | 'detail' | null => {
    const p = (PARAM_SCHEMA || []).find((x: any) => x.key === key)
    const sec = p?.section
    return sec === 'rails' || sec === 'bases' || sec === 'detail' ? sec : null
  }, [PARAM_SCHEMA])

  // No-op guard: blur from an input that wasn't actually edited fires commit
  // with the same value, which would otherwise mark the tab dirty. Compare
  // structurally so { lineRails: {...} } payloads are recognised as equal.
  const isSameValue = (a: any, b: any): boolean => {
    if (a === b) return true
    if (a == null || b == null) return a === b
    if (typeof a !== 'object' || typeof b !== 'object') return false
    try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false }
  }

  // ── Unified param API ───────────────────────────────────────────────────
  // Every per-param write goes through setParam. The legacy setters below are
  // thin wrappers so existing call sites keep working. Drag-edit keys
  // (lineRails, diagOverrides) aren't in PARAM_SCHEMA — they're mapped to
  // their owning tab here.
  type ParamPath =
    | { scope: 'global'; key: string }
    | { scope: 'area'; anchor: number; key: string }
    | { scope: 'trap'; anchor: string; key: string }

  const SYNTHETIC_TAB: Record<string, 'rails' | 'bases' | 'detail'> = {
    lineRails: 'rails',
    diagOverrides: 'detail',
  }
  const schemaDefaultOf = (key: string) =>
    (PARAM_SCHEMA || []).find((p: any) => p.key === key)?.default

  // Raw stored value — no fallback chain. Reads through the mirror refs so
  // a series of writes inside one event tick see each other.
  const getRawParam = useCallback((path: ParamPath): any => {
    if (path.scope === 'global') return globalSettingsRef.current[path.key]
    if (path.scope === 'area')   return areaSettingsRef.current[path.anchor]?.[path.key]
    return trapezoidConfigsRef.current?.[path.anchor]?.[path.key]
  }, [])

  // Effective value — stored → next-level fallback → schema/appDefaults.
  // Also reads through the mirror refs.
  const getParam = useCallback((path: ParamPath): any => {
    if (path.scope === 'global') {
      return globalSettingsRef.current[path.key] ?? schemaDefaultOf(path.key)
    }
    if (path.scope === 'area') {
      return areaSettingsRef.current[path.anchor]?.[path.key]
        ?? globalSettingsRef.current[path.key]
        ?? schemaDefaultOf(path.key)
    }
    return trapezoidConfigsRef.current?.[path.anchor]?.[path.key]
      ?? appDefaults?.[path.key]
      ?? schemaDefaultOf(path.key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appDefaults, PARAM_SCHEMA])

  // True when the stored value is a real customization (differs from the
  // next-level fallback). Drives the orange override border in the sidebar.
  const isOverride = useCallback((path: ParamPath): boolean => {
    const stored = getRawParam(path)
    if (stored === undefined) return false
    let fallback: any
    if (path.scope === 'global')      fallback = schemaDefaultOf(path.key)
    else if (path.scope === 'area')   fallback = globalSettings[path.key] ?? schemaDefaultOf(path.key)
    else                              fallback = appDefaults?.[path.key]
    return !isSameValue(stored, fallback)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getRawParam, globalSettings, appDefaults, PARAM_SCHEMA])

  const setParam = useCallback((path: ParamPath, value: any) => {
    if (isSameValue(getParam(path), value)) return
    if (path.scope === 'global') {
      // Mirror ref update is synchronous; setState is queued for re-render.
      // The next setParam in the same tick reads the live value from the ref.
      globalSettingsRef.current = { ...globalSettingsRef.current, [path.key]: value }
      setGlobalSettings(prev => ({ ...prev, [path.key]: value }))
    } else if (path.scope === 'area') {
      const curArea = areaSettingsRef.current[path.anchor] || {}
      areaSettingsRef.current = {
        ...areaSettingsRef.current,
        [path.anchor]: { ...curArea, [path.key]: value },
      }
      setAreaSettings(prev => ({
        ...prev,
        [path.anchor]: { ...(prev[path.anchor] || {}), [path.key]: value },
      }))
    } else {
      if (!setTrapezoidConfigs) return
      const curTrap = trapezoidConfigsRef.current?.[path.anchor] || {}
      trapezoidConfigsRef.current = {
        ...(trapezoidConfigsRef.current || {}),
        [path.anchor]: { ...curTrap, [path.key]: value },
      }
      setTrapezoidConfigs(prev => ({
        ...prev,
        [path.anchor]: { ...(prev[path.anchor] || {}), [path.key]: value },
      }))
    }
    recordDirtyParam(path)
    const tab = SYNTHETIC_TAB[path.key] ?? paramTab(path.key)
    if (tab) markDirty(tab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getParam, paramTab, markDirty, setTrapezoidConfigs, recordDirtyParam])

  // ── Merged settings for a given area ────────────────────────────────────
  // Reads through the mirror refs so a write made earlier in the same event
  // tick (e.g. an input blur immediately before an apply-to-all button click)
  // is visible to the next reader without waiting for React to re-render.
  const getSettings = (areaIdx) => ({
    panelLengthCm, panelWidthCm,
    ...globalSettingsRef.current,
    ...(areaSettingsRef.current[areaIdx] || {}),
  })

  const areaLabel = useCallback((areaKey, i) => {
    // areaByGroupKey maps areaGroupKey → areas entry (handles multi-row areas)
    const g = areaByGroupKey?.[areaKey]?.label ?? areas[areaKey]?.label
    return g ? `${g}` : t('step3.label.area', { n: i + 1 })
  }, [areas, areaByGroupKey, t])

  // ── Legacy setters (thin wrappers over setParam — kept for back-compat).
  const updateSetting = (areaIdx, key, value) =>
    setParam({ scope: 'area', anchor: areaIdx, key }, value)

  // ── Apply section params from one area to global ────────────────────────
  const applySection = (rowIdx, keys) => {
    const vals = {}
    const s = getSettings(rowIdx)
    keys.forEach(k => { vals[k] = s[k] })
    setGlobalSettings(prev => ({ ...prev, ...vals }))
    setAreaSettings(prev => {
      const next = {}
      for (const i of Object.keys(prev)) {
        const copy = { ...prev[i] }
        keys.forEach(k => delete copy[k])
        next[i] = copy
      }
      return next
    })
    const tabs = new Set(keys.map((k: string) => paramTab(k)).filter(Boolean))
    tabs.forEach(t => markDirty(t as any))
  }

  const updateGlobalSetting = useCallback((key, value) =>
    setParam({ scope: 'global', key }, value),
    [setParam])

  // ── LineRails helpers ───────────────────────────────────────────────────
  // Rail spacing writes commit immediately into `lineRails`. The FE rails
  // overlay reads this directly, giving live preview — the same UX the bases
  // tab already has via computeExpandedBasePlans. Dirty + banner still apply
  // so the BE knows it's out of sync until Apply.
  const updateLineRails = useCallback((areaIdx, newLineRails) =>
    setParam({ scope: 'area', anchor: areaIdx, key: 'lineRails' }, newLineRails),
    [setParam])

  const resetDetailSettings = useCallback((areaIdx) => {
    // Sweep every detail-section param across all scopes so reset truly clears
    // the user's customizations. Previously this only touched area-scope which
    // left global params (e.g. purlinBufferCm) and trap-scope params
    // (extendFront/Rear) showing stale values until a reload.
    const detailParams = PARAM_SCHEMA.filter(p => p.section === 'detail')
    const areaKeys   = detailParams.filter(p => p.scope === 'area').map(p => p.key)
    const globalKeys = detailParams.filter(p => p.scope === 'global').map(p => p.key)
    const trapKeys   = detailParams.filter(p => p.scope === 'trapezoid').map(p => p.key)
    setAreaSettings(prev => {
      const copy = { ...(prev[areaIdx] || {}) }
      areaKeys.forEach(k => delete copy[k])
      delete copy.diagOverrides
      return { ...prev, [areaIdx]: copy }
    })
    if (globalKeys.length > 0) {
      setGlobalSettings(prev => {
        const copy = { ...prev }
        globalKeys.forEach(k => delete copy[k])
        return copy
      })
    }
    if (trapKeys.length > 0 && setTrapezoidConfigs) {
      setTrapezoidConfigs(prev => {
        const next = { ...prev }
        for (const trapId of Object.keys(next)) {
          const cfg = { ...(next[trapId] || {}) }
          trapKeys.forEach(k => delete cfg[k])
          next[trapId] = cfg
        }
        return next
      })
    }
    // Round-trip to BE (was previously the caller's job — now uniform with
    // resetLineRails / resetTrapBases). After BE responds, FE + BE are in sync.
    onTabReset?.('trapezoids')
    markClean('detail')
  }, [PARAM_SCHEMA, markClean, onTabReset, setTrapezoidConfigs])

  const resetLineRails = useCallback(async () => {
    // Reset ALL rails-section area params, including rail-spacing types
    // (railSpacingV/H). Pre-refactor those were derived from lineRails so the
    // old filter skipped them — now spacing IS stored directly, so the
    // reset must clear the per-area override or the input keeps showing the
    // user's last value until a project reload.
    const railAreaParams   = PARAM_SCHEMA.filter(p => p.section === 'rails' && p.scope === 'area')
    const railGlobalParams = PARAM_SCHEMA.filter(p => p.section === 'rails' && p.scope === 'global')
    setAreaSettings(prev => {
      const updated = { ...prev }
      for (const key of Object.keys(updated)) {
        const copy = { ...(updated[key] || {}) }
        delete copy.lineRails
        railAreaParams.forEach(p => { delete copy[p.key] })
        updated[key] = copy
      }
      return updated
    })
    setGlobalSettings(prev => {
      const copy = { ...prev }
      railGlobalParams.forEach(p => { copy[p.key] = p.default })
      return copy
    })
    onTabReset?.('rails')
    markClean('rails')
  }, [onTabReset, PARAM_SCHEMA, markClean]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Per-trapezoid base settings ─────────────────────────────────────────
  const TRAP_BASES_KEYS = ['edgeOffsetMm', 'spacingMm', 'baseOverhangCm']

  // Reads through trapezoidConfigsRef so apply-bases-to-all sees the source
  // trap's just-typed value (the blur right before the button click writes
  // it into the ref synchronously; React state hasn't flushed yet).
  const getTrapBasesSettings = useCallback((trapId) => {
    const cfg = trapezoidConfigsRef.current?.[trapId] || {}
    return {
      edgeOffsetMm:   cfg.edgeOffsetMm   ?? appDefaults?.edgeOffsetMm,
      spacingMm:      cfg.spacingMm      ?? appDefaults?.spacingMm,
      baseOverhangCm: cfg.baseOverhangCm ?? appDefaults?.baseOverhangCm,
    }
    // Deps intentionally exclude trapezoidConfigs — the ref is the source of
    // truth; we still depend on appDefaults so callers see schema changes.
  }, [appDefaults])

  const updateTrapBaseSetting = useCallback((trapId, key, value) =>
    setParam({ scope: 'trap', anchor: trapId, key }, value),
    [setParam])

  // ── Dirty-params filter + clear (saveTab payload trimming) ─────────────
  // Tab → param key membership: schema section or synthetic mapping.
  const keyBelongsToTab = useCallback((key: string, tab: 'rails' | 'bases' | 'detail') =>
    (SYNTHETIC_TAB[key] ?? paramTab(key)) === tab,
    [paramTab])

  // Returns the set of keys (by scope) that were touched this session AND
  // belong to the given tab. saveTab uses this to send only those keys.
  const getDirtyParamsForTab = useCallback((tab: 'rails' | 'bases' | 'detail') => {
    const d = dirtyParamsRef.current
    const out = {
      global: new Set<string>(),
      area: {} as Record<number, Set<string>>,
      trap: {} as Record<string, Set<string>>,
    }
    Object.keys(d.global).forEach(k => { if (keyBelongsToTab(k, tab)) out.global.add(k) })
    for (const [idx, keys] of Object.entries(d.area)) {
      const filtered = new Set(Object.keys(keys).filter(k => keyBelongsToTab(k, tab)))
      if (filtered.size > 0) out.area[Number(idx)] = filtered
    }
    for (const [tid, keys] of Object.entries(d.trap)) {
      const filtered = new Set(Object.keys(keys).filter(k => keyBelongsToTab(k, tab)))
      if (filtered.size > 0) out.trap[tid] = filtered
    }
    return out
  }, [keyBelongsToTab])

  // Drops every dirty key that belongs to the given tab. Called after a
  // successful saveTab so the next save's payload stays minimal.
  const clearDirtyParamsForTab = useCallback((tab: 'rails' | 'bases' | 'detail') => {
    const d = dirtyParamsRef.current
    const filterByTab = (rec: Record<string, true>) =>
      Object.fromEntries(Object.entries(rec).filter(([k]) => !keyBelongsToTab(k, tab)))
    d.global = filterByTab(d.global)
    d.area = Object.fromEntries(Object.entries(d.area).map(([k, v]) => [k, filterByTab(v)]))
    d.trap = Object.fromEntries(Object.entries(d.trap).map(([k, v]) => [k, filterByTab(v)]))
  }, [keyBelongsToTab])

  // Tab-wide reset — mirrors resetLineRails / resetDetailSettings. The
  // _trapId arg is ignored (kept for the existing callsite signature). The
  // BE's reset_tab('bases') strips schema keys from areaSettings + the new
  // step3.trapezoidConfigs AND clears customBasesOffsets, so the round-trip
  // is sufficient. customBasesHandlers.clearAll() clears the FE-only
  // customBasesMap held in App.tsx.
  const resetTrapBases = useCallback((_trapId, customBasesHandlers) => {
    customBasesHandlers?.clearAll?.()
    if (setTrapezoidConfigs) {
      setTrapezoidConfigs(prev => {
        const next: Record<string, any> = { ...(prev || {}) }
        for (const tid of Object.keys(next)) {
          const cfg = { ...(next[tid] || {}) }
          TRAP_BASES_KEYS.forEach(k => delete cfg[k])
          next[tid] = cfg
        }
        return next
      })
      // Mirror ref sync (state setter is async; next reader needs the live value).
      const cur = trapezoidConfigsRef.current || {}
      const nextRef: Record<string, any> = { ...cur }
      for (const tid of Object.keys(nextRef)) {
        const cfg = { ...(nextRef[tid] || {}) }
        TRAP_BASES_KEYS.forEach(k => delete cfg[k])
        nextRef[tid] = cfg
      }
      trapezoidConfigsRef.current = nextRef
    }
    onTabReset?.('bases')
    markClean('bases')
  }, [setTrapezoidConfigs, onTabReset, markClean])

  return {
    globalSettings, setGlobalSettings,
    areaSettings, setAreaSettings,
    getSettings, areaLabel,
    // Unified param API — every input change should go through these.
    setParam, getParam, getRawParam, isOverride,
    // Legacy scope-specific setters (thin wrappers; kept for back-compat).
    updateSetting, applySection,
    updateGlobalSetting, updateLineRails,
    resetDetailSettings, resetLineRails,
    getTrapBasesSettings, updateTrapBaseSetting, resetTrapBases,
    dirty, markDirty, markClean,
    isAnyDirty: dirty.rails || dirty.bases || dirty.detail,
    // Per-key dirty filter for saveTab — send only what changed.
    getDirtyParamsForTab, clearDirtyParamsForTab,
    // Synchronous snapshot from the mirror refs. Use this when the caller
    // needs the very latest writes inside the same event tick (e.g. building
    // a saveTab payload right after an apply-to-all fan-out).
    getLiveSnapshot: () => ({
      globalSettings:   globalSettingsRef.current,
      areaSettings:     areaSettingsRef.current,
      trapezoidConfigs: trapezoidConfigsRef.current,
    }),
    onSettingsChange,
  }
}
