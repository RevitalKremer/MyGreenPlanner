// Panel physical dimensions (cm)
export const PANEL_WIDTH_CM = 113.4   // along row baseline (portrait orientation)
export const PANEL_GAP_CM = 2.5
export const PANEL_LENGTH_CM = 238.2  // depth along slope

/**
 * Compute full construction geometry for one row.
 * @param {number} panelCount  - number of panels in the row
 * @param {number} angle       - tilt angle in degrees
 * @param {number} frontHeight - front (lower) leg height above block, in cm
 *                               NOTE: this is NOT panelFrontHeight (panel edge from floor).
 *                               Callers must derive: frontHeight = panelFrontHeight - blockHeightCm + railOffsetCm*sin(angle) - crossRailEdgeDistCm*cos(angle)
 *                               where crossRailEdgeDistCm is the cross-rail profile height (leg ends at slope beam top, not panel bottom)
 * @param {object} config      - optional overrides: railOverhang, maxSpan, baseLength
 */
export function computeRowConstruction(panelCount, angle, frontHeight, config = {}) {
  const angleRad = angle * Math.PI / 180
  const railOverhang = config.railOverhang ?? 4  // cm — extension beyond outermost panel on each side
  const maxSpan      = config.maxSpan      ?? 165  // cm max spacing between trapezoids

  // Rail length (total row width including overhang)
  // config.rowLength can be passed from actual panel placement measurements (preferred)
  const rowLength = config.rowLength
    ?? (panelCount * PANEL_WIDTH_CM
    + Math.max(0, panelCount - 1) * PANEL_GAP_CM
    + 2 * railOverhang)

  // Trapezoid base (horizontal depth of frame, cm)
  // Use actual measured line depth if provided (multi-line rows), else single panel length
  const lineDepthCm  = config.lineDepthCm  ?? PANEL_LENGTH_CM
  const railOffsetCm = config.railOffsetCm ?? 0
  const crossRailOffsetCm = config.crossRailOffsetCm ?? 0
  const baseLength   = config.baseLength
    ?? Math.cos(angleRad) * (lineDepthCm - 2 * railOffsetCm)

  // Trapezoid heights
  const heightRear  = frontHeight                                   // low side
  const heightFront = frontHeight + baseLength * Math.tan(angleRad) // high side

  // Member lengths
  const topBeamLength    = Math.sqrt(baseLength ** 2 + (heightFront - heightRear) ** 2)
  // Diagonal: from top of rear leg → bottom of front leg
  const diagonalLength   = Math.sqrt(baseLength ** 2 + heightFront ** 2)

  // Trapezoid count and spacing along row
  const numSpans      = Math.max(1, Math.ceil(rowLength / maxSpan))
  const numTrapezoids = numSpans + 1
  const spacing       = rowLength / numSpans  // actual cm between adjacent trapezoid centres

  // How many panel widths fit per span (used for type label subscript)
  const panelsPerSpan = Math.max(1, Math.round(spacing / (PANEL_WIDTH_CM + PANEL_GAP_CM)))

  return {
    rowLength,      // cm
    angle,          // degrees
    frontHeight,
    heightRear,
    heightFront,
    baseLength,
    topBeamLength,
    diagonalLength,
    numTrapezoids,
    spacing,        // cm between trapezoids
    panelsPerSpan,
    railOverhang,
    panelCount,
  }
}

/**
 * Assign letter type codes (A, B, C…) to rows with the same geometry profile.
 * Returns the input array with { typeLetter } added to each entry.
 */
export function assignTypes(rowConstructions) {
  const typeMap = {}
  let nextCode = 65 // 'A'
  return rowConstructions.map(rc => {
    const key = `${Math.round(rc.angle)}_${Math.round(rc.heightRear)}_${Math.round(rc.heightFront)}`
    if (!typeMap[key]) typeMap[key] = String.fromCharCode(nextCode++)
    return { ...rc, typeLetter: typeMap[key] }
  })
}

/**
 * Aggregate bill-of-quantities across all rows.
 * Returns array of { type, lengthCm, quantity }
 */
export function buildBOM(rowConstructions) {
  const agg = {}
  const add = (type, len, qty) => {
    const key = `${type}_${Math.round(len)}`
    if (!agg[key]) agg[key] = { type, lengthCm: len, quantity: 0 }
    agg[key].quantity += qty
  }

  rowConstructions.forEach(rc => {
    const T = rc.numTrapezoids
    add('Base beam',    rc.baseLength,     T)
    add('Top beam',     rc.topBeamLength,  T)
    add('Rear leg',     rc.heightRear,     T)
    add('Front leg',    rc.heightFront,    T)
    add('Diagonal',     rc.diagonalLength, T)
    add('Rail (40×40)', rc.rowLength,      2)  // 2 rails per row
  })

  return Object.values(agg).sort((a, b) => a.type.localeCompare(b.type) || b.lengthCm - a.lengthCm)
}
