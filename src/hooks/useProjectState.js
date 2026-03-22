import { useState, useEffect, useRef } from 'react'
import { SAM2Service } from '../services/sam2Service'
import { generatePanelLayout, createManualPanel } from '../utils/panelUtils'
import { computePanelBackHeight } from '../utils/trapezoidGeometry'

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
  const [selectedPanels, setSelectedPanels] = useState([])
  const [dragState, setDragState] = useState(null)
  const [rotationState, setRotationState] = useState(null)
  const [viewZoom, setViewZoom] = useState(1)
  const [trapezoidConfigs, setTrapezoidConfigs] = useState({})

  // Step 4: Construction planning settings (persisted for export)
  const [step4GlobalSettings, setStep4GlobalSettings] = useState(null)
  const [step4AreaSettings,   setStep4AreaSettings]   = useState(null)

  // Step 5: BOM user overrides (deltas on top of auto-generated BOM)
  const [step5BomDeltas, setStep5BomDeltas] = useState(null)

  // Fingerprint of the areas config used to last generate panels.
  // Only regenerate in plan mode when this changes (prevents wiping subgroups on back→forward).
  const panelGenFingerprint = useRef(null)

  const projectMode = currentProject?.mode || 'scratch'

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
    setSelectedPanels([])
    setDragState(null)
    setRotationState(null)
    setTrapezoidConfigs({})
    setStep4GlobalSettings(null)
    setStep4AreaSettings(null)
    setStep5BomDeltas(null)
    panelGenFingerprint.current = null
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
    if (data.panels) {
      const mode = data.project?.mode || 'scratch'
      const areaLetter = (idx) => data.areas?.[idx]?.label || String.fromCharCode(65 + (idx || 0))
      setPanels(data.panels.map(p => {
        const area = p.area ?? p.row ?? 0
        const trapezoidId = p.trapezoidId ?? (mode === 'plan' ? `${areaLetter(area)}1` : 'A1')
        return { ...p, area, trapezoidId }
      }))
    }
    if (data.areas) setAreas(data.areas)
    else if (data.rowGroups) setAreas(data.rowGroups)
    if (data.trapezoidConfigs) {
      setTrapezoidConfigs(data.trapezoidConfigs)
    } else if (data.rowConfigs) {
      const mode = data.project?.mode || 'scratch'
      const migrated = {}
      if (mode === 'plan') {
        Object.entries(data.rowConfigs).forEach(([key, value]) => {
          const idx = parseInt(key)
          if (!isNaN(idx)) migrated[`${String.fromCharCode(65 + idx)}1`] = value
        })
      } else {
        const first = Object.values(data.rowConfigs)[0]
        if (first) migrated['A1'] = first
      }
      setTrapezoidConfigs(migrated)
    }
    if (data.step4GlobalSettings) setStep4GlobalSettings(data.step4GlobalSettings)
    if (data.step4AreaSettings)   setStep4AreaSettings(data.step4AreaSettings)
    else if (data.step4RowSettings) setStep4AreaSettings(data.step4RowSettings)
    if (data.step5BomDeltas) setStep5BomDeltas(data.step5BomDeltas)
    if (data.currentStep) setCurrentStep(data.currentStep)
    // Treat imported panels as already generated so back→forward doesn't wipe them.
    if (data.panels && data.areas) {
      const importedAreas = data.areas ?? data.rowGroups ?? []
      panelGenFingerprint.current = JSON.stringify(importedAreas.map(g => ({
        angle: g.angle, frontHeight: g.frontHeight, linesPerRow: g.linesPerRow,
        lineOrientations: g.lineOrientations, baseline: g.baseline,
      })))
    }
    setAppScreen('wizard')
  }

  const handleExportProject = () => {
    const data = {
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
      trapezoidConfigs,
      step4GlobalSettings,
      step4AreaSettings,
      step5BomDeltas,
    }
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

  const regeneratePlanPanelsHandler = () => {
    if (!refinedArea || !refinedArea.pixelToCmRatio || areas.length === 0) {
      alert('Missing configuration from Step 2')
      return
    }
    let nextId = 1
    const allPanels = []
    areas.forEach((group, groupIdx) => {
      if (!group.baseline) return
      const angle = parseFloat(group.angle) || 0
      const frontH = parseFloat(group.frontHeight) || 0
      const n = group.linesPerRow || 1
      const orients = (group.lineOrientations || ['vertical']).slice(0, n)
      const backH = computePanelBackHeight(frontH, angle, orients, n)
      const trapezoidId = `${String.fromCharCode(65 + groupIdx)}1`
      const generated = generatePanelLayout(
        { polygon: roofPolygon, pixelToCmRatio: refinedArea.pixelToCmRatio, panelConfig: { frontHeight: frontH, backHeight: backH, angle, linesPerRow: n, lineOrientations: orients } },
        group.baseline,
        true
      )
      generated.forEach(p => allPanels.push({ ...p, id: nextId++, area: groupIdx, trapezoidId }))
    })
    setPanels(allPanels)
  }

  const regenerateSingleRowHandler = (areaKey) => {
    if (!refinedArea || !refinedArea.pixelToCmRatio) return

    if (projectMode === 'plan') {
      const groupIdx = areaKey
      const group = areas[groupIdx]
      if (!group || !group.baseline) return
      const angle = parseFloat(group.angle) || 0
      const frontH = parseFloat(group.frontHeight) || 0
      const n = group.linesPerRow || 1
      const orients = (group.lineOrientations || ['vertical']).slice(0, n)
      const backH = computePanelBackHeight(frontH, angle, orients, n)
      const trapezoidId = `${String.fromCharCode(65 + groupIdx)}1`
      const generated = generatePanelLayout(
        { polygon: roofPolygon, pixelToCmRatio: refinedArea.pixelToCmRatio, panelConfig: { frontHeight: frontH, backHeight: backH, angle, linesPerRow: n, lineOrientations: orients } },
        group.baseline,
        true
      )
      setPanels(prev => {
        const maxId = prev.reduce((m, p) => Math.max(m, p.id), 0)
        let nextId = maxId + 1
        const newAreaPanels = generated.map(p => ({ ...p, id: nextId++, area: groupIdx, trapezoidId }))
        return [...prev.filter(p => (p.area ?? p.row) !== areaKey), ...newAreaPanels]
      })
      setSelectedPanels([])
    } else {
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
  }

  const addManualPanel = () => {
    const newPanel = createManualPanel(refinedArea, baseline, panels)
    if (!newPanel) return
    setPanels([...panels, newPanel])
    setSelectedPanels([newPanel.id])
    console.log('Manual panel added below baseline:', newPanel)
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

  const handleNext = (totalSteps) => {
    if (currentStep >= totalSteps) return

    if (currentStep === 2) {
      const pixelLength = Math.sqrt(
        Math.pow(referenceLine.end.x - referenceLine.start.x, 2) +
        Math.pow(referenceLine.end.y - referenceLine.start.y, 2)
      )
      const pixelToCmRatio = parseFloat(referenceLineLengthCm) / pixelLength

      if (projectMode === 'plan') {
        // Compute a fingerprint of the generation inputs. Only regenerate if something changed
        // since the last generation — this prevents wiping user-created subgroups (B1/B2) when
        // the user navigates back to Step 2 and forward again without changing anything.
        const currentFingerprint = JSON.stringify(areas.map(g => ({
          angle: g.angle, frontHeight: g.frontHeight, linesPerRow: g.linesPerRow,
          lineOrientations: g.lineOrientations, baseline: g.baseline,
        })))
        const needsRegen = panelGenFingerprint.current !== currentFingerprint

        let nextId = 1
        const allPanels = []
        const groupTrapConfigs = {}
        areas.forEach((group, groupIdx) => {
          const angle = parseFloat(group.angle) || 0
          const frontH = parseFloat(group.frontHeight) || 0
          const n = group.linesPerRow || 1
          const orients = (group.lineOrientations || ['vertical']).slice(0, n)
          const backH = computePanelBackHeight(frontH, angle, orients, n)
          const trapezoidId = `${group.label || String.fromCharCode(65 + groupIdx)}1`
          groupTrapConfigs[trapezoidId] = { angle, frontHeight: frontH, backHeight: backH, linesPerRow: n, lineOrientations: orients }
          if (!group.baseline) return
          const generated = generatePanelLayout(
            { polygon: roofPolygon, pixelToCmRatio, panelConfig: { frontHeight: frontH, backHeight: backH, angle, linesPerRow: n, lineOrientations: orients } },
            group.baseline,
            true
          )
          generated.forEach(p => allPanels.push({ ...p, id: nextId++, area: groupIdx, trapezoidId }))
        })
        setRefinedArea({
          polygon: roofPolygon, panelType, referenceLine,
          referenceLineLengthCm: parseFloat(referenceLineLengthCm),
          pixelToCmRatio,
          panelConfig: { frontHeight: 0, backHeight: 0, angle: 0, linesPerRow: 1, lineOrientations: ['vertical'] }
        })
        if (needsRegen) {
          setPanels(allPanels)
          panelGenFingerprint.current = currentFingerprint
        }
        setTrapezoidConfigs(prev => {
          const next = {}
          Object.keys(groupTrapConfigs).forEach(trapId => {
            next[trapId] = { ...(prev[trapId] || {}), ...groupTrapConfigs[trapId] }
          })
          return next
        })
      } else {
        setRefinedArea({
          polygon: roofPolygon, panelType, referenceLine,
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

    if (currentStep === 3) {
      setTrapezoidConfigs(prev => {
        const usedIds = new Set(panels.map(p => p.trapezoidId).filter(Boolean))
        const next = {}
        for (const [id, cfg] of Object.entries(prev)) {
          if (usedIds.has(id)) next[id] = cfg
        }
        return next
      })
    }

    const nextStep = currentStep + 1
    console.log(`\n${'─'.repeat(40)}\n  STEP ${nextStep}\n${'─'.repeat(40)}`)
    if (nextStep === 3) {
      const baselines = projectMode === 'plan'
        ? areas.filter(g => g.baseline).length
        : baseline ? 1 : 0
      console.log(`  Mode: ${projectMode} | Baselines: ${baselines}`)
      if (projectMode === 'plan') {
        areas.forEach((g, i) => console.log(`  Baseline ${i + 1}:`, g.baseline ? `p1=${JSON.stringify(g.baseline.p1)} p2=${JSON.stringify(g.baseline.p2)}` : 'none'))
      } else {
        console.log(`  Baseline:`, baseline ? `p1=${JSON.stringify(baseline.p1)} p2=${JSON.stringify(baseline.p2)}` : 'none')
      }
    }
    setCurrentStep(nextStep)
  }

  const handleBack = () => {
    if (currentStep > 1) {
      console.log(`\n${'─'.repeat(40)}\n  STEP ${currentStep - 1}\n${'─'.repeat(40)}`)
      setCurrentStep(prev => prev - 1)
    }
  }

  const canProceedToNextStep = () => {
    switch (currentStep) {
      case 1: return roofPolygon !== null
      case 2:
        if (projectMode === 'plan') {
          return (
            referenceLine !== null &&
            referenceLineLengthCm !== '' &&
            parseFloat(referenceLineLengthCm) > 0 &&
            areas.length > 0 &&
            areas.every(g =>
              g.baseline !== null &&
              g.frontHeight !== '' && parseFloat(g.frontHeight) >= 0 &&
              g.angle !== '' && parseFloat(g.angle) >= 0 && parseFloat(g.angle) <= 30
            )
          )
        }
        return (
          referenceLine !== null &&
          referenceLineLengthCm !== '' &&
          parseFloat(referenceLineLengthCm) > 0 &&
          panelFrontHeight !== '' && parseFloat(panelFrontHeight) >= 0 &&
          panelAngle !== '' && parseFloat(panelAngle) >= 0 && parseFloat(panelAngle) <= 30
        )
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
    selectedPanels, setSelectedPanels,
    dragState, setDragState,
    rotationState, setRotationState,
    viewZoom, setViewZoom,
    trapezoidConfigs, setTrapezoidConfigs,
    // Step 4
    step4GlobalSettings, setStep4GlobalSettings,
    step4AreaSettings, setStep4AreaSettings,
    // Step 5
    step5BomDeltas, setStep5BomDeltas,
    // Derived
    projectMode,
    getComputedBackHeight,
    // Handlers
    handleStartOver,
    handleCreateProject,
    handleImportProject,
    handleExportProject,
    generatePanelLayoutHandler,
    regeneratePlanPanelsHandler,
    regenerateSingleRowHandler,
    addManualPanel,
    handlePointSelect,
    handleImageUploaded,
    handleImageClick,
    handleNext,
    handleBack,
    canProceedToNextStep,
  }
}
