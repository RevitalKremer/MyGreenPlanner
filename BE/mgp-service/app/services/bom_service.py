"""
BOM (Bill of Materials) computation service.
Ported from FE/src/utils/constructionCalculator.js — buildBOM().

All inputs are read from already-computed and persisted project data:
- step2.areas[].rails, bases, panelGrid  (computed in step 3)
- step3.trapezoidDetails[trapId].geometry (computed in step 3)
"""
import hashlib
import json
import math
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.bom import ProjectBOM
from app.models.product import Product
from app.services.settings_cache import get_setting
from app.utils.panel_geometry import REAL_PANELS


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

def _count_panels(panel_grid: dict) -> int:
    """Count real panels (V/H) in a panel grid, excluding ghosts (EV/EH)."""
    total = 0
    for row in (panel_grid.get('rows') or []):
        for cell in row:
            if cell in REAL_PANELS:
                total += 1
    return total


def _count_lines(panel_grid: dict) -> int:
    """Number of panel lines (rows in the grid)."""
    return len(panel_grid.get('rows') or [])


def _get_area_field(area: dict, key: str, default=None):
    """
    Get a field from an area dict, handling both flat and nested formats.
    DB stores areas with flat fields (label, trapezoidIds directly on area),
    but the Pydantic schema nests them under 'settings'.
    """
    # Try flat first (actual DB format)
    val = area.get(key)
    if val is not None:
        return val
    # Try nested under 'settings' (Pydantic schema format)
    settings = area.get('settings')
    if isinstance(settings, dict):
        val = settings.get(key)
        if val is not None:
            return val
    return default


def _flatten_row_dict(d: dict | list) -> list:
    """Flatten a dict[rowIndex → list] or legacy list into a single list."""
    if isinstance(d, list):
        return d
    items = []
    for v in d.values():
        if isinstance(v, list):
            items.extend(v)
    return items


