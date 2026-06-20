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
from app.services import settings_cache

logger = logging.getLogger(__name__)


# ── Coordinate helpers ────────────────────────────────────────────────────────

def _slope_to_base(slope_pos: float, profile_half: float, cos_a: float, leg_offset: float = 0.0) -> float:
    """Convert slope beam position to base beam position.

    Beam ends (profile_half from each end) extend straight past the punch
    connection points.  cos(a) projection only applies to the structural span
    between punches — the same rule used for base_beam_core calculation.
    """
    return leg_offset + profile_half + (slope_pos - leg_offset - profile_half) * cos_a


def _base_to_slope(base_pos: float, profile_half: float, cos_a: float, leg_offset: float = 0.0) -> float:
    """Convert base beam position to slope beam position (inverse of _slope_to_base)."""
    if cos_a <= 0:
        return base_pos
    return leg_offset + profile_half + (base_pos - leg_offset - profile_half) / cos_a


def _block_punch_reversed(beam_length: float, raw_pos: float) -> tuple[int, float]:
    """Compute block punch positions: reversed rounded to integer, forward derived.

    Returns (reversedPositionCm, positionCm).
    """
    rev = round(beam_length - raw_pos)
    return rev, _r(beam_length - rev)


def _diagonal_cut_length(pp_length: float, vert: float, horiz: float, beam_thick_cm: float) -> float:
    """Compute diagonal cut length from punch-to-punch distance.

    For most angles the extension is beam_thick (the diagonal profile's
    overhang at each end). Between 40°–50° the diagonal corner reaches
    the beam edge, so we use beam_thick × sin(diagonal_angle) instead.

    Args:
        pp_length: punch-to-punch straight-line distance
        vert: vertical component of the PP distance
        horiz: horizontal component of the PP distance
        beam_thick_cm: angle profile size (4cm for 40mm)

    Returns:
        Total cut length including material extension at both ends.
    """
    if pp_length <= 0:
        return 0
    # Use abs(horiz) — diagonals tilted backward (higher point on the right)
    # have the same physical angle as forward ones, just mirrored.
    diag_angle_deg = math.atan2(vert, abs(horiz)) * 180 / math.pi
    if 40 <= diag_angle_deg <= 50:
        extension = beam_thick_cm * vert / pp_length
    else:
        extension = beam_thick_cm
    return pp_length + extension


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
            # Round up (away from rail) to maintain overhang distance
            leg_pos = math.ceil(rail_pos + base_overhang_cm - beam_thick_cm)
        else:
            # Round down (away from rail) to maintain overhang distance
            leg_pos = math.floor(rail_pos - base_overhang_cm)
        # Height interpolated using punch-to-punch span (rear punch = 0, front punch = 1)
        rear_punch = rear_outer_pos + beam_thick_cm / 2
        front_punch = front_outer_pos + beam_thick_cm / 2
        structural_span = front_punch - rear_punch
        leg_center = leg_pos + beam_thick_cm / 2
        frac = max(0.0, min(1.0, (leg_center - rear_punch) / structural_span)) if structural_span > 0 else 0
        leg_height = height_rear + frac * (height_front - height_rear)
        inner_legs.append({
            'positionCm': leg_pos,
            'positionEndCm': leg_pos + beam_thick_cm,
            'heightCm': _r(leg_height),
            'railPositionCm': _r(rail_pos),
        })

    legs = sorted([
        {'positionCm': _r(rear_outer_pos), 'positionEndCm': _r(rear_outer_pos + beam_thick_cm), 'heightCm': _r(height_rear)},
        *inner_legs,
        {'positionCm': _r(front_outer_pos), 'positionEndCm': _r(front_outer_pos + beam_thick_cm), 'heightCm': _r(height_front)},
    ], key=lambda l: l['positionCm'])
    for leg in legs:
        if leg['heightCm'] == beam_thick_cm:
            leg['virtual'] = True
        leg['isDouble'] = leg['heightCm'] >= double_above_cm

    return legs, inner_legs


