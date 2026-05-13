"""Replace diagTopPct/diagBasePct with diagDistFromLegCm and diagPreferredAngleDeg.

Revision ID: 0044
Revises: 0043
Create Date: 2026-05-10

New diagonal positioning logic: the bottom attachment is placed a fixed distance
from the near leg along the base beam, and the top attachment is derived by
projecting upward at a preferred angle from horizontal.
"""
from alembic import op


revision = '0044'
down_revision = '0043'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DELETE FROM app_settings WHERE key IN ('diagTopPct', 'diagBasePct')")
    op.execute(
        """
        INSERT INTO app_settings
        (key, value_json, label, section, scope, param_type, min_val, max_val, step_val,
         highlight_group, visible, updated_at)
        VALUES
        ('diagDistFromLegCm',    '25', 'Diagonal Dist. from Leg (cm)', 'detail', 'area', 'number',
         20.0, 100.0, 1.0, 'diagonal', true, NOW()),
        ('diagPreferredAngleDeg','45', 'Diagonal Angle (°)',           'detail', 'area', 'number',
         20.0, 85.0, 1.0, 'diagonal', true, NOW())
        ON CONFLICT (key) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM app_settings WHERE key IN ('diagDistFromLegCm', 'diagPreferredAngleDeg')")
    op.execute(
        """
        INSERT INTO app_settings
        (key, value_json, label, section, scope, param_type, min_val, max_val, step_val,
         highlight_group, visible, updated_at)
        VALUES
        ('diagTopPct',  '20', 'Diagonal Top (%)',  'detail', 'area', 'number', 0.0, 100.0, 1.0, 'diagonal', true, NOW()),
        ('diagBasePct', '85', 'Diagonal Base (%)', 'detail', 'area', 'number', 0.0, 100.0, 1.0, 'diagonal', true, NOW())
        ON CONFLICT (key) DO NOTHING
        """
    )
