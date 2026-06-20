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
  const CHAR_W = 5, GAP = 2, PAD = 2
  const halfW = (s: string) => ((s?.length ?? 0) * CHAR_W) / 2
  const labelX = punches.map(p => p.x)
  // Bounds (lo, hi) of the region a punch's label may occupy: the bar edges,
  // narrowed by any cut line on either side.
  const boundsFor = (x: number): [number, number] => {
    let lo = barX0, hi = barX0 + barW
    for (const jx of jointXs) {
      if (jx <= x && jx + PAD > lo) lo = jx + PAD
      if (jx >= x && jx - PAD < hi) hi = jx - PAD
    }
    return [lo, hi]
  }
  // Group label indices by segment.
  const groups = new Map<number, number[]>()
  punches.forEach((p, i) => {
    const seg = jointXs.reduce((n, jx) => n + (p.x > jx ? 1 : 0), 0)
    if (!groups.has(seg)) groups.set(seg, [])
    groups.get(seg)!.push(i)
  })
  // Base beam, when crowded: drop decimals (e.g. 369.5 → 370) to shrink labels
  // so they fit. Left precise when there's room ("not when spread evenly").
  const required = (idxs: number[], lbl: (i: number) => string) =>
    idxs.reduce((s, i) => s + 2 * halfW(lbl(i)), 0) + GAP * Math.max(0, idxs.length - 1)
  const crowded = which === 'bot' && [...groups.values()].some(idxs => {
    const [lo, hi] = boundsFor(punches[idxs[0]].x)
    return required(idxs, i => punches[i].label) > hi - lo
  })
  const labelText = (i: number) => {
    if (!crowded) return punches[i].label
    const n = parseFloat(punches[i].label)
    return Number.isFinite(n) ? String(Math.round(n)) : punches[i].label
  }
  // Spread within each segment's bounds (dots fixed, labels shifted).
  groups.forEach(idxs => {
    if (!idxs.length) return
    const [lo, hi] = boundsFor(punches[idxs[0]].x)
    for (let k = 1; k < idxs.length; k++) {                  // L→R: remove overlaps
      const i = idxs[k], pv = idxs[k - 1]
      const minC = labelX[pv] + halfW(labelText(pv)) + GAP + halfW(labelText(i))
      if (labelX[i] < minC) labelX[i] = minC
    }
    for (let k = idxs.length - 2; k >= 0; k--) {             // R→L: pull back where there's room
      const i = idxs[k], nx = idxs[k + 1]
      const maxC = labelX[nx] - halfW(labelText(nx)) - GAP - halfW(labelText(i))
      if (labelX[i] > maxC) labelX[i] = maxC
    }
    const first = idxs[0], last = idxs[idxs.length - 1]
    if (labelX[first] - halfW(labelText(first)) < lo) labelX[first] = lo + halfW(labelText(first))
    if (labelX[last] + halfW(labelText(last)) > hi) labelX[last] = hi - halfW(labelText(last))
    for (let k = 1; k < idxs.length; k++) {
      const i = idxs[k], pv = idxs[k - 1]
      const minC = labelX[pv] + halfW(labelText(pv)) + GAP + halfW(labelText(i))
      if (labelX[i] < minC) labelX[i] = minC
    }
  })

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
      {punches.map((p, i) => (
        <g key={`wp-${i}`}>
          <circle cx={p.x} cy={barCy} r={2} fill="white" stroke={TEXT_SECONDARY} strokeWidth="1" />
          {/* connector line from dot to label when the label was shifted off its dot */}
          {Math.abs(labelX[i] - p.x) > 1 && (
            <line x1={p.x} y1={barCy} x2={labelX[i]} y2={ry + barH + 3} stroke={TEXT_SECONDARY} strokeWidth="0.4" opacity="0.5" style={{ pointerEvents: 'none' }} />
          )}
          <text x={labelX[i]} y={ry + barH + 10} textAnchor="middle" fontSize="11" fill={TEXT_SECONDARY} fontWeight="600">
            {labelText(i)}
          </text>
        </g>
      ))}
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
            <Dim key={`dim-${i}`} ax1={seg.x0} ay1={ry + barH + 22} ax2={seg.x1} ay2={ry + barH + 22}
              label={fmt(seg.lengthCm)} off={10} />
          ))
        : <Dim ax1={activeBoundL} ay1={ry + barH + 22} ax2={activeBoundR} ay2={ry + barH + 22} label={fmt(beamLenCm)} off={10} />}
    </g>
  )
}
