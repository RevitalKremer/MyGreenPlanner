import { PANEL_H } from './panelCodes.js'
import type {
  Point, PanelLocalRect, PanelFrame, FERail, RowRailLayout,
  LineRailsMap, BeRailsAreaData, RailConfig, PanelLayout,
} from '../types/projectData'

export type { RowRailLayout }

// ─── BE data helpers ─────────────────────────────────────────────────────────

/**
 * Build a lineRails map ({ lineIdx: [offsetCm, ...] }) from BE-computed rails.
 * Works for ALL roof types — no trap config needed.
 */
export function buildLineRailsFromBE(beRailsData: BeRailsAreaData[] | null, areaLabel: string, panelRowIdx: number = 0): LineRailsMap | null {
  if (!beRailsData) return null
  const beArea = beRailsData.find(a => a.areaLabel === areaLabel)
  if (!beArea) return null
  const rails = (beArea.rails ?? []).filter(r => (r._panelRowIdx ?? 0) === panelRowIdx)
  if (!rails.length) return null
  const map: LineRailsMap = {}
  for (const r of rails) {
    if (!map[r.lineIdx]) map[r.lineIdx] = []
    map[r.lineIdx].push(r.offsetFromLineFrontCm)
  }
  for (const li of Object.keys(map)) map[li] = [...map[li]].sort((a, b) => a - b)
  return Object.keys(map).length > 0 ? map : null
}

/**
 * Build a per-line segment map ({ lineIdx: [{startCm, lengthCm}, ...] }) from BE rails.
 * Multiple segments per line happen when the BE split a line at large gaps (holes from
 * removed panels). Each segment's startCm/lengthCm encodes overhang and any long-rail
 * extension. Deduped per (lineIdx, startCm) since the BE emits one rail per Y-offset.
 */
export function buildLineSegmentsFromBE(beRailsData: BeRailsAreaData[] | null, areaLabel: string, panelRowIdx: number = 0): Record<number, { startCm: number; lengthCm: number }[]> | null {
  if (!beRailsData) return null
  const beArea = beRailsData.find(a => a.areaLabel === areaLabel)
  if (!beArea) return null
  const rails = (beArea.rails ?? []).filter(r => (r._panelRowIdx ?? 0) === panelRowIdx)
  if (!rails.length) return null
  const map: Record<number, { startCm: number; lengthCm: number }[]> = {}
  for (const r of rails) {
    if (!map[r.lineIdx]) map[r.lineIdx] = []
    if (!map[r.lineIdx].some(s => Math.abs(s.startCm - r.startCm) < 0.01)) {
      map[r.lineIdx].push({ startCm: r.startCm, lengthCm: r.lengthCm })
    }
  }
  for (const li of Object.keys(map)) map[Number(li)].sort((a, b) => a.startCm - b.startCm)
  return Object.keys(map).length > 0 ? map : null
}

// Derive rail offset from panel edge given spacing and panel depth
export function railOffsetFromSpacing(panelDepthCm: number, spacingCm: number): number {
  return Math.max(0, (panelDepthCm - spacingCm) / 2)
}

