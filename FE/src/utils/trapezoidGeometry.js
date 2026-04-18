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
// ─── Detail View geometry helpers ─────────────────────────────────────────────

/**
 * Build rail items from panel line segments and lineRails config.
 * Each item has { cx, segIdx, offsetCm, globalOffsetCm }.
 *
 * @param {object[]} segments  - panel line segments [{ depthCm, gapBeforeCm, isEmpty }]
 * @param {object}   lineRails - { lineIdx: [offsetCm, ...] }
 * @param {Function} atSlope   - (dCm) => { x, y } coordinate transform
 * @returns {object[]}
 */
export function buildRailItems(segments, lineRails, atSlope) {
  const items = []
  let dCm = 0
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si]
    dCm += (seg.gapBeforeCm ?? 0)
    if (seg.isEmpty) { dCm += (seg.depthCm ?? 0); continue }
    const segRails = lineRails?.[si] ?? lineRails?.[String(si)] ?? []
    for (const offsetCm of segRails) {
      items.push({ cx: atSlope(dCm + offsetCm).x, segIdx: si, offsetCm, globalOffsetCm: dCm + offsetCm })
    }
    dCm += (seg.depthCm ?? 0)
  }
  return items
}

/**
 * Compute diagonal rendering data from BE diagonals + user overrides.
 * Pure data transform — no SVG.
 *
 * @param {object}   beDetailData  - BE trap detail (legs, diagonals)
 * @param {object}   diagOverrides - user overrides { [spanIdx]: { topPct, botPct, disabled } }
 * @param {number[]} allLegXs      - left edge X positions of all legs (px)
 * @param {number[]} allLegEndXs   - right edge X positions of all legs (px)
 * @param {number[]} allLegHeights - heights of all legs (px)
 * @param {number}   baseY         - base beam Y position (px)
 * @param {number}   BEAM_THICK_PX - beam thickness (px)
 * @returns {object[]}
 */
export function buildDetailDiagonals(beDetailData, diagOverrides, allLegXs, allLegEndXs, allLegHeights, baseY, BEAM_THICK_PX) {
  const beDiags = beDetailData?.diagonals ?? []
  const numSpans = allLegXs.length - 1
  const raw = beDiags.map(d => {
    if (d.spanIdx >= numSpans) return null
    const ov = diagOverrides[d.spanIdx] ?? {}
    const topPct = ov.topPct ?? d.topPct
    const botPct = ov.botPct ?? d.botPct
    const { xA, xB, spanW, topX, botX, topY, botY } = calculateDiagonalPosition({
      spanIdx: d.spanIdx, topPct, botPct,
      legXs: allLegXs, legEndXs: allLegEndXs, legHeights: allLegHeights,
      baseY, beamThickPx: BEAM_THICK_PX,
    })
    const _dx = botX - topX, _dy = botY - topY
    const _len = Math.sqrt(_dx * _dx + _dy * _dy)
    const ux = _len > 0 ? _dx / _len : 0, uy = _len > 0 ? _dy / _len : 0
    const halfCap = BEAM_THICK_PX * 0.75 / 2
    return {
      xA, xB, spanW, topX, botX, topY, botY, ux, uy, halfCap,
      lenCm: d.lengthCm, isDouble: d.isDouble, skip: ov.disabled ?? d.disabled,
      spanIndex: d.spanIdx,
    }
  }).filter(Boolean)
  return raw.filter(s => !s.skip)
}

/**
 * Build sorted punch points array for DetailPunchSketch.
 *
 * @param {object[]} punches       - beDetailData.punches
 * @param {string}   beamType      - 'base' or 'slope'
 * @param {string}   excludeOrigin - origin to exclude (e.g. 'block' for slope)
 * @param {Function} atFn          - (positionCm) => x pixel position
 * @param {Function} labelFor      - (punch) => label string
 * @returns {object[]} sorted by x
 */
export function buildPunchPoints(punches, beamType, excludeOrigin, atFn, labelFor) {
  const matches = (origin) => (p) =>
    p.beamType === beamType && p.origin !== excludeOrigin && origin(p.origin)
  const toPoint = (origin) => (p) => ({ x: atFn(p.positionCm), label: labelFor(p), origin })
  const nonDiag = punches.filter(matches(o => o !== 'diagonal')).map(p => toPoint(p.origin)(p))
  const diag    = punches.filter(matches(o => o === 'diagonal')).map(toPoint('diagonal'))
  return [...nonDiag, ...diag].sort((a, b) => a.x - b.x)
}

/**
 * Compute first/last active (non-empty) panel line depths.
 *
 * @param {object[]} segments - panel line segments
 * @returns {{ firstActiveDepth: number, lastActiveDepth: number, totalPanelDepthCm: number }}
 */
export function computeActiveDepths(segments) {
  const totalPanelDepthCm = segments.reduce((s, seg) => s + (seg.gapBeforeCm ?? 0) + (seg.depthCm ?? 0), 0)
  let d = 0, firstActive = 0, foundFirst = false
  let lastEnd = totalPanelDepthCm
  for (const seg of segments) {
    d += seg.gapBeforeCm ?? 0
    if (!seg.isEmpty && !foundFirst) { firstActive = d; foundFirst = true }
    d += seg.depthCm ?? 0
    if (!seg.isEmpty) lastEnd = d
  }
  return { firstActiveDepth: firstActive, lastActiveDepth: lastEnd, totalPanelDepthCm }
}

/**
 * Derive all leg pixel data from BE legs.
 *
 * @param {object[]} beLegs     - beDetailData.legs
 * @param {Function} atTrap     - (posCm) => { x, y } coord transform
 * @param {number}   beamThickCm
 * @param {number}   SC         - scale factor (cm → px)
 * @param {number}   baseY      - base beam Y (px)
 * @returns {{ allLegXs, allLegEndXs, allLegHeights, allLegTopYs, legX0, legX1, legBW, firstLegPos }}
 */
export function buildLegData(beLegs, atTrap, beamThickCm, SC, baseY) {
  const firstLegPos = beLegs[0]?.positionCm ?? 0
  const allLegXs = beLegs.map(leg => atTrap(leg.positionCm - firstLegPos).x)
  const allLegEndXs = beLegs.map(leg => atTrap((leg.positionEndCm ?? (leg.positionCm + beamThickCm)) - firstLegPos).x)
  const allLegHeights = beLegs.map(leg => leg.heightCm * SC)
  const allLegTopYs = allLegHeights.map(h => baseY - h)
  const legX0 = allLegXs[0] ?? 0
  const legX1 = allLegEndXs[allLegEndXs.length - 1] ?? 0
  const legBW = legX1 - legX0
  return { allLegXs, allLegEndXs, allLegHeights, allLegTopYs, legX0, legX1, legBW, firstLegPos }
}

// ─── Diagonal rendering helpers ───────────────────────────────────────────────

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
