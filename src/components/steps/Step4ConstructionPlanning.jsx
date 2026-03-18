import { useState, useMemo, useRef, useEffect } from 'react'
import {
  computeRowConstruction,
  assignTypes,
  buildBOM,
  PANEL_LENGTH_CM
} from '../../utils/constructionCalculator'
import RailLayoutTab from './RailLayoutTab'
import BasesPlanTab  from './BasesPlanTab'
import { DEFAULT_RAIL_OFFSET_CM, DEFAULT_RAIL_OVERHANG_CM, DEFAULT_STOCK_LENGTHS_MM, computeRowRailLayout } from '../../utils/railLayoutService'
import { DEFAULT_BASE_EDGE_OFFSET_MM, DEFAULT_BASE_SPACING_MM, DEFAULT_RAIL_EDGE_DIST_MM, DEFAULT_RAIL_MIN_PORTRAIT, DEFAULT_RAIL_MIN_LANDSCAPE } from '../../utils/basePlanService'

const ACCENT = '#C4D600'

// ─── Centralised settings defaults ───────────────────────────────────────────
const SETTINGS_DEFAULTS = {
  // Trapezoids & Rails (detail tab)
  railOffsetCm:     DEFAULT_RAIL_OFFSET_CM,
  connOffsetCm:     5,
  panelLengthCm:    238.2,
  blockHeightCm:    30,
  blockWidthCm:     70,
  connEdgeDistMm:   DEFAULT_RAIL_EDGE_DIST_MM,
  connMinPortrait:  DEFAULT_RAIL_MIN_PORTRAIT,
  connMinLandscape: DEFAULT_RAIL_MIN_LANDSCAPE,
  // Rails (rails tab)
  railOverhangCm:   DEFAULT_RAIL_OVERHANG_CM,
  stockLengths:     DEFAULT_STOCK_LENGTHS_MM,
  // Bases (bases tab)
  edgeOffsetMm:     DEFAULT_BASE_EDGE_OFFSET_MM,
  spacingMm:        DEFAULT_BASE_SPACING_MM,
  maxSpanCm:        165,
}

// ─── SVG helpers ────────────────────────────────────────────────────────────

/** Draw a dimension arrow between two points with a label */

function ArrowDefs() {
  return (
    <defs>
      <marker id="arr" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
        <path d="M0,0 L0,6 L6,3 z" fill="#17a9cf" />
      </marker>
    </defs>
  )
}

// ─── Trapezoid profile SVG (elevation side view) ────────────────────────────

function TrapProfile({ rc, sc = 1.2, showLabel = true, selected = false }) {
  const { heightRear, heightFront, baseLength, typeLetter, panelsPerSpan, diagonalLength } = rc
  const padL = 8, padR = 8, padT = 12, padB = 10
  const bW = baseLength * sc
  const hR = heightRear * sc
  const hF = heightFront * sc
  const W = bW + padL + padR
  const svgH = hF + padT + padB

  // Points (SVG y-down, so base is at svgH - padB)
  const baseY = svgH - padB
  const x0 = padL, x1 = padL + bW
  const topY0 = baseY - hR   // top of rear leg (short)
  const topY1 = baseY - hF   // top of front leg (tall)

  return (
    <svg width={W} height={svgH} style={{ display: 'block', overflow: 'visible' }}>
      {/* Frame */}
      <line x1={x0} y1={baseY} x2={x1} y2={baseY} stroke={selected ? ACCENT : '#333'} strokeWidth="2.5" />
      <line x1={x0} y1={topY0} x2={x0} y2={baseY} stroke={selected ? ACCENT : '#333'} strokeWidth="2.5" />
      <line x1={x1} y1={topY1} x2={x1} y2={baseY} stroke={selected ? ACCENT : '#333'} strokeWidth="2.5" />
      <line x1={x0} y1={topY0} x2={x1} y2={topY1} stroke={selected ? ACCENT : '#333'} strokeWidth="2" />
      {/* Diagonal brace */}
      <line x1={x0} y1={topY0} x2={x1} y2={baseY} stroke="#666" strokeWidth="1.5" strokeDasharray="none" />
      {/* Diagonal length label */}
      {showLabel && (
        <text x={(x0 + x1) / 2 - 6} y={(topY0 + baseY) / 2 - 4}
          fontSize="7" fill="#444" fontStyle="italic" fontWeight="600"
          transform={`rotate(${Math.atan2(baseY - topY0, x1 - x0) * 180 / Math.PI}, ${(x0+x1)/2}, ${(topY0+baseY)/2})`}
          textAnchor="middle"
        >{(diagonalLength / 100).toFixed(1)}</text>
      )}
      {/* Rear leg height */}
      {showLabel && hR > 0 && (
        <text x={x0 - 4} y={(topY0 + baseY) / 2} fontSize="7" fill="#333" textAnchor="end" dominantBaseline="middle" fontStyle="italic">{(heightRear / 100).toFixed(1)}</text>
      )}
      {/* Front leg height */}
      {showLabel && (
        <text x={x1 + 4} y={(topY1 + baseY) / 2} fontSize="7" fill="#333" textAnchor="start" dominantBaseline="middle" fontStyle="italic">{(heightFront / 100).toFixed(1)}</text>
      )}
      {/* Type label */}
      {showLabel && typeLetter && (
        <text x={(x0 + x1) / 2} y={topY1 + (topY0 - topY1) / 2 + (hF - hR) * sc / 4 + 4}
          fontSize="9" fill={selected ? ACCENT : '#555'} fontWeight="800" textAnchor="middle"
        >{typeLetter}{panelsPerSpan}</text>
      )}
    </svg>
  )
}

// ─── Layout view ─────────────────────────────────────────────────────────────

