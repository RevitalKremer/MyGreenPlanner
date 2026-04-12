"""
Trapezoid detail service — server-side port of DetailView.jsx computation logic.

Computes per-trapezoid structural details: geometry (leg heights, beam lengths),
legs (positions, inner/outer, side), blocks, punches, and diagonal bracing.

All inputs come from existing stored data in step2/step3.
All outputs are persisted to step3.trapezoidDetails[trapId].
"""

from __future__ import annotations
import copy
import logging
import math

from app.utils.math_helpers import round_to_1dp as _r
from app.utils.settings_helpers import get_setting_or_override as _s
from app.utils.panel_geometry import is_empty_orientation, PANEL_EH

logger = logging.getLogger(__name__)


# ── Sub-computations ─────────────────────────────────────────────────────────

def _build_rail_items(panel_lines: list[dict], line_rails: dict[str, list[float]]) -> tuple[list[dict], float]:
    """
    Build rail item list from panel lines and line rails.

    Returns (rail_items, total_panel_depth).
    Each item: { segIdx, offsetCm, globalOffsetCm }.
    """
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
    return rail_items, d_cm


def _compute_leg_positions(
    rail_items: list[dict],
    origin: float,
    base_overhang_cm: float,
    beam_thick_cm: float,
    base_length_cm: float,
    height_rear: float,
    height_front: float,
    double_above_cm: float,
    leg_offset: float = 0.0,
) -> tuple[list[dict], list[dict]]:
    """
    Compute leg positions (outer + inner).

    Returns (legs, inner_legs).
    legs is sorted by positionCm, each with isDouble flag.
    inner_legs contains extra railPositionCm for block placement.
    leg_offset: shift all positions by this amount (for beam extension).
    """
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

    # Outer leg positions (shifted by leg_offset for beam extension)
    rear_outer_pos = leg_offset
    front_outer_pos = leg_offset + base_length_cm - beam_thick_cm

    # Inner legs
    inner_legs = []
    for ci, r in enumerate(rail_items[1:-1], start=1):
        info = rail_pos_in_seg.get(ci, {'pos': 0, 'N': 1})
        side = 'right' if info['N'] > 1 and info['pos'] > (info['N'] - 1) // 2 else 'left'
        rail_pos = r['globalOffsetCm'] - origin + leg_offset
        if side == 'right':
            leg_pos = rail_pos + base_overhang_cm - beam_thick_cm
        else:
            leg_pos = rail_pos - base_overhang_cm
        # Height interpolated using leg center relative to structural span (rear to front leg)
        leg_center = leg_pos + beam_thick_cm / 2 - rear_outer_pos
        front_center = front_outer_pos + beam_thick_cm / 2 - rear_outer_pos
        frac = max(0.0, min(1.0, leg_center / front_center)) if front_center > 0 else 0
        leg_height = height_rear + frac * (height_front - height_rear)
        inner_legs.append({
            'positionCm': _r(leg_pos),
            'positionEndCm': _r(leg_pos + beam_thick_cm),
            'heightCm': _r(leg_height),
            'railPositionCm': _r(rail_pos),
        })

    legs = sorted([
        {'positionCm': _r(rear_outer_pos), 'positionEndCm': _r(rear_outer_pos + beam_thick_cm), 'heightCm': _r(height_rear)},
        *inner_legs,
        {'positionCm': _r(front_outer_pos), 'positionEndCm': _r(front_outer_pos + beam_thick_cm), 'heightCm': _r(height_front)},
    ], key=lambda l: l['positionCm'])
    for leg in legs:
        leg['isDouble'] = leg['heightCm'] >= double_above_cm

    return legs, inner_legs


