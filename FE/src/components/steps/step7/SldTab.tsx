import { useMemo, useEffect } from 'react'
import { useLang } from '../../../i18n/LangContext'
import CanvasNavigator from '../../shared/CanvasNavigator'
import { useCanvasPanZoom } from '../../../hooks/useCanvasPanZoom'
import {
  TEXT, TEXT_DARK, TEXT_SECONDARY, TEXT_MUTED,
  BG_SUBTLE, PANEL_LIGHT_BG, PANEL_DARK, DANGER, BLUE,
} from '../../../styles/colors'

// Single-line wiring diagram: AC panel → inverter (with lettered MPPT inputs)
// → DC breaker → string (panel stack), one drop per string. Data-driven from
// the same units/ports/strings as the other tabs.
export default function SldTab({ units, strings, panelWatt, printMode = false }: any) {
  const { t } = useLang()
  const {
    zoom, setZoom, panOffset, panActive, containerRef, contentRef,
    startPan, handleMouseMove, stopPan, resetView, centerView, zoomAtCenter,
    MM_W, MM_H, panToMinimapPoint, getMinimapViewportRect,
  } = useCanvasPanZoom()

  const model = useMemo(() => {
    let giBase = 0
    return (units || []).map((u: any, ui: number) => {
      const drops: any[] = []
      for (let m = 0; m < u.mpptCount; m++) {
        const gi = giBase + m
        ;(strings || []).filter((s: any) => s.mpptIndex === gi)
          .forEach((s: any) => drops.push({ portIdx: m, letter: String.fromCharCode(65 + m), s }))
      }
      giBase += u.mpptCount
      return { u, ui, drops }
    })
  }, [units, strings])

  const hasData = (units || []).length > 0 && (strings || []).length > 0
  // Fit the diagram to the viewport on entry (interactive mode only).
  useEffect(() => { if (hasData && !printMode) centerView() }, [centerView, hasData, printMode])

  if (!hasData) {
    return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: TEXT_MUTED, fontSize: '0.9rem' }}>{t('step7.dist.empty')}</div>
  }

  // ── Layout (px in viewBox units) ──
  const SLOT = 84, COL_GAP = 70, MARGIN = 50
  const acLabelY = 18, acBoxY = 40, acBoxH = 22
  const cat7Y = 86
  const invTopY = 118, boxH = 70, invBotY = invTopY + boxH
  const fanY = invBotY + 34            // horizontal DC fan level
  const brkY = invBotY + 70, brkH = 26 // DC breaker
  const strTopY = brkY + brkH + 34, strH = 78
  const totalH = strTopY + strH + 40

  // Column widths and inverter positions.
  let x = MARGIN
  const cols = model.map((inv: any) => {
    const n = Math.max(1, inv.drops.length)
    const colW = Math.max(inv.u.mpptCount * 40 + 30, n * SLOT)
    const boxW = Math.min(colW * 0.7, inv.u.mpptCount * 40 + 40)
    const colX = x
    const boxX = colX + (colW - boxW) / 2
    x += colW + COL_GAP
    return { ...inv, colX, colW, boxX, boxW, n }
  })
  const totalW = x - COL_GAP + MARGIN

  const termX = (c: any, m: number) => c.boxX + c.boxW * (m + 1) / (c.u.mpptCount + 1)
  const slotX = (c: any, d: number) => c.colX + c.colW * (d + 0.5) / c.n

  const svg = (
    <svg viewBox={`0 0 ${totalW} ${totalH}`} preserveAspectRatio="xMidYMid meet"
      width={printMode ? undefined : totalW} height={printMode ? undefined : totalH}
      style={{ display: 'block', fontFamily: 'sans-serif', ...(printMode ? { width: '100%', height: '100%' } : {}) }}>
        {/* EMS / Cat-7 link across inverter tops */}
        {cols.length > 1 && (() => {
          const x1 = cols[0].boxX + cols[0].boxW / 2
          const x2 = cols[cols.length - 1].boxX + cols[cols.length - 1].boxW / 2
          const mid = (x1 + x2) / 2
          return (
            <g>
              <line x1={x1} y1={cat7Y} x2={x2} y2={cat7Y} stroke={BLUE} strokeWidth={1.5} />
              <text x={mid} y={cat7Y - 16} textAnchor="middle" fontSize={10} fontWeight={700} fill={BLUE}>{t('step7.sld.ems')}</text>
              <text x={mid} y={cat7Y - 4} textAnchor="middle" fontSize={9} fill={TEXT_SECONDARY}>{t('step7.sld.cat7')}</text>
            </g>
          )
        })()}

        {cols.map((c: any) => {
          const cx = c.boxX + c.boxW / 2
          return (
            <g key={c.ui}>
              {/* AC panel + riser */}
              <text x={cx} y={acLabelY} textAnchor="middle" fontSize={10} fontWeight={700} fill={TEXT_DARK}>{t('step7.sld.acPanel')}</text>
              <rect x={cx - 26} y={acBoxY} width={52} height={acBoxH} fill={BG_SUBTLE} stroke={TEXT_DARK} strokeWidth={1} />
              <text x={cx} y={acBoxY + 15} textAnchor="middle" fontSize={9} fill={TEXT_SECONDARY}>AC</text>
              <line x1={cx} y1={acBoxY + acBoxH} x2={cx} y2={invTopY} stroke={TEXT_DARK} strokeWidth={1.5} />

              {/* inverter box */}
              <rect x={c.boxX} y={invTopY} width={c.boxW} height={boxH} fill="white" stroke={TEXT_DARK} strokeWidth={1.5} rx={3} />
              <line x1={c.boxX} y1={invBotY} x2={c.boxX + c.boxW} y2={invTopY} stroke={TEXT_DARK} strokeWidth={1} />
              <text x={c.boxX + 6} y={invTopY + 13} fontSize={9} fill={TEXT_MUTED}>AC</text>
              <text x={c.boxX + c.boxW - 6} y={invBotY - 6} textAnchor="end" fontSize={9} fill={TEXT_MUTED}>DC</text>
              <text x={cx} y={invTopY + boxH / 2 - 3} textAnchor="middle" fontSize={11} fontWeight={700} fill={TEXT}>{c.u.name}</text>
              <text x={cx} y={invTopY + boxH / 2 + 12} textAnchor="middle" fontSize={10} fill={TEXT_SECONDARY}>{c.u.kw != null ? `${c.u.kw} kW` : ''}</text>
              <rect x={c.boxX + c.boxW - 26} y={invBotY - 20} width={22} height={15} fill="white" stroke={TEXT_DARK} strokeWidth={0.8} />
              <text x={c.boxX + c.boxW - 15} y={invBotY - 9} textAnchor="middle" fontSize={9} fontWeight={700} fill={TEXT_DARK}>{`0${c.ui + 1}`}</text>

              {/* MPPT terminal letters */}
              {Array.from({ length: c.u.mpptCount }).map((_, m) => (
                <text key={m} x={termX(c, m)} y={invBotY + 11} textAnchor="middle" fontSize={9} fontWeight={700} fill={TEXT_DARK}>{String.fromCharCode(65 + m)}</text>
              ))}

              {/* Solar-cable label */}
              <text x={c.colX + 2} y={fanY - 4} fontSize={8} fill={TEXT_MUTED}>{t('step7.sld.solarCable')}</text>

              {/* DC drops: terminal → breaker → string */}
              {c.drops.map((d: any, di: number) => {
                const tx = termX(c, d.portIdx), sx = slotX(c, di)
                return (
                  <g key={di}>
                    {/* terminal → fan → breaker (red DC) */}
                    <polyline points={`${tx},${invBotY} ${tx},${fanY} ${sx},${fanY} ${sx},${brkY}`} fill="none" stroke={DANGER} strokeWidth={1.5} />
                    {/* breaker symbol */}
                    <rect x={sx - 16} y={brkY} width={32} height={brkH} fill="white" stroke={TEXT_DARK} strokeWidth={1} />
                    <line x1={sx - 12} y1={brkY + brkH - 4} x2={sx + 12} y2={brkY + 4} stroke={TEXT_DARK} strokeWidth={1} />
                    <text x={sx} y={brkY + brkH + 9} textAnchor="middle" fontSize={7.5} fill={TEXT_MUTED}>1000V 2P</text>
                    {/* breaker → string */}
                    <line x1={sx} y1={brkY + brkH} x2={sx} y2={strTopY} stroke={DANGER} strokeWidth={1.5} />
                    <text x={sx + 4} y={strTopY - 6} fontSize={8} fill={TEXT_MUTED}>{t('step7.sld.stringCable')}</text>
                    {/* string box (panel stack) */}
                    <rect x={sx - SLOT * 0.34} y={strTopY} width={SLOT * 0.68} height={strH} fill={PANEL_LIGHT_BG} stroke={PANEL_DARK} strokeWidth={1} rx={2} />
                    {[0.28, 0.5, 0.72].map((f, gi) => (
                      <line key={gi} x1={sx - SLOT * 0.34} y1={strTopY + strH * f} x2={sx + SLOT * 0.34} y2={strTopY + strH * f} stroke={PANEL_DARK} strokeWidth={0.5} />
                    ))}
                    <text x={sx} y={strTopY + strH / 2 + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill={TEXT_DARK}>{(d.s.panelIds || []).length}</text>
                    <text x={sx} y={strTopY + strH + 12} textAnchor="middle" fontSize={8} fill={TEXT_MUTED}>{`${d.s.id} · ${d.letter}`}</text>
                  </g>
                )
              })}
            </g>
          )
        })}
      </svg>
  )

  if (printMode) return <div style={{ width: '100%', height: '100%', background: 'white' }}>{svg}</div>

  return (
    <div ref={containerRef}
      style={{ height: '100%', position: 'relative', overflow: 'hidden', background: 'white', cursor: panActive ? 'grabbing' : 'grab' }}
      onMouseDown={startPan} onMouseMove={handleMouseMove} onMouseUp={stopPan} onMouseLeave={stopPan}>
      <div style={{ transform: `translate(${panOffset.x}px, ${panOffset.y}px)`, transformOrigin: 'top left' }}>
        <div ref={contentRef} style={{ display: 'inline-block', transform: `scale(${zoom})`, transformOrigin: 'top left', padding: '1rem' }}>
          {svg}
        </div>
      </div>
      <CanvasNavigator
        viewZoom={zoom}
        onZoomOut={() => { const nz = Math.max(0.3, zoom - 0.1); zoomAtCenter(zoom, nz); setZoom(nz) }}
        onZoomReset={resetView}
        onZoomIn={() => { const nz = Math.min(8, zoom + 0.1); zoomAtCenter(zoom, nz); setZoom(nz) }}
        mmWidth={MM_W} mmHeight={MM_H}
        onPanToPoint={panToMinimapPoint}
        viewportRect={getMinimapViewportRect()}
      />
    </div>
  )
}
