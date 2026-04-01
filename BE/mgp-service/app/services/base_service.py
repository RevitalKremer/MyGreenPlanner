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


# ── Helpers (shared with rail_service) ────────────────────────────────────────

def _infer_row_orientation(cells: list[str]) -> Optional[str]:
    """Return 'V' (portrait) or 'H' (landscape) from the first non-empty cell."""
    for c in cells:
        if c in ('V', 'EV'):
            return 'V'
        if c in ('H', 'EH'):
            return 'H'
    return None


def _default_positions(cells: list[str], panel_along_cm: float, panel_gap_cm: float) -> list[float]:
    """Leading-edge positions (cm from area start corner) for real panels."""
    return [
        i * (panel_along_cm + panel_gap_cm)
        for i, cell in enumerate(cells)
        if cell in ('V', 'H')
    ]


def _round2(v: float) -> float:
    return round(v * 100) / 100


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
    trapezoid_id: str,
    trap_start_cm: float | None = None,
    trap_end_cm: float | None = None,
    custom_offsets: list[float] | None = None,
    rc: dict | None = None,
) -> dict | None:
    """
    Compute base layout for one area (or trapezoid sub-range).

    panel_grid  — { rows: list[list[str]], rowPositions?: dict[str, list[float]] }
    line_rails  — { str(lineIdx): [offsetFromLineFrontCm, ...] }
    rc          — { heightRear, heightFront } in cm (optional, for diagonal height)
    Returns     — dict with bases[], blockDepthOffsetsCm[], diagonals[], etc.
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
        orient = _infer_row_orientation(cells)
        if not orient:
            continue
        panel_along_cm = short_cm if orient == 'V' else long_cm
        stored = row_positions.get(str(line_idx))
        positions = stored if stored else _default_positions(cells, panel_along_cm, panel_gap_cm)
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

    # ── Base X positions (cm from area start corner) ───────────────────────
    inner_span_mm = frame_length_mm - 2 * edge_offset_mm

    if custom_offsets and len(custom_offsets) > 0:
        base_offsets_cm = [mm / 10 for mm in custom_offsets]
    else:
        num_spans = max(1, math.ceil(inner_span_mm / spacing_mm))
        actual_spacing_cm = (inner_span_mm / num_spans) / 10
        num_bases = num_spans + 1
        base_offsets_cm = [
            _round2(edge_offset_mm / 10 + i * actual_spacing_cm)
            for i in range(num_bases)
        ]

    actual_spacing_mm = (
        round((base_offsets_cm[1] - base_offsets_cm[0]) * 10)
        if len(base_offsets_cm) > 1 else 0
    )

    bases = [
        {
            'baseId': f'B{i + 1}',
            'offsetFromStartCm': _round2(frame_start_cm + off),
            'trapezoidId': trapezoid_id,
        }
        for i, off in enumerate(base_offsets_cm)
    ]

    # ── Cumulative line depths (cm from rear edge of area) ─────────────────
    line_infos: dict[int, dict] = {}
    cumulative_cm = 0.0
    for line_idx, cells in enumerate(rows):
        orient = _infer_row_orientation(cells)
        if line_idx > 0:
            cumulative_cm += panel_gap_cm
        depth_cm = long_cm if orient == 'V' else (short_cm if orient == 'H' else 0)
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
            orient = _infer_row_orientation(cells)
            if not orient or li not in line_infos:
                continue
            panel_along_cm = short_cm if orient == 'V' else long_cm
            stored = row_positions.get(str(li))
            positions = stored if stored else _default_positions(cells, panel_along_cm, panel_gap_cm)
            active_idx = 0
            for j, cell in enumerate(cells):
                if cell not in ('V', 'H'):
                    continue
                pos = positions[active_idx]
                active_idx += 1
                if base_x >= pos and base_x <= pos + panel_along_cm:
                    active_lines_for_base.append(li)
                    break

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
            base['topDepthCm'] = _round2(b_rear_leg - base_overhang_cm)
            base['bottomDepthCm'] = _round2(b_front_leg + base_overhang_cm)
            base['lengthCm'] = _round2(base['bottomDepthCm'] - base['topDepthCm'])
        else:
            base['topDepthCm'] = _round2(base_top_depth_cm)
            base['bottomDepthCm'] = _round2(base_bottom_depth_cm)
            base['lengthCm'] = _round2(base_length_cm)

    # Block positions are computed in trapezoid_detail_service (single source of truth).
    # The FE bases view reads blocks from computedTrapezoids[trapId].blocks.

    # ── Diagonals ──────────────────────────────────────────────────────────
    n = len(bases)
    diag_pairs = [[0, 1]] if n == 2 else ([[0, 1], [n - 1, n - 2]] if n > 2 else [])

    diagonals = []
    for ai, bi in diag_pairs:
        horiz_mm = round(abs(base_offsets_cm[bi] - base_offsets_cm[ai]) * 10)
        for edge_depth_cm in [base_top_depth_cm, base_bottom_depth_cm]:
            vert_mm = 0
            if rc and front_leg_depth_cm > rear_leg_depth_cm:
                t = max(0.0, min(1.0,
                    (edge_depth_cm - rear_leg_depth_cm) / (front_leg_depth_cm - rear_leg_depth_cm)
                ))
                vert_mm = round((rc.get('heightRear', 0) + t * (rc.get('heightFront', 0) - rc.get('heightRear', 0))) * 10)
            diagonals.append({
                'baseIdxA': ai,
                'baseIdxB': bi,
                'edgeDepthCm': _round2(edge_depth_cm),
                'isRearEdge': edge_depth_cm == base_top_depth_cm,
                'horizMm': horiz_mm,
                'vertMm': vert_mm,
                'diagLengthMm': round(math.sqrt(horiz_mm ** 2 + vert_mm ** 2)),
            })

    return {
        'trapezoidId': trapezoid_id,
        'bases': bases,
        'frameStartCm': _round2(frame_start_cm),
        'frameLengthCm': _round2(frame_length_cm),
        'rearLegDepthCm': _round2(rear_leg_depth_cm),
        'frontLegDepthCm': _round2(front_leg_depth_cm),
        'baseTopDepthCm': _round2(base_top_depth_cm),
        'baseBottomDepthCm': _round2(base_bottom_depth_cm),
        'baseLengthCm': _round2(base_length_cm),
        'diagonals': diagonals,
        'actualSpacingMm': actual_spacing_mm,
        'baseCount': len(bases),
    }


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

    # ── Reassign trapezoidId by matching base lengthCm to trapezoid depth ──
    # After consolidation, surviving bases may have varying lengths but all
    # carry the winning trapezoid's ID. Reassign so the FE can group correctly.
    depth_to_trap: dict[float, str] = {}
    for trap_id in trap_ids:
        bd = bases_data_map.get(trap_id)
        if bd:
            depth_to_trap[round(bd['baseLengthCm'], 1)] = trap_id

    for trap_id, bases in result.items():
        for base in bases:
            base_len = round(base.get('lengthCm', 0), 1)
            if base_len in depth_to_trap:
                base['trapezoidId'] = depth_to_trap[base_len]

    return result
