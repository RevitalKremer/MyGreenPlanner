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
  const panelGapCm     = config.panelGapCm
  const panelWidthCm   = config.panelWidthCm
  const panelLengthCm  = config.panelLengthCm
  const railOverhang   = config.railOverhang
  const maxSpan        = config.maxSpan

  // Rail length (total row width including overhang)
  // config.rowLength can be passed from actual panel placement measurements (preferred)
  const rowLength = config.rowLength
    ?? (panelCount * panelWidthCm
    + Math.max(0, panelCount - 1) * panelGapCm
    + 2 * railOverhang)

  // Trapezoid base (horizontal depth of frame, cm)
  // Use actual measured line depth if provided (multi-line rows), else single panel length
  const lineDepthCm  = config.lineDepthCm ?? panelLengthCm
  const railOffsetCm = config.railOffsetCm
  const crossRailOffsetCm = config.crossRailOffsetCm
  // baseLength = horizontal leg-to-leg span (first rail to last rail, projected)
  const baseLength   = config.baseLength
    ?? Math.cos(angleRad) * (lineDepthCm - 2 * railOffsetCm)

  // Base/slope beam physical lengths include overhang beyond each leg.
  // baseOverhangCm is measured ALONG THE SLOPE (same direction as lineRails offsets).
  const baseOverhangCm = config.baseOverhangCm
  // Slope beam = rail-to-rail distance along slope + 2 × slope overhang
  const topBeamLength  = baseLength / Math.cos(angleRad) + 2 * baseOverhangCm
  // Horizontal base beam = slope beam projected onto ground
  const baseBeamLength = topBeamLength * Math.cos(angleRad)

  // Trapezoid heights — use leg span (baseLength), not full beam
  const heightRear  = frontHeight                                    // low side
  const heightFront = frontHeight + baseLength * Math.tan(angleRad)  // high side

  // Diagonal: from top of rear leg → bottom of front leg (within leg span)
  const diagonalLength   = Math.sqrt(baseLength ** 2 + heightFront ** 2)

  // Trapezoid count and spacing along row
  const numSpans      = Math.max(1, Math.ceil(rowLength / maxSpan))
  const numTrapezoids = numSpans + 1
  const spacing       = rowLength / numSpans  // actual cm between adjacent trapezoid centres

  // How many panel widths fit per span (used for type label subscript)
  const panelsPerSpan = Math.max(1, Math.round(spacing / (panelWidthCm + panelGapCm)))

  return {
    rowLength,      // cm
    angle,          // degrees
    frontHeight,
    heightRear,
    heightFront,
    baseLength,      // horizontal leg-to-leg span (first–last rail projection)
    baseBeamLength,  // physical base beam = baseLength + 2×overhang
    topBeamLength,   // physical slope beam = baseBeamLength / cos(angle)
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
 * Build per-area bill of materials using the active product dictionary.
 * Returns array of { areaLabel, element, totalLengthM, qty }
 */
export function buildBOM(rowConstructions, rowLabels = []) {
  const rows = []

  rowConstructions.forEach((rc, i) => {
    const areaLabel = rowLabels[i] ?? `Area ${i + 1}`
    const T  = rc.numTrapezoids           // number of frames in this row
    const nS = T - 1                      // number of spans = diagonals per row
    const numRails = rc.numRails
    const linesPerArea       = rc.numLines
    const numLargeGaps      = rc.numLargeGaps
    const numRailConnectors = rc.numRailConnectors
    const numInnerLegsPerFrame = Math.max(0, numRails - 2)
    const angleRad = rc.angle * Math.PI / 180
    // Average inner leg length: beam-thickness + leg height at midpoint of frame
    const beamThickCm = rc.beamThickCm
    const avgInnerLegCm = beamThickCm * (1 + Math.cos(angleRad) / 2)
      + (rc.heightRear + rc.heightFront) / 2

    // ── angle_profile_40x40 — frame pieces (beams + legs) ───────────────
    const framePieces = [
      { qty: T,                        lenCm: rc.baseBeamLength ?? rc.baseLength },  // base beams
      { qty: T,                        lenCm: rc.topBeamLength },                    // slope beams
      { qty: T,                        lenCm: rc.heightRear },                       // rear legs
      { qty: T,                        lenCm: rc.heightFront },                      // front legs
      { qty: numInnerLegsPerFrame * T, lenCm: avgInnerLegCm },                       // inner support legs
    ].filter(p => p.qty > 0 && p.lenCm > 0)

    const frameQty     = framePieces.reduce((s, p) => s + p.qty, 0)
    const frameLengthM = framePieces.reduce((s, p) => s + p.qty * p.lenCm, 0) / 100
    rows.push({ areaLabel, element: 'angle_profile_40x40', totalLengthM: frameLengthM, qty: frameQty })

    // ── angle_profile_40x40_diag — diagonal braces ───────────────────────
    if (nS > 0 && rc.diagonalLength > 0) {
      rows.push({ areaLabel, element: 'angle_profile_40x40_diag', totalLengthM: nS * rc.diagonalLength / 100, qty: nS })
    }

    // ── rail_40x40 ───────────────────────────────────────────────────────
    rows.push({ areaLabel, element: 'rail_40x40', totalLengthM: rc.rowLength != null ? numRails * rc.rowLength / 100 : null, qty: numRails })

    // ── block_50x24x15 / bitumen_sheets / jumbo_5x16 ─────────────────────
    const blockQty = T * (2 + numInnerLegsPerFrame)
    rows.push({ areaLabel, element: 'block_50x24x15',  totalLengthM: null, qty: blockQty })
    rows.push({ areaLabel, element: 'bitumen_sheets',   totalLengthM: null, qty: blockQty })
    rows.push({ areaLabel, element: 'jumbo_5x16',       totalLengthM: null, qty: blockQty })

    // ── end_panel_clamp — 2 per rail (one at each end) + 2 per large gap per rail
    const railsPerLine   = numRails / linesPerArea
    const endClampQty    = 2 * numRails + 2 * numLargeGaps * railsPerLine
    rows.push({ areaLabel, element: 'end_panel_clamp', totalLengthM: null, qty: Math.round(endClampQty) })

    // ── rail_end_cap — 2 per rail (one at each end) ──────────────────────
    rows.push({ areaLabel, element: 'rail_end_cap', totalLengthM: null, qty: 2 * numRails })

    // ── grounding_panel_clamp — ceil(panelCount / 2) ─────────────────────
    const groundingQty = Math.ceil(rc.panelCount / 2)
    rows.push({ areaLabel, element: 'grounding_panel_clamp', totalLengthM: null, qty: groundingQty })

    // ── mid_panel_clamp — 1 per normal boundary per rail, minus grounding replacements
    // panels per line = panelCount / linesPerArea; normal boundaries = total - large gaps
    const panelsPerLine      = rc.panelCount / linesPerArea
    const totalBoundaries    = Math.max(0, panelsPerLine - 1) * linesPerArea  // across all lines
    const normalBoundaries   = Math.max(0, totalBoundaries - numLargeGaps)
    const midClampQty        = Math.max(0, Math.round(normalBoundaries * railsPerLine) - groundingQty)
    if (midClampQty > 0) {
      rows.push({ areaLabel, element: 'mid_panel_clamp', totalLengthM: null, qty: midClampQty })
    }

    // ── rail_connector — (segments - 1) per rail, summed across all rails ─
    if (numRailConnectors > 0) {
      rows.push({ areaLabel, element: 'rail_connector', totalLengthM: null, qty: numRailConnectors })
    }

    // ── hex_head_bolt_m8x20 ───────────────────────────────────────────────
    // Each leg (outer + inner) bolts to base beam AND slope beam = 2 bolts per leg per trapezoid
    // Each diagonal end = 1 bolt → 2 × nS total
    // Each rail connects to each trapezoid = 1 bolt per rail per trapezoid
    const legsPerTrapezoid = 2 + numInnerLegsPerFrame
    // Each frame has 2 punches per leg (base + slope beam) + 2 diagonal punch holes per frame
    // Diagonal punches = 2 × T (1 on slope beam + 1 on base beam per frame, pre-drilled on every frame)
    const hexBoltQty = T * (2 * legsPerTrapezoid + 2)  // leg punches + diagonal punches per frame
                     + numRails * T                      // rail-to-trapezoid attachments
    rows.push({ areaLabel, element: 'hex_head_bolt_m8x20',          totalLengthM: null, qty: hexBoltQty })
    rows.push({ areaLabel, element: 'flange_nut_m8_stainless_steel', totalLengthM: null, qty: hexBoltQty })
  })

  return rows
}
