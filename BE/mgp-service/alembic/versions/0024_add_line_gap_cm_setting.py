"""add lineGapCm to app_settings

Revision ID: 0024
Revises: 0023
Create Date: 2026-04-03

"""
from typing import Sequence, Union
from alembic import op

revision: str = "0024"
down_revision: Union[str, None] = "0023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO app_settings (key, value_json, label, section, scope, param_type, min_val, max_val, step_val, updated_at)
        VALUES ('lineGapCm', '2', 'Distance Between Lines (cm)', 'global', 'global', 'number', 2, 2.5, NULL, NOW())
        ON CONFLICT (key) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM app_settings WHERE key = 'lineGapCm'")
