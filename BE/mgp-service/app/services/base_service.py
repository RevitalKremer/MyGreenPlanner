"""
Base layout service — server-side port of FE/src/utils/basesService.js

Computes base positions, block positions, and consolidation for one area
purely from project data (cm measurements, no pixel coordinates).

Depth convention (lineIdx ordering in panelGrid.rows[]):
  lineIdx = 0 → rearmost line (closest to ridge / back of installation).
  Higher lineIdx → frontmost (closest to eave).
"""

from __future__ import annotations
import logging
import math
from typing import Optional

from app.utils.math_helpers import round_to_2dp
from app.utils.panel_geometry import infer_row_orientation, default_panel_positions, PANEL_V, PANEL_H

logger = logging.getLogger(__name__)

# Length difference (cm) above which two adjacent bases are treated as a
# shape-edge seam in external-diagonal pair selection. Below this, the
# difference is treated as float-rounding noise from the depth derivation
# / consolidation pipeline.
LENGTH_TRANSITION_TOL_CM = 1.0

# Two rail endpoints closer than this (cm) collapse to a single base. Covers
# the V-line-end / H-line-end mis-alignment seam where adjacent blocks of
# different panel orientation don't share an exact X edge. The surviving base
# is the one covering MORE panel lines (the longer beam). 0.5 m.
BASE_DEDUPE_TOL_CM = 50.0


# ── Edge-offset tolerance optimisation ────────────────────────────────────────

def _optimize_edge_offset(
    edge_offset_mm: float,
    frame_length_mm: float,
    spacing_mm: float,
    tolerance_pct: float,
) -> float:
    """Return the smallest edge offset (within tolerance) that minimises base count.

    Algorithm:
    1. Compute base count at the original edge offset.
    2. Compute base count at max tolerance (edge_offset * (1 + pct/100)).
    3. If the toleranced count is not fewer → return original edge offset.
    4. Otherwise, analytically solve for the minimum edge offset that
       achieves the reduced span count:
         num_spans_reduced * spacing_mm ≤ frame_length_mm − 2 * new_edge
       ⇒ new_edge ≥ (frame_length_mm − num_spans_reduced * spacing_mm) / 2
    """
    if tolerance_pct <= 0 or spacing_mm <= 0:
        return edge_offset_mm

    inner_span_mm = frame_length_mm - 2 * edge_offset_mm
    num_spans_orig = max(1, math.ceil(inner_span_mm / spacing_mm))

    max_edge_mm = edge_offset_mm * (1 + tolerance_pct / 100)
    inner_span_tol = frame_length_mm - 2 * max_edge_mm
    if inner_span_tol <= 0:
        return edge_offset_mm
    num_spans_tol = max(1, math.ceil(inner_span_tol / spacing_mm))

    if num_spans_tol >= num_spans_orig:
        return edge_offset_mm

    # Find minimum edge offset that achieves the reduced span count.
    # We need: ceil(inner_span / spacing) <= num_spans_tol
    # i.e. inner_span <= num_spans_tol * spacing  (since ceil(x) <= n iff x <= n)
    # i.e. frame_length - 2*edge >= ... is already satisfied;
    # we want the threshold where the span count just drops:
    #   inner_span == num_spans_tol * spacing
    #   edge == (frame_length - num_spans_tol * spacing) / 2
    min_edge_mm = (frame_length_mm - num_spans_tol * spacing_mm) / 2

    # Clamp: must be at least the original, at most the max tolerance
    return max(edge_offset_mm, min(min_edge_mm, max_edge_mm))


# ── Edge-spacing (distinct outermost span) helpers ────────────────────────────
#
# Constructors often place the outermost base at each row end at a DIFFERENT
# distance from its neighbour than the regular interior spacing — usually
# tighter (edges carry more wind load), occasionally looser. `edge_spacing_mm`
# sets that outermost span at both the start AND end of a row; the interior is
# filled at the regular `spacing`. The relationship between the two is the
# planner's choice — edge spacing may be smaller OR larger than the regular
# spacing; it is NOT enforced. (Because the edge span may be WIDER than
# `spacing`, the interior fill must never subdivide it — callers exclude the two
# edge spans from the even fill.)
#
# The feature is inert (layout byte-identical to the old even-fill) only when no
# edge spacing is set at all — i.e. ``edge_spacing_cm is None`` (a project or DB
# predating the edgeSpacingMm setting). Any positive value is applied as-is.

def _edge_spacing_active(spacing_cm: float, edge_spacing_cm: float | None) -> bool:
    """Edge tightening applies whenever a positive edge spacing is set.

    No relationship to `spacing_cm` is enforced — the planner may set the edge
    span tighter or wider than the interior. ``None`` / non-positive is inert.
    """
    return (
        edge_spacing_cm is not None
        and edge_spacing_cm > 0
        and spacing_cm > 0
    )


def _even_fill_interior(a: float, b: float, spacing_cm: float) -> list[float]:
    """Interior fill points strictly between `a` and `b` (exclusive of both),
    dividing the gap into ``ceil(gap / spacing)`` equal spans. Returns [] when
    the gap is within one ``spacing`` (or spacing is non-positive)."""
    gap = b - a
    if spacing_cm <= 0 or gap <= spacing_cm + 1e-6:
        return []
    n = math.ceil(gap / spacing_cm)
    return [round_to_2dp(a + k * gap / n) for k in range(1, n)]


# ── Per-base depth helpers ────────────────────────────────────────────────────
#
# Extracted from `compute_area_bases` so the per-base depth assignment can run
# AFTER user-override application (`_apply_persisted_position_overrides`) and
# signature-based trap reassignment. Without re-running these, a base whose X
# crossed into another sub-trap's column range keeps the SHAPE of whichever
# sub-trap originally produced it (panelLineIdx / startCm / lengthCm) — even
# after its trapezoidId is correctly reassigned.


def build_line_infos(
    panel_grid: dict,
    panel_width_cm: float,
    panel_length_cm: float,
    line_gap_cm: float,
) -> dict[int, dict]:
    """Cumulative per-line geometry for a row.

    Returns ``{lineIdx: {rearEdgeCm, frontEdgeCm, depthCm, orient}}`` for
    every line that has a non-empty orientation. Lines whose only cells
    are empty slots (EV/EH) are omitted.
    """
    rows = panel_grid.get('rows', [])
    short_cm = panel_width_cm
    long_cm = panel_length_cm
    line_infos: dict[int, dict] = {}
    cumulative_cm = 0.0
    for line_idx, cells in enumerate(rows):
        orient = infer_row_orientation(cells)
        if line_idx > 0:
            cumulative_cm += line_gap_cm
        depth_cm = long_cm if orient == PANEL_V else (short_cm if orient == PANEL_H else 0)
        if orient:
            line_infos[line_idx] = {
                'rearEdgeCm': cumulative_cm,
                'frontEdgeCm': cumulative_cm + depth_cm,
                'depthCm': depth_cm,
                'orient': orient,
            }
        cumulative_cm += depth_cm
    return line_infos


def _active_lines_at_x(
    base_x: float,
    panel_grid: dict,
    line_infos: dict[int, dict],
    panel_width_cm: float,
    panel_length_cm: float,
    panel_gap_cm: float,
) -> list[int]:
    """Line indices whose real panels cover X position ``base_x``.

    A line is active for this X only if a real panel sits there (within
    ``panel_gap_cm`` tolerance, so a base in the standard inter-panel gap
    still counts). Used both to decide a base's depth span and to rank
    rail-endpoint coverage during placement dedupe.
    """
    rows = panel_grid.get('rows', [])
    row_positions = panel_grid.get('rowPositions') or {}
    active_lines: list[int] = []
    for li, cells in enumerate(rows):
        orient = infer_row_orientation(cells)
        if not orient or li not in line_infos:
            continue
        panel_along_cm = panel_width_cm if orient == PANEL_V else panel_length_cm
        stored = row_positions.get(str(li))
        positions = stored if stored else default_panel_positions(cells, panel_along_cm, panel_gap_cm)
        if not positions:
            continue
        tol = panel_gap_cm
        if any(p - tol <= base_x <= p + panel_along_cm + tol for p in positions):
            active_lines.append(li)
    return active_lines


