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
from app.services.trapezoid_detail_service import _compute_block_punches, trim_trapezoid, group_identical_trapezoids
from app.services import settings_cache
from app.services import credits as credits_service
from app.utils.math_helpers import round_to_1dp
from app.utils.panel_geometry import (
    is_empty_orientation, infer_row_orientation,
    PANEL_V, PANEL_H, PANEL_EV, PANEL_EH, REAL_PANELS
)
from app.utils.settings_helpers import resolve_roof_spec, is_frameless_roof_type
from app.schemas.project_data import Step2Data, Step3Data, Step4Data, Step5Data


class StepTransitionInvalidError(Exception):
    """Raised when a step transition fails its server-side validation.

    Generic across all transitions so each (old_step, new_step) pair can
    add its own validator without inventing a new exception class. The
    router maps this to a 400 with a structured body the FE translates.
    """
    def __init__(self, from_step: int, to_step: int, errors: list[dict]):
        super().__init__(f'step_transition_invalid ({from_step}->{to_step})')
        self.from_step = from_step
        self.to_step = to_step
        self.errors = errors


def _validate_step_transition(project: Project, old_step: int, new_step: int) -> list[dict]:
    """Run all server-side validations for a specific step transition.

    Generic entry point — add new (old_step, new_step) branches below as
    other transitions get rules. Returns an empty list when the transition
    is valid.
    """
    if old_step == 2 and new_step == 3:
        return _validate_step2_for_advance(project.data or {}, project.roof_spec)
    # Future transitions: add branches here.
    return []


def _validate_step2_for_advance(data: dict, project_roof_spec: dict | None) -> list[dict]:
    """Validate step2 before allowing a 2→3 transition.

    Mirrors the FE `canProceedToNextStep` rules so the BE acts as a
    safety net with the same semantics. Returns a list of structured
    errors (empty list = valid). Each entry has:
        code   — i18n key the FE looks up (e.g. 'area.angle.outOfRange')
        field  — JSON-Pointer-ish path the FE can use to scroll/highlight
        params — values to interpolate into the translated message
    """
    errors: list[dict] = []
    project_type = (project_roof_spec or {}).get('type', 'concrete')
    step2 = (data or {}).get('step2', {})
    areas = step2.get('areas', []) or []

    if not areas:
        errors.append({'code': 'noAreas', 'field': 'areas', 'params': {}})
        return errors

    # Same bounds the FE reads via the paramSchema (app_settings table).
    ang_min = settings_cache.get_min('mountingAngleDeg')
    ang_max = settings_cache.get_max('mountingAngleDeg')
    fh_min  = settings_cache.get_min('frontHeightCm')
    fh_max  = settings_cache.get_max('frontHeightCm')

    default_ang = step2.get('defaultAngleDeg')
    default_fh  = step2.get('defaultFrontHeightCm')

    def in_range(v, lo, hi):
        return isinstance(v, (int, float)) and lo <= v <= hi

    for area_idx, area in enumerate(areas):
        spec = resolve_roof_spec(project_roof_spec, area)
        area_type = spec.get('type', 'concrete')
        raw_label = area.get('label')
        area_label = raw_label if isinstance(raw_label, str) and raw_label.strip() else str(area_idx)

        if not isinstance(raw_label, str) or not raw_label.strip():
            errors.append({
                'code': 'area.label.empty',
                'field': f'areas[{area_idx}].label',
                'params': {'areaIdx': area_idx},
            })

        if is_frameless_roof_type(area_type):
            continue  # frameless areas (tiles, flat_installation) have no construction frame → a/h irrelevant

        eff_ang = area.get('angleDeg') if area.get('angleDeg') is not None else default_ang
        eff_fh  = area.get('frontHeightCm') if area.get('frontHeightCm') is not None else default_fh

        if eff_ang is None:
            errors.append({
                'code': 'area.angle.missing',
                'field': f'areas[{area_idx}].angleDeg',
                'params': {'areaLabel': area_label},
            })
        elif not in_range(eff_ang, ang_min, ang_max):
            errors.append({
                'code': 'area.angle.outOfRange',
                'field': f'areas[{area_idx}].angleDeg',
                'params': {'areaLabel': area_label, 'min': ang_min, 'max': ang_max, 'value': eff_ang},
            })

        if eff_fh is None:
            errors.append({
                'code': 'area.frontHeight.missing',
                'field': f'areas[{area_idx}].frontHeightCm',
                'params': {'areaLabel': area_label},
            })
        elif not in_range(eff_fh, fh_min, fh_max):
            errors.append({
                'code': 'area.frontHeight.outOfRange',
                'field': f'areas[{area_idx}].frontHeightCm',
                'params': {'areaLabel': area_label, 'min': fh_min, 'max': fh_max, 'value': eff_fh},
            })

        # Per-row a/h overrides — bounds only, missing = inherit from area
        for ri, pr in enumerate(area.get('panelRows') or []):
            if pr is None:
                continue
            row_ang = pr.get('angleDeg')
            row_fh  = pr.get('frontHeightCm')
            if row_ang is not None and not in_range(row_ang, ang_min, ang_max):
                errors.append({
                    'code': 'row.angle.outOfRange',
                    'field': f'areas[{area_idx}].panelRows[{ri}].angleDeg',
                    'params': {'areaLabel': area_label, 'rowIdx': ri,
                               'min': ang_min, 'max': ang_max, 'value': row_ang},
                })
            if row_fh is not None and not in_range(row_fh, fh_min, fh_max):
                errors.append({
                    'code': 'row.frontHeight.outOfRange',
                    'field': f'areas[{area_idx}].panelRows[{ri}].frontHeightCm',
                    'params': {'areaLabel': area_label, 'rowIdx': ri,
                               'min': fh_min, 'max': fh_max, 'value': row_fh},
                })

        # Purlin distance is per-area only for mixed projects with purlin types.
        # For non-mixed iskurit/insulated_panel the distance lives on the
        # project's roof_spec and is enforced upstream (project setup).
        if project_type == 'mixed' and area_type in ('iskurit', 'insulated_panel'):
            dist = (area.get('roofSpec') or {}).get('distanceBetweenPurlinsCm')
            if not (isinstance(dist, (int, float)) and dist > 0):
                errors.append({
                    'code': 'area.purlinDistance.missing',
                    'field': f'areas[{area_idx}].roofSpec.distanceBetweenPurlinsCm',
                    'params': {'areaLabel': area_label},
                })

    return errors


async def list_projects(
    db: AsyncSession,
    owner_id: uuid.UUID,
    is_admin: bool = False,
    limit: int | None = None,
    offset: int = 0,
    search: str | None = None,
) -> tuple[list[Project], int]:
    """List projects with optional pagination and search.
    If is_admin=True, return all projects; otherwise filter by owner_id.
    Returns tuple of (projects_list, total_count).
    """
    from sqlalchemy import func, or_

    # Build base query
    if is_admin:
        query = select(Project).options(selectinload(Project.owner))
    else:
        query = select(Project).where(Project.owner_id == owner_id)

    # Apply search filter
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        conditions = [
            Project.name.ilike(pattern),
            Project.location.ilike(pattern),
        ]
        if is_admin:
            query = query.outerjoin(User, Project.owner_id == User.id)
            conditions.append(User.email.ilike(pattern))
        query = query.where(or_(*conditions))

    # Get total count (after search filter)
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Apply ordering, offset, and limit
    query = query.order_by(Project.updated_at.desc())
    if offset > 0:
        query = query.offset(offset)
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


async def get_project_for_user(
    db: AsyncSession,
    project_id: uuid.UUID,
    user: User,
) -> Project | None:
    """Fetch a project if `user` is allowed to access it.

    Admins see any project; regular users only their own. Returns None if the
    project doesn't exist OR the user isn't allowed to see it (caller decides
    whether to 404 or 403; we conflate them here to avoid leaking existence).
    """
    query = select(Project).where(Project.id == project_id)
    if user.role.value != "admin":
        query = query.where(Project.owner_id == user.id)
    project = (await db.execute(query)).scalar_one_or_none()
    if project is not None and isinstance(project.data, dict):
        areas = project.data.get('step2', {}).get('areas', [])
        if any(not isinstance(a.get('id'), int) for a in areas):
            _assign_area_ids(project.data)
            flag_modified(project, 'data')
            await db.commit()
            await db.refresh(project)
    return project


async def create_project(db: AsyncSession, owner_id: uuid.UUID, payload: ProjectCreate) -> Project:
    project = Project(owner_id=owner_id, **payload.model_dump())
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project


# ── Server-computed keys in step3 — never sent by FE, always preserved during merge ──
_SERVER_COMPUTED_STEP3_KEYS = {'computedAreas', 'computedTrapezoids', 'trapezoidGroups'}


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
        # Validate through schema — strips unknown fields, enforces types
        _validate_data(merged)

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


_STEP_SCHEMAS = {
    'step2': Step2Data,
    'step3': Step3Data,
    'step4': Step4Data,
    'step5': Step5Data,
}


def _validate_data(data: dict) -> None:
    """Validate data through Pydantic schema — strips unknown fields, enforces types."""
    for step_key, model_cls in _STEP_SCHEMAS.items():
        raw = data.get(step_key)
        if raw and isinstance(raw, dict):
            data[step_key] = model_cls.model_validate(raw).model_dump()


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
    """Insert or update a computed trapezoid entry by trapId.

    REPLACES the entry rather than shallow-merging, so keys present in the
    previous detail but absent from `detail` (e.g. punches/blocks tied to
    a base that was just removed) do not leak forward. Reset-to-defaults
    relies on this: clearing customBasesOffsets and recomputing must
    actually drop the geometry derived from the user's prior bases.
    """
    computed = step3.setdefault('computedTrapezoids', [])
    new_entry = {'trapezoidId': trap_id, **detail}
    for i, ct in enumerate(computed):
        if ct.get('trapezoidId') == trap_id:
            computed[i] = new_entry
            return
    computed.append(new_entry)


