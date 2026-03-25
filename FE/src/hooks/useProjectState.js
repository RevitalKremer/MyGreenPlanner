import { useState, useEffect, useRef } from 'react'
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
    setRectAreas([])
    setSelectedPanels([])
    setDragState(null)
    setRotationState(null)
    setTrapezoidConfigs({})
    setStep4GlobalSettings(null)
    setStep4AreaSettings(null)
    setStep5BomDeltas(null)
    setCloudProjectId(null)
    panelGenFingerprint.current = null
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
    return { imageData: canvas.toDataURL('image/png'), width: W, height: H, rotation: 0, scale: 1, isScratch: true }
  }

  const handleCreateProject = (projectInfo) => {
    setCurrentProject(projectInfo)
    if (projectInfo.mode === 'scratch') {
      const data = generateWhiteCanvas()
      setUploadedImageData(data)
      setUploadedImageMode(true)
      setRoofPolygon({ coordinates: [[0, 0], [data.width, 0], [data.width, data.height], [0, data.height]], area: data.width * data.height, confidence: 1 })
    }
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
    if (data.rectAreas) setRectAreas(data.rectAreas)
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
    if (data.step4BOMData)   setStep4BOMData(data.step4BOMData)
    if (data.step5BomDeltas) setStep5BomDeltas(data.step5BomDeltas)
    if (data.currentStep) setCurrentStep(data.currentStep)
    if (existingCloudId) setCloudProjectId(existingCloudId)
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
  const computeScratchPanels = () => {
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
    let panelId = 1
    const panelSpec = PANEL_TYPES.find(t => t.id === panelType) ?? DEFAULT_PANEL_TYPE
    rectAreas.forEach((area, areaIdx) => {
      const trapezoidId = `${area.label}1`
      const aFront = parseFloat(area.frontHeight) || 0
      const aAngle = parseFloat(area.angle) || 0
      const aBack = computePanelBackHeight(aFront, aAngle, ['vertical'], 1)
      groupTrapConfigs[trapezoidId] = { angle: aAngle, frontHeight: aFront, backHeight: aBack, linesPerRow: 1, lineOrientations: ['vertical'] }
      const computed = computePolygonPanels(area, pixelToCmRatio, panelSpec)
      let filtered = computed.filter(p => !allPanels.some(ep => obbsOverlap(p, ep)))
      // Existing areas always keep at least 1 panel so the area stays visible
      if (filtered.length === 0 && existingAreaIndices.has(areaIdx) && computed.length > 0) {
        filtered = [computed[0]]
      }
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
    setAreas(rectAreas.map(a => ({ label: a.label, angle: parseFloat(a.angle) || 0, frontHeight: parseFloat(a.frontHeight) || 0, linesPerRow: 1, lineOrientations: ['vertical'] })))
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

  // Auto-compute panels in scratch mode whenever rectAreas changes
  useEffect(() => {
    if (projectMode !== 'scratch') return
    computeScratchPanels()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rectAreas])

  const handleNext = (totalSteps, skipScratchPanelRegen = false) => {
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
        // Scratch mode: if panels were already computed+edited in panel-edit tab, keep them.
        // Otherwise compute fresh from rectAreas.
        if (skipScratchPanelRegen) {
          // Panels already set by computeScratchPanels; just ensure refinedArea is current.
          setRefinedArea({
            polygon: roofPolygon, panelType, referenceLine,
            referenceLineLengthCm: parseFloat(referenceLineLengthCm),
            pixelToCmRatio,
            panelConfig: { frontHeight: 0, backHeight: 0, angle: 0, linesPerRow: 1, lineOrientations: ['vertical'] },
          })
        } else {
          computeScratchPanels()
        }
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

    const nextStep = (projectMode === 'scratch' && currentStep === 2) ? 4 : currentStep + 1
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
      const prevStep = (projectMode === 'scratch' && currentStep === 4) ? 2 : currentStep - 1
      setCurrentStep(prevStep)
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
      case 2:
        if (projectMode === 'plan') {
          return (
            areas.length > 0 &&
            areas.every(g =>
              g.baseline !== null &&
              g.frontHeight !== '' && parseFloat(g.frontHeight) >= 0 &&
              g.angle !== '' && parseFloat(g.angle) >= 0 && parseFloat(g.angle) <= 30
            )
          )
        }
        // Scratch mode: need at least one rect with settings
        return (
          rectAreas.length > 0 &&
          rectAreas.every(a =>
            a.frontHeight !== '' && parseFloat(a.frontHeight) >= 0 &&
            a.angle !== '' && parseFloat(a.angle) >= 0 && parseFloat(a.angle) <= 30
          )
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
    projectMode,
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
    regeneratePlanPanelsHandler,
    regenerateSingleRowHandler,
    addManualPanel,
    handlePointSelect,
    handleImageUploaded,
    handleWhiteboardStart,
    handleImageClick,
    computeScratchPanels,
    handleNext,
    handleBack,
    canProceedToNextStep,
  }
}
