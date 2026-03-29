import copy
import logging
import uuid
from datetime import date
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

logger = logging.getLogger("mgp")

from app.models.project import Project
from app.models.setting import AppSetting
from app.models.user import User
from app.schemas.project import ProjectCreate, ProjectUpdate


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


async def update_project(db: AsyncSession, project: Project, payload: ProjectUpdate, step: int | None = None) -> Project:
    fields = payload.model_dump(exclude_none=True)

    if step is not None and 'data' in fields:
        # Merge only data.step{n} — leave all other steps (incl. planApproval) untouched
        step_key = f'step{step}'
        incoming_step = fields['data'].get(step_key)
        merged = copy.deepcopy(project.data or {})
        if incoming_step is not None:
            merged[step_key] = incoming_step
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
    """Return the areas list from the v2.0 project data structure."""
    return (project.data or {}).get('step2', {}).get('areas', [])


def _build_rail_inputs(data: dict, area: dict, area_idx: int, app_defaults: dict) -> dict:
    """Extract rail computation inputs from project data (v2.0 format) for one area."""
    step2           = data.get('step2', {})
    step3           = data.get('step3', {})
    global_settings = step3.get('globalSettings') or {}
    area_settings_raw = step3.get('areaSettings') or {}
    # areaSettings may be a list or a dict keyed by string index (FE serialises JS object keys as strings)
    if isinstance(area_settings_raw, list):
        area_settings = area_settings_raw[area_idx] if area_idx < len(area_settings_raw) else {}
    else:
        area_settings = area_settings_raw.get(str(area_idx)) or {}

    # lineRails: prefer any transient override from the request body; otherwise derive
    # from the already-computed step2.areas[i].rails (offsetFromLineFrontCm grouped by lineIdx).
    # lineRails is never persisted — it is stripped from step3 before the DB save.
    line_rails = area_settings.get('lineRails') or {}
    if not line_rails:
        derived: dict[str, list] = {}
        for r in area.get('rails', []):
            li  = str(r.get('lineIdx', 0))
            off = r.get('offsetFromLineFrontCm')
            if off is not None:
                derived.setdefault(li, []).append(off)
        line_rails = {li: sorted(offs) for li, offs in derived.items()}

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
    """Compute rails for all areas, persist to step2.areas[i].rails, return per-area results."""
    # Refresh to get the latest committed DB state — avoids overwriting a concurrent step-2 save.
    await db.refresh(project)
    data  = copy.deepcopy(project.data or {})
    if step3_data is not None:
        data['step3'] = step3_data
    areas = data.get('step2', {}).get('areas', [])
    result = []

    # Load defaults from app_settings (single source of truth)
    rows = (await db.execute(
        select(AppSetting.key, AppSetting.value_json).where(
            AppSetting.key.in_(['panelGapCm', 'railOverhangCm', 'stockLengths', 'railSpacingV', 'railSpacingH'])
        )
    )).all()
    app_defaults = {r.key: r.value_json for r in rows}

    for i, area in enumerate(areas):
        computed = rs.compute_area_rails(**_build_rail_inputs(data, area, i, app_defaults))
        areas[i]['rails'] = computed['rails']
        result.append({
            'areaLabel':    area.get('label', str(i)),
            'rails':        computed['rails'],
            'numLargeGaps': computed['numLargeGaps'],
        })

    # Strip lineRails from step3.areaSettings before persisting — positions are the
    # authoritative source in step2.areas[i].rails[*].offsetFromLineFrontCm.
    area_settings_store = data.get('step3', {}).get('areaSettings') or {}
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

    # ── Log ──
    total_rails = sum(len(r.get('rails', [])) for r in result)
    area_summary = ', '.join(f"{r['areaLabel']}:{len(r.get('rails',[]))}r" for r in result)
    stored_step = (project.navigation or {}).get('step', '?')
    logger.info(f"*** RAILS UPDATED *** project={project.id} step={stored_step} areas={len(result)} total_rails={total_rails} [{area_summary}]")

    return result


