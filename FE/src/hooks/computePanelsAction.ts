/**
 * Pure function: computes panel layout from rect areas.
 * Extracted from useProjectState to reduce file size and prepare for reducer migration.
 *
 * Inputs: all state needed for the computation (no closured references).
 * Returns: { panels, areas, trapezoidConfigs, panelGrid, refinedArea, emptyNewIndices }
 *          or null if prerequisites are missing.
 */

import { computePolygonPanels } from '../utils/rectPanelService'
import { buildPanelGrid } from '../utils/panelGridService'
import { computePanelBackHeight } from '../utils/trapezoidGeometry'
import { isAreaTiles } from '../utils/roofSpecUtils'
import { PANEL_V, PANEL_H, PANEL_EH, PANEL_EV } from '../utils/panelCodes.js'


/**
 * SAT OBB-OBB overlap test — returns true if the two panels physically intersect.
 */
function obbsOverlap(a, b) {
  const corners = (p) => {
    const r = (p.rotation || 0) * Math.PI / 180
    const c = Math.cos(r), s = Math.sin(r)
    const hw = p.width / 2, hh = p.height / 2
    return [
      { x: p.cx + hw*c - hh*s, y: p.cy + hw*s + hh*c },
      { x: p.cx - hw*c - hh*s, y: p.cy - hw*s + hh*c },
      { x: p.cx - hw*c + hh*s, y: p.cy - hw*s - hh*c },
      { x: p.cx + hw*c + hh*s, y: p.cy + hw*s - hh*c },
    ]
  }
  const ac = corners(a), bc = corners(b)
  const axes = [a, b].flatMap(p => {
    const r = (p.rotation || 0) * Math.PI / 180
    return [{ x: Math.cos(r), y: Math.sin(r) }, { x: -Math.sin(r), y: Math.cos(r) }]
  })
  for (const ax of axes) {
    const proj = pts => pts.map(p => p.x * ax.x + p.y * ax.y)
    const ap = proj(ac), bp = proj(bc)
    if (Math.max(...ap) <= Math.min(...bp) || Math.max(...bp) <= Math.min(...ap)) return false
  }
  return true
}


/**
 * @param {object} inputs
 * @param {object}   inputs.referenceLine        - { start, end } calibration line
 * @param {string}   inputs.referenceLineLengthCm - calibration length in cm (string)
 * @param {object}   inputs.appDefaults           - { panelGapCm, lineGapCm, ... }
 * @param {object}   inputs.panelSpec             - { widthCm, lengthCm }
 * @param {Array}    inputs.rectAreas             - current or overridden rectAreas
 * @param {Array}    inputs.panels                - current panels array
 * @param {object}   inputs.deletedPanelKeys      - { [areaIdx]: string[] }
 * @param {string}   inputs.panelFrontHeight      - global default front height
 * @param {string}   inputs.panelAngle            - global default angle
 * @param {object}   inputs.panelGrid             - current panelGrid (for _onlyAreaIdx carry-over)
 * @param {object}   inputs.trapezoidConfigs      - current trapezoid configs
 * @param {object}   inputs.roofPolygon           - roof polygon data
 * @param {string}   inputs.panelType             - panel type ID
 * @param {number|undefined} inputs.onlyAreaIdx   - if set, only recompute this area
 *
 * @returns {object|null} { panels, areas, trapezoidConfigs, panelGrid, refinedArea, emptyNewIndices }
 */
