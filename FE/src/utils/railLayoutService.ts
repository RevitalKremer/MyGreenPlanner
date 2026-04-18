import { PANEL_H } from './panelCodes.js'

/**
 * Build a lineRails map ({ lineIdx: [offsetCm, ...] }) from BE-computed rails.
 * Works for ALL roof types — no trap config needed.
 *
 * @param {object[]} beRailsData - flat array of BE area rail objects (from App.jsx applyBeResult)
 * @param {string}   areaLabel   - label of the area to look up
 * @param {number}   [panelRowIdx=0] - physical row index within the area
 * @returns {object|null} { lineIdx: [sortedOffsets] } or null if not found
 */
export function buildLineRailsFromBE(beRailsData, areaLabel, panelRowIdx = 0) {
  if (!beRailsData) return null
  const beArea = beRailsData.find(a => a.areaLabel === areaLabel)
  if (!beArea) return null
  const rails = (beArea.rails ?? []).filter(r => (r._panelRowIdx ?? 0) === panelRowIdx)
  if (!rails.length) return null
  const map = {}
  for (const r of rails) {
    if (!map[r.lineIdx]) map[r.lineIdx] = []
    map[r.lineIdx].push(r.offsetFromLineFrontCm)
  }
  for (const li of Object.keys(map)) map[li] = [...map[li]].sort((a, b) => a - b)
  return Object.keys(map).length > 0 ? map : null
}

// Derive rail offset from panel edge given spacing and panel depth
export function railOffsetFromSpacing(panelDepthCm, spacingCm) {
  return Math.max(0, (panelDepthCm - spacingCm) / 2)
}

// Compute local coordinate frame for a group of panels (no rail config needed).
// Returns { center, angleRad, localBounds, panelLocalRects }.
export function computePanelFrame(rowPanels) {
  if (!rowPanels || rowPanels.length === 0) return null
  const angleRad = (rowPanels[0].rotation || 0) * Math.PI / 180
  const center = {
    x: rowPanels.reduce((s, p) => s + p.x + p.width / 2, 0) / rowPanels.length,
    y: rowPanels.reduce((s, p) => s + p.y + p.height / 2, 0) / rowPanels.length,
  }
  const panelLocalRects = rowPanels.map(p => {
    const lc = screenToLocal({ x: p.x + p.width / 2, y: p.y + p.height / 2 }, center, angleRad)
    return { id: p.id, localX: lc.x - p.width / 2, localY: lc.y - p.height / 2, width: p.width, height: p.height, line: p.line ?? 0 }
  })
  const localBounds = {
    minX: Math.min(...panelLocalRects.map(r => r.localX)),
    maxX: Math.max(...panelLocalRects.map(r => r.localX + r.width)),
    minY: Math.min(...panelLocalRects.map(r => r.localY)),
    maxY: Math.max(...panelLocalRects.map(r => r.localY + r.height)),
  }
  return { center, angleRad, localBounds, panelLocalRects }
}

