import {
  GHOST_FILL, GHOST_STROKE, GHOST_DASH,
  TRAP_L_PROFILE_FILL, TRAP_L_PROFILE_STROKE,
  TRAP_BLOCK_FILL, TRAP_BLOCK_STROKE,
  PANEL_BAR_FILL, PANEL_BAR_STROKE,
  BEAM_CONNECTOR_FILL, BEAM_CONNECTOR_STROKE,
} from '../../../styles/colors'
import type { TrapStructureGeometry } from '../../../utils/trapezoidGeometry'
import type { Leg, Block, PanelLineSegment, BeamSegment } from '../../../types/projectData'

// Physical length of the angle splice connector (angle_connector_10cm).
const CONNECTOR_LEN_CM = 10
// Small visual gap (px) between adjacent spliced pieces, so the butt joint reads.
const SEGMENT_GAP_PX = 1

/**
 * Shared structural primitives for the side-view trapezoid: base beam, slope
 * beam, legs, blocks, panels, diagonals.
 *
 * Used by both DetailView (variant='main') and DetailGhostLayer (variant='ghost').
 * The variant only affects colors/dash — every position, transform and skip
 * rule lives in one place here, so a change cannot silently diverge between
 * the trimmed-trap render and the full-trap ghost render.
 *
 * Variant-specific *decorations* (DoubleProfileMarker, highlight pulses,
 * dimensions, drag handles, cross-rails, punch circles, ground line) are
 * NOT in this component — DetailView layers them on top of these primitives
 * using the same geometry helpers it passes in here.
 */
export interface PositionedDiagonal {
  topX: number
  topY: number
  botX: number
  botY: number
  halfCap: number
}

interface VariantStyle {
  fill: string
  stroke: string
  dash?: string
  blockFill: string
  blockStroke: string
  panelFill: string
  panelStroke: string
}

const MAIN_STYLE: VariantStyle = {
  fill: TRAP_L_PROFILE_FILL,
  stroke: TRAP_L_PROFILE_STROKE,
  blockFill: TRAP_BLOCK_FILL,
  blockStroke: TRAP_BLOCK_STROKE,
  panelFill: PANEL_BAR_FILL,
  panelStroke: PANEL_BAR_STROKE,
}
const GHOST_STYLE: VariantStyle = {
  fill: GHOST_FILL,
  stroke: GHOST_STROKE,
  dash: GHOST_DASH,
  blockFill: GHOST_FILL,
  blockStroke: GHOST_STROKE,
  panelFill: GHOST_FILL,
  panelStroke: GHOST_STROKE,
}

interface TrapStructureProps {
  variant: 'main' | 'ghost'
  geometry: TrapStructureGeometry
  beLegs: Leg[]
  blocks: Block[]
  diagonals: PositionedDiagonal[]
  panelLines: PanelLineSegment[]
  atSlopeX: (dCm: number) => number
  baseY: number
  beamThickPx: number
  blockH: number
  blockLengthCm: number
  panelOffsetPx: number
  panelThickPx: number
  SC: number
  // Spliced-beam pieces (from BE geometry). When >1 piece, the beam is drawn
  // as separate pieces with a splice connector marker over each joint. Absent
  // or single ⇒ the beam is drawn as one piece (existing behavior).
  baseBeamSegments?: BeamSegment[]
  topBeamSegments?: BeamSegment[]
  baseBeamLengthCm?: number
  topBeamLengthCm?: number
}

