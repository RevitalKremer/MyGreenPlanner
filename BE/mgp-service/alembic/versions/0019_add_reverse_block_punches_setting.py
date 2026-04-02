"""add reverseBlockPunches to app_settings

Revision ID: 0019
Revises: 0018
Create Date: 2026-04-02

"""
from typing import Sequence, Union
from alembic import op

revision: str = "0019"
down_revision: Union[str, None] = "0018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO app_settings (key, value_json, label, section, scope, param_type, updated_at)
        VALUES ('reverseBlockPunches', 'true', 'Reverse Block Punches', 'detail', 'global', 'boolean', NOW())
        ON CONFLICT (key) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM app_settings WHERE key = 'reverseBlockPunches'")