def assign_base_depth(
    base: dict,
    panel_grid: dict,
    line_infos: dict[int, dict],
    line_rails: dict[str, list[float]],
    panel_width_cm: float,
    panel_length_cm: float,
    panel_gap_cm: float,
    base_overhang_cm: float,
    fallback_panel_line_idx: int | None = None,
    fallback_start_cm: float | None = None,
    fallback_length_cm: float | None = None,
) -> None:
    """Recompute ``base.panelLineIdx`` / ``startCm`` / ``lengthCm`` from
    ``base.offsetFromStartCm``.

    Probes each non-empty line at the base's X position: if a real
    panel exists there (within ``panel_gap_cm`` tolerance), that line
    counts as active for this base. The base then spans from the
    rear-most active line to the front-most. Single-line active set
    (e.g. col 5 in a row whose line 0 is EV) yields a single-line
    shape — that's the case the bug was about.

    Fallbacks apply when no line is active at the X (base sits outside
    every line's real-panel extent). Defaults to a zero-length record
    when no fallback is provided.
    """
    base_x = base.get('offsetFromStartCm', 0)
    active_lines = _active_lines_at_x(
        base_x, panel_grid, line_infos, panel_width_cm, panel_length_cm, panel_gap_cm,
    )

    if active_lines:
        b_rear_idx = min(active_lines)
        b_front_idx = max(active_lines)
        b_rear_line = line_infos[b_rear_idx]
        b_front_line = line_infos[b_front_idx]
        b_rear_rails = line_rails.get(str(b_rear_idx), [])
        b_front_rails = line_rails.get(str(b_front_idx), [])
        b_rear_leg = b_rear_line['rearEdgeCm'] + (b_rear_rails[0] if b_rear_rails else 0)
        b_front_leg = b_front_line['rearEdgeCm'] + (
            b_front_rails[-1] if b_front_rails else b_front_line['depthCm']
        )
        base['panelLineIdx'] = b_rear_idx
        base['startCm'] = round_to_2dp(b_rear_leg - base_overhang_cm - b_rear_line['rearEdgeCm'])
        base['lengthCm'] = round_to_2dp((b_front_leg + base_overhang_cm) - (b_rear_leg - base_overhang_cm))
        return

    if fallback_panel_line_idx is not None and fallback_start_cm is not None and fallback_length_cm is not None:
        base['panelLineIdx'] = fallback_panel_line_idx
        base['startCm'] = round_to_2dp(fallback_start_cm)
        base['lengthCm'] = round_to_2dp(fallback_length_cm)
    else:
        # No active lines and no fallback — base sits outside the row
        # extent. Mark with zero length so downstream renderers can
        # safely skip it.
        sorted_lines = sorted(line_infos.keys())
        base['panelLineIdx'] = sorted_lines[0] if sorted_lines else 0
        base['startCm'] = 0
        base['lengthCm'] = 0


# ── Main computation ──────────────────────────────────────────────────────────

def compute_area_bases(
    panel_grid: dict,
    panel_width_cm: float,
    panel_length_cm: float,
    line_rails: dict[str, list[float]],
    edge_offset_mm: float,
    spacing_mm: float,
    base_overhang_cm: float,
    cross_rail_offset_cm: float,
    panel_gap_cm: float,
    line_gap_cm: float,
    trapezoid_id: str = '',
    trap_start_cm: float | None = None,
    trap_end_cm: float | None = None,
    roof_spec: dict | None = None,
    edge_offset_tolerance_pct: float = 0,
    edge_spacing_mm: float | None = None,
) -> dict | None:
    """
    Compute DEFAULT base layout for one area (or trapezoid sub-range).

    panel_grid  — { rows: list[list[str]], rowPositions?: dict[str, list[float]] }
    line_rails  — { str(lineIdx): [offsetFromLineFrontCm, ...] }
    Returns     — dict with bases[], frame extents, leg depths, etc.

    Pure default positioning, no user override. User edits
    (move/add/delete) are applied later by
    `_apply_persisted_position_overrides` on the row-aggregated base
    list — see `compute_and_save_bases` in projects.py.
    """
    rows = panel_grid.get('rows', [])
    if not rows:
        return None

    row_positions = panel_grid.get('rowPositions') or {}
    short_cm = panel_width_cm
    long_cm = panel_length_cm

    # ── Frame X extent (from panel positions) ──────────────────────────────
    auto_start = float('inf')
    auto_end = float('-inf')
    for line_idx, cells in enumerate(rows):
        orient = infer_row_orientation(cells)
        if not orient:
            continue
        panel_along_cm = short_cm if orient == PANEL_V else long_cm
        stored = row_positions.get(str(line_idx))
        positions = stored if stored else default_panel_positions(cells, panel_along_cm, panel_gap_cm)
        if not positions:
            continue
        auto_start = min(auto_start, positions[0])
        auto_end = max(auto_end, positions[-1] + panel_along_cm)

    if auto_start == float('inf'):
        return None

    frame_start_cm = trap_start_cm if trap_start_cm is not None else auto_start
    frame_end_cm = trap_end_cm if trap_end_cm is not None else auto_end
    frame_length_cm = frame_end_cm - frame_start_cm
    frame_length_mm = round(frame_length_cm * 10)

    # ── Parallel purlin spacing snap (iskurit / insulated_panel) ────────────
    rs = roof_spec or {}
    roof_type = rs.get('type', 'concrete')
    if roof_type in ('iskurit', 'insulated_panel'):
        orientation = rs.get('installationOrientation')
        purlin_dist_cm = rs.get('distanceBetweenPurlinsCm')
        if orientation == 'parallel' and purlin_dist_cm and purlin_dist_cm > 0:
            purlin_dist_mm = purlin_dist_cm * 10
            n = max(1, math.floor(spacing_mm / purlin_dist_mm))
            spacing_mm = n * purlin_dist_mm

    spacing_cm = spacing_mm / 10
    edge_spacing_cm = (edge_spacing_mm / 10) if edge_spacing_mm else None

    # ── Base X positions (cm from area start corner) ───────────────────────
    inner_span_mm = frame_length_mm - 2 * edge_offset_mm
    is_purlin_parallel = roof_type in ('iskurit', 'insulated_panel') and rs.get('installationOrientation') == 'parallel' and spacing_mm > 0

    if is_purlin_parallel:
        # Purlin-aligned: fixed spacing, adjust edge offset to center within frame.
        # Edge tightening is intentionally NOT applied here — bases must stay on
        # purlin lines, so the outermost span can't be pulled to an arbitrary value.
        num_spans = max(1, math.floor(inner_span_mm / spacing_mm))
        total_bases_span = num_spans * spacing_mm
        adjusted_edge_mm = (frame_length_mm - total_bases_span) / 2
        num_bases = num_spans + 1
        base_offsets_cm = [
            round_to_2dp(adjusted_edge_mm / 10 + i * (spacing_mm / 10))
            for i in range(num_bases)
        ]
    else:
        effective_edge_mm = _optimize_edge_offset(
            edge_offset_mm, frame_length_mm, spacing_mm,
            edge_offset_tolerance_pct,
        )
        effective_inner_span_mm = frame_length_mm - 2 * effective_edge_mm
        start_off = round_to_2dp(effective_edge_mm / 10)
        end_off = round_to_2dp((frame_length_mm - effective_edge_mm) / 10)
        if _edge_spacing_active(spacing_cm, edge_spacing_cm):
            # Set the outermost span at BOTH ends to edge_spacing (planner's
            # choice — tighter or wider than spacing); even-fill the interior.
            # The two edge spans are excluded from the fill so a wider edge span
            # is never subdivided.
            anchors = [start_off, end_off]
            left_cand = round_to_2dp(start_off + edge_spacing_cm)
            right_cand = round_to_2dp(end_off - edge_spacing_cm)
            add_left = start_off + 1e-6 < left_cand < end_off - 1e-6
            add_right = start_off + 1e-6 < right_cand < end_off - 1e-6
            if add_left and add_right and left_cand >= right_cand - 1e-6:
                add_left = add_right = False  # span too short for both ends
            left_edge_off = left_cand if add_left else None
            right_edge_off = right_cand if add_right else None
            if add_left:
                anchors.append(left_cand)
            if add_right:
                anchors.append(right_cand)
            anchors = sorted(set(anchors))
            base_offsets_cm = [anchors[0]]
            for i in range(1, len(anchors)):
                prev, cur = anchors[i - 1], anchors[i]
                is_left_edge = left_edge_off is not None and i == 1 and cur == left_edge_off
                is_right_edge = right_edge_off is not None and i == len(anchors) - 1 and prev == right_edge_off
                if not (is_left_edge or is_right_edge):
                    base_offsets_cm.extend(_even_fill_interior(prev, cur, spacing_cm))
                base_offsets_cm.append(cur)
        else:
            # Original even division (unchanged when edge spacing is inert).
            num_spans = max(1, math.ceil(effective_inner_span_mm / spacing_mm))
            actual_spacing_cm = (effective_inner_span_mm / num_spans) / 10
            num_bases = num_spans + 1
            base_offsets_cm = [
                round_to_2dp(effective_edge_mm / 10 + i * actual_spacing_cm)
                for i in range(num_bases)
            ]

    actual_spacing_mm = (
        round((base_offsets_cm[1] - base_offsets_cm[0]) * 10)
        if len(base_offsets_cm) > 1 else 0
    )

    # `base_offsets_cm` are SUB-TRAP-relative — convert to row-absolute
    # coordinates by adding the sub-trap's frame start. (User overrides
    # are ROW-ABSOLUTE and applied later by
    # `_apply_persisted_position_overrides` on the row-coord row_bases
    # list, not here.)
    bases = [
        {
            'baseId': f'B{i + 1}',
            'offsetFromStartCm': round_to_2dp(frame_start_cm + off),
            'trapezoidId': trapezoid_id,
        }
        for i, off in enumerate(base_offsets_cm)
    ]

    # ── Cumulative line depths (cm from rear edge of area) ─────────────────
    line_infos = build_line_infos(panel_grid, panel_width_cm, panel_length_cm, line_gap_cm)
    active_line_idxs = sorted(line_infos.keys())
    if not active_line_idxs:
        return None

    # ── Rear and front leg depth positions ─────────────────────────────────
    rear_idx = active_line_idxs[0]
    front_idx = active_line_idxs[-1]
    rear_line = line_infos[rear_idx]
    front_line = line_infos[front_idx]
    rear_rails = line_rails.get(str(rear_idx), [])
    front_rails = line_rails.get(str(front_idx), [])

    rear_leg_depth_cm = rear_line['rearEdgeCm'] + (rear_rails[0] if rear_rails else 0)
    front_leg_depth_cm = front_line['rearEdgeCm'] + (
        front_rails[-1] if front_rails else front_line['depthCm']
    )

    base_top_depth_cm = rear_leg_depth_cm - base_overhang_cm
    base_bottom_depth_cm = front_leg_depth_cm + base_overhang_cm
    base_length_cm = base_bottom_depth_cm - base_top_depth_cm

    # ── Per-base depth positions ───────────────────────────────────────────
    for base in bases:
        assign_base_depth(
            base, panel_grid, line_infos, line_rails,
            panel_width_cm, panel_length_cm, panel_gap_cm, base_overhang_cm,
            fallback_panel_line_idx=rear_idx,
            fallback_start_cm=base_top_depth_cm - rear_line['rearEdgeCm'],
            fallback_length_cm=base_length_cm,
        )

    # Block positions are computed in trapezoid_detail_service (single source of truth).
    # The FE bases view reads blocks from computedTrapezoids[trapId].blocks.

    max_edge_offset_mm = round(frame_length_mm / 2.0, 1)
    effective_edge_for_spacing = min(edge_offset_mm, max_edge_offset_mm)
    max_spacing_mm = round(max(0.0, frame_length_mm - 2.0 * effective_edge_for_spacing), 1)

    return {
        'trapezoidId': trapezoid_id,
        'bases': bases,
        'frameStartCm': round_to_2dp(frame_start_cm),
        'frameLengthCm': round_to_2dp(frame_length_cm),
        'rearLegDepthCm': round_to_2dp(rear_leg_depth_cm),
        'frontLegDepthCm': round_to_2dp(front_leg_depth_cm),
        'baseTopDepthCm': round_to_2dp(base_top_depth_cm),
        'baseBottomDepthCm': round_to_2dp(base_bottom_depth_cm),
        'baseLengthCm': round_to_2dp(base_length_cm),
        'actualSpacingMm': actual_spacing_mm,
        'baseCount': len(bases),
        'effectiveBasesSettings': {
            'maxEdgeOffsetMm': max_edge_offset_mm,
            'edgeOffsetClamped': edge_offset_mm > max_edge_offset_mm,
            'maxSpacingMm': max_spacing_mm,
            'spacingClamped': spacing_mm > max_spacing_mm,
        },
    }