def _derive_row_construction(
    area: dict,
    computed_area: dict | None,
    computed_trapezoids: list[dict],
    roof_type: str = 'concrete',
) -> dict | None:
    """
    Derive per-area row-construction data from step2 area + step3 computed data.
    Aggregates across all panel rows in the area.
    Returns dict with keys matching FE rowConstructions, or None if data is incomplete.
    """
    if not computed_area:
        return None

    # Aggregate panel counts across all panel rows
    panel_rows = area.get('panelRows', [])
    if not panel_rows:
        # Legacy fallback
        pg = area.get('panelGrid')
        panel_rows = [{'rowIndex': 0, 'panelGrid': pg}] if pg else []

    total_panel_count = 0
    max_num_lines = 0
    # Per-row breakdowns used for panel-clamp counting. Aggregating rails +
    # panels at the area level loses the per-row × per-line structure (mixed
    # row shapes and varying line counts), so the clamp formulas need the
    # raw per-row data:
    #   inter_panel_positions = Σ over (row, line) of (real_panels − 1) × rails_on_that_line
    #   grounding_panel_count  = Σ over rows of ⌈real_panels_in_row / 2⌉
    rails_by_row = computed_area.get('rails') or {}
    inter_panel_positions = 0
    grounding_panel_count = 0
    for pr in panel_rows:
        # Skip None entries — panelRows can be sparse when a row's rowIndex
        # is not 0-based (e.g. single-row area with rowIndex=2).
        if pr is None:
            continue
        pg = pr.get('panelGrid') or {}
        total_panel_count += _count_panels(pg)
        nl = _count_lines(pg)
        if nl > max_num_lines:
            max_num_lines = nl

        row_idx = pr.get('rowIndex', 0)
        row_rails = rails_by_row.get(row_idx) or rails_by_row.get(str(row_idx)) or []
        rails_on_line: dict[int, int] = {}
        for r in row_rails:
            li = r.get('lineIdx', 0)
            rails_on_line[li] = rails_on_line.get(li, 0) + 1

        row_real_panels = 0
        for line_idx, cells in enumerate(pg.get('rows') or []):
            real = sum(1 for c in cells if c in REAL_PANELS)
            row_real_panels += real
            if real > 1:
                inter_panel_positions += (real - 1) * rails_on_line.get(line_idx, 0)
        if row_real_panels > 0:
            grounding_panel_count += math.ceil(row_real_panels / 2)
    if max_num_lines == 0:
        max_num_lines = 1

    # Flatten rails and bases across all panel rows
    all_rails = _flatten_row_dict(computed_area.get('rails') or {})
    all_bases = _flatten_row_dict(computed_area.get('bases') or {})
    trap_ids = _get_area_field(area, 'trapezoidIds') or []

    # Tiles roofs have no frame/trapezoids by design — they still need rails,
    # clamps and hooks, so don't bail on missing trap_ids in that case.
    if roof_type != 'tiles' and not trap_ids:
        return None

    # Rails (needed for all roof types)
    num_rails = len(all_rails)
    num_rail_connectors = 0
    for r in all_rails:
        segs = r.get('stockSegmentsMm') or []
        if len(segs) > 1:
            num_rail_connectors += len(segs) - 1
    row_length = 0
    if all_rails:
        row_length = max(r.get('lengthCm', 0) for r in all_rails)
    # Stock-piece cut list for the rail BOM. A finished rail like 7.15 m is
    # built from two stock cuts (e.g. 6.00 m + 1.15 m), and the BOM lists the
    # raw cuts to order — not the finished length. Fall back to lengthCm only
    # if stockSegmentsMm is absent (older computed data).
    rail_pieces: list[dict] = []
    for r in all_rails:
        segs = r.get('stockSegmentsMm') or []
        if segs:
            for seg_mm in segs:
                if seg_mm > 0:
                    rail_pieces.append({'qty': 1, 'lenCm': seg_mm / 10})
        else:
            ln = r.get('lengthCm', 0)
            if ln > 0:
                rail_pieces.append({'qty': 1, 'lenCm': ln})
    num_large_gaps = computed_area.get('numLargeGaps', 0)

    # Tiles: no frame geometry needed — only rails + clamps + hooks.
    # Hook count is the total number of rail × virtual-base intersections
    # computed by base_service.fill_hook_offsets and stored on each base.
    if roof_type == 'tiles':
        num_hooks = sum(len(b.get('hookOffsets') or []) for b in all_bases)
        return {
            'rowLength': row_length,
            'angle': 0, 'frontHeight': 0, 'heightRear': 0, 'heightFront': 0,
            'baseLength': 0, 'baseBeamLength': 0, 'topBeamLength': 0,
            'numTrapezoids': 0,
            'panelCount': total_panel_count,
            'numRails': num_rails,
            'numLines': max_num_lines,
            'numLargeGaps': num_large_gaps,
            'numRailConnectors': num_rail_connectors,
            'railPieces': rail_pieces,
            'numHooks': num_hooks,
            'interPanelClampPositions': inter_panel_positions,
            'groundingPanelCount': grounding_panel_count,
        }

    # Find geometry from first trapezoid's computed detail
    first_trap_id = trap_ids[0]
    detail = None
    for ct in computed_trapezoids:
        if ct.get('trapezoidId') == first_trap_id:
            detail = ct
            break
    geom = (detail or {}).get('geometry') or {}

    if not geom:
        return None

    # numTrapezoids: count unique base positions across all rows
    unique_base_positions = set()
    for b in all_bases:
        unique_base_positions.add(round(b.get('offsetFromStartCm', 0), 2))
    num_trapezoids = len(unique_base_positions) if unique_base_positions else 1

    # Internal trapezoid diagonals (between legs within a single frame).
    # Aggregate across every trap that belongs to this area.
    trap_id_set = set(trap_ids)
    internal_diagonals: list[dict] = []
    for ct in computed_trapezoids:
        if ct.get('trapezoidId') in trap_id_set:
            internal_diagonals.extend(ct.get('diagonals') or [])

    # External diagonals (between adjacent bases) live on the area itself.
    external_diagonals = computed_area.get('diagonals') or []

    # Per-trap material summary: one entry per trapezoidId in this area, with
    # the total angle-profile material a single instance of that trap consumes
    # (beams + every leg's actual height + internal diagonals, doubled where
    # `isDouble`). Multiplied by `count` (instances in this area) at render
    # time. Used to render a `── Trapezoids ──` BOM section grouped by trap ID.
    trap_instance_counts: dict[str, int] = {}
    for b in all_bases:
        tid = b.get('trapezoidId')
        if tid:
            trap_instance_counts[tid] = trap_instance_counts.get(tid, 0) + 1
    ct_by_id = {ct.get('trapezoidId'): ct for ct in computed_trapezoids}
    trap_types: list[dict] = []
    # Each trapezoid instance sits on one block per leg. Sum across instances
    # so multi-row areas with mixed trap shapes get the right total — the
    # area-aggregate `(numRails − 2 + 2) × numTrapezoids` shortcut over-counts
    # by treating every base as if it had the row-summed rail count.
    #
    # Also count punches per origin so the bolt BOM can match the rule
    #   block punches  → single_arrow_anchor_bolt + m12_nut + m12_washer
    #   other punches  → hex_head_bolt_m8x20 + flange_nut_m8_stainless_steel
    # (one screw per punch).
    num_blocks = 0
    num_block_punches = 0
    num_other_punches = 0
    for tid, count in trap_instance_counts.items():
        ct = ct_by_id.get(tid)
        if not ct or count <= 0:
            continue
        t_geom = ct.get('geometry') or {}
        t_legs = ct.get('legs') or []
        t_diags = ct.get('diagonals') or []
        t_punches = ct.get('punches') or []
        num_blocks += count * len(t_legs)
        block_p = sum(1 for p in t_punches if p.get('origin') == 'block')
        num_block_punches += count * block_p
        num_other_punches += count * (len(t_punches) - block_p)
        cm = (t_geom.get('baseBeamLength') or t_geom.get('baseLength') or 0)
        cm += t_geom.get('topBeamLength') or 0
        for leg in t_legs:
            cm += leg.get('heightCm', 0) or 0
        for d in t_diags:
            if d.get('disabled'):
                continue
            mult = 2 if d.get('isDouble') else 1
            cm += (d.get('lengthCm', 0) or 0) * mult
        if cm > 0:
            trap_types.append({
                'trapId': tid,
                'count': count,
                'materialM': round(cm / 100, 2),
            })

    return {
        'rowLength': row_length,
        'angle': geom.get('angle', 0),
        'frontHeight': geom.get('frontHeight', 0),
        'heightRear': geom.get('heightRear', 0),
        'heightFront': geom.get('heightFront', 0),
        'baseLength': geom.get('baseLength', 0),
        'baseBeamLength': geom.get('baseBeamLength', 0),
        'topBeamLength': geom.get('topBeamLength', 0),
        'numTrapezoids': num_trapezoids,
        'panelCount': total_panel_count,
        'numRails': num_rails,
        'numLines': max_num_lines,
        'numLargeGaps': num_large_gaps,
        'numRailConnectors': num_rail_connectors,
        'railPieces': rail_pieces,
        'internalDiagonals': internal_diagonals,
        'externalDiagonals': external_diagonals,
        'trapTypes': trap_types,
        'interPanelClampPositions': inter_panel_positions,
        'groundingPanelCount': grounding_panel_count,
        'numBlocks': num_blocks,
        'numBlockPunches': num_block_punches,
        'numOtherPunches': num_other_punches,
    }


