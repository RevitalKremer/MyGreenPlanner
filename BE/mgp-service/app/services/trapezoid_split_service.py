"""
Server-side trapezoid splitting — mirrors FE computePanelsAction.js logic.

Same algorithm as the FE _refreshSingleRowTrapezoids / refreshAreaTrapezoidsAction,
using cm units instead of pixels. Panel positions (stored in pixels in layout.panels)
are converted to cm via pixelToCmRatio derived from the reference line.

Usage:
  compute_project_trapezoids(project) → { trapezoids, panel_trap_ids }
  compare_with_client(project)        → list of mismatch descriptions (empty = match)
"""

import logging
import math
from collections import defaultdict

from app.utils.panel_geometry import PANEL_V, PANEL_H, PANEL_EV, PANEL_EH

logger = logging.getLogger(__name__)


def _pixel_to_cm_ratio(layout: dict) -> float | None:
    """Derive pixelToCmRatio from reference line, same as FE."""
    ref = layout.get('referenceLine')
    ref_cm = layout.get('referenceLineLengthCm')
    if not ref or not ref_cm:
        return None
    start, end = ref.get('start', {}), ref.get('end', {})
    dx = end.get('x', 0) - start.get('x', 0)
    dy = end.get('y', 0) - start.get('y', 0)
    px_len = math.sqrt(dx * dx + dy * dy)
    if px_len <= 0:
        return None
    return float(ref_cm) / px_len


# ── Single-row signature computation ────────────────────────────────────────

def _refresh_single_row_trapezoids(
    area_idx: int,
    area: dict,
    panels: list[dict],
    pixel_to_cm: float,
    panel_width_cm: float,
    panel_gap_cm: float,
    panel_front_height: float,
    panel_angle: float,
    area_label: str,
    sig_to_trap: dict,   # shared mutable: signature → trapId
    counter: list[int],  # shared mutable: [next_id]
) -> dict | None:
    """
    Compute column signatures for one physical row (rect area).
    Mirrors FE _refreshSingleRowTrapezoids — same math, cm units.

    Returns { area_idx, panel_with_cols, col_sig_fn, a_front, a_angle }
    or None if prerequisites are missing.
    """
    if not area or area.get('manualTrapezoids') or not area.get('vertices'):
        return None

    # Convert panel pitch to pixels (matching FE: portraitW = pWid / pixelToCmRatio)
    portrait_w = panel_width_cm / pixel_to_cm
    gap_px = panel_gap_cm / pixel_to_cm
    portrait_pitch = portrait_w + gap_px

    vertices = area.get('vertices', [])
    rotation = area.get('rotation', 0)
    x_dir = area.get('xDir', 'ltr')
    area_vertical = area.get('areaVertical', False)

    effective_rotation = (90 if area_vertical else 0) + rotation
    rot_rad = effective_rotation * math.pi / 180
    cos_f = math.cos(-rot_rad)
    sin_f = math.sin(-rot_rad)
    cx_avg = sum(v.get('x', 0) for v in vertices) / len(vertices)
    cy_avg = sum(v.get('y', 0) for v in vertices) / len(vertices)

    local_verts = []
    for v in vertices:
        dx = v.get('x', 0) - cx_avg
        dy = v.get('y', 0) - cy_avg
        local_verts.append({'x': dx * cos_f - dy * sin_f, 'y': dx * sin_f + dy * cos_f})
    min_lx = min(v['x'] for v in local_verts)
    max_lx = max(v['x'] for v in local_verts)

    a_front = float(area.get('frontHeight', 0) or panel_front_height or 0)
    a_angle = float(area.get('angle', 0) or panel_angle or 0)

    area_panels = [p for p in panels if p.get('area') == area_idx]
    if not area_panels:
        return None

    # Compute column assignment per panel (same as FE)
    panel_with_cols = []
    for p in area_panels:
        pcx = p.get('x', 0) + p.get('width', 0) / 2
        pcy = p.get('y', 0) + p.get('height', 0) / 2
        lx = (pcx - cx_avg) * cos_f - (pcy - cy_avg) * sin_f
        panel_w = p.get('width', 0)
        fill_left = (max_lx - lx - panel_w / 2) if x_dir == 'rtl' else (lx - min_lx - panel_w / 2)
        k_start = math.floor(fill_left / portrait_pitch)
        k_end = math.ceil((fill_left + panel_w) / portrait_pitch)
        covered_cols = []
        for k in range(k_start, k_end + 1):
            port_center = k * portrait_pitch + portrait_w / 2
            if port_center >= fill_left and port_center < fill_left + panel_w:
                covered_cols.append(k)
        phys_col = covered_cols[0] if covered_cols else round(fill_left / portrait_pitch)
        panel_with_cols.append({
            'id': p.get('id'),
            'row': p.get('row', 0),
            'col': phys_col,
            'coveredCols': covered_cols,
            'heightCm': p.get('heightCm', 0),
            'widthCm': p.get('widthCm', 0),
        })

    # Build column→rows map and row orientations
    col_rows_map: dict[int, set[int]] = defaultdict(set)
    row_orient: dict[int, str] = {}
    for p in panel_with_cols:
        row = p.get('row', 0)
        row_orient[row] = PANEL_V if p.get('heightCm', 0) > p.get('widthCm', 0) else PANEL_H
        cols = p.get('coveredCols') or [p.get('col', 0)]
        for c in cols:
            col_rows_map[c].add(row)

    all_rows = sorted(set(p.get('row', 0) for p in panel_with_cols))

    def col_sig(col):
        parts = []
        for r in all_rows:
            if r in col_rows_map.get(col, set()):
                parts.append(row_orient[r])
            else:
                parts.append(PANEL_EH if row_orient.get(r) == PANEL_H else PANEL_EV)
        return '|'.join(parts)

    # Register unique signatures
    for col in sorted(col_rows_map.keys()):
        s = col_sig(col)
        if s not in sig_to_trap:
            sig_to_trap[s] = f'{area_label}{counter[0]}'
            counter[0] += 1

    return {
        'area_idx': area_idx,
        'panel_with_cols': panel_with_cols,
        'col_sig_fn': col_sig,
        'a_front': a_front,
        'a_angle': a_angle,
    }


