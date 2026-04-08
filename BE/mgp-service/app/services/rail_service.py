"""
Rail layout service — server-side port of FE/src/utils/railService.js

Computes rail positions and stock segments for each area purely from
project data (cm measurements, no pixel coordinates).
"""

from __future__ import annotations
from typing import Optional

from app.utils.math_helpers import round_to_5cm
from app.utils.panel_geometry import infer_row_orientation, default_panel_positions, PANEL_V, PANEL_H


def _rail_offset_from_spacing(panel_depth_cm: float, spacing_cm: float) -> float:
    """Distance from the front edge to the first rail given target inter-rail spacing."""
    return (panel_depth_cm - spacing_cm) / 2.0


def _split_stock_for_rounded(rounded_mm: int, stock_lengths: list[int]) -> list[int]:
    """
    Stock segments when rounding up to eliminate small leftovers: use full stock lengths (no cutting).
    Same strategy: largest first, smallest for final piece.
    """
    remaining = rounded_mm
    sorted_largest = sorted(stock_lengths, reverse=True)
    sorted_smallest = sorted(stock_lengths)
    result = []
    
    while remaining > 0:
        can_fit_in_one = any(s >= remaining for s in stock_lengths)
        
        if can_fit_in_one:
            # Final piece: use smallest that fits
            chosen = next((s for s in sorted_smallest if s >= remaining), max(stock_lengths))
        else:
            # Not final: use largest
            chosen = sorted_largest[0]
        
        result.append(chosen)
        remaining -= chosen
    return result


def _split_into_stock_segments(length_mm: int, stock_lengths: list[int]) -> list[dict]:
    """
    Optimal stock splitting:
    - Use largest stocks first to minimize number of pieces
    - For the final/remaining piece, use smallest stock that fits to minimize waste
    
    Example: 7000mm with [6000, 5000, 2300, 1150] → 6000 + 1150 (not 5000 + 2000)
    Example: 4800mm with [6000, 5000, 4800] → 5000 (not 6000)
    """
    remaining = length_mm
    segments = []
    sorted_largest = sorted(stock_lengths, reverse=True)  # Largest first
    sorted_smallest = sorted(stock_lengths)  # Smallest first
    
    while remaining > 0:
        # Check if remaining can fit in one stock
        can_fit_in_one = any(s >= remaining for s in stock_lengths)
        
        if can_fit_in_one:
            # Final piece: use smallest stock that fits to minimize waste
            chosen = next((s for s in sorted_smallest if s >= remaining), max(stock_lengths))
        else:
            # Not final: use largest stock to minimize number of pieces
            chosen = sorted_largest[0]
        
        segments.append({'used': remaining if chosen >= remaining else chosen,
                         'leftover': max(0, chosen - remaining)})
        remaining -= chosen
        if remaining > 0 and chosen <= 0:  # prevent infinite loop on invalid stock
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
    rail_round_threshold_cm: float = 0,
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
        orient = infer_row_orientation(cells)
        if not orient:
            continue  # all ghost slots — skip

        # Panel dimensions along the row and across the slope
        # Portrait (V): short side across row, long side up slope
        # Landscape (H): long side across row, short side up slope
        panel_along_cm = panel_width_cm  if orient == PANEL_V else panel_length_cm
        panel_depth_cm = panel_length_cm if orient == PANEL_V else panel_width_cm

        # Leading-edge positions of real panels from area start corner
        stored = row_positions.get(str(line_idx))
        positions = stored if stored else default_panel_positions(cells, panel_along_cm, panel_gap_cm)
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
            spacing = rail_spacing_h_cm if orient == PANEL_H else rail_spacing_v_cm
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
            # Round to 5cm intervals for aluminum profile cutting accuracy
            rounded_length_mm = round_to_5cm(length_mm)
            
            # Calculate stock segments from rounded length
            segs = _split_into_stock_segments(rounded_length_mm, stock_lengths)
            leftover_cm = round(sum(s['leftover'] for s in segs) / 10, 1)
            
            rail = {
                'railId':               f'R{rail_counter}',
                'lineIdx':              line_idx,
                'offsetFromLineFrontCm': round(offset_from_front, 4),
                'offsetFromRearEdgeCm': offset_from_rear,
                'startCm':              start_cm,
                'lengthCm':             round(rounded_length_mm / 10, 1),
                'stockSegmentsMm':      [s['used'] for s in segs],
                'leftoverCm':           leftover_cm,
            }
            
            # If leftover is small, round up to use full stock segments (no cutting)
            if rail_round_threshold_cm > 0 and 0 < leftover_cm <= rail_round_threshold_cm:
                rounded_mm = rounded_length_mm + round(leftover_cm * 10)
                rail['roundedLengthCm'] = round(rounded_mm / 10, 1)
                rail['stockSegmentsMm'] = _split_stock_for_rounded(rounded_mm, stock_lengths)
                rail['leftoverCm'] = 0
            
            rails.append(rail)
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
            total_length_mm += round(rail['lengthCm'] * 10)
            total_leftover_mm += round(rail['leftoverCm'] * 10)
            for seg in rail['stockSegmentsMm']:
                stock_counts[seg] = stock_counts.get(seg, 0) + 1

    return {
        'totalRails':      total_rails,
        'totalLengthMm':   total_length_mm,
        'totalLeftoverMm': total_leftover_mm,
        'stockUsage':      [{'lengthMm': k, 'count': v} for k, v in sorted(stock_counts.items(), reverse=True)],
    }
