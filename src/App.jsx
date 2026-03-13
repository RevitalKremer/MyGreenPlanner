import { useState, useEffect } from 'react'
import RoofMapper from './components/RoofMapper'
import ImageUploader from './components/ImageUploader'
import Step1RoofAllocation from './components/steps/Step1RoofAllocation'
import Step2PVAreaRefinement from './components/steps/Step2PVAreaRefinement'
import Step3PanelPlacement from './components/steps/Step3PanelPlacement'
import { SAM2Service } from './services/sam2Service'
import { generatePanelLayout, createManualPanel, detectRows, snapPanelsToRows } from './utils/panelUtils'
import './App.css'

function App() {
  // Wizard state
  const [currentStep, setCurrentStep] = useState(1)
  const totalSteps = 5
  
  // Step 1: Roof allocation
  const [selectedPoint, setSelectedPoint] = useState(null)
  const [roofPolygon, setRoofPolygon] = useState(null)
  const [processedImage, setProcessedImage] = useState(null) // Store the processed image from backend
  const [backendStatus, setBackendStatus] = useState({ status: 'checking', model_loaded: false })
  const [isProcessing, setIsProcessing] = useState(false)
  const [uploadedImageMode, setUploadedImageMode] = useState(true)
  const [uploadedImageData, setUploadedImageData] = useState(null)
  const [clickPosition, setClickPosition] = useState(null) // Store screen position for marker
  const [imageRef, setImageRef] = useState(null) // Reference to the image element
  
  // Step 2: PV area refinement
  const [refinedArea, setRefinedArea] = useState(null)
  const [panelType, setPanelType] = useState('AIKO-G670-MCH72Mw')
  const [referenceLine, setReferenceLine] = useState(null) // { start: {x, y}, end: {x, y} }
  const [referenceLineLengthCm, setReferenceLineLengthCm] = useState('')
  const [panelFrontHeight, setPanelFrontHeight] = useState('')
  const [panelBackHeight, setPanelBackHeight] = useState('')
  const [panelAngle, setPanelAngle] = useState('')
  const [isDrawingLine, setIsDrawingLine] = useState(false)
  const [lineStart, setLineStart] = useState(null)
  
  // Step 3: Solar panel placement
  const [panelLayout, setPanelLayout] = useState(null)
  const [baseline, setBaseline] = useState(null) // { p1: [x, y], p2: [x, y] } - user-drawn baseline for first row
  const [showBaseline, setShowBaseline] = useState(true) // Toggle to show/hide baseline
  const [showDistances, setShowDistances] = useState(true) // Toggle to show/hide distance measurements
  const [distanceMeasurement, setDistanceMeasurement] = useState(null) // { p1: [x, y], p2: [x, y] } - user-drawn distance measurement
  const [panels, setPanels] = useState([]) // Array of panel objects
  const [selectedPanels, setSelectedPanels] = useState([]) // Array of selected panel IDs
  const [dragState, setDragState] = useState(null) // { panelIds, startX, startY, originalPositions }
  const [rotationState, setRotationState] = useState(null) // { panelIds, centerX, centerY, startAngle, originalRotations }
  const [viewZoom, setViewZoom] = useState(1) // Zoom level for Step 3 view (independent of uploadedImageData.scale)
  
  // Step 4: Construction planning (TBD)
  const [constructionPlan, setConstructionPlan] = useState(null)
  
  // Step 5: Export data (TBD)
  const [exportReady, setExportReady] = useState(false)

  const stepTitles = [
    'Allocate Roof',
    'Refine PV Area',
    'Place Solar Panels',
    'Construction Planning',
    'Finalize & Export'
  ]

  useEffect(() => {
    // Check backend health on mount
    checkBackend()
  }, [])

  const checkBackend = async () => {
    const status = await SAM2Service.checkHealth()
    setBackendStatus(status)
  }

  const handleStartOver = () => {
    if (confirm('Are you sure you want to start over? All progress will be lost.')) {
      // Reset all state to initial values
      setCurrentStep(1)
      setSelectedPoint(null)
      setRoofPolygon(null)
      setProcessedImage(null)
      setIsProcessing(false)
      setUploadedImageMode(true)
      setUploadedImageData(null)
      setClickPosition(null)
      setImageRef(null)
      setRefinedArea(null)
      setPanelType('AIKO-G670-MCH72Mw')
      setReferenceLine(null)
      setReferenceLineLengthCm('')
      setPanelFrontHeight('')
      setPanelBackHeight('')
      setPanelAngle('')
      setIsDrawingLine(false)
      setLineStart(null)
      setPanelLayout(null)
      setPanels([])
      setSelectedPanels([])
      setDragState(null)
      setRotationState(null)
      setConstructionPlan(null)
      setExportReady(false)
    }
  }

  // Helper function: Check if a point is inside a polygon
  const isPointInPolygon = (point, polygon) => {
    let inside = false
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1]
      const xj = polygon[j][0], yj = polygon[j][1]
      
      const intersect = ((yi > point.y) !== (yj > point.y))
        && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)
      if (intersect) inside = !inside
    }
    return inside
  }

  // Helper function: Check if a rectangle (panel) is inside polygon
  const isPanelInPolygon = (panelX, panelY, panelWidth, panelHeight, polygon) => {
    // Check all four corners of the panel
    const corners = [
      { x: panelX, y: panelY },
      { x: panelX + panelWidth, y: panelY },
      { x: panelX, y: panelY + panelHeight },
      { x: panelX + panelWidth, y: panelY + panelHeight }
    ]
    
    // All corners must be inside the polygon
    return corners.every(corner => isPointInPolygon(corner, polygon))
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
    setPanelLayout({ 
      panels: generatedPanels, 
      count: generatedPanels.length,
      totalCapacityKW: (generatedPanels.length * 0.67).toFixed(2)
    })
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
        
        // Store the processed image from backend
        if (result.properties.image_base64) {
          console.log('🖼️ BACKEND IMAGE DIMENSIONS:', {
            width: result.properties.image_width,
            height: result.properties.image_height,
            aspectRatio: (result.properties.image_width / result.properties.image_height).toFixed(3),
            polygonPoints: result.properties.polygon_pixels ? result.properties.polygon_pixels.length : 0
          })
          
          setProcessedImage({
            imageData: result.properties.image_base64,
            width: result.properties.image_width,
            height: result.properties.image_height,
            polygonPixels: result.properties.polygon_pixels,
            clickPoint: result.properties.click_point
          })
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

  const handlePolygonGenerated = (polygon) => {
    console.log('Polygon generated:', polygon)
    setRoofPolygon(polygon)
  }

  const handleImageUploaded = (imageData) => {
    console.log('Image uploaded:', imageData)
    setUploadedImageData(imageData)
    setUploadedImageMode(true)
  }

  const handleApprovePolygon = () => {
    if (!roofPolygon) return
    
    console.log('Polygon approved:', roofPolygon)
    // Move to next step
    handleNext()
  }

  const handleNext = () => {
    if (currentStep < totalSteps) {
      // Store Step 2 configuration when leaving Step 2
      if (currentStep === 2) {
        const pixelLength = Math.sqrt(
          Math.pow(referenceLine.end.x - referenceLine.start.x, 2) + 
          Math.pow(referenceLine.end.y - referenceLine.start.y, 2)
        )
        const pixelToCmRatio = parseFloat(referenceLineLengthCm) / pixelLength
        
        setRefinedArea({
          polygon: roofPolygon,
          panelType,
          referenceLine,
          referenceLineLengthCm: parseFloat(referenceLineLengthCm),
          pixelToCmRatio,
          panelConfig: {
            frontHeight: parseFloat(panelFrontHeight),
            backHeight: parseFloat(panelBackHeight),
            angle: parseFloat(panelAngle)
          },
          panelFrontHeight: parseFloat(panelFrontHeight),
          panelBackHeight: parseFloat(panelBackHeight),
          panelAngle: parseFloat(panelAngle)
        })
      }
      
      setCurrentStep(prev => prev + 1)
    }
  }

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(prev => prev - 1)
    }
  }

  const canProceedToNextStep = () => {
    switch (currentStep) {
      case 1:
        return roofPolygon !== null
      case 2:
        return (
          referenceLine !== null &&
          referenceLineLengthCm !== '' &&
          parseFloat(referenceLineLengthCm) > 0 &&
          panelFrontHeight !== '' &&
          parseFloat(panelFrontHeight) >= 0 &&
          panelBackHeight !== '' &&
          parseFloat(panelBackHeight) >= 0 &&
          panelAngle !== '' &&
          parseFloat(panelAngle) >= 0 &&
          parseFloat(panelAngle) <= 30
        )
      case 3:
        return panels.length > 0
      case 4:
        return constructionPlan !== null
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
        // Store the processed image from backend
        if (result.properties.image_base64) {
          console.log('🖼️ BACKEND IMAGE DIMENSIONS (uploaded):', {
            width: result.properties.image_width,
            height: result.properties.image_height,
            aspectRatio: (result.properties.image_width / result.properties.image_height).toFixed(3),
            polygonPoints: result.properties.polygon_pixels ? result.properties.polygon_pixels.length : 0
          })
          
          setProcessedImage({
            imageData: result.properties.image_base64,
            width: result.properties.image_width,
            height: result.properties.image_height,
            polygonPixels: result.properties.polygon_pixels,
            clickPoint: result.properties.click_point
          })
        }
        
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

  return (
    <div className="app">
      {/* Header Area */}
      <header className="app-header">
        <div className="header-content">
          <div className="header-title" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <img src="/logo.svg" alt="MyGreenPlanner Logo" style={{ height: '50px', width: '50px' }} />
            <div>
              <h1>MyGreenPlanner</h1>
              <p className="header-subtitle">Solar PV Roof Planning System</p>
            </div>
          </div>
          <button className="btn-start-over" onClick={handleStartOver}>
            Start Over
          </button>
        </div>
      </header>
      
      <main className="app-main">
        {/* Step 1: Roof Allocation */}
        {/* Step 1: Identify Roof */}
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
            setProcessedImage={setProcessedImage}
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
            panelBackHeight={panelBackHeight}
            setPanelBackHeight={setPanelBackHeight}
            panelAngle={panelAngle}
            setPanelAngle={setPanelAngle}
          />
        )}

        {/* Step 3: Place Solar Panels */}
        {/* Step 3: Place Solar Panels */}
        {currentStep === 3 && (
          <Step3PanelPlacement
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
            addManualPanel={addManualPanel}
          />
        )}

        {/* Step 4: Construction Planning */}
        {currentStep === 4 && (
          <div className="step-content">
            <div className="step-placeholder">
              <h2>Construction Planning</h2>
              <p>Generate installation details and requirements</p>
              <div className="placeholder-info">
                <p>This step will provide:</p>
                <ul>
                  <li>Bill of materials (BOM)</li>
                  <li>Mounting system specifications</li>
                  <li>Wiring diagram</li>
                  <li>Installation sequence</li>
                  <li>Safety requirements</li>
                </ul>
              </div>
              <button 
                className="btn-primary"
                onClick={() => setConstructionPlan({ generated: true })}
              >
                Generate Plan (Mock)
              </button>
            </div>
          </div>
        )}

        {/* Step 5: Finalize & Export */}
        {currentStep === 5 && (
          <div className="step-content">
            <div className="step-placeholder">
              <h2>📥 Finalize & Export</h2>
              <p>Review and export your solar PV design</p>
              <div className="placeholder-info">
                <p>Export options:</p>
                <ul>
                  <li>PDF report with all details</li>
                  <li>CAD files (DXF/DWG)</li>
                  <li>3D model visualization</li>
                  <li>Energy production estimates</li>
                  <li>Cost analysis</li>
                </ul>
              </div>
              <button 
                className="btn-primary"
                onClick={() => setExportReady(true)}
              >
                Export Project (Mock)
              </button>
            </div>
          </div>
        )}
        
        {isProcessing && (
          <div className="processing-overlay">
            <div className="spinner"></div>
            <p>Analyzing roof...</p>
          </div>
        )}
      </main>

      {/* Wizard Toolbar */}
      <footer className="wizard-toolbar">
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
        
        <div className="wizard-navigation">
          <button 
            className="btn-nav btn-back"
            onClick={handleBack}
            disabled={currentStep === 1}
          >
            ← Back
          </button>
          
          <div className="step-info">
            <span className="current-step-label">Step {currentStep} of {totalSteps}</span>
            {currentStep === 1 && roofPolygon && (
              <span className="status-message status-success">✓ Roof identified</span>
            )}
            {currentStep === 1 && !roofPolygon && (
              <span className="status-message status-hint">Click on the roof to detect outline</span>
            )}
          </div>
          
          <button 
            className="btn-nav btn-next"
            onClick={handleNext}
            disabled={!canProceedToNextStep()}
          >
            {currentStep === totalSteps ? 'Finish' : 'Next →'}
          </button>
        </div>
      </footer>
    </div>
  )
}

export default App
