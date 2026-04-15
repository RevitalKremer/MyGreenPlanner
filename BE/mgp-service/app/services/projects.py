import copy
import logging
import math
import uuid

logger = logging.getLogger(__name__)
from datetime import date
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy.orm import selectinload, undefer

from app.models.project import Project
from app.models.setting import AppSetting
from app.models.user import User
from app.schemas.project import ProjectCreate, ProjectUpdate
from app.services import bom_service
from app.services.trapezoid_detail_service import _compute_block_punches, trim_trapezoid
from app.services import settings_cache
from app.utils.math_helpers import round_to_1dp
from app.utils.panel_geometry import (
    is_empty_orientation, infer_row_orientation,
    PANEL_V, PANEL_H, PANEL_EV, PANEL_EH, REAL_PANELS
)


async def list_projects(db: AsyncSession, owner_id: uuid.UUID, is_admin: bool = False, limit: int | None = None) -> tuple[list[Project], int]:
    """List projects. If is_admin=True, return all projects; otherwise filter by owner_id.
    Returns tuple of (projects_list, total_count).
    """
    # Build base query
    if is_admin:
        # Admin sees all projects with owner info loaded
        query = select(Project).options(selectinload(Project.owner))
    else:
        # Regular user sees only their own projects
        query = select(Project).where(Project.owner_id == owner_id)
    
    # Get total count
    from sqlalchemy import func
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0
    
    # Apply ordering and limit
    query = query.order_by(Project.updated_at.desc())
    if limit is not None and limit > 0:
        query = query.limit(limit)
    
    result = await db.execute(query)
    projects = list(result.scalars().all())
    
    return projects, total


async def get_project(db: AsyncSession, project_id: uuid.UUID, owner_id: uuid.UUID) -> Project | None:
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.owner_id == owner_id)
    )
    return result.scalar_one_or_none()


async def create_project(db: AsyncSession, owner_id: uuid.UUID, payload: ProjectCreate) -> Project:
    project = Project(owner_id=owner_id, **payload.model_dump())
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project


# ── Server-computed keys in step3 — never sent by FE, always preserved during merge ──
_SERVER_COMPUTED_STEP3_KEYS = {'computedAreas', 'computedTrapezoids'}


def _deep_merge_settings(existing: dict | None, incoming: dict | None) -> dict:
    """
    Deep merge incoming settings into existing, preserving keys not in incoming.
    Used for partial updates to globalSettings and areaSettings.
    Handles None gracefully — DB records may store null for settings that haven't been set yet.
    """
    if not incoming:
        return copy.deepcopy(existing) if existing else {}
    if not existing:
        return copy.deepcopy(incoming)
    merged = copy.deepcopy(existing)
    for key, val in incoming.items():
        if isinstance(val, dict) and key in merged and isinstance(merged[key], dict):
            # Recursively merge nested dicts
            merged[key] = _deep_merge_settings(merged[key], val)
        else:
            merged[key] = val
    return merged


async def update_project(db: AsyncSession, project: Project, payload: ProjectUpdate, step: int | None = None) -> Project:
    fields = payload.model_dump(exclude_none=True)

    if 'data' in fields:
        incoming_data = fields['data']
        merged = copy.deepcopy(project.data or {})

        if step is not None:
            # Scoped merge: only touch data.step{n}
            step_key = f'step{step}'
            incoming_step = incoming_data.get(step_key)
            if incoming_step is not None:
                existing_step = merged.get(step_key)
                if isinstance(existing_step, dict) and isinstance(incoming_step, dict):
                    # Preserve server-computed keys in step3
                    if step_key == 'step3':
                        for k in _SERVER_COMPUTED_STEP3_KEYS:
                            if k in existing_step and k not in incoming_step:
                                incoming_step[k] = existing_step[k]
                    existing_step.update(incoming_step)
                    merged[step_key] = existing_step
                else:
                    merged[step_key] = incoming_step
        else:
            # Full save: merge each step key.
            # step2 is fully FE-owned (no computed data) — safe to overwrite.
            # step3 has server-computed keys that must be preserved.
            for key, incoming_val in incoming_data.items():
                existing_val = merged.get(key)
                if key == 'step3' and isinstance(existing_val, dict) and isinstance(incoming_val, dict):
                    # Preserve server-computed keys
                    for k in _SERVER_COMPUTED_STEP3_KEYS:
                        if k in existing_val and k not in incoming_val:
                            incoming_val[k] = existing_val[k]
                    existing_val.update(incoming_val)
                    merged[key] = existing_val
                elif isinstance(existing_val, dict) and isinstance(incoming_val, dict):
                    existing_val.update(incoming_val)
                    merged[key] = existing_val
                else:
                    merged[key] = incoming_val

        # Assign permanent numeric IDs to areas that don't have one
        _assign_area_ids(merged)

        fields['data'] = merged

    for field, value in fields.items():
        setattr(project, field, value)

    if 'data' in fields:
        flag_modified(project, 'data')

    await db.commit()
    await db.refresh(project)
    return project


async def delete_project(db: AsyncSession, project: Project) -> None:
    await db.delete(project)
    await db.commit()


def _assign_area_ids(data: dict) -> None:
    """Assign permanent numeric IDs to step2 areas that don't have one."""
    areas = data.get('step2', {}).get('areas', [])
    if not areas:
        return
    existing_ids = [a['id'] for a in areas if isinstance(a.get('id'), int)]
    next_id = max(existing_ids, default=0) + 1
    for area in areas:
        if not isinstance(area.get('id'), int):
            area['id'] = next_id
            next_id += 1


_REAL_ORIENTATIONS = {'V', 'H', 'vertical', 'horizontal'}


