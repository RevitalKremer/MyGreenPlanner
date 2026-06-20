import { TEXT_SECONDARY, TEXT_PLACEHOLDER, BLUE, PUNCH_BAR_FILL, PUNCH_BAR_STROKE, DANGER, ADD_GREEN, BEAM_CONNECTOR_STROKE } from '../../../styles/colors'

/**
 * Renders a punch position bar (base beam or slope beam) with:
 * - Gray bar with punch circles + labels
 * - Thick black cut line + per-piece length dimensions when the beam is spliced
 * - Diagonal handle circles (edit mode)
 * - Ghost "+" follower (add diagonal)
 * - Dimension annotation below
 */
export default function DetailPunchSketch({
  which,           // 'bot' (base beam) or 'top' (slope beam)
  ry,              // Y position of the bar
  barX0, barW,     // Bar start X and width in SVG
  beamLenCm,       // Beam length for dimension label
  punches,         // [{ x, label, origin }] — pre-mapped to SVG coords
  activeDiags,     // Diagonal data with topX/botX
  showDiagHandles, printMode,
  barHover, setBarHover, hoverHandle, setHoverHandle,
  handleBarMouseMove, handleBarClick, startHandleDrag,
  findSpan, activeSpanSet,
  activeBoundL, activeBoundR,
  fmt, Dim, t,
  labelKey,        // i18n key for the bar title
  segments,        // optional [{ x0, x1, lengthCm }] — spliced pieces; >1 ⇒ draw broken bar
}) {
  const barH = 12
  const barCy = ry + barH / 2
  const diagXKey = which === 'bot' ? 'botX' : 'topX'
  const isSplit = Array.isArray(segments) && segments.length > 1

  const barHandlers = showDiagHandles ? {
    style: { cursor: 'crosshair' as const },
    onMouseMove: (e: any) => handleBarMouseMove(e, which),
    onMouseLeave: () => setBarHover(null),
    onClick: (e: any) => handleBarClick(e, which),
  } : { style: { cursor: 'default' as const } }

  // Label de-overlap: punch dots stay fixed; when labels would overlap, the
  // labels (not the dots) are shifted apart. Spreading runs PER SEGMENT (each
  // side of a cut is bounded independently) so a label is never pushed across
  // the cut into its neighbour — that was making tight pairs re-collide.
  const jointXs: number[] = isSplit ? segments.slice(0, -1).map((s: any) => s.x1) : []
  const CHAR_W = 6, GAP = 3, ROW_H = 12
  const halfW = (s: string) => ((s?.length ?? 0) * CHAR_W) / 2
  // Vertical staggering: every label stays centered under its dot and keeps its
  // exact value (accuracy matters — no rounding); if it would overlap one already
  // placed, it drops to the next row. Guarantees no overlap at any density
  // (horizontal spreading can't, once a cluster is too tight).
  const level: number[] = new Array(punches.length).fill(0)
  const rowEnds: number[] = []
  punches
    .map((p, i) => ({ i, x: p.x }))
    .sort((a, b) => a.x - b.x)
    .forEach(({ i }) => {
      const x = punches[i].x, hw = halfW(punches[i].label)
      let lv = 0
      while (lv < rowEnds.length && x - hw < rowEnds[lv] + GAP) lv++
      level[i] = lv
      rowEnds[lv] = x + hw
    })
  const maxLevel = level.length ? Math.max(...level) : 0
  const dimY = ry + barH + 22 + maxLevel * ROW_H

  const ghostX = (() => {
    if (!showDiagHandles || barHover?.which !== which) return null
    const span = findSpan(barHover.svgX)
    if (!span || activeSpanSet.has(span.spanIndex)) return null
    if (activeDiags.some(d => Math.abs(d[diagXKey] - barHover.svgX) < 8)) return null
    return barHover.svgX
  })()

  return (
    <g>
      <text x={activeBoundL} y={ry - 5} fontSize="11" fill={TEXT_PLACEHOLDER} fontWeight="600">{t(labelKey)}</text>
      {/* Bar — single continuous bar; a spliced beam adds a thick black cut line */}
      <rect x={barX0} y={ry} width={barW} height={barH}
        fill={PUNCH_BAR_FILL} stroke={PUNCH_BAR_STROKE} strokeWidth="1" rx="2" {...barHandlers} />
      {/* Cut line(s) — thick red mark where the beam is spliced (matches the connector) */}
      {jointXs.map((jx, i) => (
        <line key={`cut-${i}`} x1={jx} y1={ry - 3} x2={jx} y2={ry + barH + 3}
          stroke={BEAM_CONNECTOR_STROKE} strokeWidth="2.5" style={{ pointerEvents: 'none' }} />
      ))}
      {punches.map((p, i) => {
        const ly = ry + barH + 10 + level[i] * ROW_H
        return (
          <g key={`wp-${i}`}>
            <circle cx={p.x} cy={barCy} r={2} fill="white" stroke={TEXT_SECONDARY} strokeWidth="1" />
            {/* leader from the bar down to a label dropped to a lower row */}
            {level[i] > 0 && (
              <line x1={p.x} y1={ry + barH} x2={p.x} y2={ly - 9} stroke={TEXT_SECONDARY} strokeWidth="0.4" opacity="0.5" style={{ pointerEvents: 'none' }} />
            )}
            <text x={p.x} y={ly} textAnchor="middle" fontSize="11" fill={TEXT_SECONDARY} fontWeight="600">
              {p.label}
            </text>
          </g>
        )
      })}
      {showDiagHandles && !printMode && activeDiags.map((d, di) => {
        const dx = d[diagXKey]
        const isHov = hoverHandle?.which === which && hoverHandle?.spanIndex === d.spanIndex
        return (
          <g key={`dh-${di}`}>
            <circle cx={dx} cy={barCy} r={5.5}
              fill={isHov ? DANGER : BLUE} stroke="white" strokeWidth="1.5"
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHoverHandle({ which, spanIndex: d.spanIndex })}
              onMouseLeave={() => setHoverHandle(null)}
              onMouseDown={(e) => startHandleDrag(e, which, d)}
            />
            {isHov && <text x={dx} y={barCy} textAnchor="middle" dominantBaseline="middle" fontSize="8" fontWeight="900" fill="white" style={{ pointerEvents: 'none' }}>✕</text>}
          </g>
        )
      })}
      {ghostX !== null && (
        <g opacity="0.5" style={{ pointerEvents: 'none' }}>
          <line x1={ghostX} y1={ry} x2={ghostX} y2={ry + barH} stroke={ADD_GREEN} strokeWidth="1.5" strokeDasharray="3,2" />
          <text x={ghostX + 5} y={barCy + 1} dominantBaseline="middle" fontSize="9" fontWeight="800" fill={ADD_GREEN}>+</text>
        </g>
      )}
      {isSplit
        ? segments.map((seg, i) => (
            <Dim key={`dim-${i}`} ax1={seg.x0} ay1={dimY} ax2={seg.x1} ay2={dimY}
              label={fmt(seg.lengthCm)} off={10} />
          ))
        : <Dim ax1={activeBoundL} ay1={dimY} ax2={activeBoundR} ay2={dimY} label={fmt(beamLenCm)} off={10} />}
    </g>
  )
}