def _compute_diagonal_bracing(
    legs: list[dict],
    custom_diagonals: dict | None,
    diag_dist_from_leg_cm: float,
    diag_preferred_angle_deg: float,
    skip_below_cm: float,
    double_above_cm: float,
    angle_rad: float,
    beam_thick_cm: float,
) -> tuple[list[dict], dict]:
    """
    Compute diagonal bracing between legs.

    Default placement rule: a diagonal is added in every OTHER leg-span,
    starting from the span adjacent to the higher (front, last) leg and
    moving inward. So with num_spans=N, default-selected spans are
    indices N-1, N-3, N-5, …  Spans where both legs are below skip_below_cm
    are also skipped by default. User overrides (disabled=true/false in
    custom_diagonals) always win.

    The bottom attachment (lower point) is placed diag_dist_from_leg_cm from the
    near leg along the base beam — the same tilt-direction logic as before
    (reversed for the first span in a multi-span trap, forward for all others).
    The top attachment is then derived by projecting upward at diag_preferred_angle_deg
    from horizontal. If the top lands within the effective dist of the far leg
    on the slope beam, it is clamped outward (angle steepens).

    Server-side constraints enforced per span (sourced from admin app_settings):
      - effective_dist = min(dist, punch_span - 2 * diagDistFromLegCm.min_val)
      - effective_angle = min(angle, diagPreferredAngleDeg.max_val)

    User overrides (topDistFromLegCm/botDistFromLegCm in custom_diagonals) bypass this logic entirely.
    Returns (active_diagonals, effective_settings) where effective_settings reports
    the tightest constraints applied — used by the FE to update the sidebar.
    """
    custom = custom_diagonals or {}
    num_spans = len(legs) - 1
    profile_half = beam_thick_cm / 2
    sin_a = math.sin(angle_rad)
    cos_a = math.cos(angle_rad)
    diag_min_dist_cm = settings_cache.get_min('diagDistFromLegCm')
    diag_max_angle_deg = settings_cache.get_max('diagPreferredAngleDeg')
    # Enforce angle ceiling
    effective_angle = min(diag_preferred_angle_deg, diag_max_angle_deg)
    tan_pref = math.tan(math.radians(effective_angle))
    dist = diag_dist_from_leg_cm
    bolt_inset = 2.75

    min_max_dist = None   # tightest per-span max across all spans
    min_eff_dist = dist   # most restrictive effective dist applied

    raw_diagonals = []
    for i in range(num_spans):
        h_a = legs[i]['heightCm']
        h_b = legs[i + 1]['heightCm']

        ov_d = custom.get(str(i), {})
        # Default: every other span starting from the higher (front, last) leg
        # inward — so the span adjacent to the front leg is always selected,
        # then every second span moving rearward.
        alt_selected = (num_spans - 1 - i) % 2 == 0
        skip = (not alt_selected) or (h_a < skip_below_cm and h_b < skip_below_cm)
        if ov_d.get('disabled') is True:
            skip = True
        elif ov_d.get('disabled') is False:
            skip = False

        # Punch-to-punch span: from center of left leg to center of right leg
        punch_start = legs[i]['positionCm'] + profile_half
        punch_end = legs[i + 1]['positionEndCm'] - profile_half
        punch_span = punch_end - punch_start
        base_span = punch_span * cos_a  # horizontal punch-to-punch distance

        # Per-span distance constraint: both ends must have at least diag_min_dist_cm
        span_max_dist = max(diag_min_dist_cm, punch_span - 2 * diag_min_dist_cm)
        effective_dist = min(dist, span_max_dist)
        if min_max_dist is None or span_max_dist < min_max_dist:
            min_max_dist = span_max_dist
        if effective_dist < min_eff_dist:
            min_eff_dist = effective_dist

        if ov_d.get('topDistFromLegCm') is not None and ov_d.get('botDistFromLegCm') is not None:
            top_pct = ov_d['topDistFromLegCm'] / punch_span if punch_span > 0 else 0.25
            bot_pct = ov_d['botDistFromLegCm'] / punch_span if punch_span > 0 else 0.90
        else:
            # Tilt direction: first span in multi-span is reversed (bottom near
            # left leg); all other spans are forward (bottom near right leg).
            reversed_span = num_spans > 1 and i == 0

            if not reversed_span:
                # Forward: bottom near RIGHT leg, top to the left on slope beam.
                bot_base_pos = base_span - effective_dist
                denom = sin_a + tan_pref * cos_a  # always positive
                s_top = (tan_pref * bot_base_pos - h_a) / denom
            else:
                # Reversed: bottom near LEFT leg, top to the right on slope beam.
                bot_base_pos = effective_dist
                denom = tan_pref * cos_a - sin_a
                s_top = (h_a + tan_pref * bot_base_pos) / denom if denom > 1e-9 else punch_span

            # Clamp: top must be at least effective_dist from each leg on slope beam
            s_top = max(effective_dist, min(s_top, punch_span - effective_dist))

            top_pct = s_top / punch_span if punch_span > 0 else 0.5
            bot_pct = bot_base_pos / base_span if base_span > 0 else 0.5

        # Diagonal geometry (unchanged from original formulation)
        vert = (h_a - 2 * bolt_inset) + top_pct * punch_span * sin_a
        horiz = (bot_pct - top_pct) * punch_span * cos_a
        pp_length = math.sqrt(vert ** 2 + horiz ** 2)
        length_cm = _diagonal_cut_length(pp_length, vert, horiz, beam_thick_cm)
        is_double = length_cm >= double_above_cm

        raw_diagonals.append({
            'spanIdx': i,
            'topDistFromLegCm': _r(top_pct * punch_span),
            'botDistFromLegCm': _r(bot_pct * punch_span),
            'punchSpanCm': _r(punch_span),
            'lengthCm': _r(length_cm),
            'isDouble': is_double,
            'disabled': skip,
        })

    # Safety: if all skipped, force-show rightmost not explicitly disabled.
    # Exception: when every leg is virtual (slope sits directly on the base beam,
    # e.g. angle=0), there's no structural span to brace — keep all diagonals
    # disabled.
    all_virtual = all(l.get('virtual') for l in legs)
    if not all_virtual and all(d['disabled'] for d in raw_diagonals):
        for d in reversed(raw_diagonals):
            if custom.get(str(d['spanIdx']), {}).get('disabled') is not True:
                d['disabled'] = False
                break

    effective_settings = {
        'maxDistFromLegCm': _r(min_max_dist if min_max_dist is not None else dist),
        'distFromLegCm':    _r(min_eff_dist),
        'preferredAngleDeg': effective_angle,
        'distClamped':      min_eff_dist < dist,
    }
    return [d for d in raw_diagonals if not d['disabled']], effective_settings