def _validate_step2_trapezoids(project: Project) -> list[str]:
    """
    Validate that panel trapezoidIds are consistent with step2 area/trap configs.

    Returns a list of error strings (empty = valid).

    Checks:
      1. Every panel trapezoidId exists in step2.trapezoids
      2. Every panel trapezoidId is listed in its area's trapezoidIds
      3. Each trapezoid's lineOrientations length matches the actual number of
         panel lines for that trap within each physical row
      4. Each trapezoid's angleDeg/frontHeightCm matches its owning row's a/h
         (with area a/h and step2 default a/h as fallbacks). Row a/h is the
         source of truth — FE computes trap a/h from owning row, and this
         check verifies FE/BE produce matching results.
    """
    panels = (project.layout or {}).get('panels', [])
    step2 = (project.data or {}).get('step2', {})
    areas = step2.get('areas', [])
    traps = {t['id']: t for t in step2.get('trapezoids', [])}
    default_angle = step2.get('defaultAngleDeg', 0) or 0
    default_fh = step2.get('defaultFrontHeightCm', 0) or 0
    errors = []

    if not panels or not areas:
        return errors

    # Build area lookup: area index → area config
    area_by_id = {a['id']: a for a in areas if 'id' in a}

    # Build map: areaGroupKey → area (areas are matched to panels via the area
    # field on each panel, which stores the rectArea index, grouped by
    # areaGroupKey for multi-row areas)
    area_trap_ids = {}  # areaGroupKey → set of allowed trapezoidIds
    for a in areas:
        aid = a.get('id')
        tids = set(a.get('trapezoidIds', []))
        if aid is not None:
            area_trap_ids[aid] = tids

    # Group panels by (areaGroupKey, panelRowIdx, trapezoidId) to count lines
    from collections import defaultdict
    row_trap_lines = defaultdict(set)  # (areaGroupKey, panelRowIdx, trapId) → set of line indices

    for p in panels:
        if p.get('isEmpty'):
            continue
        tid = p.get('trapezoidId')
        if not tid:
            continue

        # Check 1: trapezoidId exists in step2.trapezoids
        if tid not in traps:
            errors.append(f"Panel {p.get('id')}: trapezoidId '{tid}' not in step2.trapezoids")
            continue

        # Collect line indices per (areaGroupKey, panelRowIdx, trapId)
        agk = p.get('areaGroupKey', p.get('area', 0))
        pri = p.get('panelRowIdx', 0)
        line = p.get('line', 0)
        row_trap_lines[(agk, pri, tid)].add(line)

    # Check 2: panel trapezoidIds are in their area's trapezoidIds
    # We need to map areaGroupKey → area. Panels store areaGroupKey which
    # corresponds to the area's id or index.
    agk_to_area_tids = {}
    for p in panels:
        if p.get('isEmpty'):
            continue
        agk = p.get('areaGroupKey', p.get('area', 0))
        if agk in agk_to_area_tids:
            continue
        # Find the area for this panel: try matching by trapezoidId through areas
        tid = p.get('trapezoidId')
        matched = None
        for a in areas:
            if tid in a.get('trapezoidIds', []):
                matched = a
                break
        if matched:
            agk_to_area_tids[agk] = set(matched.get('trapezoidIds', []))

    for p in panels:
        if p.get('isEmpty'):
            continue
        tid = p.get('trapezoidId')
        if not tid:
            continue
        agk = p.get('areaGroupKey', p.get('area', 0))
        allowed = agk_to_area_tids.get(agk)
        if allowed is not None and tid not in allowed:
            errors.append(
                f"Panel {p.get('id')}: trapezoidId '{tid}' not in area's "
                f"trapezoidIds {allowed}"
            )

    # Check 3: lineOrientations length matches actual line count per row
    for (agk, pri, tid), lines in row_trap_lines.items():
        trap_cfg = traps.get(tid)
        if not trap_cfg:
            continue
        line_ors = trap_cfg.get('lineOrientations', [])
        real_line_count = sum(1 for o in line_ors if o in _REAL_ORIENTATIONS)
        actual_line_count = len(lines)
        if real_line_count != actual_line_count:
            errors.append(
                f"Trap '{tid}' (area {agk}, row {pri}): lineOrientations has "
                f"{real_line_count} real lines but panels have {actual_line_count} lines"
            )

    # Check 4: trap a/h matches owning row a/h (with area + default fallbacks).
    # Row a/h is the source of truth; FE derives trap a/h from owning row.
    # This check enforces that FE/BE compute the same value.
    AH_TOL = 0.01  # tolerance for float comparison
    seen_traps: set[str] = set()
    for (agk, pri, tid), _lines in row_trap_lines.items():
        if tid in seen_traps:
            continue
        seen_traps.add(tid)
        trap_cfg = traps.get(tid)
        if not trap_cfg:
            continue
        # Resolve owning area: panel's area carries the rectArea index, but
        # the area we want is the one whose trapezoidIds contains tid.
        owning_area = None
        for a in areas:
            if tid in (a.get('trapezoidIds') or []):
                owning_area = a
                break
        if owning_area is None:
            continue
        # Resolve owning row by panelRowIdx within the area's panelRows.
        # Skip None entries (sparse arrays appear when rowIndex is not 0-based,
        # e.g. single-row area whose only row has rowIndex=2 → panelRows is
        # serialized as [null, null, {...}]).
        owning_row = None
        for r in (owning_area.get('panelRows') or []):
            if r is None:
                continue
            if r.get('rowIndex', 0) == pri:
                owning_row = r
                break

        # Expected a/h: row → area → step2 default
        if owning_row is not None and owning_row.get('angleDeg') is not None:
            expected_angle = owning_row['angleDeg']
        elif owning_area.get('angleDeg') is not None:
            expected_angle = owning_area['angleDeg']
        else:
            expected_angle = default_angle

        if owning_row is not None and owning_row.get('frontHeightCm') is not None:
            expected_fh = owning_row['frontHeightCm']
        elif owning_area.get('frontHeightCm') is not None:
            expected_fh = owning_area['frontHeightCm']
        else:
            expected_fh = default_fh

        actual_angle = trap_cfg.get('angleDeg', 0) or 0
        actual_fh = trap_cfg.get('frontHeightCm', 0) or 0

        if abs(actual_angle - expected_angle) > AH_TOL:
            errors.append(
                f"Trap '{tid}' (area {agk}, row {pri}): angleDeg {actual_angle} "
                f"does not match owning row a/h {expected_angle}"
            )
        if abs(actual_fh - expected_fh) > AH_TOL:
            errors.append(
                f"Trap '{tid}' (area {agk}, row {pri}): frontHeightCm {actual_fh} "
                f"does not match owning row a/h {expected_fh}"
            )

    return errors


def get_project_areas(project: Project) -> list:
    """Return the step2 areas list."""
    return (project.data or {}).get('step2', {}).get('areas', [])


def _get_computed_areas(data: dict) -> list:
    """Return step3.computedAreas list."""
    return data.get('step3', {}).get('computedAreas', [])


def _get_computed_area(data: dict, area_id: int) -> dict | None:
    """Find a computed area by numeric id."""
    for ca in _get_computed_areas(data):
        if ca.get('areaId') == area_id:
            return ca
    return None


def _trapezoids_by_id(step2: dict) -> dict:
    """Convert step2.trapezoids array to a dict keyed by id for fast lookup."""
    traps = step2.get('trapezoids', [])
    if isinstance(traps, dict):          # legacy format
        return traps
    return {t['id']: t for t in traps if 'id' in t}


def _upsert_computed_area(step3: dict, area_id: int, label: str, updates: dict) -> None:
    """Insert or update a computed area entry by numeric id."""
    computed = step3.setdefault('computedAreas', [])
    for ca in computed:
        if ca.get('areaId') == area_id:
            ca.update(updates)
            return
    computed.append({'areaId': area_id, 'label': label, **updates})


def _upsert_computed_trapezoid(step3: dict, trap_id: str, detail: dict) -> None:
    """Insert or update a computed trapezoid entry by trapId."""
    computed = step3.setdefault('computedTrapezoids', [])
    for ct in computed:
        if ct.get('trapezoidId') == trap_id:
            ct.update(detail)
            return
    computed.append({'trapezoidId': trap_id, **detail})


def _derive_line_rails(computed_area: dict | None, row_index: int = 0) -> dict[str, list[float]]:
    """Group computed rails by lineIdx → sorted offsets.

    computed_area.rails is a dict[rowIndex → list[Rail]].
    Extracts rails for the given row_index.
    """
    if not computed_area:
        return {}
    rails_dict = computed_area.get('rails', {})
    # Support both new dict format and legacy list format
    if isinstance(rails_dict, list):
        rails_list = rails_dict
    else:
        rails_list = rails_dict.get(row_index) or rails_dict.get(str(row_index)) or []
    derived: dict[str, list] = {}
    for r in rails_list:
        li = str(r.get('lineIdx', 0))
        off = r.get('offsetFromLineFrontCm')
        if off is not None:
            derived.setdefault(li, []).append(off)
    return {li: sorted(offs) for li, offs in derived.items()}


def _build_rail_inputs(data: dict, area: dict, area_idx: int, app_defaults: dict,
                       panel_grid: dict | None = None) -> dict:
    """Extract rail computation inputs from project data for one area/row.

    panel_grid: explicit panel grid for one panel row. If not provided,
    falls back to legacy area.panelGrid (should not happen after migration).
    lineRails is per-trapezoid (shared across all rows in the area).
    """
    step2           = data.get('step2', {})
    step3           = data.get('step3', {})
    global_settings = step3.get('globalSettings') or {}
    area_settings_raw = step3.get('areaSettings') or {}
    if isinstance(area_settings_raw, list):
        area_settings = area_settings_raw[area_idx] if area_idx < len(area_settings_raw) else {}
    else:
        area_settings = area_settings_raw.get(str(area_idx)) or {}

    # lineRails: per-area setting (shared across all rows in the area)
    line_rails = area_settings.get('lineRails') or {}

    effective_grid = panel_grid if panel_grid is not None else (area.get('panelGrid') or {})

    return {
        'panel_grid':        effective_grid,
        'panel_width_cm':    step2.get('panelWidthCm'),
        'panel_length_cm':   step2.get('panelLengthCm'),
        'line_rails':        line_rails,
        'overhang_cm':       area_settings.get('railOverhangCm',  app_defaults['railOverhangCm']),
        'stock_lengths':     global_settings.get('stockLengths',   app_defaults['stockLengths']),
        'panel_gap_cm':      app_defaults['panelGapCm'],
        'rail_spacing_v_cm': area_settings.get('railSpacingV',    app_defaults['railSpacingV']),
        'rail_spacing_h_cm': area_settings.get('railSpacingH',    app_defaults['railSpacingH']),
        'rail_round_threshold_cm': global_settings.get('railRoundThresholdCm', app_defaults['railRoundThresholdCm']),
    }