def _derive_line_rails(area: dict) -> dict[str, list[float]]:
    """Group stored rails by lineIdx → sorted offsets (reused by rail and base inputs)."""
    derived: dict[str, list] = {}
    for r in area.get('rails', []):
        li = str(r.get('lineIdx', 0))
        off = r.get('offsetFromLineFrontCm')
        if off is not None:
            derived.setdefault(li, []).append(off)
    return {li: sorted(offs) for li, offs in derived.items()}


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

    # Get positions for main row (row with most active cells — typically line 0)
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

    # Determine how many main-row columns each shorter row covers.
    # A shorter row with N active cells covers N * (long_side / short_side_pitch) columns.
    # Use this to find the split point between traps.
    trap_cfg = trapezoids.get(trapezoid_id, {})
    line_orients = trap_cfg.get('lineOrientations', [])

    # Count how many lines have active (non-empty) panels for this trap
    active_lines = [o for o in line_orients if 'empty' not in o]
    all_active = len(active_lines) == len(line_orients)

    # Find the row with the FEWEST active cells (the "short" row that defines the split)
    row_active_counts = []
    for line_idx, cells in enumerate(rows):
        count = sum(1 for c in cells if c in ('V', 'H'))
        if count > 0:
            row_active_counts.append((line_idx, count))

    if len(row_active_counts) <= 1:
        # Single row — split evenly
        cols_per_trap = total_cols // len(trap_ids)
        remainder = total_cols % len(trap_ids)
    else:
        # Multi-row: the short row defines how many columns belong to
        # traps with all lines active vs traps with empty lines
        row_active_counts.sort(key=lambda x: x[1])
        short_count = row_active_counts[0][1]  # fewest active cells
        short_line_idx = row_active_counts[0][0]
        short_row = rows[short_line_idx]

        # Each short-row panel covers multiple main-row columns
        short_orient = None
        for c in short_row:
            if c in ('V', 'EV'):
                short_orient = 'V'; break
            if c in ('H', 'EH'):
                short_orient = 'H'; break
        short_panel_width = short_cm if short_orient == 'V' else long_cm
        main_panel_pitch = panel_along_cm + panel_gap_cm

        # Columns covered by the short row = short_count * ceil(short_panel_width / main_panel_pitch)
        cols_per_short_panel = max(1, round(short_panel_width / main_panel_pitch)) if main_panel_pitch > 0 else 1
        cols_covered_by_short = short_count * cols_per_short_panel

        # Traps with all lines active get the short-row columns
        # Traps with empty lines get the remaining columns
        if all_active:
            cols_per_trap = cols_covered_by_short
            remainder = 0
        else:
            cols_per_trap = total_cols - cols_covered_by_short
            remainder = 0

    trap_idx = trap_ids.index(trapezoid_id) if trapezoid_id in trap_ids else 0

    # Compute start/end column for this trap
    if len(row_active_counts) > 1:
        # Multi-row: first trap(s) with all-active get cols_covered_by_short,
        # remaining traps get the rest
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
        # Single row — split evenly
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

    # Line rails from stored area rails
    line_rails = _derive_line_rails(area)

    # Per-trapezoid settings: from request body trapezoidConfigs, then app_settings defaults
    trap_cfg = (trapezoid_configs or {}).get(trapezoid_id, {})

    # Custom base offsets (user-dragged positions)
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
    """Compute bases for all areas, persist to step2.areas[i].bases, return per-area results."""
    await db.refresh(project)
    data = copy.deepcopy(project.data or {})
    if step3_data is not None:
        data['step3'] = step3_data
    areas = data.get('step2', {}).get('areas', [])
    step2 = data.get('step2', {})
    trapezoids = step2.get('trapezoids', {})
    result = []

    # Load defaults from app_settings
    rows = (await db.execute(
        select(AppSetting.key, AppSetting.value_json).where(
            AppSetting.key.in_([
                'panelGapCm', 'edgeOffsetMm', 'spacingMm', 'baseOverhangCm',
                'blockLengthCm', 'crossRailEdgeDistMm',
            ])
        )
    )).all()
    app_defaults = {r.key: r.value_json for r in rows}

    # Persist custom offsets so they survive project reloads.
    # Stored in step3.basesCustomOffsets: { trapId: [mm, ...] }
    step3 = data.setdefault('step3', {})
    stored_custom = step3.get('basesCustomOffsets') or {}

    # Merge incoming custom offsets into stored ones
    if trapezoid_configs:
        for trap_id, cfg in trapezoid_configs.items():
            co = cfg.get('customOffsets')
            if co is not None:
                if len(co) > 0:
                    stored_custom[trap_id] = co       # save custom positions
                else:
                    stored_custom.pop(trap_id, None)   # empty array = reset to defaults
    step3['basesCustomOffsets'] = stored_custom

    # Snapshot old bases for change detection
    old_bases_by_area = {
        area.get('label', str(i)): area.get('bases', [])
        for i, area in enumerate(areas)
    }

    for i, area in enumerate(areas):
        trap_ids = area.get('trapezoidIds', [])
        if not trap_ids:
            label = area.get('label', str(i))
            trap_ids = [label]

        # First-time computation: no existing bases → ignore all custom offsets
        has_existing_bases = len(area.get('bases', [])) > 0

        # Compute frame length to validate stored custom offsets
        area_frame_mm = _compute_area_frame_mm(area, data.get('step2', {}), app_defaults.get('panelGapCm', 2.5))

        # Compute bases per trapezoid
        bases_data_map: dict[str, dict | None] = {}
        for trap_id in trap_ids:
            effective_configs = dict(trapezoid_configs or {})
            if trap_id not in effective_configs:
                effective_configs[trap_id] = {}

            if not has_existing_bases:
                # First computation — always use defaults, ignore any custom offsets
                effective_configs[trap_id].pop('customOffsets', None)
                stored_custom.pop(trap_id, None)
            elif 'customOffsets' not in effective_configs[trap_id] and trap_id in stored_custom:
                stored = stored_custom[trap_id]
                # Validate: discard stale offsets if they don't span the current frame
                if (area_frame_mm and stored and len(stored) >= 2
                        and max(stored) <= area_frame_mm
                        and (max(stored) - min(stored)) >= area_frame_mm * 0.7):
                    effective_configs[trap_id]['customOffsets'] = stored
                else:
                    stored_custom.pop(trap_id, None)  # stale — clear

            # Compute per-trap X range for multi-trap areas
            trap_start, trap_end = _compute_trap_x_range(
                area.get('panelGrid') or {}, trap_id, trap_ids,
                trapezoids,
                step2.get('panelWidthCm', 113.4), step2.get('panelLengthCm', 238.2),
                app_defaults.get('panelGapCm', 2.5),
            )

            inputs = _build_base_inputs(data, area, i, app_defaults, trap_id, effective_configs, trap_start, trap_end)
            bases_data_map[trap_id] = bs.compute_area_bases(**inputs)

        # Consolidate multi-trapezoid areas
        consolidated = bs.consolidate_area_bases(trap_ids, bases_data_map)

        # Flatten all bases for this area
        all_bases = []
        for trap_id in trap_ids:
            all_bases.extend(consolidated.get(trap_id, []))

        areas[i]['bases'] = all_bases
        result.append({
            'areaLabel': area.get('label', str(i)),
            'bases': all_bases,
            'basesDataMap': {k: v for k, v in bases_data_map.items() if v},
        })

    # Check if bases actually changed
    changed = False
    for r in result:
        label = r['areaLabel']
        old = old_bases_by_area.get(label, [])
        new = r.get('bases', [])
        if len(old) != len(new):
            changed = True; break
        for ob, nb in zip(old, new):
            if (ob.get('offsetFromStartCm') != nb.get('offsetFromStartCm')
                    or ob.get('trapezoidId') != nb.get('trapezoidId')
                    or ob.get('lengthCm') != nb.get('lengthCm')):
                changed = True; break
        if changed:
            break

    if changed:
        project.data = data
        flag_modified(project, 'data')
        await db.commit()

        # ── Log ──
        total_bases = sum(len(r.get('bases', [])) for r in result)
        has_custom = bool(trapezoid_configs and any(cfg.get('customOffsets') for cfg in trapezoid_configs.values()))
        area_parts = []
        for r in result:
            trap_counts = {}
            for b in r.get('bases', []):
                tid = b.get('trapezoidId', '?')
                trap_counts[tid] = trap_counts.get(tid, 0) + 1
            trap_str = '+'.join(f"{tid}:{n}b" for tid, n in trap_counts.items())
            area_parts.append(f"{r['areaLabel']}:[{trap_str}]")
        stored_step = (project.navigation or {}).get('step', '?')
        logger.info(
            f"*** BASES UPDATED *** project={project.id} step={stored_step} areas={len(result)} "
            f"total_bases={total_bases} custom_from_FE={has_custom} "
            f"[{', '.join(area_parts)}]"
        )
    else:
        stored_step = (project.navigation or {}).get('step', '?')
        logger.info(f"BASES unchanged project={project.id} step={stored_step}")

    return result