export function computePanelsAction({
  referenceLine, referenceLineLengthCm, appDefaults, panelSpec,
  rectAreas, panels, deletedPanelKeys,
  panelFrontHeight, panelAngle,
  panelGrid, trapezoidConfigs,
  rowMounting,
  roofPolygon, panelType,
  onlyAreaIdx,
  roofType = 'concrete',
}) {
  if (!referenceLine || !referenceLineLengthCm || appDefaults?.panelGapCm == null) return null
  const dx = referenceLine.end.x - referenceLine.start.x
  const dy = referenceLine.end.y - referenceLine.start.y
  const pixelLength = Math.sqrt(dx * dx + dy * dy)
  if (pixelLength <= 0) return null
  const pixelToCmRatio = parseFloat(referenceLineLengthCm) / pixelLength

  // Areas that already had panels before this compute are "existing" — never auto-deleted
  const existingAreaIndices = new Set(panels.map(p => p.area))

  const allPanels: any[] = []
  const groupTrapConfigs: Record<string, any> = {}
  const areaLineConfigs: Record<number, any> = {}
  const newPanelGrid: Record<string, any> = {}

  // When resetting a single area, carry over all other areas' panels/grids/configs unchanged
  if (onlyAreaIdx !== undefined) {
    panels.forEach(p => {
      if (p.area !== onlyAreaIdx) allPanels.push(p)
    })
    rectAreas.forEach((area, areaIdx) => {
      if (areaIdx === onlyAreaIdx) return
      const areaLabel = area.label || area.id || `area-${areaIdx}`
      if (panelGrid[areaLabel]) {
        if (!newPanelGrid[areaLabel]) newPanelGrid[areaLabel] = []
        // Merge: preserve existing rows' grids
        const existing = panelGrid[areaLabel]
        if (Array.isArray(existing)) {
          existing.forEach((g, ri) => { if (g) newPanelGrid[areaLabel][ri] = g })
        } else {
          // Legacy single grid — wrap as row 0
          newPanelGrid[areaLabel][0] = existing
        }
      }
      const existingPanels = panels.filter(p => p.area === areaIdx)
      const lineRows = [...new Set(existingPanels.map(p => p.row) as number[])].sort((a, b) => a - b)
      areaLineConfigs[areaIdx] = {
        lineOrientations: lineRows.map(r => {
          const s = existingPanels.find(p => p.row === r)
          return s?.heightCm > s?.widthCm ? PANEL_V : PANEL_H
        }),
      }
      existingPanels.forEach(p => {
        if (p.trapezoidId && trapezoidConfigs[p.trapezoidId]) {
          groupTrapConfigs[p.trapezoidId] = trapezoidConfigs[p.trapezoidId]
        }
      })
    })
  }

  // Pre-compute areaGroupKey: index of the first rectArea in each group
  const areaGroupKeyMap = {}  // areaIdx → firstIdxInGroup
  rectAreas.forEach((area, areaIdx) => {
    const groupId = area.areaGroupId ?? -(areaIdx + 1)
    if (!(groupId in areaGroupKeyMap)) areaGroupKeyMap[groupId] = areaIdx
  })
  const getGroupKey = (areaIdx) => {
    const area = rectAreas[areaIdx]
    const groupId = area?.areaGroupId ?? -(areaIdx + 1)
    return areaGroupKeyMap[groupId] ?? areaIdx
  }

  let panelId = allPanels.length > 0 ? Math.max(...allPanels.map(p => p.id)) + 1 : 1
  const pendingGroupPanels: Record<string, any[]> = {}  // groupId → [{ areaIdx, areaLabel, computed, filtered, ... }]
  // Updated row a/h (areaLabel → [{angleDeg, frontHeightCm}]). Built from input
  // rowMounting when present, falling back to area defaults for new rows.
  const newRowMounting = {}
  rectAreas.forEach((area, areaIdx) => {
    if (onlyAreaIdx !== undefined && areaIdx !== onlyAreaIdx) return
    const areaLabel = area.label || area.id || `area-${areaIdx}`
    const aFront = parseFloat(area.frontHeight) || parseFloat(panelFrontHeight) || 0
    const aAngle = parseFloat(area.angle) || parseFloat(panelAngle) || 0
    // Resolve this row's a/h: existing row a/h → area default → panel default
    const ri = area.rowIndex ?? 0
    const inMtg = (rowMounting?.[areaLabel] || [])[ri]
    const rAngle = inMtg?.angleDeg ?? aAngle
    const rFront = inMtg?.frontHeightCm ?? aFront
    if (!newRowMounting[areaLabel]) newRowMounting[areaLabel] = []
    newRowMounting[areaLabel][ri] = { angleDeg: rAngle, frontHeightCm: rFront }
    const computed = computePolygonPanels(area, pixelToCmRatio, panelSpec, appDefaults?.panelGapCm)
    let filtered = computed.filter(p => !allPanels.some(ep => obbsOverlap(p, ep)))
    // Remove panels manually deleted by the user
    const deletedKeys = deletedPanelKeys[areaIdx]
    if (deletedKeys?.length > 0) {
      const deletedSet = new Set(deletedKeys)
      filtered = filtered.filter(p => {
        const col = p.coveredCols?.[0] ?? p.col ?? 0
        return !deletedSet.has(`${p.row}_${col}`)
      })
    }
    // Existing areas always keep at least 1 panel so the area stays visible
    if (filtered.length === 0 && existingAreaIndices.has(areaIdx) && computed.length > 0) {
      filtered = [computed[0]]
    }

    // Store per-row grid: panelGrid[areaLabel] is an array indexed by rowIndex
    const rowIdx = area.rowIndex ?? 0
    if (!newPanelGrid[areaLabel]) newPanelGrid[areaLabel] = []
    newPanelGrid[areaLabel][rowIdx] = buildPanelGrid(area, computed, filtered, pixelToCmRatio)

    // Area-level orientation (all rows, no empties) — used for areas state and step 4
    const lineRows = [...new Set(filtered.map(p => p.row) as number[])].sort((a, b) => a - b)
    const rowOrient = {}  // row → PANEL_V|PANEL_H
    lineRows.forEach(r => {
      const s = filtered.find(p => p.row === r)
      rowOrient[r] = s?.heightCm > s?.widthCm ? PANEL_V : PANEL_H
    })
    const derivedOrients = lineRows.map(r => rowOrient[r])
    areaLineConfigs[areaIdx] = { lineOrientations: derivedOrients }

    // Store filtered panels temporarily for group-level trapezoid assignment.
    // rAngle/rFront are the row-level a/h (source of truth for trap a/h).
    const groupId = getGroupKey(areaIdx)
    if (!pendingGroupPanels[groupId]) pendingGroupPanels[groupId] = []
    pendingGroupPanels[groupId].push({
      areaIdx, areaLabel, aFront, aAngle, rAngle, rFront, rowIdx, area,
      computed, filtered,
    })
  })

  // ── Group-level trapezoid assignment ──────────────────────────────────────
  // For each area group, merge all rows' computed panels and derive column signatures
  // across the UNION of all rows. This ensures multi-row areas get consistent trap IDs.
  // Trap a/h is taken from each row's a/h (rAngle/rFront), not the area default.
  // Two rows can share a trap only if they have BOTH the same column signature AND
  // the same row a/h — different a/h forces a separate trap.
  for (const [, groupEntries] of Object.entries(pendingGroupPanels)) {
    const { areaLabel } = groupEntries[0]
    const isManual = groupEntries[0].area.manualTrapezoids

    // Tiles areas have no construction frame → skip trap splitting entirely.
    // Panels are added to allPanels without a trapezoidId.
    const areaTileTyped = isAreaTiles(roofType, groupEntries[0].area)
    if (areaTileTyped) {
      groupEntries.forEach(ge => {
        ge.filtered.forEach(p => {
          allPanels.push({
            ...p, id: panelId++, area: ge.areaIdx,
            areaGroupKey: getGroupKey(ge.areaIdx), panelRowIdx: ge.rowIdx,
            trapezoidId: null,
            xDir: ge.area.xDir ?? 'ltr', yDir: ge.area.yDir ?? 'ttb',
          })
        })
      })
      continue
    }

    if (!isManual) {
      // sigToTrap key = `${sig}::${rAngle}::${rFront}` so different row a/h
      // produces distinct traps even when columns match.
      const sigToTrap = new Map()
      // trapAh tracks the row a/h that produced each trap (used when emitting trap config)
      const trapAh = new Map()  // trapId → { angle, frontHeight }
      let n = 1
      const perRowColSig = []  // [{ ge, colSig: (col) => sig, sigKey: (col) => key }]

      groupEntries.forEach(ge => {
        const { computed, filtered, rAngle, rFront } = ge
        // Lines and orientations from computed (full polygon grid shape)
        const computedAllLines = [...new Set(computed.map(p => p.row) as number[])].sort((a, b) => a - b)
        const computedLineOrient: Record<number, string> = {}
        computedAllLines.forEach(r => {
          const s = computed.find(p => p.row === r)
          computedLineOrient[r] = s?.heightCm > s?.widthCm ? PANEL_V : PANEL_H
        })

        // Column presence from FILTERED (actual panels after deletion)
        // so deleted panels create ghost slots → different trap signatures
        const colLinesComputed = new Map()
        computed.forEach(p => {
          const cols = p.coveredCols?.length > 0 ? p.coveredCols : [p.col ?? 0]
          cols.forEach(c => {
            if (!colLinesComputed.has(c)) colLinesComputed.set(c, new Set())
            if (filtered.some(fp => {
              const fpCols = fp.coveredCols?.length > 0 ? fp.coveredCols : [fp.col ?? 0]
              return fpCols.includes(c) && fp.row === p.row
            })) {
              colLinesComputed.get(c).add(p.row)
            }
          })
        })

        const colSig = (col) =>
          computedAllLines.map(r =>
            colLinesComputed.get(col)?.has(r) ? computedLineOrient[r] : (computedLineOrient[r] === PANEL_H ? PANEL_EH : PANEL_EV)
          ).join('|')
        const sigKey = (col) => `${colSig(col)}::${rAngle}::${rFront}`

        // Register unique sig+a/h keys from this row
        ;[...colLinesComputed.keys()].sort((a, b) => a - b).forEach(col => {
          const k = sigKey(col)
          if (!sigToTrap.has(k)) {
            const trapId = `${areaLabel}${n++}`
            sigToTrap.set(k, trapId)
            trapAh.set(trapId, { angle: rAngle, frontHeight: rFront })
          }
        })

        perRowColSig.push({ ge, colSig, sigKey })
      })

      if (sigToTrap.size === 1) {
        const [[k, prevTrap]] = [...sigToTrap.entries()]
        const ah = trapAh.get(prevTrap)
        sigToTrap.set(k, areaLabel)
        trapAh.delete(prevTrap)
        if (ah) trapAh.set(areaLabel, ah)
      }

      sigToTrap.forEach((trapId, key) => {
        const sig = key.split('::')[0]
        const shape = sig.split('|')
        const ah = trapAh.get(trapId) || { angle: groupEntries[0].aAngle, frontHeight: groupEntries[0].aFront }
        const trapBack = computePanelBackHeight(ah.frontHeight, ah.angle, shape, appDefaults?.lineGapCm, panelSpec.lengthCm, panelSpec.widthCm)
        groupTrapConfigs[trapId] = { angle: ah.angle, frontHeight: ah.frontHeight, backHeight: trapBack, lineOrientations: shape }
      })

      // Assign trapezoidId to each filtered panel using per-row sigKey
      perRowColSig.forEach(({ ge, sigKey }) => {
        ge.filtered.forEach(p => {
          const physCol = p.coveredCols?.[0] ?? p.col ?? 0
          const k = sigKey(physCol)
          allPanels.push({ ...p, id: panelId++, area: ge.areaIdx, areaGroupKey: getGroupKey(ge.areaIdx), panelRowIdx: ge.rowIdx,
            trapezoidId: sigToTrap.get(k) || areaLabel,
            xDir: ge.area.xDir ?? 'ltr', yDir: ge.area.yDir ?? 'ttb' })
        })
      })
    } else {
      // Manual mode: per-row, use stored column→trapId assignments.
      // Trap configs use the row's a/h (each row owns its mounting).
      groupEntries.forEach(ge => {
        const { area, areaIdx, rowIdx, filtered, rAngle, rFront } = ge
        const derivedOrients = areaLineConfigs[areaIdx]?.lineOrientations ?? [PANEL_V]
        const colToTrap = area.manualColTrapezoids || {}
        const defaultTrap = areaLabel
        const rBack = computePanelBackHeight(rFront, rAngle, derivedOrients, appDefaults?.lineGapCm ?? appDefaults?.panelGapCm, panelSpec.lengthCm, panelSpec.widthCm)
        const usedTraps = new Set([defaultTrap, ...Object.values(colToTrap)])
        usedTraps.forEach(trapId => {
          groupTrapConfigs[trapId] = { angle: rAngle, frontHeight: rFront, backHeight: rBack, lineOrientations: derivedOrients }
        })
        filtered.forEach(p => {
          const trapId = colToTrap[String(p.col ?? 0)] ?? defaultTrap
          allPanels.push({ ...p, id: panelId++, area: areaIdx, areaGroupKey: getGroupKey(areaIdx), panelRowIdx: rowIdx, trapezoidId: trapId, xDir: area.xDir ?? 'ltr', yDir: area.yDir ?? 'ttb' })
        })
      })
    }
  }

  // Detect NEW areas (not previously having panels) that got zero panels
  const areaIndicesWithPanels = new Set(allPanels.map(p => p.area))
  const emptyNewIndices = rectAreas
    .map((_, i) => i)
    .filter(i => !areaIndicesWithPanels.has(i) && !existingAreaIndices.has(i))

  // Build updated areas array — group by areaGroupId for multi-row areas
  const areaGroupMap = new Map()  // areaGroupId → { label, angle, frontHeight, lineOrientations, panelRows: [] }
  rectAreas.forEach((a, idx) => {
    const groupId = a.areaGroupId ?? -(idx + 1)
    if (!areaGroupMap.has(groupId)) {
      areaGroupMap.set(groupId, {
        label: a.label,
        angle: parseFloat(a.angle) || 0,
        frontHeight: parseFloat(a.frontHeight) || 0,
        lineOrientations: areaLineConfigs[idx]?.lineOrientations ?? [PANEL_V],
        areaVertical: a.areaVertical ?? false,
        roofSpec: a.roofSpec ?? null,
        panelRows: [],
      })
    }
    const group = areaGroupMap.get(groupId)
    const ri = a.rowIndex ?? 0
    group.panelRows.push({ rowIndex: ri })
  })
  const updatedAreas = [...areaGroupMap.values()]

  // Merge trapezoid configs (preserve existing fields, override with new)
  const mergedTrapConfigs = {}
  Object.keys(groupTrapConfigs).forEach(id => {
    mergedTrapConfigs[id] = { ...(trapezoidConfigs[id] || {}), ...groupTrapConfigs[id] }
  })

  const refinedArea = {
    polygon: roofPolygon, panelType, referenceLine,
    referenceLineLengthCm: parseFloat(referenceLineLengthCm),
    pixelToCmRatio,
    panelConfig: { frontHeight: 0, backHeight: 0, angle: 0, lineOrientations: [PANEL_V] },
  }

  // Merge new row mounting with existing (single-area recompute keeps other areas)
  const mergedRowMounting = { ...(rowMounting || {}) }
  Object.entries(newRowMounting).forEach(([label, rows]) => {
    mergedRowMounting[label] = rows
  })

  return {
    panels: allPanels,
    areas: updatedAreas,
    trapezoidConfigs: mergedTrapConfigs,
    panelGrid: newPanelGrid,
    rowMounting: mergedRowMounting,
    refinedArea,
    emptyNewIndices,
  }
}


