import { useState, useEffect, useRef, useMemo, useReducer } from 'react'
import { generatePanelLayout, createManualPanel } from '../utils/panelUtils'
import { createProject, updateProject, uploadProjectImage, getProjectImageUrl } from '../services/projectsApi'
import { mgpRequest } from '../services/mgpApi'
import { PANEL_V } from '../utils/panelCodes.js'
import { projectReducer, initialProjectState, A } from './useProjectReducer'
import { computePanelsAction, refreshAreaTrapezoidsAction, reSyncLoadedPanelColsAction, rebuildPanelGridAction } from './computePanelsAction'
import { allAreasTiles, isAreaTiles } from '../utils/roofSpecUtils'
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
  const roofAxis = pState.layout.roofAxis ?? null
  const setRoofAxis = (v) => pDispatch({ type: A.SET_LAYOUT, payload: { roofAxis: v } })
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
  const roofSource = pState.ui.roofSource  // 'canvas' | 'image' | 'map'
  const setRoofSource = (v) => pDispatch({ type: A.SET_UI, payload: { roofSource: v } })
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
  const rowMounting = pState.data.step2.rowMounting || {}
  const setRowMounting = (v) => pDispatch({ type: A.SET_ROW_MOUNTING, value: v })


  // Set before operations that call setRectAreas but already handle panel state themselves.
  // 'load' → also run reSyncLoadedPanelCols; 'reset' → just skip the recompute.
  const skipRecomputeRef = useRef(null)

  // Pending save overrides: handleNext writes refreshed panels/trapConfigs here
  // synchronously so getLayoutData/getProjectData can read them before state flushes.
  const pendingSaveRef = useRef(null)

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
    appConfigReady,
    refreshAppSettings,
  } = useAppConfig({
    panelType, currentProject,
    // For mixed projects, paramSchemaForRoof unions the types of each area's
    // roofSpec. Pass rectAreas (which carry the per-area roofSpec), deduped
    // by areaGroupId so multi-row groups count once.
    areas: (pState.layout.rectAreas || []).reduce((acc, ra) => {
      if (!ra) return acc
      const gid = ra.areaGroupId
      if (gid == null || acc.some(a => a._gid === gid)) return acc
      acc.push({ _gid: gid, roofSpec: ra.roofSpec })
      return acc
    }, []),
  })

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

  // Plain-canvas reference line: spans the full canvas width along the bottom edge.
  // Length-in-px equals canvas width, so the user only enters cm.
  const canvasReferenceLine = (data) => {
    const y = data.height - Math.max(4, Math.round(data.width * 0.005))
    return { start: { x: 0, y }, end: { x: data.width, y } }
  }

  const applyWhiteboardDefaults = (data) => {
    setReferenceLine(canvasReferenceLine(data))
    // Default canvas width: 6000 cm (60 m) → 2 cm/px on a 3000 px canvas.
    setReferenceLineLengthCm('6000')
  }

  const handleCreateProject = (projectInfo) => {
    refreshAppSettings()
    setCurrentProject(projectInfo)
    const data = generateWhiteCanvas()
    setUploadedImageData(data)
    setRoofSource('canvas')
    setRoofPolygon({ coordinates: [[0, 0], [data.width, 0], [data.width, data.height], [0, data.height]], area: data.width * data.height, confidence: 1 })
    applyWhiteboardDefaults(data)
    setAppScreen('wizard')
  }

  const handleWhiteboardStart = () => {
    const data = generateWhiteCanvas()
    setUploadedImageData(data)
    setRoofSource('canvas')
    setRoofPolygon({ coordinates: [[0, 0], [data.width, 0], [data.width, data.height], [0, data.height]], area: data.width * data.height, confidence: 1 })
    applyWhiteboardDefaults(data)
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
      const traps = Array.isArray(s2.trapezoids) ? s2.trapezoids : Object.entries(s2.trapezoids as Record<string, any>).map(([id, t]) => ({ id, ...t }))
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
      roofSpec: a.roofSpec ?? null,
    }))
    const grid = {}
    const rowMtg = {}  // areaLabel → [{angleDeg, frontHeightCm}, ...]
    ;(s2.areas || []).forEach(a => {
      const label = a.label ?? a.id
      if (a.panelRows?.length > 0) {
        // New format: panelRows array
        grid[label] = a.panelRows.map(pr => pr?.panelGrid).filter(Boolean)
        // Row a/h: prefer panelRow's a/h. Backfill from area / first matching trap if missing.
        rowMtg[label] = a.panelRows.map((pr, ri) => {
          if (!pr) return { angleDeg: a.angleDeg ?? s2.defaultAngleDeg ?? 0, frontHeightCm: a.frontHeightCm ?? s2.defaultFrontHeightCm ?? 0 }
          let ang = pr.angleDeg
          let fh  = pr.frontHeightCm
          if (ang == null || fh == null) {
            // Backfill from a trap that has panels in this row
            const panels = (layout.panels || []).filter(p =>
              !p.isEmpty && (p.panelRowIdx ?? 0) === (pr.rowIndex ?? ri)
            )
            const tid = panels.map(p => p.trapezoidId).find(t => t && (a.trapezoidIds || []).includes(t))
            const trap = tid ? (s2.trapezoids || []).find(t => t.id === tid) : null
            if (ang == null) ang = trap?.angleDeg ?? a.angleDeg ?? s2.defaultAngleDeg ?? 0
            if (fh  == null) fh  = trap?.frontHeightCm ?? a.frontHeightCm ?? s2.defaultFrontHeightCm ?? 0
          }
          return { angleDeg: ang, frontHeightCm: fh }
        })
      } else if (a.panelGrid) {
        // Legacy format: single panelGrid → wrap as array
        grid[label] = [a.panelGrid]
        rowMtg[label] = [{
          angleDeg: a.angleDeg ?? s2.defaultAngleDeg ?? 0,
          frontHeightCm: a.frontHeightCm ?? s2.defaultFrontHeightCm ?? 0,
        }]
      }
    })

    // ── Enrich rectAreas with step2 area data ──
    // Match each rectArea to its owning step2 area by label/id/areaGroupId
    // (not sequential — rectAreas may be interleaved across areas).
    let enrichedRectAreas = layout.rectAreas || []
    if (layout.rectAreas && s2.areas) {
      // Build lookup maps for step2 areas
      const s2ByLabel = {}
      const s2ById = {}
      for (const a of s2.areas) {
        if (a.label) s2ByLabel[a.label] = a
        if (a.id != null) s2ById[a.id] = a
      }

      enrichedRectAreas = layout.rectAreas.map((ra, idx) => {
        // Match by: areaGroupId → s2 area id (primary), label fallback (legacy).
        // areaGroupId is numeric: positive = BE-assigned, negative = temp.
        const s2a = (typeof ra.areaGroupId === 'number' ? s2ById[ra.areaGroupId] : null)
          ?? s2ByLabel[ra.label]
          ?? {}
        const derivedRowIndex = ra.rowIndex ?? 0
        // areaGroupId = BE-assigned numeric area ID (stable across saves)
        const numericGroupId = typeof s2a.id === 'number' ? s2a.id : (typeof ra.areaGroupId === 'number' ? ra.areaGroupId : -(idx + 1))
        const rowIndex = ra.rowIndex ?? derivedRowIndex
        return {
          ...ra,
          // id stays immutable (row identity) — don't overwrite with group id
          label: s2a.label ?? ra.label,
          frontHeight: String(s2a.frontHeightCm ?? ''),
          angle: String(s2a.angleDeg ?? ''),
          areaGroupId: numericGroupId,
          rowIndex,
          // Mirror the step2 area's per-area roof spec onto every rectArea in
          // the group. Only meaningful for projects with roof_spec.type='mixed';
          // non-mixed projects ignore this field entirely.
          roofSpec: s2a.roofSpec ?? null,
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
        roofAxis: layout.roofAxis ?? null,
        panels: layout.panels ? layout.panels.map(p => {
          const areaIdx = p.area ?? p.row ?? 0
          const ra = enrichedRectAreas[areaIdx]
          const panelRowIdx = p.panelRowIdx ?? ra?.rowIndex ?? 0
          // areaGroupKey: index of the first rectArea in this group
          const groupId = ra?.areaGroupId
          const areaGroupKey = groupId != null
            ? enrichedRectAreas.findIndex(a => a.areaGroupId === groupId)
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
          rowMounting: rowMtg,
        },
        step3: { globalSettings: s3.globalSettings || {}, areaSettings: s3.areaSettings || {},
                 customDiagonals: s3.customDiagonals || {}, customBasesOffsets: s3.customBasesOffsets || {} },
        step4: { planApproval: s4.planApproval ?? null },
        step5: { bomDeltas: s5.bomDeltas ?? null },
      },
      navigation: { step: data.currentStep || 1, tab: null },
      project: { cloudProjectId: existingCloudId ?? null, appScreen: 'wizard', currentProject: data.project },
    })

    // Restore Step 1 source toggle from loaded image (whiteboard → canvas; real image → image)
    const isCanvas = layout.uploadedImageData?.isWhiteboard
    setRoofSource(isCanvas ? 'canvas' : 'image')

    // Canvas-mode reference line is always auto (full bottom edge). Override any
    // legacy/saved value left over from older Step 1 versions, and reset length
    // to the 1:1 default (cm == px) so the ratio doesn't reuse a stale value.
    if (isCanvas && layout.uploadedImageData) {
      applyWhiteboardDefaults(layout.uploadedImageData)
    }

    // refinedArea is now a useMemo — auto-derived from layout + step2 data
  }

  const getLayoutData = () => {
    const l = pState.layout
    const pending = pendingSaveRef.current
    const hasImageRef = l.uploadedImageData?.imageRef
    const isWhiteboard = l.uploadedImageData?.isWhiteboard

    return {
      ...l,
      // Use refreshed panels from handleNext if state hasn't flushed yet
      ...(pending?.panels ? { panels: pending.panels } : {}),
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
        id: ra.id, label: ra.label, vertices: ra.vertices, rotation: ra.rotation, mode: ra.mode,
        color: ra.color, xDir: ra.xDir, yDir: ra.yDir, areaVertical: ra.areaVertical ?? false,
        manualTrapezoids: ra.manualTrapezoids, manualColTrapezoids: ra.manualColTrapezoids,
        areaGroupId: ra.areaGroupId, rowIndex: ra.rowIndex ?? 0,
      })),
    }
  }

  const getProjectData = () => {
    const d = pState.data
    const pending = pendingSaveRef.current
    // Convert FE trapezoidConfigs object to server trapezoids array
    // Use refreshed configs from handleNext if state hasn't flushed yet
    const effectiveTrapConfigs = pending?.trapezoidConfigs ?? d.step2.trapezoidConfigs
    const effectivePanels = pending?.panels ?? panels
    const trapezoids = Object.entries(effectiveTrapConfigs as Record<string, any>).map(([id, cfg]) => ({
      id, angleDeg: cfg.angle, frontHeightCm: cfg.frontHeight, lineOrientations: cfg.lineOrientations,
    }))
    // Enrich areas with rectAreas geometry + panel-derived trapezoidIds
    // d.step2.areas has one entry per area GROUP (not per rectArea).
    // Build a robust panel→area mapping using multiple strategies.

    // Pre-build: for each rectArea index, which areaGroupKey and label?
    const raGroupKeys = {}  // rectAreaIdx → areaGroupKey
    const raLabels = {}     // rectAreaIdx → label
    rectAreas.forEach((ra, idx) => {
      const gid = ra.areaGroupId
      raLabels[idx] = ra.label || String(ra.id ?? idx)
      // Find the first rectArea with this groupId
      const firstIdx = rectAreas.findIndex(r => r.areaGroupId === gid)
      raGroupKeys[idx] = firstIdx >= 0 ? firstIdx : idx
    })

    const enrichedAreas = d.step2.areas.map((a) => {
      const groupLabel = a.label
      const areaId = a.id  // BE-assigned numeric ID

      // Strategy 1: find rectArea by numeric areaGroupId matching area.id,
      // then fallback to label match
      const ra = (typeof areaId === 'number' ? rectAreas.find(r => r.areaGroupId === areaId) : null)
        || rectAreas.find(r => r.label === groupLabel)

      // Strategy 2: find panels belonging to this area group via multiple methods
      let areaPanels
      if (ra) {
        const groupKey = rectAreas.indexOf(ra)
        // Match by areaGroupKey
        areaPanels = effectivePanels.filter(p => p.areaGroupKey === groupKey)
        // Fallback: match by rectArea label
        if (areaPanels.length === 0) {
          const matchingRaIdxs = rectAreas
            .map((r, i) => ((r.areaGroupId) === groupLabel) ? i : -1)
            .filter(i => i >= 0)
          areaPanels = effectivePanels.filter(p => matchingRaIdxs.includes(p.area))
        }
      } else {
        // No rectArea match: find panels whose rectArea label matches
        areaPanels = effectivePanels.filter(p => raLabels[p.area] === groupLabel)
      }

      // Strategy 3: if still empty, try matching by trapezoidId prefix (e.g., "D" → D1, D2, D3)
      if (areaPanels.length === 0) {
        areaPanels = effectivePanels.filter(p => {
          const tid = p.trapezoidId || ''
          return tid === groupLabel || tid.replace(/\d+$/, '') === groupLabel
        })
      }

      // Derive trapezoidIds from panels (primary source of truth)
      const panelDerivedTrapIds = [...new Set(areaPanels.map(p => p.trapezoidId).filter(Boolean))]
      // Use panel-derived IDs, but keep stored IDs that panels might have lost during recompute
      const storedTrapIds = a.trapezoidIds ?? []
      // Only use stored as base if panel-derived is empty; otherwise panel-derived wins
      // but validate stored IDs belong to this area (prefix matches label)
      const validStoredIds = storedTrapIds.filter(tid =>
        tid === groupLabel || tid.startsWith(groupLabel)
      )
      const areaTrapIds = panelDerivedTrapIds.length > 0
        ? panelDerivedTrapIds
        : validStoredIds.length > 0 ? validStoredIds : storedTrapIds

      const areaRowMounting = (d.step2.rowMounting || {})[groupLabel] || []
      return {
        ...a,
        label: groupLabel,
        frontHeightCm: parseFloat(ra?.frontHeight !== '' ? ra?.frontHeight : panelFrontHeight) || 0,
        angleDeg: parseFloat(ra?.angle !== '' ? ra?.angle : panelAngle) || 0,
        trapezoidIds: areaTrapIds,
        // Per-area roof spec (only meaningful when project roof_spec is 'mixed').
        // Serialize whatever is on the (first) rectArea of the group.
        roofSpec: ra?.roofSpec ?? null,
        panelRows: (d.step2.panelGrid[groupLabel] || []).map((pg, ri) => (
          pg == null ? null : {
            rowIndex: ri,
            panelGrid: pg,
            angleDeg: areaRowMounting[ri]?.angleDeg ?? null,
            frontHeightCm: areaRowMounting[ri]?.frontHeightCm ?? null,
          }
        )).filter(Boolean),
      }
    })
    const { trapezoidConfigs: _tc, panelGrid: _pg, rowMounting: _rm, ...step2Rest } = d.step2
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
    pendingSaveRef.current = null  // consumed — clear so subsequent saves use state
    
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
      areaIdx, area: rectAreas[areaIdx], panels, rectAreas, referenceLine, referenceLineLengthCm,
      panelSpec, appDefaults, panelFrontHeight, panelAngle, trapezoidConfigs,
      rowMounting,
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

  // ── Image upload handler ──────────────────────────────────────────────────

  const dataURLtoBlob = (dataURL) => {
    const arr = dataURL.split(',')
    const mime = arr[0].match(/:(.*?);/)[1]
    const bstr = atob(arr[1])
    let n = bstr.length
    const u8arr = new Uint8Array(n)
    while (n--) u8arr[n] = bstr.charCodeAt(n)
    return new Blob([u8arr], { type: mime })
  }

  const handleImageUploaded = async (imageData) => {
    // Store image data immediately
    // Actual upload to backend happens in handleSaveProject after project exists
    setUploadedImageData(imageData)
    setRoofSource('image')
    setRoofPolygon({
      coordinates: [[0, 0], [imageData.width, 0], [imageData.width, imageData.height], [0, imageData.height]],
      area: imageData.width * imageData.height,
      confidence: 1
    })
    setReferenceLine(null)
    setReferenceLineLengthCm('')
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
      rowMounting,
      roofPolygon, panelType,
      onlyAreaIdx: _onlyAreaIdx,
      roofType: currentProject?.roofSpec?.type || 'concrete',
    })
    if (!result) return

    // Auto-delete only NEW areas that got zero panels — re-triggers via rectAreas change
    if (result.emptyNewIndices.length > 0) {
      setRectAreas(prev => prev.filter((_, i) => !result.emptyNewIndices.includes(i)))
      return
    }

    setPanelGrid(result.panelGrid)
    setPanels(result.panels)
    setAreas(prev => {
      return result.areas.map((a) => {
        // Match previous area by label (not index — lengths may differ for multi-trap areas)
        const prevMatch = prev.find(p => p.label === a.label)
        return { ...prevMatch, ...a }
      })
    })
    setTrapezoidConfigs(result.trapezoidConfigs)
    // Skip setRowMounting when content is unchanged — it would only churn a new
    // object reference and re-trigger the auto-recompute useEffect (infinite loop).
    if (result.rowMounting && JSON.stringify(result.rowMounting) !== JSON.stringify(rowMounting || {})) {
      setRowMounting(result.rowMounting)
    }
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

  const clearDeletedPanelsForArea = (areaIdx) => {
    setDeletedPanelKeys(prev => {
      const next = { ...prev }
      delete next[areaIdx]
      // Shift higher indices down (area deletion shifts all subsequent indices)
      const shifted = {}
      for (const [k, v] of Object.entries(next)) {
        const idx = Number(k)
        if (idx > areaIdx) shifted[idx - 1] = v
        else shifted[k] = v
      }
      return shifted
    })
  }

  const reSyncLoadedPanelCols = () => {
    const result = reSyncLoadedPanelColsAction({
      referenceLine, referenceLineLengthCm, rectAreas, panels, panelSpec, appDefaults,
    })
    if (!result) return
    // After re-syncing cols, also refresh trapezoid assignments so multi-row
    // areas get correct per-row trap IDs (older projects may have stale IDs).
    let currentPanels = result.panels
    let currentTrapConfigs = { ...trapezoidConfigs }
    const processedGroups = new Set()
    rectAreas.forEach((area, idx) => {
      if (area.manualTrapezoids) return
      const groupId = area.areaGroupId ?? idx
      if (processedGroups.has(groupId)) return
      processedGroups.add(groupId)
      const refreshResult = refreshAreaTrapezoidsAction({
        areaIdx: idx, area, panels: currentPanels, rectAreas,
        referenceLine, referenceLineLengthCm,
        panelSpec, appDefaults, panelFrontHeight, panelAngle,
        trapezoidConfigs: currentTrapConfigs,
        rowMounting,
      })
      if (refreshResult) {
        currentPanels = refreshResult.updatedPanels
        currentTrapConfigs = refreshResult.mergedTrapConfigs
      }
    })
    setPanels(currentPanels)
    setPanelGrid(result.panelGrid)
    setTrapezoidConfigs(currentTrapConfigs)
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
      computePanels(undefined, undefined, undefined)
    }, 5)
    return () => { if (computeTimerRef.current) clearTimeout(computeTimerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rectAreas, panelAngle, panelFrontHeight, panelType, panelTypes, appDefaults, rowMounting])

  const handleNext = (totalSteps) => {
    if (currentStep >= totalSteps) return

    // refinedArea is now a useMemo — no manual update needed on step transition

    const nextStep = currentStep + 1

    // Finalise panel data before entering step 3 (construction planning)
    if (nextStep === 3) {
      // Re-split trapezoids from current panel state (step 2 responsibility, last chance).
      // Batch all groups into a single pass so each group's result feeds into the next.
      let currentPanels = panels
      let currentTrapConfigs = { ...trapezoidConfigs }
      const processedGroups = new Set()
      rectAreas.forEach((area, idx) => {
        if (area.manualTrapezoids) return
        const groupId = area.areaGroupId ?? idx
        if (processedGroups.has(groupId)) return
        processedGroups.add(groupId)
        const result = refreshAreaTrapezoidsAction({
          areaIdx: idx, area, panels: currentPanels, rectAreas,
          referenceLine, referenceLineLengthCm,
          panelSpec, appDefaults, panelFrontHeight, panelAngle,
          trapezoidConfigs: currentTrapConfigs,
          rowMounting,
        })
        if (result) {
          currentPanels = result.updatedPanels
          currentTrapConfigs = result.mergedTrapConfigs
        }
      })
      setPanels(currentPanels)
      setTrapezoidConfigs(currentTrapConfigs)
      // Store in ref so the next save reads refreshed data (state hasn't flushed yet)
      pendingSaveRef.current = { panels: currentPanels, trapezoidConfigs: currentTrapConfigs }
      // Snapshot the panel grid — step 3 reads it but never writes it
      rebuildPanelGrid(currentPanels)
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
        if (allAreasTiles(roofType, [])) return true
        const defaultFH = panelFrontHeight ?? ''
        const defaultAng = panelAngle ?? ''
        const angLim = paramLimits.mountingAngleDeg
        const fhLim  = paramLimits.frontHeightCm
        return rectAreas.every(a => {
          // Tiles areas have no construction frame → a/h is irrelevant
          if (isAreaTiles(roofType, a)) return true
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
    roofPolygon, setRoofPolygon,
    backendStatus,
    roofSource, setRoofSource,
    uploadedImageData, setUploadedImageData,
    imageSrc, // Computed: imageRef URL or base64 imageData
    imageRef, setImageRef,
    // Step 2
    refinedArea,
    panelTypes,
    panelType, setPanelType,
    referenceLine, setReferenceLine,
    referenceLineLengthCm, setReferenceLineLengthCm,
    roofAxis, setRoofAxis,
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
    rowMounting, setRowMounting,
    rebuildPanelGrid,
    recordPanelDeletion,
    clearDeletedPanelsForArea,
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
    // App config readiness (appDefaults + panelSpec loaded)
    appConfigReady,
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
    handleImageUploaded,
    handleWhiteboardStart,
    computePanels,
    handleNext,
    handleBack,
    resetStepData,
    canProceedToNextStep,
  }
}
