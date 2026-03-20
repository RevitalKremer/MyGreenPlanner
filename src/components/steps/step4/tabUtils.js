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

/** Group panels by area/row key, return { map, sortedKeys } */
export function buildRowGroups(panels) {
  const map = {}
  for (const p of panels) {
    const key = p.area ?? p.row ?? 0
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
