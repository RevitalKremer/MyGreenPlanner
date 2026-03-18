import { useState, useMemo, useEffect } from 'react'
import {
  computeRowConstruction,
  assignTypes,
} from '../../utils/constructionCalculator'
import RailLayoutTab from './RailLayoutTab'
import BasesPlanTab  from './BasesPlanTab'
import { computeRowRailLayout } from '../../utils/railLayoutService'
import { ACCENT, PARAM_GROUP, SETTINGS_DEFAULTS } from './step4/constants'
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
      const frontLegH = Math.max(0, panelFrontH - s.blockHeightCm + s.railOffsetCm * Math.sin(angle * Math.PI / 180))

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

    const trapPanels = panels.filter(p =>
      (p.area ?? p.row) === areaKey && p.trapezoidId === trapId
    )
    const panelCount = trapPanels.length || 1
    const globalCfg = refinedArea?.panelConfig || {}
    const override = trapezoidConfigs[trapId] || {}
    const angle = override.angle ?? globalCfg.angle ?? 0
    const panelFrontH = override.frontHeight ?? globalCfg.frontHeight ?? 0
    const s = getSettings(selectedRowIdx)
    const railOverhang = s.railOverhangCm
    const maxSpan = s.maxSpanCm
    const frontLegH = Math.max(0, panelFrontH - s.blockHeightCm + s.railOffsetCm * Math.sin(angle * Math.PI / 180))

    const pixelToCmRatio = refinedArea?.pixelToCmRatio || null
    let measuredRowLength, measuredLineDepth
    if (pixelToCmRatio && trapPanels.length > 0) {
      const rl = computeRowRailLayout(trapPanels, pixelToCmRatio)
      if (rl?.frame?.localBounds) {
        const { minX, maxX, minY, maxY } = rl.frame.localBounds
        measuredRowLength = (maxX - minX) * pixelToCmRatio + 2 * railOverhang
        measuredLineDepth = (maxY - minY) * pixelToCmRatio
      }
    }

    const [rc] = assignTypes([computeRowConstruction(panelCount, angle, frontLegH, {
      railOverhang,
      maxSpan,
      ...(measuredRowLength != null ? { rowLength: measuredRowLength } : {}),
      ...(measuredLineDepth != null ? { lineDepthCm: measuredLineDepth } : {}),
    })])
    return rc
  }, [effectiveSelectedTrapId, selectedRowIdx, rowKeys, panels, refinedArea, trapezoidConfigs, areaSettings, globalSettings])

  const selectedRowLineDepths = useMemo(() => {
    const pixelToCmRatio = refinedArea?.pixelToCmRatio || null
    if (!pixelToCmRatio || selectedRowIdx == null) return null
    const rowKey = rowKeys[selectedRowIdx]
    if (rowKey == null) return null
    const rowPanels = effectiveSelectedTrapId
      ? panels.filter(p => (p.area ?? p.row ?? 'unassigned') === rowKey && p.trapezoidId === effectiveSelectedTrapId)
      : panels.filter(p => (p.area ?? p.row ?? 'unassigned') === rowKey)
    if (rowPanels.length === 0) return null
    const rl = computeRowRailLayout(rowPanels, pixelToCmRatio)
    if (!rl) return null

    const lineMap = {}
    for (const pr of rl.panelLocalRects) {
      const li = pr.line ?? 0
      if (!lineMap[li]) lineMap[li] = { minY: Infinity, maxY: -Infinity }
      lineMap[li].minY = Math.min(lineMap[li].minY, pr.localY)
      lineMap[li].maxY = Math.max(lineMap[li].maxY, pr.localY + pr.height)
    }

    const sorted = Object.entries(lineMap)
      .map(([li, b]) => ({ lineIdx: Number(li), ...b }))
      .sort((a, b) => a.lineIdx - b.lineIdx)

    return sorted.map((line, i) => ({
      depthCm:      (line.maxY - line.minY)                    * pixelToCmRatio,
      gapBeforeCm:  i === 0 ? 0 : (line.minY - sorted[i-1].maxY) * pixelToCmRatio,
    }))
  }, [panels, refinedArea, selectedRowIdx, rowKeys])

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
      <div style={{
        width: '260px', flexShrink: 0, borderRight: '1px solid #e8e8e8',
        display: 'flex', flexDirection: 'column', overflowY: 'auto',
        background: '#fafafa'
      }}>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e8e8e8' }}>
          <div style={{ fontSize: '0.65rem', fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Areas</div>
        </div>

        {/* Area / trapezoid hierarchy list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {rowConstructions.map((rc, i) => {
            const areaKey = rowKeys[i]
            const trapIds = areaTrapezoidMap[areaKey] || []
            const isAreaSelected = selectedRowIdx === i
            return (
              <div key={i}>
                {/* Area header */}
                <div
                  onClick={() => {
                    setSelectedRowIdx(i)
                    setSelectedTrapezoidId(areaTrapezoidMap[areaKey]?.[0] ?? null)
                  }}
                  style={{
                    padding: '0.6rem 1rem', cursor: 'pointer',
                    borderBottom: trapIds.length > 1 ? 'none' : '1px solid #f0f0f0',
                    background: isAreaSelected ? '#f4f9e4' : 'transparent',
                    borderLeft: `3px solid ${isAreaSelected ? ACCENT : 'transparent'}`,
                    transition: 'all 0.12s'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.84rem', fontWeight: '700', color: isAreaSelected ? '#333' : '#555' }}>
                      {areaLabel(areaKey, i)}
                    </span>
                    <span style={{
                      fontSize: '0.72rem', fontWeight: '800', color: 'white',
                      background: '#555', borderRadius: '4px', padding: '1px 6px'
                    }}>{rc.typeLetter}{rc.panelsPerSpan}</span>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#888', marginTop: '2px' }}>
                    {rc.panelCount} panels · {rc.angle}° · {rc.numTrapezoids} frames
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#888' }}>
                    Rail: {(rc.rowLength / 100).toFixed(2)} m
                  </div>
                </div>
                {/* Trapezoid children */}
                {trapIds.length > 1 && isAreaSelected && (
                  <div style={{ borderBottom: '1px solid #f0f0f0', background: '#f5f7f0' }}>
                    {trapIds.map(trapId => {
                      const isTrapSelected = effectiveSelectedTrapId === trapId
                      const count = panels.filter(p =>
                        (p.area ?? p.row) === areaKey && p.trapezoidId === trapId
                      ).length
                      return (
                        <div
                          key={trapId}
                          onClick={e => { e.stopPropagation(); setSelectedTrapezoidId(trapId) }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                            padding: '0.35rem 1rem 0.35rem 1.5rem', cursor: 'pointer',
                            borderLeft: `3px solid ${isTrapSelected ? ACCENT : 'transparent'}`,
                            background: isTrapSelected ? '#edf5d8' : 'transparent',
                            transition: 'all 0.1s'
                          }}
                        >
                          <span style={{
                            fontSize: '0.72rem', fontWeight: '700',
                            color: isTrapSelected ? '#5a6600' : '#888',
                            background: isTrapSelected ? '#ddeea0' : '#e8e8e8',
                            padding: '1px 7px', borderRadius: '10px'
                          }}>{trapId}</span>
                          <span style={{ fontSize: '0.7rem', color: '#aaa' }}>{count} panels</span>
                          {!!trapezoidConfigs[trapId] && (
                            <span title="Custom config" style={{
                              width: '5px', height: '5px', borderRadius: '50%',
                              background: '#FF9800', marginLeft: 'auto', flexShrink: 0
                            }} />
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ── Settings sections (per-row, grouped by tab) ── */}
        {selectedRC && (() => {
          const s = getSettings(selectedRowIdx)
          const isOverride = (key) => !!(areaSettings[selectedRowIdx] && key in areaSettings[selectedRowIdx])

          const numInput = (key, step = 1, min) => (
            <input type="number" value={s[key]} step={step} min={min}
              onChange={e => updateSetting(selectedRowIdx, key, parseFloat(e.target.value) || 0)}
              onFocus={() => setHighlightParam(key)}
              onBlur={() => setHighlightParam(null)}
              style={{ width: '100%', padding: '0.22rem 0.4rem', boxSizing: 'border-box',
                border: `1px solid ${isOverride(key) ? '#FFB74D' : '#ddd'}`,
                borderRadius: '4px', fontSize: '0.78rem', fontWeight: isOverride(key) ? '700' : '400' }} />
          )

          const field = (label, key, step, min) => {
            const isActive = highlightParam === key
            return (
              <div key={key} style={{ marginBottom: '0.45rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.65rem', color: isActive ? '#d97706' : '#888', fontWeight: isActive ? '700' : '400', marginBottom: '2px', transition: 'color 0.2s' }}>
                  {isActive && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#FFB300', display: 'inline-block', flexShrink: 0, animation: 'hlPulse 0.75s ease-in-out infinite' }} />}
                  {label}
                </div>
                {numInput(key, step, min)}
              </div>
            )
          }

          const applyBtn = (keys) => (
            <button onClick={() => applySection(selectedRowIdx, keys)}
              style={{ width: '100%', marginTop: '0.35rem', padding: '0.2rem',
                fontSize: '0.65rem', fontWeight: '600', color: '#888',
                background: '#f5f5f5', border: '1px solid #e0e0e0',
                borderRadius: '4px', cursor: 'pointer' }}>
              Apply to all rows
            </button>
          )

          const SECTIONS = [
            {
              tabKey: 'detail', label: 'Trapezoids',
              keys: ['railOffsetCm','connOffsetCm','panelLengthCm','blockHeightCm','blockWidthCm','connEdgeDistMm','connMinPortrait','connMinLandscape'],
              fields: [
                ['Rail Clamp Offset (cm)', 'railOffsetCm', 0.1, 0],
                ['Cross-Rail Offset (cm)', 'connOffsetCm',  0.5, 0],
                ['Panel Length (cm)',      'panelLengthCm', 0.1, 10],
                ['Block Height (cm)',      'blockHeightCm', 1,   1],
                ['Block Width (cm)',       'blockWidthCm',  1,   1],
                ['Rail Edge Dist (mm)',    'connEdgeDistMm',5,   0],
                ['Min Rails Portrait',     'connMinPortrait',1,  1],
                ['Min Rails Landscape',    'connMinLandscape',1, 1],
              ],
            },
            {
              tabKey: 'rails', label: 'Rails',
              keys: ['railOverhangCm','stockLengths'],
              fields: [
                ['Rail Overhang (cm)', 'railOverhangCm', 0.5, 0],
              ],
            },
            {
              tabKey: 'bases', label: 'Bases',
              keys: ['edgeOffsetMm','spacingMm','maxSpanCm'],
              fields: [
                ['Edge Offset (mm)',  'edgeOffsetMm', 10,  0],
                ['Base Spacing (mm)', 'spacingMm',    50, 100],
                ['Max Span (cm)',     'maxSpanCm',     5,  50],
              ],
            },
          ]

          return SECTIONS.map(sec => {
            const isOpen = activeTab === sec.tabKey
            return (
              <div key={sec.tabKey} style={{ borderTop: '1px solid #e8e8e8' }}>
                <div onClick={() => setActiveTab(isOpen ? activeTab : sec.tabKey)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '0.5rem 1rem', cursor: 'pointer',
                    background: isOpen ? '#f0f4e8' : '#fafafa' }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: '700', color: isOpen ? '#5a6600' : '#888',
                    textTransform: 'uppercase', letterSpacing: '0.06em' }}>{sec.label}</span>
                  <span style={{ fontSize: '0.8rem', color: '#aaa' }}>{isOpen ? '▲' : '▼'}</span>
                </div>
                {isOpen && (
                  <div style={{ padding: '0.6rem 1rem 0.75rem' }}>
                    {sec.fields.map(([lbl, key, step, min]) => field(lbl, key, step, min))}
                    {sec.tabKey === 'rails' && (
                      <div style={{ marginBottom: '0.45rem' }}>
                        <div style={{ fontSize: '0.65rem', color: '#888', marginBottom: '2px' }}>Stock Lengths (mm)</div>
                        <input type="text"
                          value={(s.stockLengths || []).join(', ')}
                          onChange={e => updateSetting(selectedRowIdx, 'stockLengths',
                            e.target.value.split(',').map(v => parseInt(v.trim(), 10)).filter(n => n > 0))}
                          onFocus={() => setHighlightParam('stockLengths')}
                          onBlur={() => setHighlightParam(null)}
                          placeholder="e.g. 4800, 6000"
                          style={{ width: '100%', padding: '0.22rem 0.4rem', boxSizing: 'border-box',
                            border: `1px solid ${isOverride('stockLengths') ? '#FFB74D' : '#ddd'}`,
                            borderRadius: '4px', fontSize: '0.78rem' }} />
                      </div>
                    )}
                    {applyBtn(sec.keys)}
                  </div>
                )}
              </div>
            )
          })
        })()}
      </div>

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
