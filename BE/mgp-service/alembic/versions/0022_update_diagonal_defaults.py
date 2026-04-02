"""update diagBasePct default to 85, diagTopPct default to 20

Revision ID: 0022
Revises: 0021
Create Date: 2026-04-02

"""
from typing import Sequence, Union
from alembic import op

revision: str = "0022"
down_revision: Union[str, None] = "0021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE app_settings SET value_json = '85' WHERE key = 'diagBasePct'")
    op.execute("UPDATE app_settings SET value_json = '20' WHERE key = 'diagTopPct'")


def downgrade() -> None:
    op.execute("UPDATE app_settings SET value_json = '90' WHERE key = 'diagBasePct'")
    op.execute("UPDATE app_settings SET value_json = '25' WHERE key = 'diagTopPct'")
