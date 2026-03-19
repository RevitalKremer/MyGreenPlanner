import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  computeRowConstruction,
  assignTypes,
} from '../../utils/constructionCalculator'
import RailLayoutTab from './step4/RailLayoutTab'
import BasesPlanTab  from './step4/BasesPlanTab'
import { computeRowRailLayout, initDefaultLineRails, railOffsetFromSpacing, MIN_RAIL_SPACING_VERTICAL_CM, MIN_RAIL_SPACING_HORIZONTAL_CM } from '../../utils/railLayoutService'
import { isHorizontalOrientation, isEmptyOrientation, lineSlopeDepth, PANEL_DEPTH_HORIZONTAL, PANEL_GAP_CM } from '../../utils/trapezoidGeometry'
import { ACCENT, PARAM_GROUP, SETTINGS_DEFAULTS, PARAM_SCHEMA } from './step4/constants'
import Step4Sidebar from './step4/Step4Sidebar'
import LayoutView from './step4/LayoutView'
import RowsView from './step4/RowsView'
import DetailView from './step4/DetailView'
import BOMView from './step4/BOMView'

// ─── Main Step4 component ────────────────────────────────────────────────────

export default function Step4ConstructionPlanning({ panels = [], refinedArea, trapezoidConfigs = {}, areas = [], initialGlobalSettings = null, initialAreaSettings = null, onSettingsChange }) {
  const [selectedRowIdx, setSelectedRowIdx] = useState(0)
  const [selectedTrapezoidId, setSelectedTrapezoidId] = useState(null)
  const [activeTab, setActiveTab] = useState('rails')
  const [globalSettings, setGlobalSettings] = useState(() => initialGlobalSettings ?? SETTINGS_DEFAULTS)
  const [areaSettings,   setAreaSettings]   = useState(() => initialAreaSettings   ?? {})
  const [highlightParam,  setHighlightParam]  = useState(null)
  const [customBasesMap,  setCustomBasesMap]  = useState({})

  useEffect(() => {
    onSettingsChange?.(globalSettings, areaSettings)
  }, [globalSettings, areaSettings])

  const getSettings = (areaIdx) => ({ ...globalSettings, ...(areaSettings[areaIdx] || {}) })

  const areaLabel = (areaKey, i) => {
    const g = areas[areaKey]?.label
    return g ? `${g}` : `Area ${i + 1}`
  }

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

  // Reset all per-area rails settings back to factory defaults for this area.
  const resetBases = useCallback((areaIdx) => {
    const basesAreaParams = PARAM_SCHEMA.filter(p => p.section === 'bases' && p.scope === 'area')
    setCustomBasesMap(prev => { const c = { ...prev }; delete c[areaIdx]; return c })
    setAreaSettings(prev => {
      const copy = { ...(prev[areaIdx] || {}) }
      basesAreaParams.forEach(p => { copy[p.key] = p.default })
      return { ...prev, [areaIdx]: copy }
    })
  }, [])

  const resetLineRails = useCallback((areaIdx) => {
    const railAreaParams = PARAM_SCHEMA.filter(
      p => p.section === 'rails' && p.scope === 'area' && p.type !== 'rail-spacing'
    )
    setAreaSettings(prev => {
      const copy = { ...(prev[areaIdx] || {}) }
      delete copy.lineRails
      railAreaParams.forEach(p => { copy[p.key] = p.default })
      return { ...prev, [areaIdx]: copy }
    })
  }, [])

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
  const rowLabels = rowKeys.map((rk, i) => areaLabel(rk, i))

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

  // ─── Construction calculations ────────────────────────────────────────────

  const rowConstructions = useMemo(() => {
    const pixelToCmRatio = refinedArea?.pixelToCmRatio || null
    const rcs = rowKeys.map((areaKey, i) => {
      const panelCount = rowPanelCounts[areaKey] || 1
      const globalCfg  = refinedArea?.panelConfig || {}
      const trapId     = `${String.fromCharCode(65 + areaKey)}1`
      const override   = trapezoidConfigs[trapId] || {}
      const angle      = override.angle ?? globalCfg.angle ?? 0
      const panelFrontH = override.frontHeight ?? globalCfg.frontHeight ?? 0
      const s          = getSettings(i)
      const railOverhang = s.railOverhangCm
      const maxSpan      = (s.spacingMm ?? 2000) / 10
      const angleRad0    = angle * Math.PI / 180
      const crossRailH0  = (s.crossRailEdgeDistMm ?? 40) / 10

      const lineOrientations = getLineOrientations(areaKey, trapId)
      const lineRails        = getLineRails(i, lineOrientations)
      // Front rail offset from panel edge = first rail of first line
      const railOffsetCm = lineRails[0]?.[0] ?? 0
      const frontLegH    = Math.max(0, panelFrontH - s.blockHeightCm + railOffsetCm * Math.sin(angleRad0) - crossRailH0 * Math.cos(angleRad0))

      let measuredRowLength, measuredLineDepth
      if (pixelToCmRatio) {
        const rowPanels = panels.filter(p => (p.area ?? p.row ?? 'unassigned') === areaKey)
        const rl = rowPanels.length > 0 ? computeRowRailLayout(rowPanels, pixelToCmRatio, { lineRails, overhangCm: railOverhang, stockLengths: s.stockLengths }) : null
        if (rl?.frame?.localBounds) {
          const { minX, maxX, minY, maxY } = rl.frame.localBounds
          measuredRowLength = (maxX - minX) * pixelToCmRatio + 2 * railOverhang
          measuredLineDepth = (maxY - minY) * pixelToCmRatio
        }
      }

      return computeRowConstruction(panelCount, angle, frontLegH, {
        railOverhang,
        maxSpan,
        railOffsetCm,
        crossRailOffsetCm: s.crossRailOffsetCm,
        ...(measuredRowLength != null ? { rowLength: measuredRowLength } : {}),
        ...(measuredLineDepth != null ? { lineDepthCm: measuredLineDepth } : {}),
      })
    })
    return assignTypes(rcs)
  }, [rowKeys, rowPanelCounts, refinedArea, trapezoidConfigs, areaSettings, globalSettings, panels])

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
    const railOverhang = s.railOverhangCm
    const maxSpan      = (s.spacingMm ?? 2000) / 10
    const portraitDepthCm = s.panelLengthCm ?? 238.2
    const angleRad1    = angle * Math.PI / 180
    const crossRailH1  = (s.crossRailEdgeDistMm ?? 40) / 10

    const lineOrientations = getLineOrientations(areaKey, trapId)
    const lineRails        = getLineRails(selectedRowIdx, lineOrientations)
    const railOffsetCm     = lineRails[0]?.[0] ?? 0
    const frontLegH        = Math.max(0, panelFrontH - s.blockHeightCm + railOffsetCm * Math.sin(angleRad1) - crossRailH1 * Math.cos(angleRad1))

    const lineDepthCm = lineOrientations.reduce((sum, o, i) =>
      sum + (isHorizontalOrientation(o) ? PANEL_DEPTH_HORIZONTAL : portraitDepthCm) + (i > 0 ? PANEL_GAP_CM : 0), 0)

    const [rc] = assignTypes([computeRowConstruction(1, angle, frontLegH, {
      railOverhang,
      maxSpan,
      lineDepthCm,
      railOffsetCm,
      crossRailOffsetCm: s.crossRailOffsetCm,
    })])
    return rc
  }, [effectiveSelectedTrapId, selectedRowIdx, rowKeys, refinedArea, trapezoidConfigs, areaSettings, globalSettings, areas])

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
    { key: 'rails',  label: 'Rails Layout' },
    { key: 'bases',  label: 'Bases Layout' },
    { key: 'detail', label: 'Trapezoids Details' },
    { key: 'layout', label: 'Trapezoid Layout' },
    { key: 'rows',   label: 'Row Dimensions' },
    { key: 'bom',    label: 'Bill of Materials' },
  ]

  if (rowKeys.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#aaa', fontSize: '0.95rem' }}>
        No panel areas found — complete Step 3 first.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: 'white' }}>
      <style>{`@keyframes hlPulse { 0%,100%{opacity:0.15} 50%{opacity:0.9} }`}</style>

      {/* ── Left sidebar ── */}
      <Step4Sidebar
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
      />

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Tab bar */}
        <div style={{
          display: 'flex', borderBottom: '2px solid #e8e8e8',
          background: '#f8f9fa', padding: '0 1rem', gap: '0.25rem'
        }}>
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '0.55rem 1rem', border: 'none', cursor: 'pointer',
                fontSize: '0.8rem', fontWeight: '600',
                background: activeTab === tab.key ? 'white' : 'transparent',
                color: activeTab === tab.key ? '#333' : '#888',
                borderBottom: activeTab === tab.key ? `2px solid ${ACCENT}` : '2px solid transparent',
                marginBottom: '-2px', transition: 'all 0.15s'
              }}
            >{tab.label}</button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {activeTab === 'layout' && <div style={{ height: '100%', overflowY: 'auto' }}><LayoutView rowConstructions={rowConstructions} rowLabels={rowLabels} selectedIdx={selectedRowIdx} onSelectRow={i => { setSelectedRowIdx(i) }} highlightParam={highlightParam} /></div>}
          {activeTab === 'rows'   && <div style={{ height: '100%', overflowY: 'auto' }}><RowsView rowConstructions={rowConstructions} rowLabels={rowLabels} highlightParam={highlightParam} /></div>}
          {activeTab === 'detail' && <div style={{ height: '100%', overflow: 'hidden' }}><DetailView rc={selectedTrapezoidRC ?? selectedRC} panelLines={selectedRowLineDepths} settings={getSettings(selectedRowIdx)} lineRails={selectedLineRails} highlightParam={highlightParam} /></div>}
          {activeTab === 'bom'    && <div style={{ height: '100%', overflowY: 'auto' }}><BOMView rowConstructions={rowConstructions} /></div>}
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
              selectedRowIdx={selectedRowIdx} rowConstructions={rowConstructions}
              settings={getSettings(selectedRowIdx)}
              lineRails={selectedLineRails}
              highlightGroup={PARAM_GROUP[highlightParam] ?? null}
              customBasesMap={customBasesMap}
              onBasesChange={(rowIdx, offsets) =>
                setCustomBasesMap(prev => ({ ...prev, [rowIdx]: offsets }))
              }
              onResetBases={() => resetBases(selectedRowIdx)}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
