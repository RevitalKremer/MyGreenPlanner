import { isHorizontalOrientation, isEmptyOrientation, PANEL_V } from './panelCodes.js'

// Re-export for backward compatibility with existing imports
export { isHorizontalOrientation, isEmptyOrientation }

/** Slope depth (cm) for a single line orientation */
export const lineSlopeDepth = (o, panelLengthCm, panelWidthCm) =>
  isHorizontalOrientation(o) ? panelWidthCm : panelLengthCm

// ─── Slope / back-height calculations ────────────────────────────────────────

/**
 * Total slope depth (cm) across all lines including inter-line gaps.
 * @param {string[]} orientations - array of orientation strings (length = number of lines)
 * @param {number}   lineGapCm   - gap between lines (not within a line)
 * @param {number}   panelLengthCm
 * @param {number}   panelWidthCm
 */
export const computeTotalSlopeDepth = (orientations, lineGapCm, panelLengthCm, panelWidthCm) => {
  const orients = orientations || [PANEL_V]
  const slopeSum = orients.reduce((s, o) => s + lineSlopeDepth(o, panelLengthCm, panelWidthCm), 0)
  return slopeSum + Math.max(0, orients.length - 1) * lineGapCm
}

/**
 * Panel back-edge height from floor (cm).
 * @param {number}   panelFrontHeight - panel front edge height from floor (cm)
 * @param {number}   angle            - tilt angle in degrees
 * @param {string[]} orientations     - line orientations (length = number of lines)
 * @param {number}   lineGapCm        - gap between lines
 * @param {number}   panelLengthCm
 * @param {number}   panelWidthCm
 */
export const computePanelBackHeight = (panelFrontHeight, angle, orientations, lineGapCm, panelLengthCm, panelWidthCm) => {
  const angleRad = (angle || 0) * Math.PI / 180
  return panelFrontHeight + computeTotalSlopeDepth(orientations, lineGapCm, panelLengthCm, panelWidthCm) * Math.sin(angleRad)
}
