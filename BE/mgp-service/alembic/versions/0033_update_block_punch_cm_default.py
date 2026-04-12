"""update blockPunchCm default to 5

Revision ID: 0033
Revises: 0032
Create Date: 2026-04-12

"""
from typing import Sequence, Union
from alembic import op

revision: str = "0033"
down_revision: Union[str, None] = "0032"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Update blockPunchCm default value from 9 to 5
    op.execute("""
        UPDATE app_settings 
        SET value_json = '5' 
        WHERE key = 'blockPunchCm'
    """)


def downgrade() -> None:
    # Revert to previous default value
    op.execute("""
        UPDATE app_settings 
        SET value_json = '9' 
        WHERE key = 'blockPunchCm'
    """)
