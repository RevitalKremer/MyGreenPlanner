import { useMemo, useCallback } from 'react'
import { isHorizontalOrientation, isEmptyOrientation, lineSlopeDepth } from '../utils/trapezoidGeometry'
import { initDefaultLineRails } from '../utils/railLayoutService'
import { REAL_PANELS, PANEL_V } from '../utils/panelCodes.js'
import { isAreaFrameless } from '../utils/roofSpecUtils'
import type {
  ComputedTrapezoid, Step2Area, BeRailsAreaData, PanelLayout, PanelLineSegment,
  LineRailsMap, PanelSpec, ParamSchemaEntry, RefinedArea,
} from '../types/projectData'

interface UseRowDataParams {
  panels: PanelLayout[]
  areas: Step2Area[]
  refinedArea: RefinedArea | null
  trapezoidConfigs: Record<string, any>
  setTrapezoidConfigs: ((fn: (prev: Record<string, any>) => Record<string, any>) => void) | null
  beRailsData: BeRailsAreaData[] | null
  beTrapezoidsData: Record<string, ComputedTrapezoid> | null
  panelSpec: PanelSpec
  appDefaults: Record<string, any> | null
  getSettings: (areaIdx: number) => Record<string, any>
  getTrapBasesSettings: (trapId: string) => Record<string, any>
  getLineOrientations: (areaKey: number, trapId: string) => string[]
  areaSettings: Record<number, any>
  globalSettings: Record<string, any>
  PARAM_SCHEMA: ParamSchemaEntry[]
  roofType?: string
  // Optional: when provided, applyBasesToAll routes through this so per-key
  // dirty tracking sees the writes (needed for the partial saveTab payload).
  setParam?: (path: { scope: 'global' | 'area' | 'trap'; anchor?: any; key: string }, value: any) => void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Flatten rails/bases from dict[rowIndex → list] to a single list.
 * Handles both new dict format and legacy list format.
 */
function flattenRowDict(d: any): any[] {
  if (!d) return []
  if (Array.isArray(d)) return d  // legacy list format
  return Object.values(d).flat()
}

function assignTypes(rowConstructions: Record<string, any>[]) {
  const typeMap: Record<string, string> = {}
  let nextCode = 65
  return rowConstructions.map(rc => {
    const key = `${Math.round(rc.angle)}_${Math.round(rc.heightRear)}_${Math.round(rc.heightFront)}`
    if (!typeMap[key]) typeMap[key] = String.fromCharCode(nextCode++)
    return { ...rc, typeLetter: typeMap[key] }
  })
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Derives row-level data: panel counts, row keys, line rails,
 * trapezoid maps, and construction geometry from BE data.
 */
export default function useRowData({
  panels, areas, refinedArea, trapezoidConfigs, setTrapezoidConfigs,
  beRailsData, beTrapezoidsData, panelSpec, appDefaults,
  getSettings, getTrapBasesSettings, getLineOrientations,
  areaSettings, globalSettings, PARAM_SCHEMA, roofType = 'concrete',
  setParam,
}: UseRowDataParams) {
  const panelLengthCm = panelSpec.lengthCm
  const panelWidthCm  = panelSpec.widthCm
  const lineGapCm     = appDefaults?.lineGapCm
  const railSpacingV  = (PARAM_SCHEMA.find(p => p.key === 'railSpacingV') || {} as any).default
  const railSpacingH  = (PARAM_SCHEMA.find(p => p.key === 'railSpacingH') || {} as any).default

  // Frameless areas (tiles, flat_installation) have no construction frame →
  // skip trap-detail / construction geometry computation.
  const _isAreaFrameless = useCallback(
    (areaObj: any) => isAreaFrameless(roofType, areaObj),
    [roofType],
  )

  // ── Panel counts & row keys ─────────────────────────────────────────────
  const rowPanelCounts = useMemo(() => {
    const map: Record<string | number, number> = {}
    panels.forEach(p => {
      const key = p.areaGroupKey ?? (p.area ?? (p as any).row) ?? 'unassigned'
      map[key] = (map[key] || 0) + 1
    })
    return map
  }, [panels])

  const rowKeys = useMemo(() =>
    Object.keys(rowPanelCounts).filter(k => k !== 'unassigned').map(Number).sort((a, b) => a - b),
    [rowPanelCounts]
  )

  // Map areaGroupKey → areas entry.
  const areaByGroupKey = useMemo(() => {
    const map: Record<number, Step2Area> = {}
    const areaByLabel: Record<string, Step2Area> = {}
    for (const a of areas) { if (a.label) areaByLabel[a.label] = a }
    for (const key of rowKeys) {
      const samplePanel = panels.find(p => p.areaGroupKey === key)
      if (samplePanel) {
        // Legacy projects may have non-string trapezoidId from before the
        // empty-label gates — coerce defensively so render doesn't crash.
        const trapId = typeof samplePanel.trapezoidId === 'string' ? samplePanel.trapezoidId : null
        const matched = areas.find(a => a.trapezoidIds?.includes(trapId))
          ?? (trapId ? areaByLabel[trapId.replace(/\d+$/, '')] : undefined)
        if (matched) { map[key] = matched; continue }
      }
      if (areas[key]) map[key] = areas[key]
    }
    return map
  }, [rowKeys, areas, panels])

  // ── Line rails resolution ──────────────────────────────────────────────
  const getLineRailsFromBE = useCallback((areaIdx: number, lineOrientations: string[], panelRowIdx: number = 0): LineRailsMap | null => {
    if (!beRailsData) return null
    const areaKey = rowKeys[areaIdx]
    const area    = areaByGroupKey[areaKey]
    if (!area) return null
    const beArea  = beRailsData.find(a => (a.areaId != null ? a.areaId === area.id : a.areaLabel === area.label))
    const rails = beArea?.rails ?? []
    let rowRails = rails.filter(r => (r._panelRowIdx ?? 0) === panelRowIdx)
    if (!rowRails.length) rowRails = rails.filter(r => (r._panelRowIdx ?? 0) === 0)
    if (!rowRails.length) return null
    const map: LineRailsMap = {}
    for (const r of rowRails) {
      if (!map[r.lineIdx]) map[r.lineIdx] = []
      ;(map[r.lineIdx] as number[]).push(r.offsetFromLineFrontCm)
    }
    for (const li of Object.keys(map)) map[li] = [...map[li]].sort((a, b) => a - b)
    if (Object.keys(map).length !== lineOrientations.length) return null
    return map
  }, [beRailsData, areas, rowKeys])

  // Resolution order: per-area lineRails override (future rails-edit mode) →
  // per-area railSpacingV/H derivation (typed spacing — what live preview
  // uses) → BE-computed rails → global default spacing.
  const getLineRails = useCallback((areaIdx: number, lineOrientations: string[], panelRowIdx: number = 0): LineRailsMap => {
    const areaCfg: any = areaSettings[areaIdx] || {}
    const stored = areaCfg.lineRails
    if (stored && Object.keys(stored).length === lineOrientations.length) return stored
    if (areaCfg.railSpacingV != null || areaCfg.railSpacingH != null) {
      const depths = lineOrientations.map(o => lineSlopeDepth(o, panelLengthCm, panelWidthCm))
      return initDefaultLineRails(
        lineOrientations, depths,
        areaCfg.railSpacingV ?? railSpacingV,
        areaCfg.railSpacingH ?? railSpacingH,
      )
    }
    const fromBE = getLineRailsFromBE(areaIdx, lineOrientations, panelRowIdx)
    if (fromBE) return fromBE
    const depths = lineOrientations.map(o => lineSlopeDepth(o, panelLengthCm, panelWidthCm))
    return initDefaultLineRails(lineOrientations, depths, railSpacingV, railSpacingH)
  }, [areaSettings, getLineRailsFromBE, railSpacingV, railSpacingH, panelLengthCm, panelWidthCm])

  // ── Trapezoid map ──────────────────────────────────────────────────────
  const areaTrapezoidMap = useMemo(() => {
    const map: Record<number, string[]> = {}
    rowKeys.forEach(areaKey => {
      const letter = String.fromCharCode(65 + areaKey)
      const areaObj = areaByGroupKey[areaKey]
      const serverIds = areaObj?.trapezoidIds
      if (serverIds?.length > 0) {
        map[areaKey] = serverIds
      } else {
        const ids = [...new Set(
          panels.filter(p => (p.area ?? (p as any).row) === areaKey).map(p => p.trapezoidId).filter(Boolean)
        )].sort()
        map[areaKey] = ids.length > 0 ? ids : [`${letter}1`]
      }
    })
    return map
  }, [panels, rowKeys, areas])

  // ── Apply bases to all traps ───────────────────────────────────────────
  // Route every write through setParam so per-key dirty tracking includes
  // every target trap — otherwise the next saveTab payload would carry only
  // the source trap and silently drop the rest.
  const applyBasesToAll = useCallback((effectiveSelectedTrapId: string) => {
    if (!effectiveSelectedTrapId) return
    const trapBases = getTrapBasesSettings(effectiveSelectedTrapId)
    const allTrapIds = Object.values(areaTrapezoidMap).flat()
    if (setParam) {
      allTrapIds.forEach(trapId => {
        Object.entries(trapBases).forEach(([key, value]) => {
          setParam({ scope: 'trap', anchor: trapId, key }, value)
        })
      })
    } else if (setTrapezoidConfigs) {
      // Fallback for callers that didn't wire setParam: legacy bulk write.
      setTrapezoidConfigs(prev => {
        const next = { ...prev }
        allTrapIds.forEach(trapId => {
          next[trapId] = { ...(prev[trapId] || {}), ...trapBases }
        })
        return next
      })
    }
  }, [getTrapBasesSettings, areaTrapezoidMap, setTrapezoidConfigs, setParam])

  // ── Construction calculations (from BE geometry) ───────────────────────
  const rowConstructions = useMemo(() => {
    const rcs = rowKeys.map((areaKey, i) => {
      const panelCount = rowPanelCounts[areaKey] || 1
      const globalCfg  = refinedArea?.panelConfig || {}
      const trapId     = areaTrapezoidMap[areaKey]?.[0] ?? `${String.fromCharCode(65 + areaKey)}1`
      const override   = trapezoidConfigs[trapId] || {}
      const angle      = override.angle ?? globalCfg.angle ?? 0
      const panelFrontH = override.frontHeight ?? globalCfg.frontHeight ?? 0
      const s          = getSettings(i)
      const trapBases  = getTrapBasesSettings(trapId)
      const railOverhang = s.railOverhangCm
      const maxSpan      = trapBases.spacingMm / 10
      const angleRad     = angle * Math.PI / 180
      const crossRailH   = s.crossRailEdgeDistMm / 10

      const lineOrientations = getLineOrientations(areaKey, trapId)
      const lineRails        = getLineRails(i, lineOrientations)
      const railOffsetCm = lineRails[0]?.[0] ?? 0
      const frontLegH    = Math.max(0, panelFrontH - s.blockHeightCm + railOffsetCm * Math.sin(angleRad) - crossRailH * Math.cos(angleRad))

      const areaObj    = areaByGroupKey[areaKey]
      const beAreaData = beRailsData?.find(a => (a.areaId != null && areaObj?.id != null ? a.areaId === areaObj.id : a.areaLabel === areaObj?.label))
      const rails      = flattenRowDict(beAreaData?.rails)

      const measuredRowLength = rails.length > 0 ? Math.max(...rails.map(r => r.roundedLengthCm ?? r.lengthCm)) : undefined
      const numRailConnectors = rails.reduce((sum: number, r: any) => sum + Math.max(0, r.stockSegmentsMm.length - 1), 0)

      const beTrapDetail = beTrapezoidsData?.[trapId]
      const beGeom = beTrapDetail?.geometry
      const numRails = Object.values(lineRails).reduce((sum: number, arr) => sum + (arr as number[]).length, 0)
      const numLines = Object.keys(lineRails).length

      // Tiles: no trapezoid geometry — build minimal row construction from rails only
      if (!beGeom && measuredRowLength != null) {
        return {
          angle: 0, frontHeight: 0, panelCount,
          rowLength: measuredRowLength,
          baseLength: 0,
          heightRear: 0, heightFront: 0,
          topBeamLength: 0, baseBeamLength: 0,
          numTrapezoids: 0, spacing: 0,
          railOverhang,
          panelsPerLine: (areaByGroupKey[areaKey]?.panelRows?.flatMap(pr => pr?.panelGrid?.rows ?? []) ?? []).map(row => row.filter(c => REAL_PANELS.includes(c)).length),
          numRails, numLines,
          numLargeGaps: beAreaData?.numLargeGaps ?? 0,
          numRailConnectors,
        }
      }

      if (!beGeom || measuredRowLength == null) return null

      const numSpans = Math.max(1, Math.ceil(measuredRowLength / maxSpan))
      return {
        ...beGeom,
        angle, frontHeight: frontLegH, panelCount,
        rowLength: measuredRowLength,
        baseLength: beGeom.baseBeamLength,
        numTrapezoids: numSpans + 1,
        spacing: measuredRowLength / numSpans,
        railOverhang,
        panelsPerLine: (areaByGroupKey[areaKey]?.panelRows?.flatMap(pr => pr?.panelGrid?.rows ?? []) ?? []).map(row => row.filter(c => REAL_PANELS.includes(c)).length),
        numRails, numLines,
        numLargeGaps: beAreaData?.numLargeGaps ?? 0,
        numRailConnectors,
      }
    })
    return assignTypes(rcs.filter(Boolean))
  }, [rowKeys, rowPanelCounts, refinedArea, trapezoidConfigs, areaSettings, globalSettings, beRailsData, beTrapezoidsData, areas, areaTrapezoidMap, getTrapBasesSettings])

  // ── Per-trapezoid maps ─────────────────────────────────────────────────
  const trapLineRailsMap = useMemo(() => {
    const map: Record<string, LineRailsMap> = {}
    rowKeys.forEach((areaKey, i) => {
      const trapIds = areaTrapezoidMap[areaKey] || []
      trapIds.forEach(trapId => {
        const lineOrs = getLineOrientations(areaKey, trapId)
        // Use the trap's owning panel row (set by the BE) so each trap in a
        // multi-row area pulls its OWN rails — defaulting to row 0 would feed
        // every trap row-0's rails (A1's) regardless of which row it lives in.
        const pri = beTrapezoidsData?.[trapId]?.panelRowIdx ?? 0
        const rails = getLineRails(i, lineOrs, pri)
        map[trapId] = rails
      })
    })
    // Variations inherit their parent's lineRails — they share the row.
    if (beTrapezoidsData) {
      Object.entries(beTrapezoidsData).forEach(([tid, t]) => {
        const parentId = (t as any)?.parentId
        if (parentId && map[parentId] && map[tid] == null) map[tid] = map[parentId]
      })
    }
    return map
  }, [rowKeys, areaTrapezoidMap, getLineOrientations, getLineRails, beTrapezoidsData])

  const trapSettingsMap = useMemo(() => {
    const map: Record<string, any> = {}
    rowKeys.forEach((areaKey, i) => {
      if (_isAreaFrameless(areaByGroupKey[areaKey])) return
      const s = getSettings(i)
      const trapIds = areaTrapezoidMap[areaKey] || []
      trapIds.forEach(trapId => {
        map[trapId] = { ...s, ...getTrapBasesSettings(trapId) }
      })
    })
    // Variations (trapIds with a parentId, e.g. "A.1") aren't in Step 2's
    // areaTrapezoidMap, but bases on them carry the variation id as their
    // trapezoidId. Mirror the parent's settings entry under the variation id
    // so per-trap lookups by base.trapezoidId resolve.
    if (beTrapezoidsData) {
      Object.entries(beTrapezoidsData).forEach(([tid, t]) => {
        const parentId = (t as any)?.parentId
        if (parentId && map[parentId] && map[tid] == null) map[tid] = map[parentId]
      })
    }
    return map
  }, [rowKeys, areaTrapezoidMap, areaSettings, globalSettings, trapezoidConfigs, getTrapBasesSettings, _isAreaFrameless, beTrapezoidsData]) // eslint-disable-line react-hooks/exhaustive-deps

  const trapRCMap = useMemo(() => {
    const map: Record<string, any> = {}
    rowKeys.forEach((areaKey, i) => {
      if (_isAreaFrameless(areaByGroupKey[areaKey])) return
      const trapIds = areaTrapezoidMap[areaKey] || []
      trapIds.forEach(trapId => { map[trapId] = rowConstructions[i] })
    })
    // Variations inherit their parent's row construction.
    if (beTrapezoidsData) {
      Object.entries(beTrapezoidsData).forEach(([tid, t]) => {
        const parentId = (t as any)?.parentId
        if (parentId && map[parentId] && map[tid] == null) map[tid] = map[parentId]
      })
    }
    return map
  }, [rowKeys, areaTrapezoidMap, rowConstructions, _isAreaFrameless, beTrapezoidsData])

  const trapPanelLinesMap = useMemo(() => {
    const map: Record<string, PanelLineSegment[]> = {}
    const globalCfg = refinedArea?.panelConfig || {}
    rowKeys.forEach((areaKey) => {
      if (_isAreaFrameless(areaByGroupKey[areaKey])) return
      const trapIdsList = areaTrapezoidMap[areaKey] || []
      trapIdsList.forEach(trapId => {
        const override = trapezoidConfigs[trapId] || {}
        // Trap config is the source of truth; fall back to globalCfg only
        // when the trap entry hasn't been initialised yet.
        const lineOrientations = override.lineOrientations ?? globalCfg.lineOrientations ?? [PANEL_V]
        map[trapId] = lineOrientations.map((o: string, i: number) => ({
          depthCm:     isHorizontalOrientation(o) ? panelWidthCm : panelLengthCm,
          gapBeforeCm: i === 0 ? 0 : lineGapCm,
          isEmpty:     isEmptyOrientation(o),
          isHorizontal: isHorizontalOrientation(o),
        }))
      })
    })
    // Variations inherit their parent's panel-line segments.
    if (beTrapezoidsData) {
      Object.entries(beTrapezoidsData).forEach(([tid, t]) => {
        const parentId = (t as any)?.parentId
        if (parentId && map[parentId] && map[tid] == null) map[tid] = map[parentId]
      })
    }
    return map
  }, [rowKeys, areaTrapezoidMap, areas, refinedArea, trapezoidConfigs, areaSettings, globalSettings, _isAreaFrameless, beTrapezoidsData]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    rowPanelCounts, rowKeys, areaByGroupKey,
    getLineRails, areaTrapezoidMap,
    applyBasesToAll, rowConstructions,
    trapLineRailsMap, trapSettingsMap, trapRCMap, trapPanelLinesMap,
  }
}
