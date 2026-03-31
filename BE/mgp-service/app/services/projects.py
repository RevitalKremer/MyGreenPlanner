import copy
import uuid
from datetime import date
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from app.models.project import Project
from app.models.setting import AppSetting
from app.models.user import User
from app.schemas.project import ProjectCreate, ProjectUpdate
from app.services import bom_service


async def list_projects(db: AsyncSession, owner_id: uuid.UUID) -> list[Project]:
    result = await db.execute(select(Project).where(Project.owner_id == owner_id).order_by(Project.updated_at.desc()))
    return list(result.scalars().all())


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


def get_project_areas(project: Project) -> list:
    """Return the step2 areas list."""
    return (project.data or {}).get('step2', {}).get('areas', [])


def _get_computed_areas(data: dict) -> list:
    """Return step3.computedAreas list."""
    return data.get('step3', {}).get('computedAreas', [])


def _get_computed_area(data: dict, label: str) -> dict | None:
    """Find a computed area by label."""
    for ca in _get_computed_areas(data):
        if ca.get('label') == label:
            return ca
    return None


def _get_computed_trapezoids(data: dict) -> list:
    """Return step3.computedTrapezoids list."""
    return data.get('step3', {}).get('computedTrapezoids', [])


def _get_computed_trapezoid(data: dict, trap_id: str) -> dict | None:
    """Find a computed trapezoid by trapId."""
    for ct in _get_computed_trapezoids(data):
        if ct.get('trapId') == trap_id:
            return ct
    return None


def _upsert_computed_area(step3: dict, label: str, updates: dict) -> None:
    """Insert or update a computed area entry by label."""
    computed = step3.setdefault('computedAreas', [])
    for ca in computed:
        if ca.get('label') == label:
            ca.update(updates)
            return
    computed.append({'label': label, **updates})


def _upsert_computed_trapezoid(step3: dict, trap_id: str, detail: dict) -> None:
    """Insert or update a computed trapezoid entry by trapId."""
    computed = step3.setdefault('computedTrapezoids', [])
    for ct in computed:
        if ct.get('trapId') == trap_id:
            ct.update(detail)
            return
    computed.append({'trapId': trap_id, **detail})


def _derive_line_rails(computed_area: dict | None) -> dict[str, list[float]]:
    """Group computed rails by lineIdx → sorted offsets."""
    if not computed_area:
        return {}
    derived: dict[str, list] = {}
    for r in computed_area.get('rails', []):
        li = str(r.get('lineIdx', 0))
        off = r.get('offsetFromLineFrontCm')
        if off is not None:
            derived.setdefault(li, []).append(off)
    return {li: sorted(offs) for li, offs in derived.items()}


