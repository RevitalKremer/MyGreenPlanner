import uuid
from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from sqlalchemy import select

from app.database import get_db
from app.models.setting import AppSetting
from app.models.user import User
from app.schemas.project import ProjectCreate, ProjectUpdate, ProjectRead, ProjectSummary
from app.services import projects as project_service
from app.services import rail_service
from app.routers.deps import get_current_user, require_admin

class RailComputeRequest(BaseModel):
    step3: Optional[dict] = None


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
    updated = await project_service.approve_plan(db, project, current_user, strictConsent)
    return updated.data.get("step4", {}).get("planApproval")
