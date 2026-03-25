import { useState, useEffect } from 'react'
import { SAM2Service } from '../services/sam2Service'
import { generatePanelLayout, createManualPanel } from '../utils/panelUtils'
import { computePanelBackHeight } from '../utils/trapezoidGeometry'
import { createProject, updateProject } from '../services/projectsApi'
import { computePolygonPanels } from '../utils/rectPanelService'
import { PANEL_TYPES, DEFAULT_PANEL_TYPE } from '../data/panelTypes'

export function useProjectState() {
  // App-level screen
  const [appScreen, setAppScreen] = useState('welcome') // 'welcome' | 'wizard'
  const [currentProject, setCurrentProject] = useState(null)

  // Wizard state
  const [currentStep, setCurrentStep] = useState(1)

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
  const [referenceLine, setReferenceLine] = useState(null)
  const [referenceLineLengthCm, setReferenceLineLengthCm] = useState('')
  const [panelFrontHeight, setPanelFrontHeight] = useState('')
  const [linesPerRow, setLinesPerRow] = useState(1)
  const [lineOrientations, setLineOrientations] = useState(['vertical'])
  const [panelAngle, setPanelAngle] = useState('')
  const [isDrawingLine, setIsDrawingLine] = useState(false)
  const [lineStart, setLineStart] = useState(null)

  // Step 3: Solar panel placement
  const [baseline, setBaseline] = useState(null)
  const [showBaseline, setShowBaseline] = useState(true)
  const [showDistances, setShowDistances] = useState(true)
  const [distanceMeasurement, setDistanceMeasurement] = useState(null)
  const [panels, setPanels] = useState([])
  const [areas, setAreas] = useState([])
  const [rectAreas, setRectAreas] = useState([])
  const [selectedPanels, setSelectedPanels] = useState([])
  const [dragState, setDragState] = useState(null)
  const [rotationState, setRotationState] = useState(null)
  const [viewZoom, setViewZoom] = useState(1)
  const [trapezoidConfigs, setTrapezoidConfigs] = useState({})

  // Step 4: Construction planning settings (persisted for export)
  const [step4GlobalSettings, setStep4GlobalSettings] = useState(null)
  const [step4AreaSettings,   setStep4AreaSettings]   = useState(null)
  const [step4BOMData,        setStep4BOMData]        = useState({ rowConstructions: [], rowLabels: [] })

  // Step 5: BOM user overrides (deltas on top of auto-generated BOM)
  const [step5BomDeltas, setStep5BomDeltas] = useState(null)

  // Cloud project ID — set after first cloud save, used for subsequent saves
  const [cloudProjectId, setCloudProjectId] = useState(null)


  const getComputedBackHeight = () =>
    computePanelBackHeight(parseFloat(panelFrontHeight) || 0, parseFloat(panelAngle) || 0, lineOrientations, linesPerRow)

  // ── Backend ───────────────────────────────────────────────────────────────

  useEffect(() => { checkBackend() }, [])

  const checkBackend = async () => {
    const status = await SAM2Service.checkHealth()
    setBackendStatus(status)
  }

  // ── Wizard lifecycle ──────────────────────────────────────────────────────

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
    setAreas([])
    setRectAreas([])
    setSelectedPanels([])
    setDragState(null)
    setRotationState(null)
    setTrapezoidConfigs({})
    setStep4GlobalSettings(null)
    setStep4AreaSettings(null)
    setStep5BomDeltas(null)
    setCloudProjectId(null)
  }

  const handleStartOver = () => {
    if (confirm('Return to the welcome screen? All unsaved progress will be lost.')) {
      resetWizardState()
      setCurrentProject(null)
      setAppScreen('welcome')
    }
  }

  const generateWhiteCanvas = () => {
    const W = 3000, H = 2000
    const canvas = document.createElement('canvas')
    canvas.width = W; canvas.height = H
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, W, H)
    return { imageData: canvas.toDataURL('image/png'), width: W, height: H, rotation: 0, scale: 1, isWhiteboard: true }
  }

  const handleCreateProject = (projectInfo) => {
    setCurrentProject(projectInfo)
    const data = generateWhiteCanvas()
    setUploadedImageData(data)
    setUploadedImageMode(true)
    setRoofPolygon({ coordinates: [[0, 0], [data.width, 0], [data.width, data.height], [0, data.height]], area: data.width * data.height, confidence: 1 })
    setAppScreen('wizard')
  }

  const handleWhiteboardStart = () => {
    const data = generateWhiteCanvas()
    setUploadedImageData(data)
    setUploadedImageMode(true)
    setRoofPolygon({ coordinates: [[0, 0], [data.width, 0], [data.width, data.height], [0, data.height]], area: data.width * data.height, confidence: 1 })
  }

  const handleImportProject = (data, existingCloudId = null) => {
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
    if (data.panels) {
      setPanels(data.panels.map(p => {
        const area = p.area ?? p.row ?? 0
        const trapezoidId = p.trapezoidId ?? 'A1'
        return { ...p, area, trapezoidId }
      }))
    }
    if (data.areas) setAreas(data.areas)
    else if (data.rowGroups) setAreas(data.rowGroups)
    if (data.rectAreas) setRectAreas(data.rectAreas)
    if (data.trapezoidConfigs) {
      setTrapezoidConfigs(data.trapezoidConfigs)
    } else if (data.rowConfigs) {
      const first = Object.values(data.rowConfigs)[0]
      if (first) setTrapezoidConfigs({ 'A1': first })
    }
    if (data.step4GlobalSettings) setStep4GlobalSettings(data.step4GlobalSettings)
    if (data.step4AreaSettings)   setStep4AreaSettings(data.step4AreaSettings)
    else if (data.step4RowSettings) setStep4AreaSettings(data.step4RowSettings)
    if (data.step4BOMData)   setStep4BOMData(data.step4BOMData)
    if (data.step5BomDeltas) setStep5BomDeltas(data.step5BomDeltas)
    if (data.currentStep) setCurrentStep(data.currentStep)
    if (existingCloudId) setCloudProjectId(existingCloudId)
    setAppScreen('wizard')
  }

  const getExportData = () => ({
    version: '1.0',
    project: currentProject,
    currentStep,
    uploadedImageData: uploadedImageData ? { ...uploadedImageData, file: undefined } : null,
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
    areas,
    rectAreas,
    trapezoidConfigs,
    step4GlobalSettings,
    step4AreaSettings,
    step4BOMData,
    step5BomDeltas,
  })

  const handleExportProject = () => {
    const data = getExportData()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const safeName = (currentProject?.name || 'project').replace(/[^\p{L}\p{N}]/gu, '_')
    const dateStr = new Date().toISOString().split('T')[0]
    a.href = url
    a.download = `${safeName}_${dateStr}.mgp`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleSaveProject = async () => {
    const data = getExportData()
    const name = currentProject?.name || 'Untitled'
    const location = currentProject?.location || null
    if (cloudProjectId) {
      await updateProject(cloudProjectId, { name, location, data })
    } else {
      const saved = await createProject(name, location, data)
      setCloudProjectId(saved.id)
    }
  }

  // ── Panel layout handlers ─────────────────────────────────────────────────

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
    setPanels(generatedPanels.map(p => ({ ...p, area: p.row, trapezoidId: 'A1' })))
  }

  const regenerateSingleRowHandler = (areaKey) => {
    if (!refinedArea || !refinedArea.pixelToCmRatio) return
    if (!baseline) return
    const allGenerated = generatePanelLayout(refinedArea, baseline)
    setPanels(prev => {
      const existingAreaPanels = prev.filter(p => (p.area ?? p.row) === areaKey)
      if (existingAreaPanels.length === 0) return prev
      const cx = existingAreaPanels.reduce((s, p) => s + p.x + p.width / 2, 0) / existingAreaPanels.length
      const cy = existingAreaPanels.reduce((s, p) => s + p.y + p.height / 2, 0) / existingAreaPanels.length
      let minDist = Infinity, matchRow = null
      allGenerated.forEach(p => {
        const d = Math.hypot((p.x + p.width / 2) - cx, (p.y + p.height / 2) - cy)
        if (d < minDist) { minDist = d; matchRow = p.row }
      })
      const xs = existingAreaPanels.map(p => p.x + p.width / 2)
      const ys = existingAreaPanels.map(p => p.y + p.height / 2)
      const radius = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + existingAreaPanels[0].width * 3
      const areaPanels = allGenerated.filter(p => p.row === matchRow &&
        Math.hypot((p.x + p.width / 2) - cx, (p.y + p.height / 2) - cy) <= radius)
      const maxId = prev.reduce((m, p) => Math.max(m, p.id), 0)
      let nextId = maxId + 1
      const trapId = existingAreaPanels[0]?.trapezoidId || 'A1'
      const newAreaPanels = areaPanels.map(p => ({ ...p, id: nextId++, area: areaKey, trapezoidId: trapId }))
      return [...prev.filter(p => (p.area ?? p.row) !== areaKey), ...newAreaPanels]
    })
    setSelectedPanels([])
  }

  const addManualPanel = () => {
    const newPanel = createManualPanel(refinedArea, baseline, panels, roofPolygon)
    if (!newPanel) return false
    const newAreaIdx  = areas.length
    const trapezoidId = `${String.fromCharCode(65 + newAreaIdx)}1`
    const newArea = { angle: 0, frontHeight: 0, linesPerRow: 1, lineOrientations: ['vertical'] }
    setAreas([...areas, newArea])
    setPanels([...panels, { ...newPanel, area: newAreaIdx, trapezoidId }])
    setSelectedPanels([newPanel.id])
    return true
  }

  // ── Map / image click handlers ────────────────────────────────────────────

  const handlePointSelect = async (point, mapInstance, bounds) => {
    console.log('Point selected:', point, 'bounds:', bounds)
    setSelectedPoint(point)
    setIsProcessing(true)
    try {
      if (backendStatus.status !== 'running' || !backendStatus.model_loaded) {
        alert('Backend is not ready. Please make sure the Python backend is running.')
        setIsProcessing(false)
        return
      }
      const zoom = mapInstance.getZoom()
      const mapContainer = mapInstance.getContainer()
      const mapSize = mapInstance.getSize()
      console.log('Map viewport dimensions:', { width: mapSize.x, height: mapSize.y, containerWidth: mapContainer.offsetWidth, containerHeight: mapContainer.offsetHeight })
      console.log('Sending to backend:', { lat: point.lat, lng: point.lng, zoom, bounds })
      const result = await SAM2Service.segmentRoofFromMap(point.lat, point.lng, zoom, bounds)
      console.log('SAM2 result:', result)
      if (result && result.geometry) {
        if (result.properties.actual_bounds) {
          console.log('\n🗺️ BOUNDS COMPARISON:')
          console.log('  Requested bounds (map viewport):', bounds)
          console.log('  Actual bounds (backend tiles):', result.properties.actual_bounds)
          console.log('  ⚠️ If these differ significantly, polygon will be misaligned!')
        }
        const coordinates = result.geometry.coordinates[0].map(coord => [coord[1], coord[0]])
        setRoofPolygon({ coordinates, area: result.properties.area_pixels, confidence: result.properties.confidence, actualBounds: result.properties.actual_bounds })
        if (result.properties.actual_bounds && mapInstance) {
          const ab = result.properties.actual_bounds
          mapInstance.fitBounds([[ab.south, ab.west], [ab.north, ab.east]], { padding: [50, 50] })
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

  const dataURLtoBlob = (dataURL) => {
    const arr = dataURL.split(',')
    const mime = arr[0].match(/:(.*?);/)[1]
    const bstr = atob(arr[1])
    let n = bstr.length
    const u8arr = new Uint8Array(n)
    while (n--) u8arr[n] = bstr.charCodeAt(n)
    return new Blob([u8arr], { type: mime })
  }

  const handleImageClick = async (event) => {
    if (!uploadedImageData) return
    const img = event.target
    const rect = img.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
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
    setSelectedPoint({ x: pixelX, y: pixelY })
    setIsProcessing(true)
    try {
      if (backendStatus.status !== 'running' || !backendStatus.model_loaded) {
        alert('Backend is not ready. Please make sure the Python backend is running.')
        setIsProcessing(false)
        return
      }
      const imageBlob = dataURLtoBlob(uploadedImageData.imageData)
      const result = await SAM2Service.segmentRoofPixel(imageBlob, pixelX, pixelY)
      console.log('SAM2 result:', result)
      if (result && result.geometry) {
        setRoofPolygon({ coordinates: result.geometry.coordinates[0], area: result.properties.area_pixels, confidence: result.properties.confidence })
      }
    } catch (error) {
      console.error('Error processing roof:', error)
      alert('Failed to process roof. Check console for details.')
    } finally {
      setIsProcessing(false)
    }
  }

  // ── Wizard navigation ─────────────────────────────────────────────────────

  // Compute panels from rectAreas without advancing the step (used by panel-edit tab in Step 2).
  const computePanels = () => {
    if (!referenceLine || !referenceLineLengthCm) return
    const dx = referenceLine.end.x - referenceLine.start.x
    const dy = referenceLine.end.y - referenceLine.start.y
    const pixelLength = Math.sqrt(dx * dx + dy * dy)
    if (pixelLength <= 0) return
    const pixelToCmRatio = parseFloat(referenceLineLengthCm) / pixelLength

    // SAT OBB-OBB overlap test — returns true if the two panels physically intersect
    const obbsOverlap = (a, b) => {
      const corners = (p) => {
        const r = (p.rotation || 0) * Math.PI / 180
        const c = Math.cos(r), s = Math.sin(r)
        const hw = p.width / 2, hh = p.height / 2
        return [
          { x: p.cx + hw*c - hh*s, y: p.cy + hw*s + hh*c },
          { x: p.cx - hw*c - hh*s, y: p.cy - hw*s + hh*c },
          { x: p.cx - hw*c + hh*s, y: p.cy - hw*s - hh*c },
          { x: p.cx + hw*c + hh*s, y: p.cy + hw*s - hh*c },
        ]
      }
      const ac = corners(a), bc = corners(b)
      const axes = [a, b].flatMap(p => {
        const r = (p.rotation || 0) * Math.PI / 180
        return [{ x: Math.cos(r), y: Math.sin(r) }, { x: -Math.sin(r), y: Math.cos(r) }]
      })
      for (const ax of axes) {
        const proj = pts => pts.map(p => p.x * ax.x + p.y * ax.y)
        const ap = proj(ac), bp = proj(bc)
        if (Math.max(...ap) <= Math.min(...bp) || Math.max(...bp) <= Math.min(...ap)) return false
      }
      return true
    }

    // Areas that already had panels before this compute are "existing" — never auto-deleted
    const existingAreaIndices = new Set(panels.map(p => p.area))

    const allPanels = []
    const groupTrapConfigs = {}
    const areaLineConfigs = {}
    let panelId = 1
    const panelSpec = PANEL_TYPES.find(t => t.id === panelType) ?? DEFAULT_PANEL_TYPE
    rectAreas.forEach((area, areaIdx) => {
      const trapezoidId = `${area.label}1`
      const aFront = parseFloat(area.frontHeight) || parseFloat(panelFrontHeight) || 0
      const aAngle = parseFloat(area.angle) || parseFloat(panelAngle) || 0
      const computed = computePolygonPanels(area, pixelToCmRatio, panelSpec)
      let filtered = computed.filter(p => !allPanels.some(ep => obbsOverlap(p, ep)))
      // Existing areas always keep at least 1 panel so the area stays visible
      if (filtered.length === 0 && existingAreaIndices.has(areaIdx) && computed.length > 0) {
        filtered = [computed[0]]
      }
      // Derive line orientations from actual generated panels
      const lineRows = [...new Set(filtered.map(p => p.row))].sort((a, b) => a - b)
      const derivedLPR = Math.max(1, lineRows.length)
      const derivedOrients = lineRows.map(r => {
        const sample = filtered.find(p => p.row === r)
        return (sample?.heightCm ?? 238.2) > 150 ? 'vertical' : 'horizontal'
      })
      const aBack = computePanelBackHeight(aFront, aAngle, derivedOrients, derivedLPR)
      groupTrapConfigs[trapezoidId] = { angle: aAngle, frontHeight: aFront, backHeight: aBack, linesPerRow: derivedLPR, lineOrientations: derivedOrients }
      areaLineConfigs[areaIdx] = { linesPerRow: derivedLPR, lineOrientations: derivedOrients }
      filtered.forEach(p => {
        allPanels.push({ ...p, id: panelId++, area: areaIdx, trapezoidId, yDir: area.yDir ?? 'ttb' })
      })
    })

    // Auto-delete only NEW areas (not previously having panels) that got zero panels
    const areaIndicesWithPanels = new Set(allPanels.map(p => p.area))
    const emptyNewIndices = rectAreas
      .map((_, i) => i)
      .filter(i => !areaIndicesWithPanels.has(i) && !existingAreaIndices.has(i))
    if (emptyNewIndices.length > 0) {
      setRectAreas(prev => prev.filter((_, i) => !emptyNewIndices.includes(i)))
      return // re-triggered by rectAreas change; don't commit partial state
    }

    setPanels(allPanels)
    setAreas(rectAreas.map((a, idx) => ({
      label: a.label,
      angle: parseFloat(a.angle) || 0,
      frontHeight: parseFloat(a.frontHeight) || 0,
      linesPerRow: areaLineConfigs[idx]?.linesPerRow ?? 1,
      lineOrientations: areaLineConfigs[idx]?.lineOrientations ?? ['vertical'],
    })))
    setTrapezoidConfigs(prev => {
      const next = {}
      Object.keys(groupTrapConfigs).forEach(id => { next[id] = { ...(prev[id] || {}), ...groupTrapConfigs[id] } })
      return next
    })
    setRefinedArea({
      polygon: roofPolygon, panelType, referenceLine,
      referenceLineLengthCm: parseFloat(referenceLineLengthCm),
      pixelToCmRatio,
      panelConfig: { frontHeight: 0, backHeight: 0, angle: 0, linesPerRow: 1, lineOrientations: ['vertical'] },
    })
  }

  // Auto-compute panels whenever rectAreas or global mounting defaults change
  useEffect(() => {
    computePanels()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rectAreas, panelAngle, panelFrontHeight])

  const handleNext = (totalSteps) => {
    if (currentStep >= totalSteps) return

    if (currentStep === 2) {
      const pixelLength = Math.sqrt(
        Math.pow(referenceLine.end.x - referenceLine.start.x, 2) +
        Math.pow(referenceLine.end.y - referenceLine.start.y, 2)
      )
      const pixelToCmRatio = parseFloat(referenceLineLengthCm) / pixelLength
      // Panels are already computed by the auto-effect; just update refinedArea with the calibrated ratio.
      setRefinedArea({
        polygon: roofPolygon, panelType, referenceLine,
        referenceLineLengthCm: parseFloat(referenceLineLengthCm),
        pixelToCmRatio,
        panelConfig: { frontHeight: parseFloat(panelFrontHeight) || 0, backHeight: 0, angle: parseFloat(panelAngle) || 0, linesPerRow: 1, lineOrientations: ['vertical'] },
      })
    }

    const nextStep = currentStep === 2 ? 4 : currentStep + 1
    setCurrentStep(nextStep)
  }

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep === 4 ? 2 : currentStep - 1)
    }
  }

  const canProceedToNextStep = () => {
    switch (currentStep) {
      case 1: return (
        roofPolygon !== null &&
        referenceLine !== null &&
        referenceLineLengthCm !== '' &&
        parseFloat(referenceLineLengthCm) > 0
      )
      case 2: {
        const defaultFH = panelFrontHeight ?? ''
        const defaultAng = panelAngle ?? ''
        return (
          rectAreas.length > 0 &&
          rectAreas.every(a => {
            const fh = a.frontHeight !== '' ? a.frontHeight : defaultFH
            const ang = a.angle !== '' ? a.angle : defaultAng
            return fh !== '' && parseFloat(fh) >= 0 &&
              ang !== '' && parseFloat(ang) >= 0 && parseFloat(ang) <= 30
          })
        )
      }
      case 3: return panels.length > 0
      case 4: return true
      case 5: return true
      default: return false
    }
  }

  return {
    // Screen
    appScreen, setAppScreen,
    currentProject, setCurrentProject,
    currentStep, setCurrentStep,
    // Step 1
    selectedPoint, setSelectedPoint,
    roofPolygon, setRoofPolygon,
    backendStatus,
    isProcessing,
    uploadedImageMode, setUploadedImageMode,
    uploadedImageData, setUploadedImageData,
    imageRef, setImageRef,
    // Step 2
    refinedArea,
    panelType, setPanelType,
    referenceLine, setReferenceLine,
    referenceLineLengthCm, setReferenceLineLengthCm,
    panelFrontHeight, setPanelFrontHeight,
    linesPerRow, setLinesPerRow,
    lineOrientations, setLineOrientations,
    panelAngle, setPanelAngle,
    isDrawingLine, setIsDrawingLine,
    lineStart, setLineStart,
    // Step 3
    baseline, setBaseline,
    showBaseline, setShowBaseline,
    showDistances, setShowDistances,
    distanceMeasurement, setDistanceMeasurement,
    panels, setPanels,
    areas, setAreas,
    rectAreas, setRectAreas,
    selectedPanels, setSelectedPanels,
    dragState, setDragState,
    rotationState, setRotationState,
    viewZoom, setViewZoom,
    trapezoidConfigs, setTrapezoidConfigs,
    // Step 4
    step4GlobalSettings, setStep4GlobalSettings,
    step4AreaSettings, setStep4AreaSettings,
    step4BOMData, setStep4BOMData,
    // Step 5
    step5BomDeltas, setStep5BomDeltas,
    // Derived
    getComputedBackHeight,
    // Cloud
    cloudProjectId, setCloudProjectId,
    handleSaveProject,
    // Handlers
    handleStartOver,
    handleCreateProject,
    handleImportProject,
    handleExportProject,
    generatePanelLayoutHandler,
    regenerateSingleRowHandler,
    addManualPanel,
    handlePointSelect,
    handleImageUploaded,
    handleWhiteboardStart,
    handleImageClick,
    computePanels,
    handleNext,
    handleBack,
    canProceedToNextStep,
  }
}