def _compute_block_positions(
    inner_legs: list[dict],
    block_length_cm: float,
    base_beam_length: float,
    cos_a: float,
    beam_thick_cm: float,
    back_ext_cm: float = 0.0,
    front_ext_cm: float = 0.0,
) -> list[dict]:
    """
    Compute block positions on base beam — one per leg.

    Returns list of blocks with positionCm, isEnd, slopePositionCm. Slope length
    is the same for every block in a trapezoid and derivable from
    geometry.blockLengthCm and geometry.angle, so it is not emitted per-block.

    Variation extensions (back_ext_cm / front_ext_cm) don't move the
    original outer blocks (which still mark the legs' edges of the
    un-extended core beam). Instead an additional outer block is appended
    at each extended tip — keeping the original layout untouched.
    """
    profile_half = beam_thick_cm / 2
    base_beam_core = base_beam_length - back_ext_cm - front_ext_cm

    # Special case: only 2 blocks AND they would overlap - place consecutively
    # Blocks overlap when base_beam_core < 2 * block_length_cm
    if not inner_legs and base_beam_core < 2 * block_length_cm:
        blocks = [
            {
                'positionCm': _r(back_ext_cm),
                'isEnd': True,
                'slopePositionCm': _r(_base_to_slope(back_ext_cm, profile_half, cos_a)),
            },
            {
                'positionCm': _r(back_ext_cm + block_length_cm),
                'isEnd': True,
                'slopePositionCm': _r(_base_to_slope(back_ext_cm + block_length_cm, profile_half, cos_a)),
            },
        ]
        logger.info(f'Block positioning: 2 consecutive outer blocks (overlapping case), base_beam_core={base_beam_core}, block_length={block_length_cm}')
        # Extension tip blocks (see general case below)
        if back_ext_cm > 0:
            blocks.insert(0, {'positionCm': 0.0, 'isEnd': True, 'slopePositionCm': 0.0})
        if front_ext_cm > 0:
            tip = base_beam_length - block_length_cm
            blocks.append({'positionCm': _r(tip), 'isEnd': True, 'slopePositionCm': _r(_base_to_slope(tip, profile_half, cos_a))})
        return blocks

    # General case: outer blocks at the un-extended core's edges, inner
    # blocks at leg centers. positionCm=back_ext_cm is where the original
    # rear edge sits after a back extension shifts everything forward by
    # back_ext_cm (legs are already offset upstream via leg_offset=front_ext).
    raw_blocks = []
    raw_blocks.append({'positionCm': _r(back_ext_cm), 'isEnd': True})
    for il in inner_legs:
        # Leg positions are in SLOPE coordinates (along the angled beam)
        leg_left_slope = il['positionCm']
        leg_right_slope = il['positionEndCm']
        leg_center_slope = (leg_left_slope + leg_right_slope) / 2

        # Convert leg center to BASE coordinates (punch-aware projection)
        leg_center_base = _slope_to_base(leg_center_slope, profile_half, cos_a)

        # Position block with 66% behind leg center, 34% ahead to reduce front overlap
        # Block length is in base coords, so this is consistent
        left_edge = leg_center_base - block_length_cm * 0.66
        raw_blocks.append({'positionCm': _r(left_edge), 'isEnd': False})
    raw_blocks.append({'positionCm': _r(back_ext_cm + base_beam_core - block_length_cm), 'isEnd': True})

    # Extension-tip outer blocks — one per non-zero extension. The original
    # outer blocks above keep their positions; these new blocks land at the
    # new physical end(s) of the beam. End-case overlap handling (extension
    # shorter than block_length) is deferred per spec.
    if back_ext_cm > 0:
        raw_blocks.insert(0, {'positionCm': 0.0, 'isEnd': True})
    if front_ext_cm > 0:
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
            'slopePositionCm': _r(_base_to_slope(pos, profile_half, cos_a)),
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
    # Use _slope_to_base: beam ends extend straight, cos_a only between punches.
    rear_leg_center = legs[0]['positionCm'] + profile_half if legs else leg_offset + profile_half
    front_leg_center = (legs[-1]['positionEndCm'] - profile_half) if legs else leg_offset + base_beam_length - profile_half
    rear_base = _slope_to_base(rear_leg_center, profile_half, cos_a, leg_offset)
    front_base = _slope_to_base(front_leg_center, profile_half, cos_a, leg_offset)
    punches.append({'beamType': 'base',  'positionCm': _r(rear_base), 'origin': 'outerLeg'})
    punches.append({'beamType': 'base',  'positionCm': _r(front_base), 'origin': 'outerLeg'})
    punches.append({'beamType': 'slope', 'positionCm': _r(profile_half), 'origin': 'outerLeg'})
    punches.append({'beamType': 'slope', 'positionCm': _r(top_beam_length - profile_half), 'origin': 'outerLeg'})

    # innerLeg: punch at center of profile on both beams
    for il in inner_legs:
        center = (il['positionCm'] + il['positionEndCm']) / 2
        base_pos = _slope_to_base(center, profile_half, cos_a, leg_offset)
        punches.append({'beamType': 'base',  'positionCm': _r(base_pos), 'origin': 'innerLeg'})
        # Slope beam: convert from base beam coords to slope coords
        punches.append({'beamType': 'slope', 'positionCm': _r(center - leg_offset), 'origin': 'innerLeg'})

    # rail: one punch per cross rail at its center on the slope beam
    for r in rail_items:
        rail_pos = r['globalOffsetCm'] - origin
        punches.append({'beamType': 'slope', 'positionCm': _r(rail_pos), 'origin': 'rail'})

    # diagonal: top on slope beam (slope coords), bottom on base beam (base beam coords)
    # Use punch-to-punch span (leg centers), matching _compute_diagonal_bracing
    for diag in diagonals:
        si = diag['spanIdx']
        punch_start = legs[si]['positionCm'] + profile_half
        top_pos_slope = punch_start + diag['topDistFromLegCm']
        bot_pos_slope = punch_start + diag['botDistFromLegCm']
        
        # Round final positions to integer on each beam
        top_pos = round(top_pos_slope - leg_offset)
        bot_pos = round(_slope_to_base(bot_pos_slope, profile_half, cos_a, leg_offset))

        punches.append({'beamType': 'slope', 'positionCm': top_pos, 'origin': 'diagonal'})
        punches.append({'beamType': 'base',  'positionCm': bot_pos, 'origin': 'diagonal'})

    return punches


# ── Beam splicing ──────────────────────────────────────────────────────────────
# A base or slope beam longer than the largest angle-profile stock length cannot
# be one piece: it is cut into N near-equal butt-joined pieces bridged by an
# angle-profile connector (with a bolt punch on each piece at the joint). The
# slope beam and no-block (iskurit / insulated-panel) base beams split into equal
# pieces; a concrete base snaps each interior joint to the nearest block centre so
# the splice sits over a support. Joints are nudged off any leg/diagonal punch.

# Origins a joint must not land on (a splice can't share a leg/diagonal bolt hole).
_JOINT_ORIGINS_TO_AVOID = ('outerLeg', 'innerLeg', 'diagonal')


def _nearest(values: list[float], target: float) -> float:
    return min(values, key=lambda v: abs(v - target)) if values else target


def _nudge_off_punches(joint: float, punch_positions: list[float], clearance_cm: float,
                       lo: float, hi: float) -> float:
    """If a structural punch sits within `clearance_cm` of the joint, shift the
    joint to the near edge of that punch's keep-clear zone (whichever side moves
    least), clamped to [lo, hi]. Best-effort single pass."""
    if clearance_cm <= 0:
        return joint
    conflict = next((p for p in punch_positions if abs(p - joint) < clearance_cm), None)
    if conflict is None:
        return joint
    left, right = conflict - clearance_cm, conflict + clearance_cm
    cand = left if abs(left - joint) <= abs(right - joint) else right
    return min(max(cand, lo), hi)


