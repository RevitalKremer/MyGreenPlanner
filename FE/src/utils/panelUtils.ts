// Panel utility functions for solar panel layout generation and row management
import { isEmptyOrientation, isHorizontalOrientation } from './trapezoidGeometry'
import { PANEL_H, PANEL_V } from './panelCodes.js'

/**
 * Generate panel layout based on refined area, baseline, and panel configuration
 * @param {Object} refinedArea - Contains polygon, pixelToCmRatio, and panelConfig
 * @param {Object} baseline - User-drawn baseline with p1 and p2 coordinates
 * @returns {Array} Array of generated panel objects
 */
export const generatePanelLayout = (refinedArea, baseline, singleRow = false, panelGapCm, panelSpec) => {
  if (!refinedArea || !refinedArea.polygon || !refinedArea.pixelToCmRatio) {
    console.error('Missing configuration data from Step 2')
    return []
  }

  if (!baseline) {
    console.error('Please draw a baseline for the first row of panels')
    return []
  }

  const { polygon, pixelToCmRatio, panelConfig } = refinedArea
  const { backHeight, angle } = panelConfig
  
  // Get polygon coordinates array
  const polygonCoords = polygon.coordinates || polygon
  
  // Panel dimensions in cm (from selected panel type)
  const panelLengthCm = panelSpec.lengthCm
  const panelWidthCm = panelSpec.widthCm
  const rowSpacingCm = backHeight * 1.5
  
  // Convert to pixels
  const panelLengthPx = panelLengthCm / pixelToCmRatio
  const panelWidthPx = panelWidthCm / pixelToCmRatio
  const panelGapPx = panelGapCm / pixelToCmRatio
  const rowSpacingPx = rowSpacingCm / pixelToCmRatio
  
  // Calculate roof projection (horizontal footprint) in pixels
  const angleRad = angle * (Math.PI / 180)
  const roofProjectionPx = (panelLengthCm * Math.cos(angleRad)) / pixelToCmRatio

  // Multi-line row configuration
  const lineOrientations = panelConfig.lineOrientations || [PANEL_V]
  const linesPerRow = lineOrientations.length

  const lineConfigs = lineOrientations.map(orientation => {
    const isEmpty = isEmptyOrientation(orientation)
    const base = isHorizontalOrientation(orientation) ? PANEL_H : (isEmpty ? PANEL_V : orientation)
    if (base === PANEL_H) {
      return {
        widthPx: panelLengthPx,
        projectionPx: (panelWidthCm * Math.cos(angleRad)) / pixelToCmRatio,
        widthCm: panelLengthCm,
        heightCm: panelWidthCm,
        isEmpty
      }
    }
    return {
      widthPx: panelWidthPx,
      projectionPx: roofProjectionPx,
      widthCm: panelWidthCm,
      heightCm: panelLengthCm,
      isEmpty
    }
  })

  // Total projection of the full multi-line row (all lines + gaps between them)
  const totalRowProjectionPx = lineConfigs.reduce((sum, lc) => sum + lc.projectionPx, 0) +
    (linesPerRow - 1) * panelGapPx

  // Use the user-drawn baseline to determine roof orientation
  const roofOrientation = Math.atan2(
    baseline.p2[1] - baseline.p1[1],
    baseline.p2[0] - baseline.p1[0]
  )
  
  console.log('User baseline:', baseline)
  console.log('Roof orientation angle (degrees):', roofOrientation * (180 / Math.PI))
  
  // Find polygon bounds
  const minX = Math.min(...polygonCoords.map(p => p[0]))
  const maxX = Math.max(...polygonCoords.map(p => p[0]))
  const minY = Math.min(...polygonCoords.map(p => p[1]))
  const maxY = Math.max(...polygonCoords.map(p => p[1]))
  
  // Calculate polygon center for rotation
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  
  // Rotate baseline points to aligned space
  const rotatedBaseline = {
    p1: {
      x: centerX + (baseline.p1[0] - centerX) * Math.cos(-roofOrientation) - (baseline.p1[1] - centerY) * Math.sin(-roofOrientation),
      y: centerY + (baseline.p1[0] - centerX) * Math.sin(-roofOrientation) + (baseline.p1[1] - centerY) * Math.cos(-roofOrientation)
    },
    p2: {
      x: centerX + (baseline.p2[0] - centerX) * Math.cos(-roofOrientation) - (baseline.p2[1] - centerY) * Math.sin(-roofOrientation),
      y: centerY + (baseline.p2[0] - centerX) * Math.sin(-roofOrientation) + (baseline.p2[1] - centerY) * Math.cos(-roofOrientation)
    }
  }
  
  // Ensure baseline goes left to right in rotated space
  if (rotatedBaseline.p1.x > rotatedBaseline.p2.x) {
    const temp = rotatedBaseline.p1
    rotatedBaseline.p1 = rotatedBaseline.p2
    rotatedBaseline.p2 = temp
  }
  
  const baselineRotY = (rotatedBaseline.p1.y + rotatedBaseline.p2.y) / 2
  const baselineStartX = rotatedBaseline.p1.x
  const baselineEndX = rotatedBaseline.p2.x
  
  // Helper: Rotate point around center
  const rotatePoint = (x, y, angleRad) => {
    const dx = x - centerX
    const dy = y - centerY
    return {
      x: centerX + dx * Math.cos(-angleRad) - dy * Math.sin(-angleRad),
      y: centerY + dx * Math.sin(-angleRad) + dy * Math.cos(-angleRad)
    }
  }
  
  // Rotate polygon to align with roof orientation
  const rotatedPolygon = polygonCoords.map(p => rotatePoint(p[0], p[1], roofOrientation))
  
  // Find bounds of rotated polygon
  const rotMinX = Math.min(...rotatedPolygon.map(p => p.x))
  const rotMaxX = Math.max(...rotatedPolygon.map(p => p.x))
  const rotMinY = Math.min(...rotatedPolygon.map(p => p.y))
  const rotMaxY = Math.max(...rotatedPolygon.map(p => p.y))
  
  console.log('Rotated polygon bounds:', { rotMinX, rotMaxX, rotMinY, rotMaxY })
  console.log('Panel dimensions (px):', { panelLengthPx, panelWidthPx, roofProjectionPx })
  
  const generatedPanels = []
  let panelId = 1

  // Helper: Check if panel in rotated space fits in rotated polygon
  const isPanelInRotatedPolygon = (rotX, rotY, width, height) => {
    const corners = [
      { x: rotX, y: rotY },
      { x: rotX + width, y: rotY },
      { x: rotX, y: rotY + height },
      { x: rotX + width, y: rotY + height }
    ]

    return corners.every(corner => {
      let inside = false
      for (let i = 0, j = rotatedPolygon.length - 1; i < rotatedPolygon.length; j = i++) {
        const xi = rotatedPolygon[i].x, yi = rotatedPolygon[i].y
        const xj = rotatedPolygon[j].x, yj = rotatedPolygon[j].y

        const intersect = ((yi > corner.y) !== (yj > corner.y))
          && (corner.x < (xj - xi) * (corner.y - yi) / (yj - yi) + xi)
        if (intersect) inside = !inside
      }
      return inside
    })
  }

  // Determine which rotated-Y direction is "up" in image space.
  // We do this empirically: place a test point half a row-height in each direction from the
  // baseline, unrotate it back to image space, and pick the direction whose image-Y is smaller
  // (smaller image-Y = higher on screen = "above" the baseline).
  const baseMidImageY = (baseline.p1[1] + baseline.p2[1]) / 2
  const midX = (baselineStartX + baselineEndX) / 2
  const halfProj = totalRowProjectionPx / 2

  const unrotateImageY = (rotY) => {
    const dy = rotY - centerY
    return centerY + (midX - centerX) * Math.sin(roofOrientation) + dy * Math.cos(roofOrientation)
  }

  const imgY_ifDecreasing = unrotateImageY(baselineRotY - halfProj)
  const imgY_ifIncreasing = unrotateImageY(baselineRotY + halfProj)

  // "Above" = smaller image Y.  Pick the direction that yields smaller image Y.
  const imageUpIsDecreasingRotY = imgY_ifDecreasing < imgY_ifIncreasing

  // Row 1: lower image edge sits on the baseline; rows stack upward from there.
  let currentRotY, rowStep
  if (imageUpIsDecreasingRotY) {
    currentRotY = baselineRotY - totalRowProjectionPx
    rowStep = -(totalRowProjectionPx + rowSpacingPx)
  } else {
    currentRotY = baselineRotY
    rowStep = +(totalRowProjectionPx + rowSpacingPx)
  }

  console.log('Panel placement: upward | imageUpIsDecreasingRotY:', imageUpIsDecreasingRotY,
    '| orientation°:', (roofOrientation * 180 / Math.PI).toFixed(1),
    '| baselineRotY:', baselineRotY.toFixed(1), '| row1 currentRotY:', currentRotY.toFixed(1),
    '| baseMidImageY:', baseMidImageY.toFixed(1),
    '| imgY dec:', imgY_ifDecreasing.toFixed(1), '| imgY inc:', imgY_ifIncreasing.toFixed(1))

  let rowIndex = 0

  while (rowIndex < 200) {
    // Stop when the row has moved entirely outside the polygon (above roof top)
    if (imageUpIsDecreasingRotY  && currentRotY + totalRowProjectionPx <= rotMinY) break
    if (!imageUpIsDecreasingRotY && currentRotY >= rotMaxY) break

    // For first row, respect the drawn baseline X range; subsequent rows span full polygon width
    const startX = (rowIndex === 0) ? baselineStartX : rotMinX
    const endX   = (rowIndex === 0) ? baselineEndX   : rotMaxX

    let panelsInRow = 0
    let lineY = currentRotY

    for (let lineIdx = 0; lineIdx < linesPerRow; lineIdx++) {
      const lc = lineConfigs[lineIdx]
      if (!lc.isEmpty) {
        let currentRotX = startX
        while (currentRotX + lc.widthPx <= endX) {
          if (isPanelInRotatedPolygon(currentRotX, lineY, lc.widthPx, lc.projectionPx)) {
            const rotCenterX = currentRotX + lc.widthPx / 2
            const rotCenterY = lineY + lc.projectionPx / 2
            const dx = rotCenterX - centerX
            const dy = rotCenterY - centerY
            const originalCenterX = centerX + dx * Math.cos(roofOrientation) - dy * Math.sin(roofOrientation)
            const originalCenterY = centerY + dx * Math.sin(roofOrientation) + dy * Math.cos(roofOrientation)
            generatedPanels.push({
              id: panelId++,
              x: originalCenterX - lc.widthPx / 2,
              y: originalCenterY - lc.projectionPx / 2,
              width: lc.widthPx,
              height: lc.projectionPx,
              widthCm: lc.widthCm,
              heightCm: lc.heightCm,
              rotation: roofOrientation * (180 / Math.PI),
              row: rowIndex,
              line: lineIdx
            })
            panelsInRow++
          }
          currentRotX += lc.widthPx + panelGapPx
        }
      } else {
        // Empty line: generate ghost markers at the same positions
        let currentRotX = startX
        while (currentRotX + lc.widthPx <= endX) {
          if (isPanelInRotatedPolygon(currentRotX, lineY, lc.widthPx, lc.projectionPx)) {
            const rotCenterX = currentRotX + lc.widthPx / 2
            const rotCenterY = lineY + lc.projectionPx / 2
            const dx = rotCenterX - centerX
            const dy = rotCenterY - centerY
            const originalCenterX = centerX + dx * Math.cos(roofOrientation) - dy * Math.sin(roofOrientation)
            const originalCenterY = centerY + dx * Math.sin(roofOrientation) + dy * Math.cos(roofOrientation)
            generatedPanels.push({
              id: panelId++,
              x: originalCenterX - lc.widthPx / 2,
              y: originalCenterY - lc.projectionPx / 2,
              width: lc.widthPx,
              height: lc.projectionPx,
              widthCm: lc.widthCm,
              heightCm: lc.heightCm,
              rotation: roofOrientation * (180 / Math.PI),
              row: rowIndex,
              line: lineIdx,
              isEmpty: true,
            })
          }
          currentRotX += lc.widthPx + panelGapPx
        }
      }
      lineY += lc.projectionPx + panelGapPx
    }

    console.log(`Row ${rowIndex}: placed ${panelsInRow} panels across ${linesPerRow} lines`)

    if (singleRow) break

    currentRotY += rowStep
    rowIndex++
  }
  
  console.log(`Total panels placed: ${generatedPanels.length}`)
  return generatedPanels
}

