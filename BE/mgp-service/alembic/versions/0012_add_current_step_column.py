"""add current_step column to projects

Revision ID: 0012
Revises: 0011
Create Date: 2026-03-29

Adds a dedicated current_step integer column to the projects table.
Previously stored inside the layout JSONB column — now a proper column
for server-side step enforcement.

Backfills existing projects from layout.currentStep if available.
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('projects', sa.Column('current_step', sa.Integer, nullable=False, server_default='1'))

    # Backfill from layout.currentStep for existing projects
    op.execute("""
        UPDATE projects
        SET current_step = COALESCE((layout->>'currentStep')::int, 1)
        WHERE layout IS NOT NULL AND layout->>'currentStep' IS NOT NULL
    """)


def downgrade() -> None:
    op.drop_column('projects', 'current_step')
