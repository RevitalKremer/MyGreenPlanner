import { useState } from 'react'
import { PRIMARY, TEXT, TEXT_VERY_LIGHT } from './styles/colors'
import Step1RoofAllocation from './components/steps/Step1RoofAllocation'
import Step2PVAreaRefinement from './components/steps/Step2PVAreaRefinement'
import Step3PanelPlacement from './components/steps/Step3PanelPlacement'
import Step4ConstructionPlanning from './components/steps/Step4ConstructionPlanning'
import Step5PdfReport from './components/steps/Step5PdfReport'
import WelcomeScreen from './components/WelcomeScreen'
import HelpButton from './components/HelpButton'
import { useProjectState } from './hooks/useProjectState'
import './App.css'

const TOTAL_STEPS = 5
const STEP_TITLES = ['Allocate Roof', 'Refine PV Area', 'Place Solar Panels', 'Construction Planning', 'Finalize & Export']

function App() {
  const s = useProjectState()
  const [step4PdfData, setStep4PdfData] = useState({ trapSettingsMap: {}, trapLineRailsMap: {}, trapRCMap: {}, customBasesMap: {}, trapPanelLinesMap: {} })

  if (s.appScreen === 'welcome') {
    return (
      <WelcomeScreen
        onCreateProject={s.handleCreateProject}
        onImportProject={s.handleImportProject}
      />
    )
  }

  return (
    <div className="app">
      {/* Header Area */}
      <header className="app-header">
        <div className="header-content">
          <div className="header-title" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <img src="/mgp-logo.svg" alt="MyGreenPlanner Logo" style={{ height: '68px', width: 'auto' }} />
            <div>
              <h1>MyGreenPlanner</h1>
              {s.currentProject?.name ? (
                <>
                  <p className="header-subtitle" style={{ fontWeight: '600', color: PRIMARY }}>
                    {s.currentProject.name}
                    {s.currentProject.location && (
                      <span style={{ fontWeight: '400', color: TEXT_VERY_LIGHT, marginLeft: '0.5rem' }}>
                        · {s.currentProject.location}
                      </span>
                    )}
                  </p>
                  <p className="header-subtitle" style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.45)', marginTop: '1px' }}>
                    Created {s.currentProject.date ? new Date(s.currentProject.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
                  </p>
                </>
              ) : (
                <p className="header-subtitle">Solar PV Roof Planning System</p>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderRight: '1px solid rgba(255,255,255,0.2)', paddingRight: '1rem' }}>
              <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>by</span>
              <img src="/sadot-logo.png" alt="Sadot Energy" style={{ height: '28px', width: 'auto', filter: 'brightness(0) invert(1)', opacity: 0.85 }} />
            </div>
            <button
              onClick={s.handleExportProject}
              style={{ padding: '0.5rem 1rem', background: PRIMARY, color: TEXT, border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '0.85rem' }}
            >
              ↓ Export
            </button>
            <button className="btn-start-over" onClick={s.handleStartOver}>
              Start Over
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

        {s.currentStep >= 4 && (
          <div style={s.currentStep !== 4 ? { display: 'none' } : { height: '100%', overflow: 'hidden' }}>
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
        )}

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
              <div className="step-name">{STEP_TITLES[step - 1]}</div>
            </div>
          ))}
        </div>

        <button
          className="btn-nav btn-next"
          onClick={() => s.handleNext(TOTAL_STEPS)}
          disabled={!s.canProceedToNextStep()}
        >
          {s.currentStep === TOTAL_STEPS ? 'Finish' : 'Next →'}
        </button>
      </footer>
    </div>
  )
}

export default App
