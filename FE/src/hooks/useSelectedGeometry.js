import { useMemo, useCallback } from 'react'
import { isHorizontalOrientation, isEmptyOrientation, lineSlopeDepth } from '../utils/trapezoidGeometry'
import { railOffsetFromSpacing } from '../utils/railLayoutService'
import { PANEL_H, PANEL_V, REAL_PANELS } from '../utils/panelCodes.js'

/** Flatten rails/bases from dict[rowIndex → list] to a single list. */
function flattenRowDict(d) {
  if (!d) return []
  if (Array.isArray(d)) return d
  return Object.values(d).flat()
}

/**
 * Derives geometry for the currently selected row/trapezoid:
 * line depths, orientations, rail positions, and spacing controls.
 */
export default function useSelectedGeometry({
  selectedRowIdx, effectiveSelectedTrapId,
  rowKeys, areas, refinedArea, trapezoidConfigs, areaTrapezoidMap,
  beRailsData, beTrapezoidsData,
  getSettings, getTrapBasesSettings, getLineOrientations, getLineRails,
  updateLineRails, areaSettings, globalSettings,
  panelSpec, appDefaults, PARAM_SCHEMA,
}) {
  const panelLengthCm = panelSpec.lengthCm
  const panelWidthCm  = panelSpec.widthCm
  const lineGapCm     = appDefaults?.lineGapCm
  const railSpacingVParam = PARAM_SCHEMA.find(p => p.key === 'railSpacingV') || {}
  const railSpacingHParam = PARAM_SCHEMA.find(p => p.key === 'railSpacingH') || {}
  const railSpacingV      = railSpacingVParam.default
  const railSpacingH      = railSpacingHParam.default
  const minRailSpacingV   = railSpacingVParam.min
  const minRailSpacingH   = railSpacingHParam.min

  // ── Selected row line depths (for detail tab) ──────────────────────────
  const selectedRowLineDepths = useMemo(() => {
    if (selectedRowIdx == null) return null
    const trapId = effectiveSelectedTrapId
    if (!trapId) return null
    const globalCfg  = refinedArea?.panelConfig || {}
    const override   = trapezoidConfigs[trapId] || {}
    const areaKey    = rowKeys[selectedRowIdx]
    const areaGroup  = areas[areaKey] || {}
    const lineOrientations = override.lineOrientations ?? areaGroup.lineOrientations ?? globalCfg.lineOrientations ?? [PANEL_V]
    return lineOrientations
      .filter(o => !isEmptyOrientation(o))
      .map((o, i) => ({
        depthCm: isHorizontalOrientation(o) ? panelWidthCm : panelLengthCm,
        gapBeforeCm: i === 0 ? 0 : lineGapCm,
        isEmpty: false,
        isHorizontal: isHorizontalOrientation(o),
      }))
  }, [effectiveSelectedTrapId, refinedArea, trapezoidConfigs, selectedRowIdx, areaSettings, globalSettings, areas, rowKeys])

  // ── Selected line orientations ─────────────────────────────────────────
  const selectedLineOrientations = useMemo(() => {
    const areaKey = rowKeys[selectedRowIdx]
    if (areaKey == null) return [PANEL_V]
    const trapId = effectiveSelectedTrapId ?? `${String.fromCharCode(65 + areaKey)}1`
    return getLineOrientations(areaKey, trapId)
  }, [selectedRowIdx, rowKeys, effectiveSelectedTrapId, getLineOrientations])

  // ── Selected line rails (remapped to active lines only) ────────────────
  const selectedLineRails = useMemo(() => {
    const allRails = getLineRails(selectedRowIdx, selectedLineOrientations)
    const remapped = {}
    let activeIdx = 0
    for (let li = 0; li < selectedLineOrientations.length; li++) {
      if (isEmptyOrientation(selectedLineOrientations[li])) continue
      if (allRails[li]) remapped[activeIdx] = allRails[li]
      activeIdx++
    }
    return remapped
  }, [selectedRowIdx, selectedLineOrientations, getLineRails])

  const selectedLinePanelDepths = useMemo(() =>
    selectedLineOrientations.map(o => lineSlopeDepth(o, panelLengthCm, panelWidthCm)),
    [selectedLineOrientations]
  )

  // ── Area-level orientations/rails (stable across trap selection) ───────
  const areaLineOrientations = useMemo(() => {
    const areaKey = rowKeys[selectedRowIdx]
    if (areaKey == null) return [PANEL_V]
    const firstTrapId = areaTrapezoidMap[areaKey]?.[0] ?? `${String.fromCharCode(65 + areaKey)}1`
    return getLineOrientations(areaKey, firstTrapId)
  }, [selectedRowIdx, rowKeys, areaTrapezoidMap, getLineOrientations])

  const areaLineRails = useMemo(() =>
    getLineRails(selectedRowIdx, areaLineOrientations),
    [selectedRowIdx, areaLineOrientations, getLineRails]
  )

  const areaLinePanelDepths = useMemo(() =>
    areaLineOrientations.map(o => lineSlopeDepth(o, panelLengthCm, panelWidthCm)),
    [areaLineOrientations]
  )

  // ── Selected trapezoid construction ────────────────────────────────────
  const selectedTrapezoidRC = useMemo(() => {
    if (selectedRowIdx == null) return null
    const areaKey = rowKeys[selectedRowIdx]
    if (areaKey == null) return null
    const trapId = effectiveSelectedTrapId
    if (!trapId) return null

    const globalCfg   = refinedArea?.panelConfig || {}
    const override    = trapezoidConfigs[trapId] || {}
    const angle       = override.angle ?? globalCfg.angle ?? 0
    const panelFrontH = override.frontHeight ?? globalCfg.frontHeight ?? 0
    const s           = getSettings(selectedRowIdx)
    const trapBases   = getTrapBasesSettings(trapId)
    const railOverhang = s.railOverhangCm
    const maxSpan      = trapBases.spacingMm / 10
    const angleRad     = angle * Math.PI / 180
    const crossRailH   = s.crossRailEdgeDistMm / 10

    const lineOrientations = getLineOrientations(areaKey, trapId)
    const lineRails        = getLineRails(selectedRowIdx, lineOrientations)
    const railOffsetCm     = lineRails[0]?.[0] ?? 0
    const frontLegH        = Math.max(0, panelFrontH - s.blockHeightCm + railOffsetCm * Math.sin(angleRad) - crossRailH * Math.cos(angleRad))

    const beTrapDetail = beTrapezoidsData?.[trapId]
    const beGeom = beTrapDetail?.geometry
    if (!beGeom) return null

    const beAreaData = beRailsData?.find(a => a.areaLabel === areas[areaKey]?.label)
    const rails = flattenRowDict(beAreaData?.rails)
    const rowLength = rails.length > 0 ? Math.max(...rails.map(r => r.roundedLengthCm ?? r.lengthCm)) : undefined
    if (rowLength == null) return null

    const numSpans = Math.max(1, Math.ceil(rowLength / maxSpan))
    // assignTypes on single element to get typeLetter
    const key = `${Math.round(angle)}_${Math.round(beGeom.heightRear)}_${Math.round(beGeom.heightFront)}`
    return {
      ...beGeom,
      angle, frontHeight: frontLegH, panelCount: 1,
      rowLength,
      baseLength: beGeom.baseBeamLength,
      diagonalLength: beGeom.diagonalLength ?? 0,
      numTrapezoids: numSpans + 1,
      spacing: rowLength / numSpans,
      railOverhang,
      panelsPerLine: (areas[areaKey]?.panelRows?.flatMap(pr => pr.panelGrid?.rows ?? []) ?? []).map(row => row.filter(c => REAL_PANELS.includes(c)).length),
      typeLetter: 'A', // will be overridden by row-level assignTypes if shown in context
    }
  }, [effectiveSelectedTrapId, selectedRowIdx, rowKeys, refinedArea, trapezoidConfigs, areaSettings, globalSettings, beRailsData, beTrapezoidsData, areas, getTrapBasesSettings])

  // ── Rail spacing derived from lineRails ────────────────────────────────
  const derivedRailSpacings = useMemo(() => {
    let vertical = null, horizontal = null
    selectedLineOrientations.forEach((o, li) => {
      const rails = selectedLineRails[li] ?? []
      if (rails.length >= 2) {
        const spacing = Math.round((rails[rails.length - 1] - rails[0]) * 10) / 10
        if (isHorizontalOrientation(o)) { if (horizontal == null) horizontal = spacing }
        else                            { if (vertical   == null) vertical   = spacing }
      }
    })
    return {
      vertical:   vertical   ?? railSpacingV,
      horizontal: horizontal ?? railSpacingH,
    }
  }, [selectedLineRails, selectedLineOrientations])

  // ── Rail spacing change handler ────────────────────────────────────────
  const onRailSpacingChange = useCallback((orientation, newSpacingCm) => {
    const isH = orientation === PANEL_H
    const minSpacing = isH ? minRailSpacingH : minRailSpacingV
    const newRails = { ...selectedLineRails }
    selectedLineOrientations.forEach((o, li) => {
      if (isHorizontalOrientation(o) !== isH) return
      const depth   = selectedLinePanelDepths[li]
      const spacing = Math.min(Math.max(newSpacingCm, minSpacing), depth * 0.9)
      const offset  = railOffsetFromSpacing(depth, spacing)
      newRails[li]  = [Math.round(offset * 10) / 10, Math.round((depth - offset) * 10) / 10]
    })
    updateLineRails(selectedRowIdx, newRails)
  }, [selectedLineRails, selectedLineOrientations, selectedLinePanelDepths, selectedRowIdx, updateLineRails])

  // ── Apply rails to all areas ───────────────────────────────────────────
  const applyRailsToAllAreas = useCallback((rowKeys, areaTrapezoidMap, setAreaSettings, getSettings) => {
    const s    = getSettings(selectedRowIdx)
    const snap = v => Math.round(v * 10) / 10
    const spacings = derivedRailSpacings
    setAreaSettings(prev => {
      const next = { ...prev }
      rowKeys.forEach((areaKey, areaIdx) => {
        if (areaIdx === selectedRowIdx) return
        const trapId = areaTrapezoidMap[areaKey]?.[0] ?? `${String.fromCharCode(65 + areaKey)}1`
        const orientations = getLineOrientations(areaKey, trapId)
        const depths = orientations.map(o => lineSlopeDepth(o, panelLengthCm, panelWidthCm))
        const newRails = {}
        orientations.forEach((o, li) => {
          const isH = isHorizontalOrientation(o)
          const spacing = isH ? spacings.horizontal : spacings.vertical
          const depth = depths[li]
          const minSp = isH ? minRailSpacingH : minRailSpacingV
          const clamped = Math.min(Math.max(spacing, minSp), depth * 0.9)
          const offset = railOffsetFromSpacing(depth, clamped)
          newRails[li] = [snap(offset), snap(depth - offset)]
        })
        const areaOverrides = Object.fromEntries(
          PARAM_SCHEMA
            .filter(p => p.section === 'rails' && p.scope === 'area' && p.type !== 'rail-spacing')
            .map(p => [p.key, s[p.key] ?? p.default])
        )
        next[areaIdx] = { ...(prev[areaIdx] || {}), ...areaOverrides, lineRails: newRails }
      })
      return next
    })
  }, [derivedRailSpacings, selectedRowIdx, getLineOrientations])

  return {
    selectedRowLineDepths,
    selectedLineOrientations, selectedLineRails, selectedLinePanelDepths,
    areaLineOrientations, areaLineRails, areaLinePanelDepths,
    selectedTrapezoidRC,
    derivedRailSpacings, onRailSpacingChange, applyRailsToAllAreas,
  }
}
