/**
 * Data-based base layout service.
 *
 * Computes base positions, block positions, diagonal lengths, and consolidation
 * for one trapezoid purely from panelGrid + settings (cm measurements) —
 * no pixel coordinates required.
 *
 * This is the portable counterpart to computeRowBasePlan in basePlanService.js,
 * intended to eventually replace it and enable server-side rendering.
 *
 * Input: panelGrid schema produced by buildPanelGrid in panelGridService.js
 *   { startCorner, areaAngle, rows: string[][], rowPositions?: { [lineIdx]: number[] } }
 *
 * Depth convention (lineIdx ordering in rows[]):
 *   lineIdx = 0 → rearmost line (closest to ridge / back of installation).
 *   Higher lineIdx → frontmost (closest to eave).
 *   This matches the physical ordering used by buildPanelGrid.
 *
 * Depth positions within each line are measured from that line's "rear" edge
 * (i.e., lineRails[li][0] = offset of first rail from the line's rear edge,
 * which is the same convention used in railLayoutService / RailCrossSectionOverlay).
 *
 * Output per area: { bases, rearLegDepthCm, frontLegDepthCm, baseTopDepthCm,
 *   baseBottomDepthCm, baseLengthCm, blockDepthOffsetsCm, diagonals,
 *   frameStartCm, frameLengthCm, actualSpacingMm, baseCount }
 *
 * Each BaseData:
 *   baseId               – 'B1', 'B2', ...
 *   offsetFromStartCm    – X position from area start corner
 *   trapezoidId          – label assigned by caller
 *
 * Each DiagonalData:
 *   baseIdxA, baseIdxB   – indices into bases[]
 *   edgeDepthCm          – which depth edge (baseTopDepthCm or baseBottomDepthCm)
 *   isRearEdge           – true for the rear (ridge) edge
 *   horizMm              – horizontal distance between the two bases
 *   vertMm               – vertical height difference (from rc heights)
 *   diagLengthMm         – 3D diagonal length = sqrt(horiz² + vert²)
 */

import {
  DEFAULT_BASE_EDGE_OFFSET_MM,
  DEFAULT_BASE_SPACING_MM,
  DEFAULT_BASE_OVERHANG_CM,
} from './basePlanService'


// ── Helpers ────────────────────────────────────────────────────────────────────

function inferRowOrientation(cells) {
  for (const c of cells) {
    if (c === 'V' || c === 'EV') return 'V'
    if (c === 'H' || c === 'EH') return 'H'
  }
  return null
}