// Build default lineRails for each panel line based on orientation and depths
// lineOrientations: array of panel orientation codes (see panelCodes.js)
// panelDepthsCm: array of depths per line (same length)
// railSpacingV / railSpacingH: default spacing from server app_settings
// Returns: { [lineIdx]: [offsetCm, offsetCm] }
export function initDefaultLineRails(lineOrientations, panelDepthsCm, railSpacingV, railSpacingH) {
  const result = {}
  lineOrientations.forEach((orientation, i) => {
    const depth = panelDepthsCm[i]
    const spacing = orientation === PANEL_H ? railSpacingH : railSpacingV
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
// Internal only — stock splitting for FE preview; BE is source of truth
function splitIntoStockSegments(lengthMm, stockLengths) {
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

/**
 * Build a lookup map for BE rail data, keyed by multiple access patterns:
 *   - `${areaIdx}:${panelRowIdx}:${railId}`
 *   - `${areaLabel}:${panelRowIdx}:${railId}`
 *   - `${areaId}:${panelRowIdx}:${railId}`
 *   - Legacy single-row: `${areaIdx}:${railId}`, `${areaLabel}:${railId}`
 *
 * @param {object[]} beRailsData - array of { areaLabel, areaId, rails: [...] }
 * @returns {object} lookup map
 */
export function buildBeRailLookup(beRailsData) {
  const m = {}
  ;(beRailsData ?? []).forEach((area, idx) => {
    for (const r of (area.rails ?? [])) {
      const pri = r._panelRowIdx ?? 0
      m[`${idx}:${pri}:${r.railId}`] = r
      m[`${area.areaLabel}:${pri}:${r.railId}`] = r
      if (area.areaId != null) m[`${area.areaId}:${pri}:${r.railId}`] = r
      if (!m[`${idx}:${r.railId}`]) m[`${idx}:${r.railId}`] = r
      if (!m[`${area.areaLabel}:${r.railId}`]) m[`${area.areaLabel}:${r.railId}`] = r
    }
  })
  return m
}

/**
 * Build a mapping from areaGroupKey → area label string.
 * Primary: derive from the first panel's trapezoidId (strip trailing digits).
 * Fallback: match unmapped keys to beRailsData entries by order.
 *
 * @param {object[]} panels
 * @param {number[]} rowKeys - sorted area group keys
 * @param {object[]} [beRailsData]
 * @returns {object} { [groupKey]: label }
 */
export function buildGroupKeyToLabelMap(panels, rowKeys, beRailsData) {
  const m = {}
  for (const p of panels) {
    if (p.areaGroupKey != null && p.trapezoidId && !m[p.areaGroupKey]) {
      m[p.areaGroupKey] = p.trapezoidId.replace(/\d+$/, '')
    }
  }
  if (beRailsData) {
    const unmapped = rowKeys.filter(k => !m[k])
    const usedLabels = new Set(Object.values(m))
    const availBE = (beRailsData || []).filter(a => !usedLabels.has(a.areaLabel))
    unmapped.forEach((k, i) => {
      if (availBE[i]) m[k] = availBE[i].areaLabel
    })
  }
  return m
}

/**
 * Build the rail config for one physical row of panels.
 * Resolves which lineRails to use: the editable prop for the active row,
 * or BE-computed positions for all others.
 *
 * @param {object[]} rowPanels - panels in this physical row
 * @param {number}   ri - panelRowIdx
 * @param {object}   opts
 * @param {boolean}  opts.useStored - true if this area is not the selected/editable area
 * @param {number}   opts.selectedPanelRowIdx - currently edited sub-row index
 * @param {object}   opts.lineRails - editable lineRails from the sidebar
 * @param {object[]} opts.beRailsData - BE rail data
 * @param {string}   opts.areaLabel - resolved area label for BE lookup
 * @param {object}   opts.trapSettingsMap - per-trap settings
 * @param {number}   opts.railOverhangCm - global rail overhang
 * @param {number[]} opts.stockLengths - global stock lengths
 * @returns {{ lineRails, overhangCm, stockLengths }}
 */
export function buildRowRailConfig(rowPanels, ri, {
  useStored, selectedPanelRowIdx, lineRails, beRailsData,
  areaLabel, trapSettingsMap, railOverhangCm, stockLengths,
}) {
  const trapId = rowPanels[0]?.trapezoidId
  const isEditableRow = !useStored && ri === selectedPanelRowIdx
  let rowRails
  if (isEditableRow) {
    rowRails = lineRails
  } else {
    rowRails = buildLineRailsFromBE(beRailsData, areaLabel, ri) ?? lineRails
  }
  const ts = (trapId && trapSettingsMap[trapId]) ?? {}
  const stored = !isEditableRow
  return {
    lineRails: rowRails,
    overhangCm: stored ? (ts.railOverhangCm ?? railOverhangCm) : railOverhangCm,
    stockLengths: stored ? (ts.stockLengths ?? stockLengths) : stockLengths,
  }
}

/**
 * Compute rail layouts for all area rows.
 * Expands multi-row areas into separate layout entries.
 *
 * @param {object}   opts
 * @param {number[]} opts.rowKeys - area group keys
 * @param {object}   opts.rowGroups - { [groupKey]: panel[] }
 * @param {number}   opts.pixelToCmRatio
 * @param {number|null} opts.selectedRowIdx
 * @param {number}   opts.selectedPanelRowIdx
 * @param {boolean}  opts.printMode
 * @param {object}   opts.lineRails - editable lineRails
 * @param {object}   opts.trapSettingsMap
 * @param {number}   opts.railOverhangCm
 * @param {number[]} opts.stockLengths
 * @param {object[]} opts.beRailsData
 * @param {object}   opts.groupKeyToLabel - { [groupKey]: areaLabel }
 * @returns {{ railLayouts: object[], railLayoutKeys: number[] }}
 */
export function computeAllRowRailLayouts({
  rowKeys, rowGroups, pixelToCmRatio,
  selectedRowIdx, selectedPanelRowIdx, printMode,
  lineRails, trapSettingsMap, railOverhangCm, stockLengths,
  beRailsData, groupKeyToLabel,
}) {
  const layouts = []
  const layoutKeys = []
  rowKeys.forEach((rowKey, i) => {
    const areaPanels = rowGroups[rowKey] ?? []
    const useStored = i !== selectedRowIdx || printMode
    const panelRowGroups = {}
    for (const p of areaPanels) {
      const ri = p.panelRowIdx ?? 0
      if (!panelRowGroups[ri]) panelRowGroups[ri] = []
      panelRowGroups[ri].push(p)
    }
    const rowIdxKeys = Object.keys(panelRowGroups).map(Number).sort((a, b) => a - b)
    const cfgOpts = {
      useStored, selectedPanelRowIdx, lineRails, beRailsData,
      areaLabel: groupKeyToLabel[rowKey],
      trapSettingsMap, railOverhangCm, stockLengths,
    }
    if (rowIdxKeys.length <= 1) {
      const cfg = buildRowRailConfig(areaPanels, 0, cfgOpts)
      const rl = computeRowRailLayout(areaPanels, pixelToCmRatio, cfg) as any
      if (rl) rl._panelRowIdx = 0
      layouts.push(rl)
      layoutKeys.push(rowKey)
    } else {
      for (const ri of rowIdxKeys) {
        const rowPanels = panelRowGroups[ri]
        const cfg = buildRowRailConfig(rowPanels, ri, cfgOpts)
        const rl = computeRowRailLayout(rowPanels, pixelToCmRatio, cfg) as any
        if (rl) rl._panelRowIdx = ri
        layouts.push(rl)
        layoutKeys.push(rowKey)
      }
    }
  })
  return { railLayouts: layouts, railLayoutKeys: layoutKeys }
}

// Main: compute rail layout for one row's panels
// railConfig.lineRails: { [lineIdx]: [offsetCm, ...] }  — rail positions from line's front edge
// railConfig.overhangCm: rail overhang beyond panel extents
// railConfig.stockLengths: available stock lengths in mm
export function computeRowRailLayout(rowPanels, pixelToCmRatio, railConfig: Record<string, any> = {}) {
  if (!rowPanels || rowPanels.length === 0 || !pixelToCmRatio) return null
  if (!railConfig.stockLengths || !railConfig.overhangCm) return null

  const railOverhangCm = railConfig.overhangCm
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
      })
    }
  }

  return { frame: { center, angleRad, localBounds }, panelLocalRects, rails }
}
