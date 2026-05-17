import { useState, useCallback } from 'react'
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

  // Raw stored value — no fallback chain. Used by the "override" border so
  // an explicitly-stored equal-to-default value still counts as "not stored
  // as an override".
  const getRawParam = useCallback((path: ParamPath): any => {
    if (path.scope === 'global') return globalSettings[path.key]
    if (path.scope === 'area')   return areaSettings[path.anchor]?.[path.key]
    return trapezoidConfigs?.[path.anchor]?.[path.key]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalSettings, areaSettings, trapezoidConfigs])

  // Effective value — stored → next-level fallback → schema/appDefaults.
  // What inputs display and what the no-op guard compares against.
  const getParam = useCallback((path: ParamPath): any => {
    if (path.scope === 'global') {
      return globalSettings[path.key] ?? schemaDefaultOf(path.key)
    }
    if (path.scope === 'area') {
      return areaSettings[path.anchor]?.[path.key]
        ?? globalSettings[path.key]
        ?? schemaDefaultOf(path.key)
    }
    return trapezoidConfigs?.[path.anchor]?.[path.key]
      ?? appDefaults?.[path.key]
      ?? schemaDefaultOf(path.key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalSettings, areaSettings, trapezoidConfigs, appDefaults, PARAM_SCHEMA])

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
      setGlobalSettings(prev => ({ ...prev, [path.key]: value }))
    } else if (path.scope === 'area') {
      setAreaSettings(prev => ({
        ...prev,
        [path.anchor]: { ...(prev[path.anchor] || {}), [path.key]: value },
      }))
    } else {
      if (!setTrapezoidConfigs) return
      setTrapezoidConfigs(prev => ({
        ...prev,
        [path.anchor]: { ...(prev[path.anchor] || {}), [path.key]: value },
      }))
    }
    const tab = SYNTHETIC_TAB[path.key] ?? paramTab(path.key)
    if (tab) markDirty(tab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getParam, paramTab, markDirty, setTrapezoidConfigs])

  // ── Merged settings for a given area ────────────────────────────────────
  const getSettings = (areaIdx) => ({ panelLengthCm, panelWidthCm, ...globalSettings, ...(areaSettings[areaIdx] || {}) })

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
    const detailParams = PARAM_SCHEMA.filter(p => p.section === 'detail')
    setAreaSettings(prev => {
      const copy = { ...(prev[areaIdx] || {}) }
      detailParams.forEach(p => delete copy[p.key])
      delete copy.diagOverrides
      return { ...prev, [areaIdx]: copy }
    })
    // Round-trip to BE (was previously the caller's job — now uniform with
    // resetLineRails / resetTrapBases). After BE responds, FE + BE are in sync.
    onTabReset?.('trapezoids')
    markClean('detail')
  }, [PARAM_SCHEMA, markClean, onTabReset])

  const resetLineRails = useCallback(async () => {
    const railAreaParams   = PARAM_SCHEMA.filter(p => p.section === 'rails' && p.scope === 'area' && p.type !== 'rail-spacing')
    const railGlobalParams = PARAM_SCHEMA.filter(p => p.section === 'rails' && p.scope === 'global')
    setAreaSettings(prev => {
      const updated = { ...prev }
      for (const key of Object.keys(updated)) {
        const copy = { ...(updated[key] || {}) }
        delete copy.lineRails
        railAreaParams.forEach(p => { copy[p.key] = p.default })
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

  const getTrapBasesSettings = useCallback((trapId) => {
    const cfg = trapezoidConfigs[trapId] || {}
    return {
      edgeOffsetMm:   cfg.edgeOffsetMm   ?? appDefaults?.edgeOffsetMm,
      spacingMm:      cfg.spacingMm      ?? appDefaults?.spacingMm,
      baseOverhangCm: cfg.baseOverhangCm ?? appDefaults?.baseOverhangCm,
    }
  }, [trapezoidConfigs, appDefaults])

  const updateTrapBaseSetting = useCallback((trapId, key, value) =>
    setParam({ scope: 'trap', anchor: trapId, key }, value),
    [setParam])

  const resetTrapBases = useCallback((trapId, customBasesHandlers) => {
    customBasesHandlers?.clearTrap(trapId)
    if (!setTrapezoidConfigs) return
    setTrapezoidConfigs(prev => {
      const copy = { ...(prev[trapId] || {}) }
      TRAP_BASES_KEYS.forEach(k => delete copy[k])
      return { ...prev, [trapId]: copy }
    })
    onTabSave?.('bases', { resetTrapId: trapId })
    markClean('bases')
  }, [setTrapezoidConfigs, onTabSave, markClean]) // eslint-disable-line react-hooks/exhaustive-deps

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
    onSettingsChange,
  }
}