async def compute_and_save_rails(db: AsyncSession, project: Project, rs, step3_data: dict | None = None) -> list:
    """Compute rails for all areas, persist to step3.computedAreas, return per-area results."""
    await db.refresh(project)
    data  = copy.deepcopy(project.data or {})
    if step3_data is not None:
        # Merge FE settings into step3, preserving server-computed keys
        existing_step3 = data.get('step3', {})
        for k in _SERVER_COMPUTED_STEP3_KEYS:
            if k in existing_step3 and k not in step3_data:
                step3_data[k] = existing_step3[k]
        # Deep merge globalSettings and areaSettings to preserve unrelated keys
        if 'globalSettings' in step3_data:
            existing_global = existing_step3.get('globalSettings') or {}
            step3_data['globalSettings'] = _deep_merge_settings(existing_global, step3_data['globalSettings'])
        if 'areaSettings' in step3_data:
            existing_area = existing_step3.get('areaSettings') or {}
            step3_data['areaSettings'] = _deep_merge_settings(existing_area, step3_data['areaSettings'])
        existing_step3.update(step3_data)
        data['step3'] = existing_step3
    step3 = data.setdefault('step3', {})
    areas = data.get('step2', {}).get('areas', [])
    result = []

    # Get settings from cache (no DB query)
    app_defaults = settings_cache.get_all_settings()

    step2 = data.get('step2', {})
    for i, area in enumerate(areas):
        area_id = area.get('id', i + 1)
        label = area.get('label') or str(i)

        # Iterate panel rows (multi-row areas)
        panel_rows = area.get('panelRows', [])
        if not panel_rows:
            # Legacy fallback: single panelGrid → treat as one row
            pg = area.get('panelGrid')
            panel_rows = [{'rowIndex': 0, 'panelGrid': pg}] if pg else []

        all_row_rails: dict[int, list] = {}
        total_large_gaps = 0
        for pr in panel_rows:
            # Skip None entries — panelRows can be sparse when a row's rowIndex
            # is not 0-based (e.g. single-row area with rowIndex=2 serializes as
            # [null, null, {...}]).
            if pr is None:
                continue
            row_idx = pr.get('rowIndex', 0)
            pg = pr.get('panelGrid') or {}
            computed = rs.compute_area_rails(**_build_rail_inputs(data, area, i, app_defaults, panel_grid=pg))
            # Round slope beam to whole cm by adjusting the last rail
            _round_slope_beam_rails(
                computed['rails'],
                pg,
                step2['panelWidthCm'],
                step2['panelLengthCm'],
                app_defaults['lineGapCm'],
                app_defaults['baseOverhangCm'],
            )
            all_row_rails[row_idx] = computed['rails']
            total_large_gaps += computed['numLargeGaps']

        _upsert_computed_area(step3, area_id, label, {
            'rails': all_row_rails,
            'numLargeGaps': total_large_gaps,
        })
        result.append({
            'areaId':       area_id,
            'areaLabel':    label,
            'rails':        all_row_rails,
            'numLargeGaps': total_large_gaps,
        })

    # Strip lineRails from step3.areaSettings before persisting
    area_settings_store = step3.get('areaSettings') or {}
    if isinstance(area_settings_store, dict):
        for cfg in area_settings_store.values():
            if isinstance(cfg, dict):
                cfg.pop('lineRails', None)
    elif isinstance(area_settings_store, list):
        for cfg in area_settings_store:
            if isinstance(cfg, dict):
                cfg.pop('lineRails', None)

    project.data = data
    flag_modified(project, 'data')
    await db.commit()
    return result


def _compute_trap_x_range(
    panel_grid: dict, trapezoid_id: str, trap_ids: list[str],
    trapezoids: dict, panel_width_cm: float, panel_length_cm: float, panel_gap_cm: float,
) -> tuple[float | None, float | None]:
    """
    Compute the X extent (start, end cm) for one trapezoid within an area.
    For single-trap areas returns (None, None) — use full area frame.
    For multi-trap areas, computes the X extent from panel positions on
    each trap's active lines.
    """
    if len(trap_ids) <= 1:
        return None, None

    rows = panel_grid.get('rows', [])
    if not rows:
        return None, None

    row_positions = panel_grid.get('rowPositions') or {}
    short_cm = panel_width_cm
    long_cm = panel_length_cm

    trap_cfg = trapezoids.get(trapezoid_id, {})
    line_orients = trap_cfg.get('lineOrientations', [])

    # Compute X extent from actual panel positions on active lines
    x_min = float('inf')
    x_max = float('-inf')
    for line_idx, orient in enumerate(line_orients):
        if is_empty_orientation(orient):
            continue
        if line_idx >= len(rows):
            continue
        cells = rows[line_idx]
        is_h = orient == PANEL_H
        panel_along = long_cm if is_h else short_cm
        stored = row_positions.get(str(line_idx))
        if stored:
            positions = stored
        else:
            row_orient = PANEL_H if any(c in (PANEL_H, PANEL_EH) for c in cells) else PANEL_V
            row_along = long_cm if row_orient == PANEL_H else short_cm
            positions = [
                i * (row_along + panel_gap_cm)
                for i, cell in enumerate(cells)
                if cell in REAL_PANELS
            ]
        if positions:
            x_min = min(x_min, positions[0])
            x_max = max(x_max, positions[-1] + panel_along)

    if x_min == float('inf'):
        return None, None

    trap_start = x_min
    trap_end = x_max

    return trap_start, trap_end


def _build_base_inputs(
    data: dict, area: dict, area_idx: int, app_defaults: dict,
    trapezoid_id: str, trapezoid_configs: dict | None = None,
    trap_start_cm: float | None = None, trap_end_cm: float | None = None,
    roof_spec: dict | None = None,
    panel_grid: dict | None = None, row_index: int = 0,
) -> dict:
    """Extract base computation inputs for one trapezoid within an area/row.

    panel_grid: explicit panel grid for one panel row.
    row_index: which panel row to derive line_rails from.
    """
    step2 = data.get('step2', {})
    area_id = area.get('id', area_idx + 1)

    # Line rails from computed area data (row-specific)
    computed_area = _get_computed_area(data, area_id)
    line_rails = _derive_line_rails(computed_area, row_index=row_index)

    trap_cfg = (trapezoid_configs or {}).get(trapezoid_id, {})
    custom_offsets = trap_cfg.get('customOffsets')

    effective_grid = panel_grid if panel_grid is not None else (area.get('panelGrid') or {})

    return {
        'panel_grid':          effective_grid,
        'panel_width_cm':      step2.get('panelWidthCm'),
        'panel_length_cm':     step2.get('panelLengthCm'),
        'line_rails':          line_rails,
        'edge_offset_mm':      trap_cfg.get('edgeOffsetMm',      app_defaults['edgeOffsetMm']),
        'spacing_mm':          trap_cfg.get('spacingMm',          app_defaults['spacingMm']),
        'base_overhang_cm':    trap_cfg.get('baseOverhangCm',     app_defaults['baseOverhangCm']),
        'cross_rail_offset_cm': app_defaults['crossRailEdgeDistMm'] / 10,
        'panel_gap_cm':        app_defaults['panelGapCm'],
        'line_gap_cm':         app_defaults['lineGapCm'],
        'trapezoid_id':        trapezoid_id,
        'trap_start_cm':       trap_start_cm,
        'trap_end_cm':         trap_end_cm,
        'custom_offsets':      custom_offsets,
        'roof_spec':           roof_spec,
        'edge_offset_tolerance_pct': trap_cfg.get('baseEdgeOffsetTolerance', app_defaults.get('baseEdgeOffsetTolerance', 0)),
    }

def _merge_step3_data(data: dict, step3_data: dict) -> None:
    """Merge incoming step3 payload into project data, preserving server-computed keys."""
    existing_step3 = data.get('step3', {})
    for k in _SERVER_COMPUTED_STEP3_KEYS:
        if k in existing_step3 and k not in step3_data:
            step3_data[k] = existing_step3[k]
    if 'globalSettings' in step3_data:
        existing_global = existing_step3.get('globalSettings') or {}
        step3_data['globalSettings'] = _deep_merge_settings(existing_global, step3_data['globalSettings'])
    if 'areaSettings' in step3_data:
        existing_area = existing_step3.get('areaSettings') or {}
        step3_data['areaSettings'] = _deep_merge_settings(existing_area, step3_data['areaSettings'])
    existing_step3.update(step3_data)
    data['step3'] = existing_step3


def _sync_custom_offsets(
    step3: dict, trapezoid_configs: dict | None,
) -> dict:
    """Persist/clear FE-sent custom offsets into step3. Returns the stored_custom dict."""
    stored_custom = step3.get('customBasesOffsets') or {}
    if trapezoid_configs:
        for trap_id, cfg in trapezoid_configs.items():
            co = cfg.get('customOffsets')
            row_idx = cfg.get('panelRowIdx', 0)
            row_key = f'{trap_id}:{row_idx}'
            if co is not None:
                if len(co) > 0:
                    stored_custom[row_key] = co
                else:
                    stored_custom.pop(row_key, None)
    step3['customBasesOffsets'] = stored_custom
    return stored_custom


