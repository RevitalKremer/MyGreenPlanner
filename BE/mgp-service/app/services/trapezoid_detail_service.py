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


def _s(settings: dict, overrides: dict, key: str) -> float | int | list:
    """Read a setting: per-trapezoid override > app default. KeyError if missing from both."""
    if key in overrides:
        return overrides[key]
    return settings[key]


# ── Main computation ──────────────────────────────────────────────────────────

def compute_trapezoid_details(
    bases_data: dict | None,
    line_rails: dict[str, list[float]],
    panel_lines: list[dict],
    angle_deg: float,
    front_height_cm: float,
    rail_offset_cm: float,
    settings: dict,
    overrides: dict | None = None,
    custom_diagonals: dict | None = None,
    global_settings: dict | None = None,
) -> dict | None:
    """
    Compute structural details for one trapezoid.

    bases_data     — output from base_service.compute_area_bases() for this trap
    line_rails     — { str(lineIdx): [offsetFromLineFrontCm, ...] }
    panel_lines    — [{ depthCm, gapBeforeCm, isEmpty, isHorizontal }]
    settings       — app_defaults dict (from app_settings table, single source of truth)
    overrides      — per-trapezoid config overrides (from trapezoidConfigs[trapId])
    global_settings — step3.globalSettings (for global-scope params like crossRailEdgeDistMm)
    """
    if not bases_data or not panel_lines:
        return None

    ov = overrides or {}
    gs = global_settings or {}

    # Read all settings — no hardcoded fallbacks
    block_height_cm      = _s(settings, ov, 'blockHeightCm')
    block_length_cm      = _s(settings, ov, 'blockLengthCm')
    block_punch_cm       = _s(settings, ov, 'blockPunchCm')
    diag_top_pct         = _s(settings, ov, 'diagTopPct')
    diag_base_pct        = _s(settings, ov, 'diagBasePct')
    base_overhang_cm     = _s(settings, ov, 'baseOverhangCm')
    cross_rail_edge_dist_mm = gs.get('crossRailEdgeDistMm', settings['crossRailEdgeDistMm'])
    beam_thick_cm        = settings['angleProfileSizeMm'] / 10
    panel_thick_cm       = settings['panelThickCm']

    angle_rad = angle_deg * math.pi / 180
    cross_rail_cm = cross_rail_edge_dist_mm / 10

    # ── Geometry from bases_data ───────────────────────────────────────────
    base_length_cm = bases_data.get('baseLengthCm', 0)
    rear_leg_depth = bases_data.get('rearLegDepthCm', 0)
    front_leg_depth = bases_data.get('frontLegDepthCm', 0)

    # Coordinate origin: rear outer leg in global panel coords
    # All positionCm values are relative to this origin (rear outer leg = 0).
    origin = rear_leg_depth - base_overhang_cm

    # Beam lengths: base_length_cm is along the slope (panel surface).
    # The slope beam follows the panel tilt; the base beam is horizontal.
    cos_a = math.cos(angle_rad)
    top_beam_length = base_length_cm                      # along slope
    base_beam_length = base_length_cm * cos_a             # horizontal projection

    # Derive structural leg height from panelFrontHeight (front_height_cm).
    # The rear outer leg is at (railOffset - overhang) from the panel front edge
    # along the slope. The cross rail is perpendicular to the slope (not vertical),
    # so its base on the slope beam is shifted by crossRail*tan(angle) along the
    # slope relative to the panel edge directly above.
    sin_a = math.sin(angle_rad)
    tan_a = math.tan(angle_rad)
    slope_offset = rail_offset_cm - base_overhang_cm + cross_rail_cm * tan_a
    height_rear = front_height_cm - block_height_cm + slope_offset * sin_a - cross_rail_cm / cos_a

    base_length_horiz = base_beam_length  # horizontal leg-to-leg span
    height_front = height_rear + base_length_horiz * math.tan(angle_rad)

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
        'panelFrontHeight': _r(front_height_cm),
        'originCm': _r(origin),
        # Rendering dimensions (from settings, for FE to convert cm→px)
        'beamThickCm': _r(beam_thick_cm),
        'panelThickCm': _r(panel_thick_cm),
        'blockHeightCm': _r(block_height_cm),
        'blockLengthCm': _r(block_length_cm),
        'crossRailHeightCm': _r(cross_rail_cm),
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

    # ── Slope distance annotations (added to geometry) ──────────────────
    total_panel_depth = d_cm
    first_rail_global = rail_items[0]['globalOffsetCm'] if rail_items else 0
    last_rail_global = rail_items[-1]['globalOffsetCm'] if rail_items else total_panel_depth
    geometry['panelEdgeToFirstRailCm'] = _r(first_rail_global)
    geometry['panelEdgeToLastRailCm'] = _r(total_panel_depth - last_rail_global)
    geometry['railToRailCm'] = _r(last_rail_global - first_rail_global)
    geometry['overhangCm'] = _r(base_overhang_cm)
    geometry['panelRearHeightCm'] = _r(front_height_cm + total_panel_depth * sin_a)

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

    # Outer leg positions (relative to origin, so rear = 0)
    rear_outer_pos = 0
    front_outer_pos = base_length_cm  # = baseLengthCm

    # Inner leg side: left half of segment → 'left'; right half → 'right'; single → 'left'
    # Each inner leg is offset from its cross rail by cross_rail_cm (direction based on side).
    inner_legs = []
    for ci, r in enumerate(rail_items[1:-1], start=1):
        info = rail_pos_in_seg.get(ci, {'pos': 0, 'N': 1})
        side = 'right' if info['N'] > 1 and info['pos'] > (info['N'] - 1) // 2 else 'left'
        # Rail position relative to origin
        rail_pos = r['globalOffsetCm'] - origin
        # Leg position: offset from rail by cross_rail_cm
        leg_offset = cross_rail_cm if side == 'right' else -cross_rail_cm
        leg_pos = rail_pos + leg_offset
        # Height interpolated between outer legs
        frac = max(0.0, min(1.0, leg_pos / front_outer_pos)) if front_outer_pos > 0 else 0
        leg_height = height_rear + frac * (height_front - height_rear)
        inner_legs.append({
            'positionCm': _r(leg_pos),
            'heightCm': _r(leg_height),
            'isInner': True,
            'side': side,
            'railPositionCm': _r(rail_pos),
        })

    legs = [
        {'positionCm': _r(rear_outer_pos), 'heightCm': _r(height_rear), 'isInner': False, 'side': 'outer'},
        *inner_legs,
        {'positionCm': _r(front_outer_pos), 'heightCm': _r(height_front), 'isInner': False, 'side': 'outer'},
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

        ov_d = custom.get(str(i), {})
        skip = h_a < SKIP_BELOW_CM and h_b < SKIP_BELOW_CM
        if ov_d.get('disabled') is True:
            skip = True
        elif ov_d.get('disabled') is False:
            skip = False

        reversed_span = num_spans > 1 and i == 0
        def_top = (0.90 if is_double else 1 - diag_top_frac) if reversed_span else (0.10 if is_double else diag_top_frac)
        def_bot = (1 - diag_base_frac) if reversed_span else diag_base_frac

        top_pct = ov_d.get('topPct', def_top)
        bot_pct = ov_d.get('botPct', def_bot)

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
        # Rear end block (at origin = 0)
        {'positionCm': 0, 'isEnd': True},
        # Center blocks (shifted to origin)
        *[{'positionCm': _r(r['globalOffsetCm'] - origin), 'isEnd': False} for r in center_blocks],
        # Front end block
        {'positionCm': _r(base_length_cm - block_length_cm), 'isEnd': True},
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
