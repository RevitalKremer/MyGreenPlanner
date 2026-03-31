"""add angleProfileSizeMm and panelThickCm to app_settings

Revision ID: 0017
Revises: 0016
Create Date: 2026-04-01

"""
from typing import Sequence, Union
from alembic import op

revision: str = "0017"
down_revision: Union[str, None] = "0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Angle profile (beam) thickness — under "bases" section
    op.execute(
        """
        INSERT INTO app_settings (key, value_json, label, section, scope, param_type, min_val, max_val, step_val, updated_at)
        VALUES ('angleProfileSizeMm', '40', 'Angle Profile Size (mm)', 'bases', 'global', 'number', 20.0, 100.0, 5.0, NOW())
        ON CONFLICT (key) DO NOTHING
        """
    )
    # Panel thickness — global parameter
    op.execute(
        """
        INSERT INTO app_settings (key, value_json, label, section, scope, param_type, min_val, max_val, step_val, updated_at)
        VALUES ('panelThickCm', '3.5', 'Panel Thickness (cm)', 'global', 'global', 'number', 0.5, 10.0, 0.5, NOW())
        ON CONFLICT (key) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM app_settings WHERE key = 'angleProfileSizeMm'")
    op.execute("DELETE FROM app_settings WHERE key = 'panelThickCm'")
