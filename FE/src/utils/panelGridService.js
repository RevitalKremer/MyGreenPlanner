/**
 * Builds the panelGrid entry for a single area.
 *
 * @param {object} area      - rectArea object (xDir, yDir, rotation, ...)
 * @param {Array}  computed  - all panels produced by computePolygonPanels (before overlap filter)
 * @param {Array}  filtered  - panels that survived the overlap filter
 * @returns {{ startCorner: string, areaAngle: number, rows: string[][] }}
 */
export function buildPanelGrid(area, computed, filtered) {
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
      const isPortrait = (p.heightCm ?? 238.2) > 150
      const inFiltered = filteredKeys.has(`${rowIdx}_${col}`)
      return inFiltered ? (isPortrait ? 'V' : 'H') : (isPortrait ? 'EV' : 'EH')
    })
  })
  const xSide = area.xDir === 'rtl' ? 'right' : 'left'
  const ySide = area.yDir === 'btt' ? 'bottom' : 'top'
  return { startCorner: `${xSide}-${ySide}`, areaAngle: area.rotation ?? 0, rows }
}
