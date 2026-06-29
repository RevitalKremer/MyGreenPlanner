/**
 * Derive the BE wire-format BaseOp list from the user's intended state.
 *
 * Source of truth on the FE is `customBasesMap` — a per-`${areaId}:${rowIdx}`
 * array of mm offsets reflecting the bar/grip/popover edits the user has
 * accumulated. The entry covers the entire row across every sub-trap, so
 * multi-sub-trap rows (e.g. A1 + A2 in one panel row) live under a single
 * key.
 *
 * On save we diff customBasesMap against the BE's last-known state
 * (`beBasesData`) and emit one op per change. Identical changes across
 * multiple bases (e.g. "Apply to all rows" fan-out) are then consolidated
 * into a single op carrying multiple targets so the wire payload stays
 * compact and the BE applies one logical change at a time.
 *
 * Each move/delete target carries `trapezoidId` (the sub-trap the BE
 * currently associates with that base) so the BE can disambiguate
 * colliding baseIds (B1 in A1 vs B1 in A2). add targets pass the
 * trapezoidId hint of the closest neighbouring base — the BE may
 * reassign it via signature matching, the hint just biases the
 * insertion site.
 *
 * When `live.length === be.length` every difference is treated as a
 * pure MOVE (the edit bar's clampOffset prevents a dragged base from
 * crossing its neighbours, so positional correspondence is preserved).
 * Otherwise a two-pointer diff classifies ADDs / DELETEs vs MOVEs using
 * an INSERT_GAP_CM tolerance — generous enough that legitimate single-
 * gesture moves aren't misclassified.
 */

const INSERT_GAP_CM = 500

type AnyBase = {
  baseId?: string
  trapezoidId?: string
  offsetFromStartCm?: number
  _panelRowIdx?: number
  hookOffsets?: number[]
}

type AnyArea = {
  areaId?: number | string
  areaLabel?: string
  label?: string
  bases?: any
}

type MoveTarget = { areaId: number | string; rowIdx: number; baseId: string }
type AddTarget  = { areaId: number | string; rowIdx: number }
type DeleteTarget = { areaId: number | string; rowIdx: number; baseId: string }

export type BaseOp =
  | { op: 'move';   targets: MoveTarget[];   offsetMm: number }
  | { op: 'add';    targets: AddTarget[];    offsetMm: number }
  | { op: 'delete'; targets: DeleteTarget[] }

const rowBasesFromArea = (ad: AnyArea): Record<number, AnyBase[]> => {
  const out: Record<number, AnyBase[]> = {}
  const raw = ad?.bases
  if (Array.isArray(raw)) {
    for (const b of raw) {
      const ri = (b as AnyBase)._panelRowIdx ?? 0
      if (!out[ri]) out[ri] = []
      out[ri].push(b)
    }
  } else if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      const ri = Number(k)
      if (Array.isArray(v)) out[ri] = v as AnyBase[]
    }
  }
  return out
}

/**
 * Build the BaseOp list for a save. Returns [] when nothing diverges from
 * `beBasesData`. Skips frameless / virtual hook lines (`hookOffsets` non-
 * empty) since those have no editable beam.
 */