/**
 * Recompute trapezoid IDs for a single area from current panel state.
 * Pure function — returns { updatedPanels, newTrapConfigs } or null if prerequisites missing.
 */
/**
 * Recompute trapezoid IDs for a single rectArea row.
 * Returns { updatedPanels, newTrapConfigs, sigToTrap } or null.
 */
function _refreshSingleRowTrapezoids({
  areaIdx, area, panels, referenceLine, referenceLineLengthCm,
  panelSpec, appDefaults, panelFrontHeight, panelAngle,
  areaLabel, sigToTrap, trapAh, n,
  rowMounting,
}) {
  if (!area || area.manualTrapezoids || !area.vertices?.length) return null
  if (!referenceLine || !referenceLineLengthCm) return null

  const dxRef = referenceLine.end.x - referenceLine.start.x
  const dyRef = referenceLine.end.y - referenceLine.start.y
  const pixelLength = Math.sqrt(dxRef * dxRef + dyRef * dyRef)
  if (pixelLength <= 0) return null
  const pixelToCmRatio = parseFloat(referenceLineLengthCm) / pixelLength

  const pWid = panelSpec.widthCm
  const gapPx = (appDefaults?.panelGapCm) / pixelToCmRatio
  const portraitW = pWid / pixelToCmRatio
  const portraitPitch = portraitW + gapPx

  const { vertices, rotation = 0, xDir = 'ltr', areaVertical = false } = area
  const effectiveRotation = (areaVertical ? 90 : 0) + rotation
  const rotRad = (effectiveRotation * Math.PI) / 180
  const cosF = Math.cos(-rotRad), sinF = Math.sin(-rotRad)
  const cxAvg = vertices.reduce((s, v) => s + v.x, 0) / vertices.length
  const cyAvg = vertices.reduce((s, v) => s + v.y, 0) / vertices.length
  const localVerts = vertices.map(v => {
    const dx = v.x - cxAvg, dy = v.y - cyAvg
    return { x: dx * cosF - dy * sinF, y: dx * sinF + dy * cosF }
  })
  const minLX = Math.min(...localVerts.map(v => v.x))
  const maxLX = Math.max(...localVerts.map(v => v.x))

  const aFront = parseFloat(area.frontHeight) || parseFloat(panelFrontHeight) || 0
  const aAngle = parseFloat(area.angle) || parseFloat(panelAngle) || 0
  // Row a/h is the source of truth for trap a/h. Fallback to area defaults if
  // rowMounting has no entry for this row.
  const ri = area.rowIndex ?? 0
  const inMtg = (rowMounting?.[areaLabel] || [])[ri]
  const rAngle = inMtg?.angleDeg ?? aAngle
  const rFront = inMtg?.frontHeightCm ?? aFront

  const areaPanels = panels.filter(p => p.area === areaIdx)
  if (!areaPanels.length) return null

  const panelWithCols = areaPanels.map(p => {
    const pcx = p.x + p.width / 2
    const pcy = p.y + p.height / 2
    const lx = (pcx - cxAvg) * cosF - (pcy - cyAvg) * sinF
    const panelW = p.width
    const fillLeft = xDir === 'rtl' ? maxLX - lx - panelW / 2 : lx - minLX - panelW / 2
    const kStart = Math.floor(fillLeft / portraitPitch)
    const kEnd = Math.ceil((fillLeft + panelW) / portraitPitch)
    const coveredCols = []
    for (let k = kStart; k <= kEnd; k++) {
      const portCenter = k * portraitPitch + portraitW / 2
      if (portCenter >= fillLeft && portCenter < fillLeft + panelW) coveredCols.push(k)
    }
    const physCol = coveredCols.length > 0 ? coveredCols[0] : Math.round(fillLeft / portraitPitch)
    return { ...p, col: physCol, coveredCols }
  })

  const colRowsMap = new Map()
  const rowOrient = {}
  panelWithCols.forEach(p => {
    const row = p.row ?? 0
    rowOrient[row] = p.heightCm > p.widthCm ? PANEL_V : PANEL_H
    const cols = p.coveredCols?.length > 0 ? p.coveredCols : [p.col ?? 0]
    cols.forEach(c => {
      if (!colRowsMap.has(c)) colRowsMap.set(c, new Set())
      colRowsMap.get(c).add(row)
    })
  })

  const allRows = [...new Set(panelWithCols.map(p => p.row ?? 0) as number[])].sort((a, b) => a - b)
  const colSig = (col) =>
    allRows.map(r =>
      colRowsMap.get(col)?.has(r) ? rowOrient[r] : (rowOrient[r] === PANEL_H ? PANEL_EH : PANEL_EV)
    ).join('|')
  const sigKey = (col) => `${colSig(col)}::${rAngle}::${rFront}`

  // Register unique sig+a/h keys into the shared sigToTrap map. Row a/h is part
  // of the key so two rows with same column shape but different mounting get
  // distinct trap IDs.
  ;[...colRowsMap.keys()].sort((a, b) => a - b).forEach(col => {
    const k = sigKey(col)
    if (!sigToTrap.has(k)) {
      const trapId = `${areaLabel}${n.value++}`
      sigToTrap.set(k, trapId)
      if (trapAh) trapAh.set(trapId, { angle: rAngle, frontHeight: rFront })
    }
  })

  return { areaIdx, panelWithCols, colSig, sigKey, aFront, aAngle, rAngle, rFront }
}

