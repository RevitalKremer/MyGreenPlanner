import { PRIMARY, PRIMARY_DARK, PRIMARY_BG_ALT, TEXT_SECONDARY, TEXT_VERY_LIGHT, TEXT_PLACEHOLDER, BORDER_LIGHT, BORDER, BORDER_MID, BG_SUBTLE, BG_FAINT, BG_MID, BLUE, BLUE_BG, BLUE_BORDER, WARNING, WARNING_DARK, WARNING_LIGHT, WARNING_BG } from '../../../styles/colors'
import {
  computeTotalSlopeDepth,
  isHorizontalOrientation, isEmptyOrientation,
} from '../../../utils/trapezoidGeometry'

export default function TrapezoidConfigEditor({
  selectedRow, selectedTrapezoidId, selectedAreaLabel,
  refinedArea, trapezoidConfigs,
  getAreaKey,
  resetTrapezoidConfig,
  selectedAreaTrapIds, reassignToTrapezoid,
  panelFrontHeight, panelAngle,
  rectAreas, setRectAreas,
  panelGapCm,
  panelSpec,
}) {
  if (!selectedRow) return null

  const globalCfg = refinedArea?.panelConfig || {}
  const override = trapezoidConfigs?.[selectedTrapezoidId] || {}
  const isOverridden = !!(selectedTrapezoidId && trapezoidConfigs?.[selectedTrapezoidId])
  const defaultAngle = parseFloat(panelAngle) || globalCfg.angle || 0
  const defaultFrontHeight = parseFloat(panelFrontHeight) || globalCfg.frontHeight || 0

  const areaKey = getAreaKey(selectedRow[0])
  const area = areaKey !== null ? (rectAreas?.[areaKey] ?? null) : null
  const angleRaw = area?.angle ?? ''
  const frontHeightRaw = area?.frontHeight ?? ''

  const angle = angleRaw !== '' ? parseFloat(angleRaw) || 0 : defaultAngle
  const frontHeight = frontHeightRaw !== '' ? parseFloat(frontHeightRaw) || 0 : defaultFrontHeight
  const backHeight = override.backHeight ?? globalCfg.backHeight ?? 0

  // ── Derive lines from actual panel layout ────────────────────────────────
  const rowMap = new Map()
  selectedRow.forEach(p => {
    const r = p.row ?? 0
    if (!rowMap.has(r)) rowMap.set(r, p)
  })
  const derivedRows = [...rowMap.entries()].sort(([a], [b]) => Number(a) - Number(b))
  const derivedOrients = derivedRows.map(([, p]) => p.heightCm > 150 ? 'vertical' : 'horizontal')

  // For auto-split trapezoids, use stored lineOrientations which include empty-* ghost rows.
  // Fall back to derived from actual panels for manual/legacy trapezoids.
  const storedOrients = trapezoidConfigs?.[selectedTrapezoidId]?.lineOrientations
  const effectiveLineOrientations = (storedOrients?.length > 0) ? storedOrients : derivedOrients

  const totalSlope = computeTotalSlopeDepth(effectiveLineOrientations, panelGapCm, panelSpec.lengthCm, panelSpec.widthCm)

  // Cross-section SVG geometry
  const W = 130, H = 62, groundY = H - 8, fX = 15
  const lineDepths = effectiveLineOrientations
    .map(o => isHorizontalOrientation(o) ? panelSpec.widthCm : panelSpec.lengthCm)
  const angleRad = angle * Math.PI / 180
  const totalHoriz = totalSlope * Math.cos(angleRad)
  const scaleW = totalHoriz > 0 ? (W - 30) / totalHoriz : 1
  const scaleH = backHeight > 0 ? (H - 18) / backHeight : 1
  const sc = Math.min(scaleW, scaleH)
  const segs = []
  let sx = fX, sy = groundY - frontHeight * sc
  for (let li = 0; li < lineDepths.length; li++) {
    const d = lineDepths[li]
    const gap = li < lineDepths.length - 1 ? panelGapCm : 0
    const sdx = d * Math.cos(angleRad) * sc
    const sdy = d * Math.sin(angleRad) * sc
    const gdx = gap * Math.cos(angleRad) * sc
    const gdy = gap * Math.sin(angleRad) * sc
    const liO = effectiveLineOrientations[li]
    segs.push({ x1: sx, y1: sy, x2: sx + sdx, y2: sy - sdy, isH: isHorizontalOrientation(liO), isEmp: isEmptyOrientation(liO) })
    sx = sx + sdx + gdx
    sy = sy - sdy - gdy
  }
  const finalX = sx

  return (
    <div style={{
      marginBottom: '0.85rem', padding: '0.6rem',
      background: isOverridden ? '#F8FAE8' : BG_FAINT,
      borderRadius: '8px',
      border: `1px solid ${isOverridden ? PRIMARY : BG_MID}`,
    }}>

      {/* Row 1: trapezoid selector */}
      <div style={{ marginBottom: '0.35rem' }}>
        <div style={{ fontSize: '0.6rem', color: TEXT_VERY_LIGHT, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '3px' }}>Trapezoid</div>
        <select
          value={selectedTrapezoidId || ''}
          onChange={e => reassignToTrapezoid?.(e.target.value)}
          style={{ width: '100%', padding: '3px 6px', fontSize: '0.78rem', fontWeight: '700', color: PRIMARY_DARK, background: PRIMARY_BG_ALT, border: `1px solid ${PRIMARY}`, borderRadius: '6px', cursor: 'pointer' }}
        >
          {(selectedAreaTrapIds?.length > 0 ? selectedAreaTrapIds : [selectedTrapezoidId]).filter(Boolean).map(tid => (
            <option key={tid} value={tid}>{tid}</option>
          ))}
        </select>
      </div>

      {/* Row 2: actions */}
      <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.5rem' }}>
        {isOverridden && (
          <button
            onClick={() => {
              resetTrapezoidConfig()
              if (setRectAreas && areaKey !== null && areaKey !== undefined) {
                const resetAngle = String(parseFloat(panelAngle) || defaultAngle || 0)
                const resetFH = String(parseFloat(panelFrontHeight) || defaultFrontHeight || 0)
                setRectAreas(prev => prev.map((a, i) => i === areaKey ? { ...a, angle: resetAngle, frontHeight: resetFH } : a))
              }
            }}
            style={{ flex: 1, padding: '0.28rem 0.4rem', fontSize: '0.68rem', fontWeight: '600', background: 'white', color: TEXT_PLACEHOLDER, border: `1px solid ${BORDER}`, borderRadius: '5px', cursor: 'pointer' }}
          >
            ↺ Reset to Defaults
          </button>
        )}
      </div>

      {/* Cross-section preview */}
      <svg width={W} height={H} style={{ display: 'block', margin: '0 auto 0.4rem' }}>
        <line x1="0" y1={groundY} x2={W} y2={groundY} stroke={BORDER} strokeWidth="1"/>
        <line x1={fX} y1={groundY} x2={fX} y2={groundY - frontHeight * sc} stroke={TEXT_VERY_LIGHT} strokeWidth="1.5"/>
        <line x1={finalX} y1={groundY} x2={finalX} y2={groundY - backHeight * sc} stroke={TEXT_VERY_LIGHT} strokeWidth="1.5"/>
        {segs.map((seg, i) => (
          <line key={i} x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2}
            stroke={seg.isEmp ? BORDER_MID : seg.isH ? WARNING : BLUE}
            strokeWidth="2.5" strokeLinecap="round"
            strokeDasharray={seg.isEmp ? '4 3' : undefined}
          />
        ))}
        <text x={fX - 2} y={(groundY + groundY - frontHeight * sc) / 2} textAnchor="end" fill={TEXT_PLACEHOLDER} fontSize="8">{frontHeight.toFixed(0)}</text>
        <text x={finalX + 3} y={(groundY + groundY - backHeight * sc) / 2} fill={TEXT_PLACEHOLDER} fontSize="8">{backHeight.toFixed(1)}</text>
        <text x={(fX + finalX) / 2} y={H - 1} textAnchor="middle" fill={TEXT_SECONDARY} fontSize="7.5" fontWeight="700">{angle.toFixed(1)}°</text>
        {area && (() => {
          const isDown = (area.yDir ?? 'ttb') === 'ttb'
          const leftLabel = isDown ? 'N' : 'S'
          const rightLabel = isDown ? 'S' : 'N'
          return (
            <>
              <text x={3} y={H - 1} textAnchor="start" fontSize="6.5" fontWeight="800" fill={leftLabel === 'N' ? BLUE : TEXT_VERY_LIGHT}>{leftLabel}</text>
              <text x={W - 3} y={H - 1} textAnchor="end" fontSize="6.5" fontWeight="800" fill={rightLabel === 'N' ? BLUE : TEXT_VERY_LIGHT}>{rightLabel}</text>
            </>
          )
        })()}
      </svg>

      {/* Angle + Front Height inputs */}
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.5rem' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.6rem', color: TEXT_VERY_LIGHT, marginBottom: '2px' }}>Angle (°)</div>
          <input
            type="number" min="0" max="30" step="0.5"
            value={angleRaw !== '' ? angleRaw : defaultAngle}
            onChange={e => setRectAreas?.(prev => prev.map((a, i) => i === areaKey ? { ...a, angle: e.target.value } : a))}
            style={{ width: '100%', padding: '0.28rem 0.4rem', boxSizing: 'border-box', border: `1px solid ${BORDER}`, borderRadius: '5px', fontSize: '0.82rem', fontWeight: '600' }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.6rem', color: TEXT_VERY_LIGHT, marginBottom: '2px' }}>Front H (cm)</div>
          <input
            type="number" min="0" step="0.5"
            value={frontHeightRaw !== '' ? frontHeightRaw : defaultFrontHeight}
            onChange={e => setRectAreas?.(prev => prev.map((a, i) => i === areaKey ? { ...a, frontHeight: e.target.value } : a))}
            style={{ width: '100%', padding: '0.28rem 0.4rem', boxSizing: 'border-box', border: `1px solid ${BORDER}`, borderRadius: '5px', fontSize: '0.82rem', fontWeight: '600' }}
          />
        </div>
      </div>

      {/* Lines — shape display (includes ghost slots for auto-split trapezoids) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.35rem', padding: '0.3rem 0.4rem', background: BG_SUBTLE, borderRadius: '5px', border: `1px solid ${BORDER_LIGHT}` }}>
        <div style={{ display: 'flex', gap: '0.2rem', flex: 1 }}>
          {effectiveLineOrientations.map((o, idx) => {
            const isEmpty = isEmptyOrientation(o)
            return (
              <span key={idx} style={{
                fontSize: '0.65rem', fontWeight: '700', padding: '1px 6px', borderRadius: '4px',
                background: isEmpty ? BG_MID : isHorizontalOrientation(o) ? WARNING_BG : BLUE_BG,
                color: isEmpty ? TEXT_VERY_LIGHT : isHorizontalOrientation(o) ? WARNING_DARK : BLUE,
                border: `1px solid ${isEmpty ? BORDER_MID : isHorizontalOrientation(o) ? WARNING_LIGHT : BLUE_BORDER}`,
              }}>
                {isHorizontalOrientation(o) ? '▬' : '|'}
              </span>
            )
          })}
        </div>
        <span style={{ fontSize: '0.62rem', color: TEXT_PLACEHOLDER, whiteSpace: 'nowrap' }}>{effectiveLineOrientations.length}×</span>
      </div>

    </div>
  )
}
