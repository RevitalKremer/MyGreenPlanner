import { useMemo } from 'react'
import { TEXT_VERY_LIGHT, BG_FAINT, BLUE } from '../../../styles/colors'
import CanvasNavigator from '../../shared/CanvasNavigator'
import { useCanvasPanZoom } from '../../../hooks/useCanvasPanZoom'
import { getPanelsBoundingBox, buildRowGroups } from './tabUtils'
import HatchedPanels from './HatchedPanels'

const PAD      = 40   // SVG padding around panel content
const MAX_W    = 900  // SVG content width (same as rails/bases tabs)
const CSS_PAD  = 20   // div padding around SVG
const POLY_PAD = 12   // expansion around each area polygon (SVG px)

// Andrew's monotone chain convex hull. Points must be sorted by x then y.
function convexHull(pts) {
  if (pts.length < 3) return pts
  const lower = [], upper = []
  const cross = (o, a, b) => (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop()
    lower.push(p)
  }
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop(); upper.pop()
  return [...lower, ...upper]
}

// Compute convex hull polygon around an area's panels, expanded outward by POLY_PAD.
// Returns SVG-space [x, y] pairs.
function areaPolygonPoints(areaPanels, bbox, sc) {
  if (areaPanels.length === 0) return null

  // Collect all 4 corners of every panel in screen space
  const corners = []
  for (const p of areaPanels) {
    const cx = p.x + p.width / 2, cy = p.y + p.height / 2
    const ar = (p.rotation || 0) * Math.PI / 180
    const hw = p.width / 2, hh = p.height / 2
    const cos = Math.cos(ar), sin = Math.sin(ar)
    for (const [dx, dy] of [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]]) {
      corners.push([cx + dx*cos - dy*sin, cy + dx*sin + dy*cos])
    }
  }

  // Sort then compute convex hull
  corners.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const hull = convexHull(corners)

  // Map to SVG space
  const svgHull = hull.map(([x, y]) => [
    PAD + (x - bbox.minX) * sc,
    PAD + (y - bbox.minY) * sc,
  ])

  // Expand each vertex outward from centroid by POLY_PAD
  const cx = svgHull.reduce((s, [x]) => s + x, 0) / svgHull.length
  const cy = svgHull.reduce((s, [, y]) => s + y, 0) / svgHull.length
  return svgHull.map(([x, y]) => {
    const dx = x - cx, dy = y - cy
    const d = Math.sqrt(dx*dx + dy*dy)
    return d < 1 ? [x, y] : [x + dx/d * POLY_PAD, y + dy/d * POLY_PAD]
  })
}