def _resolve_trap_custom_offsets(
    trap_id: str, row_idx: int,
    effective_configs: dict, stored_custom: dict,
    has_existing_bases: bool, trap_frame_mm: float | None,
) -> None:
    """Resolve custom offsets for one trapezoid: FE-sent → stored DB.

    Mutates effective_configs[trap_id] and stored_custom in place.
    """
    trap_cfg = effective_configs[trap_id]
    row_custom_key = f'{trap_id}:{row_idx}'

    if 'customOffsets' in trap_cfg:
        # FE explicitly sent offsets (or reset with empty list) — use as-is
        if not trap_cfg['customOffsets']:
            trap_cfg.pop('customOffsets', None)
            stored_custom.pop(row_custom_key, None)
    else:
        # No FE override — try to restore from stored DB data
        stored = stored_custom.get(row_custom_key)
        if stored and has_existing_bases:
            frame_check = trap_frame_mm
            if frame_check is not None:
                if len(stored) >= 2 and max(stored) <= frame_check:
                    trap_cfg['customOffsets'] = stored
                else:
                    stored_custom.pop(row_custom_key, None)
            elif len(stored) >= 2:
                trap_cfg['customOffsets'] = stored


# ── Base → trap validation (signature-based) ───────────────────────────────
#
# Geometric cross-check: at each base's x-position, probe every line of the
# row's panelGrid and read the cell (V/H/EV/EH) at that x. The resulting
# per-line sequence is the base's "column signature". That signature must
# match exactly one of the area's trapezoids' lineOrientations — that's
# the trap the base truly belongs to.
#
# This independent method is used to validate the trapezoidId already assigned
# by compute_area_bases. Any mismatch is logged.


def _calc_base_trap_signature(
    base_x_cm: float,
    panel_grid: dict,
    panel_width_cm: float,
    panel_length_cm: float,
    panel_gap_cm: float,
) -> list[str | None]:
    """Build the per-line signature at base_x_cm by probing each line.

    Returns a list whose entries are 'V', 'H', 'EV', 'EH' (or None if the
    line has no orientation / pitch is invalid).

    A line's cells array may not span the full row width (e.g. an H-line with
    4 real panels covers less x than a V-line with 10 cols). When col_idx is
    beyond the array, or the probe lands in the inter-panel gap, the line is
    treated as carrying an implicit empty slot matching its orientation —
    this matches how the FE composes the trap's lineOrientations ('EV'/'EH'
    for virtual gaps within the row extent).
    """
    rows = panel_grid.get('rows', []) or []
    sig: list[str | None] = []
    for cells in rows:
        orient = infer_row_orientation(cells)
        if not orient:
            sig.append(None)
            continue
        is_h = orient == PANEL_H
        empty_code = PANEL_EH if is_h else PANEL_EV
        panel_along = panel_length_cm if is_h else panel_width_cm
        pitch = panel_along + panel_gap_cm
        if pitch <= 0:
            sig.append(None)
            continue
        col_idx = int(base_x_cm // pitch)
        within = base_x_cm - col_idx * pitch
        if col_idx < 0 or col_idx >= len(cells):
            # Probe is off the explicit grid for this line — treat as an
            # implicit empty slot of the line's orientation.
            sig.append(empty_code)
            continue
        if within >= panel_along:
            # Inter-panel gap on this line — also an implicit empty slot.
            sig.append(empty_code)
            continue
        sig.append(cells[col_idx])
    return sig


def _calc_base_trap_signature_with_fallback(
    base_x_cm: float,
    panel_grid: dict,
    panel_width_cm: float,
    panel_length_cm: float,
    panel_gap_cm: float,
) -> list[str | None]:
    """Signature probe with ± offset fallbacks.

    If the base falls in a gap and one or more lines return None, retry with
    small offsets (panel_gap_cm) and then a larger nudge (panel_width/4).
    Return the signature with the most real (V/H) entries.
    """
    nudges = [
        0.0,
        panel_gap_cm,
        -panel_gap_cm,
        panel_width_cm / 4,
        -panel_width_cm / 4,
    ]
    best_sig: list[str | None] = []
    best_real = -1
    for off in nudges:
        sig = _calc_base_trap_signature(
            base_x_cm + off, panel_grid,
            panel_width_cm, panel_length_cm, panel_gap_cm,
        )
        real_count = sum(1 for s in sig if s in REAL_PANELS)
        if real_count > best_real:
            best_real = real_count
            best_sig = sig
            if real_count == len([s for s in sig if s is not None]):
                # Every non-None line resolved to a real panel — good enough
                break
    return best_sig


def _match_trap_by_signature(
    sig: list[str | None],
    trap_ids: list[str],
    trapezoids_by_id: dict,
    row_angle_deg: float | None = None,
    row_front_height_cm: float | None = None,
) -> str | None:
    """Return the trap id that best matches the signature at the base.

    Primary key: `lineOrientations == sig`.
    Secondary (disambiguating) key: the row's a/h. Two traps with identical
    signatures but different mounting (angleDeg / frontHeightCm) can coexist
    within a single area when two rows share a column layout but differ in
    their row-level a/h — see Phase A (sigToTrap keys by signature + a/h on FE).

    Resolution:
      1. If exactly one trap matches the signature → that one.
      2. If several match → prefer the one whose a/h matches the row's a/h
         (within a tight tolerance). Fall back to the first signature match
         if a/h isn't supplied or nothing matches a/h.
    """
    AH_TOL = 0.01
    candidates: list[str] = []
    for tid in trap_ids:
        t = trapezoids_by_id.get(tid)
        if not t:
            continue
        if list(t.get('lineOrientations') or []) == sig:
            candidates.append(tid)

    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]

    # Multiple sig matches — disambiguate by row a/h if available.
    if row_angle_deg is not None or row_front_height_cm is not None:
        for tid in candidates:
            t = trapezoids_by_id.get(tid, {})
            t_ang = t.get('angleDeg')
            t_fh = t.get('frontHeightCm')
            ang_ok = (
                row_angle_deg is None
                or t_ang is None
                or abs((t_ang or 0) - (row_angle_deg or 0)) <= AH_TOL
            )
            fh_ok = (
                row_front_height_cm is None
                or t_fh is None
                or abs((t_fh or 0) - (row_front_height_cm or 0)) <= AH_TOL
            )
            if ang_ok and fh_ok:
                return tid

    # No a/h info or nothing matched — first signature match wins.
    return candidates[0]


def _reassign_row_base_traps_by_signature(
    bases: list,
    panel_grid: dict,
    trap_ids: list[str],
    trapezoids_by_id: dict,
    panel_width_cm: float,
    panel_length_cm: float,
    panel_gap_cm: float,
    area_label: str,
    row_idx: int,
    row_angle_deg: float | None = None,
    row_front_height_cm: float | None = None,
) -> None:
    """Assign each base's trapezoidId from its geometric column signature.

    Signature-based matching is the authoritative method: for each base we
    probe the row's panelGrid at the base's x position and read the per-line
    orientation (V/H/EV/EH). The resulting signature exactly matches one of
    the area's trapezoid configs — that's the correct trap.

    The original trapezoidId (from compute_area_bases + consolidation) is
    preserved only if the signature fails to resolve. Any disagreement
    between the two methods is logged as a warning for observability.
    """
    if not bases or not panel_grid or not trap_ids:
        return
    for i, base in enumerate(bases):
        base_x = base.get('offsetFromStartCm')
        if base_x is None:
            continue
        sig = _calc_base_trap_signature_with_fallback(
            base_x, panel_grid,
            panel_width_cm, panel_length_cm, panel_gap_cm,
        )
        expected = _match_trap_by_signature(
            sig, trap_ids, trapezoids_by_id,
            row_angle_deg=row_angle_deg,
            row_front_height_cm=row_front_height_cm,
        )
        original = base.get('trapezoidId')
        if expected is None:
            # Signature didn't match any trap — leave the original alone but
            # log so we can investigate.
            logger.warning(
                "[base trap sig] area %s row %s base %s (x=%s): no trap matches "
                "signature %s — keeping actual=%s",
                area_label, row_idx, base.get('baseId', f'B{i + 1}'),
                base_x, sig, original,
            )
            continue
        if original and original != expected:
            # Old method (compute_area_bases + consolidation) disagrees with
            # the geometric signature. Log and override — signature wins.
            logger.warning(
                "[base trap sig] area %s row %s base %s (x=%s): "
                "old=%s, sig=%s → using sig (old kept as validation)",
                area_label, row_idx, base.get('baseId', f'B{i + 1}'),
                base_x, original, expected,
            )
        base['trapezoidId'] = expected