def compute_row_bases(
    rails_for_row: list[dict],
    panel_grid: dict,
    panel_width_cm: float,
    panel_length_cm: float,
    line_rails: dict[str, list[float]],
    edge_offset_cm: float,
    base_overhang_cm: float,
    spacing_mm: float,
    panel_gap_cm: float,
    line_gap_cm: float,
    roof_spec: dict | None = None,
    edge_spacing_mm: float | None = None,
) -> dict | None:
    """Compute the DEFAULT base layout for one whole panel ROW.

    Replaces the per-sub-trap even-spacing placement with a rail-driven one:

      Phase 1 — place a base at each rail's two X endpoints, inset from the
                tip by ``edge_offset_cm`` (the rail-end-to-base distance, i.e.
                ``edgeOffsetMm``). Endpoints within ``BASE_DEDUPE_TOL_CM``
                collapse to a single base, keeping the one that covers MORE
                panel lines (the longer beam).
      Edge    — when ``edge_spacing_mm`` is strictly tighter than ``spacing``,
                insert one extra base ``edge_spacing`` in from each of the row's
                two outermost rail-endpoint bases, so the OUTERMOST span at both
                ends equals ``edge_spacing``. Inert (no extra base) otherwise.
      Phase 2 — sort by X and fill any gap wider than ``spacing`` with evenly
                spaced intermediate bases.
      Depth   — each base's rear/front depth (``startCm`` / ``lengthCm``) is
                derived from the panel lines covering its X via
                ``assign_base_depth`` (uniform ``base_overhang_cm``).

    No sub-trap awareness: ``trapezoidId`` is stamped later by the row
    finalizer's signature pass. Returns a dict shaped like
    ``compute_area_bases`` (bases + row frame metadata) or None.
    """
    if not rails_for_row:
        return None

    line_infos = build_line_infos(panel_grid, panel_width_cm, panel_length_cm, line_gap_cm)
    active_line_idxs = sorted(line_infos.keys())
    if not active_line_idxs:
        return None

    # ── Parallel purlin spacing snap (iskurit / insulated_panel) ───────────
    rs = roof_spec or {}
    roof_type = rs.get('type', 'concrete')
    if roof_type in ('iskurit', 'insulated_panel'):
        orientation = rs.get('installationOrientation')
        purlin_dist_cm = rs.get('distanceBetweenPurlinsCm')
        if orientation == 'parallel' and purlin_dist_cm and purlin_dist_cm > 0:
            purlin_dist_mm = purlin_dist_cm * 10
            n = max(1, math.floor(spacing_mm / purlin_dist_mm))
            spacing_mm = n * purlin_dist_mm
            if edge_spacing_mm and edge_spacing_mm > 0:
                ne = max(1, round(edge_spacing_mm / purlin_dist_mm))
                edge_spacing_mm = ne * purlin_dist_mm
    spacing_cm = spacing_mm / 10
    edge_spacing_cm = (edge_spacing_mm / 10) if edge_spacing_mm else None

    def coverage_at(x: float) -> int:
        return len(_active_lines_at_x(
            x, panel_grid, line_infos, panel_width_cm, panel_length_cm, panel_gap_cm,
        ))

    # ── Phase 1: rail-endpoint bases, tolerance dedupe (keep more coverage) ─
    candidates: list[float] = []
    for r in rails_for_row:
        start = r.get('startCm', 0)
        length = r.get('lengthCm', 0)
        candidates.append(round_to_2dp(start + edge_offset_cm))
        candidates.append(round_to_2dp(start + length - edge_offset_cm))
    candidates.sort()

    def pick_winner(cluster: list[float]) -> float:
        # Most covering lines wins; tie → rear-most (smallest X) for stability.
        return max(cluster, key=lambda x: (coverage_at(x), -x))

    phase1_xs: list[float] = []
    cluster: list[float] = []
    for x in candidates:
        if cluster and x - cluster[-1] <= BASE_DEDUPE_TOL_CM:
            cluster.append(x)
        else:
            if cluster:
                phase1_xs.append(pick_winner(cluster))
            cluster = [x]
    if cluster:
        phase1_xs.append(pick_winner(cluster))

    # ── Edge spacing: extra anchor edge_spacing in from each outer tip ─────
    # Inserts a base so the OUTERMOST span at each end equals `edge_spacing`
    # (which the planner may set tighter OR wider than the regular spacing).
    # The two edge spans are excluded from the Phase-2 fill so a wider edge
    # span is never subdivided. Inert (no extra anchor) when edge spacing is
    # unset. When unset, the loop is byte-identical to the old plain even fill.
    anchors = list(phase1_xs)
    left_edge_x: float | None = None
    right_edge_x: float | None = None
    if _edge_spacing_active(spacing_cm, edge_spacing_cm) and len(phase1_xs) >= 2:
        left_cand = round_to_2dp(phase1_xs[0] + edge_spacing_cm)
        right_cand = round_to_2dp(phase1_xs[-1] - edge_spacing_cm)
        # Each candidate must land strictly inside its end gap (before the next
        # existing rail anchor); a requested edge span wider than that gap can't
        # be honoured — the required rail-endpoint base already sits closer.
        add_left = left_cand < phase1_xs[1] - BASE_DEDUPE_TOL_CM
        add_right = right_cand > phase1_xs[-2] + BASE_DEDUPE_TOL_CM
        # Single-gap row (only the two tips): drop both edge anchors only if
        # they'd actually cross — i.e. the row is too short to hold both edge
        # spans. A small middle span between them is fine (and intended), so the
        # guard uses a float epsilon, NOT BASE_DEDUPE_TOL_CM (which would wrongly
        # discard a legitimate sub-tolerance middle gap, e.g. 1300/350/1300).
        if add_left and add_right and left_cand >= right_cand - 1e-6:
            add_left = add_right = False
        if add_left:
            left_edge_x = left_cand
        if add_right:
            right_edge_x = right_cand
        extra = ([left_edge_x] if add_left else []) + ([right_edge_x] if add_right else [])
        if extra:
            anchors = sorted(set(anchors) | set(extra))

    # ── Phase 2: spacing fill — even-fill every interior gap, but leave the
    # two edge spans (tip ↔ edge anchor) untouched so they stay exactly
    # `edge_spacing` even when that's wider than `spacing`. ─────────────────
    xs: list[float] = []
    for i, x in enumerate(anchors):
        if i == 0:
            xs.append(x)
            continue
        prev = anchors[i - 1]
        is_left_edge_span = left_edge_x is not None and i == 1 and x == left_edge_x
        is_right_edge_span = right_edge_x is not None and i == len(anchors) - 1 and prev == right_edge_x
        if not (is_left_edge_span or is_right_edge_span):
            xs.extend(_even_fill_interior(prev, x, spacing_cm))
        xs.append(x)

    # ── Row frame metadata (rear/front leg depth, base extents) ────────────
    rear_idx = active_line_idxs[0]
    front_idx = active_line_idxs[-1]
    rear_line = line_infos[rear_idx]
    front_line = line_infos[front_idx]
    rear_rails = line_rails.get(str(rear_idx), [])
    front_rails = line_rails.get(str(front_idx), [])
    rear_leg_depth_cm = rear_line['rearEdgeCm'] + (rear_rails[0] if rear_rails else 0)
    front_leg_depth_cm = front_line['rearEdgeCm'] + (
        front_rails[-1] if front_rails else front_line['depthCm']
    )
    base_top_depth_cm = rear_leg_depth_cm - base_overhang_cm
    base_bottom_depth_cm = front_leg_depth_cm + base_overhang_cm
    base_length_cm = base_bottom_depth_cm - base_top_depth_cm

    # ── Build bases + per-base depth ───────────────────────────────────────
    bases: list[dict] = []
    for i, x in enumerate(xs):
        base = {
            'baseId': f'B{i + 1}',
            'offsetFromStartCm': round_to_2dp(x),
            'trapezoidId': '',
        }
        assign_base_depth(
            base, panel_grid, line_infos, line_rails,
            panel_width_cm, panel_length_cm, panel_gap_cm, base_overhang_cm,
            fallback_panel_line_idx=rear_idx,
            fallback_start_cm=base_top_depth_cm - rear_line['rearEdgeCm'],
            fallback_length_cm=base_length_cm,
        )
        bases.append(base)

    # Row X extent from panel positions (for the FE spacing/edge clamps).
    auto_start = float('inf')
    auto_end = float('-inf')
    for li, cells in enumerate(panel_grid.get('rows', [])):
        orient = infer_row_orientation(cells)
        if not orient:
            continue
        panel_along_cm = panel_width_cm if orient == PANEL_V else panel_length_cm
        stored = (panel_grid.get('rowPositions') or {}).get(str(li))
        positions = stored if stored else default_panel_positions(cells, panel_along_cm, panel_gap_cm)
        if not positions:
            continue
        auto_start = min(auto_start, positions[0])
        auto_end = max(auto_end, positions[-1] + panel_along_cm)
    frame_start_cm = auto_start if auto_start != float('inf') else 0.0
    frame_end_cm = auto_end if auto_end != float('-inf') else 0.0
    frame_length_cm = max(0.0, frame_end_cm - frame_start_cm)
    frame_length_mm = round(frame_length_cm * 10)

    # Largest realised gap between consecutive bases → reported spacing.
    actual_spacing_mm = 0
    if len(bases) > 1:
        gaps = [bases[i + 1]['offsetFromStartCm'] - bases[i]['offsetFromStartCm']
                for i in range(len(bases) - 1)]
        actual_spacing_mm = round(max(gaps) * 10) if gaps else 0

    max_spacing_mm = frame_length_mm  # no edge offset in the new model

    return {
        'trapezoidId': '',
        'bases': bases,
        'frameStartCm': round_to_2dp(frame_start_cm),
        'frameLengthCm': round_to_2dp(frame_length_cm),
        'rearLegDepthCm': round_to_2dp(rear_leg_depth_cm),
        'frontLegDepthCm': round_to_2dp(front_leg_depth_cm),
        'baseTopDepthCm': round_to_2dp(base_top_depth_cm),
        'baseBottomDepthCm': round_to_2dp(base_bottom_depth_cm),
        'baseLengthCm': round_to_2dp(base_length_cm),
        'actualSpacingMm': actual_spacing_mm,
        'baseCount': len(bases),
        'effectiveBasesSettings': {
            'maxEdgeOffsetMm': round(frame_length_mm / 2.0, 1),
            'edgeOffsetClamped': False,
            'maxSpacingMm': max_spacing_mm,
            'spacingClamped': spacing_mm > max_spacing_mm,
        },
    }


