import { useState, useCallback } from 'react'
import { useLang } from '../i18n/LangContext'

/**
 * Manages Step 3 hierarchical settings: global → area → trapezoid.
 * Returns getters, setters, and apply/reset helpers.
 */
export default function useStep3Settings({
  initialGlobalSettings, initialAreaSettings, SETTINGS_DEFAULTS, PARAM_SCHEMA,
  appDefaults, panelSpec, trapezoidConfigs, setTrapezoidConfigs, areas,
  onTabSave, onTabReset, onSettingsChange,
}) {
  const { t } = useLang()
  const panelLengthCm = panelSpec.lengthCm
  const panelWidthCm  = panelSpec.widthCm

  const [globalSettings, setGlobalSettings] = useState(() =>
    initialGlobalSettings ? { ...SETTINGS_DEFAULTS, ...initialGlobalSettings } : SETTINGS_DEFAULTS
  )
  const [areaSettings, setAreaSettings] = useState(() => initialAreaSettings ?? {})

  // ── Merged settings for a given area ────────────────────────────────────
  const getSettings = (areaIdx) => ({ panelLengthCm, panelWidthCm, ...globalSettings, ...(areaSettings[areaIdx] || {}) })

  const areaLabel = useCallback((areaKey, i) => {
    const g = areas[areaKey]?.label
    return g ? `${g}` : t('step3.label.area', { n: i + 1 })
  }, [areas, t])

  // ── Area-level setting update ───────────────────────────────────────────
  const updateSetting = (areaIdx, key, value) => {
    setAreaSettings(prev => ({
      ...prev,
      [areaIdx]: { ...(prev[areaIdx] || {}), [key]: value }
    }))
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
  }

  // ── Global setting update ───────────────────────────────────────────────
  const updateGlobalSetting = useCallback((key, value) => {
    setGlobalSettings(prev => ({ ...prev, [key]: value }))
  }, [])

  // ── LineRails helpers ───────────────────────────────────────────────────
  const updateLineRails = useCallback((areaIdx, newLineRails) => {
    setAreaSettings(prev => ({
      ...prev,
      [areaIdx]: { ...(prev[areaIdx] || {}), lineRails: newLineRails }
    }))
  }, [])

  const resetDetailSettings = useCallback((areaIdx) => {
    const detailParams = PARAM_SCHEMA.filter(p => p.section === 'detail')
    setAreaSettings(prev => {
      const copy = { ...(prev[areaIdx] || {}) }
      detailParams.forEach(p => delete copy[p.key])
      delete copy.diagOverrides
      return { ...prev, [areaIdx]: copy }
    })
  }, [])

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
  }, [onTabReset, PARAM_SCHEMA]) // eslint-disable-line react-hooks/exhaustive-deps

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
    setTrapezoidConfigs(prev => ({
      ...prev,
      [trapId]: { ...(prev[trapId] || {}), [key]: value }
    }))
  }, [setTrapezoidConfigs])

  const resetTrapBases = useCallback((trapId, customBasesHandlers) => {
    customBasesHandlers?.clearTrap(trapId)
    if (!setTrapezoidConfigs) return
    setTrapezoidConfigs(prev => {
      const copy = { ...(prev[trapId] || {}) }
      TRAP_BASES_KEYS.forEach(k => delete copy[k])
      return { ...prev, [trapId]: copy }
    })
    onTabSave?.('bases', { resetTrapId: trapId })
  }, [setTrapezoidConfigs, onTabSave]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    globalSettings, setGlobalSettings,
    areaSettings, setAreaSettings,
    getSettings, areaLabel,
    updateSetting, applySection,
    updateGlobalSetting, updateLineRails,
    resetDetailSettings, resetLineRails,
    getTrapBasesSettings, updateTrapBaseSetting, resetTrapBases,
    onSettingsChange,
  }
}