# ── Area-group orchestration ────────────────────────────────────────────────

def _refresh_area_trapezoids(
    area: dict,
    rect_areas: list[dict],
    panels: list[dict],
    pixel_to_cm: float,
    panel_width_cm: float,
    panel_gap_cm: float,
    panel_front_height: float,
    panel_angle: float,
    step2_areas: list[dict] | None = None,
) -> dict | None:
    """
    Recompute trapezoid IDs for all rows in an area group.
    Mirrors FE refreshAreaTrapezoidsAction.

    Returns {
      'trap_configs': { trapId: { angle, frontHeight, lineOrientations } },
      'panel_trap_ids': { panelId: trapId },
    } or None.
    """
    # Resolve area_label from step2 areas: areaGroupId matches step2 area.id
    group_id = area.get('areaGroupId')
    area_label = None
    if step2_areas and group_id is not None:
        for s2a in step2_areas:
            if s2a.get('id') == group_id:
                area_label = s2a.get('label')
                break
    if not area_label:
        # Fallback: strip _rN suffix from rectArea id
        raw_label = area.get('id') or area.get('label') or 'A'
        if isinstance(raw_label, int):
            raw_label = chr(65 + raw_label)
        area_label = raw_label.split('_')[0] if '_' in str(raw_label) else raw_label

    # Find all rectArea indices in the same group (same as FE: areaGroupId match)
    group_id = area.get('areaGroupId')
    if group_id is not None and rect_areas:
        group_indices = [i for i, ra in enumerate(rect_areas)
                         if ra.get('areaGroupId') == group_id]
    else:
        group_indices = [i for i, ra in enumerate(rect_areas)
                         if ra.get('id') == area.get('id')]
        if not group_indices:
            group_indices = [0]

    sig_to_trap: dict[str, str] = {}
    counter = [1]
    per_row_results = []

    for ra_idx in group_indices:
        ra = rect_areas[ra_idx] if ra_idx < len(rect_areas) else area
        result = _refresh_single_row_trapezoids(
            area_idx=ra_idx, area=ra, panels=panels,
            pixel_to_cm=pixel_to_cm,
            panel_width_cm=panel_width_cm, panel_gap_cm=panel_gap_cm,
            panel_front_height=panel_front_height, panel_angle=panel_angle,
            area_label=area_label, sig_to_trap=sig_to_trap, counter=counter,
        )
        if result:
            per_row_results.append(result)

    if not per_row_results:
        return None

    # Simplify: if only one signature, use area label directly
    if len(sig_to_trap) == 1:
        only_sig = next(iter(sig_to_trap))
        sig_to_trap[only_sig] = area_label

    # Build trap configs
    a_front = per_row_results[0]['a_front']
    a_angle = per_row_results[0]['a_angle']
    trap_configs: dict[str, dict] = {}
    for sig, trap_id in sig_to_trap.items():
        shape = sig.split('|')
        trap_configs[trap_id] = {
            'angle': a_angle,
            'frontHeight': a_front,
            'lineOrientations': shape,
        }

    # Map panel → trapId
    group_area_set = set(group_indices)
    panel_trap_ids: dict[int, str] = {}
    for p in panels:
        if p.get('area') not in group_area_set:
            continue
        row_result = next(
            (r for r in per_row_results if r['area_idx'] == p.get('area')), None
        )
        if not row_result:
            continue
        updated = next(
            (pw for pw in row_result['panel_with_cols'] if pw.get('id') == p.get('id')), None
        )
        if not updated:
            continue
        sig = row_result['col_sig_fn'](updated['col'])
        panel_trap_ids[p['id']] = sig_to_trap.get(sig, area_label)

    return {
        'trap_configs': trap_configs,
        'panel_trap_ids': panel_trap_ids,
    }


