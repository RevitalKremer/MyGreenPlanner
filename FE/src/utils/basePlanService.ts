import { computeRowRailLayout, computePanelFrame, localToScreen, getPanelOrientation, buildLineRailsFromBE } from './railLayoutService'
import type {
  Point, LineInfo, BasePlanBase, BasePlanFrame, RowBasePlan, BaseConfig,
  RowRailLayout, Step2Area, BeRailsAreaData, BeBasesAreaData, RailConfig, PanelLayout,
} from '../types/projectData'

export type { RowBasePlan }

// ─── Core computation ────────────────────────────────────────────────────────

/**
 * Compute base placement for one row.
 */
export function computeRowBasePlan(rowPanels: PanelLayout[], pixelToCmRatio: number, railConfig: RailConfig = {}, baseConfig: BaseConfig = {}): RowBasePlan | null {
  if (!rowPanels || rowPanels.length === 0 || !pixelToCmRatio) return null
  if (!baseConfig.customOffsets || baseConfig.customOffsets.length === 0) return null

  const rl = computeRowRailLayout(rowPanels, pixelToCmRatio, railConfig)
  if (!rl) return null

  const { frame, panelLocalRects } = rl
  const { center, angleRad, localBounds } = frame

  // Per-line bounds (local Y extents) and orientation
  const lineMap: Record<number, LineInfo> = {}
  for (const pr of panelLocalRects) {
    const li = pr.line ?? 0
    if (!lineMap[li]) lineMap[li] = { lineIdx: li, minY: Infinity, maxY: -Infinity, orientation: null }
    lineMap[li].minY = Math.min(lineMap[li].minY, pr.localY)
    lineMap[li].maxY = Math.max(lineMap[li].maxY, pr.localY + pr.height)
  }
  for (const li of Object.keys(lineMap)) {
    const lineIdx = Number(li)
    const panel = rowPanels.find(p => (p.line ?? 0) === lineIdx) || rowPanels[0]
    lineMap[li].orientation = getPanelOrientation(panel)
  }
  const lines = Object.values(lineMap).sort((a, b) => a.minY - b.minY)

  // Frame spans panel edges (not rail ends)
  const frameXMinPx   = localBounds.minX
  const frameXMaxPx   = localBounds.maxX
  const frameLengthPx = frameXMaxPx - frameXMinPx
  const frameLengthMm = Math.round(frameLengthPx * pixelToCmRatio * 10)

  // Determine X direction from panels — for RTL areas (BR/TR), offset grows from maxX toward minX
  const xDir = rowPanels[0]?.xDir ?? 'ltr'
  const isRtl = xDir === 'rtl'

  // Convert BE-provided offsets (mm) to pixel coordinates for SVG rendering
  const makeBase = (offsetFromStartMm: number): BasePlanBase => {
    const xPx = isRtl
      ? frameXMaxPx - (offsetFromStartMm / 10) / pixelToCmRatio
      : frameXMinPx + (offsetFromStartMm / 10) / pixelToCmRatio
    const screenTop    = localToScreen({ x: xPx, y: localBounds.minY }, center, angleRad)
    const screenBottom = localToScreen({ x: xPx, y: localBounds.maxY }, center, angleRad)
    return { localX: xPx, screenTop, screenBottom, offsetFromStartMm }
  }

  const bases = baseConfig.customOffsets.map(makeBase)
  const actualSpacingMm = bases.length > 1
    ? Math.max(...bases.slice(1).map((b, i) => b.offsetFromStartMm - bases[i].offsetFromStartMm))
    : 0

  return {
    frame: { center, angleRad, localBounds, frameXMinPx, frameXMaxPx },
    lines,
    bases,
    frameLengthMm,
    baseCount: bases.length,
    spacingMm: Math.round(actualSpacingMm),
    isRtl,
  }
}

/**
 * Consolidate bases across sub-areas within the same area.
 */
