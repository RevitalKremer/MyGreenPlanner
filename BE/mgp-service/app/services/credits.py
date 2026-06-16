"""Credit-flow rules — single home for all credit-affecting mutations.

Every balance write opens with `SELECT ... FOR UPDATE` on the target user row
so concurrent charges/grants/refunds serialize cleanly. The ledger insert and
the `users.credits_balance` update happen in the same DB transaction (managed
by the caller via `db.commit()`), so partial state is impossible.

All numeric rates read from `settings_cache.get_setting(...)` — admins can
retune project cost and trial amount live via PATCH /admin/settings/{key}.
"""
from datetime import datetime, timezone
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.project import Project
from app.models.credit_transaction import CreditTransaction, CreditTxnKind
from app.services import settings_cache


# ── Custom exceptions ─────────────────────────────────────────────────────


class CreditsError(Exception):
    """Base class for all credits-flow errors."""


class InsufficientCreditsError(CreditsError):
    def __init__(self, available: int, required: int):
        self.available = available
        self.required = required
        super().__init__(f"Insufficient credits: have {available}, need {required}")


class AlreadyChargedError(CreditsError):
    """The project has already been charged for 2→3 and can't be re-charged."""


class AlreadyRefundedError(CreditsError):
    """The project's open charge has already been refunded."""


class NothingToRefundError(CreditsError):
    """The project has no open charge to refund (either never charged, or already refunded)."""


# ── Internal helpers ──────────────────────────────────────────────────────


async def _lock_user(db: AsyncSession, user_id) -> User | None:
    """Acquire a row-level lock on the target user and return the locked row.

    Any concurrent transaction touching the same user blocks until this one
    commits — the bedrock of our concurrency-safe balance arithmetic.
    """
    result = await db.execute(
        select(User).where(User.id == user_id).with_for_update()
    )
    return result.scalar_one_or_none()


async def _find_open_charge(db: AsyncSession, project_id) -> CreditTransaction | None:
    """Return the unrefunded project_charge row for this project, if any."""
    result = await db.execute(
        select(CreditTransaction).where(
            CreditTransaction.project_id == project_id,
            CreditTransaction.kind == CreditTxnKind.project_charge,
            CreditTransaction.refunded.is_(False),
        )
    )
    return result.scalar_one_or_none()


def _trial_amount() -> int:
    val = settings_cache.get_setting('trialGrantCredits', default=0)
    return int(val)


def _project_cost() -> int:
    val = settings_cache.get_setting('projectCostCredits', default=0)
    return int(val)


# ── Public API ────────────────────────────────────────────────────────────


async def grant_trial_if_eligible(db: AsyncSession, user: User) -> bool:
    """Grant the configured trial amount on first email-verification.

    Idempotent — a user who already has a `kind='trial'` ledger row gets nothing.
    Returns True if a grant was made, False otherwise.
    """
    existing = await db.execute(
        select(CreditTransaction.id).where(
            CreditTransaction.user_id == user.id,
            CreditTransaction.kind == CreditTxnKind.trial,
        ).limit(1)
    )
    if existing.scalar_one_or_none() is not None:
        return False

    amount = _trial_amount()
    if amount <= 0:
        # Admin set the trial to zero — record nothing, return cleanly.
        return False

    locked = await _lock_user(db, user.id)
    if locked is None:
        return False
    locked.credits_balance = locked.credits_balance + amount

    db.add(CreditTransaction(
        user_id=locked.id,
        project_id=None,
        amount=amount,
        kind=CreditTxnKind.trial,
        reason=None,
        created_by=None,
    ))
    return True


async def admin_grant(
    db: AsyncSession,
    *,
    target_user: User,
    amount: int,
    reason: str,
    granted_by: User,
) -> CreditTransaction:
    """Admin manually adds credits to a user (no project tie)."""
    if amount <= 0:
        raise ValueError("Grant amount must be positive")
    if not reason or not reason.strip():
        raise ValueError("Reason is required for admin grants")

    locked = await _lock_user(db, target_user.id)
    if locked is None:
        raise ValueError("Target user not found")
    locked.credits_balance = locked.credits_balance + amount

    txn = CreditTransaction(
        user_id=locked.id,
        project_id=None,
        amount=amount,
        kind=CreditTxnKind.admin_grant,
        reason=reason.strip(),
        created_by=granted_by.id,
    )
    db.add(txn)
    await db.flush()
    return txn


