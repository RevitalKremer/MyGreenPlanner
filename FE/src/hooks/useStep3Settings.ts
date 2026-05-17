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

  // ── Merged settings for a given area ────────────────────────────────────
  const getSettings = (areaIdx) => ({ panelLengthCm, panelWidthCm, ...globalSettings, ...(areaSettings[areaIdx] || {}) })

  const areaLabel = useCallback((areaKey, i) => {
    // areaByGroupKey maps areaGroupKey → areas entry (handles multi-row areas)
    const g = areaByGroupKey?.[areaKey]?.label ?? areas[areaKey]?.label
    return g ? `${g}` : t('step3.label.area', { n: i + 1 })
  }, [areas, areaByGroupKey, t])

  // ── Area-level setting update ───────────────────────────────────────────
  const updateSetting = (areaIdx, key, value) => {
    // Compare against the EFFECTIVE current value (area override → global →
    // schema default). The input shows that resolved value, so a blur without
    // a typed change commits the same number we'd compare against.
    const schemaDefault = (PARAM_SCHEMA || []).find((p: any) => p.key === key)?.default
    const effectiveCurrent = areaSettings[areaIdx]?.[key] ?? globalSettings[key] ?? schemaDefault
    if (isSameValue(effectiveCurrent, value)) return
    setAreaSettings(prev => ({
      ...prev,
      [areaIdx]: { ...(prev[areaIdx] || {}), [key]: value }
    }))
    // Drag-edit keys live outside PARAM_SCHEMA (they're staging buckets, not
    // user-facing params), so map them to their owning tab here.
    const dragEditTab: Record<string, 'rails' | 'bases' | 'detail'> = {
      diagOverrides: 'detail',
    }
    const tab = dragEditTab[key] ?? paramTab(key)
    if (tab) markDirty(tab)
  }

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

  // ── Global setting update ───────────────────────────────────────────────
  const updateGlobalSetting = useCallback((key, value) => {
    const schemaDefault = (PARAM_SCHEMA || []).find((p: any) => p.key === key)?.default
    const effectiveCurrent = globalSettings[key] ?? schemaDefault
    if (isSameValue(effectiveCurrent, value)) return
    setGlobalSettings(prev => ({ ...prev, [key]: value }))
    const tab = paramTab(key); if (tab) markDirty(tab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramTab, markDirty, globalSettings, PARAM_SCHEMA])

  // ── LineRails helpers ───────────────────────────────────────────────────
  // Rail spacing writes commit immediately into `lineRails`. The FE rails
  // overlay reads this directly, giving live preview — the same UX the bases
  // tab already has via computeExpandedBasePlans. Dirty + banner still apply
  // so the BE knows it's out of sync until Apply.
  const updateLineRails = useCallback((areaIdx, newLineRails) => {
    const cur: any = areaSettings[areaIdx] || {}
    if (isSameValue(cur.lineRails, newLineRails)) return
    setAreaSettings(prev => ({
      ...prev,
      [areaIdx]: { ...(prev[areaIdx] || {}), lineRails: newLineRails }
    }))
    markDirty('rails')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markDirty, areaSettings])

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

  const updateTrapBaseSetting = useCallback((trapId, key, value) => {
    if (!setTrapezoidConfigs) return
    // Trap-base inputs fall through to appDefaults when the trap-level value
    // is undefined, so the no-op guard must compare against the same chain.
    const effectiveCurrent = trapezoidConfigs?.[trapId]?.[key] ?? appDefaults?.[key]
    if (isSameValue(effectiveCurrent, value)) return
    setTrapezoidConfigs(prev => ({
      ...prev,
      [trapId]: { ...(prev[trapId] || {}), [key]: value }
    }))
    // Trapezoid params split: 'extendFront'/'extendRear' belong to the detail
    // tab; offset/spacing/overhang belong to the bases tab.
    const tab = paramTab(key); if (tab) markDirty(tab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setTrapezoidConfigs, paramTab, markDirty, trapezoidConfigs, appDefaults])

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
    updateSetting, applySection,
    updateGlobalSetting, updateLineRails,
    resetDetailSettings, resetLineRails,
    getTrapBasesSettings, updateTrapBaseSetting, resetTrapBases,
    dirty, markDirty, markClean,
    isAnyDirty: dirty.rails || dirty.bases || dirty.detail,
    onSettingsChange,
  }
}
