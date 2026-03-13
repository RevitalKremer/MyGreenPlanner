import { useState, useEffect } from 'react'
import RoofMapper from './components/RoofMapper'
import ImageUploader from './components/ImageUploader'
import { SAM2Service } from './services/sam2Service'
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
  const [panels, setPanels] = useState([]) // Array of panel objects
  const [selectedPanels, setSelectedPanels] = useState([]) // Array of selected panel IDs
  const [dragState, setDragState] = useState(null) // { panelIds, startX, startY, originalPositions }
  const [rotationState, setRotationState] = useState(null) // { panelIds, centerX, centerY, startAngle, originalRotations }
  
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
  const generatePanelLayout = () => {
    if (!refinedArea || !refinedArea.polygon || !refinedArea.pixelToCmRatio) {
      alert('Missing configuration data from Step 2')
      return
    }

    const { polygon, pixelToCmRatio, panelConfig } = refinedArea
    const { frontHeight, backHeight, angle } = panelConfig
    
    // Check if baseline is drawn
    if (!baseline) {
      alert('Please draw a baseline for the first row of panels')
      return
    }
    
    // Get polygon coordinates array
    const polygonCoords = polygon.coordinates || polygon
    
    // Panel dimensions in cm (from selected panel type)
    const panelLengthCm = 238.2
    const panelWidthCm = 113.4
    const panelGapCm = 2.5
    const rowSpacingCm = backHeight * 1.5
    
    // Convert to pixels
    const panelLengthPx = panelLengthCm / pixelToCmRatio
    const panelWidthPx = panelWidthCm / pixelToCmRatio
    const panelGapPx = panelGapCm / pixelToCmRatio
    const rowSpacingPx = rowSpacingCm / pixelToCmRatio
    
    // Calculate roof projection (horizontal footprint) in pixels
    const angleRad = angle * (Math.PI / 180)
    const roofProjectionPx = (panelLengthCm * Math.cos(angleRad)) / pixelToCmRatio
    
    // Use the user-drawn baseline to determine roof orientation
    const roofOrientation = Math.atan2(
      baseline.p2[1] - baseline.p1[1],
      baseline.p2[0] - baseline.p1[0]
    )
    
    console.log('User baseline:', baseline)
    console.log('Roof orientation angle (radians):', roofOrientation)
    console.log('Roof orientation angle (degrees):', roofOrientation * (180 / Math.PI))
    
    // Find polygon bounds
    const minX = Math.min(...polygonCoords.map(p => p[0]))
    const maxX = Math.max(...polygonCoords.map(p => p[0]))
    const minY = Math.min(...polygonCoords.map(p => p[1]))
    const maxY = Math.max(...polygonCoords.map(p => p[1]))
    
    // Calculate polygon center for rotation
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    
    // Rotate baseline points to aligned space
    const rotatedBaseline = {
      p1: {
        x: centerX + (baseline.p1[0] - centerX) * Math.cos(-roofOrientation) - (baseline.p1[1] - centerY) * Math.sin(-roofOrientation),
        y: centerY + (baseline.p1[0] - centerX) * Math.sin(-roofOrientation) + (baseline.p1[1] - centerY) * Math.cos(-roofOrientation)
      },
      p2: {
        x: centerX + (baseline.p2[0] - centerX) * Math.cos(-roofOrientation) - (baseline.p2[1] - centerY) * Math.sin(-roofOrientation),
        y: centerY + (baseline.p2[0] - centerX) * Math.sin(-roofOrientation) + (baseline.p2[1] - centerY) * Math.cos(-roofOrientation)
      }
    }
    
    // Ensure baseline goes left to right in rotated space
    if (rotatedBaseline.p1.x > rotatedBaseline.p2.x) {
      const temp = rotatedBaseline.p1
      rotatedBaseline.p1 = rotatedBaseline.p2
      rotatedBaseline.p2 = temp
    }
    
    const baselineRotY = (rotatedBaseline.p1.y + rotatedBaseline.p2.y) / 2
    const baselineStartX = rotatedBaseline.p1.x
    const baselineEndX = rotatedBaseline.p2.x
    
    console.log('Rotated baseline:', rotatedBaseline)
    console.log('Baseline Y in rotated space:', baselineRotY)
    console.log('Baseline X range:', baselineStartX, 'to', baselineEndX)
    
    // Helper: Rotate point around center
    const rotatePoint = (x, y, angleRad) => {
      const dx = x - centerX
      const dy = y - centerY
      return {
        x: centerX + dx * Math.cos(-angleRad) - dy * Math.sin(-angleRad),
        y: centerY + dx * Math.sin(-angleRad) + dy * Math.cos(-angleRad)
      }
    }
    
    // Rotate polygon to align with roof orientation
    const rotatedPolygon = polygonCoords.map(p => rotatePoint(p[0], p[1], roofOrientation))
    
    // Find bounds of rotated polygon
    const rotMinX = Math.min(...rotatedPolygon.map(p => p.x))
    const rotMaxX = Math.max(...rotatedPolygon.map(p => p.x))
    const rotMinY = Math.min(...rotatedPolygon.map(p => p.y))
    const rotMaxY = Math.max(...rotatedPolygon.map(p => p.y))
    
    console.log('Rotated polygon bounds:', { rotMinX, rotMaxX, rotMinY, rotMaxY })
    console.log('Panel dimensions (px):', { panelLengthPx, panelWidthPx, roofProjectionPx })
    console.log('Row spacing (px):', rowSpacingPx)
    
    const generatedPanels = []
    let panelId = 1
    
    // Helper: Check if panel in rotated space fits in rotated polygon
    const isPanelInRotatedPolygon = (rotX, rotY, width, height) => {
      const corners = [
        { x: rotX, y: rotY },
        { x: rotX + width, y: rotY },
        { x: rotX, y: rotY + height },
        { x: rotX + width, y: rotY + height }
      ]
      
      return corners.every(corner => {
        let inside = false
        for (let i = 0, j = rotatedPolygon.length - 1; i < rotatedPolygon.length; j = i++) {
          const xi = rotatedPolygon[i].x, yi = rotatedPolygon[i].y
          const xj = rotatedPolygon[j].x, yj = rotatedPolygon[j].y
          
          const intersect = ((yi > corner.y) !== (yj > corner.y))
            && (corner.x < (xj - xi) * (corner.y - yi) / (yj - yi) + xi)
          if (intersect) inside = !inside
        }
        return inside
      })
    }
    
    // Start from the baseline - first row's top edge is at baseline, then build downward (toward higher Y = south in image coords but actually toward top of physical roof)
    // In image coordinates: Y increases downward, but after rotation this represents moving toward the physical top of the roof
    let currentRotY = baselineRotY
    let rowIndex = 0
    
    console.log('Panel placement starting:')
    console.log('  baselineRotY:', baselineRotY)
    console.log('  roofProjectionPx:', roofProjectionPx)
    console.log('  rotMaxY:', rotMaxY)
    console.log('  First row currentRotY:', currentRotY)
    
    while (currentRotY + roofProjectionPx <= rotMaxY) {
      // Try landscape orientation first
      // For first row, use baseline X range; for other rows, use full polygon width
      const startX = (rowIndex === 0) ? baselineStartX : rotMinX
      const endX = (rowIndex === 0) ? baselineEndX : rotMaxX
      
      let currentRotX = startX
      let panelsInRow = 0
      let isLastRow = (currentRotY + rowSpacingPx + roofProjectionPx) > rotMaxY
      
      // Place panels in row from west (left) to east (right) in rotated space
      while (currentRotX + panelWidthPx <= endX) {
        // Check if panel fits in rotated polygon
        if (isPanelInRotatedPolygon(currentRotX, currentRotY, panelWidthPx, roofProjectionPx)) {
          // Calculate center in rotated space
          const rotCenterX = currentRotX + panelWidthPx / 2
          const rotCenterY = currentRotY + roofProjectionPx / 2
          
          // Rotate back to original space
          const dx = rotCenterX - centerX
          const dy = rotCenterY - centerY
          const originalCenterX = centerX + dx * Math.cos(roofOrientation) - dy * Math.sin(roofOrientation)
          const originalCenterY = centerY + dx * Math.sin(roofOrientation) + dy * Math.cos(roofOrientation)
          
          // Calculate top-left corner in original space
          const originalX = originalCenterX - panelWidthPx / 2
          const originalY = originalCenterY - roofProjectionPx / 2
          
          generatedPanels.push({
            id: panelId++,
            x: originalX,
            y: originalY,
            width: panelWidthPx,
            height: roofProjectionPx,
            widthCm: panelWidthCm,
            heightCm: panelLengthCm,
            rotation: roofOrientation * (180 / Math.PI), // Store rotation in degrees
            row: rowIndex
          })
          panelsInRow++
        }
        
        currentRotX += panelWidthPx + panelGapPx
      }
      
      console.log(`Row ${rowIndex}: placed ${panelsInRow} panels at Y=${currentRotY}`)
      
      // Move to next row in rotated space (toward higher Y, which is toward physical roof top after considering rotation)
      currentRotY += (roofProjectionPx + rowSpacingPx)
      rowIndex++
      
      // If this is the last row and landscape didn't fit, try portrait
      if (isLastRow && panelsInRow === 0 && (currentRotY + roofProjectionPx <= rotMaxY)) {
        const portraitProjectionPx = (panelWidthCm * Math.cos(angleRad)) / pixelToCmRatio
        const portraitWidthPx = panelLengthPx
        
        currentRotX = rotMinX
        while (currentRotX + portraitWidthPx <= rotMaxX) {
          if (isPanelInRotatedPolygon(currentRotX, currentRotY, portraitWidthPx, portraitProjectionPx)) {
            // Calculate center in rotated space
            const rotCenterX = currentRotX + portraitWidthPx / 2
            const rotCenterY = currentRotY + portraitProjectionPx / 2
            
            // Rotate back to original space
            const dx = rotCenterX - centerX
            const dy = rotCenterY - centerY
            const originalCenterX = centerX + dx * Math.cos(roofOrientation) - dy * Math.sin(roofOrientation)
            const originalCenterY = centerY + dx * Math.sin(roofOrientation) + dy * Math.cos(roofOrientation)
            
            // Calculate top-left corner in original space
            const originalX = originalCenterX - portraitWidthPx / 2
            const originalY = originalCenterY - portraitProjectionPx / 2
            
            generatedPanels.push({
              id: panelId++,
              x: originalX,
              y: originalY,
              width: portraitWidthPx,
              height: portraitProjectionPx,
              widthCm: panelLengthCm,
              heightCm: panelWidthCm,
              rotation: roofOrientation * (180 / Math.PI) + 90, // Roof orientation + 90 for portrait
              row: rowIndex
            })
            panelsInRow++
          }
          currentRotX += portraitWidthPx + panelGapPx
        }
        console.log(`Row ${rowIndex} (portrait): placed ${panelsInRow} panels`)
        break
      }
    }
    
    console.log(`Total panels placed: ${generatedPanels.length}`)
    setPanels(generatedPanels)
    setPanelLayout({ 
      panels: generatedPanels, 
      count: generatedPanels.length,
      totalCapacityKW: (generatedPanels.length * 0.67).toFixed(2)
    })
  }

  const addManualPanel = () => {
    if (!refinedArea || !refinedArea.polygon || !imageRef || !baseline || !baseline.p2) return

    const { pixelToCmRatio } = refinedArea
    
    // Panel dimensions from AIKO-G670-MCH72Mw specifications
    const panelLengthCm = 238.2
    const panelWidthCm = 113.4
    
    // Convert to pixels
    const panelLengthPx = panelLengthCm / pixelToCmRatio
    const panelWidthPx = panelWidthCm / pixelToCmRatio
    
    // Calculate baseline center and angle
    const baselineCenterX = (baseline.p1[0] + baseline.p2[0]) / 2
    const baselineCenterY = (baseline.p1[1] + baseline.p2[1]) / 2
    const baselineAngle = Math.atan2(
      baseline.p2[1] - baseline.p1[1],
      baseline.p2[0] - baseline.p1[0]
    )
    
    // Place panel below baseline (perpendicular to baseline, 50px margin)
    const margin = 50
    const newPanelCenterX = baselineCenterX + margin * Math.sin(baselineAngle)
    const newPanelCenterY = baselineCenterY - margin * Math.cos(baselineAngle)
    
    // Calculate top-left corner from center
    const newPanelX = newPanelCenterX - panelLengthPx / 2
    const newPanelY = newPanelCenterY - panelWidthPx / 2
    
    // Generate new panel ID
    const newId = panels.length > 0 ? Math.max(...panels.map(p => p.id)) + 1 : 1
    
    // Create new panel with baseline rotation
    const newPanel = {
      id: newId,
      x: newPanelX,
      y: newPanelY,
      width: panelLengthPx,
      height: panelWidthPx,
      widthCm: panelLengthCm,
      heightCm: panelWidthCm,
      rotation: baselineAngle * (180 / Math.PI) // Match baseline angle
    }
    
    // Add to panels array
    setPanels([...panels, newPanel])
    
    // Select the new panel
    setSelectedPanels([newId])
    
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
        {currentStep === 1 && (
          <>
            {/* Step Options Toolbar */}
            <div className="step-options">
              <button 
                className="btn-option" 
                onClick={() => setUploadedImageMode(!uploadedImageMode)}
              >
                {uploadedImageMode ? 'Map' : 'Image'}
              </button>
              <div className="step-instruction" style={{ flex: 1, padding: '0 1rem', color: '#666666', fontWeight: '500' }}>
                {uploadedImageMode ? 'Upload an image and click on the roof' : 'Click on the roof to identify it (SAM2 will process)'}
              </div>
              <div className="step-status">
                {backendStatus.status === 'checking' && (
                  <span className="status-badge status-checking">Checking</span>
                )}
                {backendStatus.status === 'running' && backendStatus.model_loaded && (
                  <span className="status-badge status-ready">SAM2 Ready</span>
                )}
                {backendStatus.status === 'running' && !backendStatus.model_loaded && (
                  <span className="status-badge status-warning">Loading</span>
                )}
                {backendStatus.status === 'offline' && (
                  <span className="status-badge status-offline">Offline</span>
                )}
              </div>
            </div>
            
            {/* Step Content Area */}
            <div className="step-content-area" style={{ position: 'relative' }}>
              {uploadedImageMode ? (
                uploadedImageData ? (
              <div className="uploaded-image-view" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%' }}>
                <div className="uploaded-image-container" style={{ position: 'relative', display: 'inline-block', width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '100%' }}>
                  <img 
                    ref={(el) => setImageRef(el)}
                    src={uploadedImageData.imageData} 
                    alt="Uploaded roof"
                    onClick={handleImageClick}
                    style={{
                      display: 'block',
                      transform: `rotate(${uploadedImageData.rotation}deg) scale(${uploadedImageData.scale})`,
                      maxWidth: '100%',
                      maxHeight: 'calc(100vh - 250px)',
                      width: 'auto',
                      height: 'auto',
                      cursor: 'crosshair'
                    }}
                  />
                  {roofPolygon && roofPolygon.coordinates && imageRef && (
                    <svg
                      viewBox={`0 0 ${imageRef.naturalWidth} ${imageRef.naturalHeight}`}
                      preserveAspectRatio="xMidYMid meet"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        pointerEvents: 'none',
                        transform: `rotate(${uploadedImageData.rotation}deg) scale(${uploadedImageData.scale})`
                      }}
                    >
                      <polygon
                        points={roofPolygon.coordinates.map(coord => `${coord[0]},${coord[1]}`).join(' ')}
                        fill="rgba(196, 214, 0, 0.3)"
                        stroke="#C4D600"
                        strokeWidth="3"
                      />
                    </svg>
                  )}
                  {selectedPoint && imageRef && (
                    <div 
                      className="selected-point-marker"
                      style={{
                        position: 'absolute',
                        left: `calc(50% + ${(selectedPoint.x - imageRef.naturalWidth / 2) * (imageRef.width / imageRef.naturalWidth)}px)`,
                        top: `calc(50% + ${(selectedPoint.y - imageRef.naturalHeight / 2) * (imageRef.height / imageRef.naturalHeight)}px)`,
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        border: '3px solid #FF5722',
                        background: 'rgba(255, 87, 34, 0.5)',
                        transform: `translate(-50%, -50%) rotate(${uploadedImageData.rotation}deg) scale(${uploadedImageData.scale})`,
                        transformOrigin: 'center',
                        pointerEvents: 'none',
                        zIndex: 10
                      }}
                    />
                  )}
                </div>
              </div>
                ) : (
                  <ImageUploader 
                    onImageUploaded={handleImageUploaded}
                    onClose={() => {}} 
                  />
                )
              ) : (
                <RoofMapper 
                onPointSelect={handlePointSelect}
                selectedPoint={selectedPoint}
                roofPolygon={roofPolygon}
              />
            )}

            {/* Info Panel - only shown in Step 1 */}
            {selectedPoint && (
              <div className="info-panel">
                <h3>Selected Location</h3>
                {uploadedImageMode ? (
                  <>
                    <p>Pixel X: {selectedPoint.x}</p>
                    <p>Pixel Y: {selectedPoint.y}</p>
                  </>
                ) : (
                  <>
                    <p>Latitude: {selectedPoint.lat?.toFixed(6)}</p>
                    <p>Longitude: {selectedPoint.lng?.toFixed(6)}</p>
                  </>
                )}
                {roofPolygon && (
                  <div>
                    <h4>Roof Polygon Created</h4>
                    {roofPolygon.area && (
                      <p>Area: {roofPolygon.area.toLocaleString()} {uploadedImageMode ? 'pixels' : 'm²'}</p>
                    )}
                    {roofPolygon.confidence && (
                      <p>Confidence: {(roofPolygon.confidence * 100).toFixed(1)}%</p>
                    )}
                    {roofPolygon.coordinates && <p>Points: {roofPolygon.coordinates.length}</p>}
                    
                    <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexDirection: 'column' }}>
                      <button 
                        onClick={() => {
                          setSelectedPoint(null)
                          setRoofPolygon(null)
                          setProcessedImage(null)
                        }}
                        style={{
                          background: '#f44336',
                          color: 'white',
                          border: 'none',
                          padding: '0.75rem 1rem',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontWeight: '600'
                        }}
                      >
                        Clear & Try Again
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            </div>
          </>
        )}

        {/* Step 2: Refine PV Area */}
        {currentStep === 2 && (
          <>
            <div className="step-content-area" style={{ position: 'relative' }}>
              {uploadedImageData && roofPolygon ? (
                <div className="uploaded-image-view" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%' }}>
                  <div className="uploaded-image-container" style={{ position: 'relative', display: 'inline-block', width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '100%' }}>
                    <img 
                      ref={(el) => setImageRef(el)}
                      src={uploadedImageData.imageData} 
                      alt="Roof with polygon"
                      onClick={(e) => {
                        if (isDrawingLine && imageRef) {
                          const rect = imageRef.getBoundingClientRect()
                          const x = ((e.clientX - rect.left) / rect.width) * imageRef.naturalWidth
                          const y = ((e.clientY - rect.top) / rect.height) * imageRef.naturalHeight
                          
                          if (!lineStart) {
                            setLineStart({ x, y })
                          } else {
                            setReferenceLine({ start: lineStart, end: { x, y } })
                            setLineStart(null)
                            setIsDrawingLine(false)
                          }
                        }
                      }}
                      style={{
                        display: 'block',
                        transform: `rotate(${uploadedImageData.rotation}deg) scale(${uploadedImageData.scale})`,
                        maxWidth: '100%',
                        maxHeight: 'calc(100vh - 250px)',
                        width: 'auto',
                        height: 'auto',
                        cursor: isDrawingLine ? 'crosshair' : 'default'
                      }}
                    />
                    
                    {/* SVG overlay for polygon mask and reference line */}
                    {imageRef && (
                      <svg
                        viewBox={`0 0 ${imageRef.naturalWidth} ${imageRef.naturalHeight}`}
                        preserveAspectRatio="xMidYMid meet"
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: '100%',
                          pointerEvents: 'none',
                          transform: `rotate(${uploadedImageData.rotation}deg) scale(${uploadedImageData.scale})`
                        }}
                      >
                        {/* Mask: darken everything outside polygon */}
                        <defs>
                          <mask id="polygonMask">
                            <rect width="100%" height="100%" fill="white"/>
                            <polygon
                              points={roofPolygon.coordinates.map(coord => `${coord[0]},${coord[1]}`).join(' ')}
                              fill="black"
                            />
                          </mask>
                        </defs>
                        
                        {/* Semi-transparent overlay outside polygon */}
                        <rect 
                          width="100%" 
                          height="100%" 
                          fill="rgba(0, 0, 0, 0.6)" 
                          mask="url(#polygonMask)"
                        />
                        
                        {/* Polygon outline */}
                        <polygon
                          points={roofPolygon.coordinates.map(coord => `${coord[0]},${coord[1]}`).join(' ')}
                          fill="rgba(196, 214, 0, 0.2)"
                          stroke="#C4D600"
                          strokeWidth="3"
                        />
                        
                        {/* Reference line */}
                        {referenceLine && (
                          <>
                            <line
                              x1={referenceLine.start.x}
                              y1={referenceLine.start.y}
                              x2={referenceLine.end.x}
                              y2={referenceLine.end.y}
                              stroke="#FF5722"
                              strokeWidth="4"
                            />
                            <circle cx={referenceLine.start.x} cy={referenceLine.start.y} r="6" fill="#FF5722" />
                            <circle cx={referenceLine.end.x} cy={referenceLine.end.y} r="6" fill="#FF5722" />
                          </>
                        )}
                        
                        {/* Line being drawn */}
                        {isDrawingLine && lineStart && (
                          <circle cx={lineStart.x} cy={lineStart.y} r="6" fill="#FF5722" />
                        )}
                      </svg>
                    )}
                  </div>
                </div>
              ) : (
                <div className="step-content">
                  <div className="step-placeholder">
                    <h2>No Roof Data</h2>
                    <p>Please complete Step 1 first to identify the roof area.</p>
                  </div>
                </div>
              )}

              {/* Left: Panel Side View Diagram */}
              {uploadedImageData && roofPolygon && (
                <div style={{ 
                  position: 'absolute',
                  top: '20px',
                  left: '20px',
                  width: '400px',
                  padding: '1.5rem', 
                  background: 'white',
                  borderRadius: '12px',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                  border: '2px solid #C4D600',
                  minHeight: '200px',
                  display: 'flex',
                  flexDirection: 'column'
                }}>
                    <h4 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: '600', color: '#666' }}>
                      Panel Side View
                    </h4>
                    {panelFrontHeight && panelBackHeight && panelAngle ? (
                      <svg 
                        viewBox="0 0 300 180" 
                        style={{ 
                          width: '100%', 
                          height: 'auto',
                          background: '#f8f9fa',
                          borderRadius: '6px',
                          padding: '1rem'
                        }}
                      >
                        {/* Roof line */}
                        <line x1="20" y1="140" x2="280" y2="140" stroke="#666" strokeWidth="2" />
                        <text x="150" y="160" textAnchor="middle" fontSize="10" fill="#999">Roof</text>
                        
                        {/* Front height (LEFT side) */}
                        <line x1="50" y1="140" x2="50" y2={140 - parseFloat(panelFrontHeight) * 0.5} stroke="#FF5722" strokeWidth="2" strokeDasharray="3,3" />
                        <text x="30" y={140 - parseFloat(panelFrontHeight) * 0.25} textAnchor="middle" fontSize="9" fill="#FF5722" fontWeight="600">
                          {panelFrontHeight}cm
                        </text>
                        <text x="30" y={140 - parseFloat(panelFrontHeight) * 0.25 + 12} textAnchor="middle" fontSize="8" fill="#FF5722">
                          (front)
                        </text>
                        
                        {/* Back height (RIGHT side) */}
                        <line 
                          x1={50 + 238.2 * 0.5 * Math.cos(parseFloat(panelAngle) * Math.PI / 180)} 
                          y1="140" 
                          x2={50 + 238.2 * 0.5 * Math.cos(parseFloat(panelAngle) * Math.PI / 180)} 
                          y2={140 - parseFloat(panelBackHeight) * 0.5} 
                          stroke="#C4D600" 
                          strokeWidth="2" 
                          strokeDasharray="3,3" 
                        />
                        <text 
                          x={50 + 238.2 * 0.5 * Math.cos(parseFloat(panelAngle) * Math.PI / 180) + 25} 
                          y={140 - parseFloat(panelBackHeight) * 0.25} 
                          textAnchor="start" 
                          fontSize="9" 
                          fill="#C4D600" 
                          fontWeight="600"
                        >
                          {panelBackHeight}cm
                        </text>
                        <text 
                          x={50 + 238.2 * 0.5 * Math.cos(parseFloat(panelAngle) * Math.PI / 180) + 25} 
                          y={140 - parseFloat(panelBackHeight) * 0.25 + 12} 
                          textAnchor="start" 
                          fontSize="8" 
                          fill="#C4D600"
                        >
                          (back)
                        </text>
                        
                        {/* Panel (angled line) */}
                        <line 
                          x1="50" 
                          y1={140 - parseFloat(panelFrontHeight) * 0.5} 
                          x2={50 + 238.2 * 0.5 * Math.cos(parseFloat(panelAngle) * Math.PI / 180)} 
                          y2={140 - parseFloat(panelBackHeight) * 0.5} 
                          stroke="#666666" 
                          strokeWidth="4" 
                        />
                        
                        {/* Panel length label */}
                        <text 
                          x={50 + 238.2 * 0.25 * Math.cos(parseFloat(panelAngle) * Math.PI / 180)} 
                          y={140 - (parseFloat(panelFrontHeight) + parseFloat(panelBackHeight)) * 0.25 - 15} 
                          textAnchor="middle" 
                          fontSize="10" 
                          fill="#666666" 
                          fontWeight="700"
                        >
                          Panel: 238.2cm
                        </text>
                        
                        {/* Roof projection (horizontal distance) */}
                        <line 
                          x1="50" 
                          y1="145" 
                          x2={50 + 238.2 * 0.5 * Math.cos(parseFloat(panelAngle) * Math.PI / 180)} 
                          y2="145" 
                          stroke="#2196F3" 
                          strokeWidth="2" 
                          strokeDasharray="5,3"
                        />
                        <text 
                          x={50 + 238.2 * 0.25 * Math.cos(parseFloat(panelAngle) * Math.PI / 180)} 
                          y="158" 
                          textAnchor="middle" 
                          fontSize="9" 
                          fill="#2196F3" 
                          fontWeight="600"
                        >
                          Projection: {(238.2 * Math.cos(parseFloat(panelAngle) * Math.PI / 180)).toFixed(1)}cm
                        </text>
                        
                        {/* Angle arc */}
                        <path 
                          d={`M ${50 + 30} 140 A 30 30 0 0 1 ${50 + 30 * Math.cos(parseFloat(panelAngle) * Math.PI / 180)} ${140 - 30 * Math.sin(parseFloat(panelAngle) * Math.PI / 180)}`} 
                          stroke="#666666" 
                          strokeWidth="1.5" 
                          fill="none" 
                        />
                        <text 
                          x={50 + 40} 
                          y={135} 
                          fontSize="9" 
                          fill="#666666" 
                          fontWeight="600"
                        >
                          {parseFloat(panelAngle).toFixed(1)}°
                        </text>
                      </svg>
                    ) : (
                      <div style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: '#f8f9fa',
                        borderRadius: '6px',
                        padding: '2rem',
                        textAlign: 'center',
                        color: '#999'
                      }}>
                        <p style={{ margin: 0, fontSize: '0.9rem' }}>
                          Enter panel measurements to see diagram
                        </p>
                      </div>
                    )}
                  </div>
                )}

              {/* Right: Panel Configuration Form */}
              {uploadedImageData && roofPolygon && (
                  <div style={{
                    position: 'absolute',
                    top: '20px',
                    right: '20px',
                    width: '320px',
                    background: 'white',
                    padding: '1.5rem',
                    borderRadius: '12px',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                    maxHeight: 'calc(100vh - 300px)',
                    overflowY: 'auto',
                    border: '2px solid #C4D600'
                  }}>
                    <h3 style={{ margin: '0 0 1rem 0', color: '#666666', fontSize: '1.1rem' }}>
                      Panel Configuration
                    </h3>

                  {/* Panel Type */}
                  <div style={{ marginBottom: '1.25rem' }}>
                    <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                      Panel Type
                    </label>
                    <select 
                      value={panelType}
                      onChange={(e) => setPanelType(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '0.65rem',
                        border: '2px solid #e0e0e0',
                        borderRadius: '6px',
                        fontSize: '0.9rem'
                      }}
                    >
                      <option value="AIKO-G670-MCH72Mw">AIKO-G670-MCH72Mw (2382×1134×30mm)</option>
                    </select>
                    <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.75rem', color: '#666', fontStyle: 'italic' }}>
                      Panel: 238.2 cm (L) × 113.4 cm (W) × 3.0 cm (H)
                    </p>
                  </div>

                  {/* Reference Line */}
                  <div style={{ marginBottom: '1.25rem', padding: '1rem', background: '#fcfdf7', borderRadius: '8px', border: '1px solid #C4D600' }}>
                    <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                      Reference Line (for scale)
                    </label>
                    <button
                      onClick={() => {
                        if (isDrawingLine) {
                          setIsDrawingLine(false)
                          setLineStart(null)
                        } else {
                          setIsDrawingLine(true)
                          setReferenceLine(null)
                        }
                      }}
                      style={{
                        width: '100%',
                        padding: '0.65rem',
                        background: isDrawingLine ? '#f44336' : '#C4D600',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: '600',
                        fontSize: '0.9rem',
                        marginBottom: '0.75rem'
                      }}
                    >
                      {isDrawingLine ? 'Cancel Drawing' : (referenceLine ? 'Redraw Line' : 'Draw Line on Image')}
                    </button>
                    
                    {referenceLine && (
                      <>
                        <label style={{ display: 'block', fontWeight: '500', marginBottom: '0.5rem', fontSize: '0.85rem', color: '#666' }}>
                          Line Length (cm)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={referenceLineLengthCm}
                          onChange={(e) => setReferenceLineLengthCm(e.target.value)}
                          placeholder="Enter length in cm"
                          style={{
                            width: '100%',
                            padding: '0.65rem',
                            border: '2px solid #e0e0e0',
                            borderRadius: '6px',
                            fontSize: '0.9rem'
                          }}
                        />
                        {referenceLineLengthCm && (
                          <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: '#666' }}>
                            Pixel length: {Math.round(Math.sqrt(
                              Math.pow(referenceLine.end.x - referenceLine.start.x, 2) + 
                              Math.pow(referenceLine.end.y - referenceLine.start.y, 2)
                            ))}px
                            <br/>
                            Ratio: {(referenceLineLengthCm / Math.sqrt(
                              Math.pow(referenceLine.end.x - referenceLine.start.x, 2) + 
                              Math.pow(referenceLine.end.y - referenceLine.start.y, 2)
                            )).toFixed(4)} cm/px
                          </p>
                        )}
                      </>
                    )}
                  </div>

                  {/* Panel Front Height */}
                  <div style={{ marginBottom: '1.25rem' }}>
                    <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                      Panel Front Height (cm)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={panelFrontHeight}
                      onChange={(e) => setPanelFrontHeight(e.target.value)}
                      placeholder="Elevation from roof"
                      style={{
                        width: '100%',
                        padding: '0.65rem',
                        border: '2px solid #e0e0e0',
                        borderRadius: '6px',
                        fontSize: '0.9rem'
                      }}
                    />
                  </div>

                  {/* Panel Back Height */}
                  <div style={{ marginBottom: '1.25rem' }}>
                    <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                      Panel Back Height (cm)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={panelBackHeight}
                      onChange={(e) => {
                        const backHeight = e.target.value
                        setPanelBackHeight(backHeight)
                        
                        // Auto-calculate angle from back height
                        // back_height = front_height + panel_length × sin(angle)
                        // Therefore: angle = asin((back_height - front_height) / panel_length)
                        if (backHeight !== '' && parseFloat(backHeight) >= 0 && panelFrontHeight !== '' && parseFloat(panelFrontHeight) >= 0) {
                          const panelLengthCm = 238.2
                          const backHeightVal = parseFloat(backHeight)
                          const frontHeightVal = parseFloat(panelFrontHeight)
                          
                          const verticalRise = backHeightVal - frontHeightVal
                          
                          // Vertical rise must be positive and can't exceed panel length
                          if (verticalRise >= 0 && verticalRise <= panelLengthCm) {
                            const angleRadians = Math.asin(verticalRise / panelLengthCm)
                            const angleDegrees = angleRadians * (180 / Math.PI)
                            
                            // Only update if within valid range (0-30°)
                            if (angleDegrees >= 0 && angleDegrees <= 30) {
                              setPanelAngle(angleDegrees.toFixed(2))
                            }
                          }
                        }
                      }}
                      placeholder="front_height + panel_length × sin(angle)"
                      style={{
                        width: '100%',
                        padding: '0.65rem',
                        border: '2px solid #e0e0e0',
                        borderRadius: '6px',
                        fontSize: '0.9rem'
                      }}
                    />
                    {panelFrontHeight && (
                      <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.75rem', color: '#999' }}>
                        Max: {(parseFloat(panelFrontHeight) + 238.2 * Math.sin(30 * Math.PI / 180)).toFixed(1)} cm (at 30°)
                      </p>
                    )}
                  </div>

                  {/* Panel Angle */}
                  <div style={{ marginBottom: '1.25rem' }}>
                    <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                      Panel Angle (degrees)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="30"
                      step="0.1"
                      value={panelAngle}
                      onChange={(e) => {
                        const angle = e.target.value
                        const angleVal = parseFloat(angle)
                        
                        if (angle === '' || (angleVal >= 0 && angleVal <= 30)) {
                          setPanelAngle(angle)
                          
                          // Auto-calculate back height from angle
                          // back_height = front_height + panel_length × sin(angle)
                          // Panel length: 238.2 cm (AIKO-G670-MCH72Mw: 2382mm)
                          if (angle !== '' && angleVal >= 0 && angleVal <= 30 && panelFrontHeight !== '' && parseFloat(panelFrontHeight) >= 0) {
                            const panelLengthCm = 238.2
                            const frontHeightVal = parseFloat(panelFrontHeight)
                            const angleRadians = angleVal * (Math.PI / 180)
                            const backHeight = frontHeightVal + panelLengthCm * Math.sin(angleRadians)
                            setPanelBackHeight(backHeight.toFixed(2))
                          }
                        }
                      }}
                      placeholder="0-30°"
                      style={{
                        width: '100%',
                        padding: '0.65rem',
                        border: '2px solid #e0e0e0',
                        borderRadius: '6px',
                        fontSize: '0.9rem'
                      }}
                    />
                  </div>

                  {/* Validation Summary */}
                  <div style={{ 
                    padding: '1rem', 
                    background: referenceLine && referenceLineLengthCm && panelFrontHeight && panelBackHeight && panelAngle ? '#e8f5e9' : '#fff3cd',
                    borderRadius: '8px',
                    fontSize: '0.85rem'
                  }}>
                    <strong>Required:</strong>
                    <ul style={{ margin: '0.5rem 0 0 0', paddingLeft: '1.25rem' }}>
                      <li style={{ color: referenceLine && referenceLineLengthCm ? '#4caf50' : '#ff9800' }}>
                        Reference line with length
                      </li>
                      <li style={{ color: panelFrontHeight ? '#4caf50' : '#ff9800' }}>
                        Panel front height
                      </li>
                      <li style={{ color: panelBackHeight ? '#4caf50' : '#ff9800' }}>
                        Panel back height
                      </li>
                      <li style={{ color: panelAngle ? '#4caf50' : '#ff9800' }}>
                        Panel angle
                      </li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Step 3: Place Solar Panels */}
        {currentStep === 3 && (
          <>
            <div className="step-content-area" style={{ position: 'relative' }}>
              {uploadedImageData && roofPolygon && refinedArea ? (
                <div className="uploaded-image-view" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%' }}>
                  <div className="uploaded-image-container" style={{ position: 'relative', display: 'inline-block', width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '100%' }}>
                    <img 
                      ref={(el) => setImageRef(el)}
                      src={uploadedImageData.imageData} 
                      alt="Roof with panels"
                      style={{
                        display: 'block',
                        transform: `rotate(${uploadedImageData.rotation}deg) scale(${uploadedImageData.scale})`,
                        maxWidth: '100%',
                        maxHeight: 'calc(100vh - 250px)',
                        width: 'auto',
                        height: 'auto',
                        cursor: 'default'
                      }}
                    />
                    
                    {/* SVG overlay for polygon and panels */}
                    {imageRef && (
                      <svg
                        viewBox={`0 0 ${imageRef.naturalWidth} ${imageRef.naturalHeight}`}
                        preserveAspectRatio="xMidYMid meet"
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: '100%',
                          pointerEvents: 'auto',
                          transform: `rotate(${uploadedImageData.rotation}deg) scale(${uploadedImageData.scale})`,
                          cursor: dragState ? 'move' : 'default'
                        }}
                        onMouseDown={(e) => {
                          const svg = e.currentTarget
                          const rect = svg.getBoundingClientRect()
                          const x = ((e.clientX - rect.left) / rect.width) * imageRef.naturalWidth
                          const y = ((e.clientY - rect.top) / rect.height) * imageRef.naturalHeight
                          
                          // If baseline is not complete, capture baseline points
                          if (!baseline) {
                            setBaseline({ p1: [x, y], p2: null })
                            return
                          }
                          if (baseline && baseline.p2 === null) {
                            setBaseline({ ...baseline, p2: [x, y] })
                            return
                          }
                          
                          // Check if clicking on a rotation icon (top-right corner of selected panels)
                          let clickedRotationHandle = null
                          const iconSize = 10
                          const iconPadding = 3
                          
                          for (const panel of panels) {
                            if (selectedPanels.includes(panel.id)) {
                              const centerX = panel.x + panel.width / 2
                              const centerY = panel.y + panel.height / 2
                              const rotation = (panel.rotation || 0) * Math.PI / 180
                              
                              // Icon position in unrotated space (top-right corner)
                              const iconLocalX = panel.x + panel.width - iconPadding - iconSize / 2
                              const iconLocalY = panel.y + iconPadding + iconSize / 2
                              
                              // Rotate icon position around panel center
                              const dx = iconLocalX - centerX
                              const dy = iconLocalY - centerY
                              const iconX = centerX + dx * Math.cos(rotation) - dy * Math.sin(rotation)
                              const iconY = centerY + dx * Math.sin(rotation) + dy * Math.cos(rotation)
                              
                              const distance = Math.sqrt(Math.pow(x - iconX, 2) + Math.pow(y - iconY, 2))
                              if (distance <= iconSize / 2) {
                                clickedRotationHandle = panel
                                break
                              }
                            }
                          }
                          
                          if (clickedRotationHandle) {
                            // Start group rotation - anchor panel is the one whose handle was clicked
                            const anchorCenterX = clickedRotationHandle.x + clickedRotationHandle.width / 2
                            const anchorCenterY = clickedRotationHandle.y + clickedRotationHandle.height / 2
                            const startAngle = Math.atan2(y - anchorCenterY, x - anchorCenterX) * (180 / Math.PI)
                            
                            // Store original rotations and positions for all selected panels
                            const originalData = {}
                            selectedPanels.forEach(id => {
                              const panel = panels.find(p => p.id === id)
                              if (panel) {
                                const panelCenterX = panel.x + panel.width / 2
                                const panelCenterY = panel.y + panel.height / 2
                                originalData[id] = {
                                  rotation: panel.rotation || 0,
                                  centerX: panelCenterX,
                                  centerY: panelCenterY,
                                  x: panel.x,
                                  y: panel.y
                                }
                              }
                            })
                            
                            setRotationState({
                              anchorPanelId: clickedRotationHandle.id,
                              panelIds: selectedPanels,
                              anchorCenterX,
                              anchorCenterY,
                              startAngle,
                              originalData
                            })
                            return
                          }
                          
                          // Check if clicking on a panel
                          const clickedPanel = panels.find(panel => 
                            x >= panel.x && x <= panel.x + panel.width &&
                            y >= panel.y && y <= panel.y + panel.height
                          )
                          
                          if (clickedPanel) {
                            // Handle multi-select with Shift key
                            if (e.shiftKey) {
                              if (selectedPanels.includes(clickedPanel.id)) {
                                setSelectedPanels(selectedPanels.filter(id => id !== clickedPanel.id))
                              } else {
                                setSelectedPanels([...selectedPanels, clickedPanel.id])
                              }
                            } else {
                              // Single select (or start drag)
                              const panelsToMove = selectedPanels.includes(clickedPanel.id) 
                                ? selectedPanels 
                                : [clickedPanel.id]
                              
                              setSelectedPanels(panelsToMove)
                              
                              // Start drag
                              const originalPositions = {}
                              panelsToMove.forEach(id => {
                                const panel = panels.find(p => p.id === id)
                                if (panel) {
                                  originalPositions[id] = { x: panel.x, y: panel.y }
                                }
                              })
                              
                              setDragState({
                                panelIds: panelsToMove,
                                startX: x,
                                startY: y,
                                originalPositions
                              })
                            }
                          } else {
                            // Clicked on empty space - deselect all
                            if (!e.shiftKey) {
                              setSelectedPanels([])
                            }
                          }
                        }}
                        onMouseMove={(e) => {
                          if (rotationState) {
                            const svg = e.currentTarget
                            const rect = svg.getBoundingClientRect()
                            const x = ((e.clientX - rect.left) / rect.width) * imageRef.naturalWidth
                            const y = ((e.clientY - rect.top) / rect.height) * imageRef.naturalHeight
                            
                            // Calculate current angle relative to anchor center
                            const currentAngle = Math.atan2(y - rotationState.anchorCenterY, x - rotationState.anchorCenterX) * (180 / Math.PI)
                            const angleDelta = currentAngle - rotationState.startAngle
                            const angleRad = angleDelta * (Math.PI / 180)
                            
                            // Update panel rotations AND positions (group rotation around anchor)
                            setPanels(prevPanels => prevPanels.map(panel => {
                              if (rotationState.panelIds.includes(panel.id)) {
                                const originalData = rotationState.originalData[panel.id]
                                
                                // Calculate relative position from anchor center
                                const relX = originalData.centerX - rotationState.anchorCenterX
                                const relY = originalData.centerY - rotationState.anchorCenterY
                                
                                // Rotate the relative position
                                const rotatedRelX = relX * Math.cos(angleRad) - relY * Math.sin(angleRad)
                                const rotatedRelY = relX * Math.sin(angleRad) + relY * Math.cos(angleRad)
                                
                                // Calculate new center position
                                const newCenterX = rotationState.anchorCenterX + rotatedRelX
                                const newCenterY = rotationState.anchorCenterY + rotatedRelY
                                
                                // Calculate new top-left position
                                const newX = newCenterX - panel.width / 2
                                const newY = newCenterY - panel.height / 2
                                
                                return {
                                  ...panel,
                                  x: newX,
                                  y: newY,
                                  rotation: (originalData.rotation + angleDelta) % 360
                                }
                              }
                              return panel
                            }))
                          } else if (dragState) {
                            const svg = e.currentTarget
                            const rect = svg.getBoundingClientRect()
                            const x = ((e.clientX - rect.left) / rect.width) * imageRef.naturalWidth
                            const y = ((e.clientY - rect.top) / rect.height) * imageRef.naturalHeight
                            
                            const deltaX = x - dragState.startX
                            const deltaY = y - dragState.startY
                            
                            // Update panel positions
                            setPanels(prevPanels => prevPanels.map(panel => {
                              if (dragState.panelIds.includes(panel.id)) {
                                return {
                                  ...panel,
                                  x: dragState.originalPositions[panel.id].x + deltaX,
                                  y: dragState.originalPositions[panel.id].y + deltaY
                                }
                              }
                              return panel
                            }))
                          }
                        }}
                        onMouseUp={() => {
                          setDragState(null)
                          setRotationState(null)
                        }}
                        onMouseLeave={() => {
                          setDragState(null)
                          setRotationState(null)
                        }}
                      >
                        {/* Mask: darken everything outside polygon */}
                        <defs>
                          <mask id="polygonMask">
                            <rect width="100%" height="100%" fill="white"/>
                            <polygon
                              points={roofPolygon.coordinates.map(coord => `${coord[0]},${coord[1]}`).join(' ')}
                              fill="black"
                            />
                          </mask>
                        </defs>
                        
                        {/* Semi-transparent overlay outside polygon */}
                        <rect 
                          width="100%" 
                          height="100%" 
                          fill="rgba(0, 0, 0, 0.6)" 
                          mask="url(#polygonMask)"
                        />
                        
                        {/* Polygon outline */}
                        <polygon
                          points={roofPolygon.coordinates.map(coord => `${coord[0]},${coord[1]}`).join(' ')}
                          fill="rgba(196, 214, 0, 0.1)"
                          stroke="#C4D600"
                          strokeWidth="3"
                        />
                        
                        {/* User-drawn baseline */}
                        {showBaseline && baseline && baseline.p1 && baseline.p2 && (
                          <>
                            <line
                              x1={baseline.p1[0]}
                              y1={baseline.p1[1]}
                              x2={baseline.p2[0]}
                              y2={baseline.p2[1]}
                              stroke="#FF0000"
                              strokeWidth="2"
                              strokeDasharray="8,4"
                            />
                            {/* Start point marker */}
                            <circle
                              cx={baseline.p1[0]}
                              cy={baseline.p1[1]}
                              r="4"
                              fill="#FF0000"
                              stroke="white"
                              strokeWidth="1.5"
                            />
                            {/* End point marker */}
                            <circle
                              cx={baseline.p2[0]}
                              cy={baseline.p2[1]}
                              r="4"
                              fill="#FF0000"
                              stroke="white"
                              strokeWidth="1.5"
                            />
                          </>
                        )}
                        
                        {/* Temporary baseline point while drawing */}
                        {baseline && baseline.p1 && !baseline.p2 && (
                          <circle
                            cx={baseline.p1[0]}
                            cy={baseline.p1[1]}
                            r="4"
                            fill="#FF0000"
                            stroke="white"
                            strokeWidth="1.5"
                          />
                        )}
                        
                        {/* Baseline length measurement - shown with baseline */}
                        {showBaseline && showDistances && baseline && baseline.p1 && baseline.p2 && refinedArea && (() => {
                          const { pixelToCmRatio } = refinedArea
                          const baselineLengthPx = Math.sqrt(
                            Math.pow(baseline.p2[0] - baseline.p1[0], 2) +
                            Math.pow(baseline.p2[1] - baseline.p1[1], 2)
                          )
                          const baselineLengthCm = baselineLengthPx * pixelToCmRatio
                          const midX = (baseline.p1[0] + baseline.p2[0]) / 2
                          const midY = (baseline.p1[1] + baseline.p2[1]) / 2
                          
                          return (
                            <g>
                              <rect
                                x={midX - 40}
                                y={midY + 15}
                                width="80"
                                height="24"
                                fill="white"
                                stroke="#FF0000"
                                strokeWidth="1.5"
                                rx="4"
                              />
                              <text
                                x={midX}
                                y={midY + 32}
                                textAnchor="middle"
                                fill="#FF0000"
                                fontSize="12"
                                fontWeight="600"
                              >
                                {baselineLengthCm.toFixed(0)} cm
                              </text>
                            </g>
                          )
                        })()}
                        
                        {/* Solar panels */}
                        {panels.map(panel => {
                          const centerX = panel.x + panel.width / 2
                          const centerY = panel.y + panel.height / 2
                          const rotation = panel.rotation || 0
                          const iconSize = 10 // Size of rotation icon (reduced)
                          const iconPadding = 3 // Distance from corner
                          
                          return (
                            <g key={panel.id} transform={`rotate(${rotation} ${centerX} ${centerY})`}>
                              {/* Panel rectangle */}
                              <rect
                                x={panel.x}
                                y={panel.y}
                                width={panel.width}
                                height={panel.height}
                                fill={selectedPanels.includes(panel.id) ? 'rgba(100, 180, 255, 0.7)' : 'rgba(135, 206, 235, 0.6)'}
                                stroke={selectedPanels.includes(panel.id) ? '#0066CC' : '#4682B4'}
                                strokeWidth={selectedPanels.includes(panel.id) ? '3' : '1.5'}
                                style={{ cursor: 'move' }}
                              />
                              
                              {/* Rotation icon in top-right corner */}
                              {selectedPanels.includes(panel.id) && (
                                <g>
                                  {/* Icon background circle */}
                                  <circle
                                    cx={panel.x + panel.width - iconPadding - iconSize / 2}
                                    cy={panel.y + iconPadding + iconSize / 2}
                                    r={iconSize / 2}
                                    fill="#FF9800"
                                    stroke="white"
                                    strokeWidth="1.5"
                                    style={{ cursor: 'grab' }}
                                  />
                                  {/* Circular arrow icon */}
                                  <path
                                    d={`M ${panel.x + panel.width - iconPadding - iconSize / 2 - 3} ${panel.y + iconPadding + iconSize / 2} A 3 3 0 1 1 ${panel.x + panel.width - iconPadding - iconSize / 2 + 3} ${panel.y + iconPadding + iconSize / 2}`}
                                    fill="none"
                                    stroke="white"
                                    strokeWidth="1"
                                    strokeLinecap="round"
                                    style={{ cursor: 'grab', pointerEvents: 'none' }}
                                  />
                                  {/* Arrow head */}
                                  <path
                                    d={`M ${panel.x + panel.width - iconPadding - iconSize / 2 + 3} ${panel.y + iconPadding + iconSize / 2} l -1.5 -1.5 m 1.5 1.5 l 1.5 -1.5`}
                                    fill="none"
                                    stroke="white"
                                    strokeWidth="1"
                                    strokeLinecap="round"
                                    style={{ pointerEvents: 'none' }}
                                  />
                                </g>
                              )}
                            </g>
                          )
                        })}
                        
                        {/* Distance measurements */}
                        {showDistances && panels.length > 0 && refinedArea && (() => {
                          const { pixelToCmRatio } = refinedArea
                          const measurements = []
                          
                          // Group panels by row
                          const rowGroups = {}
                          panels.forEach(panel => {
                            if (!rowGroups[panel.row]) rowGroups[panel.row] = []
                            rowGroups[panel.row].push(panel)
                          })
                          
                          const rowNumbers = Object.keys(rowGroups).map(Number).sort((a, b) => a - b)
                          
                          // Show distance between rows
                          for (let i = 0; i < rowNumbers.length - 1; i++) {
                            const currentRow = rowGroups[rowNumbers[i]]
                            const nextRow = rowGroups[rowNumbers[i + 1]]
                            
                            if (currentRow.length > 0 && nextRow.length > 0) {
                              const currentPanel = currentRow[0]
                              const nextPanel = nextRow[0]
                              
                              const currentCenterY = currentPanel.y + currentPanel.height / 2
                              const nextCenterY = nextPanel.y + nextPanel.height / 2
                              const avgX = (currentPanel.x + nextPanel.x) / 2
                              
                              const distancePx = Math.abs(currentCenterY - nextCenterY)
                              const distanceCm = distancePx * pixelToCmRatio
                              
                              measurements.push(
                                <g key={`row-spacing-${i}`} style={{ cursor: 'pointer' }}>
                                  <line
                                    x1={avgX}
                                    y1={currentCenterY}
                                    x2={avgX}
                                    y2={nextCenterY}
                                    stroke="#2196F3"
                                    strokeWidth="2"
                                    markerStart="url(#arrow-start)"
                                    markerEnd="url(#arrow-end)"
                                  />
                                  {/* Label group - shown on hover */}
                                  <g className="distance-label" style={{ opacity: 0, transition: 'opacity 0.2s' }}>
                                    <rect
                                      x={avgX - 35}
                                      y={(currentCenterY + nextCenterY) / 2 - 12}
                                      width="70"
                                      height="24"
                                      fill="white"
                                      stroke="#2196F3"
                                      strokeWidth="1.5"
                                      rx="4"
                                    />
                                    <text
                                      x={avgX}
                                      y={(currentCenterY + nextCenterY) / 2 + 5}
                                      textAnchor="middle"
                                      fill="#2196F3"
                                      fontSize="12"
                                      fontWeight="600"
                                      pointerEvents="none"
                                    >
                                      {distanceCm.toFixed(0)} cm
                                    </text>
                                  </g>
                                  {/* Invisible hover area */}
                                  <rect
                                    x={avgX - 40}
                                    y={Math.min(currentCenterY, nextCenterY)}
                                    width="80"
                                    height={Math.abs(nextCenterY - currentCenterY)}
                                    fill="transparent"
                                    onMouseEnter={(e) => {
                                      const label = e.currentTarget.previousSibling
                                      if (label) label.style.opacity = '1'
                                    }}
                                    onMouseLeave={(e) => {
                                      const label = e.currentTarget.previousSibling
                                      if (label) label.style.opacity = '0'
                                    }}
                                  />
                                </g>
                              )
                            }
                          }
                          
                          return (
                            <>
                              <defs>
                                <marker
                                  id="arrow-start"
                                  markerWidth="10"
                                  markerHeight="10"
                                  refX="5"
                                  refY="5"
                                  orient="auto"
                                >
                                  <polygon points="5,2 5,8 2,5" fill="#2196F3" />
                                </marker>
                                <marker
                                  id="arrow-end"
                                  markerWidth="10"
                                  markerHeight="10"
                                  refX="5"
                                  refY="5"
                                  orient="auto"
                                >
                                  <polygon points="5,2 5,8 8,5" fill="#2196F3" />
                                </marker>
                              </defs>
                              {measurements}
                            </>
                          )
                        })()}
                      </svg>
                    )}
                  </div>
                </div>
              ) : (
                <div className="step-content">
                  <div className="step-placeholder">
                    <h2>No Configuration Data</h2>
                    <p>Please complete Steps 1 and 2 first.</p>
                  </div>
                </div>
              )}

              {/* Left Panel: Statistics */}
              {uploadedImageData && roofPolygon && refinedArea && (
                <div style={{ 
                  position: 'absolute',
                  top: '20px',
                  left: '20px',
                  width: '300px',
                  padding: '1.5rem', 
                  background: 'white',
                  borderRadius: '12px',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                  border: '2px solid #C4D600'
                }}>
                  <h3 style={{ margin: '0 0 1rem 0', color: '#666666', fontSize: '1.1rem' }}>
                    Panel Layout
                  </h3>
                  
                  {!baseline || !baseline.p2 ? (
                    <>
                      <div style={{ 
                        padding: '1rem', 
                        background: '#FFF3E0',
                        borderRadius: '8px',
                        marginBottom: '1rem',
                        border: '2px solid #FF9800'
                      }}>
                        <h4 style={{ margin: '0 0 0.5rem 0', color: '#E65100', fontSize: '0.95rem' }}>
                          📍 Step 1: Draw Baseline
                        </h4>
                        <p style={{ fontSize: '0.85rem', color: '#666', margin: '0 0 0.75rem 0' }}>
                          Click <strong>two points</strong> on the roof to define the baseline for the first row of panels:
                        </p>
                        <ol style={{ margin: '0', paddingLeft: '1.25rem', fontSize: '0.85rem', color: '#666' }}>
                          <li style={{ marginBottom: '0.25rem' }}>Click the <strong>starting point</strong> (usually southwest corner)</li>
                          <li>Click the <strong>ending point</strong> (usually southeast corner)</li>
                        </ol>
                        {baseline && baseline.p1 && !baseline.p2 && (
                          <p style={{ fontSize: '0.85rem', color: '#FF9800', margin: '0.75rem 0 0 0', fontWeight: '600' }}>
                            ✓ First point set. Click the second point.
                          </p>
                        )}
                      </div>
                    </>
                  ) : panels.length === 0 ? (
                    <>
                      <div style={{ 
                        padding: '1rem', 
                        background: '#E8F5E9',
                        borderRadius: '8px',
                        marginBottom: '1rem',
                        border: '2px solid #4CAF50'
                      }}>
                        <p style={{ fontSize: '0.85rem', color: '#1B5E20', margin: '0', fontWeight: '600' }}>
                          ✓ Baseline drawn successfully!
                        </p>
                      </div>
                      <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>
                        Click the button below to automatically generate the panel layout based on your baseline.
                      </p>
                      <button
                        onClick={() => {
                          setBaseline(null)
                          setPanels([])
                        }}
                        style={{
                          width: '100%',
                          padding: '0.5rem',
                          background: 'white',
                          color: '#666',
                          border: '2px solid #ddd',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontWeight: '600',
                          fontSize: '0.85rem',
                          marginBottom: '0.75rem'
                        }}
                      >
                        🔄 Redraw Baseline
                      </button>
                      <button
                        onClick={() => setShowBaseline(!showBaseline)}
                        style={{
                          width: '100%',
                          padding: '0.5rem',
                          background: showBaseline ? '#FF0000' : 'white',
                          color: showBaseline ? 'white' : '#666',
                          border: '2px solid #FF0000',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontWeight: '600',
                          fontSize: '0.85rem',
                          marginBottom: '0.75rem'
                        }}
                      >
                        {showBaseline ? '👁️ Hide Baseline' : '👁️ Show Baseline'}
                      </button>
                      <button
                        onClick={generatePanelLayout}
                        style={{
                          width: '100%',
                          padding: '0.75rem',
                          background: '#C4D600',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontWeight: '600',
                          fontSize: '0.95rem'
                        }}
                      >
                        Generate Panel Layout
                      </button>
                    </>
                  ) : (
                    <>
                      <div style={{ 
                        padding: '1rem', 
                        background: '#f8f9fa',
                        borderRadius: '8px',
                        marginBottom: '1rem'
                      }}>
                        <div style={{ marginBottom: '0.75rem' }}>
                          <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.25rem' }}>Total Panels</div>
                          <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#C4D600' }}>{panels.length}</div>
                        </div>
                        
                        <div style={{ marginBottom: '0.75rem' }}>
                          <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.25rem' }}>System Capacity</div>
                          <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#C4D600' }}>
                            {(panels.length * 0.67).toFixed(2)} kW
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#999' }}>670W per panel</div>
                        </div>
                        
                        <div>
                          <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.25rem' }}>Roof Coverage</div>
                          <div style={{ fontSize: '1.25rem', fontWeight: '700', color: '#666' }}>
                            {(panels.length * 238.2 * 113.4 / 10000).toFixed(1)} m²
                          </div>
                        </div>
                      </div>
                      
                      <button
                        onClick={() => {
                          setBaseline(null)
                          setPanels([])
                          setSelectedPanels([])
                        }}
                        style={{
                          width: '100%',
                          padding: '0.75rem',
                          background: 'white',
                          color: '#666',
                          border: '2px solid #ddd',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontWeight: '600',
                          fontSize: '0.9rem',
                          marginBottom: '0.75rem'
                        }}
                      >
                        🔄 Redraw Baseline & Reset
                      </button>
                      
                      <div style={{ fontSize: '0.8rem', color: '#999', lineHeight: '1.4' }}>
                        <strong>Tips:</strong>
                        <ul style={{ margin: '0.5rem 0 0 0', paddingLeft: '1.25rem' }}>
                          <li>Click to select panels</li>
                          <li>Shift+click for multi-select</li>
                          <li>Drag panels to move</li>
                          <li>Click rotation icon to rotate</li>
                          <li>Use "Add Panel" for extra panels</li>
                        </ul>
                      </div>
                      
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                        <button
                          onClick={generatePanelLayout}
                          style={{
                            flex: 1,
                            padding: '0.65rem',
                            background: '#666',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            fontWeight: '600'
                          }}
                        >
                          🔄 Regenerate
                        </button>
                        <button
                          onClick={addManualPanel}
                          style={{
                            flex: 1,
                            padding: '0.65rem',
                            background: '#C4D600',
                            color: '#333',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            fontWeight: '600'
                          }}
                        >
                          ➕ Add Panel
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Right Panel: Controls */}
              {uploadedImageData && roofPolygon && refinedArea && baseline && baseline.p2 && (
                <div style={{ 
                  position: 'absolute',
                  top: '20px',
                  right: '20px',
                  width: '200px',
                  padding: '1rem', 
                  background: 'white',
                  borderRadius: '12px',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                  border: '2px solid #C4D600'
                }}>
                  <h3 style={{ margin: '0 0 1rem 0', color: '#666666', fontSize: '1rem' }}>
                    Display Controls
                  </h3>
                  
                  {/* Baseline & Distance Toggles */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                    <button
                      onClick={() => setShowBaseline(!showBaseline)}
                      style={{
                        padding: '0.65rem',
                        background: showBaseline ? '#FF0000' : 'white',
                        color: showBaseline ? 'white' : '#666',
                        border: '2px solid #FF0000',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: '600',
                        fontSize: '0.85rem'
                      }}
                    >
                      {showBaseline ? '👁️ Baseline' : '👁️ Baseline'}
                    </button>
                    <button
                      onClick={() => setShowDistances(!showDistances)}
                      style={{
                        padding: '0.65rem',
                        background: showDistances ? '#2196F3' : 'white',
                        color: showDistances ? 'white' : '#666',
                        border: '2px solid #2196F3',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: '600',
                        fontSize: '0.85rem'
                      }}
                    >
                      {showDistances ? '📏 Distances' : '📏 Distances'}
                    </button>
                  </div>
                  
                  {/* Delete Selected Panel */}
                  {selectedPanels.length > 0 && (
                    <div style={{ 
                      padding: '0.75rem', 
                      background: '#ffebee',
                      borderRadius: '8px',
                      border: '1px solid #f44336'
                    }}>
                      <div style={{ fontSize: '0.85rem', color: '#c62828', fontWeight: '600', marginBottom: '0.5rem' }}>
                        {selectedPanels.length} selected
                      </div>
                      <button
                        onClick={() => {
                          setPanels(panels.filter(p => !selectedPanels.includes(p.id)))
                          setSelectedPanels([])
                        }}
                        style={{
                          width: '100%',
                          padding: '0.5rem',
                          background: '#f44336',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '0.85rem',
                          fontWeight: '600'
                        }}
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
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