export default function AreasTab({ panels, areas, rowKeys, areaLabel, printMode = false }) {
  const {
    zoom, setZoom, panOffset, panActive,
    containerRef, contentRef,
    startPan, handleMouseMove, stopPan, resetView,
    MM_W, MM_H, panToMinimapPoint, getMinimapViewportRect,
  } = useCanvasPanZoom()

  const nonEmptyPanels = useMemo(() => panels.filter(p => !p.isEmpty), [panels])

  const bbox = useMemo(() => {
    if (nonEmptyPanels.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 }
    return getPanelsBoundingBox(nonEmptyPanels)
  }, [nonEmptyPanels])

  const bboxW = bbox.maxX - bbox.minX
  const bboxH = bbox.maxY - bbox.minY
  const sc    = bboxW > 0 ? MAX_W / bboxW : 1
  const svgW  = MAX_W + PAD * 2
  const svgH  = bboxH * sc + PAD * 2

  const { map: rowGroups } = useMemo(() => buildRowGroups(nonEmptyPanels), [nonEmptyPanels])

  const areaData = useMemo(() => {
    const items = rowKeys.map((areaKey, i) => {
      const areaPanels = rowGroups[areaKey] ?? []
      if (areaPanels.length === 0) return null

      const pts = areaPolygonPoints(areaPanels, bbox, sc)
      if (!pts) return null

      // Label center = centroid of polygon
      const svgCx = pts.reduce((s, [x]) => s + x, 0) / pts.length
      const svgCy = pts.reduce((s, [, y]) => s + y, 0) / pts.length

      const extW = Math.max(...pts.map(([x]) => x)) - Math.min(...pts.map(([x]) => x))
      const extH = Math.max(...pts.map(([, y]) => y)) - Math.min(...pts.map(([, y]) => y))

      return { areaKey, pts, svgCx, svgCy, extW, extH, label: areaLabel(areaKey, i) }
    }).filter(Boolean)

    // Use the smallest area to determine font size so it fits in every area
    const fontSize = items.length === 0 ? 14 : Math.max(14, Math.min(
      ...items.map(({ extH, extW }) => Math.min(extH * 0.3, extW * 0.12))
    ))

    return items.map(item => ({ ...item, fontSize }))
  }, [rowKeys, rowGroups, bbox, sc, areaLabel])

  if (nonEmptyPanels.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: TEXT_VERY_LIGHT, fontSize: '0.95rem' }}>
        No panels found — complete Step 3 first.
      </div>
    )
  }

  if (printMode) {
    return (
      <svg width={svgW} height={svgH} style={{ display: 'block' }}>
        {areaData.map(({ areaKey, pts }) => (
          <polygon key={`poly-${areaKey}`}
            points={pts.map(([x, y]) => `${x},${y}`).join(' ')}
            fill={BLUE} fillOpacity={0.13}
            stroke={BLUE} strokeOpacity={0.65} strokeWidth={2}
          />
        ))}
        <HatchedPanels
          panels={nonEmptyPanels}
          selectedTrapId={null}
          toSvg={(sx, sy) => [PAD + (sx - bbox.minX) * sc, PAD + (sy - bbox.minY) * sc]}
          sc={sc}
          pixelToCmRatio={1}
          clipIdPrefix="atpm"
        />
        {areaData.map(({ areaKey, svgCx, svgCy, fontSize, label }) => (
          <text key={`lbl-${areaKey}`}
            x={svgCx} y={svgCy}
            textAnchor="middle" dominantBaseline="middle"
            fill={BLUE} fontSize={fontSize} fontWeight="800"
            stroke="white" strokeWidth={fontSize * 0.2} paintOrder="stroke"
          >{label}</text>
        ))}
      </svg>
    )
  }

  const contentW = svgW + CSS_PAD * 2
  const contentH = svgH + CSS_PAD * 2

  return (
    <div
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: BG_FAINT, cursor: panActive ? 'grabbing' : 'grab' }}
      onMouseDown={startPan} onMouseMove={handleMouseMove} onMouseUp={stopPan} onMouseLeave={stopPan}
      ref={containerRef}
    >
      <div style={{ transform: `translate(${panOffset.x}px, ${panOffset.y}px)`, transformOrigin: 'top left' }}>
        <div ref={contentRef} style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
          <div style={{ padding: CSS_PAD }}>
            <svg width={svgW} height={svgH} style={{ display: 'block' }}>

              {/* Area polygons — drawn behind panels */}
              {areaData.map(({ areaKey, pts }) => (
                <polygon key={`poly-${areaKey}`}
                  points={pts.map(([x, y]) => `${x},${y}`).join(' ')}
                  fill={BLUE} fillOpacity={0.13}
                  stroke={BLUE} strokeOpacity={0.65} strokeWidth={2}
                  style={{ pointerEvents: 'none' }}
                />
              ))}

              {/* Panels */}
              <HatchedPanels
                panels={nonEmptyPanels}
                selectedTrapId={null}
                toSvg={(sx, sy) => [PAD + (sx - bbox.minX) * sc, PAD + (sy - bbox.minY) * sc]}
                sc={sc}
                pixelToCmRatio={1}
                clipIdPrefix="at"
              />

              {/* Area labels — on top of panels */}
              {areaData.map(({ areaKey, svgCx, svgCy, fontSize, label }) => (
                <text key={`lbl-${areaKey}`}
                  x={svgCx} y={svgCy}
                  textAnchor="middle" dominantBaseline="middle"
                  fill={BLUE} fontSize={fontSize} fontWeight="800"
                  stroke="white" strokeWidth={fontSize * 0.2} paintOrder="stroke"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >{label}</text>
              ))}
            </svg>
          </div>
        </div>
      </div>

      <CanvasNavigator
        viewZoom={zoom}
        onZoomIn={()  => setZoom(z => Math.min(8, z + 0.1))}
        onZoomOut={()  => setZoom(z => Math.max(0.3, z - 0.1))}
        onZoomReset={resetView}
        mmWidth={MM_W} mmHeight={MM_H}
        onPanToPoint={panToMinimapPoint}
        viewportRect={getMinimapViewportRect()}
        left={276}
      >
        {/* Minimap: one polygon outline per area */}
        {areaData.map(({ areaKey, pts }) => (
          <polygon key={areaKey}
            points={pts.map(([x, y]) =>
              `${((CSS_PAD + x) / contentW * MM_W).toFixed(2)},${((CSS_PAD + y) / contentH * MM_H).toFixed(2)}`
            ).join(' ')}
            fill={BLUE} fillOpacity={0.55} stroke="none"
          />
        ))}
      </CanvasNavigator>
    </div>
  )
}
