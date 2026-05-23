import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useLang } from '../../i18n/LangContext'
import { TEXT, TEXT_PLACEHOLDER, TEXT_VERY_LIGHT, BORDER_FAINT, BG_LIGHT, PRIMARY, WARNING } from '../../styles/colors'
import ConfirmDialog from '../ConfirmDialog'
import { useConfirm } from '../../hooks/useConfirm'
import { PANEL_V } from '../../utils/panelCodes'
import { allAreasFrameless, resolveAreaRoofSpec } from '../../utils/roofSpecUtils'
import RailLayoutTab from './step3/RailLayoutTab'
import BasesPlanTab  from './step3/BasesPlanTab'
import Step3Sidebar from './step3/Step3Sidebar'
import AreasTab from './step3/AreasTab'
import DetailView from './step3/DetailView'
import { buildFullTrapGhost } from './step3/tabUtils'
import useStep3Settings from '../../hooks/useStep3Settings'
import useRowData from '../../hooks/useRowData'
import useSelectedGeometry from '../../hooks/useSelectedGeometry'

// ─── Main Step3 component ────────────────────────────────────────────────────

export default function Step3ConstructionPlanning({
  panels = [], refinedArea, trapezoidConfigs = {}, setTrapezoidConfigs,
  uploadedImageData, imageSrc,
  rectAreas = [],
  areas = [], initialGlobalSettings = null, initialAreaSettings = null, initialTab = null,
  onSettingsChange, onTrapConfigsChange, onCustomBasesChange, onPdfDataChange,
  // Notify the host of the current queue of TrapExtendOps. App.tsx
  // mirrors it into a ref for the save flow; sessionId is stripped
  // before the payload goes over the wire.
  onTrapExtendOpsChange = null as null | ((ops: any[]) => void),
  // (BaseOp wire format is derived on save by App.tsx via
  // buildBaseOpsFromState — no per-click push from Step3/BasesPlanTab.)
  beRailsData = null, beBasesData = null, beTrapezoidsData = null, beTrapezoidGroups = [],
  railsComputing = false, onTabSave, onTabReset, onActiveTabChange,
  appDefaults, paramSchema: PARAM_SCHEMA = [], settingsDefaults: SETTINGS_DEFAULTS = {},
  paramGroup: PARAM_GROUP = {}, panelSpec,
  roofType = 'concrete',
  purlinDistCm = 0,
  installationOrientation = null,
  basesComputing = false,
  // Optional ref the host fills with a function that applies every dirty tab
  // — used by the Next button to silently flush before transitioning to step 4.
  flushDirtyTabsRef = null,
  // Optional ref the host reads to check whether any step-3 tab is dirty —
  // lets Start Over skip its confirm dialog when there's nothing to lose.
  isAnyDirtyRef = null,
}) {
  const { t } = useLang()

  // ── UI state ───────────────────────────────────────────────────────────
  const [selectedRowIdx, setSelectedRowIdx] = useState(0)
  const [selectedTrapezoidId, setSelectedTrapezoidId] = useState(null)
  const [selectedPanelRowIdx, setSelectedPanelRowIdx] = useState(null)
  // Treat null, "null" string, and undefined as no saved tab - default to 'areas'
  const [activeTab, setActiveTab] = useState((initialTab && initialTab !== 'null') ? initialTab : 'areas')
  const [highlightParam, setHighlightParam] = useState(null)
  const [customBasesMap, setCustomBasesMap] = useState({})
  // (userEditedBases was used to gate which customBasesMap entries were
  // sent to BE. Obsolete now — buildBaseOpsFromState diffs every entry
  // against beBasesData and only emits ops where they actually differ.)

  // ── Pending trap-extend ops queue ──────────────────────────────────────
  // Live state (not just a ref) so the canvas can preview each extension
  // before save. Each op carries an FE-only `_sessionId`: one editor
  // session = one logical user gesture, so successive emits within the
  // same session (drag-release → input edit → scope button click) collapse
  // to the LATEST op. App.tsx strips the sessionId before the payload
  // goes over the wire.
  const [pendingTrapOps, setPendingTrapOps] = useState<any[]>([])
  const pushTrapExtendOp = useCallback((op: any) => {
    setPendingTrapOps(prev => {
      const sid = op?._sessionId
      const filtered = sid != null ? prev.filter(o => o._sessionId !== sid) : prev
      return [...filtered, op]
    })
    settings.markDirty('bases')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Mirror upstream so App.tsx can drain the queue on save.
  useEffect(() => { onTrapExtendOpsChange?.(pendingTrapOps) }, [pendingTrapOps]) // eslint-disable-line react-hooks/exhaustive-deps
  // Clear pending ops whenever a fresh BE response lands — those ops
  // have just been applied (or rejected) and any new edit starts a new
  // session.
  useEffect(() => { setPendingTrapOps([]) }, [beBasesData])

  // ── Settings hook ──────────────────────────────────────────────────────
  // Pre-compute areaByGroupKey for settings (needed before useRowData runs)
  const areaByGroupKey = useMemo(() => {
    const map = {}
    const areaByLabel = {}
    for (const a of areas) { if (a.label) areaByLabel[a.label] = a }
    // Group panels by areaGroupKey, find area via trapezoidId
    const seen = new Set()
    for (const p of panels) {
      const gk = p.areaGroupKey ?? p.area ?? 0
      if (seen.has(gk)) continue
      seen.add(gk)
      const tid = p.trapezoidId
      const matched = areas.find(a => a.trapezoidIds?.includes(tid)) ?? areaByLabel[tid?.replace(/\d+$/, '')]
      if (matched) map[gk] = matched
      else if (areas[gk]) map[gk] = areas[gk]
    }
    return map
  }, [panels, areas])

  const settings = useStep3Settings({
    initialGlobalSettings, initialAreaSettings, SETTINGS_DEFAULTS, PARAM_SCHEMA,
    appDefaults, panelSpec, trapezoidConfigs, setTrapezoidConfigs, areas,
    areaByGroupKey,
    onTabSave, onTabReset, onSettingsChange,
  })

  // ── Line orientations resolver ─────────────────────────────────────────
  const getLineOrientations = useCallback((areaKey, trapId) => {
    const globalCfg = refinedArea?.panelConfig || {}
    const override  = trapezoidConfigs[trapId] || {}
    const areaGroup = areaByGroupKey[areaKey] ?? areas[areaKey] ?? {}
    return override.lineOrientations ?? areaGroup.lineOrientations ?? globalCfg.lineOrientations ?? [PANEL_V]
  }, [refinedArea, trapezoidConfigs, areas])

  // ── Row data hook ──────────────────────────────────────────────────────
  const rowData = useRowData({
    panels, areas, refinedArea, trapezoidConfigs, setTrapezoidConfigs,
    beRailsData, beTrapezoidsData, panelSpec, appDefaults,
    getSettings: settings.getSettings, getTrapBasesSettings: settings.getTrapBasesSettings,
    getLineOrientations,
    areaSettings: settings.areaSettings, globalSettings: settings.globalSettings,
    PARAM_SCHEMA, roofType,
    setParam: settings.setParam,
  })

  const { rowKeys, areaTrapezoidMap, rowConstructions } = rowData

  const effectiveSelectedTrapId = selectedTrapezoidId ??
    (rowKeys[selectedRowIdx] != null ? (areaTrapezoidMap[rowKeys[selectedRowIdx]]?.[0] ?? null) : null)

  const selectedRC = rowConstructions[selectedRowIdx] ?? null

  // ── Selected geometry hook ─────────────────────────────────────────────
  const geo = useSelectedGeometry({
    selectedRowIdx, selectedPanelRowIdx, effectiveSelectedTrapId,
    rowKeys, areas, refinedArea, trapezoidConfigs, areaTrapezoidMap,
    beRailsData, beTrapezoidsData,
    getSettings: settings.getSettings, getTrapBasesSettings: settings.getTrapBasesSettings,
    getLineOrientations, getLineRails: rowData.getLineRails,
    updateLineRails: settings.updateLineRails,
    setParam: settings.setParam,
    areaSettings: settings.areaSettings, globalSettings: settings.globalSettings,
    panelSpec, appDefaults, PARAM_SCHEMA,
    panels,
  })

  // ── Notify host of active tab (no implicit save — Apply is explicit now) ──
  useEffect(() => {
    const tabMap = { 'areas': 'areas', 'rails': 'rails', 'bases': 'bases', 'detail': 'trapezoids' }
    onActiveTabChange?.(tabMap[activeTab] || activeTab)
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  // Apply Changes handler: await the BE save, then clear the tab's dirty flag.
  // No staging step — FE-computable params already preview live on the canvas.
  const confirmDialog = useConfirm()
  const applyTab = useCallback(async (tab: 'rails' | 'bases' | 'detail') => {
    const beTab = tab === 'detail' ? 'trapezoids' : tab
    // Snapshot which keys the user touched this session, then hand them to
    // saveTab so the payload carries only those keys. Cleared on success so
    // the next save's payload stays minimal.
    const dirtyParams = settings.getDirtyParamsForTab(tab)
    // Live snapshot from the mirror refs — propagates writes made earlier in
    // this same event tick (e.g. apply-to-all fan-out) that React state /
    // step3SettingsRef in the host haven't seen yet.
    const liveSettings = settings.getLiveSnapshot()
    try { await onTabSave?.(beTab, { dirtyParams, liveSettings }) } catch (e) { console.error(e) }
    settings.clearDirtyParamsForTab(tab)
    settings.markClean(tab)
  }, [onTabSave, settings])

  // Expose a "flush all dirty tabs" callback to the host (Next button uses it
  // to apply pending edits silently before stepping to 4).
  useEffect(() => {
    if (!flushDirtyTabsRef) return
    flushDirtyTabsRef.current = async () => {
      if (settings.dirty.rails)  await applyTab('rails')
      if (settings.dirty.bases)  await applyTab('bases')
      if (settings.dirty.detail) await applyTab('detail')
    }
    return () => { if (flushDirtyTabsRef) flushDirtyTabsRef.current = null }
  }, [flushDirtyTabsRef, settings.dirty, applyTab])

  // Mirror isAnyDirty to the host's ref so Start Over can decide whether to
  // show its confirm prompt without a heavier prop dance.
  useEffect(() => {
    if (isAnyDirtyRef) isAnyDirtyRef.current = !!settings.isAnyDirty
  }, [isAnyDirtyRef, settings.isAnyDirty])

  // Gate tab switches: if the current tab has unsaved edits, ask first.
  // The dialog offers three choices — Apply (save then switch), Discard
  // (revert in-progress edits then switch), or Cancel (stay put).
  const tabFromKey = (key: string) =>
    (key === 'detail' || key === 'rails' || key === 'bases') ? key : null
  const requestTabSwitch = useCallback(async (next: string) => {
    if (next === activeTab) return
    const cur = tabFromKey(activeTab)
    if (cur && settings.dirty[cur]) {
      const choice = await confirmDialog.ask({
        message: t('step3.unsaved.confirmSwitch', { tab: t(`step3.tabs.${activeTab}`) }),
        confirmLabel: t('step3.unsaved.applyAndSwitch'),
        discardLabel: t('step3.unsaved.discardAndSwitch'),
        cancelLabel: t('common.cancel'),
        variant: 'warning',
      })
      if (choice === false) return
      if (choice === 'discard') settings.discardDirtyParamsForTab(cur)
      else await applyTab(cur)
    }
    setActiveTab(next)
  }, [activeTab, settings, confirmDialog, t, applyTab])

  // Exit gate for bases edit mode. The layers-panel "Exit edit mode"
  // button calls this — returns true if the caller should actually
  // exit (either no dirty edits, or the user chose apply / discard).
  const requestExitBasesEdit = useCallback(async (): Promise<boolean> => {
    if (!settings.dirty.bases) return true
    const choice = await confirmDialog.ask({
      message: t('step3.editMode.exitConfirm'),
      confirmLabel: t('step3.editMode.applyAndExit'),
      discardLabel: t('step3.editMode.discardAndExit'),
      cancelLabel: t('common.cancel'),
      variant: 'warning',
    })
    if (choice === false) return false
    if (choice === 'discard') {
      setCustomBasesMap({})
      setPendingTrapOps([])
      settings.markClean('bases')
    } else {
      await applyTab('bases')
    }
    return true
  }, [settings, confirmDialog, t, applyTab])
  
  // Save initial tab to backend if it was defaulted to 'areas'
  const initialSaveRef = useRef(false)
  useEffect(() => {
    if (!initialSaveRef.current && (!initialTab || initialTab === 'null') && activeTab === 'areas') {
      onTabSave?.('areas')
      initialSaveRef.current = true
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync effects ───────────────────────────────────────────────────────
  // Seed customBasesMap with PER-ROW keys ("areaId:rowIdx") from BE data.
  // Each entry is the row's sorted mm offsets ACROSS ALL sub-traps — so
  // a row that spans A1 + A2 yields a single combined list instead of
  // two per-sub-trap lists. This is the data shape the edit bar shows
  // and the diff compares against; sub-trap reassignment is the BE's
  // responsibility (signature-based) and stays out of FE state.
  useEffect(() => {
    if (!beBasesData) return
    const map = {}
    for (const areaData of beBasesData) {
      const areaKey = areaData.areaId ?? areaData.areaLabel ?? areaData.label
      if (areaKey == null) continue
      for (const base of (areaData.bases || [])) {
        const ri = base._panelRowIdx ?? 0
        const key = `${areaKey}:${ri}`
        if (!map[key]) map[key] = []
        map[key].push(Math.round(base.offsetFromStartCm * 10))
      }
    }
    for (const k of Object.keys(map)) map[k].sort((a, b) => a - b)
    setCustomBasesMap(map)
  }, [beBasesData])

  useEffect(() => { onTrapConfigsChange?.(trapezoidConfigs) }, [trapezoidConfigs]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Expose the FULL customBasesMap to the host. The save flow derives
    // ops by diffing this map against beBasesData — entries that match
    // produce no op, so sending everything is safe and avoids the
    // userEditedBases-filter trap (which would lose ops if the set
    // missed a key for any reason).
    onCustomBasesChange?.(customBasesMap)
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
  const allTabs = [
    { key: 'areas',  label: t('step3.tabs.areas') },
    { key: 'rails',  label: t('step3.tabs.rails') },
    { key: 'bases',  label: t('step3.tabs.bases') },
    { key: 'detail', label: t('step3.tabs.detail') },
  ]
  const allFrameless = allAreasFrameless(roofType, areas)
  // Frameless roofs (tiles, flat_installation) have no construction frame →
  // hide the Detail (trapezoid) tab but keep Bases so anchor points
  // (hooks / sandwich_roof_accessory omegas) remain inspectable.
  const tabs = allFrameless
    ? allTabs.filter(t => t.key !== 'detail')
    : allTabs

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
        selectedRowIdx={selectedRowIdx} setSelectedRowIdx={(idx) => { setSelectedRowIdx(idx); setSelectedPanelRowIdx(null) }}
        selectedPanelRowIdx={selectedPanelRowIdx} setSelectedPanelRowIdx={setSelectedPanelRowIdx}
        selectedTrapezoidId={selectedTrapezoidId} setSelectedTrapezoidId={setSelectedTrapezoidId}
        effectiveSelectedTrapId={effectiveSelectedTrapId}
        trapezoidConfigs={trapezoidConfigs} panels={panels}
        activeTab={activeTab} setActiveTab={requestTabSwitch}
        dirty={settings.dirty}
        isOverride={settings.isOverride}
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
        onApplyChanges={(tab) => applyTab(tab)}
        effectiveDiagSettings={beTrapezoidsData?.[effectiveSelectedTrapId]?.effectiveDiagSettings ?? null}
        effectiveBasesSettings={beTrapezoidsData?.[effectiveSelectedTrapId]?.effectiveBasesSettings ?? null}
        trapExtensions={(() => {
          // Surface only USER variations (idx 1+) to the sidebar; idx 0 is
          // the BE default and is already represented by the parent entry.
          const out: Record<string, any[]> = {}
          for (const tid of Object.keys(beTrapezoidsData ?? {})) {
            const ext = beTrapezoidsData?.[tid]?.geometry?.extensions
            if (Array.isArray(ext) && ext.length > 1) out[tid] = ext.slice(1)
          }
          return out
        })()}
      />

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Tab bar */}
        <div style={{
          display: 'flex', borderBottom: `2px solid ${BORDER_FAINT}`,
          background: BG_LIGHT, padding: '0 1rem', gap: '0.25rem'
        }}>
          {tabs.map(tab => {
            const tabDirty = (tab.key === 'rails' || tab.key === 'bases' || tab.key === 'detail') && settings.dirty[tab.key]
            return (
              <button
                key={tab.key}
                onClick={() => requestTabSwitch(tab.key)}
                style={{
                  padding: '0.55rem 1rem', border: 'none', cursor: 'pointer',
                  fontSize: '0.8rem', fontWeight: '600',
                  background: activeTab === tab.key ? 'white' : 'transparent',
                  color: activeTab === tab.key ? TEXT : TEXT_PLACEHOLDER,
                  borderBottom: activeTab === tab.key ? `2px solid ${PRIMARY}` : '2px solid transparent',
                  marginBottom: '-2px', transition: 'all 0.15s',
                  display: 'flex', alignItems: 'center', gap: '0.35rem',
                }}
              >
                {tab.label}
                {tabDirty && (
                  <span title={t('step3.unsaved.dotTooltip')} style={{
                    display: 'inline-block', width: '7px', height: '7px',
                    borderRadius: '50%', background: WARNING,
                  }} />
                )}
              </button>
            )
          })}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {activeTab === 'areas' && <AreasTab panels={panels} areas={areas} rowKeys={rowKeys} areaLabel={settings.areaLabel} uploadedImageData={uploadedImageData} imageSrc={imageSrc} roofType={roofType} />}

          {activeTab === 'detail' && (() => {
            const areaTrapIds = areaTrapezoidMap[rowKeys[selectedRowIdx]] || []
            const fullTrapGhost = buildFullTrapGhost(
              effectiveSelectedTrapId, areaTrapIds,
              beTrapezoidsData, rowData.trapPanelLinesMap, rowData.trapLineRailsMap, rowData.trapRCMap,
            )
            return (
              <div style={{ height: '100%', overflow: 'hidden' }}>
                {(() => {
                  // Resolve roof data for this specific trap's owning area.
                  const owning = effectiveSelectedTrapId
                    ? (areas || []).find(a => (a.trapezoidIds || []).includes(effectiveSelectedTrapId))
                    : null
                  const { type: detailRoofType, purlinDistCm: detailPurlinDistCm, installationOrientation: detailOrient } =
                    resolveAreaRoofSpec(roofType, owning)
                  return (
                    <DetailView
                      rc={geo.selectedTrapezoidRC ?? selectedRC} trapId={effectiveSelectedTrapId}
                      twinIds={(beTrapezoidGroups.find(g => g.trapIds.includes(effectiveSelectedTrapId))?.trapIds ?? []).filter(id => id !== effectiveSelectedTrapId)}
                      panelLines={rowData.trapPanelLinesMap[effectiveSelectedTrapId] ?? geo.selectedRowLineDepths}
                      settings={settings.getSettings(selectedRowIdx)}
                      lineRails={rowData.trapLineRailsMap[effectiveSelectedTrapId] ?? geo.selectedLineRails}
                      highlightParam={highlightParam}
                      beDetailData={beTrapezoidsData?.[effectiveSelectedTrapId]}
                      effectiveDetailSettings={beTrapezoidsData?.[effectiveSelectedTrapId]?.effectiveDetailSettings ?? null}
                      fullTrapGhost={fullTrapGhost}
                      paramGroup={PARAM_GROUP}
                      reverseBlockPunches={settings.globalSettings.reverseBlockPunches ?? true}
                      onReset={() => settings.resetDetailSettings(selectedRowIdx)}
                      onUpdateSetting={(key, val) => settings.updateSetting(selectedRowIdx, key, val)}
                      roofType={detailRoofType}
                      purlinDistCm={detailPurlinDistCm}
                      installationOrientation={detailOrient}
                    />
                  )
                })()}
              </div>
            )
          })()}

          {activeTab === 'rails' && (
            <div style={{ height: '100%', overflow: 'hidden' }}>
              <RailLayoutTab
                panels={panels} refinedArea={refinedArea}
                uploadedImageData={uploadedImageData} imageSrc={imageSrc}
                selectedRowIdx={selectedRowIdx} selectedPanelRowIdx={selectedPanelRowIdx}
                settings={settings.getSettings(selectedRowIdx)}
                lineRails={geo.areaLineRails}
                panelDepthsCm={geo.areaLinePanelDepths}
                keepSymmetry={settings.getSettings(selectedRowIdx).keepSymmetry ?? true}
                onLineRailsChange={(newRails) => settings.updateLineRails(selectedRowIdx, newRails)}
                onApplyRailsToAll={() => settings.applySection(selectedRowIdx, ['lineRails'])}
                onResetRails={settings.resetLineRails}
                highlightGroup={PARAM_GROUP[highlightParam] ?? null}
                trapSettingsMap={rowData.trapSettingsMap}
                railsComputing={railsComputing}
                beRailsData={beRailsData}
                rectAreas={rectAreas}
              />
            </div>
          )}

          <div style={{ display: activeTab === 'bases' ? 'flex' : 'none', height: '100%', flexDirection: 'column' }}>
            <BasesPlanTab
              panels={panels} refinedArea={refinedArea} areas={areas}
              uploadedImageData={uploadedImageData} imageSrc={imageSrc}
              effectiveSelectedTrapId={effectiveSelectedTrapId}
              selectedRowIdx={selectedRowIdx} rowKeys={rowKeys}
              selectedPanelRowIdx={selectedPanelRowIdx}
              trapSettingsMap={rowData.trapSettingsMap}
              trapLineRailsMap={rowData.trapLineRailsMap}
              trapRCMap={rowData.trapRCMap}
              beTrapezoidsData={beTrapezoidsData}
              beBasesData={beBasesData}
              beRailsData={beRailsData}
              highlightGroup={PARAM_GROUP[highlightParam] ?? null}
              customBasesMap={customBasesMap}
              onBasesChange={(areaKey, offsets, panelRowIdx) => {
                // customBasesMap is keyed PER ROW now (`areaId:rowIdx`),
                // not per sub-trap — so a multi-sub-trap row writes back
                // to a single key with all bases' sorted offsets.
                const key = `${areaKey}:${panelRowIdx ?? selectedPanelRowIdx}`
                setCustomBasesMap(prev => ({ ...prev, [key]: offsets }))
                // Drag-edits don't go through useStep3Settings setters; mark
                // the bases tab dirty explicitly so the Apply UX kicks in.
                settings.markDirty('bases')
              }}
              onTrapExtend={pushTrapExtendOp}
              pendingTrapOps={pendingTrapOps}
              onRequestExitEdit={requestExitBasesEdit}
              onResetBases={() => settings.resetTrapBases(effectiveSelectedTrapId, {
                clearAll: () => {
                  setCustomBasesMap({})
                },
              })}
              roofType={roofType}
              purlinDistCm={purlinDistCm}
              installationOrientation={installationOrientation}
              globalRailConfig={{
                overhangCm: settings.globalSettings.railOverhangCm,
                stockLengths: settings.globalSettings.stockLengths,
                crossRailEdgeDistMm: settings.globalSettings.crossRailEdgeDistMm,
              }}
              areaByGroupKey={rowData.areaByGroupKey}
            />
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDialog.pending}
        message={confirmDialog.pending?.message ?? ''}
        title={confirmDialog.pending?.title}
        variant={confirmDialog.pending?.variant}
        confirmLabel={confirmDialog.pending?.confirmLabel || t('common.confirm')}
        cancelLabel={confirmDialog.pending?.cancelLabel || t('common.cancel')}
        discardLabel={confirmDialog.pending?.discardLabel}
        onConfirm={confirmDialog.handleConfirm}
        onCancel={confirmDialog.handleCancel}
        onDiscard={confirmDialog.handleDiscard}
      />
    </div>
  )
}
