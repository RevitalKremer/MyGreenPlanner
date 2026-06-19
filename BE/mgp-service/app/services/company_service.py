"""Company get-or-create + lookups.

Companies are deduped by a normalized name so two users typing the same company
in different casing/spacing ("Sadot Energy" vs " sadot  energy ") land on one
row. The original casing is preserved on `name` for display.
"""
import re

from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company import Company
from app.models.user import User


def normalize_name(name: str) -> str:
    """Dedup key: trim, collapse internal whitespace, lower-case."""
    return re.sub(r"\s+", " ", (name or "").strip()).lower()


async def get_or_create(db: AsyncSession, name: str) -> Company:
    """Return the Company matching `name` (by normalized key), creating it if
    missing. Caller is responsible for committing the surrounding transaction.

    Races (two registrations of a new company at once) are resolved against the
    unique `normalized_name` constraint: on IntegrityError we roll back the
    failed insert and re-read the now-existing row.
    """
    norm = normalize_name(name)
    existing = (await db.execute(
        select(Company).where(Company.normalized_name == norm)
    )).scalar_one_or_none()
    if existing is not None:
        return existing

    company = Company(name=name.strip(), normalized_name=norm)
    db.add(company)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        return (await db.execute(
            select(Company).where(Company.normalized_name == norm)
        )).scalar_one()
    return company


async def list_companies(db: AsyncSession) -> list[tuple[Company, int]]:
    """All companies (alphabetical) with their member count. Used by the admin
    Companies tab and the Users-tab assignment picker."""
    rows = (await db.execute(
        select(Company, func.count(User.id))
        .outerjoin(User, User.company_id == Company.id)
        .group_by(Company.id)
        .order_by(Company.name)
    )).all()
    return [(c, cnt) for c, cnt in rows]


async def member_count(db: AsyncSession, company_id) -> int:
    return (await db.execute(
        select(func.count(User.id)).where(User.company_id == company_id)
    )).scalar_one()
