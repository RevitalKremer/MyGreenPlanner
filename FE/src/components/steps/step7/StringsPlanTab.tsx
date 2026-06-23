import { useState, useEffect, useMemo, useRef } from 'react'
import { useLang } from '../../../i18n/LangContext'
import { generateStrings, validateStrings } from '../../../services/projectsApi'
import RowActions from '../../shared/RowActions'
import CanvasNavigator from '../../shared/CanvasNavigator'
import LayersPanel from '../step3/LayersPanel'
import { useCanvasPanZoom } from '../../../hooks/useCanvasPanZoom'
import {
  PRIMARY_BG, PRIMARY_DARK,
  TEXT, TEXT_DARK, TEXT_SECONDARY, TEXT_MUTED,
  BORDER, BORDER_FAINT, BG_FAINT, BG_LIGHT, BG_SUBTLE,
  SUCCESS_BG, SUCCESS_DARK,
  ERROR_DARK, ERROR_BG, WARNING_DARK, WARNING_BG,
  STRING_PALETTE, PANEL_LIGHT_BG, PANEL_DARK,
} from '../../../styles/colors'

export const stringColor = (i: number) => STRING_PALETTE[i % STRING_PALETTE.length]

const SIDES = ['auto', 'left', 'right', 'top', 'bottom'] as const

// The MPPT ports sit on the box edge facing the panels.
function autoSide(bx: number, by: number, px: number, py: number) {
  const dx = px - bx, dy = py - by
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right'
  return dy < 0 ? 'top' : 'bottom'
}

// Coordinate of MPPT port m (of count) on a given side of box b.
function portPoint(b: any, side: string, m: number, count: number) {
  const f = (m + 1) / (count + 1)
  if (side === 'left') return { x: b.x, y: b.y + b.h * f }
  if (side === 'right') return { x: b.x + b.w, y: b.y + b.h * f }
  if (side === 'top') return { x: b.x + b.w * f, y: b.y }
  return { x: b.x + b.w * f, y: b.y + b.h }   // bottom
}

// Collapsible left-bar section with a clickable header + chevron.
function Section({ title, open, onToggle, children }: any) {
  return (
    <div style={{ marginTop: '1.1rem', borderTop: `1px solid ${BORDER_FAINT}`, paddingTop: '0.7rem' }}>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}>
        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</span>
        <span style={{ fontSize: '0.7rem', color: TEXT_MUTED }}>{open ? '▾' : '▸'}</span>
      </div>
      {open && <div style={{ marginTop: '0.65rem' }}>{children}</div>}
    </div>
  )
}