def _compute_row_bases(
    bs, data: dict, area: dict, area_idx: int,
    trap_ids: list[str], trapezoids: dict,
    app_defaults: dict, roof_spec: dict,
    trapezoid_configs: dict | None,
    stored_custom: dict, has_existing_bases: bool,
    panel_grid: dict, row_idx: int,
) -> tuple[list, dict[str, dict | None], dict]:
    """Compute bases for one panel row across all trapezoids.

    Returns (row_bases, bases_data_map, consolidated).
    """
    step2 = data.get('step2', {})

    bases_data_map: dict[str, dict | None] = {}
    for trap_id in trap_ids:
        trap_start, trap_end = _compute_trap_x_range(
            panel_grid, trap_id, trap_ids, trapezoids,
            step2['panelWidthCm'], step2['panelLengthCm'],
            app_defaults['panelGapCm'],
        )
        trap_frame_mm = (
            round((trap_end - trap_start) * 10)
            if trap_start is not None and trap_end is not None else None
        )

        effective_configs = dict(trapezoid_configs or {})
        if trap_id not in effective_configs:
            effective_configs[trap_id] = {}

        _resolve_trap_custom_offsets(
            trap_id, row_idx, effective_configs, stored_custom,
            has_existing_bases, trap_frame_mm,
        )

        inputs = _build_base_inputs(
            data, area, area_idx, app_defaults, trap_id, effective_configs,
            trap_start, trap_end, roof_spec,
            panel_grid=panel_grid, row_index=row_idx,
        )
        bases_data_map[trap_id] = bs.compute_area_bases(**inputs)

    consolidated = bs.consolidate_area_bases(trap_ids, bases_data_map)
    row_bases = []
    for trap_id in trap_ids:
        row_bases.extend(consolidated.get(trap_id, []))

    return row_bases, bases_data_map, consolidated


async def compute_and_save_bases(
    db: AsyncSession, project: Project, bs,
    step3_data: dict | None = None, trapezoid_configs: dict | None = None,
) -> list:
    """Compute bases for all areas, persist to step3.computedAreas, return per-area results."""
    await db.refresh(project)
    data = copy.deepcopy(project.data or {})
    if step3_data is not None:
        _merge_step3_data(data, step3_data)
    step3 = data.setdefault('step3', {})
    step2 = data.get('step2', {})
    areas = step2.get('areas', [])
    trapezoids = _trapezoids_by_id(step2)
    app_defaults = settings_cache.get_all_settings()
    roof_spec = project.roof_spec or {'type': 'concrete'}

    # Tiles: no construction frame — skip base computation entirely
    if roof_spec.get('type') == 'tiles':
        project.data = data
        flag_modified(project, 'data')
        await db.commit()
        return []

    stored_custom = _sync_custom_offsets(step3, trapezoid_configs)
    result = []

    for i, area in enumerate(areas):
        area_id = area.get('id', i + 1)
        label = area.get('label') or str(i)
        trap_ids = area.get('trapezoidIds', [])
        if not trap_ids:
            trap_ids = [label]

        computed_area = _get_computed_area(data, area_id)
        existing_bases = computed_area.get('bases', {}) if computed_area else {}
        has_existing_bases = bool(existing_bases) and any(
            len(v) > 0 for v in (existing_bases.values() if isinstance(existing_bases, dict) else [existing_bases])
        )

        panel_rows = area.get('panelRows', [])
        if not panel_rows:
            pg = area.get('panelGrid')
            panel_rows = [{'rowIndex': 0, 'panelGrid': pg}] if pg else []

        all_row_bases: dict[int, list] = {}
        first_bases_data_map: dict[str, dict | None] = {}
        per_row_data: dict[int, dict] = {}

        for pr in panel_rows:
            # Skip None entries — panelRows can be sparse when a row's rowIndex
            # is not 0-based (e.g. single-row area with rowIndex=2).
            if pr is None:
                continue
            row_idx = pr.get('rowIndex', 0)
            pg = pr.get('panelGrid') or {}

            row_bases, bases_data_map, consolidated = _compute_row_bases(
                bs, data, area, i,
                trap_ids, trapezoids,
                app_defaults, roof_spec,
                trapezoid_configs, stored_custom, has_existing_bases,
                panel_grid=pg, row_idx=row_idx,
            )
            all_row_bases[row_idx] = row_bases
            if not first_bases_data_map:
                first_bases_data_map = bases_data_map
            per_row_data[row_idx] = {'basesDataMap': bases_data_map, 'consolidated': consolidated}

            # Authoritative trap assignment — probe each base's x-position
            # against the row's panelGrid to derive the column signature
            # (V/H/EV/EH per line) and match it to the owning trap. Row a/h
            # disambiguates traps with identical signatures but different
            # mounting (Phase A: sigToTrap keys on signature + a/h).
            row_ang = pr.get('angleDeg')
            if row_ang is None:
                row_ang = area.get('angleDeg')
            row_fh = pr.get('frontHeightCm')
            if row_fh is None:
                row_fh = area.get('frontHeightCm')
            _reassign_row_base_traps_by_signature(
                row_bases, pg, trap_ids, trapezoids,
                step2['panelWidthCm'], step2['panelLengthCm'],
                app_defaults['panelGapCm'],
                label, row_idx,
                row_angle_deg=row_ang,
                row_front_height_cm=row_fh,
            )

        _upsert_computed_area(step3, area_id, label, {'bases': all_row_bases})
        result.append({
            'areaId': area_id,
            'areaLabel': label,
            'bases': all_row_bases,
            'basesDataMap': first_bases_data_map,
            'trapIds': trap_ids,
            'consolidated': consolidated if panel_rows else {},
            'perRowData': per_row_data,
        })

    project.data = data
    flag_modified(project, 'data')
    await db.commit()
    return result


async def compute_and_save_external_diagonals(
    db: AsyncSession, project: Project, bs, bases_result: list,
) -> list:
    """
    Compute external diagonals for all areas (step 4 in the chain).

    Runs AFTER trapezoid details so heightRear/heightFront are available.
    Reads bases_data_map from bases_result and computed trapezoids from DB.
    Persists diagonals to step3.computedAreas[].diagonals.

    Returns separate diagonals list: [{ areaLabel, diagonals }, ...]
    """
    await db.refresh(project)
    data = copy.deepcopy(project.data or {})
    step3 = data.get('step3', {})
    computed_trapezoids = step3.get('computedTrapezoids', [])

    diagonals_result = []
    for area_res in bases_result:
        area_id = area_res.get('areaId', 0)
        label = area_res.get('areaLabel', '')
        trap_ids = area_res.get('trapIds', [])
        per_row_data = area_res.get('perRowData', {})

        # Compute external diagonals per panel row, tag each with panelRowIdx
        all_diagonals = []
        if per_row_data:
            for row_idx, row_data in sorted(per_row_data.items()):
                bdm = row_data.get('basesDataMap', {})
                cons = row_data.get('consolidated', {})
                if not bdm:
                    continue
                row_diags = bs.compute_external_diagonals(trap_ids, bdm, cons, computed_trapezoids)
                for d in row_diags:
                    d['panelRowIdx'] = row_idx
                all_diagonals.extend(row_diags)
        else:
            # Fallback: single-row (use basesDataMap from area_res)
            bases_data_map = area_res.get('basesDataMap', {})
            consolidated = area_res.get('consolidated', {})
            if bases_data_map:
                all_diagonals = bs.compute_external_diagonals(trap_ids, bases_data_map, consolidated, computed_trapezoids)

        _upsert_computed_area(step3, area_id, label, {'diagonals': all_diagonals})
        diagonals_result.append({'areaId': area_id, 'areaLabel': label, 'diagonals': all_diagonals})

    data['step3'] = step3
    project.data = data
    flag_modified(project, 'data')
    await db.commit()
    return diagonals_result


