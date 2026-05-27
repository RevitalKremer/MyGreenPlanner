/**
 * Derive the BE wire-format BlockOp list from the user's intended block state.
 *
 * Source of truth on the FE is `customBlocksMap` — a per-trapezoidId array of
 * `{ positionCm, isEnd }` reflecting the drag / add / delete gestures the user
 * has accumulated in the trap-detail edit mode. On save we diff against the
 * BE's last-known blocks (from `beTrapezoidsData[trapId].blocks`) and emit
 * one op per change.
 *
 * Blocks have no stable id (the BE re-emits them every compute), so move /
 * delete identify the affected block by its current positionMm. mm-precision
 * rounding plus the 50cm minimum gap between blocks make position-based
 * addressing unambiguous.
 *
 * The min-gap clamp is order-preserving, so when `live.length === be.length`
 * every difference is treated as a pure MOVE. Otherwise a best-fit-skip
 * heuristic identifies the single add/delete, falling back to a two-pointer
 * walk for multi-edit cases.
 */

type Block = { positionCm: number; isEnd?: boolean }
type BeTrap = { blocks?: Block[] }

export type BlockOp =
  | { op: 'move';   trapezoidId: string; fromPositionMm: number; toPositionMm: number }
  | { op: 'add';    trapezoidId: string; positionMm: number }
  | { op: 'delete'; trapezoidId: string; positionMm: number }

const INSERT_GAP_MM = 500  // 50cm — matches the FE min-gap clamp on block drag

export function buildBlockOpsFromState(
  customBlocksMap: Record<string, Block[]>,
  beTrapezoidsData: Record<string, BeTrap> | null,
): BlockOp[] {
  if (!beTrapezoidsData) return []
  const ops: BlockOp[] = []

  for (const [trapezoidId, liveBlocks] of Object.entries(customBlocksMap)) {
    const beTrap = beTrapezoidsData[trapezoidId]
    if (!beTrap) continue

    const live = liveBlocks
      .map(b => Math.round((b.positionCm ?? 0) * 10))
      .slice()
      .sort((a, b) => a - b)
    const be = (beTrap.blocks || [])
      .map(b => Math.round((b.positionCm ?? 0) * 10))
      .slice()
      .sort((a, b) => a - b)

    // Length match → pure moves. The drag clamp is order-preserving, so the
    // sorted live array maintains positional correspondence with the BE peers.
    if (live.length === be.length) {
      for (let i = 0; i < live.length; i++) {
        if (live[i] !== be[i]) {
          ops.push({ op: 'move', trapezoidId, fromPositionMm: be[i], toPositionMm: live[i] })
        }
      }
      continue
    }

    // Length differs by ±1 → one add or one delete (possibly alongside moves).
    // Try each possible skip index on the longer side and pick the one with
    // minimum total positional drift — that's the actual add/delete.
    if (live.length === be.length - 1) {
      let bestSkip = 0
      let bestDrift = Infinity
      for (let skipIdx = 0; skipIdx < be.length; skipIdx++) {
        let drift = 0
        let li = 0
        for (let bi = 0; bi < be.length; bi++) {
          if (bi === skipIdx) continue
          drift += Math.abs(live[li] - be[bi])
          li++
        }
        if (drift < bestDrift) {
          bestDrift = drift
          bestSkip = skipIdx
        }
      }
      ops.push({ op: 'delete', trapezoidId, positionMm: be[bestSkip] })
      let li = 0
      for (let bi = 0; bi < be.length; bi++) {
        if (bi === bestSkip) continue
        if (live[li] !== be[bi]) {
          ops.push({ op: 'move', trapezoidId, fromPositionMm: be[bi], toPositionMm: live[li] })
        }
        li++
      }
      continue
    }

    if (live.length === be.length + 1) {
      let bestSkip = 0
      let bestDrift = Infinity
      for (let skipIdx = 0; skipIdx < live.length; skipIdx++) {
        let drift = 0
        let bi = 0
        for (let li = 0; li < live.length; li++) {
          if (li === skipIdx) continue
          drift += Math.abs(live[li] - be[bi])
          bi++
        }
        if (drift < bestDrift) {
          bestDrift = drift
          bestSkip = skipIdx
        }
      }
      ops.push({ op: 'add', trapezoidId, positionMm: live[bestSkip] })
      let bi = 0
      for (let li = 0; li < live.length; li++) {
        if (li === bestSkip) continue
        if (live[li] !== be[bi]) {
          ops.push({ op: 'move', trapezoidId, fromPositionMm: be[bi], toPositionMm: live[li] })
        }
        bi++
      }
      continue
    }

    // Multi-edit fallback — gap-based two-pointer.
    let bi = 0
    let li = 0
    while (bi < be.length || li < live.length) {
      if (bi >= be.length) {
        ops.push({ op: 'add', trapezoidId, positionMm: live[li] })
        li++
        continue
      }
      if (li >= live.length) {
        ops.push({ op: 'delete', trapezoidId, positionMm: be[bi] })
        bi++
        continue
      }
      const beMm = be[bi]
      const liveMm = live[li]
      if (live.length > be.length && liveMm + INSERT_GAP_MM < beMm) {
        ops.push({ op: 'add', trapezoidId, positionMm: liveMm })
        li++
      } else if (live.length < be.length && beMm + INSERT_GAP_MM < liveMm) {
        ops.push({ op: 'delete', trapezoidId, positionMm: beMm })
        bi++
      } else {
        if (liveMm !== beMm) {
          ops.push({ op: 'move', trapezoidId, fromPositionMm: beMm, toPositionMm: liveMm })
        }
        bi++
        li++
      }
    }
  }

  return ops
}
