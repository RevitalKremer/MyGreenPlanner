"""Add companies + company_id on users.

Revision ID: 0053
Revises: 0052
Create Date: 2026-06-18

First phase of company management: a real Company entity (deduped by
normalized_name) and a nullable users.company_id (required at registration,
NULL for admins/legacy). Company-level project sharing is derived from the
project owner's company (project.owner.company_id) — no column on projects.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = '0053'
down_revision = '0052'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "companies",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("normalized_name", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_companies_normalized_name", "companies", ["normalized_name"], unique=True)

    op.add_column("users", sa.Column("company_id", UUID(as_uuid=True), nullable=True))
    op.create_index("ix_users_company_id", "users", ["company_id"])
    op.create_foreign_key(
        "fk_users_company_id", "users", "companies", ["company_id"], ["id"], ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_users_company_id", "users", type_="foreignkey")
    op.drop_index("ix_users_company_id", table_name="users")
    op.drop_column("users", "company_id")

    op.drop_index("ix_companies_normalized_name", table_name="companies")
    op.drop_table("companies")
