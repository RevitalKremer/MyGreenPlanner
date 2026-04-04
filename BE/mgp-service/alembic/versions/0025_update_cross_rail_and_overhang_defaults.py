"""update railOverhangCm default to 10

Revision ID: 0025
Revises: 0024
Create Date: 2026-04-03

"""
from typing import Sequence, Union
from alembic import op

revision: str = "0025"
down_revision: Union[str, None] = "0024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "UPDATE app_settings SET value_json = '40' WHERE key = 'crossRailEdgeDistMm'"
    )
    op.execute(
        "UPDATE app_settings SET value_json = '10' WHERE key = 'railOverhangCm'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE app_settings SET value_json = '4' WHERE key = 'railOverhangCm'"
    )
