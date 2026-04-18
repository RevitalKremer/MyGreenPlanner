import { isHorizontalOrientation, isEmptyOrientation, PANEL_V } from './panelCodes.js'
import type { ComputedTrapezoid, Leg, Punch, Diagonal, PanelLineSegment } from '../types/projectData'

// Re-export for backward compatibility with existing imports
export { isHorizontalOrientation, isEmptyOrientation }

/** Slope depth (cm) for a single line orientation */
export const lineSlopeDepth = (o: string, panelLengthCm: number, panelWidthCm: number): number =>
  isHorizontalOrientation(o) ? panelWidthCm : panelLengthCm

// ─── Slope / back-height calculations ────────────────────────────────────────

/**
 * Total slope depth (cm) across all lines including inter-line gaps.
 */
export const computeTotalSlopeDepth = (orientations: string[], lineGapCm: number, panelLengthCm: number, panelWidthCm: number): number => {
  const orients = orientations || [PANEL_V]
  const slopeSum = orients.reduce((s, o) => s + lineSlopeDepth(o, panelLengthCm, panelWidthCm), 0)
  return slopeSum + Math.max(0, orients.length - 1) * lineGapCm
}

/**
 * Panel back-edge height from floor (cm).
 */
export const computePanelBackHeight = (panelFrontHeight: number, angle: number, orientations: string[], lineGapCm: number, panelLengthCm: number, panelWidthCm: number): number => {
  const angleRad = (angle || 0) * Math.PI / 180
  return panelFrontHeight + computeTotalSlopeDepth(orientations, lineGapCm, panelLengthCm, panelWidthCm) * Math.sin(angleRad)
}

// ─── Detail View geometry helpers ─────────────────────────────────────────────

/**
 * Build rail items from panel line segments and lineRails config.
 * Each item has { cx, segIdx, offsetCm, globalOffsetCm }.
 */
export function buildRailItems(
  segments: PanelLineSegment[],
  lineRails: Record<number | string, number[]> | null,
  atSlope: (dCm: number) => { x: number; y: number },
) {
  const items: { cx: number; segIdx: number; offsetCm: number; globalOffsetCm: number }[] = []
  let dCm = 0
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si]
    dCm += (seg.gapBeforeCm ?? 0)
    if (seg.isEmpty) { dCm += (seg.depthCm ?? 0); continue }
    const segRails = lineRails?.[si] ?? lineRails?.[String(si)] ?? []
    for (const offsetCm of segRails) {
      items.push({ cx: atSlope(dCm + offsetCm).x, segIdx: si, offsetCm, globalOffsetCm: dCm + offsetCm })
    }
    dCm += (seg.depthCm ?? 0)
  }
  return items
}

/**
 * Compute diagonal rendering data from BE diagonals + user overrides.
 * Pure data transform — no SVG.
 */
export function buildDetailDiagonals(
  beDetailData: ComputedTrapezoid | null,
  diagOverrides: Record<number, Partial<Diagonal> & { disabled?: boolean }>,
  allLegXs: number[],
  allLegEndXs: number[],
  allLegHeights: number[],
  baseY: number,
  BEAM_THICK_PX: number,
) {
  const beDiags = beDetailData?.diagonals ?? []
  const numSpans = allLegXs.length - 1
  const raw = beDiags.map(d => {
    if (d.spanIdx >= numSpans) return null
    const ov = diagOverrides[d.spanIdx] ?? {}
    const topPct = ov.topPct ?? d.topPct
    const botPct = ov.botPct ?? d.botPct
    const { xA, xB, spanW, topX, botX, topY, botY } = calculateDiagonalPosition({
      spanIdx: d.spanIdx, topPct, botPct,
      legXs: allLegXs, legEndXs: allLegEndXs, legHeights: allLegHeights,
      baseY, beamThickPx: BEAM_THICK_PX,
    })
    const _dx = botX - topX, _dy = botY - topY
    const _len = Math.sqrt(_dx * _dx + _dy * _dy)
    const ux = _len > 0 ? _dx / _len : 0, uy = _len > 0 ? _dy / _len : 0
    const halfCap = BEAM_THICK_PX * 0.75 / 2
    return {
      xA, xB, spanW, topX, botX, topY, botY, ux, uy, halfCap,
      lenCm: d.lengthCm, isDouble: d.isDouble, skip: ov.disabled ?? d.disabled,
      spanIndex: d.spanIdx,
    }
  }).filter(Boolean)
  return raw.filter(s => !s.skip)
}

