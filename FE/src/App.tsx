import { useState, useEffect, useCallback, useRef } from 'react'
import { PRIMARY, AREA_PALETTE, ERROR_DARK, ERROR_BG, ERROR } from './styles/colors'
import { PANEL_V } from './utils/panelCodes'
import { useLang } from './i18n/LangContext'
import LangToggle from './i18n/LangToggle'
import Step1RoofAllocation from './components/steps/Step1RoofAllocation'
import Step2PanelPlacement from './components/steps/Step2PanelPlacement'
import Step3ConstructionPlanning from './components/steps/Step3ConstructionPlanning'
import Step4PlanApproval from './components/steps/Step4PlanApproval'
import Step5PdfReport from './components/steps/Step5PdfReport'
import Step6ElectricalSettings from './components/steps/Step6ElectricalSettings'
import Step7StringsPlan from './components/steps/Step7StringsPlan'
import Step8ElectricalApproval from './components/steps/Step8ElectricalApproval'
import Step9ElectricalBom from './components/steps/Step9ElectricalBom'
import FinalSummary from './components/steps/FinalSummary'
import WelcomeScreen from './components/WelcomeScreen'
import HelpButton from './components/HelpButton'
import FinishCelebration from './components/FinishCelebration'
import ConfirmDialog from './components/ConfirmDialog'
import { useConfirm } from './hooks/useConfirm'
import ProjectInfoModal from './components/ProjectInfoModal'
import MyAccount from './components/MyAccount'
import { useProjectState } from './hooks/useProjectState'
import { useAuth } from './hooks/useAuth'
import AuthModal from './components/auth/AuthModal'
import UserChip from './components/auth/UserChip'
import VerifyBanner from './components/VerifyBanner'
import PromoBanner from './components/PromoBanner'
import { listProjects, getProject, updateProject, deleteProject, getConstructionData, updateStep, saveTab, resetTab, StepTransitionError } from './services/projectsApi'
import { buildBaseOpsFromState } from './utils/baseOpsBuilder'
import { buildBlockOpsFromState } from './utils/blockOpsBuilder'
import { STEP_GROUPS, LAST_STEP_ID, isLastStep } from './config/steps'
import './App.css'

// Trap-scope schema params persisted server-side under step3.trapezoidConfigs
// (mirrors BE TRAP_SCHEMA_PARAM_KEYS). On every BE result these are re-synced
// authoritatively — stripped then re-applied from the server — so an unsaved
// optimistic edit can't outlive the server's truth. Keep in sync with the BE.
const TRAP_SCHEMA_PARAM_KEYS = ['edgeOffsetMm', 'spacingMm', 'baseOverhangCm', 'extendFront', 'extendRear']

