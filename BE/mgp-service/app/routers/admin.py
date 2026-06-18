import uuid
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.user import User, UserRole
from app.models.product import Product
from app.models.setting import AppSetting
from app.models.project import Project
from app.models.credit_transaction import CreditTransaction, CreditTxnKind
from app.schemas.user import (
    UserRead, UserListResponse, UserUpdate,
    AdminGrantCreditsRequest, AdminRefundProjectRequest, AdminDismissRefundInboxRequest,
    AdminReassignProjectOwnerRequest,
)
from app.schemas.company import CompanyRead
from app.schemas.product import ProductCreate, ProductUpdate, ProductRead
from app.schemas.setting import SettingRead, SettingUpdate
from app.schemas.credit_transaction import LedgerResponse, CreditTransactionRead, PendingRefundsResponse, PendingRefundRow
from app.routers.deps import require_admin
from app.services import settings_cache, credits as credits_service, company_service

router = APIRouter(prefix="/admin", tags=["admin"])


# ── Users ──────────────────────────────────────────────────────────────────────

@router.get("/users", response_model=UserListResponse)
async def list_users(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    search: str | None = Query(None, description="Substring match on email or full_name."),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Paginated user list for admin views.

    Optional `search` is case-insensitive substring matching on `email`
    OR `full_name`. The credits picker / Users tab share this endpoint.

    `credits_available` is patched from the ORM's `credits_balance`
    column (names diverge between schema and ORM). `credits_used` /
    `credits_total` stay at 0 in the list view — those need a per-user
    ledger query and aren't worth running for every row; the right-hand
    detail pane fetches the full snapshot via the ledger endpoint when
    a user is selected.
    """
    from app.models.company import Company
    base = select(User)
    clean_search = (search or '').strip()
    if clean_search:
        pattern = f"%{clean_search}%"
        from sqlalchemy import or_
        # Outer-join Company so the search can also match the company name.
        base = base.outerjoin(Company, User.company_id == Company.id).where(or_(
            User.email.ilike(pattern),
            User.full_name.ilike(pattern),
            Company.name.ilike(pattern),
        ))

    total_rows = (await db.execute(
        select(func.count()).select_from(base.subquery())
    )).scalar_one()

    page = await db.execute(
        base.options(selectinload(User.company))
            .order_by(User.created_at).offset(offset).limit(limit)
    )
    users = list(page.scalars().all())
    # company eager-loaded → UserRead.company_name resolves via the model property.
    rows = [
        UserRead.model_validate(u).model_copy(update={'credits_available': u.credits_balance})
        for u in users
    ]
    return UserListResponse(
        rows=rows,
        total_rows=total_rows,
        has_more=(offset + len(rows)) < total_rows,
    )


@router.put("/users/{user_id}", response_model=UserRead)
async def update_user(
    user_id: str,
    payload: UserUpdate,
    current_admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.is_sysadmin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot modify the system administrator")
    if user.id == current_admin.id and payload.role is not None and payload.role != current_admin.role:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot change your own role")

    # exclude_unset (not exclude_none): only touch fields the client actually
    # sent, but honor an explicit null — e.g. clearing discount_percent back
    # to "no discount". Omitted fields are left untouched.
    fields = payload.model_dump(exclude_unset=True)
    # Company is set via the relationship, not a plain column write — pull both
    # keys out of the generic loop and resolve them explicitly below.
    company_name = fields.pop('company_name', None)
    company_id_sent = 'company_id' in fields
    company_id = fields.pop('company_id', None)
    for field, value in fields.items():
        setattr(user, field, value)

    if company_name:  # create-or-reuse a company by name (takes precedence)
        user.company = await company_service.get_or_create(db, company_name)
    elif company_id_sent:  # select an existing company, or explicit null to clear
        user.company_id = company_id

    # Admins must not belong to a company — promotion overrides any assignment.
    # (Project sharing is derived from the owner's company, so changing a user's
    # company immediately re-scopes their projects — nothing to re-stamp.)
    if user.role == UserRole.admin:
        user.company_id = None

    await db.commit()
    await db.refresh(user)
    await db.refresh(user, attribute_names=['company'])  # for UserRead.company_name
    return user


@router.get("/companies", response_model=list[CompanyRead])
async def list_companies(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """All companies (alphabetical) — populates the admin user-assignment picker."""
    return await company_service.list_companies(db)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: str,
    current_admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.is_sysadmin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delete the system administrator")
    if user.id == current_admin.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delete your own account")
    if user.role == UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delete other admin accounts")
    await db.delete(user)
    await db.commit()


# ── Products ───────────────────────────────────────────────────────────────────

@router.get("/products", response_model=list[ProductRead])
async def list_products(
    product_type: str | None = Query(None, description="Filter by product_type. 'material' is an alias for any non-panel category."),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    q = select(Product)
    if product_type == 'material':
        # Backwards-compatible alias: every non-panel category counts as a material.
        q = q.where(Product.product_type != 'panel')
    elif product_type is not None:
        q = q.where(Product.product_type == product_type)
    result = await db.execute(q.order_by(Product.name))
    return list(result.scalars().all())


@router.post("/products", response_model=ProductRead, status_code=status.HTTP_201_CREATED)
async def create_product(
    payload: ProductCreate,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(select(Product).where(Product.type_key == payload.type_key))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="type_key already exists")
    product = Product(**payload.model_dump())
    db.add(product)
    await db.commit()
    await db.refresh(product)
    return product


@router.put("/products/{product_id}", response_model=ProductRead)
async def update_product(
    product_id: str,
    payload: ProductUpdate,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Product).where(Product.id == uuid.UUID(product_id)))
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(product, field, value)
    await db.commit()
    await db.refresh(product)
    return product


@router.delete("/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(
    product_id: str,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Product).where(Product.id == uuid.UUID(product_id)))
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    await db.delete(product)
    await db.commit()


# ── Settings ───────────────────────────────────────────────────────────────────

@router.get("/settings", response_model=list[SettingRead])
async def list_settings(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(AppSetting).order_by(AppSetting.section, AppSetting.key))
    return list(result.scalars().all())


@router.patch("/settings/{key}", response_model=SettingRead)
async def update_setting(
    key: str,
    payload: SettingUpdate,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(AppSetting).where(AppSetting.key == key))
    setting = result.scalar_one_or_none()
    if not setting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Setting not found")
    setting.value_json = payload.value_json
    if payload.min_val is not None:
        setting.min_val = payload.min_val
    if payload.max_val is not None:
        setting.max_val = payload.max_val
    if payload.step_val is not None:
        setting.step_val = payload.step_val
    if payload.visible is not None:
        setting.visible = payload.visible
    if payload.roof_types is not None:
        setting.roof_types = payload.roof_types
    await db.commit()
    await db.refresh(setting)
    
    # Refresh settings cache immediately after update
    await settings_cache.load_settings_cache(db)

    return setting


# ── Credits ────────────────────────────────────────────────────────────────────


async def _user_read_with_credits(db: AsyncSession, user: User) -> UserRead:
    snapshot = await credits_service.compute_account_snapshot(db, user)
    return UserRead.model_validate(user).model_copy(update=snapshot)


@router.get("/users/{user_id}/credits/ledger", response_model=LedgerResponse)
async def get_user_ledger(
    user_id: str,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    search: str | None = Query(None, description="Substring match on reason, kind, or project_id."),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    uid = uuid.UUID(user_id)
    user = (await db.execute(select(User).where(User.id == uid))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    base = select(CreditTransaction).where(CreditTransaction.user_id == uid)
    clean_search = (search or '').strip()
    if clean_search:
        pattern = f"%{clean_search}%"
        from sqlalchemy import or_, cast, String
        base = base.where(or_(
            CreditTransaction.reason.ilike(pattern),
            cast(CreditTransaction.kind, String).ilike(pattern),
            cast(CreditTransaction.project_id, String).ilike(pattern),
        ))

    total_rows = (await db.execute(
        select(func.count()).select_from(base.subquery())
    )).scalar_one()

    rows_result = await db.execute(
        base.order_by(CreditTransaction.created_at.desc())
            .offset(offset).limit(limit)
    )
    rows = list(rows_result.scalars().all())
    snapshot = await credits_service.compute_account_snapshot(db, user)
    return LedgerResponse(
        rows=[CreditTransactionRead.model_validate(r) for r in rows],
        total_rows=total_rows,
        has_more=(offset + len(rows)) < total_rows,
        **snapshot,
    )


@router.post("/users/{user_id}/credits/grant", response_model=UserRead)
async def admin_grant_credits(
    user_id: str,
    payload: AdminGrantCreditsRequest,
    current_admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if payload.amount <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="amount must be positive")
    if not payload.reason or not payload.reason.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="reason is required")
    uid = uuid.UUID(user_id)
    target = (await db.execute(select(User).where(User.id == uid))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    await credits_service.admin_grant(
        db, target_user=target, amount=payload.amount,
        reason=payload.reason, granted_by=current_admin,
    )
    await db.commit()
    await db.refresh(target)
    return await _user_read_with_credits(db, target)


@router.post("/projects/{project_id}/credits/refund", response_model=UserRead)
async def admin_refund_project(
    project_id: str,
    payload: AdminRefundProjectRequest,
    current_admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if not payload.reason or not payload.reason.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="reason is required")
    pid = uuid.UUID(project_id)
    project = (await db.execute(select(Project).where(Project.id == pid))).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    try:
        await credits_service.admin_refund_for_project(
            db, project=project, reason=payload.reason, granted_by=current_admin,
        )
    except credits_service.AlreadyRefundedError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Project already refunded")
    except credits_service.NothingToRefundError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Project has no charge to refund")

    await db.commit()
    owner = (await db.execute(select(User).where(User.id == project.owner_id))).scalar_one()
    await db.refresh(owner)
    return await _user_read_with_credits(db, owner)


@router.put("/projects/{project_id}/owner")
async def admin_reassign_project_owner(
    project_id: str,
    payload: AdminReassignProjectOwnerRequest,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Reassign a project's owner. Because company sharing is derived from the
    owner's company, assigning the project to a member of a company makes it
    visible (and editable) to that whole company."""
    project = (await db.execute(
        select(Project).where(Project.id == uuid.UUID(project_id))
    )).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    new_owner = (await db.execute(
        select(User).where(User.id == payload.user_id)
    )).scalar_one_or_none()
    if not new_owner:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target user not found")
    project.owner_id = new_owner.id
    await db.commit()
    # Return the new owner so the FE can update the project row in place.
    return {"owner_id": str(new_owner.id), "owner_email": new_owner.email}


@router.get("/projects/pending-refunds", response_model=PendingRefundsResponse)
async def list_pending_refunds(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    search: str | None = Query(None, description="Substring match on project name, owner email, or charge reason."),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Projects that are charged, quoted, not dismissed, and not yet refunded.

    Optional `search` is a case-insensitive substring filter applied to
    project.name OR owner.email OR the project_charge ledger row's reason.
    """
    base = (
        select(Project, CreditTransaction, User)
        .join(CreditTransaction, CreditTransaction.project_id == Project.id)
        .join(User, User.id == Project.owner_id)
        .where(
            Project.credits_charged_at.isnot(None),
            Project.quotation_requested_at.isnot(None),
            Project.refund_inbox_dismissed_at.is_(None),
            CreditTransaction.kind == CreditTxnKind.project_charge,
            CreditTransaction.refunded.is_(False),
        )
    )
    clean_search = (search or '').strip()
    if clean_search:
        pattern = f"%{clean_search}%"
        from sqlalchemy import or_, cast, String
        base = base.where(or_(
            Project.name.ilike(pattern),
            User.email.ilike(pattern),
            CreditTransaction.reason.ilike(pattern),
            cast(Project.id, String).ilike(pattern),
        ))

    total_rows = (await db.execute(
        select(func.count()).select_from(base.subquery())
    )).scalar_one()

    page = await db.execute(
        base.order_by(Project.quotation_requested_at.asc())
            .offset(offset).limit(limit)
    )
    rows: list[PendingRefundRow] = []
    for project, charge, owner in page.all():
        rows.append(PendingRefundRow(
            project_id=project.id,
            project_name=project.name,
            owner_id=owner.id,
            owner_email=owner.email,
            quotation_requested_at=project.quotation_requested_at,
            charged_at=project.credits_charged_at,
            charge_amount=-charge.amount,
        ))
    return PendingRefundsResponse(
        rows=rows,
        total_rows=total_rows,
        has_more=(offset + len(rows)) < total_rows,
    )


@router.post("/projects/{project_id}/refund-inbox/dismiss", status_code=status.HTTP_204_NO_CONTENT)
async def dismiss_refund_inbox(
    project_id: str,
    payload: AdminDismissRefundInboxRequest,
    current_admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Toggle whether a charged-and-quoted project shows in the pending-refunds inbox.

    `undo=true` puts it back in the inbox. Either way, no credit movement.
    """
    pid = uuid.UUID(project_id)
    project = (await db.execute(select(Project).where(Project.id == pid))).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if payload.undo:
        credits_service.undismiss_from_refund_inbox(project)
    else:
        credits_service.dismiss_from_refund_inbox(project, admin=current_admin, reason=payload.reason)
    await db.commit()
