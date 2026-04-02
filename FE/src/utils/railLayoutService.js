// Derive rail offset from panel edge given spacing and panel depth
export function railOffsetFromSpacing(panelDepthCm, spacingCm) {
  return Math.max(0, (panelDepthCm - spacingCm) / 2)
}

// Build default lineRails for each panel line based on orientation and depths
// lineOrientations: array of 'vertical'|'horizontal'|'empty'
// panelDepthsCm: array of depths per line (same length)
// railSpacingV / railSpacingH: default spacing from server app_settings
// Returns: { [lineIdx]: [offsetCm, offsetCm] }
export function initDefaultLineRails(lineOrientations, panelDepthsCm, railSpacingV, railSpacingH) {
  const result = {}
  lineOrientations.forEach((orientation, i) => {
    const depth = panelDepthsCm[i]
    const spacing = orientation === 'horizontal' ? railSpacingH : railSpacingV
    const offset = railOffsetFromSpacing(depth, spacing)
    result[i] = [offset, depth - offset]
  })
  return result
}

// Transform screen-space point to local frame (inverse rotation around center)
export function screenToLocal(point, center, angleRad) {
  const dx = point.x - center.x
  const dy = point.y - center.y
  return {
    x:  dx * Math.cos(angleRad) + dy * Math.sin(angleRad),
    y: -dx * Math.sin(angleRad) + dy * Math.cos(angleRad),
  }
}

// Transform local frame point back to screen space
export function localToScreen(point, center, angleRad) {
  return {
    x: center.x + point.x * Math.cos(angleRad) - point.y * Math.sin(angleRad),
    y: center.y + point.x * Math.sin(angleRad) + point.y * Math.cos(angleRad),
  }
}

// Detect orientation from panel physical dimensions
export function getPanelOrientation(panel) {
  return panel.widthCm < panel.heightCm ? 'PORTRAIT' : 'LANDSCAPE'
}

// Split a length in mm into stock segments (greedy, largest-first)
export function splitIntoStockSegments(lengthMm, stockLengths) {
  const sorted = [...stockLengths].sort((a, b) => b - a)
  const segments = []
  let remaining = Math.round(lengthMm)
  while (remaining > 0) {
    const largest = sorted[0]
    if (largest <= remaining) {
      segments.push({ stock: largest, used: largest, leftover: 0 })
      remaining -= largest
    } else {
      segments.push({ stock: largest, used: remaining, leftover: largest - remaining })
      remaining = 0
    }
  }
  return segments
}