# ── Frameless-roof anchor points (tiles, flat_installation) ─────────────────

def line_rear_edges_cm(
    panel_grid: dict,
    panel_width_cm: float,
    panel_length_cm: float,
    line_gap_cm: float,
) -> dict[int, float]:
    """Cumulative rear-edge position (cm from area's rear edge) for each line.

    Mirrors the line-info computation in `compute_area_bases`. Used by both
    frameless-anchor hook offsets and external-diagonal Y-overlap geometry —
    `Base.startCm` is line-relative (depth from `panelLineIdx`'s rear), so any
    comparison across bases on different lines must add this offset first.
    """
    rows = panel_grid.get('rows', [])
    out: dict[int, float] = {}
    cumulative = 0.0
    for line_idx, cells in enumerate(rows):
        orient = infer_row_orientation(cells)
        if line_idx > 0:
            cumulative += line_gap_cm
        depth = panel_length_cm if orient == PANEL_V else (panel_width_cm if orient == PANEL_H else 0)
        if orient:
            out[line_idx] = cumulative
        cumulative += depth
    return out


def fill_frameless_anchors_offsets(
    bases: list[dict],
    rails: list[dict],
    panel_grid: dict,
    panel_width_cm: float,
    panel_length_cm: float,
    line_gap_cm: float,
) -> None:
    """For each base, populate `base['hookOffsets']` with the rail × base
    intersection positions (in cm from the base's `startCm`, measured along
    the base's depth axis). Mutates `bases` in place.

    Both `rail.offsetFromRearEdgeCm` and `base.startCm` are LINE-relative
    in the source data (relative to the rail's owning line and the base's
    `panelLineIdx` respectively). They are translated into a shared
    area-Y space using each line's cumulative rear-edge offset before
    intersection — otherwise rails from different lines collapse together.

    A rail is considered to cross a base only when both:
      • the rail's area-Y lies within the base's area-Y span, AND
      • the base's X position lies within the rail's X span
        (`startCm .. startCm + lengthCm`).

    Called only on frameless-roof rows (tiles, flat_installation). Non-frameless
    rows do not invoke this, so concrete / iskurit / insulated bases keep an
    empty `hookOffsets`.
    """
    line_rears = line_rear_edges_cm(panel_grid, panel_width_cm, panel_length_cm, line_gap_cm)
    for b in bases:
        base_line = b.get('panelLineIdx', 0)
        base_rear = line_rears.get(base_line, 0.0)
        base_y0 = base_rear + b.get('startCm', 0)
        base_y1 = base_y0 + b.get('lengthCm', 0)
        base_x = b.get('offsetFromStartCm', 0)
        offsets: list[float] = []
        for r in rails:
            line_rear = line_rears.get(r.get('lineIdx', 0), 0.0)
            rail_y = line_rear + r.get('offsetFromRearEdgeCm', 0)
            if not (base_y0 <= rail_y <= base_y1):
                continue
            r_start = r.get('startCm', 0)
            r_end = r_start + r.get('lengthCm', 0)
            if not (r_start <= base_x <= r_end):
                continue
            offsets.append(round_to_2dp(rail_y - base_y0))
        b['hookOffsets'] = offsets


