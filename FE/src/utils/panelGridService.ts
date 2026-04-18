import { PANEL_V, PANEL_H, PANEL_EV, PANEL_EH } from './panelCodes.js'

/**
 * Builds the panelGrid entry for a single area.
 *
 * @param {object} area          - rectArea object (xDir, yDir, rotation, vertices, ...)
 * @param {Array}  computed      - all panels produced by computePolygonPanels (default positions)
 * @param {Array}  filtered      - panels that survived the overlap filter (actual positions)
 * @param {number} [pixelToCmRatio] - cm per pixel (cm/px); required for rowPositions
 * @returns {{ startCorner: string, areaAngle: number, rows: string[][], rowPositions?: object }}
 */
export function buildPanelGrid(area, computed, filtered, pixelToCmRatio) {
  const filteredKeys = new Set(filtered.map(p => `${p.row}_${p.coveredCols?.[0] ?? p.col ?? 0}`))
  const allRows = [...new Set(computed.map(p => p.row))].sort((a, b) => a - b)
  const rowColMap = new Map()
  computed.forEach(p => {
    const col = p.coveredCols?.[0] ?? p.col ?? 0
    if (!rowColMap.has(p.row)) rowColMap.set(p.row, [])
    rowColMap.get(p.row).push({ col, p })
  })
  const rows = allRows.map(rowIdx => {
    const cols = (rowColMap.get(rowIdx) || []).sort((a, b) => a.col - b.col)
    return cols.map(({ col, p }) => {
      const isPortrait = p.heightCm > p.widthCm
      const inFiltered = filteredKeys.has(`${rowIdx}_${col}`)
      return inFiltered ? (isPortrait ? PANEL_V : PANEL_H) : (isPortrait ? PANEL_EV : PANEL_EH)
    })
  })
  const xCode = area.xDir === 'rtl' ? 'R' : 'L'
  const yCode = area.yDir === 'btt' ? 'B' : 'T'

  // ── rowPositions: absolute cm from start corner to leading edge of each cell ──
  const rowPositions = buildRowPositions(area, computed, filtered, pixelToCmRatio)

  const effectiveAngle = (area.areaVertical ? 90 : 0) + (area.rotation ?? 0)
  const result = { startCorner: `${yCode}${xCode}`, areaAngle: effectiveAngle, rows }
  if (rowPositions) result.rowPositions = rowPositions
  return result
}

/**
 * Computes rowPositions for any row where at least one panel deviates >1 cm
 * from its default (computed) position along the row axis.
 *
 * Returns null when no deviations exist or when required params are missing.
 *
 * @param {object} area
 * @param {Array}  computed  - panels at default positions (from computePolygonPanels)
 * @param {Array}  filtered  - panels at actual (possibly moved) positions
 * @param {number} pixelToCmRatio - cm/pixel
 * @returns {object|null}  { rowIdx: [pos0, pos1, ...] } or null
 */
function buildRowPositions(area, computed, filtered, pixelToCmRatio) {
  if (!pixelToCmRatio || pixelToCmRatio <= 0) return null
  if (!area.vertices || area.vertices.length < 3) return null

  const { vertices, rotation = 0, xDir = 'ltr', areaVertical = false } = area
  const effectiveRotation = (areaVertical ? 90 : 0) + rotation
  const rotRad = (effectiveRotation * Math.PI) / 180
  const cosF = Math.cos(-rotRad), sinF = Math.sin(-rotRad)

  // Area centroid — same as in computePolygonPanels
  const cxAvg = vertices.reduce((s, v) => s + v.x, 0) / vertices.length
  const cyAvg = vertices.reduce((s, v) => s + v.y, 0) / vertices.length

  // Screen → local X transform
  const toLocalX = (cx, cy) => (cx - cxAvg) * cosF - (cy - cyAvg) * sinF

  // Bounding box X from vertices (matches computePolygonPanels)
  const minLX = Math.min(...vertices.map(v => toLocalX(v.x, v.y)))
  const maxLX = Math.max(...vertices.map(v => toLocalX(v.x, v.y)))
  const isRtl = xDir === 'rtl'

  // Converts a panel's screen-space center to cm position from the area start corner
  const toCmPos = (cx, cy, widthCm) => {
    const lx = toLocalX(cx, cy)
    // panelW in pixels: widthCm (cm) / (cm/px) = px
    const panelW = widthCm / pixelToCmRatio
    // Leading edge local X
    const leadLX = isRtl ? lx + panelW / 2 : lx - panelW / 2
    // Distance from start corner in cm
    return isRtl
      ? (maxLX - leadLX) * pixelToCmRatio
      : (leadLX - minLX) * pixelToCmRatio
  }

  // Panel center: use x+width/2 rather than cx because cx is not updated after drag
  const centerX = p => p.x + p.width / 2
  const centerY = p => p.y + p.height / 2

  // Build "col key → default cm position" lookup from computed panels
  const defaultPos = new Map()
  computed.forEach(p => {
    const col = p.coveredCols?.[0] ?? p.col ?? 0
    defaultPos.set(`${p.row}_${col}`, toCmPos(centerX(p), centerY(p), p.widthCm))
  })

  // Group filtered panels by row
  const rowGroups = new Map()
  filtered.forEach(p => {
    if (!rowGroups.has(p.row)) rowGroups.set(p.row, [])
    rowGroups.get(p.row).push(p)
  })

  const result = {}

  rowGroups.forEach((panels, rowIdx) => {
    const sorted = [...panels].sort((a, b) => {
      const ca = a.coveredCols?.[0] ?? a.col ?? 0
      const cb = b.coveredCols?.[0] ?? b.col ?? 0
      return ca - cb
    })

    const actualPos = sorted.map(p => toCmPos(centerX(p), centerY(p), p.widthCm))

    // Check deviation against default positions
    const hasDeviation = sorted.some((p, i) => {
      const col = p.coveredCols?.[0] ?? p.col ?? 0
      const def = defaultPos.get(`${rowIdx}_${col}`)
      if (def == null) return false
      return Math.abs(actualPos[i] - def) > 1.0
    })

    if (hasDeviation) {
      result[rowIdx] = actualPos.map(pos => Math.round(pos * 10) / 10)
    }
  })

  return Object.keys(result).length > 0 ? result : null
}