async def update_project_step(
    db: AsyncSession, project: Project, new_step: int,
    rs=None, bs=None,
) -> dict:
    """
    Transition project to a new step with server-side data cleanup.
    Forward: resets dependent data and recomputes (e.g., rails+bases on 2→3).
    Backward: clears data from steps being navigated away from.
    Returns all relevant data so the FE doesn't need separate GET/PUT calls.
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
        # ── Forward transitions ──
        for s in range(old_step + 1, new_step + 1):
            if s == 3:
                # Entering step 3: clear computed data
                areas = data.get('step2', {}).get('areas', [])
                for area in areas:
                    area.pop('bases', None)
                    area.pop('rails', None)
                step3 = data.get('step3', {})
                step3.pop('basesCustomOffsets', None)
                cleared.append('step3')
            elif s == 4:
                data.get('step4', {}).pop('planApproval', None)
                cleared.append('step4')
    else:
        # ── Backward transitions ──
        for s in range(old_step, new_step, -1):
            if s == 3:
                data.pop('step3', None)
                areas = data.get('step2', {}).get('areas', [])
                for area in areas:
                    area.pop('rails', None)
                    area.pop('bases', None)
                cleared.append('step3')
            elif s == 4:
                data.get('step4', {}).pop('planApproval', None)
                cleared.append('step4')
            elif s == 5:
                data.get('step5', {}).pop('bomDeltas', None)
                cleared.append('step5')

    project.data = data
    nav = dict(project.navigation or {})
    nav['step'] = new_step
    nav['tab'] = None
    project.navigation = nav
    flag_modified(project, 'navigation')
    flag_modified(project, 'data')
    await db.commit()

    # ── Compute rails + bases on entering step 3 ──
    if new_step >= 3 and 'step3' in cleared and rs and bs:
        rails_result = await compute_and_save_rails(db, project, rs)
        bases_result = await compute_and_save_bases(db, project, bs)

    logger.info(
        f"*** STEP CHANGED *** project={project.id} {old_step}→{new_step} "
        f"cleared=[{','.join(cleared)}] "
        f"computed_rails={'yes' if rails_result else 'no'} "
        f"computed_bases={'yes' if bases_result else 'no'}"
    )

    result = {'currentStep': new_step, 'clearedSteps': cleared}
    if rails_result:
        result['rails'] = rails_result
    if bases_result:
        result['bases'] = bases_result
    return result


async def save_tab(
    db: AsyncSession, project: Project, tab: str,
    rs, bs,
    step3_data: dict | None = None, trapezoid_configs: dict | None = None,
) -> dict:
    """
    Save data from the active tab, recompute dependents, and return all step 3 data.
    Tab dependency: rails → bases (→ trapezoids in future).
    """
    # Update navigation.tab
    nav = dict(project.navigation or {'step': 1})
    nav['tab'] = tab
    project.navigation = nav
    flag_modified(project, 'navigation')
    await db.commit()

    rails_result = None
    bases_result = None

    if tab == 'rails':
        # Save rail settings + recompute rails + recompute bases (dependent)
        rails_result = await compute_and_save_rails(db, project, rs, step3_data)
        bases_result = await compute_and_save_bases(db, project, bs, step3_data, trapezoid_configs)
    elif tab == 'bases':
        # Save base settings + recompute bases only (rails unchanged)
        bases_result = await compute_and_save_bases(db, project, bs, step3_data, trapezoid_configs)
        # Also return current rails (unchanged) so FE has full state
        rails_result = [
            {'areaLabel': area.get('label', str(i)), 'rails': area.get('rails', [])}
            for i, area in enumerate(get_project_areas(project))
        ]

    logger.info(
        f"*** TAB SAVED *** project={project.id} tab={tab} "
        f"rails={'yes' if rails_result else 'no'} bases={'yes' if bases_result else 'no'}"
    )

    return {
        'tab': tab,
        'rails': rails_result,
        'bases': bases_result,
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
