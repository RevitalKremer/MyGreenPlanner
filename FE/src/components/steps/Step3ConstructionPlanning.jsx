import { useState, useEffect, useCallback, useRef } from 'react'
import { useLang } from '../../i18n/LangContext'
import { TEXT, TEXT_PLACEHOLDER, TEXT_VERY_LIGHT, BORDER_FAINT, BG_LIGHT, PRIMARY } from '../../styles/colors'
import RailLayoutTab from './step3/RailLayoutTab'
import BasesPlanTab  from './step3/BasesPlanTab'
import Step3Sidebar from './step3/Step3Sidebar'
import AreasTab from './step3/AreasTab'
import DetailView from './step3/DetailView'
import useStep3Settings from '../../hooks/useStep3Settings'
import useRowData from '../../hooks/useRowData'
import useSelectedGeometry from '../../hooks/useSelectedGeometry'

// ─── Main Step3 component ────────────────────────────────────────────────────

export default function Step3ConstructionPlanning({
  panels = [], refinedArea, trapezoidConfigs = {}, setTrapezoidConfigs,
  areas = [], initialGlobalSettings = null, initialAreaSettings = null, initialTab = null,
  onSettingsChange, onTrapConfigsChange, onCustomBasesChange, onPdfDataChange,
  beRailsData = null, beBasesData = null, beTrapezoidsData = null,
  railsComputing = false, onTabSave, onTabReset,
  appDefaults, paramSchema: PARAM_SCHEMA = [], settingsDefaults: SETTINGS_DEFAULTS = {},
  paramGroup: PARAM_GROUP = {}, panelSpec,
}) {
  const { t } = useLang()

  // ── UI state ───────────────────────────────────────────────────────────
  const [selectedRowIdx, setSelectedRowIdx] = useState(0)
  const [selectedTrapezoidId, setSelectedTrapezoidId] = useState(null)
  const [activeTab, setActiveTab] = useState(initialTab || 'areas')
  const [highlightParam, setHighlightParam] = useState(null)
  const [customBasesMap, setCustomBasesMap] = useState({})
  const [userEditedBases, setUserEditedBases] = useState(new Set())

  // ── Settings hook ──────────────────────────────────────────────────────
  const settings = useStep3Settings({
    initialGlobalSettings, initialAreaSettings, SETTINGS_DEFAULTS, PARAM_SCHEMA,
    appDefaults, panelSpec, trapezoidConfigs, setTrapezoidConfigs, areas,
    onTabSave, onTabReset, onSettingsChange,
  })

  // ── Line orientations resolver ─────────────────────────────────────────
  const getLineOrientations = useCallback((areaKey, trapId) => {
    const globalCfg = refinedArea?.panelConfig || {}
    const override  = trapezoidConfigs[trapId] || {}
    const areaGroup = areas[areaKey] || {}
    return override.lineOrientations ?? areaGroup.lineOrientations ?? globalCfg.lineOrientations ?? ['vertical']
  }, [refinedArea, trapezoidConfigs, areas])

  // ── Row data hook ──────────────────────────────────────────────────────
  const rowData = useRowData({
    panels, areas, refinedArea, trapezoidConfigs, setTrapezoidConfigs,
    beRailsData, beTrapezoidsData, panelSpec, appDefaults,
    getSettings: settings.getSettings, getTrapBasesSettings: settings.getTrapBasesSettings,
    getLineOrientations,
    areaSettings: settings.areaSettings, globalSettings: settings.globalSettings,
    PARAM_SCHEMA,
  })

  const { rowKeys, areaTrapezoidMap, rowConstructions } = rowData

  const effectiveSelectedTrapId = selectedTrapezoidId ??
    (rowKeys[selectedRowIdx] != null ? (areaTrapezoidMap[rowKeys[selectedRowIdx]]?.[0] ?? null) : null)

  const selectedRC = rowConstructions[selectedRowIdx] ?? null

  // ── Selected geometry hook ─────────────────────────────────────────────
  const geo = useSelectedGeometry({
    selectedRowIdx, effectiveSelectedTrapId,
    rowKeys, areas, refinedArea, trapezoidConfigs, areaTrapezoidMap,
    beRailsData, beTrapezoidsData,
    getSettings: settings.getSettings, getTrapBasesSettings: settings.getTrapBasesSettings,
    getLineOrientations, getLineRails: rowData.getLineRails,
    updateLineRails: settings.updateLineRails,
    areaSettings: settings.areaSettings, globalSettings: settings.globalSettings,
    panelSpec, appDefaults, PARAM_SCHEMA,
  })

  // ── Tab save on leave ──────────────────────────────────────────────────
  const prevTabRef = useRef(activeTab)
  useEffect(() => {
    if (prevTabRef.current === 'rails' && activeTab !== 'rails') onTabSave?.('rails')
    if (prevTabRef.current === 'bases' && activeTab !== 'bases') onTabSave?.('bases')
    if (prevTabRef.current === 'detail' && activeTab !== 'detail') onTabSave?.('trapezoids')
    prevTabRef.current = activeTab
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync effects ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!beBasesData) return
    const map = {}
    for (const areaData of beBasesData) {
      const bdMap = areaData.basesDataMap || {}
      for (const base of (areaData.bases || [])) {
        const tid = base.trapezoidId
        const frameStart = bdMap[tid]?.frameStartCm ?? 0
        if (!map[tid]) map[tid] = []
        map[tid].push(Math.round((base.offsetFromStartCm - frameStart) * 10))
      }
    }
    for (const tid of Object.keys(map)) map[tid].sort((a, b) => a - b)
    setCustomBasesMap(map)
  }, [beBasesData])

  useEffect(() => { onTrapConfigsChange?.(trapezoidConfigs) }, [trapezoidConfigs]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const userEdited = {}
    for (const tid of userEditedBases) {
      if (customBasesMap[tid]) userEdited[tid] = customBasesMap[tid]
    }
    onCustomBasesChange?.(userEdited)
  }, [customBasesMap]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onSettingsChange?.(settings.globalSettings, settings.areaSettings)
  }, [settings.globalSettings, settings.areaSettings])

  useEffect(() => {
    onPdfDataChange?.({
      trapSettingsMap: rowData.trapSettingsMap,
      trapLineRailsMap: rowData.trapLineRailsMap,
      trapRCMap: rowData.trapRCMap,
      customBasesMap,
      trapPanelLinesMap: rowData.trapPanelLinesMap,
    })
  }, [rowData.trapSettingsMap, rowData.trapLineRailsMap, rowData.trapRCMap, customBasesMap, rowData.trapPanelLinesMap])

  // ── Apply rails to all areas (bridges hooks) ───────────────────────────
  const handleApplyRailsToAll = useCallback(() => {
    geo.applyRailsToAllAreas(rowKeys, areaTrapezoidMap, settings.setAreaSettings, settings.getSettings)
  }, [geo.applyRailsToAllAreas, rowKeys, areaTrapezoidMap, settings.setAreaSettings, settings.getSettings])

  // ── Tabs ───────────────────────────────────────────────────────────────
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

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: 'white' }}>
      <style>{`@keyframes hlPulse { 0%,100%{opacity:0.15} 50%{opacity:0.9} }`}</style>

      {/* ── Left sidebar ── */}
      <Step3Sidebar
        rowConstructions={rowConstructions} rowKeys={rowKeys}
        areaTrapezoidMap={areaTrapezoidMap} areaLabel={settings.areaLabel}
        selectedRowIdx={selectedRowIdx} setSelectedRowIdx={setSelectedRowIdx}
        selectedTrapezoidId={selectedTrapezoidId} setSelectedTrapezoidId={setSelectedTrapezoidId}
        effectiveSelectedTrapId={effectiveSelectedTrapId}
        trapezoidConfigs={trapezoidConfigs} panels={panels}
        activeTab={activeTab} setActiveTab={setActiveTab}
        selectedRC={selectedRC} getSettings={settings.getSettings}
        updateSetting={settings.updateSetting} applySection={settings.applySection}
        highlightParam={highlightParam} setHighlightParam={setHighlightParam}
        areaSettings={settings.areaSettings}
        globalSettings={settings.globalSettings}
        updateGlobalSetting={settings.updateGlobalSetting}
        derivedRailSpacings={geo.derivedRailSpacings}
        lineOrientations={geo.selectedLineOrientations}
        panelDepthsCm={geo.selectedLinePanelDepths}
        onRailSpacingChange={geo.onRailSpacingChange}
        onApplyRailsToAllAreas={handleApplyRailsToAll}
        getTrapBasesSettings={settings.getTrapBasesSettings}
        updateTrapBaseSetting={settings.updateTrapBaseSetting}
        applyBasesToAll={() => rowData.applyBasesToAll(effectiveSelectedTrapId)}
        paramSchema={PARAM_SCHEMA}
        paramGroup={PARAM_GROUP}
        onApplyChanges={(tab) => onTabSave?.(tab === 'detail' ? 'trapezoids' : tab)}
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
                borderBottom: activeTab === tab.key ? `2px solid ${PRIMARY}` : '2px solid transparent',
                marginBottom: '-2px', transition: 'all 0.15s'
              }}
            >{tab.label}</button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {activeTab === 'areas' && <AreasTab panels={panels} areas={areas} rowKeys={rowKeys} areaLabel={settings.areaLabel} />}

          {activeTab === 'detail' && (() => {
            const areaTrapIds = areaTrapezoidMap[rowKeys[selectedRowIdx]] || []
            const fullTrapId = areaTrapIds.find(tid =>
              beTrapezoidsData?.[tid]?.isFullTrap && tid !== effectiveSelectedTrapId
            )
            const fullTrapGhost = fullTrapId ? {
              beDetailData: beTrapezoidsData[fullTrapId],
              panelLines: rowData.trapPanelLinesMap[fullTrapId],
              lineRails: rowData.trapLineRailsMap[fullTrapId],
              rc: rowData.trapRCMap[fullTrapId],
            } : null
            return (
              <div style={{ height: '100%', overflow: 'hidden' }}>
                <DetailView
                  rc={geo.selectedTrapezoidRC ?? selectedRC} trapId={effectiveSelectedTrapId}
                  panelLines={rowData.trapPanelLinesMap[effectiveSelectedTrapId] ?? geo.selectedRowLineDepths}
                  settings={settings.getSettings(selectedRowIdx)}
                  lineRails={rowData.trapLineRailsMap[effectiveSelectedTrapId] ?? geo.selectedLineRails}
                  highlightParam={highlightParam}
                  beDetailData={beTrapezoidsData?.[effectiveSelectedTrapId]}
                  fullTrapGhost={fullTrapGhost}
                  paramGroup={PARAM_GROUP}
                  reverseBlockPunches={settings.globalSettings.reverseBlockPunches ?? true}
                  onReset={() => { settings.resetDetailSettings(selectedRowIdx); onTabReset?.('trapezoids') }}
                  onUpdateSetting={(key, val) => settings.updateSetting(selectedRowIdx, key, val)}
                />
              </div>
            )
          })()}

          {activeTab === 'rails' && (
            <div style={{ height: '100%', overflow: 'hidden' }}>
              <RailLayoutTab
                panels={panels} refinedArea={refinedArea}
                selectedRowIdx={selectedRowIdx}
                settings={settings.getSettings(selectedRowIdx)}
                lineRails={geo.areaLineRails}
                panelDepthsCm={geo.areaLinePanelDepths}
                keepSymmetry={settings.getSettings(selectedRowIdx).keepSymmetry ?? true}
                onLineRailsChange={(newRails) => settings.updateLineRails(selectedRowIdx, newRails)}
                onApplyRailsToAll={() => settings.applySection(selectedRowIdx, ['lineRails'])}
                onResetRails={settings.resetLineRails}
                highlightGroup={PARAM_GROUP[highlightParam] ?? null}
                trapLineRailsMap={rowData.trapLineRailsMap}
                trapSettingsMap={rowData.trapSettingsMap}
                railsComputing={railsComputing}
                beRailsData={beRailsData}
              />
            </div>
          )}

          <div style={{ display: activeTab === 'bases' ? 'flex' : 'none', height: '100%', flexDirection: 'column' }}>
            <BasesPlanTab
              panels={panels} refinedArea={refinedArea}
              effectiveSelectedTrapId={effectiveSelectedTrapId}
              trapSettingsMap={rowData.trapSettingsMap}
              trapLineRailsMap={rowData.trapLineRailsMap}
              trapRCMap={rowData.trapRCMap}
              beTrapezoidsData={beTrapezoidsData}
              beBasesData={beBasesData}
              highlightGroup={PARAM_GROUP[highlightParam] ?? null}
              customBasesMap={customBasesMap}
              onBasesChange={(trapId, offsets) => {
                setCustomBasesMap(prev => ({ ...prev, [trapId]: offsets }))
                setUserEditedBases(prev => new Set([...prev, trapId]))
              }}
              onResetBases={() => settings.resetTrapBases(effectiveSelectedTrapId, {
                clearTrap: (tid) => {
                  setCustomBasesMap(prev => { const c = { ...prev }; delete c[tid]; return c })
                  setUserEditedBases(prev => { const s = new Set(prev); s.delete(tid); return s })
                }
              })}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
