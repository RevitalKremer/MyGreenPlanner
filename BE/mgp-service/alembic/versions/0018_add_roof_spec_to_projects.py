"""add roof_spec to projects

Revision ID: 0018
Revises: 0017
Create Date: 2026-04-01

Adds roof_spec JSONB column to projects table.
Default: { type: 'concrete' }
"""
from typing import Sequence, Union
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision: str = "0018"
down_revision: Union[str, None] = "0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add column as nullable first
    op.add_column('projects', sa.Column(
        'roof_spec',
        postgresql.JSONB,
        nullable=True,
    ))
    
    # Backfill existing rows with default value
    op.execute("""
        UPDATE projects 
        SET roof_spec = '{"type": "concrete"}'::jsonb 
        WHERE roof_spec IS NULL
    """)
    
    # Make column non-nullable with server default
    op.alter_column('projects', 'roof_spec',
                    nullable=False,
                    server_default='{"type": "concrete"}')


def downgrade() -> None:
    op.drop_column('projects', 'roof_spec')
