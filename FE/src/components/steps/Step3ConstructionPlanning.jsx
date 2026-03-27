import { useState, useMemo, useEffect, useCallback } from 'react'
import { useLang } from '../../i18n/LangContext'
import { TEXT, TEXT_PLACEHOLDER, TEXT_VERY_LIGHT, BORDER_FAINT, BG_LIGHT } from '../../styles/colors'
import {
  computeRowConstruction,
  assignTypes,
} from '../../utils/constructionCalculator'
import RailLayoutTab from './step3/RailLayoutTab'
import BasesPlanTab  from './step3/BasesPlanTab'
import { initDefaultLineRails, railOffsetFromSpacing, MIN_RAIL_SPACING_VERTICAL_CM, MIN_RAIL_SPACING_HORIZONTAL_CM } from '../../utils/railLayoutService'
import { computeAreaRailData } from '../../utils/railService'
import { isHorizontalOrientation, isEmptyOrientation, lineSlopeDepth, computeTotalSlopeDepth, PANEL_DEPTH_HORIZONTAL, PANEL_GAP_CM } from '../../utils/trapezoidGeometry'
import { ACCENT, PARAM_GROUP, SETTINGS_DEFAULTS, PARAM_SCHEMA } from './step3/constants'
import { DEFAULT_BASE_EDGE_OFFSET_MM, DEFAULT_BASE_SPACING_MM, DEFAULT_BASE_OVERHANG_CM } from '../../utils/basePlanService'
import Step3Sidebar from './step3/Step3Sidebar'
import AreasTab from './step3/AreasTab'
import DetailView from './step3/DetailView'


// ─── Helpers ─────────────────────────────────────────────────────────────────

// Compute horizontal base-beam span from actual first-to-last rail positions across all
// panel lines.  lineRails: { [li]: [offsetCm, ...] }, offsets measured from each line's
// front edge.  getLineDepth(li) → slope depth (cm) for line li.
function computeBaseLengthFromRails(lineOrientations, lineRails, angleRad, getLineDepth) {
  let dCm = 0
  let firstRailGlobal = null
  let lastRailGlobal  = null
  for (let li = 0; li < lineOrientations.length; li++) {
    if (li > 0) dCm += PANEL_GAP_CM
    for (const r of (lineRails[li] ?? [])) {
      const g = dCm + r
      if (firstRailGlobal === null) firstRailGlobal = g
      lastRailGlobal = g
    }
    dCm += getLineDepth(li)
  }
  if (firstRailGlobal == null || lastRailGlobal == null || lastRailGlobal <= firstRailGlobal) return null
  return Math.cos(angleRad) * (lastRailGlobal - firstRailGlobal)
}

// ─── Main Step3 component ────────────────────────────────────────────────────