async def admin_refund_for_project(
    db: AsyncSession,
    *,
    project: Project,
    reason: str,
    granted_by: User,
) -> CreditTransaction:
    """Admin manually refunds a previously-charged project.

    Mirrors the original charge's absolute amount so a user who paid 100 last
    week gets back exactly 100 even if the rate has since changed — the
    ledger row is the source of truth.
    """
    if not reason or not reason.strip():
        raise ValueError("Reason is required for admin refunds")

    open_charge = await _find_open_charge(db, project.id)
    if open_charge is None:
        # Either never charged, or already refunded — both raise (caller decides).
        if project.credits_charged_at is None:
            raise NothingToRefundError(f"Project {project.id} has no charge to refund")
        raise AlreadyRefundedError(f"Project {project.id}'s charge has already been refunded")

    refund_amount = -open_charge.amount  # original was negative; we credit back the absolute value
    now = datetime.now(timezone.utc)

    locked = await _lock_user(db, project.owner_id)
    if locked is None:
        raise ValueError("Project owner not found")
    locked.credits_balance = locked.credits_balance + refund_amount

    refund_row = CreditTransaction(
        user_id=locked.id,
        project_id=project.id,
        amount=refund_amount,
        kind=CreditTxnKind.admin_refund,
        reason=reason.strip(),
        created_by=granted_by.id,
    )
    db.add(refund_row)
    await db.flush()

    open_charge.refunded = True
    open_charge.refunded_at = now
    open_charge.refunded_by_id = refund_row.id

    return refund_row


async def charge_for_project(db: AsyncSession, user: User, project: Project) -> None:
    """Debit the configured project cost on first 2→3 transition.

    Raises:
      InsufficientCreditsError — balance < cost (caller maps to step-transition error).
    """
    # Admins never spend; callers should also gate, but defense in depth.
    if user.role.value == 'admin':
        return

    # Cheap pre-check (in-memory state) — avoids the lock when clearly already charged.
    if project.credits_charged_at is not None:
        return

    cost = _project_cost()
    if cost <= 0:
        # Admin set the rate to zero — record nothing but mark as charged so
        # a future non-zero rate doesn't retroactively charge the same project.
        project.credits_charged_at = datetime.now(timezone.utc)
        return

    locked = await _lock_user(db, user.id)
    if locked is None:
        raise ValueError("User not found")

    # Re-check INSIDE the lock against the freshest DB state. A concurrent
    # transaction may have charged this same project while we were blocked
    # on the user-row lock — refresh credits_charged_at from the DB before
    # deciding to charge.
    await db.refresh(project, attribute_names=['credits_charged_at'])
    if project.credits_charged_at is not None:
        return

    if locked.credits_balance < cost:
        raise InsufficientCreditsError(available=locked.credits_balance, required=cost)

    locked.credits_balance = locked.credits_balance - cost
    project.credits_charged_at = datetime.now(timezone.utc)

    # Stash the project name in `reason` so the ledger row stays traceable
    # even after the project is deleted (the FK on project_id is ON DELETE
    # SET NULL — without this label, an orphan project_charge row would
    # have no human-readable link back to the original project).
    db.add(CreditTransaction(
        user_id=locked.id,
        project_id=project.id,
        amount=-cost,
        kind=CreditTxnKind.project_charge,
        reason=(project.name or str(project.id)),
        created_by=None,
    ))


def mark_quotation_requested(project: Project) -> None:
    """Stamp the project as having gone through Get Quotation. No credit movement."""
    if project.quotation_requested_at is None:
        project.quotation_requested_at = datetime.now(timezone.utc)


def dismiss_from_refund_inbox(project: Project, *, admin: User, reason: str | None) -> None:
    """Hide the project from the pending-refunds inbox (no credit movement)."""
    project.refund_inbox_dismissed_at = datetime.now(timezone.utc)
    project.refund_inbox_dismissed_by_id = admin.id
    project.refund_inbox_dismissed_reason = (reason or '').strip() or None


def undismiss_from_refund_inbox(project: Project) -> None:
    """Restore the project to the pending-refunds inbox."""
    project.refund_inbox_dismissed_at = None
    project.refund_inbox_dismissed_by_id = None
    project.refund_inbox_dismissed_reason = None


async def compute_account_snapshot(db: AsyncSession, user: User) -> dict:
    """Return the {available, used, total} view shown on /auth/me.

    `used` is the absolute sum of currently-open project_charge rows.
    `total = available + used` (only ever grows as new grants/purchases land).
    """
    result = await db.execute(
        select(func.coalesce(func.sum(-CreditTransaction.amount), 0)).where(
            CreditTransaction.user_id == user.id,
            CreditTransaction.kind == CreditTxnKind.project_charge,
            CreditTransaction.refunded.is_(False),
        )
    )
    used = int(result.scalar_one())
    available = int(user.credits_balance)
    return {
        'credits_available': available,
        'credits_used': used,
        'credits_total': available + used,
    }
