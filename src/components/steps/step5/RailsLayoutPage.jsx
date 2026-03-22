import { useMemo } from 'react'
import { CadPage } from '../Step5PdfReport'
import HatchedPanels from '../step4/HatchedPanels'
import DimensionAnnotation from '../step4/DimensionAnnotation'
import { getPanelsBoundingBox, buildTrapezoidGroups } from '../step4/tabUtils'
import { computeRowRailLayout, localToScreen, screenToLocal, DEFAULT_RAIL_OVERHANG_CM, DEFAULT_STOCK_LENGTHS_MM } from '../../../utils/railLayoutService'
import { RAIL_STROKE, TEXT_SECONDARY, BLUE_SELECTED } from '../../../styles/colors'

const ZOOM = 1

export default function RailsLayoutPage({
  panels = [], refinedArea,
  trapSettingsMap = {}, trapLineRailsMap = {},
  project, panelType, panelWp, totalKw, date, pageRef,
  showRails = true,
}) {
  const pixelToCmRatio = refinedArea?.pixelToCmRatio ?? 1

  const { map: trapGroups, keys: trapIds } = useMemo(() => buildTrapezoidGroups(panels), [panels])

  const railLayouts = useMemo(() => trapIds.map(trapId => {
    const s = trapSettingsMap[trapId] ?? {}
    return computeRowRailLayout(trapGroups[trapId], pixelToCmRatio, {
      lineRails:    trapLineRailsMap[trapId] ?? null,
      overhangCm:   s.railOverhangCm ?? DEFAULT_RAIL_OVERHANG_CM,
      stockLengths: s.stockLengths   ?? DEFAULT_STOCK_LENGTHS_MM,
    })
  }), [trapIds, trapGroups, pixelToCmRatio, trapSettingsMap, trapLineRailsMap])

  const { sc, svgW, svgH, toSvg, svgCentX, svgCentY } = useMemo(() => {
    if (!panels.length) return { sc: 1, svgW: 100, svgH: 100, toSvg: () => [0, 0], svgCentX: 50, svgCentY: 50 }
    const bbox = getPanelsBoundingBox(panels)
    const PAD = 32
    const bboxW = bbox.maxX - bbox.minX
    const bboxH = bbox.maxY - bbox.minY
    const sc = bboxW > 0 ? 850 / bboxW : 1
    const svgW = 850 + PAD * 2
    const svgH = bboxH * sc + PAD * 2
    const toSvg = (sx, sy) => [PAD + (sx - bbox.minX) * sc, PAD + (sy - bbox.minY) * sc]
    return { sc, svgW, svgH, toSvg, svgCentX: PAD + bboxW / 2 * sc, svgCentY: PAD + bboxH / 2 * sc }
  }, [panels])

  const crossRailEdgeDistMm = 40  // default

  return (
    <CadPage
      pageRef={pageRef}
      project={project}
      panelType={panelType}
      panelWp={panelWp}
      totalKw={totalKw}
      panelCount={panels.length}
      date={date}
    >
      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        width="100%" height="100%"
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block' }}
      >
        <HatchedPanels
          panels={panels}
          selectedTrapId={null}
          toSvg={toSvg}
          sc={sc}
          pixelToCmRatio={pixelToCmRatio}
          clipIdPrefix="pdf-rl"
        />

        {railLayouts.map((rl, i) => {
          if (!rl) return null
          const railProfileSvg = (crossRailEdgeDistMm / 10 / pixelToCmRatio) * sc

          // Dimension annotations — one per rail line (first rail per lineIdx)
          const annotatedRailIds = new Set()
          const annotatedLines = new Set()
          for (const rail of rl.rails) {
            if (!annotatedLines.has(rail.lineIdx)) {
              annotatedLines.add(rail.lineIdx)
              annotatedRailIds.add(rail.railId)
            }
          }

          const dimAnnotations = rl.frame ? (() => {
            const { center: fc, angleRad: ar, localBounds: lb } = rl.frame
            const perpX = -Math.sin(ar), perpY = Math.cos(ar)
            const [fcxSvg, fcySvg] = toSvg(fc.x, fc.y)
            const outSign = ((fcxSvg - svgCentX) * perpX + (fcySvg - svgCentY) * perpY) >= 0 ? 1 : -1
            const apX = outSign * perpX, apY = outSign * perpY
            const extremeLocalY = outSign >= 0 ? lb.maxY : lb.minY
            const ANN_OFF = 16 / ZOOM, EXT_GAP = 2 / ZOOM
            const edgeSvgFn = (lx) => { const s = localToScreen({ x: lx, y: extremeLocalY }, fc, ar); return toSvg(s.x, s.y) }
            const annSvgFn  = (lx) => { const [ex, ey] = edgeSvgFn(lx); return [ex + apX * ANN_OFF, ey + apY * ANN_OFF] }

            return rl.rails
              .filter(rail => annotatedRailIds.has(rail.railId))
              .map(rail => {
                const lxStart = screenToLocal(rail.screenStart, fc, ar).x
                const lxEnd   = screenToLocal(rail.screenEnd,   fc, ar).x
                const [esx, esy] = edgeSvgFn(lxStart), [eex, eey] = edgeSvgFn(lxEnd)
                const measurePts = [[esx + apX * EXT_GAP, esy + apY * EXT_GAP], [eex + apX * EXT_GAP, eey + apY * EXT_GAP]]
                const annPts     = [annSvgFn(lxStart), annSvgFn(lxEnd)]
                return (
                  <DimensionAnnotation key={`dim-${rail.railId}`}
                    measurePts={measurePts} annPts={annPts}
                    labels={[String(Math.round(rail.lengthMm))]}
                    zoom={ZOOM} color={TEXT_SECONDARY}
                  />
                )
              })
          })() : null

          // Material summary label per panel line
          const materialSummary = (() => {
            const refRail = rl.rails[0]
            if (!refRail || !rl.panelLocalRects || !rl.frame) return null
            const counts = {}
            for (const mm of refRail.stockSegments) counts[mm] = (counts[mm] ?? 0) + 1
            const text = Object.entries(counts)
              .sort((a, b) => Number(b[0]) - Number(a[0]))
              .map(([mm, n]) => `${n}×${(Number(mm) / 1000).toFixed(3).replace(/\.?0+$/, '')}m`)
              .join(' + ')
            const { center, angleRad } = rl.frame
            const fontSize = 10
            const lineRects = {}
            for (const pr of rl.panelLocalRects) {
              if (!lineRects[pr.line]) lineRects[pr.line] = []
              lineRects[pr.line].push(pr)
            }
            return Object.entries(lineRects).map(([li, rects]) => {
              const midLX = (Math.min(...rects.map(r => r.localX)) + Math.max(...rects.map(r => r.localX + r.width))) / 2
              const midLY = (Math.min(...rects.map(r => r.localY)) + Math.max(...rects.map(r => r.localY + r.height))) / 2
              const sx = center.x + midLX * Math.cos(angleRad) - midLY * Math.sin(angleRad)
              const sy = center.y + midLX * Math.sin(angleRad) + midLY * Math.cos(angleRad)
              const [cx, cy] = toSvg(sx, sy)
              return (
                <text key={li} x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                  fontSize={fontSize} fontWeight="600" fill={RAIL_STROKE}
                  style={{ pointerEvents: 'none' }}>
                  {text}
                </text>
              )
            })
          })()

          return (
            <g key={i}>
              {materialSummary}
              {showRails && rl.rails.map(rail => {
                const [x1, y1] = toSvg(rail.screenStart.x, rail.screenStart.y)
                const [x2, y2] = toSvg(rail.screenEnd.x, rail.screenEnd.y)
                const dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy)
                if (len < 2) return null
                return (
                  <line key={`${i}-${rail.railId}`}
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={RAIL_STROKE} strokeWidth={railProfileSvg} strokeLinecap="square"
                  />
                )
              })}
              {dimAnnotations}
            </g>
          )
        })}
      </svg>
    </CadPage>
  )
}
