import { useRef, useState, useCallback, useEffect } from 'react'
import { BLACK, DANGER, AMBER, BORDER, PRIMARY } from '../../../styles/colors'
import { baseScreenCoords, resolveAreaContext } from './basePlanHelpers'
import { parseVariationTrapId, getExtensionForBase, variationLabel as deriveVariationLabel } from '../../../utils/trapExtensionService'

const GRIP_RADIUS_SVG = 4
const READOUT_OFFSET_SVG = 14
const EDITOR_LIFETIME_MS = 3000  // popover auto-dismisses after ~3s of inactivity
const SLOPE_DEFAULT_ANGLE_DEG = 0 // fallback when trap geometry lacks angle

type ExtendTarget =
  | { scope: 'base'; areaId: string | number; baseId: string }
  | { scope: 'row';  areaId: string | number; rowIdx: number }
  | { scope: 'area'; areaId: string | number }

type ExtendOp = {
  op: 'extend'
  target: ExtendTarget
  frontExtMm: number
  backExtMm: number
}

type Props = {
  beBasesData: any[] | null
  beTrapezoidsData: Record<string, any> | null
  areaFrames: Record<string, any>
  areaTrapsMap: Record<string | number, string[]>
  trapAreaMap: Record<string, string | number>
  customBasesMap: Record<string, number[]>
  effectiveSelectedTrapId: string | null
  pixelToCmRatio: number
  sc: number
  zoom: number
  toSvg: (sx: number, sy: number) => number[]
  onExtend: (op: ExtendOp) => void
}

/**
 * Endpoint grips for the bases edit bar (extend operation).
 *
 * Renders two SVG grips on every base — one at each slope-axis end — that
 * the user can drag to extend the front (eave-side) or back (ridge-side)
 * of the beam. Live readout chip during drag shows the absolute values in
 * mm. On release fires a TrapExtendOp(scope='base') for the parent host
 * to queue.
 *
 * v1 scope: scope='base' only (single base per drag). Fan-out via the
 * EditScopeChip is a follow-up.
 */
