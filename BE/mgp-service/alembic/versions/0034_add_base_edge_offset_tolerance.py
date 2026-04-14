"""add baseEdgeOffsetTolerance to app_settings

Revision ID: 0034
Revises: 0033
Create Date: 2026-04-14

"""
from typing import Sequence, Union
from alembic import op

revision: str = "0034"
down_revision: Union[str, None] = "0033"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO app_settings
            (key, value_json, label, section, scope, param_type,
             min_val, max_val, step_val, highlight_group, visible, roof_types, updated_at)
        VALUES
            ('baseEdgeOffsetTolerance', '15', 'Edge Offset Tolerance (%)', 'bases', 'trapezoid', 'number',
             0, 30, 1, NULL, false,
             '["concrete", "iskurit", "insulated_panel"]'::jsonb, NOW())
        ON CONFLICT (key) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM app_settings WHERE key = 'baseEdgeOffsetTolerance'")