// Compute local coordinate frame for a group of panels (no rail config needed).
export function computePanelFrame(rowPanels: PanelLayout[]): PanelFrame | null {
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

/**
 * Build default lineRails for each panel line based on orientation and depths.
 */
export function initDefaultLineRails(lineOrientations: string[], panelDepthsCm: number[], railSpacingV: number, railSpacingH: number): LineRailsMap {
  const result: LineRailsMap = {}
  lineOrientations.forEach((orientation, i) => {
    const depth = panelDepthsCm[i]
    const spacing = orientation === PANEL_H ? railSpacingH : railSpacingV
    const offset = railOffsetFromSpacing(depth, spacing)
    result[i] = [offset, depth - offset]
  })
  return result
}

// Transform screen-space point to local frame (inverse rotation around center)
export function screenToLocal(point: Point, center: Point, angleRad: number): Point {
  const dx = point.x - center.x
  const dy = point.y - center.y
  return {
    x:  dx * Math.cos(angleRad) + dy * Math.sin(angleRad),
    y: -dx * Math.sin(angleRad) + dy * Math.cos(angleRad),
  }
}

// Transform local frame point back to screen space
export function localToScreen(point: Point, center: Point, angleRad: number): Point {
  return {
    x: center.x + point.x * Math.cos(angleRad) - point.y * Math.sin(angleRad),
    y: center.y + point.x * Math.sin(angleRad) + point.y * Math.cos(angleRad),
  }
}

// Detect orientation from panel physical dimensions
export function getPanelOrientation(panel: { widthCm: number; heightCm: number }): string {
  return panel.widthCm < panel.heightCm ? 'PORTRAIT' : 'LANDSCAPE'
}

// Split a length in mm into stock segments (greedy, largest-first)
// Internal only — stock splitting for FE preview; BE is source of truth
function splitIntoStockSegments(lengthMm: number, stockLengths: number[]) {
  const sorted = [...stockLengths].sort((a, b) => b - a)
  const segments: { stock: number; used: number; leftover: number }[] = []
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
 * Map each FE areaGroupKey to its BE rails-area entry.
 *
 * areaGroupKey is a rectArea index (FE-unique). Primary resolution is by
 * rectArea.areaGroupId → beRailsData[].areaId — a stable numeric link that
 * survives label renames and avoids collisions when labels repeat.
 *
 * Fallback by label is required for the step 2 → 3 transition on a
 * fresh-create project: rectAreas are still holding their local negative
 * rowIds in areaGroupId until handleImportProject mirrors the BE-assigned
 * positive areaId back in. Without the fallback, beSegsFn in RailsOverlay
 * returns [] for every rail and the material-summary / dimensions layers
 * silently render nothing until the user reloads the project.
 */
export function buildGroupKeyToBeArea(
  rowKeys: number[],
  beRailsData: BeRailsAreaData[] | null,
  rectAreas: { areaGroupId?: number | string | null; label?: string | null }[] | null = null,
): Record<number, BeRailsAreaData> {
  const map: Record<number, BeRailsAreaData> = {}
  if (!beRailsData || beRailsData.length === 0 || !rectAreas) return map
  const beByAreaId: Record<number, BeRailsAreaData> = {}
  const beByLabel: Record<string, BeRailsAreaData> = {}
  for (const a of beRailsData) {
    if (a.areaId != null) beByAreaId[a.areaId] = a
    if (a.areaLabel) beByLabel[a.areaLabel] = a
  }
  for (const gk of rowKeys) {
    const ra = rectAreas[gk]
    const beAreaId = ra?.areaGroupId
    if (typeof beAreaId === 'number' && beByAreaId[beAreaId]) {
      map[gk] = beByAreaId[beAreaId]
      continue
    }
    if (ra?.label && beByLabel[ra.label]) {
      map[gk] = beByLabel[ra.label]
    }
  }
  return map
}

/**
 * Build a mapping from areaGroupKey → area label string.
 */
export function buildGroupKeyToLabelMap(panels: PanelLayout[], rowKeys: number[], beRailsData: BeRailsAreaData[] | null): Record<number, string> {
  const m: Record<number, string> = {}
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
 */
export function buildRowRailConfig(rowPanels: PanelLayout[], ri: number, {
  useStored, selectedPanelRowIdx, lineRails, beRailsData,
  areaLabel, trapSettingsMap, railOverhangCm, stockLengths,
}: {
  useStored: boolean
  selectedPanelRowIdx: number
  lineRails: LineRailsMap | null
  beRailsData: BeRailsAreaData[] | null
  areaLabel: string
  trapSettingsMap: Record<string, any>
  railOverhangCm: number
  stockLengths: number[]
}): RailConfig {
  const trapId = rowPanels[0]?.trapezoidId
  const isEditableRow = !useStored && ri === selectedPanelRowIdx
  let rowRails: LineRailsMap | null
  if (isEditableRow) {
    rowRails = lineRails
  } else {
    rowRails = buildLineRailsFromBE(beRailsData, areaLabel, ri) ?? lineRails
  }
  const ts = (trapId && trapSettingsMap[trapId]) ?? {}
  const stored = !isEditableRow
  // Per-line segments from BE are authoritative regardless of edit mode: they carry
  // server-only adjustments (long-rail extension, split-at-holes) that the FE shouldn't
  // recompute. When set, the FE emits one rail per segment using BE-anchored positions.
  const lineSegments = buildLineSegmentsFromBE(beRailsData, areaLabel, ri) ?? undefined
  return {
    lineRails: rowRails,
    overhangCm: stored ? (ts.railOverhangCm ?? railOverhangCm) : railOverhangCm,
    stockLengths: stored ? (ts.stockLengths ?? stockLengths) : stockLengths,
    lineSegments,
  }
}

/**
 * Compute rail layouts for all area rows.
 * Expands multi-row areas into separate layout entries.
 */
export function computeAllRowRailLayouts({
  rowKeys, rowGroups, pixelToCmRatio,
  selectedRowIdx, selectedPanelRowIdx, printMode,
  lineRails, trapSettingsMap, railOverhangCm, stockLengths,
  beRailsData, groupKeyToLabel,
}: {
  rowKeys: number[]
  rowGroups: Record<number, PanelLayout[]>
  pixelToCmRatio: number
  selectedRowIdx: number | null
  selectedPanelRowIdx: number
  printMode: boolean
  lineRails: LineRailsMap | null
  trapSettingsMap: Record<string, any>
  railOverhangCm: number
  stockLengths: number[]
  beRailsData: BeRailsAreaData[] | null
  groupKeyToLabel: Record<number, string>
}): { railLayouts: (RowRailLayout | null)[]; railLayoutKeys: number[] } {
  const layouts: (RowRailLayout | null)[] = []
  const layoutKeys: number[] = []
  rowKeys.forEach((rowKey, i) => {
    const areaPanels = rowGroups[rowKey] ?? []
    const useStored = i !== selectedRowIdx || printMode
    const panelRowGroups: Record<number, PanelLayout[]> = {}
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
      const rl = computeRowRailLayout(areaPanels, pixelToCmRatio, cfg)
      if (rl) rl._panelRowIdx = 0
      layouts.push(rl)
      layoutKeys.push(rowKey)
    } else {
      for (const ri of rowIdxKeys) {
        const rowPanels = panelRowGroups[ri]
        const cfg = buildRowRailConfig(rowPanels, ri, cfgOpts)
        const rl = computeRowRailLayout(rowPanels, pixelToCmRatio, cfg)
        if (rl) rl._panelRowIdx = ri
        layouts.push(rl)
        layoutKeys.push(rowKey)
      }
    }
  })
  return { railLayouts: layouts, railLayoutKeys: layoutKeys }
}

/**
 * Compute rail layout for one row's panels.
 */
export function computeRowRailLayout(rowPanels: PanelLayout[], pixelToCmRatio: number, railConfig: RailConfig = {}): RowRailLayout | null {
  if (!rowPanels || rowPanels.length === 0 || !pixelToCmRatio) return null
  if (!railConfig.stockLengths || !railConfig.overhangCm) return null

  const railOverhangCm = railConfig.overhangCm
  const lineRails      = railConfig.lineRails ?? null
  const railSpacingV   = railConfig.railSpacingV
  const railSpacingH   = railConfig.railSpacingH
  const lineSegments   = railConfig.lineSegments
  const anchorPanels   = railConfig.anchorPanels

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
  const lineGroups: Record<number, PanelLocalRect[]> = {}
  for (const pr of panelLocalRects) {
    const li = pr.line
    if (!lineGroups[li]) lineGroups[li] = []
    lineGroups[li].push(pr)
  }

  // Row-wide anchor for BE coord 0. BE's startCm/lengthCm have LTR semantics:
  // BE coord 0 = cell[0]'s "LEFT edge" in BE measurement = the side facing the
  // (hypothetical) negative-index cell. For BL/TL (LTR) areas, cell[0] is
  // visually leftmost so this edge is the visually-leftmost edge of the row
  // (= MIN of panel left edges in local). For BR/TR (RTL) areas, cell[0] is
  // visually rightmost so this edge is the visually-RIGHTMOST edge of the row
  // (= MAX of panel right edges in local). In RTL, BE coord positive maps to
  // decreasing local x — so we subtract instead of adding when building spans.
  //
  // When anchorPanels is provided (bases tab per-trap layout with a panel subset),
  // transform them to this call's local frame; otherwise fall back to rowPanels
  // (which, for the rails tab, already contains the full row).
  const isRtl = (rowPanels[0] as any)?.xDir === 'rtl'
  const anchorSet = (anchorPanels && anchorPanels.length > 0) ? anchorPanels : rowPanels
  let rowAnchorX: number | undefined = undefined
  for (const p of anchorSet) {
    const lc = screenToLocal({ x: p.x + p.width / 2, y: p.y + p.height / 2 }, center, angleRad)
    if (isRtl) {
      // RTL anchor = right-edge of the visually-rightmost panel (= cell[0]'s right edge)
      const right = lc.x + p.width / 2
      if (rowAnchorX === undefined || right > rowAnchorX) {
        rowAnchorX = right
      }
    } else {
      // LTR anchor = left-edge of the visually-leftmost panel (= cell[0]'s left edge)
      const left = lc.x - p.width / 2
      if (rowAnchorX === undefined || left < rowAnchorX) {
        rowAnchorX = left
      }
    }
  }

  const rails: FERail[] = []
  let railCounter = 1

  for (const lineIdxStr of Object.keys(lineGroups).sort((a, b) => Number(a) - Number(b))) {
    const lineIdx = Number(lineIdxStr)
    const lineRects = lineGroups[lineIdx]
    const samplePanel = rowPanels.find(p => (p.line ?? 0) === lineIdx) || rowPanels[0]
    const orientation = getPanelOrientation(samplePanel)

    const lineMinY = Math.min(...lineRects.map(r => r.localY))
    const lineMaxY = Math.max(...lineRects.map(r => r.localY + r.height))
    const lineDepthPx = lineMaxY - lineMinY

    // Rail y-positions: from lineRails config or fall back to default symmetric placement.
    // Fallback chain when this lineIdx isn't keyed in lineRails:
    //   1. If lineRails has any populated entry (e.g. a Recalc-split sub-row whose BE
    //      rails were keyed under lineIdx=0 while panels carry the parent's original
    //      line index), use the first available entry — the offsets are valid for
    //      this row regardless of label mismatch.
    //   2. Otherwise compute from railSpacingV/H. spacing=0 would collapse both rails
    //      to the panel midpoint, so guard against that with a panelDepth-based default.
    let railYPositions: number[]
    if (lineRails && lineRails[lineIdx] && (lineRails[lineIdx] as number[]).length >= 2) {
      railYPositions = (lineRails[lineIdx] as number[]).map(offsetCm => lineMaxY - offsetCm / pixelToCmRatio)
    } else if (lineRails) {
      const firstAvail = Object.values(lineRails).find(arr => Array.isArray(arr) && arr.length >= 2) as number[] | undefined
      if (firstAvail) {
        railYPositions = firstAvail.map(offsetCm => lineMaxY - offsetCm / pixelToCmRatio)
      } else {
        const spacing = orientation === 'LANDSCAPE' ? (railSpacingH ?? 0) : (railSpacingV ?? 0)
        const offsetPx = spacing > 0
          ? Math.max(0, (lineDepthPx - spacing / pixelToCmRatio) / 2)
          : lineDepthPx * 0.2
        railYPositions = [lineMinY + offsetPx, lineMaxY - offsetPx]
      }
    } else {
      const spacing = orientation === 'LANDSCAPE' ? (railSpacingH ?? 0) : (railSpacingV ?? 0)
      const offsetPx = spacing > 0
        ? Math.max(0, (lineDepthPx - spacing / pixelToCmRatio) / 2)
        : lineDepthPx * 0.2
      railYPositions = [lineMinY + offsetPx, lineMaxY - offsetPx]
    }

    const segmentsForLine = lineSegments?.[lineIdx]
    // BE coord 0 = row start (col 0 position). Use the row-wide leftmost panel
    // as the anchor for every line, since BE's startCm is in row-coords. Fall back
    // to this line's leftmost panel only if no panels exist (shouldn't happen).
    const lineMinX = rowAnchorX ?? (lineRects.length > 0 ? Math.min(...lineRects.map(r => r.localX)) : 0)

    // Build the X spans for this line: one per BE segment when present (handles
    // split-at-holes + per-segment long-rail extension); otherwise a single span
    // covering all panels with the global overhang (edit mode / no BE data).
    // For RTL areas, BE coord positive goes leftward in local px, so we subtract.
    type Span = { xMin: number; xMax: number }
    const spans: Span[] = segmentsForLine && segmentsForLine.length > 0
      ? segmentsForLine.map(seg => isRtl
          ? {
              xMin: lineMinX - (seg.startCm + seg.lengthCm) / pixelToCmRatio,
              xMax: lineMinX - seg.startCm / pixelToCmRatio,
            }
          : {
              xMin: lineMinX + seg.startCm / pixelToCmRatio,
              xMax: lineMinX + (seg.startCm + seg.lengthCm) / pixelToCmRatio,
            })
      : (() => {
          // Fallback (edit mode / no BE data): one rail spanning all panels that
          // overlap this line's Y range, inflated by the global overhang.
          let xMin = Infinity, xMax = -Infinity
          const midY = (lineMinY + lineMaxY) / 2
          for (const pr of panelLocalRects) {
            if (midY >= pr.localY - 0.5 && midY <= pr.localY + pr.height + 0.5) {
              xMin = Math.min(xMin, pr.localX)
              xMax = Math.max(xMax, pr.localX + pr.width)
            }
          }
          if (xMin === Infinity) return []
          const overhangPx = railOverhangCm / pixelToCmRatio
          return [{ xMin: xMin - overhangPx, xMax: xMax + overhangPx }]
        })()

    // Iterate segment → Y-offset to match BE rail ID order (line → segment → offset).
    // This makes FE railId match BE railId for the stockSegmentsMm lookup.
    for (const { xMin, xMax } of spans) {
      for (const railY of railYPositions) {
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
  }

  return { frame: { center, angleRad, localBounds }, panelLocalRects, rails }
}