# ── External diagonals (runs after trapezoid details) ────────────────────────

def _select_row_pairs(
    bases: list[dict],
    line_rears_cm: dict[int, float] | None = None,
) -> list[tuple[int, int, bool, bool]]:
    """Pick `(outer_idx, inner_idx, emit_rear, emit_front)` pairs for a row.

    `bases` MUST be sorted by `offsetFromStartCm` (left → right along the row).
    Each tuple is oriented so `outer_idx` is the row-edge anchor (FE renders
    the cyan endpoint at that base, tilts the inner end inward by one block
    length). The `emit_*` flags tell the emission step which of the two
    overlap-edge diagonals to actually produce — extension pairs only emit
    at the side of the seam where the longer base's flank is exposed, so
    we don't duplicate a same-Y diagonal one base over from the existing
    row-end brace ("gap of 1 base between diagonals").

    Selection rules:
      A) Row outer ends — (0,1) and (n-2,n-1) always braced, both edges.
      B) Shape-edge seams — consecutive pair where the trapezoid changes OR
         `lengthCm` differs by more than `LENGTH_TRANSITION_TOL_CM`. Both
         edges of the seam pair's overlap are emitted (those are the actual
         exposed shape transitions).
      C) Long-side extension — when a seam at (i,i+1) has one base materially
         longer in Y than the other, also brace the adjacent pair on the
         longer side, but only at the Y edge where the long base actually
         extends past the short one. (e.g. A1 extends past A2 in front only
         → emit only the front-edge diagonal of the extension pair; D's D2
         extends past D1 on both rear and front → emit both.)
      D) Inward expansion — fill remaining unbraced consecutive pairs only
         across runs of same-trap, same-length bases, alternating left/right.
    """
    n = len(bases)
    if n < 2:
        return []

    line_rears = line_rears_cm or {}

    def _y_range(b: dict) -> tuple[float, float]:
        rear = line_rears.get(b.get('panelLineIdx', 0), 0.0) + b.get('startCm', 0)
        return rear, rear + b.get('lengthCm', 0)

    # raw_pairs entries: [lo, hi, emit_rear, emit_front, outer_hint]
    # outer_hint ∈ {'lo', 'hi', None}: which index of the pair is the OUTER
    # (cyan-endpoint) anchor. First non-None hint wins on duplicate adds.
    raw_pairs: list[list] = []
    seen: dict[tuple[int, int], int] = {}  # (lo,hi) → index into raw_pairs
    connected: set[int] = set()

    def add(
        a: int, b: int,
        emit_rear: bool = True, emit_front: bool = True,
        outer_hint: str | None = None,
    ) -> None:
        if a == b:
            return
        key = (min(a, b), max(a, b))
        if key in seen:
            entry = raw_pairs[seen[key]]
            entry[2] = entry[2] or emit_rear
            entry[3] = entry[3] or emit_front
            if entry[4] is None and outer_hint is not None:
                entry[4] = outer_hint
            return
        seen[key] = len(raw_pairs)
        raw_pairs.append([key[0], key[1], emit_rear, emit_front, outer_hint])
        connected.update(key)

    # Rule A — outer ends (explicit orientation: left-end anchored at lo, right
    # at hi)
    add(0, 1, outer_hint='lo')
    if n > 2:
        add(n - 2, n - 1, outer_hint='hi')

    # Rule B — shape-edge seams (+ Rule C as a consequence of each seam)
    def _is_seam(a: dict, b: dict) -> bool:
        if a.get('trapezoidId') != b.get('trapezoidId'):
            return True
        return abs(a.get('lengthCm', 0) - b.get('lengthCm', 0)) > LENGTH_TRANSITION_TOL_CM

    for i in range(n - 1):
        a, b = bases[i], bases[i + 1]
        if not _is_seam(a, b):
            continue
        add(i, i + 1)
        # Rule C — extension on the longer base's exposed Y-flank, but only
        # when the seam itself sits at a row outer end. An interior seam's
        # long-side flank is already braced by whichever row-end pair is on
        # that side; the extension would just land deep interior with no
        # adjacent row-end pair (redundant, gap of >1 base to any neighbor).
        if i != 0 and i + 1 != n - 1:
            continue
        # Compare the actual area-Y ranges rather than raw lengthCm: cross-
        # line seams can leave equal-length bases sitting at different Y
        # origins, and we need to brace whichever flank is exposed.
        a_rear, a_front = _y_range(a)
        b_rear, b_front = _y_range(b)
        a_y_len = a_front - a_rear
        b_y_len = b_front - b_rear
        tol = LENGTH_TRANSITION_TOL_CM
        if a_y_len - b_y_len > tol and i > 0:
            emit_rear = a_rear < b_rear - tol
            emit_front = a_front > b_front + tol
            if emit_rear or emit_front:
                # Extension on the long-base side of the seam: outer anchor is
                # the index ADJACENT to the seam (i.e., `i`), which is the `hi`
                # of pair (i-1, i).
                add(i - 1, i, emit_rear=emit_rear, emit_front=emit_front,
                    outer_hint='hi')
        elif b_y_len - a_y_len > tol and i + 2 < n:
            emit_rear = b_rear < a_rear - tol
            emit_front = b_front > a_front + tol
            if emit_rear or emit_front:
                # Mirror: outer anchor is `i+1` (adjacent to seam), which is
                # the `lo` of pair (i+1, i+2).
                add(i + 1, i + 2, emit_rear=emit_rear, emit_front=emit_front,
                    outer_hint='lo')

    # Rule D — inward expansion over uniform (same-trap, same-length) runs
    left_next = 0
    right_next = n - 1
    while True:
        added = False
        while left_next + 1 < n:
            a, b = left_next, left_next + 1
            if a in connected or b in connected or _is_seam(bases[a], bases[b]):
                left_next += 1
                continue
            add(a, b)
            left_next = b + 1
            added = True
            break
        while right_next - 1 >= 0:
            a, b = right_next, right_next - 1
            if a in connected or b in connected or _is_seam(bases[a], bases[b]):
                right_next -= 1
                continue
            add(a, b)
            right_next = b - 1
            added = True
            break
        if not added:
            break

    # Orient each pair as (outer, inner). `outer_hint` pins the orientation;
    # row-end pairs and extension pairs both supply hints, so unhinted pairs
    # (purely interior expansion, middle seams) default to (lo, hi).
    oriented: list[tuple[int, int, bool, bool]] = []
    for lo, hi, er, ef, hint in raw_pairs:
        if hint == 'hi':
            oriented.append((hi, lo, er, ef))
        else:
            oriented.append((lo, hi, er, ef))
    return oriented