def _split_beam_segments(
    length_cm: float,
    stock_lengths_mm: list[int],
    *,
    blocks: list[dict] | None = None,
    block_length_cm: float = 0.0,
    avoid_positions: list[float] | None = None,
    clearance_cm: float = 0.0,
    min_piece_cm: float = 1.0,
) -> list[dict]:
    """Split a beam of `length_cm` into butt-joined pieces, each <= the largest
    stock length. Returns a single segment when no split is needed.

    Each segment: {idx, startCm, endCm, lengthCm, lengthMm, jointAtFrontCm?}
    (`jointAtFrontCm` is present on every non-final segment). Segment coordinates
    are in the beam's own rear->front frame (the same one `punches[].positionCm`
    uses), so consumers need no conversion.
    """
    max_stock_cm = max(stock_lengths_mm) / 10 if stock_lengths_mm else 0
    n = max(1, math.ceil(round(length_cm, 6) / max_stock_cm)) if max_stock_cm > 0 else 1
    if n <= 1:
        return [{'idx': 0, 'startCm': 0.0, 'endCm': _r(length_cm),
                 'lengthCm': _r(length_cm), 'lengthMm': round(length_cm * 10)}]

    # Ideal equal joints.
    joints = [length_cm * i / n for i in range(1, n)]

    # Concrete base: snap each joint to the nearest block centre (splice over a support).
    if blocks:
        centres = sorted(b['positionCm'] + block_length_cm / 2 for b in blocks)
        joints = [_nearest(centres, j) for j in joints]

    # Keep the splice clear of leg/diagonal punches.
    avoid = avoid_positions or []
    joints = [
        _nudge_off_punches(j, avoid, clearance_cm, min_piece_cm, length_cm - min_piece_cm)
        for j in joints
    ]
    joints = sorted({round(min(max(j, min_piece_cm), length_cm - min_piece_cm), 1) for j in joints})

    # Validate: every resulting piece must stay within [min_piece, max_stock].
    # If snapping/nudging broke that, fall back to pure equal division (which is
    # within stock by construction since n = ceil(length / max_stock)).
    bounds = [0.0] + joints + [length_cm]
    ok = len(joints) == n - 1 and all(
        min_piece_cm <= bounds[k + 1] - bounds[k] <= max_stock_cm + 0.05
        for k in range(len(bounds) - 1)
    )
    if not ok:
        joints = [round(length_cm * i / n, 1) for i in range(1, n)]
        bounds = [0.0] + joints + [length_cm]

    segments = []
    for i in range(len(bounds) - 1):
        start, end = bounds[i], bounds[i + 1]
        seg = {'idx': i, 'startCm': _r(start), 'endCm': _r(end),
               'lengthCm': _r(end - start), 'lengthMm': round((end - start) * 10)}
        if i < len(bounds) - 2:
            seg['jointAtFrontCm'] = _r(end)
        segments.append(seg)
    return segments


def _segment_index(segments: list[dict], pos: float) -> int:
    """Index of the piece that contains beam-coordinate `pos` (last segment whose
    start is at or before pos)."""
    for i in range(len(segments) - 1, -1, -1):
        if pos >= segments[i]['startCm'] - 0.05:
            return i
    return 0


def _tag_punch_segments(punches: list[dict], segments: list[dict], beam_type: str) -> None:
    """Set `segmentIdx` + `piecePositionCm` (position from that piece's rear end)
    on every punch of `beam_type`."""
    for p in punches:
        if p.get('beamType') != beam_type:
            continue
        pos = p.get('positionCm', 0)
        idx = _segment_index(segments, pos)
        p['segmentIdx'] = idx
        p['piecePositionCm'] = _r(pos - segments[idx]['startCm'])