export default function BaseEndpointGrips({
  beBasesData,
  beTrapezoidsData,
  areaFrames,
  areaTrapsMap,
  trapAreaMap,
  customBasesMap,
  effectiveSelectedTrapId,
  pixelToCmRatio,
  sc,
  zoom,
  toSvg,
  onExtend,
}: Props) {
  const dragging = useRef<null | {
    baseId: string
    parentTrapId: string
    end: 'front' | 'back'
    startClientX: number
    startClientY: number
    axis: { x: number; y: number }      // unit vector along base in SVG plane
    initialFrontMm: number
    initialBackMm: number
    cosAngle: number                    // trap slope angle: drag delta is in
                                         // slope-axis cm, but the stored value
                                         // is HORIZONTAL mm — convert × cos(a).
    frontEnd: [number, number]          // SVG coords (for preview rendering)
    backEnd: [number, number]
  }>(null)

  const [livePreview, setLivePreview] = useState<null | {
    baseId: string
    anchor: [number, number]
    frontMm: number
    backMm: number
    parentTrapId: string
    // Preview overlay: where the new endpoint will be after this drag.
    previewEnd: [number, number]
    staticEnd: [number, number]
  }>(null)

  // Numeric input popover anchored to the most recently edited base; stays
  // open after drag-release so the user can type precise values. Auto-
  // dismisses after EDITOR_LIFETIME_MS unless the user engages with it.
  const [editor, setEditor] = useState<null | {
    baseId: string
    areaId: string | number
    rowIdx: number             // for scope='row' button
    parentTrapId: string
    anchor: [number, number]   // SVG coords near the base's front end
    frontMm: number
    backMm: number
  }>(null)
  const editorTimerRef = useRef<number | null>(null)
  const scheduleEditorDismiss = useCallback(() => {
    if (editorTimerRef.current != null) window.clearTimeout(editorTimerRef.current)
    editorTimerRef.current = window.setTimeout(() => {
      setEditor(null)
      editorTimerRef.current = null
    }, EDITOR_LIFETIME_MS) as unknown as number
  }, [])
  useEffect(() => () => {
    if (editorTimerRef.current != null) window.clearTimeout(editorTimerRef.current)
  }, [])

  const onGripMouseDown = useCallback((
    e: React.MouseEvent,
    base: any,
    parentTrapId: string,
    end: 'front' | 'back',
    axis: { x: number; y: number },
    initialFrontMm: number,
    initialBackMm: number,
    cosAngle: number,
    frontEnd: [number, number],
    backEnd: [number, number],
  ) => {
    e.preventDefault()
    e.stopPropagation()
    dragging.current = {
      baseId: base.baseId,
      parentTrapId,
      end,
      startClientX: e.clientX,
      startClientY: e.clientY,
      axis,
      initialFrontMm,
      initialBackMm,
      cosAngle,
      frontEnd,
      backEnd,
    }
    setLivePreview({
      baseId: base.baseId,
      anchor: end === 'front' ? frontEnd : backEnd,
      frontMm: initialFrontMm,
      backMm: initialBackMm,
      parentTrapId,
      previewEnd: end === 'front' ? frontEnd : backEnd,
      staticEnd: end === 'front' ? frontEnd : backEnd,
    })

    const onMove = (me: MouseEvent) => {
      const d = dragging.current
      if (!d) return
      // Client-px delta → SVG-px (divide by zoom) → screen-px (divide by sc)
      // → slope-axis cm (× pixelToCmRatio). The stored value is HORIZONTAL
      // mm (the units used by trapezoid_detail_service's frontExtensionCm,
      // and what `_apply_base_extensions` divides by cos(angle) when applying
      // back to the slope-axis-emitted Base.lengthCm). So:
      //   slope_along_cm = client_along_px / zoom / sc * pixelToCmRatio
      //   horizontal_mm  = slope_along_cm × cos(angle) × 10
      const dxClient = me.clientX - d.startClientX
      const dyClient = me.clientY - d.startClientY
      const alongClientPx = dxClient * d.axis.x + dyClient * d.axis.y
      const slopeAlongCm = (alongClientPx / zoom / sc) * pixelToCmRatio
      const horizontalDeltaMm = slopeAlongCm * d.cosAngle * 10

      // `axis` points from BACK end → FRONT end. A positive `alongCm` means
      // the user pulled toward the front. Front grip outward (positive
      // delta) extends the front; back grip outward (negative delta)
      // extends the back.
      let frontMm = d.initialFrontMm
      let backMm = d.initialBackMm
      if (d.end === 'front') {
        frontMm = Math.max(0, Math.round(d.initialFrontMm + horizontalDeltaMm))
      } else {
        backMm = Math.max(0, Math.round(d.initialBackMm - horizontalDeltaMm))
      }

      // Real-time preview position: extend the grabbed endpoint along the
      // base axis by the user's drag distance (in SVG px). Recompute from
      // the absolute extension so it stays accurate even when clamped to 0.
      const absMm = d.end === 'front' ? frontMm : backMm
      const initialMm = d.end === 'front' ? d.initialFrontMm : d.initialBackMm
      // SVG-px per horizontal-mm: 1 horizontal cm = 10 horizontal mm.
      // SVG px / 1 horizontal cm = sc / pixelToCmRatio / cosAngle (slope cm
      // per horizontal cm = 1/cosAngle).
      const svgPxPerHmm = (sc / pixelToCmRatio) / d.cosAngle / 10
      const offsetSvg = (absMm - initialMm) * svgPxPerHmm
      const outward = d.end === 'front' ? 1 : -1
      const previewEnd: [number, number] = [
        (d.end === 'front' ? d.frontEnd[0] : d.backEnd[0]) + outward * d.axis.x * offsetSvg,
        (d.end === 'front' ? d.frontEnd[1] : d.backEnd[1]) + outward * d.axis.y * offsetSvg,
      ]
      const staticEnd: [number, number] = d.end === 'front' ? d.frontEnd : d.backEnd

      setLivePreview({
        baseId: d.baseId,
        anchor: previewEnd,
        frontMm,
        backMm,
        parentTrapId: d.parentTrapId,
        previewEnd,
        staticEnd,
      })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const d = dragging.current
      const preview = livePreviewRef.current
      dragging.current = null
      if (!d || !preview) { setLivePreview(null); return }
      // Only fire op if values actually changed.
      const changed = preview.frontMm !== d.initialFrontMm
                    || preview.backMm  !== d.initialBackMm
      const areaId = trapAreaMap[d.parentTrapId]
      if (changed && areaId != null) {
        onExtend({
          op: 'extend',
          target: { scope: 'base', areaId, baseId: d.baseId },
          frontExtMm: preview.frontMm,
          backExtMm: preview.backMm,
        } as ExtendOp)
      }
      setLivePreview(null)
      // Open the numeric editor anchored to this base so the user can
      // refine the just-dragged value precisely. Works after either a
      // committed drag OR a no-change click.
      if (areaId != null) {
        // Look up the base's panel-row index (used by scope='row' fan-out
        // button in the editor popover).
        let rowIdx = 0
        for (const ad of (beBasesData ?? [])) {
          const adAreaKey = String(ad.areaId ?? ad.areaLabel ?? ad.label)
          if (adAreaKey !== String(areaId)) continue
          for (const b of (ad.bases ?? [])) {
            if (b.baseId === d.baseId) {
              rowIdx = b._panelRowIdx ?? 0
              break
            }
          }
        }
        setEditor({
          baseId: d.baseId,
          areaId,
          rowIdx,
          parentTrapId: d.parentTrapId,
          anchor: d.frontEnd,
          frontMm: preview.frontMm,
          backMm: preview.backMm,
        })
        scheduleEditorDismiss()
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [zoom, sc, pixelToCmRatio, onExtend, trapAreaMap, scheduleEditorDismiss])

  // Keep a ref of livePreview for the onUp handler (closure captures stale state otherwise).
  const livePreviewRef = useRef(livePreview)
  livePreviewRef.current = livePreview

  if (!beBasesData) return null

  // Build extensions lookup from current trap data so we can show the
  // base's CURRENT absolute extension as the drag starting point.
  const extensionsMap: Record<string, { frontExtMm: number; backExtMm: number }[]> = {}
  for (const tid of Object.keys(beTrapezoidsData ?? {})) {
    const ext = beTrapezoidsData?.[tid]?.geometry?.extensions
    if (Array.isArray(ext) && ext.length > 0) extensionsMap[tid] = ext
  }

  // If a trap is selected, only show grips for bases owned by that area.
  const selectedAreaForFilter = effectiveSelectedTrapId
    ? trapAreaMap[effectiveSelectedTrapId]
    : null

  const gripRadius = GRIP_RADIUS_SVG / zoom

  return (
    <g>
      {beBasesData.flatMap((areaData) => {
        const areaKey = String(areaData.areaId ?? areaData.areaLabel ?? areaData.label)
        if (selectedAreaForFilter != null && String(selectedAreaForFilter) !== areaKey) return []
        // Dedupe by baseId — a defensive guard against any upstream diff
        // path that might emit the same baseId twice within an area
        // (would otherwise duplicate the grip circles).
        const bases: any[] = []
        const seen = new Set<string>()
        for (const sb of (areaData.bases ?? [])) {
          const id = sb?.baseId
          if (!id) continue
          if (seen.has(id)) {
            // eslint-disable-next-line no-console
            console.warn('[BaseEndpointGrips] duplicate baseId skipped:', id, 'in area', areaKey)
            continue
          }
          seen.add(id)
          bases.push(sb)
        }

        return bases.map((sb: any, sbi: number) => {
          // Skip frameless / virtual hook lines — they have no beam to extend.
          if ((sb.hookOffsets?.length ?? 0) > 0) return null
          // Synthetic adds (from the in-flight live diff) have no real
          // BE-assigned baseId yet — defer extend grips until the user
          // hits Apply and the BE round-trip returns a stable baseId.
          if (sb.__synthetic) return null

          const rowIdx = sb._panelRowIdx ?? 0
          const ctx = resolveAreaContext(areaData, areaFrames, areaTrapsMap, beTrapezoidsData, customBasesMap, rowIdx)
          if (!ctx) return null
          const { af } = ctx

          const { btx, bty, bbx, bby } = baseScreenCoords(sb, sbi, { af, pixelToCmRatio, toSvg })
          // baseScreenCoords returns (btx,bty)=top, (bbx,bby)=bottom of the
          // base line. For TTB orientation top = ridge/back end; for BTT it
          // flips. We use isBtt to map "front"/"back" consistently to the
          // physical eave/ridge ends — same convention used by anchor render.
          const isBtt = !!af?.isBtt
          const backEnd: [number, number]  = isBtt ? [bbx, bby] : [btx, bty]
          const frontEnd: [number, number] = isBtt ? [btx, bty] : [bbx, bby]

          const dx = frontEnd[0] - backEnd[0]
          const dy = frontEnd[1] - backEnd[1]
          const len = Math.hypot(dx, dy) || 1
          const axis = { x: dx / len, y: dy / len }

          const { parentTrapId } = parseVariationTrapId(sb.trapezoidId ?? '')
          const ext = getExtensionForBase(extensionsMap, sb.trapezoidId ?? '')
          const initialFrontMm = Math.round(ext.frontExtMm)
          const initialBackMm  = Math.round(ext.backExtMm)

          // Trap slope angle drives the horizontal-mm ↔ slope-cm conversion.
          // Stored extension values are HORIZONTAL mm (parallel the base
          // beam, which sits flat on purlins); the plan-view Base.lengthCm
          // is slope-axis cm. They differ by cos(angle).
          const angleDeg = beTrapezoidsData?.[parentTrapId]?.geometry?.angle ?? SLOPE_DEFAULT_ANGLE_DEG
          const cosAngle = Math.cos((angleDeg * Math.PI) / 180) || 1

          const isHovered = livePreview?.baseId === sb.baseId
          const fill = isHovered ? DANGER : BLACK

          return (
            <g key={`grip-${areaKey}-${sb.baseId}`}>
              <circle
                cx={frontEnd[0]} cy={frontEnd[1]} r={gripRadius}
                fill={fill} stroke="white" strokeWidth={1.5 / zoom}
                style={{ cursor: 'crosshair' }}
                onMouseDown={(e) => onGripMouseDown(e, sb, parentTrapId, 'front', axis, initialFrontMm, initialBackMm, cosAngle, frontEnd, backEnd)}
              />
              <circle
                cx={backEnd[0]} cy={backEnd[1]} r={gripRadius}
                fill={fill} stroke="white" strokeWidth={1.5 / zoom}
                style={{ cursor: 'crosshair' }}
                onMouseDown={(e) => onGripMouseDown(e, sb, parentTrapId, 'back', axis, initialFrontMm, initialBackMm, cosAngle, frontEnd, backEnd)}
              />
            </g>
          )
        }).filter(Boolean)
      })}

      {/* Live preview overlay — amber line + endpoint marker showing where
          the new base end will sit. Drawn ONLY during active drag. */}
      {livePreview && (
        <g style={{ pointerEvents: 'none' }}>
          <line
            x1={livePreview.staticEnd[0]} y1={livePreview.staticEnd[1]}
            x2={livePreview.previewEnd[0]} y2={livePreview.previewEnd[1]}
            stroke={AMBER} strokeWidth={3 / zoom}
            strokeDasharray={`${4 / zoom} ${3 / zoom}`}
            strokeLinecap="round"
          />
          <circle
            cx={livePreview.previewEnd[0]} cy={livePreview.previewEnd[1]}
            r={gripRadius * 1.2}
            fill={AMBER} stroke="white" strokeWidth={1.5 / zoom}
          />
        </g>
      )}

      {/* Precise numeric editor — appears after a drag-release; lets the
          user fine-tune front/back values without re-dragging. Auto-
          dismisses after EDITOR_LIFETIME_MS if untouched. */}
      {editor && !livePreview && (() => {
        const [ax, ay] = editor.anchor
        // Width/height in SVG px; foreignObject scales to outer SVG zoom.
        const w = 200 / zoom
        const h = 154 / zoom
        const x = ax + 10 / zoom
        const y = ay - h / 2
        const fontSz = 10 / zoom
        const commit = (
          next: { frontMm: number; backMm: number },
          scope: ExtendTarget['scope'] = 'base',
        ) => {
          let target: ExtendTarget
          if (scope === 'row') target = { scope: 'row', areaId: editor.areaId, rowIdx: editor.rowIdx }
          else if (scope === 'area') target = { scope: 'area', areaId: editor.areaId }
          else target = { scope: 'base', areaId: editor.areaId, baseId: editor.baseId }
          onExtend({
            op: 'extend',
            target,
            frontExtMm: next.frontMm,
            backExtMm: next.backMm,
          })
          setEditor({ ...editor, ...next })
          scheduleEditorDismiss()
        }
        return (
          <foreignObject x={x} y={y} width={w} height={h}>
            <div
              onMouseDown={(e) => { e.stopPropagation(); scheduleEditorDismiss() }}
              onKeyDown={(e) => { e.stopPropagation(); scheduleEditorDismiss() }}
              onWheel={(e) => e.stopPropagation()}
              style={{
                background: 'white', border: `1px solid ${BORDER}`,
                borderRadius: 4 / zoom, padding: `${6 / zoom}px ${8 / zoom}px`,
                fontSize: fontSz, fontFamily: 'inherit',
                boxShadow: `0 ${2 / zoom}px ${6 / zoom}px rgba(0,0,0,0.15)`,
                display: 'flex', flexDirection: 'column', gap: 4 / zoom,
              }}
            >
              <div style={{ fontWeight: 700, color: PRIMARY }}>
                {deriveVariationLabel(editor.parentTrapId, 0)} extend (mm)
              </div>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 / zoom }}>
                front
                <input
                  type="number" min={0} step={10}
                  value={editor.frontMm}
                  onChange={(e) => {
                    const v = Math.max(0, Math.round(Number(e.target.value) || 0))
                    setEditor({ ...editor, frontMm: v })
                  }}
                  onBlur={() => commit({ frontMm: editor.frontMm, backMm: editor.backMm })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commit({ frontMm: editor.frontMm, backMm: editor.backMm })
                    }
                  }}
                  style={{
                    width: 60 / zoom, padding: `${2 / zoom}px ${4 / zoom}px`,
                    border: `1px solid ${BORDER}`, borderRadius: 2 / zoom,
                    fontSize: fontSz, textAlign: 'right',
                  }}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 / zoom }}>
                back
                <input
                  type="number" min={0} step={10}
                  value={editor.backMm}
                  onChange={(e) => {
                    const v = Math.max(0, Math.round(Number(e.target.value) || 0))
                    setEditor({ ...editor, backMm: v })
                  }}
                  onBlur={() => commit({ frontMm: editor.frontMm, backMm: editor.backMm })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commit({ frontMm: editor.frontMm, backMm: editor.backMm })
                    }
                  }}
                  style={{
                    width: 60 / zoom, padding: `${2 / zoom}px ${4 / zoom}px`,
                    border: `1px solid ${BORDER}`, borderRadius: 2 / zoom,
                    fontSize: fontSz, textAlign: 'right',
                  }}
                />
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 / zoom, marginTop: 3 / zoom, borderTop: `1px solid ${BORDER}`, paddingTop: 4 / zoom }}>
                <div style={{ fontSize: fontSz * 0.85, color: '#666' }}>fan out to:</div>
                <button
                  type="button"
                  onClick={() => commit({ frontMm: editor.frontMm, backMm: editor.backMm }, 'row')}
                  style={{
                    padding: `${3 / zoom}px ${6 / zoom}px`, border: `1px solid ${BORDER}`,
                    borderRadius: 2 / zoom, background: 'white', cursor: 'pointer',
                    fontSize: fontSz, textAlign: 'left',
                  }}
                >row {editor.rowIdx}</button>
                <button
                  type="button"
                  onClick={() => commit({ frontMm: editor.frontMm, backMm: editor.backMm }, 'area')}
                  style={{
                    padding: `${3 / zoom}px ${6 / zoom}px`, border: `1px solid ${BORDER}`,
                    borderRadius: 2 / zoom, background: 'white', cursor: 'pointer',
                    fontSize: fontSz, textAlign: 'left',
                  }}
                >whole area</button>
              </div>
            </div>
          </foreignObject>
        )
      })()}

      {/* Live readout chip — anchored to the grabbed grip */}
      {livePreview && (() => {
        const [ax, ay] = livePreview.anchor
        const fs = 9 / zoom
        const lbl = `${deriveVariationLabel(livePreview.parentTrapId, 0)}  front: ${livePreview.frontMm}  back: ${livePreview.backMm}`
        const bgW = lbl.length * fs * 0.6 + 8 / zoom
        const bgH = fs + 6 / zoom
        const cx = ax
        const cy = ay - READOUT_OFFSET_SVG / zoom
        return (
          <g style={{ pointerEvents: 'none' }}>
            <rect x={cx - bgW / 2} y={cy - bgH / 2} width={bgW} height={bgH}
              rx={2 / zoom} fill="white" stroke={BLACK} strokeWidth={0.5 / zoom} />
            <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
              fontSize={fs} fontWeight={700} fill={BLACK}>{lbl}</text>
          </g>
        )
      })()}
    </g>
  )
}
