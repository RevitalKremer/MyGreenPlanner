import { useState, useMemo, useEffect } from 'react'
import {
  computeRowConstruction,
  assignTypes,
} from '../../utils/constructionCalculator'
import RailLayoutTab from './step4/RailLayoutTab'
import BasesPlanTab  from './step4/BasesPlanTab'
import { computeRowRailLayout } from '../../utils/railLayoutService'
import { isHorizontalOrientation, isEmptyOrientation, PANEL_DEPTH_HORIZONTAL, PANEL_GAP_CM } from '../../utils/trapezoidGeometry'
import { ACCENT, PARAM_GROUP, SETTINGS_DEFAULTS } from './step4/constants'
import Step4Sidebar from './step4/Step4Sidebar'
import LayoutView from './step4/LayoutView'
import RowsView from './step4/RowsView'
import DetailView from './step4/DetailView'
import BOMView from './step4/BOMView'

// ─── Main Step4 component ────────────────────────────────────────────────────

export default function Step4ConstructionPlanning({ panels = [], refinedArea, trapezoidConfigs = {}, areas = [], initialGlobalSettings = null, initialAreaSettings = null, onSettingsChange }) {
  const [selectedRowIdx, setSelectedRowIdx] = useState(0)
  const [selectedTrapezoidId, setSelectedTrapezoidId] = useState(null)
  const [activeTab, setActiveTab] = useState('detail')
  const [globalSettings, setGlobalSettings] = useState(() => initialGlobalSettings ?? SETTINGS_DEFAULTS)
  const [areaSettings,   setAreaSettings]   = useState(() => initialAreaSettings   ?? {})
  const [highlightParam, setHighlightParam] = useState(null)

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

  const rowConstructions = useMemo(() => {
    const pixelToCmRatio = refinedArea?.pixelToCmRatio || null
    const rcs = rowKeys.map((areaKey, i) => {
      const panelCount = rowPanelCounts[areaKey] || 1
      const globalCfg = refinedArea?.panelConfig || {}
      const trapId = `${String.fromCharCode(65 + areaKey)}1`
      const override = trapezoidConfigs[trapId] || {}
      const angle = override.angle ?? globalCfg.angle ?? 0
      const panelFrontH = override.frontHeight ?? globalCfg.frontHeight ?? 0
      const s = getSettings(i)
      const railOverhang = s.railOverhangCm
      const maxSpan      = s.maxSpanCm
      const angleRad0 = angle * Math.PI / 180
      const connH0 = (s.connEdgeDistMm ?? 40) / 10
      const frontLegH = Math.max(0, panelFrontH - s.blockHeightCm + s.railOffsetCm * Math.sin(angleRad0) - connH0 * Math.cos(angleRad0))

      let measuredRowLength, measuredLineDepth
      if (pixelToCmRatio) {
        const rowPanels = panels.filter(p => (p.area ?? p.row ?? 'unassigned') === areaKey)
        const rl = rowPanels.length > 0 ? computeRowRailLayout(rowPanels, pixelToCmRatio) : null
        if (rl?.frame?.localBounds) {
          const { minX, maxX, minY, maxY } = rl.frame.localBounds
          measuredRowLength = (maxX - minX) * pixelToCmRatio + 2 * railOverhang
          measuredLineDepth = (maxY - minY) * pixelToCmRatio
        }
      }

      return computeRowConstruction(panelCount, angle, frontLegH, {
        railOverhang,
        maxSpan,
        railOffsetCm: s.railOffsetCm,
        connOffsetCm: s.connOffsetCm,
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

    const globalCfg = refinedArea?.panelConfig || {}
    const override = trapezoidConfigs[trapId] || {}
    const angle = override.angle ?? globalCfg.angle ?? 0
    const panelFrontH = override.frontHeight ?? globalCfg.frontHeight ?? 0
    const linesPerRow = override.linesPerRow ?? globalCfg.linesPerRow ?? 1
    const lineOrientations = (override.lineOrientations ?? globalCfg.lineOrientations ?? ['vertical']).slice(0, linesPerRow)
    const s = getSettings(selectedRowIdx)
    const railOverhang = s.railOverhangCm
    const maxSpan = s.maxSpanCm
    const portraitDepthCm = s.panelLengthCm ?? 238.2
    const angleRad1 = angle * Math.PI / 180
    const connH1 = (s.connEdgeDistMm ?? 40) / 10
    const frontLegH = Math.max(0, panelFrontH - s.blockHeightCm + s.railOffsetCm * Math.sin(angleRad1) - connH1 * Math.cos(angleRad1))

    const lineDepthCm = lineOrientations.reduce((sum, o, i) =>
      sum + (isHorizontalOrientation(o) ? PANEL_DEPTH_HORIZONTAL : portraitDepthCm) + (i > 0 ? PANEL_GAP_CM : 0), 0)

    const [rc] = assignTypes([computeRowConstruction(1, angle, frontLegH, {
      railOverhang,
      maxSpan,
      lineDepthCm,
      railOffsetCm: s.railOffsetCm,
      connOffsetCm: s.connOffsetCm,
    })])
    return rc
  }, [effectiveSelectedTrapId, selectedRowIdx, rowKeys, refinedArea, trapezoidConfigs, areaSettings, globalSettings])

  const selectedRowLineDepths = useMemo(() => {
    if (selectedRowIdx == null) return null
    const trapId = effectiveSelectedTrapId
    if (!trapId) return null

    const globalCfg = refinedArea?.panelConfig || {}
    const override = trapezoidConfigs[trapId] || {}
    const linesPerRow = override.linesPerRow ?? globalCfg.linesPerRow ?? 1
    const lineOrientations = (override.lineOrientations ?? globalCfg.lineOrientations ?? ['vertical']).slice(0, linesPerRow)
    const s = getSettings(selectedRowIdx)
    const portraitDepthCm = s.panelLengthCm ?? 238.2

    return lineOrientations.map((o, i) => ({
      depthCm: isHorizontalOrientation(o) ? PANEL_DEPTH_HORIZONTAL : portraitDepthCm,
      gapBeforeCm: i === 0 ? 0 : PANEL_GAP_CM,
      isEmpty: isEmptyOrientation(o),
    }))
  }, [effectiveSelectedTrapId, refinedArea, trapezoidConfigs, selectedRowIdx, areaSettings, globalSettings])

  const tabs = [
    { key: 'detail', label: 'Trapezoids Details' },
    { key: 'rails',  label: 'Rails Layout' },
    { key: 'bases',  label: 'Bases Layout' },
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
          {activeTab === 'detail' && <div style={{ height: '100%', overflow: 'hidden' }}><DetailView rc={selectedTrapezoidRC ?? selectedRC} panelLines={selectedRowLineDepths} settings={getSettings(selectedRowIdx)} highlightParam={highlightParam} /></div>}
          {activeTab === 'bom'    && <div style={{ height: '100%', overflowY: 'auto' }}><BOMView rowConstructions={rowConstructions} /></div>}
          {activeTab === 'rails'  && <div style={{ height: '100%', overflow: 'hidden' }}><RailLayoutTab panels={panels} refinedArea={refinedArea} selectedRowIdx={selectedRowIdx} settings={getSettings(selectedRowIdx)} highlightGroup={PARAM_GROUP[highlightParam] ?? null} /></div>}
          <div style={{ display: activeTab === 'bases' ? 'flex' : 'none', height: '100%', flexDirection: 'column' }}>
            <BasesPlanTab panels={panels} refinedArea={refinedArea} selectedRowIdx={selectedRowIdx} rowConstructions={rowConstructions} settings={getSettings(selectedRowIdx)} highlightGroup={PARAM_GROUP[highlightParam] ?? null} />
          </div>
        </div>
      </div>
    </div>
  )
}