# ── Full project computation ────────────────────────────────────────────────

def compute_project_trapezoids(project) -> dict:
    """
    Compute trapezoid assignments for all areas in a project.
    Iterates layout.rectAreas grouped by areaGroupId — same as FE.

    Returns {
      'trapezoids': { trapId: { angle, frontHeight, lineOrientations } },
      'panel_trap_ids': { panelId: trapId },
    }
    """
    layout = project.layout or {}
    panels = layout.get('panels', [])
    rect_areas = layout.get('rectAreas', [])
    step2 = (project.data or {}).get('step2', {})

    pixel_to_cm = _pixel_to_cm_ratio(layout)
    if not pixel_to_cm or not panels or not rect_areas:
        return {'trapezoids': {}, 'panel_trap_ids': {}}

    panel_width_cm = step2.get('panelWidthCm', 0) or 0
    panel_gap_cm = 2  # TODO: read from app settings
    panel_front_height = step2.get('defaultFrontHeightCm', 0)
    panel_angle = step2.get('defaultAngleDeg', 0)

    all_trap_configs: dict[str, dict] = {}
    all_panel_trap_ids: dict[int, str] = {}
    processed_groups: set = set()

    # Iterate rectAreas (same as FE: rectAreas.forEach((area, idx) => ...))
    for idx, ra in enumerate(rect_areas):
        if ra.get('manualTrapezoids'):
            continue
        group_id = ra.get('areaGroupId', idx)
        if group_id in processed_groups:
            continue
        processed_groups.add(group_id)

        result = _refresh_area_trapezoids(
            area=ra, rect_areas=rect_areas, panels=panels,
            pixel_to_cm=pixel_to_cm,
            panel_width_cm=panel_width_cm, panel_gap_cm=panel_gap_cm,
            panel_front_height=panel_front_height, panel_angle=panel_angle,
            step2_areas=step2.get('areas', []),
        )
        if result:
            all_trap_configs.update(result['trap_configs'])
            all_panel_trap_ids.update(result['panel_trap_ids'])

    return {
        'trapezoids': all_trap_configs,
        'panel_trap_ids': all_panel_trap_ids,
    }


# ── Comparison wrapper ──────────────────────────────────────────────────────

def compare_with_client(project) -> list[str]:
    """
    Compare server-computed trapezoid assignments against client-provided ones.
    Logs both sides and the final verdict. Returns list of mismatch descriptions
    (empty = identical).

    Checks:
      1. Trap IDs per panel match
      2. lineOrientations per trap match
      3. No extra/missing traps
    """
    mismatches = []

    server = compute_project_trapezoids(project)
    server_traps = server['trapezoids']
    server_panel_ids = server['panel_trap_ids']

    # Client data
    panels = (project.layout or {}).get('panels', [])
    step2 = (project.data or {}).get('step2', {})
    client_traps = {t['id']: t for t in step2.get('trapezoids', [])}

    # Compare panel trap assignments
    for p in panels:
        if p.get('isEmpty'):
            continue
        pid = p.get('id')
        client_tid = p.get('trapezoidId')
        server_tid = server_panel_ids.get(pid)
        if server_tid and client_tid and server_tid != client_tid:
            mismatches.append(
                f"Panel {pid}: client='{client_tid}', server='{server_tid}'"
            )

    # Compare trap configs
    server_trap_set = set(server_traps.keys())
    client_trap_set = set(client_traps.keys())

    for tid in sorted(server_trap_set - client_trap_set):
        mismatches.append(f"Trap '{tid}': server-only (missing on client)")
    for tid in sorted(client_trap_set - server_trap_set):
        mismatches.append(f"Trap '{tid}': client-only (missing on server)")

    for tid in sorted(server_trap_set & client_trap_set):
        s_ors = server_traps[tid].get('lineOrientations', [])
        c_ors = client_traps[tid].get('lineOrientations', [])
        if s_ors != c_ors:
            mismatches.append(
                f"Trap '{tid}': lineOrientations server={s_ors}, client={c_ors}"
            )

    # Log result
    server_summary = {tid: cfg.get('lineOrientations') for tid, cfg in server_traps.items()}
    if mismatches:
        logger.warning(
            "[trap calc] MISMATCH (%d issues) — server traps: %s — %s",
            len(mismatches), server_summary, '; '.join(mismatches[:5]),
        )
    else:
        logger.info("[trap calc] MATCH — server traps: %s", server_summary)

    return mismatches
