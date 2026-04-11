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

// ─── Diagonal rendering helpers ───────────────────────────────────────────────

/**
 * Calculate diagonal pixel positions from leg data and percentages.
 * Diagonal spans FULL BEAM (start of left leg to end of right leg) to match backend.
 * @param {number}   spanIdx      - span index (between legs i and i+1)
 * @param {number}   topPct       - top attachment point as percentage of span (0-1)
 * @param {number}   botPct       - bottom attachment point as percentage of span (0-1)
 * @param {number[]} legXs        - left edge X positions of all legs (px)
 * @param {number[]} legEndXs     - right edge X positions of all legs (px)
 * @param {number[]} legHeights   - heights of all legs (px)
 * @param {number}   baseY        - base beam Y position (px)
 * @param {number}   beamThickPx  - beam thickness (px)
 * @returns {{ xA, xB, spanW, topX, botX, topY, botY }} - pixel coordinates for diagonal rendering
 */
export const calculateDiagonalPosition = ({
  spanIdx,
  topPct,
  botPct,
  legXs,
  legEndXs,
  legHeights,
  baseY,
  beamThickPx,
}) => {
  const xA = legXs[spanIdx]
  const xB = legEndXs[spanIdx + 1]
  const spanW = xB - xA
  const topX = xA + topPct * spanW
  const botX = xA + botPct * spanW
  const hA = legHeights[spanIdx] ?? 0
  const hB = legHeights[spanIdx + 1] ?? 0
  const topY = baseY - (hA + topPct * (hB - hA))
  const botY = baseY + beamThickPx / 2
  return { xA, xB, spanW, topX, botX, topY, botY }
}