def _derive_line_rails(computed_area: dict | None, row_index: int = 0) -> dict[str, list[float]]:
    """Group computed rails by lineIdx → sorted unique offsets.

    computed_area.rails is a dict[rowIndex → list[Rail]].
    Extracts rails for the given row_index. When a line is split into multiple
    segments (large gaps), each segment emits the same Y-offsets, so we dedupe
    by offset value — the trapezoid cross-section is segment-invariant and only
    needs one rail per (line, Y-offset).
    """
    if not computed_area:
        return {}
    rails_dict = computed_area.get('rails', {})
    # Support both new dict format and legacy list format
    if isinstance(rails_dict, list):
        rails_list = rails_dict
    else:
        rails_list = rails_dict.get(row_index) or rails_dict.get(str(row_index)) or []
    derived: dict[str, set[float]] = {}
    for r in rails_list:
        li = str(r.get('lineIdx', 0))
        off = r.get('offsetFromLineFrontCm')
        if off is not None:
            derived.setdefault(li, set()).add(off)
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
        'long_rail_threshold_cm':      app_defaults['longRailThresholdCm'],
        'long_rail_extra_overhang_cm': app_defaults['longRailExtraOverhangCm'],
        'rail_round_threshold_cm': global_settings.get('railRoundThresholdCm', app_defaults['railRoundThresholdCm']),
        'rail_min_cut_cm':         global_settings.get('railMinCutCm',         app_defaults['railMinCutCm']),
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

        # Cross-row concat: sibling sub-rows of the same area may have rails at
        # identical slope-Y positions (e.g. when a row was Recalc-split by
        # column voids). Emit area-level cross-row rails for the material
        # summary; source rails are annotated with `crrId` so the
        # FE can fade them out.
        annotated_row_rails, cross_row_rails = rs.concat_cross_row_rails(
            panel_rows=panel_rows,
            all_row_rails=all_row_rails,
            panel_length_cm=step2['panelLengthCm'],
            panel_width_cm=step2['panelWidthCm'],
            line_gap_cm=app_defaults['lineGapCm'],
            panel_gap_cm=app_defaults['panelGapCm'],
            stock_lengths=app_defaults['stockLengths'],
            rail_round_threshold_cm=app_defaults.get('railRoundThresholdCm', 0) or 0,
            rail_min_cut_cm=app_defaults.get('railMinCutCm', 0) or 0,
        )

        _upsert_computed_area(step3, area_id, label, {
            'rails': annotated_row_rails,
            'crossRowRails': cross_row_rails,
            'numLargeGaps': total_large_gaps,
        })
        result.append({
            'areaId':        area_id,
            'areaLabel':     label,
            'rails':         annotated_row_rails,
            'crossRowRails': cross_row_rails,
            'numLargeGaps':  total_large_gaps,
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

    # Merge incoming trap-cfg over the persisted schema params (step3.trapezoidConfigs).
    # Incoming wins, so a partial update from the FE still works; the persisted
    # store ensures values survive across reloads / requests that don't carry
    # the full trap config.
    persisted_traps = (data.get('step3') or {}).get('trapezoidConfigs') or {}
    trap_cfg = {
        **(persisted_traps.get(trapezoid_id) or {}),
        **((trapezoid_configs or {}).get(trapezoid_id, {})),
    }

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


# Trap-scope schema params that the FE edits via the sidebar. Persisted under
# `data.step3.trapezoidConfigs[trapId]` so they survive project reload —
# without this, the compute pipeline accepted them per-request but never wrote
# them back. Drag-edit data (base position overrides, diagonal overrides)
# lives in dedicated step3 paths (customBasesOffsets, customDiagonals) and
# is intentionally NOT mixed into trapezoidConfigs.
TRAP_SCHEMA_PARAM_KEYS = (
    'edgeOffsetMm', 'spacingMm', 'baseOverhangCm',  # bases tab
    'extendFront', 'extendRear',                    # detail tab
)


async def _persist_trap_schema_configs(db: AsyncSession, project: Project, trapezoid_configs: dict) -> None:
    """Merge incoming trap-scope schema params into project.data.step3.trapezoidConfigs.

    Must commit before the downstream compute chain — compute_and_save_rails
    refreshes the project from the DB, which would discard an uncommitted
    in-memory mutation.
    """
    data = copy.deepcopy(project.data or {})
    step3 = data.setdefault('step3', {})
    stored = step3.setdefault('trapezoidConfigs', {})
    if not isinstance(stored, dict):
        stored = {}
    dirty = False
    for trap_id, cfg in trapezoid_configs.items():
        if not isinstance(cfg, dict):
            continue
        schema_only = {k: v for k, v in cfg.items() if k in TRAP_SCHEMA_PARAM_KEYS}
        if not schema_only:
            continue
        existing = stored.get(trap_id) or {}
        merged = {**existing, **schema_only}
        if merged != existing:
            stored[trap_id] = merged
            dirty = True
    if dirty:
        step3['trapezoidConfigs'] = stored
        project.data = data
        flag_modified(project, 'data')
        await db.commit()


def _sync_custom_offsets(step3: dict) -> dict:
    """Return the persisted user position-override snapshot dict.

    The snapshot is the input `_apply_persisted_position_overrides`
    reads to layer user edits onto the default positions. Save_tab is
    the sole writer — it translates an incoming `overrides.bases` ops
    list (or legacy snapshot dict) into entries via `_ops_to_base_snapshot`
    and persists them BEFORE compute runs. By the time we reach here, the
    snapshot already reflects every accumulated user edit; this function
    just guarantees the dict exists and returns a reference.
    """
    stored_custom = step3.get('customBasesOffsets') or {}
    step3['customBasesOffsets'] = stored_custom
    return stored_custom


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
    kept: list[dict] = []
    for i, base in enumerate(bases):
        base_x = base.get('offsetFromStartCm')
        if base_x is None:
            kept.append(base)
            continue
        sig = _calc_base_trap_signature_with_fallback(
            base_x, panel_grid,
            panel_width_cm, panel_length_cm, panel_gap_cm,
        )
        # Drop bases whose probe hits no real panel on any line. These are
        # placed outside the row's panel extent by compute_area_bases when
        # a wider-frame trap in the same area (e.g. a V+H trap sharing the
        # row with V-only traps) pushes frame_end beyond this row's panels.
        has_real_panel = any(s in REAL_PANELS for s in sig if s is not None)
        if not has_real_panel:
            logger.info(
                "[base trap sig] area %s row %s base %s (x=%s): signature "
                "%s has no real panel — dropping (outside panel extent)",
                area_label, row_idx, base.get('baseId', f'B{i + 1}'),
                base_x, sig,
            )
            continue
        expected = _match_trap_by_signature(
            sig, trap_ids, trapezoids_by_id,
            row_angle_deg=row_angle_deg,
            row_front_height_cm=row_front_height_cm,
        )
        original = base.get('trapezoidId')
        if expected is None:
            logger.info(
                "[base trap sig] area %s row %s base %s (x=%s): no trap matches "
                "signature %s — keeping actual=%s",
                area_label, row_idx, base.get('baseId', f'B{i + 1}'),
                base_x, sig, original,
            )
        else:
            if original and original != expected:
                logger.info(
                    "[base trap sig] area %s row %s base %s (x=%s): "
                    "old=%s, sig=%s → using sig (old kept as validation)",
                    area_label, row_idx, base.get('baseId', f'B{i + 1}'),
                    base_x, original, expected,
                )
            base['trapezoidId'] = expected
        kept.append(base)
    # Mutate the caller's list in place (row_bases and all_row_bases[row_idx]
    # are the same reference, so re-id'ing and shrinking here propagates).
    if len(kept) != len(bases):
        # Reassign baseIds to stay B1..BN
        for new_i, b in enumerate(kept):
            b['baseId'] = f'B{new_i + 1}'
    bases[:] = kept


def _trap_matches_panel_grid(trap_cfg: dict, panel_grid: dict) -> bool:
    """True if the trap's lineOrientations can be observed on at least one
    column of this panel grid (same line count, matching cells).

    V/H in the trap's lineOrientations matches either the real (V/H) or the
    empty (EV/EH) cell of the same orientation. Cells beyond a line's length
    only match a trap's explicitly-empty (EV/EH) orientation.
    """
    line_orients = trap_cfg.get('lineOrientations') or []
    rows_cells = (panel_grid or {}).get('rows') or []
    if not line_orients or not rows_cells:
        return False
    if len(rows_cells) != len(line_orients):
        return False
    n_cols = max((len(r) for r in rows_cells), default=0)
    for c in range(n_cols):
        ok = True
        for li, want in enumerate(line_orients):
            cell = rows_cells[li][c] if c < len(rows_cells[li]) else None
            want_is_empty = bool(want and want.startswith('E'))
            base_orient = want[-1] if want_is_empty else want
            if cell is None:
                if not want_is_empty:
                    ok = False
                    break
                continue
            if cell not in (base_orient, 'E' + base_orient):
                ok = False
                break
        if ok:
            return True
    return False


def _filter_trap_ids_for_row(
    trap_ids: list[str], trapezoids: dict, panel_grid: dict,
) -> list[str]:
    """Keep only the trap ids that actually appear in this row's panel grid."""
    return [tid for tid in trap_ids
            if _trap_matches_panel_grid(trapezoids.get(tid) or {}, panel_grid)]


# ── Compute and save bases — per-row pipeline ──────────────────────────────
#
# Each panel row's bases flow through three sub-functions, in this order:
#
#   _compute_row_default_bases
#       Pure DEFAULT positions per sub-trap, consolidated into one
#       row list. No user overrides, no trap reassignment, no
#       renumbering, no completion. Just default positions from
#       each sub-trap's geometry.
#
#   _apply_persisted_position_overrides
#       Apply user position edits from the persisted
#       `step3.customBasesOffsets` snapshot to the row_bases list.
#       Move/add/delete ops arriving in a save payload are translated
#       into snapshot updates upstream (see `_ops_to_base_snapshot` in
#       save_tab); this function consumes that snapshot.
#
#   _finalize_row_bases
#       Position-independent passes that produce the final stored row
#       state, in order:
#         (1) signature-based trap reassignment
#         (2) bases_completion_for_segmented_rails
#         (3) renumber baseIds globally per row (B1..BN)
#         (4) rebuild the consolidated{trapId: [bases]} dict
#
# The user-override pass runs on default positions but BEFORE the
# trap-reassignment and completion passes — those depend on final
# positions to do their work correctly.


def _compute_row_default_bases(
    bs, data: dict, area: dict, area_idx: int,
    trap_ids: list[str], trapezoids: dict,
    app_defaults: dict, roof_spec: dict,
    trapezoid_configs: dict | None,
    panel_grid: dict, row_idx: int,
    rails_for_row: list[dict],
) -> tuple[list, dict[str, dict | None]]:
    """Compute DEFAULT base positions for one panel row in a SINGLE pass.

    Rail-driven placement (see `base_service.compute_row_bases`): bases land
    at the row's distinct rail endpoints + spacing fill — one pass over the
    whole row, no per-sub-trap loop or cross-trap consolidation.
    ``trapezoidId`` is left blank here and stamped by `_finalize_row_bases`'
    signature pass.

    Returns ``(row_bases, bases_data_map)``. `bases_data_map` carries the
    row-level frame metadata (rear/front leg depth, base extents) keyed by
    EVERY trap_id so the external-diagonal interpolation lookup still resolves.
    """
    step2 = data.get('step2', {})
    area_id = area.get('id', area_idx + 1)
    line_rails = _derive_line_rails(_get_computed_area(data, area_id), row_index=row_idx)

    # edgeOffsetMm (rail-end-to-base inset), baseOverhang + spacing are
    # trap-scope but uniform per row in practice — read them off the
    # primary sub-trap.
    step3 = data.get('step3', {})
    persisted_traps = step3.get('trapezoidConfigs') or {}
    primary = trap_ids[0] if trap_ids else ''
    trap_cfg = {
        **(persisted_traps.get(primary) or {}),
        **((trapezoid_configs or {}).get(primary, {})),
    }
    edge_offset_cm = trap_cfg.get('edgeOffsetMm', app_defaults['edgeOffsetMm']) / 10
    base_overhang_cm = trap_cfg.get('baseOverhangCm', app_defaults['baseOverhangCm'])
    spacing_mm = trap_cfg.get('spacingMm', app_defaults['spacingMm'])

    row_meta = bs.compute_row_bases(
        rails_for_row=rails_for_row,
        panel_grid=panel_grid,
        panel_width_cm=step2['panelWidthCm'],
        panel_length_cm=step2['panelLengthCm'],
        line_rails=line_rails,
        edge_offset_cm=edge_offset_cm,
        base_overhang_cm=base_overhang_cm,
        spacing_mm=spacing_mm,
        panel_gap_cm=app_defaults['panelGapCm'],
        line_gap_cm=app_defaults['lineGapCm'],
        roof_spec=roof_spec,
    )
    if not row_meta:
        return [], {}

    row_bases = row_meta['bases']
    keys = trap_ids or [primary]
    bases_data_map: dict[str, dict | None] = {tid: row_meta for tid in keys}
    return row_bases, bases_data_map


def _apply_persisted_position_overrides(
    row_bases: list[dict],
    stored_custom: dict,
    row_idx: int,
    stored_variations: dict | None = None,
) -> None:
    """Apply user position + variation overrides from the persisted
    ``customBasesOffsets`` / ``customBaseVariations`` snapshots to the
    default row_bases produced by `_compute_row_default_bases`.

    Snapshots are keyed ``{trap_id}:{row_idx}`` with row-absolute mm
    offsets (and an i-th-aligned `extensionIdx` for variations). We
    group row_bases by stripped (variation-less) trapezoidId and, for
    each sub-trap that has a stored entry, re-position its bases to
    match. Length mismatch is resolved by ADD (stored has more entries)
    or DELETE (stored has fewer) so the row reaches the user's intended
    count. The variation at each slot travels with its offset, so
    add/delete-induced renumbering can never orphan a variation
    reference.

    Bases with non-empty ``hookOffsets`` (frameless / virtual anchors)
    are not editable by users and are left untouched.

    trapezoidId stays as the default compute assigned it; cross-sub-
    trap moves leave a stale trap stamp that `_finalize_row_bases`'s
    signature reassignment resolves authoritatively (and the parallel
    extension stamp comes from `_apply_base_extensions` later).
    """
    # Early-out only when BOTH snapshots are empty. An extend-only
    # save has no customBasesOffsets entries but does carry
    # customBaseVariations — we must still set `extensionIdx` on each
    # affected base so `_apply_base_extensions` can stamp the
    # trapezoidId suffix and stretch the beam.
    if not stored_custom and not stored_variations:
        return

    by_parent: dict[str, list[dict]] = {}
    for b in row_bases:
        if (b.get('hookOffsets') or []):
            continue
        parent, _ = _parse_variation_trap_id(b.get('trapezoidId') or '')
        if parent:
            by_parent.setdefault(parent, []).append(b)

    additions: list[dict] = []
    removal_ids: set[int] = set()

    stored_variations = stored_variations or {}

    for parent, peers in by_parent.items():
        key = f'{parent}:{row_idx}'
        has_positions = key in stored_custom
        has_variations = key in stored_variations
        if not has_positions and not has_variations:
            continue   # no override for this sub-trap → keep defaults
        peers_sorted = sorted(peers, key=lambda b: b.get('offsetFromStartCm', 0))
        # Position source: explicit override if provided, else the
        # default offsets currently on the bases (extend-only saves
        # don't touch positions, but we still need to align the
        # variation idx with each base's slot).
        if has_positions:
            offs = list(stored_custom[key] or [])
        else:
            offs = [round((p.get('offsetFromStartCm') or 0) * 10) for p in peers_sorted]
        vars_list = list(stored_variations.get(key) or [])
        # Pad vars_list with zeros if missing entries (legacy snapshot
        # without variations, or extend op added bases without filling).
        while len(vars_list) < len(offs):
            vars_list.append(0)
        # Pair offset + variation idx so a sort below keeps them aligned.
        pairs = sorted(zip(offs, vars_list), key=lambda p: p[0])
        n_peers = len(peers_sorted)
        n_stored = len(pairs)

        # Update positions + extension idx of existing peers (sort-paired
        # against stored). `extensionIdx` is the slot-stable variation
        # reference; `_apply_base_extensions` consumes it after the
        # finalize pass.
        for i in range(min(n_peers, n_stored)):
            off_mm, ext_idx = pairs[i]
            peers_sorted[i]['offsetFromStartCm'] = round(off_mm / 10, 2)
            peers_sorted[i]['extensionIdx'] = int(ext_idx)

        # ADD: stored has more entries than defaults — clone the last
        # peer as a template (preserves panelLineIdx / startCm /
        # lengthCm; the finalize pass will re-stamp trapezoidId via
        # signature, recompute depth, and renumber baseId).
        if n_stored > n_peers and peers_sorted:
            template = peers_sorted[-1]
            for i in range(n_peers, n_stored):
                off_mm, ext_idx = pairs[i]
                new_b = dict(template)
                new_b['offsetFromStartCm'] = round(off_mm / 10, 2)
                new_b['extensionIdx'] = int(ext_idx)
                additions.append(new_b)

        # DELETE: stored has fewer entries — drop the trailing peers by
        # identity so we don't accidentally remove a same-position
        # base from another sub-trap.
        if n_stored < n_peers:
            for extra in peers_sorted[n_stored:]:
                removal_ids.add(id(extra))

    if removal_ids:
        row_bases[:] = [b for b in row_bases if id(b) not in removal_ids]
    row_bases.extend(additions)


def _finalize_row_bases(
    bs, row_bases: list[dict],
    panel_grid: dict, trap_ids: list[str], trapezoids: dict,
    step2: dict, app_defaults: dict,
    area_label: str, row_idx: int,
    row_angle_deg: float | None, row_front_height_cm: float | None,
    rails_for_row: list[dict],
    line_rails_dict: dict[str, list[float]],
    base_overhang_by_trap: dict[str, float],
) -> dict[str, list[dict]]:
    """Position-independent finalization for one row's bases.

    Runs the passes that turn a positioned-but-unfinalized row into
    the final stored shape, in order:

      1. Signature-based trap reassignment — re-stamps each base's
         `trapezoidId` from its X-position signature, regardless of
         which sub-trap originally produced it.
      2. Per-base depth recompute — re-derive `panelLineIdx` /
         `startCm` / `lengthCm` from each base's X position. The
         user-override step's ADD path clones a sub-trap template,
         so a base whose X falls in a different sub-trap's column
         range keeps stale geometry until this pass restamps it.
      3. `bases_completion_for_segmented_rails` — adds bases to rail
         segments that ended up with < 2 bases (split-at-holes can
         leave isolated columns with only one).
      4. Renumber `baseId` globally per row (B1..BN) so the FE wire
         protocol's `(areaId, rowIdx, baseId)` addressing is
         unambiguous and the diagonal emitter's `base_idx_by_id` map
         doesn't suffer last-write-wins collisions between sub-traps.
      5. Rebuild the `consolidated{trapId: [bases]}` dict from the final
         row_bases so downstream callers (external diagonals etc.) see
         the post-reassignment trap groupings.

    Mutates `row_bases` in place. Returns the rebuilt `consolidated`.
    """
    # (1) Signature-based trap reassignment.
    _reassign_row_base_traps_by_signature(
        row_bases, panel_grid, trap_ids, trapezoids,
        step2['panelWidthCm'], step2['panelLengthCm'],
        app_defaults['panelGapCm'],
        area_label, row_idx,
        row_angle_deg=row_angle_deg,
        row_front_height_cm=row_front_height_cm,
    )

    # (2) Per-base depth recompute. Cumulative line geometry is
    # row-wide, so build it once and feed each base into
    # `assign_base_depth`. `base_overhang_by_trap` lets each base use
    # ITS sub-trap's overhang (post-reassignment); fall back to the
    # app default for unknown traps.
    line_infos = bs.build_line_infos(
        panel_grid,
        step2['panelWidthCm'], step2['panelLengthCm'],
        app_defaults['lineGapCm'],
    )
    if line_infos:
        default_overhang = app_defaults['baseOverhangCm']
        for b in row_bases:
            parent, _ = _parse_variation_trap_id(b.get('trapezoidId') or '')
            overhang = base_overhang_by_trap.get(parent, default_overhang)
            bs.assign_base_depth(
                b, panel_grid, line_infos, line_rails_dict,
                step2['panelWidthCm'], step2['panelLengthCm'],
                app_defaults['panelGapCm'], overhang,
            )

    # (3) Add bases to rail segments left with <2 after standard placement.
    bs.bases_completion_for_segmented_rails(
        row_bases, rails_for_row, panel_grid,
        step2['panelWidthCm'], step2['panelLengthCm'],
        app_defaults['panelGapCm'],
        app_defaults['edgeOffsetMm'],
    )

    # (4) Renumber baseIds globally per row, sorted by offset, so the
    #     visual order matches the wire-protocol identifier order. The
    #     default-positions pass produces colliding `B1..BN` per sub-
    #     trap; finalize is the last place to make them unique before
    #     downstream consumers (diagonal emitter, FE save flow) read
    #     them.
    row_bases.sort(key=lambda b: b.get('offsetFromStartCm', 0))
    for i, b in enumerate(row_bases):
        b['baseId'] = f'B{i + 1}'

    # (5) Rebuild consolidated from final row_bases. Without this,
    #     diagonals are paired against stale (pre-reassign) trap
    #     groupings and miss any newly added completion bases.
    consolidated: dict[str, list[dict]] = {tid: [] for tid in trap_ids}
    for b in row_bases:
        tid = b.get('trapezoidId')
        if tid in consolidated:
            consolidated[tid].append(b)
    for tid in consolidated:
        consolidated[tid].sort(key=lambda b: b.get('offsetFromStartCm', 0))

    return consolidated


def _ops_to_base_snapshot(project, ops: list) -> tuple[dict, dict, dict]:
    """Materialise a list of BaseOp into the persisted shapes that the
    recompute path consumes.

    Returns ``(snapshot, var_snapshot, base_lookup)``:

      * ``snapshot`` — ``{ "trapId:rowIdx": offsetsMm[] }``, written into
        ``step3.customBasesOffsets``.
      * ``var_snapshot`` — same keys, same lengths, each i-th value is the
        ``extensionIdx`` for the i-th offset (so a base's variation
        travels with its slot through add/delete renumbering instead of
        being orphaned by a stale baseId reference). Written into
        ``step3.customBaseVariations``.
      * ``base_lookup`` — ``(areaId, rowIdx, baseId) → (snapshot_key, slot)``
        AFTER all ops have been applied. Callers (e.g.
        ``_apply_trap_extend_ops``) use it to locate the slot that
        corresponds to an extend op's targeted baseId.

    Starts from the current ``step3.computedAreas`` (the BE's last
    truth), reads each base's stamped variation idx, then applies each
    op in order:

        move:   reset slot's offset (variation stays at the same slot).
        add:    append offset + 0 variation; sort the pair list together
                so they re-align by offset.
        delete: pop both at the slot.
    """
    data = project.data or {}
    step3 = data.get('step3') or {}
    computed_areas = step3.get('computedAreas') or []

    # `bases` is stored as a dict keyed by row index (`{"0": [...], "1": [...]}`)
    # — the row idx lives on the OUTER key, NOT on each base. Use the key
    # everywhere; otherwise multi-row areas collapse to `A:0` and any move
    # op targeting a non-zero row silently misses.
    def _rows_with_idx(bases_by_row: any) -> list[tuple[int, list]]:
        if isinstance(bases_by_row, dict):
            return [(int(k), v) for k, v in bases_by_row.items() if isinstance(v, list)]
        if isinstance(bases_by_row, list):
            return [(0, bases_by_row)]
        return []

    # Build the starting snapshots from current computed bases.
    snapshot: dict[str, list[int]] = {}
    var_snapshot: dict[str, list[int]] = {}
    # (area_id, row_idx, base_id) → (snapshot_key, idx_in_sorted_offsets).
    # baseIds are renumbered globally per (area, row) by
    # `_finalize_row_bases` (B1..BN sorted by offset), so this triple is
    # unique.
    base_lookup: dict[tuple[str, int, str], tuple[str, int]] = {}

    # Legacy baseVariations[areaId][baseId] = idx — used to seed the
    # parallel var_snapshot for projects saved before customBaseVariations
    # existed. The per-base trapezoidId stamp is the more reliable source
    # (it survives renumbers), but for projects whose bases haven't been
    # re-stamped yet we fall back to this map.
    legacy_base_vars: dict = step3.get('baseVariations') or {}

    for area in computed_areas:
        area_id = str(area.get('areaId'))
        legacy_for_area: dict[str, int] = legacy_base_vars.get(area_id) or {}
        for ri, row_bases in _rows_with_idx(area.get('bases')):
            # Group this row's bases by parent trap (strip variation suffix).
            grouped: dict[str, list[dict]] = {}
            for b in row_bases:
                trap_raw = b.get('trapezoidId') or ''
                parent, _ = _parse_variation_trap_id(trap_raw)
                grouped.setdefault(f'{parent}:{ri}', []).append(b)
            for key, group in grouped.items():
                group.sort(key=lambda b: b.get('offsetFromStartCm', 0))
                snapshot[key] = [round(b.get('offsetFromStartCm', 0) * 10) for b in group]
                # Variation idx: prefer the live trapezoidId stamp, fall
                # back to the legacy baseVariations lookup.
                var_snapshot[key] = []
                for b in group:
                    _, stamped_idx = _parse_variation_trap_id(b.get('trapezoidId') or '')
                    if stamped_idx == 0:
                        stamped_idx = legacy_for_area.get(b.get('baseId'), 0) or 0
                    var_snapshot[key].append(int(stamped_idx))
                for idx, b in enumerate(group):
                    bid = b.get('baseId')
                    if bid:
                        base_lookup[(area_id, ri, bid)] = (key, idx)

    # Map `(areaId, rowIdx)` → ordered list of snapshot keys (per sub-trap)
    # so add ops can resolve which row's snapshot to append to. The FIRST
    # sub-trap key is the default insertion site for an add.
    keys_by_area_row: dict[tuple[str, int], list[str]] = {}
    for area in computed_areas:
        a_id = str(area.get('areaId'))
        for ri, row_bases in _rows_with_idx(area.get('bases')):
            for b in row_bases:
                trap_raw = b.get('trapezoidId') or ''
                parent, _ = _parse_variation_trap_id(trap_raw)
                if parent:
                    keys_by_area_row.setdefault((a_id, ri), [])
                    sk = f'{parent}:{ri}'
                    if sk not in keys_by_area_row[(a_id, ri)]:
                        keys_by_area_row[(a_id, ri)].append(sk)

    def _sort_pair(key: str) -> None:
        """Sort snapshot[key] ascending and reorder var_snapshot[key] in
        lockstep so variation idx stays paired with its offset."""
        pairs = sorted(zip(snapshot[key], var_snapshot[key]), key=lambda p: p[0])
        snapshot[key] = [p[0] for p in pairs]
        var_snapshot[key] = [p[1] for p in pairs]

    def _shift_lookup_for_add(key: str, inserted_slot: int) -> None:
        """When an add inserts at `inserted_slot`, every base whose old
        slot was ≥ that index in this key needs its lookup updated."""
        for k, (lk, slot) in list(base_lookup.items()):
            if lk == key and slot >= inserted_slot:
                base_lookup[k] = (lk, slot + 1)

    def _shift_lookup_for_delete(key: str, deleted_slot: int, deleted_base_id: str | None) -> None:
        """When a delete removes `deleted_slot`, every base whose old slot
        was > that index needs its lookup decremented; the deleted base's
        own entry is dropped."""
        for k, (lk, slot) in list(base_lookup.items()):
            if lk != key:
                continue
            if slot == deleted_slot and (deleted_base_id is None or k[2] == deleted_base_id):
                base_lookup.pop(k, None)
            elif slot > deleted_slot:
                base_lookup[k] = (lk, slot - 1)

    for op in ops:
        op_type = op.get('op')
        targets = op.get('targets') or []
        if op_type == 'move':
            offset_mm = round(float(op.get('offsetMm') or 0))
            for t in targets:
                ri = int(t.get('rowIdx') or 0)
                lookup = base_lookup.get((str(t.get('areaId')), ri, t.get('baseId')))
                if not lookup:
                    continue
                key, idx = lookup
                if 0 <= idx < len(snapshot.get(key, [])):
                    snapshot[key][idx] = offset_mm
                    # NB: don't re-sort after a move — the clampOffset on
                    # the FE bar prevents crossings, so order is preserved.
                    # If we sorted here, base_lookup slots would no longer
                    # correspond to snapshot indices.
        elif op_type == 'add':
            offset_mm = round(float(op.get('offsetMm') or 0))
            for t in targets:
                ri = int(t.get('rowIdx') or 0)
                area_id_s = str(t.get('areaId'))
                keys = keys_by_area_row.get((area_id_s, ri), [])
                if not keys:
                    continue
                # No sub-trap hint on the wire — the BE assigns the new
                # base to a sub-trap by X position via signature
                # reassignment after the recompute. Park it in the first
                # sub-trap's snapshot; the reassign pass will reparent it
                # if it actually belongs elsewhere.
                key = keys[0]
                snapshot.setdefault(key, [])
                var_snapshot.setdefault(key, [])
                # Dedupe near-neighbours so re-issuing the same add op is
                # idempotent (BE may receive a retried payload).
                if all(abs(o - offset_mm) > 1 for o in snapshot[key]):
                    snapshot[key].append(offset_mm)
                    var_snapshot[key].append(0)
                    # Determine where the new offset will land after sort,
                    # then shift lookups before sorting.
                    inserted_slot = sorted(snapshot[key]).index(offset_mm)
                    _shift_lookup_for_add(key, inserted_slot)
                    _sort_pair(key)
        elif op_type == 'delete':
            for t in targets:
                ri = int(t.get('rowIdx') or 0)
                area_id_s = str(t.get('areaId'))
                bid = t.get('baseId')
                lookup = base_lookup.get((area_id_s, ri, bid))
                if not lookup:
                    continue
                key, idx = lookup
                if 0 <= idx < len(snapshot.get(key, [])):
                    snapshot[key].pop(idx)
                    if 0 <= idx < len(var_snapshot.get(key, [])):
                        var_snapshot[key].pop(idx)
                    _shift_lookup_for_delete(key, idx, bid)

    return snapshot, var_snapshot, base_lookup


def _parse_variation_trap_id(trap_id: str) -> tuple[str, int]:
    """Split a base's trapezoidId into (parentTrapId, extensionIdx).

    Convention:
      "A1"    → ("A1", 0)   default extension
      "A1.N"  → ("A1", N)   variation N

    Any non-integer suffix is treated as part of the parent ID (no split).
    """
    if not trap_id or '.' not in trap_id:
        return trap_id, 0
    parent, suffix = trap_id.rsplit('.', 1)
    if not suffix.isdigit():
        return trap_id, 0
    return parent, int(suffix)


def _ops_to_block_snapshot(
    project,
    ops: list[dict],
) -> dict[str, list[dict] | None]:
    """Apply a list of BlockOp dicts to current per-trap block state.

    Returns ``{ trapId: list[{positionCm, isEnd}] }`` — write each list to
    ``step3.customBlocks[trapId]``. (Per-trap reset is expressed by the
    caller sending the snapshot-dict shape with an empty list; this helper
    only handles incremental move/add/delete ops.)

    The baseline for each affected trap is the trap's current customBlocks
    entry if one exists, otherwise the last-computed blocks from
    ``step3.computedTrapezoids[].blocks``. positionMm rounding plus the
    50cm minimum gap make position-based addressing unambiguous.
    """
    data = project.data or {}
    step3 = data.get('step3') or {}
    existing_custom = step3.get('customBlocks') or {}
    computed_blocks_by_trap: dict[str, list[dict]] = {
        t.get('trapezoidId'): t.get('blocks') or []
        for t in (step3.get('computedTrapezoids') or [])
        if t.get('trapezoidId')
    }

    result: dict[str, list[dict]] = {}

    def _ensure(trap_id: str) -> list[dict]:
        if trap_id in result:
            return result[trap_id]
        baseline = existing_custom.get(trap_id) or computed_blocks_by_trap.get(trap_id) or []
        wc = sorted(
            (
                {'positionCm': float(b.get('positionCm', 0)), 'isEnd': bool(b.get('isEnd', False))}
                for b in baseline
            ),
            key=lambda b: b['positionCm'],
        )
        result[trap_id] = wc
        return wc

    eps_cm = 0.05  # mm-level precision is enough; 50cm gap >> 0.5mm

    for op in ops:
        op_type = op.get('op')
        tid = op.get('trapezoidId')
        if not tid:
            continue
        blocks = _ensure(tid)
        if op_type == 'move':
            from_cm = float(op.get('fromPositionMm') or 0) / 10
            to_cm = float(op.get('toPositionMm') or 0) / 10
            for b in blocks:
                if abs(b['positionCm'] - from_cm) < eps_cm:
                    b['positionCm'] = to_cm
                    break
            blocks.sort(key=lambda b: b['positionCm'])
        elif op_type == 'add':
            pos_cm = float(op.get('positionMm') or 0) / 10
            blocks.append({'positionCm': pos_cm, 'isEnd': False})
            blocks.sort(key=lambda b: b['positionCm'])
        elif op_type == 'delete':
            pos_cm = float(op.get('positionMm') or 0) / 10
            result[tid] = [b for b in blocks if abs(b['positionCm'] - pos_cm) >= eps_cm]

    return result


def _apply_trap_extend_ops(
    project,
    ops: list[dict],
    base_lookup: dict[tuple[str, int, str], tuple[str, int]] | None = None,
) -> None:
    """Mutate persistent override state (`step3.trapExtensions` and
    `step3.customBaseVariations`) from a list of TrapExtendOp dicts.

    Wire shape: each op carries a flat ``targets: list[TrapExtendTarget]``
    where each target is ``{areaId, rowIdx, baseId}``. Row/area
    fan-out gestures are expanded into per-base targets by the FE
    before being sent.

    For each op, for each target:
      * Locate the base in the post-ops snapshot via
        `base_lookup[(areaId, rowIdx, baseId)] → (snap_key, slot)`.
      * Resolve the (frontExtMm, backExtMm) signature against the
        target base's PARENT trap geometry.extensions[]:
          - exact match against extensions[0] (BE default) → idx 0.
          - exact match against an existing user variation → reuse idx.
          - no match → append a new entry, take the new tail idx.
      * Write `customBaseVariations[snap_key][slot] = idx`. Slot is
        the base's position in the parallel offsets array — slot-
        based addressing survives baseId renumbering caused by
        add/delete.

    `base_lookup` (from `_ops_to_base_snapshot`) maps the wire
    `(areaId, rowIdx, baseId)` to the post-ops `(snapshot_key, slot)`
    so we can address slots that have already shifted under add/delete
    ops in the same save. When called WITHOUT a lookup (e.g. an
    extend-only save), we rebuild it from the current computedAreas.

    The next recompute pass — `_apply_trap_extensions` +
    `_apply_persisted_position_overrides` + `_apply_base_extensions`
    — surfaces this state onto each base's `trapezoidId` + `startCm` /
    `lengthCm`.
    """
    eps = 0.001
    # Deep-copy + reassign at the end is the SQLAlchemy-safe pattern
    # for mutating a JSONB column. In-place mutation + `flag_modified`
    # works in MOST cases, but mixing it with the deep-copies used
    # elsewhere in `save_tab` led to occasional dropped writes.
    data = copy.deepcopy(project.data or {})
    step3 = data.setdefault('step3', {})
    trap_exts: dict[str, list[dict]] = (step3.get('trapExtensions') or {})
    custom_vars: dict[str, list[int]] = (step3.get('customBaseVariations') or {})

    # Build lookups against the LAST computed snapshot so we can resolve
    # signatures and identify affected bases. Brand-new projects won't have
    # these yet — ops are no-ops until the first compute runs.
    computed_traps_by_id: dict[str, dict] = {
        t.get('trapezoidId'): t
        for t in step3.get('computedTrapezoids') or []
        if t.get('trapezoidId')
    }
    computed_areas = step3.get('computedAreas') or []
    areas_by_id: dict[str, dict] = {str(a.get('areaId')): a for a in computed_areas}

    def _rows_with_idx(bases_by_row: any) -> list[tuple[int, list]]:
        if isinstance(bases_by_row, dict):
            return [(int(k), v) for k, v in bases_by_row.items() if isinstance(v, list)]
        if isinstance(bases_by_row, list):
            return [(0, bases_by_row)]
        return []

    # If the caller didn't pass a base_lookup (extend-only save), rebuild
    # it from the current computedAreas — same algorithm as the snapshot
    # builder but without applying any ops on top.
    if base_lookup is None:
        base_lookup = {}
        for area in computed_areas:
            area_id = str(area.get('areaId'))
            for ri, row_bases in _rows_with_idx(area.get('bases')):
                grouped: dict[str, list[dict]] = {}
                for b in row_bases:
                    parent, _ = _parse_variation_trap_id(b.get('trapezoidId') or '')
                    grouped.setdefault(f'{parent}:{ri}', []).append(b)
                for key, group in grouped.items():
                    group.sort(key=lambda b: b.get('offsetFromStartCm', 0))
                    for idx, b in enumerate(group):
                        bid = b.get('baseId')
                        if bid:
                            base_lookup[(area_id, ri, bid)] = (key, idx)
                    # Seed customBaseVariations from current trapezoidId
                    # stamps so post-this-save state matches reality.
                    if key not in custom_vars:
                        custom_vars[key] = []
                        for b in group:
                            _, stamped = _parse_variation_trap_id(b.get('trapezoidId') or '')
                            custom_vars[key].append(int(stamped))

    def _resolve_existing_idx(
        parent_tid: str, front_mm: float, back_mm: float,
    ) -> int | None:
        """Return the variation idx whose (front, back) signature
        matches the given values WITHIN THE PARENT'S OWN namespace:
          - idx 0 if it matches `computed_traps_by_id[parent_tid]
            .geometry.extensions[0]` (this parent's BE default).
          - idx N>0 if it matches an entry in `trap_exts[parent_tid]`
            (this parent's user variation list).
          - None if no existing signature matches.

        Every lookup is scoped by `parent_tid` so a {front, back}
        signature on, say, A1 never reuses a variation that happens
        to share the same values on A2 — each parent maintains its
        own variation namespace.
        """
        parent_trap = computed_traps_by_id.get(parent_tid) or {}
        default_ext = ((parent_trap.get('geometry') or {}).get('extensions') or [{}])[0]
        if (abs((default_ext.get('frontExtMm') or 0) - front_mm) < eps
                and abs((default_ext.get('backExtMm') or 0) - back_mm) < eps):
            return 0
        for i, e in enumerate(trap_exts.get(parent_tid) or [], start=1):
            if (abs((e.get('frontExtMm') or 0) - front_mm) < eps
                    and abs((e.get('backExtMm') or 0) - back_mm) < eps):
                return i
        return None

    def _is_sole_user(
        parent_tid: str, idx: int,
        excl_snap_key: str, excl_slot: int,
    ) -> bool:
        """True iff no other base in `custom_vars` references variation
        `idx` of `parent_tid` (excluding the position
        `(excl_snap_key, excl_slot)` itself).

        Scoped to the parent's own snapshot keys (`f'{parent_tid}:…'`)
        — variations on a different parent that happen to share the
        same idx number are NOT counted; the idx number is local to
        each parent's variation list.
        """
        prefix = f'{parent_tid}:'
        for snap_key, slots in custom_vars.items():
            if not snap_key.startswith(prefix):
                continue
            for s_idx, v in enumerate(slots):
                if v != idx:
                    continue
                if snap_key == excl_snap_key and s_idx == excl_slot:
                    continue
                return False
        return True

    def _set_slot(snap_key: str, slot: int, idx: int) -> None:
        slots = custom_vars.setdefault(snap_key, [])
        while len(slots) <= slot:
            slots.append(0)
        slots[slot] = idx

    for op in ops:
        if op.get('op') != 'extend':
            continue
        front_mm = float(op.get('frontExtMm') or 0)
        back_mm = float(op.get('backExtMm') or 0)
        for target in (op.get('targets') or []):
            area_key = str(target.get('areaId'))
            row_idx = int(target.get('rowIdx') or 0)
            base_id = target.get('baseId')
            if not base_id:
                continue
            area = areas_by_id.get(area_key)
            if not area:
                continue
            # Find the base in computedAreas so we can read its
            # current parent trapezoidId (for variation idx resolution).
            base = None
            for ri, row_bases in _rows_with_idx(area.get('bases')):
                if ri != row_idx:
                    continue
                for b in row_bases:
                    if b.get('baseId') == base_id:
                        base = b
                        break
                if base is not None:
                    break
            if base is None:
                continue
            parent_tid, _ = _parse_variation_trap_id(base.get('trapezoidId') or '')
            if not parent_tid:
                continue
            lookup = base_lookup.get((area_key, row_idx, base_id))
            if not lookup:
                continue
            snap_key, slot = lookup
            # Current variation idx (slot-stable, post-ops).
            current_slots = custom_vars.get(snap_key) or []
            current_idx = current_slots[slot] if slot < len(current_slots) else 0

            # 1) Signature matches an existing variation (or parent
            #    default at idx 0) → reuse it. Always takes priority
            #    over the COW path to avoid creating duplicates.
            matched_idx = _resolve_existing_idx(parent_tid, front_mm, back_mm)
            if matched_idx is not None:
                if matched_idx != current_idx:
                    _set_slot(snap_key, slot, matched_idx)
                continue

            # 2) No existing match.
            #    a) If the base is the SOLE user of its current
            #       variation, update that variation in place
            #       (copy-on-write — the variation is effectively a
            #       per-base storage). The base keeps its idx; the
            #       associated ComputedTrapezoid "A.N" entry is
            #       regenerated on the next recompute with the new
            #       values.
            if current_idx > 0 and _is_sole_user(parent_tid, current_idx, snap_key, slot):
                user_list = trap_exts.setdefault(parent_tid, [])
                while len(user_list) < current_idx:
                    user_list.append({'frontExtMm': 0.0, 'backExtMm': 0.0})
                user_list[current_idx - 1] = {
                    'frontExtMm': float(front_mm),
                    'backExtMm': float(back_mm),
                }
                continue

            #    b) Otherwise append a new variation entry and point
            #       this base at its tail idx. Other bases sharing the
            #       previous idx (multi-user case) remain on it.
            user_list = trap_exts.setdefault(parent_tid, [])
            user_list.append({
                'frontExtMm': float(front_mm),
                'backExtMm': float(back_mm),
            })
            _set_slot(snap_key, slot, len(user_list))

    if trap_exts:
        step3['trapExtensions'] = {k: v for k, v in trap_exts.items() if v}
    elif 'trapExtensions' in step3:
        step3['trapExtensions'] = {}

    if custom_vars:
        step3['customBaseVariations'] = {k: v for k, v in custom_vars.items() if v}
    elif 'customBaseVariations' in step3:
        step3['customBaseVariations'] = {}

    # Legacy baseVariations is being phased out — clear it once we've
    # populated customBaseVariations so it doesn't shadow newer state.
    if 'baseVariations' in step3:
        step3['baseVariations'] = {}

    project.data = data
    flag_modified(project, 'data')


def _apply_trap_extensions(project) -> None:
    """Append user-created variations to each ComputedTrapezoid.geometry.extensions[].

    trapezoid_detail_service emits extensions=[BE_default] per trap. This
    post-process reads the persisted user variations from
    step3.trapExtensions[parentTrapId] and appends them so that
    geometry.extensions[i] is addressable by base.variationIdx for i > 0.

    Mutates project.data in place; caller commits.
    """
    data = project.data or {}
    step3 = data.get('step3') or {}
    user_vars: dict = step3.get('trapExtensions') or {}
    if not user_vars:
        return
    for t in step3.get('computedTrapezoids') or []:
        parent = t.get('trapezoidId')
        if not parent:
            continue
        added = user_vars.get(parent)
        if not added:
            continue
        geom = t.setdefault('geometry', {})
        default_list = geom.get('extensions') or [{'frontExtMm': 0, 'backExtMm': 0}]
        # Always rebuild: default at idx 0, then user additions in stored order.
        geom['extensions'] = [default_list[0]] + [
            {'frontExtMm': float(e.get('frontExtMm') or 0),
             'backExtMm':  float(e.get('backExtMm')  or 0)}
            for e in added
        ]


def _apply_base_extensions(project) -> None:
    """Post-process bases: stamp each base with the variation it owns and
    re-apply the matching extension to `startCm` / `lengthCm`.

    The variation idx comes from `base.extensionIdx` (set during
    `_apply_persisted_position_overrides`, which reads it from the
    slot-stable `step3.customBaseVariations` snapshot). The on-base
    field survives baseId renumbering because it travels with the
    base record itself.

    Legacy fallback: projects saved before `customBaseVariations`
    existed don't have `extensionIdx` on their bases. We fall back to
    `step3.baseVariations[areaId][baseId]` (the old baseId-keyed map)
    — fragile against renumber, but kept so existing projects keep
    rendering until their next save migrates them.

    The base's `trapezoidId` is the surface representation: parent ("A1")
    for idx 0; dotted ("A1.N") for idx > 0. Recompute always emits the
    parent; this function adds the suffix and stretches the beam.

    Units: `frontExtMm` / `backExtMm` are HORIZONTAL mm (they parallel
    the trap's horizontal base beam — the physical purlin-aligned beam).
    The plan-view Base in `startCm` / `lengthCm` is SLOPE-axis cm;
    converting horizontal → slope = horizontal / cos(angle). Bases on
    iskurit / insulated_panel sit on the base beam, so the slope-
    direction projection of the same physical extension is slightly
    LONGER at a tilted angle.

    Must run AFTER `compute_and_save_trapezoid_details` AND
    `_apply_trap_extensions` since both populate the extensions list.
    Mutates project.data in place; caller commits.
    """
    data = project.data or {}
    step3 = data.get('step3') or {}
    computed_traps = step3.get('computedTrapezoids') or []
    computed_areas = step3.get('computedAreas') or []
    if not computed_traps or not computed_areas:
        return

    exts_by_trap: dict[str, list[dict]] = {}
    angle_by_trap: dict[str, float] = {}
    for t in computed_traps:
        tid = t.get('trapezoidId')
        if not tid:
            continue
        geom = t.get('geometry') or {}
        ext_list = geom.get('extensions')
        if isinstance(ext_list, list) and ext_list:
            exts_by_trap[tid] = ext_list
        angle_by_trap[tid] = float(geom.get('angle') or 0)

    legacy_base_vars: dict = step3.get('baseVariations') or {}

    for area in computed_areas:
        area_id_key = str(area.get('areaId'))
        legacy_for_area = legacy_base_vars.get(area_id_key) or {}
        bases_by_row = area.get('bases') or {}
        # `bases` may be dict[row_idx -> list[Base]] or list[Base] for legacy
        rows = bases_by_row.values() if isinstance(bases_by_row, dict) else [bases_by_row]
        for row_bases in rows:
            if not isinstance(row_bases, list):
                continue
            for base in row_bases:
                raw_tid = base.get('trapezoidId')
                if not raw_tid:
                    continue
                # The base may already carry a variation suffix from a
                # prior run; strip it so we can re-stamp cleanly.
                parent_tid, _ = _parse_variation_trap_id(raw_tid)
                ext_list = exts_by_trap.get(parent_tid)
                if not ext_list:
                    continue
                # Prefer the on-base extensionIdx (slot-stable, set by
                # `_apply_persisted_position_overrides`). Fall back to
                # the legacy baseVariations map for not-yet-migrated
                # projects.
                if 'extensionIdx' in base:
                    idx = int(base.get('extensionIdx') or 0)
                else:
                    idx = legacy_for_area.get(base.get('baseId'), 0) or 0
                if not (0 <= idx < len(ext_list)):
                    idx = 0
                # Surface the variation onto the trapezoidId for
                # downstream readers (BOM rollups, sidebar tree,
                # schedule labels).
                base['trapezoidId'] = (
                    f'{parent_tid}.{idx}' if idx > 0 else parent_tid
                )
                ext = ext_list[idx]
                # Horizontal mm → slope cm (divide by cos(angle), then /10).
                angle_deg = angle_by_trap.get(parent_tid, 0.0)
                cos_a = math.cos(math.radians(angle_deg)) or 1.0
                front_cm = ((ext.get('frontExtMm') or 0) / 10) / cos_a
                back_cm = ((ext.get('backExtMm') or 0) / 10) / cos_a
                if front_cm or back_cm:
                    base['startCm'] = round(base.get('startCm', 0) - back_cm, 2)
                    base['lengthCm'] = round(
                        base.get('lengthCm', 0) + front_cm + back_cm, 2
                    )


def _compute_row_hook_bases(
    bs, data: dict, area: dict, area_idx: int,
    app_defaults: dict, roof_spec: dict,
    panel_grid: dict, row_idx: int,
    rails: list[dict],
) -> list[dict]:
    """Compute virtual anchor bases for one frameless-area row (tiles, flat_installation).

    Reuses `compute_area_bases` with no owning trapezoid (full panel-row X
    extent → auto-computed by the function when trap_start/end are None),
    then `fill_frameless_anchors_offsets` populates each base's hookOffsets from
    the rail intersections. Returns the bases list (empty list on no panels).
    """
    inputs = _build_base_inputs(
        data, area, area_idx, app_defaults, trapezoid_id=None,
        trapezoid_configs=None,
        trap_start_cm=None, trap_end_cm=None,
        roof_spec=roof_spec,
        panel_grid=panel_grid, row_index=row_idx,
    )
    result = bs.compute_area_bases(**inputs)
    if not result:
        return []
    bases = result.get('bases') or []
    bs.fill_frameless_anchors_offsets(
        bases, rails, panel_grid,
        inputs['panel_width_cm'], inputs['panel_length_cm'],
        inputs['line_gap_cm'],
    )
    return bases


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
    project_roof_spec = project.roof_spec

    stored_custom = _sync_custom_offsets(step3)
    stored_variations = step3.get('customBaseVariations') or {}
    result = []

    for i, area in enumerate(areas):
        area_id = area.get('id', i + 1)
        label = area.get('label') or str(i)

        # Resolve this area's roof spec (per-area for mixed projects,
        # otherwise the project spec). Frameless areas (tiles, flat_installation)
        # use the virtual-anchor branch below — they have no construction frame,
        # but each rail crossing a virtual base line becomes one anchor point.
        roof_spec = resolve_roof_spec(project_roof_spec, area)
        if is_frameless_roof_type(roof_spec.get('type')):
            computed_area = _get_computed_area(data, area_id) or {}
            panel_rows = area.get('panelRows', [])
            if not panel_rows:
                pg = area.get('panelGrid')
                panel_rows = [{'rowIndex': 0, 'panelGrid': pg}] if pg else []
            all_row_bases: dict[int, list] = {}
            for pr in panel_rows:
                if pr is None:
                    continue
                row_idx = pr.get('rowIndex', 0)
                rails_dict = computed_area.get('rails', {})
                if isinstance(rails_dict, list):
                    row_rails = rails_dict
                else:
                    row_rails = rails_dict.get(row_idx) or rails_dict.get(str(row_idx)) or []
                row_bases = _compute_row_hook_bases(
                    bs, data, area, i,
                    app_defaults, roof_spec,
                    panel_grid=pr.get('panelGrid') or {},
                    row_idx=row_idx,
                    rails=row_rails,
                )
                all_row_bases[row_idx] = row_bases
            _upsert_computed_area(step3, area_id, label, {'bases': all_row_bases})
            result.append({
                'areaId': area_id,
                'areaLabel': label,
                'bases': all_row_bases,
                'basesDataMap': {},
                'trapIds': [],
                'consolidated': {},
                'perRowData': {},
            })
            continue

        trap_ids = area.get('trapezoidIds', [])
        if not trap_ids:
            trap_ids = [label]

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

            # Restrict traps computed for THIS row to those whose
            # lineOrientations both (a) have the same line count as the row's
            # panelGrid, and (b) match the row's actual cells on at least one
            # column. Without this, a wider-frame trap (e.g. a V+H trap) gets
            # computed against a row that has no H cells, producing a frame
            # that overshoots the row's real panel extent — and its bases win
            # consolidation at positions that don't exist in the row.
            row_trap_ids = _filter_trap_ids_for_row(trap_ids, trapezoids, pg)
            if not row_trap_ids:
                # Fallback: no matching trap (shouldn't happen for a well-split
                # area). Keep the full list so we at least produce bases.
                row_trap_ids = trap_ids

            # Per-row computed rails feed the rail-endpoint placement.
            row_rails_all = (_get_computed_area(data, area_id) or {}).get('rails', {})
            rails_for_row = (row_rails_all.get(row_idx)
                             or row_rails_all.get(str(row_idx)) or [])

            # Pure DEFAULT base positions for this row (single rail-driven
            # pass). No user overrides; those get layered on below.
            row_bases, bases_data_map = _compute_row_default_bases(
                bs, data, area, i,
                row_trap_ids, trapezoids,
                app_defaults, roof_spec,
                trapezoid_configs,
                panel_grid=pg, row_idx=row_idx,
                rails_for_row=rails_for_row,
            )
            all_row_bases[row_idx] = row_bases
            if not first_bases_data_map:
                first_bases_data_map = bases_data_map
            # `Base.startCm` is line-relative — external-diagonal Y-overlap
            # geometry must translate to area-rear-relative Y, so stash the
            # row's line-rear table now while panel_grid + dims are in scope.
            line_rears_cm = bs.line_rear_edges_cm(
                pg, step2['panelWidthCm'], step2['panelLengthCm'],
                app_defaults['lineGapCm'],
            )

            row_ang = pr.get('angleDeg')
            if row_ang is None:
                row_ang = area.get('angleDeg')
            row_fh = pr.get('frontHeightCm')
            if row_fh is None:
                row_fh = area.get('frontHeightCm')

            # Stamp trapezoidId on the default bases BEFORE applying overrides.
            # The rail-driven placement leaves trapezoidId blank (it's the
            # finalize signature pass that assigns it), but
            # `_apply_persisted_position_overrides` groups bases by
            # trapezoidId to match the stored `{trapId}:{rowIdx}` snapshot —
            # blank trapIds would never match, silently dropping every base
            # edit. Run the same signature reassignment up front; finalize
            # re-runs it idempotently after add/delete reconciliation.
            _reassign_row_base_traps_by_signature(
                row_bases, pg, row_trap_ids, trapezoids,
                step2['panelWidthCm'], step2['panelLengthCm'],
                app_defaults['panelGapCm'],
                label, row_idx,
                row_angle_deg=row_ang, row_front_height_cm=row_fh,
            )

            # Apply persisted user position overrides. The snapshot
            # `customBasesOffsets` is updated by save_tab from the
            # incoming ops payload (via `_ops_to_base_snapshot`); we
            # consume it here on the row_bases list, BEFORE the
            # position-independent finalize pass below.
            _apply_persisted_position_overrides(
                row_bases, stored_custom, row_idx,
                stored_variations=stored_variations,
            )

            # Finalize: trap reassignment, completion, baseId renumber,
            # rebuild consolidated.
            # rails_for_row already fetched above for default placement.
            # Per-line rails for the per-base depth recompute. Same
            # shape `compute_area_bases` consumes from line_rails.
            line_rails_dict = _derive_line_rails(
                _get_computed_area(data, area_id), row_index=row_idx,
            )
            # Per-trap baseOverhangCm so the depth recompute uses each
            # base's OWN sub-trap overhang (post-signature-reassignment),
            # not the sub-trap that originally produced it.
            persisted_traps = (data.get('step3') or {}).get('trapezoidConfigs') or {}
            base_overhang_by_trap: dict[str, float] = {}
            for tid in trap_ids:
                merged = {
                    **(persisted_traps.get(tid) or {}),
                    **((trapezoid_configs or {}).get(tid, {})),
                }
                base_overhang_by_trap[tid] = merged.get(
                    'baseOverhangCm', app_defaults['baseOverhangCm'],
                )
            consolidated = _finalize_row_bases(
                bs, row_bases,
                panel_grid=pg, trap_ids=trap_ids, trapezoids=trapezoids,
                step2=step2, app_defaults=app_defaults,
                area_label=label, row_idx=row_idx,
                row_angle_deg=row_ang, row_front_height_cm=row_fh,
                rails_for_row=rails_for_row,
                line_rails_dict=line_rails_dict,
                base_overhang_by_trap=base_overhang_by_trap,
            )

            per_row_data[row_idx] = {
                'basesDataMap': bases_data_map,
                'consolidated': consolidated,
                'lineRearsCm': line_rears_cm,
                # Stash the final row_bases so diagonal calc can emit
                # indices that reference the stored array directly (via
                # baseId lookup).
                'rowBases': row_bases,
            }

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

        # Per-row rails were persisted by compute_and_save_rails into
        # step3.computedAreas[].rails[rowIdx]. The rails-based diagonal
        # algorithm needs them to identify external rails + shape edges.
        computed_area = _get_computed_area(data, area_id) or {}
        rails_by_row = computed_area.get('rails', {})

        # `per_row_data.rowBases` is captured by `compute_and_save_bases`
        # BEFORE `_apply_base_extensions` shifts startCm / lengthCm for
        # iskurit perpendicular and variation extensions. The persisted
        # computedAreas[].bases is the post-extension truth, so re-key by
        # baseId and substitute the live geometry — otherwise the
        # slope-range guard in `_base_slope_y_range` works against
        # un-extended startCm/lengthCm while reading extension values from
        # `geom.extensions`, mis-clipping the slope range and steering
        # diagonals off the slope-beam ends.
        live_bases_by_row: dict[int, list[dict]] = {}
        live_bases_by_row_str: dict = (computed_area.get('bases') or {})
        for k, v in live_bases_by_row_str.items():
            try:
                live_bases_by_row[int(k)] = v if isinstance(v, list) else []
            except (TypeError, ValueError):
                continue

        # Compute external diagonals per panel row, tag each with panelRowIdx
        all_diagonals = []
        if per_row_data:
            for row_idx, row_data in sorted(per_row_data.items()):
                bdm = row_data.get('basesDataMap', {})
                cons = row_data.get('consolidated', {})
                stale_row_bases = row_data.get('rowBases') or []
                # Substitute post-extension startCm/lengthCm from the live
                # computedAreas store, matched by baseId.
                live_row = live_bases_by_row.get(row_idx) or []
                if live_row and stale_row_bases:
                    live_by_id = {lb.get('baseId'): lb for lb in live_row}
                    row_bases = []
                    for sb in stale_row_bases:
                        live = live_by_id.get(sb.get('baseId'))
                        row_bases.append({**sb, **live} if live else sb)
                else:
                    row_bases = stale_row_bases
                line_rears_cm = row_data.get('lineRearsCm')
                rails = (rails_by_row.get(row_idx)
                         or rails_by_row.get(str(row_idx))
                         or [])
                if not bdm:
                    continue
                row_diags = bs.compute_external_diagonals(
                    trap_ids, bdm, cons, computed_trapezoids,
                    row_bases=row_bases, line_rears_cm=line_rears_cm,
                    rails=rails,
                )
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
    current_user: User | None = None,
) -> dict:
    """
    Transition project to a new step with server-side data cleanup.
    Forward: resets dependent data and recomputes (e.g., rails+bases on 2→3).
    Backward: clears data from steps being navigated away from.

    `current_user` is required for the 2→3 charge — pass it from the router.
    """
    # Infer old step from navigation; if not set, assume one step before new_step
    # (the FE always saves before calling updateStep, so the transition is always ±1)
    nav_step = (project.navigation or {}).get('step')
    old_step = nav_step if nav_step is not None else max(1, new_step - 1)
    if new_step == old_step:
        return {'currentStep': old_step, 'clearedSteps': []}
    if new_step < 1 or new_step > 5:
        raise ValueError(f"Invalid step: {new_step}")

    # Per-transition validation runs BEFORE any mutation so the FE can stay
    # on the current step with data intact when the BE rejects. The router
    # maps the raised StepTransitionInvalidError to HTTP 400.
    transition_errors = _validate_step_transition(project, old_step, new_step)
    if transition_errors:
        raise StepTransitionInvalidError(old_step, new_step, transition_errors)

    # ── Credits: block reset-to-step-1 on charged projects ──────────────
    # Closes the "pay once, restart the whole plan" loophole — a user could
    # otherwise charge 100 credits at 2→3, generate the PDF, go back to
    # step 1 to redo the roof outline, and effectively get a second plan
    # free. Charged projects are committed; to start fresh the user has to
    # create a new project (which charges again). Iteration in steps 2+
    # stays free as designed.
    if new_step == 1 and project.credits_charged_at is not None:
        raise StepTransitionInvalidError(old_step, new_step, [{
            'code': 'chargedProjectCannotResetToStep1',
            'field': 'currentStep',
            'params': {},
        }])

    # ── Credits: charge once per project on first entry into step 3+ ──
    # The legitimate FE flow only ever transitions ±1, so this almost always
    # fires on 2→3. We gate on `new_step > 2 AND credits_charged_at IS NULL`
    # instead of the exact 2→3 pair so a forged "advance straight to step 5"
    # request can't sneak past the charge. Admins are skipped (charge_for_project
    # no-ops on role='admin'). Already-charged projects are also no-ops, so
    # re-entering step 3+ after going back to step 2 stays free. Insufficient
    # credits is surfaced through the same StepTransitionInvalidError channel
    # as other 2→3 validations.
    if new_step > 2 and project.credits_charged_at is None and current_user is not None:
        try:
            await credits_service.charge_for_project(db, current_user, project)
        except credits_service.InsufficientCreditsError as e:
            raise StepTransitionInvalidError(old_step, new_step, [{
                'code': 'insufficientCredits',
                'field': 'credits',
                'params': {'required': e.required, 'available': e.available},
            }])

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
    # Leaving step 2 backward also wipes the step-2 portion of the layout
    # (rectAreas / panels / deletedPanelKeys) so re-entering step 2 is fresh.
    # Step-1 layout fields (roofPolygon, referenceLine, baseline, roofAxis,
    # uploadedImageData, pixelToCmRatio) are preserved.
    if 'step2' in cleared and new_step < old_step:
        layout = dict(project.layout or {})
        layout['rectAreas'] = []
        layout['panels'] = []
        layout['deletedPanelKeys'] = {}
        project.layout = layout
        flag_modified(project, 'layout')
    nav = dict(project.navigation or {})
    nav['step'] = new_step
    nav['tab'] = None
    project.navigation = nav
    flag_modified(project, 'navigation')
    flag_modified(project, 'data')
    await db.commit()

    # ── Frameless roofs: force angle=0, frontHeight=0 (no construction frame) ──
    # For mixed projects, only zero out frameless-typed areas and the traps
    # belonging to them. For fully-frameless projects, zero everything and the
    # step2 defaults. Non-frameless projects: no change.
    project_roof_spec = project.roof_spec
    ptype = project_roof_spec.get('type')
    if is_frameless_roof_type(ptype) or ptype == 'mixed':
        step2 = data.get('step2', {})
        if is_frameless_roof_type(ptype):
            step2['defaultAngleDeg'] = 0
            step2['defaultFrontHeightCm'] = 0
        frameless_trap_ids: set[str] = set()
        for area in step2.get('areas', []):
            if not is_frameless_roof_type(resolve_roof_spec(project_roof_spec, area).get('type')):
                continue
            area['angleDeg'] = 0
            area['frontHeightCm'] = 0
            # Row-level a/h too (row is the authority post Phase A)
            for pr in (area.get('panelRows') or []):
                if pr is None:
                    continue
                pr['angleDeg'] = 0
                pr['frontHeightCm'] = 0
            frameless_trap_ids.update(area.get('trapezoidIds') or [])
        # Remove frameless-area traps entirely from step2.trapezoids (these areas
        # have no construction frame → traps are meaningless). Also clear
        # the area's trapezoidIds so downstream consumers see no traps.
        if frameless_trap_ids:
            step2['trapezoids'] = [
                t for t in step2.get('trapezoids', [])
                if t.get('id') not in frameless_trap_ids
            ]
            for area in step2.get('areas', []):
                if is_frameless_roof_type(resolve_roof_spec(project_roof_spec, area).get('type')):
                    area['trapezoidIds'] = []
        if frameless_trap_ids or is_frameless_roof_type(ptype):
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
            # Surface user variations onto each trap's geometry.extensions[],
            # then stamp affected bases' trapezoidId + startCm/lengthCm.
            _apply_trap_extensions(project)
            _apply_base_extensions(project)
            flag_modified(project, 'data')
            await db.commit()
            await db.refresh(project)
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
    # Always force recompute when coming back from step 5 so materialized
    # alt-swaps are discarded and default elements are restored.
    bom_result = None
    if new_step >= 4:
        await db.refresh(project)
        existing_bom = await bom_service.get_bom(db, project.id)
        coming_back_from_step5 = 'step5' in cleared
        if not existing_bom or bom_service.is_bom_stale(project.data or {}, existing_bom) or coming_back_from_step5:
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
    project_roof_spec: dict,
    stored_custom_blocks: dict | None = None,
) -> tuple[dict, dict[str, int]]:
    """
    Compute structural details for all trapezoids (first pass — full trap computation).

    Returns (result, trap_row_map):
      result        — {trapId: detail_dict}
      trap_row_map  — {trapId: owning panelRow index}; needed so block alignment
                      can be restricted to traps that share physical base beams
                      (i.e. live in the same row of the same area).
    """
    result = {}
    trap_row_map: dict[str, int] = {}
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

        # Resolve this trap's effective roof spec via its owning area.
        # Frameless areas (tiles, flat_installation) have no construction frame → skip the trap.
        roof_spec = resolve_roof_spec(project_roof_spec, area)
        if is_frameless_roof_type(roof_spec.get('type')):
            continue

        area_id = area.get('id', 0)

        # Build panel lines from trap's lineOrientations
        line_orients = trap_cfg.get('lineOrientations', [PANEL_V])

        # Find the trap's OWNING row. A multi-row area can have traps with
        # different lineOrientations per row — pulling line_rails from row 0
        # for a trap that lives in row N would give 0's rails (wrong line
        # count). Prefer the panelRow whose panelGrid has the same number of
        # lines AND whose column signatures match the trap's. Fallback: row 0.
        owning_row_idx = 0
        panel_rows = area.get('panelRows') or []
        for pr in panel_rows:
            if pr is None:
                continue
            pg = pr.get('panelGrid') or {}
            rows_cells = pg.get('rows') or []
            if len(rows_cells) != len(line_orients):
                continue
            # Column signature check: every line must have a REAL cell at the
            # column, and its orientation must match the trap's (treating V/EV
            # as interchangeable against a trap's V, same for H/EH). Cells
            # beyond a line's length are implicit empty slots, so they only
            # match a trap's explicitly-empty ('EV'/'EH') orientation.
            n_cols = max((len(r) for r in rows_cells), default=0)
            col_match = False
            for c in range(n_cols):
                ok = True
                for li, want in enumerate(line_orients):
                    cell = rows_cells[li][c] if c < len(rows_cells[li]) else None
                    want_is_empty = bool(want and want.startswith('E'))
                    base = want[-1] if want_is_empty else want
                    if cell is None:
                        # Out-of-bounds → implicit empty slot on this line.
                        # Only matches when the trap expects empty here.
                        if not want_is_empty:
                            ok = False
                            break
                        continue
                    if cell not in (base, 'E' + base):
                        ok = False
                        break
                if ok:
                    col_match = True
                    break
            if col_match:
                owning_row_idx = pr.get('rowIndex', 0)
                break

        # Derive line rails — only for active (non-empty) lines of this trapezoid.
        # Ghost rendering is handled by the FE overlaying the full trap's DetailView.
        computed_area = _get_computed_area(data, area_id)
        all_line_rails = _derive_line_rails(computed_area, row_index=owning_row_idx)
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

        # Merge persisted trap-scope schema params under the incoming cfg so
        # request-only updates win but persisted values survive reloads.
        persisted_traps = (data.get('step3') or {}).get('trapezoidConfigs') or {}
        t_cfg = {
            **(persisted_traps.get(trap_id) or {}),
            **((trapezoid_configs or {}).get(trap_id, {})),
        }
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
        custom_blocks = (stored_custom_blocks or {}).get(trap_id)

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
            custom_blocks=custom_blocks,
        )

        if detail:
            is_full = all(not is_empty_orientation(o) for o in line_orients)
            detail['isFullTrap'] = is_full
            # Surface the owning panelRow so the FE can pull the right per-row
            # rails when rendering this trap's detail view (DetailView, etc.).
            detail['panelRowIdx'] = owning_row_idx
            result[trap_id] = detail
            trap_row_map[trap_id] = owning_row_idx

            # ── Sub-trap variations ("A.1", "A.2", ...) ─────────────────
            # Each user variation is materialised as its OWN
            # ComputedTrapezoid entry — same inputs as the parent plus
            # the (front, back) extension applied. This gives each
            # variation its own legs/blocks/punches/diagonals so
            # downstream consumers (Detail view, BOM, PDF) treat it
            # like a normal trap. The variation entry references its
            # parent via `parentId`; the parent retains
            # `geometry.extensions[]` as the input-side list of
            # variations (idx 0 = parent default, idx N>0 = nth
            # variation).
            user_vars = (step3.get('trapExtensions') or {}).get(trap_id) or []
            for var_idx, var_ext in enumerate(user_vars, start=1):
                cos_a = math.cos(math.radians(angle)) or 1.0
                front_ext_cm = (float(var_ext.get('frontExtMm') or 0) / 10) / cos_a
                back_ext_cm = (float(var_ext.get('backExtMm') or 0) / 10) / cos_a
                if not front_ext_cm and not back_ext_cm:
                    continue
                var_id = f'{trap_id}.{var_idx}'
                var_detail = tds.compute_trapezoid_details(
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
                    variation_front_ext_cm=front_ext_cm,
                    variation_back_ext_cm=back_ext_cm,
                    custom_blocks=(stored_custom_blocks or {}).get(var_id),
                )
                if not var_detail:
                    continue
                var_detail['isFullTrap'] = is_full
                var_detail['panelRowIdx'] = owning_row_idx
                var_detail['parentId'] = trap_id
                # The variation's INTRINSIC extension is the user's
                # input (frontExtMm/backExtMm). Mirror it as idx 0 of
                # the variation's own extensions list — matches the
                # `parentTrap.extensions[var_idx]` entry surfaced onto
                # the parent later by `_apply_trap_extensions`.
                geom = var_detail.setdefault('geometry', {})
                geom['extensions'] = [{
                    'frontExtMm': float(var_ext.get('frontExtMm') or 0),
                    'backExtMm': float(var_ext.get('backExtMm') or 0),
                }]
                result[var_id] = var_detail
                trap_row_map[var_id] = owning_row_idx

    return result, trap_row_map