def _build_rail_inputs(data: dict, area: dict, area_idx: int, app_defaults: dict) -> dict:
    """Extract rail computation inputs from project data for one area."""
    step2           = data.get('step2', {})
    step3           = data.get('step3', {})
    global_settings = step3.get('globalSettings') or {}
    area_settings_raw = step3.get('areaSettings') or {}
    if isinstance(area_settings_raw, list):
        area_settings = area_settings_raw[area_idx] if area_idx < len(area_settings_raw) else {}
    else:
        area_settings = area_settings_raw.get(str(area_idx)) or {}

    # lineRails: use transient override from FE if provided; otherwise let
    # rail_service compute from default spacing (no re-derivation from old rails)
    line_rails = area_settings.get('lineRails') or {}

    return {
        'panel_grid':        area.get('panelGrid') or {},
        'panel_width_cm':    step2.get('panelWidthCm'),
        'panel_length_cm':   step2.get('panelLengthCm'),
        'line_rails':        line_rails,
        'overhang_cm':       area_settings.get('railOverhangCm',  app_defaults['railOverhangCm']),
        'stock_lengths':     global_settings.get('stockLengths',   app_defaults['stockLengths']),
        'panel_gap_cm':      app_defaults['panelGapCm'],
        'rail_spacing_v_cm': area_settings.get('railSpacingV',    app_defaults['railSpacingV']),
        'rail_spacing_h_cm': area_settings.get('railSpacingH',    app_defaults['railSpacingH']),
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
        existing_step3.update(step3_data)
        data['step3'] = existing_step3
    step3 = data.setdefault('step3', {})
    areas = data.get('step2', {}).get('areas', [])
    result = []

    rows = (await db.execute(
        select(AppSetting.key, AppSetting.value_json).where(
            AppSetting.key.in_(['panelGapCm', 'railOverhangCm', 'stockLengths', 'railSpacingV', 'railSpacingH'])
        )
    )).all()
    app_defaults = {r.key: r.value_json for r in rows}

    for i, area in enumerate(areas):
        label = area.get('label', str(i))
        computed = rs.compute_area_rails(**_build_rail_inputs(data, area, i, app_defaults))
        _upsert_computed_area(step3, label, {
            'rails': computed['rails'],
            'numLargeGaps': computed['numLargeGaps'],
        })
        result.append({
            'areaLabel':    label,
            'rails':        computed['rails'],
            'numLargeGaps': computed['numLargeGaps'],
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
    For multi-trap areas, uses the shorter rows (lines with fewer panels)
    to determine where each trap's X range begins and ends.
    """
    if len(trap_ids) <= 1:
        return None, None

    rows = panel_grid.get('rows', [])
    if not rows:
        return None, None

    row_positions = panel_grid.get('rowPositions') or {}
    short_cm = panel_width_cm
    long_cm = panel_length_cm

    main_row = max(rows, key=lambda r: sum(1 for c in r if c in ('V', 'H')))
    orient = None
    for c in main_row:
        if c in ('V', 'EV'):
            orient = 'V'; break
        if c in ('H', 'EH'):
            orient = 'H'; break
    if not orient:
        return None, None

    panel_along_cm = short_cm if orient == 'V' else long_cm
    main_idx = rows.index(main_row)
    stored = row_positions.get(str(main_idx))
    if stored:
        positions = stored
    else:
        positions = [
            i * (panel_along_cm + panel_gap_cm)
            for i, cell in enumerate(main_row)
            if cell in ('V', 'H')
        ]

    if not positions:
        return None, None

    total_cols = len(positions)

    trap_cfg = trapezoids.get(trapezoid_id, {})
    line_orients = trap_cfg.get('lineOrientations', [])
    active_lines = [o for o in line_orients if 'empty' not in o]
    all_active = len(active_lines) == len(line_orients)

    row_active_counts = []
    for line_idx, cells in enumerate(rows):
        count = sum(1 for c in cells if c in ('V', 'H'))
        if count > 0:
            row_active_counts.append((line_idx, count))

    if len(row_active_counts) <= 1:
        cols_per_trap = total_cols // len(trap_ids)
        remainder = total_cols % len(trap_ids)
    else:
        row_active_counts.sort(key=lambda x: x[1])
        short_count = row_active_counts[0][1]
        short_line_idx = row_active_counts[0][0]
        short_row = rows[short_line_idx]

        short_orient = None
        for c in short_row:
            if c in ('V', 'EV'):
                short_orient = 'V'; break
            if c in ('H', 'EH'):
                short_orient = 'H'; break
        short_panel_width = short_cm if short_orient == 'V' else long_cm
        main_panel_pitch = panel_along_cm + panel_gap_cm

        cols_per_short_panel = max(1, round(short_panel_width / main_panel_pitch)) if main_panel_pitch > 0 else 1
        cols_covered_by_short = short_count * cols_per_short_panel

        if all_active:
            cols_per_trap = cols_covered_by_short
            remainder = 0
        else:
            cols_per_trap = total_cols - cols_covered_by_short
            remainder = 0

    trap_idx = trap_ids.index(trapezoid_id) if trapezoid_id in trap_ids else 0

    if len(row_active_counts) > 1:
        start_col = 0
        for t_idx, t_id in enumerate(trap_ids):
            t_cfg = trapezoids.get(t_id, {})
            t_orients = t_cfg.get('lineOrientations', [])
            t_all_active = all(('empty' not in o) for o in t_orients)

            if t_idx == trap_idx:
                break

            if t_all_active:
                start_col += cols_covered_by_short
            else:
                start_col += total_cols - cols_covered_by_short

        end_col = start_col + cols_per_trap - 1
    else:
        start_col = 0
        for t in range(trap_idx):
            start_col += cols_per_trap + (1 if t < remainder else 0)
        end_col = start_col + cols_per_trap + (1 if trap_idx < remainder else 0) - 1

    if start_col >= len(positions) or end_col >= len(positions):
        return None, None

    trap_start = positions[start_col]
    trap_end = positions[end_col] + panel_along_cm

    return trap_start, trap_end


def _build_base_inputs(
    data: dict, area: dict, area_idx: int, app_defaults: dict,
    trapezoid_id: str, trapezoid_configs: dict | None = None,
    trap_start_cm: float | None = None, trap_end_cm: float | None = None,
) -> dict:
    """Extract base computation inputs for one trapezoid within an area."""
    step2 = data.get('step2', {})
    label = area.get('label', str(area_idx))

    # Line rails from computed area data
    computed_area = _get_computed_area(data, label)
    line_rails = _derive_line_rails(computed_area)

    trap_cfg = (trapezoid_configs or {}).get(trapezoid_id, {})
    custom_offsets = trap_cfg.get('customOffsets')

    return {
        'panel_grid':          area.get('panelGrid') or {},
        'panel_width_cm':      step2.get('panelWidthCm'),
        'panel_length_cm':     step2.get('panelLengthCm'),
        'line_rails':          line_rails,
        'edge_offset_mm':      trap_cfg.get('edgeOffsetMm',      app_defaults['edgeOffsetMm']),
        'spacing_mm':          trap_cfg.get('spacingMm',          app_defaults['spacingMm']),
        'base_overhang_cm':    trap_cfg.get('baseOverhangCm',     app_defaults['baseOverhangCm']),
        'block_length_cm':     app_defaults.get('blockLengthCm',  50),
        'cross_rail_offset_cm': app_defaults.get('crossRailEdgeDistMm', 40) / 10,
        'panel_gap_cm':        app_defaults['panelGapCm'],
        'trapezoid_id':        trapezoid_id,
        'trap_start_cm':       trap_start_cm,
        'trap_end_cm':         trap_end_cm,
        'custom_offsets':      custom_offsets,
    }


def _compute_area_frame_mm(area: dict, step2: dict, panel_gap_cm: float) -> int | None:
    """Compute the frame length (mm) for an area from its panel grid."""
    panel_grid = area.get('panelGrid') or {}
    rows = panel_grid.get('rows', [])
    row_positions = panel_grid.get('rowPositions') or {}
    short_cm = step2.get('panelWidthCm', 113.4)
    long_cm = step2.get('panelLengthCm', 238.2)

    auto_start = float('inf')
    auto_end = float('-inf')
    for line_idx, cells in enumerate(rows):
        orient = None
        for c in cells:
            if c in ('V', 'EV'):
                orient = 'V'; break
            if c in ('H', 'EH'):
                orient = 'H'; break
        if not orient:
            continue
        panel_along_cm = short_cm if orient == 'V' else long_cm
        stored = row_positions.get(str(line_idx))
        if stored:
            positions = stored
        else:
            positions = [
                i * (panel_along_cm + panel_gap_cm)
                for i, cell in enumerate(cells)
                if cell in ('V', 'H')
            ]
        if not positions:
            continue
        auto_start = min(auto_start, positions[0])
        auto_end = max(auto_end, positions[-1] + panel_along_cm)

    if auto_start == float('inf'):
        return None
    return round((auto_end - auto_start) * 10)


async def compute_and_save_bases(
    db: AsyncSession, project: Project, bs,
    step3_data: dict | None = None, trapezoid_configs: dict | None = None,
) -> list:
    """Compute bases for all areas, persist to step3.computedAreas, return per-area results."""
    await db.refresh(project)
    data = copy.deepcopy(project.data or {})
    if step3_data is not None:
        existing_step3 = data.get('step3', {})
        for k in _SERVER_COMPUTED_STEP3_KEYS:
            if k in existing_step3 and k not in step3_data:
                step3_data[k] = existing_step3[k]
        existing_step3.update(step3_data)
        data['step3'] = existing_step3
    step3 = data.setdefault('step3', {})
    areas = data.get('step2', {}).get('areas', [])
    step2 = data.get('step2', {})
    trapezoids = step2.get('trapezoids', {})
    result = []

    rows = (await db.execute(
        select(AppSetting.key, AppSetting.value_json).where(
            AppSetting.key.in_([
                'panelGapCm', 'edgeOffsetMm', 'spacingMm', 'baseOverhangCm',
                'blockLengthCm', 'crossRailEdgeDistMm',
            ])
        )
    )).all()
    app_defaults = {r.key: r.value_json for r in rows}

    # Persist custom offsets
    stored_custom = step3.get('basesCustomOffsets') or {}
    if trapezoid_configs:
        for trap_id, cfg in trapezoid_configs.items():
            co = cfg.get('customOffsets')
            if co is not None:
                if len(co) > 0:
                    stored_custom[trap_id] = co
                else:
                    stored_custom.pop(trap_id, None)
    step3['basesCustomOffsets'] = stored_custom

    for i, area in enumerate(areas):
        label = area.get('label', str(i))
        trap_ids = area.get('trapezoidIds', [])
        if not trap_ids:
            trap_ids = [label]

        # Check if this area already has computed bases
        computed_area = _get_computed_area(data, label)
        has_existing_bases = computed_area is not None and len(computed_area.get('bases', [])) > 0

        bases_data_map: dict[str, dict | None] = {}
        for trap_id in trap_ids:
            trap_start, trap_end = _compute_trap_x_range(
                area.get('panelGrid') or {}, trap_id, trap_ids,
                trapezoids,
                step2.get('panelWidthCm', 113.4), step2.get('panelLengthCm', 238.2),
                app_defaults.get('panelGapCm', 2.5),
            )

            trap_frame_mm = round((trap_end - trap_start) * 10) if trap_start is not None and trap_end is not None else None

            effective_configs = dict(trapezoid_configs or {})
            if trap_id not in effective_configs:
                effective_configs[trap_id] = {}

            if not has_existing_bases:
                effective_configs[trap_id].pop('customOffsets', None)
                stored_custom.pop(trap_id, None)
            elif 'customOffsets' not in effective_configs[trap_id] and trap_id in stored_custom:
                stored = stored_custom[trap_id]
                frame_check = trap_frame_mm or round((trap_end - trap_start) * 10) if trap_start is not None else None
                if stored and len(stored) >= 2 and frame_check and max(stored) <= frame_check:
                    effective_configs[trap_id]['customOffsets'] = stored
                else:
                    stored_custom.pop(trap_id, None)

            inputs = _build_base_inputs(data, area, i, app_defaults, trap_id, effective_configs, trap_start, trap_end)
            bases_data_map[trap_id] = bs.compute_area_bases(**inputs)

        consolidated = bs.consolidate_area_bases(trap_ids, bases_data_map)

        all_bases = []
        for trap_id in trap_ids:
            all_bases.extend(consolidated.get(trap_id, []))

        _upsert_computed_area(step3, label, {'bases': all_bases})
        result.append({
            'areaLabel': label,
            'bases': all_bases,
            'basesDataMap': {k: v for k, v in bases_data_map.items() if v},
        })

    project.data = data
    flag_modified(project, 'data')
    await db.commit()
    return result


async def update_project_step(
    db: AsyncSession, project: Project, new_step: int,
    rs=None, bs=None, tds=None,
) -> dict:
    """
    Transition project to a new step with server-side data cleanup.
    Forward: resets dependent data and recomputes (e.g., rails+bases on 2→3).
    Backward: clears data from steps being navigated away from.
    """
    old_step = (project.navigation or {}).get('step', 1)
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

    # ── Compute rails + bases + trapezoid details on entering step 3 ──
    trapezoid_details = None
    if new_step >= 3 and 'step3' in cleared and rs and bs:
        rails_result = await compute_and_save_rails(db, project, rs)
        bases_result = await compute_and_save_bases(db, project, bs)
        if tds:
            trapezoid_details = await compute_and_save_trapezoid_details(db, project, tds)

    # ── Auto-compute BOM on entering step 4 ──
    bom_result = None
    if new_step >= 4:
        await db.refresh(project)
        existing_bom = await bom_service.get_bom(db, project.id)
        if not existing_bom or bom_service.is_bom_stale(project.data or {}, existing_bom):
            bom_obj = await bom_service.compute_and_save_bom(db, project)
            bom_result = {'items': bom_obj.items, 'id': str(bom_obj.id)}

    result = {'currentStep': new_step, 'clearedSteps': cleared}
    if rails_result:
        result['rails'] = rails_result
    if bases_result:
        result['bases'] = bases_result
    if trapezoid_details:
        result['trapezoidDetails'] = trapezoid_details
    if bom_result:
        result['bom'] = bom_result
    return result


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
        existing_step3.update(step3_data)
        data['step3'] = existing_step3
    step2 = data.get('step2', {})
    step3 = data.setdefault('step3', {})
    trapezoids = step2.get('trapezoids', {})
    areas = step2.get('areas', [])
    global_settings = step3.get('globalSettings', {})

    rows = (await db.execute(
        select(AppSetting.key, AppSetting.value_json).where(
            AppSetting.key.in_([
                'panelGapCm', 'edgeOffsetMm', 'spacingMm', 'baseOverhangCm',
                'blockHeightCm', 'blockLengthCm', 'blockWidthCm', 'blockPunchCm',
                'crossRailEdgeDistMm', 'angleProfileSizeMm', 'panelThickCm',
            ])
        )
    )).all()
    app_defaults = {r.key: r.value_json for r in rows}

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

    result = {}
    for trap_id, trap_cfg in trapezoids.items():
        # Find the area this trap belongs to
        area = None
        for a in areas:
            if trap_id in a.get('trapezoidIds', []):
                area = a
                break
        if not area:
            continue

        label = area.get('label', '')

        # Build panel lines from trap's lineOrientations
        line_orients = trap_cfg.get('lineOrientations', ['vertical'])

        # Derive line rails — only for active (non-empty) lines of this trapezoid.
        # Ghost rendering is handled by the FE overlaying the full trap's DetailView.
        computed_area = _get_computed_area(data, label)
        all_line_rails = _derive_line_rails(computed_area)
        line_rails = {
            li: offs for li, offs in all_line_rails.items()
            if int(li) < len(line_orients) and 'empty' not in line_orients[int(li)]
        }
        # Build panel_lines only for active (non-empty) lines.
        # Remap line_rails keys to match the filtered panel_lines indices.
        panel_lines = []
        remapped_line_rails = {}
        active_idx = 0
        for li, orient in enumerate(line_orients):
            if 'empty' in orient:
                continue  # skip empty lines — ghost handled by FE overlay
            is_h = orient == 'horizontal'
            depth = step2.get('panelWidthCm', 113.4) if is_h else step2.get('panelLengthCm', 238.2)
            gap = app_defaults.get('panelGapCm', 2.5) if active_idx > 0 else 0
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

        # Get bases data from computed area — use the trap's own actual base data
        bases_data = None
        if computed_area:
            bases = [b for b in computed_area.get('bases', []) if b.get('trapezoidId') == trap_id]
            if bases:
                base_overhang = t_cfg.get('baseOverhangCm', app_defaults['baseOverhangCm'])
                bases_data = {
                    'baseLengthCm': bases[0].get('lengthCm', 0),
                    'rearLegDepthCm': bases[0].get('topDepthCm', 0) + base_overhang,
                    'frontLegDepthCm': bases[0].get('bottomDepthCm', 0) - base_overhang,
                }

        rail_offset_cm = float(line_rails.get('0', [0])[0]) if line_rails.get('0') else 0

        custom_diags = stored_custom_diags.get(trap_id)

        detail = tds.compute_trapezoid_details(
            bases_data=bases_data,
            line_rails=line_rails,
            panel_lines=panel_lines,
            angle_deg=angle,
            front_height_cm=front_height,
            rail_offset_cm=rail_offset_cm,
            settings=app_defaults,
            overrides=t_cfg,
            custom_diagonals=custom_diags,
            global_settings=global_settings,
        )

        if detail:
            is_full = all('empty' not in o for o in line_orients)
            detail['isFullTrap'] = is_full
            _upsert_computed_trapezoid(step3, trap_id, detail)
            result[trap_id] = detail

    # ── Second pass: for trimmed traps, derive legs from the full trap ────
    # All traps in an area share the same rail positions. Trimmed traps
    # keep only the legs whose positions match their active rail offsets.
    full_trap_detail = None
    for tid, detail in result.items():
        if detail.get('isFullTrap'):
            full_trap_detail = detail
            break

    if full_trap_detail:
        full_origin = full_trap_detail.get('geometry', {}).get('originCm', 0)
        full_base_overhang = app_defaults.get('baseOverhangCm', 5)

        for tid, detail in result.items():
            if detail.get('isFullTrap'):
                continue
            trap_cfg_local = trapezoids.get(tid, {})
            local_orients = trap_cfg_local.get('lineOrientations', ['vertical'])
            # Find the area this trap belongs to and get all line rails
            trap_area = None
            for a in areas:
                if tid in a.get('trapezoidIds', []):
                    trap_area = a
                    break
            trap_label = trap_area.get('label', '') if trap_area else ''
            trap_computed_area = _get_computed_area(data, trap_label)
            trap_all_line_rails = _derive_line_rails(trap_computed_area)

            # Build active rail positions in the full trap's coordinate system
            # (globalOffsetCm - origin) so they match railPositionCm in full trap legs.
            active_rail_positions = set()
            d_cm = 0.0
            for li, orient in enumerate(local_orients):
                is_h = orient == 'horizontal'
                depth = step2.get('panelWidthCm', 113.4) if is_h else step2.get('panelLengthCm', 238.2)
                gap = app_defaults.get('panelGapCm', 2.5) if li > 0 else 0
                d_cm += gap
                if 'empty' not in orient:
                    for off in trap_all_line_rails.get(str(li), []):
                        active_rail_positions.add(round(d_cm + off - full_origin, 1))
                d_cm += depth

            # Filter full trap's legs: keep outer rear + inner legs at active rail positions
            full_legs = full_trap_detail.get('legs', [])
            filtered_legs = []
            for leg in full_legs:
                if not leg['isInner']:
                    # Outer rear leg (position 0): always keep
                    if round(leg['positionCm'], 1) == 0:
                        filtered_legs.append(leg)
                    # Skip outer front leg — will add correct one below
                else:
                    # Inner leg: match on railPositionCm (position before cross-rail offset)
                    rail_pos = round(leg.get('railPositionCm', leg['positionCm']), 1)
                    if rail_pos in active_rail_positions:
                        filtered_legs.append(leg)

            # Add front outer leg at last active rail + base overhang
            if filtered_legs and active_rail_positions:
                t_cfg_local = (trapezoid_configs or {}).get(tid, {})
                trap_overhang = t_cfg_local.get('baseOverhangCm', full_base_overhang)
                last_rail = max(active_rail_positions)
                front_pos = last_rail + trap_overhang
                # Interpolate height from full trap
                full_front = full_trap_detail['legs'][-1]
                full_rear = full_trap_detail['legs'][0]
                full_span = full_front['positionCm']
                frac = front_pos / full_span if full_span > 0 else 1
                front_height = full_rear['heightCm'] + frac * (full_front['heightCm'] - full_rear['heightCm'])
                filtered_legs.append({
                    'positionCm': round(front_pos * 10) / 10,
                    'heightCm': round(front_height * 10) / 10,
                    'isInner': False,
                    'side': 'outer',
                })

            detail['legs'] = filtered_legs

            # Filter diagonals: keep only spans within the filtered leg range
            num_filtered_spans = len(filtered_legs) - 1
            detail['diagonals'] = [
                d for d in detail.get('diagonals', [])
                if d['spanIdx'] < num_filtered_spans
            ]

            _upsert_computed_trapezoid(step3, tid, detail)
            result[tid] = detail

    project.data = data
    flag_modified(project, 'data')
    await db.commit()

    return result


async def save_tab(
    db: AsyncSession, project: Project, tab: str,
    rs, bs, tds=None,
    step3_data: dict | None = None, trapezoid_configs: dict | None = None,
) -> dict:
    """
    Save data from the active tab, recompute dependents, and return all step 3 data.
    Tab dependency: rails → bases → trapezoids.
    """
    # Update navigation.tab
    nav = dict(project.navigation or {'step': 1})
    nav['tab'] = tab
    project.navigation = nav
    flag_modified(project, 'navigation')
    await db.commit()

    # Any tab change recomputes the full chain: rails → bases → trapezoid details
    rails_result = await compute_and_save_rails(db, project, rs, step3_data)
    bases_result = await compute_and_save_bases(db, project, bs, step3_data, trapezoid_configs)
    trapezoid_details = {}
    if tds:
        trapezoid_details = await compute_and_save_trapezoid_details(
            db, project, tds, step3_data, trapezoid_configs,
        )

    return {
        'tab': tab,
        'rails': rails_result,
        'bases': bases_result,
        'trapezoidDetails': trapezoid_details,
    }


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