/**
 * Wrapper: recompute trapezoid IDs for ALL rows in an area group.
 * Calls _refreshSingleRowTrapezoids per row, collects unique signatures,
 * then assigns consistent trap IDs across all rows.
 */
export function refreshAreaTrapezoidsAction({
  areaIdx, area, panels, rectAreas, referenceLine, referenceLineLengthCm,
  panelSpec, appDefaults, panelFrontHeight, panelAngle, trapezoidConfigs,
  rowMounting,
}) {
  if (!area || area.manualTrapezoids || !area.vertices?.length) return null

  const areaLabel = area.label || area.id || `area-${areaIdx}`

  // Find all rectArea indices in the same group
  const groupId = area.areaGroupId
  const groupIndices = rectAreas
    ? rectAreas.map((ra, i) => ra.areaGroupId === groupId ? i : -1).filter(i => i >= 0)
    : [areaIdx]

  // Shared sig+a/h key → trapId map. Row a/h is part of the key so traps
  // never get shared across rows with different mounting.
  const sigToTrap = new Map()
  const trapAh = new Map()  // trapId → { angle, frontHeight }
  const n = { value: 1 }  // mutable counter shared across rows
  const perRowResults = []

  for (const raIdx of groupIndices) {
    const ra = rectAreas ? rectAreas[raIdx] : area
    const result = _refreshSingleRowTrapezoids({
      areaIdx: raIdx, area: ra, panels, referenceLine, referenceLineLengthCm,
      panelSpec, appDefaults, panelFrontHeight, panelAngle,
      areaLabel, sigToTrap, trapAh, n,
      rowMounting,
    })
    if (result) perRowResults.push(result)
  }

  if (perRowResults.length === 0) return null

  // Simplify: if only one trap, use area label directly
  if (sigToTrap.size === 1) {
    const [[k, prevTrap]] = [...sigToTrap.entries()]
    const ah = trapAh.get(prevTrap)
    sigToTrap.set(k, areaLabel)
    trapAh.delete(prevTrap)
    if (ah) trapAh.set(areaLabel, ah)
  }

  // Build trap configs using each trap's row a/h
  const newTrapConfigs = {}
  sigToTrap.forEach((trapId, key) => {
    const sig = key.split('::')[0]
    const shape = sig.split('|')
    const ah = trapAh.get(trapId) || { angle: perRowResults[0].rAngle, frontHeight: perRowResults[0].rFront }
    newTrapConfigs[trapId] = {
      angle: ah.angle, frontHeight: ah.frontHeight,
      backHeight: computePanelBackHeight(ah.frontHeight, ah.angle, shape, appDefaults?.lineGapCm, panelSpec.lengthCm, panelSpec.widthCm),
      lineOrientations: shape,
    }
  })

  // Update panels across all rows in the group
  const groupAreaSet = new Set(groupIndices)
  const updatedPanels = panels.map(p => {
    if (!groupAreaSet.has(p.area)) return p
    const rowResult = perRowResults.find(r => r.areaIdx === p.area)
    if (!rowResult) return p
    const updated = rowResult.panelWithCols.find(pw => pw.id === p.id)
    if (!updated) return p
    const k = rowResult.sigKey(updated.col)
    const newTrapId = sigToTrap.get(k) || areaLabel
    if (newTrapId === p.trapezoidId && updated.col === p.col) return p
    return { ...p, col: updated.col, coveredCols: updated.coveredCols, trapezoidId: newTrapId }
  })

  // Merge trap configs: remove old traps for this area, add new
  const mergedTrapConfigs = {}
  Object.entries(trapezoidConfigs).forEach(([id, cfg]) => {
    const rest = id.slice(areaLabel.length)
    if (id !== areaLabel && !(id.startsWith(areaLabel) && /^\d/.test(rest))) mergedTrapConfigs[id] = cfg
  })
  Object.entries(newTrapConfigs).forEach(([id, cfg]) => {
    mergedTrapConfigs[id] = { ...(trapezoidConfigs[id] || {}), ...((cfg as Record<string, any>) || {}) }
  })

  return { updatedPanels, mergedTrapConfigs }
}


