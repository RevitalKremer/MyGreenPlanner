import { computeRowRailLayout, localToScreen, DEFAULT_RAIL_OVERHANG_CM, getPanelOrientation } from './railLayoutService'

export const DEFAULT_BASE_EDGE_OFFSET_MM  = 300   // 30 cm from each end
export const DEFAULT_BASE_SPACING_MM      = 2000  // max 2 m between bases
export const DEFAULT_BASE_OVERHANG_CM     = 5     // cm from rail center to base end (both sides)
export const DEFAULT_RAIL_EDGE_DIST_MM    = 40
export const DEFAULT_RAIL_MIN_PORTRAIT    = 2
export const DEFAULT_RAIL_MIN_LANDSCAPE   = 1

// Compute base placement for one row
// Returns { frame, bases, lines, frameLengthMm, baseCount, edgeOffsetMm, spacingMm, lastGapMm }
export function computeRowBasePlan(rowPanels, pixelToCmRatio, railConfig = {}, baseConfig = {}) {
  if (!rowPanels || rowPanels.length === 0 || !pixelToCmRatio) return null

  const edgeOffsetMm = baseConfig.edgeOffsetMm ?? DEFAULT_BASE_EDGE_OFFSET_MM
  const spacingMm    = baseConfig.spacingMm    ?? DEFAULT_BASE_SPACING_MM

  const rl = computeRowRailLayout(rowPanels, pixelToCmRatio, railConfig)
  if (!rl) return null

  const { frame, panelLocalRects } = rl
  const { center, angleRad, localBounds } = frame

  // Per-line bounds (local Y extents) and orientation
  const lineMap = {}
  for (const pr of panelLocalRects) {
    const li = pr.line ?? 0
    if (!lineMap[li]) lineMap[li] = { lineIdx: li, minY: Infinity, maxY: -Infinity, orientation: null }
    lineMap[li].minY = Math.min(lineMap[li].minY, pr.localY)
    lineMap[li].maxY = Math.max(lineMap[li].maxY, pr.localY + pr.height)
  }
  for (const li of Object.keys(lineMap)) {
    const lineIdx = Number(li)
    const panel = rowPanels.find(p => (p.line ?? 0) === lineIdx) || rowPanels[0]
    lineMap[li].orientation = getPanelOrientation(panel)
  }
  const lines = Object.values(lineMap).sort((a, b) => a.lineIdx - b.lineIdx)

  const railOverhangCm = railConfig.overhangCm ?? DEFAULT_RAIL_OVERHANG_CM
  const railOverhangPx = railOverhangCm / pixelToCmRatio

  const frameXMinPx  = localBounds.minX - railOverhangPx
  const frameXMaxPx  = localBounds.maxX + railOverhangPx
  const frameLengthPx = frameXMaxPx - frameXMinPx
  const frameLengthMm = Math.round(frameLengthPx * pixelToCmRatio * 10)

  // Even distribution: first base at edgeOffset, last base at (frameLength - edgeOffset),
  // number of spans = ceil(innerSpan / maxSpacing), then divide evenly.
  const innerSpanMm     = frameLengthMm - 2 * edgeOffsetMm
  const numSpans        = Math.max(1, Math.ceil(innerSpanMm / spacingMm))
  const actualSpacingMm = innerSpanMm / numSpans
  const numBases        = numSpans + 1

  const bases = []
  for (let i = 0; i < numBases; i++) {
    const offsetFromStartMm = Math.round(edgeOffsetMm + i * actualSpacingMm)
    const xPx = frameXMinPx + (offsetFromStartMm / 10) / pixelToCmRatio
    const screenTop    = localToScreen({ x: xPx, y: localBounds.minY }, center, angleRad)
    const screenBottom = localToScreen({ x: xPx, y: localBounds.maxY }, center, angleRad)
    bases.push({ localX: xPx, screenTop, screenBottom, offsetFromStartMm })
  }

  const lastGapMm = edgeOffsetMm  // by definition, last base is always at edgeOffset from right end

  return {
    frame: { center, angleRad, localBounds, frameXMinPx, frameXMaxPx },
    lines,
    bases,
    frameLengthMm,
    baseCount: bases.length,
    edgeOffsetMm,
    spacingMm: Math.round(actualSpacingMm),
    lastGapMm,
  }
}
