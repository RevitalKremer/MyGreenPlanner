import { useState, useEffect, useMemo } from 'react'
import { useLang } from '../../i18n/LangContext'
import { generateStrings, validateStrings, fetchSadotEquipment } from '../../services/projectsApi'
import RowActions from '../shared/RowActions'
import CanvasNavigator from '../shared/CanvasNavigator'
import LayersPanel from './step3/LayersPanel'
import { useCanvasPanZoom } from '../../hooks/useCanvasPanZoom'
import {
  PRIMARY_BG, PRIMARY_DARK,
  TEXT, TEXT_DARK, TEXT_SECONDARY, TEXT_MUTED,
  BORDER, BORDER_FAINT, BG_FAINT, BG_LIGHT, BG_SUBTLE,
  SUCCESS_BG, SUCCESS_DARK,
  ERROR_DARK, ERROR_BG, WARNING_DARK, WARNING_BG,
  STRING_PALETTE, PANEL_LIGHT_BG, PANEL_DARK,
} from '../../styles/colors'

const stringColor = (i: number) => STRING_PALETTE[i % STRING_PALETTE.length]

// Build the physical inverter units (expand by qty) and the flat list of MPPT
// inputs across the whole fleet. The BE assigns each string a flat `mpptIndex`
// into this same ordered port list, so a string → port lookup is index-based.
function buildFleet(inverters: any[], byKey: Record<string, any>) {
  const units: { typeKey: string; name: string; kw: number | null; mpptCount: number }[] = []
  ;(inverters || []).forEach((p: any) => {
    const prod = byKey[p.typeKey]
    const mpptCount = prod?.params?.mpptCount || 2
    const kw = prod?.params?.acPowerKw ?? null
    for (let q = 0; q < (p.qty || 1); q++) {
      units.push({ typeKey: p.typeKey, name: prod?.name || p.typeKey, kw, mpptCount })
    }
  })
  const ports: { unitIdx: number; portIdx: number }[] = []
  units.forEach((u, ui) => { for (let m = 0; m < u.mpptCount; m++) ports.push({ unitIdx: ui, portIdx: m }) })
  return { units, ports }
}

