import { DEFAULT_RAIL_OVERHANG_CM, DEFAULT_STOCK_LENGTHS_MM, MIN_RAIL_SPACING_VERTICAL_CM, MIN_RAIL_SPACING_HORIZONTAL_CM } from '../../../utils/railLayoutService'
import { DEFAULT_BASE_EDGE_OFFSET_MM, DEFAULT_BASE_SPACING_MM, DEFAULT_BASE_OVERHANG_CM, DEFAULT_RAIL_EDGE_DIST_MM } from '../../../utils/basePlanService'

export const ACCENT = '#C4D600'

// Single source of truth for every user-facing setting in Step 4.
// The sidebar, reset logic, and apply-to-all are all driven from this schema.
export const PARAM_SCHEMA = [
  // ── rails · area ─────────────────────────────────────────────────────────
  { key: 'railSpacingV',        label: 'Spacing Vertical (cm)',   section: 'rails',  scope: 'area',   type: 'rail-spacing', orientation: 'vertical',   default: 140, min: MIN_RAIL_SPACING_VERTICAL_CM,   highlightGroup: 'railSpacingV'  },
  { key: 'railSpacingH',        label: 'Spacing Horizontal (cm)', section: 'rails',  scope: 'area',   type: 'rail-spacing', orientation: 'horizontal', default:  70, min: MIN_RAIL_SPACING_HORIZONTAL_CM, highlightGroup: 'railSpacingH'  },
  { key: 'keepSymmetry',        label: 'Keep Symmetry',           section: 'rails',  scope: 'area',   type: 'boolean',                                 default: true                                                           },
  { key: 'railOverhangCm',      label: 'Rail Overhang (cm)',      section: 'rails',  scope: 'area',   type: 'number',   step: 0.5, min: 0,   max: 30,   default: DEFAULT_RAIL_OVERHANG_CM,  highlightGroup: 'rail-ends'     },
  // ── rails · global ────────────────────────────────────────────────────────
  { key: 'crossRailEdgeDistMm', label: 'Rail Profile Size (mm)',  section: 'rails',  scope: 'global', type: 'number',   step: 5,   min: 20,  max: 100,  default: DEFAULT_RAIL_EDGE_DIST_MM, highlightGroup: 'cross-rails'   },
  { key: 'stockLengths',        label: 'Stock Lengths (mm)',      section: 'rails',  scope: 'global', type: 'array',                                   default: DEFAULT_STOCK_LENGTHS_MM,  highlightGroup: 'rail-cuts'     },
  // ── bases · area ─────────────────────────────────────────────────────────
  { key: 'edgeOffsetMm',        label: 'Edge Offset (mm)',        section: 'bases',  scope: 'trapezoid', type: 'number',   step: 10,  min: 0,   max: 1000, default: DEFAULT_BASE_EDGE_OFFSET_MM, highlightGroup: 'base-edges'   },
  { key: 'spacingMm',           label: 'Base Spacing (mm)',       section: 'bases',  scope: 'trapezoid', type: 'number',   step: 50,  min: 100, max: 5000, default: DEFAULT_BASE_SPACING_MM,     highlightGroup: 'base-spacing' },
  { key: 'baseOverhangCm',      label: 'Base Overhang (cm)',      section: 'bases',  scope: 'trapezoid', type: 'number',   step: 0.5, min: 0,   max: 50,   default: DEFAULT_BASE_OVERHANG_CM,    highlightGroup: 'base-overhang'},
  // ── detail · area ─────────────────────────────────────────────────────────
  { key: 'blockHeightCm',       label: 'Block Height (cm)',       section: 'detail', scope: 'area',   type: 'number',   step: 1,   min: 1,   max: 100,  default: 15,  highlightGroup: 'blocks'   },
  { key: 'blockLengthCm',       label: 'Block Length (cm)',       section: 'detail', scope: 'area',   type: 'number',   step: 1,   min: 1,   max: 200,  default: 50,  highlightGroup: 'blocks'   },
  { key: 'blockWidthCm',        label: 'Block Width (cm)',        section: 'detail', scope: 'area',   type: 'number',   step: 1,   min: 5,   max: 200,  default: 24,  highlightGroup: 'blocks'   },
  { key: 'blockPunchCm',        label: 'Block Punch Distance (cm)', section: 'detail', scope: 'area', type: 'number',   step: 0.5, min: 4,   max: 200,  default: 9,   highlightGroup: 'blocks'   },
  { key: 'diagTopPct',          label: 'Diagonal Top (%)',        section: 'detail', scope: 'area',   type: 'number',   step: 1,   min: 0,   max: 100,  default: 25,  highlightGroup: 'diagonal' },
  { key: 'diagBasePct',         label: 'Diagonal Base (%)',       section: 'detail', scope: 'area',   type: 'number',   step: 1,   min: 0,   max: 100,  default: 90,  highlightGroup: 'diagonal' },
]

// Derived from schema — all stored params (rail-spacing is derived, not stored)
export const SETTINGS_DEFAULTS = Object.fromEntries(
  PARAM_SCHEMA
    .filter(p => p.type !== 'rail-spacing')
    .map(p => [p.key, p.default])
)

// Derived from schema — maps param key → diagram highlight group
export const PARAM_GROUP = Object.fromEntries(
  PARAM_SCHEMA
    .filter(p => p.highlightGroup != null)
    .map(p => [p.key, p.highlightGroup])
)
