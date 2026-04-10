"""Add step 2 mounting angle and front height settings to app_settings

Revision ID: 0030
Revises: 0029
Create Date: 2026-04-09

Adds mountingAngleDeg and frontHeightCm as app_settings rows with
default, min, max so step 2 input limits are configurable via admin.
"""

revision = '0030'
down_revision = '0029'
branch_labels = None
depends_on = None

from alembic import op
from sqlalchemy import text


def upgrade() -> None:
    op.execute(text("""
        INSERT INTO app_settings (key, value_json, label, section, scope, param_type, min_val, max_val, step_val, visible, roof_types, updated_at)
        VALUES ('mountingAngleDeg', '10', 'Mounting Angle (°)', 'mounting', 'global', 'number', 0, 40, 1, true, '["concrete", "iskurit", "insulated_panel"]'::jsonb, NOW())
        ON CONFLICT (key) DO NOTHING
    """))
    op.execute(text("""
        INSERT INTO app_settings (key, value_json, label, section, scope, param_type, min_val, max_val, step_val, visible, roof_types, updated_at)
        VALUES ('frontHeightCm', '10', 'Front Height (cm)', 'mounting', 'global', 'number', 0, 500, 1, true, '["concrete", "iskurit", "insulated_panel"]'::jsonb, NOW())
        ON CONFLICT (key) DO NOTHING
    """))


def downgrade() -> None:
    op.execute(text("DELETE FROM app_settings WHERE key IN ('mountingAngleDeg', 'frontHeightCm')"))
