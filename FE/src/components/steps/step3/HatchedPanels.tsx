import { PANEL_LIGHT_BG, PANEL_LIGHT_BG_ALT, PANEL_DARK, PANEL_MID } from '../../../styles/colors'

/**
 * Renders all panels as hatched rectangles into an SVG.
 * clipIdPrefix must be unique per usage site to avoid SVG clipPath ID collisions.
 */
export default function HatchedPanels({ panels, selectedTrapId, selectedArea = null, toSvg, sc, pixelToCmRatio, clipIdPrefix = 'cp' }) {
  return panels.map(panel => {
    const [sx, sy] = toSvg(panel.x, panel.y)
    const sw = panel.width * sc, sh = panel.height * sc
    const scx = sx + sw / 2, scy = sy + sh / 2
    const isSelected = selectedArea != null
      ? (panel.areaGroupKey ?? panel.area) === selectedArea
      : selectedTrapId === null || panel.trapezoidId === selectedTrapId
    const opacity = isSelected ? 1 : 0.25
    const fill = isSelected ? PANEL_LIGHT_BG_ALT : PANEL_LIGHT_BG
    const borderColor = isSelected ? PANEL_DARK : PANEL_MID
    const ibw = Math.max(1, sw * 0.015)

    const hatchLines = []
    const step = 8, inset = 2
    for (let k = 0; k * step < sw + sh; k++) {
      hatchLines.push(
        <line key={k}
          x1={Math.min(k * step, sw)} y1={Math.max(0, k * step - sw)}
          x2={Math.max(0, k * step - sh)} y2={Math.min(k * step, sh)}
          stroke="white" strokeWidth="0.5" opacity="0.7" />
      )
    }

    return (
      <g key={panel.id} opacity={opacity} transform={`rotate(${panel.rotation || 0} ${scx} ${scy})`}>
        <rect x={sx} y={sy} width={sw} height={sh} fill={fill} stroke="none" />
        <rect x={sx + ibw / 2} y={sy + ibw / 2} width={sw - ibw} height={sh - ibw}
          fill="none" stroke={borderColor} strokeWidth={ibw} style={{ pointerEvents: 'none' }} />
        <g transform={`translate(${sx}, ${sy})`}>
          <clipPath id={`${clipIdPrefix}-${panel.id}`}>
            <rect x={inset} y={inset} width={sw - inset * 2} height={sh - inset * 2} />
          </clipPath>
          <g clipPath={`url(#${clipIdPrefix}-${panel.id})`}>{hatchLines}</g>
        </g>
      </g>
    )
  })
}
