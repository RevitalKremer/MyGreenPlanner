import copy
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Body, Depends, HTTPException, Query, status, UploadFile, File, Response
from typing import Annotated, Literal, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified
from pydantic import BaseModel, ConfigDict, Field
from PIL import Image
import io

from sqlalchemy import select

from app.database import get_db
from app.models.setting import AppSetting
from app.models.user import User
from app.models.project import Project
from app.models.project_image import ProjectImage
from app.schemas.project import ProjectCreate, ProjectUpdate, ProjectRead, ProjectSummary, ProjectListResponse
from app.schemas.bom import BOMRead, BOMItemRead, BOMDeltasUpdate, BOMEffectiveRead
from app.services import projects as project_service
from app.services import rail_service
from app.services import base_service
from app.services import trapezoid_detail_service
from app.services import bom_service
from app.services import proposal_service
from app.services import settings_cache
from app.services import email_service
from app.services import monday_service
from app.config import settings as app_settings
from app.routers.deps import get_current_user, require_admin

class TabSettings(BaseModel):
    """Settings (parameters) for a tab - global and per-area."""
    # Pydantic v2: alias 'global' (a Python keyword) onto the attribute global_.
    # The v1 `class Config: fields = {...}` form is silently ignored on v2 and
    # would cause the FE's `settings.global` payload to be dropped at parse
    # time — turning every global-scope tab save into a no-op.
    global_: Optional[dict] = Field(default=None, alias='global')
    areas: Optional[dict] = None

    model_config = ConfigDict(populate_by_name=True)

class TrapExtendTarget(BaseModel):
    """A specific base addressed by its (areaId, rowIdx, baseId).

    `rowIdx` is REQUIRED because `baseId` is BE-assigned per row
    (B1..BN renumbered globally within each row), so `(areaId,
    baseId)` alone collides across rows in the same multi-row area.

    Row / area "fan-out" gestures expand into multiple targets on the
    FE before being sent — the wire format is always a flat list of
    bases, mirroring the BaseOp model.
    """
    areaId: int | str
    rowIdx: int
    baseId: str


class TrapExtendOp(BaseModel):
    """Apply a (front, back) base-beam extension to one or more bases.

    Server resolves the (frontExtMm, backExtMm) signature against each
    target's PARENT trap geometry.extensions[]:
      - exact match → reuse that index;
      - no match → append the new entry, take the new tail index.
    Each affected base's trapezoidId is then re-tagged from "A1" (or
    its previous "A1.N") to the variation suffix that names the
    resolved index ("A1" for idx 0, "A1.N" for N>0). The next
    recompute pass applies the new lengths to startCm / lengthCm via
    _apply_base_extensions.
    """
    op: Literal['extend'] = 'extend'
    targets: list[TrapExtendTarget]
    frontExtMm: float
    backExtMm: float


# ── Per-base ops ───────────────────────────────────────────────────────────
#
# Ops always operate on a list of base targets — never a scope-expanding
# "row" / "area" descriptor. The FE derives the targets list from the
# diff between user-intended state (customBasesMap) and the BE snapshot,
# then consolidates identical (op, value) entries into one op carrying
# multiple targets. This keeps edge cases honest: if the user added a
# base to N rows then deleted it from one, the resulting payload reflects
# exactly the N-1 rows that still differ — no scope-expansion accidents.
#
# Each target carries `(areaId, rowIdx)` — `baseId` for move/delete so the
# BE can address a specific base; add doesn't carry baseId because the
# base doesn't exist yet (BE assigns one).

class BaseMoveTarget(BaseModel):
    areaId: int | str
    rowIdx: int
    baseId: str


class BaseMoveOp(BaseModel):
    op: Literal['move'] = 'move'
    targets: list[BaseMoveTarget]
    offsetMm: float


class BaseAddTarget(BaseModel):
    areaId: int | str
    rowIdx: int


class BaseAddOp(BaseModel):
    op: Literal['add'] = 'add'
    targets: list[BaseAddTarget]
    offsetMm: float


class BaseDeleteTarget(BaseModel):
    areaId: int | str
    rowIdx: int
    baseId: str