export function buildBaseOpsFromState(
  customBasesMap: Record<string, number[]>,
  beBasesData: AnyArea[] | null,
): BaseOp[] {
  if (!beBasesData) return []

  const moves: { offsetMm: number; target: MoveTarget }[] = []
  const adds:  { offsetMm: number; target: AddTarget   }[] = []
  const deletes: DeleteTarget[] = []

  for (const ad of beBasesData) {
    const areaId = ad.areaId
    if (areaId == null) continue
    const byRow = rowBasesFromArea(ad)
    for (const [riStr, rowBases] of Object.entries(byRow)) {
      const ri = Number(riStr)
      // Take ALL bases in the row (every sub-trap) and sort by offset.
      // Frameless / virtual anchors (non-empty hookOffsets) are editable too
      // (move/add/delete) — the BE re-derives their hook crossings at the new
      // position — so they're included in the diff. A row is homogeneous
      // (one roof type), so framed and frameless never mix here.
      const sorted = rowBases
        .slice()
        .sort((a, b) => (a.offsetFromStartCm ?? 0) - (b.offsetFromStartCm ?? 0))
      if (sorted.length === 0) continue

      const liveMm = customBasesMap[`${areaId}:${ri}`]
        ?? customBasesMap[`${ad.areaLabel}:${ri}`]
        ?? customBasesMap[`${ad.label}:${ri}`]
      if (!liveMm) continue   // no FE override for this row → no diff
      const live = liveMm.slice().sort((a, b) => a - b)
      const beMm = sorted.map(b => Math.round((b.offsetFromStartCm ?? 0) * 10))

      // Length match → pure moves. The edit bar's clampOffset prevents
      // a dragged base from crossing its neighbours, so the sorted live
      // array maintains positional correspondence with the BE peers.
      // Compare in MM space (integer) so float round-trips (230.6 cm ↔
      // 2306 mm ↔ 230.5999... cm) don't trigger phantom moves.
      if (live.length === sorted.length) {
        for (let i = 0; i < sorted.length; i++) {
          if (live[i] !== beMm[i]) {
            const b = sorted[i]
            if (b.baseId) {
              moves.push({
                offsetMm: live[i],
                target: { areaId, rowIdx: ri, baseId: b.baseId },
              })
            }
          }
        }
        continue
      }

      // Length differs by ±1 → exactly one add or one delete (possibly
      // alongside moves). A naive two-pointer that scans left-to-right
      // misreads the shift: deleting the middle base of [B1,B2,B3,B4,B5]
      // makes live=[B1,B3,B4,B5] look like "B2→pos of B3, B3→pos of B4,
      // B4→pos of B5, B5 deleted." Instead we try EACH possible skip
      // index in the longer side and pick the one with minimum total
      // positional drift — that index is the actual add/delete; the
      // surviving pairs are either matches or moves.
      if (live.length === sorted.length - 1) {
        // One delete: the BE peer whose removal yields the smallest
        // total drift between the remaining pairs is the deleted base.
        let bestSkip = 0
        let bestDrift = Infinity
        for (let skipIdx = 0; skipIdx < sorted.length; skipIdx++) {
          let drift = 0
          let li = 0
          for (let bi = 0; bi < sorted.length; bi++) {
            if (bi === skipIdx) continue
            drift += Math.abs(live[li] - beMm[bi])
            li++
          }
          if (drift < bestDrift) {
            bestDrift = drift
            bestSkip = skipIdx
          }
        }
        const skipped = sorted[bestSkip]
        if (skipped.baseId) {
          deletes.push({ areaId, rowIdx: ri, baseId: skipped.baseId })
        }
        let li = 0
        for (let bi = 0; bi < sorted.length; bi++) {
          if (bi === bestSkip) continue
          const peer = sorted[bi]
          if (live[li] !== beMm[bi] && peer.baseId) {
            moves.push({
              offsetMm: live[li],
              target: { areaId, rowIdx: ri, baseId: peer.baseId },
            })
          }
          li++
        }
        continue
      }

      if (live.length === sorted.length + 1) {
        // One add: the live entry whose removal yields the smallest
        // total drift against the BE peers is the inserted base.
        let bestSkip = 0
        let bestDrift = Infinity
        for (let skipIdx = 0; skipIdx < live.length; skipIdx++) {
          let drift = 0
          let bi = 0
          for (let li = 0; li < live.length; li++) {
            if (li === skipIdx) continue
            drift += Math.abs(live[li] - beMm[bi])
            bi++
          }
          if (drift < bestDrift) {
            bestDrift = drift
            bestSkip = skipIdx
          }
        }
        adds.push({ offsetMm: live[bestSkip], target: { areaId, rowIdx: ri } })
        let bi = 0
        for (let li = 0; li < live.length; li++) {
          if (li === bestSkip) continue
          const peer = sorted[bi]
          if (live[li] !== beMm[bi] && peer.baseId) {
            moves.push({
              offsetMm: live[li],
              target: { areaId, rowIdx: ri, baseId: peer.baseId },
            })
          }
          bi++
        }
        continue
      }

      // Length differs by > 1 → multi-edit. Fall back to the existing
      // gap-based two-pointer; mixed drag + add / drag + delete in the
      // same row is best-effort.
      const insertGapMm = INSERT_GAP_CM * 10
      let bi = 0
      let li = 0
      while (bi < sorted.length || li < live.length) {
        if (bi >= sorted.length) {
          adds.push({ offsetMm: live[li], target: { areaId, rowIdx: ri } })
          li++
          continue
        }
        if (li >= live.length) {
          const b = sorted[bi]
          if (b.baseId) deletes.push({ areaId, rowIdx: ri, baseId: b.baseId })
          bi++
          continue
        }
        const beMmI = beMm[bi]
        const liveMmI = live[li]
        if (live.length > sorted.length && liveMmI + insertGapMm < beMmI) {
          adds.push({ offsetMm: liveMmI, target: { areaId, rowIdx: ri } })
          li++
        } else if (live.length < sorted.length && beMmI + insertGapMm < liveMmI) {
          const b = sorted[bi]
          if (b.baseId) deletes.push({ areaId, rowIdx: ri, baseId: b.baseId })
          bi++
        } else {
          const b = sorted[bi]
          if (liveMmI !== beMmI && b.baseId) {
            moves.push({
              offsetMm: liveMmI,
              target: { areaId, rowIdx: ri, baseId: b.baseId },
            })
          }
          bi++
          li++
        }
      }
    }
  }

  // Consolidate identical (op, offsetMm) entries into one op per group.
  const ops: BaseOp[] = []
  const moveByOffset: Record<number, MoveTarget[]> = {}
  for (const m of moves) {
    if (!moveByOffset[m.offsetMm]) moveByOffset[m.offsetMm] = []
    moveByOffset[m.offsetMm].push(m.target)
  }
  for (const [offStr, tgts] of Object.entries(moveByOffset)) {
    ops.push({ op: 'move', targets: tgts, offsetMm: Number(offStr) })
  }

  const addByOffset: Record<number, AddTarget[]> = {}
  for (const a of adds) {
    if (!addByOffset[a.offsetMm]) addByOffset[a.offsetMm] = []
    addByOffset[a.offsetMm].push(a.target)
  }
  for (const [offStr, tgts] of Object.entries(addByOffset)) {
    ops.push({ op: 'add', targets: tgts, offsetMm: Number(offStr) })
  }

  if (deletes.length > 0) {
    ops.push({ op: 'delete', targets: deletes })
  }

  return ops
}
