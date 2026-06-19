"""Move client discount_percent from users to companies.

Revision ID: 0054
Revises: 0053
Create Date: 2026-06-19

The admin-set client discount is a company-level commercial term, not a per-user
one. Add companies.discount_percent, backfill it from existing per-user values
(max non-null across a company's members), then drop users.discount_percent.
"""
from alembic import op
import sqlalchemy as sa


revision = '0054'
down_revision = '0053'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("companies", sa.Column("discount_percent", sa.Numeric(5, 2), nullable=True))
    # Best-effort carry-over of any existing per-user discounts to their company.
    op.execute(
        "UPDATE companies SET discount_percent = sub.maxd FROM ("
        "  SELECT company_id, MAX(discount_percent) AS maxd FROM users "
        "  WHERE company_id IS NOT NULL AND discount_percent IS NOT NULL "
        "  GROUP BY company_id"
        ") sub WHERE companies.id = sub.company_id"
    )
    op.drop_column("users", "discount_percent")


def downgrade() -> None:
    op.add_column("users", sa.Column("discount_percent", sa.Numeric(5, 2), nullable=True))
    # Restore per-user values from the company (every member inherits it).
    op.execute(
        "UPDATE users SET discount_percent = companies.discount_percent "
        "FROM companies WHERE companies.id = users.company_id "
        "AND companies.discount_percent IS NOT NULL"
    )
    op.drop_column("companies", "discount_percent")