async def update_project_step(
    db: AsyncSession, project: Project, new_step: int,
    rs=None, bs=None, tds=None,
) -> dict:
    """
    Transition project to a new step with server-side data cleanup.
    Forward: resets dependent data and recomputes (e.g., rails+bases on 2→3).
    Backward: clears data from steps being navigated away from.
    """
    # Infer old step from navigation; if not set, assume one step before new_step
    # (the FE always saves before calling updateStep, so the transition is always ±1)
    nav_step = (project.navigation or {}).get('step')
    old_step = nav_step if nav_step is not None else max(1, new_step - 1)
    if new_step == old_step:
        return {'currentStep': old_step, 'clearedSteps': []}
    if new_step < 1 or new_step > 5:
        raise ValueError(f"Invalid step: {new_step}")

    data = copy.deepcopy(project.data or {})
    cleared = []
    rails_result = None
    bases_result = None

    if new_step > old_step:
        # ── Forward transitions: wipe all data from each step being entered ──
        for s in range(old_step + 1, new_step + 1):
            data[f'step{s}'] = {}
            cleared.append(f'step{s}')
    else:
        # ── Backward transitions: wipe all data from each step being left ──
        for s in range(old_step, new_step, -1):
            data[f'step{s}'] = {}
            cleared.append(f'step{s}')

    project.data = data
    nav = dict(project.navigation or {})
    nav['step'] = new_step
    nav['tab'] = None
    project.navigation = nav
    flag_modified(project, 'navigation')
    flag_modified(project, 'data')
    await db.commit()

    # ── Tiles: force angle=0, frontHeight=0 (no construction frame) ──
    roof_spec = project.roof_spec or {'type': 'concrete'}
    if roof_spec.get('type') == 'tiles':
        step2 = data.get('step2', {})
        step2['defaultAngleDeg'] = 0
        step2['defaultFrontHeightCm'] = 0
        for area in step2.get('areas', []):
            area['angleDeg'] = 0
            area['frontHeightCm'] = 0
        for trap in step2.get('trapezoids', []):
            trap['angleDeg'] = 0
            trap['frontHeightCm'] = 0
        project.data = data
        flag_modified(project, 'data')
        await db.commit()

    # ── Validate trapezoid assignments before computing step 3 ──
    # Log mismatches as warnings — does not block the transition (yet).
    # Will be promoted to a blocking error once FE save ordering is fixed.
    if new_step >= 3 and 'step3' in cleared:
        trap_errors = _validate_step2_trapezoids(project)
        if trap_errors:
            logger.warning(
                "[trap validate] %d issues for project %s: %s",
                len(trap_errors), project.id, '; '.join(trap_errors[:3]),
            )

        # Compare server-computed trap assignments with client-provided ones.
        # Log mismatches as warnings — does not block the transition (yet).
        from app.services.trapezoid_split_service import compare_with_client
        trap_mismatches = compare_with_client(project)
        if trap_mismatches:
            logger.warning(
                "Trapezoid split mismatch for project %s (%d issues): %s",
                project.id, len(trap_mismatches),
                '; '.join(trap_mismatches[:5]),
            )

    # ── Compute rails → bases → trapezoid details → external diagonals ──
    trapezoid_details = None
    diagonals_result = None
    if new_step >= 3 and 'step3' in cleared and rs and bs:
        rails_result = await compute_and_save_rails(db, project, rs)
        bases_result = await compute_and_save_bases(db, project, bs)
        if tds:
            trapezoid_details = await compute_and_save_trapezoid_details(db, project, tds)
        # External diagonals — after trapezoid details so heights are available
        diagonals_result = await compute_and_save_external_diagonals(db, project, bs, bases_result)

    # Re-read bases from DB after trapezoid computation (trapezoidId reassignment updates bases)
    if trapezoid_details and bases_result:
        await db.refresh(project)
        updated_step3 = (project.data or {}).get('step3', {})
        for area_res in bases_result:
            aid = area_res.get('areaId')
            for ca in updated_step3.get('computedAreas', []):
                if ca.get('areaId') == aid:
                    area_res['bases'] = ca.get('bases', {})
                    break

    # ── Auto-compute BOM on entering step 4 ──
    bom_result = None
    if new_step >= 4:
        await db.refresh(project)
        existing_bom = await bom_service.get_bom(db, project.id)
        if not existing_bom or bom_service.is_bom_stale(project.data or {}, existing_bom):
            bom_obj = await bom_service.compute_and_save_bom(db, project)
            bom_result = {'items': bom_obj.items, 'id': str(bom_obj.id)}

    # Return full project data — same structure as GET /projects/:id
    await db.refresh(project)
    result = {'currentStep': new_step, 'clearedSteps': cleared, 'data': project.data or {}}
    if bom_result:
        result['bom'] = bom_result
    return result


def _round_slope_beam_rails(
    rails: list[dict],
    panel_grid: dict,
    panel_width_cm: float,
    panel_length_cm: float,
    line_gap_cm: float,
    base_overhang_cm: float,
) -> None:
    """
    Adjust the last rail's offset so the slope beam length is a whole number.
    Profiles are physically cut to whole centimeters — fractional mm accuracy
    is impossible.  The last rail in the last active line absorbs the delta.
    Modifies rails list in place.
    """
    if not rails:
        return
    rows = panel_grid.get('rows', [])
    if not rows:
        return
    # Total depth = V lines × panelLength + H lines × panelWidth + gaps
    num_v = sum(1 for cells in rows if any(c == PANEL_V for c in cells))
    num_h = sum(1 for cells in rows if any(c == PANEL_H for c in cells) and not any(c == PANEL_V for c in cells))
    num_active = num_v + num_h
    total_depth = num_v * panel_length_cm + num_h * panel_width_cm + max(0, num_active - 1) * line_gap_cm
    # Rails are ordered by ID — first is rails[0], last is rails[-1]
    dist_from_start = rails[0]['offsetFromLineFrontCm']
    dist_from_end = rails[-1]['offsetFromRearEdgeCm']
    slope_beam = round_to_1dp(total_depth - dist_from_start - dist_from_end + 2 * base_overhang_cm)
    if slope_beam == math.floor(slope_beam):
        return  # already a whole number
    delta = round_to_1dp(slope_beam - math.floor(slope_beam))
    # Shift only the last rail (move it closer to reduce slope beam to whole cm)
    rails[-1]['offsetFromLineFrontCm'] = round_to_1dp(rails[-1]['offsetFromLineFrontCm'] - delta)
    rails[-1]['offsetFromRearEdgeCm'] = round_to_1dp(rails[-1]['offsetFromRearEdgeCm'] + delta)


def _compute_all_trapezoid_details(
    trapezoids: dict,
    areas: list,
    step2: dict,
    step3: dict,
    data: dict,
    app_defaults: dict,
    trapezoid_configs: dict | None,
    stored_custom_diags: dict,
    tds,
    roof_spec: dict,
) -> dict:
    """
    Compute structural details for all trapezoids (first pass — full trap computation).
    
    Returns dict of {trapId: detail_dict}.
    """
    result = {}
    area_settings = step3.get('areaSettings', {})
    global_settings = step3.get('globalSettings', {})
    
    for trap_id, trap_cfg in trapezoids.items():
        # Find the area this trap belongs to
        area = None
        area_idx = None
        for idx, a in enumerate(areas):
            if trap_id in a.get('trapezoidIds', []):
                area = a
                area_idx = idx
                break
        if not area:
            logging.error(
                f"Trapezoid '{trap_id}' not found in any area's trapezoidIds. "
                f"Available areas: {[(a.get('label'), a.get('trapezoidIds', [])) for a in areas]}. "
                f"Skipping trapezoid detail computation."
            )
            continue

        area_id = area.get('id', 0)

        # Build panel lines from trap's lineOrientations
        line_orients = trap_cfg.get('lineOrientations', [PANEL_V])

        # Derive line rails — only for active (non-empty) lines of this trapezoid.
        # Ghost rendering is handled by the FE overlaying the full trap's DetailView.
        # Use first panel row (row_index=0) — trapezoid geometry is shared across rows.
        computed_area = _get_computed_area(data, area_id)
        all_line_rails = _derive_line_rails(computed_area, row_index=0)
        line_rails = {
            li: offs for li, offs in all_line_rails.items()
            if int(li) < len(line_orients) and not is_empty_orientation(line_orients[int(li)])
        }
        # Build panel_lines only for active (non-empty) lines.
        # Remap line_rails keys to match the filtered panel_lines indices.
        panel_lines = []
        remapped_line_rails = {}
        active_idx = 0
        for li, orient in enumerate(line_orients):
            if is_empty_orientation(orient):
                continue  # skip empty lines — ghost handled by FE overlay
            is_h = orient == PANEL_H
            depth = step2['panelWidthCm'] if is_h else step2['panelLengthCm']
            gap = app_defaults['lineGapCm'] if active_idx > 0 else 0
            # Remap: original line index li → new active index active_idx
            if str(li) in line_rails:
                remapped_line_rails[str(active_idx)] = line_rails[str(li)]
            panel_lines.append({
                'depthCm': depth,
                'gapBeforeCm': gap,
                'isEmpty': False,
                'isHorizontal': is_h,
            })
            active_idx += 1

        # Use remapped line_rails (keys match filtered panel_lines indices)
        line_rails = remapped_line_rails

        t_cfg = (trapezoid_configs or {}).get(trap_id, {})
        angle = trap_cfg.get('angleDeg', 0)
        front_height = trap_cfg.get('frontHeightCm', 0)
        base_overhang = t_cfg.get('baseOverhangCm', app_defaults['baseOverhangCm'])

        # Derive bases_data from rail positions + overhang (independent of
        # consolidated bases — consolidation can remove bases for shallower traps).
        bases_data = None
        if line_rails:
            # Accumulate global rail offsets across panel lines
            all_rail_offsets = []
            d_cm = 0.0
            for si, seg in enumerate(panel_lines):
                d_cm += seg.get('gapBeforeCm', 0)
                for off in line_rails.get(str(si), []):
                    all_rail_offsets.append(d_cm + off)
                d_cm += seg.get('depthCm', 0)
            if all_rail_offsets:
                first_rail = min(all_rail_offsets)
                last_rail = max(all_rail_offsets)
                top_depth = first_rail - base_overhang
                bottom_depth = last_rail + base_overhang
                bases_data = {
                    'baseLengthCm': round_to_1dp(bottom_depth - top_depth),
                    'rearLegDepthCm': round_to_1dp(first_rail),
                    'frontLegDepthCm': round_to_1dp(last_rail),
                }

        rail_offset_cm = float(line_rails.get('0', [0])[0]) if line_rails.get('0') else 0

        custom_diags = stored_custom_diags.get(trap_id)
        
        # Merge area-specific settings with trapezoid-specific config
        # Priority: trapezoid config > area settings > app defaults
        merged_overrides = {}
        if area_idx is not None:
            area_specific = area_settings.get(str(area_idx), {})
            # Copy area settings (excluding lineRails and diagOverrides which are handled separately)
            for k, v in area_specific.items():
                if k not in ('lineRails', 'diagOverrides'):
                    merged_overrides[k] = v
        # Trapezoid-specific config overrides area settings
        merged_overrides.update(t_cfg)

        detail = tds.compute_trapezoid_details(
            bases_data=bases_data,
            line_rails=line_rails,
            panel_lines=panel_lines,
            angle_deg=angle,
            front_height_cm=front_height,
            rail_offset_cm=rail_offset_cm,
            settings=app_defaults,
            overrides=merged_overrides,
            custom_diagonals=custom_diags,
            global_settings=global_settings,
            roof_spec=roof_spec,
        )

        if detail:
            is_full = all(not is_empty_orientation(o) for o in line_orients)
            detail['isFullTrap'] = is_full
            result[trap_id] = detail
    
    return result