function App() {
  const s = useProjectState()
  const auth = useAuth()
  const { t } = useLang()

  const [step4PdfData, setStep4PdfData] = useState({ trapSettingsMap: {}, trapLineRailsMap: {}, trapRCMap: {}, customBasesMap: {}, trapPanelLinesMap: {} })
  const [step3ResetKey, setStep3ResetKey] = useState(0)
  const [showAuthGate, setShowAuthGate] = useState(false)
  const [saveState, setSaveState] = useState(null) // null | 'saving' | 'saved' | 'error'
  const PAGE_SIZE = 10
  const [cloudProjects, setCloudProjects] = useState([])
  const [cloudProjectsLoading, setCloudProjectsLoading] = useState(false)
  const [totalProjectsCount, setTotalProjectsCount] = useState(0)
  const [hasMoreProjects, setHasMoreProjects] = useState(false)
  const [projectsSearch, setProjectsSearch] = useState('')
  const [urlResetToken, setUrlResetToken] = useState(null) // reset token from URL param
  const [verifyBanner, setVerifyBanner] = useState(null)  // null | 'success' | 'error'
  const [showNextTooltip, setShowNextTooltip] = useState(false)
  const confirmDialog = useConfirm()
  // Server-side step-transition validation errors (set when updateStep returns 400)
  const [stepTransitionErrors, setStepTransitionErrors] = useState<
    null | { fromStep: number; toStep: number; errors: Array<{ code: string; field: string; params?: Record<string, any> }> }
  >(null)
  // One-shot signal: logout sets this to true so the welcome screen opens the
  // login modal as soon as it mounts. On normal load we don't auto-open —
  // the user clicks "New Project" (or the UserChip sign-in) when they're ready.
  const [openLoginOnWelcome, setOpenLoginOnWelcome] = useState(false)
  // Celebration modal shown when the user clicks Finish on step 5.
  const [showFinishModal, setShowFinishModal] = useState(false)
  const [showProjectInfo, setShowProjectInfo] = useState(false)
  // My Account modal — opened from UserChip (non-admin avatar click + balance
  // pill) and from the insufficient-credits banner CTA.
  const [showMyAccount, setShowMyAccount] = useState(false)

  // Handle ?verifyToken= and ?resetToken= URL params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const verifyToken = params.get('verifyToken')
    const resetToken = params.get('resetToken')
    if (verifyToken) {
      window.history.replaceState({}, '', window.location.pathname)
      auth.verifyEmail(verifyToken)
        .then(() => setVerifyBanner('success'))
        .catch(() => setVerifyBanner('error'))
    } else if (resetToken) {
      window.history.replaceState({}, '', window.location.pathname)
      setUrlResetToken(resetToken)
      setShowAuthGate(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchCloudProjects = useCallback(async (searchTerm = '') => {
    if (!auth.user) return
    setCloudProjectsLoading(true)
    try {
      const data = await listProjects({ limit: PAGE_SIZE, offset: 0, search: searchTerm || null })
      setCloudProjects(data.projects || [])
      setTotalProjectsCount(data.total || 0)
      setHasMoreProjects(data.has_more || false)
    } catch {
      setCloudProjects([])
      setTotalProjectsCount(0)
      setHasMoreProjects(false)
    } finally {
      setCloudProjectsLoading(false)
    }
  }, [auth.user])

  useEffect(() => {
    if (auth.user) fetchCloudProjects(projectsSearch)
    else { setCloudProjects([]); setHasMoreProjects(false) }
  }, [auth.user, projectsSearch, fetchCloudProjects])

  const [beRailsData, setBeRailsData] = useState(null)
  const [beBasesData, setBeBasesData] = useState(null)
  const [beTrapezoidsData, setBeTrapezoidsData] = useState(null)
  const [beTrapezoidGroups, setBeTrapezoidGroups] = useState([])
  const [savedActiveTab, setSavedActiveTab] = useState(null)
  const [railsComputing] = useState(false)
  const [basesComputing] = useState(false)
  // Always-current step3 settings — updated synchronously in onSettingsChange so commit
  // callbacks never read stale state from the React re-render cycle.
  const step3SettingsRef = useRef({ globalSettings: s.step3GlobalSettings, areaSettings: s.step3AreaSettings })
  const trapConfigsRef = useRef(s.trapezoidConfigs)
  const customBasesRef = useRef({})
  // Mirror of customBlocksMap held in Step3ConstructionPlanning. Per-trapezoid
  // user block edits (drag / add / delete) collected in the trap-detail edit
  // mode. Diffed against beTrapezoidsData via buildBlockOpsFromState on the
  // trapezoids tab save.
  const customBlocksRef = useRef<Record<string, { positionCm: number; isEnd?: boolean }[]>>({})
  // Pending step3 extend ops (TrapExtendOp[]) accumulated by drag handlers
  // in BasesPlanTab. The authoritative state lives in Step3ConstructionPlanning
  // (so the canvas can re-render with each pending op as a live preview);
  // this ref just mirrors it for the bases-tab save flow. App.tsx itself
  // doesn't need to re-render on every op — Step3 already does.
  const pendingTrapOpsRef = useRef<any[]>([])
  // Pending base ops are NOT accumulated per click anymore — they're
  // derived on save from the customBasesMap snapshot via
  // buildBaseOpsFromState. The ref is kept for the discard path (so a
  // pending FE-state reset still has a single place to clear).
  const step3ActiveTabRef = useRef(savedActiveTab || 'areas')
  // Filled by Step3ConstructionPlanning so Next can flush all dirty tabs to BE.
  const step3FlushDirtyRef = useRef<null | (() => Promise<void>)>(null)
  // Step 5 publishes its PDF / quotation handlers here so the Summary hub can
  // trigger them while Step 5 is mounted off-screen.
  const step5ExportRef = useRef<any>(null)
  // Step 9 publishes its electrical PDF / equipment-quotation handlers here so
  // the Final hub can trigger them while Step 9 is mounted off-screen.
  const step9ExportRef = useRef<any>(null)
  // Mirrors `settings.isAnyDirty` from useStep3Settings. Used by Start Over
  // to skip the confirm prompt when there's nothing to lose. Default `true`
  // so before step 3 has mounted (or on a fresh project), Start Over still
  // warns — only step 3 explicitly reporting "clean" suppresses the prompt.
  const step3IsAnyDirtyRef = useRef<boolean>(true)

  // Fetch construction data when a (different) project is loaded while on step 3+.
  // Step 2→3 transition is handled explicitly in the Next button after save completes.
  // Must cover every step ≥3 (not just 3/5): the Summary hub (step 10) mounts
  // Step 5 off-screen to generate the PDF/quotation, which needs rails/bases
  // data — so a cold reload landing on the Summary still has to fetch it.
  useEffect(() => {
    if (s.currentStep >= 3 && s.cloudProjectId) {
      getConstructionData(s.cloudProjectId)
        .then(applyBeResult)
        .catch(console.error)
    }
  // Only cloudProjectId should trigger this — currentStep transitions are handled in Next button
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.cloudProjectId])

  const applyBeResult = (result) => {
    // Unified handler: accepts { data: { step2, step3, ... } } or legacy { step3: { ... } }
    const data = result.data || result
    const step2 = data.step2 || {}
    const step3 = data.step3 || {}
    if (!step3) return

    // Merge step2 area data (panelRows, roofSpec, trapezoidIds) into existing
    // areas. Don't replace — existing areas have correct structure from
    // handleImportProject/computePanels; we only add fields the FE load skips.
    if (step2.areas) {
      const s2ByLabel = {}
      const s2ById = {}
      for (const a of step2.areas) {
        if (a.label) s2ByLabel[a.label] = a
        if (a.id != null) s2ById[a.id] = a
      }
      s.setAreas(prev => prev.map(a => {
        const s2a = s2ByLabel[a.label] ?? (a.id != null ? s2ById[a.id] : null)
        if (!s2a) return a
        return {
          ...a,
          id: s2a.id ?? a.id,
          trapezoidIds: s2a.trapezoidIds ?? a.trapezoidIds,
          panelRows: s2a.panelRows ?? a.panelRows,
          roofSpec: s2a.roofSpec ?? a.roofSpec,
        }
      }))
    }

    const { computedAreas = [], computedTrapezoids = [] } = step3

    // Flatten rails, tagging each with _panelRowIdx for per-row lookup
    const flattenRailsWithRowIdx = (d) => {
      if (!d) return []
      if (Array.isArray(d)) return d
      const result = []
      for (const [rowIdx, items] of Object.entries(d) as [string, any[]][]) {
        for (const item of items) {
          result.push({ ...item, _panelRowIdx: Number(rowIdx) })
        }
      }
      return result
    }

    // Convert to rails format (flatten per-row dict to flat list).
    // crossRowRails are area-level (already flat) and pass through unchanged.
    const railsData = computedAreas.map(ca => ({
      areaId: ca.areaId,
      areaLabel: ca.label || '',
      rails: flattenRailsWithRowIdx(ca.rails),
      crossRowRails: ca.crossRowRails || [],
      numLargeGaps: ca.numLargeGaps ?? 0,
    }))
    setBeRailsData(railsData)

    // Convert to bases format (flatten per-row dict, tag each base with _panelRowIdx)
    const flattenBasesWithRowIdx = (d) => {
      if (!d) return []
      if (Array.isArray(d)) return d
      const result = []
      for (const [rowIdx, items] of Object.entries(d) as [string, any[]][]) {
        for (const item of items) {
          result.push({ ...item, _panelRowIdx: Number(rowIdx) })
        }
      }
      return result
    }
    const basesData = computedAreas.map(ca => ({
      areaId: ca.areaId,
      areaLabel: ca.label || '',
      bases: flattenBasesWithRowIdx(ca.bases),
      diagonals: ca.diagonals || [],
    }))
    setBeBasesData(basesData)

    // Convert to trapezoidDetails format (object keyed by trapezoidId)
    const trapDetails = {}
    computedTrapezoids.forEach(ct => {
      if (ct.trapezoidId) {
        trapDetails[ct.trapezoidId] = ct
      }
    })
    setBeTrapezoidsData(trapDetails)

    // Groups of structurally identical traps — populated by the BE at the end
    // of compute_and_save_trapezoid_details. Older projects without this field
    // fall back to one group per trap on the consumer side.
    setBeTrapezoidGroups(step3.trapezoidGroups ?? [])

    // ── Authoritative sync of user-editable settings ────────────────────
    // The BE is the source of truth: every applyBeResult caller (load,
    // construction-data, saveTab, resetTab, updateStep) returns the FULL
    // project data, so these fields reflect exactly what the server kept.
    // Replace unconditionally (absent → {}) so a server-side mutation
    // (reset_tab stripping keys, clamping) or an unsaved optimistic edit can
    // never outlive the server's truth.
    s.setStep3GlobalSettings(step3.globalSettings ?? {})
    s.setStep3AreaSettings(step3.areaSettings ?? {})
    step3SettingsRef.current = {
      ...step3SettingsRef.current,
      globalSettings: step3.globalSettings ?? {},
      areaSettings: step3.areaSettings ?? {},
    }
    // Authoritatively re-sync trap-scope SCHEMA params from the server.
    // `step3.trapezoidConfigs` is the BE's source of truth for these keys;
    // a key ABSENT there means "default", so we STRIP any stale optimistic
    // override the FE still holds, then re-apply whatever the server kept.
    // (Mirrors the full-replace of global/area settings above — an additive
    // merge could never pull a value back down to the server default, which
    // is why an unsaved edit used to survive step navigation.) FE-only fields
    // (angle / frontHeight / lineOrientations) come from step2.areas[]
    // .trapezoids[], not this map, so they're preserved.
    const persistedTraps = (step3.trapezoidConfigs && typeof step3.trapezoidConfigs === 'object')
      ? step3.trapezoidConfigs as Record<string, any>
      : {}
    s.setTrapezoidConfigs(prev => {
      const next: Record<string, any> = {}
      for (const [trapId, cfg] of Object.entries((prev || {}) as Record<string, any>)) {
        const cleaned: Record<string, any> = { ...cfg }
        TRAP_SCHEMA_PARAM_KEYS.forEach(k => delete cleaned[k])
        const serverCfg = persistedTraps[trapId] || {}
        for (const k of TRAP_SCHEMA_PARAM_KEYS) {
          if (serverCfg[k] !== undefined) cleaned[k] = serverCfg[k]
        }
        next[trapId] = cleaned
      }
      // Server traps not present in prev (rare) — seed with their schema params.
      for (const [trapId, cfg] of Object.entries(persistedTraps)) {
        if (!next[trapId]) next[trapId] = { ...cfg }
      }
      return next
    })

    // Re-sync the BE-normalized drag-edit override snapshots into the reducer.
    // These (customBasesOffsets / customDiagonals) aren't read for rendering,
    // but they ride the full-project save payload (getProjectData spreads all
    // of data.step3). The BE renumbers/normalizes them on each recompute, so
    // without this a later full save would write a STALE copy back over the
    // server's truth. Mirror exactly what the server holds (absent → {}).
    s.patchStep3({
      customBasesOffsets: step3.customBasesOffsets ?? {},
      customDiagonals: step3.customDiagonals ?? {},
    })
  }

  // Build tab-specific payload to send only relevant settings and overrides
  const buildTabPayload = (tabName, dirtyParams = null, liveSettings = null) => {
    // Prefer the live snapshot (sync from useStep3Settings refs) when given —
    // it includes apply-to-all writes from this same event tick that
    // step3SettingsRef hasn't seen yet (it updates via post-render useEffect).
    const { globalSettings, areaSettings } = liveSettings ?? step3SettingsRef.current
    const trapezoidConfigs = liveSettings?.trapezoidConfigs ?? trapConfigsRef.current ?? {}

    // Get parameter keys for this section from paramSchema
    const tabSection = tabName === 'trapezoids' ? 'detail' : tabName
    const sectionParams = (s.paramSchema || []).filter(p => p.section === tabSection)

    // When dirtyParams is provided, send ONLY keys the user changed this
    // session. Otherwise (legacy callers, no per-key info) fall back to the
    // section-wide filter so the BE still gets a coherent payload.
    const dirtyGlobalKeys: Set<string> | null = dirtyParams?.global ?? null
    const dirtyAreaByIdx: Record<number, Set<string>> | null = dirtyParams?.area ?? null
    const dirtyTrapByTrap: Record<string, Set<string>> | null = dirtyParams?.trap ?? null

    const filteredGlobal = {}
    sectionParams.filter(p => p.scope === 'global').forEach(p => {
      if (dirtyGlobalKeys && !dirtyGlobalKeys.has(p.key)) return
      if (globalSettings?.[p.key] != null) filteredGlobal[p.key] = globalSettings[p.key]
    })

    const filteredArea = {}
    const areaParamKeys = sectionParams.filter(p => p.scope === 'area').map(p => p.key)
    Object.keys(areaSettings || {}).forEach(areaIdx => {
      const area = areaSettings[areaIdx] || {}
      const dirtyKeysForArea = dirtyAreaByIdx?.[Number(areaIdx)] ?? null
      const filtered = {}
      areaParamKeys.forEach(key => {
        if (dirtyKeysForArea && !dirtyKeysForArea.has(key)) return
        if (area[key] != null) filtered[key] = area[key]
      })
      if (Object.keys(filtered).length > 0) filteredArea[areaIdx] = filtered
    })

    // Trap-scope params (edgeOffsetMm, spacingMm, baseOverhangCm for bases;
    // extendFront/Rear for detail). These live in trapezoidConfigs and ride
    // the legacy top-level `trapezoidConfigs` field on the request — the BE
    // merges those into project.data.step3.trapezoidConfigs as overrides.
    const filteredTraps: Record<string, Record<string, any>> = {}
    const trapParamKeys = sectionParams.filter(p => p.scope === 'trapezoid').map(p => p.key)
    if (trapParamKeys.length > 0) {
      Object.keys(trapezoidConfigs || {}).forEach(trapId => {
        const cfg = trapezoidConfigs[trapId] || {}
        const dirtyKeysForTrap = dirtyTrapByTrap?.[trapId] ?? null
        const filtered: Record<string, any> = {}
        trapParamKeys.forEach(key => {
          if (dirtyKeysForTrap && !dirtyKeysForTrap.has(key)) return
          if (cfg[key] != null) filtered[key] = cfg[key]
        })
        if (Object.keys(filtered).length > 0) filteredTraps[trapId] = filtered
      })
    }

    // Overrides only carry edit-mode artefacts (future rails-edit mode +
    // bases drag). The spacing input now flows through settings.areas as a
    // regular railSpacingV/H param, so no overrides.rails branch is needed.
    const overrides: Record<string, any> = {}

    if (tabName === 'rails') {
      const railOverrides = {}
      Object.keys(areaSettings || {}).forEach(areaIdx => {
        const lineRails = areaSettings[areaIdx]?.lineRails
        if (!lineRails) return
        const dirtyKeysForArea = dirtyAreaByIdx?.[Number(areaIdx)] ?? null
        if (dirtyKeysForArea && !dirtyKeysForArea.has('lineRails')) return
        const areaKey = parseInt(areaIdx)
        const areaLabel = s.areas[areaKey]?.label || s.areas[areaKey]?.id || String(areaIdx)
        railOverrides[areaLabel] = lineRails
      })
      if (Object.keys(railOverrides).length > 0) overrides.rails = railOverrides
    }

    return {
      settings: {
        global: Object.keys(filteredGlobal).length > 0 ? filteredGlobal : undefined,
        areas: Object.keys(filteredArea).length > 0 ? filteredArea : undefined,
      },
      // BE accepts trap-scope params via the top-level `trapezoidConfigs`
      // field (it merges them as overrides on project.data.step3.trapezoidConfigs).
      trapezoidConfigs: Object.keys(filteredTraps).length > 0 ? filteredTraps : undefined,
      overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
    }
  }

  const handleTabSave = useCallback(async (tabName, opts) => {
    if (!s.cloudProjectId) return

    // 'areas' tab is view-only, no backend save needed
    if (tabName === 'areas') return
    
    try {
      // opts.dirtyParams (when set by applyTab) limits the payload to keys the
      // user actually changed this session. Resets and other legacy callers
      // pass nothing and fall back to the section-wide payload.
      // opts.liveSettings (when set) is a sync snapshot from the step3 hook's
      // mirror refs — necessary when applyTab fires right after a same-tick
      // apply-to-all fan-out so the destination areas/traps are visible.
      const payload: Record<string, any> = buildTabPayload(
        tabName, opts?.dirtyParams ?? null, opts?.liveSettings ?? null,
      )

      // Add tab-specific overrides
      if (tabName === 'bases') {
        payload.overrides = payload.overrides || {}

        // Derive base ops from the diff between the user-intended state
        // (customBasesRef) and the BE snapshot. Consolidates identical
        // changes across rows into one op with multiple targets — handles
        // the "added to all rows then deleted one" case naturally because
        // the diff outputs exactly the rows that still differ.
        const baseOps = buildBaseOpsFromState(customBasesRef.current, beBasesData)
        if (baseOps.length > 0) {
          payload.overrides.bases = baseOps
        } else if (opts?.resetTrapId) {
          // Reset-to-defaults still uses the legacy snapshot dict (one
          // empty-list entry per trap to clear) since it isn't a diff.
          payload.overrides.bases = { [opts.resetTrapId]: [] }
        }

        // Drain pending trap extend ops (front/back base-beam
        // variations). BE consumes them under overrides.traps as a
        // flat-targets list, same shape as BaseOp. Two save-time
        // touch-ups before sending:
        //   1) Delete-cascade: prune any targeted base that is ALSO
        //      in a delete op from the op's targets list. If the
        //      targets list ends up empty, drop the op entirely.
        //      Key by (areaId, rowIdx, baseId) since baseIds collide
        //      across rows.
        //   2) Strip the FE-only `_sessionId` tag.
        // Ops are sent in chronological order — BE applies them in
        // order, last-write-wins per base. The user does fan-out
        // first, then per-base refinements naturally win.
        let pendingTraps = pendingTrapOpsRef.current
        if (pendingTraps && pendingTraps.length > 0) {
          const deletedBaseKeys = new Set<string>()
          for (const op of baseOps) {
            if (op.op === 'delete') {
              for (const t of (op.targets ?? [])) {
                if (t.baseId) deletedBaseKeys.add(`${t.areaId}:${t.rowIdx}:${t.baseId}`)
              }
            }
          }
          if (deletedBaseKeys.size > 0) {
            pendingTraps = pendingTraps
              .map(op => ({
                ...op,
                targets: (op.targets ?? []).filter((t: any) =>
                  !deletedBaseKeys.has(`${t.areaId}:${t.rowIdx}:${t.baseId}`),
                ),
              }))
              .filter(op => (op.targets ?? []).length > 0)
          }
          if (pendingTraps.length > 0) {
            payload.overrides.traps = pendingTraps.map(({ _sessionId, ...op }) => op)
          }
        }

      } else if (tabName === 'trapezoids') {
        // Trapezoids tab overrides: diagonal positions from areaSettings
        const diagOverrides = {}
        const { areaSettings } = step3SettingsRef.current
        
        // Build area -> trapezoid mapping from panels (normalize keys to strings)
        const areaTrapMap = {}
        s.panels.forEach(p => {
          const areaIdx = String(p.area)  // Normalize to string
          const trapId = p.trapezoidId
          if (p.area != null && trapId) {
            if (!areaTrapMap[areaIdx]) areaTrapMap[areaIdx] = []
            if (!areaTrapMap[areaIdx].includes(trapId)) areaTrapMap[areaIdx].push(trapId)
          }
        })
        
        // For each area with diagOverrides, map to its trapezoid(s)
        Object.keys(areaSettings || {}).forEach(areaIdx => {
          const areaDiagOverrides = areaSettings[areaIdx]?.diagOverrides
          if (!areaDiagOverrides || typeof areaDiagOverrides !== 'object') return

          const trapIds = areaTrapMap[areaIdx] || []
          const trapId = trapIds[0] || `${String.fromCharCode(65 + parseInt(areaIdx))}1`

          const diagObj = {}
          for (const [spanIdx, diag] of Object.entries(areaDiagOverrides) as [string, any][]) {
            const { topDistFromLegCm, botDistFromLegCm, disabled } = diag
            if (disabled === true) {
              diagObj[spanIdx] = { disabled: true }
            } else if (topDistFromLegCm != null && botDistFromLegCm != null) {
              diagObj[spanIdx] = { topDistFromLegCm, botDistFromLegCm }
            }
          }
          if (Object.keys(diagObj).length > 0) {
            diagOverrides[trapId] = diagObj
          }
        })
        if (Object.keys(diagOverrides).length > 0) {
          payload.overrides = payload.overrides || {}
          payload.overrides.diagonals = diagOverrides
        }

        // Block ops from the customBlocksMap diff against the BE snapshot.
        // Reset-trap flow sends a snapshot dict `{ trapId: [] }` instead;
        // that path is handled in the unified reset handler, not here.
        const blockOps = buildBlockOpsFromState(customBlocksRef.current, beTrapezoidsData)
        if (blockOps.length > 0) {
          payload.overrides = payload.overrides || {}
          payload.overrides.blocks = blockOps
        }
      }

      const result = await saveTab(s.cloudProjectId, tabName, payload)
      applyBeResult(result)
    } catch (e) { console.error(e) }
  }, [s.cloudProjectId, s.areas]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleTabReset = useCallback(async (tabName) => {
    if (!s.cloudProjectId) return
    try {
      applyBeResult(await resetTab(s.cloudProjectId, tabName))
    } catch (e) { console.error(e) }
  }, [s.cloudProjectId])

  const handleCloudSave = async (step = null) => {
    setSaveState('saving')
    try {
      const id = await s.handleSaveProject(step)
      setSaveState('saved')
      // No need to refresh projects list during wizard — will fetch fresh when returning to welcome screen
      setTimeout(() => setSaveState(null), 2500)
      return id
    } catch {
      setSaveState('error')
      setTimeout(() => setSaveState(null), 3000)
      return null
    }
  }

  const handleAuthGateSuccess = async (tab, email, password, fullName, phone, company) => {
    if (tab === 'login') await auth.login(email, password)
    else await auth.register(email, password, fullName, phone, company)
    setShowAuthGate(false)
    // If the user signed back in mid-wizard (UserChip → Sign In), flush
    // the current in-memory state to BE so subsequent step transitions
    // build on a saved baseline. For the reset-token URL flow no project
    // is in memory yet — handleCloudSave is a no-op in that case.
    try { await handleCloudSave(s.currentStep) } catch (e) { console.error(e) }
  }

  const handleLoadCloudProject = async (projectId) => {
    try {
      const cloudProject = await getProject(projectId)
      // Merge layout + data columns into the shape handleImportProject expects
      const layout = cloudProject.layout ?? {}
      const currentStep = cloudProject.navigation?.step ?? layout.currentStep ?? 1
      const savedTab = cloudProject.navigation?.tab
      // Treat null, "null" string, and undefined as no saved tab
      const activeTab = (savedTab && savedTab !== 'null') 
        ? savedTab 
        : (currentStep === 3 ? 'areas' : null)
      const merged = {
        project:     {
          name: cloudProject.name,
          clientName: cloudProject.client_name,
          location: cloudProject.location,
          date: cloudProject.created_at,
          roofSpec: cloudProject.roof_spec,
          // Credits markers — needed so the FE doesn't re-prompt the 2→3
          // confirm dialog on an already-charged project, and so Step 5's
          // Get-Quotation button shows the right label on a previously-
          // quoted project.
          credits_charged_at: cloudProject.credits_charged_at ?? null,
          quotation_requested_at: cloudProject.quotation_requested_at ?? null,
        },
        currentStep,
        activeTab,
        layout,
        ...(cloudProject.data ?? {}),
      }
      setSavedActiveTab(merged.activeTab)
      s.handleImportProject(merged, cloudProject.id)
      // Seed BE data immediately from the project's saved data.
      // Pass both step2 + step3 so areas get panelRows and BE rails/bases are set.
      if (cloudProject.data?.step3) {
        applyBeResult(cloudProject.data)
      }
    } catch (err) {
      alert(t('app.loadProjectError', { msg: err.message }))
    }
  }

  const handleUpdateCloudProject = async (projectId, name, clientName, location) => {
    try {
      await updateProject(projectId, { name, client_name: clientName, location })
      setCloudProjects(prev => prev.map(p => p.id === projectId ? { ...p, name, client_name: clientName, location } : p))
    } catch (err) {
      alert(`Could not update project: ${err.message}`)
    }
  }

  const handleDeleteCloudProject = async (projectId) => {
    if (!await confirmDialog.ask({ message: t('app.deleteProjectConfirm'), variant: 'danger' })) return
    try {
      await deleteProject(projectId)
      setCloudProjects(prev => prev.filter(p => p.id !== projectId))
      setTotalProjectsCount(prev => Math.max(0, prev - 1))
    } catch (err) {
      alert(t('app.deleteProjectError', { msg: err.message }))
    }
  }

  // Sign out wipes the in-memory project state and returns to the welcome
  // screen — keeping a cloud project open after logout would leak it into a
  // subsequent anonymous session.
  const handleLogout = async () => {
    await auth.logout()
    s.handleStartOver()
    setProjectsSearch('')
    setOpenLoginOnWelcome(true)
  }

  const handleStartOver = async () => {
    // Skip the prompt only when the user is on step 3 AND every step-3 tab
    // is clean (project in sync with BE, nothing to lose). On any other step
    // we don't have a robust "is this dirty" signal, so we always warn.
    const skipConfirm = s.currentStep === 3 && !step3IsAnyDirtyRef.current
    if (!skipConfirm) {
      if (!await confirmDialog.ask({ message: t('app.startOverConfirm'), variant: 'warning' })) return
    }
    s.handleStartOver()
    setProjectsSearch('')
    if (auth.user) {
      try {
        const data = await listProjects({ limit: PAGE_SIZE })
        setCloudProjects(data.projects || [])
        setTotalProjectsCount(data.total || 0)
        setHasMoreProjects(data.has_more || false)
      } catch (err) {
        console.error('Failed to fetch latest project:', err)
      }
    }
  }

  const handleLoadMoreProjects = useCallback(async () => {
    if (!auth.user || !hasMoreProjects) return
    setCloudProjectsLoading(true)
    try {
      const data = await listProjects({ limit: PAGE_SIZE, offset: cloudProjects.length, search: projectsSearch || null })
      setCloudProjects(prev => [...prev, ...(data.projects || [])])
      setTotalProjectsCount(data.total || 0)
      setHasMoreProjects(data.has_more || false)
    } catch {
      // keep existing projects on failure
    } finally {
      setCloudProjectsLoading(false)
    }
  }, [auth.user, hasMoreProjects, cloudProjects.length, projectsSearch])

  const handleProjectsSearch = useCallback((query) => {
    setProjectsSearch(query)
  }, [])

  // ConfirmDialog is rendered in both branches so dialogs raised from the
  // welcome screen (e.g. delete project) actually appear.
  const confirmDialogElement = (
    <ConfirmDialog
      open={!!confirmDialog.pending}
      message={confirmDialog.pending?.message ?? ''}
      title={confirmDialog.pending?.title}
      variant={confirmDialog.pending?.variant}
      confirmLabel={confirmDialog.pending?.confirmLabel || t('common.confirm')}
      cancelLabel={confirmDialog.pending?.cancelLabel || t('common.cancel')}
      onConfirm={confirmDialog.handleConfirm}
      onCancel={confirmDialog.handleCancel}
    />
  )

  // Top banner — priority: amber warning (unverified) first; otherwise the
  // green admin promo (if a message is set). Shown across both app screens.
  const topBanner = (auth.user && !auth.user.is_verified)
    ? <VerifyBanner user={auth.user} onResend={auth.resendVerification} />
    : <PromoBanner promo={s.appDefaults} />

  if (s.appScreen === 'welcome') {
    return (
      <>
        {topBanner}
        <WelcomeScreen
          onCreateProject={s.handleCreateProject}
          user={auth.user}
          onLogin={auth.login}
          onRegister={auth.register}
          onLogout={handleLogout}
          onUpdateProfile={auth.updateProfile}
          onOpenAccount={() => setShowMyAccount(true)}
          onAdminClose={() => { s.refreshAppSettings(); s.refreshPanelTypes() }}
          authLoading={auth.authLoading}
          cloudProjects={cloudProjects}
          cloudProjectsLoading={cloudProjectsLoading}
          totalProjectsCount={totalProjectsCount}
          hasMoreProjects={hasMoreProjects}
          onLoadCloudProject={handleLoadCloudProject}
          onUpdateCloudProject={handleUpdateCloudProject}
          onDeleteCloudProject={handleDeleteCloudProject}
          onLoadMoreProjects={handleLoadMoreProjects}
          onProjectsSearch={handleProjectsSearch}
          projectsSearch={projectsSearch}
          onForgotPassword={auth.forgotPassword}
          onResetPassword={auth.resetPassword}
          trialGrantCredits={Number(s.appDefaults?.trialGrantCredits ?? 0)}
          appConfigReady={s.appConfigReady}
          resetToken={urlResetToken}
          onClearResetToken={() => setUrlResetToken(null)}
          openLoginOnMount={openLoginOnWelcome}
          onClearOpenLogin={() => setOpenLoginOnWelcome(false)}
        />
        {showMyAccount && auth.user && (
          <MyAccount
            user={auth.user}
            onClose={() => setShowMyAccount(false)}
            onRefresh={auth.refreshMe}
            onUpdateProfile={auth.updateProfile}
            onResendVerification={auth.resendVerification}
            onSignOut={() => { setShowMyAccount(false); handleLogout() }}
          />
        )}
        {confirmDialogElement}
      </>
    )
  }

  // App settings must be loaded before any step renders — Step3 is kept mounted
  // and dereferences panelSpec.lengthCm unconditionally, so there is no safe
  // fallback path. Show a minimal splash until /settings/defaults and
  // /products/panel-types return.
  if (!s.appConfigReady) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: '0.75rem' }}>
        <svg width="28" height="28" viewBox="0 0 24 24" style={{ animation: 'spin 1s linear infinite', color: PRIMARY }}>
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="31.4 31.4" strokeLinecap="round" />
        </svg>
        <div style={{ fontSize: '0.85rem', color: 'rgba(0,0,0,0.55)' }}>{t('welcome.loadingSettings')}</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  return (
    <div className="app">
      {/* Header Area */}
      <header className="app-header">
        <div className="header-content">

          {/* LEFT: Brand + project */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: 0 }}>
            <img src="/mgp-logo.svg" alt="MyGreenPlanner Logo" style={{ height: '52px', width: 'auto', flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <h1 style={{ margin: 0 }}>{t('app.title')}</h1>
              {s.currentProject?.name ? (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '2px', minWidth: 0 }}>
                  <span
                    onClick={() => setShowProjectInfo(true)}
                    title={t('projectInfo.title')}
                    style={{ fontSize: '0.85rem', fontWeight: '600', color: PRIMARY, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '260px', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'transparent', transition: 'text-decoration-color 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.textDecorationColor = PRIMARY)}
                    onMouseLeave={e => (e.currentTarget.style.textDecorationColor = 'transparent')}
                  >
                    {s.currentProject.name}
                  </span>
                  {s.currentProject.location && (
                    <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>
                      · {s.currentProject.location}
                    </span>
                  )}
                  <span style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.28)', whiteSpace: 'nowrap' }}>
                    {s.currentProject.date ? new Date(s.currentProject.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''}
                  </span>
                  {/* Charged-project marker — subtle pill, opens the project
                      details modal on click. Visible to all roles since the
                      charge is a property of the project. */}
                  {s.currentProject.credits_charged_at && (
                    <span
                      onClick={() => setShowProjectInfo(true)}
                      title={t('projectInfo.charged.tooltip')}
                      style={{
                        fontSize: '0.6rem', fontWeight: 700,
                        color: 'rgba(255,255,255,0.65)',
                        background: 'rgba(255,255,255,0.08)',
                        border: '1px solid rgba(255,255,255,0.18)',
                        padding: '1px 6px', borderRadius: 999,
                        display: 'inline-flex', alignItems: 'center', gap: 3,
                        whiteSpace: 'nowrap', cursor: 'pointer',
                        textTransform: 'uppercase', letterSpacing: '0.05em',
                      }}
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                      {t('projectInfo.charged.badge')}
                    </span>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>{t('app.subtitle')}</div>
              )}
            </div>
          </div>

          {/* Server status */}
          {!s.appConfigReady && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.25rem 0.6rem', borderRadius: '6px', background: 'rgba(235,87,87,0.15)', marginRight: '0.5rem' }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#eb5757', flexShrink: 0 }} />
              <span style={{ fontSize: '0.68rem', fontWeight: 600, color: '#eb5757', whiteSpace: 'nowrap' }}>Server offline</span>
            </div>
          )}

          {/* RIGHT: Icon actions (e-commerce style) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.1rem', flexShrink: 0 }}>

            {/* Sadot Energy branding */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', paddingRight: '0.75rem', borderRight: '1px solid rgba(255,255,255,0.13)', marginRight: '0.25rem' }}>
              <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('app.by')}</span>
              <img src="/sadot-logo.png" alt="Sadot Energy" style={{ height: '22px', width: 'auto', filter: 'brightness(0) invert(1)', opacity: 0.7 }} />
            </div>

            {/* Language toggle */}
            <LangToggle dark />

            {/* User chip — avatar / sign-in / admin gear */}
            <UserChip
              user={auth.user}
              onSignIn={() => setShowAuthGate(true)}
              onSignOut={handleLogout}
              onUpdateProfile={auth.updateProfile}
              onOpenAccount={() => setShowMyAccount(true)}
              onAdminClose={() => { s.refreshAppSettings(); s.refreshPanelTypes() }}
              dark
            />

            {/* Divider */}
            <div style={{ width: '1px', height: '36px', background: 'rgba(255,255,255,0.13)', margin: '0 0.2rem' }} />

            {/* Start Over icon button */}
            <button
              onClick={handleStartOver}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', background: 'none', border: 'none', cursor: 'pointer', padding: '0.3rem 0.65rem', color: 'rgba(255,255,255,0.55)' }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10"/>
                <path d="M3.51 15a9 9 0 1 0 .49-3.21"/>
              </svg>
              <span style={{ fontSize: '0.6rem', fontWeight: '600', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{t('app.startOver')}</span>
            </button>

            <HelpButton currentStep={s.currentStep} />
          </div>

        </div>
      </header>

      {topBanner}

      <main className="app-main">
        {s.currentStep === 1 && (
          <Step1RoofAllocation
            roofSource={s.roofSource}
            setRoofSource={s.setRoofSource}
            uploadedImageData={s.uploadedImageData}
            imageSrc={s.imageSrc}
            handleImageUploaded={s.handleImageUploaded}
            imageRef={s.imageRef}
            setImageRef={s.setImageRef}
            roofPolygon={s.roofPolygon}
            setRoofPolygon={s.setRoofPolygon}
            setUploadedImageData={s.setUploadedImageData}
            isDrawingLine={s.isDrawingLine}
            setIsDrawingLine={s.setIsDrawingLine}
            lineStart={s.lineStart}
            setLineStart={s.setLineStart}
            referenceLine={s.referenceLine}
            setReferenceLine={s.setReferenceLine}
            referenceLineLengthCm={s.referenceLineLengthCm}
            setReferenceLineLengthCm={s.setReferenceLineLengthCm}
          />
        )}

        {s.currentStep === 2 && (
          <Step2PanelPlacement
            uploadedImageData={s.uploadedImageData}
            imageSrc={s.imageSrc}
            roofPolygon={s.roofPolygon}
            refinedArea={s.refinedArea}
            imageRef={s.imageRef}
            setImageRef={s.setImageRef}
            baseline={{ p1: [0, 0], p2: [1, 1] }}
            setBaseline={() => {}}
            panels={s.panels}
            setPanels={s.setPanels}
            selectedPanels={s.selectedPanels}
            setSelectedPanels={s.setSelectedPanels}
            dragState={s.dragState}
            setDragState={s.setDragState}
            rotationState={s.rotationState}
            setRotationState={s.setRotationState}
            viewZoom={s.viewZoom}
            setViewZoom={s.setViewZoom}
            showBaseline={false}
            showDistances={s.showDistances}
            setShowDistances={s.setShowDistances}
            distanceMeasurement={s.distanceMeasurement}
            setDistanceMeasurement={s.setDistanceMeasurement}
            regenerateSingleRowHandler={s.regenerateSingleRowHandler}
            refreshAreaTrapezoids={s.refreshAreaTrapezoids}
            rebuildPanelGrid={s.rebuildPanelGrid}
            recordPanelDeletion={s.recordPanelDeletion}
            clearDeletedPanelsForArea={s.clearDeletedPanelsForArea}
            deletedPanelKeys={s.deletedPanelKeys}
            setDeletedPanelKeys={s.setDeletedPanelKeys}
            skipNextRecompute={s.skipNextRecompute}
            areas={s.areas}
            setAreas={s.setAreas}
            addManualPanel={s.addManualPanel}
            trapezoidConfigs={s.trapezoidConfigs}
            setTrapezoidConfigs={s.setTrapezoidConfigs}
            rectAreas={s.rectAreas}
            setRectAreas={s.setRectAreas}
            onAddRectArea={(rawRect, addToGroupId) => {
              s.setRectAreas(prev => {
                // When the project is mixed, every new standalone area starts
                // as concrete; added rows inherit their parent group's spec.
                const isMixed = s.currentProject?.roofSpec?.type === 'mixed'
                // Unique row ID: use min of existing IDs minus 1 (never collides,
                // even after deletions). BE may reassign positive IDs on save.
                const minId = prev.length > 0 ? Math.min(0, ...prev.map(a => a.id ?? 0)) : 0
                const rowId = minId - 1
                if (addToGroupId != null) {
                  // Adding a new row to an existing area group
                  const parentArea = prev.find(a => a.areaGroupId === addToGroupId)
                  const groupRows = prev.filter(a => a.areaGroupId === addToGroupId)
                  const nextRowIndex = groupRows.length
                  return [...prev, {
                    ...rawRect,
                    id: rowId,
                    label: parentArea?.label ?? '',
                    color: parentArea?.color ?? AREA_PALETTE[prev.length % AREA_PALETTE.length],
                    // New rows inherit a/h from the global default (general a/h).
                    // If global is empty, row stays empty — user must fill before Next.
                    frontHeight: s.panelFrontHeight ?? '',
                    angle: s.panelAngle ?? '',
                    areaGroupId: addToGroupId,
                    rowIndex: nextRowIndex,
                    areaVertical: parentArea?.areaVertical ?? false,
                    rotation: rawRect.rotation ?? 0,
                    manualTrapezoids: false,
                    manualColTrapezoids: {},
                    roofSpec: isMixed ? (parentArea?.roofSpec ?? { type: 'concrete' }) : null,
                  }]
                }
                // New standalone area — row id and areaGroupId start identical
                const newLabel = String.fromCharCode(65 + prev.length % 26)
                return [...prev, {
                  ...rawRect,
                  id: rowId,
                  label: newLabel,
                  color: AREA_PALETTE[prev.length % AREA_PALETTE.length],
                  frontHeight: s.panelFrontHeight ?? '',
                  angle: s.panelAngle ?? '',
                  areaGroupId: rowId,
                  rowIndex: 0,
                  manualTrapezoids: false,
                  manualColTrapezoids: {},
                  roofSpec: isMixed ? { type: 'concrete' } : null,
                }]
              })
            }}
            cmPerPixel={(() => {
              if (s.refinedArea?.pixelToCmRatio) return s.refinedArea.pixelToCmRatio
              if (!s.referenceLine || !s.referenceLineLengthCm) return null
              const dx = s.referenceLine.end.x - s.referenceLine.start.x
              const dy = s.referenceLine.end.y - s.referenceLine.start.y
              const len = Math.sqrt(dx * dx + dy * dy)
              return len > 0 ? parseFloat(s.referenceLineLengthCm) / len : null
            })()}
            panelTypes={s.panelTypes}
            panelType={s.panelType}
            setPanelType={s.setPanelType}
            panelFrontHeight={s.panelFrontHeight}
            setPanelFrontHeight={s.setPanelFrontHeight}
            panelAngle={s.panelAngle}
            setPanelAngle={s.setPanelAngle}
            appDefaults={s.appDefaults}
            paramLimits={s.paramLimits}
            roofType={s.currentProject?.roofSpec?.type}
            rowMounting={s.rowMounting}
            setRowMounting={s.setRowMounting}
            roofAxis={s.roofAxis}
            setRoofAxis={s.setRoofAxis}
            roofAxisEnabled={s.roofAxisEnabled}
            setRoofAxisEnabled={s.setRoofAxisEnabled}
          />
        )}
        {/* Step3 stays mounted so onPdfDataChange fires even when on step 4+.
            No overflow:hidden here — that breaks position:fixed in CanvasNavigator. */}
        <div style={{ display: s.currentStep === 3 ? undefined : 'none', height: '100%' }}>
          <Step3ConstructionPlanning
            key={step3ResetKey}
            user={auth.user}
            panels={s.panels}
            refinedArea={s.refinedArea}
            rectAreas={s.rectAreas}
            uploadedImageData={s.uploadedImageData}
            imageSrc={s.imageSrc}
            railsComputing={railsComputing}
            onTabSave={handleTabSave}
            onTabReset={handleTabReset}
            onActiveTabChange={(tab) => { step3ActiveTabRef.current = tab }}
            flushDirtyTabsRef={step3FlushDirtyRef}
            isAnyDirtyRef={step3IsAnyDirtyRef}
            trapezoidConfigs={s.trapezoidConfigs}
            setTrapezoidConfigs={s.setTrapezoidConfigs}
            areas={s.areas}
            initialGlobalSettings={s.step3GlobalSettings}
            initialAreaSettings={s.step3AreaSettings}
            initialTab={savedActiveTab}
            onSettingsChange={(g, a) => { step3SettingsRef.current = { globalSettings: g, areaSettings: a }; s.setStep3GlobalSettings(g); s.setStep3AreaSettings(a) }}
            onTrapConfigsChange={(configs) => { trapConfigsRef.current = configs }}
            onCustomBasesChange={(map) => { customBasesRef.current = map }}
            onCustomBlocksChange={(map) => { customBlocksRef.current = map }}
            onTrapExtendOpsChange={(ops) => { pendingTrapOpsRef.current = ops }}
            onPdfDataChange={setStep4PdfData}
            beRailsData={beRailsData}
            beBasesData={beBasesData}
            beTrapezoidsData={beTrapezoidsData}
            beTrapezoidGroups={beTrapezoidGroups}
            basesComputing={basesComputing}
            appDefaults={s.appDefaults}
            paramSchema={s.paramSchemaForRoof}
            settingsDefaults={s.settingsDefaults}
            paramGroup={s.paramGroup}
            panelSpec={s.panelSpec}
            roofType={s.currentProject?.roofSpec?.type || 'concrete'}
            purlinDistCm={s.currentProject?.roofSpec?.distanceBetweenPurlinsCm || 0}
            installationOrientation={s.currentProject?.roofSpec?.installationOrientation || null}
          />
        </div>

        {s.currentStep === 4 && (
          <Step4PlanApproval
            user={auth.user}
            projectId={s.cloudProjectId}
            onEnsureSaved={s.handleSaveProject}
            planApproval={s.step4PlanApproval}
            onApprovalChange={s.setStep4PlanApproval}
          />
        )}

        {(s.currentStep === 5 || isLastStep(s.currentStep)) && (
          <div style={isLastStep(s.currentStep)
            ? { position: 'absolute', width: '100vw', height: '100vh', left: '-99999px', top: 0, overflow: 'hidden', pointerEvents: 'none' }
            : { height: '100%' }}>
          <Step5PdfReport
            user={auth.user}
            exportApiRef={step5ExportRef}
            hideActions={true}
            panels={s.panels}
            refinedArea={s.refinedArea}
            areas={s.areas}
            rectAreas={s.rectAreas}
            project={s.currentProject}
            projectId={s.cloudProjectId}
            uploadedImageData={s.uploadedImageData}
            imageSrc={s.imageSrc}
            trapSettingsMap={step4PdfData.trapSettingsMap}
            trapLineRailsMap={step4PdfData.trapLineRailsMap}
            trapRCMap={step4PdfData.trapRCMap}
            customBasesMap={step4PdfData.customBasesMap}
            trapPanelLinesMap={step4PdfData.trapPanelLinesMap}
            roofType={s.currentProject?.roofSpec?.type || 'concrete'}
            panelTypes={s.panelTypes}
            beRailsData={beRailsData}
            beBasesData={beBasesData}
            beTrapezoidsData={beTrapezoidsData}
            beTrapezoidGroups={beTrapezoidGroups}
            bomDeltas={s.step5BomDeltas ?? {}}
            onBomDeltasChange={s.setStep5BomDeltas}
            onQuotationRequested={(timestamp) => {
              s.setCurrentProject({
                ...s.currentProject,
                quotation_requested_at: timestamp,
              })
            }}
            products={s.products}
            productByType={s.productByType}
            altsByType={s.altsByType}
          />
          </div>
        )}

        {s.currentStep === 6 && (
          <Step6ElectricalSettings
            projectId={s.cloudProjectId}
            settings={s.step6Settings}
            onSettingsChange={s.setStep6Settings}
            inverters={s.step6Inverters}
            onInvertersChange={s.setStep6Inverters}
            batteries={s.step6Batteries}
            onBatteriesChange={s.setStep6Batteries}
            onSave={() => handleCloudSave(s.currentStep)}
            panelCount={(s.panels || []).filter((p: any) => !p.isEmpty).length}
            totalKw={(s.panels || []).filter((p: any) => !p.isEmpty).length * (s.panelSpec?.kw || 0) / 1000}
            areaCount={(s.areas || []).length}
            roofType={s.currentProject?.roofSpec?.type || 'concrete'}
            panelTypeName={s.panelSpec?.name || s.currentProject?.panelType}
            panelSadotUrl={s.panelSpec?.sadotUrl}
          />
        )}

        {s.currentStep === 7 && (
          <Step7StringsPlan
            projectId={s.cloudProjectId}
            panels={s.panels}
            inverters={s.step6Inverters}
            strings={s.step7Strings}
            onStringsChange={s.setStep7Strings}
            inverterLayout={s.step7InverterLayout}
            onInverterLayoutChange={s.setStep7InverterLayout}
            mode={s.step7Mode}
            onModeChange={s.setStep7Mode}
            panelWatt={s.panelSpec?.kw}
          />
        )}

        {s.currentStep === 8 && (
          <Step8ElectricalApproval
            user={auth.user}
            projectId={s.cloudProjectId}
            onEnsureSaved={s.handleSaveProject}
            planApproval={s.step8PlanApproval}
            onApprovalChange={s.setStep8PlanApproval}
          />
        )}

        {(s.currentStep === 9 || isLastStep(s.currentStep)) && (
          <div style={isLastStep(s.currentStep)
            ? { position: 'absolute', width: '100vw', height: '100vh', left: '-99999px', top: 0, overflow: 'hidden', pointerEvents: 'none' }
            : { height: '100%' }}>
          <Step9ElectricalBom
            projectId={s.cloudProjectId}
            project={s.currentProject}
            user={auth.user}
            exportApiRef={step9ExportRef}
            hideActions={isLastStep(s.currentStep)}
            panels={s.panels}
            strings={s.step7Strings}
            inverterLayout={s.step7InverterLayout}
            panelWatt={s.panelSpec?.kw}
            panelTypeName={s.panelSpec?.name || s.currentProject?.panelType}
            inverters={s.step6Inverters}
            onQuotationRequested={(timestamp) => {
              s.setCurrentProject({ ...s.currentProject, quotation_requested_at: timestamp })
            }}
          />
          </div>
        )}

        {isLastStep(s.currentStep) && (
          <FinalSummary
            projectId={s.cloudProjectId}
            projectName={s.currentProject?.name}
            isAdmin={auth.user?.role === 'admin'}
            panelCount={(s.panels || []).filter((p: any) => !p.isEmpty).length}
            totalKw={(s.panels || []).filter((p: any) => !p.isEmpty).length * (s.panelSpec?.kw || 0) / 1000}
            areaCount={(s.areas || []).length}
            roofType={s.currentProject?.roofSpec?.type || 'concrete'}
            panelTypeName={s.panelSpec?.name || s.currentProject?.panelType}
            hasRequestedQuotation={!!s.currentProject?.quotation_requested_at}
            onGetQuotation={() => step5ExportRef.current?.requestQuotation?.('full')}
            onDownloadPdf={() => step5ExportRef.current?.generatePdf?.()}
            onGetEquipmentQuotation={() => step9ExportRef.current?.requestQuotation?.()}
            onDownloadElectricalPdf={() => step9ExportRef.current?.generatePdf?.()}
            onDownloadEquipmentXlsx={() => step9ExportRef.current?.downloadEquipmentXlsx?.()}
            inverters={s.step6Inverters}
            stringsCount={(s.step7Strings || []).length}
            electricalApproval={s.step8PlanApproval}
            onFinish={() => setShowFinishModal(true)}
          />
        )}

        {showAuthGate && (
          <AuthModal
            onClose={() => { setShowAuthGate(false); setUrlResetToken(null) }}
            onSuccess={handleAuthGateSuccess}
            onForgotPassword={auth.forgotPassword}
            onResetPassword={auth.resetPassword}
            resetToken={urlResetToken}
            trialGrantCredits={Number(s.appDefaults?.trialGrantCredits ?? 0)}
          />
        )}

        <FinishCelebration
          open={showFinishModal}
          onDone={() => { setShowFinishModal(false); s.handleStartOver() }}
        />

        {showProjectInfo && s.currentProject && (
          <ProjectInfoModal
            project={s.currentProject}
            onClose={() => setShowProjectInfo(false)}
          />
        )}

        {showMyAccount && auth.user && (
          <MyAccount
            user={auth.user}
            onClose={() => setShowMyAccount(false)}
            onRefresh={auth.refreshMe}
            onUpdateProfile={auth.updateProfile}
            onResendVerification={auth.resendVerification}
            onSignOut={() => { setShowMyAccount(false); handleLogout() }}
          />
        )}

        {verifyBanner && (
          <div style={{
            position: 'fixed', bottom: '1.5rem', left: '50%', transform: 'translateX(-50%)',
            zIndex: 1100, padding: '0.75rem 1.25rem', borderRadius: '10px',
            background: verifyBanner === 'success' ? '#e8f5e9' : '#ffebee',
            color: verifyBanner === 'success' ? '#2e7d32' : '#c62828',
            boxShadow: '0 4px 20px rgba(0,0,0,0.12)', fontSize: '0.88rem', fontWeight: '600',
            display: 'flex', alignItems: 'center', gap: '0.6rem',
          }}>
            {verifyBanner === 'success' ? t('app.verifySuccess') : t('app.verifyFailed')}
            <button onClick={() => setVerifyBanner(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1, padding: 0, color: 'inherit', opacity: 0.6 }}>×</button>
          </div>
        )}

        {stepTransitionErrors && (() => {
          // Insufficient credits is the only error code that has a "fix" action
          // surfaced inline — open My Account so the user sees their balance +
          // the (future) top-up flow. Other codes are content errors with no
          // standardized CTA.
          const hasInsufficientCredits = stepTransitionErrors.errors.some(e => e.code === 'insufficientCredits')
          return (
            <div style={{
              position: 'fixed', bottom: '5rem', left: '50%', transform: 'translateX(-50%)',
              zIndex: 1100, maxWidth: '32rem', padding: '0.85rem 1.1rem', borderRadius: '10px',
              background: ERROR_BG, color: ERROR_DARK,
              boxShadow: '0 4px 20px rgba(0,0,0,0.12)', fontSize: '0.85rem',
              border: `1px solid ${ERROR}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, marginBottom: '0.4rem' }}>{t('app.stepTransitionError')}</div>
                  <ul style={{ margin: 0, paddingInlineStart: '1.2rem' }}>
                    {stepTransitionErrors.errors.map((err, i) => (
                      <li key={i} style={{ marginBottom: '0.2rem' }}>
                        {t(`step2.error.${err.code}` as any, err.params || {})}
                      </li>
                    ))}
                  </ul>
                  {hasInsufficientCredits && (
                    <button
                      onClick={() => { setStepTransitionErrors(null); setShowMyAccount(true) }}
                      style={{
                        marginTop: '0.55rem', background: ERROR_DARK, color: 'white',
                        border: 'none', borderRadius: 6, padding: '0.4rem 0.75rem',
                        fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer',
                      }}
                    >
                      {t('step2.error.insufficientCredits.cta')}
                    </button>
                  )}
                </div>
                <button onClick={() => setStepTransitionErrors(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1, padding: 0, color: 'inherit', opacity: 0.6 }}>×</button>
              </div>
            </div>
          )
        })()}
      </main>

      {/* Wizard Toolbar */}
      <footer className="wizard-toolbar">
        <button className="btn-nav btn-back" onClick={async () => {
          if (s.currentStep > 1 && s.cloudProjectId) {
            // Back from the Final summary returns to where the user actually
            // came from, not a blind step-1: Path C (did the string plan /
            // approval) → 9; Path B (picked inverters then skipped) → 6;
            // Path A (skipped from construction) → 5. Derived from the data
            // so it survives a reload. Normal steps just go back one.
            const nextStep = isLastStep(s.currentStep)
              ? (((s.step7Strings || []).length || s.step8PlanApproval?.strictConsent)
                  ? 9
                  : ((s.step6Inverters || []).length ? 6 : 5))
              : s.currentStep - 1
            // ── Credits guard: a charged project cannot reset to step 1.
            //    Going back to step 1 would let the user redo the whole
            //    plan for free. The guard is a property of the PROJECT,
            //    not the user — admins viewing a charged project see
            //    the same block (the BE rejects the request either way).
            //    Offer Start Over (= new project) as the explicit way out.
            const isChargedProjectResetToStep1 = (
              nextStep === 1 &&
              !!s.currentProject?.credits_charged_at
            )
            if (isChargedProjectResetToStep1) {
              const proceed = await confirmDialog.ask({
                title: t('step2.error.chargedProjectCannotResetToStep1.title'),
                message: t('step2.error.chargedProjectCannotResetToStep1.message'),
                confirmLabel: t('nav.startOverNew'),
                cancelLabel: t('common.cancel'),
              })
              if (proceed) {
                s.handleStartOver()
              }
              return
            }
            if (!await confirmDialog.ask({
              message: t('nav.backWarning', { from: s.currentStep, to: nextStep }),
              variant: 'warning',
            })) return
            const result = await updateStep(s.cloudProjectId, nextStep).catch(console.error)
            if (result?.clearedSteps) {
              s.resetStepData(result.clearedSteps)
              if (result.clearedSteps.includes('step3')) setStep3ResetKey(k => k + 1)
            }
            // Jump to the computed target (may be a multi-step skip back from
            // Final), rather than a single-step decrement.
            s.setCurrentStep(nextStep)
            return
          }
          s.handleBack()
        }} disabled={s.currentStep === 1}>
          {t('nav.back')}
        </button>

        {/* Compact 3-group step bar: the group containing the current step
            expands to its numbered sub-steps; other groups collapse to a
            labeled row of dots (done = brand color, upcoming = grey). */}
        <div className="wizard-phases">
          {STEP_GROUPS.map((g) => {
            const isActiveGroup = g.steps.some(st => st.id === s.currentStep)
            const allDone = g.steps.every(st => s.currentStep > st.id)
            return (
              <div key={g.key} className={`wizard-phase ${isActiveGroup ? 'active' : ''} ${allDone ? 'completed' : ''}`}>
                <div className="wizard-phase-label">{t(g.nameKey)}</div>
                <div className="wizard-phase-steps">
                  {g.steps.map((st) => {
                    const done = s.currentStep > st.id
                    const current = s.currentStep === st.id
                    if (!isActiveGroup) {
                      return <span key={st.id} className={`wizard-dot ${done ? 'completed' : ''}`} title={t(st.nameKey)} />
                    }
                    return (
                      <div key={st.id} className={`wizard-step ${current ? 'active' : ''} ${done ? 'completed' : ''}`}>
                        <div className="step-number">{done ? '✓' : st.id}</div>
                        <div className="step-name">{t(st.nameKey)}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Skip to the Final summary — only on the construction exit (5) and
            the electrical entry (6). Path A/B: leaves with partial data and
            never triggers the electrical charge (skip=true). */}
        {(s.currentStep === 5 || s.currentStep === 6) && (
          <button
            className="btn-nav btn-back"
            style={{ marginInlineEnd: '0.5rem' }}
            onClick={async () => {
              const stepBefore = s.currentStep
              const savedId = await handleCloudSave(stepBefore)
              if (!savedId) return
              try {
                const stepResult = await updateStep(savedId, LAST_STEP_ID, true)
                applyBeResult(stepResult)
                s.setCurrentStep(LAST_STEP_ID)
              } catch (e) { console.error(e) }
            }}
          >
            {t('nav.skipToLast')}
          </button>
        )}

        <span
          style={{ position: 'relative', display: 'inline-block' }}
          onMouseEnter={() => setShowNextTooltip(true)}
          onMouseLeave={() => setShowNextTooltip(false)}
        >
        {showNextTooltip && (() => {
          const blockers = s.getNextStepBlockers()
          if (blockers.length === 0) return null
          return (
            <div style={{
              position: 'absolute', bottom: 'calc(100% + 8px)', right: 0,
              background: '#222', color: '#fff', padding: '8px 12px', borderRadius: 6,
              fontSize: '0.8rem', whiteSpace: 'nowrap', zIndex: 1000,
              boxShadow: '0 2px 8px rgba(0,0,0,0.25)', pointerEvents: 'none',
            }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('nav.blocker.header')}</div>
              {blockers.map(k => <div key={k}>• {t(k)}</div>)}
            </div>
          )
        })()}
        <button
          className="btn-nav btn-next"
          style={!s.canProceedToNextStep() ? { pointerEvents: 'none' } : undefined}
          onClick={async () => {
            // On the final step the button reads "Finish" — show the
            // celebration popup instead of trying to advance.
            if (isLastStep(s.currentStep)) {
              setShowFinishModal(true)
              return
            }
            const stepBeforeNext = s.currentStep
            // ── Credits: confirm prompt on first 2→3 transition ─────────────
            // Skipped for admins (unlimited usage) and for already-charged
            // projects (re-traversal stays free).
            const isCreditsUser = auth.user && auth.user.role !== 'admin'
            const alreadyCharged = !!s.currentProject?.credits_charged_at
            if (stepBeforeNext === 2 && isCreditsUser && !alreadyCharged) {
              const cost = Number(s.appDefaults?.projectCostCredits ?? 0)
              const available = auth.user?.credits_available ?? 0
              if (cost > 0) {
                const proceed = await confirmDialog.ask({
                  title: t('step2.confirmCredits.title'),
                  message: t('step2.confirmCredits.message', { cost, available }),
                })
                if (!proceed) return
              }
            }
            // ── Credits: NON-REFUNDABLE confirm on first 6→7 transition ──────
            // Unlocking the string plan is committed work. Never fires on
            // accidental nav — only on this explicit Next, with a danger dialog.
            const alreadyElecCharged = !!s.currentProject?.electrical_charged_at
            if (stepBeforeNext === 6 && isCreditsUser && !alreadyElecCharged) {
              const cost = Number(s.appDefaults?.electricalCostCredits ?? 0)
              const available = auth.user?.credits_available ?? 0
              if (cost > 0) {
                const proceed = await confirmDialog.ask({
                  title: t('step6.confirmElectricalCredits.title'),
                  message: t('step6.confirmElectricalCredits.message', { cost, available }),
                  variant: 'danger',
                })
                if (!proceed) return
              }
            }
            // Run pre-transition prep (e.g. refresh trapezoids for 2→3) WITHOUT
            // advancing currentStep yet — the visual advance must wait for the
            // server's 200 OK so a BE rejection keeps the user on this step.
            s.handleNext(LAST_STEP_ID, { advance: false })
            // Let React flush the prep's state updates before save reads them.
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
            setStepTransitionErrors(null)
            const savedId = await handleCloudSave(stepBeforeNext)
            if (!savedId) return  // save failed — handleCloudSave already surfaced it
            // Auto-apply any unsaved step-3 edits (rails/bases/detail) before
            // the transition. The Step3 component fills step3FlushDirtyRef
            // with a function that awaits saveTab for every dirty tab and
            // clears its dirty flag.
            if (stepBeforeNext === 3 && step3FlushDirtyRef.current) {
              try { await step3FlushDirtyRef.current() } catch (e) { console.error(e) }
            }
            try {
              const stepResult = await updateStep(savedId, stepBeforeNext + 1)
              applyBeResult(stepResult)
              // First successful forward entry into step 3+ charges the project
              // server-side. Mirror that marker locally so re-entering 2→3
              // doesn't re-trigger the confirm prompt (BE is the source of
              // truth — it would no-op the re-charge — but the FE prompt
              // gate needs the same signal). Skipped for admins (no charge).
              if (
                stepBeforeNext === 2 &&
                auth.user?.role !== 'admin' &&
                !s.currentProject?.credits_charged_at
              ) {
                s.setCurrentProject({
                  ...s.currentProject,
                  credits_charged_at: new Date().toISOString(),
                })
                // The charge moved the balance — pull the fresh /auth/me so
                // the UserChip pill + MyAccount totals reflect it without
                // waiting for a tab-focus refresh.
                auth.refreshMe?.().catch(() => {})
              }
              // Mirror the NON-REFUNDABLE electrical charge marker on first 6→7.
              if (
                stepBeforeNext === 6 &&
                auth.user?.role !== 'admin' &&
                !s.currentProject?.electrical_charged_at
              ) {
                s.setCurrentProject({
                  ...s.currentProject,
                  electrical_charged_at: new Date().toISOString(),
                })
                auth.refreshMe?.().catch(() => {})
              }
              s.advanceToNextStep()
            } catch (e) {
              if (e instanceof StepTransitionError) {
                setStepTransitionErrors({ fromStep: e.fromStep, toStep: e.toStep, errors: e.errors })
              } else {
                console.error(e)
                setSaveState('error')
                setTimeout(() => setSaveState(null), 3000)
              }
            }
          }}
          disabled={!s.canProceedToNextStep()}
        >
          {isLastStep(s.currentStep) ? t('nav.finish') : t('nav.next')}
        </button>
        </span>
      </footer>

      {confirmDialogElement}
    </div>
  )
}

export default App
