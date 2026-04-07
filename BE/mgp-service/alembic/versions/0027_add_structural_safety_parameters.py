"""add structural safety parameters to app_settings

Revision ID: 0027
Revises: 0026
Create Date: 2026-04-06

Adds 5 parameters for structural safety thresholds and punch spacing:
- diagSkipBelowCm: Skip diagonal bracing if both legs < threshold
- diagDoubleAboveCm: Double diagonal if leg >= threshold  
- punchOverlapMarginCm: Minimum spacing between punches
- punchInnerOffsetCm: Offset for inner block punches
- railRoundPrecisionCm: Rail rounding precision (5cm default)
"""
from typing import Sequence, Union
from alembic import op

revision: str = "0027"
down_revision: Union[str, None] = "0026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Structural safety parameters for detail section
    op.execute(
        """
        INSERT INTO app_settings 
        (key, value_json, label, section, scope, param_type, min_val, max_val, step_val, highlight_group, visible, updated_at)
        VALUES 
        ('diagSkipBelowCm', '60', 'Skip Diagonal Below (cm)', 'detail', 'global', 'number', 0, 200, 5, 'diagonals', true, NOW()),
        ('diagDoubleAboveCm', '200', 'Double Diagonal Above (cm)', 'detail', 'global', 'number', 50, 500, 10, 'diagonals', true, NOW()),
        ('punchOverlapMarginCm', '2', 'Punch Overlap Margin (cm)', 'detail', 'global', 'number', 0.5, 10, 0.5, 'punches', true, NOW()),
        ('punchInnerOffsetCm', '8', 'Punch Inner Offset (cm)', 'detail', 'global', 'number', 2, 20, 1, 'punches', true, NOW()),
        ('railRoundPrecisionCm', '5', 'Rail Rounding Precision (cm)', 'rails', 'global', 'number', 1, 10, 1, NULL, false, NOW())
        ON CONFLICT (key) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM app_settings 
        WHERE key IN (
            'diagSkipBelowCm',
            'diagDoubleAboveCm', 
            'punchOverlapMarginCm',
            'punchInnerOffsetCm',
            'railRoundPrecisionCm'
        )
        """
    )