/**
 * Re-derive col/coveredCols/row for loaded panels by matching to closest computed panel.
 * Returns { panels, panelGrid } or null if prerequisites missing.
 */
export function reSyncLoadedPanelColsAction({
  referenceLine, referenceLineLengthCm, rectAreas, panels, panelSpec, appDefaults,
}) {
  if (!referenceLine || !referenceLineLengthCm || rectAreas.length === 0) return null
  if (!panelSpec) return null
  const dx = referenceLine.end.x - referenceLine.start.x
  const dy = referenceLine.end.y - referenceLine.start.y
  const pixelLength = Math.sqrt(dx * dx + dy * dy)
  if (pixelLength <= 0) return null
  const ratio = parseFloat(referenceLineLengthCm) / pixelLength

  const next = [...panels]
  rectAreas.forEach((area, areaIdx) => {
    const computed = computePolygonPanels(area, ratio, panelSpec, appDefaults?.panelGapCm)
    if (!computed.length) return
    const halfW = computed[0].width / 2
    const threshold = halfW * 3
    next.forEach((p, i) => {
      if (p.area !== areaIdx) return
      const pcx = p.x + p.width / 2
      const pcy = p.y + p.height / 2
      let best = null, bestDist = Infinity
      computed.forEach(cp => {
        const d = Math.sqrt((pcx - cp.cx) ** 2 + (pcy - cp.cy) ** 2)
        if (d < bestDist) { bestDist = d; best = cp }
      })
      if (best && bestDist < threshold) {
        next[i] = { ...p, row: best.row, col: best.col, coveredCols: best.coveredCols }
      }
    })
  })

  const newGrid = {}
  rectAreas.forEach((area, areaIdx) => {
    const areaLabel = area.label || area.id || `area-${areaIdx}`
    const rowIdx = area.rowIndex ?? 0
    const computed = computePolygonPanels(area, ratio, panelSpec, appDefaults?.panelGapCm)
    const areaFiltered = next.filter(p => p.area === areaIdx)
    if (!newGrid[areaLabel]) newGrid[areaLabel] = []
    newGrid[areaLabel][rowIdx] = buildPanelGrid(area, computed, areaFiltered, ratio)
  })

  return { panels: next, panelGrid: newGrid }
}


