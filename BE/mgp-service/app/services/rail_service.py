"""
Rail layout service — server-side port of FE/src/utils/railService.js

Computes rail positions and stock segments for each area purely from
project data (cm measurements, no pixel coordinates).
"""

from __future__ import annotations
import math
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


def _redistribute_small_last_cut(
    segments: list[dict],
    stock_lengths: list[int],
    min_cut_mm: int,
) -> list[dict]:
    """
    Merge a tiny final cut into the preceding cut and split the pair into two
    equal halves (each ceiled up to the 5cm cutting grid). Installers prefer
    handling two medium pieces over one full + one sliver.

    Returns a new segment list, or the original when no change applies.

    Why ceiling-round and not nearest-round: two halves must cover the combined
    used length so the rail isn't shortened. With combined=6050 → half=3025 →
    ceil to 5cm = 3050 → 2 × 3050 = 6100 (covers 6050, adds 50mm slack absorbed
    by the next stock leftover, matching the existing round_to_5cm semantics).
    """
    if min_cut_mm <= 0 or len(segments) < 2:
        return segments
    last = segments[-1]
    if last['used'] >= min_cut_mm:
        return segments

    prev = segments[-2]
    combined = prev['used'] + last['used']
    half_mm = math.ceil(combined / 2 / 50) * 50  # ceiling onto 5cm cutting grid
    # Halves must fit one stock; smaller than min_cut_mm would defeat the point.
    chosen = next((s for s in sorted(stock_lengths) if s >= half_mm), None)
    if chosen is None or half_mm < min_cut_mm:
        return segments

    new_pair = [
        {'used': half_mm, 'leftover': chosen - half_mm},
        {'used': half_mm, 'leftover': chosen - half_mm},
    ]
    return segments[:-2] + new_pair


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
    long_rail_threshold_cm: float,
    long_rail_extra_overhang_cm: float,
    rail_round_threshold_cm: float = 0,
    rail_min_cut_cm: float = 0,
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

        # Split positions into contiguous segments separated by large gaps (holes
        # where panels were removed). Each segment becomes its own rail with its
        # own overhang and long-rail extension — there is no rail across a hole.
        large_gap_threshold = panel_gap_cm + 0.5
        segments: list[list[float]] = [[positions[0]]]
        for j in range(1, len(positions)):
            if positions[j] - (positions[j - 1] + panel_along_cm) > large_gap_threshold:
                segments.append([positions[j]])
                num_large_gaps += 1
            else:
                segments[-1].append(positions[j])

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

        for segment in segments:
            # Rail horizontal span for this segment
            start_cm = round(segment[0] - overhang_cm, 4)
            end_cm   = round(segment[-1] + panel_along_cm + overhang_cm, 4)
            length_mm = round((end_cm - start_cm) * 10)
            if length_mm <= 0:
                continue

            # Long rails: extend each side to absorb panel-placement drift accumulated
            # over long install lines. Threshold compared against post-overhang length.
            if length_mm / 10 > long_rail_threshold_cm:
                start_cm = round(start_cm - long_rail_extra_overhang_cm, 4)
                end_cm   = round(end_cm + long_rail_extra_overhang_cm, 4)
                length_mm = round((end_cm - start_cm) * 10)

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
                elif rail_min_cut_cm > 0:
                    # Final piece too small for installers? Merge it into the
                    # previous cut and split that pair into two equal halves.
                    redistributed = _redistribute_small_last_cut(
                        segs, stock_lengths, round(rail_min_cut_cm * 10),
                    )
                    if redistributed is not segs:
                        rail['stockSegmentsMm'] = [s['used'] for s in redistributed]
                        rail['leftoverCm'] = round(
                            sum(s['leftover'] for s in redistributed) / 10, 1,
                        )

                rails.append(rail)
                rail_counter += 1

    return {'rails': rails, 'numLargeGaps': num_large_gaps}


# ── Cross-row rail concatenation ──────────────────────────────────────────────

