import { useState, useEffect, useCallback, useRef } from 'react'
import { PRIMARY, AREA_PALETTE } from './styles/colors'
import { useLang } from './i18n/LangContext'
import LangToggle from './i18n/LangToggle'
import Step1RoofAllocation from './components/steps/Step1RoofAllocation'
import Step2PanelPlacement from './components/steps/Step2PanelPlacement'
import Step3ConstructionPlanning from './components/steps/Step3ConstructionPlanning'
import Step4PlanApproval from './components/steps/Step4PlanApproval'
import Step5PdfReport from './components/steps/Step4PdfReport'
import WelcomeScreen from './components/WelcomeScreen'
import HelpButton from './components/HelpButton'
import { useProjectState } from './hooks/useProjectState'
import { useAuth } from './hooks/useAuth'
import AuthModal from './components/auth/AuthModal'
import UserChip from './components/auth/UserChip'
import { listProjects, getProject, updateProject, deleteProject, getConstructionData, updateStep, saveTab, resetTab } from './services/projectsApi'
import './App.css'

const TOTAL_STEPS = 5

const LOGIN_REQUIRED_STEP = 3   // step 3+ (construction planning, approval, export) require login

function App() {
  const s = useProjectState()
  const auth = useAuth()
  const { t } = useLang()

  const STEP_NAME = {
    1: t('step.1.name'),
    2: t('step.2.name'),
    3: t('step.3.name'),
    4: t('step.4.name'),
    5: t('step.5.name'),
  }
  const [step4PdfData, setStep4PdfData] = useState({ trapSettingsMap: {}, trapLineRailsMap: {}, trapRCMap: {}, customBasesMap: {}, trapPanelLinesMap: {} })
  const [showAuthGate, setShowAuthGate] = useState(false)
  const [pendingAction, setPendingAction] = useState(null) // 'next'
  const [saveState, setSaveState] = useState(null) // null | 'saving' | 'saved' | 'error'
  const [cloudProjects, setCloudProjects] = useState([])
  const [cloudProjectsLoading, setCloudProjectsLoading] = useState(false)
  const [totalProjectsCount, setTotalProjectsCount] = useState(0)
  const [projectsLimit, setProjectsLimit] = useState(10) // null = load all
  const [urlResetToken, setUrlResetToken] = useState(null) // reset token from URL param
  const [verifyBanner, setVerifyBanner] = useState(null)  // null | 'success' | 'error'

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

  const requireLogin = (action) => {
    if (auth.user) return true
    setPendingAction(action)
    setShowAuthGate(true)
    return false
  }

  const fetchCloudProjects = useCallback(async () => {
    if (!auth.user) return
    setCloudProjectsLoading(true)
    try {
      const data = await listProjects(projectsLimit)
      setCloudProjects(data.projects || [])
      setTotalProjectsCount(data.total || 0)
    } catch {
      setCloudProjects([])
      setTotalProjectsCount(0)
    } finally {
      setCloudProjectsLoading(false)
    }
  }, [auth.user, projectsLimit])

  useEffect(() => {
    if (auth.user) fetchCloudProjects()
    else setCloudProjects([])
  }, [auth.user, fetchCloudProjects])

  const [beRailsData, setBeRailsData] = useState(null)
  const [beBasesData, setBeBasesData] = useState(null)
  const [beTrapezoidsData, setBeTrapezoidsData] = useState(null)
  const [savedActiveTab, setSavedActiveTab] = useState(null)
  const [railsComputing] = useState(false)
  const [basesComputing] = useState(false)
  // Always-current step3 settings — updated synchronously in onSettingsChange so commit
  // callbacks never read stale state from the React re-render cycle.
  const step3SettingsRef = useRef({ globalSettings: s.step3GlobalSettings, areaSettings: s.step3AreaSettings })
  const trapConfigsRef = useRef(s.trapezoidConfigs)
  const customBasesRef = useRef({})

  // Fetch construction data when a (different) project is loaded while on step 3+.
  // Step 2→3 transition is handled explicitly in the Next button after save completes.
  useEffect(() => {
    if ((s.currentStep === 3 || s.currentStep === 5) && s.cloudProjectId) {
      getConstructionData(s.cloudProjectId)
        .then(result => {
          setBeRailsData(result.rails)
          setBeBasesData(result.bases)
          setBeTrapezoidsData(result.trapezoidDetails)
        })
        .catch(console.error)
    }
  // Only cloudProjectId should trigger this — currentStep transitions are handled in Next button
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.cloudProjectId])

  const applyBeResult = (result) => {
    if (result.rails) setBeRailsData(result.rails)
    if (result.bases) setBeBasesData(result.bases)
    if (result.trapezoidDetails) setBeTrapezoidsData(result.trapezoidDetails)
  }

  const handleTabSave = useCallback(async (tabName, opts) => {
    if (!s.cloudProjectId) return
    try {
      // Build trapezoid configs with custom offsets for bases/trapezoids tabs
      let trapConfigs = trapConfigsRef.current
      if (tabName === 'bases') {
        const customBases = { ...customBasesRef.current }
        if (opts?.resetTrapId) customBases[opts.resetTrapId] = []
        trapConfigs = { ...(trapConfigs || {}) }
        for (const [trapId, offsets] of Object.entries(customBases)) {
          trapConfigs[trapId] = { ...(trapConfigs[trapId] || {}), customOffsets: offsets }
        }
      }

      const result = await saveTab(
        s.cloudProjectId, tabName,
        step3SettingsRef.current,
        (tabName === 'bases' || tabName === 'trapezoids') ? trapConfigs : null,
      )
      applyBeResult(result)
    } catch (e) { console.error(e) }
  }, [s.cloudProjectId]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleAuthGateSuccess = async (tab, email, password, fullName, phone) => {
    if (tab === 'login') await auth.login(email, password)
    else await auth.register(email, password, fullName, phone)
    setShowAuthGate(false)
    if (pendingAction === 'next') s.handleNext(TOTAL_STEPS)
    else if (pendingAction === 'export') s.handleExportProject()
    else if (pendingAction === 'save') handleCloudSave()
    setPendingAction(null)
  }

  const handleLoadCloudProject = async (projectId) => {
    try {
      const cloudProject = await getProject(projectId)
      // Merge layout + data columns into the shape handleImportProject expects
      const layout = cloudProject.layout ?? {}
      const merged = {
        project:     { name: cloudProject.name, location: cloudProject.location },
        currentStep: cloudProject.navigation?.step ?? layout.currentStep ?? 1,
        activeTab:   cloudProject.navigation?.tab ?? null,
        layout,
        ...(cloudProject.data ?? {}),
      }
      setSavedActiveTab(merged.activeTab)
      s.handleImportProject(merged, cloudProject.id)
    } catch (err) {
      alert(t('app.loadProjectError', { msg: err.message }))
    }
  }

  const handleUpdateCloudProject = async (projectId, name, location) => {
    try {
      await updateProject(projectId, { name, location })
      setCloudProjects(prev => prev.map(p => p.id === projectId ? { ...p, name, location } : p))
    } catch (err) {
      alert(`Could not update project: ${err.message}`)
    }
  }

  const handleDeleteCloudProject = async (projectId) => {
    if (!confirm(t('app.deleteProjectConfirm'))) return
    try {
      await deleteProject(projectId)
      setCloudProjects(prev => prev.filter(p => p.id !== projectId))
      setTotalProjectsCount(prev => Math.max(0, prev - 1))
    } catch (err) {
      alert(t('app.deleteProjectError', { msg: err.message }))
    }
  }

  const handleStartOver = async () => {
    s.handleStartOver()
    // Fetch the latest project to show on welcome screen
    if (auth.user) {
      try {
        const data = await listProjects(1)
        setCloudProjects(data.projects || [])
        setTotalProjectsCount(data.total || 0)
      } catch (err) {
        console.error('Failed to fetch latest project:', err)
      }
    }
  }

  const handleLoadMoreProjects = () => {
    setProjectsLimit(null) // Load all
  }

  if (s.appScreen === 'welcome') {
    return (
      <WelcomeScreen
        onCreateProject={s.handleCreateProject}
        user={auth.user}
        onLogin={auth.login}
        onRegister={auth.register}
        onLogout={auth.logout}
        onUpdateProfile={auth.updateProfile}
        authLoading={auth.authLoading}
        cloudProjects={cloudProjects}
        cloudProjectsLoading={cloudProjectsLoading}
        totalProjectsCount={totalProjectsCount}
        onLoadCloudProject={handleLoadCloudProject}
        onUpdateCloudProject={handleUpdateCloudProject}
        onDeleteCloudProject={handleDeleteCloudProject}
        onLoadMoreProjects={handleLoadMoreProjects}
        onForgotPassword={auth.forgotPassword}
        onResetPassword={auth.resetPassword}
        appDefaultsReady={!!s.appDefaults}
      />
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
                  <span style={{ fontSize: '0.85rem', fontWeight: '600', color: PRIMARY, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '260px' }}>
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
                </div>
              ) : (
                <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>{t('app.subtitle')}</div>
              )}
            </div>
          </div>

          {/* Server status */}
          {!s.appDefaults && (
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
              onSignIn={() => { setPendingAction(null); setShowAuthGate(true) }}
              onSignOut={auth.logout}
              onUpdateProfile={auth.updateProfile}
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

      <main className="app-main">
        {s.currentStep === 1 && (
          <Step1RoofAllocation
            uploadedImageMode={s.uploadedImageMode}
            setUploadedImageMode={s.setUploadedImageMode}
            backendStatus={s.backendStatus}
            uploadedImageData={s.uploadedImageData}
            handleImageUploaded={s.handleImageUploaded}
            imageRef={s.imageRef}
            setImageRef={s.setImageRef}
            handleImageClick={s.handleImageClick}
            roofPolygon={s.roofPolygon}
            selectedPoint={s.selectedPoint}
            setSelectedPoint={s.setSelectedPoint}
            setRoofPolygon={s.setRoofPolygon}
            handlePointSelect={s.handlePointSelect}
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
            generatePanelLayoutHandler={s.computePanels}
            regenerateSingleRowHandler={s.regenerateSingleRowHandler}
            refreshAreaTrapezoids={s.refreshAreaTrapezoids}
            rebuildPanelGrid={s.rebuildPanelGrid}
            recordPanelDeletion={s.recordPanelDeletion}
            areas={s.areas}
            setAreas={s.setAreas}
            addManualPanel={s.addManualPanel}
            trapezoidConfigs={s.trapezoidConfigs}
            setTrapezoidConfigs={s.setTrapezoidConfigs}
            rectAreas={s.rectAreas}
            setRectAreas={s.setRectAreas}
            onAddRectArea={(rawRect) => {
              s.setRectAreas(prev => {
                const idx = prev.length
                return [...prev, {
                  ...rawRect,
                  id: String.fromCharCode(65 + idx % 26),
                  label: String.fromCharCode(65 + idx % 26),
                  color: AREA_PALETTE[idx % AREA_PALETTE.length],
                  frontHeight: s.panelFrontHeight ?? '',
                  angle: s.panelAngle ?? '',
                  manualTrapezoids: false,
                  manualColTrapezoids: {},
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
          />
        )}
        {/* Step3 stays mounted so onPdfDataChange fires even when on step 4+.
            No overflow:hidden here — that breaks position:fixed in CanvasNavigator. */}
        <div style={{ display: s.currentStep === 3 ? undefined : 'none', height: '100%' }}>
          <Step3ConstructionPlanning
            panels={s.panels}
            refinedArea={s.refinedArea}
            railsComputing={railsComputing}
            onTabSave={handleTabSave}
            onTabReset={handleTabReset}
            trapezoidConfigs={s.trapezoidConfigs}
            setTrapezoidConfigs={s.setTrapezoidConfigs}
            areas={s.areas}
            initialGlobalSettings={s.step3GlobalSettings}
            initialAreaSettings={s.step3AreaSettings}
            initialTab={savedActiveTab}
            onSettingsChange={(g, a) => { step3SettingsRef.current = { globalSettings: g, areaSettings: a }; s.setStep3GlobalSettings(g); s.setStep3AreaSettings(a) }}
            onTrapConfigsChange={(configs) => { trapConfigsRef.current = configs }}
            onCustomBasesChange={(map) => { customBasesRef.current = map }}
            onPdfDataChange={setStep4PdfData}
            beRailsData={beRailsData}
            beBasesData={beBasesData}
            beTrapezoidsData={beTrapezoidsData}
            basesComputing={basesComputing}
            appDefaults={s.appDefaults}
            paramSchema={s.paramSchema}
            settingsDefaults={s.settingsDefaults}
            paramGroup={s.paramGroup}
            panelSpec={s.panelSpec}
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

        {s.currentStep === 5 && (
          <Step5PdfReport
            panels={s.panels}
            refinedArea={s.refinedArea}
            areas={s.areas}
            project={s.currentProject}
            projectId={s.cloudProjectId}
            trapSettingsMap={step4PdfData.trapSettingsMap}
            trapLineRailsMap={step4PdfData.trapLineRailsMap}
            trapRCMap={step4PdfData.trapRCMap}
            customBasesMap={step4PdfData.customBasesMap}
            trapPanelLinesMap={step4PdfData.trapPanelLinesMap}
            beBasesData={beBasesData}
            beTrapezoidsData={beTrapezoidsData}
            bomDeltas={s.step5BomDeltas ?? {}}
            onBomDeltasChange={s.setStep5BomDeltas}
            products={s.products}
            productByType={s.productByType}
            altsByType={s.altsByType}
          />
        )}

        {s.isProcessing && (
          <div className="processing-overlay">
            <div className="spinner"></div>
            <p>{t('app.analyzingRoof')}</p>
          </div>
        )}

        {showAuthGate && (
          <AuthModal
            onClose={() => { setShowAuthGate(false); setPendingAction(null); setUrlResetToken(null) }}
            onSuccess={handleAuthGateSuccess}
            onForgotPassword={auth.forgotPassword}
            onResetPassword={auth.resetPassword}
            resetToken={urlResetToken}
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
      </main>

      {/* Wizard Toolbar */}
      <footer className="wizard-toolbar">
        <button className="btn-nav btn-back" onClick={async () => {
          if (s.currentStep > 1 && s.cloudProjectId) {
            if (!confirm(t('nav.backWarning', { from: s.currentStep, to: s.currentStep - 1 }))) return
            const result = await updateStep(s.cloudProjectId, s.currentStep - 1).catch(console.error)
            if (result?.clearedSteps) s.resetStepData(result.clearedSteps)
          }
          s.handleBack()
        }} disabled={s.currentStep === 1}>
          {t('nav.back')}
        </button>

        <div className="wizard-steps">
          {[1, 2, 3, 4, 5].map((step) => (
            <div key={step} className={`wizard-step ${s.currentStep === step ? 'active' : ''} ${s.currentStep > step ? 'completed' : ''}`}>
              <div className="step-number">{s.currentStep > step ? '✓' : step}</div>
              <div className="step-name" style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                {STEP_NAME[step]}
                {step >= LOGIN_REQUIRED_STEP && !auth.user && (
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ opacity: 0.55, flexShrink: 0 }}>
                    <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                )}
              </div>
            </div>
          ))}
        </div>

        <button
          className="btn-nav btn-next"
          onClick={async () => {
            if (s.currentStep >= LOGIN_REQUIRED_STEP - 1 && !requireLogin('next')) return
            const stepBeforeNext = s.currentStep
            s.handleNext(TOTAL_STEPS)
            if (auth.user) {
              const savedId = await handleCloudSave(stepBeforeNext)
              if (savedId) {
                // Tell the BE about the step transition — it resets dependent data
                // and computes rails+bases on 2→3 (returned in response)
                try {
                  const stepResult = await updateStep(savedId, stepBeforeNext + 1)
                  if (stepResult.rails) setBeRailsData(stepResult.rails)
                  if (stepResult.bases) setBeBasesData(stepResult.bases)
                  if (stepResult.trapezoidDetails) setBeTrapezoidsData(stepResult.trapezoidDetails)
                } catch (e) { console.error(e) }
              }
            }
          }}
          disabled={!s.canProceedToNextStep()}
        >
          {s.currentStep === TOTAL_STEPS ? t('nav.finish') : s.currentStep === LOGIN_REQUIRED_STEP - 1 && !auth.user ? t('nav.signIn') : t('nav.next')}
        </button>
      </footer>
    </div>
  )
}

export default App
