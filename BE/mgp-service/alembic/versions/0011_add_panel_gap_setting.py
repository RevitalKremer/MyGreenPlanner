"""add panelGapCm to app_settings

Revision ID: 0011
Revises: 0010
Create Date: 2026-03-28

"""
from typing import Sequence, Union
from datetime import datetime, timezone
from alembic import op

revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO app_settings (key, value_json, label, section, scope, param_type, min_val, max_val, step_val, updated_at)
        VALUES ('panelGapCm', '2.5', 'Panel Gap (cm)', 'global', 'global', 'number', 2.5, 2.5, NULL, NOW())
        ON CONFLICT (key) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM app_settings WHERE key = 'panelGapCm'")
