"""
Trapezoid detail service — server-side port of DetailView.jsx computation logic.

Computes per-trapezoid structural details: geometry (leg heights, beam lengths),
legs (positions, inner/outer, side), blocks, punches, and diagonal bracing.

All inputs come from existing stored data in step2/step3.
All outputs are persisted to step3.trapezoidDetails[trapId].
"""

from __future__ import annotations
import logging
import math

logger = logging.getLogger(__name__)


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
    beam_thick_cm        = settings.get('angleProfileSizeMm', 40) / 10
    panel_thick_cm       = settings.get('panelThickCm', 3.5)

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
        'blockPunchCm': _r(block_punch_cm),
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
            'railPositionCm': _r(rail_pos),
        })

    legs = sorted([
        {'positionCm': _r(rear_outer_pos), 'heightCm': _r(height_rear)},
        *inner_legs,
        {'positionCm': _r(front_outer_pos), 'heightCm': _r(height_front)},
    ], key=lambda l: l['positionCm'])

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

        # Diagonal length: sqrt(vertical² + horizontal²)
        # Top attachment on slope beam at topPct, bottom attachment on base beam at botPct
        span_horiz_cm = abs(legs[i + 1]['positionCm'] - legs[i]['positionCm']) * cos_a
        height_at_top = h_a + top_pct * (h_b - h_a)  # vertical from base beam to slope beam at topPct
        horiz_dist = abs(top_pct - bot_pct) * span_horiz_cm  # horizontal between attachments
        length_cm = math.sqrt(height_at_top ** 2 + horiz_dist ** 2) if span_horiz_cm > 0 else 0

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

    # ── Blocks — one per leg ─────────────────────────────────────────────
    # Rear outer leg: block left edge at leg position (block extends right)
    # Front outer leg: block right edge at leg position (block extends left)
    # Inner legs: block centered on rail position (railPositionCm)
    # Skip if overlap with adjacent block.

    raw_blocks = []
    # Rear outer leg
    raw_blocks.append({'positionCm': _r(rear_outer_pos), 'isEnd': True, 'legIdx': 0})
    # Inner legs — centered on rail
    for il in inner_legs:
        rail_pos = il['railPositionCm']
        left_edge = rail_pos - block_length_cm / 2
        raw_blocks.append({'positionCm': _r(left_edge), 'isEnd': False, 'legIdx': None})
    # Front outer leg — right-aligned
    raw_blocks.append({'positionCm': _r(front_outer_pos - block_length_cm), 'isEnd': True, 'legIdx': len(legs) - 1})

    # Remove overlaps: walk left-to-right, skip any block that overlaps the previous
    # Add slope projection for bases layout (top-down view shows slope beam, blocks sit on base beam)
    slope_block_length = block_length_cm / cos_a if cos_a > 0 else block_length_cm
    blocks = []
    for blk in raw_blocks:
        if blocks and blk['positionCm'] < blocks[-1]['positionCm'] + block_length_cm - 0.1:
            continue  # overlaps previous block — skip
        pos = blk['positionCm']
        blocks.append({
            'positionCm': _r(pos),
            'isEnd': blk['isEnd'],
            'slopePositionCm': _r(pos / cos_a) if cos_a > 0 else _r(pos),
            'slopeLengthCm': _r(slope_block_length),
        })

    # ── Punches ────────────────────────────────────────────────────────────
    # All positionCm values are in the trapezoid horizontal coordinate system
    # (same as leg positions, origin = rear outer leg).
    profile_half = beam_thick_cm / 2

    punches = []

    # outerLeg: profile_half from each end of each beam
    # Base beam positions in base-beam coordinates (0 to base_beam_length)
    # Slope beam positions in slope-beam coordinates (0 to top_beam_length)
    punches.append({'beamType': 'base',  'positionCm': _r(profile_half), 'origin': 'outerLeg'})
    punches.append({'beamType': 'base',  'positionCm': _r(base_beam_length - profile_half), 'origin': 'outerLeg'})
    punches.append({'beamType': 'slope', 'positionCm': _r(profile_half), 'origin': 'outerLeg'})
    punches.append({'beamType': 'slope', 'positionCm': _r(top_beam_length - profile_half), 'origin': 'outerLeg'})

    # innerLeg: at each inner leg position on both beams
    # Base beam position = slope position * cos(angle) (horizontal projection)
    # Slope beam position = slope position (along slope)
    for il in inner_legs:
        pos = il['positionCm']
        punches.append({'beamType': 'base',  'positionCm': _r(pos * cos_a), 'origin': 'innerLeg'})
        punches.append({'beamType': 'slope', 'positionCm': _r(pos), 'origin': 'innerLeg'})

    # rail: one punch per cross rail at its center on the slope beam
    for r in rail_items:
        rail_pos = r['globalOffsetCm'] - origin
        punches.append({'beamType': 'slope', 'positionCm': _r(rail_pos), 'origin': 'rail'})

    # diagonal: top attachment on slope beam, bottom on base beam
    for diag in diagonals:
        si = diag['spanIdx']
        leg_a_pos = legs[si]['positionCm']
        leg_b_pos = legs[si + 1]['positionCm']
        span = leg_b_pos - leg_a_pos
        top_pos = _r(leg_a_pos + span * diag['topPct'])
        bot_pos = _r(leg_a_pos + span * diag['botPct'])
        punches.append({'beamType': 'slope', 'positionCm': top_pos, 'origin': 'diagonal'})
        punches.append({'beamType': 'base',  'positionCm': bot_pos, 'origin': 'diagonal'})

    # block: one punch per block, position depends on nearby punches on base beam
    other_base_positions = [p['positionCm'] for p in punches if p['beamType'] == 'base']
    punches += _compute_block_punches(blocks, other_base_positions, block_length_cm, base_beam_length, block_punch_cm, beam_thick_cm)

    return {
        'geometry': geometry,
        'legs': legs,
        'blocks': blocks,
        'punches': punches,
        'diagonals': diagonals,
    }


