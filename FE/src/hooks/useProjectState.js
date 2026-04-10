import { useState, useEffect, useRef, useMemo, useReducer } from 'react'
import { SAM2Service } from '../services/sam2Service'
import { generatePanelLayout, createManualPanel } from '../utils/panelUtils'
import { createProject, updateProject, uploadProjectImage, getProjectImageUrl } from '../services/projectsApi'
import { mgpRequest } from '../services/mgpApi'
import { PANEL_V } from '../utils/panelCodes.js'
import { projectReducer, initialProjectState, A } from './useProjectReducer'
import { computePanelsAction, refreshAreaTrapezoidsAction, reSyncLoadedPanelColsAction, rebuildPanelGridAction } from './computePanelsAction'
import useAppConfig from './useAppConfig'

export function useProjectState() {
  // ── Structured state (mirrors server JSON) ──
  const [pState, pDispatch] = useReducer(projectReducer, initialProjectState)

  // App-level screen — reads from reducer
  const appScreen = pState.project.appScreen
  const setAppScreen = (v) => pDispatch({ type: A.SET_PROJECT, payload: { appScreen: v } })
  const currentProject = pState.project.currentProject
  const setCurrentProject = (v) => pDispatch({ type: A.SET_PROJECT, payload: { currentProject: v } })

  // Wizard state — now reads from reducer
  const currentStep = pState.navigation.step
  const setCurrentStep = (step) => pDispatch({ type: A.SET_STEP, step })

  // Step 1: Roof allocation
  const [imageRef, setImageRef] = useState(null)

  // Layout — reads from reducer
  const uploadedImageData = pState.layout.uploadedImageData
  const setUploadedImageData = (v) => pDispatch({ type: A.SET_LAYOUT, payload: { uploadedImageData: v } })
  const roofPolygon = pState.layout.roofPolygon
  const setRoofPolygon = (v) => pDispatch({ type: A.SET_LAYOUT, payload: { roofPolygon: v } })
  const referenceLine = pState.layout.referenceLine
  const setReferenceLine = (v) => pDispatch({ type: A.SET_LAYOUT, payload: { referenceLine: v } })
  const referenceLineLengthCm = pState.layout.referenceLineLengthCm ?? ''
  const setReferenceLineLengthCm = (v) => pDispatch({ type: A.SET_LAYOUT, payload: { referenceLineLengthCm: v } })
  const baseline = pState.layout.baseline
  const setBaseline = (v) => pDispatch({ type: A.SET_LAYOUT, payload: { baseline: v } })
  const panels = pState.layout.panels
  const setPanels = (v) => pDispatch({ type: A.SET_PANELS, value: v })
  const rectAreas = pState.layout.rectAreas
  const setRectAreas = (v) => pDispatch({ type: A.SET_RECT_AREAS, value: v })
  const deletedPanelKeys = pState.layout.deletedPanelKeys
  const setDeletedPanelKeys = (v) => pDispatch({ type: A.SET_DELETED_PANEL_KEYS, value: v })

  // UI — reads from reducer
  const selectedPoint = pState.ui.selectedPoint
  const setSelectedPoint = (v) => pDispatch({ type: A.SET_UI, payload: { selectedPoint: v } })
  const isProcessing = pState.ui.isProcessing
  const setIsProcessing = (v) => pDispatch({ type: A.SET_UI, payload: { isProcessing: v } })
  const uploadedImageMode = pState.ui.uploadedImageMode
  const setUploadedImageMode = (v) => pDispatch({ type: A.SET_UI, payload: { uploadedImageMode: v } })
  const isDrawingLine = pState.ui.isDrawingLine
  const setIsDrawingLine = (v) => pDispatch({ type: A.SET_UI, payload: { isDrawingLine: v } })
  const lineStart = pState.ui.lineStart
  const setLineStart = (v) => pDispatch({ type: A.SET_UI, payload: { lineStart: v } })
  const showBaseline = pState.ui.showBaseline
  const setShowBaseline = (v) => pDispatch({ type: A.SET_UI, payload: { showBaseline: v } })
  const showDistances = pState.ui.showDistances
  const setShowDistances = (v) => pDispatch({ type: A.SET_UI, payload: { showDistances: v } })
  const distanceMeasurement = pState.ui.distanceMeasurement
  const setDistanceMeasurement = (v) => pDispatch({ type: A.SET_UI, payload: { distanceMeasurement: v } })
  const selectedPanels = pState.ui.selectedPanels
  const setSelectedPanels = (v) => pDispatch({ type: A.SET_SELECTED_PANELS, value: v })
  const dragState = pState.ui.dragState
  const setDragState = (v) => pDispatch({ type: A.SET_UI, payload: { dragState: v } })
  const rotationState = pState.ui.rotationState
  const setRotationState = (v) => pDispatch({ type: A.SET_UI, payload: { rotationState: v } })
  const viewZoom = pState.ui.viewZoom
  const setViewZoom = (v) => pDispatch({ type: A.SET_UI, payload: { viewZoom: v } })

  // Step 2: PV area refinement
  const panelType = pState.data.step2.panelType
  const setPanelType = (v) => pDispatch({ type: A.SET_STEP2, payload: { panelType: v } })
  const panelFrontHeight = String(pState.data.step2.defaultFrontHeightCm || '')
  const setPanelFrontHeight = (v) => pDispatch({ type: A.SET_STEP2, payload: { defaultFrontHeightCm: parseFloat(v) || 0 } })
  const panelAngle = String(pState.data.step2.defaultAngleDeg || '')
  const setPanelAngle = (v) => pDispatch({ type: A.SET_STEP2, payload: { defaultAngleDeg: parseFloat(v) || 0 } })

  // Derived from layout + step2 data
  const refinedArea = useMemo(() => {
    if (!referenceLine || !referenceLineLengthCm) return null
    const dx = referenceLine.end.x - referenceLine.start.x
    const dy = referenceLine.end.y - referenceLine.start.y
    const pixelLength = Math.sqrt(dx * dx + dy * dy)
    if (pixelLength <= 0) return null
    const pixelToCmRatio = parseFloat(referenceLineLengthCm) / pixelLength
    return {
      pixelToCmRatio,
      polygon: roofPolygon,
      panelType,
      referenceLine,
      referenceLineLengthCm: parseFloat(referenceLineLengthCm),
      panelConfig: { frontHeight: parseFloat(panelFrontHeight) || 0, backHeight: 0, angle: parseFloat(panelAngle) || 0, lineOrientations: [PANEL_V] },
    }
  }, [referenceLine, referenceLineLengthCm, roofPolygon, panelType, panelFrontHeight, panelAngle])

  // Step 2-3: data from reducer
  const areas = pState.data.step2.areas
  const setAreas = (v) => pDispatch({ type: A.SET_AREAS, value: v })
  const trapezoidConfigs = pState.data.step2.trapezoidConfigs
  const setTrapezoidConfigs = (v) => pDispatch({ type: A.SET_TRAPEZOID_CONFIGS, value: v })
  const panelGrid = pState.data.step2.panelGrid
  const setPanelGrid = (v) => pDispatch({ type: A.SET_PANEL_GRID, value: v })


  // Set before operations that call setRectAreas but already handle panel state themselves.
  // 'load' → also run reSyncLoadedPanelCols; 'reset' → just skip the recompute.
  const skipRecomputeRef = useRef(null)

  // Step 3-5: reads from reducer, writes via dispatch
  const step3GlobalSettings = pState.data.step3.globalSettings
  const setStep3GlobalSettings = (v) => pDispatch({ type: A.SET_STEP3_GLOBAL, value: v })
  const step3AreaSettings = pState.data.step3.areaSettings
  const setStep3AreaSettings = (v) => pDispatch({ type: A.SET_STEP3_AREA, value: v })
  const step4PlanApproval = pState.data.step4.planApproval
  const setStep4PlanApproval = (v) => pDispatch({ type: A.SET_PLAN_APPROVAL, value: v })
  const step5BomDeltas = pState.data.step5.bomDeltas
  const setStep5BomDeltas = (v) => pDispatch({ type: A.SET_BOM_DELTAS, value: v })

  const cloudProjectId = pState.project.cloudProjectId
  const setCloudProjectId = (v) => pDispatch({ type: A.SET_PROJECT, payload: { cloudProjectId: v } })

  // ── App config (panel types, settings, products, backend) ──
  const {
    panelTypes, panelSpec,
    appDefaults, paramSchema, paramSchemaForRoof, settingsDefaults, paramGroup, paramLimits,
    products, productByType, altsByType,
    backendStatus,
    refreshAppSettings,
  } = useAppConfig({ panelType, currentProject })

  // ── Sync panelSpec dimensions into reducer when panelType changes ──
  useEffect(() => {
    const spec = panelTypes?.find(t => t.id === panelType) ?? panelTypes?.[0]
    if (spec) pDispatch({ type: A.SET_STEP2, payload: { panelWidthCm: spec.widthCm, panelLengthCm: spec.lengthCm } })
  }, [panelType, panelTypes])

  // ── Wizard lifecycle ──────────────────────────────────────────────────────

  const resetWizardState = () => {
    pDispatch({ type: A.RESET })
    // Reset remaining useState hooks not in reducer
    setImageRef(null)
  }

  const handleStartOver = () => {
    resetWizardState()
    setCurrentProject(null)
    setAppScreen('welcome')
  }

  const generateWhiteCanvas = () => {
    const W = 3000, H = 2000
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
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
    refreshAppSettings()
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
    // Refresh app settings so defaults are not stale after admin changes / migrations
    refreshAppSettings()

    const layout = data.layout || {}
    
    // Regenerate white canvas imageData if missing (for projects saved after optimization)
    if (layout.uploadedImageData?.isWhiteboard && !layout.uploadedImageData.imageData) {
      const whiteCanvas = generateWhiteCanvas()
      layout.uploadedImageData.imageData = whiteCanvas.imageData
    }
    const s2     = data.step2  || {}
    const s3     = data.step3  || {}
    const s4     = data.step4  || {}
    const s5     = data.step5  || {}

    // ── Convert server trapezoids array → FE trapezoidConfigs object ──
    const trapezoidConfigs = {}
    if (s2.trapezoids) {
      const traps = Array.isArray(s2.trapezoids) ? s2.trapezoids : Object.entries(s2.trapezoids).map(([id, t]) => ({ id, ...t }))
      traps.forEach(t => {
        trapezoidConfigs[t.id] = { angle: t.angleDeg, frontHeight: t.frontHeightCm, lineOrientations: t.lineOrientations }
      })
    }

    // ── Convert server areas → FE areas format + extract panelGrid ──
    const feAreas = (s2.areas || []).map(a => ({
      id: a.id,
      label: a.label ?? a.id,
      trapezoidIds: a.trapezoidIds ?? [],
      angle: a.angleDeg ?? 0,
      frontHeight: a.frontHeightCm ?? 0,
      lineOrientations: a.trapezoids?.[0]?.lineOrientations ?? [PANEL_V],
    }))
    const grid = {}
    ;(s2.areas || []).forEach(a => {
      const label = a.label ?? a.id
      if (a.panelRows?.length > 0) {
        // New format: panelRows array
        grid[label] = a.panelRows.map(pr => pr.panelGrid).filter(Boolean)
      } else if (a.panelGrid) {
        // Legacy format: single panelGrid → wrap as array
        grid[label] = [a.panelGrid]
      }
    })

    // ── Enrich rectAreas with step2 area data ──
    // Multi-row areas: s2.areas has fewer entries than layout.rectAreas (one per group).
    // Use panelRows count to assign rectAreas to s2.areas sequentially.
    let enrichedRectAreas = layout.rectAreas || []
    if (layout.rectAreas && s2.areas) {
      // Build a sequential mapping: rectArea index → { s2Area, rowIndex }
      const rectToArea = []
      let raIdx = 0
      for (const s2a of s2.areas) {
        const rowCount = Math.max(1, s2a.panelRows?.length ?? 1)
        for (let ri = 0; ri < rowCount && raIdx < layout.rectAreas.length; ri++) {
          rectToArea.push({ s2a, rowIndex: ri })
          raIdx++
        }
      }
      // Assign any remaining rectAreas (shouldn't happen, but be safe)
      while (raIdx < layout.rectAreas.length) {
        rectToArea.push({ s2a: {}, rowIndex: 0 })
        raIdx++
      }

      enrichedRectAreas = layout.rectAreas.map((ra, idx) => {
        const { s2a, rowIndex: derivedRowIndex } = rectToArea[idx] || { s2a: {}, rowIndex: 0 }
        const effectiveGroupId = s2a.label || ra.areaGroupId || ra.label || ra.id
        const rowIndex = ra.rowIndex ?? derivedRowIndex
        return {
          ...ra,
          // Keep rectArea's own id (unique per drawn row); don't overwrite with s2.area.id
          label: s2a.label ?? ra.id,
          frontHeight: String(s2a.frontHeightCm ?? ''),
          angle: String(s2a.angleDeg ?? ''),
          areaGroupId: ra.areaGroupId || effectiveGroupId,
          rowIndex,
        }
      })
    }
    if (enrichedRectAreas.length > 0) skipRecomputeRef.current = 'load'

    // ── Load all reducer state in one shot ──
    pDispatch({ type: A.LOAD_PROJECT,
      layout: {
        uploadedImageData: layout.uploadedImageData ?? null,
        roofPolygon: layout.roofPolygon ?? null,
        referenceLine: layout.referenceLine ?? null,
        referenceLineLengthCm: layout.referenceLineLengthCm != null ? String(layout.referenceLineLengthCm) : null,
        pixelToCmRatio: layout.pixelToCmRatio ?? null,
        baseline: layout.baseline ?? null,
        panels: layout.panels ? layout.panels.map(p => {
          const areaIdx = p.area ?? p.row ?? 0
          const ra = enrichedRectAreas[areaIdx]
          const panelRowIdx = p.panelRowIdx ?? ra?.rowIndex ?? 0
          // areaGroupKey: index of the first rectArea in this group
          const groupId = ra?.areaGroupId || ra?.label
          const areaGroupKey = groupId != null
            ? enrichedRectAreas.findIndex(a => (a.areaGroupId || a.label) === groupId)
            : areaIdx
          return { ...p, area: areaIdx, trapezoidId: p.trapezoidId ?? 'A', panelRowIdx, areaGroupKey: areaGroupKey >= 0 ? areaGroupKey : areaIdx }
        }) : [],
        rectAreas: enrichedRectAreas,
        deletedPanelKeys: layout.deletedPanelKeys ?? {},
      },
      data: {
        version: '3.0',
        step2: {
          panelType: s2.panelType || 'AIKO-G670-MCH72Mw',
          panelWidthCm: s2.panelWidthCm ?? null,
          panelLengthCm: s2.panelLengthCm ?? null,
          defaultFrontHeightCm: s2.defaultFrontHeightCm ?? 0,
          defaultAngleDeg: s2.defaultAngleDeg ?? 0,
          areas: feAreas,
          trapezoidConfigs,
          panelGrid: grid,
        },
        step3: { globalSettings: s3.globalSettings || {}, areaSettings: s3.areaSettings || {},
                 customDiagonals: s3.customDiagonals || {}, customBasesOffsets: s3.customBasesOffsets || {} },
        step4: { planApproval: s4.planApproval ?? null },
        step5: { bomDeltas: s5.bomDeltas ?? null },
      },
      navigation: { step: data.currentStep || 1, tab: null },
      project: { cloudProjectId: existingCloudId ?? null, appScreen: 'wizard', currentProject: data.project },
    })

    // refinedArea is now a useMemo — auto-derived from layout + step2 data
  }

  const getLayoutData = () => {
    const l = pState.layout
    const hasImageRef = l.uploadedImageData?.imageRef
    const isWhiteboard = l.uploadedImageData?.isWhiteboard
    
    return {
      ...l,
      currentStep,
      pixelToCmRatio: refinedArea?.pixelToCmRatio ?? l.pixelToCmRatio ?? null,
      // Strip FE-only fields before saving
      // If imageRef exists, don't send base64 imageData (reduces payload by ~1-2MB)
      // For white canvas, exclude imageData (can be regenerated on load)
      uploadedImageData: l.uploadedImageData ? {
        ...l.uploadedImageData,
        file: undefined,
        imageData: (hasImageRef || isWhiteboard) ? undefined : l.uploadedImageData.imageData,
      } : null,
      rectAreas: l.rectAreas.map(ra => ({
        id: ra.id, vertices: ra.vertices, rotation: ra.rotation, mode: ra.mode,
        color: ra.color, xDir: ra.xDir, yDir: ra.yDir, areaVertical: ra.areaVertical ?? false,
        manualTrapezoids: ra.manualTrapezoids, manualColTrapezoids: ra.manualColTrapezoids,
        areaGroupId: ra.areaGroupId, rowIndex: ra.rowIndex ?? 0,
      })),
    }
  }

  const getProjectData = () => {
    const d = pState.data
    // Convert FE trapezoidConfigs object to server trapezoids array
    const trapezoids = Object.entries(d.step2.trapezoidConfigs).map(([id, cfg]) => ({
      id, angleDeg: cfg.angle, frontHeightCm: cfg.frontHeight, lineOrientations: cfg.lineOrientations,
    }))
    // Enrich areas with rectAreas geometry + panel-derived trapezoidIds
    // d.step2.areas has one entry per area GROUP (not per rectArea).
    // Find the first rectArea for each group by matching label/areaGroupId.
    const enrichedAreas = d.step2.areas.map((a) => {
      const groupLabel = a.label
      // Find the primary rectArea for this group by matching areaGroupId, label, or area index
      const ra = rectAreas.find(r => (r.areaGroupId || r.label) === groupLabel)
        || rectAreas.find(r => r.label === groupLabel)
      // Filter panels by areaGroupKey (not p.area which is rectArea index)
      const groupKey = ra ? rectAreas.indexOf(ra) : undefined
      const areaTrapIds = [...new Set(
        panels.filter(p => p.areaGroupKey === groupKey || (groupKey === undefined && (rectAreas[p.area]?.label === groupLabel)))
          .map(p => p.trapezoidId).filter(Boolean)
      )]
      return {
        ...a,
        label: groupLabel,
        frontHeightCm: parseFloat(ra?.frontHeight !== '' ? ra?.frontHeight : panelFrontHeight) || 0,
        angleDeg: parseFloat(ra?.angle !== '' ? ra?.angle : panelAngle) || 0,
        trapezoidIds: areaTrapIds.length > 0 ? areaTrapIds : (a.trapezoidIds ?? []),
        panelRows: (d.step2.panelGrid[groupLabel] || []).map((pg, ri) => ({
          rowIndex: ri, panelGrid: pg ?? null,
        })),
      }
    })
    const { trapezoidConfigs: _tc, panelGrid: _pg, ...step2Rest } = d.step2
    return {
      ...d,
      step2: {
        ...step2Rest,
        // Ensure panel dimensions are always present (fallback to panelSpec if sync effect hasn't fired)
        panelWidthCm: step2Rest.panelWidthCm ?? panelSpec?.widthCm ?? null,
        panelLengthCm: step2Rest.panelLengthCm ?? panelSpec?.lengthCm ?? null,
        areas: enrichedAreas,
        trapezoids,
      },
    }
  }

  const handleSaveProject = async (step = null) => {
    const name     = currentProject?.name || 'Untitled'
    const location = currentProject?.location || null
    const roofSpec = currentProject?.roofSpec || null
    const layout   = getLayoutData()
    const data     = getProjectData()
    
    let projectId
    if (cloudProjectId) {
      await updateProject(cloudProjectId, { name, location, layout, data }, step)
      projectId = cloudProjectId
    } else {
      const saved = await createProject(name, location, layout, data, roofSpec)
      setCloudProjectId(saved.id)
      projectId = saved.id
    }
    
    // After project is saved, upload image if it hasn't been uploaded yet
    // Skip white canvas - it can be regenerated on-the-fly
    if (projectId && uploadedImageData && uploadedImageData.imageData && !uploadedImageData.imageRef && !uploadedImageData.isWhiteboard) {
      try {
        // Convert base64 to blob (for uploaded images)
        const imageBlob = uploadedImageData.file || dataURLtoBlob(uploadedImageData.imageData)
        const result = await uploadProjectImage(projectId, imageBlob)
        
        // Update state with imageRef
        const updatedImageData = { ...uploadedImageData, imageRef: result.imageId }
        setUploadedImageData(updatedImageData)
        
        // Update project again to use imageRef (this time without base64)
        const updatedLayout = {
          ...layout,
          uploadedImageData: {
            ...updatedImageData,
            imageData: undefined,  // Remove base64 now that we have imageRef
            file: undefined,
          }
        }
        await updateProject(projectId, { layout: updatedLayout }, step)
        
        console.log('✅ Image uploaded and project updated with imageRef:', result.imageId)
      } catch (error) {
        console.error('Failed to upload image after project save:', error)
        // Continue - project was saved with base64
      }
    }
    
    return projectId
  }

  // ── Panel layout handlers ─────────────────────────────────────────────────

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
    const allGenerated = generatePanelLayout(refinedArea, baseline, false, appDefaults?.panelGapCm, panelSpec)
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

  const refreshAreaTrapezoids = (areaIdx) => {
    const result = refreshAreaTrapezoidsAction({
      areaIdx, area: rectAreas[areaIdx], panels, referenceLine, referenceLineLengthCm,
      panelSpec, appDefaults, panelFrontHeight, panelAngle, trapezoidConfigs,
    })
    if (!result) return
    setPanels(result.updatedPanels)
    setTrapezoidConfigs(result.mergedTrapConfigs)
  }

  const addManualPanel = () => {
    const newPanel = createManualPanel(refinedArea, baseline, panels, roofPolygon, panelSpec)
    if (!newPanel) return false
    const newAreaIdx  = areas.length
    const trapezoidId = `${String.fromCharCode(65 + newAreaIdx)}1`
    const newArea = { angle: 0, frontHeight: 0, lineOrientations: [PANEL_V] }
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

  const handleImageUploaded = async (imageData) => {
    // Store image data immediately
    // Actual upload to backend happens in handleSaveProject after project exists
    setUploadedImageData(imageData)
    setUploadedImageMode(true)
    setRoofPolygon({ 
      coordinates: [[0, 0], [imageData.width, 0], [imageData.width, imageData.height], [0, imageData.height]], 
      area: imageData.width * imageData.height, 
      confidence: 1 
    })
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
    const result = computePanelsAction({
      referenceLine, referenceLineLengthCm, appDefaults, panelSpec,
      rectAreas: _rectAreasOverride ?? rectAreas,
      panels, deletedPanelKeys: _deletedKeysOverride ?? deletedPanelKeys,
      panelFrontHeight, panelAngle,
      panelGrid, trapezoidConfigs,
      roofPolygon, panelType,
      onlyAreaIdx: _onlyAreaIdx,
    })
    if (!result) return

    // Auto-delete only NEW areas that got zero panels — re-triggers via rectAreas change
    if (result.emptyNewIndices.length > 0) {
      setRectAreas(prev => prev.filter((_, i) => !result.emptyNewIndices.includes(i)))
      return
    }

    setPanelGrid(result.panelGrid)
    setPanels(result.panels)
    setAreas(prev => result.areas.map((a, idx) => ({
      ...prev[idx],  // preserve existing fields like id, trapezoidIds from server
      ...a,
    })))
    setTrapezoidConfigs(result.trapezoidConfigs)
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

  const reSyncLoadedPanelCols = () => {
    const result = reSyncLoadedPanelColsAction({
      referenceLine, referenceLineLengthCm, rectAreas, panels, panelSpec, appDefaults,
    })
    if (!result) return
    setPanels(result.panels)
    setPanelGrid(result.panelGrid)
  }

  const rebuildPanelGrid = (updatedPanels) => {
    const newGrid = rebuildPanelGridAction({
      referenceLine, referenceLineLengthCm, rectAreas, panels: updatedPanels, panelSpec, appDefaults,
    })
    if (newGrid) setPanelGrid(newGrid)
  }

  // Auto-compute panels whenever rectAreas, panel type, or global mounting defaults change.
  // Skipped once after a project load so imported panel positions (including moves) are preserved.
  // Only runs on step 1-2; step 3+ uses frozen data from the step 2→3 transition.
  const computeTimerRef = useRef(null)
  useEffect(() => {
    if (skipRecomputeRef.current) {
      const reason = skipRecomputeRef.current
      skipRecomputeRef.current = null
      if (reason === 'load') reSyncLoadedPanelCols()
      return
    }
    if (currentStep > 2) return  // don't recompute panels after step 2
    // Debounce: avoid re-render cascade during rapid drag updates
    if (computeTimerRef.current) clearTimeout(computeTimerRef.current)
    computeTimerRef.current = setTimeout(() => {
      computeTimerRef.current = null
      computePanels()
    }, 5)
    return () => { if (computeTimerRef.current) clearTimeout(computeTimerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rectAreas, panelAngle, panelFrontHeight, panelType, panelTypes, appDefaults])

  const handleNext = (totalSteps) => {
    if (currentStep >= totalSteps) return

    // refinedArea is now a useMemo — no manual update needed on step transition

    const nextStep = currentStep + 1

    // Finalise panel data before entering step 3 (construction planning)
    if (nextStep === 3) {
      // Re-split trapezoids from current panel state (step 2 responsibility, last chance)
      rectAreas.forEach((area, idx) => {
        if (!area.manualTrapezoids) refreshAreaTrapezoids(idx)
      })
      // Snapshot the panel grid — step 3 reads it but never writes it
      rebuildPanelGrid(panels)
    }

    setCurrentStep(nextStep)
  }

  const resetStepData = (clearedSteps) => {
    if (!clearedSteps?.length) return
    for (const key of clearedSteps) {
      if (key === 'step3') { setStep3GlobalSettings({}); setStep3AreaSettings({}) }
      if (key === 'step4') { setStep4PlanApproval(null) }
      if (key === 'step5') { setStep5BomDeltas(null) }
    }
  }

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
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
        const roofType = currentProject?.roofSpec?.type || 'concrete'
        if (rectAreas.length === 0) return false
        if (roofType === 'tiles') return true
        const defaultFH = panelFrontHeight ?? ''
        const defaultAng = panelAngle ?? ''
        const angLim = paramLimits.mountingAngleDeg
        const fhLim  = paramLimits.frontHeightCm
        return rectAreas.every(a => {
          const fh = a.frontHeight !== '' ? a.frontHeight : defaultFH
          const ang = a.angle !== '' ? a.angle : defaultAng
          return fh !== '' && parseFloat(fh) >= fhLim.min && parseFloat(fh) <= fhLim.max &&
            ang !== '' && parseFloat(ang) >= angLim.min && parseFloat(ang) <= angLim.max
        })
      }
      case 3: return true
      case 4: return !!(step4PlanApproval?.strictConsent)
      case 5: return true
      default: return false
    }
  }

  // ── Computed image source (handles both base64 and imageRef) ──
  const [imageSrc, setImageSrc] = useState(null)
  
  useEffect(() => {
    if (!uploadedImageData) {
      setImageSrc(null)
      return
    }
    
    // New flow: fetch image from backend if imageRef exists
    if (uploadedImageData.imageRef && cloudProjectId) {
      const fetchImage = async () => {
        try {
          const url = getProjectImageUrl(cloudProjectId)
          const response = await mgpRequest(url)
          
          if (!response.ok) {
            console.error('Failed to fetch image:', response.status)
            // Fallback to base64 if available
            setImageSrc(uploadedImageData.imageData || null)
            return
          }
          
          const blob = await response.blob()
          const blobUrl = URL.createObjectURL(blob)
          setImageSrc(blobUrl)
          
          // Cleanup function to revoke blob URL when component unmounts or deps change
          return () => URL.revokeObjectURL(blobUrl)
        } catch (error) {
          console.error('Error fetching image:', error)
          // Fallback to base64 if available
          setImageSrc(uploadedImageData.imageData || null)
        }
      }
      
      fetchImage()
    } else {
      // Legacy flow: use base64 imageData
      setImageSrc(uploadedImageData.imageData || null)
    }
  }, [uploadedImageData?.imageRef, uploadedImageData?.imageData, cloudProjectId])

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
    imageSrc, // Computed: imageRef URL or base64 imageData
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
    // Step 4 (construction planning)
    step3GlobalSettings, setStep3GlobalSettings,
    step3AreaSettings, setStep3AreaSettings,
    // Step 5 (plan approval)
    step4PlanApproval, setStep4PlanApproval,
    // Step 6 (BOM / PDF)
    step5BomDeltas, setStep5BomDeltas,
    // Panel spec (resolved from panelTypes + panelType)
    panelSpec,
    // App defaults (from app_settings DB table)
    appDefaults,
    paramSchema,
    paramSchemaForRoof,
    settingsDefaults,
    paramGroup,
    paramLimits,
    // Products (materials for BOM)
    products, productByType, altsByType,
    // Cloud
    cloudProjectId, setCloudProjectId,
    handleSaveProject,
    // Handlers
    handleStartOver,
    handleCreateProject,
    handleImportProject,
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
    resetStepData,
    canProceedToNextStep,
  }
}
