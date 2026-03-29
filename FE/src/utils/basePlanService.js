import { computeRowRailLayout, localToScreen, getPanelOrientation } from './railLayoutService'

export const DEFAULT_RAIL_EDGE_DIST_MM    = 40
export const DEFAULT_RAIL_MIN_PORTRAIT    = 2
export const DEFAULT_RAIL_MIN_LANDSCAPE   = 1

// Compute base placement for one row
// Returns { frame, bases, lines, frameLengthMm, baseCount, edgeOffsetMm, spacingMm, lastGapMm }
export function computeRowBasePlan(rowPanels, pixelToCmRatio, railConfig = {}, baseConfig = {}) {
  if (!rowPanels || rowPanels.length === 0 || !pixelToCmRatio) return null
  if (!baseConfig.customOffsets || baseConfig.customOffsets.length === 0) return null

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
  // Sort by physical position (minY) so lines[0] is always the rearmost (topmost in image)
  // regardless of lineIdx ordering, which differs between yDir='ttb' and yDir='btt' areas.
  const lines = Object.values(lineMap).sort((a, b) => a.minY - b.minY)

  // Frame spans panel edges (not rail ends)
  const frameXMinPx   = localBounds.minX
  const frameXMaxPx   = localBounds.maxX
  const frameLengthPx = frameXMaxPx - frameXMinPx
  const frameLengthMm = Math.round(frameLengthPx * pixelToCmRatio * 10)

  // Determine X direction from panels — for RTL areas (BR/TR), offset grows from maxX toward minX
  const xDir = rowPanels[0]?.xDir ?? 'ltr'
  const isRtl = xDir === 'rtl'

  // Convert BE-provided offsets (mm) to pixel coordinates for SVG rendering
  const makeBase = (offsetFromStartMm) => {
    const xPx = isRtl
      ? frameXMaxPx - (offsetFromStartMm / 10) / pixelToCmRatio
      : frameXMinPx + (offsetFromStartMm / 10) / pixelToCmRatio
    const screenTop    = localToScreen({ x: xPx, y: localBounds.minY }, center, angleRad)
    const screenBottom = localToScreen({ x: xPx, y: localBounds.maxY }, center, angleRad)
    return { localX: xPx, screenTop, screenBottom, offsetFromStartMm }
  }

  const bases = baseConfig.customOffsets.map(makeBase)
  const actualSpacingMm = bases.length > 1
    ? Math.max(...bases.slice(1).map((b, i) => b.offsetFromStartMm - bases[i].offsetFromStartMm))
    : 0

  return {
    frame: { center, angleRad, localBounds, frameXMinPx, frameXMaxPx },
    lines,
    bases,
    frameLengthMm,
    baseCount: bases.length,
    spacingMm: Math.round(actualSpacingMm),
    isRtl,
  }
}

/**
 * Consolidate bases across sub-areas within the same area.
 * Within each area group, if a base from a shallower sub-area falls within a deeper
 * sub-area's x-extent, the shallower base is removed.
 *
 * @param {Object} areaTrapsMap  { areaKey: [trapId, ...] }
 * @param {Object} basePlansMap  { trapId: basePlan }
 * @returns {Object} { trapId: filteredBases[] }
 */
export function consolidateAreaBases(areaTrapsMap, basePlansMap) {
  // Start with a copy of all bases
  const result = {}
  for (const [trapId, bp] of Object.entries(basePlansMap)) {
    if (bp) result[trapId] = [...bp.bases]
  }

  for (const trapIds of Object.values(areaTrapsMap)) {
    if (trapIds.length <= 1) continue

    // Build per-trap metadata for comparison
    const trapInfos = trapIds.map(trapId => {
      const bp = basePlansMap[trapId]
      if (!bp) return null
      const { frame } = bp
      const depth = frame.localBounds.maxY - frame.localBounds.minY
      const width = frame.frameXMaxPx - frame.frameXMinPx
      const { angleRad } = frame
      const centerProj = frame.center.x * Math.cos(angleRad) + frame.center.y * Math.sin(angleRad)
      const xProjMin = centerProj + frame.frameXMinPx
      const xProjMax = centerProj + frame.frameXMaxPx
      return { trapId, depth, width, angleRad, xProjMin, xProjMax }
    }).filter(Boolean)

    // For each trap, remove bases that fall strictly within a "winning" trap's x-extent
    for (const infoA of trapInfos) {
      result[infoA.trapId] = result[infoA.trapId].filter(base => {
        const xProjBase = base.screenTop.x * Math.cos(infoA.angleRad) + base.screenTop.y * Math.sin(infoA.angleRad)
        for (const infoB of trapInfos) {
          if (infoB.trapId === infoA.trapId) continue
          if (xProjBase > infoB.xProjMin && xProjBase < infoB.xProjMax) {
            // B wins if deeper, or same depth but wider x-extent
            if (infoB.depth > infoA.depth || (infoB.depth === infoA.depth && infoB.width >= infoA.width)) {
              return false
            }
          }
        }
        return true
      })
    }
  }

  return result
}
