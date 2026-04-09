import { useState, useEffect, useMemo } from 'react'
import { SAM2Service } from '../services/sam2Service'
import { fetchPanelTypes, fetchAppDefaults, fetchProducts } from '../services/projectsApi'
import { PANEL_V, PANEL_H } from '../utils/panelCodes.js'

const DEFAULT_PANEL_TYPE = { id: 'AIKO-G670-MCH72Mw', name: 'AIKO G670', lengthCm: 238.2, widthCm: 113.4, kw: 670 }

/**
 * App-level configuration: panel types, app settings (param schema), products, backend status.
 * Fetched once on mount. Not project-specific — shared across all projects.
 *
 * @param {object} options
 * @param {string} options.panelType  - current project's panel type ID (for panelSpec resolution)
 * @param {object} options.currentProject - current project object (for roofType filtering)
 */
export default function useAppConfig({ panelType, currentProject }) {
  // ── Panel types ──
  const [panelTypes, setPanelTypes] = useState([])

  // ── App settings (param schema from app_settings table) ──
  const [appSettingsRaw, setAppSettingsRaw] = useState(null)

  const appDefaults = useMemo(() => {
    if (!appSettingsRaw) return null
    return Object.fromEntries(appSettingsRaw.map(s => [s.key, s.value_json]))
  }, [appSettingsRaw])

  const paramSchema = useMemo(() => {
    if (!appSettingsRaw) return []
    return appSettingsRaw.map(s => ({
      key: s.key,
      label: s.label,
      section: s.section,
      scope: s.scope,
      type: s.param_type,
      default: s.value_json,
      min: s.min_val,
      max: s.max_val,
      step: s.step_val,
      highlightGroup: s.highlight_group,
      orientation: s.key === 'railSpacingV' ? PANEL_V : s.key === 'railSpacingH' ? PANEL_H : undefined,
      visible: s.visible ?? true,
      roofTypes: s.roof_types ?? null,
    }))
  }, [appSettingsRaw])

  const paramSchemaForRoof = useMemo(() => {
    const roofType = currentProject?.roofSpec?.type || 'concrete'
    return paramSchema.filter(p => p.roofTypes === null || (Array.isArray(p.roofTypes) && p.roofTypes.includes(roofType)))
  }, [paramSchema, currentProject])

  const settingsDefaults = useMemo(() => {
    if (!paramSchema.length) return {}
    return Object.fromEntries(
      paramSchema.filter(p => p.type !== 'rail-spacing').map(p => [p.key, p.default])
    )
  }, [paramSchema])

  const paramGroup = useMemo(() => {
    return Object.fromEntries(
      paramSchema.filter(p => p.highlightGroup != null).map(p => [p.key, p.highlightGroup])
    )
  }, [paramSchema])

  // ── Products (materials for BOM) ──
  const [products, setProducts] = useState([])
  const productByType = useMemo(() => Object.fromEntries(products.map(p => [p.type, p])), [products])
  const altsByType = useMemo(() => {
    const groups = {}
    products.forEach(p => {
      if (p.altGroup != null) {
        if (!groups[p.altGroup]) groups[p.altGroup] = []
        groups[p.altGroup].push(p)
      }
    })
    return Object.fromEntries(
      products
        .filter(p => p.altGroup != null)
        .map(p => [p.type, groups[p.altGroup].filter(a => a.type !== p.type)])
    )
  }, [products])

  // ── Resolved panel spec ──
  const panelSpec = panelTypes.find(t => t.id === panelType) ?? panelTypes[0] ?? DEFAULT_PANEL_TYPE

  // ── Backend health ──
  const [backendStatus, setBackendStatus] = useState({ status: 'checking', model_loaded: false })

  const checkBackend = async () => {
    const status = await SAM2Service.checkHealth()
    setBackendStatus(status)
  }

  // ── Fetch on mount ──
  useEffect(() => { checkBackend() }, [])

  useEffect(() => {
    fetchPanelTypes()
      .then(types => { if (types.length > 0) setPanelTypes(types.map(t => ({ id: t.type_key, name: t.name, lengthCm: t.length_cm, widthCm: t.width_cm, kw: t.kw_peak }))) })
      .catch(() => { /* keep hardcoded fallback */ })
    fetchAppDefaults()
      .then(setAppSettingsRaw)
      .catch(() => { /* keep null — callers must handle */ })
    fetchProducts()
      .then(items => setProducts(items.map(p => ({
        type: p.type_key, pn: p.part_number ?? '', name: p.name,
        extraPct: p.extra ? parseInt(p.extra) || 0 : 0,
        altGroup: p.alt_group, isDefault: p.is_default,
      }))))
      .catch(() => { /* products stay empty */ })
  }, [])

  const refreshAppSettings = () => {
    fetchAppDefaults().then(setAppSettingsRaw).catch(() => {})
  }

  return {
    panelTypes, panelSpec,
    appDefaults, paramSchema, paramSchemaForRoof, settingsDefaults, paramGroup,
    products, productByType, altsByType,
    backendStatus,
    refreshAppSettings,
  }
}
