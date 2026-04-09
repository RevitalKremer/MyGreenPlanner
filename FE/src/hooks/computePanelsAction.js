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
  roofPolygon, panelType,
  onlyAreaIdx,
}) {
  if (!referenceLine || !referenceLineLengthCm || appDefaults?.panelGapCm == null) return null
  const dx = referenceLine.end.x - referenceLine.start.x
  const dy = referenceLine.end.y - referenceLine.start.y
  const pixelLength = Math.sqrt(dx * dx + dy * dy)
  if (pixelLength <= 0) return null
  const pixelToCmRatio = parseFloat(referenceLineLengthCm) / pixelLength

  // Areas that already had panels before this compute are "existing" — never auto-deleted
  const existingAreaIndices = new Set(panels.map(p => p.area))

  const allPanels = []
  const groupTrapConfigs = {}
  const areaLineConfigs = {}
  const newPanelGrid = {}

  // When resetting a single area, carry over all other areas' panels/grids/configs unchanged
  if (onlyAreaIdx !== undefined) {
    panels.forEach(p => {
      if (p.area !== onlyAreaIdx) allPanels.push(p)
    })
    rectAreas.forEach((area, areaIdx) => {
      if (areaIdx === onlyAreaIdx) return
      const areaLabel = area.label || area.id || `area-${areaIdx}`
      if (panelGrid[areaLabel]) newPanelGrid[areaLabel] = panelGrid[areaLabel]
      const existingPanels = panels.filter(p => p.area === areaIdx)
      const lineRows = [...new Set(existingPanels.map(p => p.row))].sort((a, b) => a - b)
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

  let panelId = allPanels.length > 0 ? Math.max(...allPanels.map(p => p.id)) + 1 : 1
  rectAreas.forEach((area, areaIdx) => {
    if (onlyAreaIdx !== undefined && areaIdx !== onlyAreaIdx) return
    const areaLabel = area.label || area.id || `area-${areaIdx}`
    const aFront = parseFloat(area.frontHeight) || parseFloat(panelFrontHeight) || 0
    const aAngle = parseFloat(area.angle) || parseFloat(panelAngle) || 0
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

    newPanelGrid[areaLabel] = buildPanelGrid(area, computed, filtered, pixelToCmRatio)

    // Area-level orientation (all rows, no empties) — used for areas state and step 4
    const lineRows = [...new Set(filtered.map(p => p.row))].sort((a, b) => a - b)
    const rowOrient = {}  // row → PANEL_V|PANEL_H
    lineRows.forEach(r => {
      const s = filtered.find(p => p.row === r)
      rowOrient[r] = s?.heightCm > s?.widthCm ? PANEL_V : PANEL_H
    })
    const derivedOrients = lineRows.map(r => rowOrient[r])
    areaLineConfigs[areaIdx] = { lineOrientations: derivedOrients }

    if (!area.manualTrapezoids) {
      // ── Auto-split: group columns by their row-presence signature ────────────
      const computedAllRows = [...new Set(computed.map(p => p.row))].sort((a, b) => a - b)
      const computedRowOrient = {}
      computedAllRows.forEach(r => {
        const s = computed.find(p => p.row === r)
        computedRowOrient[r] = s?.heightCm > s?.widthCm ? PANEL_V : PANEL_H
      })

      const colRowsComputed = new Map()
      computed.forEach(p => {
        const cols = p.coveredCols?.length > 0 ? p.coveredCols : [p.col ?? 0]
        cols.forEach(c => {
          if (!colRowsComputed.has(c)) colRowsComputed.set(c, new Set())
          colRowsComputed.get(c).add(p.row)
        })
      })

      // Signature = per-row orientation string, EV/EH for rows absent in the polygon
      const colSig = (col) =>
        computedAllRows.map(r =>
          colRowsComputed.get(col)?.has(r) ? computedRowOrient[r] : (computedRowOrient[r] === PANEL_H ? PANEL_EH : PANEL_EV)
        ).join('|')

      // Assign trapezoid IDs grouped by signature (left-to-right column order)
      const sigToTrap = new Map()
      let n = 1
      ;[...colRowsComputed.keys()].sort((a, b) => a - b).forEach(col => {
        const s = colSig(col)
        if (!sigToTrap.has(s)) sigToTrap.set(s, `${areaLabel}${n++}`)
      })
      if (sigToTrap.size === 1) {
        const [[sig]] = [...sigToTrap.entries()]
        sigToTrap.set(sig, areaLabel)
      }

      // Build groupTrapConfigs for each unique trap shape
      sigToTrap.forEach((trapId, sig) => {
        const shape = sig.split('|')
        const trapBack = computePanelBackHeight(aFront, aAngle, shape, appDefaults?.lineGapCm, panelSpec.lengthCm, panelSpec.widthCm)
        groupTrapConfigs[trapId] = { angle: aAngle, frontHeight: aFront, backHeight: trapBack,
          lineOrientations: shape }
      })

      filtered.forEach(p => {
        const physCol = p.coveredCols?.[0] ?? p.col ?? 0
        const sig = colSig(physCol)
        allPanels.push({ ...p, id: panelId++, area: areaIdx,
          trapezoidId: sigToTrap.get(sig) || areaLabel,
          xDir: area.xDir ?? 'ltr', yDir: area.yDir ?? 'ttb' })
      })
    } else {
      // ── Manual mode: use stored column→trapId assignments ────────────────────
      const colToTrap = area.manualColTrapezoids || {}
      const defaultTrap = areaLabel
      const aBack = computePanelBackHeight(aFront, aAngle, derivedOrients, appDefaults?.lineGapCm ?? appDefaults?.panelGapCm, panelSpec.lengthCm, panelSpec.widthCm)
      const usedTraps = new Set([defaultTrap, ...Object.values(colToTrap)])
      usedTraps.forEach(trapId => {
        groupTrapConfigs[trapId] = { angle: aAngle, frontHeight: aFront, backHeight: aBack,
          lineOrientations: derivedOrients }
      })
      filtered.forEach(p => {
        const trapId = colToTrap[String(p.col ?? 0)] ?? defaultTrap
        allPanels.push({ ...p, id: panelId++, area: areaIdx, trapezoidId: trapId, xDir: area.xDir ?? 'ltr', yDir: area.yDir ?? 'ttb' })
      })
    }
  })

  // Detect NEW areas (not previously having panels) that got zero panels
  const areaIndicesWithPanels = new Set(allPanels.map(p => p.area))
  const emptyNewIndices = rectAreas
    .map((_, i) => i)
    .filter(i => !areaIndicesWithPanels.has(i) && !existingAreaIndices.has(i))

  // Build updated areas array
  const updatedAreas = rectAreas.map((a, idx) => ({
    label: a.label,
    angle: parseFloat(a.angle) || 0,
    frontHeight: parseFloat(a.frontHeight) || 0,
    lineOrientations: areaLineConfigs[idx]?.lineOrientations ?? [PANEL_V],
  }))

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

  return {
    panels: allPanels,
    areas: updatedAreas,
    trapezoidConfigs: mergedTrapConfigs,
    panelGrid: newPanelGrid,
    refinedArea,
    emptyNewIndices,
  }
}
