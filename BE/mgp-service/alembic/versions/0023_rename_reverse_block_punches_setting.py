"""rename reverseBlockPunches label

Revision ID: 0023
Revises: 0022
Create Date: 2026-04-02

"""
from typing import Sequence, Union
from alembic import op

revision: str = "0023"
down_revision: Union[str, None] = "0022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "UPDATE app_settings SET label = 'Reverse Block & Slope Beam Punches' WHERE key = 'reverseBlockPunches'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE app_settings SET label = 'Reverse Block Punches' WHERE key = 'reverseBlockPunches'"
    )
