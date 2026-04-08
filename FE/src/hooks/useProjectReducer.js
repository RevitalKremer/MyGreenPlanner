/**
 * Project state reducer — single source of truth for all project data.
 * State shape mirrors the server's DB columns (layout, data, navigation).
 * Each dispatch carries a step ID; the reducer rejects writes to the wrong step.
 */

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
      panelType: null,
      panelWidthCm: null,
      panelLengthCm: null,
      defaultFrontHeightCm: 0,
      defaultAngleDeg: 0,
      areas: [],
      trapezoids: [],
    },
    step3: {
      globalSettings: null,
      areaSettings: null,
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
  },
}


export function projectReducer(state, action) {
  // ── Step enforcement ──
  // Data-write actions with a step ID are rejected if that step is past the current step.
  // Navigation and lifecycle actions are always allowed.
  const EXEMPT_ACTIONS = ['SET_STEP', 'SET_TAB', 'LOAD_PROJECT', 'RESET']
  if (action.step != null && action.step > state.navigation.step && !EXEMPT_ACTIONS.includes(action.type)) {
    return state  // silently reject — wrong step
  }

  switch (action.type) {

    // ── Project lifecycle ──

    case 'LOAD_PROJECT':
      return {
        ...state,
        layout: action.layout ?? state.layout,
        data: action.data ?? state.data,
        navigation: action.navigation ?? state.navigation,
      }

    case 'RESET':
      return { ...initialProjectState }

    // ── Navigation ──

    case 'SET_STEP':
      return { ...state, navigation: { ...state.navigation, step: action.step } }

    case 'SET_TAB':
      return { ...state, navigation: { ...state.navigation, tab: action.tab } }

    // ── Step 3 settings ──

    case 'SET_STEP3_GLOBAL_SETTINGS':
      return {
        ...state,
        data: { ...state.data, step3: { ...state.data.step3, globalSettings: action.value } },
      }

    case 'SET_STEP3_AREA_SETTINGS':
      return {
        ...state,
        data: { ...state.data, step3: { ...state.data.step3, areaSettings: action.value } },
      }

    // ── Step 4 ──

    case 'SET_PLAN_APPROVAL':
      return {
        ...state,
        data: { ...state.data, step4: { ...state.data.step4, planApproval: action.value } },
      }

    // ── Step 5 ──

    case 'SET_BOM_DELTAS':
      return {
        ...state,
        data: { ...state.data, step5: { ...state.data.step5, bomDeltas: action.value } },
      }

    // ── UI (ephemeral) ──

    case 'SET_UI':
      return { ...state, ui: { ...state.ui, ...action.payload } }

    default:
      return state
  }
}