def _trim_non_full_trapezoids(
    result: dict,
    trapezoids: dict,
    areas: list,
    step2: dict,
    data: dict,
    app_defaults: dict,
    tds,
    stored_custom_blocks: dict | None = None,
) -> None:
    """
    Second pass: trim non-full trapezoids to include only legs for active panel lines.
    
    Modifies result dict in place.
    """
    # Build per-(area, panelRow) full trap lookup. A multi-row area can have
    # several full traps in different rows (e.g. A1 in row 0 + A2 in row 2);
    # a non-full sibling must be trimmed against the full trap that shares
    # its row, otherwise the reference's leg / rail layout is structurally
    # unrelated and `trim_trapezoid` early-returns with empty diagonals and
    # incomplete legs (bug: A3 in row 2 trimmed against A1 in row 0).
    area_row_full_trap: dict[tuple[str, int], dict] = {}
    area_any_full_trap: dict[str, dict] = {}
    for a in areas:
        label = a.get('label', '')
        for tid in a.get('trapezoidIds', []):
            d = result.get(tid)
            if not (d and d.get('isFullTrap')):
                continue
            key = (label, d.get('panelRowIdx', 0))
            if key not in area_row_full_trap:
                area_row_full_trap[key] = d
            if label not in area_any_full_trap:
                area_any_full_trap[label] = d

    for tid, detail in result.items():
        if detail.get('isFullTrap'):
            continue
        # Resolve owning area: direct lookup for parent traps, parent's
        # area for sub-trap variations ("C2.1" inherits C2's area).
        lookup_id = detail.get('parentId') or tid
        is_variation = bool(detail.get('parentId'))
        trap_area = None
        for a in areas:
            if lookup_id in a.get('trapezoidIds', []):
                trap_area = a
                break
        if not trap_area:
            continue
        # Prefer the full trap that shares this non-full trap's row; fall back
        # to any full trap in the area (single-row legacy projects).
        label = trap_area.get('label', '')
        row_idx = detail.get('panelRowIdx', 0)
        full_trap_detail = (
            area_row_full_trap.get((label, row_idx))
            or area_any_full_trap.get(label)
        )
        if not full_trap_detail:
            continue
        full_geom = full_trap_detail.get('geometry', {})
        full_origin = full_geom.get('originCm', 0)
        # Extension source for the strip / re-apply trim path:
        #   - Parent trap (non-full): use the FULL trap's BE-default
        #     extension (extensions[0]) since trimmed sub-traps share
        #     the full trap's default beam shape.
        #   - Variation (e.g. C2.1): use the VARIATION's OWN
        #     intrinsic extension (its extensions[0] = user's input),
        #     so the trimmed variation keeps its specific extension.
        full_exts = full_geom.get('extensions') or [{'frontExtMm': 0, 'backExtMm': 0}]
        if is_variation:
            own_exts = (detail.get('geometry') or {}).get('extensions') or [{'frontExtMm': 0, 'backExtMm': 0}]
            ext_source = own_exts[0] if own_exts else {'frontExtMm': 0, 'backExtMm': 0}
        else:
            ext_source = full_exts[0] if full_exts else {'frontExtMm': 0, 'backExtMm': 0}
        # User-facing semantics (post-schema-fix):
        #   frontExtMm = beam-FRONT extension (right in drawing) — pure
        #                length increase past the front leg.
        #   backExtMm  = beam-REAR extension (left in drawing) — shifts
        #                every leg forward by this amount in beam-local
        #                coords (BE applies via `leg_offset=back_ext`).
        # The trim algorithm runs in the un-shifted (original) coordinate
        # system, so only the back extension needs to be normalized out of
        # leg positions. The front extension affects beam length only and
        # is re-added below alongside the back shift.
        full_front_ext = (ext_source.get('frontExtMm') or 0) / 10
        full_rear_ext  = (ext_source.get('backExtMm') or 0) / 10

        normalized_full = {**full_trap_detail}
        if full_rear_ext:
            normalized_full['legs'] = []
            for leg in full_trap_detail.get('legs', []):
                nl = {**leg, 'positionCm': round_to_1dp(leg['positionCm'] - full_rear_ext),
                       'positionEndCm': round_to_1dp((leg.get('positionEndCm', leg['positionCm'] + full_geom.get('beamThickCm', 4)) - full_rear_ext))}
                if 'railPositionCm' in leg:
                    nl['railPositionCm'] = round_to_1dp(leg['railPositionCm'] - full_rear_ext)
                normalized_full['legs'].append(nl)

        # Use the PARENT's lineOrientations for variations — the
        # variation isn't in step2.trapezoids; its line layout matches
        # its parent's.
        trap_cfg_local = trapezoids.get(lookup_id, {})
        local_orients = trap_cfg_local.get('lineOrientations', [PANEL_V])
        trap_area_id = trap_area.get('id', 0)
        trap_computed_area = _get_computed_area(data, trap_area_id)
        # Rails live per-row on the computed area. Use this trap's own row
        # — defaulting to 0 here silently returns row-0 rails for a row-2
        # sub-trap, leaving `active_rail_positions` empty and the trim
        # early-returning with `legs: []`.
        trap_all_line_rails = _derive_line_rails(trap_computed_area, row_index=detail.get('panelRowIdx', 0))

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
            is_h = orient in (PANEL_H, PANEL_EH)
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
            custom_blocks=(stored_custom_blocks or {}).get(tid),
        )
        result[tid] = detail

        # Re-apply extension to trimmed trap. The back extension shifts
        # every leg / base-beam punch forward in beam-local coords (same as
        # the upstream leg_offset). The front extension only adds length to
        # the beam — no position shift.
        if full_front_ext or full_rear_ext:
            geom = detail['geometry']
            for leg in detail.get('legs', []):
                leg['positionCm'] = round_to_1dp(leg['positionCm'] + full_rear_ext)
                if 'positionEndCm' in leg:
                    leg['positionEndCm'] = round_to_1dp(leg['positionEndCm'] + full_rear_ext)
                if 'railPositionCm' in leg:
                    leg['railPositionCm'] = round_to_1dp(leg['railPositionCm'] + full_rear_ext)
            for p in detail.get('punches', []):
                if p['beamType'] == 'base':
                    p['positionCm'] = round_to_1dp(p['positionCm'] + full_rear_ext)
            geom['baseBeamLength'] = round_to_1dp(geom.get('baseBeamLength', 0) + full_front_ext + full_rear_ext)

            # Add extension-tip outer blocks (and their block punches) — same
            # pattern as `_compute_block_positions` for the full-trap path.
            # The trim path regenerates a fresh block layout that knows
            # nothing about extensions, so we layer the tip blocks on top
            # after re-applying the extension geometry.
            if 'blockLengthCm' in geom and detail.get('blocks') is not None:
                block_length_cm = geom['blockLengthCm']
                block_punch_cm = geom.get('blockPunchCm', 5)
                beam_thick_cm = geom.get('beamThickCm', 4)
                profile_half = beam_thick_cm / 2
                angle = geom.get('angle', 0)
                cos_a = math.cos(math.radians(angle)) or 1.0
                base_beam_length = geom['baseBeamLength']
                blocks = list(detail.get('blocks') or [])
                added_tip_punches: list[dict] = []
                if full_rear_ext > 0:
                    tip_pos = 0.0
                    blocks.insert(0, {
                        'positionCm': round_to_1dp(tip_pos),
                        'isEnd': True,
                        'slopePositionCm': round_to_1dp(profile_half + (tip_pos - profile_half) / cos_a if cos_a > 0 else tip_pos),
                    })
                    rev = round(base_beam_length - block_punch_cm)
                    added_tip_punches.append({
                        'beamType': 'base', 'origin': 'block',
                        'positionCm': round_to_1dp(base_beam_length - rev),
                        'reversedPositionCm': rev,
                    })
                if full_front_ext > 0:
                    tip_pos = base_beam_length - block_length_cm
                    blocks.append({
                        'positionCm': round_to_1dp(tip_pos),
                        'isEnd': True,
                        'slopePositionCm': round_to_1dp(profile_half + (tip_pos - profile_half) / cos_a if cos_a > 0 else tip_pos),
                    })
                    raw_pos = base_beam_length - block_punch_cm
                    rev = round(base_beam_length - raw_pos)
                    added_tip_punches.append({
                        'beamType': 'base', 'origin': 'block',
                        'positionCm': round_to_1dp(base_beam_length - rev),
                        'reversedPositionCm': rev,
                    })
                # Renumber blockIdx on existing + new block punches to stay
                # 1:1 with the blocks list (downstream BOM / FE both rely on
                # the index ordering).
                detail['blocks'] = blocks
                if added_tip_punches:
                    block_punches = [p for p in detail.get('punches', []) if p.get('origin') == 'block']
                    other_punches = [p for p in detail.get('punches', []) if p.get('origin') != 'block']
                    # Insert/append the new punches in the same order as the new blocks.
                    if full_rear_ext > 0:
                        block_punches.insert(0, added_tip_punches.pop(0))
                    if full_front_ext > 0 and added_tip_punches:
                        block_punches.append(added_tip_punches.pop(0))
                    for i, bp in enumerate(block_punches):
                        bp['blockIdx'] = i
                    detail['punches'] = other_punches + block_punches

        # Inherit/refresh the trap's base-beam extensions list:
        #   - Parent trimmed trap: mirrors the FULL trap's list so the
        #     trimmed C2 carries the same default + user variants as C1.
        #   - Variation (C2.1): keeps its OWN extensions list (a single
        #     entry — its intrinsic extension), regardless of the
        #     parent's list.
        if not is_variation:
            detail['geometry']['extensions'] = [dict(e) for e in full_exts]