def _group_pieces_by_length(pieces: list[dict], area_label: str, element: str) -> list[dict]:
    """Group raw {qty, lenCm} pieces into one BOM row per distinct length.

    Lengths are rounded to the nearest cm for grouping, so near-equal pieces
    merge cleanly. Rows are emitted sorted longest-first (most useful as a
    cutting list).
    """
    if not pieces:
        return []
    grouped: dict[int, int] = {}
    for p in pieces:
        key_cm = round(p['lenCm'])
        if key_cm <= 0:
            continue
        grouped[key_cm] = grouped.get(key_cm, 0) + p['qty']
    rows = []
    for length_cm in sorted(grouped.keys(), reverse=True):
        qty = grouped[length_cm]
        if qty <= 0:
            continue
        piece_length_m = length_cm / 100
        rows.append({
            'areaLabel': area_label,
            'element': element,
            'pieceLengthM': piece_length_m,
            'totalLengthM': round(piece_length_m * qty, 2),
            'qty': qty,
        })
    return rows


def _compute_trapezoid_bom(rc: dict, _area_label: str, products_by_type: dict) -> list[dict]:
    """One BOM row per distinct trapezoid type (e.g. B1, B2, B3, J).

    Each row describes the angle-profile material a single trapezoid frame
    consumes (beams + every leg + internal diagonals, doubled where
    `isDouble`); `qty` is how many instances of that trap type exist in the
    area. Trap ID goes into the area column so the user can see which trap
    is which at a glance. Section `trapezoids` keeps these grouped under one
    header in the BOM table.
    """
    element = _alt_group_default(products_by_type, _ANGLE_PROFILE_ANCHOR)
    rows: list[dict] = []
    for tt in rc.get('trapTypes') or []:
        material_m = tt.get('materialM', 0)
        count = tt.get('count', 0)
        if material_m <= 0 or count <= 0:
            continue
        rows.append({
            'areaLabel': tt.get('trapId', '?'),
            'element': element,
            'section': 'trapezoids',
            'pieceLengthM': material_m,
            'totalLengthM': round(material_m * count, 2),
            'qty': count,
        })
    return rows


def _compute_external_diagonal_bom(rc: dict, area_label: str, products_by_type: dict) -> list[dict]:
    """One BOM row per distinct cut length of external (base-to-base) diagonal
    in this area. Section `diagonals_external` separates these from the
    trapezoid-frame material.
    """
    element = _alt_group_default(products_by_type, _ANGLE_PROFILE_ANCHOR)
    pieces: list[dict] = []
    for diag in rc.get('externalDiagonals') or []:
        length_mm = diag.get('diagLengthMm', 0)
        if length_mm <= 0:
            continue
        pieces.append({'qty': 1, 'lenCm': length_mm / 10})
    rows = _group_pieces_by_length(pieces, area_label, element)
    for r in rows:
        r['section'] = 'diagonals_external'
    # 2 hex bolts per diagonal cut (one at each connection point)
    total_cuts = len(pieces)
    if total_cuts > 0:
        bolt_element = _alt_group_default(products_by_type, _OTHER_PUNCH_BOLT_ANCHOR)
        rows.append({'areaLabel': area_label, 'element': bolt_element, 'totalLengthM': None, 'qty': total_cuts * 2})
    return rows


def _compute_rail_bom(rc: dict, area_label: str, products_by_type: dict) -> list[dict]:
    """Compute rail profiles + connectors BOM.

    Rails are emitted as one row per distinct cut length within the area; a
    later post-processing step (`_aggregate_rails_globally`) merges identical
    lengths across all areas into a single row, since rails are stocked by
    standard length without regard to area.
    """
    num_rails = rc.get('numRails', 2)
    num_rail_connectors = rc.get('numRailConnectors', 0)
    rail_element      = _alt_group_default(products_by_type, _RAIL_ANCHOR)
    connector_element = _alt_group_default(products_by_type, _RAIL_CONNECTOR_ANCHOR)
    rows: list[dict] = []
    rail_pieces = rc.get('railPieces') or []
    if rail_pieces:
        rows += _group_pieces_by_length(rail_pieces, area_label, rail_element)
    elif num_rails > 0:
        # Fallback when per-rail data isn't available: emit a piece-count row.
        rows.append({'areaLabel': area_label, 'element': rail_element, 'totalLengthM': None, 'qty': num_rails})
    if num_rail_connectors > 0:
        rows.append({'areaLabel': area_label, 'element': connector_element, 'totalLengthM': None, 'qty': num_rail_connectors})
        screw_element = _alt_group_default(products_by_type, _CONNECTOR_SCREW_ANCHOR)
        rows.append({'areaLabel': area_label, 'element': screw_element, 'totalLengthM': None, 'qty': num_rail_connectors * 4})
    return rows