def _compute_diagonal_bracing(
    legs: list[dict],
    custom_diagonals: dict | None,
    diag_top_pct: float,
    diag_base_pct: float,
    skip_below_cm: float,
    double_above_cm: float,
    angle_rad: float,
) -> list[dict]:
    """
    Compute diagonal bracing between legs.

    Returns list of active (non-disabled) diagonals.
    """
    custom = custom_diagonals or {}
    num_spans = len(legs) - 1
    diag_top_frac = diag_top_pct / 100
    diag_base_frac = diag_base_pct / 100

    raw_diagonals = []
    for i in range(num_spans):
        h_a = legs[i]['heightCm']
        h_b = legs[i + 1]['heightCm']
        is_double = h_a >= double_above_cm or h_b >= double_above_cm

        ov_d = custom.get(str(i), {})
        skip = h_a < skip_below_cm and h_b < skip_below_cm
        if ov_d.get('disabled') is True:
            skip = True
        elif ov_d.get('disabled') is False:
            skip = False

        reversed_span = num_spans > 1 and i == 0
        def_top = (0.90 if is_double else 1 - diag_top_frac) if reversed_span else (0.10 if is_double else diag_top_frac)
        def_bot = (1 - diag_base_frac) if reversed_span else diag_base_frac

        top_pct = ov_d.get('topPct', def_top)
        bot_pct = ov_d.get('botPct', def_bot)

        # Calculate attachment positions along full beams (not just gap)
        # Leg positions are along slope beam; use these for top attachment
        span_slope_start = legs[i]['positionCm']
        span_slope_end = legs[i + 1]['positionEndCm']
        span_slope_len = span_slope_end - span_slope_start
        
        top_pos_slope = span_slope_start + top_pct * span_slope_len
        bot_pos_slope = span_slope_start + bot_pct * span_slope_len
        
        # Height rises as we move along slope: rise = run × sin(angle)
        sin_a = math.sin(angle_rad)
        cos_a = math.cos(angle_rad)
        height_at_top = h_a + top_pos_slope * sin_a
        
        # Horizontal distance uses cos_a projection
        horiz_dist = abs(bot_pos_slope - top_pos_slope) * cos_a
        length_cm = math.sqrt(height_at_top ** 2 + horiz_dist ** 2) if horiz_dist > 0 else 0

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

    return [d for d in raw_diagonals if not d['disabled']]


def _compute_block_positions(
    inner_legs: list[dict],
    block_length_cm: float,
    base_beam_length: float,
    cos_a: float,
) -> list[dict]:
    """
    Compute block positions on base beam — one per leg.

    Returns list of blocks with positionCm, isEnd, slopePositionCm, slopeLengthCm.
    """
    slope_block_length = block_length_cm / cos_a if cos_a > 0 else block_length_cm
    
    # Special case: only 2 blocks AND they would overlap - place consecutively
    # Blocks overlap when base_beam_length < 2 * block_length_cm
    if not inner_legs and base_beam_length < 2 * block_length_cm:
        blocks = [
            {
                'positionCm': 0.0,
                'isEnd': True,
                'slopePositionCm': 0.0,
                'slopeLengthCm': _r(slope_block_length),
            },
            {
                'positionCm': _r(block_length_cm),
                'isEnd': True,
                'slopePositionCm': _r(block_length_cm / cos_a) if cos_a > 0 else _r(block_length_cm),
                'slopeLengthCm': _r(slope_block_length),
            },
        ]
        logger.info(f'Block positioning: 2 consecutive outer blocks (overlapping case), base_beam_length={base_beam_length}, block_length={block_length_cm}')
        return blocks
    
    # General case: position blocks at leg centers
    raw_blocks = []
    raw_blocks.append({'positionCm': 0.0, 'isEnd': True})
    for il in inner_legs:
        # Leg positions are in SLOPE coordinates (along the angled beam)
        leg_left_slope = il['positionCm']
        leg_right_slope = il['positionEndCm']
        leg_center_slope = (leg_left_slope + leg_right_slope) / 2
        
        # Convert leg center to BASE coordinates (horizontal projection)
        leg_center_base = leg_center_slope * cos_a
        
        # Position block with 66% behind leg center, 34% ahead to reduce front overlap
        # Block length is in base coords, so this is consistent
        left_edge = leg_center_base - block_length_cm * 0.66
        raw_blocks.append({'positionCm': _r(left_edge), 'isEnd': False})
    raw_blocks.append({'positionCm': _r(base_beam_length - block_length_cm), 'isEnd': True})
    
    logger.info(f'Block positioning: {len(raw_blocks)} raw blocks, base_beam_length={base_beam_length}, block_length={block_length_cm}')

    # Remove overlaps: walk left-to-right, skip any block that overlaps the previous
    # EXCEPT: always keep both outer blocks (minimum 2 blocks per trapezoid)
    blocks = []
    for i, blk in enumerate(raw_blocks):
        if blocks and blk['positionCm'] < blocks[-1]['positionCm'] + block_length_cm - 0.1:
            # Overlaps with previous block
            logger.info(f'Block {i} at {blk["positionCm"]} overlaps with previous at {blocks[-1]["positionCm"]}, isEnd={blk["isEnd"]}')
            if blk['isEnd']:
                # This is an outer block - NEVER remove it
                # Keep at calculated position even if it overlaps (block may extend beyond beam)
                pos = blk['positionCm']
                logger.info(f'Keeping outer block {i} at {pos}')
            else:
                # Inner block that overlaps - skip it
                logger.info(f'Skipping inner block {i}')
                continue
        else:
            pos = blk['positionCm']
        
        blocks.append({
            'positionCm': _r(pos),
            'isEnd': blk['isEnd'],
            'slopePositionCm': _r(pos / cos_a) if cos_a > 0 else _r(pos),
            'slopeLengthCm': _r(slope_block_length),
        })
    
    logger.info(f'Final: {len(blocks)} blocks after overlap removal')
    return blocks


