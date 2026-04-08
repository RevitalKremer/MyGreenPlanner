import { GROUND_LINE } from '../../../styles/colors'

/**
 * Renders the roof surface line — corrugated trapezoidal pattern for
 * iskurit/insulated_panel perpendicular, or a flat green line for other types.
 */
export default function DetailCorrugatedRoof({
  roofType, installationOrientation, purlinDistCm,
  panelX1, panelX2, blockBotY, baseY,
  BEAM_THICK_PX, SC, legX0, firstLegPos, geom, legBW,
}) {
  const isPurlinPerp = (roofType === 'iskurit' || roofType === 'insulated_panel') && installationOrientation === 'perpendicular'

  if (!isPurlinPerp || !purlinDistCm || purlinDistCm <= 0) {
    return <line x1={panelX1 - 35} y1={blockBotY} x2={panelX2 + 45} y2={blockBotY}
      stroke={GROUND_LINE} strokeWidth="2.5" strokeLinecap="round" />
  }

  const waveH = BEAM_THICK_PX * 1.5
  const dropW = 3 * SC
  const flatBotW = 33 * SC - 2 * dropW
  const flatTopW = 3 * SC
  const bbX0 = legX0 - firstLegPos * SC
  const bbW = (geom.baseBeamLength ?? (legBW / SC)) * SC
  const x1w = bbX0 - 20
  const x2w = bbX0 + bbW + 20
  const yTop = baseY + BEAM_THICK_PX
  const yBot = yTop + waveH

  let d = `M ${x1w} ${yTop}`
  let x = x1w
  while (x < x2w) {
    const ft = Math.min(Math.max(flatTopW, 0), x2w - x)
    d += ` L ${x + ft} ${yTop}`
    x += ft
    if (x >= x2w) break
    d += ` L ${Math.min(x + dropW, x2w)} ${yBot}`
    x += dropW
    if (x >= x2w) break
    const fb = Math.min(flatBotW, x2w - x)
    d += ` L ${x + fb} ${yBot}`
    x += fb
    if (x >= x2w) break
    d += ` L ${Math.min(x + dropW, x2w)} ${yTop}`
    x += dropW
  }

  return <path d={d} fill="none" stroke={GROUND_LINE} strokeWidth="2" strokeLinecap="round" />
}