def _compute_block_bom(rc: dict, area_label: str, products_by_type: dict) -> list[dict]:
    """One block per trapezoid leg. bundle children (bitumen_sheets) are
    appended automatically by expand_bundles."""
    block_qty = rc.get('numBlocks', 0)
    if block_qty <= 0:
        return []
    element = _alt_group_default(products_by_type, _BLOCK_ANCHOR)
    return [
        {'areaLabel': area_label, 'element': element, 'totalLengthM': None, 'qty': block_qty},
    ]


def _compute_panel_clamp_bom(rc: dict, area_label: str, products_by_type: dict) -> list[dict]:
    """Compute all panel clamp types (end, grounding, mid) BOM.

    Mid + grounding clamps live at every adjacent-panel boundary on every
    rail crossing that boundary. The total boundary-position count and the
    grounding count are computed per panel row in `_derive_row_construction`
    (see `interPanelClampPositions` / `groundingPanelCount`) — area-level
    averages don't work for areas with mixed-shape rows.

    Grounding clamps are mid-clamp positions reused as the electrical bond,
    so subtract them from the inter-panel total to get the plain mid count.
    """
    num_rails = rc.get('numRails', 2)
    num_lines = rc.get('numLines', 1)
    num_large_gaps = rc.get('numLargeGaps', 0)
    end_clamp_element      = _alt_group_default(products_by_type, _END_CLAMP_ANCHOR)
    grounding_clamp_element = _alt_group_default(products_by_type, _GROUNDING_CLAMP_ANCHOR)
    mid_clamp_element      = _alt_group_default(products_by_type, _MID_CLAMP_ANCHOR)
    rows = []

    rails_per_line = num_rails / num_lines if num_lines else num_rails
    end_clamp_qty = 2 * num_rails + 2 * num_large_gaps * rails_per_line
    rows.append({'areaLabel': area_label, 'element': end_clamp_element, 'totalLengthM': None, 'qty': round(end_clamp_qty)})

    grounding_qty = rc.get('groundingPanelCount', 0)
    rows.append({'areaLabel': area_label, 'element': grounding_clamp_element, 'totalLengthM': None, 'qty': grounding_qty})

    inter_panel_positions = rc.get('interPanelClampPositions', 0)
    # Large-gap boundaries don't get a mid-clamp — the rail is split there
    # and gets two end-clamps instead.
    mid_positions = max(0, inter_panel_positions - num_large_gaps)
    mid_clamp_qty = max(0, mid_positions - grounding_qty)
    if mid_clamp_qty > 0:
        rows.append({'areaLabel': area_label, 'element': mid_clamp_element, 'totalLengthM': None, 'qty': mid_clamp_qty})

    return rows


def _alt_group_default(products_by_type: dict, anchor_key: str) -> str:
    """Return the type_key of the is_default product in the same alt group as
    anchor_key. Falls back to anchor_key if alt_group is unset or no default
    is marked in the group."""
    anchor = products_by_type.get(anchor_key, {})
    grp = anchor.get('alt_group')
    if grp is not None:
        for prod in products_by_type.values():
            if prod.get('alt_group') == grp and prod.get('is_default'):
                return prod['type_key']
    return anchor_key


# Stable anchors that identify each alt group used in BOM computation.
# The actual element emitted is whichever member of the group has is_default=True.
_ANGLE_PROFILE_ANCHOR        = 'angle_profile_40x40'
_RAIL_ANCHOR                 = 'rail_40x40'
_RAIL_CONNECTOR_ANCHOR       = 'rail_connector'
_BLOCK_ANCHOR                = 'block_50x24x15'
_END_CLAMP_ANCHOR            = 'end_panel_clamp'
_GROUNDING_CLAMP_ANCHOR      = 'grounding_panel_clamp'
_MID_CLAMP_ANCHOR            = 'mid_panel_clamp'
_OTHER_PUNCH_BOLT_ANCHOR     = 'hex_head_bolt_m8x20'
_BLOCK_PUNCH_ANCHOR          = 'jumbo_5x16'
_ISKURIT_SCREW_ANCHOR        = 'self_drilling_screw_7_5_drill_1_4_1_4_1_with_seal'
_INSULATED_SCREW_ANCHOR      = 'self_drilling_screw_12_5_5_drill_with_seal'
_CONNECTOR_SCREW_ANCHOR      = 'self_drilling_screw_3_5_drill_1_4_1_4_1_with_seal'
_HOOK_ANCHOR                 = 'hooks'


