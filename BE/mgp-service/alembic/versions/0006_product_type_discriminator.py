"""add product_type discriminator column to products

Revision ID: 0006
Revises: 0005
Create Date: 2026-03-26

"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = '0006'
down_revision: Union[str, None] = '0005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add product_type column; default 'material' for all existing rows
    op.add_column('products', sa.Column(
        'product_type',
        sa.String(20),
        nullable=False,
        server_default='material',
    ))

    # Mark existing rows that have panel dimensions as 'panel'
    op.execute("""
        UPDATE products
        SET product_type = 'panel'
        WHERE length_cm IS NOT NULL
          AND width_cm IS NOT NULL
          AND kw_peak IS NOT NULL
    """)


def downgrade() -> None:
    op.drop_column('products', 'product_type')
