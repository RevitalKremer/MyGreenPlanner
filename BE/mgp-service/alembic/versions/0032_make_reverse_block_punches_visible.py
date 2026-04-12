"""make reverseBlockPunches visible

Revision ID: 0032
Revises: 0031
Create Date: 2026-04-12

"""
from typing import Sequence, Union
from alembic import op

revision: str = "0032"
down_revision: Union[str, None] = "0031"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Make reverseBlockPunches visible to users (was set to false in 0026)
    op.execute("""
        UPDATE app_settings 
        SET visible = true 
        WHERE key = 'reverseBlockPunches'
    """)


def downgrade() -> None:
    # Revert to hidden state
    op.execute("""
        UPDATE app_settings 
        SET visible = false 
        WHERE key = 'reverseBlockPunches'
    """)
