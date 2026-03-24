import { useState, useEffect, useCallback } from 'react'
import { PRIMARY, TEXT } from './styles/colors'
import Step1RoofAllocation from './components/steps/Step1RoofAllocation'
import Step2PVAreaRefinement from './components/steps/Step2PVAreaRefinement'
import Step3PanelPlacement from './components/steps/Step3PanelPlacement'
import Step4ConstructionPlanning from './components/steps/Step4ConstructionPlanning'
import Step5PdfReport from './components/steps/Step5PdfReport'
import WelcomeScreen from './components/WelcomeScreen'
import HelpButton from './components/HelpButton'
import { useProjectState } from './hooks/useProjectState'
import { useAuth } from './hooks/useAuth'
import AuthModal from './components/auth/AuthModal'
import UserChip from './components/auth/UserChip'
import { listProjects, getProject, deleteProject } from './services/projectsApi'
import './App.css'

const TOTAL_STEPS = 5
const STEP_TITLES = ['Allocate Roof', 'Refine PV Area', 'Place Solar Panels', 'Construction Planning', 'Finalize & Export']

const LOGIN_REQUIRED_STEP = 4   // step 4+ and export require login

function App() {
  const s = useProjectState()
  const auth = useAuth()
  const [step4PdfData, setStep4PdfData] = useState({ trapSettingsMap: {}, trapLineRailsMap: {}, trapRCMap: {}, customBasesMap: {}, trapPanelLinesMap: {} })
  const [showAuthGate, setShowAuthGate] = useState(false)
  const [pendingAction, setPendingAction] = useState(null) // 'next' | 'export' | 'save'
  const [saveState, setSaveState] = useState(null) // null | 'saving' | 'saved' | 'error'
  const [cloudProjects, setCloudProjects] = useState([])
  const [cloudProjectsLoading, setCloudProjectsLoading] = useState(false)
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
      const list = await listProjects()
      setCloudProjects(list)
    } catch {
      setCloudProjects([])
    } finally {
      setCloudProjectsLoading(false)
    }
  }, [auth.user])

  useEffect(() => {
    if (auth.user) fetchCloudProjects()
    else setCloudProjects([])
  }, [auth.user, fetchCloudProjects])

  const handleCloudSave = async () => {
    setSaveState('saving')
    try {
      await s.handleSaveProject()
      setSaveState('saved')
      fetchCloudProjects()
      setTimeout(() => setSaveState(null), 2500)
    } catch {
      setSaveState('error')
      setTimeout(() => setSaveState(null), 3000)
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
      s.handleImportProject(cloudProject.data, cloudProject.id)
    } catch (err) {
      alert('Could not load project: ' + err.message)
    }
  }

  const handleDeleteCloudProject = async (projectId) => {
    if (!confirm('Delete this cloud project? This cannot be undone.')) return
    try {
      await deleteProject(projectId)
      setCloudProjects(prev => prev.filter(p => p.id !== projectId))
    } catch (err) {
      alert('Could not delete project: ' + err.message)
    }
  }

  if (s.appScreen === 'welcome') {
    return (
      <WelcomeScreen
        onCreateProject={s.handleCreateProject}
        onImportProject={s.handleImportProject}
        user={auth.user}
        onLogin={auth.login}
        onRegister={auth.register}
        onLogout={auth.logout}
        onUpdateProfile={auth.updateProfile}
        authLoading={auth.authLoading}
        cloudProjects={cloudProjects}
        cloudProjectsLoading={cloudProjectsLoading}
        onLoadCloudProject={handleLoadCloudProject}
        onDeleteCloudProject={handleDeleteCloudProject}
        onForgotPassword={auth.forgotPassword}
        onResetPassword={auth.resetPassword}
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
              <h1 style={{ margin: 0 }}>MyGreenPlanner</h1>
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
                <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>Solar PV Roof Planning System</div>
              )}
            </div>
          </div>

          {/* RIGHT: Icon actions (e-commerce style) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.1rem', flexShrink: 0 }}>

            {/* Sadot Energy branding */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', paddingRight: '0.75rem', borderRight: '1px solid rgba(255,255,255,0.13)', marginRight: '0.25rem' }}>
              <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>by</span>
              <img src="/sadot-logo.png" alt="Sadot Energy" style={{ height: '22px', width: 'auto', filter: 'brightness(0) invert(1)', opacity: 0.7 }} />
            </div>

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

            {/* Save / Export button */}
            {auth.user ? (
              <button
                onClick={handleCloudSave}
                disabled={saveState === 'saving'}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', background: 'none', border: 'none', cursor: saveState === 'saving' ? 'default' : 'pointer', padding: '0.3rem 0.65rem', color: saveState === 'saved' ? '#6fcf97' : saveState === 'error' ? '#eb5757' : 'rgba(255,255,255,0.75)' }}
              >
                {saveState === 'saving' ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                    <circle cx="12" cy="12" r="9"/>
                  </svg>
                ) : saveState === 'saved' ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                    <polyline points="17 21 17 13 7 13 7 21"/>
                    <polyline points="7 3 7 8 15 8"/>
                  </svg>
                )}
                <span style={{ fontSize: '0.6rem', fontWeight: '600', letterSpacing: '0.04em' }}>
                  {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : saveState === 'error' ? 'Error' : 'Save'}
                </span>
              </button>
            ) : (
              <button
                onClick={() => requireLogin('export') && s.handleExportProject()}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', background: 'none', border: 'none', cursor: 'pointer', padding: '0.3rem 0.65rem', color: 'rgba(255,255,255,0.75)' }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                <span style={{ fontSize: '0.6rem', fontWeight: '600', letterSpacing: '0.04em' }}>Export</span>
              </button>
            )}

            {/* Start Over icon button */}
            <button
              onClick={s.handleStartOver}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', background: 'none', border: 'none', cursor: 'pointer', padding: '0.3rem 0.65rem', color: 'rgba(255,255,255,0.55)' }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10"/>
                <path d="M3.51 15a9 9 0 1 0 .49-3.21"/>
              </svg>
              <span style={{ fontSize: '0.6rem', fontWeight: '600', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>Start Over</span>
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
          />
        )}

        {s.currentStep === 2 && (
          <Step2PVAreaRefinement
            uploadedImageData={s.uploadedImageData}
            roofPolygon={s.roofPolygon}
            imageRef={s.imageRef}
            setImageRef={s.setImageRef}
            viewZoom={s.viewZoom}
            setViewZoom={s.setViewZoom}
            isDrawingLine={s.isDrawingLine}
            setIsDrawingLine={s.setIsDrawingLine}
            lineStart={s.lineStart}
            setLineStart={s.setLineStart}
            referenceLine={s.referenceLine}
            setReferenceLine={s.setReferenceLine}
            referenceLineLengthCm={s.referenceLineLengthCm}
            setReferenceLineLengthCm={s.setReferenceLineLengthCm}
            panelType={s.panelType}
            setPanelType={s.setPanelType}
            panelFrontHeight={s.panelFrontHeight}
            setPanelFrontHeight={s.setPanelFrontHeight}
            linesPerRow={s.linesPerRow}
            setLinesPerRow={s.setLinesPerRow}
            lineOrientations={s.lineOrientations}
            setLineOrientations={s.setLineOrientations}
            computedBackHeight={s.getComputedBackHeight()}
            panelAngle={s.panelAngle}
            setPanelAngle={s.setPanelAngle}
            projectMode={s.projectMode}
            areas={s.areas}
            setAreas={s.setAreas}
          />
        )}

        {s.currentStep === 3 && (
          <Step3PanelPlacement
            projectMode={s.projectMode}
            uploadedImageData={s.uploadedImageData}
            roofPolygon={s.roofPolygon}
            refinedArea={s.refinedArea}
            imageRef={s.imageRef}
            setImageRef={s.setImageRef}
            baseline={s.baseline}
            setBaseline={s.setBaseline}
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
            showBaseline={s.showBaseline}
            setShowBaseline={s.setShowBaseline}
            showDistances={s.showDistances}
            setShowDistances={s.setShowDistances}
            distanceMeasurement={s.distanceMeasurement}
            setDistanceMeasurement={s.setDistanceMeasurement}
            generatePanelLayoutHandler={s.generatePanelLayoutHandler}
            regeneratePlanPanelsHandler={s.regeneratePlanPanelsHandler}
            regenerateSingleRowHandler={s.regenerateSingleRowHandler}
            areas={s.areas}
            setAreas={s.setAreas}
            addManualPanel={s.addManualPanel}
            trapezoidConfigs={s.trapezoidConfigs}
            setTrapezoidConfigs={s.setTrapezoidConfigs}
          />
        )}

        {/* Step4 stays mounted so onPdfDataChange fires even when on step 5.
            No overflow:hidden here — that breaks position:fixed in CanvasNavigator. */}
        <div style={{ display: s.currentStep === 4 ? undefined : 'none', height: '100%' }}>
          <Step4ConstructionPlanning
            panels={s.panels}
            refinedArea={s.refinedArea}
            trapezoidConfigs={s.trapezoidConfigs}
            setTrapezoidConfigs={s.setTrapezoidConfigs}
            areas={s.areas}
            initialGlobalSettings={s.step4GlobalSettings}
            initialAreaSettings={s.step4AreaSettings}
            onSettingsChange={(g, a) => { s.setStep4GlobalSettings(g); s.setStep4AreaSettings(a) }}
            onBOMDataChange={s.setStep4BOMData}
            onPdfDataChange={setStep4PdfData}
          />
        </div>

        {s.currentStep === 5 && (
          <Step5PdfReport
            panels={s.panels}
            refinedArea={s.refinedArea}
            areas={s.areas}
            project={s.currentProject}
            rowConstructions={s.step4BOMData.rowConstructions}
            rowLabels={s.step4BOMData.rowLabels}
            trapSettingsMap={step4PdfData.trapSettingsMap}
            trapLineRailsMap={step4PdfData.trapLineRailsMap}
            trapRCMap={step4PdfData.trapRCMap}
            customBasesMap={step4PdfData.customBasesMap}
            trapPanelLinesMap={step4PdfData.trapPanelLinesMap}
            bomDeltas={s.step5BomDeltas ?? {}}
            onBomDeltasChange={s.setStep5BomDeltas}
          />
        )}

        {s.isProcessing && (
          <div className="processing-overlay">
            <div className="spinner"></div>
            <p>Analyzing roof...</p>
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
            {verifyBanner === 'success' ? '✓ Email verified successfully!' : '✗ Email verification failed — link may have expired.'}
            <button onClick={() => setVerifyBanner(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1, padding: 0, color: 'inherit', opacity: 0.6 }}>×</button>
          </div>
        )}
      </main>

      {/* Wizard Toolbar */}
      <footer className="wizard-toolbar">
        <button className="btn-nav btn-back" onClick={s.handleBack} disabled={s.currentStep === 1}>
          ← Back
        </button>

        <div className="wizard-steps">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map(step => (
            <div key={step} className={`wizard-step ${s.currentStep === step ? 'active' : ''} ${s.currentStep > step ? 'completed' : ''}`}>
              <div className="step-number">{s.currentStep > step ? '✓' : step}</div>
              <div className="step-name" style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                {STEP_TITLES[step - 1]}
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
          onClick={() => {
            if (s.currentStep >= LOGIN_REQUIRED_STEP - 1 && !requireLogin('next')) return
            s.handleNext(TOTAL_STEPS)
          }}
          disabled={!s.canProceedToNextStep()}
        >
          {s.currentStep === TOTAL_STEPS ? 'Finish' : s.currentStep === LOGIN_REQUIRED_STEP - 1 && !auth.user ? 'Sign In to Continue →' : 'Next →'}
        </button>
      </footer>
    </div>
  )
}

export default App