function defaultPositions(cells, panelAlongCm, panelGapCm) {
  const positions = []
  cells.forEach((cell, i) => {
    if (cell === 'V' || cell === 'H') positions.push(i * (panelAlongCm + panelGapCm))
  })
  return positions
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Compute base layout for one area (or trapezoid sub-range) from panelGrid data.
 *
 * @param {object}   panelGrid    – { rows: string[][], rowPositions?: object }
 * @param {object}   panelSpec    – { widthCm, lengthCm }
 * @param {object}   lineRails    – { [lineIdx]: [offsetCm, ...] }
 * @param {object|null} rc        – { heightRear, heightFront } in cm (optional, for diagonals)
 * @param {object}   settings     – {
 *   edgeOffsetMm?,   spacingMm?,    baseOverhangCm?,  customOffsets?: number[],
 *   blockLengthCm?,  blockWidthCm?, crossRailOffsetCm?
 * }
 * @param {string}   trapezoidId  – label to stamp on each base
 * @param {number}   [trapStartCm] – override X start (for per-trap calls within a shared area)
 * @param {number}   [trapEndCm]   – override X end
 * @returns {object|null}
 */
export function computeAreaBasesData(
  panelGrid, panelSpec, lineRails, rc,
  settings = {}, trapezoidId = '',
  trapStartCm = null, trapEndCm = null,
) {
  if (!panelGrid?.rows?.length) return null

  const { rows, rowPositions } = panelGrid
  const edgeOffsetMm   = settings.edgeOffsetMm   ?? DEFAULT_BASE_EDGE_OFFSET_MM
  const spacingMm      = settings.spacingMm      ?? DEFAULT_BASE_SPACING_MM
  const baseOverhangCm = settings.baseOverhangCm ?? DEFAULT_BASE_OVERHANG_CM
  const blockLengthCm  = settings.blockLengthCm  ?? 50
  const crossRailOffCm = settings.crossRailOffsetCm ?? 5
  const panelGapCm     = settings.panelGapCm
  const customOffsets  = settings.customOffsets   // undefined → auto placement

  const shortCm = panelSpec.widthCm
  const longCm  = panelSpec.lengthCm

  // ── Frame X extent (from panel positions, not rail overhang) ──────────────
  let autoStart = Infinity, autoEnd = -Infinity
  rows.forEach((cells, lineIdx) => {
    const orient = inferRowOrientation(cells)
    if (!orient) return
    const panelAlongCm = orient === 'V' ? shortCm : longCm
    const positions = rowPositions?.[lineIdx] ?? defaultPositions(cells, panelAlongCm, panelGapCm)
    if (positions.length === 0) return
    autoStart = Math.min(autoStart, positions[0])
    autoEnd   = Math.max(autoEnd,   positions[positions.length - 1] + panelAlongCm)
  })
  if (autoStart === Infinity) return null

  const frameStartCm  = trapStartCm ?? autoStart
  const frameEndCm    = trapEndCm   ?? autoEnd
  const frameLengthCm = frameEndCm - frameStartCm
  const frameLengthMm = Math.round(frameLengthCm * 10)

  // ── Base X positions (cm from area start corner) ──────────────────────────
  const innerSpanMm = frameLengthMm - 2 * edgeOffsetMm
  let baseOffsetsCm   // offsets from frameStartCm

  if (customOffsets?.length > 0) {
    baseOffsetsCm = customOffsets.map(mm => mm / 10)
  } else {
    const numSpans       = Math.max(1, Math.ceil(innerSpanMm / spacingMm))
    const actualSpacingCm = (innerSpanMm / numSpans) / 10
    const numBases       = numSpans + 1
    baseOffsetsCm = []
    for (let i = 0; i < numBases; i++) {
      baseOffsetsCm.push(Math.round((edgeOffsetMm / 10 + i * actualSpacingCm) * 100) / 100)
    }
  }

  const actualSpacingMm = baseOffsetsCm.length > 1
    ? Math.round((baseOffsetsCm[1] - baseOffsetsCm[0]) * 10)
    : 0

  const bases = baseOffsetsCm.map((off, i) => ({
    baseId:            `B${i + 1}`,
    offsetFromStartCm: Math.round((frameStartCm + off) * 100) / 100,
    trapezoidId,
  }))

  // ── Cumulative line depths (cm from rear edge of area) ────────────────────
  // lineIdx = 0 → rearmost line; increasing lineIdx → toward front (eave).
  // Each line starts after the gap following the previous line.
  const lineInfos = {}   // { lineIdx: { rearEdgeCm, frontEdgeCm, depthCm, orient } }
  let cumulativeCm = 0
  rows.forEach((cells, lineIdx) => {
    const orient = inferRowOrientation(cells)
    if (lineIdx > 0) cumulativeCm += panelGapCm
    const depthCm = orient === 'V' ? longCm : (orient === 'H' ? shortCm : 0)
    if (orient) {
      lineInfos[lineIdx] = {
        rearEdgeCm:  cumulativeCm,
        frontEdgeCm: cumulativeCm + depthCm,
        depthCm,
        orient,
      }
    }
    cumulativeCm += depthCm
  })

  const activeLineIdxs = Object.keys(lineInfos).map(Number).sort((a, b) => a - b)
  if (activeLineIdxs.length === 0) return null

  // ── Rear and front leg depth positions ───────────────────────────────────
  // Rear leg  = first rail of rearmost line  (measured from that line's rear edge)
  // Front leg = last  rail of frontmost line (measured from that line's rear edge)
  const rearIdx        = activeLineIdxs[0]
  const frontIdx       = activeLineIdxs[activeLineIdxs.length - 1]
  const rearLine       = lineInfos[rearIdx]
  const frontLine      = lineInfos[frontIdx]
  const rearRails      = lineRails?.[rearIdx]  ?? []
  const frontRails     = lineRails?.[frontIdx] ?? []
  const rearLegDepthCm  = rearLine.rearEdgeCm  + (rearRails[0]                         ?? 0)
  const frontLegDepthCm = frontLine.rearEdgeCm + (frontRails[frontRails.length - 1]    ?? frontLine.depthCm)

  const baseTopDepthCm    = rearLegDepthCm  - baseOverhangCm
  const baseBottomDepthCm = frontLegDepthCm + baseOverhangCm
  const baseLengthCm      = baseBottomDepthCm - baseTopDepthCm

  // ── Per-base depth positions ──────────────────────────────────────────────
  // For each base, find which lines have an active panel covering that base's
  // X position, then derive topDepthCm / bottomDepthCm from those lines' rail
  // positions + baseOverhangCm.  Bases at trapezoid boundaries may sit under
  // fewer lines than the global rear/front, so their length can differ.
  bases.forEach(base => {
    const baseX = base.offsetFromStartCm
    const activeLinesForBase = []

    rows.forEach((cells, li) => {
      const orient = inferRowOrientation(cells)
      if (!orient || !lineInfos[li]) return
      const panelAlongCm = orient === 'V' ? shortCm : longCm
      const positions = rowPositions?.[li] ?? defaultPositions(cells, panelAlongCm)
      let activeIdx = 0
      for (let j = 0; j < cells.length; j++) {
        if (cells[j] !== 'V' && cells[j] !== 'H') continue
        const pos = positions[activeIdx++]
        if (baseX >= pos && baseX <= pos + panelAlongCm) {
          activeLinesForBase.push(li)
          break
        }
      }
    })

    if (activeLinesForBase.length > 0) {
      const bRearIdx   = Math.min(...activeLinesForBase)
      const bFrontIdx  = Math.max(...activeLinesForBase)
      const bRearLine  = lineInfos[bRearIdx]
      const bFrontLine = lineInfos[bFrontIdx]
      const bRearRails  = lineRails?.[bRearIdx]  ?? []
      const bFrontRails = lineRails?.[bFrontIdx] ?? []
      const bRearLeg  = bRearLine.rearEdgeCm  + (bRearRails[0] ?? 0)
      const bFrontLeg = bFrontLine.rearEdgeCm + (bFrontRails[bFrontRails.length - 1] ?? bFrontLine.depthCm)
      base.topDepthCm    = Math.round((bRearLeg  - baseOverhangCm) * 100) / 100
      base.bottomDepthCm = Math.round((bFrontLeg + baseOverhangCm) * 100) / 100
      base.lengthCm      = Math.round((base.bottomDepthCm - base.topDepthCm) * 100) / 100
    } else {
      // Fallback: base sits outside any active panel column — use global extents
      base.topDepthCm    = Math.round(baseTopDepthCm    * 100) / 100
      base.bottomDepthCm = Math.round(baseBottomDepthCm * 100) / 100
      base.lengthCm      = Math.round(baseLengthCm      * 100) / 100
    }
  })

  // ── Cross-rail attachment points (for block placement) ────────────────────
  // Each line contributes two connection points, symmetrically placed
  // at crossRailOffCm from the leg positions (or from the line edges where unconstrained).
  const crossRailDepthsCm = []
  activeLineIdxs.forEach((li, si) => {
    const ld          = lineInfos[li]
    const lineCenter  = ld.rearEdgeCm + ld.depthCm / 2
    const effectiveRearEdge  = si === 0 ? rearLegDepthCm  : ld.rearEdgeCm
    const effectiveFrontEdge = si === activeLineIdxs.length - 1 ? frontLegDepthCm : ld.frontEdgeCm

    let rearConn  = effectiveRearEdge  < rearLegDepthCm  ? rearLegDepthCm  + crossRailOffCm : ld.rearEdgeCm  + crossRailOffCm
    let frontConn = effectiveFrontEdge > frontLegDepthCm ? frontLegDepthCm - crossRailOffCm : ld.frontEdgeCm - crossRailOffCm

    // Symmetrize connections around the line center
    const rearDist  = lineCenter - rearConn
    const frontDist = frontConn - lineCenter
    if (rearDist >= 0 && frontDist >= 0) {
      if (rearDist <= frontDist) frontConn = lineCenter + rearDist
      else                       rearConn  = lineCenter - frontDist
    }
    crossRailDepthsCm.push(rearConn, frontConn)
  })

  // ── Block depth positions along each base ────────────────────────────────
  // One block at each end (rear/front), plus center blocks for intermediate rails.
  const numBlocks = Math.max(2, activeLineIdxs.reduce((sum, li) =>
    sum + (lineInfos[li].orient === 'H' ? 1 : 2), 0))
  const numCenterBlocks = numBlocks - 2
  const innerCrossRails = [...crossRailDepthsCm].sort((a, b) => a - b).slice(1, -1)
  const centerBlockDepths = numCenterBlocks === 0 ? [] : innerCrossRails.slice(-numCenterBlocks)

  const blockDepthOffsetsCm = [
    baseTopDepthCm    + blockLengthCm / 2,
    ...centerBlockDepths,
    baseBottomDepthCm - blockLengthCm / 2,
  ].map(v => Math.round(v * 100) / 100)

  // ── Diagonals ─────────────────────────────────────────────────────────────
  // For 2 bases: 1 pair spanning bases [0,1].
  // For N>2 bases: 2 pairs — [0,1] at the rear side and [N-1,N-2] at the front side.
  // Each pair produces 2 diagonal lines (one at each depth edge: rear and front).
  const n         = bases.length
  const diagPairs = n === 2 ? [[0, 1]] : [[0, 1], [n - 1, n - 2]]

  const diagonals = diagPairs.flatMap(([ai, bi]) => {
    const horizMm = Math.round(Math.abs(baseOffsetsCm[bi] - baseOffsetsCm[ai]) * 10)
    return [baseTopDepthCm, baseBottomDepthCm].map((edgeDepthCm) => {
      let vertMm = 0
      if (rc && frontLegDepthCm > rearLegDepthCm) {
        const t      = Math.max(0, Math.min(1,
          (edgeDepthCm - rearLegDepthCm) / (frontLegDepthCm - rearLegDepthCm)))
        vertMm = Math.round((rc.heightRear + t * (rc.heightFront - rc.heightRear)) * 10)
      }
      return {
        baseIdxA:     ai,
        baseIdxB:     bi,
        edgeDepthCm,
        isRearEdge:   edgeDepthCm === baseTopDepthCm,
        horizMm,
        vertMm,
        diagLengthMm: Math.round(Math.sqrt(horizMm ** 2 + vertMm ** 2)),
      }
    })
  })

  return {
    trapezoidId,
    bases,
    frameStartCm:       Math.round(frameStartCm   * 100) / 100,
    frameLengthCm:      Math.round(frameLengthCm  * 100) / 100,
    rearLegDepthCm:     Math.round(rearLegDepthCm  * 100) / 100,
    frontLegDepthCm:    Math.round(frontLegDepthCm * 100) / 100,
    baseTopDepthCm:     Math.round(baseTopDepthCm  * 100) / 100,
    baseBottomDepthCm:  Math.round(baseBottomDepthCm * 100) / 100,
    baseLengthCm:       Math.round(baseLengthCm    * 100) / 100,
    blockDepthOffsetsCm,
    diagonals,
    actualSpacingMm,
    baseCount: bases.length,
  }
}

// ── Consolidation (data-based counterpart to consolidateAreaBases) ────────────

/**
 * Remove bases from shallower trapezoids where they fall within a deeper
 * trapezoid's X extent.  Works in cm, no pixel coordinates needed.
 *
 * @param {object} areaTrapsMap   – { areaKey: [trapId, ...] }
 * @param {object} basesDataMap   – { trapId: computeAreaBasesData result }
 * @returns {object}               – { trapId: BaseData[] } (filtered bases per trap)
 */
export function consolidateAreaBasesData(areaTrapsMap, basesDataMap) {
  // Start with full copies
  const result = {}
  for (const [trapId, bd] of Object.entries(basesDataMap)) {
    if (bd) result[trapId] = [...bd.bases]
  }

  for (const trapIds of Object.values(areaTrapsMap)) {
    if (trapIds.length <= 1) continue

    // Metadata per trap: x-range and depth (base length as proxy for depth)
    const trapInfos = trapIds.map(trapId => {
      const bd = basesDataMap[trapId]
      if (!bd) return null
      return {
        trapId,
        xMin:    bd.frameStartCm,
        xMax:    bd.frameStartCm + bd.frameLengthCm,
        depth:   bd.baseLengthCm,
      }
    }).filter(Boolean)

    // For each trap, remove bases that fall strictly within a "winning" trap's x-range.
    // The winning trap is deeper, or wider at same depth, or earlier in list at same depth+width.
    const trapOrder = Object.fromEntries(trapIds.map((id, i) => [id, i]))
    const bWins = (a, b) => {
      if (b.depth > a.depth) return true
      if (b.depth < a.depth) return false
      const wA = a.xMax - a.xMin, wB = b.xMax - b.xMin
      if (wB > wA) return true
      if (wB < wA) return false
      return (trapOrder[b.trapId] ?? 999) < (trapOrder[a.trapId] ?? 999)
    }
    for (const infoA of trapInfos) {
      result[infoA.trapId] = result[infoA.trapId].filter(base => {
        const x = base.offsetFromStartCm
        for (const infoB of trapInfos) {
          if (infoB.trapId === infoA.trapId) continue
          if (x > infoB.xMin && x < infoB.xMax && bWins(infoA, infoB)) return false
        }
        return true
      })
    }
  }

  return result
}