def _compute_structural_punches(
    beam_thick_cm: float,
    base_beam_length: float,
    top_beam_length: float,
    cos_a: float,
    inner_legs: list[dict],
    rail_items: list[dict],
    origin: float,
    diagonals: list[dict],
    legs: list[dict],
    leg_offset: float = 0.0,
) -> list[dict]:
    """
    Compute punches for outer legs, inner legs, rails, and diagonals (not blocks).

    leg_offset: offset applied to legs (rear extension). Slope beam punches from legs/diagonals
    must subtract this to convert from base beam coords to slope beam coords.

    Returns list of punch dicts.
    """
    profile_half = beam_thick_cm / 2
    punches = []

    # outerLeg: at leg center on base beam.
    # Leg positions include leg_offset (extension). Separate extension from structural
    # position: extension is flat (not projected), structural part is cos_a-projected.
    rear_leg_center = legs[0]['positionCm'] + profile_half if legs else leg_offset + profile_half
    front_leg_center = (legs[-1]['positionEndCm'] - profile_half) if legs else leg_offset + base_beam_length - profile_half
    rear_base = leg_offset + (rear_leg_center - leg_offset) * cos_a
    front_base = leg_offset + (front_leg_center - leg_offset) * cos_a
    punches.append({'beamType': 'base',  'positionCm': _r(rear_base), 'origin': 'outerLeg'})
    punches.append({'beamType': 'base',  'positionCm': _r(front_base), 'origin': 'outerLeg'})
    punches.append({'beamType': 'slope', 'positionCm': _r(profile_half), 'origin': 'outerLeg'})
    punches.append({'beamType': 'slope', 'positionCm': _r(top_beam_length - profile_half), 'origin': 'outerLeg'})

    # innerLeg: punch at center of profile on both beams
    for il in inner_legs:
        center = (il['positionCm'] + il['positionEndCm']) / 2
        base_pos = leg_offset + (center - leg_offset) * cos_a
        punches.append({'beamType': 'base',  'positionCm': _r(base_pos), 'origin': 'innerLeg'})
        # Slope beam: convert from base beam coords to slope coords
        punches.append({'beamType': 'slope', 'positionCm': _r(center - leg_offset), 'origin': 'innerLeg'})

    # rail: one punch per cross rail at its center on the slope beam
    for r in rail_items:
        rail_pos = r['globalOffsetCm'] - origin
        punches.append({'beamType': 'slope', 'positionCm': _r(rail_pos), 'origin': 'rail'})

    # diagonal: top on slope beam (slope coords), bottom on base beam (base beam coords)
    # Use SAME span definition as diagonal bracing calculation (full span, not gap)
    for diag in diagonals:
        si = diag['spanIdx']
        span_slope_start = legs[si]['positionCm']
        span_slope_end = legs[si + 1]['positionEndCm']
        span_slope_len = span_slope_end - span_slope_start
        
        top_pos_slope = span_slope_start + diag['topPct'] * span_slope_len
        bot_pos_slope = span_slope_start + diag['botPct'] * span_slope_len
        
        # Convert to beam coordinates
        top_pos = _r(top_pos_slope - leg_offset)  # slope beam coords
        bot_pos = _r(leg_offset + (bot_pos_slope - leg_offset) * cos_a)  # base beam coords (projected)
        
        punches.append({'beamType': 'slope', 'positionCm': top_pos, 'origin': 'diagonal'})
        punches.append({'beamType': 'base',  'positionCm': bot_pos, 'origin': 'diagonal'})

    return punches


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
    roof_spec: dict | None = None,
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
    rs = roof_spec or {}
    roof_type = rs.get('type', 'concrete')

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

    # Structural safety parameters (from app_settings)
    skip_below_cm        = settings['diagSkipBelowCm']
    double_above_cm      = settings['diagDoubleAboveCm']
    punch_overlap_margin = settings['punchOverlapMarginCm']
    punch_inner_offset   = settings['punchInnerOffsetCm']

    angle_rad = angle_deg * math.pi / 180
    cross_rail_cm = cross_rail_edge_dist_mm / 10

    # ── Geometry from bases_data ───────────────────────────────────────────
    base_length_cm = bases_data.get('baseLengthCm', 0)
    rear_leg_depth = bases_data.get('rearLegDepthCm', 0)
    front_leg_depth = bases_data.get('frontLegDepthCm', 0)

    origin = rear_leg_depth - base_overhang_cm

    cos_a = math.cos(angle_rad)
    top_beam_length = base_length_cm
    base_beam_length = base_length_cm * cos_a

    # ── Iskurit / Insulated Panel: perpendicular beam extension ────────────
    front_ext = 0.0
    rear_ext = 0.0
    if roof_type in ('iskurit', 'insulated_panel'):
        orientation = rs.get('installationOrientation')
        purlin_dist_cm = rs.get('distanceBetweenPurlinsCm')
        if orientation == 'perpendicular' and purlin_dist_cm and purlin_dist_cm > 0:
            buffer_cm = _s(settings, ov, 'purlinBufferCm')
            extension = purlin_dist_cm + buffer_cm
            extend_front = _s(settings, ov, 'extendFront')  # label: "Extend Base Beam Rear"
            extend_rear = _s(settings, ov, 'extendRear')   # label: "Extend Base Beam Front"
            front_ext = extension if extend_front else 0
            rear_ext = extension if extend_rear else 0
            base_beam_length = base_beam_length + rear_ext + front_ext

    sin_a = math.sin(angle_rad)
    tan_a = math.tan(angle_rad)
    slope_offset = rail_offset_cm - base_overhang_cm + cross_rail_cm * tan_a
    # For purlin types: no blocks, base beam sits on roof surface
    effective_block_height = 0 if roof_type in ('iskurit', 'insulated_panel') else block_height_cm
    height_rear = front_height_cm - effective_block_height + slope_offset * sin_a - cross_rail_cm / cos_a

    base_length_horiz = base_length_cm * cos_a  # original (without extension) for leg placement
    height_front = height_rear + base_length_horiz * math.tan(angle_rad)

    geometry = {
        'heightRear': _r(height_rear),
        'heightFront': _r(height_front),
        'topBeamLength': _r(top_beam_length),
        'baseBeamLength': _r(base_beam_length),
        'baseLength': _r(base_length_horiz),
        'angle': angle_deg,
        'panelFrontHeight': _r(front_height_cm),
        'originCm': _r(origin),
        'beamThickCm': _r(beam_thick_cm),
        'panelThickCm': _r(panel_thick_cm),
        **({'blockHeightCm': _r(effective_block_height), 'blockLengthCm': _r(block_length_cm), 'blockPunchCm': _r(block_punch_cm)} if roof_type == 'concrete' else {}),
        'crossRailHeightCm': _r(cross_rail_cm),
        'punchOverlapMarginCm': _r(punch_overlap_margin),
        'punchInnerOffsetCm': _r(punch_inner_offset),
    }

    # Store extension info for FE rendering
    if front_ext > 0 or rear_ext > 0:
        geometry['frontExtensionCm'] = _r(front_ext)
        geometry['rearExtensionCm'] = _r(rear_ext)

    # ── Rail items ─────────────────────────────────────────────────────────
    rail_items, total_panel_depth = _build_rail_items(panel_lines, line_rails)

    # Slope distance annotations
    first_rail_global = rail_items[0]['globalOffsetCm'] if rail_items else 0
    last_rail_global = rail_items[-1]['globalOffsetCm'] if rail_items else total_panel_depth
    geometry['panelEdgeToFirstRailCm'] = _r(first_rail_global)
    geometry['panelEdgeToLastRailCm'] = _r(total_panel_depth - last_rail_global)
    geometry['railToRailCm'] = _r(last_rail_global - first_rail_global)
    geometry['overhangCm'] = _r(base_overhang_cm)
    geometry['panelRearHeightCm'] = _r(front_height_cm + total_panel_depth * sin_a)

    # ── Legs ───────────────────────────────────────────────────────────────
    # For extended beams, legs shift by front_ext so position 0 = base beam start
    legs, inner_legs = _compute_leg_positions(
        rail_items, origin, base_overhang_cm, beam_thick_cm,
        base_length_cm, height_rear, height_front, double_above_cm,
        leg_offset=front_ext,
    )

    # ── Diagonals ──────────────────────────────────────────────────────────
    diagonals = _compute_diagonal_bracing(
        legs, custom_diagonals, diag_top_pct, diag_base_pct,
        skip_below_cm, double_above_cm, angle_rad,
    )

    # ── Blocks ─────────────────────────────────────────────────────────────
    # Iskurit/insulated panel: no blocks (attached to purlins with screws)
    if roof_type in ('iskurit', 'insulated_panel'):
        blocks = []
    else:
        blocks = _compute_block_positions(inner_legs, block_length_cm, base_beam_length, cos_a)

    # ── Punches ────────────────────────────────────────────────────────────
    punches = _compute_structural_punches(
        beam_thick_cm, base_beam_length, top_beam_length, cos_a,
        inner_legs, rail_items, origin, diagonals, legs,
        leg_offset=front_ext,
    )

    # Block punches (only for concrete)
    if blocks:
        other_base_positions = [p['positionCm'] for p in punches if p['beamType'] == 'base']
        block_punches = _compute_block_punches(
            blocks, inner_legs, other_base_positions, block_length_cm, base_beam_length,
            block_punch_cm, beam_thick_cm, cos_a, punch_overlap_margin, punch_inner_offset,
        )
        punches += block_punches

    # Add reversedPositionCm (distance from beam end) to qualifying punches
    for p in punches:
        if p['beamType'] == 'base' and p['origin'] == 'block':
            p['reversedPositionCm'] = _r(base_beam_length - p['positionCm'])
        elif p['beamType'] == 'slope' and p['origin'] != 'rail':
            p['reversedPositionCm'] = _r(top_beam_length - p['positionCm'])

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

    # Collect all block positions in global base-beam coords
    global_positions: set[float] = set()
    for tid, detail in trap_details.items():
        geom = detail.get('geometry', {})
        origin = geom.get('originCm', 0)
        angle_deg = geom.get('angle', 0)
        cos_a = math.cos(angle_deg * math.pi / 180) if angle_deg else 1
        origin_base = origin * cos_a
        for blk in detail.get('blocks', []):
            global_positions.add(_r(blk['positionCm'] + origin_base))

    sorted_globals = sorted(global_positions)

    # Redistribute blocks to each trapezoid
    for tid, detail in trap_details.items():
        geom = detail.get('geometry', {})
        origin = geom.get('originCm', 0)
        block_length = geom.get('blockLengthCm', 50)
        angle_deg = geom.get('angle', 0)
        cos_a = math.cos(angle_deg * math.pi / 180) if angle_deg else 1
        origin_base = origin * cos_a
        base_beam_len = geom.get('baseBeamLength', 0)

        # Convert global base-beam positions to local, keep within [0, baseBeamLen]
        local_positions = []
        for gp in sorted_globals:
            lp = _r(gp - origin_base)
            if -0.1 <= lp <= base_beam_len + 0.1:
                local_positions.append(lp)

        # Remove overlaps + add slope projection
        slope_block_length = block_length / cos_a if cos_a > 0 else block_length
        blocks = []
        for lp in local_positions:
            if blocks and lp < blocks[-1]['positionCm'] + block_length - 0.1:
                continue
            blocks.append({
                'positionCm': lp,
                'isEnd': False,
                'slopePositionCm': _r(lp / cos_a) if cos_a > 0 else lp,
                'slopeLengthCm': _r(slope_block_length),
            })
        # First and last blocks are outer — reposition to align with beam ends
        if blocks:
            blocks[0]['isEnd'] = True
            blocks[0]['positionCm'] = 0.0
            blocks[0]['slopePositionCm'] = 0.0
            blocks[-1]['isEnd'] = True
            blocks[-1]['positionCm'] = _r(base_beam_len - block_length)
            blocks[-1]['slopePositionCm'] = _r((base_beam_len - block_length) / cos_a) if cos_a > 0 else _r(base_beam_len - block_length)

        detail['blocks'] = blocks

        # Recompute block punches from new block positions; preserve all other origins
        non_block_punches = [p for p in detail.get('punches', []) if p.get('origin') != 'block']
        other_base_positions = [p['positionCm'] for p in non_block_punches if p['beamType'] == 'base']
        block_punch = geom.get('blockPunchCm', 9)
        profile_step = geom.get('beamThickCm', 4)
        overlap_margin = geom['punchOverlapMarginCm']
        inner_offset = geom['punchInnerOffsetCm']
        inner_legs = detail.get('legs', [])[1:-1]
        new_block_punches = _compute_block_punches(
            blocks, inner_legs, other_base_positions, block_length, base_beam_len,
            block_punch, profile_step, cos_a, overlap_margin, inner_offset,
        )
        # Add reversedPositionCm (distance from beam end) to block punches
        for p in new_block_punches:
            p['reversedPositionCm'] = _r(base_beam_len - p['positionCm'])
        detail['punches'] = non_block_punches + new_block_punches


