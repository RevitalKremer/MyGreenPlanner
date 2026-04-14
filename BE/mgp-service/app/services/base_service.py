"""
Base layout service — server-side port of FE/src/utils/basesService.js

Computes base positions, block positions, and consolidation for one area
purely from project data (cm measurements, no pixel coordinates).

Depth convention (lineIdx ordering in panelGrid.rows[]):
  lineIdx = 0 → rearmost line (closest to ridge / back of installation).
  Higher lineIdx → frontmost (closest to eave).
"""

from __future__ import annotations
import math
from typing import Optional

from app.utils.math_helpers import round_to_2dp
from app.utils.panel_geometry import infer_row_orientation, default_panel_positions, PANEL_V, PANEL_H


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
    custom_offsets: list[float] | None = None,
    roof_spec: dict | None = None,
    edge_offset_tolerance_pct: float = 0,
) -> dict | None:
    """
    Compute base layout for one area (or trapezoid sub-range).

    panel_grid  — { rows: list[list[str]], rowPositions?: dict[str, list[float]] }
    line_rails  — { str(lineIdx): [offsetFromLineFrontCm, ...] }
    Returns     — dict with bases[], frame extents, leg depths, etc.
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

    # ── Base X positions (cm from area start corner) ───────────────────────
    inner_span_mm = frame_length_mm - 2 * edge_offset_mm
    is_purlin_parallel = roof_type in ('iskurit', 'insulated_panel') and rs.get('installationOrientation') == 'parallel' and spacing_mm > 0

    if custom_offsets and len(custom_offsets) > 0:
        base_offsets_cm = [mm / 10 for mm in custom_offsets]
    elif is_purlin_parallel:
        # Purlin-aligned: fixed spacing, adjust edge offset to center within frame
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

    bases = [
        {
            'baseId': f'B{i + 1}',
            'offsetFromStartCm': round_to_2dp(frame_start_cm + off),
            'trapezoidId': trapezoid_id,
        }
        for i, off in enumerate(base_offsets_cm)
    ]

    # ── Cumulative line depths (cm from rear edge of area) ─────────────────
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
        base_x = base['offsetFromStartCm']
        active_lines_for_base = []

        for li, cells in enumerate(rows):
            orient = infer_row_orientation(cells)
            if not orient or li not in line_infos:
                continue
            panel_along_cm = short_cm if orient == PANEL_V else long_cm
            stored = row_positions.get(str(li))
            positions = stored if stored else default_panel_positions(cells, panel_along_cm, panel_gap_cm)
            if not positions:
                continue
            # Check if base falls within the line's overall panel extent
            # (first panel start to last panel end), not requiring exact panel alignment
            line_start = positions[0]
            line_end = positions[-1] + panel_along_cm
            if base_x >= line_start and base_x <= line_end:
                active_lines_for_base.append(li)

        if active_lines_for_base:
            b_rear_idx = min(active_lines_for_base)
            b_front_idx = max(active_lines_for_base)
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
        else:
            base['panelLineIdx'] = rear_idx
            base['startCm'] = round_to_2dp(base_top_depth_cm - rear_line['rearEdgeCm'])
            base['lengthCm'] = round_to_2dp(base_length_cm)

    # Block positions are computed in trapezoid_detail_service (single source of truth).
    # The FE bases view reads blocks from computedTrapezoids[trapId].blocks.

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
    }


# ── External diagonals (runs after trapezoid details) ────────────────────────

def _diagonal_pairs(n: int, base_lengths: list[float] | None = None) -> list[list[int]]:
    """Compute diagonal base pairs: outer pairs + corner pairs + inward expansion.

    Step 1 — always add outer pairs [0,1] and [n-1,n-2].
    Corner detection — scan inward from each side; where base length changes
    (short→long), add a corner pair at the first two long bases. This covers
    the structural "corners" of irregular area shapes (e.g. L-shaped).
    Expansion — from all seed pairs, continue inward with consecutive pairs,
    alternating left/right, stop when pairs overlap.
    """
    if n < 2:
        return []

    connected: set[int] = set()
    pairs: list[list[int]] = []

    def _add(a: int, b: int) -> None:
        pairs.append([a, b])
        connected.update([a, b])

    # ── Step 1: outer pairs ───────────────────────────────────────────────
    _add(0, 1)
    if n > 2:
        _add(n - 1, n - 2)

    # ── Corner pairs: detect length transitions from each side ────────────
    lens = base_lengths or []
    threshold = 1.0  # cm

    if len(lens) >= n:
        # From left: scan inward, find first short→long transition
        for i in range(n - 2):
            if lens[i + 1] - lens[i] > threshold:
                # Corner: add first two long bases (left→right)
                if i + 2 < n and (i + 1) not in connected:
                    _add(i + 1, i + 2)
                elif i + 2 < n and (i + 2) not in connected:
                    _add(i + 1, i + 2)
                break
            if lens[i] - lens[i + 1] > threshold:
                break  # getting shorter — no corner from this side

        # From right: scan inward, find first short→long transition
        for i in range(n - 1, 0, -1):
            if lens[i - 1] - lens[i] > threshold:
                # Corner: add first two long bases (right→left)
                if i - 2 >= 0 and (i - 1) not in connected:
                    _add(i - 1, i - 2)
                elif i - 2 >= 0 and (i - 2) not in connected:
                    _add(i - 1, i - 2)
                break
            if lens[i] - lens[i - 1] > threshold:
                break  # getting shorter — no corner from this side

    # ── Expansion: inward from both ends ──────────────────────────────────
    left_next = min((i for i in range(n) if i not in connected), default=n)
    right_next = max((i for i in range(n) if i not in connected), default=-1)

    while True:
        added = False

        # Left side: find next unconnected consecutive pair (left→right)
        while left_next + 1 < n:
            a, b = left_next, left_next + 1
            if a not in connected and b not in connected:
                _add(a, b)
                left_next = b + 1
                added = True
                break
            left_next += 1

        # Right side: find next unconnected consecutive pair (right→left)
        while right_next - 1 >= 0:
            a, b = right_next, right_next - 1
            if a not in connected and b not in connected:
                _add(a, b)
                right_next = b - 1
                added = True
                break
            right_next -= 1

        if not added:
            break

    return pairs




def compute_external_diagonals(
    trap_ids: list[str],
    bases_data_map: dict[str, dict],
    consolidated: dict[str, list[dict]],
    computed_trapezoids: list[dict],
) -> list[dict]:
    """
    Compute external diagonals for all trapezoids in one area.

    Runs AFTER trapezoid details so heightRear/heightFront are available.

    trap_ids             — ordered list of trapezoid IDs for this area
    bases_data_map       — { trapId: compute_area_bases() result } (for frame data)
    consolidated         — { trapId: [base, ...] } post-consolidation bases
    computed_trapezoids  — list of ComputedTrapezoid dicts (with geometry.heightRear/Front)

    Returns flat list of diagonal dicts with area-wide baseIdxA/baseIdxB.
    """
    trap_geom = {}
    geom_by_beam_len: dict[float, dict] = {}
    for ct in computed_trapezoids:
        tid = ct.get('trapezoidId', '')
        geom = ct.get('geometry', {})
        if geom:
            trap_geom[tid] = geom
            tbl = round(geom.get('topBeamLength', 0), 1)
            if tbl > 0:
                geom_by_beam_len[tbl] = geom

    # Build area-wide offset per trap (matches how all_bases is built)
    trap_area_offset = {}
    offset = 0
    for tid in trap_ids:
        trap_area_offset[tid] = offset
        offset += len(consolidated.get(tid, []))

    result: list[dict] = []
    for trap_id in trap_ids:
        bd = bases_data_map.get(trap_id)
        if not bd:
            continue
        # Use consolidated bases (post-consolidation) for diagonal pairs
        trap_bases = consolidated.get(trap_id, [])
        n = len(trap_bases)
        if n < 2:
            continue

        base_lens = [b.get('lengthCm', 0) for b in trap_bases]
        diag_pairs = _diagonal_pairs(n, base_lens)
        area_offset = trap_area_offset.get(trap_id, 0)

        base_top_depth_cm = bd.get('baseTopDepthCm', 0)
        base_bottom_depth_cm = bd.get('baseBottomDepthCm', 0)
        rear_leg_depth_cm = bd.get('rearLegDepthCm', 0)
        front_leg_depth_cm = bd.get('frontLegDepthCm', 0)

        # Prefer geometry matching the actual base depth (baseLengthCm ≈ topBeamLength).
        # This handles multi-row areas where consolidation assigns bases to a deeper
        # trap but the row's physical geometry matches a different trapezoid.
        base_len_key = round(bd.get('baseLengthCm', 0), 1)
        geom = geom_by_beam_len.get(base_len_key) or trap_geom.get(trap_id, {})
        height_rear = geom.get('heightRear', 0)
        height_front = geom.get('heightFront', 0)

        # Base offsets relative to frame start
        frame_start = bd.get('frameStartCm', 0)
        base_offsets_cm = [b['offsetFromStartCm'] - frame_start for b in trap_bases]

        for ai, bi in diag_pairs:
            horiz_mm = round(abs(base_offsets_cm[bi] - base_offsets_cm[ai]) * 10)
            base_a = trap_bases[ai]
            base_b = trap_bases[bi]
            for edge_depth_cm in [base_top_depth_cm, base_bottom_depth_cm]:
                is_rear = edge_depth_cm == base_top_depth_cm
                height_at_edge_cm = 0.0
                if height_rear > 0 and front_leg_depth_cm > rear_leg_depth_cm:
                    t = max(0.0, min(1.0,
                        (edge_depth_cm - rear_leg_depth_cm) / (front_leg_depth_cm - rear_leg_depth_cm)
                    ))
                    height_at_edge_cm = height_rear + t * (height_front - height_rear)
                vert_mm = round(height_at_edge_cm * 10)
                result.append({
                    'startBaseIdx': area_offset + ai,
                    'endBaseIdx': area_offset + bi,
                    'startBaseOffsetCm': 0.0 if is_rear else round_to_2dp(base_a.get('lengthCm', 0)),
                    'startBaseHeightCm': round_to_2dp(height_at_edge_cm),
                    'endBaseOffsetCm': 0.0 if is_rear else round_to_2dp(base_b.get('lengthCm', 0)),
                    'endBaseHeightCm': 0.0,
                    'horizMm': horiz_mm,
                    'vertMm': vert_mm,
                    'diagLengthMm': round(math.sqrt(horiz_mm ** 2 + vert_mm ** 2)),
                })

    return result


# ── Consolidation ─────────────────────────────────────────────────────────────

def consolidate_area_bases(
    trap_ids: list[str],
    bases_data_map: dict[str, dict | None],
) -> dict[str, list[dict]]:
    """
    Remove bases from shallower trapezoids where they fall within a deeper
    trapezoid's X extent.  Returns { trapId: [BaseData, ...] }.
    """
    result: dict[str, list[dict]] = {}
    for trap_id, bd in bases_data_map.items():
        if bd:
            result[trap_id] = list(bd['bases'])

    if len(trap_ids) <= 1:
        return result

    # Metadata per trap
    trap_infos = []
    for trap_id in trap_ids:
        bd = bases_data_map.get(trap_id)
        if not bd:
            continue
        trap_infos.append({
            'trapId': trap_id,
            'xMin': bd['frameStartCm'],
            'xMax': bd['frameStartCm'] + bd['frameLengthCm'],
            'depth': bd['baseLengthCm'],
        })

    # Build an order map so earlier traps win ties
    trap_order = {tid: idx for idx, tid in enumerate(trap_ids)}

    def _b_wins(info_a: dict, info_b: dict) -> bool:
        """Return True if trap B should eliminate trap A's overlapping bases."""
        if info_b['depth'] > info_a['depth']:
            return True
        if info_b['depth'] < info_a['depth']:
            return False
        # Equal depth — wider range wins
        width_a = info_a['xMax'] - info_a['xMin']
        width_b = info_b['xMax'] - info_b['xMin']
        if width_b > width_a:
            return True
        if width_b < width_a:
            return False
        # Equal depth and width — earlier trap in list wins (later loses)
        return trap_order.get(info_b['trapId'], 999) < trap_order.get(info_a['trapId'], 999)

    for info_a in trap_infos:
        result[info_a['trapId']] = [
            base for base in result.get(info_a['trapId'], [])
            if not any(
                info_b['trapId'] != info_a['trapId']
                and base['offsetFromStartCm'] > info_b['xMin']
                and base['offsetFromStartCm'] < info_b['xMax']
                and _b_wins(info_a, info_b)
                for info_b in trap_infos
            )
        ]

    return result