def concat_cross_row_rails(
    panel_rows: list[dict],
    all_row_rails: dict[int, list[dict]],
    panel_length_cm: float,
    panel_width_cm: float,
    line_gap_cm: float,
    panel_gap_cm: float,
    stock_lengths: list[int],
    rail_round_threshold_cm: float = 0,
    rail_min_cut_cm: float = 0,
) -> tuple[dict[int, list[dict]], list[dict]]:
    """
    Merge rails from sibling sub-rows of an area that sit at the same absolute
    slope-axis position AND are physically adjacent along the row axis. All
    sub-row rowPositions are pre-translated to the parent area's frame (see FE
    panelGridService.buildPanelGrid `frameRef`), so `startCm` is directly
    comparable across sub-rows.

    Algorithm:
      1. Bucket every rail by (slope_y_mm, offset_from_line_front_mm) — the
         "same physical level" key.
      2. Sort each bucket by startCm ascending ("from start position inward").
      3. Walk consecutive pairs; break into a new sub-group whenever
         next.startCm − (prev.startCm + prev.lengthCm) > panel_gap_cm.
      4. Each sub-group with ≥2 distinct sub-row sources becomes a CrossRowRail
         spanning startCm to endCm of the group. Single-sub-row groups stay
         as ordinary per-row rails.

    Per-row rails are NOT removed — each source rail is tagged with
    `crrId` and `virtual=True` so the FE can render it as a virtual
    (dashed/faded) placeholder. Provenance is one-way: find the source rails
    of a CrossRowRail by filtering per-row rails where `crrId == cr.railId`.
    """
    # Per-sub-row geometry: front height, angle, cumulative slope-axis position
    # of each line's FRONT edge (line 0 = 0; line i = sum of preceding panel
    # depths + gaps based on each line's orientation), rowAxisOffsetCm (this
    # sub-row's V0 in the parent's row-axis), and is_rtl (whether this sub-row's
    # row-axis runs OPPOSITE to its V0 → reverses the sign of startCm relative
    # to the parent row-axis). is_rtl is derived from panelGrid.startCorner:
    # 'BR' and 'TR' have V0 at the right edge with panels growing leftward.
    row_info: dict[int, dict] = {}
    for pr in panel_rows:
        if pr is None:
            continue
        row_idx = pr.get('rowIndex', 0)
        front_h = float(pr.get('frontHeightCm') or 0)
        angle_rad = math.radians(float(pr.get('angleDeg') or 0))
        row_offset = float(pr.get('rowAxisOffsetCm') or 0)
        slope_offset = float(pr.get('slopeAxisOffsetCm') or 0)
        pg = pr.get('panelGrid') or {}
        start_corner = pg.get('startCorner', 'BL') or 'BL'
        is_rtl = 'R' in start_corner  # BR or TR
        area_angle = float(pg.get('areaAngle') or 0)  # screen rotation of the row
        rows = pg.get('rows', [])
        line_fronts: list[float] = []
        cum = 0.0
        for cells in rows:
            line_fronts.append(cum)
            orient = infer_row_orientation(cells)
            depth = panel_length_cm if orient == PANEL_V else panel_width_cm
            cum += depth + line_gap_cm
        row_info[row_idx] = {
            'front_h': front_h,
            'angle_rad': angle_rad,
            'line_fronts': line_fronts,
            'row_offset': row_offset,
            'slope_offset': slope_offset,
            'is_rtl': is_rtl,
            'area_angle': area_angle,
        }

    # Anchor sub-row (smallest rowIndex) defines the parent row-axis convention.
    # Sub-rows with the OPPOSITE xDir need their startCm flipped.
    anchor_row_idx = min(row_info.keys()) if row_info else None
    anchor_is_rtl = row_info[anchor_row_idx]['is_rtl'] if anchor_row_idx is not None else False

    # Slope-Y matching uses a 5 cm bucket. Tolerant of small FE/BE arithmetic
    # drift, comfortably smaller than the ~100 cm minimum gap between
    # adjacent rail levels (rear-of-line-N → front-of-line-N+1).
    #
    # slope_y = slope_offset (sub-row V0's slope-axis offset from anchor V0,
    #           supplied by the FE as `slopeAxisOffsetCm`)
    #         + line_front (sub-row-local distance from V0 to this line's front)
    #         + offset_from_line_front (rail's offset within the line)
    # Using the FE-supplied 2D origin lets us distinguish manually-drawn rows
    # at different physical Y but same frontHeightCm — they get distinct
    # slope_offset values, so their rails don't bucket together.
    SLOPE_Y_BUCKET_CM = 5
    def slope_y_bucket(row_idx: int, line_idx: int, offset_front_cm: float) -> int | None:
        info = row_info.get(row_idx)
        if not info or line_idx >= len(info['line_fronts']):
            return None
        line_front = info['line_fronts'][line_idx]
        sy = info['slope_offset'] + line_front + offset_front_cm
        return round(sy / SLOPE_Y_BUCKET_CM)

    # Bucket every rail by (slope-Y, screen rotation). Rails with different
    # screen rotations are NOT physically parallel and can't be concat'd into
    # one straight piece — areaAngle goes into the key (rounded to whole
    # degrees) so a slightly-rotated sub-row never merges with axis-aligned
    # siblings even if their slope-Y matches.
    # For sub-rows whose xDir matches the anchor, startCm runs the same
    # direction as the parent axis → abs_start = offset + startCm. For sub-rows
    # whose xDir is FLIPPED (e.g. BR sub-row under a BL anchor), the rail's
    # local startCm runs the opposite way, so abs_end = offset - startCm and
    # abs_start = abs_end - lengthCm.
    buckets: dict[tuple, list[dict]] = {}
    for row_idx, rails in all_row_rails.items():
        info = row_info.get(row_idx)
        row_offset = info['row_offset'] if info else 0.0
        is_rtl = info['is_rtl'] if info else False
        area_angle = info['area_angle'] if info else 0.0
        # Mounting tilt of this sub-row (e.g. 5° slope). Two rails at the same
        # screen position but different tilts are at different 3D heights and
        # can't be one physical piece — include in the bucket.
        mount_angle_deg = math.degrees(info['angle_rad']) if info else 0.0
        flipped = (is_rtl != anchor_is_rtl)
        screen_angle_key = round(area_angle)        # whole degrees
        mount_angle_key  = round(mount_angle_deg, 1)  # 0.1° resolution
        for rail in rails:
            sy = slope_y_bucket(row_idx, rail.get('lineIdx', 0), rail.get('offsetFromLineFrontCm', 0))
            if sy is None:
                continue
            key = (sy, screen_angle_key, mount_angle_key)
            start_local = rail.get('startCm', 0)
            length_local = rail.get('lengthCm', 0)
            if flipped:
                abs_end = row_offset - start_local
                abs_start = abs_end - length_local
            else:
                abs_start = start_local + row_offset
                abs_end = abs_start + length_local
            buckets.setdefault(key, []).append({
                'row_idx': row_idx, 'rail': rail,
                'abs_start': abs_start, 'abs_end': abs_end,
                'area_angle': area_angle,
            })

    cross_row_rails: list[dict] = []
    counter = 1

    for key, items in buckets.items():
        # Sort by ABSOLUTE start (parent-frame) ascending (= away from area's
        # start corner). Per-sub-row startCm alone wouldn't sort correctly
        # because each sub-row's frame is local — abs_start adds the offset.
        items_sorted = sorted(items, key=lambda it: it['abs_start'])

        # Walk consecutive pairs. Same bucket = same (slope_y, area_angle), so
        # everything here is parallel at the same Y. Split into a new group
        # only when the X gap is too large to bridge (> panel_gap + tolerance).
        # Now that slope_y comes from the FE-supplied 2D offset, physically
        # separated rows already land in different buckets — no overlap-based
        # heuristic needed.
        groups: list[list[dict]] = [[items_sorted[0]]] if items_sorted else []
        for prev, curr in zip(items_sorted, items_sorted[1:]):
            gap = curr['abs_start'] - prev['abs_end']
            if gap > panel_gap_cm + 0.5:
                groups.append([curr])
            else:
                groups[-1].append(curr)

        for group in groups:
            sources = {it['row_idx'] for it in group}
            if len(sources) < 2:
                continue  # contiguous run from one sub-row — no cross-row concat

            # Absolute (parent-frame) span of the merged group
            start_cm = group[0]['abs_start']
            end_cm = max(it['abs_end'] for it in group)
            length_mm = round((end_cm - start_cm) * 10)
            if length_mm <= 0:
                continue

            segs = _split_into_stock_segments(length_mm, stock_lengths)
            leftover_cm = round(sum(s['leftover'] for s in segs) / 10, 1)
            first_rail = group[0]['rail']
            cross_rail = {
                'railId':                f'CR{counter}',
                'startCm':               round(start_cm, 4),
                'lengthCm':              round(length_mm / 10, 1),
                'offsetFromLineFrontCm': first_rail.get('offsetFromLineFrontCm', 0),
                'offsetFromRearEdgeCm':  first_rail.get('offsetFromRearEdgeCm', 0),
                'stockSegmentsMm':       [s['used'] for s in segs],
                'leftoverCm':            leftover_cm,
                'slopeYCm':              round(key[0] * SLOPE_Y_BUCKET_CM, 1),
                'areaAngleDeg':          round(key[1], 2),
                'mountAngleDeg':         round(key[2], 2),
                # Same field names as on Rail — CR's startCm/lengthCm are
                # already absolute (parent-frame), so these are direct mirrors.
                'absStartCm':            round(start_cm, 2),
                'absEndCm':              round(start_cm + length_mm / 10, 2),
            }
            # Small-cut / round-up post-processing (same as per-row rails)
            if rail_round_threshold_cm > 0 and 0 < leftover_cm <= rail_round_threshold_cm:
                rounded_mm = length_mm + round(leftover_cm * 10)
                cross_rail['roundedLengthCm'] = round(rounded_mm / 10, 1)
                cross_rail['stockSegmentsMm'] = _split_stock_for_rounded(rounded_mm, stock_lengths)
                cross_rail['leftoverCm'] = 0
            elif rail_min_cut_cm > 0:
                redistributed = _redistribute_small_last_cut(
                    segs, stock_lengths, round(rail_min_cut_cm * 10),
                )
                if redistributed is not segs:
                    cross_rail['stockSegmentsMm'] = [s['used'] for s in redistributed]
                    cross_rail['leftoverCm'] = round(
                        sum(s['leftover'] for s in redistributed) / 10, 1,
                    )

            cross_row_rails.append(cross_rail)

            # Annotate source rails so the FE can render them as virtual
            # placeholders. Per-source abs spans stay on the rails themselves
            # (provenance lives via `crrId` on each source — no need for a
            # separate sourceRails array on the CR).
            for it in group:
                it['rail']['crrId'] = cross_rail['railId']
                it['rail']['virtual'] = True
                it['rail']['absStartCm'] = round(it['abs_start'], 2)
                it['rail']['absEndCm'] = round(it['abs_end'], 2)

            counter += 1

    return all_row_rails, cross_row_rails


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