def _compute_block_punches(
    blocks: list[dict],
    inner_legs: list[dict],
    other_base_positions: list[float],
    block_length_cm: float,
    base_beam_length: float,
    block_punch_cm: float,
    profile_step_cm: float,
    cos_a: float,
    overlap_margin_cm: float,
    inner_offset_cm: float,
) -> list[dict]:
    """
    Compute one punch per block on the base beam.

    Outer blocks (isEnd): blockPunchCm from the outer edge toward center.
    Inner blocks: Use actual leg positions to find valid punch locations.
    Travel from leg right wall (toward higher leg) first, then left wall if needed.

    overlap_margin_cm: Minimum distance from any existing punch (from settings)
    inner_offset_cm: Offset for inner block punches (from settings)
    """
    def has_overlap(candidate, existing):
        return any(abs(candidate - p) < overlap_margin_cm for p in existing)

    result = []
    for bi, block in enumerate(blocks):
        pos = block['positionCm']          # slope coords
        block_end = pos + block_length_cm  # slope coords

        if block['isEnd']:
            is_rear = pos < base_beam_length / 2
            if is_rear:
                # Rear outer block: distance from rear leg END (right wall) + block_punch_cm
                # Rear leg: 0 to profile_step_cm (4cm)
                punch_pos = profile_step_cm + block_punch_cm
                while has_overlap(punch_pos, other_base_positions) and punch_pos < block_end:
                    punch_pos = round(punch_pos + profile_step_cm)
            else:
                # Front outer block: distance from front leg START (left wall) - block_punch_cm
                # Front leg: (base_beam_length - profile_step_cm) to base_beam_length
                punch_pos = (base_beam_length - profile_step_cm) - block_punch_cm
                while has_overlap(punch_pos, other_base_positions) and punch_pos > pos:
                    punch_pos = round(punch_pos - profile_step_cm)
            check_lo, check_hi = pos - 0.1, block_end + 0.1
        else:
            # Inner block: use actual leg position from inner_legs data
            # Inner blocks (bi=1 to len(blocks)-2) map to inner_legs (0 to len(inner_legs)-1)
            leg_idx = bi - 1
            if leg_idx < 0 or leg_idx >= len(inner_legs):
                # Safeguard: use center if leg data missing (shouldn't happen)
                base_lo = _r(pos * cos_a)
                base_hi = _r(block_end * cos_a)
                punch_pos = (base_lo + base_hi) / 2
                check_lo, check_hi = base_lo - 0.1, base_hi + 0.1
            else:
                # Get leg position from inner_legs (in SLOPE coords)
                leg = inner_legs[leg_idx]
                leg_left_slope = leg['positionCm']
                leg_right_slope = leg['positionEndCm']
                
                # Convert to BASE coords (horizontal projection)
                leg_left_base = _r(leg_left_slope * cos_a)
                leg_right_base = _r(leg_right_slope * cos_a)
                
                # Block range in base coords
                base_lo = _r(pos * cos_a)
                base_hi = _r(block_end * cos_a)
                
                # Block is positioned 66% behind leg, 34% ahead of leg
                # 34% section = ahead of leg (right side, toward higher/front leg)
                # 66% section = behind leg (left side, toward lower/rear leg)
                
                punch_pos = None
                
                # FIRST TRY: 34% section (ahead of leg, toward higher leg)
                # Start at leg right wall + block_punch_cm, travel RIGHT
                start_right = round(leg_right_base + block_punch_cm)
                candidate = start_right
                while candidate <= base_hi:
                    if not has_overlap(candidate, other_base_positions):
                        punch_pos = candidate
                        break
                    candidate += 1
                
                # SECOND TRY: 66% section (behind leg, toward lower leg)
                # Start at leg left wall - block_punch_cm, travel LEFT
                if punch_pos is None:
                    start_left = round(leg_left_base - block_punch_cm)
                    candidate = start_left
                    while candidate >= base_lo:
                        if not has_overlap(candidate, other_base_positions):
                            punch_pos = candidate
                            break
                        candidate -= 1
                
                # Fallback if still no valid position (should be rare)
                if punch_pos is None:
                    punch_pos = round((base_lo + base_hi) / 2)
                
                check_lo, check_hi = base_lo - 0.1, base_hi + 0.1

        # Validate within block range
        if punch_pos < check_lo or punch_pos > check_hi:
            logger.error(
                'Block %d punch at %.1f outside range [%.1f, %.1f] — DROPPED',
                bi, punch_pos, pos, block_end,
            )
            continue
      
        result.append({
            'beamType': 'base',
            'positionCm': round(punch_pos),  # Ensure punch position is a whole centimeter
            'origin': 'block',
            'blockIdx': bi,
        })

    return result


