import { GHOST_FILL, GHOST_STROKE, GHOST_DASH } from '../../../styles/colors'

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
  const gLegBW = gActualX1 - gActualX0

  const gBeamY = (x) => {
    if (gLegBW <= 0) return gBaseY - (gLegHeights[0] ?? 0)
    const frac = (x - gActualX0) / gLegBW
    const h0 = gLegHeights[0] ?? 0, h1 = gLegHeights[gLegHeights.length - 1] ?? 0
    return gBaseY - (h0 + frac * (h1 - h0))
  }
  const gAtSlope = (dCm) => {
    const x = legX0 + originDelta + (dCm - gOriginCm) * Math.cos(gAngleRad) * SC
    return { x, y: gBeamY(x) }
  }

  return (
    <g pointerEvents="none">
      {/* Ghost base beam */}
      {GR({ key: 'g-base', x: gActualX0, y: gBaseY, width: gActualX1 - gActualX0, height: BEAM_THICK_PX })}
      {/* Ghost slope beam */}
      {GL({ key: 'g-slope', x1: gActualX0, y1: gBaseY - gLegHeights[0], x2: gActualX1, y2: gBaseY - gLegHeights[gLegHeights.length - 1], sw: BEAM_THICK_PX })}
      {/* Ghost legs */}
      {gLegs.map((_, li) => {
        const lx = gLegXPositions[li], lxEnd = gLegEndXPositions[li]
        const lw = lxEnd - lx
        const lh = gLegHeights[li] ?? 0
        return GR({ key: `gl${li}`, x: lx, y: gBaseY - lh, width: lw, height: lh + BEAM_THICK_PX })
      })}
      {/* Ghost diagonals */}
      {gDiags.map((d, di) => {
        if (d.spanIdx >= gLegs.length - 1) return null
        const xA = gLegEndXPositions[d.spanIdx], xB = gLegXPositions[d.spanIdx + 1]
        const spanW = xB - xA
        const topX = xA + d.topPct * spanW
        const botX = xA + d.botPct * spanW
        const hA = gLegHeights[d.spanIdx] ?? 0, hB = gLegHeights[d.spanIdx + 1] ?? 0
        const topY = gBaseY - (hA + d.topPct * (hB - hA))
        return GL({ key: `gd${di}`, x1: topX, y1: topY, x2: botX, y2: gBaseY + BEAM_THICK_PX / 2, sw: BEAM_THICK_PX * 0.75 })
      })}
      {/* Ghost blocks */}
      {(() => {
        const gBaseBeamLen = gGeom.baseBeamLength || 1
        const gBW = gActualX1 - gActualX0
        const gAtBase = (posCm) => gActualX0 + (posCm / gBaseBeamLen) * gBW
        const gbw = (blockLengthCm / gBaseBeamLen) * gBW
        return (fullTrapGhost.beDetailData.blocks ?? []).map((blk, bi) =>
          GR({ key: `gb${bi}`, x: gAtBase(blk.positionCm), y: gBlockTopY, width: gbw, height: blockH })
        )
      })()}
      {/* Ghost panels */}
      {(() => {
        const gBW = gActualX1 - gActualX0
        const gTopY0 = gBaseY - gLegHeights[0], gTopYN = gBaseY - gLegHeights[gLegHeights.length - 1]
        const gBeamYLocal = (x) => gBW > 0 ? gTopY0 + (x - gActualX0) / gBW * (gTopYN - gTopY0) : gTopY0
        const gBeamDeg = gBW > 0 ? Math.atan2(gTopYN - gTopY0, gBW) * 180 / Math.PI : 0
        let dCm = 0
        return (fullTrapGhost.panelLines ?? []).map((seg, si) => {
          dCm += (seg.gapBeforeCm ?? 0)
          const sx = gAtSlope(dCm).x
          const ex = gAtSlope(dCm + (seg.depthCm ?? 0)).x
          dCm += (seg.depthCm ?? 0)
          const sy = gBeamYLocal(sx), ey = gBeamYLocal(ex)
          const cx = (sx + ex) / 2
          const cy = (sy + ey) / 2 - PANEL_OFFSET_PX
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
