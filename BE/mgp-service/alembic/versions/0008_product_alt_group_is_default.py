"""add is_default to products, drop alt column

Revision ID: 0008
Revises: 0007
Create Date: 2026-03-26

"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = '0008'
down_revision: Union[str, None] = '0007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add is_default: marks the preferred/default product within an alt_group
    op.add_column('products', sa.Column(
        'is_default',
        sa.Boolean,
        nullable=False,
        server_default='false',
    ))

    # jumbo_5x16 is the default in alt_group 1
    op.execute("""
        UPDATE products SET is_default = true WHERE type_key = 'jumbo_5x16'
    """)

    # Drop the old single-pointer alt column — alt_group + is_default replaces it
    op.drop_column('products', 'alt')


def downgrade() -> None:
    op.add_column('products', sa.Column('alt', sa.String(100), nullable=True))
    op.drop_column('products', 'is_default')
