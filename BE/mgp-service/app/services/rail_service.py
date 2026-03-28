"""
Rail layout service — server-side port of FE/src/utils/railService.js

Computes rail positions and stock segments for each area purely from
project data (cm measurements, no pixel coordinates).
"""

from __future__ import annotations
from typing import Optional

# ── Helpers ───────────────────────────────────────────────────────────────────

def _infer_row_orientation(cells: list[str]) -> Optional[str]:
    """Return 'V' (portrait) or 'H' (landscape) from the first non-empty cell."""
    for c in cells:
        if c in ('V', 'EV'):
            return 'V'
        if c in ('H', 'EH'):
            return 'H'
    return None


def _default_positions(cells: list[str], panel_along_cm: float, panel_gap_cm: float) -> list[float]:
    """
    Leading-edge positions (cm from area start corner) for real panels,
    assuming uniform spacing — matches rectPanelService layout.
    """
    return [
        i * (panel_along_cm + panel_gap_cm)
        for i, cell in enumerate(cells)
        if cell in ('V', 'H')
    ]


def _rail_offset_from_spacing(panel_depth_cm: float, spacing_cm: float) -> float:
    """Distance from the front edge to the first rail given target inter-rail spacing."""
    return (panel_depth_cm - spacing_cm) / 2.0


def _split_into_stock_segments(length_mm: int, stock_lengths: list[int]) -> list[dict]:
    """
    Greedy largest-first stock splitting.
    Returns list of { used, leftover } dicts — same logic as FE splitIntoStockSegments.
    """
    remaining = length_mm
    segments = []
    sorted_stocks = sorted(stock_lengths, reverse=True)
    while remaining > 0:
        chosen = next((s for s in sorted_stocks if s >= remaining), sorted_stocks[-1])
        segments.append({'used': remaining if chosen >= remaining else chosen,
                         'leftover': max(0, chosen - remaining)})
        remaining -= chosen
        if chosen < remaining + chosen:  # prevent infinite loop on undersized stock
            break
    return segments


# ── Main computation ──────────────────────────────────────────────────────────

def compute_area_rails(
    panel_grid: dict,
    panel_width_cm: float,
    panel_length_cm: float,
    line_rails: dict[str, list[float]],   # str(lineIdx) → [offsetFromLineFrontCm, ...]
    overhang_cm: float,
    stock_lengths: list[int],
    panel_gap_cm: float,
    rail_spacing_v_cm: float,
    rail_spacing_h_cm: float,
) -> dict:
    """
    Compute rails for one area.

    panel_grid  — { rows: list[list[str]], rowPositions?: dict[str, list[float]] }
    line_rails  — user-configured rail offsets from rear (ridge) edge per line
    Returns     — { rails: list[Rail-dict], num_large_gaps: int }
    """
    rows: list[list[str]] = panel_grid.get('rows', [])
    row_positions: dict = panel_grid.get('rowPositions') or {}

    rails = []
    rail_counter = 1
    num_large_gaps = 0

    for line_idx, cells in enumerate(rows):
        orient = _infer_row_orientation(cells)
        if not orient:
            continue  # all ghost slots — skip

        # Panel dimensions along the row and across the slope
        # Portrait (V): short side across row, long side up slope
        # Landscape (H): long side across row, short side up slope
        panel_along_cm = panel_width_cm  if orient == 'V' else panel_length_cm
        panel_depth_cm = panel_length_cm if orient == 'V' else panel_width_cm

        # Leading-edge positions of real panels from area start corner
        stored = row_positions.get(str(line_idx))
        positions = stored if stored else _default_positions(cells, panel_along_cm, panel_gap_cm)
        if not positions:
            continue

        # Count large gaps (only meaningful when rowPositions is stored)
        if stored:
            threshold = panel_gap_cm + 0.5
            for j in range(1, len(positions)):
                if positions[j] - (positions[j - 1] + panel_along_cm) > threshold:
                    num_large_gaps += 1

        # Rail offsets within this line — from the line's FRONT (eave) edge.
        # Matches FE convention: lineRails stores offsetFromLineFrontCm values.
        stored_offsets = line_rails.get(str(line_idx), [])
        if len(stored_offsets) >= 2:
            offsets_from_front = stored_offsets
        else:
            spacing = rail_spacing_h_cm if orient == 'H' else rail_spacing_v_cm
            front_offset = _rail_offset_from_spacing(panel_depth_cm, spacing)
            offsets_from_front = [
                round(front_offset, 4),
                round(panel_depth_cm - front_offset, 4),
            ]

        # Rail horizontal span
        start_cm = round(positions[0] - overhang_cm, 4)
        end_cm   = round(positions[-1] + panel_along_cm + overhang_cm, 4)
        length_mm = round((end_cm - start_cm) * 10)
        if length_mm <= 0:
            continue

        for offset_from_front in offsets_from_front:
            offset_from_rear = round(panel_depth_cm - offset_from_front, 4)
            segs = _split_into_stock_segments(length_mm, stock_lengths)
            rails.append({
                'railId':               f'R{rail_counter}',
                'lineIdx':              line_idx,
                'offsetFromLineFrontCm': round(offset_from_front, 4),
                'offsetFromRearEdgeCm': offset_from_rear,
                'startCm':              start_cm,
                'endCm':                end_cm,
                'lengthMm':             length_mm,
                'stockSegments':        [s['used'] for s in segs],
                'leftoverMm':           sum(s['leftover'] for s in segs),
            })
            rail_counter += 1

    return {'rails': rails, 'numLargeGaps': num_large_gaps}


def compute_materials_summary(areas_rails: list[list[dict]], stock_lengths: list[int]) -> dict:
    """
    Aggregate rail materials across all areas.
    Returns total rail count, total length, stock usage per length, and total waste.
    """
    stock_counts: dict[int, int] = {s: 0 for s in stock_lengths}
    total_length_mm = 0
    total_leftover_mm = 0
    total_rails = 0

    for rails in areas_rails:
        for rail in rails:
            total_rails += 1
            total_length_mm += rail['lengthMm']
            total_leftover_mm += rail['leftoverMm']
            for seg in rail['stockSegments']:
                stock_counts[seg] = stock_counts.get(seg, 0) + 1

    return {
        'totalRails':      total_rails,
        'totalLengthMm':   total_length_mm,
        'totalLeftoverMm': total_leftover_mm,
        'stockUsage':      [{'lengthMm': k, 'count': v} for k, v in sorted(stock_counts.items(), reverse=True)],
    }
