import { GHOST_FILL, GHOST_STROKE, GHOST_DASH } from '../../../styles/colors'
import { calculateDiagonalPosition } from '../../../utils/trapezoidGeometry'

/**
 * Ghost overlay: renders the full trap structural outline in ghost style
 * (dashed, semi-transparent) behind the trimmed trap.
 */
export default function DetailGhostLayer({
  fullTrapGhost, originCm, legX0, legX1, baseY, beamThickCm,
  BEAM_THICK_PX, PANEL_OFFSET_PX, PANEL_THICK_PX, SC, blockLengthCm, blockH,
}) {
  const gGeom = fullTrapGhost.beDetailData.geometry
  const gAngleRad = gGeom.angle * Math.PI / 180
  const gBaseY = baseY
  const gBlockTopY = gBaseY + BEAM_THICK_PX

  const GR = ({ key, ...props }) => <rect key={key} {...props} fill={GHOST_FILL} stroke={GHOST_STROKE} strokeWidth="1" strokeDasharray={GHOST_DASH} />
  const GL = ({ key, x1: lx1, y1: ly1, x2: lx2, y2: ly2, sw }) => {
    const dx = lx2 - lx1, dy = ly2 - ly1
    const len = Math.sqrt(dx * dx + dy * dy)
    const mx = (lx1 + lx2) / 2, my = (ly1 + ly2) / 2
    const ang = Math.atan2(dy, dx) * 180 / Math.PI
    return GR({ key, x: -len / 2, y: -(sw || 1) / 2, width: len, height: sw || 1, transform: `translate(${mx},${my}) rotate(${ang})` })
  }

  const gDiags = (fullTrapGhost.beDetailData.diagonals ?? []).filter(d => !d.disabled)
  const gLegs = fullTrapGhost.beDetailData.legs ?? []
  const gOriginCm = gGeom.originCm ?? 0
  const gFirstLegPos = gLegs[0]?.positionCm ?? 0
  const originDelta = (gOriginCm - originCm) * Math.cos(gAngleRad) * SC
  const gLegHeights = gLegs.map(leg => leg.heightCm * SC)
  const gLegXPositions = gLegs.map(leg => legX0 + originDelta + (leg.positionCm - gFirstLegPos) * Math.cos(gAngleRad) * SC)
  const gLegEndXPositions = gLegs.map(leg => legX0 + originDelta + ((leg.positionEndCm ?? (leg.positionCm + beamThickCm)) - gFirstLegPos) * Math.cos(gAngleRad) * SC)
  const gActualX0 = gLegXPositions[0] ?? legX0
  const gActualX1 = gLegEndXPositions[gLegEndXPositions.length - 1] ?? legX1

  const gLegCenterXs = gLegs.map((_: unknown, li: number) => (gLegXPositions[li] + gLegEndXPositions[li]) / 2)
  const _gH0 = gLegHeights[0] ?? 0
  const _gHN = gLegHeights[gLegHeights.length - 1] ?? _gH0
  // Full base beam (including front/rear extensions) — matches DetailView.tsx base beam math.
  const gBaseBeamLen = gGeom.baseBeamLength ?? 0
  const gBaseBeamX0 = gActualX0 - gFirstLegPos * SC
  const gBaseBeamW = gBaseBeamLen * SC

  // Anchor at leg CENTER x's (heights are leg-center heights) so the rendered slope
  // matches geom.angle exactly and inner-leg labels match leg.heightCm.
  const _gXC0 = gLegCenterXs[0] ?? gActualX0
  const _gXCN = gLegCenterXs[gLegCenterXs.length - 1] ?? gActualX1
  const _gXSpan = _gXCN - _gXC0
  const gBeamY = (x: number) => {
    if (_gXSpan <= 0) return gBaseY + 3 * BEAM_THICK_PX / 2 - _gH0
    return gBaseY + 3 * BEAM_THICK_PX / 2 - (_gH0 + (x - _gXC0) / _gXSpan * (_gHN - _gH0))
  }
  const gAtSlope = (dCm) => {
    const x = legX0 + originDelta + (dCm - gOriginCm) * Math.cos(gAngleRad) * SC
    return { x, y: gBeamY(x) }
  }

  return (
    <g pointerEvents="none">
      {/* Ghost base beam — full length including front/rear extensions */}
      {GR({ key: 'g-base', x: gBaseBeamX0, y: gBaseY, width: gBaseBeamW, height: BEAM_THICK_PX })}
      {/* Ghost slope beam — endpoints evaluated via leg-center interpolation */}
      {GL({ key: 'g-slope', x1: gActualX0, y1: gBeamY(gActualX0), x2: gActualX1, y2: gBeamY(gActualX1), sw: BEAM_THICK_PX })}
      {/* Ghost legs — skip virtual legs (matches DetailView) */}
      {gLegs.map((leg, li) => {
        if (leg.virtual) return null
        const lx = gLegXPositions[li], lxEnd = gLegEndXPositions[li]
        const lw = lxEnd - lx
        const slopeTopY = gBeamY(gLegCenterXs[li]) - BEAM_THICK_PX / 2
        return GR({ key: `gl${li}`, x: lx, y: slopeTopY, width: lw, height: gBaseY + BEAM_THICK_PX - slopeTopY })
      })}
      {/* Ghost diagonals */}
      {gDiags.map((d, di) => {
        if (d.spanIdx >= gLegs.length - 1) return null
        const { topX, topY, botX, botY } = calculateDiagonalPosition({
          spanIdx: d.spanIdx,
          topDistFromLegCm: d.topDistFromLegCm,
          botDistFromLegCm: d.botDistFromLegCm,
          punchSpanCm: d.punchSpanCm,
          legXs: gLegXPositions,
          legEndXs: gLegEndXPositions,
          legHeights: gLegHeights,
          baseY: gBaseY,
          beamThickPx: BEAM_THICK_PX,
        })
        return GL({ key: `gd${di}`, x1: topX, y1: topY, x2: botX, y2: botY, sw: BEAM_THICK_PX * 0.75 })
      })}
      {/* Ghost blocks — physical scaling (1 cm = SC px), matches DetailView */}
      {(() => {
        const gAtBase = (posCm: number) => gBaseBeamX0 + posCm * SC
        const gbw = blockLengthCm * SC
        return (fullTrapGhost.beDetailData.blocks ?? []).map((blk, bi) =>
          GR({ key: `gb${bi}`, x: gAtBase(blk.positionCm), y: gBlockTopY, width: gbw, height: blockH })
        )
      })()}
      {/* Ghost panels */}
      {(() => {
        const gBeamYLocal = gBeamY
        const gBeamDeg = _gXSpan > 0 ? Math.atan2(_gHN - _gH0, _gXSpan) * -180 / Math.PI : 0
        let dCm = 0
        return (fullTrapGhost.panelLines ?? []).map((seg, si) => {
          dCm += (seg.gapBeforeCm ?? 0)
          const sx = gAtSlope(dCm).x
          const ex = gAtSlope(dCm + (seg.depthCm ?? 0)).x
          dCm += (seg.depthCm ?? 0)
          const sy = gBeamYLocal(sx), ey = gBeamYLocal(ex)
          const gBeamRad = gBeamDeg * Math.PI / 180
          const cx = (sx + ex) / 2 + PANEL_OFFSET_PX * Math.sin(gBeamRad)
          const cy = (sy + ey) / 2 - PANEL_OFFSET_PX * Math.cos(gBeamRad)
          const dx = ex - sx, dy = ey - sy
          const len = Math.sqrt(dx * dx + dy * dy)
          return GR({ key: `gp${si}`, x: -len / 2, y: -PANEL_THICK_PX / 2, width: len, height: PANEL_THICK_PX, transform: `translate(${cx},${cy}) rotate(${gBeamDeg})` })
        })
      })()}
      {/* Ghost ground line */}
      <line x1={gActualX0 - 20} y1={gBlockTopY + blockH} x2={gActualX1 + 20} y2={gBlockTopY + blockH} stroke={GHOST_STROKE} strokeWidth="1.5" strokeDasharray={GHOST_DASH} />
    </g>
  )
}
