// Pure panel fill computation for scratch-mode rect/polygon areas.

const DEFAULT_LENGTH_CM = 238.2  // long dimension
const DEFAULT_WIDTH_CM  = 113.4  // short dimension
const GAP_CM = 2.5

/**
 * Compute panels that fill a rectangle in image pixel space.
 * Used for live draw preview (rotation=0 always during draw).
 *
 * @param {object} rect
 *   cx, cy       - center of rect in image pixels
 *   width, height - dimensions in image pixels (unrotated)
 *   rotation      - degrees (applied to rect and panels)
 *   xDir          - 'ltr' | 'rtl'
 *   yDir          - 'ttb' | 'btt'
 * @param {number} cmPerPixel
 * @returns {Array} panel objects with image-pixel coords
 */
export function computeRectPanels(rect, cmPerPixel, panelSpec) {
  if (!cmPerPixel || cmPerPixel <= 0) return []
  const { cx, cy, width, height, rotation = 0, xDir = 'ltr', yDir = 'ttb' } = rect
  const pLen = panelSpec?.lengthCm ?? DEFAULT_LENGTH_CM
  const pWid = panelSpec?.widthCm  ?? DEFAULT_WIDTH_CM

  const gapPx      = GAP_CM / cmPerPixel
  const portraitW  = pWid / cmPerPixel
  const portraitH  = pLen / cmPerPixel
  const landscapeW = pLen / cmPerPixel
  const landscapeH = pWid / cmPerPixel

  const localPanels = []
  let localY = 0
  let rowIndex = 0

  while (localY < height) {
    const remaining = height - localY
    let rowH, panelW, widthCm, heightCm

    if (remaining >= portraitH - 0.001) {
      rowH = portraitH; panelW = portraitW
      widthCm = pWid; heightCm = pLen
    } else if (remaining >= landscapeH - 0.001) {
      rowH = landscapeH; panelW = landscapeW
      widthCm = pLen; heightCm = pWid
    } else {
      break
    }

    let localX = 0
    let colIndex = 0
    while (localX + panelW <= width + 0.001) {
      if (width - localX < panelW * 0.5) break
      localPanels.push({
        localCx: localX + panelW / 2,
        localCy: localY + rowH / 2,
        panelW, rowH,
        widthCm, heightCm,
        rowIndex, colIndex,
      })
      localX += panelW + gapPx
      colIndex++
    }

    localY += rowH + gapPx
    rowIndex++
  }

  // Apply xDir/yDir flips
  const flipped = localPanels.map(p => ({
    ...p,
    localCx: xDir === 'rtl' ? width  - p.localCx : p.localCx,
    localCy: yDir === 'btt' ? height - p.localCy : p.localCy,
  }))

  const rotRad = (rotation * Math.PI) / 180
  const cosR   = Math.cos(rotRad)
  const sinR   = Math.sin(rotRad)

  return flipped.map((p, i) => {
    const lx = p.localCx - width  / 2
    const ly = p.localCy - height / 2
    const imgCx = cx + lx * cosR - ly * sinR
    const imgCy = cy + lx * sinR + ly * cosR
    return {
      id: i + 1,
      x: imgCx - p.panelW / 2,
      y: imgCy - p.rowH   / 2,
      width:    p.panelW,
      height:   p.rowH,
      widthCm:  p.widthCm,
      heightCm: p.heightCm,
      rotation,
      cx: imgCx,
      cy: imgCy,
      row:  p.rowIndex,
      line: p.rowIndex,
    }
  })
}

// ── Polygon helpers ───────────────────────────────────────────────────────────

