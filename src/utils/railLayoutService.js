export const DEFAULT_RAIL_OFFSET_CM = 49.1
export const DEFAULT_RAIL_OVERHANG_CM = 4
export const DEFAULT_STOCK_LENGTHS_MM = [4800, 6000]

// Transform screen-space point to local frame (inverse rotation around center)
// angleRad is the row's rotation angle in radians
export function screenToLocal(point, center, angleRad) {
  const dx = point.x - center.x
  const dy = point.y - center.y
  return {
    x: dx * Math.cos(angleRad) + dy * Math.sin(angleRad),
    y: -dx * Math.sin(angleRad) + dy * Math.cos(angleRad)
  }
}

// Transform local frame point back to screen space
export function localToScreen(point, center, angleRad) {
  return {
    x: center.x + point.x * Math.cos(angleRad) - point.y * Math.sin(angleRad),
    y: center.y + point.x * Math.sin(angleRad) + point.y * Math.cos(angleRad)
  }
}

// Detect orientation from panel physical dimensions
export function getPanelOrientation(panel) {
  // widthCm < heightCm => PORTRAIT (narrow width along row)
  return (panel.widthCm ?? 113.4) < (panel.heightCm ?? 238.2) ? 'PORTRAIT' : 'LANDSCAPE'
}

// Split a length in mm into stock segments (greedy, largest-first)
// Example: 11800mm, stocks=[4800,6000] => [{stock:6000,used:6000,leftover:0},{stock:6000,used:5800,leftover:200}]
export function splitIntoStockSegments(lengthMm, stockLengths = DEFAULT_STOCK_LENGTHS_MM) {
  const sorted = [...stockLengths].sort((a, b) => b - a) // descending
  const segments = []
  let remaining = Math.round(lengthMm)
  while (remaining > 0) {
    const largest = sorted[0]
    if (largest <= remaining) {
      segments.push({ stock: largest, used: largest, leftover: 0 })
      remaining -= largest
    } else {
      // Cut the largest stock to fit, track leftover
      segments.push({ stock: largest, used: remaining, leftover: largest - remaining })
      remaining = 0
    }
  }
  return segments
}

// Main: compute rail layout for one row's panels
// Returns { frame, panelLocalRects, rails }
// frame: { center, angleRad, localBounds }
// panelLocalRects: [{ id, localX, localY, width, height, line }]  -- localX/localY is top-left in local frame
// rails: [{ railId, lineIdx, orientation, localStart, localEnd, lengthMm, stockSegments, leftoverMm }]
export function computeRowRailLayout(rowPanels, pixelToCmRatio, railConfig = {}) {
  if (!rowPanels || rowPanels.length === 0 || !pixelToCmRatio) return null

  const railOffsetCm = railConfig.offsetFromPanelEdge ?? DEFAULT_RAIL_OFFSET_CM
  const railOverhangCm = railConfig.overhangCm ?? DEFAULT_RAIL_OVERHANG_CM
  const stockLengths = railConfig.stockLengths ?? DEFAULT_STOCK_LENGTHS_MM
  const railOffsetPx = railOffsetCm / pixelToCmRatio
  const railOverhangPx = railOverhangCm / pixelToCmRatio

  const angleRad = (rowPanels[0].rotation || 0) * Math.PI / 180

  // Row center = mean of all panel centers in screen space
  const center = {
    x: rowPanels.reduce((s, p) => s + p.x + p.width / 2, 0) / rowPanels.length,
    y: rowPanels.reduce((s, p) => s + p.y + p.height / 2, 0) / rowPanels.length,
  }

  // Transform each panel to local frame (axis-aligned, no rotation)
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

  // Compute overall local bounds
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
    const orientation = getPanelOrientation(rowPanels.find(p => (p.line ?? 0) === lineIdx) || rowPanels[0])

    // Line y-extent in local frame
    const lineMinY = Math.min(...lineRects.map(r => r.localY))
    const lineMaxY = Math.max(...lineRects.map(r => r.localY + r.height))

    // Every panel needs exactly 2 rails regardless of orientation
    const railYPositions = [lineMinY + railOffsetPx, lineMaxY - railOffsetPx]

    for (const railY of railYPositions) {
      // Clip rail x-extent: find all panels (across ALL lines) that span this y
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

      const lengthPx = xMax - xMin
      const lengthCm = lengthPx * pixelToCmRatio
      const lengthMm = Math.round(lengthCm * 10)

      const segments = splitIntoStockSegments(lengthMm, stockLengths)
      const stockPieces = segments.map(s => s.used)
      const totalLeftover = segments.reduce((s, seg) => s + seg.leftover, 0)

      const localStart = { x: xMin, y: railY }
      const localEnd = { x: xMax, y: railY }
      const screenStart = localToScreen(localStart, center, angleRad)
      const screenEnd = localToScreen(localEnd, center, angleRad)

      rails.push({
        railId: `R${railCounter++}`,
        lineIdx,
        orientation,
        localStart,
        localEnd,
        screenStart,
        screenEnd,
        lengthMm,
        stockSegments: stockPieces,
        leftoverMm: totalLeftover,
      })
    }
  }

  return { frame: { center, angleRad, localBounds }, panelLocalRects, rails }
}