def _align_blocks_across_trapezoids(
    result: dict,
    areas: list,
    tds,
    trap_row_map: dict[str, int] | None = None,
    pinned_trap_ids: set[str] | None = None,
) -> dict[str, list[str]]:
    """
    Align block positions across trapezoids that share physical base beams.

    Traps share a base beam set only when they belong to the same (area, panel row);
    traps in different rows of a multi-row area sit on entirely separate bases, so
    aligning their block positions pulls phantom blocks under non-existent legs.

    Pinned trap ids (traps with user-supplied customBlocks) are forwarded to
    `align_blocks` so their block lists are not redistributed.

    Returns area_trap_map: {area_label: [trapId, ...]}.
    """
    trap_row_map = trap_row_map or {}
    # Group by (area_label, row_idx) — bases are per-row, not per-area
    row_trap_map: dict[tuple[str, int], list[str]] = {}
    area_trap_map: dict[str, list[str]] = {}
    for a in areas:
        label = a.get('label', '')
        for tid in a.get('trapezoidIds', []):
            area_trap_map.setdefault(label, []).append(tid)
            row_idx = trap_row_map.get(tid, 0)
            row_trap_map.setdefault((label, row_idx), []).append(tid)
    for (_label, _ri), trap_ids in row_trap_map.items():
        row_traps = {tid: result[tid] for tid in trap_ids if tid in result}
        tds.align_blocks(row_traps, pinned_trap_ids=pinned_trap_ids)
        result.update(row_traps)
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

    project_roof_spec = project.roof_spec

    # Global frameless skip only for fully-frameless projects (tiles, flat_installation).
    # Mixed projects let the per-trap check inside _compute_all_trapezoid_details decide.
    if is_frameless_roof_type(project_roof_spec.get('type')):
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

    # Stored custom blocks (per-trap user overrides; concrete roofs only)
    stored_custom_blocks = step3.get('customBlocks', {}) or {}

    # ── Compute all trapezoids (first pass — full trap computation) ────────────
    result, trap_row_map = _compute_all_trapezoid_details(
        trapezoids, areas, step2, step3, data, app_defaults,
        trapezoid_configs, stored_custom_diags, tds, project_roof_spec,
        stored_custom_blocks=stored_custom_blocks,
    )

    # Persist first pass results
    for tid, detail in result.items():
        _upsert_computed_trapezoid(step3, tid, detail)

    # ── Trim non-full trapezoids (second pass) ──────────────────────────────────
    _trim_non_full_trapezoids(
        result, trapezoids, areas, step2, data, app_defaults, tds,
        stored_custom_blocks=stored_custom_blocks,
    )

    # Persist trimmed results
    for tid, detail in result.items():
        _upsert_computed_trapezoid(step3, tid, detail)

    # ── Align blocks across trapezoids sharing physical base beams ──────────────
    # Restrict to (area, panel row) groups — traps in different rows of a
    # multi-row area sit on separate base beams, so aligning across rows
    # produces phantom blocks under non-existent legs. Traps with user-
    # supplied customBlocks are pinned: their positions seed the alignment
    # for neighbours but are not themselves redistributed.
    pinned_block_trap_ids = set(stored_custom_blocks.keys())
    _align_blocks_across_trapezoids(
        result, areas, tds, trap_row_map,
        pinned_trap_ids=pinned_block_trap_ids,
    )

    # ── Persist aligned blocks ────────────────────────────────────────────────
    for tid, detail in result.items():
        _upsert_computed_trapezoid(step3, tid, detail)

    # ── Group identical trapezoids by shape (for PDF consolidation) ───────────
    step3['trapezoidGroups'] = group_identical_trapezoids(
        step3.get('computedTrapezoids', [])
    )

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
        
        # Bases overrides → step3.customBasesOffsets (the row-aware store).
        #
        # Accept two wire shapes:
        #   - Snapshot dict: { "trapId:rowIdx": offsetsMm[] }
        #   - Op list: list[BaseOp] (move / add / delete)
        # Both materialise as a per-(trap, row) snapshot, then write into
        # `step3.customBasesOffsets` directly. The recompute path's
        # `_apply_persisted_position_overrides` reads from that store
        # using the `f'{trap_id}:{row_idx}'` key.
        # Build the per-(trap, row) snapshot from base ops and stash the
        # post-ops base_lookup so the trap-extend handler below can find
        # each affected base's slot in the variations array (the lookup
        # accounts for slot shifts caused by add / delete ops).
        post_ops_base_lookup: dict[tuple[str, int, str], tuple[str, int]] | None = None
        if 'bases' in overrides and overrides['bases']:
            raw_bases = overrides['bases']
            if isinstance(raw_bases, list):
                snapshot, var_snapshot, post_ops_base_lookup = _ops_to_base_snapshot(
                    project, raw_bases,
                )
            else:
                # Legacy snapshot dict — no variations carried; preserve any
                # existing customBaseVariations untouched.
                snapshot = raw_bases
                var_snapshot = None
            # Mutate project.data in place so the compute chain that runs
            # downstream picks it up. MUST commit before the recompute
            # chain — compute_and_save_rails refreshes the project from
            # the DB and would otherwise discard the in-memory write.
            data = copy.deepcopy(project.data or {})
            step3 = data.setdefault('step3', {})
            cbo = step3.setdefault('customBasesOffsets', {})
            for key, offsets in snapshot.items():
                cbo[key] = offsets
            if var_snapshot is not None:
                cbv = step3.setdefault('customBaseVariations', {})
                for key, vars_for_key in var_snapshot.items():
                    cbv[key] = vars_for_key
            project.data = data
            flag_modified(project, 'data')
            await db.commit()
            await db.refresh(project)

        # Block overrides → step3.customBlocks (per-trap user block edits).
        #
        # Accept two wire shapes (mirrors bases):
        #   - Op list: list[BlockOp] (move / add / delete)
        #   - Snapshot dict: { trapId: [{positionCm, isEnd}, ...] }
        # Empty list under a trapId in the snapshot dict clears that trap's
        # override — used by the unified per-trap "Reset trap" button.
        if 'blocks' in overrides and overrides['blocks']:
            raw_blocks = overrides['blocks']
            if isinstance(raw_blocks, list):
                block_result = _ops_to_block_snapshot(project, raw_blocks)
            else:
                # Snapshot shape — accept as-is. Normalise so empty lists
                # become None (drop signal) for the writer loop below.
                block_result = {
                    tid: (blocks if blocks else None)
                    for tid, blocks in raw_blocks.items()
                }
            data = copy.deepcopy(project.data or {})
            step3 = data.setdefault('step3', {})
            cb = step3.setdefault('customBlocks', {})
            for tid, blocks in block_result.items():
                if blocks is None or len(blocks) == 0:
                    cb.pop(tid, None)
                else:
                    cb[tid] = blocks
            if not cb:
                step3.pop('customBlocks', None)
            project.data = data
            flag_modified(project, 'data')
            await db.commit()
            await db.refresh(project)

        # Diagonal overrides → trapezoidConfigs[].customDiagonals
        # Format: { trapId: { spanId: {topDistFromLegCm, botDistFromLegCm} | {disabled: true} } }
        if 'diagonals' in overrides and overrides['diagonals']:
            trapezoid_configs = trapezoid_configs or {}
            for trap_id, diag_obj in overrides['diagonals'].items():
                expanded_obj = {str(span_id): value for span_id, value in diag_obj.items() if isinstance(value, dict)}
                trap_cfg = trapezoid_configs.setdefault(trap_id, {})
                trap_cfg['customDiagonals'] = expanded_obj

        # Trap extend ops → step3.trapExtensions + step3.customBaseVariations.
        # Surfaced onto each base's trapezoidId + startCm/lengthCm by
        # `_apply_base_extensions` after the recompute. See TrapExtendOp
        # in routers/projects.py.
        #
        # MUST commit + refresh after applying — the compute chain that
        # follows (`compute_and_save_rails` → `compute_and_save_bases`)
        # opens with `await db.refresh(project)` which would revert any
        # uncommitted JSONB mutation, silently dropping the extends.
        if 'traps' in overrides and overrides['traps']:
            _apply_trap_extend_ops(
                project, overrides['traps'],
                base_lookup=post_ops_base_lookup,
            )
            await db.commit()
            await db.refresh(project)

    # Persist trap-scope schema params into step3.trapezoidConfigs so they
    # survive project reload. Drag-edit data (customBasesOffsets,
    # customDiagonals) lives in dedicated step3 paths, not here.
    if trapezoid_configs:
        await _persist_trap_schema_configs(db, project, trapezoid_configs)

    # Any tab change recomputes the full chain: rails → bases → trapezoid details → external diagonals
    rails_result = await compute_and_save_rails(db, project, rs, step3_data)
    bases_result = await compute_and_save_bases(db, project, bs, step3_data, trapezoid_configs)
    trapezoid_details = {}
    if tds:
        trapezoid_details = await compute_and_save_trapezoid_details(
            db, project, tds, step3_data, trapezoid_configs,
        )
        # Surface user variations onto each trap's geometry.extensions[],
        # then stamp affected bases' trapezoidId + startCm/lengthCm.
        _apply_trap_extensions(project)
        _apply_base_extensions(project)
        flag_modified(project, 'data')
        await db.commit()
        await db.refresh(project)
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
        # Trap base-beam extension variants — both the per-trap variation
        # list and the per-base assignments (current customBaseVariations
        # + legacy baseVariations) — are wiped on bases reset.
        step3.pop('trapExtensions', None)
        step3.pop('customBaseVariations', None)
        step3.pop('baseVariations', None)
        for area_settings in (step3.get('areaSettings') or {}).values():
            if isinstance(area_settings, dict):
                for key in ['edgeOffsetMm', 'spacingMm', 'baseOverhangCm']:
                    area_settings.pop(key, None)
        # Trap-scope bases params live in step3.trapezoidConfigs (new
        # persistence). Strip them so reset truly returns to defaults.
        for trap_cfg in (step3.get('trapezoidConfigs') or {}).values():
            if isinstance(trap_cfg, dict):
                for key in ['edgeOffsetMm', 'spacingMm', 'baseOverhangCm']:
                    trap_cfg.pop(key, None)
    elif tab == 'trapezoids':
        step3.pop('customDiagonals', None)
        step3.pop('customBlocks', None)
        for area_settings in (step3.get('areaSettings') or {}).values():
            if isinstance(area_settings, dict):
                for key in ['diagDistFromLegCm', 'diagPreferredAngleDeg']:
                    area_settings.pop(key, None)
        for trap_cfg in (step3.get('trapezoidConfigs') or {}).values():
            if isinstance(trap_cfg, dict):
                for key in ['extendFront', 'extendRear']:
                    trap_cfg.pop(key, None)

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