export default function Step3ConstructionPlanning({ panels = [], panelGrid = {}, refinedArea, trapezoidConfigs = {}, setTrapezoidConfigs, areas = [], initialGlobalSettings = null, initialAreaSettings = null, onSettingsChange, onBOMDataChange, onPdfDataChange }) {
  const { t } = useLang()
  const [selectedRowIdx, setSelectedRowIdx] = useState(0)
  const [selectedTrapezoidId, setSelectedTrapezoidId] = useState(null)
  const [activeTab, setActiveTab] = useState('areas')
  const [globalSettings, setGlobalSettings] = useState(() =>
    initialGlobalSettings ? { ...SETTINGS_DEFAULTS, ...initialGlobalSettings } : SETTINGS_DEFAULTS
  )
  const [areaSettings,   setAreaSettings]   = useState(() => initialAreaSettings   ?? {})
  const [highlightParam,  setHighlightParam]  = useState(null)
  const [customBasesMap,  setCustomBasesMap]  = useState({})

  useEffect(() => {
    onSettingsChange?.(globalSettings, areaSettings)
  }, [globalSettings, areaSettings])

  const getSettings = (areaIdx) => ({ ...globalSettings, ...(areaSettings[areaIdx] || {}) })

  const areaLabel = useCallback((areaKey, i) => {
    const g = areas[areaKey]?.label
    return g ? `${g}` : t('step3.label.area', { n: i + 1 })
  }, [areas, t])

  const updateSetting = (areaIdx, key, value) => {
    setAreaSettings(prev => ({
      ...prev,
      [areaIdx]: { ...(prev[areaIdx] || {}), [key]: value }
    }))
  }

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

  // ─── lineRails helpers ────────────────────────────────────────────────────

  // Resolve lineOrientations for an area from all config sources
  const getLineOrientations = useCallback((areaKey, trapId) => {
    const globalCfg = refinedArea?.panelConfig || {}
    const override  = trapezoidConfigs[trapId] || {}
    const areaGroup = areas[areaKey] || {}
    const linesPerRow = override.linesPerRow ?? areaGroup.linesPerRow ?? globalCfg.linesPerRow ?? 1
    return (override.lineOrientations ?? areaGroup.lineOrientations ?? globalCfg.lineOrientations ?? ['vertical']).slice(0, linesPerRow)
  }, [refinedArea, trapezoidConfigs, areas])

  // Get effective lineRails for an area (from settings or defaults)
  const getLineRails = useCallback((areaIdx, lineOrientations) => {
    const stored = areaSettings[areaIdx]?.lineRails
    if (stored && Object.keys(stored).length === lineOrientations.length) return stored
    const depths = lineOrientations.map(o => lineSlopeDepth(o))
    return initDefaultLineRails(lineOrientations, depths)
  }, [areaSettings])

  // Update lineRails for an area (called from the cross-section widget)
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

  const resetLineRails = useCallback((areaIdx) => {
    const railAreaParams   = PARAM_SCHEMA.filter(p => p.section === 'rails' && p.scope === 'area'   && p.type !== 'rail-spacing')
    const railGlobalParams = PARAM_SCHEMA.filter(p => p.section === 'rails' && p.scope === 'global')
    setAreaSettings(prev => {
      const copy = { ...(prev[areaIdx] || {}) }
      delete copy.lineRails
      railAreaParams.forEach(p => { copy[p.key] = p.default })
      return { ...prev, [areaIdx]: copy }
    })
    setGlobalSettings(prev => {
      const copy = { ...prev }
      railGlobalParams.forEach(p => { copy[p.key] = p.default })
      return copy
    })
  }, [])

  // ─── Per-trapezoid bases settings ─────────────────────────────────────────

  const TRAP_BASES_KEYS = ['edgeOffsetMm', 'spacingMm', 'baseOverhangCm']

  const getTrapBasesSettings = useCallback((trapId) => {
    const cfg = trapezoidConfigs[trapId] || {}
    return {
      edgeOffsetMm:   cfg.edgeOffsetMm   ?? DEFAULT_BASE_EDGE_OFFSET_MM,
      spacingMm:      cfg.spacingMm      ?? DEFAULT_BASE_SPACING_MM,
      baseOverhangCm: cfg.baseOverhangCm ?? DEFAULT_BASE_OVERHANG_CM,
    }
  }, [trapezoidConfigs])

  const updateTrapBaseSetting = useCallback((trapId, key, value) => {
    if (!setTrapezoidConfigs) return
    setTrapezoidConfigs(prev => ({
      ...prev,
      [trapId]: { ...(prev[trapId] || {}), [key]: value }
    }))
  }, [setTrapezoidConfigs])

  const resetTrapBases = useCallback((trapId) => {
    setCustomBasesMap(prev => { const c = { ...prev }; delete c[trapId]; return c })
    if (!setTrapezoidConfigs) return
    setTrapezoidConfigs(prev => {
      const copy = { ...(prev[trapId] || {}) }
      TRAP_BASES_KEYS.forEach(k => delete copy[k])
      return { ...prev, [trapId]: copy }
    })
  }, [setTrapezoidConfigs]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Row data ─────────────────────────────────────────────────────────────

  const rowPanelCounts = useMemo(() => {
    const map = {}
    panels.forEach(p => {
      const key = (p.area ?? p.row) ?? 'unassigned'
      map[key] = (map[key] || 0) + 1
    })
    return map
  }, [panels])

  const rowKeys = useMemo(() =>
    Object.keys(rowPanelCounts).filter(k => k !== 'unassigned').map(Number).sort((a, b) => a - b),
    [rowPanelCounts]
  )
  const rowLabels = useMemo(() => rowKeys.map((rk, i) => areaLabel(rk, i)), [rowKeys, areaLabel])

  const areaTrapezoidMap = useMemo(() => {
    const map = {}
    rowKeys.forEach(areaKey => {
      const letter = String.fromCharCode(65 + areaKey)
      const ids = [...new Set(
        panels
          .filter(p => (p.area ?? p.row) === areaKey)
          .map(p => p.trapezoidId)
          .filter(Boolean)
      )].sort()
      map[areaKey] = ids.length > 0 ? ids : [`${letter}1`]
    })
    return map
  }, [panels, rowKeys])

  const effectiveSelectedTrapId = selectedTrapezoidId ??
    (rowKeys[selectedRowIdx] != null ? (areaTrapezoidMap[rowKeys[selectedRowIdx]]?.[0] ?? null) : null)

  const applyBasesToAll = useCallback(() => {
    if (!setTrapezoidConfigs || !effectiveSelectedTrapId) return
    const trapBases = getTrapBasesSettings(effectiveSelectedTrapId)
    const allTrapIds = Object.values(areaTrapezoidMap).flat()
    setTrapezoidConfigs(prev => {
      const next = { ...prev }
      allTrapIds.forEach(trapId => {
        next[trapId] = { ...(prev[trapId] || {}), ...trapBases }
      })
      return next
    })
  }, [getTrapBasesSettings, effectiveSelectedTrapId, areaTrapezoidMap, setTrapezoidConfigs])

  // ─── Construction calculations ────────────────────────────────────────────

  const rowConstructions = useMemo(() => {
    const spec = (() => {
      const p = panels.find(p => p.widthCm && p.heightCm)
      return p
        ? { widthCm: Math.min(p.widthCm, p.heightCm), lengthCm: Math.max(p.widthCm, p.heightCm) }
        : { widthCm: 113.4, lengthCm: 238.2 }
    })()

    const rcs = rowKeys.map((areaKey, i) => {
      const panelCount = rowPanelCounts[areaKey] || 1
      const globalCfg  = refinedArea?.panelConfig || {}
      const trapId     = areaTrapezoidMap[areaKey]?.[0] ?? `${String.fromCharCode(65 + areaKey)}1`
      const override   = trapezoidConfigs[trapId] || {}
      const angle      = override.angle ?? globalCfg.angle ?? 0
      const panelFrontH = override.frontHeight ?? globalCfg.frontHeight ?? 0
      const s          = getSettings(i)
      const trapBases  = getTrapBasesSettings(trapId)
      const railOverhang = s.railOverhangCm
      const maxSpan      = (trapBases.spacingMm ?? 2000) / 10
      const angleRad0    = angle * Math.PI / 180
      const crossRailH0  = (s.crossRailEdgeDistMm ?? 40) / 10

      const lineOrientations = getLineOrientations(areaKey, trapId)
      const lineRails        = getLineRails(i, lineOrientations)
      // Front rail offset from panel edge = first rail of first line
      const railOffsetCm = lineRails[0]?.[0] ?? 0
      const frontLegH    = Math.max(0, panelFrontH - s.blockHeightCm + railOffsetCm * Math.sin(angleRad0) - crossRailH0 * Math.cos(angleRad0))

      const areaLabel = areas[areaKey]?.label
      const areaGrid  = areaLabel ? panelGrid[areaLabel] : null
      const { rails, numLargeGaps } = areaGrid
        ? computeAreaRailData(areaGrid, spec, { lineRails, overhangCm: railOverhang, stockLengths: s.stockLengths })
        : { rails: [], numLargeGaps: 0 }

      const measuredRowLength  = rails.length > 0 ? Math.max(...rails.map(r => r.endCm - r.startCm)) : undefined
      const measuredLineDepth  = lineOrientations.length > 0 ? computeTotalSlopeDepth(lineOrientations, lineOrientations.length) : undefined
      const numRailConnectors  = rails.reduce((sum, r) => sum + Math.max(0, r.stockSegments.length - 1), 0)

      const computedBaseLength = computeBaseLengthFromRails(
        lineOrientations, lineRails, angleRad0, (li) => lineSlopeDepth(lineOrientations[li])
      )

      const numRails    = Object.values(lineRails).reduce((sum, arr) => sum + arr.length, 0)
      const linesPerRow = Object.keys(lineRails).length
      const rc = computeRowConstruction(panelCount, angle, frontLegH, {
        railOverhang,
        maxSpan,
        railOffsetCm,
        baseOverhangCm: trapBases.baseOverhangCm ?? 0,
        crossRailOffsetCm: s.crossRailOffsetCm,
        ...(computedBaseLength != null ? { baseLength: computedBaseLength } : {}),
        ...(measuredRowLength != null ? { rowLength: measuredRowLength } : {}),
        ...(measuredLineDepth != null ? { lineDepthCm: measuredLineDepth } : {}),
      })
      return { ...rc, numRails, linesPerRow, numLargeGaps, numRailConnectors }
    })
    return assignTypes(rcs)
  }, [rowKeys, rowPanelCounts, refinedArea, trapezoidConfigs, areaSettings, globalSettings, panels, panelGrid, areas, areaTrapezoidMap, getTrapBasesSettings])

  useEffect(() => {
    onBOMDataChange?.({ rowConstructions, rowLabels })
  }, [rowConstructions, rowLabels])


const selectedRC = rowConstructions[selectedRowIdx] ?? null

  const selectedTrapezoidRC = useMemo(() => {
    if (selectedRowIdx == null) return null
    const areaKey = rowKeys[selectedRowIdx]
    if (areaKey == null) return null
    const trapId = effectiveSelectedTrapId
    if (!trapId) return null

    const globalCfg   = refinedArea?.panelConfig || {}
    const override    = trapezoidConfigs[trapId] || {}
    const angle       = override.angle ?? globalCfg.angle ?? 0
    const panelFrontH = override.frontHeight ?? globalCfg.frontHeight ?? 0
    const s           = getSettings(selectedRowIdx)
    const trapBases1  = getTrapBasesSettings(trapId)
    const railOverhang = s.railOverhangCm
    const maxSpan      = (trapBases1.spacingMm ?? 2000) / 10
    const portraitDepthCm = s.panelLengthCm ?? 238.2
    const angleRad1    = angle * Math.PI / 180
    const crossRailH1  = (s.crossRailEdgeDistMm ?? 40) / 10

    const lineOrientations = getLineOrientations(areaKey, trapId)
    const lineRails        = getLineRails(selectedRowIdx, lineOrientations)
    const railOffsetCm     = lineRails[0]?.[0] ?? 0
    const frontLegH        = Math.max(0, panelFrontH - s.blockHeightCm + railOffsetCm * Math.sin(angleRad1) - crossRailH1 * Math.cos(angleRad1))

    const lineDepthCm = lineOrientations.reduce((sum, o, i) =>
      sum + (isHorizontalOrientation(o) ? PANEL_DEPTH_HORIZONTAL : portraitDepthCm) + (i > 0 ? PANEL_GAP_CM : 0), 0)

    const computedBaseLength = computeBaseLengthFromRails(
      lineOrientations, lineRails, angleRad1,
      (li) => isHorizontalOrientation(lineOrientations[li]) ? PANEL_DEPTH_HORIZONTAL : portraitDepthCm
    )

    const [rc] = assignTypes([computeRowConstruction(1, angle, frontLegH, {
      railOverhang,
      maxSpan,
      lineDepthCm,
      railOffsetCm,
      baseOverhangCm: trapBases1.baseOverhangCm ?? 0,
      crossRailOffsetCm: s.crossRailOffsetCm,
      ...(computedBaseLength != null ? { baseLength: computedBaseLength } : {}),
    })])
    return rc
  }, [effectiveSelectedTrapId, selectedRowIdx, rowKeys, refinedArea, trapezoidConfigs, areaSettings, globalSettings, areas, getTrapBasesSettings])

  const selectedRowLineDepths = useMemo(() => {
    if (selectedRowIdx == null) return null
    const trapId = effectiveSelectedTrapId
    if (!trapId) return null

    const globalCfg  = refinedArea?.panelConfig || {}
    const override   = trapezoidConfigs[trapId] || {}
    const areaKey2   = rowKeys[selectedRowIdx]
    const areaGroup2 = areas[areaKey2] || {}
    const linesPerRow = override.linesPerRow ?? areaGroup2.linesPerRow ?? globalCfg.linesPerRow ?? 1
    const lineOrientations = (override.lineOrientations ?? areaGroup2.lineOrientations ?? globalCfg.lineOrientations ?? ['vertical']).slice(0, linesPerRow)
    const s = getSettings(selectedRowIdx)
    const portraitDepthCm = s.panelLengthCm ?? 238.2

    return lineOrientations.map((o, i) => ({
      depthCm: isHorizontalOrientation(o) ? PANEL_DEPTH_HORIZONTAL : portraitDepthCm,
      gapBeforeCm: i === 0 ? 0 : PANEL_GAP_CM,
      isEmpty: isEmptyOrientation(o),
      isHorizontal: isHorizontalOrientation(o),
    }))
  }, [effectiveSelectedTrapId, refinedArea, trapezoidConfigs, selectedRowIdx, areaSettings, globalSettings, areas, rowKeys])

  // lineRails for the selected row (for RailLayoutTab / sidebar widget)
  const selectedLineOrientations = useMemo(() => {
    const areaKey = rowKeys[selectedRowIdx]
    if (areaKey == null) return ['vertical']
    const trapId = effectiveSelectedTrapId ?? `${String.fromCharCode(65 + areaKey)}1`
    return getLineOrientations(areaKey, trapId)
  }, [selectedRowIdx, rowKeys, effectiveSelectedTrapId, getLineOrientations])

  const selectedLineRails = useMemo(() =>
    getLineRails(selectedRowIdx, selectedLineOrientations),
    [selectedRowIdx, selectedLineOrientations, getLineRails]
  )

  const selectedLinePanelDepths = useMemo(() =>
    selectedLineOrientations.map(o => lineSlopeDepth(o)),
    [selectedLineOrientations]
  )

  // ─── Per-trapezoid derived maps (for BasesPlanTab) ────────────────────────

  // lineRails per trapezoid — same as area's lineRails (rails span the full row)
  const trapLineRailsMap = useMemo(() => {
    const map = {}
    rowKeys.forEach((areaKey, i) => {
      const trapIds = areaTrapezoidMap[areaKey] || []
      const lineOrs = getLineOrientations(areaKey, trapIds[0] ?? `${String.fromCharCode(65 + areaKey)}1`)
      const rails   = getLineRails(i, lineOrs)
      trapIds.forEach(trapId => { map[trapId] = rails })
    })
    return map
  }, [rowKeys, areaTrapezoidMap, getLineOrientations, getLineRails])

  // Merged settings per trapezoid: area-level (global+area) + trap-level bases
  const trapSettingsMap = useMemo(() => {
    const map = {}
    rowKeys.forEach((areaKey, i) => {
      const s = getSettings(i)
      const trapIds = areaTrapezoidMap[areaKey] || []
      trapIds.forEach(trapId => {
        map[trapId] = { ...s, ...getTrapBasesSettings(trapId) }
      })
    })
    return map
  }, [rowKeys, areaTrapezoidMap, areaSettings, globalSettings, trapezoidConfigs, getTrapBasesSettings]) // eslint-disable-line react-hooks/exhaustive-deps

  // Row construction per trapezoid (for type label on bases canvas)
  const trapRCMap = useMemo(() => {
    const map = {}
    rowKeys.forEach((areaKey, i) => {
      const trapIds = areaTrapezoidMap[areaKey] || []
      trapIds.forEach(trapId => { map[trapId] = rowConstructions[i] })
    })
    return map
  }, [rowKeys, areaTrapezoidMap, rowConstructions])

  // Panel lines (segment descriptors) per trapezoid — mirrors selectedRowLineDepths logic
  const trapPanelLinesMap = useMemo(() => {
    const map = {}
    const globalCfg = refinedArea?.panelConfig || {}
    rowKeys.forEach((areaKey, rowIdx) => {
      const trapIdsList = areaTrapezoidMap[areaKey] || []
      const areaGroup   = areas[areaKey] || {}
      const s           = getSettings(rowIdx)
      const portraitDepthCm = s.panelLengthCm ?? 238.2
      trapIdsList.forEach(trapId => {
        const override = trapezoidConfigs[trapId] || {}
        const linesPerRow = override.linesPerRow ?? areaGroup.linesPerRow ?? globalCfg.linesPerRow ?? 1
        const lineOrientations = (override.lineOrientations ?? areaGroup.lineOrientations ?? globalCfg.lineOrientations ?? ['vertical']).slice(0, linesPerRow)
        map[trapId] = lineOrientations.map((o, i) => ({
          depthCm:     isHorizontalOrientation(o) ? PANEL_DEPTH_HORIZONTAL : portraitDepthCm,
          gapBeforeCm: i === 0 ? 0 : PANEL_GAP_CM,
          isEmpty:     isEmptyOrientation(o),
          isHorizontal: isHorizontalOrientation(o),
        }))
      })
    })
    return map
  }, [rowKeys, areaTrapezoidMap, areas, refinedArea, trapezoidConfigs, areaSettings, globalSettings]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onPdfDataChange?.({ trapSettingsMap, trapLineRailsMap, trapRCMap, customBasesMap, trapPanelLinesMap })
  }, [trapSettingsMap, trapLineRailsMap, trapRCMap, customBasesMap, trapPanelLinesMap])

  // ─── Rail spacing derived from lineRails (source of truth) ───────────────

  // Derive per-orientation spacing from current lineRails (first 2 rails of each line type)
  const derivedRailSpacings = useMemo(() => {
    let vertical = null, horizontal = null
    selectedLineOrientations.forEach((o, li) => {
      const rails = selectedLineRails[li] ?? []
      if (rails.length >= 2) {
        const spacing = Math.round((rails[rails.length - 1] - rails[0]) * 10) / 10
        if (isHorizontalOrientation(o)) { if (horizontal == null) horizontal = spacing }
        else                            { if (vertical   == null) vertical   = spacing }
      }
    })
    return {
      vertical:   vertical   ?? 140,
      horizontal: horizontal ?? 70,
    }
  }, [selectedLineRails, selectedLineOrientations])

  // Change spacing → recompute lineRails symmetrically for all lines of that orientation
  const onRailSpacingChange = useCallback((orientation, newSpacingCm) => {
    const isH = orientation === 'horizontal'
    const minSpacing = isH ? MIN_RAIL_SPACING_HORIZONTAL_CM : MIN_RAIL_SPACING_VERTICAL_CM
    const newRails = { ...selectedLineRails }
    selectedLineOrientations.forEach((o, li) => {
      if (isHorizontalOrientation(o) !== isH) return
      const depth   = selectedLinePanelDepths[li]
      const spacing = Math.min(Math.max(newSpacingCm, minSpacing), depth * 0.9)
      const offset  = railOffsetFromSpacing(depth, spacing)
      newRails[li]  = [Math.round(offset * 10) / 10, Math.round((depth - offset) * 10) / 10]
    })
    updateLineRails(selectedRowIdx, newRails)
  }, [selectedLineRails, selectedLineOrientations, selectedLinePanelDepths, selectedRowIdx, updateLineRails])

  // Write a key directly to globalSettings (for truly global params like stockLengths)
  const updateGlobalSetting = useCallback((key, value) => {
    setGlobalSettings(prev => ({ ...prev, [key]: value }))
  }, [])

  // Copy all per-area rail parameters from the selected area to every other area.
  // railOverhangCm and keepSymmetry are copied as-is; lineRails are recalculated
  // from the derived spacing but adjusted for each area's own panel depth.
  const applyRailsToAllAreas = useCallback(() => {
    const s    = getSettings(selectedRowIdx)
    const snap = v => Math.round(v * 10) / 10
    const spacings = derivedRailSpacings
    setAreaSettings(prev => {
      const next = { ...prev }
      rowKeys.forEach((areaKey, areaIdx) => {
        if (areaIdx === selectedRowIdx) return
        const trapId = areaTrapezoidMap[areaKey]?.[0] ?? `${String.fromCharCode(65 + areaKey)}1`
        const orientations = getLineOrientations(areaKey, trapId)
        const depths = orientations.map(o => lineSlopeDepth(o))
        const newRails = {}
        orientations.forEach((o, li) => {
          const isH = isHorizontalOrientation(o)
          const spacing = isH ? spacings.horizontal : spacings.vertical
          const depth = depths[li]
          const minSpacing = isH ? MIN_RAIL_SPACING_HORIZONTAL_CM : MIN_RAIL_SPACING_VERTICAL_CM
          const clamped = Math.min(Math.max(spacing, minSpacing), depth * 0.9)
          const offset = railOffsetFromSpacing(depth, clamped)
          newRails[li] = [snap(offset), snap(depth - offset)]
        })
        const areaOverrides = Object.fromEntries(
          PARAM_SCHEMA
            .filter(p => p.section === 'rails' && p.scope === 'area' && p.type !== 'rail-spacing')
            .map(p => [p.key, s[p.key] ?? p.default])
        )
        next[areaIdx] = { ...(prev[areaIdx] || {}), ...areaOverrides, lineRails: newRails }
      })
      return next
    })
  }, [derivedRailSpacings, rowKeys, selectedRowIdx, areaTrapezoidMap, getLineOrientations, getSettings])

  // ─── Tabs ─────────────────────────────────────────────────────────────────

  const tabs = [
    { key: 'areas',  label: t('step3.tabs.areas') },
    { key: 'rails',  label: t('step3.tabs.rails') },
    { key: 'bases',  label: t('step3.tabs.bases') },
    { key: 'detail', label: t('step3.tabs.detail') },
  ]

  if (rowKeys.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: TEXT_VERY_LIGHT, fontSize: '0.95rem' }}>
        {t('step3.empty.noAreas')}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: 'white' }}>
      <style>{`@keyframes hlPulse { 0%,100%{opacity:0.15} 50%{opacity:0.9} }`}</style>

      {/* ── Left sidebar ── */}
      <Step3Sidebar
        rowConstructions={rowConstructions} rowKeys={rowKeys}
        areaTrapezoidMap={areaTrapezoidMap} areaLabel={areaLabel}
        selectedRowIdx={selectedRowIdx} setSelectedRowIdx={setSelectedRowIdx}
        selectedTrapezoidId={selectedTrapezoidId} setSelectedTrapezoidId={setSelectedTrapezoidId}
        effectiveSelectedTrapId={effectiveSelectedTrapId}
        trapezoidConfigs={trapezoidConfigs} panels={panels}
        activeTab={activeTab} setActiveTab={setActiveTab}
        selectedRC={selectedRC} getSettings={getSettings}
        updateSetting={updateSetting} applySection={applySection}
        highlightParam={highlightParam} setHighlightParam={setHighlightParam}
        areaSettings={areaSettings}
        globalSettings={globalSettings}
        updateGlobalSetting={updateGlobalSetting}
        derivedRailSpacings={derivedRailSpacings}
        lineOrientations={selectedLineOrientations}
        panelDepthsCm={selectedLinePanelDepths}
        onRailSpacingChange={onRailSpacingChange}
        onApplyRailsToAllAreas={applyRailsToAllAreas}
        getTrapBasesSettings={getTrapBasesSettings}
        updateTrapBaseSetting={updateTrapBaseSetting}
        applyBasesToAll={applyBasesToAll}
      />

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Tab bar */}
        <div style={{
          display: 'flex', borderBottom: `2px solid ${BORDER_FAINT}`,
          background: BG_LIGHT, padding: '0 1rem', gap: '0.25rem'
        }}>
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '0.55rem 1rem', border: 'none', cursor: 'pointer',
                fontSize: '0.8rem', fontWeight: '600',
                background: activeTab === tab.key ? 'white' : 'transparent',
                color: activeTab === tab.key ? TEXT : TEXT_PLACEHOLDER,
                borderBottom: activeTab === tab.key ? `2px solid ${ACCENT}` : '2px solid transparent',
                marginBottom: '-2px', transition: 'all 0.15s'
              }}
            >{tab.label}</button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {activeTab === 'areas'  && <AreasTab panels={panels} areas={areas} rowKeys={rowKeys} areaLabel={areaLabel} />}
          {activeTab === 'detail' && <div style={{ height: '100%', overflow: 'hidden' }}><DetailView rc={selectedTrapezoidRC ?? selectedRC} trapId={effectiveSelectedTrapId} panelLines={selectedRowLineDepths} settings={getSettings(selectedRowIdx)} lineRails={selectedLineRails} highlightParam={highlightParam} onReset={() => resetDetailSettings(selectedRowIdx)} onUpdateSetting={(key, val) => updateSetting(selectedRowIdx, key, val)} /></div>}

          {activeTab === 'rails'  && (
            <div style={{ height: '100%', overflow: 'hidden' }}>
              <RailLayoutTab
                panels={panels} refinedArea={refinedArea}
                selectedRowIdx={selectedRowIdx}
                settings={getSettings(selectedRowIdx)}
                lineRails={selectedLineRails}
                lineOrientations={selectedLineOrientations}
                panelDepthsCm={selectedLinePanelDepths}
                keepSymmetry={getSettings(selectedRowIdx).keepSymmetry ?? true}
                onLineRailsChange={(newRails) => updateLineRails(selectedRowIdx, newRails)}
                onApplyRailsToAll={() => applySection(selectedRowIdx, ['lineRails'])}
                onResetRails={() => resetLineRails(selectedRowIdx)}
                highlightGroup={PARAM_GROUP[highlightParam] ?? null}
              />
            </div>
          )}
          <div style={{ display: activeTab === 'bases' ? 'flex' : 'none', height: '100%', flexDirection: 'column' }}>
            <BasesPlanTab
              panels={panels} refinedArea={refinedArea}
              effectiveSelectedTrapId={effectiveSelectedTrapId}
              trapSettingsMap={trapSettingsMap}
              trapLineRailsMap={trapLineRailsMap}
              trapRCMap={trapRCMap}
              highlightGroup={PARAM_GROUP[highlightParam] ?? null}
              customBasesMap={customBasesMap}
              onBasesChange={(trapId, offsets) =>
                setCustomBasesMap(prev => ({ ...prev, [trapId]: offsets }))
              }
              onResetBases={() => resetTrapBases(effectiveSelectedTrapId)}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
