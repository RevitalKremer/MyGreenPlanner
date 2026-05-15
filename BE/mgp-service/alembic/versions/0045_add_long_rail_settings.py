"""Add long rail extension settings.

Revision ID: 0045
Revises: 0044
Create Date: 2026-05-15

When a rail's total length (including overhang) exceeds longRailThresholdCm,
the BE extends the rail by longRailExtraOverhangCm on each side. This absorbs
panel-placement drift that accumulates over long lines during installation.

Both settings are admin-only (visible=false) — installation tolerance constants,
not per-project knobs.
"""
from alembic import op


revision = '0045'
down_revision = '0044'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO app_settings
        (key, value_json, label, section, scope, param_type, min_val, max_val, step_val,
         highlight_group, visible, updated_at)
        VALUES
        ('longRailThresholdCm',     '1200', 'Long Rail Threshold (cm)',       'rails', 'global', 'number',
         600.0, 2400.0, 10.0, NULL, false, NOW()),
        ('longRailExtraOverhangCm', '5',    'Long Rail Extra Overhang (cm)',  'rails', 'global', 'number',
         0.0,   50.0,   1.0,  NULL, false, NOW())
        ON CONFLICT (key) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM app_settings WHERE key IN ('longRailThresholdCm', 'longRailExtraOverhangCm')"
    )
