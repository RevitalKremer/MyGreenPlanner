import { useMemo, useCallback } from 'react'
import { isHorizontalOrientation, isEmptyOrientation, lineSlopeDepth } from '../utils/trapezoidGeometry'
import { initDefaultLineRails } from '../utils/railLayoutService'
import { REAL_PANELS, PANEL_V } from '../utils/panelCodes.js'
import { isAreaTiles } from '../utils/roofSpecUtils'

/**
 * Flatten rails/bases from dict[rowIndex → list] to a single list.
 * Handles both new dict format and legacy list format.
 */
function flattenRowDict(d) {
  if (!d) return []
  if (Array.isArray(d)) return d  // legacy list format
  return Object.values(d).flat()
}

/**
 * Derives row-level data: panel counts, row keys, line rails,
 * trapezoid maps, and construction geometry from BE data.
 */
export default function useRowData({
  panels, areas, refinedArea, trapezoidConfigs, setTrapezoidConfigs,
  beRailsData, beTrapezoidsData, panelSpec, appDefaults,
  getSettings, getTrapBasesSettings, getLineOrientations,
  areaSettings, globalSettings, PARAM_SCHEMA, roofType = 'concrete',
}) {
  const panelLengthCm = panelSpec.lengthCm
  const panelWidthCm  = panelSpec.widthCm
  const lineGapCm     = appDefaults?.lineGapCm
  const railSpacingV  = (PARAM_SCHEMA.find(p => p.key === 'railSpacingV') || {}).default
  const railSpacingH  = (PARAM_SCHEMA.find(p => p.key === 'railSpacingH') || {}).default

  // Tiles areas have no construction frame → skip trap-detail / construction
  // geometry computation. Uses the shared resolver from roofSpecUtils.
  const _isAreaTiles = useCallback(
    (areaObj) => isAreaTiles(roofType, areaObj),
    [roofType],
  )

  // ── Panel counts & row keys ─────────────────────────────────────────────
  const rowPanelCounts = useMemo(() => {
    const map = {}
    panels.forEach(p => {
      const key = p.areaGroupKey ?? (p.area ?? p.row) ?? 'unassigned'
      map[key] = (map[key] || 0) + 1
    })
    return map
  }, [panels])

  const rowKeys = useMemo(() =>
    Object.keys(rowPanelCounts).filter(k => k !== 'unassigned').map(Number).sort((a, b) => a - b),
    [rowPanelCounts]
  )

  // Map areaGroupKey → areas entry. rowKeys are areaGroupKeys (rectArea indices),
  // but `areas` is a compact array from the server. Match by finding the area whose
  // panels have this areaGroupKey, or fall back to label matching via panels.
  const areaByGroupKey = useMemo(() => {
    const map = {}
    // Build label → area lookup
    const areaByLabel = {}
    for (const a of areas) { if (a.label) areaByLabel[a.label] = a }
    // For each rowKey, find which area's panels use this groupKey
    for (const key of rowKeys) {
      const samplePanel = panels.find(p => p.areaGroupKey === key)
      if (samplePanel) {
        const trapId = samplePanel.trapezoidId
        // Find area containing this trapezoidId
        const matched = areas.find(a => a.trapezoidIds?.includes(trapId))
          ?? areaByLabel[trapId?.replace(/\d+$/, '')]
        if (matched) { map[key] = matched; continue }
      }
      // Fallback: use areas by index (single-row compat)
      if (areas[key]) map[key] = areas[key]
    }
    return map
  }, [rowKeys, areas, panels])

  // ── Line rails resolution ──────────────────────────────────────────────
  // lineRails convention: keys are numeric integers (0, 1, 2...) representing line indices.
  // BE responses may return string keys after JSON serialization. Consumers should handle
  // both via dual fallback: lineRails[si] ?? lineRails[String(si)].
  const getLineRailsFromBE = useCallback((areaIdx, lineOrientations, panelRowIdx = 0) => {
    if (!beRailsData) return null
    const areaKey = rowKeys[areaIdx]
    const area    = areaByGroupKey[areaKey]
    if (!area) return null
    const beArea  = beRailsData.find(a => (a.areaId != null ? a.areaId === area.id : a.areaLabel === area.label))
    // Pull rails for the specific panelRowIdx. Phase A made lineOrientations
    // per-row, so rails can differ across rows in a multi-row area (e.g. a
    // V-only row vs a V+H row). Fall back to row 0 if the requested row has
    // no rails (legacy single-row areas, or a row whose trap is tile-only).
    const rails = beArea?.rails ?? []
    let rowRails = rails.filter(r => (r._panelRowIdx ?? 0) === panelRowIdx)
    if (!rowRails.length) rowRails = rails.filter(r => (r._panelRowIdx ?? 0) === 0)
    if (!rowRails.length) return null
    const map = {}
    for (const r of rowRails) {
      if (!map[r.lineIdx]) map[r.lineIdx] = []
      map[r.lineIdx].push(r.offsetFromLineFrontCm)
    }
    for (const li of Object.keys(map)) map[li] = [...map[li]].sort((a, b) => a - b)
    if (Object.keys(map).length !== lineOrientations.length) return null
    return map
  }, [beRailsData, areas, rowKeys])

  const getLineRails = useCallback((areaIdx, lineOrientations, panelRowIdx = 0) => {
    const stored = areaSettings[areaIdx]?.lineRails
    if (stored && Object.keys(stored).length === lineOrientations.length) return stored
    const fromBE = getLineRailsFromBE(areaIdx, lineOrientations, panelRowIdx)
    if (fromBE) return fromBE
    const depths = lineOrientations.map(o => lineSlopeDepth(o, panelLengthCm, panelWidthCm))
    return initDefaultLineRails(lineOrientations, depths, railSpacingV, railSpacingH)
  }, [areaSettings, getLineRailsFromBE, railSpacingV, railSpacingH])

  // ── Trapezoid map ──────────────────────────────────────────────────────
  // Source of truth: step2.areas.trapezoidIds (from DB via areas prop).
  // Fallback to panel-derived IDs only when areas data is not available.
  const areaTrapezoidMap = useMemo(() => {
    const map = {}
    rowKeys.forEach(areaKey => {
      const letter = String.fromCharCode(65 + areaKey)
      const areaObj = areaByGroupKey[areaKey]
      const serverIds = areaObj?.trapezoidIds
      if (serverIds?.length > 0) {
        map[areaKey] = serverIds
      } else {
        const ids = [...new Set(
          panels.filter(p => (p.area ?? p.row) === areaKey).map(p => p.trapezoidId).filter(Boolean)
        )].sort()
        map[areaKey] = ids.length > 0 ? ids : [`${letter}1`]
      }
    })
    return map
  }, [panels, rowKeys, areas])

  // ── Apply bases to all traps ───────────────────────────────────────────
  const applyBasesToAll = useCallback((effectiveSelectedTrapId) => {
    if (!setTrapezoidConfigs || !effectiveSelectedTrapId) return
    const trapBases = getTrapBasesSettings(effectiveSelectedTrapId)
    const allTrapIds = Object.values(areaTrapezoidMap).flat()
    setTrapezoidConfigs(prev => {
      const next = { ...prev }
      allTrapIds.forEach(trapId => {
        next[trapId] = { ...(prev[trapId] || {}), ...trapBases }
      })
      return next
    })
  }, [getTrapBasesSettings, areaTrapezoidMap, setTrapezoidConfigs])

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
      const numRailConnectors = rails.reduce((sum, r) => sum + Math.max(0, r.stockSegmentsMm.length - 1), 0)

      const beTrapDetail = beTrapezoidsData?.[trapId]
      const beGeom = beTrapDetail?.geometry
      const numRails = Object.values(lineRails).reduce((sum, arr) => sum + arr.length, 0)
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
  // Rails are needed for ALL areas including tiles (panels mount on rails).
  // Only construction-frame maps (settings, RC, panelLines) skip tiles.
  const trapLineRailsMap = useMemo(() => {
    const map = {}
    rowKeys.forEach((areaKey, i) => {
      const trapIds = areaTrapezoidMap[areaKey] || []
      trapIds.forEach(trapId => {
        const lineOrs = getLineOrientations(areaKey, trapId)
        const rails = getLineRails(i, lineOrs)
        map[trapId] = rails
      })
    })
    return map
  }, [rowKeys, areaTrapezoidMap, getLineOrientations, getLineRails])

  const trapSettingsMap = useMemo(() => {
    const map = {}
    rowKeys.forEach((areaKey, i) => {
      if (_isAreaTiles(areaByGroupKey[areaKey])) return
      const s = getSettings(i)
      const trapIds = areaTrapezoidMap[areaKey] || []
      trapIds.forEach(trapId => {
        map[trapId] = { ...s, ...getTrapBasesSettings(trapId) }
      })
    })
    return map
  }, [rowKeys, areaTrapezoidMap, areaSettings, globalSettings, trapezoidConfigs, getTrapBasesSettings, _isAreaTiles]) // eslint-disable-line react-hooks/exhaustive-deps

  const trapRCMap = useMemo(() => {
    const map = {}
    rowKeys.forEach((areaKey, i) => {
      if (_isAreaTiles(areaByGroupKey[areaKey])) return
      const trapIds = areaTrapezoidMap[areaKey] || []
      trapIds.forEach(trapId => { map[trapId] = rowConstructions[i] })
    })
    return map
  }, [rowKeys, areaTrapezoidMap, rowConstructions, _isAreaTiles])

  const trapPanelLinesMap = useMemo(() => {
    const map = {}
    const globalCfg = refinedArea?.panelConfig || {}
    rowKeys.forEach((areaKey) => {
      if (_isAreaTiles(areaByGroupKey[areaKey])) return
      const trapIdsList = areaTrapezoidMap[areaKey] || []
      const areaGroup   = areaByGroupKey[areaKey] || {}
      trapIdsList.forEach(trapId => {
        const override = trapezoidConfigs[trapId] || {}
        const lineOrientations = override.lineOrientations ?? areaGroup.lineOrientations ?? globalCfg.lineOrientations ?? [PANEL_V]
        map[trapId] = lineOrientations.map((o, i) => ({
          depthCm:     isHorizontalOrientation(o) ? panelWidthCm : panelLengthCm,
          gapBeforeCm: i === 0 ? 0 : lineGapCm,
          isEmpty:     isEmptyOrientation(o),
          isHorizontal: isHorizontalOrientation(o),
        }))
      })
    })
    return map
  }, [rowKeys, areaTrapezoidMap, areas, refinedArea, trapezoidConfigs, areaSettings, globalSettings, _isAreaTiles]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    rowPanelCounts, rowKeys, areaByGroupKey,
    getLineRails, areaTrapezoidMap,
    applyBasesToAll, rowConstructions,
    trapLineRailsMap, trapSettingsMap, trapRCMap, trapPanelLinesMap,
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function assignTypes(rowConstructions) {
  const typeMap = {}
  let nextCode = 65
  return rowConstructions.map(rc => {
    const key = `${Math.round(rc.angle)}_${Math.round(rc.heightRear)}_${Math.round(rc.heightFront)}`
    if (!typeMap[key]) typeMap[key] = String.fromCharCode(nextCode++)
    return { ...rc, typeLetter: typeMap[key] }
  })
}
