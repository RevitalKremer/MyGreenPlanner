import { useMemo, useCallback } from 'react'
import { isHorizontalOrientation, isEmptyOrientation, lineSlopeDepth } from '../utils/trapezoidGeometry'
import { initDefaultLineRails } from '../utils/railLayoutService'

/**
 * Derives row-level data: panel counts, row keys, line rails,
 * trapezoid maps, and construction geometry from BE data.
 */
export default function useRowData({
  panels, areas, refinedArea, trapezoidConfigs, setTrapezoidConfigs,
  beRailsData, beTrapezoidsData, panelSpec, appDefaults,
  getSettings, getTrapBasesSettings, getLineOrientations,
  areaSettings, globalSettings, PARAM_SCHEMA,
}) {
  const panelLengthCm = panelSpec.lengthCm
  const panelWidthCm  = panelSpec.widthCm
  const lineGapCm     = appDefaults?.lineGapCm
  const railSpacingV  = (PARAM_SCHEMA.find(p => p.key === 'railSpacingV') || {}).default
  const railSpacingH  = (PARAM_SCHEMA.find(p => p.key === 'railSpacingH') || {}).default

  // ── Panel counts & row keys ─────────────────────────────────────────────
  const rowPanelCounts = useMemo(() => {
    const map = {}
    panels.forEach(p => {
      const key = (p.area ?? p.row) ?? 'unassigned'
      map[key] = (map[key] || 0) + 1
    })
    return map
  }, [panels])

  const rowKeys = useMemo(() =>
    Object.keys(rowPanelCounts).filter(k => k !== 'unassigned').map(Number).sort((a, b) => a - b),
    [rowPanelCounts]
  )

  // ── Line rails resolution ──────────────────────────────────────────────
  const getLineRailsFromBE = useCallback((areaIdx, lineOrientations) => {
    if (!beRailsData) return null
    const areaKey = rowKeys[areaIdx]
    const label   = areas[areaKey]?.label
    if (!label) return null
    const beArea  = beRailsData.find(a => a.areaLabel === label)
    if (!beArea?.rails?.length) return null
    const map = {}
    for (const r of beArea.rails) {
      if (!map[r.lineIdx]) map[r.lineIdx] = []
      map[r.lineIdx].push(r.offsetFromLineFrontCm)
    }
    for (const li of Object.keys(map)) map[li] = [...map[li]].sort((a, b) => a - b)
    if (Object.keys(map).length !== lineOrientations.length) return null
    return map
  }, [beRailsData, areas, rowKeys])

  const getLineRails = useCallback((areaIdx, lineOrientations) => {
    const stored = areaSettings[areaIdx]?.lineRails
    if (stored && Object.keys(stored).length === lineOrientations.length) return stored
    const fromBE = getLineRailsFromBE(areaIdx, lineOrientations)
    if (fromBE) return fromBE
    const depths = lineOrientations.map(o => lineSlopeDepth(o, panelLengthCm, panelWidthCm))
    return initDefaultLineRails(lineOrientations, depths, railSpacingV, railSpacingH)
  }, [areaSettings, getLineRailsFromBE, railSpacingV, railSpacingH])

  // ── Trapezoid map ──────────────────────────────────────────────────────
  const areaTrapezoidMap = useMemo(() => {
    const map = {}
    rowKeys.forEach(areaKey => {
      const letter = String.fromCharCode(65 + areaKey)
      const ids = [...new Set(
        panels.filter(p => (p.area ?? p.row) === areaKey).map(p => p.trapezoidId).filter(Boolean)
      )].sort()
      map[areaKey] = ids.length > 0 ? ids : [`${letter}1`]
    })
    return map
  }, [panels, rowKeys])

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

      const areaLbl    = areas[areaKey]?.label
      const beAreaData = beRailsData?.find(a => a.areaLabel === areaLbl)
      const rails      = beAreaData?.rails ?? []

      const measuredRowLength = rails.length > 0 ? Math.max(...rails.map(r => r.roundedLengthCm ?? r.lengthCm)) : undefined
      const numRailConnectors = rails.reduce((sum, r) => sum + Math.max(0, r.stockSegmentsMm.length - 1), 0)

      const beTrapDetail = beTrapezoidsData?.[trapId]
      const beGeom = beTrapDetail?.geometry
      if (!beGeom || measuredRowLength == null) return null

      const numRails = Object.values(lineRails).reduce((sum, arr) => sum + arr.length, 0)
      const numLines = Object.keys(lineRails).length
      const numSpans = Math.max(1, Math.ceil(measuredRowLength / maxSpan))
      return {
        ...beGeom,
        angle, frontHeight: frontLegH, panelCount,
        rowLength: measuredRowLength,
        baseLength: beGeom.baseBeamLength,
        diagonalLength: beGeom.diagonalLength ?? 0,
        numTrapezoids: numSpans + 1,
        spacing: measuredRowLength / numSpans,
        railOverhang,
        panelsPerLine: (areas[areaKey]?.panelGrid?.rows ?? []).map(row => row.filter(c => c === 'V' || c === 'H').length),
        numRails, numLines,
        numLargeGaps: beAreaData?.numLargeGaps ?? 0,
        numRailConnectors,
      }
    })
    return assignTypes(rcs.filter(Boolean))
  }, [rowKeys, rowPanelCounts, refinedArea, trapezoidConfigs, areaSettings, globalSettings, beRailsData, beTrapezoidsData, areas, areaTrapezoidMap, getTrapBasesSettings])

  // ── Per-trapezoid maps ─────────────────────────────────────────────────
  const trapLineRailsMap = useMemo(() => {
    const map = {}
    rowKeys.forEach((areaKey, i) => {
      const trapIds = areaTrapezoidMap[areaKey] || []
      const lineOrs = getLineOrientations(areaKey, trapIds[0] ?? `${String.fromCharCode(65 + areaKey)}1`)
      const rails   = getLineRails(i, lineOrs)
      trapIds.forEach(trapId => { map[trapId] = rails })
    })
    return map
  }, [rowKeys, areaTrapezoidMap, getLineOrientations, getLineRails])

  const trapSettingsMap = useMemo(() => {
    const map = {}
    rowKeys.forEach((areaKey, i) => {
      const s = getSettings(i)
      const trapIds = areaTrapezoidMap[areaKey] || []
      trapIds.forEach(trapId => {
        map[trapId] = { ...s, ...getTrapBasesSettings(trapId) }
      })
    })
    return map
  }, [rowKeys, areaTrapezoidMap, areaSettings, globalSettings, trapezoidConfigs, getTrapBasesSettings]) // eslint-disable-line react-hooks/exhaustive-deps

  const trapRCMap = useMemo(() => {
    const map = {}
    rowKeys.forEach((areaKey, i) => {
      const trapIds = areaTrapezoidMap[areaKey] || []
      trapIds.forEach(trapId => { map[trapId] = rowConstructions[i] })
    })
    return map
  }, [rowKeys, areaTrapezoidMap, rowConstructions])

  const trapPanelLinesMap = useMemo(() => {
    const map = {}
    const globalCfg = refinedArea?.panelConfig || {}
    rowKeys.forEach((areaKey) => {
      const trapIdsList = areaTrapezoidMap[areaKey] || []
      const areaGroup   = areas[areaKey] || {}
      trapIdsList.forEach(trapId => {
        const override = trapezoidConfigs[trapId] || {}
        const lineOrientations = override.lineOrientations ?? areaGroup.lineOrientations ?? globalCfg.lineOrientations ?? ['V']
        map[trapId] = lineOrientations.map((o, i) => ({
          depthCm:     isHorizontalOrientation(o) ? panelWidthCm : panelLengthCm,
          gapBeforeCm: i === 0 ? 0 : lineGapCm,
          isEmpty:     isEmptyOrientation(o),
          isHorizontal: isHorizontalOrientation(o),
        }))
      })
    })
    return map
  }, [rowKeys, areaTrapezoidMap, areas, refinedArea, trapezoidConfigs, areaSettings, globalSettings]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    rowPanelCounts, rowKeys,
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
