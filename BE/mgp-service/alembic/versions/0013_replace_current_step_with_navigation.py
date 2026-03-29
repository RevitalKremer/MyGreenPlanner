"""replace current_step with navigation JSONB

Revision ID: 0013
Revises: 0012
Create Date: 2026-03-29

Replaces the current_step integer column with a navigation JSONB column
that tracks both step and active tab: {"step": 3, "tab": "rails"}
"""
from typing import Sequence, Union
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('projects', sa.Column(
        'navigation', postgresql.JSONB, nullable=False,
        server_default='{"step": 1, "tab": null}',
    ))
    op.execute("""
        UPDATE projects
        SET navigation = jsonb_build_object('step', current_step, 'tab', null)
    """)
    op.drop_column('projects', 'current_step')


def downgrade() -> None:
    op.add_column('projects', sa.Column('current_step', sa.Integer, nullable=False, server_default='1'))
    op.execute("""
        UPDATE projects
        SET current_step = COALESCE((navigation->>'step')::int, 1)
    """)
    op.drop_column('projects', 'navigation')
