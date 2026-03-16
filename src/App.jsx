import { useState, useEffect } from 'react'
import Step1RoofAllocation from './components/steps/Step1RoofAllocation'
import Step2PVAreaRefinement from './components/steps/Step2PVAreaRefinement'
import Step3PanelPlacement from './components/steps/Step3PanelPlacement'
import Step4ConstructionPlanning from './components/steps/Step4ConstructionPlanning'
import Step5PdfReport from './components/steps/Step5PdfReport'
import WelcomeScreen from './components/WelcomeScreen'
import HelpPanel from './components/HelpPanel'
import { SAM2Service } from './services/sam2Service'
import { generatePanelLayout, createManualPanel } from './utils/panelUtils'
import './App.css'

function App() {
  // App-level screen
  const [appScreen, setAppScreen] = useState('welcome') // 'welcome' | 'wizard'
  const [currentProject, setCurrentProject] = useState(null) // { name, location, date }

  // Wizard state
  const [currentStep, setCurrentStep] = useState(1)
  const totalSteps = 5
  
  // Step 1: Roof allocation
  const [selectedPoint, setSelectedPoint] = useState(null)
  const [roofPolygon, setRoofPolygon] = useState(null)
  const [backendStatus, setBackendStatus] = useState({ status: 'checking', model_loaded: false })
  const [isProcessing, setIsProcessing] = useState(false)
  const [uploadedImageMode, setUploadedImageMode] = useState(true)
  const [uploadedImageData, setUploadedImageData] = useState(null)
  const [imageRef, setImageRef] = useState(null)
  
  // Step 2: PV area refinement
  const [refinedArea, setRefinedArea] = useState(null)
  const [panelType, setPanelType] = useState('AIKO-G670-MCH72Mw')
  const [referenceLine, setReferenceLine] = useState(null) // { start: {x, y}, end: {x, y} }
  const [referenceLineLengthCm, setReferenceLineLengthCm] = useState('')
  const [panelFrontHeight, setPanelFrontHeight] = useState('')
  const [linesPerRow, setLinesPerRow] = useState(1)
  const [lineOrientations, setLineOrientations] = useState(['vertical'])
  const [panelAngle, setPanelAngle] = useState('')
  const [isDrawingLine, setIsDrawingLine] = useState(false)

  // Derived: back height computed from angle, frontHeight, and line config
  const getComputedBackHeight = () => {
    const angle = parseFloat(panelAngle) || 0
    const frontH = parseFloat(panelFrontHeight) || 0
    const angleRad = angle * Math.PI / 180
    const totalSlopeLen = lineOrientations.reduce(
      (sum, o) => sum + (o === 'vertical' ? 238.2 : 113.4), 0
    ) + (linesPerRow - 1) * 2.5
    return frontH + totalSlopeLen * Math.sin(angleRad)
  }

  const [lineStart, setLineStart] = useState(null)
  
  // Step 3: Solar panel placement
  const [baseline, setBaseline] = useState(null) // { p1: [x, y], p2: [x, y] } - user-drawn baseline for first row
  const [showBaseline, setShowBaseline] = useState(true) // Toggle to show/hide baseline
  const [showDistances, setShowDistances] = useState(true) // Toggle to show/hide distance measurements
  const [distanceMeasurement, setDistanceMeasurement] = useState(null) // { p1: [x, y], p2: [x, y] } - user-drawn distance measurement
  const [panels, setPanels] = useState([]) // Array of panel objects
  const [rowGroups, setRowGroups] = useState([])
  const [selectedPanels, setSelectedPanels] = useState([]) // Array of selected panel IDs
  const [dragState, setDragState] = useState(null) // { panelIds, startX, startY, originalPositions }
  const [rotationState, setRotationState] = useState(null) // { panelIds, centerX, centerY, startAngle, originalRotations }
  const [viewZoom, setViewZoom] = useState(1) // Zoom level for Step 3 view (independent of uploadedImageData.scale)
  const [rowConfigs, setRowConfigs] = useState({}) // Per-row trapezoid overrides: { [rowKey]: { angle, backHeight } }

  // Step 4: Construction planning settings (persisted for export)
  const [step4GlobalSettings, setStep4GlobalSettings] = useState(null) // null = use Step4 defaults
  const [step4RowSettings,    setStep4RowSettings]    = useState(null)
  
  const projectMode = currentProject?.mode || 'scratch' // 'scratch' | 'plan'
  const [showHelp, setShowHelp] = useState(false)

  const stepTitles = ['Allocate Roof', 'Refine PV Area', 'Place Solar Panels', 'Construction Planning', 'Finalize & Export']

  useEffect(() => {
    // Check backend health on mount
    checkBackend()
  }, [])

  const checkBackend = async () => {
    const status = await SAM2Service.checkHealth()
    setBackendStatus(status)
  }

  const resetWizardState = () => {
    setCurrentStep(1)
    setSelectedPoint(null)
    setRoofPolygon(null)
    setIsProcessing(false)
    setUploadedImageMode(true)
    setUploadedImageData(null)
    setImageRef(null)
    setRefinedArea(null)
    setPanelType('AIKO-G670-MCH72Mw')
    setReferenceLine(null)
    setReferenceLineLengthCm('')
    setPanelFrontHeight('')
    setLinesPerRow(1)
    setLineOrientations(['vertical'])
    setPanelAngle('')
    setIsDrawingLine(false)
    setLineStart(null)
    setPanels([])
    setRowGroups([])
    setSelectedPanels([])
    setDragState(null)
    setRotationState(null)
    setRowConfigs({})
    setStep4GlobalSettings(null)
    setStep4RowSettings(null)
  }

  const handleStartOver = () => {
    if (confirm('Return to the welcome screen? All unsaved progress will be lost.')) {
      resetWizardState()
      setCurrentProject(null)
      setAppScreen('welcome')
    }
  }

  const handleCreateProject = (projectInfo) => {
    setCurrentProject(projectInfo)
    setAppScreen('wizard')
  }

  const handleImportProject = (data) => {
    resetWizardState()
    setCurrentProject(data.project)
    if (data.uploadedImageData) setUploadedImageData(data.uploadedImageData)
    if (data.roofPolygon) setRoofPolygon(data.roofPolygon)
    if (data.referenceLine) setReferenceLine(data.referenceLine)
    if (data.referenceLineLengthCm !== undefined) setReferenceLineLengthCm(String(data.referenceLineLengthCm))
    if (data.panelType) setPanelType(data.panelType)
    if (data.panelFrontHeight !== undefined) setPanelFrontHeight(String(data.panelFrontHeight))
    if (data.panelAngle !== undefined) setPanelAngle(String(data.panelAngle))
    if (data.linesPerRow !== undefined) setLinesPerRow(data.linesPerRow)
    if (data.lineOrientations) setLineOrientations(data.lineOrientations)
    if (data.refinedArea) setRefinedArea(data.refinedArea)
    if (data.baseline) setBaseline(data.baseline)
    if (data.panels) setPanels(data.panels)
    if (data.rowGroups) setRowGroups(data.rowGroups)
    if (data.rowConfigs) setRowConfigs(data.rowConfigs)
    if (data.step4GlobalSettings) setStep4GlobalSettings(data.step4GlobalSettings)
    if (data.step4RowSettings)    setStep4RowSettings(data.step4RowSettings)
    if (data.currentStep) setCurrentStep(data.currentStep)
    setAppScreen('wizard')
  }


  const handleExportProject = () => {
    const data = {
      version: '1.0',
      project: currentProject,
      currentStep,
      uploadedImageData: uploadedImageData
        ? { ...uploadedImageData, file: undefined }
        : null,
      roofPolygon,
      referenceLine,
      referenceLineLengthCm,
      panelType,
      panelFrontHeight,
      panelAngle,
      linesPerRow,
      lineOrientations,
      refinedArea,
      baseline,
      panels,
      rowGroups,
      rowConfigs,
      step4GlobalSettings,
      step4RowSettings,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const safeName = (currentProject?.name || 'project').replace(/[^a-z0-9]/gi, '_')
    const dateStr = new Date().toISOString().split('T')[0]
    a.href = url
    a.download = `${safeName}_${dateStr}.mgp`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Auto-generate panel layout based on Step 2 configuration
  const generatePanelLayoutHandler = () => {
    if (!refinedArea || !refinedArea.polygon || !refinedArea.pixelToCmRatio) {
      alert('Missing configuration data from Step 2')
      return
    }

    if (!baseline) {
      alert('Please draw a baseline for the first row of panels')
      return
    }

    const generatedPanels = generatePanelLayout(refinedArea, baseline)
    
    setPanels(generatedPanels)
  }

  const regeneratePlanPanelsHandler = () => {
    if (!refinedArea || !refinedArea.pixelToCmRatio || rowGroups.length === 0) {
      alert('Missing configuration from Step 2')
      return
    }
    let nextId = 1
    const allPanels = []
    rowGroups.forEach((group, groupIdx) => {
      if (!group.baseline) return
      const angle = parseFloat(group.angle) || 0
      const frontH = parseFloat(group.frontHeight) || 0
      const angleRad = angle * Math.PI / 180
      const n = group.linesPerRow || 1
      const orients = (group.lineOrientations || ['vertical']).slice(0, n)
      const totalSlope = orients.reduce((s, o) => s + (o === 'vertical' ? 238.2 : 113.4), 0) + (n - 1) * 2.5
      const backH = frontH + totalSlope * Math.sin(angleRad)
      const generated = generatePanelLayout(
        { polygon: roofPolygon, pixelToCmRatio: refinedArea.pixelToCmRatio, panelConfig: { frontHeight: frontH, backHeight: backH, angle, linesPerRow: n, lineOrientations: orients } },
        group.baseline,
        true
      )
      generated.forEach(p => allPanels.push({ ...p, id: nextId++, row: groupIdx }))
    })
    setPanels(allPanels)
  }

  const regenerateSingleRowHandler = (rowKey) => {
    if (!refinedArea || !refinedArea.pixelToCmRatio) return

    if (projectMode === 'plan') {
      const groupIdx = rowKey
      const group = rowGroups[groupIdx]
      if (!group || !group.baseline) return
      const angle = parseFloat(group.angle) || 0
      const frontH = parseFloat(group.frontHeight) || 0
      const angleRad = angle * Math.PI / 180
      const n = group.linesPerRow || 1
      const orients = (group.lineOrientations || ['vertical']).slice(0, n)
      const totalSlope = orients.reduce((s, o) => s + (o === 'vertical' ? 238.2 : 113.4), 0) + (n - 1) * 2.5
      const backH = frontH + totalSlope * Math.sin(angleRad)
      const generated = generatePanelLayout(
        { polygon: roofPolygon, pixelToCmRatio: refinedArea.pixelToCmRatio, panelConfig: { frontHeight: frontH, backHeight: backH, angle, linesPerRow: n, lineOrientations: orients } },
        group.baseline,
        true
      )
      setPanels(prev => {
        const maxId = prev.reduce((m, p) => Math.max(m, p.id), 0)
        let nextId = maxId + 1
        const newRowPanels = generated.map(p => ({ ...p, id: nextId++, row: groupIdx }))
        return [...prev.filter(p => p.row !== rowKey), ...newRowPanels]
      })
      setSelectedPanels([])
    } else {
      // Scratch mode: re-run full generation, splice back only the target row
      if (!baseline) return
      const allGenerated = generatePanelLayout(refinedArea, baseline)
      const rowPanels = allGenerated.filter(p => p.row === rowKey)
      setPanels(prev => {
        const maxId = prev.reduce((m, p) => Math.max(m, p.id), 0)
        let nextId = maxId + 1
        const newRowPanels = rowPanels.map(p => ({ ...p, id: nextId++ }))
        return [...prev.filter(p => p.row !== rowKey), ...newRowPanels]
      })
      setSelectedPanels([])
    }
  }

  const addManualPanel = () => {
    const newPanel = createManualPanel(refinedArea, baseline, panels)
    if (!newPanel) return

    // Add to panels array
    setPanels([...panels, newPanel])
    
    // Select the new panel
    setSelectedPanels([newPanel.id])
    
    console.log('Manual panel added below baseline:', newPanel)
  }

  const handlePointSelect = async (point, mapInstance, bounds) => {
    console.log('Point selected:', point, 'bounds:', bounds)
    setSelectedPoint(point)
    setIsProcessing(true)
    
    try {
      // Check backend status
      if (backendStatus.status !== 'running' || !backendStatus.model_loaded) {
        alert('Backend is not ready. Please make sure the Python backend is running.')
        setIsProcessing(false)
        return
      }

      // Get current zoom level
      const zoom = mapInstance.getZoom()
      
      // Log map container dimensions
      const mapContainer = mapInstance.getContainer()
      const mapSize = mapInstance.getSize()
      console.log('Map viewport dimensions:', { 
        width: mapSize.x, 
        height: mapSize.y,
        containerWidth: mapContainer.offsetWidth,
        containerHeight: mapContainer.offsetHeight
      })
      
      console.log('Sending to backend:', { lat: point.lat, lng: point.lng, zoom, bounds })
      
      // Call backend to fetch tiles and run SAM2 (avoids CORS issues)
      const result = await SAM2Service.segmentRoofFromMap(
        point.lat,
        point.lng,
        zoom,
        bounds
      )
      
      console.log('SAM2 result:', result)
      
      if (result && result.geometry) {
        // Log bounds comparison
        if (result.properties.actual_bounds) {
          console.log('\n🗺️ BOUNDS COMPARISON:')
          console.log('  Requested bounds (map viewport):', bounds)
          console.log('  Actual bounds (backend tiles):', result.properties.actual_bounds)
          console.log('  ⚠️ If these differ significantly, polygon will be misaligned!')
        }
        
        // Backend returns [lng, lat], but Leaflet needs [lat, lng]
        const coordinates = result.geometry.coordinates[0].map(coord => {
          return [coord[1], coord[0]]  // Convert [lng, lat] to [lat, lng]
        })
        
        setRoofPolygon({
          coordinates: coordinates,
          area: result.properties.area_pixels,
          confidence: result.properties.confidence,
          actualBounds: result.properties.actual_bounds
        })
        
        // Fit map to actual bounds if available
        if (result.properties.actual_bounds && mapInstance) {
          const actualBounds = result.properties.actual_bounds
          mapInstance.fitBounds([
            [actualBounds.south, actualBounds.west],
            [actualBounds.north, actualBounds.east]
          ], { padding: [50, 50] })
          console.log('✅ Map fitted to actual_bounds from backend')
        }
      }
      
      setIsProcessing(false)
      
    } catch (error) {
      console.error('Error processing roof:', error)
      alert(`Error: ${error.message}`)
      setIsProcessing(false)
    }
  }

  const handleImageUploaded = (imageData) => {
    console.log('Image uploaded:', imageData)
    setUploadedImageData(imageData)
    setUploadedImageMode(true)
  }

  const handleNext = () => {
    if (currentStep < totalSteps) {
      if (currentStep === 2) {
        const pixelLength = Math.sqrt(
          Math.pow(referenceLine.end.x - referenceLine.start.x, 2) +
          Math.pow(referenceLine.end.y - referenceLine.start.y, 2)
        )
        const pixelToCmRatio = parseFloat(referenceLineLengthCm) / pixelLength

        if (projectMode === 'plan') {
          // Generate panels from every row group
          let nextId = 1
          const allPanels = []
          const groupConfigs = {}
          rowGroups.forEach((group, groupIdx) => {
            const angle = parseFloat(group.angle) || 0
            const frontH = parseFloat(group.frontHeight) || 0
            const angleRad = angle * Math.PI / 180
            const n = group.linesPerRow || 1
            const orients = (group.lineOrientations || ['vertical']).slice(0, n)
            const totalSlope = orients.reduce((s, o) => s + (o === 'vertical' ? 238.2 : 113.4), 0) + (n - 1) * 2.5
            const backH = frontH + totalSlope * Math.sin(angleRad)
            // Store per-group baseline config so editor defaults are correct (not 0)
            groupConfigs[groupIdx] = { angle, frontHeight: frontH, backHeight: backH }
            if (!group.baseline) return
            const generated = generatePanelLayout(
              { polygon: roofPolygon, pixelToCmRatio, panelConfig: { frontHeight: frontH, backHeight: backH, angle, linesPerRow: n, lineOrientations: orients } },
              group.baseline,
              true // singleRow: each group baseline generates exactly 1 row
            )
            generated.forEach(p => allPanels.push({ ...p, id: nextId++, row: groupIdx }))
          })
          setRefinedArea({
            polygon: roofPolygon,
            panelType,
            referenceLine,
            referenceLineLengthCm: parseFloat(referenceLineLengthCm),
            pixelToCmRatio,
            panelConfig: { frontHeight: 0, backHeight: 0, angle: 0, linesPerRow: 1, lineOrientations: ['vertical'] }
          })
          setPanels(allPanels)
          // Initialize rowConfigs from group settings, preserving any existing per-row overrides
          setRowConfigs(prev => {
            const next = {}
            Object.keys(groupConfigs).forEach(key => {
              next[key] = { ...(prev[key] || {}), ...groupConfigs[key] }
            })
            return next
          })
        } else {
          setRefinedArea({
            polygon: roofPolygon,
            panelType,
            referenceLine,
            referenceLineLengthCm: parseFloat(referenceLineLengthCm),
            pixelToCmRatio,
            panelConfig: {
              frontHeight: parseFloat(panelFrontHeight),
              backHeight: getComputedBackHeight(),
              angle: parseFloat(panelAngle),
              linesPerRow,
              lineOrientations: [...lineOrientations]
            },
            panelFrontHeight: parseFloat(panelFrontHeight),
            panelAngle: parseFloat(panelAngle)
          })
        }
      }

      const nextStep = currentStep + 1
      console.log(`\n${'─'.repeat(40)}\n  STEP ${nextStep}\n${'─'.repeat(40)}`)
      if (nextStep === 3) {
        const baselines = projectMode === 'plan'
          ? rowGroups.filter(g => g.baseline).length
          : baseline ? 1 : 0
        console.log(`  Mode: ${projectMode} | Baselines: ${baselines}`)
        if (projectMode === 'plan') {
          rowGroups.forEach((g, i) => console.log(`  Baseline ${i + 1}:`, g.baseline ? `p1=${JSON.stringify(g.baseline.p1)} p2=${JSON.stringify(g.baseline.p2)}` : 'none'))
        } else {
          console.log(`  Baseline:`, baseline ? `p1=${JSON.stringify(baseline.p1)} p2=${JSON.stringify(baseline.p2)}` : 'none')
        }
      }
      setCurrentStep(nextStep)
    }
  }

  const handleBack = () => {
    if (currentStep > 1) {
      console.log(`\n${'─'.repeat(40)}\n  STEP ${currentStep - 1}\n${'─'.repeat(40)}`)
      setCurrentStep(prev => prev - 1)
    }
  }

  const canProceedToNextStep = () => {
    switch (currentStep) {
      case 1:
        return roofPolygon !== null
      case 2:
        if (projectMode === 'plan') {
          return (
            referenceLine !== null &&
            referenceLineLengthCm !== '' &&
            parseFloat(referenceLineLengthCm) > 0 &&
            rowGroups.length > 0 &&
            rowGroups.every(g =>
              g.baseline !== null &&
              g.frontHeight !== '' &&
              parseFloat(g.frontHeight) >= 0 &&
              g.angle !== '' &&
              parseFloat(g.angle) >= 0 &&
              parseFloat(g.angle) <= 30
            )
          )
        }
        return (
          referenceLine !== null &&
          referenceLineLengthCm !== '' &&
          parseFloat(referenceLineLengthCm) > 0 &&
          panelFrontHeight !== '' &&
          parseFloat(panelFrontHeight) >= 0 &&
          panelAngle !== '' &&
          parseFloat(panelAngle) >= 0 &&
          parseFloat(panelAngle) <= 30
        )
      case 3:
        return panels.length > 0
      case 4:
        return true
      case 5:
        return true
      default:
        return false
    }
  }

  const dataURLtoBlob = (dataURL) => {
    // Convert base64 data URL to Blob
    const arr = dataURL.split(',')
    const mime = arr[0].match(/:(.*?);/)[1]
    const bstr = atob(arr[1])
    let n = bstr.length
    const u8arr = new Uint8Array(n)
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n)
    }
    return new Blob([u8arr], { type: mime })
  }

  const handleImageClick = async (event) => {
    if (!uploadedImageData) return
    
    const img = event.target
    const rect = img.getBoundingClientRect()
    
    // Get click position relative to the image
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    
    // Convert to pixel coordinates (accounting for any scaling)
    const scaleX = img.naturalWidth / rect.width
    const scaleY = img.naturalHeight / rect.height
    
    const pixelX = Math.round(x * scaleX)
    const pixelY = Math.round(y * scaleY)
    
    console.log('📷 UPLOADED IMAGE:')
    console.log('  Display dimensions:', { width: rect.width, height: rect.height })
    console.log('  Natural dimensions:', { width: img.naturalWidth, height: img.naturalHeight })
    console.log('  Click position (display):', { x, y })
    console.log('  Click position (natural):', { x: pixelX, y: pixelY })
    console.log('  Scale factors:', { scaleX, scaleY })
    
    // Store the clicked point
    setSelectedPoint({ x: pixelX, y: pixelY })
    setIsProcessing(true)
    
    try {
      // Check backend status
      if (backendStatus.status !== 'running' || !backendStatus.model_loaded) {
        alert('Backend is not ready. Please make sure the Python backend is running.')
        setIsProcessing(false)
        return
      }
      
      // Convert data URL to Blob
      const imageBlob = dataURLtoBlob(uploadedImageData.imageData)
      
      // Send to SAM2 for segmentation
      const result = await SAM2Service.segmentRoofPixel(
        imageBlob,
        pixelX,
        pixelY
      )
      
      console.log('SAM2 result:', result)
      
      if (result && result.geometry) {
        setRoofPolygon({
          coordinates: result.geometry.coordinates[0],
          area: result.properties.area_pixels,
          confidence: result.properties.confidence
        })
      }
      
    } catch (error) {
      console.error('Error processing roof:', error)
      alert('Failed to process roof. Check console for details.')
    } finally {
      setIsProcessing(false)
    }
  }

  if (appScreen === 'welcome') {
    return (
      <WelcomeScreen
        onCreateProject={handleCreateProject}
        onImportProject={handleImportProject}
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
              {currentProject?.name ? (
                <>
                  <p className="header-subtitle" style={{ fontWeight: '600', color: '#C4D600' }}>
                    {currentProject.name}
                    {currentProject.location && (
                      <span style={{ fontWeight: '400', color: '#aaa', marginLeft: '0.5rem' }}>
                        · {currentProject.location}
                      </span>
                    )}
                  </p>
                  <p className="header-subtitle" style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.45)', marginTop: '1px' }}>
                    Created {currentProject.date ? new Date(currentProject.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
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
              onClick={handleExportProject}
              style={{
                padding: '0.5rem 1rem',
                background: '#C4D600', color: '#333',
                border: 'none', borderRadius: '6px',
                cursor: 'pointer', fontWeight: '700', fontSize: '0.85rem'
              }}
            >
              ↓ Export
            </button>
            <button className="btn-start-over" onClick={handleStartOver}>
              Start Over
            </button>
          </div>
        </div>
      </header>
      
      <main className="app-main">
        {/* Step 1: Allocate Roof */}
        {currentStep === 1 && (
          <Step1RoofAllocation
            uploadedImageMode={uploadedImageMode}
            setUploadedImageMode={setUploadedImageMode}
            backendStatus={backendStatus}
            uploadedImageData={uploadedImageData}
            handleImageUploaded={handleImageUploaded}
            imageRef={imageRef}
            setImageRef={setImageRef}
            handleImageClick={handleImageClick}
            roofPolygon={roofPolygon}
            selectedPoint={selectedPoint}
            setSelectedPoint={setSelectedPoint}
            setRoofPolygon={setRoofPolygon}
            handlePointSelect={handlePointSelect}
          />
        )}

        {/* Step 2: Refine PV Area */}
        {currentStep === 2 && (
          <Step2PVAreaRefinement
            uploadedImageData={uploadedImageData}
            roofPolygon={roofPolygon}
            imageRef={imageRef}
            setImageRef={setImageRef}
            viewZoom={viewZoom}
            setViewZoom={setViewZoom}
            isDrawingLine={isDrawingLine}
            setIsDrawingLine={setIsDrawingLine}
            lineStart={lineStart}
            setLineStart={setLineStart}
            referenceLine={referenceLine}
            setReferenceLine={setReferenceLine}
            referenceLineLengthCm={referenceLineLengthCm}
            setReferenceLineLengthCm={setReferenceLineLengthCm}
            panelType={panelType}
            setPanelType={setPanelType}
            panelFrontHeight={panelFrontHeight}
            setPanelFrontHeight={setPanelFrontHeight}
            linesPerRow={linesPerRow}
            setLinesPerRow={setLinesPerRow}
            lineOrientations={lineOrientations}
            setLineOrientations={setLineOrientations}
            computedBackHeight={getComputedBackHeight()}
            panelAngle={panelAngle}
            setPanelAngle={setPanelAngle}
            projectMode={projectMode}
            rowGroups={rowGroups}
            setRowGroups={setRowGroups}
          />
        )}

        {/* Step 3: Place Solar Panels */}
        {/* Step 3: Place Solar Panels */}
        {currentStep === 3 && (
          <Step3PanelPlacement
            projectMode={projectMode}
            uploadedImageData={uploadedImageData}
            roofPolygon={roofPolygon}
            refinedArea={refinedArea}
            imageRef={imageRef}
            setImageRef={setImageRef}
            baseline={baseline}
            setBaseline={setBaseline}
            panels={panels}
            setPanels={setPanels}
            selectedPanels={selectedPanels}
            setSelectedPanels={setSelectedPanels}
            dragState={dragState}
            setDragState={setDragState}
            rotationState={rotationState}
            setRotationState={setRotationState}
            viewZoom={viewZoom}
            setViewZoom={setViewZoom}
            showBaseline={showBaseline}
            setShowBaseline={setShowBaseline}
            showDistances={showDistances}
            setShowDistances={setShowDistances}
            distanceMeasurement={distanceMeasurement}
            setDistanceMeasurement={setDistanceMeasurement}
            generatePanelLayoutHandler={generatePanelLayoutHandler}
            regeneratePlanPanelsHandler={regeneratePlanPanelsHandler}
            regenerateSingleRowHandler={regenerateSingleRowHandler}
            rowGroups={rowGroups}
            addManualPanel={addManualPanel}
            rowConfigs={rowConfigs}
            setRowConfigs={setRowConfigs}
          />
        )}

        {/* Step 4: Construction Planning */}
        {currentStep === 4 && (
          <Step4ConstructionPlanning
            panels={panels}
            refinedArea={refinedArea}
            rowConfigs={rowConfigs}
            initialGlobalSettings={step4GlobalSettings}
            initialRowSettings={step4RowSettings}
            onSettingsChange={(g, r) => { setStep4GlobalSettings(g); setStep4RowSettings(r) }}
          />
        )}

        {/* Step 5: Finalize & Export */}
        {currentStep === 5 && (
          <div className="step-content">
            <Step5PdfReport
              panels={panels}
              refinedArea={refinedArea}
              rowConfigs={rowConfigs}
              project={currentProject}
            />
          </div>
        )}
        
        {/* Help button */}
        <button
          onClick={() => setShowHelp(true)}
          title="Help & Guidelines"
          style={{
            position: 'absolute', bottom: '1.25rem', right: '1.25rem',
            width: '38px', height: '38px', borderRadius: '50%',
            background: 'white', border: '2px solid #C4D600',
            color: '#C4D600', fontSize: '1rem', fontWeight: '800',
            cursor: 'pointer', zIndex: 900,
            boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.2s'
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#C4D600'; e.currentTarget.style.color = 'white' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'white'; e.currentTarget.style.color = '#C4D600' }}
        >?</button>

        {isProcessing && (
          <div className="processing-overlay">
            <div className="spinner"></div>
            <p>Analyzing roof...</p>
          </div>
        )}
      </main>

      {showHelp && (
        <HelpPanel currentStep={currentStep} onClose={() => setShowHelp(false)} />
      )}

      {/* Wizard Toolbar */}
      <footer className="wizard-toolbar">
        <button
          className="btn-nav btn-back"
          onClick={handleBack}
          disabled={currentStep === 1}
        >
          ← Back
        </button>

        <div className="wizard-steps">
          {Array.from({ length: totalSteps }, (_, i) => i + 1).map(step => (
            <div
              key={step}
              className={`wizard-step ${currentStep === step ? 'active' : ''} ${currentStep > step ? 'completed' : ''}`}
            >
              <div className="step-number">
                {currentStep > step ? '✓' : step}
              </div>
              <div className="step-name">{stepTitles[step - 1]}</div>
            </div>
          ))}
        </div>

        <button
          className="btn-nav btn-next"
          onClick={handleNext}
          disabled={!canProceedToNextStep()}
        >
          {currentStep === totalSteps ? 'Finish' : 'Next →'}
        </button>
      </footer>
    </div>
  )
}

export default App