/**
 * Rebuild panel grid from panels + rectAreas geometry.
 * Returns the new panelGrid object, or null if prerequisites missing.
 */
export function rebuildPanelGridAction({
  referenceLine, referenceLineLengthCm, rectAreas, panels, panelSpec, appDefaults,
}) {
  if (!referenceLine || !referenceLineLengthCm || rectAreas.length === 0) return null
  if (!panelSpec) return null
  const dx = referenceLine.end.x - referenceLine.start.x
  const dy = referenceLine.end.y - referenceLine.start.y
  const pixelLength = Math.sqrt(dx * dx + dy * dy)
  if (pixelLength <= 0) return null
  const pixelToCmRatio = parseFloat(referenceLineLengthCm) / pixelLength
  const newGrid = {}
  rectAreas.forEach((area, areaIdx) => {
    const areaLabel = area.label || area.id || `area-${areaIdx}`
    const rowIdx = area.rowIndex ?? 0
    const computed = computePolygonPanels(area, pixelToCmRatio, panelSpec, appDefaults?.panelGapCm)
    const areaFiltered = panels.filter(p => p.area === areaIdx)
    if (!newGrid[areaLabel]) newGrid[areaLabel] = []
    newGrid[areaLabel][rowIdx] = buildPanelGrid(area, computed, areaFiltered, pixelToCmRatio)
  })
  return newGrid
}