/** Ray-casting point-in-polygon test (2D). */
function pointInPolygon(px, py, polygon) {
  let inside = false
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y
    const xj = polygon[j].x, yj = polygon[j].y
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Compute panels that fill a polygon area.
 * Works for any convex/concave polygon (rect, L-shape, etc.).
 *
 * @param {object} area  { vertices [{x,y}], rotation (deg), yDir }
 * @param {number} cmPerPixel
 * @returns {Array} panel objects with image-pixel coords
 */
export function computePolygonPanels(area, cmPerPixel, panelSpec) {
  if (!cmPerPixel || cmPerPixel <= 0) return []
  const { vertices, rotation = 0, yDir = 'ttb', xDir = 'ltr' } = area
  const pLen = panelSpec?.lengthCm ?? DEFAULT_LENGTH_CM
  const pWid = panelSpec?.widthCm  ?? DEFAULT_WIDTH_CM
  if (!vertices || vertices.length < 3) return []

  const rotRad = (rotation * Math.PI) / 180
  const cosF = Math.cos(-rotRad), sinF = Math.sin(-rotRad)  // screen → local
  const cosB = Math.cos(rotRad),  sinB = Math.sin(rotRad)   // local → screen

  // Centroid of polygon vertices (used as local-frame origin)
  const cxAvg = vertices.reduce((s, v) => s + v.x, 0) / vertices.length
  const cyAvg = vertices.reduce((s, v) => s + v.y, 0) / vertices.length

  // Vertices in local (unrotated) frame
  const localVerts = vertices.map(v => {
    const dx = v.x - cxAvg, dy = v.y - cyAvg
    return { x: dx * cosF - dy * sinF, y: dx * sinF + dy * cosF }
  })

  const minLX = Math.min(...localVerts.map(v => v.x))
  const maxLX = Math.max(...localVerts.map(v => v.x))
  const minLY = Math.min(...localVerts.map(v => v.y))
  const maxLY = Math.max(...localVerts.map(v => v.y))

  const gapPx      = GAP_CM / cmPerPixel
  const portraitW  = pWid / cmPerPixel
  const portraitH  = pLen / cmPerPixel
  const landscapeW = pLen / cmPerPixel
  const landscapeH = pWid / cmPerPixel

  const bboxH = maxLY - minLY
  const bboxW = maxLX - minLX

  // Fill bounding box row by row, respecting yDir (matches computeRectPanels behaviour)
  const localPanels = []
  let localY = 0
  let rowIndex = 0

  while (localY < bboxH) {
    const remaining = bboxH - localY
    let rowH, panelW, widthCm, heightCm

    if (remaining >= portraitH - 0.001) {
      rowH = portraitH; panelW = portraitW
      widthCm = pWid; heightCm = pLen
    } else if (remaining >= landscapeH - 0.001) {
      rowH = landscapeH; panelW = landscapeW
      widthCm = pLen; heightCm = pWid
    } else {
      break
    }

    let localX = 0
    let colIndex = 0
    while (localX + panelW <= bboxW + 0.001) {
      if (bboxW - localX < panelW * 0.5) break
      localPanels.push({
        localCx: xDir === 'rtl' ? maxLX - localX - panelW / 2 : minLX + localX + panelW / 2,
        localCy: yDir === 'btt' ? maxLY - localY - rowH / 2 : minLY + localY + rowH / 2,
        panelW, rowH, widthCm, heightCm, rowIndex, colIndex,
      })
      localX += panelW + gapPx
      colIndex++
    }
    localY += rowH + gapPx
    rowIndex++
  }

  // Clip: only keep panels whose centre is inside the polygon (local frame)
  const inside = localPanels.filter(p => pointInPolygon(p.localCx, p.localCy, localVerts))

  // Transform centres back to screen coords
  return inside.map((p, i) => {
    const imgCx = cxAvg + p.localCx * cosB - p.localCy * sinB
    const imgCy = cyAvg + p.localCx * sinB + p.localCy * cosB
    return {
      id: i + 1,
      x: imgCx - p.panelW / 2,
      y: imgCy - p.rowH   / 2,
      width:    p.panelW,
      height:   p.rowH,
      widthCm:  p.widthCm,
      heightCm: p.heightCm,
      rotation,
      cx: imgCx,
      cy: imgCy,
      row:  p.rowIndex,
      line: p.rowIndex,
    }
  })
}

/**
 * Fit a tight 4-vertex polygon around a set of placed panels (in screen coords).
 * Vertex[0] is the corner nearest to (startX, startY) — used as y-lock pivot.
 * Vertices are ordered clockwise starting from vertex[0].
 *
 * @param {Array}  panels      panel objects from computeRectPanels
 * @param {number} rotation    degrees (panel rotation)
 * @param {number} startX      draw-start x (screen coords)
 * @param {number} startY      draw-start y (screen coords)
 * @returns {Array|null}  [{x,y}, ...] 4 vertices, or null if no panels
 */
export function fitPolygonToRectPanels(panels, rotation, startX, startY) {
  if (!panels.length) return null

  const rotRad = (rotation * Math.PI) / 180
  const cosF = Math.cos(-rotRad), sinF = Math.sin(-rotRad)
  const cosB = Math.cos(rotRad),  sinB = Math.sin(rotRad)

  // Use average panel centre as local-frame origin
  const avgCx = panels.reduce((s, p) => s + p.cx, 0) / panels.length
  const avgCy = panels.reduce((s, p) => s + p.cy, 0) / panels.length

  // Find tight bounding box of all panel corners in local frame.
  // Use actual rotated screen-space corners (not axis-aligned) so the fit is
  // correct for any rotation, not just rotation=0.
  let minLX = Infinity, maxLX = -Infinity, minLY = Infinity, maxLY = -Infinity
  panels.forEach(p => {
    const hw = p.width / 2, hh = p.height / 2
    const actualCorners = [
      { x: p.cx - hw * cosB + hh * sinB, y: p.cy - hw * sinB - hh * cosB },
      { x: p.cx + hw * cosB + hh * sinB, y: p.cy + hw * sinB - hh * cosB },
      { x: p.cx + hw * cosB - hh * sinB, y: p.cy + hw * sinB + hh * cosB },
      { x: p.cx - hw * cosB - hh * sinB, y: p.cy - hw * sinB + hh * cosB },
    ]
    actualCorners.forEach(c => {
      const dx = c.x - avgCx, dy = c.y - avgCy
      const lx = dx * cosF - dy * sinF
      const ly = dx * sinF + dy * cosF
      if (lx < minLX) minLX = lx; if (lx > maxLX) maxLX = lx
      if (ly < minLY) minLY = ly; if (ly > maxLY) maxLY = ly
    })
  })

  // 4 corners of tight bbox in local frame (clockwise: TL, TR, BR, BL)
  const localCorners = [
    { x: minLX, y: minLY },
    { x: maxLX, y: minLY },
    { x: maxLX, y: maxLY },
    { x: minLX, y: maxLY },
  ]

  // Back to screen coords
  const screenCorners = localCorners.map(c => ({
    x: avgCx + c.x * cosB - c.y * sinB,
    y: avgCy + c.x * sinB + c.y * cosB,
  }))

  // Rotate vertex list so vertex[0] is nearest to draw-start point (the pivot)
  const dists = screenCorners.map(v => (v.x - startX) ** 2 + (v.y - startY) ** 2)
  const pivotIdx = dists.indexOf(Math.min(...dists))
  return [0, 1, 2, 3].map(i => screenCorners[(pivotIdx + i) % 4])
}