export default function TrapStructure({
  variant, geometry, beLegs, blocks, diagonals, panelLines, atSlopeX,
  baseY, beamThickPx, blockH, blockLengthCm,
  panelOffsetPx, panelThickPx, SC,
  baseBeamSegments, topBeamSegments, baseBeamLengthCm, topBeamLengthCm,
}: TrapStructureProps) {
  const s = variant === 'ghost' ? GHOST_STYLE : MAIN_STYLE
  const dashAttr = s.dash ? { strokeDasharray: s.dash } : {}
  const isGhost = variant === 'ghost'

  const {
    legXs, legEndXs, legCenterXs,
    beamYAt, beamAngleDeg,
    legX0, legX1, baseBeamX0, baseBeamW,
  } = geometry

  // Thick line as a rotated rect so fill + stroke work for the semi-transparent ghost.
  const thickLine = (
    key: string, x1: number, y1: number, x2: number, y2: number, sw: number,
    capExtend = 0, fill = s.fill, stroke = s.stroke,
  ) => {
    const dx = x2 - x1, dy = y2 - y1
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < 0.5) return null
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
    const ang = Math.atan2(dy, dx) * 180 / Math.PI
    return (
      <rect key={key} x={-(len / 2 + capExtend)} y={-sw / 2} width={len + 2 * capExtend} height={sw}
        fill={fill} stroke={stroke} strokeWidth="1" {...dashAttr}
        transform={`translate(${mx},${my}) rotate(${ang})`} />
    )
  }

  const blockTopY = baseY + beamThickPx
  const beamRad = beamAngleDeg * Math.PI / 180

  return (
    <g {...(isGhost ? { pointerEvents: 'none' as const } : {})}>
      {/* Base beam — one rect, or one rect per spliced piece + connector marker(s) */}
      {(() => {
        const segs = baseBeamSegments
        if (!segs || segs.length <= 1 || !baseBeamLengthCm) {
          return (
            <rect x={baseBeamX0} y={baseY} width={baseBeamW} height={beamThickPx}
              fill={s.fill} stroke={s.stroke} strokeWidth="1" {...dashAttr} />
          )
        }
        const baseX = (cm: number) => baseBeamX0 + cm * SC
        const cw = CONNECTOR_LEN_CM * SC
        return (
          <>
            {segs.map((seg, i) => {
              const left  = i > 0 ? SEGMENT_GAP_PX : 0
              const right = i < segs.length - 1 ? SEGMENT_GAP_PX : 0
              const x = baseX(seg.startCm) + left
              const w = (seg.endCm - seg.startCm) * SC - left - right
              return (
                <rect key={`base-seg-${i}`} x={x} y={baseY} width={Math.max(0, w)} height={beamThickPx}
                  fill={s.fill} stroke={s.stroke} strokeWidth="1" {...dashAttr} />
              )
            })}
            {!isGhost && segs.map((seg, i) => (
              seg.jointAtFrontCm == null ? null : (
                <rect key={`base-conn-${i}`} x={baseX(seg.jointAtFrontCm) - cw / 2} y={baseY - 1}
                  width={cw} height={beamThickPx + 2} rx={1}
                  fill={BEAM_CONNECTOR_FILL} stroke={BEAM_CONNECTOR_STROKE} strokeWidth="1" />
              )
            ))}
          </>
        )
      })()}

      {/* Slope beam — one line, or one line per spliced piece + connector marker(s) */}
      {(() => {
        const segs = topBeamSegments
        if (!segs || segs.length <= 1 || !topBeamLengthCm) {
          return thickLine('slope', legX0, beamYAt(legX0), legX1, beamYAt(legX1), beamThickPx)
        }
        const slopeX = (cm: number) => legX0 + (cm / topBeamLengthCm) * (legX1 - legX0)
        const cw = CONNECTOR_LEN_CM * SC
        return (
          <>
            {segs.map((seg, i) => {
              const x1 = slopeX(seg.startCm), x2 = slopeX(seg.endCm)
              return thickLine(`slope-seg-${i}`, x1, beamYAt(x1), x2, beamYAt(x2), beamThickPx)
            })}
            {!isGhost && segs.map((seg, i) => {
              if (seg.jointAtFrontCm == null) return null
              const jx = slopeX(seg.jointAtFrontCm), jy = beamYAt(jx)
              return (
                <rect key={`slope-conn-${i}`} x={-cw / 2} y={-(beamThickPx + 2) / 2}
                  width={cw} height={beamThickPx + 2} rx={1}
                  fill={BEAM_CONNECTOR_FILL} stroke={BEAM_CONNECTOR_STROKE} strokeWidth="1"
                  transform={`translate(${jx},${jy}) rotate(${beamAngleDeg})`} />
              )
            })}
          </>
        )
      })()}

      {/* Legs — skip virtual */}
      {beLegs.map((leg, li) => {
        if (leg.virtual) return null
        const lx = legXs[li], lxEnd = legEndXs[li]
        const lw = lxEnd - lx
        const slopeTopY = beamYAt(legCenterXs[li]) - beamThickPx / 2
        const legH = (baseY + beamThickPx) - slopeTopY
        if (legH <= 0) return null
        return (
          <rect key={`leg-${li}`} x={lx} y={slopeTopY} width={lw} height={legH}
            fill={s.fill} stroke={s.stroke} strokeWidth="1" {...dashAttr} />
        )
      })}

      {/* Diagonals — pre-positioned by caller; halfCap extends the rect past the punch points */}
      {diagonals.map((d, di) =>
        thickLine(`diag-${di}`, d.topX, d.topY, d.botX, d.botY, beamThickPx * 0.75, d.halfCap)
      )}

      {/* Blocks — physical scaling (1 cm = SC px) */}
      {(() => {
        const bw = blockLengthCm * SC
        return blocks.map((blk, bi) => (
          <rect key={`blk-${bi}`} x={baseBeamX0 + blk.positionCm * SC} y={blockTopY}
            width={bw} height={blockH}
            fill={s.blockFill} stroke={s.blockStroke} strokeWidth="1" {...dashAttr} />
        ))
      })()}

      {/* Panels — rotated rects perpendicular-offset above the slope beam */}
      {(() => {
        let dCm = 0
        return panelLines.map((seg, si) => {
          dCm += (seg.gapBeforeCm ?? 0)
          const sx = atSlopeX(dCm)
          const ex = atSlopeX(dCm + (seg.depthCm ?? 0))
          dCm += (seg.depthCm ?? 0)
          if (seg.isEmpty) return null
          const sy = beamYAt(sx), ey = beamYAt(ex)
          const cx = (sx + ex) / 2 + panelOffsetPx * Math.sin(beamRad)
          const cy = (sy + ey) / 2 - panelOffsetPx * Math.cos(beamRad)
          const dx = ex - sx, dy = ey - sy
          const len = Math.sqrt(dx * dx + dy * dy)
          return (
            <rect key={`pnl-${si}`}
              x={-len / 2} y={-panelThickPx / 2} width={len} height={panelThickPx}
              fill={s.panelFill} stroke={s.panelStroke} strokeWidth="1" {...dashAttr}
              transform={`translate(${cx},${cy}) rotate(${beamAngleDeg})`} />
          )
        })
      })()}
    </g>
  )
}