// Read-only SVG: placed panels colored by their string group on the left, an
// inverter rack on the right, and connector lines from each string to the MPPT
// input it feeds.
// Pure, self-contained SVG of the strings plan. Exported so the Step 9 PDF can
// embed it directly (printMode → no interactivity, no selection highlight).
export function StringCanvas({ panels, strings, selectedId, units, ports, showMpptLines, showStringColors, layout, onMoveUnit, onPanelClick, onInverterClick, printMode = false }: any) {
  const real = (panels || []).filter((p: any) => !p.isEmpty)
  const selIdx = (printMode || !selectedId) ? -1 : (strings || []).findIndex((s: any) => s?.id === selectedId)
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState<number | null>(null)

  // panel id → owning string index, for highlight coloring.
  const panelStr = useMemo(() => {
    const m: Record<string, number> = {}
    ;(strings || []).forEach((s: any, i: number) => (s.panelIds || []).forEach((pid: any) => { m[pid] = i }))
    return m
  }, [strings])

  const geo = useMemo(() => {
    if (!real.length) return null
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of real) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x + p.width); maxY = Math.max(maxY, p.y + p.height)
    }
    const w = maxX - minX, h = maxY - minY
    const pad = w * 0.03 || 10
    const pcx = (minX + maxX) / 2, pcy = (minY + maxY) / 2

    // Inverter boxes: default stacked to the right of the panels, but each unit
    // can be repositioned (layout[i].x/y) and its MPPT side overridden
    // (layout[i].side; 'auto' faces the panels from the box's current spot).
    const boxW = Math.max(w * 0.26, 120)
    const boxH = Math.max(boxW * 0.6, h * 0.13)
    const gap = h * 0.06
    const defX = maxX + w * 0.12
    const unitBoxes = units.map((u: any, i: number) => {
      const lay = (layout && layout[i]) || {}
      const x = typeof lay.x === 'number' ? lay.x : defX
      const y = typeof lay.y === 'number' ? lay.y : minY + i * (boxH + gap)
      const pref = lay.side || 'auto'
      const side = pref === 'auto' ? autoSide(x + boxW / 2, y + boxH / 2, pcx, pcy) : pref
      return { ...u, x, y, w: boxW, h: boxH, side, idx: i }
    })

    // Port coordinates, flat-indexed like `ports`, placed on each box's side.
    const portPts: { x: number; y: number }[] = []
    unitBoxes.forEach((b: any) => {
      for (let m = 0; m < b.mpptCount; m++) portPts.push(portPoint(b, b.side, m, b.mpptCount))
    })

    // viewBox spans the panels plus every inverter box.
    let vMinX = minX, vMinY = minY, vMaxX = maxX, vMaxY = maxY
    unitBoxes.forEach((b: any) => {
      vMinX = Math.min(vMinX, b.x); vMinY = Math.min(vMinY, b.y)
      vMaxX = Math.max(vMaxX, b.x + b.w); vMaxY = Math.max(vMaxY, b.y + b.h)
    })
    const vbX = vMinX - pad, vbY = vMinY - pad
    const vbW = (vMaxX - vMinX) + 2 * pad, vbH = (vMaxY - vMinY) + 2 * pad
    return { minX, minY, w, h, pad, unitBoxes, portPts, vb: `${vbX} ${vbY} ${vbW} ${vbH}` }
  }, [real, units, ports, layout])

  // Convert a client point to SVG user (viewBox) coordinates — accounts for the
  // pan/zoom CSS transforms via getScreenCTM, so drag tracks the cursor exactly.
  const clientToUser = (cx: number, cy: number) => {
    const svg = svgRef.current
    if (!svg) return null
    const pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy
    const m = svg.getScreenCTM(); if (!m) return null
    const u = pt.matrixTransform(m.inverse())
    return { x: u.x, y: u.y }
  }

  const startUnitDrag = (e: any, box: any) => {
    if (!onMoveUnit) return
    e.stopPropagation(); e.preventDefault()
    const u0 = clientToUser(e.clientX, e.clientY); if (!u0) return
    const offX = u0.x - box.x, offY = u0.y - box.y
    const move = (ev: MouseEvent) => {
      const u = clientToUser(ev.clientX, ev.clientY)
      if (u) onMoveUnit(box.idx, { x: u.x - offX, y: u.y - offY })
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setDragging(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    setDragging(box.idx)
  }

  // Per-string series route: the ordered panel centers a string connects in
  // series (panelIds already come back in series order). This is the snaking
  // "string line" drawn through the array. `end` feeds the inverter connector.
  const routes = useMemo(() => {
    const byId: Record<string, any> = {}
    for (const p of real) byId[p.id] = p
    return (strings || []).map((s: any) => {
      const pts = (s.panelIds || []).map((pid: any) => byId[pid]).filter(Boolean)
        .map((p: any) => ({ x: p.x + p.width / 2, y: p.y + p.height / 2 }))
      if (!pts.length) return null
      return { pts, start: pts[0], end: pts[pts.length - 1] }
    })
  }, [real, strings])

  if (!geo) return <div style={{ color: TEXT_MUTED, padding: '2rem', textAlign: 'center' }}>—</div>
  const lineW = Math.max(1.2, geo.w * 0.0035)
  const titleFs = Math.min(geo.h * 0.03, (geo.unitBoxes[0]?.h || geo.h) * 0.2)
  const portFs = titleFs * 0.7
  const portR = Math.max(2, titleFs * 0.28)
  const labelFs = Math.max(titleFs * 0.6, geo.w * 0.012)

  // Connector: string series-end → its MPPT port, routed with right-angle
  // (horizontal/vertical) segments — the final leg approaches the port
  // perpendicular to the box side it sits on.
  const renderConn = (i: number) => {
    const r = routes[i]
    if (!r) return null
    const gi = strings[i]?.mpptIndex
    const port = geo.portPts[gi]
    if (!port) return null
    const side = geo.unitBoxes[ports[gi]?.unitIdx]?.side
    // Leave the last panel heading toward the inverter, then turn — so the
    // run reads as last-panel → port (subway style), not cutting through the array.
    const pts = (side === 'left' || side === 'right')
      ? (() => { const mx = (r.end.x + port.x) / 2; return `${r.end.x},${r.end.y} ${mx},${r.end.y} ${mx},${port.y} ${port.x},${port.y}` })()   // H V H
      : (() => { const my = (r.end.y + port.y) / 2; return `${r.end.x},${r.end.y} ${r.end.x},${my} ${port.x},${my} ${port.x},${port.y}` })()   // V H V
    const isSel = i === selIdx
    return (
      <polyline key={`c${i}`} points={pts} fill="none"
        stroke={isSel ? stringColor(i) : PANEL_DARK} strokeWidth={isSel ? lineW * 1.6 : lineW * 0.7}
        strokeOpacity={isSel ? 0.85 : (selIdx >= 0 ? 0.2 : 0.45)} strokeDasharray={`${lineW * 3} ${lineW * 2}`} />
    )
  }

  // Series routing line through a string's panels. Thin/blue normally; the
  // selected string is thick and uses its palette color.
  const renderRoute = (i: number) => {
    const r = routes[i]
    if (!r) return null
    const isSel = i === selIdx
    const col = isSel ? stringColor(i) : PANEL_DARK
    const op = isSel ? 1 : (selIdx >= 0 ? 0.3 : 0.7)
    return (
      <g key={`r${i}`}>
        <polyline points={r.pts.map((p: any) => `${p.x},${p.y}`).join(' ')}
          fill="none" stroke={col} strokeWidth={isSel ? lineW * 2.8 : lineW * 0.9} strokeOpacity={op}
          strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={r.start.x} cy={r.start.y} r={isSel ? lineW * 3 : lineW * 2} fill={col} fillOpacity={op} stroke="white" strokeWidth={lineW * 0.6} />
        {(isSel || selIdx < 0) && (
          <text x={r.start.x} y={r.start.y - lineW * 3.5} textAnchor="middle" fontSize={labelFs}
            fontWeight={700} fill={isSel ? stringColor(i) : TEXT_DARK}>{strings[i]?.id}</text>
        )}
      </g>
    )
  }

  // Concrete pixel size (the pan/zoom hook measures the rendered content).
  const [, , vbW, vbH] = geo.vb.split(' ').map(Number)
  const BASE_W = 1000
  const svgW = BASE_W
  const svgH = Math.round(BASE_W / (vbW / vbH))

  return (
    <svg ref={svgRef} width={svgW} height={svgH} viewBox={geo.vb} style={{ display: 'block' }}>
      {/* panels — blue by default. The "strings colors" layer fills every
          assigned panel with its string color; the selected string always
          takes its color (and pops above dimmed siblings). */}
      {real.map((p: any) => {
        const cx = p.x + p.width / 2, cy = p.y + p.height / 2
        const si = panelStr[p.id]
        const assigned = si != null && si >= 0
        const hi = selIdx >= 0 && si === selIdx
        const colored = hi || (showStringColors && assigned)
        const op = hi ? 0.65 : (colored ? (selIdx >= 0 ? 0.4 : 0.6) : 0.85)
        return (
          <g key={p.id} transform={`rotate(${p.rotation || 0} ${cx} ${cy})`}
            onClick={() => !printMode && assigned && onPanelClick?.(p.id)} style={{ cursor: !printMode && assigned ? 'pointer' : 'default' }}>
            <rect x={p.x} y={p.y} width={p.width} height={p.height}
              fill={colored ? stringColor(si) : PANEL_LIGHT_BG} fillOpacity={op}
              stroke={PANEL_DARK} strokeWidth={Math.max(0.5, p.width * 0.012)} />
          </g>
        )
      })}

      {/* connectors + routing lines — selected drawn last so it sits on top */}
      {showMpptLines && routes.map((_: any, i: number) => (i === selIdx ? null : renderConn(i)))}
      {routes.map((_: any, i: number) => (i === selIdx ? null : renderRoute(i)))}
      {showMpptLines && selIdx >= 0 && renderConn(selIdx)}
      {selIdx >= 0 && renderRoute(selIdx)}

      {/* inverter rack — draggable boxes; ports on the side facing the panels */}
      {geo.unitBoxes.map((b: any, ui: number) => (
        <g key={`u${ui}`} onMouseDown={printMode ? undefined : (e) => startUnitDrag(e, b)} onClick={printMode ? undefined : () => onInverterClick?.()}
          style={{ cursor: !printMode && onMoveUnit ? (dragging === ui ? 'grabbing' : 'grab') : 'default' }}>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={titleFs * 0.4} fill={BG_SUBTLE}
            stroke={dragging === ui ? PRIMARY_DARK : BORDER} strokeWidth={dragging === ui ? lineW * 1.6 : lineW} />
          <text x={b.x + b.w / 2} y={b.y + b.h * 0.34} textAnchor="middle" fontSize={titleFs} fontWeight={700} fill={TEXT_DARK}>
            {`INV ${ui + 1}`}
          </text>
          <text x={b.x + b.w / 2} y={b.y + b.h * 0.52} textAnchor="middle" fontSize={portFs} fontWeight={600} fill={TEXT}>
            {b.name}
          </text>
          <text x={b.x + b.w / 2} y={b.y + b.h * 0.68} textAnchor="middle" fontSize={portFs} fill={TEXT_MUTED}>
            {`${b.kw != null ? b.kw + ' kW · ' : ''}${b.mpptCount} MPPT`}
          </text>
          {Array.from({ length: b.mpptCount }).map((_, m) => {
            const pt = portPoint(b, b.side, m, b.mpptCount)
            const lbl = b.side === 'left' ? { x: pt.x + portR * 1.6, y: pt.y + portFs * 0.35, a: 'start' }
              : b.side === 'right' ? { x: pt.x - portR * 1.6, y: pt.y + portFs * 0.35, a: 'end' }
              : b.side === 'top' ? { x: pt.x, y: pt.y + portFs * 1.3, a: 'middle' }
              : { x: pt.x, y: pt.y - portFs * 0.7, a: 'middle' }
            return (
              <g key={`p${m}`}>
                <circle cx={pt.x} cy={pt.y} r={portR} fill={PRIMARY_DARK} stroke="white" strokeWidth={lineW * 0.5} />
                <text x={lbl.x} y={lbl.y} textAnchor={lbl.a as any} fontSize={portFs} fill={TEXT_SECONDARY}>{`M${m + 1}`}</text>
              </g>
            )
          })}
        </g>
      ))}
    </svg>
  )
}

// Strings-plan tab — the diagram: control bar (left) + canvas (right).
// `units`/`ports` are derived once in the host and shared with the Summary tab.
export default function StringsPlanTab({ projectId, panels, strings, onStringsChange, inverterLayout, onInverterLayoutChange, units, ports }: any) {
  const { t } = useLang()
  const [issues, setIssues] = useState<any[]>([])
  const [summary, setSummary] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showInverters, setShowInverters] = useState(true)
  const [showMpptLines, setShowMpptLines] = useState(true)
  const [showStringColors, setShowStringColors] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(true)
  const [invertersOpen, setInvertersOpen] = useState(false)
  const [stringsOpen, setStringsOpen] = useState(true)
  const {
    zoom, setZoom, panOffset, panActive, containerRef, contentRef,
    startPan, handleMouseMove, stopPan, resetView, centerView,
    MM_W, MM_H, panToMinimapPoint, getMinimapViewportRect,
  } = useCanvasPanZoom()

  // Validate any pre-existing strings on mount so the panel reflects state.
  useEffect(() => {
    if (projectId && (strings || []).length) {
      validateStrings(projectId, strings).then(r => setIssues(r.issues || [])).catch(() => {})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Port capacity / usage for the MPPT reassignment dropdown (free-capacity only).
  const portUsage = useMemo(() => {
    const used = ports.map(() => 0)
    ;(strings || []).forEach((s: any) => {
      const i = s.mpptIndex
      if (typeof i === 'number' && i >= 0 && i < used.length) used[i]++
    })
    return used
  }, [ports, strings])
  const portCap = (gi: number) => units[ports[gi]?.unitIdx]?.maxStringsPerMppt || 1
  const portFull = (gi: number) => portUsage[gi] >= portCap(gi)

  // Reassign a string to a different MPPT port, then re-validate.
  const reassignString = (id: string, mpptIndex: number) => {
    const next = (strings || []).map((s: any) => (s.id === id ? { ...s, mpptIndex } : s))
    onStringsChange(next)
    if (projectId) validateStrings(projectId, next).then(r => setIssues(r.issues || [])).catch(() => {})
  }

  // Inverter layout (position + MPPT side), persisted in step7 data.
  const moveUnit = (idx: number, pos: { x: number; y: number }) =>
    onInverterLayoutChange?.((prev: any) => ({ ...(prev || {}), [idx]: { ...((prev || {})[idx] || {}), ...pos } }))
  const setUnitSide = (idx: number, side: string) =>
    onInverterLayoutChange?.((prev: any) => ({ ...(prev || {}), [idx]: { ...((prev || {})[idx] || {}), side } }))
  const resetLayout = () => onInverterLayoutChange?.({})

  const handleGenerate = async () => {
    if (!projectId) return
    setBusy(true)
    try {
      const res = await generateStrings(projectId)
      onStringsChange(res.strings || [])
      setIssues(res.issues || [])
      setSummary(res.summary || null)
    } catch { /* surfaced via empty result */ }
    finally { setBusy(false) }
  }

  // Reset clears the whole plan; panels revert to the as-is layout.
  const handleReset = () => {
    onStringsChange([])
    onInverterLayoutChange?.({})   // also clear inverter positions / sides
    setIssues([])
    setSummary(null)
    setSelectedId(null)
  }

  // Clicking a panel selects its string and opens the Strings area.
  const handlePanelClick = (pid: any) => {
    const s = (strings || []).find((st: any) => (st.panelIds || []).includes(pid))
    if (s) { setSelectedId(s.id); setStringsOpen(true) }
  }
  const handleInverterClick = () => setInvertersOpen(true)

  // Delete one string; re-validate the remaining set so issues stay accurate.
  const handleDeleteString = (id: string) => {
    const next = (strings || []).filter((s: any) => s.id !== id)
    onStringsChange(next)
    if (selectedId === id) setSelectedId(null)
    if (projectId && next.length) {
      validateStrings(projectId, next).then(r => setIssues(r.issues || [])).catch(() => {})
    } else {
      setIssues([])
    }
  }

  const issueText = (it: any) => {
    const params = { ...(it.params || {}) }
    if (Array.isArray(params.specs)) params.specs = params.specs.join(', ')
    return t(`step7.issue.${it.code}`, params)
  }
  const errors = issues.filter(i => i.severity === 'error')
  const warnings = issues.filter(i => i.severity === 'warning')
  const hasStrings = (strings || []).length > 0
  const hasPanels = (panels || []).some((p: any) => !p.isEmpty)

  // Fit the diagram to the viewport on entry and whenever the layout's overall
  // footprint changes (strings generated → inverter rack appears).
  useEffect(() => { if (hasPanels) centerView() }, [centerView, hasPanels, hasStrings, units.length])

  // Derived string summary.
  const stats = useMemo(() => {
    const totalPanels = (panels || []).filter((p: any) => !p.isEmpty).length
    const counts = (strings || []).map((s: any) => (s.panelIds || []).length)
    return {
      totalPanels,
      stringCount: counts.length,
      perMin: counts.length ? Math.min(...counts) : 0,
      perMax: counts.length ? Math.max(...counts) : 0,
      inverters: units.length,
      mpptInputs: ports.length,
    }
  }, [panels, strings, units, ports])

  const detailRow = (label: string, value: any) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', padding: '0.15rem 0' }}>
      <span style={{ color: TEXT_MUTED }}>{label}</span>
      <span style={{ color: TEXT, fontWeight: 700 }}>{value}</span>
    </div>
  )

  return (
    <div style={{ height: '100%', display: 'flex', background: BG_FAINT }}>
      {/* ── Left sidebar (control bar) ── */}
      <div style={{ width: 320, borderRight: `1px solid ${BORDER_FAINT}`, background: 'white', padding: '1.5rem 1.25rem', overflowY: 'auto' }}>
        <button onClick={handleGenerate} disabled={busy || !projectId}
          style={{ width: '100%', padding: '0.7rem', background: busy ? BG_LIGHT : PRIMARY_DARK, color: busy ? TEXT_MUTED : 'white', border: 'none', borderRadius: 7, fontWeight: 700, fontSize: '0.95rem', cursor: busy ? 'wait' : 'pointer' }}>
          {busy ? '…' : (hasStrings ? t('step7.regenerate') : t('step7.generate'))}
        </button>

        {hasStrings && (
          <button onClick={handleReset} disabled={busy}
            style={{ width: '100%', marginTop: '0.5rem', padding: '0.55rem', background: 'none', color: TEXT_SECONDARY, border: `1px solid ${BORDER}`, borderRadius: 7, fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}>
            {t('step7.reset')}
          </button>
        )}

        {hasStrings && (
          <Section title={t('step7.detailsHeading')} open={summaryOpen} onToggle={() => setSummaryOpen(o => !o)}>
            <div style={{ background: PRIMARY_BG, borderRadius: 6, padding: '0.5rem 0.8rem' }}>
              {detailRow(t('step7.detail.panels'), stats.totalPanels)}
              {detailRow(t('step7.detail.strings'), stats.stringCount)}
              {detailRow(t('step7.detail.perString'), stats.perMin === stats.perMax ? stats.perMin : `${stats.perMin}–${stats.perMax}`)}
              {summary && detailRow(t('step7.detail.series'), (summary.seriesMin ?? '—') + '–' + (summary.seriesMax ?? '—'))}
              {detailRow(t('step7.detail.inverters'), stats.inverters)}
              {detailRow(t('step7.detail.mppt'), stats.mpptInputs)}
            </div>
          </Section>
        )}

        {hasStrings && units.length > 0 && (
          <Section title={t('step7.invHeading')} open={invertersOpen} onToggle={() => setInvertersOpen(o => !o)}>
            <div style={{ fontSize: '0.72rem', color: TEXT_MUTED, fontStyle: 'italic', marginBottom: '0.5rem' }}>{t('step7.dragHint')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {units.map((u: any, i: number) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: TEXT }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{`INV ${i + 1} · ${u.name}`}</span>
                  <select value={(inverterLayout && inverterLayout[i]?.side) || 'auto'} onChange={(e) => setUnitSide(i, e.target.value)} title={t('step7.portSide')}
                    style={{ fontSize: '0.7rem', padding: '0.12rem 0.2rem', border: `1px solid ${BORDER_FAINT}`, borderRadius: 4 }}>
                    {SIDES.map(sd => <option key={sd} value={sd}>{t(`step7.side.${sd}`)}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <button onClick={resetLayout}
              style={{ marginTop: '0.6rem', padding: '0.4rem 0.6rem', background: 'none', color: TEXT_SECONDARY, border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer' }}>
              {t('step7.resetLayout')}
            </button>
          </Section>
        )}

        {hasStrings && (
          <Section title={t('step7.legend')} open={stringsOpen} onToggle={() => setStringsOpen(o => !o)}>
            {/* validation */}
            {errors.length === 0 && warnings.length === 0 ? (
              <div style={{ background: SUCCESS_BG, color: SUCCESS_DARK, borderRadius: 6, padding: '0.5rem 0.8rem', fontSize: '0.8rem', marginBottom: '0.6rem' }}>{t('step7.valid')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: '0.6rem' }}>
                {errors.map((it, i) => (
                  <div key={`e${i}`} style={{ background: ERROR_BG, color: ERROR_DARK, borderRadius: 6, padding: '0.5rem 0.7rem', fontSize: '0.8rem' }}>{issueText(it)}</div>
                ))}
                {warnings.map((it, i) => (
                  <div key={`w${i}`} style={{ background: WARNING_BG, color: WARNING_DARK, borderRadius: 6, padding: '0.5rem 0.7rem', fontSize: '0.8rem' }}>{issueText(it)}</div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(strings || []).map((s: any, i: number) => {
                const sel = selectedId === s.id
                return (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: TEXT, borderRadius: 6, padding: '0.15rem 0.3rem', background: sel ? PANEL_LIGHT_BG : 'transparent' }}>
                    <div onClick={() => setSelectedId(sel ? null : s.id)} title={t('step7.selectString')}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, cursor: 'pointer' }}>
                      <span style={{ width: 12, height: 12, borderRadius: 3, background: stringColor(i), flexShrink: 0 }} />
                      <span style={{ flex: 1, whiteSpace: 'nowrap' }}>{s.id} · {t('step7.legendPanels', { n: (s.panelIds || []).length })}</span>
                    </div>
                    <select value={s.mpptIndex ?? ''} onClick={(e) => e.stopPropagation()}
                      onChange={(e) => reassignString(s.id, Number(e.target.value))} title={t('step7.reassignMppt')}
                      style={{ fontSize: '0.68rem', padding: '0.1rem 0.15rem', border: `1px solid ${BORDER_FAINT}`, borderRadius: 4, maxWidth: 92 }}>
                      {ports.map((pt: any, gi: number) => {
                        const dis = portFull(gi) && gi !== s.mpptIndex
                        return <option key={gi} value={gi} disabled={dis}>{`INV${pt.unitIdx + 1}·M${pt.portIdx + 1}${dis ? ' ✕' : ''}`}</option>
                      })}
                    </select>
                    <RowActions onDelete={() => handleDeleteString(s.id)} deleteTitle={t('step7.deleteString')} />
                  </div>
                )
              })}
            </div>
          </Section>
        )}
      </div>

      {/* ── Canvas ── */}
      <div style={{ flex: 1, minWidth: 0, padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: '1.2rem', fontWeight: 700, color: TEXT }}>{t('step7.title')}</div>
        <div style={{ fontSize: '0.85rem', color: TEXT_SECONDARY, margin: '0.3rem 0 1rem' }}>{t('step7.subtitle')}</div>
        <div ref={containerRef}
          style={{ flex: 1, position: 'relative', background: 'white', border: `1px solid ${BORDER}`, borderRadius: 10, overflow: 'hidden', minHeight: 0, cursor: hasPanels ? (panActive ? 'grabbing' : 'grab') : 'default' }}
          onMouseDown={hasPanels ? startPan : undefined} onMouseMove={handleMouseMove} onMouseUp={stopPan} onMouseLeave={stopPan}>
          {hasPanels ? (
            <>
              <div style={{ transform: `translate(${panOffset.x}px, ${panOffset.y}px)`, transformOrigin: 'top left' }}>
                <div ref={contentRef} style={{ display: 'inline-block', transform: `scale(${zoom})`, transformOrigin: 'top left', padding: '1rem' }}>
                  <StringCanvas panels={panels} strings={strings} selectedId={selectedId}
                    units={hasStrings && showInverters ? units : []} ports={ports}
                    showMpptLines={showMpptLines} showStringColors={showStringColors}
                    layout={inverterLayout} onMoveUnit={moveUnit}
                    onPanelClick={handlePanelClick} onInverterClick={handleInverterClick} />
                </div>
              </div>
              {hasStrings && (
                <LayersPanel actions={[]} layers={[
                  { label: t('step7.layer.inverters'), checked: showInverters, setter: setShowInverters },
                  { label: t('step7.layer.mpptLines'), checked: showMpptLines, setter: setShowMpptLines },
                  { label: t('step7.layer.stringColors'), checked: showStringColors, setter: setShowStringColors },
                ]} />
              )}
              <CanvasNavigator
                viewZoom={zoom}
                onZoomOut={() => setZoom(z => Math.max(0.3, z - 0.1))}
                onZoomReset={resetView}
                onZoomIn={() => setZoom(z => Math.min(8, z + 0.1))}
                mmWidth={MM_W} mmHeight={MM_H}
                onPanToPoint={panToMinimapPoint}
                viewportRect={getMinimapViewportRect()}
                left={336}
              />
            </>
          ) : (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: TEXT_MUTED, fontSize: '0.9rem', textAlign: 'center', padding: '2rem' }}>{t('step7.noStrings')}</div>
          )}
        </div>
      </div>
    </div>
  )
}
