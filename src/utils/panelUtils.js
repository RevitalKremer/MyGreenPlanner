// Panel utility functions for solar panel layout generation and row management

/**
 * Generate panel layout based on refined area, baseline, and panel configuration
 * @param {Object} refinedArea - Contains polygon, pixelToCmRatio, and panelConfig
 * @param {Object} baseline - User-drawn baseline with p1 and p2 coordinates
 * @returns {Array} Array of generated panel objects
 */
export const generatePanelLayout = (refinedArea, baseline) => {
  if (!refinedArea || !refinedArea.polygon || !refinedArea.pixelToCmRatio) {
    console.error('Missing configuration data from Step 2')
    return []
  }

  if (!baseline) {
    console.error('Please draw a baseline for the first row of panels')
    return []
  }

  const { polygon, pixelToCmRatio, panelConfig } = refinedArea
  const { frontHeight, backHeight, angle } = panelConfig
  
  // Get polygon coordinates array
  const polygonCoords = polygon.coordinates || polygon
  
  // Panel dimensions in cm (from selected panel type)
  const panelLengthCm = 238.2
  const panelWidthCm = 113.4
  const panelGapCm = 2.5
  const rowSpacingCm = backHeight * 1.5
  
  // Convert to pixels
  const panelLengthPx = panelLengthCm / pixelToCmRatio
  const panelWidthPx = panelWidthCm / pixelToCmRatio
  const panelGapPx = panelGapCm / pixelToCmRatio
  const rowSpacingPx = rowSpacingCm / pixelToCmRatio
  
  // Calculate roof projection (horizontal footprint) in pixels
  const angleRad = angle * (Math.PI / 180)
  const roofProjectionPx = (panelLengthCm * Math.cos(angleRad)) / pixelToCmRatio
  
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
  
  let currentRotY = baselineRotY
  let rowIndex = 0
  
  console.log('Panel placement starting at baselineRotY:', baselineRotY)
  
  while (currentRotY + roofProjectionPx <= rotMaxY) {
    // For first row, use baseline X range; for other rows, use full polygon width
    const startX = (rowIndex === 0) ? baselineStartX : rotMinX
    const endX = (rowIndex === 0) ? baselineEndX : rotMaxX
    
    let currentRotX = startX
    let panelsInRow = 0
    let isLastRow = (currentRotY + rowSpacingPx + roofProjectionPx) > rotMaxY
    
    // Place panels in row from left to right in rotated space
    while (currentRotX + panelWidthPx <= endX) {
      if (isPanelInRotatedPolygon(currentRotX, currentRotY, panelWidthPx, roofProjectionPx)) {
        // Calculate center in rotated space
        const rotCenterX = currentRotX + panelWidthPx / 2
        const rotCenterY = currentRotY + roofProjectionPx / 2
        
        // Rotate back to original space
        const dx = rotCenterX - centerX
        const dy = rotCenterY - centerY
        const originalCenterX = centerX + dx * Math.cos(roofOrientation) - dy * Math.sin(roofOrientation)
        const originalCenterY = centerY + dx * Math.sin(roofOrientation) + dy * Math.cos(roofOrientation)
        
        // Calculate top-left corner in original space
        const originalX = originalCenterX - panelWidthPx / 2
        const originalY = originalCenterY - roofProjectionPx / 2
        
        generatedPanels.push({
          id: panelId++,
          x: originalX,
          y: originalY,
          width: panelWidthPx,
          height: roofProjectionPx,
          widthCm: panelWidthCm,
          heightCm: panelLengthCm,
          rotation: roofOrientation * (180 / Math.PI),
          row: rowIndex
        })
        panelsInRow++
      }
      
      currentRotX += panelWidthPx + panelGapPx
    }
    
    console.log(`Row ${rowIndex}: placed ${panelsInRow} panels`)
    
    // Move to next row
    currentRotY += (roofProjectionPx + rowSpacingPx)
    rowIndex++
    
    // If this is the last row and landscape didn't fit, try portrait
    if (isLastRow && panelsInRow === 0 && (currentRotY + roofProjectionPx <= rotMaxY)) {
      const portraitProjectionPx = (panelWidthCm * Math.cos(angleRad)) / pixelToCmRatio
      const portraitWidthPx = panelLengthPx
      
      currentRotX = rotMinX
      while (currentRotX + portraitWidthPx <= rotMaxX) {
        if (isPanelInRotatedPolygon(currentRotX, currentRotY, portraitWidthPx, portraitProjectionPx)) {
          const rotCenterX = currentRotX + portraitWidthPx / 2
          const rotCenterY = currentRotY + portraitProjectionPx / 2
          
          const dx = rotCenterX - centerX
          const dy = rotCenterY - centerY
          const originalCenterX = centerX + dx * Math.cos(roofOrientation) - dy * Math.sin(roofOrientation)
          const originalCenterY = centerY + dx * Math.sin(roofOrientation) + dy * Math.cos(roofOrientation)
          
          const originalX = originalCenterX - portraitWidthPx / 2
          const originalY = originalCenterY - portraitProjectionPx / 2
          
          generatedPanels.push({
            id: panelId++,
            x: originalX,
            y: originalY,
            width: portraitWidthPx,
            height: portraitProjectionPx,
            widthCm: panelLengthCm,
            heightCm: panelWidthCm,
            rotation: roofOrientation * (180 / Math.PI) + 90,
            row: rowIndex
          })
          panelsInRow++
        }
        currentRotX += portraitWidthPx + panelGapPx
      }
      console.log(`Row ${rowIndex} (portrait): placed ${panelsInRow} panels`)
      break
    }
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
export const createManualPanel = (refinedArea, baseline, existingPanels) => {
  if (!refinedArea || !refinedArea.pixelToCmRatio || !baseline || !baseline.p2) {
    return null
  }

  const { pixelToCmRatio } = refinedArea
  
  // Panel dimensions
  const panelLengthCm = 238.2
  const panelWidthCm = 113.4
  
  const panelLengthPx = panelLengthCm / pixelToCmRatio
  const panelWidthPx = panelWidthCm / pixelToCmRatio
  
  // Calculate baseline center and angle
  const baselineCenterX = (baseline.p1[0] + baseline.p2[0]) / 2
  const baselineCenterY = (baseline.p1[1] + baseline.p2[1]) / 2
  const baselineAngle = Math.atan2(
    baseline.p2[1] - baseline.p1[1],
    baseline.p2[0] - baseline.p1[0]
  )
  
  // Place panel below baseline
  const margin = 50
  const newPanelCenterX = baselineCenterX + margin * Math.sin(baselineAngle)
  const newPanelCenterY = baselineCenterY - margin * Math.cos(baselineAngle)
  
  const newPanelX = newPanelCenterX - panelLengthPx / 2
  const newPanelY = newPanelCenterY - panelWidthPx / 2
  
  // Generate new panel ID
  const newId = existingPanels.length > 0 ? Math.max(...existingPanels.map(p => p.id)) + 1 : 1
  
  return {
    id: newId,
    x: newPanelX,
    y: newPanelY,
    width: panelLengthPx,
    height: panelWidthPx,
    widthCm: panelLengthCm,
    heightCm: panelWidthCm,
    rotation: baselineAngle * (180 / Math.PI)
  }
}

/**
 * Detect rows from a list of panels
 * @param {Array} panelList - Array of panel objects
 * @param {number} pixelToCmRatio - Conversion ratio
 * @returns {Array} Array of rows, where each row is an array of panels
 */
export const detectRows = (panelList, pixelToCmRatio) => {
  if (!pixelToCmRatio) return []
  
  const panelGapCm = 2.5
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
 * Calculate snapped positions for moved panels
 * @param {Array} allPanels - All panels
 * @param {Array} movedPanelIds - IDs of panels that were moved
 * @param {number} pixelToCmRatio - Conversion ratio
 * @returns {Array} Updated panels array with snapped positions
 */
export const snapPanelsToRows = (allPanels, movedPanelIds, pixelToCmRatio) => {
  if (!pixelToCmRatio) return allPanels
  
  const panelGapCm = 2.5
  const panelGapPx = panelGapCm / pixelToCmRatio
  
  // Get unmoved panels (potential target rows)
  const unmovedPanels = allPanels.filter(p => !movedPanelIds.includes(p.id))
  
  // Detect rows from unmoved panels only
  const rows = detectRows(unmovedPanels, pixelToCmRatio)
  
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