// Main: compute rail layout for one row's panels
// railConfig.lineRails: { [lineIdx]: [offsetCm, ...] }  — rail positions from line's front edge
// railConfig.overhangCm: rail overhang beyond panel extents
// railConfig.stockLengths: available stock lengths in mm
export function computeRowRailLayout(rowPanels, pixelToCmRatio, railConfig = {}) {
  if (!rowPanels || rowPanels.length === 0 || !pixelToCmRatio) return null
  if (!railConfig.stockLengths || !railConfig.overhangCm) return null

  const railOverhangCm = railConfig.overhangCm
  const stockLengths   = railConfig.stockLengths
  const lineRails      = railConfig.lineRails      ?? null   // { [lineIdx]: [offsetCm, ...] }
  const railSpacingV   = railConfig.railSpacingV
  const railSpacingH   = railConfig.railSpacingH
  const railOverhangPx = railOverhangCm / pixelToCmRatio

  const angleRad = (rowPanels[0].rotation || 0) * Math.PI / 180

  // Row center = mean of all panel centers
  const center = {
    x: rowPanels.reduce((s, p) => s + p.x + p.width / 2, 0) / rowPanels.length,
    y: rowPanels.reduce((s, p) => s + p.y + p.height / 2, 0) / rowPanels.length,
  }

  // Transform panels to local frame
  const panelLocalRects = rowPanels.map(p => {
    const localCenter = screenToLocal({ x: p.x + p.width / 2, y: p.y + p.height / 2 }, center, angleRad)
    return {
      id: p.id,
      localX: localCenter.x - p.width / 2,
      localY: localCenter.y - p.height / 2,
      width: p.width,
      height: p.height,
      line: p.line ?? 0,
    }
  })

  // Overall local bounds
  const localBounds = {
    minX: Math.min(...panelLocalRects.map(r => r.localX)),
    maxX: Math.max(...panelLocalRects.map(r => r.localX + r.width)),
    minY: Math.min(...panelLocalRects.map(r => r.localY)),
    maxY: Math.max(...panelLocalRects.map(r => r.localY + r.height)),
  }

  // Group by line
  const lineGroups = {}
  for (const pr of panelLocalRects) {
    const li = pr.line
    if (!lineGroups[li]) lineGroups[li] = []
    lineGroups[li].push(pr)
  }

  const rails = []
  let railCounter = 1

  for (const lineIdxStr of Object.keys(lineGroups).sort((a, b) => Number(a) - Number(b))) {
    const lineIdx = Number(lineIdxStr)
    const lineRects = lineGroups[lineIdx]
    const samplePanel = rowPanels.find(p => (p.line ?? 0) === lineIdx) || rowPanels[0]
    const orientation = getPanelOrientation(samplePanel)

    const lineMinY = Math.min(...lineRects.map(r => r.localY))
    const lineMaxY = Math.max(...lineRects.map(r => r.localY + r.height))
    const lineDepthPx = lineMaxY - lineMinY

    // Rail y-positions: from lineRails config or fall back to default symmetric placement
    let railYPositions
    if (lineRails && lineRails[lineIdx] && lineRails[lineIdx].length >= 2) {
      railYPositions = lineRails[lineIdx].map(offsetCm => lineMaxY - offsetCm / pixelToCmRatio)
    } else {
      const spacing = orientation === 'LANDSCAPE' ? railSpacingH : railSpacingV
      const offsetPx = Math.max(0, (lineDepthPx - spacing / pixelToCmRatio) / 2)
      railYPositions = [lineMinY + offsetPx, lineMaxY - offsetPx]
    }

    for (const railY of railYPositions) {
      // x-extent: all panels across ALL lines that span this y
      let xMin = Infinity, xMax = -Infinity
      for (const pr of panelLocalRects) {
        if (railY >= pr.localY - 0.5 && railY <= pr.localY + pr.height + 0.5) {
          xMin = Math.min(xMin, pr.localX)
          xMax = Math.max(xMax, pr.localX + pr.width)
        }
      }
      if (xMin === Infinity) continue

      xMin -= railOverhangPx
      xMax += railOverhangPx

      const lengthPx  = xMax - xMin
      const lengthCm  = lengthPx * pixelToCmRatio
      const lengthMm  = Math.round(lengthCm * 10)

      const segments     = splitIntoStockSegments(lengthMm, stockLengths)
      const stockPieces  = segments.map(s => s.used)
      const totalLeftover = segments.reduce((s, seg) => s + seg.leftover, 0)

      const localStart  = { x: xMin, y: railY }
      const localEnd    = { x: xMax, y: railY }
      const screenStart = localToScreen(localStart, center, angleRad)
      const screenEnd   = localToScreen(localEnd,   center, angleRad)

      rails.push({
        railId: `R${railCounter++}`,
        lineIdx,
        orientation,
        localStart,
        localEnd,
        screenStart,
        screenEnd,
        lengthCm: Math.round(lengthCm * 10) / 10,
        stockSegmentsMm: stockPieces,
        leftoverCm: Math.round(totalLeftover) / 10,
      })
    }
  }

  return { frame: { center, angleRad, localBounds }, panelLocalRects, rails }
}

/**
 * Count panel boundaries where the gap exceeds the default, using pre-transformed local rects.
 * Accepts panelLocalRects from computeRowRailLayout (each has .localX, .width, .line).
 * Returns total count across all lines.
 * @param {object[]} panelLocalRects  - from rl.panelLocalRects
 * @param {number}   pixelToCmRatio
 * @param {number}   defaultGapCm     - expected gap (panelGapCm from app_settings)
 */
export function countLargeGaps(panelLocalRects, pixelToCmRatio, defaultGapCm) {
  if (!panelLocalRects || panelLocalRects.length < 2 || !pixelToCmRatio) return 0

  const threshold = defaultGapCm + 0.5   // 0.5 cm tolerance for float noise

  // Group by line
  const lineGroups = {}
  for (const pr of panelLocalRects) {
    const li = pr.line ?? 0
    if (!lineGroups[li]) lineGroups[li] = []
    lineGroups[li].push(pr)
  }

  let count = 0
  for (const linePanels of Object.values(lineGroups)) {
    const sorted = [...linePanels].sort((a, b) => a.localX - b.localX)
    for (let j = 1; j < sorted.length; j++) {
      const gapCm = (sorted[j].localX - (sorted[j - 1].localX + sorted[j - 1].width)) * pixelToCmRatio
      if (gapCm > threshold) count++
    }
  }
  return count
}
