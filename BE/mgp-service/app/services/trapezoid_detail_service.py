"""
Trapezoid detail service — server-side port of DetailView.jsx computation logic.

Computes per-trapezoid structural details: geometry (leg heights, beam lengths),
legs (positions, inner/outer, side), blocks, punches, and diagonal bracing.

All inputs come from existing stored data in step2/step3.
All outputs are persisted to step3.trapezoidDetails[trapId].
"""

from __future__ import annotations
import math


# ── Constants ─────────────────────────────────────────────────────────────────

SKIP_BELOW_CM = 60       # skip diagonal if both adjacent legs < this
DOUBLE_ABOVE_CM = 200    # mark diagonal ×2 if either leg ≥ this


# ── Main computation ──────────────────────────────────────────────────────────

def compute_trapezoid_details(
    bases_data: dict | None,
    line_rails: dict[str, list[float]],
    panel_lines: list[dict],
    angle_deg: float,
    front_height_cm: float,
    block_height_cm: float = 15,
    block_length_cm: float = 50,
    block_width_cm: float = 24,
    block_punch_cm: float = 9,
    diag_top_pct: float = 25,
    diag_base_pct: float = 90,
    base_overhang_cm: float = 5,
    cross_rail_edge_dist_mm: float = 40,
    rail_offset_cm: float = 0,
    custom_diagonals: dict | None = None,
) -> dict | None:
    """
    Compute structural details for one trapezoid.

    bases_data — output from base_service.compute_area_bases() for this trap
    line_rails — { str(lineIdx): [offsetFromLineFrontCm, ...] }
    panel_lines — [{ depthCm, gapBeforeCm, isEmpty, isHorizontal }]
    """
    if not bases_data or not panel_lines:
        return None

    angle_rad = angle_deg * math.pi / 180
    cross_rail_cm = cross_rail_edge_dist_mm / 10

    # ── Geometry from bases_data ───────────────────────────────────────────
    base_length_cm = bases_data.get('baseLengthCm', 0)
    rear_leg_depth = bases_data.get('rearLegDepthCm', 0)
    front_leg_depth = bases_data.get('frontLegDepthCm', 0)

    # Beam lengths
    top_beam_length = base_length_cm / math.cos(angle_rad) + 2 * base_overhang_cm if math.cos(angle_rad) > 0 else 0
    base_beam_length = top_beam_length * math.cos(angle_rad)

    # Leg heights (from constructionCalculator logic)
    # frontHeight = panelFrontHeight - blockHeightCm + railOffsetCm*sin(angle) - crossRailCm*cos(angle)
    # Here we receive the already-derived frontHeight (front leg height above block)
    base_length_horiz = base_length_cm  # horizontal leg-to-leg span
    height_rear = front_height_cm
    height_front = front_height_cm + base_length_horiz * math.tan(angle_rad)

    # Simplified diagonal length (single diagonal, beam-to-beam)
    diagonal_length = math.sqrt(base_length_horiz ** 2 + height_front ** 2)

    geometry = {
        'heightRear': _r(height_rear),
        'heightFront': _r(height_front),
        'topBeamLength': _r(top_beam_length),
        'baseBeamLength': _r(base_beam_length),
        'baseLength': _r(base_length_horiz),
        'diagonalLength': _r(diagonal_length),
        'angle': angle_deg,
        'frontHeight': _r(front_height_cm),
    }

    # ── Rail items (from lineRails + panelLines) ───────────────────────────
    # Build ALL rail items including from empty lines — must match FE's railItems
    # array so spanIdx values for diagonals align with FE rendering.
    rail_items = []
    d_cm = 0.0
    for si, seg in enumerate(panel_lines):
        d_cm += seg.get('gapBeforeCm', 0)
        seg_rails = line_rails.get(str(si), [])
        for offset_cm in seg_rails:
            rail_items.append({
                'segIdx': si,
                'offsetCm': offset_cm,
                'globalOffsetCm': d_cm + offset_cm,
            })
        d_cm += seg.get('depthCm', 0)

    # ── Leg positions ──────────────────────────────────────────────────────
    # Per-segment rail ordering for inner leg side logic
    seg_sorted = {}
    for i, r in enumerate(rail_items):
        seg_sorted.setdefault(r['segIdx'], []).append(i)
    for arr in seg_sorted.values():
        arr.sort(key=lambda idx: rail_items[idx]['offsetCm'])

    rail_pos_in_seg = {}
    for arr in seg_sorted.values():
        for pos, global_idx in enumerate(arr):
            rail_pos_in_seg[global_idx] = {'pos': pos, 'N': len(arr)}

    # Inner leg side: left half of segment → 'left'; right half → 'right'; single → 'left'
    inner_legs = []
    for ci, r in enumerate(rail_items[1:-1], start=1):
        info = rail_pos_in_seg.get(ci, {'pos': 0, 'N': 1})
        side = 'right' if info['N'] > 1 and info['pos'] > (info['N'] - 1) // 2 else 'left'
        # Leg height interpolated between rear and front
        if base_length_horiz > 0:
            # globalOffsetCm gives position along the slope
            slope_pos = (r['globalOffsetCm'] - rail_offset_cm + base_overhang_cm) * math.cos(angle_rad)
            frac = min(1.0, max(0.0, slope_pos / base_length_horiz)) if base_length_horiz > 0 else 0
        else:
            frac = 0
        leg_height = height_rear + frac * (height_front - height_rear)
        inner_legs.append({
            'positionCm': _r(r['globalOffsetCm']),
            'heightCm': _r(leg_height),
            'isInner': True,
            'side': side,
        })

    legs = [
        {'positionCm': 0, 'heightCm': _r(height_rear), 'isInner': False, 'side': 'outer'},
        *inner_legs,
        {'positionCm': _r(d_cm), 'heightCm': _r(height_front), 'isInner': False, 'side': 'outer'},
    ]

    # ── Active zone ────────────────────────────────────────────────────────
    active_segs = [i for i, s in enumerate(panel_lines) if not s.get('isEmpty', False)]
    first_active = min(active_segs) if active_segs else 0
    last_active = max(active_segs) if active_segs else len(panel_lines) - 1

    # ── Diagonals ──────────────────────────────────────────────────────────
    custom = custom_diagonals or {}
    num_spans = len(legs) - 1
    diag_top_frac = diag_top_pct / 100
    diag_base_frac = diag_base_pct / 100

    raw_diagonals = []
    for i in range(num_spans):
        h_a = legs[i]['heightCm']
        h_b = legs[i + 1]['heightCm']
        is_double = h_a >= DOUBLE_ABOVE_CM or h_b >= DOUBLE_ABOVE_CM

        ov = custom.get(str(i), {})
        skip = h_a < SKIP_BELOW_CM and h_b < SKIP_BELOW_CM
        if ov.get('disabled') is True:
            skip = True
        elif ov.get('disabled') is False:
            skip = False

        reversed_span = num_spans > 1 and i == 0
        def_top = (0.90 if is_double else 1 - diag_top_frac) if reversed_span else (0.10 if is_double else diag_top_frac)
        def_bot = (1 - diag_base_frac) if reversed_span else diag_base_frac

        top_pct = ov.get('topPct', def_top)
        bot_pct = ov.get('botPct', def_bot)

        # Approximate length (simplified: horizontal span between legs * Pythagorean)
        span_width_cm = abs(legs[i + 1]['positionCm'] - legs[i]['positionCm']) * math.cos(angle_rad)
        h_diff = abs(h_b - h_a)
        length_cm = math.sqrt(span_width_cm ** 2 + max(h_a, h_b) ** 2) if span_width_cm > 0 else 0

        raw_diagonals.append({
            'spanIdx': i,
            'topPct': _r(top_pct),
            'botPct': _r(bot_pct),
            'lengthCm': _r(length_cm),
            'isDouble': is_double,
            'disabled': skip,
        })

    # Safety: if all skipped, force-show rightmost not explicitly disabled
    if all(d['disabled'] for d in raw_diagonals):
        for d in reversed(raw_diagonals):
            if custom.get(str(d['spanIdx']), {}).get('disabled') is not True:
                d['disabled'] = False
                break

    diagonals = [d for d in raw_diagonals if not d['disabled']]

    # ── Blocks ─────────────────────────────────────────────────────────────
    num_blocks = max(2, sum(
        1 if seg.get('isHorizontal') else 2
        for seg in panel_lines if not seg.get('isEmpty')
    ))
    num_center = num_blocks - 2

    # Center blocks from inner rail positions (highest globalOffsetCm)
    inner_rail_items = rail_items[1:-1] if len(rail_items) > 2 else []
    center_blocks = sorted(inner_rail_items, key=lambda r: r['globalOffsetCm'])[-num_center:] if num_center > 0 else []
    center_blocks.sort(key=lambda r: r['globalOffsetCm'])

    block_punch_clamped = min(block_punch_cm, block_length_cm)

    blocks = [
        # Rear end block
        {'positionCm': _r(rear_leg_depth - base_overhang_cm), 'isEnd': True},
        # Center blocks
        *[{'positionCm': _r(r['globalOffsetCm']), 'isEnd': False} for r in center_blocks],
        # Front end block
        {'positionCm': _r(front_leg_depth + base_overhang_cm - block_length_cm), 'isEnd': True},
    ]

    # ── Punches ────────────────────────────────────────────────────────────
    punches = []
    for block in blocks:
        pos = block['positionCm']
        # Punch on base beam
        punches.append({'beamType': 'base', 'positionCm': _r(pos + block_punch_clamped)})
        punches.append({'beamType': 'base', 'positionCm': _r(pos + block_length_cm - block_punch_clamped)})
        # Punch on slope beam (same horizontal positions)
        punches.append({'beamType': 'slope', 'positionCm': _r(pos + block_punch_clamped)})
        punches.append({'beamType': 'slope', 'positionCm': _r(pos + block_length_cm - block_punch_clamped)})

    return {
        'geometry': geometry,
        'legs': legs,
        'blocks': blocks,
        'punches': punches,
        'diagonals': diagonals,
    }


def _r(v: float) -> float:
    """Round to 1 decimal."""
    return round(v * 10) / 10