def _interp_leg_height_cm(
    base: dict,
    off_along_base_cm: float,
    bases_data_map: dict[str, dict],
    trap_geom: dict[str, dict],
) -> float:
    """Linear interpolation of leg height (cm) at a depth along the base.

    `off_along_base_cm` is measured from `base.startCm` along the base's depth
    axis (0 = rear edge of the base in its own line frame, lengthCm = front edge).
    The leg-height profile (heightRear → heightFront) is keyed off the trap's
    rear/front leg depths and evaluated at the absolute depth-from-trap-rear.
    """
    bd = bases_data_map.get(base.get('trapezoidId', ''), {}) or {}
    geom = trap_geom.get(base.get('trapezoidId', ''), {}) or {}
    edge_depth_cm = bd.get('baseTopDepthCm', 0) + off_along_base_cm
    rl = bd.get('rearLegDepthCm', 0)
    fl = bd.get('frontLegDepthCm', 0)
    hr = geom.get('heightRear', 0)
    hf = geom.get('heightFront', 0)
    if fl <= rl or hr <= 0:
        return 0.0
    t = max(0.0, min(1.0, (edge_depth_cm - rl) / (fl - rl)))
    return hr + t * (hf - hr)


def _rail_select_subrow_pairs(n: int) -> list[tuple[int, int]]:
    """Outer-pairs-plus-alternating-expansion on a `n`-base sub-row.

    No seam / shape logic — sub-rows here are slices of bases that all
    intersect a given rail, so every consecutive pair sits at the rail's Y.
    Returns (lo, hi) tuples in the order they're added (Rule A first, then
    Rule D alternating-walk expansion). Orientation handled by the caller.
    """
    if n < 2:
        return []
    pairs: list[tuple[int, int]] = []
    seen: set[tuple[int, int]] = set()
    connected: set[int] = set()

    def add(a: int, b: int) -> None:
        if a == b:
            return
        key = (min(a, b), max(a, b))
        if key in seen:
            return
        seen.add(key)
        pairs.append(key)
        connected.update(key)

    add(0, 1)
    if n > 2:
        add(n - 2, n - 1)
    left_next, right_next = 0, n - 1
    while True:
        added = False
        while left_next + 1 < n:
            a, b = left_next, left_next + 1
            if a in connected or b in connected:
                left_next += 1
                continue
            add(a, b); left_next = b + 1; added = True; break
        while right_next - 1 >= 0:
            a, b = right_next, right_next - 1
            if a in connected or b in connected:
                right_next -= 1
                continue
            add(a, b); right_next = b - 1; added = True; break
        if not added:
            break
    return pairs


def _base_slope_y_range(
    base: dict, base_rear_y: float, base_front_y: float, trap_geom: dict[str, dict],
) -> tuple[float, float]:
    """Y range covered by a base's SLOPE beam — i.e. the un-extended portion
    of the base bar. External diagonals must attach within this range so they
    sit inside the panel area, not on the dashed extension(s).

    The variation's intrinsic extension lives at
    `computedTrapezoid[<base.trapezoidId>].geometry.extensions[0]` under the
    user-facing convention (frontExtMm = beam-FRONT, backExtMm = beam-REAR).
    Returns the full base Y range as a graceful fallback if extensions
    would collapse it to a non-positive interval.
    """
    tid = base.get('trapezoidId', '')
    geom = trap_geom.get(tid, {})
    exts = geom.get('extensions') or []
    if not exts:
        return base_rear_y, base_front_y
    ext = exts[0] or {}
    angle = geom.get('angle', 0)
    cos_a = math.cos(math.radians(angle)) or 1.0
    inv_cos = 1.0 / cos_a if cos_a > 0 else 1.0
    front_ext_cm = (float(ext.get('frontExtMm') or 0) / 10) * inv_cos
    back_ext_cm = (float(ext.get('backExtMm') or 0) / 10) * inv_cos
    rear = base_rear_y + back_ext_cm
    front = base_front_y - front_ext_cm
    return (rear, front) if front > rear else (base_rear_y, base_front_y)


