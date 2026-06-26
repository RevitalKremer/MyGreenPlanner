import { useState, useEffect, useMemo, useRef } from 'react'
import { useLang } from '../../../i18n/LangContext'
import { generateStrings, validateStrings } from '../../../services/projectsApi'
import RowActions from '../../shared/RowActions'
import CanvasNavigator from '../../shared/CanvasNavigator'
import LayersPanel from '../step3/LayersPanel'
import ConfirmDialog from '../../ConfirmDialog'
import DirectionArrow from '../../shared/DirectionArrow'
import { useConfirm } from '../../../hooks/useConfirm'
import { useCanvasPanZoom } from '../../../hooks/useCanvasPanZoom'
import {
  PRIMARY_BG, PRIMARY_DARK,
  TEXT, TEXT_DARK, TEXT_SECONDARY, TEXT_MUTED,
  BORDER, BORDER_FAINT, BG_FAINT, BG_LIGHT, BG_SUBTLE,
  SUCCESS_BG, SUCCESS_DARK,
  ERROR_DARK, ERROR_BG, WARNING_DARK, WARNING_BG,
  STRING_PALETTE, PANEL_LIGHT_BG, PANEL_DARK, BLACK,
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
export function StringCanvas({ panels, strings, selectedId, units, ports, showMpptLines, showStringColors, showDirections, layout, onMoveUnit, onPanelClick, onInverterClick, printMode = false,
  editActive = false, editPanelIds = [], editAreaIdx = null, takenPanels = new Set(), onRemoveAt, onInsertAt }: any) {
  const real = (panels || []).filter((p: any) => !p.isEmpty)
  const selIdx = (printMode || !selectedId) ? -1 : (strings || []).findIndex((s: any) => s?.id === selectedId)
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [hoverDot, setHoverDot] = useState<number | null>(null)
  const [dragSeg, setDragSeg] = useState<{ segIndex: number; x: number; y: number } | null>(null)

  const editSet = new Set(editPanelIds)
  const realById: Record<string, any> = {}
  for (const p of real) realById[p.id] = p
  const isSelectable = (p: any) => editActive && !takenPanels.has(p.id) && !editSet.has(p.id) && (editAreaIdx == null || p.area === editAreaIdx)

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

  // Panel under a viewBox point (axis-aligned hit-test).
  const hitTestPanel = (x: number, y: number) =>
    real.find((p: any) => x >= p.x && x <= p.x + p.width && y >= p.y && y <= p.y + p.height)

  // Drag a chain segment's midpoint → "?" node follows the cursor → drop on a
  // selectable panel to insert it between that segment's endpoints.
  const startSegDrag = (e: any, segIndex: number) => {
    e.stopPropagation(); e.preventDefault()
    const move = (ev: MouseEvent) => { const u = clientToUser(ev.clientX, ev.clientY); if (u) setDragSeg({ segIndex, x: u.x, y: u.y }) }
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up)
      const u = clientToUser(ev.clientX, ev.clientY)
      if (u) { const p = hitTestPanel(u.x, u.y); if (p && isSelectable(p)) onInsertAt?.(segIndex, p.id) }
      setDragSeg(null)
    }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
    const u0 = clientToUser(e.clientX, e.clientY); if (u0) setDragSeg({ segIndex, x: u0.x, y: u0.y })
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
        stroke={isSel ? stringColor(i) : BLACK} strokeWidth={isSel ? lineW * 1.6 : lineW * 0.7}
        strokeOpacity={isSel ? 0.85 : (selIdx >= 0 ? 0.2 : 0.45)} strokeDasharray={`${lineW * 3} ${lineW * 2}`} />
    )
  }

  // Series routing line through a string's panels. Thin/blue normally; the
  // selected string is thick and uses its palette color.
  const renderRoute = (i: number) => {
    const r = routes[i]
    if (!r) return null
    const isSel = i === selIdx
    const col = isSel ? stringColor(i) : BLACK
    const op = isSel ? 1 : (selIdx >= 0 ? 0.3 : 0.7)
    return (
      <g key={`r${i}`}>
        <polyline points={r.pts.map((p: any) => `${p.x},${p.y}`).join(' ')}
          fill="none" stroke={col} strokeWidth={isSel ? lineW * 1.8 : lineW * 0.5} strokeOpacity={op}
          strokeLinejoin="round" strokeLinecap="round" />
        {/* string start marker: a "+" inside a circle */}
        {(() => {
          const R = isSel ? lineW * 3.6 : lineW * 2.8, a = R * 0.5, sw = lineW * 0.7
          return (
            <g fillOpacity={op} strokeOpacity={op}>
              <circle cx={r.start.x} cy={r.start.y} r={R} fill="white" stroke={col} strokeWidth={sw} />
              <line x1={r.start.x - a} y1={r.start.y} x2={r.start.x + a} y2={r.start.y} stroke={col} strokeWidth={sw} strokeLinecap="round" />
              <line x1={r.start.x} y1={r.start.y - a} x2={r.start.x} y2={r.start.y + a} stroke={col} strokeWidth={sw} strokeLinecap="round" />
            </g>
          )
        })()}
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
    <svg ref={svgRef} viewBox={geo.vb} preserveAspectRatio="xMidYMid meet"
      width={printMode ? undefined : svgW} height={printMode ? undefined : svgH}
      style={{ display: 'block', ...(printMode ? { width: '100%', height: '100%' } : {}) }}>
      {/* panels — blue by default. The "strings colors" layer fills every
          assigned panel with its string color; the selected string always
          takes its color (and pops above dimmed siblings). */}
      {real.map((p: any) => {
        const cx = p.x + p.width / 2, cy = p.y + p.height / 2
        const si = panelStr[p.id]
        const assigned = si != null && si >= 0
        let fill: string, op: number, clickable: boolean
        if (editActive) {
          const inChain = editSet.has(p.id)
          const sel = isSelectable(p)
          fill = inChain ? PRIMARY_DARK : PANEL_LIGHT_BG
          op = inChain ? 0.7 : (sel ? 0.85 : 0.22)
          clickable = sel
        } else {
          const hi = selIdx >= 0 && si === selIdx
          const colored = hi || (showStringColors && assigned)
          fill = colored ? stringColor(si) : PANEL_LIGHT_BG
          op = hi ? 0.65 : (colored ? (selIdx >= 0 ? 0.4 : 0.6) : 0.85)
          clickable = assigned
        }
        return (
          <g key={p.id} transform={`rotate(${p.rotation || 0} ${cx} ${cy})`}
            onClick={() => !printMode && clickable && onPanelClick?.(p.id)} style={{ cursor: !printMode && clickable ? 'pointer' : 'default' }}>
            <rect x={p.x} y={p.y} width={p.width} height={p.height}
              fill={fill} fillOpacity={op} stroke={PANEL_DARK} strokeWidth={Math.max(0.5, p.width * 0.012)} />
          </g>
        )
      })}

      {/* direction arrows — each panel's in-plane facing (rotation + yDir) */}
      {showDirections && real.map((p: any) => (
        <DirectionArrow key={`d${p.id}`} x={p.x + p.width / 2} y={p.y + p.height / 2}
          rotation={p.rotation} yDir={p.yDir} size={Math.min(p.width, p.height) * 0.3}
          fill={PANEL_DARK} fillOpacity={0.6} />
      ))}

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

      {/* edit chain overlay — numbered dots, segment drag-handles, hover-× delete */}
      {editActive && (() => {
        const pts = editPanelIds.map((id: any) => realById[id]).filter(Boolean).map((p: any) => ({ x: p.x + p.width / 2, y: p.y + p.height / 2 }))
        if (!pts.length) return null
        const col = PRIMARY_DARK
        const dotR = Math.max(3, lineW * 3)
        const fs = Math.max(lineW * 3, geo.w * 0.012)
        return (
          <g>
            {pts.length > 1 && <polyline points={pts.map((p: any) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={col} strokeWidth={lineW * 2} strokeLinejoin="round" strokeLinecap="round" />}
            {/* segment midpoint drag-handles (insert) */}
            {pts.slice(0, -1).map((p: any, i: number) => {
              const mx = (p.x + pts[i + 1].x) / 2, my = (p.y + pts[i + 1].y) / 2
              return <circle key={`seg${i}`} cx={mx} cy={my} r={dotR * 0.65} fill="white" stroke={col} strokeWidth={lineW} style={{ cursor: 'grab' }} onMouseDown={(e) => startSegDrag(e, i)} />
            })}
            {/* numbered dots — hover turns the number into a × to delete */}
            {pts.map((p: any, i: number) => {
              const hov = hoverDot === i
              return (
                <g key={`dot${i}`} onMouseEnter={() => setHoverDot(i)} onMouseLeave={() => setHoverDot(h => (h === i ? null : h))}
                  onClick={hov ? (e) => { e.stopPropagation(); onRemoveAt?.(i) } : undefined} style={{ cursor: hov ? 'pointer' : 'default' }}>
                  <circle cx={p.x} cy={p.y} r={dotR} fill={hov ? ERROR_DARK : col} stroke="white" strokeWidth={lineW * 0.6} />
                  <text x={p.x} y={p.y + fs * 0.35} textAnchor="middle" fontSize={fs} fontWeight={700} fill="white" style={{ pointerEvents: 'none' }}>{hov ? '×' : i + 1}</text>
                </g>
              )
            })}
            {/* dragging "?" node */}
            {dragSeg && (
              <g>
                <circle cx={dragSeg.x} cy={dragSeg.y} r={dotR} fill="white" stroke={col} strokeWidth={lineW} />
                <text x={dragSeg.x} y={dragSeg.y + fs * 0.35} textAnchor="middle" fontSize={fs} fontWeight={700} fill={col}>?</text>
              </g>
            )}
          </g>
        )
      })()}
    </svg>
  )
}

// Strings-plan tab — control bar (left) + canvas (right). Step-3-style edit
// mode: enter edit → draw/delete/reassign on a local draft → Apply (commit all
// to the server at once, mode='manual') or Discard. `units`/`ports` are derived
// in the host and shared with the Summary tab.
export default function StringsPlanTab({ projectId, panels, areas, strings, onStringsChange, inverterLayout, onInverterLayoutChange, mode, onModeChange, units, ports }: any) {
  const { t } = useLang()
  const [issues, setIssues] = useState<any[]>([])
  const [summary, setSummary] = useState<any>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [draft, setDraft] = useState<any[]>([])
  // Single in-progress chain: { stringId: null=new | id, panelIds, areaIdx }.
  const [chain, setChain] = useState<{ stringId: string | null; panelIds: number[]; areaIdx: number | null } | null>(null)
  const [showInverters, setShowInverters] = useState(true)
  const [showMpptLines, setShowMpptLines] = useState(true)
  const [showStringColors, setShowStringColors] = useState(false)
  const [showDirections, setShowDirections] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(true)
  const [invertersOpen, setInvertersOpen] = useState(false)
  const [stringsOpen, setStringsOpen] = useState(true)
  const confirm = useConfirm()
  const {
    zoom, setZoom, panOffset, panActive, containerRef, contentRef,
    startPan, handleMouseMove, stopPan, resetView, centerView, zoomAtCenter,
    MM_W, MM_H, panToMinimapPoint, getMinimapViewportRect,
  } = useCanvasPanZoom()

  // While editing, the diagram + lists read from the local draft.
  const effStrings = editMode ? draft : (strings || [])

  useEffect(() => {
    if (projectId && (strings || []).length) {
      validateStrings(projectId, strings).then(r => setIssues(r.issues || [])).catch(() => {})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const reValidate = (next: any[]) => {
    if (projectId && next.length) validateStrings(projectId, next).then(r => setIssues(r.issues || [])).catch(() => {})
    else setIssues([])
  }

  // Port capacity / usage (from the effective strings).
  const portUsage = useMemo(() => {
    const used = ports.map(() => 0)
    ;(effStrings || []).forEach((s: any) => {
      const i = s.mpptIndex
      if (typeof i === 'number' && i >= 0 && i < used.length) used[i]++
    })
    return used
  }, [ports, effStrings])
  const portCap = (gi: number) => units[ports[gi]?.unitIdx]?.maxStringsPerMppt || 1
  const portFull = (gi: number) => portUsage[gi] >= portCap(gi)

  // Inverter layout (position + MPPT side) — persisted directly (not part of the draft).
  const moveUnit = (idx: number, pos: { x: number; y: number }) =>
    onInverterLayoutChange?.((prev: any) => ({ ...(prev || {}), [idx]: { ...((prev || {})[idx] || {}), ...pos } }))
  const setUnitSide = (idx: number, side: string) =>
    onInverterLayoutChange?.((prev: any) => ({ ...(prev || {}), [idx]: { ...((prev || {})[idx] || {}), side } }))
  const resetLayout = () => onInverterLayoutChange?.({})

  // ── Auto-generate / reset (view mode) ──
  const handleGenerate = async () => {
    if (!projectId) return
    if (mode === 'manual' && (strings || []).length) {
      const ok = await confirm.ask({ message: t('step7.regenWarn'), variant: 'warning', confirmLabel: t('step7.regenerate') })
      if (!ok) return
    }
    try {
      const res = await generateStrings(projectId)
      onStringsChange(res.strings || [])
      setIssues(res.issues || [])
      setSummary(res.summary || null)
      onModeChange?.('auto')
    } catch { /* surfaced via empty result */ }
  }
  // Reset is always available — clears the whole plan (auto or manual), fresh start.
  const handleReset = async () => {
    const ok = await confirm.ask({ message: t('step7.resetWarn'), variant: 'danger', confirmLabel: t('step7.reset') })
    if (!ok) return
    onStringsChange([])
    onInverterLayoutChange?.({})
    setIssues([]); setSummary(null); setSelectedId(null)
    onModeChange?.('auto'); setEditMode(false); setChain(null)
  }

  // ── Edit mode (Step-3 style) ──
  const enterEdit = () => { setDraft([...(strings || [])]); setEditMode(true); setChain(null) }
  // Dirty = the draft differs from the persisted plan (used to guard discard).
  const isDirty = () => JSON.stringify(draft) !== JSON.stringify(strings || [])
  const applyEdit = () => {
    onStringsChange(draft); onModeChange?.('manual'); reValidate(draft)
    setEditMode(false); setChain(null)
  }
  const discardEdit = async () => {
    if (isDirty()) {
      const ok = await confirm.ask({ message: t('step7.discardWarn'), variant: 'danger', confirmLabel: t('step7.draw.discard') })
      if (!ok) return
    }
    setEditMode(false); setChain(null); setSelectedId(null); reValidate(strings || [])
  }

  // ── Chain draw / edit (operates on the draft) ──
  const panelById = useMemo(() => {
    const m: Record<string, any> = {}
    ;(panels || []).forEach((p: any) => { if (!p.isEmpty) m[p.id] = p })
    return m
  }, [panels])
  const areaOf = (pid: any) => panelById[pid]?.area
  // Direction = the panel's in-plane facing (the arrow): rotation + row dir.
  // Tilt (a/h) does NOT count. Matches the BE panel_direction().
  const stringDir = (ids: number[]): string => {
    const p = panelById[ids[0]] || {}
    return `${p.rotation || 0}|${p.yDir || 'ttb'}`
  }
  const takenPanels = useMemo(() => {
    const s = new Set<any>()
    ;(effStrings || []).forEach((st: any) => { if (!chain || st.id !== chain.stringId) (st.panelIds || []).forEach((p: any) => s.add(p)) })
    return s
  }, [effStrings, chain])

  const startDraw = () => { setSelectedId(null); setChain({ stringId: null, panelIds: [], areaIdx: null }) }
  const startEditString = (id: string) => {
    const s = (draft || []).find((st: any) => st.id === id); if (!s) return
    setSelectedId(id)
    setChain({ stringId: id, panelIds: [...(s.panelIds || [])], areaIdx: areaOf((s.panelIds || [])[0]) ?? null })
  }
  const cancelChain = () => setChain(null)

  const appendPanel = (pid: any) => setChain(e => {
    if (!e) return e
    if (e.panelIds.includes(pid) || takenPanels.has(pid)) return e
    if (e.areaIdx != null && areaOf(pid) !== e.areaIdx) return e
    return { ...e, panelIds: [...e.panelIds, pid], areaIdx: e.areaIdx ?? areaOf(pid) ?? null }
  })
  const removeAt = (idx: number) => setChain(e => {
    if (!e) return e
    const panelIds = e.panelIds.filter((_, i) => i !== idx)
    return { ...e, panelIds, areaIdx: panelIds.length ? e.areaIdx : null }
  })
  const insertAt = (segIndex: number, pid: any) => setChain(e => {
    if (!e) return e
    if (e.panelIds.includes(pid) || takenPanels.has(pid)) return e
    if (e.areaIdx != null && areaOf(pid) !== e.areaIdx) return e
    const panelIds = [...e.panelIds]
    panelIds.splice(segIndex + 1, 0, pid)
    return { ...e, panelIds, areaIdx: e.areaIdx ?? areaOf(pid) ?? null }
  })

  const finishChain = () => {
    if (!chain) return
    const ids = chain.panelIds
    let next: any[]
    if (chain.stringId) {
      next = ids.length
        ? draft.map((s: any) => (s.id === chain.stringId ? { ...s, panelIds: ids, direction: stringDir(ids) } : s))
        : draft.filter((s: any) => s.id !== chain.stringId)
    } else {
      if (!ids.length) { setChain(null); return }
      const p0 = panelById[ids[0]]
      const label = String(p0?.trapezoidId || '').replace(/[^A-Za-z]/g, '') || `A${(p0?.area ?? 0) + 1}`
      const used = new Set(draft.map((s: any) => s.id))
      let n = 1; while (used.has(`STR-${label}-${String(n).padStart(2, '0')}`)) n++
      const id = `STR-${label}-${String(n).padStart(2, '0')}`
      // First MPPT that's empty or already holds same (count, direction) strings.
      const dir = stringDir(ids)
      let firstFree = ports.findIndex((_: any, gi: number) => {
        if (portFull(gi)) return false
        const on = draft.filter((s: any) => s.mpptIndex === gi)
        return !on.length || ((on[0].panelIds || []).length === ids.length && on[0].direction === dir)
      })
      if (firstFree < 0) firstFree = null as any
      next = [...draft, { id, areaLabel: label, panelIds: ids, direction: dir, inverterTypeKey: units[ports[firstFree]?.unitIdx ?? 0]?.typeKey ?? units[0]?.typeKey ?? null, mpptIndex: firstFree }]
      setSelectedId(id)
    }
    setDraft(next); reValidate(next); setChain(null)
  }

  const reassignString = (id: string, mpptIndex: number) => {
    const next = draft.map((s: any) => (s.id === id ? { ...s, mpptIndex } : s))
    setDraft(next); reValidate(next)
  }
  const deleteString = (id: string) => {
    const next = draft.filter((s: any) => s.id !== id)
    setDraft(next); reValidate(next)
    if (selectedId === id) setSelectedId(null)
  }

  const handlePanelClick = (pid: any) => {
    if (chain) { appendPanel(pid); return }
    const s = (effStrings || []).find((st: any) => (st.panelIds || []).includes(pid))
    if (s) { setSelectedId(s.id); setStringsOpen(true) }
  }
  const handleInverterClick = () => { if (!chain) setInvertersOpen(true) }

  const issueText = (it: any) => {
    const params = { ...(it.params || {}) }
    if (Array.isArray(params.specs)) params.specs = params.specs.join(', ')
    return t(`step7.issue.${it.code}`, params)
  }
  const errors = issues.filter(i => i.severity === 'error')
  const warnings = issues.filter(i => i.severity === 'warning')
  const hasStrings = (effStrings || []).length > 0
  const hasPanels = (panels || []).some((p: any) => !p.isEmpty)

  useEffect(() => { if (hasPanels) centerView() }, [centerView, hasPanels, hasStrings, units.length])

  const stats = useMemo(() => {
    const totalPanels = (panels || []).filter((p: any) => !p.isEmpty).length
    const counts = (effStrings || []).map((s: any) => (s.panelIds || []).length)
    return {
      totalPanels, stringCount: counts.length,
      perMin: counts.length ? Math.min(...counts) : 0,
      perMax: counts.length ? Math.max(...counts) : 0,
      inverters: units.length, mpptInputs: ports.length,
    }
  }, [panels, effStrings, units, ports])

  const detailRow = (label: string, value: any) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', padding: '0.15rem 0' }}>
      <span style={{ color: TEXT_MUTED }}>{label}</span>
      <span style={{ color: TEXT, fontWeight: 700 }}>{value}</span>
    </div>
  )

  // LayersPanel action buttons (Step-3 style) — enter/exit + generate/reset.
  const aPrimary = { color: 'white', background: PRIMARY_DARK, border: `1px solid ${PRIMARY_DARK}`, padding: '0.4rem 0.55rem', fontSize: '0.72rem' }
  const aNeutral = { color: TEXT_SECONDARY, background: 'white', border: `1px solid ${BORDER}`, padding: '0.4rem 0.55rem', fontSize: '0.72rem' }
  const aDanger = { color: ERROR_DARK, background: 'white', border: `1px solid ${BORDER}`, padding: '0.4rem 0.55rem', fontSize: '0.72rem' }
  const layerActions = editMode
    ? [
        { label: '+ ' + t('step7.draw.drawString'), onClick: startDraw, style: aPrimary },
        { label: t('step7.draw.apply'), onClick: applyEdit, style: { ...aPrimary, background: SUCCESS_DARK, border: `1px solid ${SUCCESS_DARK}` } },
        { label: t('step7.draw.discard'), onClick: discardEdit, style: aDanger },
      ]
    : [
        { label: t('step7.editPlan'), onClick: enterEdit, style: aPrimary },
        { label: hasStrings ? t('step7.regenerate') : t('step7.generate'), onClick: handleGenerate, style: aNeutral },
        { label: t('step7.reset'), onClick: handleReset, style: aDanger },
      ]

  return (
    <div style={{ height: '100%', display: 'flex', background: BG_FAINT }}>
      {/* ── Left sidebar (control bar) ── */}
      <div style={{ width: 320, borderRight: `1px solid ${BORDER_FAINT}`, background: 'white', padding: '1.5rem 1.25rem', overflowY: 'auto' }}>
        {/* edit-mode status / chain toolbar */}
        {editMode && (
          chain ? (
            <div style={{ border: `1px solid ${PRIMARY_DARK}`, borderRadius: 8, padding: '0.7rem', background: PRIMARY_BG, marginBottom: '0.5rem' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: PRIMARY_DARK, marginBottom: 4 }}>
                {chain.stringId ? t('step7.draw.editing') : t('step7.draw.newString')}
              </div>
              <div style={{ fontSize: '0.74rem', color: TEXT_SECONDARY, marginBottom: '0.6rem' }}>{t('step7.draw.hint', { n: chain.panelIds.length })}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={finishChain} disabled={chain.panelIds.length === 0}
                  style={{ flex: 1, padding: '0.5rem', background: PRIMARY_DARK, color: 'white', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: '0.82rem', cursor: chain.panelIds.length ? 'pointer' : 'not-allowed', opacity: chain.panelIds.length ? 1 : 0.5 }}>{t('step7.draw.finish')}</button>
                <button onClick={cancelChain}
                  style={{ flex: 1, padding: '0.5rem', background: 'none', color: TEXT_SECONDARY, border: `1px solid ${BORDER}`, borderRadius: 6, fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer' }}>{t('step7.draw.cancel')}</button>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '0.78rem', color: PRIMARY_DARK, background: PRIMARY_BG, borderRadius: 6, padding: '0.5rem 0.7rem', marginBottom: '0.5rem', fontWeight: 600 }}>{t('step7.editHint')}</div>
          )
        )}
        {!editMode && !hasStrings && (
          <button onClick={handleGenerate} disabled={!projectId}
            style={{ width: '100%', padding: '0.7rem', background: PRIMARY_DARK, color: 'white', border: 'none', borderRadius: 7, fontWeight: 700, fontSize: '0.92rem', cursor: projectId ? 'pointer' : 'not-allowed', opacity: projectId ? 1 : 0.5 }}>
            {t('step7.generate')}
          </button>
        )}
        {!editMode && mode === 'manual' && (
          <div style={{ marginTop: '0.6rem', fontSize: '0.74rem', fontWeight: 700, color: PRIMARY_DARK, background: PRIMARY_BG, borderRadius: 6, padding: '0.3rem 0.5rem', textAlign: 'center' }}>{t('step7.manualBadge')}</div>
        )}

        {hasPanels && (
          <Section title={t('step7.detailsHeading')} open={summaryOpen} onToggle={() => setSummaryOpen(o => !o)}>
            <div style={{ background: PRIMARY_BG, borderRadius: 6, padding: '0.5rem 0.8rem' }}>
              {detailRow(t('step7.detail.panels'), stats.totalPanels)}
              {detailRow(t('step7.detail.strings'), hasStrings ? stats.stringCount : '—')}
              {detailRow(t('step7.detail.perString'), hasStrings ? (stats.perMin === stats.perMax ? stats.perMin : `${stats.perMin}–${stats.perMax}`) : '—')}
              {detailRow(t('step7.detail.series'), hasStrings && summary ? (summary.seriesMin ?? '—') + '–' + (summary.seriesMax ?? '—') : '—')}
              {detailRow(t('step7.detail.inverters'), hasStrings ? stats.inverters : '—')}
              {detailRow(t('step7.detail.mppt'), hasStrings ? stats.mpptInputs : '—')}
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
            {errors.length === 0 && warnings.length === 0 ? (
              <div style={{ background: SUCCESS_BG, color: SUCCESS_DARK, borderRadius: 6, padding: '0.5rem 0.8rem', fontSize: '0.8rem', marginBottom: '0.6rem' }}>{t('step7.valid')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: '0.6rem' }}>
                {errors.map((it, i) => (<div key={`e${i}`} style={{ background: ERROR_BG, color: ERROR_DARK, borderRadius: 6, padding: '0.5rem 0.7rem', fontSize: '0.8rem' }}>{issueText(it)}</div>))}
                {warnings.map((it, i) => (<div key={`w${i}`} style={{ background: WARNING_BG, color: WARNING_DARK, borderRadius: 6, padding: '0.5rem 0.7rem', fontSize: '0.8rem' }}>{issueText(it)}</div>))}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(effStrings || []).map((s: any, i: number) => {
                const sel = selectedId === s.id
                return (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: TEXT, borderRadius: 6, padding: '0.15rem 0.3rem', background: sel ? PANEL_LIGHT_BG : 'transparent' }}>
                    <div onClick={() => setSelectedId(sel ? null : s.id)} title={t('step7.selectString')}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, cursor: 'pointer' }}>
                      <span style={{ width: 12, height: 12, borderRadius: 3, background: stringColor(i), flexShrink: 0 }} />
                      <span style={{ flex: 1, whiteSpace: 'nowrap' }}>{s.id} · {t('step7.legendPanels', { n: (s.panelIds || []).length })}</span>
                    </div>
                    <select value={s.mpptIndex ?? ''} disabled={!editMode || !!chain} onClick={(e) => e.stopPropagation()}
                      onChange={(e) => reassignString(s.id, Number(e.target.value))} title={t('step7.reassignMppt')}
                      style={{ fontSize: '0.68rem', padding: '0.1rem 0.15rem', border: `1px solid ${BORDER_FAINT}`, borderRadius: 4, maxWidth: 92, opacity: editMode ? 1 : 0.6 }}>
                      {ports.map((pt: any, gi: number) => {
                        // Incompatible if the port already holds strings of a
                        // different (panel count, direction) than this string.
                        const on = (effStrings || []).filter((x: any) => x.id !== s.id && x.mpptIndex === gi)
                        const incompat = on.length > 0 && ((on[0].panelIds || []).length !== (s.panelIds || []).length || on[0].direction !== s.direction)
                        const dis = (portFull(gi) && gi !== s.mpptIndex) || incompat
                        return <option key={gi} value={gi} disabled={dis}>{`INV${pt.unitIdx + 1}·M${pt.portIdx + 1}${dis ? ' ✕' : ''}`}</option>
                      })}
                    </select>
                    {editMode && (
                      <RowActions onEdit={!chain ? () => startEditString(s.id) : undefined} onDelete={() => deleteString(s.id)}
                        editTitle={t('step7.draw.editString')} deleteTitle={t('step7.deleteString')} />
                    )}
                  </div>
                )
              })}
            </div>
          </Section>
        )}
      </div>

      {/* ── Canvas ── */}
      <div style={{ flex: 1, minWidth: 0, padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
        <div ref={containerRef}
          style={{ flex: 1, position: 'relative', background: 'white', border: `1px solid ${BORDER}`, borderRadius: 10, overflow: 'hidden', minHeight: 0, cursor: hasPanels ? (panActive ? 'grabbing' : 'grab') : 'default' }}
          onMouseDown={hasPanels ? startPan : undefined} onMouseMove={handleMouseMove} onMouseUp={stopPan} onMouseLeave={stopPan}>
          {hasPanels ? (
            <>
              <div style={{ transform: `translate(${panOffset.x}px, ${panOffset.y}px)`, transformOrigin: 'top left' }}>
                <div ref={contentRef} style={{ display: 'inline-block', transform: `scale(${zoom})`, transformOrigin: 'top left', padding: '1rem' }}>
                  <StringCanvas panels={panels} strings={effStrings} selectedId={selectedId}
                    units={hasStrings && showInverters ? units : []} ports={ports}
                    showMpptLines={showMpptLines} showStringColors={showStringColors}
                    showDirections={showDirections}
                    layout={inverterLayout} onMoveUnit={chain ? undefined : moveUnit}
                    onPanelClick={handlePanelClick} onInverterClick={handleInverterClick}
                    editActive={!!chain} editPanelIds={chain?.panelIds || []} editAreaIdx={chain?.areaIdx ?? null}
                    takenPanels={takenPanels} onRemoveAt={removeAt} onInsertAt={insertAt} />
                </div>
              </div>
              <LayersPanel actions={layerActions} layers={hasStrings ? [
                { label: t('step7.layer.inverters'), checked: showInverters, setter: setShowInverters },
                { label: t('step7.layer.mpptLines'), checked: showMpptLines, setter: setShowMpptLines },
                { label: t('step7.layer.stringColors'), checked: showStringColors, setter: setShowStringColors },
                { label: t('step7.layer.directions'), checked: showDirections, setter: setShowDirections },
              ] : [
                { label: t('step7.layer.directions'), checked: showDirections, setter: setShowDirections },
              ]} />
              <CanvasNavigator
                viewZoom={zoom}
                onZoomOut={() => { const nz = Math.max(0.3, zoom - 0.1); zoomAtCenter(zoom, nz); setZoom(nz) }}
                onZoomReset={resetView}
                onZoomIn={() => { const nz = Math.min(8, zoom + 0.1); zoomAtCenter(zoom, nz); setZoom(nz) }}
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

      <ConfirmDialog
        open={!!confirm.pending}
        message={confirm.pending?.message ?? ''}
        title={confirm.pending?.title}
        variant={confirm.pending?.variant}
        confirmLabel={confirm.pending?.confirmLabel || t('common.confirm')}
        cancelLabel={confirm.pending?.cancelLabel || t('common.cancel')}
        onConfirm={confirm.handleConfirm}
        onCancel={confirm.handleCancel}
      />
    </div>
  )
}