// Read-only SVG: placed panels colored by their string group on the left, an
// inverter rack on the right, and connector lines from each string to the MPPT
// input it feeds.
function StringCanvas({ panels, strings, selectedId, units, ports, showMpptLines }) {
  const real = (panels || []).filter((p: any) => !p.isEmpty)
  const selIdx = selectedId ? (strings || []).findIndex((s: any) => s?.id === selectedId) : -1

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

    // Reserve a rack column to the right of the panels for the inverter boxes.
    const hasRack = units.length > 0
    const rackGap = hasRack ? w * 0.12 : 0
    const rackW = hasRack ? Math.max(w * 0.3, 120) : 0
    const rackX = maxX + rackGap

    // Stack inverter unit boxes vertically across the panel height.
    const unitGap = h * 0.05
    const unitH = units.length ? (h - unitGap * (units.length - 1)) / units.length : 0
    const unitBoxes = units.map((u: any, i: number) => ({
      ...u, x: rackX, y: minY + i * (unitH + unitGap), w: rackW, h: unitH,
    }))

    // Port coordinates (left edge of each unit box), flat-indexed like `ports`.
    const portPts: { x: number; y: number }[] = []
    unitBoxes.forEach((b: any) => {
      for (let m = 0; m < b.mpptCount; m++) {
        portPts.push({ x: b.x, y: b.y + b.h * (m + 1) / (b.mpptCount + 1) })
      }
    })

    const vbX = minX - pad
    const vbW = (rackX + rackW) - minX + 2 * pad
    const vbY = minY - pad
    const vbH = h + 2 * pad
    return { minX, minY, w, h, pad, unitBoxes, portPts, vb: `${vbX} ${vbY} ${vbW} ${vbH}` }
  }, [real, units, ports])

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

  // Connector: string series-end → its MPPT port. Emphasized when selected.
  const renderConn = (i: number) => {
    const r = routes[i]
    if (!r) return null
    const port = geo.portPts[strings[i]?.mpptIndex]
    if (!port) return null
    const isSel = i === selIdx
    const midX = r.end.x + (port.x - r.end.x) * 0.5
    return (
      <path key={`c${i}`} d={`M ${r.end.x} ${r.end.y} C ${midX} ${r.end.y} ${midX} ${port.y} ${port.x} ${port.y}`}
        fill="none" stroke={isSel ? stringColor(i) : PANEL_DARK} strokeWidth={isSel ? lineW * 1.6 : lineW * 0.7}
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
    <svg width={svgW} height={svgH} viewBox={geo.vb} style={{ display: 'block' }}>
      {/* panels — blue by default; the selected string's panels take its color */}
      {real.map((p: any) => {
        const cx = p.x + p.width / 2, cy = p.y + p.height / 2
        const si = panelStr[p.id]
        const hi = selIdx >= 0 && si === selIdx
        return (
          <g key={p.id} transform={`rotate(${p.rotation || 0} ${cx} ${cy})`}>
            <rect x={p.x} y={p.y} width={p.width} height={p.height}
              fill={hi ? stringColor(si) : PANEL_LIGHT_BG} fillOpacity={hi ? 0.6 : 0.85}
              stroke={PANEL_DARK} strokeWidth={Math.max(0.5, p.width * 0.012)} />
          </g>
        )
      })}

      {/* connectors + routing lines — selected drawn last so it sits on top */}
      {showMpptLines && routes.map((_: any, i: number) => (i === selIdx ? null : renderConn(i)))}
      {routes.map((_: any, i: number) => (i === selIdx ? null : renderRoute(i)))}
      {showMpptLines && selIdx >= 0 && renderConn(selIdx)}
      {selIdx >= 0 && renderRoute(selIdx)}

      {/* inverter rack */}
      {geo.unitBoxes.map((b: any, ui: number) => (
        <g key={`u${ui}`}>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={titleFs * 0.4} fill={BG_SUBTLE} stroke={BORDER} strokeWidth={lineW} />
          <text x={b.x + b.w / 2} y={b.y + titleFs * 1.4} textAnchor="middle" fontSize={titleFs} fontWeight={700} fill={TEXT_DARK}>
            {`INV ${ui + 1}`}{b.kw != null ? ` · ${b.kw} kW` : ''}
          </text>
          <text x={b.x + b.w / 2} y={b.y + titleFs * 2.6} textAnchor="middle" fontSize={portFs} fill={TEXT_MUTED}>
            {`${b.mpptCount} MPPT`}
          </text>
          {Array.from({ length: b.mpptCount }).map((_, m) => {
            const py = b.y + b.h * (m + 1) / (b.mpptCount + 1)
            return (
              <g key={`p${m}`}>
                <circle cx={b.x} cy={py} r={portR} fill={PRIMARY_DARK} stroke="white" strokeWidth={lineW * 0.5} />
                <text x={b.x + portR * 1.6} y={py + portFs * 0.35} fontSize={portFs} fill={TEXT_SECONDARY}>{`M${m + 1}`}</text>
              </g>
            )
          })}
        </g>
      ))}
    </svg>
  )
}

