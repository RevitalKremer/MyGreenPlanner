"""hide block dimension settings

Manufacturer currently supports a single block (50*24*15). Hide the W/H/L
sliders from the sidebar and rely on the seeded defaults. When a second
block type is introduced, this will be replaced by a block-type selector.

Revision ID: 0047
Revises: 0046
Create Date: 2026-05-24

"""
from typing import Sequence, Union
from alembic import op

revision: str = "0047"
down_revision: Union[str, None] = "0046"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        UPDATE app_settings
        SET visible = false
        WHERE key IN ('blockHeightCm', 'blockLengthCm', 'blockWidthCm')
    """)


def downgrade() -> None:
    op.execute("""
        UPDATE app_settings
        SET visible = true
        WHERE key IN ('blockHeightCm', 'blockLengthCm', 'blockWidthCm')
    """)