def _make_joint_punches(segments: list[dict], beam_type: str, inset_cm: float) -> list[dict]:
    """Two `origin='connector'` punches per joint (one per adjoining piece),
    `inset_cm` back from the joint on each side."""
    out = []
    for i in range(len(segments) - 1):
        joint = segments[i]['endCm']
        rp, fp = joint - inset_cm, joint + inset_cm
        out.append({'beamType': beam_type, 'positionCm': _r(rp), 'origin': 'connector',
                    'segmentIdx': i, 'piecePositionCm': _r(rp - segments[i]['startCm'])})
        out.append({'beamType': beam_type, 'positionCm': _r(fp), 'origin': 'connector',
                    'segmentIdx': i + 1, 'piecePositionCm': _r(fp - segments[i + 1]['startCm'])})
    return out


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
    variation_front_ext_cm: float = 0.0,
    variation_back_ext_cm: float = 0.0,
    custom_blocks: list[dict] | None = None,
) -> dict | None:
    """
    Compute structural details for one trapezoid.

    bases_data     — output from base_service.compute_area_bases() for this trap
    line_rails     — { str(lineIdx): [offsetFromLineFrontCm, ...] }
    panel_lines    — [{ depthCm, gapBeforeCm, isEmpty, isHorizontal }]
    settings       — app_defaults dict (from app_settings table, single source of truth)
    overrides      — per-trapezoid config overrides (from trapezoidConfigs[trapId])
    global_settings — step3.globalSettings (for global-scope params like crossRailEdgeDistMm)
    variation_front_ext_cm / variation_back_ext_cm — beam extensions in
        SLOPE cm for a sub-trap variation (e.g. "A.1"). Extends the base
        beam past its front / back leg without moving the legs
        themselves. Caller passes them when computing a variation's
        ComputedTrapezoid entry; for parent traps both are 0.
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
    diag_dist_from_leg_cm    = _s(settings, ov, 'diagDistFromLegCm')
    diag_preferred_angle_deg = _s(settings, ov, 'diagPreferredAngleDeg')
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
    # Trig applies only between punch points (profile_half from each beam end).
    # The beam ends extend straight past the connection punches.
    punch_end_cm = beam_thick_cm / 2
    base_beam_core = (base_length_cm - 2 * punch_end_cm) * cos_a + 2 * punch_end_cm
    base_beam_length = base_beam_core

    # ── Iskurit / Insulated Panel: perpendicular beam extension ────────────
    # Treat missing/null orientation as 'perpendicular' — the FE dropdown displays
    # "Perpendicular" by default for iskurit/insulated_panel areas, so projects
    # where the user never explicitly toggled the dropdown still carry null in
    # their data. Mirrors base_service.is_purlin_parallel which already treats
    # null as non-parallel (== perpendicular).
    front_ext = 0.0
    rear_ext = 0.0
    if roof_type in ('iskurit', 'insulated_panel'):
        orientation = rs.get('installationOrientation') or 'perpendicular'
        purlin_dist_cm = rs.get('distanceBetweenPurlinsCm')
        if orientation == 'perpendicular' and purlin_dist_cm and purlin_dist_cm > 0:
            # purlinBufferCm is global-scope (see migration 0028) — read from
            # globalSettings, not the merged area/trap overrides in `ov`.
            buffer_cm = gs.get('purlinBufferCm', settings['purlinBufferCm'])
            extension = purlin_dist_cm + buffer_cm
            extend_front = _s(settings, ov, 'extendFront')  # label: "Extend Base Beam Rear"
            extend_rear = _s(settings, ov, 'extendRear')   # label: "Extend Base Beam Front"
            front_ext = extension if extend_front else 0
            rear_ext = extension if extend_rear else 0
            base_beam_length = base_beam_length + rear_ext + front_ext

    # Sub-trap variation extensions ("A.1" beam stretches past parent's
    # legs). These augment the iskurit-perpendicular path's ext above —
    # local var `front_ext` represents BEAM-REAR extension (legs shift
    # forward in beam-local coords; see leg_offset=front_ext below),
    # and `rear_ext` represents BEAM-FRONT extension (pure length
    # increase past the front leg). Caller-side `back` semantically
    # extends the beam REAR, `front` extends the beam FRONT — wire
    # them through to the correctly-named internal counterpart.
    if variation_front_ext_cm or variation_back_ext_cm:
        front_ext = front_ext + variation_back_ext_cm
        rear_ext = rear_ext + variation_front_ext_cm
        base_beam_length = base_beam_length + variation_front_ext_cm + variation_back_ext_cm

    sin_a = math.sin(angle_rad)
    tan_a = math.tan(angle_rad)
    slope_offset = rail_offset_cm - base_overhang_cm + cross_rail_cm * tan_a

    # Only concrete uses blocks; all other roof types treat block height as zero.
    effective_block_height = block_height_cm if roof_type == 'concrete' else 0.0

    height_rear = front_height_cm - effective_block_height + slope_offset * sin_a - cross_rail_cm / cos_a

    base_length_horiz = base_beam_core  # original (without extension) for leg placement
    # Height rise only across punch-to-punch horizontal distance (beam ends are straight)
    height_front = height_rear + (base_length_horiz - beam_thick_cm) * math.tan(angle_rad)

    # Short front leg: rear (first, index-0) leg below machine minimum → clamp to beam profile height.
    # Shift panel down so height_rear == beam_thick_cm, keeping angle unchanged.
    short_front_leg = False
    if height_rear < skip_below_cm:
        short_front_leg = True
        shift = height_rear - beam_thick_cm
        front_height_cm = front_height_cm - shift
        height_front = height_front - shift
        height_rear = beam_thick_cm

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

    # Base-beam extension variants. Index 0 is the trap's BE-default extension;
    # indices 1..N are user-created variations appended by step3 extend ops.
    # Bases identify their variation via Base.trapezoidId ("A1" → idx 0,
    # "A1.N" → idx N). See TrapExtension docstring in schemas/project_data.py.
    # This is the canonical home for front/back extension data — no separate
    # geometry["frontExtensionCm"] / ["rearExtensionCm"] keys; consumers
    # read extensions[idx].
    #
    # User-facing semantics: `frontExtMm` always means "beam-FRONT extension"
    # (extends past the front leg — drawing-RIGHT in the trap detail view);
    # `backExtMm` means "beam-REAR extension" (extends past leg 0 — drawing-
    # LEFT). The internal local vars are swapped from this naming
    # (`front_ext` = beam-rear shift via leg_offset; `rear_ext` = beam-front
    # length increase past the front leg — see comment above), so map them
    # explicitly here. Variation persistence (projects.py) already stores
    # user-facing values, so consumers can rely on one consistent convention.
    geometry['extensions'] = [{
        'frontExtMm': _r(rear_ext * 10),
        'backExtMm':  _r(front_ext * 10),
    }]

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
    diagonals, effective_diag_settings = _compute_diagonal_bracing(
        legs, custom_diagonals, diag_dist_from_leg_cm, diag_preferred_angle_deg,
        skip_below_cm, double_above_cm, angle_rad, beam_thick_cm,
    )

    # ── Blocks ─────────────────────────────────────────────────────────────
    # Iskurit/insulated panel: no blocks (attached to purlins with screws)
    if roof_type in ('iskurit', 'insulated_panel'):
        blocks = []
    elif custom_blocks:
        # User has overridden block positions for this trap. Use them verbatim;
        # re-derive slopePositionCm from positionCm. `isEnd` is preserved as
        # provided — structural-block invariants are enforced FE-side.
        profile_half = beam_thick_cm / 2
        blocks = sorted(
            (
                {
                    'positionCm': _r(float(b['positionCm'])),
                    'isEnd': bool(b.get('isEnd', False)),
                    'slopePositionCm': _r(_base_to_slope(float(b['positionCm']), profile_half, cos_a)),
                }
                for b in custom_blocks
            ),
            key=lambda b: b['positionCm'],
        )
    else:
        # Pass extensions through so an extra outer block lands at each
        # extended tip while the original outer blocks stay anchored to the
        # un-extended core. Internal `front_ext` is the caller's BACK
        # extension (beam-rear) and `rear_ext` is the caller's FRONT
        # extension (beam-front) — see the variant-wiring comment above.
        blocks = _compute_block_positions(
            inner_legs, block_length_cm, base_beam_length, cos_a, beam_thick_cm,
            back_ext_cm=front_ext,
            front_ext_cm=rear_ext,
        )

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
            back_ext_cm=front_ext,
            front_ext_cm=rear_ext,
        )
        punches += block_punches

    # Add reversedPositionCm (distance from beam end) to qualifying punches
    for p in punches:
        if p['beamType'] == 'base' and p['origin'] == 'block':
            p['reversedPositionCm'], p['positionCm'] = _block_punch_reversed(base_beam_length, p['positionCm'])
        elif p['beamType'] == 'slope' and p['origin'] != 'rail':
            p['reversedPositionCm'] = _r(top_beam_length - p['positionCm'])

    # ── Beam splicing: split beams longer than the largest angle-profile stock ──
    # Runs last, on the finalised beam lengths / punches. Un-split beams are left
    # untouched (no segments, no segmentIdx) so existing data/consumers are
    # unchanged; a split beam gains geometry.*BeamSegments, per-punch segmentIdx /
    # piecePositionCm, and two origin='connector' joint punches per joint.
    stock_lengths_mm = settings.get('angleProfileStockLengths') or []
    if stock_lengths_mm and max(stock_lengths_mm) > 0:
        connector_inset_cm = settings.get('connectorPunchInsetCm', 3)
        base_avoid = [p['positionCm'] for p in punches
                      if p['beamType'] == 'base' and p['origin'] in _JOINT_ORIGINS_TO_AVOID]
        slope_avoid = [p['positionCm'] for p in punches
                       if p['beamType'] == 'slope' and p['origin'] in _JOINT_ORIGINS_TO_AVOID]
        base_segments = _split_beam_segments(
            base_beam_length, stock_lengths_mm,
            blocks=blocks, block_length_cm=block_length_cm,
            avoid_positions=base_avoid, clearance_cm=punch_overlap_margin,
        )
        slope_segments = _split_beam_segments(
            top_beam_length, stock_lengths_mm,
            avoid_positions=slope_avoid, clearance_cm=punch_overlap_margin,
        )
        if len(base_segments) > 1:
            _tag_punch_segments(punches, base_segments, 'base')
            punches += _make_joint_punches(base_segments, 'base', connector_inset_cm)
            geometry['baseBeamSegments'] = base_segments
            geometry['baseBeamConnectorCount'] = len(base_segments) - 1
        if len(slope_segments) > 1:
            _tag_punch_segments(punches, slope_segments, 'slope')
            slope_joints = _make_joint_punches(slope_segments, 'slope', connector_inset_cm)
            for jp in slope_joints:  # parity with other slope punches (line ~748)
                jp['reversedPositionCm'] = _r(top_beam_length - jp['positionCm'])
            punches += slope_joints
            geometry['topBeamSegments'] = slope_segments
            geometry['topBeamConnectorCount'] = len(slope_segments) - 1

    bases_effective = (bases_data or {}).get('effectiveBasesSettings')

    return {
        'geometry': geometry,
        'legs': legs,
        'blocks': blocks,
        'punches': punches,
        'diagonals': diagonals,
        'effectiveDiagSettings': effective_diag_settings,
        'effectiveDetailSettings': {
            'shortFrontLeg': short_front_leg,
        },
        'effectiveBasesSettings': bases_effective,
        'diagSettings': {
            'distFromLegCm': diag_dist_from_leg_cm,
            'preferredAngleDeg': diag_preferred_angle_deg,
            'skipBelowCm': skip_below_cm,
            'doubleAboveCm': double_above_cm,
        },
    }


def align_blocks(
    trap_details: dict[str, dict],
    pinned_trap_ids: set[str] | None = None,
) -> None:
    """
    Align block positions across all trapezoids in the same area.

    All trapezoids share the same physical base beams, so block depth positions
    must be consistent. We collect all block positions (in global panel coords),
    merge into a unified set, then redistribute to each trapezoid — keeping only
    positions that fall within that trapezoid's beam span.

    Pinned trap ids (traps with user-provided customBlocks) contribute their
    positions to the merge but are NOT redistributed — their block list is
    left untouched so the user's edits survive verbatim.

    Modifies trap_details in place (updates blocks and punches).
    """
    if len(trap_details) < 2:
        return

    pinned = pinned_trap_ids or set()

    # Collect all block positions in global base-beam coords
    global_positions: set[float] = set()
    for tid, detail in trap_details.items():
        geom = detail.get('geometry', {})
        origin = geom.get('originCm', 0)
        angle_deg = geom.get('angle', 0)
        cos_a = math.cos(angle_deg * math.pi / 180) if angle_deg else 1
        ph = geom.get('beamThickCm', 4) / 2
        origin_base = _slope_to_base(origin, ph, cos_a)
        for blk in detail.get('blocks', []):
            global_positions.add(_r(blk['positionCm'] + origin_base))

    sorted_globals = sorted(global_positions)

    # Redistribute blocks to each trapezoid
    for tid, detail in trap_details.items():
        # Pinned traps keep their user-supplied blocks; skip redistribution.
        if tid in pinned:
            continue
        geom = detail.get('geometry', {})
        origin = geom.get('originCm', 0)
        block_length = geom.get('blockLengthCm', 50)
        angle_deg = geom.get('angle', 0)
        cos_a = math.cos(angle_deg * math.pi / 180) if angle_deg else 1
        ph = geom.get('beamThickCm', 4) / 2
        origin_base = _slope_to_base(origin, ph, cos_a)
        base_beam_len = geom.get('baseBeamLength', 0)

        # Convert global base-beam positions to local, keep within [0, baseBeamLen]
        local_positions = []
        for gp in sorted_globals:
            lp = _r(gp - origin_base)
            if -0.1 <= lp <= base_beam_len + 0.1:
                local_positions.append(lp)

        # Remove overlaps + add slope projection
        blocks = []
        for lp in local_positions:
            if blocks and lp < blocks[-1]['positionCm'] + block_length - 0.1:
                continue
            blocks.append({
                'positionCm': lp,
                'isEnd': False,
                'slopePositionCm': _r(_base_to_slope(lp, ph, cos_a)),
            })
        # First and last blocks are outer — reposition to align with beam ends
        if blocks:
            blocks[0]['isEnd'] = True
            blocks[0]['positionCm'] = 0.0
            blocks[0]['slopePositionCm'] = 0.0
            blocks[-1]['isEnd'] = True
            blocks[-1]['positionCm'] = _r(base_beam_len - block_length)
            blocks[-1]['slopePositionCm'] = _r(_base_to_slope(base_beam_len - block_length, ph, cos_a))

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
        for p in new_block_punches:
            p['reversedPositionCm'], p['positionCm'] = _block_punch_reversed(base_beam_len, p['positionCm'])
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
    back_ext_cm: float = 0.0,
    front_ext_cm: float = 0.0,
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
    profile_half = profile_step_cm / 2
    # Un-extended core spans [back_ext_cm, back_ext_cm + base_beam_core].
    # Outer legs sit at the core's edges (the BE applies leg_offset=back_ext
    # upstream). Extension-tip blocks land beyond those legs and have no
    # adjacent leg to anchor a punch to — their punch sits inside the block
    # at block_punch_cm from the beam's outer edge.
    base_beam_core = base_beam_length - back_ext_cm - front_ext_cm
    core_front_edge = back_ext_cm + base_beam_core
    core_pivot = back_ext_cm + base_beam_core / 2
    for bi, block in enumerate(blocks):
        pos = block['positionCm']          # base beam coords
        block_end = pos + block_length_cm  # base beam coords

        if block['isEnd']:
            is_rear_tip  = back_ext_cm > 0  and pos < back_ext_cm - 0.5
            is_front_tip = front_ext_cm > 0 and pos > core_front_edge - block_length_cm + 0.5
            # All isEnd punches are anchored to the BLOCK so that user-moved
            # structural blocks (block CRUD edit mode) carry their punch with
            # them. When a structural block overhangs the beam (FE allows up
            # to ~blockLengthCm - (2*beamThickCm + blockPunchCm) of overhang),
            # the punch is clamped to the BEAM edge so it never lands outside
            # the physical beam. At default position these expressions yield
            # the same result as the previous leg/beam-edge anchored formulas.
            #
            # Anchor points (block-edge clamped to beam):
            #   rear tip      anchor_pos = max(0, pos)
            #   rear outer    anchor_pos = max(0, pos), + profile_step_cm
            #   front tip     anchor_end = min(beamLen, block_end)
            #   front outer   anchor_end = min(beamLen, block_end), - profile_step_cm
            anchor_pos = max(0.0, pos)
            anchor_end = min(base_beam_length, block_end)
            if is_rear_tip:
                # Tip block sits past the rear leg — no leg foot to step over.
                punch_pos = anchor_pos + block_punch_cm
                while has_overlap(punch_pos, other_base_positions) and punch_pos < block_end:
                    punch_pos = _r(punch_pos + profile_step_cm)
            elif is_front_tip:
                # Tip block sits past the front leg — no leg foot to step over.
                punch_pos = anchor_end - block_punch_cm
                while has_overlap(punch_pos, other_base_positions) and punch_pos > pos:
                    punch_pos = _r(punch_pos - profile_step_cm)
            elif pos < core_pivot:
                # Rear outer block — leaves room for the rear leg foot
                # (profile_step_cm) at the block's rear edge.
                punch_pos = anchor_pos + profile_step_cm + block_punch_cm
                while has_overlap(punch_pos, other_base_positions) and punch_pos < block_end:
                    punch_pos = _r(punch_pos + profile_step_cm)
            else:
                # Front outer block — leaves room for the front leg foot
                # (profile_step_cm) at the block's front edge.
                punch_pos = anchor_end - profile_step_cm - block_punch_cm
                while has_overlap(punch_pos, other_base_positions) and punch_pos > pos:
                    punch_pos = _r(punch_pos - profile_step_cm)
            check_lo, check_hi = pos - 0.1, block_end + 0.1
        else:
            # Inner block: find the inner leg whose center falls within this
            # block's base-coord span. We can't use leg_idx = bi - 1 because
            # overlap removal may have dropped some inner blocks, breaking the
            # 1:1 mapping (e.g. 2 inner legs but only 1 inner block fits).
            target_leg = None
            for leg in inner_legs:
                leg_center_slope = (leg['positionCm'] + leg['positionEndCm']) / 2
                leg_center_base = _slope_to_base(leg_center_slope, profile_half, cos_a)
                if pos <= leg_center_base <= block_end:
                    target_leg = leg
                    break

            if target_leg is None:
                # Block has been moved so no inner leg falls inside its span
                # (block CRUD edit mode). Use the same configurable offset as
                # an isEnd block's rear-outer punch — `block_punch_cm` past
                # the block's rear edge, allowing for one leg-foot profile.
                # Skip overlapping positions toward the block end.
                punch_pos = pos + profile_step_cm + block_punch_cm
                while has_overlap(punch_pos, other_base_positions) and punch_pos < block_end:
                    punch_pos = _r(punch_pos + profile_step_cm)
                check_lo, check_hi = pos - 0.1, block_end + 0.1
            else:
                # Get leg position from inner_legs (in SLOPE coords)
                leg_left_slope = target_leg['positionCm']
                leg_right_slope = target_leg['positionEndCm']

                # Convert leg positions to BASE coords (punch-aware projection)
                leg_left_base = _r(_slope_to_base(leg_left_slope, profile_half, cos_a))
                leg_right_base = _r(_slope_to_base(leg_right_slope, profile_half, cos_a))

                # Block range already in base coords
                base_lo = pos
                base_hi = block_end

                # Block is positioned 66% behind leg, 34% ahead of leg
                # 34% section = ahead of leg (right side, toward higher/front leg)
                # 66% section = behind leg (left side, toward lower/rear leg)

                punch_pos = None

                # FIRST TRY: 34% section (ahead of leg, toward higher leg)
                # Start at leg right wall + block_punch_cm, travel RIGHT
                start_right = _r(leg_right_base + block_punch_cm)
                candidate = start_right
                while candidate <= base_hi:
                    if not has_overlap(candidate, other_base_positions):
                        punch_pos = candidate
                        break
                    candidate += 1

                # SECOND TRY: 66% section (behind leg, toward lower leg)
                # Start at leg left wall - block_punch_cm, travel LEFT
                if punch_pos is None:
                    start_left = _r(leg_left_base - block_punch_cm)
                    candidate = start_left
                    while candidate >= base_lo:
                        if not has_overlap(candidate, other_base_positions):
                            punch_pos = candidate
                            break
                        candidate -= 1

                # Fallback if still no valid position (should be rare)
                if punch_pos is None:
                    punch_pos = _r((base_lo + base_hi) / 2)

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
            'positionCm': _r(punch_pos),
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
    custom_blocks: list[dict] | None = None,
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
    beam_thick = detail.get('geometry', {}).get('beamThickCm', 4)
    # Same formula as base_beam_core: trig only between punch points, beam ends straight
    base_len = beam_thick + (slope_len - beam_thick) * cos_a
    geom = detail['geometry']

    # Update geometry
    geom['originCm'] = _r(full_origin + rear_pos)
    geom['heightRear'] = filtered_legs[0]['heightCm']
    geom['heightFront'] = filtered_legs[-1]['heightCm']
    geom['topBeamLength'] = _r(slope_len)
    geom['baseBeamLength'] = _r(base_len)
    geom['baseLength'] = _r(base_len)

    # First-pass `compute_trapezoid_details` skips empty (EV / EH) lines when
    # building panel_lines, so the trap's `total_panel_depth` only covers the
    # active lines — meaning `panelRearHeightCm = panelFrontHeight + active *
    # sin(angle)` already, before we shift anything.
    #
    # When the sub-trap is preceded by empty lines (first line empty), its
    # physical front edge sits at the row's slope position past those empty
    # lines. We need to shift BOTH `panelFrontHeight` AND `panelRearHeightCm`
    # up by the same delta so the active panel depth is preserved.
    #
    # When the sub-trap is followed by empty lines (last line empty), the
    # first-pass values already represent only the active portion — no
    # adjustment needed on either height.
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
        delta = skipped_depth * sin_a
        geom['panelFrontHeight'] = _r(geom.get('panelFrontHeight', 0) + delta)
        geom['panelRearHeightCm'] = _r(geom.get('panelRearHeightCm', 0) + delta)

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
    profile_half = geom['beamThickCm'] / 2
    if has_blocks:
        block_length_cm = geom['blockLengthCm']
        if custom_blocks:
            # User has overridden block positions for this trimmed trap.
            # Use them verbatim (FE writes positionCm in trimmed coords) and
            # re-derive slopePositionCm for the trimmed base length.
            detail['blocks'] = sorted(
                (
                    {
                        'positionCm': _r(float(b['positionCm'])),
                        'isEnd': bool(b.get('isEnd', False)),
                        'slopePositionCm': _r(_base_to_slope(float(b['positionCm']), profile_half, cos_a)),
                    }
                    for b in custom_blocks
                ),
                key=lambda b: b['positionCm'],
            )
        else:
            # Blocks: regenerate in base-beam coords (same rules as service)
            raw_blocks = []
            raw_blocks.append({'positionCm': 0.0, 'isEnd': True})
            for leg in filtered_legs[1:-1]:
                rail_pos = leg.get('railPositionCm', leg['positionCm'])
                rail_base = _slope_to_base(rail_pos, profile_half, cos_a)
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
                    'slopePositionCm': _r(_base_to_slope(pos, profile_half, cos_a)),
                })
            detail['blocks'] = new_blocks
    else:
        detail['blocks'] = []

    # Punches: filter from full trap, rebase, regenerate outer+inner+block
    base_shift = _slope_to_base(rear_pos, profile_half, cos_a) - profile_half
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
    new_punches.append({'beamType': 'base',  'positionCm': _r(_slope_to_base(rear_leg_center, profile_half, cos_a)), 'origin': 'outerLeg'})
    new_punches.append({'beamType': 'base',  'positionCm': _r(_slope_to_base(front_leg_center, profile_half, cos_a)), 'origin': 'outerLeg'})
    new_punches.append({'beamType': 'slope', 'positionCm': _r(profile_half), 'origin': 'outerLeg',
                        'reversedPositionCm': _r(slope_len - profile_half)})
    new_punches.append({'beamType': 'slope', 'positionCm': _r(slope_len - profile_half), 'origin': 'outerLeg',
                        'reversedPositionCm': _r(profile_half)})
    # Fresh innerLeg punches from actual trimmed inner legs
    for il in filtered_legs[1:-1]:
        center = (il['positionCm'] + il['positionEndCm']) / 2
        new_punches.append({'beamType': 'base',  'positionCm': _r(_slope_to_base(center, profile_half, cos_a)), 'origin': 'innerLeg'})
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
            bp['reversedPositionCm'], bp['positionCm'] = _block_punch_reversed(base_len, bp['positionCm'])
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

    # Fallback: trim trap has legs but inherited no diagonals from the full trap
    # (e.g. full trap's diagonal was at a different span). Re-run the bracing
    # computation using only this trim trap's legs so at least one diagonal appears.
    if not new_diags and len(filtered_legs) >= 2:
        ds = full_trap_detail.get('diagSettings', {})
        new_diags, _ = _compute_diagonal_bracing(
            detail['legs'],
            None,
            ds.get('distFromLegCm', 10),
            ds.get('preferredAngleDeg', 45),
            ds.get('skipBelowCm', 8),
            ds.get('doubleAboveCm', 200),
            angle * math.pi / 180,
            beam_thick,
        )

    detail['diagonals'] = new_diags

    return detail


# ── Trapezoid comparison ─────────────────────────────────────────────────────

# 0.05 cm = half the 0.1-cm step used by round_to_1dp(). Tight enough to catch
# real differences, loose enough to absorb FP noise across independent computes
# that round to the same physical value.
_TRAP_EQ_TOL_CM = 0.05


def _close(a: float, b: float, tol: float = _TRAP_EQ_TOL_CM) -> bool:
    return abs(a - b) <= tol


def _value_equal(a, b) -> bool:
    """Deep value equality with float tolerance and recursion into dicts/lists."""
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, dict) and isinstance(b, dict):
        return _dict_equal(a, b)
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return False
        return all(_value_equal(x, y) for x, y in zip(a, b))
    if isinstance(a, bool) or isinstance(b, bool):
        return a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return _close(float(a), float(b))
    return a == b


def _dict_equal(a: dict, b: dict) -> bool:
    keys = set(a.keys()) | set(b.keys())
    return all(_value_equal(a.get(k), b.get(k)) for k in keys)


def computed_trapezoids_equal(a: dict, b: dict) -> bool:
    """
    Return True if two ComputedTrapezoid dicts describe the same materialized
    trapezoid shape.

    Compares only fields that define the physical shape:
      geometry, isFullTrap, legs, blocks, diagonals.

    Excluded:
      - trapezoidId, panelRowIdx — context, not shape
      - punches — derived from legs/blocks/diagonals/geometry; if those match,
        punches match too
      - diagSettings, effective* — input echoes / resolved config, already
        reflected in the structural fields above

    Numeric values match within 0.05 cm. Geometry is compared first — most
    non-matching traps differ in angle / heights / beam lengths and fail there.
    """
    if not _dict_equal(a.get('geometry', {}), b.get('geometry', {})):
        return False
    if a.get('isFullTrap', True) != b.get('isFullTrap', True):
        return False
    if not _value_equal(a.get('legs', []), b.get('legs', [])):
        return False
    if not _value_equal(a.get('blocks', []), b.get('blocks', [])):
        return False
    if not _value_equal(a.get('diagonals', []), b.get('diagonals', [])):
        return False
    return True


def group_identical_trapezoids(computed_trapezoids: list[dict]) -> list[dict]:
    """
    Partition computedTrapezoids by materialized shape.

    Returns a list of groups, one per distinct shape:
        [{'groupIdx': 0, 'trapIds': ['A', 'B']}, {'groupIdx': 1, 'trapIds': ['C']}]

    Singleton traps get their own group. `trapIds` within each group are sorted;
    groups are ordered by their first trapId so the output is stable across
    recomputes (useful for the PDF generator to show one page per group).
    """
    groups: list[list[dict]] = []
    for trap in computed_trapezoids:
        for grp in groups:
            if computed_trapezoids_equal(trap, grp[0]):
                grp.append(trap)
                break
        else:
            groups.append([trap])

    sorted_ids = sorted(
        (sorted(t['trapezoidId'] for t in grp) for grp in groups),
        key=lambda ids: ids[0],
    )
    return [{'groupIdx': i, 'trapIds': ids} for i, ids in enumerate(sorted_ids)]