// Step 7 — auto-generate per-area strings, validate against inverter limits,
// and visualize string groups + their inverter/MPPT connections.
export default function Step7StringPlan({ projectId, panels, inverters, strings, onStringsChange }) {
  const { t } = useLang()
  const [issues, setIssues] = useState<any[]>([])
  const [summary, setSummary] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [equipment, setEquipment] = useState<any[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showInverters, setShowInverters] = useState(true)
  const [showMpptLines, setShowMpptLines] = useState(true)
  const {
    zoom, setZoom, panOffset, panActive, containerRef, contentRef,
    startPan, handleMouseMove, stopPan, resetView, centerView,
    MM_W, MM_H, panToMinimapPoint, getMinimapViewportRect,
  } = useCanvasPanZoom()

  useEffect(() => { fetchSadotEquipment().then(setEquipment).catch(() => setEquipment([])) }, [])

  // Validate any pre-existing strings on mount so the panel reflects state.
  useEffect(() => {
    if (projectId && (strings || []).length) {
      validateStrings(projectId, strings).then(r => setIssues(r.issues || [])).catch(() => {})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const byKey = useMemo(() => Object.fromEntries(equipment.map(e => [e.type_key, e])), [equipment])
  const { units, ports } = useMemo(() => buildFleet(inverters, byKey), [inverters, byKey])

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
    setIssues([])
    setSummary(null)
    setSelectedId(null)
  }

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

  // Map a string's flat mpptIndex back to its inverter/port label.
  const connLabel = (mpptIndex: number) => {
    const port = ports[mpptIndex]
    if (!port) return ''
    return t('step7.connLabel', { inv: port.unitIdx + 1, mppt: port.portIdx + 1 })
  }

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
          <div style={{ marginTop: '1.25rem' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: TEXT_MUTED, marginBottom: '0.4rem' }}>{t('step7.detailsHeading')}</div>
            <div style={{ background: PRIMARY_BG, borderRadius: 6, padding: '0.5rem 0.8rem' }}>
              {detailRow(t('step7.detail.panels'), stats.totalPanels)}
              {detailRow(t('step7.detail.strings'), stats.stringCount)}
              {detailRow(t('step7.detail.perString'), stats.perMin === stats.perMax ? stats.perMin : `${stats.perMin}–${stats.perMax}`)}
              {summary && detailRow(t('step7.detail.series'), (summary.seriesMin ?? '—') + '–' + (summary.seriesMax ?? '—'))}
              {detailRow(t('step7.detail.inverters'), stats.inverters)}
              {detailRow(t('step7.detail.mppt'), stats.mpptInputs)}
            </div>
          </div>
        )}

        {hasStrings && (
          <div style={{ marginTop: '1.25rem' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: TEXT_MUTED, marginBottom: '0.5rem' }}>{t('step7.issuesHeading')}</div>
            {errors.length === 0 && warnings.length === 0 ? (
              <div style={{ background: SUCCESS_BG, color: SUCCESS_DARK, borderRadius: 6, padding: '0.6rem 0.8rem', fontSize: '0.82rem' }}>{t('step7.valid')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {errors.map((it, i) => (
                  <div key={`e${i}`} style={{ background: ERROR_BG, color: ERROR_DARK, borderRadius: 6, padding: '0.5rem 0.7rem', fontSize: '0.8rem' }}>{issueText(it)}</div>
                ))}
                {warnings.map((it, i) => (
                  <div key={`w${i}`} style={{ background: WARNING_BG, color: WARNING_DARK, borderRadius: 6, padding: '0.5rem 0.7rem', fontSize: '0.8rem' }}>{issueText(it)}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {hasStrings && (
          <div style={{ marginTop: '1.25rem' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: TEXT_MUTED, marginBottom: '0.5rem' }}>{t('step7.legend')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(strings || []).map((s: any, i: number) => {
                const sel = selectedId === s.id
                return (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', color: TEXT, borderRadius: 6, padding: '0.15rem 0.3rem', background: sel ? PANEL_LIGHT_BG : 'transparent' }}>
                    <div onClick={() => setSelectedId(sel ? null : s.id)} title={t('step7.selectString')}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, cursor: 'pointer' }}>
                      <span style={{ width: 12, height: 12, borderRadius: 3, background: stringColor(i), flexShrink: 0 }} />
                      <span style={{ flex: 1 }}>{s.id} · {t('step7.legendPanels', { n: (s.panelIds || []).length })}</span>
                      <span style={{ color: TEXT_MUTED, fontSize: '0.74rem' }}>{connLabel(s.mpptIndex)}</span>
                    </div>
                    <RowActions onDelete={() => handleDeleteString(s.id)} deleteTitle={t('step7.deleteString')} />
                  </div>
                )
              })}
            </div>
          </div>
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
                    units={hasStrings && showInverters ? units : []} ports={ports} showMpptLines={showMpptLines} />
                </div>
              </div>
              {hasStrings && (
                <LayersPanel actions={[]} layers={[
                  { label: t('step7.layer.inverters'), checked: showInverters, setter: setShowInverters },
                  { label: t('step7.layer.mpptLines'), checked: showMpptLines, setter: setShowMpptLines },
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