class BaseDeleteOp(BaseModel):
    op: Literal['delete'] = 'delete'
    targets: list[BaseDeleteTarget]


BaseOp = Annotated[
    BaseMoveOp | BaseAddOp | BaseDeleteOp,
    Field(discriminator='op'),
]


# ── Per-block ops ──────────────────────────────────────────────────────────
#
# Blocks are trap-scoped (one block list per trapezoid), so each op carries a
# single trapezoidId — no targets-list aggregation needed. Blocks have no
# stable id (the BE re-emits them each compute), so move/delete identify the
# affected block by its current positionMm. mm-precision rounding plus the
# 50cm minimum gap make position-based addressing unambiguous.
#
# Per-trap reset uses the legacy snapshot dict shape `{ [trapId]: [] }`
# (mirrors bases). The unified "Reset trap" button in the FE clears
# customBlocks, customDiagonals, and trap settings in one save.

class BlockMoveOp(BaseModel):
    op: Literal['move'] = 'move'
    trapezoidId: str
    fromPositionMm: int
    toPositionMm: int


class BlockAddOp(BaseModel):
    op: Literal['add'] = 'add'
    trapezoidId: str
    positionMm: int


class BlockDeleteOp(BaseModel):
    op: Literal['delete'] = 'delete'
    trapezoidId: str
    positionMm: int


BlockOp = Annotated[
    BlockMoveOp | BlockAddOp | BlockDeleteOp,
    Field(discriminator='op'),
]


class TabOverrides(BaseModel):
    """User edit-mode overrides for a tab."""
    rails: Optional[dict] = None       # { areaLabel: { lineIdx: [positions] } }
    # Either a list of BaseOp (op-based wire format) OR the legacy snapshot
    # dict `{ "trapId:rowIdx": offsetsMm[] }`. When a list is provided BE
    # translates ops to a per-(trap,row) snapshot before applying via the
    # standard recompute path. Snapshot remains as the in-storage shape.
    bases: Optional[list[BaseOp] | dict] = None
    traps: Optional[list[TrapExtendOp]] = None
    # New op-based wire format for trap base-beam extensions. See TrapExtendOp.
    diagonals: Optional[dict] = None   # { trapId: { spanId: {topDistFromLegCm, botDistFromLegCm} | {disabled: true} } }
    blocks: Optional[list[BlockOp] | dict] = None
    # Either a list of BlockOp (op-based wire format for user block edits in
    # the trap-detail view) OR the snapshot dict `{ trapId: [{positionCm, isEnd}, ...] }`.
    # Empty list under a trapId in the snapshot dict clears that trap's
    # override (per-trap reset).

class SaveTabRequest(BaseModel):
    """Unified save request for all tabs."""
    settings: Optional[TabSettings] = None
    overrides: Optional[TabOverrides] = None
    # Legacy fields for backward compatibility
    step3: Optional[dict] = None
    trapezoidConfigs: Optional[dict] = None


router = APIRouter(prefix="/projects", tags=["projects"])


