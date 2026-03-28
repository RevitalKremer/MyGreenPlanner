import { useState, useEffect, useRef } from 'react'
import { SAM2Service } from '../services/sam2Service'
import { generatePanelLayout, createManualPanel } from '../utils/panelUtils'
import { computePanelBackHeight } from '../utils/trapezoidGeometry'
import { createProject, updateProject, fetchPanelTypes } from '../services/projectsApi'
import { computePolygonPanels } from '../utils/rectPanelService'
import { buildPanelGrid } from '../utils/panelGridService'

function logPanelGrid(grid, trigger) {
  console.group(`[panelGrid] ${trigger}`)
  Object.entries(grid).forEach(([label, areaGrid]) => {
    const totalSlots = areaGrid.rows.reduce((sum, r) => sum + r.length, 0)
    const active = areaGrid.rows.reduce((sum, r) => sum + r.filter(c => c === 'V' || c === 'H').length, 0)
    const empty = totalSlots - active
    console.group(`Area "${label}" — startCorner: ${areaGrid.startCorner}, areaAngle: ${areaGrid.areaAngle}°, rows: ${areaGrid.rows.length}, panels: ${active}, empty slots: ${empty}`)
    areaGrid.rows.forEach((row, i) => {
      const pos = areaGrid.rowPositions?.[i]
      if (pos) {
        console.log(`  row ${i}: [${row.join(', ')}]  positions: [${pos.join(', ')}]`)
      } else {
        console.log(`  row ${i}: [${row.join(', ')}]`)
      }
    })
    if (areaGrid.rowPositions) {
      console.log('  rowPositions:', areaGrid.rowPositions)
    }
    console.groupEnd()
  })
  console.groupEnd()
}
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
  const [panelGrid, setPanelGrid] = useState({})
  // Tracks manually deleted panel positions per area so computePanels can skip them.
  // Shape: { [areaIdx: number]: string[] }  where each string is "row_col".
  const [deletedPanelKeys, setDeletedPanelKeys] = useState({})
  // Set before operations that call setRectAreas but already handle panel state themselves.
  // 'load' → also run reSyncLoadedPanelCols; 'reset' → just skip the recompute.
  const skipRecomputeRef = useRef(null)

  // Step 4: Construction planning settings (persisted for export)
  const [step3GlobalSettings, setStep3GlobalSettings] = useState(null)
  const [step3AreaSettings,   setStep3AreaSettings]   = useState(null)
  const [step3BOMData,        setStep3BOMData]        = useState({ rowConstructions: [], rowLabels: [] })

  // Step 5: BOM user overrides (deltas on top of auto-generated BOM)
  const [step4BomDeltas, setStep4BomDeltas] = useState(null)

  // Cloud project ID — set after first cloud save, used for subsequent saves
  const [cloudProjectId, setCloudProjectId] = useState(null)

  // Panel types — fetched from server, falls back to hardcoded list
  const [panelTypes, setPanelTypes] = useState(PANEL_TYPES)


  // ── Backend ───────────────────────────────────────────────────────────────

  useEffect(() => { checkBackend() }, [])

  useEffect(() => {
    fetchPanelTypes()
      .then(types => { if (types.length > 0) setPanelTypes(types.map(t => ({ id: t.type_key, name: t.name, lengthCm: t.length_cm, widthCm: t.width_cm, kw: t.kw_peak }))) })
      .catch(() => { /* keep hardcoded fallback */ })
  }, [])

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
    setDeletedPanelKeys({})
    setStep3GlobalSettings(null)
    setStep3AreaSettings(null)
    setStep4BomDeltas(null)
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

  // Default calibration for whiteboard: 0.7 cm/px (100px line = 70cm)
  const WHITEBOARD_DEFAULT_RATIO_CM_PER_PX = 0.7
  const applyWhiteboardDefaults = () => {
    setReferenceLine({ start: { x: 0, y: 0 }, end: { x: 100, y: 0 } })
    setReferenceLineLengthCm(String(100 * WHITEBOARD_DEFAULT_RATIO_CM_PER_PX))
  }

  const handleCreateProject = (projectInfo) => {
    setCurrentProject(projectInfo)
    const data = generateWhiteCanvas()
    setUploadedImageData(data)
    setUploadedImageMode(true)
    setRoofPolygon({ coordinates: [[0, 0], [data.width, 0], [data.width, data.height], [0, data.height]], area: data.width * data.height, confidence: 1 })
    applyWhiteboardDefaults()
    setAppScreen('wizard')
  }

  const handleWhiteboardStart = () => {
    const data = generateWhiteCanvas()
    setUploadedImageData(data)
    setUploadedImageMode(true)
    setRoofPolygon({ coordinates: [[0, 0], [data.width, 0], [data.width, data.height], [0, data.height]], area: data.width * data.height, confidence: 1 })
    applyWhiteboardDefaults()
  }

  const handleImportProject = (data, existingCloudId = null) => {
    resetWizardState()
    setCurrentProject(data.project)

    if (data.version === '2.0') {
      // ── v2.0 format ────────────────────────────────────────────────────────
      const layout = data.layout || {}
      const s2     = data.step2  || {}
      const s3     = data.step3  || {}
      const s4     = data.step4  || {}

      if (layout.uploadedImageData)  setUploadedImageData(layout.uploadedImageData)
      if (layout.roofPolygon)        setRoofPolygon(layout.roofPolygon)
      if (layout.referenceLine)      setReferenceLine(layout.referenceLine)
      if (layout.referenceLineLengthCm !== undefined) setReferenceLineLengthCm(String(layout.referenceLineLengthCm))
      if (layout.baseline)           setBaseline(layout.baseline)
      if (layout.panels)             setPanels(layout.panels.map(p => ({ ...p, area: p.area ?? p.row ?? 0, trapezoidId: p.trapezoidId ?? 'A' })))
      if (layout.deletedPanelKeys)   setDeletedPanelKeys(layout.deletedPanelKeys)

      if (layout.rectAreas && s2.areas) {
        skipRecomputeRef.current = 'load'
        setRectAreas(layout.rectAreas.map(ra => {
          const s2a = s2.areas.find(a => a.id === ra.id) || {}
          return { ...ra, label: s2a.label ?? ra.id, frontHeight: String(s2a.frontHeightCm ?? ''), angle: String(s2a.angleDeg ?? '') }
        }))
      } else if (layout.rectAreas) {
        skipRecomputeRef.current = 'load'
        setRectAreas(layout.rectAreas)
      }

      if (s2.panelType)                       setPanelType(s2.panelType)
      if (s2.defaultFrontHeightCm !== undefined) setPanelFrontHeight(String(s2.defaultFrontHeightCm))
      if (s2.defaultAngleDeg      !== undefined) setPanelAngle(String(s2.defaultAngleDeg))

      if (s2.trapezoids) {
        const configs = {}
        Object.entries(s2.trapezoids).forEach(([id, t]) => {
          configs[id] = { angle: t.angleDeg, frontHeight: t.frontHeightCm, linesPerRow: t.linesPerRow, lineOrientations: t.lineOrientations }
        })
        setTrapezoidConfigs(configs)
      }

      if (s2.areas) {
        // Reconstruct legacy areas array (used by Step3 for label/config lookups)
        setAreas(s2.areas.map(a => ({
          label: a.label ?? a.id,
          angle: a.angleDeg ?? 0,
          frontHeight: a.frontHeightCm ?? 0,
          linesPerRow: a.trapezoids?.[0]?.linesPerRow ?? 1,
          lineOrientations: a.trapezoids?.[0]?.lineOrientations ?? ['vertical'],
        })))
        // Reconstruct panelGrid from per-area panelGrid fields
        const grid = {}
        s2.areas.forEach(a => { if (a.panelGrid) grid[a.label ?? a.id] = a.panelGrid })
        setPanelGrid(grid)
      }

      // Reconstruct refinedArea (needed by Step3 for pixelToCmRatio + panelConfig)
      if (layout.pixelToCmRatio) {
        setRefinedArea({
          pixelToCmRatio: layout.pixelToCmRatio,
          polygon: layout.roofPolygon,
          panelType: s2.panelType,
          referenceLine: layout.referenceLine,
          referenceLineLengthCm: layout.referenceLineLengthCm,
          panelConfig: { frontHeight: s2.defaultFrontHeightCm ?? 0, backHeight: 0, angle: s2.defaultAngleDeg ?? 0, linesPerRow: 1, lineOrientations: ['vertical'] },
        })
      }

      if (s3.globalSettings) setStep3GlobalSettings(s3.globalSettings)
      if (s3.areaSettings)   setStep3AreaSettings(s3.areaSettings)
      if (s4.bomDeltas)      setStep4BomDeltas(s4.bomDeltas)

    } else {
      // ── v1.0 legacy format ─────────────────────────────────────────────────
      if (data.uploadedImageData) setUploadedImageData(data.uploadedImageData)
      if (data.roofPolygon)       setRoofPolygon(data.roofPolygon)
      if (data.referenceLine)     setReferenceLine(data.referenceLine)
      if (data.referenceLineLengthCm !== undefined) setReferenceLineLengthCm(String(data.referenceLineLengthCm))
      if (data.panelType)         setPanelType(data.panelType)
      if (data.panelFrontHeight !== undefined) setPanelFrontHeight(String(data.panelFrontHeight))
      if (data.panelAngle       !== undefined) setPanelAngle(String(data.panelAngle))
      if (data.refinedArea)       setRefinedArea(data.refinedArea)
      if (data.baseline)          setBaseline(data.baseline)
      if (data.panels)            setPanels(data.panels.map(p => ({ ...p, area: p.area ?? p.row ?? 0, trapezoidId: p.trapezoidId ?? 'A1' })))
      if (data.areas)             setAreas(data.areas)
      else if (data.rowGroups)    setAreas(data.rowGroups)
      if (data.rectAreas)         { skipRecomputeRef.current = 'load'; setRectAreas(data.rectAreas) }
      if (data.trapezoidConfigs) {
        setTrapezoidConfigs(data.trapezoidConfigs)
      } else if (data.rowConfigs) {
        const first = Object.values(data.rowConfigs)[0]
        if (first) setTrapezoidConfigs({ 'A1': first })
      }
      if (data.step3GlobalSettings ?? data.step4GlobalSettings) setStep3GlobalSettings(data.step3GlobalSettings ?? data.step4GlobalSettings)
      if (data.step3AreaSettings   ?? data.step4AreaSettings)   setStep3AreaSettings(data.step3AreaSettings ?? data.step4AreaSettings)
      else if (data.step4RowSettings) setStep3AreaSettings(data.step4RowSettings)
      if (data.step4BomDeltas) setStep4BomDeltas(data.step4BomDeltas)
    }

    if (data.currentStep) setCurrentStep(data.currentStep)
    if (existingCloudId)  setCloudProjectId(existingCloudId)
    setAppScreen('wizard')
  }

  const getLayoutData = () => {
    const layoutRectAreas = rectAreas.map(ra => ({
      id:                   ra.id,
      vertices:             ra.vertices,
      rotation:             ra.rotation,
      mode:                 ra.mode,
      color:                ra.color,
      xDir:                 ra.xDir,
      yDir:                 ra.yDir,
      manualTrapezoids:     ra.manualTrapezoids,
      manualColTrapezoids:  ra.manualColTrapezoids,
    }))
    return {
      currentStep,
      uploadedImageData: uploadedImageData ? { ...uploadedImageData, file: undefined } : null,
      roofPolygon,
      referenceLine,
      referenceLineLengthCm,
      pixelToCmRatio: refinedArea?.pixelToCmRatio ?? null,
      baseline,
      rectAreas: layoutRectAreas,
      panels,
      deletedPanelKeys,
    }
  }

  const getProjectData = () => {
    const step2Trapezoids = {}
    Object.entries(trapezoidConfigs).forEach(([id, cfg]) => {
      step2Trapezoids[id] = {
        angleDeg:         cfg.angle,
        frontHeightCm:    cfg.frontHeight,
        linesPerRow:      cfg.linesPerRow,
        lineOrientations: cfg.lineOrientations,
      }
    })
    const step2Areas = rectAreas.map((ra, idx) => {
      const areaTrapIds = [...new Set(panels.filter(p => p.area === idx).map(p => p.trapezoidId).filter(Boolean))]
      return {
        id:            ra.id,
        label:         ra.label,
        frontHeightCm: ra.frontHeight !== '' ? parseFloat(ra.frontHeight) || 0 : null,
        angleDeg:      ra.angle !== '' ? parseFloat(ra.angle) || 0 : null,
        trapezoidIds:  areaTrapIds,
        panelGrid:     panelGrid[ra.label] ?? null,
      }
    })
    return {
      version: '2.0',
      step2: {
        panelType,
        defaultFrontHeightCm: parseFloat(panelFrontHeight) || 0,
        defaultAngleDeg:      parseFloat(panelAngle) || 0,
        trapezoids: step2Trapezoids,
        areas: step2Areas,
      },
      step3: {
        globalSettings: step3GlobalSettings,
        areaSettings:   step3AreaSettings,
      },
      step4: {
        bomDeltas: step4BomDeltas,
      },
    }
  }

  // Keep getExportData for file export (combines both into one portable blob)
  const getExportData = () => ({
    project: currentProject,
    layout:  getLayoutData(),
    data:    getProjectData(),
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
    const name     = currentProject?.name || 'Untitled'
    const location = currentProject?.location || null
    const layout   = getLayoutData()
    const data     = getProjectData()
    if (cloudProjectId) {
      await updateProject(cloudProjectId, { name, location, layout, data })
    } else {
      const saved = await createProject(name, location, layout, data)
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
    // For rect areas (numeric index): restore to just-drawn state —
    // clear all manual overrides, deleted cells, and reset angle/frontHeight to globals.
    if (typeof areaKey === 'number' && areaKey >= 0 && areaKey < rectAreas.length) {
      const newRectAreas = rectAreas.map((a, i) => i !== areaKey ? a : {
        ...a,
        angle: panelAngle ?? '',
        frontHeight: panelFrontHeight ?? '',
        manualTrapezoids: false,
        manualColTrapezoids: {},
      })
      skipRecomputeRef.current = 'reset'
      setRectAreas(newRectAreas)
      // Clear deleted-panel memory for this area so all panels are regenerated
      const newDeletedKeys = { ...deletedPanelKeys }
      delete newDeletedKeys[areaKey]
      setDeletedPanelKeys(newDeletedKeys)
      // Call computePanels synchronously with the new data so the restored panels
      // appear immediately without waiting for the async useEffect cycle.
      computePanels(newRectAreas, newDeletedKeys, areaKey)
      setSelectedPanels([])
      return
    }
    // Legacy path for non-rect areas
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

  // Recompute trapezoid IDs for a single area from current panel state.
  // orientOverrides: { panelId: newHeightCm } — pending orientation changes not yet in state.
  // When provided, the orientation swap (pixel w/h + heightCm) is also applied in the same setPanels call.
  const refreshAreaTrapezoids = (areaIdx) => {
    const area = rectAreas[areaIdx]
    if (!area || area.manualTrapezoids || !area.vertices?.length) return
    if (!referenceLine || !referenceLineLengthCm) return

    // Pixel-to-cm ratio from the calibration line
    const dxRef = referenceLine.end.x - referenceLine.start.x
    const dyRef = referenceLine.end.y - referenceLine.start.y
    const pixelLength = Math.sqrt(dxRef * dxRef + dyRef * dyRef)
    if (pixelLength <= 0) return
    const pixelToCmRatio = parseFloat(referenceLineLengthCm) / pixelLength

    // Fill-grid column geometry
    const panelSpec = panelTypes.find(t => t.id === panelType) ?? panelTypes[0] ?? DEFAULT_PANEL_TYPE
    const pWid = panelSpec?.widthCm ?? 113.4
    const gapPx = 2.5 / pixelToCmRatio
    const portraitW = pWid / pixelToCmRatio
    const portraitPitch = portraitW + gapPx

    // Area local frame (unrotated bounding box)
    const { vertices, rotation = 0, xDir = 'ltr' } = area
    const rotRad = (rotation * Math.PI) / 180
    const cosF = Math.cos(-rotRad), sinF = Math.sin(-rotRad)
    const cxAvg = vertices.reduce((s, v) => s + v.x, 0) / vertices.length
    const cyAvg = vertices.reduce((s, v) => s + v.y, 0) / vertices.length
    const localVerts = vertices.map(v => {
      const dx = v.x - cxAvg, dy = v.y - cyAvg
      return { x: dx * cosF - dy * sinF, y: dx * sinF + dy * cosF }
    })
    const minLX = Math.min(...localVerts.map(v => v.x))
    const maxLX = Math.max(...localVerts.map(v => v.x))

    const aFront = parseFloat(area.frontHeight) || parseFloat(panelFrontHeight) || 0
    const aAngle = parseFloat(area.angle) || parseFloat(panelAngle) || 0

    const areaPanels = panels.filter(p => p.area === areaIdx)
    if (!areaPanels.length) return

    // Recompute col/coveredCols for each panel from its current pixel position
    const panelWithCols = areaPanels.map(p => {
      const pcx = p.x + p.width / 2
      const pcy = p.y + p.height / 2
      const lx = (pcx - cxAvg) * cosF - (pcy - cyAvg) * sinF
      const panelW = p.width
      const fillLeft = xDir === 'rtl' ? maxLX - lx - panelW / 2 : lx - minLX - panelW / 2
      const kStart = Math.floor(fillLeft / portraitPitch)
      const kEnd = Math.ceil((fillLeft + panelW) / portraitPitch)
      const coveredCols = []
      for (let k = kStart; k <= kEnd; k++) {
        const portCenter = k * portraitPitch + portraitW / 2
        if (portCenter >= fillLeft && portCenter < fillLeft + panelW) coveredCols.push(k)
      }
      const physCol = coveredCols.length > 0 ? coveredCols[0] : Math.round(fillLeft / portraitPitch)
      return { ...p, col: physCol, coveredCols }
    })

    // Build col → set<row> and row → orientation from current panel state
    const colRowsMap = new Map()
    const rowOrient = {}
    panelWithCols.forEach(p => {
      const row = p.row ?? 0
      rowOrient[row] = (p.heightCm ?? 238.2) > 150 ? 'vertical' : 'horizontal'
      const cols = p.coveredCols?.length > 0 ? p.coveredCols : [p.col ?? 0]
      cols.forEach(c => {
        if (!colRowsMap.has(c)) colRowsMap.set(c, new Set())
        colRowsMap.get(c).add(row)
      })
    })

    const allRows = [...new Set(panelWithCols.map(p => p.row ?? 0))].sort((a, b) => a - b)
    const colSig = (col) =>
      allRows.map(r =>
        colRowsMap.get(col)?.has(r) ? rowOrient[r] : `empty-${rowOrient[r]}`
      ).join('|')

    const sigToTrap = new Map()
    let n = 1
    ;[...colRowsMap.keys()].sort((a, b) => a - b).forEach(col => {
      const s = colSig(col)
      if (!sigToTrap.has(s)) sigToTrap.set(s, `${area.label}${n++}`)
    })
    if (sigToTrap.size === 1) {
      const [[sig]] = [...sigToTrap.entries()]
      sigToTrap.set(sig, area.label)
    }

    // Compute trap configs for each trapezoid shape
    const newTrapConfigs = {}
    sigToTrap.forEach((trapId, sig) => {
      const shape = sig.split('|')
      newTrapConfigs[trapId] = {
        angle: aAngle, frontHeight: aFront,
        backHeight: computePanelBackHeight(aFront, aAngle, shape, shape.length),
        linesPerRow: shape.length, lineOrientations: shape,
      }
    })

    // Update panels with recomputed col/coveredCols and new trapezoidId
    setPanels(prev => prev.map(p => {
      if (p.area !== areaIdx) return p
      const updated = panelWithCols.find(pw => pw.id === p.id)
      if (!updated) return p
      const sig = colSig(updated.col)
      const newTrapId = sigToTrap.get(sig) || area.label
      if (newTrapId === p.trapezoidId && updated.col === p.col) return p
      return { ...p, col: updated.col, coveredCols: updated.coveredCols, trapezoidId: newTrapId }
    }))

    // Rebuild trapezoid configs for this area, preserve other areas
    setTrapezoidConfigs(prev => {
      const next = {}
      Object.entries(prev).forEach(([id, cfg]) => {
        const rest = id.slice(area.label.length)
        if (id !== area.label && !(id.startsWith(area.label) && /^\d/.test(rest))) next[id] = cfg
      })
      Object.entries(newTrapConfigs).forEach(([id, cfg]) => {
        next[id] = { ...(prev[id] || {}), ...cfg }
      })
      return next
    })
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
    setUploadedImageData(imageData)
    setUploadedImageMode(true)
    setRoofPolygon({ coordinates: [[0, 0], [imageData.width, 0], [imageData.width, imageData.height], [0, imageData.height]], area: imageData.width * imageData.height, confidence: 1 })
    setReferenceLine(null)
    setReferenceLineLengthCm('')
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
  // Accepts an optional _rectAreasOverride so callers can pass fresh data without waiting for
  // a state update to propagate through the useEffect cycle.
  const computePanels = (_rectAreasOverride, _deletedKeysOverride, _onlyAreaIdx) => {
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

    const effectiveRectAreas = _rectAreasOverride ?? rectAreas
    const effectiveDeletedKeys = _deletedKeysOverride ?? deletedPanelKeys

    // Areas that already had panels before this compute are "existing" — never auto-deleted
    const existingAreaIndices = new Set(panels.map(p => p.area))

    const allPanels = []
    const groupTrapConfigs = {}
    const areaLineConfigs = {}
    const newPanelGrid = {}
    const panelSpec = panelTypes.find(t => t.id === panelType) ?? panelTypes[0] ?? DEFAULT_PANEL_TYPE

    // When resetting a single area, carry over all other areas' panels/grids/configs unchanged
    if (_onlyAreaIdx !== undefined) {
      panels.forEach(p => {
        if (p.area !== _onlyAreaIdx) allPanels.push(p)
      })
      effectiveRectAreas.forEach((area, areaIdx) => {
        if (areaIdx === _onlyAreaIdx) return
        if (panelGrid[area.label]) newPanelGrid[area.label] = panelGrid[area.label]
        const existingPanels = panels.filter(p => p.area === areaIdx)
        const lineRows = [...new Set(existingPanels.map(p => p.row))].sort((a, b) => a - b)
        areaLineConfigs[areaIdx] = {
          linesPerRow: Math.max(1, lineRows.length),
          lineOrientations: lineRows.map(r => {
            const s = existingPanels.find(p => p.row === r)
            return (s?.heightCm ?? 238.2) > 150 ? 'vertical' : 'horizontal'
          }),
        }
        existingPanels.forEach(p => {
          if (p.trapezoidId && trapezoidConfigs[p.trapezoidId]) {
            groupTrapConfigs[p.trapezoidId] = trapezoidConfigs[p.trapezoidId]
          }
        })
      })
    }

    let panelId = allPanels.length > 0 ? Math.max(...allPanels.map(p => p.id)) + 1 : 1
    effectiveRectAreas.forEach((area, areaIdx) => {
      if (_onlyAreaIdx !== undefined && areaIdx !== _onlyAreaIdx) return
      const aFront = parseFloat(area.frontHeight) || parseFloat(panelFrontHeight) || 0
      const aAngle = parseFloat(area.angle) || parseFloat(panelAngle) || 0
      const computed = computePolygonPanels(area, pixelToCmRatio, panelSpec)
      let filtered = computed.filter(p => !allPanels.some(ep => obbsOverlap(p, ep)))
      // Remove panels manually deleted by the user
      const deletedKeys = effectiveDeletedKeys[areaIdx]
      if (deletedKeys?.length > 0) {
        const deletedSet = new Set(deletedKeys)
        filtered = filtered.filter(p => {
          const col = p.coveredCols?.[0] ?? p.col ?? 0
          return !deletedSet.has(`${p.row}_${col}`)
        })
      }
      // Existing areas always keep at least 1 panel so the area stays visible
      if (filtered.length === 0 && existingAreaIndices.has(areaIdx) && computed.length > 0) {
        filtered = [computed[0]]
      }

      newPanelGrid[area.label] = buildPanelGrid(area, computed, filtered, pixelToCmRatio)

      // Area-level orientation (all rows, no empties) — used for areas state and step 4
      const lineRows = [...new Set(filtered.map(p => p.row))].sort((a, b) => a - b)
      const derivedLPR = Math.max(1, lineRows.length)
      const rowOrient = {}  // row → 'vertical'|'horizontal'
      lineRows.forEach(r => {
        const s = filtered.find(p => p.row === r)
        rowOrient[r] = (s?.heightCm ?? 238.2) > 150 ? 'vertical' : 'horizontal'
      })
      const derivedOrients = lineRows.map(r => rowOrient[r])
      areaLineConfigs[areaIdx] = { linesPerRow: derivedLPR, lineOrientations: derivedOrients }

      if (!area.manualTrapezoids) {
        // ── Auto-split: group columns by their row-presence signature ────────────
        const computedAllRows = [...new Set(computed.map(p => p.row))].sort((a, b) => a - b)
        const computedRowOrient = {}
        computedAllRows.forEach(r => {
          const s = computed.find(p => p.row === r)
          computedRowOrient[r] = (s?.heightCm ?? 238.2) > 150 ? 'vertical' : 'horizontal'
        })

        const colRowsComputed = new Map()
        computed.forEach(p => {
          const cols = p.coveredCols?.length > 0 ? p.coveredCols : [p.col ?? 0]
          cols.forEach(c => {
            if (!colRowsComputed.has(c)) colRowsComputed.set(c, new Set())
            colRowsComputed.get(c).add(p.row)
          })
        })

        // Signature = per-row orientation string, empty-* for rows absent in the polygon
        const colSig = (col) =>
          computedAllRows.map(r =>
            colRowsComputed.get(col)?.has(r) ? computedRowOrient[r] : `empty-${computedRowOrient[r]}`
          ).join('|')

        // Assign trapezoid IDs grouped by signature (left-to-right column order)
        const sigToTrap = new Map()
        let n = 1
        ;[...colRowsComputed.keys()].sort((a, b) => a - b).forEach(col => {
          const s = colSig(col)
          if (!sigToTrap.has(s)) sigToTrap.set(s, `${area.label}${n++}`)
        })
        if (sigToTrap.size === 1) {
          const [[sig]] = [...sigToTrap.entries()]
          sigToTrap.set(sig, area.label)
        }

        // Build groupTrapConfigs for each unique trap shape
        sigToTrap.forEach((trapId, sig) => {
          const shape = sig.split('|')
          const trapBack = computePanelBackHeight(aFront, aAngle, shape, shape.length)
          groupTrapConfigs[trapId] = { angle: aAngle, frontHeight: aFront, backHeight: trapBack,
            linesPerRow: shape.length, lineOrientations: shape }
        })

        filtered.forEach(p => {
          const physCol = p.coveredCols?.[0] ?? p.col ?? 0
          const sig = colSig(physCol)
          allPanels.push({ ...p, id: panelId++, area: areaIdx,
            trapezoidId: sigToTrap.get(sig) || area.label,
            yDir: area.yDir ?? 'ttb' })
        })
      } else {
        // ── Manual mode: use stored column→trapId assignments ────────────────────
        const colToTrap = area.manualColTrapezoids || {}
        const defaultTrap = area.label
        const aBack = computePanelBackHeight(aFront, aAngle, derivedOrients, derivedLPR)
        const usedTraps = new Set([defaultTrap, ...Object.values(colToTrap)])
        usedTraps.forEach(trapId => {
          groupTrapConfigs[trapId] = { angle: aAngle, frontHeight: aFront, backHeight: aBack,
            linesPerRow: derivedLPR, lineOrientations: derivedOrients }
        })
        filtered.forEach(p => {
          const trapId = colToTrap[String(p.col ?? 0)] ?? defaultTrap
          allPanels.push({ ...p, id: panelId++, area: areaIdx, trapezoidId: trapId, yDir: area.yDir ?? 'ttb' })
        })
      }
    })

    // Auto-delete only NEW areas (not previously having panels) that got zero panels
    const areaIndicesWithPanels = new Set(allPanels.map(p => p.area))
    const emptyNewIndices = effectiveRectAreas
      .map((_, i) => i)
      .filter(i => !areaIndicesWithPanels.has(i) && !existingAreaIndices.has(i))
    if (emptyNewIndices.length > 0) {
      setRectAreas(prev => prev.filter((_, i) => !emptyNewIndices.includes(i)))
      return // re-triggered by rectAreas change; don't commit partial state
    }

    setPanelGrid(newPanelGrid)
    logPanelGrid(newPanelGrid, 'panel grid generated')

    setPanels(allPanels)
    setAreas(effectiveRectAreas.map((a, idx) => ({
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

  const recordPanelDeletion = (panel) => {
    const areaIdx = panel.area
    const col = panel.coveredCols?.[0] ?? panel.col ?? 0
    const key = `${panel.row}_${col}`
    setDeletedPanelKeys(prev => {
      const existing = prev[areaIdx] ?? []
      if (existing.includes(key)) return prev
      return { ...prev, [areaIdx]: [...existing, key] }
    })
  }

  // After a project load (computePanels skipped), re-derive col/coveredCols/row for each
  // loaded panel by matching it to the closest computed panel from computePolygonPanels.
  // This ensures key lookups in buildPanelGrid are consistent with fresh geometry,
  // without resetting the panel's pixel positions.
  const reSyncLoadedPanelCols = () => {
    if (!referenceLine || !referenceLineLengthCm || rectAreas.length === 0) return
    const dx = referenceLine.end.x - referenceLine.start.x
    const dy = referenceLine.end.y - referenceLine.start.y
    const pixelLength = Math.sqrt(dx * dx + dy * dy)
    if (pixelLength <= 0) return
    const ratio = parseFloat(referenceLineLengthCm) / pixelLength
    const spec = panelTypes.find(t => t.id === panelType) ?? panelTypes[0] ?? DEFAULT_PANEL_TYPE

    setPanels(prev => {
      const next = [...prev]
      rectAreas.forEach((area, areaIdx) => {
        const computed = computePolygonPanels(area, ratio, spec)
        if (!computed.length) return
        const halfW = computed[0].width / 2
        const threshold = halfW * 3  // generous: covers one full panel-pitch
        next.forEach((p, i) => {
          if (p.area !== areaIdx) return
          const pcx = p.x + p.width / 2
          const pcy = p.y + p.height / 2
          let best = null, bestDist = Infinity
          computed.forEach(cp => {
            const d = Math.sqrt((pcx - cp.cx) ** 2 + (pcy - cp.cy) ** 2)
            if (d < bestDist) { bestDist = d; best = cp }
          })
          if (best && bestDist < threshold) {
            next[i] = { ...p, row: best.row, col: best.col, coveredCols: best.coveredCols }
          }
        })
      })
      // Rebuild panelGrid with the synced panel data
      const newGrid = {}
      rectAreas.forEach((area, areaIdx) => {
        const computed = computePolygonPanels(area, ratio, spec)
        const areaFiltered = next.filter(p => p.area === areaIdx)
        newGrid[area.label] = buildPanelGrid(area, computed, areaFiltered, ratio)
      })
      setPanelGrid(newGrid)
      logPanelGrid(newGrid, 'loaded (col-synced)')
      return next
    })
  }

  const rebuildPanelGrid = (updatedPanels) => {
    if (!referenceLine || !referenceLineLengthCm || rectAreas.length === 0) return
    const dx = referenceLine.end.x - referenceLine.start.x
    const dy = referenceLine.end.y - referenceLine.start.y
    const pixelLength = Math.sqrt(dx * dx + dy * dy)
    if (pixelLength <= 0) return
    const pixelToCmRatio = parseFloat(referenceLineLengthCm) / pixelLength
    const panelSpec = panelTypes.find(t => t.id === panelType) ?? panelTypes[0] ?? DEFAULT_PANEL_TYPE
    const newGrid = {}
    rectAreas.forEach((area, areaIdx) => {
      const computed = computePolygonPanels(area, pixelToCmRatio, panelSpec)
      const areaFiltered = updatedPanels.filter(p => p.area === areaIdx)
      newGrid[area.label] = buildPanelGrid(area, computed, areaFiltered, pixelToCmRatio)
    })
    setPanelGrid(newGrid)
    logPanelGrid(newGrid, 'panel deleted/rotated')
  }

  // Auto-compute panels whenever rectAreas, panel type, or global mounting defaults change.
  // Skipped once after a project load so imported panel positions (including moves) are preserved.
  useEffect(() => {
    if (skipRecomputeRef.current) {
      const reason = skipRecomputeRef.current
      skipRecomputeRef.current = null
      if (reason === 'load') reSyncLoadedPanelCols()
      return
    }
    computePanels()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rectAreas, panelAngle, panelFrontHeight, panelType, panelTypes])

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

    // Finalise panel data before entering step 3 (construction planning)
    if (nextStep === 4) {
      // Re-split trapezoids from current panel state (step 2 responsibility, last chance)
      rectAreas.forEach((area, idx) => {
        if (!area.manualTrapezoids) refreshAreaTrapezoids(idx)
      })
      // Snapshot the panel grid — step 3 reads it but never writes it
      rebuildPanelGrid(panels)
    }

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
    panelTypes,
    panelType, setPanelType,
    referenceLine, setReferenceLine,
    referenceLineLengthCm, setReferenceLineLengthCm,
    panelFrontHeight, setPanelFrontHeight,
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
    panelGrid,
    rebuildPanelGrid,
    recordPanelDeletion,
    // Step 4
    step3GlobalSettings, setStep3GlobalSettings,
    step3AreaSettings, setStep3AreaSettings,
    step3BOMData, setStep3BOMData,
    // Step 5
    step4BomDeltas, setStep4BomDeltas,
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
    refreshAreaTrapezoids,
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