def _compute_diagonals_via_rails(
    rails: list[dict],
    row_bases: list[dict],
    bases_data_map: dict[str, dict],
    trap_geom: dict[str, dict],
    line_rears: dict[int, float],
    min_height_cm: float = 0,
) -> list[dict]:
    """Rails-based external-diagonal placement.

    Two passes:
      1. Identify the rear-most and front-most rails of the area (the
         "external" rails). For each, gather the bases it intersects (Y in
         base's area-Y range AND X in rail's X span). Run standard
         outer-pair + alternating expansion on that sub-row and emit one
         diagonal per pair at the rail's area-Y.
      2. For every remaining (internal) rail, gather intersecting bases. If
         the sub-row's left or right end is INTERIOR to the overall row
         (i.e., the overall row continues beyond on that side), the sub-row
         end is a shape edge. Emit one brace pair at each such edge.

    Endpoints are line-relative offsets along each base: `off = rail.Y −
    base.areaYRear`. Heights come from `_interp_leg_height_cm` evaluated at
    the OUTER base's offset.
    """
    if not rails or len(row_bases) < 2:
        return []

    def rail_y(rail: dict) -> float:
        return line_rears.get(rail.get('lineIdx', 0), 0.0) + rail.get('offsetFromRearEdgeCm', 0)

    def base_y_range(base: dict) -> tuple[float, float]:
        # Slope-beam-only Y range (excludes back/front extensions). Rails on
        # the extension shouldn't anchor diagonals — those would sit outside
        # the panel area.
        rear = line_rears.get(base.get('panelLineIdx', 0), 0.0) + base.get('startCm', 0)
        full_front = rear + base.get('lengthCm', 0)
        return _base_slope_y_range(base, rear, full_front, trap_geom)

    tol = 0.5  # cm — tolerance for the strict-inequality intersection check

    def intersects(base: dict, rail: dict) -> bool:
        # A base belongs to a rail's sub-row only when the rail physically
        # crosses it: the rail's Y lies in the base's Y-span AND the base's X
        # lies within the rail's X-span. The X check matters for shapes with
        # separate columns at the same depth (e.g. the two towers of a U/M
        # shape) — without it a rail in one tower would wrongly pair with the
        # other tower's bases at the same Y, producing gap-spanning diagonals.
        ry = rail_y(rail)
        by_rear, by_front = base_y_range(base)
        if not (by_rear - tol <= ry <= by_front + tol):
            return False
        bx = base.get('offsetFromStartCm', 0)
        rx0 = rail.get('startCm', 0)
        rx1 = rx0 + rail.get('lengthCm', 0)
        return rx0 - tol <= bx <= rx1 + tol

    # Map each base in row_bases to its index so emitted indices align with
    # the stored array regardless of sort order.
    base_idx_by_id: dict[str, int] = {}
    for i, b in enumerate(row_bases):
        bid = b.get('baseId')
        if bid:
            base_idx_by_id[bid] = i

    bases_sorted = sorted(row_bases, key=lambda b: b.get('offsetFromStartCm', 0))
    rails_sorted = sorted(rails, key=rail_y)

    diagonals: list[dict] = []

    def actual_rear_y(base: dict) -> float:
        # Offsets along the base must be measured from the base's TRUE rear
        # (where the base bar physically starts, including back-ext), not the
        # slope-only range used for pair selection — otherwise emitted
        # offsets would be off by the back-ext amount.
        return line_rears.get(base.get('panelLineIdx', 0), 0.0) + base.get('startCm', 0)

    def emit(rail: dict, outer: dict, inner: dict) -> None:
        ry = rail_y(rail)
        out_len = outer.get('lengthCm', 0)
        inn_len = inner.get('lengthCm', 0)
        out_rear = actual_rear_y(outer)
        inn_rear = actual_rear_y(inner)
        off_outer = max(0.0, min(out_len, ry - out_rear))
        off_inner = max(0.0, min(inn_len, ry - inn_rear))
        horiz_mm = round(abs(inner.get('offsetFromStartCm', 0) - outer.get('offsetFromStartCm', 0)) * 10)
        height_at_edge_cm = _interp_leg_height_cm(outer, off_outer, bases_data_map, trap_geom)
        # Skip diagonals whose attachment leg is shorter than the configured
        # minimum (extDiagMinHeightCm) — low legs don't warrant external bracing.
        if min_height_cm > 0 and height_at_edge_cm < min_height_cm:
            return
        vert_mm = round(height_at_edge_cm * 10)
        diagonals.append({
            'startBaseIdx': base_idx_by_id.get(outer.get('baseId'), 0),
            'endBaseIdx': base_idx_by_id.get(inner.get('baseId'), 0),
            'startBaseOffsetCm': round_to_2dp(off_outer),
            'startBaseHeightCm': round_to_2dp(height_at_edge_cm),
            'endBaseOffsetCm': round_to_2dp(off_inner),
            'endBaseHeightCm': 0.0,
            'horizMm': horiz_mm,
            'vertMm': vert_mm,
            'diagLengthMm': round(math.sqrt(horiz_mm ** 2 + vert_mm ** 2)),
        })

    # Per base, the rails it intersects (sorted by Y). The first/last entry
    # is the base's rear/front Y-edge; any rail between them crosses the
    # base's middle.
    rails_per_base: dict[str, list[dict]] = {}
    for b in bases_sorted:
        bid = b.get('baseId')
        if bid is None:
            continue
        rails_per_base[bid] = [r for r in rails_sorted if intersects(b, r)]

    def at_y_edge(base: dict, rail: dict) -> bool:
        br = rails_per_base.get(base.get('baseId'), [])
        return bool(br) and (rail is br[0] or rail is br[-1])

    # Dedupe so a 2-base rail whose two ends are both at their Y-edge emits a
    # single brace, not A→B and B→A. Keyed by (rail, unordered base pair).
    emitted: set[tuple[str, int, int]] = set()
    # (railId, baseIdx) junctions already carrying a diagonal endpoint — Step 2
    # skips any pair touching one (cumulative across Step 1 + Step 2).
    junctions: set[tuple[str, int]] = set()

    def emit_pair(rail: dict, outer: dict, inner: dict) -> None:
        oi = base_idx_by_id.get(outer.get('baseId'), -1)
        ii = base_idx_by_id.get(inner.get('baseId'), -1)
        key = (rail.get('railId', ''), min(oi, ii), max(oi, ii))
        if key in emitted:
            return
        emitted.add(key)
        rid = rail.get('railId', '')
        junctions.add((rid, oi))
        junctions.add((rid, ii))
        emit(rail, outer, inner)

    def sub_row_for(rail: dict) -> list[dict]:
        return sorted(
            (b for b in bases_sorted if intersects(b, rail)),
            key=lambda b: b.get('offsetFromStartCm', 0),
        )

    # Step 1 — for every rail, take its two extreme bases (first / last along
    # X). If an extreme base meets the rail at its OWN rear/front Y-edge,
    # brace it to its immediate inward neighbour at the rail's Y. A rail
    # crossing a base's middle contributes nothing there.
    for rail in rails_sorted:
        sub_row = sub_row_for(rail)
        if len(sub_row) < 2:
            continue
        left = sub_row[0]
        if at_y_edge(left, rail):
            emit_pair(rail, left, sub_row[1])
        right = sub_row[-1]
        if at_y_edge(right, rail):
            emit_pair(rail, right, sub_row[-2])

    # Step 2 — fill the rail ends Step 1 missed. Step 1 only braces a rail's
    # EXTREME base; when that extreme base is a long bar passing through (not
    # at its Y-edge here) Step 1 skips the end even though an inner base may
    # terminate at this rail. Walk each rail's pairs L→R and add it1→it2 when
    # (a) neither junction is already braced on this rail, AND (b) it1 or it2
    # terminates at this rail (its own rear/front Y-edge). A rail that only
    # crosses bases' middles (interior rail) terminates none → no diagonal.
    for rail in rails_sorted:
        rid = rail.get('railId', '')
        sub_row = sub_row_for(rail)
        n = len(sub_row)
        if n < 2:
            continue
        for i in range(n - 1):
            it1, it2 = sub_row[i], sub_row[i + 1]
            i1 = base_idx_by_id.get(it1.get('baseId'), -1)
            i2 = base_idx_by_id.get(it2.get('baseId'), -1)
            if (rid, i1) in junctions or (rid, i2) in junctions:
                continue
            if not (at_y_edge(it1, rail) or at_y_edge(it2, rail)):
                continue
            emit_pair(rail, it1, it2)

    return diagonals


