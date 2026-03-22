import { useMemo } from 'react'
import { CadPage } from '../Step5PdfReport'
import HatchedPanels from '../step4/HatchedPanels'
import DimensionAnnotation from '../step4/DimensionAnnotation'
import { getPanelsBoundingBox, buildTrapezoidGroups } from '../step4/tabUtils'
import { computeRowBasePlan, consolidateAreaBases, DEFAULT_BASE_EDGE_OFFSET_MM, DEFAULT_BASE_SPACING_MM, DEFAULT_BASE_OVERHANG_CM } from '../../../utils/basePlanService'
import { localToScreen, screenToLocal, DEFAULT_RAIL_OVERHANG_CM } from '../../../utils/railLayoutService'
import { BLUE, BLACK, BLOCK_FILL, BLOCK_STROKE, L_PROFILE_STROKE, TEXT_SECONDARY, BORDER_MID, TEXT_DARKEST } from '../../../styles/colors'

const ZOOM = 1

export default function BasesLayoutPage({
  panels = [], refinedArea,
  trapSettingsMap = {}, trapLineRailsMap = {}, trapRCMap = {}, customBasesMap = {},
  project, panelType, panelWp, totalKw, date, pageRef,
}) {
  const pixelToCmRatio = refinedArea?.pixelToCmRatio ?? 1

  const { map: trapGroups, keys: trapIds } = useMemo(() => buildTrapezoidGroups(panels), [panels])

  const basePlans = useMemo(() => trapIds.map(trapId => {
    const s = trapSettingsMap[trapId] ?? {}
    const lineRails = trapLineRailsMap[trapId] ?? null
    const cfg = {
      edgeOffsetMm: s.edgeOffsetMm ?? DEFAULT_BASE_EDGE_OFFSET_MM,
      spacingMm:    s.spacingMm    ?? DEFAULT_BASE_SPACING_MM,
    }
    const customOffsets = customBasesMap[trapId]
    if (customOffsets?.length > 0) cfg.customOffsets = customOffsets
    return computeRowBasePlan(trapGroups[trapId], pixelToCmRatio,
      { overhangCm: s.railOverhangCm ?? DEFAULT_RAIL_OVERHANG_CM, lineRails }, cfg)
  }), [trapIds, trapGroups, pixelToCmRatio, trapSettingsMap, trapLineRailsMap, customBasesMap])

const areaTrapsMap = useMemo(() => {
    const atm = {}
    for (const trapId of trapIds) {
      const area = trapId.replace(/\d+$/, '')
      if (!atm[area]) atm[area] = []
      atm[area].push(trapId)
    }
    return atm
  }, [trapIds])

  const basePlansMap = useMemo(() => {
    const m = {}
    trapIds.forEach((trapId, i) => { if (basePlans[i]) m[trapId] = basePlans[i] })
    return m
  }, [trapIds, basePlans])

  const consolidatedBasesMap = useMemo(
    () => consolidateAreaBases(areaTrapsMap, basePlansMap),
    [areaTrapsMap, basePlansMap]
  )

  const { sc, svgW, svgH, toSvg, svgCentX, svgCentY } = useMemo(() => {
    if (!panels.length) return { sc: 1, svgW: 100, svgH: 100, toSvg: () => [0, 0], svgCentX: 50, svgCentY: 50 }
    const bbox = getPanelsBoundingBox(panels)
    const PAD = 60
    const bboxW = bbox.maxX - bbox.minX
    const bboxH = bbox.maxY - bbox.minY
    const sc = bboxW > 0 ? 850 / bboxW : 1
    const svgW = 850 + PAD * 2
    const svgH = bboxH * sc + PAD * 2
    const toSvg = (sx, sy) => [PAD + (sx - bbox.minX) * sc, PAD + (sy - bbox.minY) * sc]
    return { sc, svgW, svgH, toSvg, svgCentX: PAD + bboxW / 2 * sc, svgCentY: PAD + bboxH / 2 * sc }
  }, [panels])

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
          clipIdPrefix="pdf-bp"
        />

        {/* Per-trap: blocks, rails, bases, diagonals */}
        {basePlans.map((bp, i) => {
          if (!bp) return null
          const trapId  = trapIds[i]
          const trapS   = trapSettingsMap[trapId] ?? {}
          const trapLRails = trapLineRailsMap[trapId] ?? null
          const { frame, lines } = bp
          const bases = consolidatedBasesMap[trapId] ?? bp.bases
          const { angleRad, localBounds } = frame
          const rc = trapRCMap[trapId]

          const railOffsetCm      = trapLRails?.[0]?.[0] ?? 0
          const crossRailOffsetCm = trapS.crossRailOffsetCm   ?? 5
          const baseOverhangCm    = trapS.baseOverhangCm      ?? DEFAULT_BASE_OVERHANG_CM
const railOffPx         = railOffsetCm    / pixelToCmRatio
          const connOffPx         = crossRailOffsetCm / pixelToCmRatio
          const baseOverhangPx    = baseOverhangCm  / pixelToCmRatio
          const panelRearY        = lines && lines.length > 0 ? lines[0].minY : localBounds.minY
          const rearLegY          = panelRearY + railOffPx
          let frontLegY = rearLegY
          if (trapLRails && lines && lines.length > 0) {
            for (const ln of lines) {
              const lnRails = trapLRails[ln.lineIdx]
              if (lnRails && lnRails.length > 0) {
                const lastRailY = ln.minY + lnRails[lnRails.length - 1] / pixelToCmRatio
                if (lastRailY > frontLegY) frontLegY = lastRailY
              }
            }
          }
          const baseTopY    = rearLegY  - baseOverhangPx
          const baseBottomY = frontLegY + baseOverhangPx
          const PROFILE_THICK = 4 / pixelToCmRatio * sc

          const railLocalYs = [];
          (lines || []).forEach((ln) => {
            const lineCenterY = (ln.minY + ln.maxY) / 2
            let lcY = ln.minY + connOffPx
            let rcY = ln.maxY - connOffPx
            const leftDist = lineCenterY - lcY, rightDist = rcY - lineCenterY
            if (leftDist >= 0 && rightDist >= 0) {
              if (leftDist <= rightDist) rcY = lineCenterY + leftDist
              else lcY = lineCenterY - rightDist
            }
            railLocalYs.push(lcY, rcY)
          })

          const blockLengthCm    = trapS.blockLengthCm ?? 50
          const blockWidthCm     = trapS.blockWidthCm  ?? 24
          const blockLengthLocal = blockLengthCm / pixelToCmRatio
          const blockLengthSvg   = blockLengthLocal * sc
          const blockWidthSvg    = (blockWidthCm / pixelToCmRatio) * sc
          const numBlocks = Math.max(2, (lines || []).reduce((sum, ln) => sum + (ln.orientation === 'LANDSCAPE' ? 1 : 2), 0))
          const numCenterBlocks = numBlocks - 2
          const innerRailYs = [...railLocalYs].sort((a, b) => a - b).slice(1, -1)
          const centerBlockYs = numCenterBlocks === 0 ? [] : innerRailYs.slice(-numCenterBlocks)
          const allBlockYCenters = [
            baseTopY + blockLengthLocal / 2,
            ...centerBlockYs,
            baseBottomY - blockLengthLocal / 2,
          ]

          return (
            <g key={`bp-${trapId}`}>
              {/* Blocks */}
              {bases.map((base, bi) => {
                const beamTop    = localToScreen({ x: base.localX, y: baseTopY    }, frame.center, angleRad)
                const beamBottom = localToScreen({ x: base.localX, y: baseBottomY }, frame.center, angleRad)
                const [btx, bty] = toSvg(beamTop.x, beamTop.y)
                const [bbx, bby] = toSvg(beamBottom.x, beamBottom.y)
                const lineAngle = Math.atan2(bby - bty, bbx - btx) * 180 / Math.PI
                return allBlockYCenters.map((blockCenterY, bki) => {
                  const sp = localToScreen({ x: base.localX, y: blockCenterY }, frame.center, angleRad)
                  const [bkx, bky] = toSvg(sp.x, sp.y)
                  return (
                    <rect key={`blk-${bi}-${bki}`}
                      x={bkx - blockLengthSvg / 2} y={bky - blockWidthSvg / 2}
                      width={blockLengthSvg} height={blockWidthSvg}
                      fill={BLOCK_FILL} stroke={BLOCK_STROKE} strokeWidth={0.5}
                      transform={`rotate(${lineAngle} ${bkx} ${bky})`}
                    />
                  )
                })
              })}


              {/* Base beams + IDs */}
              {bases.map((base, bi) => {
                const beamTop    = localToScreen({ x: base.localX, y: baseTopY    }, frame.center, angleRad)
                const beamBottom = localToScreen({ x: base.localX, y: baseBottomY }, frame.center, angleRad)
                const [btx, bty] = toSvg(beamTop.x, beamTop.y)
                const [bbx, bby] = toSvg(beamBottom.x, beamBottom.y)
                const lineAngle = Math.atan2(bby - bty, bbx - btx) * 180 / Math.PI
                const bx = (btx + bbx) / 2, by = (bty + bby) / 2
                return (
                  <g key={`base-${bi}`}>
                    <line x1={btx} y1={bty} x2={bbx} y2={bby} stroke={L_PROFILE_STROKE} strokeWidth={PROFILE_THICK} strokeLinecap="square" />
                    <g transform={`rotate(${lineAngle} ${bx} ${by})`}>
                      <text x={bx} y={by} textAnchor="middle" dominantBaseline="middle" fontSize={28} fontWeight="700" fill="white" style={{ userSelect: 'none' }}>{trapId}</text>
                    </g>
                  </g>
                )
              })}

              {/* Diagonals */}
              {bases.length >= 2 && (() => {
                const n = bases.length
                const heightAtY_mm = (localY) => {
                  if (!rc || frontLegY <= rearLegY) return 0
                  const t = Math.max(0, Math.min(1, (localY - rearLegY) / (frontLegY - rearLegY)))
                  return (rc.heightRear + t * (rc.heightFront - rc.heightRear)) * 10
                }
                const pairs = n === 2 ? [[0, 1]] : [[0, 1], [n - 1, n - 2]]
                return pairs.flatMap(([ai, bi], pi) => {
                  const ba = bases[ai], bb = bases[bi]
                  const horizMm = Math.abs(bb.localX - ba.localX) * pixelToCmRatio * 10
                  return [baseTopY, baseBottomY].map((edgeY, di) => {
                    const pa = localToScreen({ x: ba.localX, y: edgeY }, frame.center, angleRad)
                    const pb = localToScreen({ x: bb.localX, y: edgeY }, frame.center, angleRad)
                    const [x1, y1] = toSvg(pa.x, pa.y), [x2, y2] = toSvg(pb.x, pb.y)
                    const vertMm  = heightAtY_mm(edgeY)
                    const distMm  = Math.round(Math.sqrt(horizMm ** 2 + vertMm ** 2))
                    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
                    const ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI
                    const labelAngle = ang > 90 || ang < -90 ? ang + 180 : ang
                    const fs = 11, bgW = String(distMm).length * fs * 0.6 + 6, bgH = fs + 4, dotR = 7
                    return (
                      <g key={`diag-${pi}-${di}`}>
                        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={BLUE} strokeWidth={PROFILE_THICK} />
                        <circle cx={x1} cy={y1} r={dotR} fill={BLUE} stroke={TEXT_DARKEST} strokeWidth={1} />
                        <circle cx={x2} cy={y2} r={dotR} fill="white" stroke={BLUE} strokeWidth={2} />
                        <g transform={`rotate(${labelAngle} ${mx} ${my})`}>
                          <rect x={mx - bgW / 2} y={my - bgH / 2} width={bgW} height={bgH} fill="white" stroke={BORDER_MID} strokeWidth={0.5} rx={1} />
                          <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle" fontSize={fs} fontWeight="700" fill={BLACK}>{distMm}</text>
                        </g>
                      </g>
                    )
                  })
                })
              })()}
            </g>
          )
        })}

        {/* Per-area dimension annotations */}
        {Object.entries(areaTrapsMap).map(([areaKey, areaTrapIds]) => {
          const allBases = areaTrapIds.flatMap(tid => {
            const bp2 = basePlansMap[tid]
            const b2 = consolidatedBasesMap[tid] ?? bp2?.bases ?? []
            return b2.map(b => ({ ...b, trapId: tid }))
          })
          if (allBases.length < 2) return null

          const refBp = basePlansMap[areaTrapIds.find(tid => basePlansMap[tid])]
          if (!refBp) return null
          const { frame: refFrame } = refBp
          const { angleRad: refAngle, localBounds: refLB, center: refCenter } = refFrame

          const projected = allBases.map(b => ({
            ...b,
            localX: screenToLocal(b.screenTop, refCenter, refAngle).x,
          })).sort((a, b) => a.localX - b.localX)

          const perpX = -Math.sin(refAngle), perpY = Math.cos(refAngle)
          const [fcxSvg, fcySvg] = toSvg(refCenter.x, refCenter.y)
          const outSign = ((fcxSvg - svgCentX) * perpX + (fcySvg - svgCentY) * perpY) >= 0 ? 1 : -1
          const apX = outSign * perpX, apY = outSign * perpY

          let extremeLocalY = outSign >= 0 ? refLB.maxY : refLB.minY
          for (const tid of areaTrapIds) {
            const otherBp = basePlansMap[tid]
            if (!otherBp) continue
            const cyOffset = screenToLocal(otherBp.frame.center, refCenter, refAngle).y
            const yMin = cyOffset + otherBp.frame.localBounds.minY
            const yMax = cyOffset + otherBp.frame.localBounds.maxY
            extremeLocalY = outSign >= 0 ? Math.max(extremeLocalY, yMax) : Math.min(extremeLocalY, yMin)
          }

          const ANN_OFF = 16, EXT_GAP = 2
          const edgeSvg = (lx) => { const s = localToScreen({ x: lx, y: extremeLocalY }, refCenter, refAngle); return toSvg(s.x, s.y) }
          const annSvg  = (lx) => { const [ex, ey] = edgeSvg(lx); return [ex + apX * ANN_OFF, ey + apY * ANN_OFF] }

          const measurePts = projected.map(b => { const [ex, ey] = edgeSvg(b.localX); return [ex + apX * EXT_GAP, ey + apY * EXT_GAP] })
          const annPts    = projected.map(b => annSvg(b.localX))
          const labels    = projected.slice(0, -1).map((b1, si) => String(Math.round(Math.abs(projected[si + 1].localX - b1.localX) * pixelToCmRatio * 10)))

          return (
            <g key={`area-ann-${areaKey}`}>
              <DimensionAnnotation measurePts={measurePts} annPts={annPts} labels={labels} zoom={ZOOM} color={TEXT_SECONDARY} />
            </g>
          )
        })}
      </svg>
    </CadPage>
  )
}