def _trim_non_full_trapezoids(
    result: dict,
    trapezoids: dict,
    areas: list,
    step2: dict,
    data: dict,
    app_defaults: dict,
    tds,
) -> None:
    """
    Second pass: trim non-full trapezoids to include only legs for active panel lines.
    
    Modifies result dict in place.
    """
    # Build per-area full trap lookup
    area_full_trap: dict[str, dict] = {}  # area label → full trap detail
    for a in areas:
        for tid in a.get('trapezoidIds', []):
            detail = result.get(tid)
            if detail and detail.get('isFullTrap'):
                area_full_trap[a.get('label', '')] = detail
                break

    for tid, detail in result.items():
        if detail.get('isFullTrap'):
            continue
        # Find this trap's area
        trap_area = None
        for a in areas:
            if tid in a.get('trapezoidIds', []):
                trap_area = a
                break
        if not trap_area:
            continue
        full_trap_detail = area_full_trap.get(trap_area.get('label', ''))
        if not full_trap_detail:
            continue
        full_geom = full_trap_detail.get('geometry', {})
        full_origin = full_geom.get('originCm', 0)
        full_front_ext = full_geom.get('frontExtensionCm', 0)

        # Normalize: temporarily subtract rear_ext from full trap legs so the
        # trim logic works in the original coordinate system (first leg at 0).
        # After trimming, _trim_trapezoid rebases and we add the offset back.
        normalized_full = {**full_trap_detail}
        if full_front_ext:
            normalized_full['legs'] = []
            for leg in full_trap_detail.get('legs', []):
                nl = {**leg, 'positionCm': round_to_1dp(leg['positionCm'] - full_front_ext),
                       'positionEndCm': round_to_1dp((leg.get('positionEndCm', leg['positionCm'] + full_geom.get('beamThickCm', 4)) - full_front_ext))}
                if 'railPositionCm' in leg:
                    nl['railPositionCm'] = round_to_1dp(leg['railPositionCm'] - full_front_ext)
                normalized_full['legs'].append(nl)

        trap_cfg_local = trapezoids.get(tid, {})
        local_orients = trap_cfg_local.get('lineOrientations', [PANEL_V])
        trap_area_id = trap_area.get('id', 0)
        trap_computed_area = _get_computed_area(data, trap_area_id)
        trap_all_line_rails = _derive_line_rails(trap_computed_area)

        # Build active rail positions from normalized leg railPositionCm values
        full_rail_positions = {}
        for leg in normalized_full.get('legs', [])[1:-1]:
            rp = leg.get('railPositionCm')
            if rp is not None:
                full_rail_positions[round(rp, 1)] = True
        # Compute approx in original coords (no extension offset)
        active_rail_positions = set()
        d_cm = 0.0
        for li, orient in enumerate(local_orients):
            is_h = orient == PANEL_H
            depth = step2['panelWidthCm'] if is_h else step2['panelLengthCm']
            gap = app_defaults['lineGapCm'] if li > 0 else 0
            d_cm += gap
            if not is_empty_orientation(orient):
                for off in trap_all_line_rails.get(str(li), []):
                    approx = round(d_cm + off - full_origin, 1)
                    for frp in full_rail_positions:
                        if abs(frp - approx) < 1.5:
                            active_rail_positions.add(frp)
                            break
                    else:
                        active_rail_positions.add(approx)
            d_cm += depth

        detail = tds.trim_trapezoid(
            detail, normalized_full, active_rail_positions, full_origin,
            local_orients, step2.get('panelWidthCm'), step2.get('panelLengthCm'),
            app_defaults['lineGapCm'],
        )
        result[tid] = detail

        # Re-apply extension to trimmed trap
        if full_front_ext or full_geom.get('rearExtensionCm', 0):
            full_rear_ext = full_geom.get('rearExtensionCm', 0)
            geom = detail['geometry']
            # Shift legs back into base beam coords
            for leg in detail.get('legs', []):
                leg['positionCm'] = round_to_1dp(leg['positionCm'] + full_front_ext)
                if 'positionEndCm' in leg:
                    leg['positionEndCm'] = round_to_1dp(leg['positionEndCm'] + full_front_ext)
                if 'railPositionCm' in leg:
                    leg['railPositionCm'] = round_to_1dp(leg['railPositionCm'] + full_front_ext)
            # Shift base beam punches by rear extension offset
            for p in detail.get('punches', []):
                if p['beamType'] == 'base':
                    p['positionCm'] = round_to_1dp(p['positionCm'] + full_front_ext)
            # Extend base beam length and copy extension info
            geom['baseBeamLength'] = round_to_1dp(geom.get('baseBeamLength', 0) + full_front_ext + full_rear_ext)
            geom['frontExtensionCm'] = full_front_ext
            geom['rearExtensionCm'] = full_rear_ext


def _align_blocks_across_trapezoids(
    result: dict,
    areas: list,
    tds,
) -> dict[str, list[str]]:
    """
    Align block positions across trapezoids in same area (shared physical base beams).
    
    Returns area_trap_map: {area_label: [trapId, ...]}
    """
    area_trap_map = {}
    for a in areas:
        label = a.get('label', '')
        for tid in a.get('trapezoidIds', []):
            area_trap_map.setdefault(label, []).append(tid)
    for label, trap_ids in area_trap_map.items():
        area_traps = {tid: result[tid] for tid in trap_ids if tid in result}
        tds.align_blocks(area_traps)
        result.update(area_traps)
    return area_trap_map


