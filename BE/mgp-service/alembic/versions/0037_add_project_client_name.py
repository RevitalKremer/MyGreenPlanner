"""Add client_name to projects (NOT NULL, backfilled with 'UNKNOWN').

Stores the customer / client the project is being prepared for. Surfaces
in the proposal xlsx as the CUSTOMER_NAME placeholder. Mandatory at the
DB level — existing rows are backfilled with 'UNKNOWN' so the constraint
can be enforced immediately.

Revision ID: 0037
Revises: 0036
Create Date: 2026-05-06
"""
from alembic import op
import sqlalchemy as sa


revision = '0037'
down_revision = '0036'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add as nullable first so we can backfill, then enforce NOT NULL.
    op.add_column('projects', sa.Column('client_name', sa.String(length=255), nullable=True))
    op.execute("UPDATE projects SET client_name = 'UNKNOWN' WHERE client_name IS NULL")
    op.alter_column('projects', 'client_name', nullable=False)


def downgrade() -> None:
    op.drop_column('projects', 'client_name')
