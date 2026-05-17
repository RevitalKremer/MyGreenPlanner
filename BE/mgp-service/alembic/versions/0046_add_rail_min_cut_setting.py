"""Add railMinCutCm setting.

Revision ID: 0046
Revises: 0045
Create Date: 2026-05-17

When the smallest cut piece in a multi-segment rail is below this threshold,
the BE redistributes the last two cut pieces into two equal halves (rounded
to 5cm). Avoids producing tiny offcuts like 5cm that are awkward for
installers to handle. Set to 0 to disable.
"""
from alembic import op


revision = '0046'
down_revision = '0045'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO app_settings
        (key, value_json, label, section, scope, param_type, min_val, max_val, step_val,
         highlight_group, visible, updated_at)
        VALUES
        ('railMinCutCm', '50', 'Rail Min Cut (cm)', 'rails', 'global', 'number',
         0.0, 300.0, 5.0, 'rail-cuts', true, NOW())
        ON CONFLICT (key) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM app_settings WHERE key = 'railMinCutCm'")
