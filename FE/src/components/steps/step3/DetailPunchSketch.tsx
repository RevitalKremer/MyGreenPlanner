import { TEXT_SECONDARY, TEXT_PLACEHOLDER, BLUE, PUNCH_BAR_FILL, PUNCH_BAR_STROKE, DANGER, ADD_GREEN } from '../../../styles/colors'

/**
 * Renders a punch position bar (base beam or slope beam) with:
 * - Gray bar with punch circles + labels
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
}) {
  const barH = 12
  const barCy = ry + barH / 2
  const diagXKey = which === 'bot' ? 'botX' : 'topX'

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
      <rect x={barX0} y={ry} width={barW} height={barH}
        fill={PUNCH_BAR_FILL} stroke={PUNCH_BAR_STROKE} strokeWidth="1" rx="2"
        style={{ cursor: showDiagHandles ? 'crosshair' : 'default' }}
        onMouseMove={showDiagHandles ? (e) => handleBarMouseMove(e, which) : undefined}
        onMouseLeave={showDiagHandles ? () => setBarHover(null) : undefined}
        onClick={showDiagHandles ? (e) => handleBarClick(e, which) : undefined}
      />
      {punches.map((p, i) => (
        <g key={`wp-${i}`}>
          <circle cx={p.x} cy={barCy} r={2} fill="white" stroke={TEXT_SECONDARY} strokeWidth="1" />
          <text x={p.x} y={ry + barH + 10} textAnchor="middle" fontSize="11" fill={TEXT_SECONDARY} fontWeight="600">
            {p.label}
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
      <Dim ax1={activeBoundL} ay1={ry + barH + 22} ax2={activeBoundR} ay2={ry + barH + 22} label={fmt(beamLenCm)} off={10} />
    </g>
  )
}
