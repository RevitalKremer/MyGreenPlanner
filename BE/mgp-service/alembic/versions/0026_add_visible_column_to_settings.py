"""add visible column to app_settings

Revision ID: 0026
Revises: 0025
Create Date: 2026-04-05

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "0026"
down_revision: Union[str, None] = "0025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add visible column (default True for backward compatibility)
    op.add_column(
        'app_settings',
        sa.Column('visible', sa.Boolean(), nullable=False, server_default='true')
    )
    
    # Set specific parameters to NOT visible (admin-only)
    # These are system constants or internal optimization parameters
    op.execute("""
        UPDATE app_settings 
        SET visible = false 
        WHERE key IN (
            'panelGapCm',           -- Fixed at 2.5cm, not user-editable
            'lineGapCm',            -- System constant (2cm)
            'railRoundThresholdCm', -- Internal optimization parameter
            'panelThickCm',         -- System constant
            'reverseBlockPunches'   -- Internal detail flag
        )
    """)


def downgrade() -> None:
    op.drop_column('app_settings', 'visible')
