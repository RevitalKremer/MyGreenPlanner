import copy
import uuid
from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified
from pydantic import BaseModel

from sqlalchemy import select

from app.database import get_db
from app.models.setting import AppSetting
from app.models.user import User
from app.schemas.project import ProjectCreate, ProjectUpdate, ProjectRead, ProjectSummary
from app.schemas.bom import BOMRead, BOMItemRead, BOMDeltasUpdate, BOMEffectiveRead
from app.services import projects as project_service
from app.services import rail_service
from app.services import base_service
from app.services import trapezoid_detail_service
from app.services import bom_service
from app.routers.deps import get_current_user, require_admin

class RailComputeRequest(BaseModel):
    step3: Optional[dict] = None

class BaseComputeRequest(BaseModel):
    step3: Optional[dict] = None
    trapezoidConfigs: Optional[dict] = None

class SaveRailsTabRequest(BaseModel):
    step3: Optional[dict] = None

class SaveTrapezoidsTabRequest(BaseModel):
    step3: Optional[dict] = None
    trapezoidConfigs: Optional[dict] = None

class SaveBasesTabRequest(BaseModel):
    step3: Optional[dict] = None
    trapezoidConfigs: Optional[dict] = None


router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[ProjectSummary])
async def list_projects(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await project_service.list_projects(db, current_user.id)


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await project_service.create_project(db, current_user.id, payload)


@router.get("/{project_id}", response_model=ProjectRead)
async def get_project(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


@router.put("/{project_id}", response_model=ProjectRead)
async def update_project(
    project_id: uuid.UUID,
    payload: ProjectUpdate,
    step: int | None = Query(None, description="If provided, only data.step{n} is merged; other steps are preserved"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return await project_service.update_project(db, project, payload, step)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    await project_service.delete_project(db, project)



@router.put("/{project_id}/step")
async def update_step(
    project_id: uuid.UUID,
    new_step: int = Query(..., description="Target step number (1-5)"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Transition project to a new step with server-side data cleanup."""
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if new_step < 1 or new_step > 5:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Step must be 1-5")

    result = await project_service.update_project_step(
        db, project, new_step,
        rs=rail_service, bs=base_service, tds=trapezoid_detail_service,
    )
    return result


@router.put("/{project_id}/saveTab/rails")
async def save_tab_rails(
    project_id: uuid.UUID,
    payload: Optional[SaveRailsTabRequest] = Body(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Save rails tab data, recompute rails + bases, return all step 3 data."""
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if (project.navigation or {}).get('step', 1) < 3:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Project must be on step 3+")

    return await project_service.save_tab(
        db, project, 'rails', rail_service, base_service, trapezoid_detail_service,
        step3_data=payload.step3 if payload else None,
    )


@router.put("/{project_id}/saveTab/bases")
async def save_tab_bases(
    project_id: uuid.UUID,
    payload: Optional[SaveBasesTabRequest] = Body(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Save bases tab data, recompute bases, return all step 3 data."""
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if (project.navigation or {}).get('step', 1) < 3:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Project must be on step 3+")

    return await project_service.save_tab(
        db, project, 'bases', rail_service, base_service, trapezoid_detail_service,
        step3_data=payload.step3 if payload else None,
        trapezoid_configs=payload.trapezoidConfigs if payload else None,
    )


@router.put("/{project_id}/saveTab/trapezoids")
async def save_tab_trapezoids(
    project_id: uuid.UUID,
    payload: Optional[SaveTrapezoidsTabRequest] = Body(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Save trapezoid details tab data, recompute details, return all step 3 data."""
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if (project.navigation or {}).get('step', 1) < 3:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Project must be on step 3+")

    return await project_service.save_tab(
        db, project, 'trapezoids', rail_service, base_service, trapezoid_detail_service,
        step3_data=payload.step3 if payload else None,
        trapezoid_configs=payload.trapezoidConfigs if payload else None,
    )


@router.put("/{project_id}/rails")
async def compute_rails(
    project_id: uuid.UUID,
    payload: Optional[RailComputeRequest] = Body(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Compute rail layout for all areas, persist to data.areas[i].rails, return rails."""
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if (project.navigation or {}).get('step', 1) < 3:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Project must be on step 3+ to compute rails")

    result = await project_service.compute_and_save_rails(
        db, project, rail_service,
        step3_data=payload.step3 if payload else None,
    )
    return result


@router.get("/{project_id}/rails")
async def get_rails(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return saved rails for all areas (available to all users)."""
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    return [
        {
            'areaLabel': area.get('label', str(i)),
            'rails': area.get('rails', []),
        }
        for i, area in enumerate(project_service.get_project_areas(project))
    ]


@router.put("/{project_id}/bases")
async def compute_bases(
    project_id: uuid.UUID,
    payload: Optional[BaseComputeRequest] = Body(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Compute base layout for all areas, persist to data.areas[i].bases, return bases."""
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if (project.navigation or {}).get('step', 1) < 3:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Project must be on step 3+ to compute bases")

    result = await project_service.compute_and_save_bases(
        db, project, base_service,
        step3_data=payload.step3 if payload else None,
        trapezoid_configs=payload.trapezoidConfigs if payload else None,
    )
    return result


@router.get("/{project_id}/bases")
async def get_bases(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return saved bases for all areas."""
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    return [
        {
            'areaLabel': area.get('label', str(i)),
            'bases': area.get('bases', []),
        }
        for i, area in enumerate(project_service.get_project_areas(project))
    ]


@router.get("/{project_id}/rails/dimensions")
async def get_rail_dimensions(
    project_id: uuid.UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Return physical rail dimensions per area (admin only)."""
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    return [
        {
            'areaLabel': area.get('label', str(i)),
            'rails': [
                {k: r[k] for k in ('railId', 'lineIdx',
                                    'offsetFromLineFrontCm', 'offsetFromRearEdgeCm',
                                    'startCm', 'endCm', 'lengthMm')}
                for r in area.get('rails', [])
            ],
        }
        for i, area in enumerate(project_service.get_project_areas(project))
    ]


@router.get("/{project_id}/rails/materials")
async def get_rail_materials(
    project_id: uuid.UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Return aggregated rail materials summary (admin only)."""
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    data     = project.data or {}
    settings = data.get('settings', {})
    # Load stockLengths default from app_settings
    row = (await db.execute(
        select(AppSetting.value_json).where(AppSetting.key == 'stockLengths')
    )).scalar_one()
    stock_lengths = settings.get('globalSettings', {}).get('stockLengths', row)
    areas_rails = [area.get('rails', []) for area in project_service.get_project_areas(project)]
    return rail_service.compute_materials_summary(areas_rails, stock_lengths)


@router.put("/{project_id}/approvePlan")
async def approve_plan(
    project_id: uuid.UUID,
    strictConsent: bool = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if (project.navigation or {}).get('step', 1) < 4:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Project must be on step 4+ to approve plan")
    updated = await project_service.approve_plan(db, project, current_user, strictConsent)
    return updated.data.get("step4", {}).get("planApproval")


# ── BOM endpoints ──────────────────────────────────────────────────────────


def _resolve_lang(lang_param: str | None, user: User) -> str:
    """Resolve language: explicit param → user preference → 'en'."""
    return lang_param or getattr(user, 'lang', None) or 'en'


def _localize_bom_items(items: list[dict], lang: str) -> list[dict]:
    """Pick the correct name field based on language."""
    localized = []
    for item in items:
        entry = {**item}
        if lang == 'he':
            entry['name'] = item.get('nameHe') or item.get('name')
        else:
            entry['name'] = item.get('name')
        entry.pop('nameHe', None)
        localized.append(entry)
    return localized


@router.get("/{project_id}/bom", response_model=BOMRead)
async def get_bom(
    project_id: uuid.UUID,
    lang: str | None = Query(None, description="Language for product names: 'en' or 'he'"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the current BOM with product enrichment and staleness flag."""
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    bom = await bom_service.get_bom(db, project.id)
    if not bom:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="BOM not yet computed")

    resolved_lang = _resolve_lang(lang, current_user)
    return BOMRead(
        id=bom.id,
        projectId=bom.project_id,
        items=[BOMItemRead(**item) for item in _localize_bom_items(bom.items, resolved_lang)],
        isStale=bom_service.is_bom_stale(project.data or {}, bom),
        createdAt=bom.created_at,
        updatedAt=bom.updated_at,
    )


@router.put("/{project_id}/bom/compute", response_model=BOMRead)
async def compute_bom(
    project_id: uuid.UUID,
    lang: str | None = Query(None, description="Language for product names: 'en' or 'he'"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Compute (or recompute) BOM from current step3 data and save."""
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    bom = await bom_service.compute_and_save_bom(db, project)
    resolved_lang = _resolve_lang(lang, current_user)
    return BOMRead(
        id=bom.id,
        projectId=bom.project_id,
        items=[BOMItemRead(**item) for item in _localize_bom_items(bom.items, resolved_lang)],
        isStale=False,
        createdAt=bom.created_at,
        updatedAt=bom.updated_at,
    )


@router.get("/{project_id}/bom/deltas")
async def get_bom_deltas(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return current bomDeltas from project data."""
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    step5 = (project.data or {}).get('step5', {})
    return step5.get('bomDeltas') or {'overrides': {}, 'additions': [], 'alternatives': {}}


@router.put("/{project_id}/bom/deltas")
async def save_bom_deltas(
    project_id: uuid.UUID,
    payload: BOMDeltasUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Save bomDeltas to project.data.step5.bomDeltas."""
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    data = copy.deepcopy(project.data or {})
    if 'step5' not in data:
        data['step5'] = {}
    data['step5']['bomDeltas'] = payload.model_dump()
    project.data = data
    flag_modified(project, 'data')
    await db.commit()
    return data['step5']['bomDeltas']


@router.get("/{project_id}/bom/effective", response_model=BOMEffectiveRead)
async def get_effective_bom(
    project_id: uuid.UUID,
    lang: str | None = Query(None, description="Language for product names: 'en' or 'he'"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return BOM items with bomDeltas applied (merged view for PQ/export)."""
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    bom = await bom_service.get_bom(db, project.id)
    if not bom:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="BOM not yet computed")

    step5 = (project.data or {}).get('step5', {})
    deltas = step5.get('bomDeltas') or {}
    effective_items = bom_service.apply_bom_deltas(bom.items, deltas)
    resolved_lang = _resolve_lang(lang, current_user)

    return BOMEffectiveRead(
        items=_localize_bom_items(effective_items, resolved_lang),
        createdAt=bom.created_at,
        updatedAt=bom.updated_at,
    )
