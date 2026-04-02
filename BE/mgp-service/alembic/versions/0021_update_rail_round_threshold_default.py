"""update railRoundThresholdCm default to 50

Revision ID: 0021
Revises: 0020
Create Date: 2026-04-02

"""
from typing import Sequence, Union
from alembic import op

revision: str = "0021"
down_revision: Union[str, None] = "0020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "UPDATE app_settings SET value_json = '50', max_val = 100.0 WHERE key = 'railRoundThresholdCm'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE app_settings SET value_json = '5', max_val = 30.0 WHERE key = 'railRoundThresholdCm'"
    )