async def get_accessible_project(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Project:
    """Fetch a project the current user is allowed to access, or raise 404.

    Admins can access any project; regular users only their own. 404 on
    missing-or-forbidden (we conflate to avoid leaking existence of other
    users' projects).
    """
    project = await project_service.get_project_for_user(db, project_id, current_user)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


@router.get("", response_model=ProjectListResponse)
async def list_projects(
    limit: int | None = Query(None, description="Maximum number of projects to return. If None, return all."),
    offset: int = Query(0, ge=0, description="Number of projects to skip for pagination."),
    search: str | None = Query(None, description="Search projects by name, location, or owner email."),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    is_admin = current_user.role.value == "admin"
    clean_search = search.strip() if search else None
    projects, total = await project_service.list_projects(
        db, current_user.id, is_admin=is_admin, limit=limit, offset=offset, search=clean_search,
    )
    # For admin, populate owner_email from loaded relationship
    project_summaries = []
    for proj in projects:
        proj_dict = {
            "id": proj.id,
            "name": proj.name,
            "client_name": proj.client_name,
            "location": proj.location,
            "roof_spec": proj.roof_spec,
            "navigation": proj.navigation,
            "owner_id": proj.owner_id,
            "created_at": proj.created_at,
            "updated_at": proj.updated_at,
        }
        if is_admin and proj.owner:
            proj_dict["owner_email"] = proj.owner.email
        project_summaries.append(proj_dict)
    return {
        "projects": project_summaries,
        "total": total,
        "offset": offset,
        "limit": limit,
        "has_more": (offset + len(project_summaries)) < total,
    }


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
    project: Project = Depends(get_accessible_project),
):
    return project


@router.put("/{project_id}", response_model=ProjectRead)
async def update_project(
    project_id: uuid.UUID,
    payload: ProjectUpdate,
    step: int | None = Query(None, description="If provided, only data.step{n} is merged; other steps are preserved"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(get_accessible_project),
):
    return await project_service.update_project(db, project, payload, step)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(get_accessible_project),
):
    await project_service.delete_project(db, project)



@router.put("/{project_id}/step")
async def update_step(
    project_id: uuid.UUID,
    new_step: int = Query(..., description="Target step number (1-5)"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(get_accessible_project),
):
    """Transition project to a new step with server-side data cleanup."""
    if new_step < 1 or new_step > 5:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Step must be 1-5")

    try:
        result = await project_service.update_project_step(
            db, project, new_step,
            rs=rail_service, bs=base_service, tds=trapezoid_detail_service,
        )
    except project_service.StepTransitionInvalidError as e:
        # Structured detail so the FE can translate per-error and highlight
        # the offending fields. See _validate_step_transition.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                'code': 'step_transition_invalid',
                'fromStep': e.from_step,
                'toStep': e.to_step,
                'errors': e.errors,
            },
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return result


@router.put("/{project_id}/saveTab/rails")
async def save_tab_rails(
    project_id: uuid.UUID,
    payload: Optional[SaveTabRequest] = Body(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(get_accessible_project),
):
    """Save rails tab data, recompute rails + bases, return all step 3 data."""
    if (project.navigation or {}).get('step', 1) < 3:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Project must be on step 3+")

    # Convert new format to legacy or use legacy directly
    step3_data, trapezoid_configs, overrides = _extract_payload_data(payload)

    return await project_service.save_tab(
        db, project, 'rails', rail_service, base_service, trapezoid_detail_service,
        step3_data=step3_data, trapezoid_configs=trapezoid_configs, overrides=overrides,
    )


@router.put("/{project_id}/saveTab/bases")
async def save_tab_bases(
    project_id: uuid.UUID,
    payload: Optional[SaveTabRequest] = Body(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(get_accessible_project),
):
    """Save bases tab data, recompute bases, return all step 3 data."""
    if (project.navigation or {}).get('step', 1) < 3:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Project must be on step 3+")

    step3_data, trapezoid_configs, overrides = _extract_payload_data(payload)

    return await project_service.save_tab(
        db, project, 'bases', rail_service, base_service, trapezoid_detail_service,
        step3_data=step3_data, trapezoid_configs=trapezoid_configs, overrides=overrides,
    )


@router.put("/{project_id}/saveTab/trapezoids")
async def save_tab_trapezoids(
    project_id: uuid.UUID,
    payload: Optional[SaveTabRequest] = Body(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(get_accessible_project),
):
    """Save trapezoid details tab data, recompute details, return all step 3 data."""
    if (project.navigation or {}).get('step', 1) < 3:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Project must be on step 3+")

    step3_data, trapezoid_configs, overrides = _extract_payload_data(payload)

    return await project_service.save_tab(
        db, project, 'trapezoids', rail_service, base_service, trapezoid_detail_service,
        step3_data=step3_data, trapezoid_configs=trapezoid_configs, overrides=overrides,
    )


def _extract_payload_data(payload: Optional[SaveTabRequest]) -> tuple[dict | None, dict | None, dict | None]:
    """Extract step3_data, trapezoid_configs, and overrides from unified or legacy payload."""
    if not payload:
        return None, None, None

    # New format
    if payload.settings or payload.overrides:
        step3_data = {}
        trapezoid_configs = None

        if payload.settings:
            if payload.settings.global_:
                step3_data['globalSettings'] = payload.settings.global_
            if payload.settings.areas:
                step3_data['areaSettings'] = payload.settings.areas

        overrides = {}
        if payload.overrides:
            if payload.overrides.rails:
                overrides['rails'] = payload.overrides.rails
            if payload.overrides.bases:
                # bases may be a legacy snapshot dict OR a list of BaseOp.
                # Pass through the raw shape; the service layer dispatches
                # on type. Pydantic models are dumped to plain dicts so the
                # service has no Pydantic dependency.
                b = payload.overrides.bases
                overrides['bases'] = (
                    [op.model_dump() for op in b] if isinstance(b, list) else b
                )
            if payload.overrides.traps:
                # Pass through as plain dicts so the service layer can iterate
                # without a Pydantic dependency. by_alias keeps `scope` literal.
                overrides['traps'] = [op.model_dump() for op in payload.overrides.traps]
            if payload.overrides.diagonals:
                overrides['diagonals'] = payload.overrides.diagonals
            if payload.overrides.blocks:
                # blocks may be a snapshot dict OR a list of BlockOp; pass through
                # the raw shape and let the service layer dispatch on type.
                b = payload.overrides.blocks
                overrides['blocks'] = (
                    [op.model_dump() for op in b] if isinstance(b, list) else b
                )

        # Legacy trapezoidConfigs (only for backward compatibility)
        if payload.trapezoidConfigs:
            trapezoid_configs = payload.trapezoidConfigs

        return step3_data, trapezoid_configs, overrides if overrides else None

    # Legacy format
    return payload.step3, payload.trapezoidConfigs, None


@router.put("/{project_id}/resetTab/{tab_name}")
async def reset_tab(
    project_id: uuid.UUID,
    tab_name: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(get_accessible_project),
):
    """Reset tab to server defaults: clear FE overrides, recompute with defaults."""
    if tab_name not in ('rails', 'bases', 'trapezoids'):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tab name")
    return await project_service.reset_tab(
        db, project, tab_name, rail_service, base_service, trapezoid_detail_service,
    )


@router.get("/{project_id}/construction-data")
async def get_construction_data(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(get_accessible_project),
):
    """Return full project data."""

    return {'data': project.data or {}}


@router.get("/{project_id}/rails")
async def get_rails(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(get_accessible_project),
):
    """Return saved rails for all areas."""

    computed_areas = (project.data or {}).get('step3', {}).get('computedAreas', [])
    return [
        {'areaLabel': ca.get('label', ''), 'rails': ca.get('rails', {})}
        for ca in computed_areas
    ]


@router.get("/{project_id}/bases")
async def get_bases(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(get_accessible_project),
):
    """Return saved bases for all areas."""

    computed_areas = (project.data or {}).get('step3', {}).get('computedAreas', [])
    return [
        {'areaId': ca.get('areaId', 0), 'areaLabel': ca.get('label', ''), 'bases': ca.get('bases', {}), 'diagonals': ca.get('diagonals', [])}
        for ca in computed_areas
    ]


@router.get("/{project_id}/trapezoids")
async def get_trapezoids(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(get_accessible_project),
):
    """Return saved computed trapezoid details."""

    computed_traps = (project.data or {}).get('step3', {}).get('computedTrapezoids', [])
    return {ct['trapezoidId']: ct for ct in computed_traps if 'trapezoidId' in ct}


@router.get("/{project_id}/rails/dimensions")
async def get_rail_dimensions(
    project_id: uuid.UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(get_accessible_project),
):
    """Return physical rail dimensions per area (admin only)."""

    computed_areas = (project.data or {}).get('step3', {}).get('computedAreas', [])
    result = []
    for ca in computed_areas:
        rails_dict = ca.get('rails', {})
        # Flatten all rows' rails for the dimensions view
        all_rails = []
        if isinstance(rails_dict, dict):
            for row_rails in rails_dict.values():
                if isinstance(row_rails, list):
                    all_rails.extend(row_rails)
        else:
            all_rails = rails_dict  # legacy list format
        result.append({
            'areaLabel': ca.get('label', ''),
            'rails': [
                {k: r[k] for k in ('railId', 'lineIdx',
                                    'offsetFromLineFrontCm', 'offsetFromRearEdgeCm',
                                    'startCm', 'lengthCm')
                 if k in r}
                for r in all_rails
            ],
        })
    return result


@router.get("/{project_id}/rails/materials")
async def get_rail_materials(
    project_id: uuid.UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(get_accessible_project),
):
    """Return aggregated rail materials summary (admin only)."""

    data     = project.data or {}
    step3    = data.get('step3', {})
    # Get stockLengths from settings cache (no DB query)
    stock_lengths_default = settings_cache.get_setting('stockLengths')
    stock_lengths = (step3.get('globalSettings') or {}).get('stockLengths', stock_lengths_default)
    # Flatten rails across all panel rows per area, plus cross-row rails
    # (area-level concatenated rails — pruned from the per-row dict).
    areas_rails = []
    for ca in step3.get('computedAreas', []):
        rails_dict = ca.get('rails', {})
        flat_rails = []
        if isinstance(rails_dict, dict):
            for row_rails in rails_dict.values():
                if isinstance(row_rails, list):
                    flat_rails.extend(row_rails)
        else:
            flat_rails = rails_dict  # legacy list format
        cross = ca.get('crossRowRails') or []
        if isinstance(cross, list):
            flat_rails.extend(cross)
        areas_rails.append(flat_rails)
    return rail_service.compute_materials_summary(areas_rails, stock_lengths)


@router.put("/{project_id}/approvePlan")
async def approve_plan(
    project_id: uuid.UUID,
    strictConsent: bool = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(get_accessible_project),
):
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
    project: Project = Depends(get_accessible_project),
):
    """Return the current BOM with product enrichment and staleness flag."""

    bom = await bom_service.get_bom(db, project.id)
    if not bom:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="BOM not yet computed")

    # Re-enrich on every read so product-table edits (extra%, name, etc.)
    # propagate without bumping the BOM logic version. The cached row's
    # computed quantities are kept; only the product-derived fields are
    # overlaid from current DB state.
    fresh_items = await bom_service.reenrich_items_with_fresh_products(db, bom.items or [])
    resolved_lang = _resolve_lang(lang, current_user)
    return BOMRead(
        id=bom.id,
        projectId=bom.project_id,
        items=[BOMItemRead(**item) for item in _localize_bom_items(fresh_items, resolved_lang)],
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
    project: Project = Depends(get_accessible_project),
):
    """Compute (or recompute) BOM from current step3 data and save."""

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


@router.put("/{project_id}/bom/recalc", response_model=BOMRead)
async def recalc_bom(
    project_id: uuid.UUID,
    lang: str | None = Query(None, description="Language for product names: 'en' or 'he'"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(get_accessible_project),
):
    """Materialise pending bomDeltas + expand bundles into the saved BOM,
    then clear deltas. Triggered by the FE 'Recalc' button so the user
    sees their alt-swaps and the resulting bundle children persisted."""

    bom = await bom_service.materialize_bom(db, project)
    if not bom:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="BOM not yet computed")
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
    project: Project = Depends(get_accessible_project),
):
    """Return current bomDeltas from project data."""

    step5 = (project.data or {}).get('step5', {})
    return step5.get('bomDeltas') or {'overrides': {}, 'additions': [], 'alternatives': {}}


@router.put("/{project_id}/bom/deltas")
async def save_bom_deltas(
    project_id: uuid.UUID,
    payload: BOMDeltasUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(get_accessible_project),
):
    """Save bomDeltas to project.data.step5.bomDeltas."""

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
    project: Project = Depends(get_accessible_project),
):
    """Return BOM items with bomDeltas applied (merged view for PQ/export)."""

    bom = await bom_service.get_bom(db, project.id)
    if not bom:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="BOM not yet computed")

    fresh_items = await bom_service.reenrich_items_with_fresh_products(db, bom.items or [])
    step5 = (project.data or {}).get('step5', {})
    deltas = step5.get('bomDeltas') or {}
    effective_items = bom_service.apply_bom_deltas(fresh_items, deltas)
    # Bundle expansion last — operates on whatever the user is actually
    # ordering after deltas resolve (incl. alt-swaps). Exports must never
    # generate from stale data.
    products_by_type = await bom_service._load_products_by_type(db)
    effective_items = bom_service.expand_bundles(effective_items, products_by_type)
    resolved_lang = _resolve_lang(lang, current_user)

    return BOMEffectiveRead(
        items=_localize_bom_items(effective_items, resolved_lang),
        createdAt=bom.created_at,
        updatedAt=bom.updated_at,
    )


