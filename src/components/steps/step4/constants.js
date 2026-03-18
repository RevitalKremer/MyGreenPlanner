import { DEFAULT_RAIL_OFFSET_CM, DEFAULT_RAIL_OVERHANG_CM, DEFAULT_STOCK_LENGTHS_MM } from '../../../utils/railLayoutService'
import { DEFAULT_BASE_EDGE_OFFSET_MM, DEFAULT_BASE_SPACING_MM, DEFAULT_RAIL_EDGE_DIST_MM, DEFAULT_RAIL_MIN_PORTRAIT, DEFAULT_RAIL_MIN_LANDSCAPE } from '../../../utils/basePlanService'

export const ACCENT = '#C4D600'

export const SETTINGS_DEFAULTS = {
  // Trapezoids & Rails (detail tab)
  railOffsetCm:     DEFAULT_RAIL_OFFSET_CM,
  connOffsetCm:     5,
  panelLengthCm:    238.2,
  blockHeightCm:    30,
  blockWidthCm:     70,
  connEdgeDistMm:   DEFAULT_RAIL_EDGE_DIST_MM,
  connMinPortrait:  DEFAULT_RAIL_MIN_PORTRAIT,
  connMinLandscape: DEFAULT_RAIL_MIN_LANDSCAPE,
  // Rails (rails tab)
  railOverhangCm:   DEFAULT_RAIL_OVERHANG_CM,
  stockLengths:     DEFAULT_STOCK_LENGTHS_MM,
  // Bases (bases tab)
  edgeOffsetMm:     DEFAULT_BASE_EDGE_OFFSET_MM,
  spacingMm:        DEFAULT_BASE_SPACING_MM,
  maxSpanCm:        165,
}

export const PARAM_GROUP = {
  railOffsetCm:     'rail-clamp',    // detail tab: panel-rear clamp area
  connOffsetCm:     'cross-rails',   // detail tab: cross-rail rects
  connEdgeDistMm:   'cross-rails',
  connMinPortrait:  'cross-rails',
  connMinLandscape: 'cross-rails',
  panelLengthCm:    'panel',         // detail tab: panel bars
  blockHeightCm:    'blocks',        // detail tab: block rects
  blockWidthCm:     'blocks',
  railOverhangCm:   'rail-ends',     // rails tab + rows tab
  stockLengths:     'rail-cuts',     // rails tab: cut segment labels
  edgeOffsetMm:     'base-edges',    // bases tab: first & last base
  spacingMm:        'base-spacing',  // bases tab: dimension annotations
  maxSpanCm:        'trap-spacing',  // layout tab + bases tab
}