/**
 * Build sorted punch points array for DetailPunchSketch.
 */
export function buildPunchPoints(
  punches: Punch[],
  beamType: Punch['beamType'],
  excludeOrigin: string,
  atFn: (pos: number) => number,
  labelFor: (p: Punch) => string,
) {
  const matches = (origin: (o: string) => boolean) => (p: Punch) =>
    p.beamType === beamType && p.origin !== excludeOrigin && origin(p.origin)
  const toPoint = (origin: string) => (p: Punch) => ({ x: atFn(p.positionCm), label: labelFor(p), origin })
  const nonDiag = punches.filter(matches(o => o !== 'diagonal')).map(p => toPoint(p.origin)(p))
  const diag    = punches.filter(matches(o => o === 'diagonal')).map(toPoint('diagonal'))
  return [...nonDiag, ...diag].sort((a, b) => a.x - b.x)
}

/**
 * Compute first/last active (non-empty) panel line depths.
 */
export function computeActiveDepths(segments: PanelLineSegment[]) {
  const totalPanelDepthCm = segments.reduce((s, seg) => s + (seg.gapBeforeCm ?? 0) + (seg.depthCm ?? 0), 0)
  let d = 0, firstActive = 0, foundFirst = false
  let lastEnd = totalPanelDepthCm
  for (const seg of segments) {
    d += seg.gapBeforeCm ?? 0
    if (!seg.isEmpty && !foundFirst) { firstActive = d; foundFirst = true }
    d += seg.depthCm ?? 0
    if (!seg.isEmpty) lastEnd = d
  }
  return { firstActiveDepth: firstActive, lastActiveDepth: lastEnd, totalPanelDepthCm }
}

/**
 * Derive all leg pixel data from BE legs.
 */
export function buildLegData(
  beLegs: Leg[],
  atTrap: (posCm: number) => { x: number; y: number },
  beamThickCm: number,
  SC: number,
  baseY: number,
) {
  const firstLegPos = beLegs[0]?.positionCm ?? 0
  const allLegXs = beLegs.map(leg => atTrap(leg.positionCm - firstLegPos).x)
  const allLegEndXs = beLegs.map(leg => atTrap((leg.positionEndCm ?? (leg.positionCm + beamThickCm)) - firstLegPos).x)
  const allLegHeights = beLegs.map(leg => leg.heightCm * SC)
  const allLegTopYs = allLegHeights.map(h => baseY - h)
  const legX0 = allLegXs[0] ?? 0
  const legX1 = allLegEndXs[allLegEndXs.length - 1] ?? 0
  const legBW = legX1 - legX0
  return { allLegXs, allLegEndXs, allLegHeights, allLegTopYs, legX0, legX1, legBW, firstLegPos }
}

// ─── Diagonal rendering helpers ───────────────────────────────────────────────

interface DiagonalPositionParams {
  spanIdx: number
  topPct: number
  botPct: number
  legXs: number[]
  legEndXs: number[]
  legHeights: number[]
  baseY: number
  beamThickPx: number
}

export const calculateDiagonalPosition = ({
  spanIdx, topPct, botPct, legXs, legEndXs, legHeights, baseY, beamThickPx,
}: DiagonalPositionParams) => {
  const xA = legXs[spanIdx]
  const xB = legEndXs[spanIdx + 1]
  const spanW = xB - xA
  const topX = xA + topPct * spanW
  const botX = xA + botPct * spanW
  const hA = legHeights[spanIdx] ?? 0
  const hB = legHeights[spanIdx + 1] ?? 0
  const topY = baseY - (hA + topPct * (hB - hA))
  const botY = baseY + beamThickPx / 2
  return { xA, xB, spanW, topX, botX, topY, botY }
}