@router.get("/{project_id}/proposal.xlsx")
async def download_proposal(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(get_accessible_project),
):
    """Generate the Hebrew price proposal xlsx (always Hebrew, regardless of
    the requesting user's language)."""
    try:
        xlsx_bytes = await proposal_service.generate_proposal(db, project)
    except FileNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

    from urllib.parse import quote
    safe_name = ''.join(c if c not in '\\/:*?"<>|' else '_' for c in (project.name or 'proposal'))
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    filename = f"{safe_name}_proposal_{today}.xlsx"
    # HTTP headers are latin-1 — encode the unicode filename per RFC 5987,
    # and provide a plain ASCII fallback for legacy clients.
    ascii_fallback = filename.encode('ascii', errors='replace').decode('ascii').replace('?', '_')
    return Response(
        content=xlsx_bytes,
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers={
            'Content-Disposition': (
                f'attachment; filename="{ascii_fallback}"; '
                f"filename*=UTF-8''{quote(filename)}"
            ),
        },
    )


def _attachment_disposition(filename: str) -> str:
    """RFC 5987-compliant Content-Disposition value with both an ASCII
    fallback and a UTF-8 percent-encoded form, so Hebrew project names
    survive the latin-1 HTTP header constraint."""
    from urllib.parse import quote
    ascii_fallback = filename.encode('ascii', errors='replace').decode('ascii').replace('?', '_')
    return f'attachment; filename="{ascii_fallback}"; filename*=UTF-8\'\'{quote(filename)}'