/**
 * Add a manual panel below the baseline
 * @param {Object} refinedArea - Contains pixelToCmRatio
 * @param {Object} baseline - User-drawn baseline
 * @param {Array} existingPanels - Current panels array
 * @returns {Object} New panel object
 */
// ── Roof containment helpers ──────────────────────────────────────────────────

function pointInPolygon(px, py, coords) {
  let inside = false
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const xi = coords[i][0], yi = coords[i][1]
    const xj = coords[j][0], yj = coords[j][1]
    if (((yi > py) !== (yj > py)) && px < ((xj - xi) * (py - yi) / (yj - yi) + xi))
      inside = !inside
  }
  return inside
}

/**
 * Returns true if all four corners of the (possibly rotated) panel are inside the roof polygon.
 * cx/cy are the panel centre in image pixel coords.
 */
export function panelInsideRoof(cx, cy, hw, hh, rotation, polygonCoords) {
  if (!polygonCoords || polygonCoords.length === 0) return true
  const r = (rotation || 0) * Math.PI / 180
  const cosR = Math.cos(r), sinR = Math.sin(r)
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].every(([lx, ly]) =>
    pointInPolygon(cx + lx * cosR - ly * sinR, cy + lx * sinR + ly * cosR, polygonCoords)
  )
}

/**
 * Find the topmost available position inside the roof for a standalone panel.
 * Scans row-by-row (top→bottom, left→right) in half-panel steps.
 * Returns { cx, cy } or null if no position found.
 */
