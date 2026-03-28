import copy
import uuid
from datetime import date
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from app.models.project import Project
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


def _build_rail_inputs(data: dict, area: dict, area_idx: int, rs) -> dict:
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

    stock_lengths   = global_settings.get('stockLengths', rs.DEFAULT_STOCK_LENGTHS_MM)
    overhang_cm     = area_settings.get('railOverhangCm', rs.DEFAULT_RAIL_OVERHANG_CM)
    panel_width_cm  = step2.get('panelWidthCm',  113.4)
    panel_length_cm = step2.get('panelLengthCm', 238.2)

    return {
        'panel_grid':      area.get('panelGrid') or {},
        'panel_width_cm':  panel_width_cm,
        'panel_length_cm': panel_length_cm,
        'line_rails':      line_rails,
        'overhang_cm':     overhang_cm,
        'stock_lengths':   stock_lengths,
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

    for i, area in enumerate(areas):
        computed = rs.compute_area_rails(**_build_rail_inputs(data, area, i, rs))
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
    return result


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