def _compute_bolt_bom(rc: dict, area_label: str, products_by_type: dict) -> list[dict]:
    """One bolt per trapezoid punch, split by punch origin.

      • block-origin punches  → default product in the block-punch alt group
                                (anchor: jumbo_5x16; alt: single_arrow_anchor_bolt)
      • all other punches     → hex_head_bolt_m8x20 (per punch)

    When the user alt-swaps a block-punch bolt to single_arrow_anchor_bolt,
    expand_bundles auto-appends its bundle children (m12_nut_for_arrow_anchor
    ×2, m12_washer_for_arrow_anchor ×2). Flange nut for hex bolts likewise
    comes via expand_bundles — no companion items are hand-rolled here.
    """
    other_q = rc.get('numOtherPunches', 0)
    block_q = rc.get('numBlockPunches', 0)
    rows: list[dict] = []
    if other_q > 0:
        element = _alt_group_default(products_by_type, _OTHER_PUNCH_BOLT_ANCHOR)
        rows.append({'areaLabel': area_label, 'element': element, 'totalLengthM': None, 'qty': other_q})
    if block_q > 0:
        element = _alt_group_default(products_by_type, _BLOCK_PUNCH_ANCHOR)
        rows.append({'areaLabel': area_label, 'element': element, 'totalLengthM': None, 'qty': block_q})
    return rows


def _compute_purlin_screw_bom(rc: dict, area_label: str, roof_type: str, products_by_type: dict) -> list[dict]:
    """Compute screws for iskurit/insulated_panel — 2 per panel."""
    panel_count = rc.get('panelCount', 0)
    if panel_count <= 0:
        return []
    anchor = _ISKURIT_SCREW_ANCHOR if roof_type == 'iskurit' else _INSULATED_SCREW_ANCHOR
    element = _alt_group_default(products_by_type, anchor)
    return [{'areaLabel': area_label, 'element': element, 'totalLengthM': None, 'qty': 2 * panel_count}]


def _compute_hook_bom(rc: dict, area_label: str, products_by_type: dict) -> list[dict]:
    """One hook line item per tile-roof area, plus 1 hex bolt per hook when
    the resolved hook type is 'hooks' (not hook_5cm_with_3_holes_gallery).

    Quantity = total rail × virtual-base intersections, computed upstream by
    base_service.fill_hook_offsets and rolled up into rc['numHooks'].
    """
    hook_count = rc.get('numHooks', 0)
    if hook_count <= 0:
        return []
    element = _alt_group_default(products_by_type, _HOOK_ANCHOR)
    bolt_element = _alt_group_default(products_by_type, _OTHER_PUNCH_BOLT_ANCHOR)
    return [
        {'areaLabel': area_label, 'element': element, 'totalLengthM': None, 'qty': hook_count},
        {'areaLabel': area_label, 'element': bolt_element, 'totalLengthM': None, 'qty': hook_count},
    ]


def _aggregate_rails_globally(rows: list[dict]) -> list[dict]:
    """Merge `rail_40x40` rows across areas by piece length.

    Rails are stocked in standard lengths regardless of which area they go in,
    so the user-facing BOM lists them once per length with the contributing
    areas joined into a single comma-separated label (e.g. "A, J").

    `rail_end_cap` and `rail_connector` are piece-count items and stay per-area.
    """
    rail_rows: list[dict] = []
    other_rows: list[dict] = []
    for row in rows:
        if row.get('element') == 'rail_40x40' and row.get('pieceLengthM') is not None:
            rail_rows.append(row)
        else:
            other_rows.append(row)

    if not rail_rows:
        return rows

    grouped: dict[int, dict] = {}
    for row in rail_rows:
        key_cm = round(row['pieceLengthM'] * 100)
        bucket = grouped.setdefault(key_cm, {
            'pieceLengthM': row['pieceLengthM'],
            'qty': 0,
            'areas': set(),
        })
        bucket['qty'] += row.get('qty', 0)
        label = row.get('areaLabel')
        if label:
            bucket['areas'].add(label)

    aggregated: list[dict] = []
    for length_cm in sorted(grouped.keys(), reverse=True):
        g = grouped[length_cm]
        if g['qty'] <= 0:
            continue
        labels = sorted(g['areas'])
        aggregated.append({
            'areaLabel': ', '.join(labels),
            'element': 'rail_40x40',
            'pieceLengthM': g['pieceLengthM'],
            'totalLengthM': round(g['pieceLengthM'] * g['qty'], 2),
            'qty': g['qty'],
        })

    return other_rows + aggregated


def _aggregate_other_globally(rows: list[dict]) -> list[dict]:
    """Merge non-length-bearing rows across areas by element.

    Items in the "Other" section (clamps, bolts, blocks, end caps, screws,
    hooks, etc.) are stocked by the box without regard to area, so the BOM
    lists each element once with the contributing areas comma-joined in the
    area column.
    """
    length_rows = [r for r in rows if r.get('pieceLengthM') is not None]
    other_rows = [r for r in rows if r.get('pieceLengthM') is None]
    if not other_rows:
        return rows

    grouped: dict[str, dict] = {}
    for r in other_rows:
        element = r.get('element')
        if not element:
            continue
        bucket = grouped.setdefault(element, {
            'element': element,
            'qty': 0,
            'areas': set(),
        })
        bucket['qty'] += r.get('qty', 0)
        label = r.get('areaLabel')
        if label:
            bucket['areas'].add(label)

    aggregated: list[dict] = []
    for element in sorted(grouped.keys()):
        g = grouped[element]
        if g['qty'] <= 0:
            continue
        labels = sorted(g['areas'])
        aggregated.append({
            'areaLabel': ', '.join(labels),
            'element': element,
            'totalLengthM': None,
            'qty': g['qty'],
        })

    return length_rows + aggregated