@router.get("/{project_id}/proposal.pdf")
async def download_proposal_pdf(
    project_id: uuid.UUID,
    content: list[str] = Query(default=['pricing', 'quantities']),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(get_accessible_project),
):
    """Render the requested proposal sheets to a single PDF via headless LibreOffice.

    `content` may be repeated: ?content=pricing&content=quantities
    Valid values: 'pricing', 'quantities'. Unknown values are silently ignored.
    """
    try:
        pdf_bytes = await proposal_service.generate_proposal_pdf(db, project, content)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

    safe_name = ''.join(c if c not in '\\/:*?"<>|' else '_' for c in (project.name or 'proposal'))
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    label = '_'.join(s for s in content if s in ('pricing', 'quantities')) or 'proposal'
    filename = f"{safe_name}_{label}_{today}.pdf"
    return Response(
        content=pdf_bytes,
        media_type='application/pdf',
        headers={'Content-Disposition': _attachment_disposition(filename)},
    )


@router.post("/{project_id}/send-report")
async def send_report_email(
    project_id: uuid.UUID,
    file: Optional[UploadFile] = File(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(get_accessible_project),
):
    """Email a project report to the company inbox AND (if Monday is
    configured) create a new item on the proposals board.

    The pricing xlsx is generated server-side and is **always** attached to
    both the email and the Monday item — it's the canonical deliverable.
    The PDF is **optional**: when the FE has built one (any combination of
    plans/pricing/quantities), it's attached too; when the user only
    downloaded the standalone xlsx, the call still fires with no PDF and
    everything still works.

    The Monday upload is best-effort: failures are logged but don't bubble up
    to the user, so the email still succeeds when Monday is misconfigured."""
    import logging
    logger = logging.getLogger(__name__)

    pdf_bytes = await file.read() if file is not None else None
    safe_name = ''.join(c if c not in '\\/:*?"<>|' else '_' for c in (project.name or 'report'))
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    pdf_filename  = f"{safe_name}_plan_{today}.pdf"
    xlsx_filename = f"{safe_name}_proposal_{today}.xlsx"

    # xlsx is the canonical deliverable — always generate it.
    xlsx_bytes = await proposal_service.generate_proposal(db, project)

    XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    PDF_MIME  = 'application/pdf'

    # Email — xlsx always, PDF when provided.
    email_attachments: list[tuple[str, bytes, str]] = [(xlsx_filename, xlsx_bytes, XLSX_MIME)]
    if pdf_bytes is not None:
        email_attachments.append((pdf_filename, pdf_bytes, PDF_MIME))
    await email_service.send_email_with_attachments(
        to=app_settings.COMPANY_REPORT_EMAIL,
        subject=f"Project Report — {project.name or project_id}",
        html=f"<p>Please find attached the generated report for project <strong>{project.name or project_id}</strong>.</p>",
        attachments=email_attachments,
    )

    # Monday — best-effort. Same attachment policy as email.
    monday_result = None
    monday_error = None
    try:
        owner = None
        if project.owner_id:
            from app.models.user import User as _User
            owner = await db.get(_User, project.owner_id)
        monday_attachments: list[tuple[str, bytes, str]] = [(xlsx_filename, xlsx_bytes, XLSX_MIME)]
        if pdf_bytes is not None:
            monday_attachments.append((pdf_filename, pdf_bytes, PDF_MIME))
        monday_result = await monday_service.upload_proposal(
            project_id=str(project_id),
            project_name=project.name or str(project_id),
            client_name=project.client_name or "",
            owner_email=(owner.email if owner else "") or "",
            owner_full_name=(owner.full_name if owner else None),
            owner_phone=(owner.phone_number if owner else None),
            owner_created_at=(owner.created_at if owner else None),
            location=project.location,
            attachments=monday_attachments,
        )
    except Exception as e:
        monday_error = str(e)
        logger.exception("Monday upload failed for project %s", project_id)

    return {
        "status": "sent",
        "to": app_settings.COMPANY_REPORT_EMAIL,
        "monday": monday_result,
        "monday_error": monday_error,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Image Upload/Fetch Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/{project_id}/image")
async def upload_project_image(
    project_id: uuid.UUID,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(get_accessible_project),
):
    """Upload an image for a project and store it in the project_images table.
    
    Returns: { imageId, width, height, contentType, fileSize }
    """
    # Verify project ownership
    
    # Validate file type
    if not file.content_type or not file.content_type.startswith('image/'):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid image file")
    
    # Read and validate image
    try:
        image_bytes = await file.read()
        image = Image.open(io.BytesIO(image_bytes))
        width, height = image.size
        file_size = len(image_bytes)
        
        # Optional: Add max size validation
        max_size = 10 * 1024 * 1024  # 10MB
        if file_size > max_size:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Image too large. Maximum size is {max_size / (1024 * 1024)}MB"
            )
        
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid image: {str(e)}")
    
    # Delete existing image for this project (one image per project)
    existing = await db.execute(
        select(ProjectImage).where(ProjectImage.project_id == project_id)
    )
    existing_image = existing.scalar_one_or_none()
    if existing_image:
        await db.delete(existing_image)
    
    # Create new image record
    project_image = ProjectImage(
        project_id=project_id,
        image_data=image_bytes,
        content_type=file.content_type,
        width=width,
        height=height,
        file_size=file_size,
    )
    db.add(project_image)
    await db.commit()
    await db.refresh(project_image)
    
    return {
        "imageId": str(project_image.id),
        "width": width,
        "height": height,
        "contentType": file.content_type,
        "fileSize": file_size,
    }


@router.get("/{project_id}/image")
async def get_project_image(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(get_accessible_project),
):
    """Fetch the image for a project.
    
    Returns the binary image data with appropriate Content-Type header.
    """
    # Verify project ownership
    
    # Fetch image
    result = await db.execute(
        select(ProjectImage).where(ProjectImage.project_id == project_id)
    )
    project_image = result.scalar_one_or_none()
    
    if not project_image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No image found for this project")
    
    # Return binary data with proper content type
    return Response(
        content=project_image.image_data,
        media_type=project_image.content_type,
        headers={
            "Cache-Control": "public, max-age=2592000",  # Cache for 30 days
            "Content-Length": str(project_image.file_size),
        }
    )