function LayoutView({ rowConstructions, rowLabels = [], selectedIdx, onSelectRow, highlightParam = null }) {
  const hlSpacing = PARAM_GROUP[highlightParam] === 'trap-spacing'
  return (
    <div style={{ padding: '1.5rem', overflowY: 'auto' }}>
      {hlSpacing && <style>{`@keyframes hlPulse { 0%,100%{opacity:0.15} 50%{opacity:0.9} }`}</style>}
      {rowConstructions.map((rc, i) => {
        const sc = 1.2
        const profileW = rc.baseLength * sc + 16
        const spacing_mm = Math.round(rc.spacing * 10)
        const totalW = rc.numTrapezoids * profileW + (rc.numTrapezoids - 1) * 20 + 60
        const arrowColor = hlSpacing ? '#FFB300' : '#17a9cf'

        return (
          <div key={i}
            onClick={() => onSelectRow(i)}
            style={{
              marginBottom: '1.5rem', cursor: 'pointer',
              border: `2px solid ${selectedIdx === i ? ACCENT : '#eee'}`,
              borderRadius: '10px', padding: '0.75rem 1rem',
              background: selectedIdx === i ? '#f8fce8' : 'white',
              transition: 'all 0.15s'
            }}
          >
            <div style={{ fontSize: '0.75rem', fontWeight: '700', color: '#888', marginBottom: '0.5rem' }}>
              {rowLabels[i] ?? `Area ${i + 1}`} · {rc.panelCount} panels · {rc.angle}° · {rc.typeLetter}{rc.panelsPerSpan} type
            </div>
            <div style={{ overflowX: 'auto' }}>
              <svg width={totalW} height={140} style={{ display: 'block' }}>
                <ArrowDefs />
                {Array.from({ length: rc.numTrapezoids }, (_, j) => {
                  const x = 30 + j * (profileW + 20)
                  const isLast = j === rc.numTrapezoids - 1
                  return (
                    <g key={j} transform={`translate(${x}, 10)`}>
                      <TrapProfile rc={rc} sc={sc} showLabel={true} selected={selectedIdx === i} />
                      {/* Spacing arrow at bottom */}
                      {!isLast && (
                        <g transform={`translate(0, 115)`}
                          style={hlSpacing ? { animation: 'hlPulse 0.75s ease-in-out infinite' } : {}}>
                          <line x1={rc.baseLength * sc + 16} y1={5} x2={rc.baseLength * sc + 16 + 20} y2={5}
                            stroke={arrowColor} strokeWidth={hlSpacing ? 2 : 1}
                            markerEnd="url(#arr)" markerStart="url(#arr)" />
                          <text x={rc.baseLength * sc + 16 + 10} y={14} fontSize="8"
                            fill={arrowColor} fontWeight="700" fontStyle="italic" textAnchor="middle">{spacing_mm}</text>
                        </g>
                      )}
                    </g>
                  )
                })}
              </svg>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Rows (top view) ─────────────────────────────────────────────────────────

function RowsView({ rowConstructions, rowLabels = [], highlightParam = null }) {
  const maxLen = Math.max(...rowConstructions.map(r => r.rowLength), 1)
  const maxW = 580
  const sc = maxW / maxLen
  const hlEnds = PARAM_GROUP[highlightParam] === 'rail-ends'

  return (
    <div style={{ padding: '1.5rem', overflowY: 'auto' }}>
      {hlEnds && <style>{`@keyframes hlPulse { 0%,100%{opacity:0.15} 50%{opacity:0.9} }`}</style>}
      {rowConstructions.map((rc, i) => {
        const W = rc.rowLength * sc
        const panelDepth = PANEL_LENGTH_CM * Math.cos(rc.angle * Math.PI / 180)
        const depthSc = Math.min(60, panelDepth * sc)
        const railLabel = `${2}×${(rc.rowLength / 100).toFixed(1)}m`
        const totalH = depthSc + 48
        const svgW = W + 70
        const widthArrowColor = hlEnds ? '#FFB300' : '#222'

        return (
          <div key={i} style={{ marginBottom: '2rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: '700', color: '#888', marginBottom: '4px' }}>{rowLabels[i] ?? `Area ${i + 1}`}</div>
            <svg width={svgW} height={totalH} style={{ display: 'block', overflow: 'visible' }}>
              <ArrowDefs />
              {/* Row width arrow */}
              <g style={hlEnds ? { animation: 'hlPulse 0.75s ease-in-out infinite' } : {}}>
                <line x1={30} y1={8} x2={30 + W} y2={8} stroke={widthArrowColor} strokeWidth={hlEnds ? 2 : 1} markerEnd="url(#arr)" markerStart="url(#arr)" />
                <text x={30 + W / 2} y={5} fontSize="9" fontWeight="700" fill={widthArrowColor} textAnchor="middle">{Math.round(rc.rowLength * 10)}</text>
              </g>
              {/* Rectangle */}
              <rect x={30} y={20} width={W} height={depthSc}
                fill="#cfe3f5" stroke="#3a6ea5" strokeWidth="1.5" />
              {/* Hatch lines */}
              {Array.from({ length: Math.floor(W / 18) }, (_, k) => (
                <line key={k} x1={30 + k * 18} y1={20} x2={30 + k * 18 + depthSc * 0.6} y2={20 + depthSc}
                  stroke="#9bbcd4" strokeWidth="0.5" />
              ))}
              {/* Trapezoid positions (vertical lines) */}
              {Array.from({ length: rc.numTrapezoids }, (_, j) => {
                const tx = 30 + (rc.railOverhang + j * rc.spacing) * sc
                return <line key={j} x1={tx} y1={20} x2={tx} y2={20 + depthSc} stroke="#3a6ea5" strokeWidth="1.5" />
              })}
              {/* Label */}
              <text x={30 + W / 2} y={20 + depthSc / 2 + 4} fontSize="13" fontWeight="800" fill="#1a3a5c"
                textAnchor="middle">{railLabel}</text>
              {/* Depth arrow on right */}
              <line x1={30 + W + 10} y1={20} x2={30 + W + 10} y2={20 + depthSc} stroke="#222" strokeWidth="1" markerEnd="url(#arr)" markerStart="url(#arr)" />
              <text x={30 + W + 22} y={20 + depthSc / 2} fontSize="9" fontWeight="700" fill="#222" dominantBaseline="middle">{Math.round(panelDepth * 10)}</text>
            </svg>
          </div>
        )
      })}
    </div>
  )
}

// ─── Detail view (side elevation sketch) ─────────────────────────────────────

// Param → highlight group mapping (used across all tabs)
const PARAM_GROUP = {
  railOffsetCm:     'rail-clamp',    // detail tab: panel-rear clamp area
  connOffsetCm:     'cross-rails',    // detail tab: cross-rail rects
  connEdgeDistMm:   'cross-rails',
  connMinPortrait:  'cross-rails',
  connMinLandscape: 'cross-rails',
  panelLengthCm:    'panel',         // detail tab: panel bars
  blockHeightCm:    'blocks',        // detail tab: block rects
  blockWidthCm:     'blocks',
  railOverhangCm:   'rail-ends',     // rails tab + rows tab
  stockLengths:     'rail-cuts',     // rails tab: cut segment labels
  edgeOffsetMm:     'base-edges',    // bases tab: first & last base
  spacingMm:        'base-spacing',  // bases tab: dimension annotations
  maxSpanCm:        'trap-spacing',  // layout tab + bases tab
}

function DetailView({ rc, panelLines = null, settings = {}, highlightParam = null }) {
  const [zoom, setZoom]             = useState(1)
  const [panOffset, setPanOffset]   = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning]   = useState(false)
  const [panStart, setPanStart]     = useState(null)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [minimapCollapsed, setMinimapCollapsed] = useState(false)
  const containerRef = useRef(null)
  const contentRef = useRef(null)
  const minimapDragRef = useRef(false)

  const MM_W = 180
  const MM_H = 100

  const panToMinimapPoint = (mmX, mmY) => {
    if (!contentRef.current || !containerRef.current) return
    const contentRect = contentRef.current.getBoundingClientRect()
    const naturalW = contentRect.width / zoom
    const naturalH = contentRect.height / zoom
    if (naturalW <= 0 || naturalH <= 0) return
    const containerRect = containerRef.current.getBoundingClientRect()
    const contentX = (mmX / MM_W) * naturalW
    const contentY = (mmY / MM_H) * naturalH
    setPanOffset({
      x: containerRect.width  / 2 - contentX * zoom,
      y: containerRect.height / 2 - contentY * zoom,
    })
  }

  const getMinimapViewportRect = () => {
    if (!contentRef.current || !containerRef.current) return null
    const contentRect = contentRef.current.getBoundingClientRect()
    const naturalW = contentRect.width / zoom
    const naturalH = contentRect.height / zoom
    if (naturalW <= 0 || naturalH <= 0) return null
    const containerRect = containerRef.current.getBoundingClientRect()
    const visLeft = -panOffset.x / zoom
    const visTop  = -panOffset.y / zoom
    const visW = containerRect.width  / zoom
    const visH = containerRect.height / zoom
    return {
      x: Math.max(0, visLeft / naturalW * MM_W),
      y: Math.max(0, visTop  / naturalH * MM_H),
      w: Math.min(MM_W, visW  / naturalW * MM_W),
      h: Math.min(MM_H, visH  / naturalH * MM_H),
    }
  }

  const railOffsetCm  = settings.railOffsetCm  ?? DEFAULT_RAIL_OFFSET_CM
  const blockHeightCm = settings.blockHeightCm ?? 30
  const blockWidthCm  = settings.blockWidthCm  ?? 70
  const connOffsetCm  = settings.connOffsetCm  ?? 5
  const panelLengthCm = settings.panelLengthCm ?? 238.2

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.1 : 0.909
      setZoom(z => Math.max(0.25, Math.min(6, z * factor)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Highlight helpers
  const hlGroup = PARAM_GROUP[highlightParam] ?? null
  const hl = (group) => hlGroup === group

  if (!rc) return <div style={{ padding: '2rem', color: '#aaa' }}>Select a row to see its trapezoid detail</div>

  const { heightRear, heightFront, baseLength, angle, topBeamLength } = rc

  const SC         = 2.2
  const RAIL_CM    = railOffsetCm
  const BLOCK_H_CM = blockHeightCm

  const angleRad = angle * Math.PI / 180
  const bW      = baseLength   * SC
  const hR      = heightRear   * SC
  const hF      = heightFront  * SC
  // Rail offset projected: RAIL_CM is measured along slope
  const railOffH = RAIL_CM * Math.cos(angleRad) * SC  // horizontal projection
  const railOffV = RAIL_CM * Math.sin(angleRad) * SC  // vertical projection
  const blockH  = BLOCK_H_CM   * SC

  // Panel segments — one per line, or single fallback
  const segments = (panelLines && panelLines.length > 0)
    ? panelLines
    : [{ depthCm: panelLengthCm, gapBeforeCm: 0 }]
  const totalPanelDepthCm = segments.reduce((s, seg) => s + seg.gapBeforeCm + seg.depthCm, 0)

  const padL = Math.max(120, railOffH + 40)
  // padR must cover panel extension beyond front leg
  const panelExtCm = (totalPanelDepthCm - RAIL_CM) * Math.cos(angleRad) - baseLength
  const padR = Math.max(100, panelExtCm * SC + 70)
  const padT = 55
  const padB = blockH + 120

  const svgW = bW + padL + padR
  const svgH = hF + padT + padB

  const baseY     = hF + padT
  const topY0     = baseY - hR
  const topY1     = baseY - hF
  const blockBotY = baseY + blockH

  const x0 = padL
  const x1 = padL + bW

  const slope   = (topY1 - topY0) / bW
  // Panel rear edge: RAIL_CM before the rear leg along the slope
  const panelX1 = x0 - railOffH
  const panelY1 = topY0 + railOffV
  // Helper: screen coords at slope distance d (cm) from panelX1/Y1
  const atSlope = (dCm) => ({
    x: panelX1 + dCm * Math.cos(angleRad) * SC,
    y: panelY1 - dCm * Math.sin(angleRad) * SC,
  })
  // Panel front edge: at totalPanelDepthCm along slope from rear edge
  const { x: panelX2, y: panelY2 } = atSlope(totalPanelDepthCm)

  const beamY = (x) => topY0 + slope * (x - x0)

  // Cross-rails: 2 per panel segment (line).
  // If the panel edge is outside the beam, snap the rail to the beam end + connOffsetCm.
  // If the panel edge is inside the beam (middle gap), use panel edge ± connOffsetCm.
  const beamOffX = connOffsetCm * SC * Math.cos(angleRad)
  const railXs = (() => {
    const xs = []
    let dCm = 0
    for (let si = 0; si < segments.length; si++) {
      const seg = segments[si]
      dCm += seg.gapBeforeCm
      const startX  = atSlope(dCm).x
      const endX    = atSlope(dCm + seg.depthCm).x
      const centerX = (startX + endX) / 2

      // For the outermost edges use panelX1/panelX2 so the snap matches what's drawn
      const leftEdge  = si === 0                    ? panelX1 : startX
      const rightEdge = si === segments.length - 1  ? panelX2 : endX

      // Initial placement: snap to beam end when panel overhangs, else panel edge
      let lcX = leftEdge  < x0 ? x0 + beamOffX : startX + beamOffX
      let rcX = rightEdge > x1 ? x1 - beamOffX : endX   - beamOffX

      // Symmetrize: use the rail closer to center as the reference distance
      const leftDist  = centerX - lcX
      const rightDist = rcX - centerX
      if (leftDist >= 0 && rightDist >= 0) {
        if (leftDist <= rightDist) {
          rcX = centerX + leftDist
        } else {
          lcX = centerX - rightDist
        }
      }

      xs.push(lcX)
      xs.push(rcX)
      dCm += seg.depthCm
    }
    return xs
  })()
  const rail1X = railXs[0] ?? x0
  const rail2X = railXs[railXs.length - 1] ?? x1

  // 40×40 mm profile: at SC pixels/cm → 4 cm × SC px
  const BEAM_THICK_PX = 4 * SC           // 40 mm in pixels = 8.8 px
  const PANEL_THICK_PX = 6               // panel visual thickness (px)
  // Panel is offset perpendicularly above the beam (skyward direction)
  // Skyward unit = (-sin, -cos) in SVG (y-down) coords
  const PANEL_OFFSET_PX = BEAM_THICK_PX / 2 + 10 + PANEL_THICK_PX / 2  // beam edge + gap + panel half
  const panOffX = -Math.sin(angleRad) * PANEL_OFFSET_PX
  const panOffY = -Math.cos(angleRad) * PANEL_OFFSET_PX

  const blockW  = blockWidthCm * SC
  const lb_x = x0 - blockW / 2, lb_w = blockW
  const rb_x = x1 - blockW / 2, rb_w = blockW

  // Colour palette — all dims are black, only TBD is gray
  const DC = '#222'      // black — all known dimensions
  const TC = '#aaa'      // gray  — TBD

  // Beam angle for bracket rotation
  const beamAngleDeg = Math.atan2(topY1 - topY0, x1 - x0) * 180 / Math.PI

  const Dim = ({ ax1, ay1, ax2, ay2, label, off = 12, tbd = false, fs = 8 }) => {
    const col = tbd ? TC : DC
    const mk  = tbd ? 't' : 'k'
    const dx = ax2 - ax1, dy = ay2 - ay1
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < 2) return null
    const nx = -dy / len * off, ny = dx / len * off
    const lx1 = ax1 + nx, ly1 = ay1 + ny
    const lx2 = ax2 + nx, ly2 = ay2 + ny
    const mx = (lx1 + lx2) / 2, my = (ly1 + ly2) / 2
    const ang = Math.atan2(dy, dx) * 180 / Math.PI
    const ta = ang > 90 || ang < -90 ? ang + 180 : ang
    return (
      <g>
        <line x1={ax1} y1={ay1} x2={lx1} y2={ly1} stroke={col} strokeWidth="0.5" />
        <line x1={ax2} y1={ay2} x2={lx2} y2={ly2} stroke={col} strokeWidth="0.5" />
        <line x1={lx1} y1={ly1} x2={lx2} y2={ly2} stroke={col} strokeWidth="0.8"
          markerStart={`url(#arr-${mk})`} markerEnd={`url(#arr-${mk})`} />
        <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle"
          fontSize={fs} fontWeight="600" fill={col}
          transform={`rotate(${ta} ${mx} ${my})`}
        >{tbd ? 'TBD' : label}</text>
      </g>
    )
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>

      {/* ── Zoom / pan area ── */}
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', overflow: 'hidden', cursor: isPanning ? 'grabbing' : 'grab' }}
        onMouseDown={e => { setIsPanning(true); setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y }) }}
        onMouseMove={e => { if (isPanning && panStart) setPanOffset({ x: e.clientX - panStart.x, y: e.clientY - panStart.y }) }}
        onMouseUp={() => { setIsPanning(false); setPanStart(null) }}
        onMouseLeave={() => { setIsPanning(false); setPanStart(null) }}
      >
        <div ref={contentRef} style={{
          transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          padding: '1rem 1.5rem',
          display: 'inline-block',
        }}>
          <div style={{ fontSize: '0.78rem', fontWeight: '700', color: '#555', marginBottom: '0.75rem' }}>
            Type {rc.typeLetter}{rc.panelsPerSpan} — {angle}° · Base {baseLength.toFixed(0)} cm · Front {heightFront.toFixed(1)} cm
          </div>

          <svg width={svgW} height={svgH} style={{ display: 'block', overflow: 'visible' }}>
            <defs>
              <marker id="arr-k" markerWidth="5" markerHeight="5" refX="2.5" refY="2.5" orient="auto">
                <path d="M0,0 L0,5 L5,2.5 z" fill={DC} />
              </marker>
              <marker id="arr-t" markerWidth="5" markerHeight="5" refX="2.5" refY="2.5" orient="auto">
                <path d="M0,0 L0,5 L5,2.5 z" fill={TC} />
              </marker>
              <style>{`@keyframes hlPulse { 0%,100%{opacity:0.15} 50%{opacity:0.9} }`}</style>
            </defs>

            {/* ── Structure (40×40 mm profile → BEAM_THICK_PX stroke) ── */}
            <line x1={x0} y1={baseY} x2={x1} y2={baseY} stroke="#404040" strokeWidth={BEAM_THICK_PX} strokeLinecap="square" />
            {hR > 0 && <line x1={x0} y1={topY0} x2={x0} y2={baseY} stroke="#404040" strokeWidth={BEAM_THICK_PX} strokeLinecap="square" />}
            <line x1={x1} y1={topY1} x2={x1} y2={baseY} stroke="#404040" strokeWidth={BEAM_THICK_PX} strokeLinecap="square" />
            <line x1={x0} y1={topY0} x2={x1} y2={topY1} stroke="#404040" strokeWidth={BEAM_THICK_PX} strokeLinecap="square" />
            <line x1={x0} y1={topY0} x2={x1} y2={baseY} stroke="#606060" strokeWidth={BEAM_THICK_PX * 0.75} strokeLinecap="square" />
            {/* Rail-clamp offset highlight: panel rear overhang region */}
            {hl('rail-clamp') && (
              <g style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }}>
                {/* Highlight the panel-rear-to-rear-leg span */}
                <line x1={panelX1} y1={panelY1} x2={x0} y2={topY0}
                  stroke="#FFB300" strokeWidth="8" strokeLinecap="round" opacity="0.6" />
                {/* Ring on the rear leg top where the clamp sits */}
                <circle cx={x0} cy={topY0} r={10} fill="none" stroke="#FFB300" strokeWidth="2.5" />
              </g>
            )}

            {/* ── Panel bars (one per line, offset above beam+rails) ── */}
            {(() => {
              let dCm = 0
              return segments.map((seg, idx) => {
                dCm += seg.gapBeforeCm
                const start = atSlope(dCm)
                dCm += seg.depthCm
                const end = atSlope(dCm)
                const cx  = (start.x + end.x) / 2 + panOffX
                const cy  = (start.y + end.y) / 2 + panOffY
                const len = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2)
                return (
                  <g key={idx}>
                    <rect
                      x={cx - len/2} y={cy - PANEL_THICK_PX/2}
                      width={len} height={PANEL_THICK_PX}
                      fill="#6a70ac" stroke="#293189" strokeWidth="1"
                      transform={`rotate(${beamAngleDeg}, ${cx}, ${cy})`}
                    />
                    {hl('panel') && (
                      <rect
                        x={cx - len/2 - 5} y={cy - PANEL_THICK_PX/2 - 5}
                        width={len + 10} height={PANEL_THICK_PX + 10}
                        fill="none" stroke="#FFB300" strokeWidth="2.5" rx="3"
                        transform={`rotate(${beamAngleDeg}, ${cx}, ${cy})`}
                        style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }}
                      />
                    )}
                  </g>
                )
              })
            })()}

            {/* ── Cross-rails 40×40mm profile (drawn on top of panel bars) ── */}
            {railXs.map((cx, ci) => {
              const cy = beamY(cx)
              const beamTop  = -BEAM_THICK_PX / 2
              const panBot   = -(PANEL_OFFSET_PX - PANEL_THICK_PX / 2)
              const RW = 4 * SC, RH = 4 * SC  // 40×40 mm profile (square)
              const midY = (beamTop + panBot) / 2
              // Distance along slope from beam start (x0)
              const distCm = Math.round((cx - x0) / (SC * Math.cos(angleRad)))
              // Label position: skyward above the rail
              const labelOffPx = PANEL_OFFSET_PX + PANEL_THICK_PX + 10
              const lx = cx + (-Math.sin(angleRad)) * labelOffPx
              const ly = cy + (-Math.cos(angleRad)) * labelOffPx
              return (
                <g key={ci}>
                  <g transform={`translate(${cx}, ${cy}) rotate(${beamAngleDeg})`}>
                    <rect x={-RW/2} y={midY - RH/2} width={RW} height={RH}
                      fill="#7c3aed" stroke="#642165" strokeWidth="1" />
                    {hl('cross-rails') && (
                      <rect x={-RW/2 - 5} y={midY - RH/2 - 5} width={RW + 10} height={RH + 10}
                        fill="none" stroke="#FFB300" strokeWidth="2.5" rx="3"
                        style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }} />
                    )}
                  </g>
                  {/* Distance from panel start, above the rail */}
                  <text x={lx} y={ly}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize="7.5" fontWeight="700" fill="#642165"
                    transform={`rotate(${beamAngleDeg}, ${lx}, ${ly})`}
                  >{distCm}</text>
                </g>
              )
            })}

            {/* ── Rail support profiles (vertical, beam → base) ── */}
            {/* Skip first and last — the trapezoid legs already support those edges */}
            {railXs.slice(1, -1).map((cx, ci) => {
              const sx = cx - 4 * Math.cos(angleRad) * SC  // 4 cm toward lower end
              const topY = beamY(sx)
              const lenCm = (baseY - topY) / SC
              return (
                <g key={ci}>
                  <line x1={sx} y1={topY} x2={sx} y2={baseY}
                    stroke="#404040" strokeWidth={BEAM_THICK_PX} strokeLinecap="square" />
                  <Dim ax1={sx} ay1={topY} ax2={sx} ay2={baseY}
                    label={lenCm.toFixed(1)} off={14} />
                </g>
              )
            })}

            {/* ── Blocks ── */}
            <rect x={lb_x} y={baseY} width={lb_w} height={blockH} fill="#c0c0c0" stroke="#777" strokeWidth="1" />
            <rect x={rb_x} y={baseY} width={rb_w} height={blockH} fill="#c0c0c0" stroke="#777" strokeWidth="1" />
            {hl('blocks') && (
              <g style={{ animation: 'hlPulse 0.75s ease-in-out infinite', pointerEvents: 'none' }}>
                <rect x={lb_x - 5} y={baseY - 5} width={lb_w + 10} height={blockH + 10}
                  fill="none" stroke="#FFB300" strokeWidth="2.5" rx="3" />
                <rect x={rb_x - 5} y={baseY - 5} width={rb_w + 10} height={blockH + 10}
                  fill="none" stroke="#FFB300" strokeWidth="2.5" rx="3" />
              </g>
            )}

            {/* ── Green floor line ── */}
            <line x1={panelX1 - 10} y1={blockBotY} x2={panelX2 + 20} y2={blockBotY}
              stroke="#3a9e3a" strokeWidth="2.5" strokeLinecap="round" />

            {/* ── Angle label at front leg top ── */}
            <text x={x1 + 8} y={topY1 + 14} fontSize="9" fill="#444" fontWeight="700">{angle}°</text>

            {/* ── Dimension annotations ── */}

            {/* Top beam length */}
            <Dim ax1={x0} ay1={topY0} ax2={x1} ay2={topY1}
              label={`${topBeamLength.toFixed(0)}`} off={-(PANEL_OFFSET_PX + 14)} />

            {/* Split dim: [panel start → conn1] · [conn1 → conn2] · [conn2 → panel end] */}
            {(() => {
              const splitOff = -(PANEL_OFFSET_PX + 30)
              const toCm = (dx) => Math.round(dx / SC / Math.cos(angleRad))
              return (<>
                <Dim ax1={panelX1} ay1={panelY1} ax2={rail1X} ay2={beamY(rail1X)}
                  label={`${toCm(rail1X - panelX1)}`} off={splitOff} />
                <Dim ax1={rail1X} ay1={beamY(rail1X)} ax2={rail2X} ay2={beamY(rail2X)}
                  label={`${toCm(rail2X - rail1X)}`} off={splitOff} />
                <Dim ax1={rail2X} ay1={beamY(rail2X)} ax2={panelX2} ay2={panelY2}
                  label={`${toCm(panelX2 - rail2X)}`} off={splitOff} />
              </>)
            })()}

            {/* Rear leg height alone (inner left) */}
            {hR > 0 && <Dim ax1={x0} ay1={topY0} ax2={x0} ay2={baseY}
              label={`${heightRear.toFixed(1)}`} off={-28} />}

            {/* Panel front edge height from floor (= panelFrontHeight user input) */}
            <Dim ax1={panelX1 + panOffX} ay1={blockBotY}
                 ax2={panelX1 + panOffX} ay2={panelY1 + panOffY}
              label={`${(BLOCK_H_CM + heightRear - RAIL_CM * Math.sin(angleRad)).toFixed(1)}`}
              off={-22} />

            {/* Block height (left of block) */}
            <Dim ax1={lb_x} ay1={baseY} ax2={lb_x} ay2={blockBotY}
              label={`${BLOCK_H_CM}`} off={-14} />

            {/* Front leg height alone (right inner) */}
            <Dim ax1={x1} ay1={baseY} ax2={x1} ay2={topY1}
              label={`${heightFront.toFixed(1)}`} off={38} />

            {/* Block + front leg total (far right) */}
            <Dim ax1={x1} ay1={blockBotY} ax2={x1} ay2={topY1}
              label={`${(BLOCK_H_CM + heightFront).toFixed(1)}`} off={55} />

            {/* ── TBD section (bottom — rail cut schedule) ── */}
            {[0, 1].map(row => {
              const ry = blockBotY + 12 + row * 28
              return (
                <g key={row}>
                  <rect x={x0 - railOffH} y={ry} width={bW + 2 * railOffH} height={22}
                    fill="#f6f6f6" stroke="#ccc" strokeWidth="1" strokeDasharray="4,3" rx="3" />
                  <text x={x0 - railOffH + (bW + 2 * railOffH) / 2} y={ry + 11}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize="9" fill="#bbb" fontWeight="700">TBD</text>
                </g>
              )
            })}
          </svg>

          {/* Members table */}
          <div style={{ marginTop: '1.5rem', maxWidth: '340px' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>Members per trapezoid</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ background: '#f5f5f5' }}>
                  <th style={{ textAlign: 'left', padding: '0.3rem 0.5rem', fontWeight: '700', color: '#555' }}>Element</th>
                  <th style={{ textAlign: 'right', padding: '0.3rem 0.5rem', fontWeight: '700', color: '#555' }}>Length (cm)</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Base beam',  rc.baseLength],
                  ['Top beam',   rc.topBeamLength],
                  ['Rear leg',   rc.heightRear],
                  ['Front leg',  rc.heightFront],
                  ['Diagonal',   rc.diagonalLength],
                ].map(([name, val]) => (
                  <tr key={name} style={{ borderTop: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '0.3rem 0.5rem', color: '#444' }}>{name}</td>
                    <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', fontWeight: '600', color: '#222' }}>{val.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Floating right panel ── */}
      <div style={{
        position: 'absolute', top: '16px', right: '16px', zIndex: 10,
        width: panelCollapsed ? '36px' : '190px',
        background: 'white', borderRadius: '10px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
        border: '1px solid #e0e0e0', overflow: 'hidden',
        transition: 'width 0.18s',
      }} onMouseDown={e => e.stopPropagation()}>
        <div onClick={() => setPanelCollapsed(c => !c)} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0.5rem 0.65rem', cursor: 'pointer', background: '#fafafa',
          borderBottom: panelCollapsed ? 'none' : '1px solid #f0f0f0',
        }}>
          {!panelCollapsed && <span style={{ fontSize: '0.68rem', fontWeight: '700', color: '#555', whiteSpace: 'nowrap' }}>Display</span>}
          <span style={{ fontSize: '0.75rem', color: '#aaa', marginLeft: 'auto' }}>{panelCollapsed ? '◀' : '▶'}</span>
        </div>
        {!panelCollapsed && (
          <div style={{ padding: '0.6rem 0.75rem' }}>
            <div style={{ fontSize: '0.63rem', fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.35rem' }}>Zoom — {Math.round(zoom * 100)}%</div>
            <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.2rem' }}>
              {[['−', () => setZoom(z => Math.max(0.25, z * 0.833))], ['100%', () => { setZoom(1); setPanOffset({ x: 0, y: 0 }) }], ['+', () => setZoom(z => Math.min(6, z * 1.2))]].map(([lbl, fn]) => (
                <button key={lbl} onClick={fn} style={{ flex: 1, padding: '0.3rem 0', background: 'white', color: '#666', border: '1px solid #ddd', borderRadius: '5px', cursor: 'pointer', fontWeight: '600', fontSize: '0.72rem' }}>{lbl}</button>
              ))}
            </div>
            <div style={{ fontSize: '0.63rem', color: '#ccc' }}>Scroll to zoom</div>

            {/* Minimap Navigator — shown only when zoomed in */}
            {zoom > 1 && (
              <div style={{ marginTop: '0.5rem' }}>
                <div
                  onClick={() => setMinimapCollapsed(c => !c)}
                  style={{ fontSize: '0.58rem', fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.2rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                >
                  <span>Navigator</span>
                  <span style={{ fontSize: '0.52rem' }}>{minimapCollapsed ? '▲' : '▼'}</span>
                </div>
                {!minimapCollapsed && (
                  <div
                    style={{ width: MM_W, height: MM_H, borderRadius: '5px', overflow: 'hidden', cursor: 'crosshair', boxShadow: '0 1px 5px rgba(0,0,0,0.18)', position: 'relative', background: '#1e2433' }}
                    onMouseDown={(e) => { minimapDragRef.current = true; const r = e.currentTarget.getBoundingClientRect(); panToMinimapPoint(e.clientX - r.left, e.clientY - r.top) }}
                    onMouseMove={(e) => { if (!minimapDragRef.current) return; const r = e.currentTarget.getBoundingClientRect(); panToMinimapPoint(e.clientX - r.left, e.clientY - r.top) }}
                    onMouseUp={() => { minimapDragRef.current = false }}
                    onMouseLeave={() => { minimapDragRef.current = false }}
                  >
                    <svg width={MM_W} height={MM_H} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
                      {(() => { const vr = getMinimapViewportRect(); if (!vr) return null; return <rect x={vr.x} y={vr.y} width={vr.w} height={vr.h} fill="rgba(255,255,255,0.08)" stroke="white" strokeWidth="1.5" strokeDasharray="3,2" /> })()}
                    </svg>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  )
}

// ─── BOM view ────────────────────────────────────────────────────────────────

function BOMView({ rowConstructions }) {
  const bom = useMemo(() => buildBOM(rowConstructions), [rowConstructions])
  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ fontSize: '0.7rem', fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>Bill of Materials</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
        <thead>
          <tr style={{ background: '#f5f5f5' }}>
            <th style={{ textAlign: 'left', padding: '0.4rem 0.75rem', fontWeight: '700', color: '#444' }}>Element</th>
            <th style={{ textAlign: 'right', padding: '0.4rem 0.75rem', fontWeight: '700', color: '#444' }}>Length (cm)</th>
            <th style={{ textAlign: 'right', padding: '0.4rem 0.75rem', fontWeight: '700', color: '#444' }}>Qty</th>
            <th style={{ textAlign: 'right', padding: '0.4rem 0.75rem', fontWeight: '700', color: '#444' }}>Total (cm)</th>
          </tr>
        </thead>
        <tbody>
          {bom.map((item, i) => (
            <tr key={i} style={{ borderTop: '1px solid #f0f0f0', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
              <td style={{ padding: '0.4rem 0.75rem', color: '#333' }}>{item.type}</td>
              <td style={{ padding: '0.4rem 0.75rem', textAlign: 'right', color: '#555' }}>{item.lengthCm.toFixed(1)}</td>
              <td style={{ padding: '0.4rem 0.75rem', textAlign: 'right', fontWeight: '700', color: '#222' }}>{item.quantity}</td>
              <td style={{ padding: '0.4rem 0.75rem', textAlign: 'right', fontWeight: '600', color: '#5a6600' }}>{(item.lengthCm * item.quantity / 100).toFixed(2)} m</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ background: '#f0f0f0', fontWeight: '700' }}>
            <td colSpan={3} style={{ padding: '0.4rem 0.75rem', color: '#333' }}>Total linear meters</td>
            <td style={{ padding: '0.4rem 0.75rem', textAlign: 'right', color: '#222' }}>
              {(bom.reduce((s, r) => s + r.lengthCm * r.quantity, 0) / 100).toFixed(2)} m
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ─── Main Step4 component ────────────────────────────────────────────────────

export default function Step4ConstructionPlanning({ panels = [], refinedArea, trapezoidConfigs = {}, areas = [], initialGlobalSettings = null, initialAreaSettings = null, onSettingsChange }) {
  const [selectedRowIdx, setSelectedRowIdx] = useState(0)     // index into rowKeys (area)
  const [selectedTrapezoidId, setSelectedTrapezoidId] = useState(null) // e.g. "A1"
  const [activeTab, setActiveTab] = useState('detail')
  const [globalSettings, setGlobalSettings] = useState(() => initialGlobalSettings ?? SETTINGS_DEFAULTS)
  const [areaSettings,   setAreaSettings]   = useState(() => initialAreaSettings   ?? {})
  const [highlightParam, setHighlightParam] = useState(null)

  // Sync settings back to App whenever they change (for export persistence)
  useEffect(() => {
    onSettingsChange?.(globalSettings, areaSettings)
  }, [globalSettings, areaSettings])

  const getSettings = (areaIdx) => ({ ...globalSettings, ...(areaSettings[areaIdx] || {}) })

  // Area label: use area group label if available (e.g. "A")
  const areaLabel = (areaKey, i) => {
    const g = areas[areaKey]?.label
    return g ? `${g}` : `Area ${i + 1}`
  }

  const updateSetting = (areaIdx, key, value) => {
    setAreaSettings(prev => ({
      ...prev,
      [areaIdx]: { ...(prev[areaIdx] || {}), [key]: value }
    }))
  }

  const applySection = (rowIdx, keys) => {
    const vals = {}
    const s = getSettings(rowIdx)
    keys.forEach(k => { vals[k] = s[k] })
    setGlobalSettings(prev => ({ ...prev, ...vals }))
    setAreaSettings(prev => {
      const next = {}
      for (const i of Object.keys(prev)) {
        const copy = { ...prev[i] }
        keys.forEach(k => delete copy[k])
        next[i] = copy
      }
      return next
    })
  }

  // Group panels by area index
  const rowPanelCounts = useMemo(() => {
    const map = {}
    panels.forEach(p => {
      const key = (p.area ?? p.row) ?? 'unassigned'
      map[key] = (map[key] || 0) + 1
    })
    return map
  }, [panels])

  const rowKeys = useMemo(() =>
    Object.keys(rowPanelCounts).filter(k => k !== 'unassigned').map(Number).sort((a, b) => a - b),
    [rowPanelCounts]
  )
  const rowLabels = rowKeys.map((rk, i) => areaLabel(rk, i))

  // Map: areaKey → sorted array of trapezoidIds
  const areaTrapezoidMap = useMemo(() => {
    const map = {}
    rowKeys.forEach(areaKey => {
      const letter = String.fromCharCode(65 + areaKey)
      const ids = [...new Set(
        panels
          .filter(p => (p.area ?? p.row) === areaKey)
          .map(p => p.trapezoidId)
          .filter(Boolean)
      )].sort()
      map[areaKey] = ids.length > 0 ? ids : [`${letter}1`]
    })
    return map
  }, [panels, rowKeys])

  // Auto-select first trapezoid when area changes or on mount
  const effectiveSelectedTrapId = selectedTrapezoidId ??
    (rowKeys[selectedRowIdx] != null ? (areaTrapezoidMap[rowKeys[selectedRowIdx]]?.[0] ?? null) : null)

  // Compute construction for each area
  const rowConstructions = useMemo(() => {
    const pixelToCmRatio = refinedArea?.pixelToCmRatio || null
    const rcs = rowKeys.map((areaKey, i) => {
      const panelCount = rowPanelCounts[areaKey] || 1
      const globalCfg = refinedArea?.panelConfig || {}
      // Look up trapezoidConfig by trapezoidId (e.g. "A1" for area 0)
      const trapId = `${String.fromCharCode(65 + areaKey)}1`
      const override = trapezoidConfigs[trapId] || {}
      const angle = override.angle ?? globalCfg.angle ?? 0
      // panelFrontH = panel front edge height from floor (user input)
      // frontLegH   = trapezoid front (lower) leg height above block (derived)
      const panelFrontH = override.frontHeight ?? globalCfg.frontHeight ?? 0
      const s = getSettings(i)
      const railOverhang = s.railOverhangCm
      const maxSpan      = s.maxSpanCm
      const frontLegH = Math.max(0, panelFrontH - s.blockHeightCm + s.railOffsetCm * Math.sin(angle * Math.PI / 180))

      // Derive actual row length and line depth from placed panel positions
      let measuredRowLength, measuredLineDepth
      if (pixelToCmRatio) {
        const rowPanels = panels.filter(p => (p.area ?? p.row ?? 'unassigned') === areaKey)
        const rl = rowPanels.length > 0 ? computeRowRailLayout(rowPanels, pixelToCmRatio) : null
        if (rl?.frame?.localBounds) {
          const { minX, maxX, minY, maxY } = rl.frame.localBounds
          measuredRowLength = (maxX - minX) * pixelToCmRatio + 2 * railOverhang
          measuredLineDepth = (maxY - minY) * pixelToCmRatio
        }
      }

      return computeRowConstruction(panelCount, angle, frontLegH, {
        railOverhang,
        maxSpan,
        ...(measuredRowLength != null ? { rowLength: measuredRowLength } : {}),
        ...(measuredLineDepth != null ? { lineDepthCm: measuredLineDepth } : {}),
      })
    })
    return assignTypes(rcs)
  }, [rowKeys, rowPanelCounts, refinedArea, trapezoidConfigs, areaSettings, globalSettings, panels])

  const selectedRC = rowConstructions[selectedRowIdx] ?? null

  // Per-trapezoid construction for detail view (uses effectiveSelectedTrapId's config)
  const selectedTrapezoidRC = useMemo(() => {
    if (selectedRowIdx == null) return null
    const areaKey = rowKeys[selectedRowIdx]
    if (areaKey == null) return null
    const trapId = effectiveSelectedTrapId
    if (!trapId) return null

    const trapPanels = panels.filter(p =>
      (p.area ?? p.row) === areaKey && p.trapezoidId === trapId
    )
    const panelCount = trapPanels.length || 1
    const globalCfg = refinedArea?.panelConfig || {}
    const override = trapezoidConfigs[trapId] || {}
    const angle = override.angle ?? globalCfg.angle ?? 0
    const panelFrontH = override.frontHeight ?? globalCfg.frontHeight ?? 0
    const s = getSettings(selectedRowIdx)
    const railOverhang = s.railOverhangCm
    const maxSpan = s.maxSpanCm
    const frontLegH = Math.max(0, panelFrontH - s.blockHeightCm + s.railOffsetCm * Math.sin(angle * Math.PI / 180))

    const pixelToCmRatio = refinedArea?.pixelToCmRatio || null
    let measuredRowLength, measuredLineDepth
    if (pixelToCmRatio && trapPanels.length > 0) {
      const rl = computeRowRailLayout(trapPanels, pixelToCmRatio)
      if (rl?.frame?.localBounds) {
        const { minX, maxX, minY, maxY } = rl.frame.localBounds
        measuredRowLength = (maxX - minX) * pixelToCmRatio + 2 * railOverhang
        measuredLineDepth = (maxY - minY) * pixelToCmRatio
      }
    }

    const [rc] = assignTypes([computeRowConstruction(panelCount, angle, frontLegH, {
      railOverhang,
      maxSpan,
      ...(measuredRowLength != null ? { rowLength: measuredRowLength } : {}),
      ...(measuredLineDepth != null ? { lineDepthCm: measuredLineDepth } : {}),
    })])
    return rc
  }, [effectiveSelectedTrapId, selectedRowIdx, rowKeys, panels, refinedArea, trapezoidConfigs, areaSettings, globalSettings])

  // Per-line depth info for the selected row (for multi-line panel drawing)
  const selectedRowLineDepths = useMemo(() => {
    const pixelToCmRatio = refinedArea?.pixelToCmRatio || null
    if (!pixelToCmRatio || selectedRowIdx == null) return null
    const rowKey = rowKeys[selectedRowIdx]
    if (rowKey == null) return null
    // Filter to selected trapezoid if one is active, otherwise all panels in area
    const rowPanels = effectiveSelectedTrapId
      ? panels.filter(p => (p.area ?? p.row ?? 'unassigned') === rowKey && p.trapezoidId === effectiveSelectedTrapId)
      : panels.filter(p => (p.area ?? p.row ?? 'unassigned') === rowKey)
    if (rowPanels.length === 0) return null
    const rl = computeRowRailLayout(rowPanels, pixelToCmRatio)
    if (!rl) return null

    const lineMap = {}
    for (const pr of rl.panelLocalRects) {
      const li = pr.line ?? 0
      if (!lineMap[li]) lineMap[li] = { minY: Infinity, maxY: -Infinity }
      lineMap[li].minY = Math.min(lineMap[li].minY, pr.localY)
      lineMap[li].maxY = Math.max(lineMap[li].maxY, pr.localY + pr.height)
    }

    const sorted = Object.entries(lineMap)
      .map(([li, b]) => ({ lineIdx: Number(li), ...b }))
      .sort((a, b) => a.lineIdx - b.lineIdx)

    return sorted.map((line, i) => ({
      depthCm:      (line.maxY - line.minY)                    * pixelToCmRatio,
      gapBeforeCm:  i === 0 ? 0 : (line.minY - sorted[i-1].maxY) * pixelToCmRatio,
    }))
  }, [panels, refinedArea, selectedRowIdx, rowKeys])

  const tabs = [
    { key: 'detail', label: 'Trapezoids Details' },
    { key: 'rails',  label: 'Rails Layout' },
    { key: 'bases',  label: 'Bases Layout' },
    { key: 'layout', label: 'Trapezoid Layout' },
    { key: 'rows',   label: 'Row Dimensions' },
    { key: 'bom',    label: 'Bill of Materials' },
  ]

  if (rowKeys.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#aaa', fontSize: '0.95rem' }}>
        No panel areas found — complete Step 3 first.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: 'white' }}>
      <style>{`@keyframes hlPulse { 0%,100%{opacity:0.15} 50%{opacity:0.9} }`}</style>

      {/* ── Left sidebar ── */}
      <div style={{
        width: '260px', flexShrink: 0, borderRight: '1px solid #e8e8e8',
        display: 'flex', flexDirection: 'column', overflowY: 'auto',
        background: '#fafafa'
      }}>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e8e8e8' }}>
          <div style={{ fontSize: '0.65rem', fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Areas</div>
        </div>

        {/* Area / trapezoid hierarchy list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {rowConstructions.map((rc, i) => {
            const areaKey = rowKeys[i]
            const trapIds = areaTrapezoidMap[areaKey] || []
            const isAreaSelected = selectedRowIdx === i
            return (
              <div key={i}>
                {/* Area header */}
                <div
                  onClick={() => {
                    setSelectedRowIdx(i)
                    setSelectedTrapezoidId(areaTrapezoidMap[areaKey]?.[0] ?? null)
                  }}
                  style={{
                    padding: '0.6rem 1rem', cursor: 'pointer',
                    borderBottom: trapIds.length > 1 ? 'none' : '1px solid #f0f0f0',
                    background: isAreaSelected ? '#f4f9e4' : 'transparent',
                    borderLeft: `3px solid ${isAreaSelected ? ACCENT : 'transparent'}`,
                    transition: 'all 0.12s'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.84rem', fontWeight: '700', color: isAreaSelected ? '#333' : '#555' }}>
                      {areaLabel(areaKey, i)}
                    </span>
                    <span style={{
                      fontSize: '0.72rem', fontWeight: '800', color: 'white',
                      background: '#555', borderRadius: '4px', padding: '1px 6px'
                    }}>{rc.typeLetter}{rc.panelsPerSpan}</span>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#888', marginTop: '2px' }}>
                    {rc.panelCount} panels · {rc.angle}° · {rc.numTrapezoids} frames
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#888' }}>
                    Rail: {(rc.rowLength / 100).toFixed(2)} m
                  </div>
                </div>
                {/* Trapezoid children (when area has multiple trapezoids) */}
                {trapIds.length > 1 && isAreaSelected && (
                  <div style={{ borderBottom: '1px solid #f0f0f0', background: '#f5f7f0' }}>
                    {trapIds.map(trapId => {
                      const isTrapSelected = effectiveSelectedTrapId === trapId
                      const count = panels.filter(p =>
                        (p.area ?? p.row) === areaKey && p.trapezoidId === trapId
                      ).length
                      return (
                        <div
                          key={trapId}
                          onClick={e => { e.stopPropagation(); setSelectedTrapezoidId(trapId) }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                            padding: '0.35rem 1rem 0.35rem 1.5rem', cursor: 'pointer',
                            borderLeft: `3px solid ${isTrapSelected ? ACCENT : 'transparent'}`,
                            background: isTrapSelected ? '#edf5d8' : 'transparent',
                            transition: 'all 0.1s'
                          }}
                        >
                          <span style={{
                            fontSize: '0.72rem', fontWeight: '700',
                            color: isTrapSelected ? '#5a6600' : '#888',
                            background: isTrapSelected ? '#ddeea0' : '#e8e8e8',
                            padding: '1px 7px', borderRadius: '10px'
                          }}>{trapId}</span>
                          <span style={{ fontSize: '0.7rem', color: '#aaa' }}>{count} panels</span>
                          {!!trapezoidConfigs[trapId] && (
                            <span title="Custom config" style={{
                              width: '5px', height: '5px', borderRadius: '50%',
                              background: '#FF9800', marginLeft: 'auto', flexShrink: 0
                            }} />
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ── Settings sections (per-row, grouped by tab) ── */}
        {selectedRC && (() => {
          const s = getSettings(selectedRowIdx)
          const isOverride = (key) => !!(areaSettings[selectedRowIdx] && key in areaSettings[selectedRowIdx])

          const numInput = (key, step = 1, min) => (
            <input type="number" value={s[key]} step={step} min={min}
              onChange={e => updateSetting(selectedRowIdx, key, parseFloat(e.target.value) || 0)}
              onFocus={() => setHighlightParam(key)}
              onBlur={() => setHighlightParam(null)}
              style={{ width: '100%', padding: '0.22rem 0.4rem', boxSizing: 'border-box',
                border: `1px solid ${isOverride(key) ? '#FFB74D' : '#ddd'}`,
                borderRadius: '4px', fontSize: '0.78rem', fontWeight: isOverride(key) ? '700' : '400' }} />
          )

          const field = (label, key, step, min) => {
            const isActive = highlightParam === key
            return (
              <div key={key} style={{ marginBottom: '0.45rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.65rem', color: isActive ? '#d97706' : '#888', fontWeight: isActive ? '700' : '400', marginBottom: '2px', transition: 'color 0.2s' }}>
                  {isActive && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#FFB300', display: 'inline-block', flexShrink: 0, animation: 'hlPulse 0.75s ease-in-out infinite' }} />}
                  {label}
                </div>
                {numInput(key, step, min)}
              </div>
            )
          }

          const applyBtn = (keys) => (
            <button onClick={() => applySection(selectedRowIdx, keys)}
              style={{ width: '100%', marginTop: '0.35rem', padding: '0.2rem',
                fontSize: '0.65rem', fontWeight: '600', color: '#888',
                background: '#f5f5f5', border: '1px solid #e0e0e0',
                borderRadius: '4px', cursor: 'pointer' }}>
              Apply to all rows
            </button>
          )

          const SECTIONS = [
            {
              tabKey: 'detail', label: 'Trapezoids',
              keys: ['railOffsetCm','connOffsetCm','panelLengthCm','blockHeightCm','blockWidthCm','connEdgeDistMm','connMinPortrait','connMinLandscape'],
              fields: [
                ['Rail Clamp Offset (cm)', 'railOffsetCm', 0.1, 0],
                ['Cross-Rail Offset (cm)', 'connOffsetCm',  0.5, 0],
                ['Panel Length (cm)',      'panelLengthCm', 0.1, 10],
                ['Block Height (cm)',      'blockHeightCm', 1,   1],
                ['Block Width (cm)',       'blockWidthCm',  1,   1],
                ['Rail Edge Dist (mm)',    'connEdgeDistMm',5,   0],
                ['Min Rails Portrait',     'connMinPortrait',1,  1],
                ['Min Rails Landscape',    'connMinLandscape',1, 1],
              ],
            },
            {
              tabKey: 'rails', label: 'Rails',
              keys: ['railOverhangCm','stockLengths'],
              fields: [
                ['Rail Overhang (cm)', 'railOverhangCm', 0.5, 0],
              ],
            },
            {
              tabKey: 'bases', label: 'Bases',
              keys: ['edgeOffsetMm','spacingMm','maxSpanCm'],
              fields: [
                ['Edge Offset (mm)',  'edgeOffsetMm', 10,  0],
                ['Base Spacing (mm)', 'spacingMm',    50, 100],
                ['Max Span (cm)',     'maxSpanCm',     5,  50],
              ],
            },
          ]

          return SECTIONS.map(sec => {
            const isOpen = activeTab === sec.tabKey
            return (
              <div key={sec.tabKey} style={{ borderTop: '1px solid #e8e8e8' }}>
                <div onClick={() => setActiveTab(isOpen ? activeTab : sec.tabKey)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '0.5rem 1rem', cursor: 'pointer',
                    background: isOpen ? '#f0f4e8' : '#fafafa' }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: '700', color: isOpen ? '#5a6600' : '#888',
                    textTransform: 'uppercase', letterSpacing: '0.06em' }}>{sec.label}</span>
                  <span style={{ fontSize: '0.8rem', color: '#aaa' }}>{isOpen ? '▲' : '▼'}</span>
                </div>
                {isOpen && (
                  <div style={{ padding: '0.6rem 1rem 0.75rem' }}>
                    {sec.fields.map(([lbl, key, step, min]) => field(lbl, key, step, min))}
                    {sec.tabKey === 'rails' && (
                      <div style={{ marginBottom: '0.45rem' }}>
                        <div style={{ fontSize: '0.65rem', color: '#888', marginBottom: '2px' }}>Stock Lengths (mm)</div>
                        <input type="text"
                          value={(s.stockLengths || []).join(', ')}
                          onChange={e => updateSetting(selectedRowIdx, 'stockLengths',
                            e.target.value.split(',').map(v => parseInt(v.trim(), 10)).filter(n => n > 0))}
                          onFocus={() => setHighlightParam('stockLengths')}
                          onBlur={() => setHighlightParam(null)}
                          placeholder="e.g. 4800, 6000"
                          style={{ width: '100%', padding: '0.22rem 0.4rem', boxSizing: 'border-box',
                            border: `1px solid ${isOverride('stockLengths') ? '#FFB74D' : '#ddd'}`,
                            borderRadius: '4px', fontSize: '0.78rem' }} />
                      </div>
                    )}
                    {applyBtn(sec.keys)}
                  </div>
                )}
              </div>
            )
          })
        })()}
      </div>

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Tab bar */}
        <div style={{
          display: 'flex', borderBottom: '2px solid #e8e8e8',
          background: '#f8f9fa', padding: '0 1rem', gap: '0.25rem'
        }}>
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '0.55rem 1rem', border: 'none', cursor: 'pointer',
                fontSize: '0.8rem', fontWeight: '600',
                background: activeTab === tab.key ? 'white' : 'transparent',
                color: activeTab === tab.key ? '#333' : '#888',
                borderBottom: activeTab === tab.key ? `2px solid ${ACCENT}` : '2px solid transparent',
                marginBottom: '-2px', transition: 'all 0.15s'
              }}
            >{tab.label}</button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {activeTab === 'layout' && <div style={{ height: '100%', overflowY: 'auto' }}><LayoutView rowConstructions={rowConstructions} rowLabels={rowLabels} selectedIdx={selectedRowIdx} onSelectRow={i => { setSelectedRowIdx(i) }} highlightParam={highlightParam} /></div>}
          {activeTab === 'rows'   && <div style={{ height: '100%', overflowY: 'auto' }}><RowsView rowConstructions={rowConstructions} rowLabels={rowLabels} highlightParam={highlightParam} /></div>}
          {activeTab === 'detail' && <div style={{ height: '100%', overflow: 'hidden' }}><DetailView rc={selectedTrapezoidRC ?? selectedRC} panelLines={selectedRowLineDepths} settings={getSettings(selectedRowIdx)} highlightParam={highlightParam} /></div>}
          {activeTab === 'bom'    && <div style={{ height: '100%', overflowY: 'auto' }}><BOMView rowConstructions={rowConstructions} /></div>}
          {activeTab === 'rails'  && <div style={{ height: '100%', overflow: 'hidden' }}><RailLayoutTab panels={panels} refinedArea={refinedArea} selectedRowIdx={selectedRowIdx} settings={getSettings(selectedRowIdx)} highlightGroup={PARAM_GROUP[highlightParam] ?? null} /></div>}
          {/* Bases tab: kept mounted to preserve zoom/pan state */}
          <div style={{ display: activeTab === 'bases' ? 'flex' : 'none', height: '100%', flexDirection: 'column' }}>
            <BasesPlanTab panels={panels} refinedArea={refinedArea} selectedRowIdx={selectedRowIdx} rowConstructions={rowConstructions} settings={getSettings(selectedRowIdx)} highlightGroup={PARAM_GROUP[highlightParam] ?? null} />
          </div>
        </div>
      </div>
    </div>
  )
}
