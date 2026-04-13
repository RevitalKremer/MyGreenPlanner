/** Format a number with locale thousands separators */
export const fmt = n => n.toLocaleString('en-US')

/** Compute the rotated bounding box of all panels in screen space */
export function getPanelsBoundingBox(panels) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of panels) {
    const cx = p.x + p.width / 2, cy = p.y + p.height / 2
    const ar = (p.rotation || 0) * Math.PI / 180
    const hw = p.width / 2, hh = p.height / 2
    const cos = Math.cos(ar), sin = Math.sin(ar)
    const corners = [
      { x: cx - hw * cos + hh * sin, y: cy - hw * sin - hh * cos },
      { x: cx + hw * cos + hh * sin, y: cy + hw * sin - hh * cos },
      { x: cx + hw * cos - hh * sin, y: cy + hw * sin + hh * cos },
      { x: cx - hw * cos - hh * sin, y: cy - hw * sin + hh * cos },
    ]
    for (const c of corners) {
      minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x)
      minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y)
    }
  }
  return { minX, maxX, minY, maxY }
}

/**
 * Compute optimal print-mode scale and natural size to maximally fill a
 * fixed content area while preserving the bbox aspect ratio.
 * Returns { sc, naturalW, naturalH } where one of (naturalW, naturalH)
 * equals the corresponding (contentW, contentH) and the other is smaller.
 */
export function computePrintFit(bboxW, bboxH, contentW, contentH, pad) {
  const availW = Math.max(1, contentW - 2 * pad)
  const availH = Math.max(1, contentH - 2 * pad)
  const sc = bboxW > 0 && bboxH > 0
    ? Math.min(availW / bboxW, availH / bboxH)
    : 1
  return {
    sc,
    naturalW: bboxW * sc + 2 * pad,
    naturalH: bboxH * sc + 2 * pad,
  }
}

/** Expand a bounding box to include the full image dimensions if image exists */
export function expandBboxForImage(panelBbox, uploadedImageData) {
  if (!uploadedImageData) return panelBbox
  
  const imgW = uploadedImageData.width || 3000
  const imgH = uploadedImageData.height || 2000
  
  return {
    minX: Math.min(panelBbox.minX, 0),
    maxX: Math.max(panelBbox.maxX, imgW),
    minY: Math.min(panelBbox.minY, 0),
    maxY: Math.max(panelBbox.maxY, imgH)
  }
}

/** Group panels by area/row key, return { map, sortedKeys }.
 *  Uses panel.areaGroupKey (set by computePanelsAction) to merge multi-row areas.
 */
export function buildRowGroups(panels) {
  const map = {}
  for (const p of panels) {
    // areaGroupKey groups all rows in a multi-row area under one key
    const key = p.areaGroupKey ?? p.area ?? p.row ?? 0
    if (!map[key]) map[key] = []
    map[key].push(p)
  }
  const keys = Object.keys(map).map(Number).sort((a, b) => a - b)
  return { map, keys }
}

/** Group panels by trapezoidId, return { map, keys } (keys sorted alphabetically) */
export function buildTrapezoidGroups(panels) {
  const map = {}
  for (const p of panels) {
    const key = p.trapezoidId ?? 'A1'
    if (!map[key]) map[key] = []
    map[key].push(p)
  }
  const keys = Object.keys(map).sort()
  return { map, keys }
}