export function consolidateAreaBases(areaTrapsMap: Record<string | number, string[]>, basePlansMap: Record<string, RowBasePlan | null>): Record<string, BasePlanBase[]> {
  const result: Record<string, BasePlanBase[]> = {}
  for (const [trapId, bp] of Object.entries(basePlansMap)) {
    if (bp) result[trapId] = [...bp.bases]
  }

  for (const trapIds of Object.values(areaTrapsMap)) {
    if (trapIds.length <= 1) continue

    const trapInfos = trapIds.map(trapId => {
      const bp = basePlansMap[trapId]
      if (!bp) return null
      const { frame } = bp
      const depth = frame.localBounds.maxY - frame.localBounds.minY
      const width = frame.frameXMaxPx - frame.frameXMinPx
      const { angleRad } = frame
      const centerProj = frame.center.x * Math.cos(angleRad) + frame.center.y * Math.sin(angleRad)
      const xProjMin = centerProj + frame.frameXMinPx
      const xProjMax = centerProj + frame.frameXMaxPx
      return { trapId, depth, width, angleRad, xProjMin, xProjMax }
    }).filter(Boolean)

    for (const infoA of trapInfos) {
      result[infoA.trapId] = result[infoA.trapId].filter(base => {
        const xProjBase = base.screenTop.x * Math.cos(infoA.angleRad) + base.screenTop.y * Math.sin(infoA.angleRad)
        for (const infoB of trapInfos) {
          if (infoB.trapId === infoA.trapId) continue
          if (xProjBase > infoB.xProjMin && xProjBase < infoB.xProjMax) {
            if (infoB.depth > infoA.depth || (infoB.depth === infoA.depth && infoB.width >= infoA.width)) {
              return false
            }
          }
        }
        return true
      })
    }
  }

  return result
}


/**
 * Build bidirectional maps: trapId → areaKey, areaKey → [trapIds].
 */
export function buildTrapAreaMaps(trapIds: string[], areas: Step2Area[]): { trapAreaMap: Record<string, string | number>; areaTrapsMap: Record<string | number, string[]> } {
  const trapAreaMap: Record<string, string | number> = {}
  const areaTrapsMap: Record<string | number, string[]> = {}
  if (areas.length > 0) {
    for (const area of areas) {
      const aid = area.id
      if (!areaTrapsMap[aid]) areaTrapsMap[aid] = []
      for (const tid of (area.trapezoidIds || [])) {
        trapAreaMap[tid] = aid
        areaTrapsMap[aid].push(tid)
      }
    }
  } else {
    for (const trapId of trapIds) {
      const area = trapId.replace(/\d+$/, '')
      trapAreaMap[trapId] = area
      if (!areaTrapsMap[area]) areaTrapsMap[area] = []
      areaTrapsMap[area].push(trapId)
    }
  }
  return { trapAreaMap, areaTrapsMap }
}


/**
 * Build BE rail lookup keyed by trapId:railId (for RailsOverlay in bases tab).
 */
export function buildBasePlanBeRailLookup(beBasesData: BeBasesAreaData[] | null, areaTrapsMap: Record<string | number, string[]>): Record<string, any> {
  const m: Record<string, any> = {}
  for (const areaData of (beBasesData ?? [])) {
    const areaTrapIds = areaTrapsMap[areaData.areaId] ?? areaTrapsMap[areaData.areaLabel] ?? []
    for (const r of (areaData.rails ?? [])) {
      for (const tid of areaTrapIds) {
        m[`${tid}:${r.railId}`] = r
      }
    }
  }
  return m
}


/**
 * Compute expanded base plans and rail layouts — one per (trapId, panelRowIdx).
 */