def trim_trapezoid(
    detail: dict,
    full_trap_detail: dict,
    active_rail_positions: set,
    full_origin: float,
    line_orientations: list[str] | None = None,
    panel_width_cm: float = 0,
    panel_length_cm: float = 0,
    line_gap_cm: float = 0,
) -> dict:
    """
    Trim a trapezoid detail to only include legs/blocks/punches/diagonals
    relevant to its active panel lines. Rebases all positions to start from 0.
    
    Returns a deep copy of detail with trimmed data. Does not modify inputs.
    
    Args:
        detail: Trapezoid detail dict to trim (will be deep copied)
        full_trap_detail: Full trapezoid detail dict (reference for filtering)
        active_rail_positions: Set of rail positions (cm) that are active
        full_origin: Origin cm of the full trapezoid
        line_orientations: Panel orientations for each line
        panel_width_cm: Panel width for empty line height adjustments
        panel_length_cm: Panel length for empty line height adjustments
        line_gap_cm: Gap between lines for empty line height adjustments
    
    Returns:
        Trimmed detail dict with rebased positions
    """
    # Deep copy to avoid modifying input
    detail = copy.deepcopy(detail)
    
    full_legs = full_trap_detail.get('legs', [])
    if len(full_legs) < 2:
        return detail

    # Keep inner legs matching active rail positions (exact match — positions
    # come from the full trap's own leg data, so they're guaranteed consistent).
    filtered_legs = []
    for leg in full_legs[1:-1]:
        rail_pos = round(leg.get('railPositionCm', leg['positionCm']), 1)
        if rail_pos in active_rail_positions:
            filtered_legs.append({**leg})
    # Include outer legs: always add rear/front outer legs when there are active rails,
    # even if no inner legs matched (e.g., sub-trap with only 1 panel line).
    if active_rail_positions:
        if not filtered_legs or max(active_rail_positions) > filtered_legs[-1]['positionCm']:
            filtered_legs.append({**full_legs[-1]})
        if not filtered_legs or min(active_rail_positions) < filtered_legs[0]['positionCm']:
            filtered_legs.insert(0, {**full_legs[0]})
    if len(filtered_legs) < 2:
        detail['legs'] = filtered_legs
        detail['diagonals'] = []
        return detail

    # Capture pre-rebase positions for diagonal filtering
    pre_rebase_positions = [_r(l['positionCm']) for l in filtered_legs]

    # Rebase: shift so first leg aligns with extension offset
    rear_pos = filtered_legs[0]['positionCm']
    front_end = filtered_legs[-1]['positionEndCm']
    slope_len = front_end - rear_pos
    angle = detail.get('geometry', {}).get('angle', 0)
    cos_a = math.cos(angle * math.pi / 180)
    base_len = slope_len * cos_a
    geom = detail['geometry']

    # Update geometry
    geom['originCm'] = _r(full_origin + rear_pos)
    geom['heightRear'] = filtered_legs[0]['heightCm']
    geom['heightFront'] = filtered_legs[-1]['heightCm']
    geom['topBeamLength'] = _r(slope_len)
    geom['baseBeamLength'] = _r(base_len)
    geom['baseLength'] = _r(base_len)

    # Update panelFrontHeight if first line is empty (EV/EH)
    orients = line_orientations or []
    if orients and is_empty_orientation(orients[0]):
        skipped_depth = 0
        for li, o in enumerate(orients):
            if not is_empty_orientation(o):
                break
            is_h = o == PANEL_EH
            skipped_depth += panel_width_cm if is_h else panel_length_cm
            if li > 0:
                skipped_depth += line_gap_cm
        sin_a = math.sin(angle * math.pi / 180)
        geom['panelFrontHeight'] = _r(geom.get('panelFrontHeight', 0) + skipped_depth * sin_a)

    # Update panelRearHeightCm if last line is empty (EV/EH)
    if orients and is_empty_orientation(orients[-1]):
        skipped_rear = 0
        for o in reversed(orients):
            if not is_empty_orientation(o):
                break
            is_h = o == PANEL_EH
            skipped_rear += panel_width_cm if is_h else panel_length_cm
            skipped_rear += line_gap_cm
        sin_a = math.sin(angle * math.pi / 180)
        geom['panelRearHeightCm'] = _r(geom.get('panelRearHeightCm', 0) - skipped_rear * sin_a)

    # Rebase legs: shift so first leg is at position 0
    rebase_shift = rear_pos
    for leg in filtered_legs:
        leg['positionCm'] = _r(leg['positionCm'] - rebase_shift)
        if 'positionEndCm' in leg:
            leg['positionEndCm'] = _r(leg['positionEndCm'] - rebase_shift)
        if 'railPositionCm' in leg:
            leg['railPositionCm'] = _r(leg['railPositionCm'] - rebase_shift)
    detail['legs'] = filtered_legs

    # Recompute railToRailCm
    inner_rails = [l.get('railPositionCm', l['positionCm']) for l in filtered_legs[1:-1]]
    if inner_rails:
        geom['railToRailCm'] = _r(max(inner_rails) - min(inner_rails))

    # ── Blocks + Punches ──────────────────────────────────────────────────
    has_blocks = 'blockLengthCm' in geom
    if not has_blocks and detail.get('blocks'):
        logger.error('Trim trapezoid: blocks present but blockLengthCm missing from geometry — data inconsistency')
    if has_blocks:
        # Blocks: regenerate in base-beam coords (same rules as service)
        block_length_cm = geom['blockLengthCm']
        slope_block_length = block_length_cm / cos_a if cos_a > 0 else block_length_cm
        raw_blocks = []
        raw_blocks.append({'positionCm': 0.0, 'isEnd': True})
        for leg in filtered_legs[1:-1]:
            rail_pos = leg.get('railPositionCm', leg['positionCm'])
            rail_base = rail_pos * cos_a
            raw_blocks.append({'positionCm': _r(rail_base - block_length_cm / 2), 'isEnd': False})
        raw_blocks.append({'positionCm': _r(base_len - block_length_cm), 'isEnd': True})
        new_blocks = []
        for blk in raw_blocks:
            if new_blocks and blk['positionCm'] < new_blocks[-1]['positionCm'] + block_length_cm - 0.1:
                continue
            pos = blk['positionCm']
            new_blocks.append({
                'positionCm': _r(pos),
                'isEnd': blk['isEnd'],
                'slopePositionCm': _r(pos / cos_a) if cos_a > 0 else _r(pos),
                'slopeLengthCm': _r(slope_block_length),
            })
        detail['blocks'] = new_blocks
    else:
        detail['blocks'] = []

    # Punches: filter from full trap, rebase, regenerate outer+inner+block
    base_shift = rear_pos * cos_a
    profile_half = geom['beamThickCm'] / 2
    new_punches = []
    for p in full_trap_detail.get('punches', []):
        # Skip outerLeg, block, and innerLeg punches — they'll be regenerated
        if p.get('origin') in ('outerLeg', 'block', 'innerLeg'):
            continue
        pp = {**p}
        shift = rear_pos if p['beamType'] == 'slope' else base_shift
        pp['positionCm'] = _r(p['positionCm'] - shift)
        beam_len = slope_len if p['beamType'] == 'slope' else base_len
        if -0.5 <= pp['positionCm'] <= beam_len + 0.5:
            if p['beamType'] == 'slope' and p.get('origin') != 'rail':
                pp['reversedPositionCm'] = _r(slope_len - pp['positionCm'])
            new_punches.append(pp)
    # Fresh outerLeg punches — base at leg center, slope at beam ends
    rear_leg_center = filtered_legs[0]['positionCm'] + profile_half
    front_leg_center = filtered_legs[-1]['positionEndCm'] - profile_half
    new_punches.append({'beamType': 'base',  'positionCm': _r(rear_leg_center * cos_a), 'origin': 'outerLeg'})
    new_punches.append({'beamType': 'base',  'positionCm': _r(front_leg_center * cos_a), 'origin': 'outerLeg'})
    new_punches.append({'beamType': 'slope', 'positionCm': _r(profile_half), 'origin': 'outerLeg',
                        'reversedPositionCm': _r(slope_len - profile_half)})
    new_punches.append({'beamType': 'slope', 'positionCm': _r(slope_len - profile_half), 'origin': 'outerLeg',
                        'reversedPositionCm': _r(profile_half)})
    # Fresh innerLeg punches from actual trimmed inner legs
    for il in filtered_legs[1:-1]:
        center = (il['positionCm'] + il['positionEndCm']) / 2
        new_punches.append({'beamType': 'base',  'positionCm': _r(center * cos_a), 'origin': 'innerLeg'})
        new_punches.append({'beamType': 'slope', 'positionCm': _r(center), 'origin': 'innerLeg',
                            'reversedPositionCm': _r(slope_len - center)})
    # Block punches only if blocks exist
    if has_blocks:
        other_base_positions = [p['positionCm'] for p in new_punches if p['beamType'] == 'base']
        block_punch_cm = geom['blockPunchCm']
        inner_legs_trim = [leg for leg in detail['legs'] if not (leg.get('positionCm', 0) == 0 or leg.get('positionCm', 0) >= geom['topBeamLength'] - 0.1)]
        block_punches = _compute_block_punches(
            detail['blocks'], inner_legs_trim, other_base_positions, block_length_cm, base_len,
            block_punch_cm, geom['beamThickCm'], cos_a,
            geom['punchOverlapMarginCm'], geom['punchInnerOffsetCm'],
        )
        for bp in block_punches:
            bp['reversedPositionCm'] = _r(base_len - bp['positionCm'])
        new_punches += block_punches
    detail['punches'] = new_punches

    # Filter diagonals from full trap: keep those where both adjacent legs survived
    pos_to_idx = {p: i for i, p in enumerate(pre_rebase_positions)}
    new_diags = []
    for d in full_trap_detail.get('diagonals', []):
        si = d['spanIdx']
        if si < len(full_legs) - 1:
            pa = _r(full_legs[si]['positionCm'])
            pb = _r(full_legs[si + 1]['positionCm'])
            ia = pos_to_idx.get(pa)
            ib = pos_to_idx.get(pb)
            if ia is not None and ib is not None and ib == ia + 1:
                new_diags.append({**d, 'spanIdx': ia})
    detail['diagonals'] = new_diags
    
    return detail
