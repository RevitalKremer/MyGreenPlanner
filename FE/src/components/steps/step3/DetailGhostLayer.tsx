import { GHOST_STROKE, GHOST_DASH } from '../../../styles/colors'
import { calculateDiagonalPosition, computeTrapStructureGeometry } from '../../../utils/trapezoidGeometry'
import TrapStructure, { type PositionedDiagonal } from './TrapStructure'

/**
 * Ghost overlay: renders the full trap behind a trimmed trap, using the same
 * TrapStructure component as DetailView so the two paths cannot diverge.
 *
 * The only ghost-specific concern is the atTrapX anchor — offset by originDelta
 * so the full trap's coordinates align with the trimmed trap's frame.
 */
export default function DetailGhostLayer({
  fullTrapGhost, originCm, legX0, baseY,
  BEAM_THICK_PX, PANEL_OFFSET_PX, PANEL_THICK_PX, SC, blockLengthCm, blockH,
}) {
  const gGeom = fullTrapGhost.beDetailData.geometry
  const gAngleRad = gGeom.angle * Math.PI / 180
  const gOriginCm = gGeom.originCm ?? 0
  const originDelta = (gOriginCm - originCm) * Math.cos(gAngleRad) * SC
  const cosA = Math.cos(gAngleRad)

  const gLegs = fullTrapGhost.beDetailData.legs ?? []
  const gBlocks = fullTrapGhost.beDetailData.blocks ?? []
  const gPanelLines = fullTrapGhost.panelLines ?? []

  const geometry = computeTrapStructureGeometry({
    beLegs: gLegs,
    baseBeamLengthCm: gGeom.baseBeamLength ?? 0,
    atTrapX: (posCm) => legX0 + originDelta + posCm * cosA * SC,
    baseY, beamThickPx: BEAM_THICK_PX, SC,
  })
  const atSlopeX = (dCm: number) => legX0 + originDelta + (dCm - gOriginCm) * cosA * SC

  const diagonals: PositionedDiagonal[] = (fullTrapGhost.beDetailData.diagonals ?? [])
    .filter(d => !d.disabled)
    .filter(d => d.spanIdx < gLegs.length - 1)
    .map(d => {
      const { topX, topY, botX, botY } = calculateDiagonalPosition({
        spanIdx: d.spanIdx,
        topDistFromLegCm: d.topDistFromLegCm,
        botDistFromLegCm: d.botDistFromLegCm,
        punchSpanCm: d.punchSpanCm,
        legXs: geometry.legXs,
        legEndXs: geometry.legEndXs,
        legHeights: geometry.legHeights,
        baseY, beamThickPx: BEAM_THICK_PX,
      })
      return { topX, topY, botX, botY, halfCap: BEAM_THICK_PX * 0.75 / 2 }
    })

  const groundY = baseY + BEAM_THICK_PX + blockH

  return (
    <g pointerEvents="none">
      <TrapStructure
        variant="ghost"
        geometry={geometry}
        beLegs={gLegs}
        blocks={gBlocks}
        diagonals={diagonals}
        panelLines={gPanelLines}
        atSlopeX={atSlopeX}
        baseY={baseY}
        beamThickPx={BEAM_THICK_PX}
        blockH={blockH}
        blockLengthCm={blockLengthCm}
        panelOffsetPx={PANEL_OFFSET_PX}
        panelThickPx={PANEL_THICK_PX}
        SC={SC}
      />
      {/* Ghost ground line (plain dashed; main uses DetailCorrugatedRoof) */}
      <line x1={geometry.legX0 - 20} y1={groundY} x2={geometry.legX1 + 20} y2={groundY}
        stroke={GHOST_STROKE} strokeWidth="1.5" strokeDasharray={GHOST_DASH} />
    </g>
  )
}