def compute_external_diagonals(
    trap_ids: list[str],
    bases_data_map: dict[str, dict],
    consolidated: dict[str, list[dict]],
    computed_trapezoids: list[dict],
    row_bases: list[dict] | None = None,
    line_rears_cm: dict[int, float] | None = None,
    rails: list[dict] | None = None,
    min_height_cm: float = 0,
) -> list[dict]:
    """
    Compute external diagonals for one panel row in one area.

    Runs AFTER trapezoid details so heightRear/heightFront are available.

    Pair selection is row-level (across all traps in the area's row) so single-
    base traps and trap/area seams that today fall through `n < 2` get braced.
    Endpoint placement uses the Y-overlap of the two paired bases — diagonals
    are parallel to rails in plan view, so both endpoints sit at the SAME
    line-rear-relative Y, and an endpoint may land mid-base when the two bases
    don't share a Y origin.

    Parameters
    ----------
    trap_ids
        Ordered list of trapezoid IDs for this area (used only for the legacy
        fallback when `row_bases is None`).
    bases_data_map
        ``{trapId: compute_area_bases() result}`` — supplies `baseTopDepthCm`,
        `rearLegDepthCm`, `frontLegDepthCm` per trap for leg-height
        interpolation.
    consolidated
        ``{trapId: [base, ...]}`` — only used to flatten into a synthetic
        `row_bases` when none is supplied (legacy callers).
    computed_trapezoids
        List of ComputedTrapezoid dicts; supplies `geometry.heightRear/Front`.
    row_bases
        The stored bases list for this row. When supplied, `startBaseIdx` /
        `endBaseIdx` are emitted as positions within this list (via baseId
        lookup) so they line up with the storage.
    line_rears_cm
        ``{panelLineIdx: cm-from-area-rear}``. `Base.startCm` is
        line-relative, so cross-line Y comparison must add this offset.
        Omit (or pass {}) to treat all bases as if they shared a Y origin.
    rails
        Per-row computed rails (each with ``lineIdx``, ``offsetFromRearEdgeCm``,
        ``startCm``, ``lengthCm``). When supplied, selection runs the
        rails-based algorithm: external rails get outer-pair+alternating
        bracing along their intersecting bases, and internal rails brace
        only where the sub-row deviates from the overall row (shape edges).
        Omit to fall back to the legacy base-pair/overlap path.
    """
    trap_geom: dict[str, dict] = {}
    for ct in computed_trapezoids:
        tid = ct.get('trapezoidId', '')
        geom = ct.get('geometry', {})
        if geom:
            trap_geom[tid] = geom

    line_rears = line_rears_cm or {}

    # Source of truth for pair-selection and emitted indices.
    if row_bases is None:
        bases_source = [b for tid in trap_ids for b in consolidated.get(tid, [])]
    else:
        bases_source = row_bases

    if rails:
        return _compute_diagonals_via_rails(
            rails, bases_source, bases_data_map, trap_geom, line_rears,
            min_height_cm=min_height_cm,
        )
    base_idx_by_id: dict[str, int] = {}
    for i, b in enumerate(bases_source):
        bid = b.get('baseId')
        if bid:
            base_idx_by_id[bid] = i

    # Sort a separate list for pair selection; emit indices via `base_idx_by_id`
    # so the storage order is unchanged.
    sorted_bases = sorted(bases_source, key=lambda b: b.get('offsetFromStartCm', 0))
    pairs = _select_row_pairs(sorted_bases, line_rears_cm=line_rears)

    def area_y_of(base: dict, off_along_base_cm: float) -> float:
        return line_rears.get(base.get('panelLineIdx', 0), 0.0) \
               + base.get('startCm', 0) + off_along_base_cm

    result: list[dict] = []
    for outer_idx, inner_idx, emit_rear, emit_front in pairs:
        outer = sorted_bases[outer_idx]
        inner = sorted_bases[inner_idx]
        outer_len = outer.get('lengthCm', 0)
        inner_len = inner.get('lengthCm', 0)
        horiz_mm = round(abs(inner.get('offsetFromStartCm', 0) - outer.get('offsetFromStartCm', 0)) * 10)

        # Y-spans (area-rear-relative) — `Base.startCm` is line-relative so
        # `line_rears` is required to compare across panelLineIdx. The full
        # base extent (y0..y1) is kept for offset math below; pair selection
        # uses the slope-only range so diagonals don't anchor on extensions.
        y_outer0 = area_y_of(outer, 0.0)
        y_outer1 = area_y_of(outer, outer_len)
        y_inner0 = area_y_of(inner, 0.0)
        y_inner1 = area_y_of(inner, inner_len)
        slope_outer0, slope_outer1 = _base_slope_y_range(outer, y_outer0, y_outer1, trap_geom)
        slope_inner0, slope_inner1 = _base_slope_y_range(inner, y_inner0, y_inner1, trap_geom)
        y_rear = max(slope_outer0, slope_inner0)
        y_front = min(slope_outer1, slope_inner1)

        if y_front <= y_rear:
            logger.warning(
                "external_diagonal: no Y-overlap between consecutive bases — "
                "skipped. outer.baseId=%s (Y=[%.2f,%.2f]) inner.baseId=%s (Y=[%.2f,%.2f])",
                outer.get('baseId'), y_outer0, y_outer1,
                inner.get('baseId'), y_inner0, y_inner1,
            )
            continue

        start_idx = base_idx_by_id.get(outer.get('baseId'), outer_idx)
        end_idx = base_idx_by_id.get(inner.get('baseId'), inner_idx)

        for Y, do_emit in ((y_rear, emit_rear), (y_front, emit_front)):
            if not do_emit:
                continue
            off_outer = max(0.0, min(outer_len, Y - y_outer0))
            off_inner = max(0.0, min(inner_len, Y - y_inner0))
            # Both endpoints share Y → same depth-from-area-rear → leg height
            # is structurally identical on both bases by design (parallel-to-
            # rails diagonal). Interpolate on the outer base.
            height_at_edge_cm = _interp_leg_height_cm(outer, off_outer, bases_data_map, trap_geom)
            # Skip diagonals whose attachment leg is below the configured
            # minimum (extDiagMinHeightCm).
            if min_height_cm > 0 and height_at_edge_cm < min_height_cm:
                continue
            vert_mm = round(height_at_edge_cm * 10)
            result.append({
                'startBaseIdx': start_idx,
                'endBaseIdx': end_idx,
                'startBaseOffsetCm': round_to_2dp(off_outer),
                'startBaseHeightCm': round_to_2dp(height_at_edge_cm),
                'endBaseOffsetCm': round_to_2dp(off_inner),
                'endBaseHeightCm': 0.0,
                'horizMm': horiz_mm,
                'vertMm': vert_mm,
                'diagLengthMm': round(math.sqrt(horiz_mm ** 2 + vert_mm ** 2)),
            })

    return result


def bases_completion_for_segmented_rails(
    row_bases: list[dict],
    rails: list[dict],
    panel_grid: dict,
    panel_width_cm: float,
    panel_length_cm: float,
    panel_gap_cm: float,
    edge_offset_mm: float,
) -> None:
    """Ensure every rail segment is supported by ≥ 2 bases (in place).

    When a rail segment has only one base under it (typical for line-0 split
    segments over a single panel column after the hole), this brings the
    segment up to 2 bases. The two bases sit at the standard edge-offset from
    each end of the segment's panel-column frame, which means the existing
    single base may also be relocated to the closest std position.

    Runs after `compute_row_bases` + signature reassignment, so the base
    list reflects the final per-row layout. The
    new base inherits trapezoidId / panelLineIdx / startCm / lengthCm from
    the existing base in the segment (same column → same depth properties).

    Segments with 0 or ≥ 2 bases are left alone.
    """
    if not rails or not row_bases:
        return

    rows_cells = panel_grid.get('rows') or []
    row_positions = panel_grid.get('rowPositions') or {}
    edge_offset_cm = edge_offset_mm / 10

    # Dedupe rails by physical segment (same lineIdx + startCm + lengthCm).
    # The BE emits one rail per Y-offset per segment; the segment-level rule
    # should fire once per segment, not once per Y-offset.
    seen_segments: set[tuple[int, float, float]] = set()

    for rail in rails:
        line_idx = rail.get('lineIdx', 0)
        rail_start = rail.get('startCm', 0)
        rail_length = rail.get('lengthCm', 0)
        rail_end = rail_start + rail_length

        seg_key = (line_idx, round(rail_start, 2), round(rail_length, 2))
        if seg_key in seen_segments:
            continue
        seen_segments.add(seg_key)

        # Bases under this segment: offset within the rail's x-extent.
        supporting = [
            b for b in row_bases
            if rail_start <= b.get('offsetFromStartCm', 0) <= rail_end
        ]
        if len(supporting) != 1:
            continue
        existing = supporting[0]

        # Find panels in this line covered by the segment → frame for std placement.
        if line_idx >= len(rows_cells):
            continue
        cells = rows_cells[line_idx]
        orient = infer_row_orientation(cells)
        if not orient:
            continue
        panel_along_cm = panel_width_cm if orient == PANEL_V else panel_length_cm

        stored = row_positions.get(str(line_idx))
        positions = stored if stored else default_panel_positions(cells, panel_along_cm, panel_gap_cm)
        if not positions:
            continue

        # A panel is "in" the segment if its full x-range fits within the rail's extent.
        tol = 0.5
        covered = [
            p for p in positions
            if p >= rail_start - tol and p + panel_along_cm <= rail_end + tol
        ]
        if not covered:
            continue

        frame_start = covered[0]
        frame_end = covered[-1] + panel_along_cm
        pos_left = frame_start + edge_offset_cm
        pos_right = frame_end - edge_offset_cm
        if pos_right - pos_left < 1:
            # Frame too narrow for 2 distinct bases — leave as-is.
            continue

        # Move existing to the closer std position; new base at the other.
        existing_pos = existing.get('offsetFromStartCm', 0)
        if abs(existing_pos - pos_left) <= abs(existing_pos - pos_right):
            existing['offsetFromStartCm'] = round_to_2dp(pos_left)
            new_pos = pos_right
        else:
            existing['offsetFromStartCm'] = round_to_2dp(pos_right)
            new_pos = pos_left

        # Skip adding the second base if a neighbour already sits within
        # ~`edge_offset` of the proposed slot. That neighbour — typically
        # an adjacent sub-trap's edge base sitting just across the panel
        # gap — already covers this panel's edge structurally, so a
        # second base here would just be a redundant near-duplicate.
        # Without this guard, narrow split-at-holes segments end up with
        # an extra base right next to the segment-1 entry (the
        # "72cm cluster" bug in multi-sub-trap rows like area D).
        nearby_threshold_cm = 2 * edge_offset_cm  # 70 cm at default settings
        if any(
            b is not existing
            and abs(b.get('offsetFromStartCm', 0) - new_pos) < nearby_threshold_cm
            for b in row_bases
        ):
            continue

        new_base = {
            **existing,
            'baseId': f'B{len(row_bases) + 1}',
            'offsetFromStartCm': round_to_2dp(new_pos),
        }
        row_bases.append(new_base)