def build_bom(
    row_constructions: list[dict],
    row_labels: list[str],
    products_by_type: dict | None = None,
) -> list[dict]:
    """
    Build per-area bill of materials.
    Direct port of FE constructionCalculator.js → buildBOM().
    Returns list of { areaLabel, element, totalLengthM, qty }.
    """
    products_by_type = products_by_type or {}
    rows: list[dict] = []

    for i, rc in enumerate(row_constructions):
        area_label = row_labels[i] if i < len(row_labels) else f'Area {i + 1}'
        roof_type = rc.get('roofType', 'concrete')

        p = products_by_type
        if roof_type == 'tiles':
            # Tiles: rails + clamps + hooks only (no frame, no blocks)
            rows += _compute_rail_bom(rc, area_label, p)
            rows += _compute_panel_clamp_bom(rc, area_label, p)
            rows += _compute_hook_bom(rc, area_label, p)
        elif roof_type in ('iskurit', 'insulated_panel'):
            # Full frame, no blocks, add screws
            rows += _compute_trapezoid_bom(rc, area_label, p)
            rows += _compute_external_diagonal_bom(rc, area_label, p)
            rows += _compute_rail_bom(rc, area_label, p)
            rows += _compute_panel_clamp_bom(rc, area_label, p)
            rows += _compute_bolt_bom(rc, area_label, p)
            rows += _compute_purlin_screw_bom(rc, area_label, roof_type, p)
        else:
            # Concrete (default): full BOM
            rows += _compute_trapezoid_bom(rc, area_label, p)
            rows += _compute_external_diagonal_bom(rc, area_label, p)
            rows += _compute_rail_bom(rc, area_label, p)
            rows += _compute_block_bom(rc, area_label, p)
            rows += _compute_panel_clamp_bom(rc, area_label, p)
            rows += _compute_bolt_bom(rc, area_label, p)

    return _aggregate_other_globally(_aggregate_rails_globally(rows))


def enrich_bom_with_products(
    bom_items: list[dict],
    products_by_type: dict[str, dict],
) -> list[dict]:
    """Add product details (name, partNumber, etc.) to each BOM item."""
    enriched = []
    for item in bom_items:
        prod = products_by_type.get(item['element'])
        enriched.append({
            **item,
            'productId': str(prod['id']) if prod else None,
            'partNumber': prod['part_number'] if prod else None,
            'name': prod['name'] if prod else None,
            'nameHe': prod['name_he'] if prod else None,
            'extraPct': prod['extra'] if prod else None,
            'altGroup': prod['alt_group'] if prod else None,
        })
    return enriched


_BOM_LOGIC_VERSION = 25  # bump to invalidate all cached BOMs


