/**
 * Project state reducer — single source of truth for all project data.
 * State shape mirrors the server's DB columns (layout, data, navigation).
 * Each dispatch carries a step ID; the reducer rejects writes to the wrong step.
 */

// ── Action types ──
export const A = Object.freeze({
  // Lifecycle
  LOAD_PROJECT:           'LOAD_PROJECT',
  RESET:                  'RESET',
  // Navigation
  SET_STEP:               'SET_STEP',
  SET_TAB:                'SET_TAB',
  // Step 2
  SET_STEP2:              'SET_STEP2',
  SET_AREAS:              'SET_AREAS',
  SET_TRAPEZOID_CONFIGS:  'SET_TRAPEZOID_CONFIGS',
  SET_PANEL_GRID:         'SET_PANEL_GRID',
  // Step 3
  SET_STEP3_GLOBAL:       'SET_STEP3_GLOBAL',
  SET_STEP3_AREA:         'SET_STEP3_AREA',
  // Step 4
  SET_PLAN_APPROVAL:      'SET_PLAN_APPROVAL',
  // Step 5
  SET_BOM_DELTAS:         'SET_BOM_DELTAS',
  // Layout
  SET_LAYOUT:             'SET_LAYOUT',
  SET_PANELS:             'SET_PANELS',
  SET_RECT_AREAS:         'SET_RECT_AREAS',
  SET_DELETED_PANEL_KEYS: 'SET_DELETED_PANEL_KEYS',
  // Project-level
  SET_PROJECT:            'SET_PROJECT',
  // UI
  SET_UI:                 'SET_UI',
  SET_SELECTED_PANELS:    'SET_SELECTED_PANELS',
})

export const initialProjectState = {
  // ── Mirrors DB `layout` JSONB column ──
  layout: {
    uploadedImageData: null,
    roofPolygon: null,
    referenceLine: null,
    referenceLineLengthCm: null,
    pixelToCmRatio: null,
    baseline: null,
    rectAreas: [],
    panels: [],
    deletedPanelKeys: {},
  },

  // ── Mirrors DB `data` JSONB column ──
  data: {
    version: '3.0',
    step2: {
      panelType: 'AIKO-G670-MCH72Mw',
      panelWidthCm: null,
      panelLengthCm: null,
      defaultFrontHeightCm: 0,
      defaultAngleDeg: 0,
      areas: [],
      trapezoidConfigs: {},
      panelGrid: {},
    },
    step3: {
      globalSettings: {},
      areaSettings: {},
      customDiagonals: {},
      customBasesOffsets: {},
    },
    step4: {
      planApproval: null,
    },
    step5: {
      bomDeltas: null,
    },
  },

  // ── Mirrors DB `navigation` column ──
  navigation: {
    step: 1,
    tab: null,
  },

  // ── Project-level (not per-step) ──
  project: {
    appScreen: 'welcome',   // 'welcome' | 'wizard'
    currentProject: null,    // { name, location, roofSpec }
    cloudProjectId: null,    // set after first cloud save
  },

  // ── FE-only ephemeral state (not persisted) ──
  ui: {
    selectedPanels: [],
    dragState: null,
    rotationState: null,
    viewZoom: 1,
    showBaseline: true,
    showDistances: true,
    distanceMeasurement: null,
    isDrawingLine: false,
    lineStart: null,
    isProcessing: false,
    selectedPoint: null,
    uploadedImageMode: true,
  },
}


export function projectReducer(state, action) {
  // ── Step enforcement ──
  // Data-write actions with a step ID are rejected if that step is past the current step.
  // Navigation and lifecycle actions are always allowed.
  const EXEMPT = [A.SET_STEP, A.SET_TAB, A.LOAD_PROJECT, A.RESET]
  if (action.step != null && action.step > state.navigation.step && !EXEMPT.includes(action.type)) {
    return state  // silently reject — wrong step
  }

  switch (action.type) {

    // ── Project lifecycle ──

    case A.LOAD_PROJECT:
      return {
        ...state,
        layout: action.layout ?? state.layout,
        data: action.data ?? state.data,
        navigation: action.navigation ?? state.navigation,
        project: action.project ?? state.project,
      }

    case A.RESET:
      return { ...initialProjectState }

    // ── Navigation ──

    case A.SET_STEP:
      return { ...state, navigation: { ...state.navigation, step: action.step } }

    case A.SET_TAB:
      return { ...state, navigation: { ...state.navigation, tab: action.tab } }

    // ── Step 2 data ──

    case A.SET_STEP2:
      return {
        ...state,
        data: { ...state.data, step2: { ...state.data.step2, ...action.payload } },
      }

    case A.SET_AREAS: {
      const areas = typeof action.value === 'function' ? action.value(state.data.step2.areas) : action.value
      return { ...state, data: { ...state.data, step2: { ...state.data.step2, areas } } }
    }

    case A.SET_TRAPEZOID_CONFIGS: {
      const trapezoidConfigs = typeof action.value === 'function' ? action.value(state.data.step2.trapezoidConfigs) : action.value
      return { ...state, data: { ...state.data, step2: { ...state.data.step2, trapezoidConfigs } } }
    }

    case A.SET_PANEL_GRID: {
      const panelGrid = typeof action.value === 'function' ? action.value(state.data.step2.panelGrid) : action.value
      return { ...state, data: { ...state.data, step2: { ...state.data.step2, panelGrid } } }
    }

    // ── Step 3 settings ──

    case A.SET_STEP3_GLOBAL:
      return {
        ...state,
        data: { ...state.data, step3: { ...state.data.step3, globalSettings: action.value } },
      }

    case A.SET_STEP3_AREA:
      return {
        ...state,
        data: { ...state.data, step3: { ...state.data.step3, areaSettings: action.value } },
      }

    // ── Step 4 ──

    case A.SET_PLAN_APPROVAL:
      return {
        ...state,
        data: { ...state.data, step4: { ...state.data.step4, planApproval: action.value } },
      }

    // ── Step 5 ──

    case A.SET_BOM_DELTAS:
      return {
        ...state,
        data: { ...state.data, step5: { ...state.data.step5, bomDeltas: action.value } },
      }

    // ── Layout ──

    case A.SET_LAYOUT:
      return { ...state, layout: { ...state.layout, ...action.payload } }

    case A.SET_PANELS: {
      const panels = typeof action.value === 'function' ? action.value(state.layout.panels) : action.value
      return { ...state, layout: { ...state.layout, panels } }
    }

    case A.SET_RECT_AREAS: {
      const rectAreas = typeof action.value === 'function' ? action.value(state.layout.rectAreas) : action.value
      return { ...state, layout: { ...state.layout, rectAreas } }
    }

    case A.SET_DELETED_PANEL_KEYS: {
      const deletedPanelKeys = typeof action.value === 'function' ? action.value(state.layout.deletedPanelKeys) : action.value
      return { ...state, layout: { ...state.layout, deletedPanelKeys } }
    }

    // ── Project-level ──

    case A.SET_PROJECT:
      return { ...state, project: { ...state.project, ...action.payload } }

    // ── UI (ephemeral) ──

    case A.SET_UI:
      return { ...state, ui: { ...state.ui, ...action.payload } }

    case A.SET_SELECTED_PANELS: {
      const selectedPanels = typeof action.value === 'function' ? action.value(state.ui.selectedPanels) : action.value
      return { ...state, ui: { ...state.ui, selectedPanels } }
    }

    default:
      return state
  }
}