def align_blocks(trap_details: dict[str, dict]) -> None:
    """
    Align block positions across all trapezoids in the same area.

    All trapezoids share the same physical base beams, so block depth positions
    must be consistent. We collect all block positions (in global panel coords),
    merge into a unified set, then redistribute to each trapezoid — keeping only
    positions that fall within that trapezoid's beam span.

    Modifies trap_details in place (updates blocks and punches).
    """
    if len(trap_details) < 2:
        return

    # Collect all block positions in global coords (positionCm + originCm)
    global_positions: set[float] = set()
    for tid, detail in trap_details.items():
        origin = detail.get('geometry', {}).get('originCm', 0)
        for blk in detail.get('blocks', []):
            global_positions.add(_r(blk['positionCm'] + origin))

    sorted_globals = sorted(global_positions)

    # Redistribute blocks to each trapezoid
    for tid, detail in trap_details.items():
        geom = detail.get('geometry', {})
        origin = geom.get('originCm', 0)
        beam_len = geom.get('topBeamLength', 0)  # slope length = local span
        block_length = geom.get('blockLengthCm', 50)

        # Convert global positions to local, keep those within [0, beamLen]
        local_positions = []
        for gp in sorted_globals:
            lp = _r(gp - origin)
            if -0.1 <= lp <= beam_len + 0.1:
                local_positions.append(lp)

        # Remove overlaps + add slope projection (same logic as initial computation)
        angle_deg = geom.get('angle', 0)
        cos_a = math.cos(angle_deg * math.pi / 180) if angle_deg else 1
        slope_block_length = block_length / cos_a if cos_a > 0 else block_length
        blocks = []
        for lp in local_positions:
            if blocks and lp < blocks[-1]['positionCm'] + block_length - 0.1:
                continue
            is_end = abs(lp) < 0.1 or abs(lp - (beam_len - block_length)) < 0.1
            blocks.append({
                'positionCm': lp,
                'isEnd': is_end,
                'slopePositionCm': _r(lp / cos_a) if cos_a > 0 else lp,
                'slopeLengthCm': _r(slope_block_length),
            })

        detail['blocks'] = blocks

        # Recompute block punches from new block positions; preserve all other origins
        base_beam_len = geom.get('baseBeamLength', beam_len * cos_a)
        non_block_punches = [p for p in detail.get('punches', []) if p.get('origin') != 'block']
        other_base_positions = [p['positionCm'] for p in non_block_punches if p['beamType'] == 'base']
        block_punch = geom.get('blockPunchCm', 9)
        profile_step = geom.get('beamThickCm', 4)
        detail['punches'] = non_block_punches + _compute_block_punches(
            blocks, other_base_positions, block_length, base_beam_len, block_punch, profile_step,
        )


def _compute_block_punches(
    blocks: list[dict],
    other_base_positions: list[float],
    block_length_cm: float,
    base_beam_length: float,
    block_punch_cm: float = 9,
    profile_step_cm: float = 4,
) -> list[dict]:
    """
    Compute one punch per block on the base beam.

    Outer blocks (isEnd): blockPunchCm from the outer edge toward center.
    If that overlaps an existing punch (±2cm), shift by profileStepCm
    toward center until a free spot is found.
    Inner blocks: 2cm to the right (toward front) of the rightmost other punch
    in the block range.
    """
    OVERLAP_MARGIN = 2   # cm — minimum distance from any existing punch
    INNER_OFFSET   = 2   # cm

    def has_overlap(candidate, existing):
        return any(abs(candidate - p) < OVERLAP_MARGIN for p in existing)

    result = []
    for block in blocks:
        pos = block['positionCm']
        block_end = pos + block_length_cm

        if block['isEnd']:
            is_rear = pos < base_beam_length / 2
            if is_rear:
                # First outer block: blockPunchCm from base beam start toward center
                punch_pos = block_punch_cm
                while has_overlap(punch_pos, other_base_positions) and punch_pos < block_end:
                    punch_pos += profile_step_cm
            else:
                # Last outer block: blockPunchCm from base beam end toward center
                punch_pos = base_beam_length - block_punch_cm
                while has_overlap(punch_pos, other_base_positions) and punch_pos > pos:
                    punch_pos -= profile_step_cm
        else:
            # Support-leg block: 2cm to the right of the rightmost punch in range
            in_range = [p for p in other_base_positions if pos - 0.1 <= p <= block_end + 0.1]
            if in_range:
                punch_pos = max(in_range) + INNER_OFFSET
            else:
                punch_pos = pos + block_length_cm / 2

        # Validate within block range
        if punch_pos < pos - 0.1 or punch_pos > block_end + 0.1:
            logger.error(
                'Block %s punch at %.1f outside range [%.1f, %.1f]',
                block.get('baseId', '?'), punch_pos, pos, block_end,
            )
            continue

        result.append({
            'beamType': 'base',
            'positionCm': _r(punch_pos),
            'origin': 'block',
        })

    # Add reversedPositionCm: reversed array of positions mapped to same indices
    positions = [p['positionCm'] for p in result]
    reversed_positions = list(reversed(positions))
    for i, p in enumerate(result):
        p['reversedPositionCm'] = reversed_positions[i]

    return result


def _r(v: float) -> float:
    """Round to 1 decimal."""
    return round(v * 10) / 10
