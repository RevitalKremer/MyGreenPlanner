// Panel physical dimensions (cm)
export const PANEL_DEPTH_VERTICAL   = 238.2  // slope depth for portrait orientation
export const PANEL_DEPTH_HORIZONTAL = 113.4  // slope depth for landscape orientation

// ─── Orientation predicates ──────────────────────────────────────────────────

export const isHorizontalOrientation = (o) =>
  o === 'horizontal' || o === 'empty-horizontal'

export const isEmptyOrientation = (o) =>
  o === 'empty' || o === 'empty-vertical' || o === 'empty-horizontal'

/** Slope depth (cm) for a single line orientation */
export const lineSlopeDepth = (o) =>
  isHorizontalOrientation(o) ? PANEL_DEPTH_HORIZONTAL : PANEL_DEPTH_VERTICAL

// ─── Orientation toggles ──────────────────────────────────────────────────────

/** Cycle portrait ↔ landscape (preserving empty state) */
export const toggleOrientation = (o) =>
  o === 'vertical'       ? 'horizontal'       :
  o === 'horizontal'     ? 'vertical'         :
  o === 'empty-vertical' ? 'empty-horizontal' :
  o === 'empty-horizontal' ? 'empty-vertical' : 'vertical'

/** Toggle empty on/off (preserving portrait/landscape) */
export const toggleEmptyOrientation = (o) =>
  o === 'vertical'         ? 'empty-vertical'   :
  o === 'horizontal'       ? 'empty-horizontal'  :
  o === 'empty-vertical'   ? 'vertical'          :
  o === 'empty-horizontal' ? 'horizontal'        : 'vertical'

// ─── Slope / back-height calculations ────────────────────────────────────────

/**
 * Total slope depth (cm) across all lines including inter-line gaps.
 * @param {string[]} orientations - array of orientation strings
 * @param {number}   linesPerRow  - how many lines to use (slices the array)
 */
export const computeTotalSlopeDepth = (orientations, linesPerRow, panelGapCm) => {
  const orients = (orientations || ['vertical']).slice(0, linesPerRow)
  const slopeSum = orients.reduce((s, o) => s + lineSlopeDepth(o), 0)
  return slopeSum + Math.max(0, orients.length - 1) * panelGapCm
}

/**
 * Panel back-edge height from floor (cm).
 * @param {number}   panelFrontHeight - panel front edge height from floor (cm)
 * @param {number}   angle            - tilt angle in degrees
 * @param {string[]} orientations     - line orientations
 * @param {number}   linesPerRow
 */
export const computePanelBackHeight = (panelFrontHeight, angle, orientations, linesPerRow, panelGapCm) => {
  const angleRad = (angle || 0) * Math.PI / 180
  return panelFrontHeight + computeTotalSlopeDepth(orientations, linesPerRow, panelGapCm) * Math.sin(angleRad)
}