def compute_input_hash(data: dict) -> str:
    """SHA-256 hash of step3 computed data relevant to BOM computation."""
    step3 = data.get('step3', {})
    relevant = {
        '_v': _BOM_LOGIC_VERSION,
        'computedAreas': step3.get('computedAreas', []),
        'computedTrapezoids': step3.get('computedTrapezoids', []),
    }
    raw = json.dumps(relevant, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


# ---------------------------------------------------------------------------
# DB-aware orchestrators
# ---------------------------------------------------------------------------

async def get_bom(db: AsyncSession, project_id: uuid.UUID) -> ProjectBOM | None:
    result = await db.execute(
        select(ProjectBOM).where(ProjectBOM.project_id == project_id)
    )
    return result.scalar_one_or_none()


def is_bom_stale(project_data: dict, bom: ProjectBOM) -> bool:
    """Check if stored BOM is outdated relative to current project data."""
    if bom.input_hash != compute_input_hash(project_data):
        return True
    # Also stale if items lack nameHe (pre-translation BOM)
    items = bom.items or []
    if items and 'nameHe' not in items[0]:
        return True
    return False


async def reenrich_items_with_fresh_products(
    db: AsyncSession, items: list[dict],
) -> list[dict]:
    """Overlay current products-table data onto cached BOM items.

    The computed quantities (areaLabel, element, qty, totalLengthM) are
    stable as long as step3 hasn't changed, but the enriched fields
    (name, nameHe, partNumber, extraPct, altGroup) are read-through to
    the products table on every call so admin edits propagate without
    needing a BOM cache invalidation. The DB row is not mutated.
    """
    if not items:
        return []
    products_by_type = await _load_products_by_type(db)
    return enrich_bom_with_products(items, products_by_type)


async def _load_products_by_type(db: AsyncSession) -> dict[str, dict]:
    """Load all active material products keyed by type_key."""
    result = await db.execute(
        select(Product).where(Product.active == True, Product.product_type != 'panel')
    )
    products = result.scalars().all()
    return {
        p.type_key: {
            'id': p.id,
            'type_key': p.type_key,
            'part_number': p.part_number,
            'name': p.name,
            'name_he': p.name_he,
            'extra': p.extra,
            'alt_group': p.alt_group,
            'is_default': p.is_default,
            'bundle': p.bundle,
        }
        for p in products
    }


def expand_bundles(items: list[dict], products_by_type: dict[str, dict]) -> list[dict]:
    """Append derived rows for every bundle whose parent appears in `items`.

    Idempotent: any pre-existing `bundleParent`-tagged rows are dropped up
    front so a re-run regenerates the children from the *current* parents
    (and current `products.bundle` rules) instead of stacking on top of a
    previous expansion. Without this, every Recalc would duplicate the
    flange-nut / m12-nut / m12-washer rows.

    A bundled product carries `bundle = {"parentType": str, "multiplier": int}`.
    For each base row the *effective* product type is `altElement or element`
    — respects user alt-swaps. Per match we emit one child row with
    qty = parent.qty * multiplier, tagged `bundleParent` + `bundleMultiplier`.
    Bundle children inherit `areaLabel` from the parent (which after the
    global aggregation pass may already be a comma-joined list like "A, B"),
    so duplicates across areas don't reappear here.

    Alt-group-aware deduplication: when multiple products share the same
    bundle.parentType AND the same alt_group, only one is expanded per parent
    row.  The committed member (recorded from existing bundle-child rows) takes
    priority; if none is committed yet the is_default=True member is used.
    This allows the user to switch between alt variants of a bundle child
    (e.g. 7.5 cm vs 12.5 cm hook screw) without both being emitted.
    """
    if not items:
        return []

    # Before dropping bundle children, record the previously committed alt for
    # each (parent_type, alt_group) pair so re-expansion honours the user's
    # choice.  `altElement` takes precedence when apply_bom_deltas has just set
    # a pending swap; fall back to `element` for already-materialised items.
    committed_alts: dict[tuple[str, int], str] = {}
    for it in items:
        parent = it.get('bundleParent')
        if not parent:
            continue
        elem = it.get('altElement') or it.get('element')
        if not elem:
            continue
        prod = products_by_type.get(elem)
        if prod:
            ag = prod.get('alt_group')
            if ag is not None:
                committed_alts[(parent, ag)] = elem

    # Drop previously-expanded children to keep the call idempotent.
    base = [it for it in items if not it.get('bundleParent')]

    # Build by_parent.  For alt-grouped bundle members keep only one entry per
    # (parent_type, alt_group): the committed alt if present, else is_default.
    by_parent: dict[str, list[tuple[dict, int]]] = {}
    alt_winners: dict[tuple[str, int], tuple[dict, int]] = {}

    for prod in products_by_type.values():
        b = prod.get('bundle')
        if not b:
            continue
        parent_type = b.get('parentType')
        mult = b.get('multiplier')
        if not parent_type or not isinstance(mult, int) or mult <= 0:
            continue
        ag = prod.get('alt_group')
        if ag is None:
            by_parent.setdefault(parent_type, []).append((prod, mult))
        else:
            key = (parent_type, ag)
            committed_elem = committed_alts.get(key)
            if committed_elem:
                committed_prod = products_by_type.get(committed_elem)
                if committed_prod:
                    committed_mult = (committed_prod.get('bundle') or {}).get('multiplier', mult)
                    alt_winners[key] = (committed_prod, committed_mult)
            elif key not in alt_winners or prod.get('is_default'):
                alt_winners[key] = (prod, mult)

    for (parent_type, _), (prod, mult) in alt_winners.items():
        by_parent.setdefault(parent_type, []).append((prod, mult))

    expanded: list[dict] = []
    for item in base:
        expanded.append(item)
        effective_type = item.get('altElement') or item.get('element')
        for child_prod, mult in by_parent.get(effective_type, []):
            qty = (item.get('qty') or 0) * mult
            if qty <= 0:
                continue
            expanded.append({
                'areaLabel': item.get('areaLabel', ''),
                'element': child_prod['type_key'],
                'section': item.get('section'),
                'totalLengthM': None,
                'qty': qty,
                'productId': str(child_prod['id']) if child_prod.get('id') else None,
                'partNumber': child_prod.get('part_number'),
                'name': child_prod.get('name'),
                'nameHe': child_prod.get('name_he'),
                'extraPct': child_prod.get('extra'),
                'altGroup': child_prod.get('alt_group'),
                'bundleParent': effective_type,
                'bundleMultiplier': mult,
            })
    return expanded


async def materialize_bom(db: AsyncSession, project) -> ProjectBOM:
    """Recalc button: apply bomDeltas + expand bundles, save back, clear deltas.

    Reads the cached `bom.items`, applies the user's pending edits
    (overrides / additions / alternatives) onto a fresh copy, runs
    `expand_bundles` so bundle children appear under their (possibly
    alt-swapped) parents, persists the merged list as `bom.items`, and
    clears `project.data.step5.bomDeltas`. Future edits start from a
    clean slate on top of the materialised BOM.
    """
    bom = await get_bom(db, project.id)
    if not bom:
        return None
    data = project.data or {}
    step5 = data.get('step5') or {}
    deltas = step5.get('bomDeltas') or {}

    products_by_type = await _load_products_by_type(db)
    base = enrich_bom_with_products(bom.items or [], products_by_type)
    effective = apply_bom_deltas(base, deltas)
    expanded = expand_bundles(effective, products_by_type)

    # Commit alt-swaps: replace element with altElement so the stored BOM
    # reflects the user's choice. Without this, element stays as the default
    # key and the swap is invisible after the BOM is saved.
    for item in expanded:
        alt = item.pop('altElement', None)
        if alt:
            item['element'] = alt
            prod = products_by_type.get(alt)
            if prod:
                item['productId'] = str(prod['id'])
                item['partNumber'] = prod.get('part_number')
                item['name'] = prod.get('name')
                item['nameHe'] = prod.get('name_he')
                item['extraPct'] = prod.get('extra')
                item['altGroup'] = prod.get('alt_group')

    bom.items = expanded
    bom.updated_at = datetime.now(timezone.utc)
    flag_modified(bom, 'items')

    if step5.get('bomDeltas'):
        step5['bomDeltas'] = {}
        data['step5'] = step5
        project.data = data
        flag_modified(project, 'data')

    await db.commit()
    await db.refresh(bom)
    return bom


async def compute_and_save_bom(db: AsyncSession, project) -> ProjectBOM:
    """
    Compute BOM from project's step2/step3 data, enrich with products, and upsert.
    """
    data = project.data or {}
    step2 = data.get('step2', {})
    step3 = data.get('step3', {})
    areas = step2.get('areas', [])
    computed_areas = step3.get('computedAreas', [])
    computed_trapezoids = step3.get('computedTrapezoids', [])

    # Get angleProfileSizeMm from settings cache (no DB call)
    angle_profile_size_mm = get_setting('angleProfileSizeMm')

    project_roof_spec = project.roof_spec or {'type': 'concrete'}

    # Build label → computedArea lookup
    ca_by_label = {ca.get('label'): ca for ca in computed_areas}

    # Derive row constructions for each area. Each area's BOM contribution
    # is computed against its own resolved roof type — for mixed projects
    # that means concrete / tiles / iskurit / insulated_panel per area.
    from app.utils.settings_helpers import resolve_roof_spec
    row_constructions = []
    row_labels = []
    for area in areas:
        label = _get_area_field(area, 'label', f'Area {len(row_labels) + 1}')
        ca = ca_by_label.get(label)
        area_roof_type = resolve_roof_spec(project_roof_spec, area).get('type', 'concrete')
        rc = _derive_row_construction(area, ca, computed_trapezoids, area_roof_type)
        if rc is None:
            continue
        # Add angleProfileSizeMm from app_settings to each row construction
        rc['angleProfileSizeMm'] = angle_profile_size_mm
        rc['roofType'] = area_roof_type
        row_constructions.append(rc)
        row_labels.append(label)

    # Load products first — build_bom needs them to resolve the default
    # product within each alt group (e.g. block-punch bolt).
    products_by_type = await _load_products_by_type(db)
    bom_items = build_bom(row_constructions, row_labels, products_by_type)

    # Enrich + expand bundles. Step-5 entry resets the BOM, so bomDeltas is
    # also wiped — we don't apply alt-swaps here, just fire bundles whose
    # parent is the canonical element. Alt-swap-driven bundles materialise
    # later when the user clicks Recalc (`materialize_bom`).
    enriched_items = enrich_bom_with_products(bom_items, products_by_type)
    enriched_items = expand_bundles(enriched_items, products_by_type)

    # Compute hash for staleness detection
    input_hash = compute_input_hash(data)

    # Step-5 entry policy: any pending bomDeltas are wiped, since the
    # canonical regen replaces the materialised state the user was editing.
    step5 = data.get('step5') or {}
    if step5.get('bomDeltas'):
        step5['bomDeltas'] = {}
        data['step5'] = step5
        project.data = data
        flag_modified(project, 'data')

    # Upsert: find existing or create new
    existing = await get_bom(db, project.id)
    if existing:
        existing.items = enriched_items
        existing.input_hash = input_hash
        existing.updated_at = datetime.now(timezone.utc)
        flag_modified(existing, 'items')
        await db.commit()
        await db.refresh(existing)
        return existing
    else:
        bom = ProjectBOM(
            project_id=project.id,
            items=enriched_items,
            input_hash=input_hash,
        )
        db.add(bom)
        await db.commit()
        await db.refresh(bom)
        return bom


def _delta_key(item: dict) -> str:
    """Stable per-row override key. Length-bearing rows include pieceLengthM
    so multiple cut-length variants of the same element (e.g. 6m vs 1.2m
    angle profile in the same area) can be edited independently."""
    base = f"{item['areaLabel']}||{item['element']}"
    piece_length_m = item.get('pieceLengthM')
    if piece_length_m is None:
        return base
    return f"{base}||{int(round(piece_length_m * 100))}cm"


def apply_bom_deltas(
    bom_items: list[dict],
    bom_deltas: dict,
) -> list[dict]:
    """
    Merge bomDeltas (overrides, additions, alternatives) onto base BOM items.
    Returns the effective BOM list.
    """
    overrides = bom_deltas.get('overrides') or {}
    additions = bom_deltas.get('additions') or []
    alternatives = bom_deltas.get('alternatives') or {}

    effective = []
    for item in bom_items:
        key = _delta_key(item)
        ov = overrides.get(key)
        if ov and ov.get('removed'):
            continue
        entry = {**item}
        if ov:
            if 'qty' in ov:
                entry['qty'] = ov['qty']
            if 'extras' in ov:
                entry['extras'] = ov['extras']
        # Apply alternative product substitution
        alt_element = alternatives.get(entry['element'])
        if alt_element:
            entry['altElement'] = alt_element
        effective.append(entry)

    # Append user-added items
    for add in additions:
        effective.append({
            'areaLabel': add.get('areaLabel', ''),
            'element': add.get('element', ''),
            'totalLengthM': add.get('totalLengthM'),
            'qty': add.get('qty', 0),
            'extras': add.get('extras', 0),
            'productId': add.get('productId'),
            'partNumber': add.get('partNumber'),
            'name': add.get('name'),
            'extraPct': None,
            'altGroup': None,
        })

    return effective