function findTopmostInRoof(hw, hh, rotation, polygonCoords, existingPanels) {
  const xs = polygonCoords.map(c => c[0])
  const ys = polygonCoords.map(c => c[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const stepX = hw        // half-panel steps for good coverage
  const stepY = hh

  for (let cy = minY + hh; cy <= maxY - hh; cy += stepY) {
    for (let cx = minX + hw; cx <= maxX - hw; cx += stepX) {
      if (!panelInsideRoof(cx, cy, hw, hh, rotation, polygonCoords)) continue
      const overlaps = existingPanels.some(p => {
        if (p.isEmpty) return false
        return Math.abs(cx - (p.x + p.width / 2)) < hw + p.width / 2 &&
               Math.abs(cy - (p.y + p.height / 2)) < hh + p.height / 2
      })
      if (!overlaps) return { cx, cy }
    }
  }
  return null
}

export const createManualPanel = (refinedArea, baseline, existingPanels, roofPolygon, panelSpec) => {
  if (!refinedArea || !refinedArea.pixelToCmRatio) return null

  const { pixelToCmRatio, panelConfig } = refinedArea
  const panelLengthCm = panelSpec.lengthCm
  const panelWidthCm  = panelSpec.widthCm
  const angle         = panelConfig?.angle || 0
  const angleRad      = angle * (Math.PI / 180)
  const panelHeightPx = (panelLengthCm * Math.cos(angleRad)) / pixelToCmRatio
  const panelWidthPx  = panelWidthCm / pixelToCmRatio

  // Rotation: inherit from existing panels, then baseline, then 0
  let rotation = 0
  const realPanel = existingPanels.find(p => !p.isEmpty)
  if (realPanel) {
    rotation = realPanel.rotation || 0
  } else if (baseline?.p1 && baseline?.p2) {
    rotation = Math.atan2(baseline.p2[1] - baseline.p1[1], baseline.p2[0] - baseline.p1[0]) * (180 / Math.PI)
  }

  const hw = panelWidthPx / 2, hh = panelHeightPx / 2
  const newId = existingPanels.length > 0 ? Math.max(...existingPanels.map(p => p.id)) + 1 : 1
  const polyCoords = roofPolygon?.coordinates || []

  if (polyCoords.length > 0) {
    const pos = findTopmostInRoof(hw, hh, rotation, polyCoords, existingPanels)
    if (!pos) return null
    return { id: newId, x: pos.cx - hw, y: pos.cy - hh, width: panelWidthPx, height: panelHeightPx, widthCm: panelWidthCm, heightCm: panelLengthCm, rotation }
  }

  // Fallback (no roof polygon): place near baseline center
  if (!baseline?.p2) return null
  const bAngle = Math.atan2(baseline.p2[1] - baseline.p1[1], baseline.p2[0] - baseline.p1[0])
  const bcx = (baseline.p1[0] + baseline.p2[0]) / 2
  const bcy = (baseline.p1[1] + baseline.p2[1]) / 2
  const cx = bcx + panelHeightPx * Math.sin(bAngle)
  const cy = bcy - panelHeightPx * Math.cos(bAngle)
  return { id: newId, x: cx - hw, y: cy - hh, width: panelWidthPx, height: panelHeightPx, widthCm: panelWidthCm, heightCm: panelLengthCm, rotation: bAngle * (180 / Math.PI) }
}

/**
 * Detect rows from a list of panels
 * @param {Array} panelList - Array of panel objects
 * @param {number} pixelToCmRatio - Conversion ratio
 * @returns {Array} Array of rows, where each row is an array of panels
 */
export const detectRows = (panelList, pixelToCmRatio, panelGapCm) => {
  if (!pixelToCmRatio) return []

  const panelGapPx = panelGapCm / pixelToCmRatio
  const tolerance = 1
  
  const rows = []
  const processed = new Set()
  
  panelList.forEach(panel => {
    if (processed.has(panel.id)) return
    
    const row = [panel]
    processed.add(panel.id)
    
    let changed = true
    while (changed) {
      changed = false
      
      panelList.forEach(otherPanel => {
        if (processed.has(otherPanel.id)) return
        
        const sameRotation = Math.abs(otherPanel.rotation - panel.rotation) < 1
        
        if (sameRotation) {
          for (const rowPanel of row) {
            const yDiff = Math.abs(rowPanel.y - otherPanel.y)
            const alignedY = yDiff < rowPanel.height * 0.3
            
            if (alignedY) {
              const panel1Right = rowPanel.x + rowPanel.width
              const panel1Left = rowPanel.x
              const panel2Right = otherPanel.x + otherPanel.width
              const panel2Left = otherPanel.x
              
              let gap = Infinity
              
              if (panel2Left >= panel1Right) {
                gap = panel2Left - panel1Right
              } else if (panel1Left >= panel2Right) {
                gap = panel1Left - panel2Right
              } else {
                gap = 0
              }
              
              const isAdjacent = gap <= (panelGapPx + tolerance)
              
              if (isAdjacent) {
                row.push(otherPanel)
                processed.add(otherPanel.id)
                changed = true
                break
              }
            }
          }
        }
      })
    }
    
    rows.push(row)
  })
  
  return rows
}

/**
 * Auto-group SAM2-detected panels into rows by Y-proximity
 * @param {Array} detectedPanels - Array of { x, y, width, height, rotation, confidence } (top-left origin)
 * @returns {Array} Panel objects with id, row, line assigned
 */
export const autoGroupPanels = (detectedPanels) => {
  if (!detectedPanels || detectedPanels.length === 0) return []

  let nextId = 1
  const withIds = detectedPanels.map(p => ({ ...p, id: nextId++ }))

  // Sort by Y center
  const sorted = [...withIds].sort((a, b) => (a.y + a.height / 2) - (b.y + b.height / 2))

  // Compute median height for row-grouping threshold
  const heights = [...sorted].map(p => p.height).sort((a, b) => a - b)
  const medianHeight = heights[Math.floor(heights.length / 2)]
  const threshold = medianHeight * 0.6

  // Group into rows by Y proximity (running mean)
  const rowGroups = []
  for (const panel of sorted) {
    const cy = panel.y + panel.height / 2
    let found = false
    for (const group of rowGroups) {
      const groupCY = group.reduce((s, p) => s + p.y + p.height / 2, 0) / group.length
      if (Math.abs(cy - groupCY) <= threshold) {
        group.push(panel)
        found = true
        break
      }
    }
    if (!found) rowGroups.push([panel])
  }

  // Sort each row by X center, assign row and line indices
  const result = []
  rowGroups.forEach((group, rowIdx) => {
    group.sort((a, b) => (a.x + a.width / 2) - (b.x + b.width / 2))
    group.forEach(panel => result.push({ ...panel, row: rowIdx, line: 0 }))
  })

  return result
}

/**
 * Calculate snapped positions for moved panels
 * @param {Array} allPanels - All panels
 * @param {Array} movedPanelIds - IDs of panels that were moved
 * @param {number} pixelToCmRatio - Conversion ratio
 * @returns {Array} Updated panels array with snapped positions
 */
export const snapPanelsToRows = (allPanels, movedPanelIds, pixelToCmRatio, panelGapCm) => {
  if (!pixelToCmRatio) return allPanels

  const panelGapPx = panelGapCm / pixelToCmRatio
  
  // Get unmoved panels (potential target rows)
  const unmovedPanels = allPanels.filter(p => !movedPanelIds.includes(p.id))
  
  // Detect rows from unmoved panels only
  const rows = detectRows(unmovedPanels, pixelToCmRatio, panelGapCm)
  
  console.log('Detected rows for snapping:', rows.length)
  
  // For each moved panel, check if it should snap to a row
  return allPanels.map(panel => {
    if (!movedPanelIds.includes(panel.id)) return panel
    
    let bestRow = null
    let bestDistance = Infinity
    
    // Find closest row that this panel could snap to
    for (const row of rows) {
      const rowRotation = row[0].rotation
      const sameRotation = Math.abs(panel.rotation - rowRotation) < 1
      
      if (sameRotation) {
        const panelCenterY = panel.y + panel.height / 2
        const rowCenterY = row[0].y + row[0].height / 2
        const yDiff = Math.abs(panelCenterY - rowCenterY)
        
        const rowMinX = Math.min(...row.map(p => p.x))
        const rowMaxX = Math.max(...row.map(p => p.x + p.width))
        const panelCenterX = panel.x + panel.width / 2
        
        const horizontallyAligned = panelCenterX >= (rowMinX - panel.width * 2) && 
                                   panelCenterX <= (rowMaxX + panel.width * 2)
        
        const snapTolerance = panel.height * 0.35
        
        if (horizontallyAligned && yDiff < bestDistance && yDiff < snapTolerance) {
          bestDistance = yDiff
          bestRow = row
        }
      }
    }
    
    if (bestRow) {
      const rowRotation = bestRow[0].rotation
      const newY = bestRow[0].y
      
      const sortedRowPanels = [...bestRow].sort((a, b) => a.x - b.x)
      const panelCenterX = panel.x + panel.width / 2
      
      let newX
      
      if (panelCenterX < sortedRowPanels[0].x) {
        newX = sortedRowPanels[0].x - panel.width - panelGapPx
        console.log(`Snapping panel ${panel.id} to START of row`)
      } else {
        let insertionFound = false
        for (let i = 0; i < sortedRowPanels.length - 1; i++) {
          const currentPanel = sortedRowPanels[i]
          const nextPanel = sortedRowPanels[i + 1]
          const currentRight = currentPanel.x + currentPanel.width
          const nextLeft = nextPanel.x
          
          if (panelCenterX > currentRight && panelCenterX < nextLeft) {
            newX = currentRight + panelGapPx
            console.log(`Snapping panel ${panel.id} BETWEEN panels in row`)
            insertionFound = true
            break
          }
        }
        
        if (!insertionFound) {
          const lastPanel = sortedRowPanels[sortedRowPanels.length - 1]
          newX = lastPanel.x + lastPanel.width + panelGapPx
          console.log(`Snapping panel ${panel.id} to END of row`)
        }
      }
      
      console.log(`Panel ${panel.id} snapped to Y=${newY}, X=${newX}`)
      
      return {
        ...panel,
        x: newX,
        y: newY,
        rotation: rowRotation
      }
    }
    
    console.log(`Panel ${panel.id} not snapped - no suitable row found`)
    return panel
  })
}