export function computeExpandedBasePlans({
  trapIds, trapGroups, pixelToCmRatio,
  trapSettingsMap, customBasesMap, beRailsData, areas,
}: {
  trapIds: string[]
  trapGroups: Record<string, PanelLayout[]>
  pixelToCmRatio: number
  trapSettingsMap: Record<string, any>
  customBasesMap: Record<string, number[]>
  beRailsData: BeRailsAreaData[] | null
  areas: Step2Area[]
}): { expandedBasePlans: (RowBasePlan | null)[]; expandedRailLayouts: (RowRailLayout | null)[]; expandedTrapIds: string[] } {
  const bps: (RowBasePlan | null)[] = []
  const rls: (RowRailLayout | null)[] = []
  const eTrapIds: string[] = []
  const trapLabel = (tid: string) => {
    const a = (areas || []).find(ar => (ar.trapezoidIds || []).includes(tid))
    return a?.label ?? tid.replace(/\d+$/, '')
  }

  for (const trapId of trapIds) {
    const allPanels = trapGroups[trapId] ?? []
    const s = trapSettingsMap[trapId] ?? {}

    const byRow: Record<number, PanelLayout[]> = {}
    for (const p of allPanels) {
      const ri = p.panelRowIdx ?? 0
      if (!byRow[ri]) byRow[ri] = []
      byRow[ri].push(p)
    }
    const rowIdxKeys = Object.keys(byRow).map(Number).sort((a, b) => a - b)

    for (const ri of rowIdxKeys) {
      const rowPanels = byRow[ri]
      const lineRails = buildLineRailsFromBE(beRailsData, trapLabel(trapId), ri) ?? null
      const cfg: BaseConfig = { edgeOffsetMm: s.edgeOffsetMm, spacingMm: s.spacingMm }
      const customOffsets = customBasesMap[trapId]
      if (customOffsets?.length > 0) cfg.customOffsets = customOffsets
      bps.push(computeRowBasePlan(rowPanels, pixelToCmRatio, { overhangCm: s.railOverhangCm, stockLengths: s.stockLengths, lineRails }, cfg))
      rls.push(computeRowRailLayout(rowPanels, pixelToCmRatio, { lineRails, overhangCm: s.railOverhangCm, stockLengths: s.stockLengths }))
      eTrapIds.push(trapId)
    }
  }
  return { expandedBasePlans: bps, expandedRailLayouts: rls, expandedTrapIds: eTrapIds }
}


/**
 * Build per-row panel frames keyed by "areaKey:rowIdx" (and plain areaKey for row 0).
 */
export function buildAreaFrames(panels: PanelLayout[], trapAreaMap: Record<string, string | number>, areas: Step2Area[]): Record<string, any> {
  const rowPanels: Record<string, { areaKey: string | number; ri: number; panels: PanelLayout[] }> = {}
  for (const p of panels) {
    const tid = p.trapezoidId ?? 'A1'
    const areaKey = trapAreaMap[tid] ?? tid.replace(/\d+$/, '')
    const ri = p.panelRowIdx ?? 0
    const key = `${areaKey}:${ri}`
    if (!rowPanels[key]) rowPanels[key] = { areaKey, ri, panels: [] }
    rowPanels[key].panels.push(p)
  }

  const buildFrame = (areaPnls: PanelLayout[]) => {
    const pf = computePanelFrame(areaPnls)
    if (!pf) return null
    const lineMap: Record<number, { lineIdx: number; minY: number; maxY: number }> = {}
    for (const pr of pf.panelLocalRects) {
      const li = pr.line ?? 0
      if (!lineMap[li]) lineMap[li] = { lineIdx: li, minY: Infinity, maxY: -Infinity }
      lineMap[li].minY = Math.min(lineMap[li].minY, pr.localY)
      lineMap[li].maxY = Math.max(lineMap[li].maxY, pr.localY + pr.height)
    }
    const lines = Object.values(lineMap).sort((a, b) => a.minY - b.minY)
    const isRtl = areaPnls[0]?.xDir === 'rtl'
    const isBtt = areaPnls[0]?.yDir === 'btt'
    return { frame: { center: pf.center, angleRad: pf.angleRad, localBounds: pf.localBounds }, lines, isRtl, isBtt }
  }

  const map: Record<string, any> = {}
  for (const [key, { areaKey, ri, panels: pnls }] of Object.entries(rowPanels)) {
    const f = buildFrame(pnls)
    if (!f) continue
    map[key] = f
    if (ri === 0 && !map[areaKey]) map[areaKey] = f
  }
  // Also key by area label so beBasesData lookups work
  for (const area of areas) {
    const idKey = area.id
    if (idKey != null && map[idKey] && area.label && area.label !== String(idKey)) {
      map[area.label] = map[idKey]
    }
  }
  return map
}


/**
 * Merge expanded base plans into a per-trap lookup (first row per trap wins).
 */
export function buildBasePlansMap(expandedTrapIds: string[], basePlans: (RowBasePlan | null)[]): Record<string, RowBasePlan> {
  const m: Record<string, RowBasePlan> = {}
  expandedTrapIds.forEach((trapId, i) => {
    if (!basePlans[i]) return
    if (!m[trapId]) m[trapId] = basePlans[i]
  })
  return m
}