async def compute_and_save_trapezoid_details(
    db: AsyncSession, project: Project, tds,
    step3_data: dict | None = None, trapezoid_configs: dict | None = None,
) -> dict:
    """Compute trapezoid details for all traps, persist to step3.computedTrapezoids, return results."""
    await db.refresh(project)
    data = copy.deepcopy(project.data or {})
    if step3_data is not None:
        existing_step3 = data.get('step3', {})
        for k in _SERVER_COMPUTED_STEP3_KEYS:
            if k in existing_step3 and k not in step3_data:
                step3_data[k] = existing_step3[k]
        # Deep merge globalSettings and areaSettings to preserve unrelated keys
        if 'globalSettings' in step3_data:
            existing_global = existing_step3.get('globalSettings') or {}
            step3_data['globalSettings'] = _deep_merge_settings(existing_global, step3_data['globalSettings'])
        if 'areaSettings' in step3_data:
            existing_area = existing_step3.get('areaSettings') or {}
            step3_data['areaSettings'] = _deep_merge_settings(existing_area, step3_data['areaSettings'])
        existing_step3.update(step3_data)
        data['step3'] = existing_step3
    step2 = data.get('step2', {})
    step3 = data.setdefault('step3', {})
    trapezoids = _trapezoids_by_id(step2)
    areas = step2.get('areas', [])
    global_settings = step3.get('globalSettings', {})

    # Get settings from cache (no DB query)
    app_defaults = settings_cache.get_all_settings()

    roof_spec = project.roof_spec or {'type': 'concrete'}

    # Tiles: no construction frame — skip trapezoid detail computation entirely
    if roof_spec.get('type') == 'tiles':
        project.data = data
        flag_modified(project, 'data')
        await db.commit()
        return {}

    # Stored custom diagonals
    stored_custom_diags = step3.get('customDiagonals', {})
    if trapezoid_configs:
        for trap_id, cfg in trapezoid_configs.items():
            cd = cfg.get('customDiagonals')
            if cd is not None:
                if cd:
                    stored_custom_diags[trap_id] = cd
                else:
                    stored_custom_diags.pop(trap_id, None)
    step3['customDiagonals'] = stored_custom_diags

    # ── Compute all trapezoids (first pass — full trap computation) ────────────
    result = _compute_all_trapezoid_details(
        trapezoids, areas, step2, step3, data, app_defaults,
        trapezoid_configs, stored_custom_diags, tds, roof_spec,
    )
    
    # Persist first pass results
    for tid, detail in result.items():
        _upsert_computed_trapezoid(step3, tid, detail)

    # ── Trim non-full trapezoids (second pass) ──────────────────────────────────
    _trim_non_full_trapezoids(
        result, trapezoids, areas, step2, data, app_defaults, tds,
    )
    
    # Persist trimmed results
    for tid, detail in result.items():
        _upsert_computed_trapezoid(step3, tid, detail)

    # ── Align blocks across area trapezoids ─────────────────────────────────────
    # (Legacy length-based base-trap reassignment removed — base trap IDs are
    # now assigned authoritatively in compute_and_save_bases via the geometric
    # column-signature method _reassign_row_base_traps_by_signature.)
    _align_blocks_across_trapezoids(result, areas, tds)

    # ── Persist aligned blocks ────────────────────────────────────────────────
    for tid, detail in result.items():
        _upsert_computed_trapezoid(step3, tid, detail)

    project.data = data
    flag_modified(project, 'data')
    await db.commit()

    return result


async def save_tab(
    db: AsyncSession, project: Project, tab: str,
    rs, bs, tds=None,
    step3_data: dict | None = None, trapezoid_configs: dict | None = None,
    overrides: dict | None = None,
) -> dict:
    """
    Save data from the active tab, recompute dependents, and return all step 3 data.
    Tab dependency: rails → bases → trapezoids.
    
    Args:
        overrides: New-format user edit data: {'rails': {...}, 'bases': {...}, 'diagonals': {...}}
    """
    # Update navigation.tab
    nav = dict(project.navigation or {'step': 1})
    nav['tab'] = tab
    project.navigation = nav
    flag_modified(project, 'navigation')
    await db.commit()

    # Convert new overrides format to legacy format for backward compatibility
    if overrides:
        step3_data = step3_data or {}
        
        # Rails overrides → areaSettings[].lineRails
        if 'rails' in overrides and overrides['rails']:
            area_settings = step3_data.setdefault('areaSettings', {})
            for area_label, line_rails in overrides['rails'].items():
                # Find area index by label
                data = copy.deepcopy(project.data or {})
                areas = data.get('step2', {}).get('areas', [])
                for idx, area in enumerate(areas):
                    if (area.get('label') or area.get('id')) == area_label:
                        area_cfg = area_settings.setdefault(str(idx), {})
                        area_cfg['lineRails'] = line_rails
                        break
        
        # Bases overrides → trapezoidConfigs[].customOffsets
        if 'bases' in overrides and overrides['bases']:
            trapezoid_configs = trapezoid_configs or {}
            for key, offsets in overrides['bases'].items():
                # Key format: "trapId:rowIdx" (per-row) or plain "trapId"
                if ':' in key:
                    trap_id, row_idx_str = key.rsplit(':', 1)
                    row_idx = int(row_idx_str)
                else:
                    trap_id = key
                    row_idx = 0
                trap_cfg = trapezoid_configs.setdefault(trap_id, {})
                trap_cfg['customOffsets'] = offsets
                trap_cfg['panelRowIdx'] = row_idx
        
        # Diagonal overrides → trapezoidConfigs[].customDiagonals
        # New format: { trapId: { spanId: [topPct, botPct] | {disabled: true} } }
        # Legacy storage: { trapId: { "0": {topPct, botPct}, "1": {...} } }
        if 'diagonals' in overrides and overrides['diagonals']:
            trapezoid_configs = trapezoid_configs or {}
            for trap_id, diag_obj in overrides['diagonals'].items():
                # Convert simplified format to full object format for legacy storage
                expanded_obj = {}
                for span_id, value in diag_obj.items():
                    if isinstance(value, list) and len(value) == 2:
                        # Array format: [topPct, botPct]
                        expanded_obj[str(span_id)] = {
                            'topPct': value[0],
                            'botPct': value[1]
                        }
                    elif isinstance(value, dict):
                        # Object format: {disabled: true} or {topPct, botPct}
                        expanded_obj[str(span_id)] = value
                
                trap_cfg = trapezoid_configs.setdefault(trap_id, {})
                trap_cfg['customDiagonals'] = expanded_obj

    # Any tab change recomputes the full chain: rails → bases → trapezoid details → external diagonals
    rails_result = await compute_and_save_rails(db, project, rs, step3_data)
    bases_result = await compute_and_save_bases(db, project, bs, step3_data, trapezoid_configs)
    trapezoid_details = {}
    if tds:
        trapezoid_details = await compute_and_save_trapezoid_details(
            db, project, tds, step3_data, trapezoid_configs,
        )
    # External diagonals — after trapezoid details so heights are available
    diagonals_result = await compute_and_save_external_diagonals(db, project, bs, bases_result)

    # Re-read bases from DB after trapezoid computation (trapezoidId reassignment updates bases)
    if trapezoid_details and bases_result:
        await db.refresh(project)
        updated_step3 = (project.data or {}).get('step3', {})
        for area_res in bases_result:
            aid = area_res.get('areaId')
            for ca in updated_step3.get('computedAreas', []):
                if ca.get('areaId') == aid:
                    area_res['bases'] = ca.get('bases', {})
                    break

    # Return full project data — same structure as GET /projects/:id
    await db.refresh(project)
    return {'data': project.data or {}}


async def reset_tab(
    db: AsyncSession, project: Project, tab: str,
    rs, bs, tds=None,
) -> dict:
    """
    Reset a tab to server defaults: clear FE settings for the tab, recompute everything.
    """
    data = copy.deepcopy(project.data or {})
    step3 = data.setdefault('step3', {})

    # Clear FE-owned settings for this tab
    if tab == 'rails':
        # Clear area-level rail overrides and global rail settings
        for area_settings in (step3.get('areaSettings') or {}).values():
            if isinstance(area_settings, dict):
                for key in ['lineRails', 'railOverhangCm', 'railSpacingV', 'railSpacingH', 'keepSymmetry']:
                    area_settings.pop(key, None)
        gs = step3.get('globalSettings') or {}
        for key in ['stockLengths', 'crossRailEdgeDistMm']:
            gs.pop(key, None)
        step3['globalSettings'] = gs
    elif tab == 'bases':
        step3.pop('customBasesOffsets', None)
        for area_settings in (step3.get('areaSettings') or {}).values():
            if isinstance(area_settings, dict):
                for key in ['edgeOffsetMm', 'spacingMm', 'baseOverhangCm']:
                    area_settings.pop(key, None)
    elif tab == 'trapezoids':
        step3.pop('customDiagonals', None)

    project.data = data
    flag_modified(project, 'data')
    await db.commit()

    return await save_tab(db, project, tab, rs, bs, tds)


async def approve_plan(db: AsyncSession, project: Project, user: User, strict_consent: bool) -> Project:
    data = copy.deepcopy(project.data or {})
    step4 = data.setdefault('step4', {})

    if strict_consent:
        step4['planApproval'] = {
            'date':          date.today().isoformat(),
            'strictConsent': True,
            'performedBy': {
                'userId':   str(user.id),
                'email':    user.email,
                'fullName': user.full_name,
            },
        }
    else:
        step4['planApproval'] = None

    project.data = data
    flag_modified(project, 'data')
    await db.commit()
    await db.refresh(project)
    return project
