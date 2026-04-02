"""add railRoundThresholdCm to app_settings

Revision ID: 0020
Revises: 0019
Create Date: 2026-04-02

"""
from typing import Sequence, Union
from alembic import op

revision: str = "0020"
down_revision: Union[str, None] = "0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO app_settings (key, value_json, label, section, scope, param_type, min_val, max_val, step_val, updated_at)
        VALUES ('railRoundThresholdCm', '5', 'Rail Round Threshold (cm)', 'global', 'global', 'number', 0, 30.0, 1.0, NOW())
        ON CONFLICT (key) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM app_settings WHERE key = 'railRoundThresholdCm'")
