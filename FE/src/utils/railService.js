/**
 * Data-based rail layout service.
 *
 * Computes rail positions and stock segments for one area purely from panelGrid
 * data (cm measurements) — no pixel coordinates required.
 *
 * This is the portable counterpart to computeRowRailLayout in railLayoutService.js,
 * intended to eventually replace it and enable server-side rendering.
 *
 * Input: panelGrid schema produced by buildPanelGrid in panelGridService.js
 *   { startCorner, areaAngle, rows: string[][], rowPositions?: { [lineIdx]: number[] } }
 *
 * Output per area: { rails: RailData[] }
 * Each RailData:
 *   railId                – 'R1', 'R2', ...
 *   lineIdx               – which slope-depth line (0 = front)
 *   offsetFromLineFrontCm – distance from this line's front edge to the rail
 *   startCm               – leading edge of leftmost panel minus overhang (from area start corner)
 *   endCm                 – trailing edge of rightmost panel plus overhang
 *   lengthMm              – total rail length in mm
 *   stockSegments         – array of used-length pieces in mm (greedy split)
 *   leftoverMm            – total waste from stock cuts
 */

import {
  DEFAULT_RAIL_OVERHANG_CM,
  DEFAULT_STOCK_LENGTHS_MM,
  DEFAULT_RAIL_SPACING_VERTICAL_CM,
  DEFAULT_RAIL_SPACING_HORIZONTAL_CM,
  railOffsetFromSpacing,
  splitIntoStockSegments,
} from './railLayoutService'
import { PANEL_GAP_CM } from './trapezoidGeometry'

// Panel physical dimensions along each axis (cm)
// Portrait (V): 113.4 cm across the row, 238.2 cm up the slope
// Landscape (H): 238.2 cm across the row, 113.4 cm up the slope
const PANEL_SHORT_CM = 113.4
const PANEL_LONG_CM  = 238.2

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Return 'V' or 'H' for the first non-empty cell; null if all empty. */
function inferRowOrientation(cells) {
  for (const c of cells) {
    if (c === 'V' || c === 'EV') return 'V'
    if (c === 'H' || c === 'EH') return 'H'
  }
  return null
}

/**
 * Compute default leading-edge positions (cm from area start corner) for
 * the active (non-empty) cells of a row when rowPositions is not stored.
 *
 * Matches the layout produced by computePolygonPanels in rectPanelService.js:
 * each column i is placed at i * (panelAlongCm + PANEL_GAP_CM).
 */
function defaultPositions(cells, panelAlongCm) {
  const positions = []
  cells.forEach((cell, i) => {
    if (cell === 'V' || cell === 'H') positions.push(i * (panelAlongCm + PANEL_GAP_CM))
  })
  return positions
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Compute rail layout for one area from panelGrid data.
 *
 * @param {object} panelGrid  - { rows: string[][], rowPositions?: object }
 * @param {object} panelSpec  - { widthCm, lengthCm } — short and long panel dimensions
 * @param {object} settings   - {
 *   lineRails?:    { [lineIdx]: number[] }  — offsets from line front edge (cm)
 *   overhangCm?:   number                  — rail overhang beyond panel extents
 *   stockLengths?: number[]                — available stock lengths in mm
 * }
 * @returns {{ rails: object[] }}
 */
export function computeAreaRailData(panelGrid, panelSpec, settings = {}) {
  if (!panelGrid?.rows?.length) return { rails: [] }

  const { rows, rowPositions } = panelGrid
  const overhangCm   = settings.overhangCm   ?? DEFAULT_RAIL_OVERHANG_CM
  const stockLengths = settings.stockLengths ?? DEFAULT_STOCK_LENGTHS_MM

  // Resolve panel dimensions (fall back to standard AIKO-style defaults)
  const shortCm = panelSpec?.widthCm  ?? PANEL_SHORT_CM
  const longCm  = panelSpec?.lengthCm ?? PANEL_LONG_CM

  const rails = []
  let railId = 1
  let numLargeGaps = 0

  rows.forEach((cells, lineIdx) => {
    const orient = inferRowOrientation(cells)
    if (!orient) return  // line is entirely empty ghost slots

    // Dimension along the row (X axis) and across the row (slope depth)
    const panelAlongCm = orient === 'V' ? shortCm : longCm
    const panelDepthCm = orient === 'V' ? longCm  : shortCm

    // Leading-edge positions of active panels from area start corner (cm)
    const positions = rowPositions?.[lineIdx] ?? defaultPositions(cells, panelAlongCm)
    if (positions.length === 0) return

    // Large-gap count: gaps between adjacent panels exceeding default + 0.5 cm tolerance.
    // Only possible when rowPositions is stored (panels were manually moved).
    if (rowPositions?.[lineIdx]) {
      const threshold = PANEL_GAP_CM + 0.5
      for (let j = 1; j < positions.length; j++) {
        if (positions[j] - (positions[j - 1] + panelAlongCm) > threshold) numLargeGaps++
      }
    }

    // Rail offset positions within this line (from line's front edge)
    const storedOffsets = settings.lineRails?.[lineIdx]
    let offsetsCm
    if (storedOffsets?.length >= 2) {
      offsetsCm = storedOffsets
    } else {
      const spacing = orient === 'H'
        ? DEFAULT_RAIL_SPACING_HORIZONTAL_CM
        : DEFAULT_RAIL_SPACING_VERTICAL_CM
      const off = railOffsetFromSpacing(panelDepthCm, spacing)
      offsetsCm = [off, panelDepthCm - off]
    }

    // Rail horizontal span (same for all rails in this line)
    const startCm  = positions[0] - overhangCm
    const endCm    = positions[positions.length - 1] + panelAlongCm + overhangCm
    const lengthMm = Math.round((endCm - startCm) * 10)
    if (lengthMm <= 0) return

    for (const offsetCm of offsetsCm) {
      const segs = splitIntoStockSegments(lengthMm, stockLengths)
      rails.push({
        railId:                `R${railId++}`,
        lineIdx,
        offsetFromLineFrontCm: Math.round(offsetCm * 100) / 100,
        startCm:               Math.round(startCm  * 100) / 100,
        endCm:                 Math.round(endCm    * 100) / 100,
        lengthMm,
        stockSegments:         segs.map(s => s.used),
        leftoverMm:            segs.reduce((sum, s) => sum + s.leftover, 0),
      })
    }
  })

  return { rails, numLargeGaps }
}
