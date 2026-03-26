"""drop sort_order from products

Revision ID: 0009
Revises: 0008
Create Date: 2026-03-26
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0009'
down_revision: Union[str, None] = '0008'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column('products', 'sort_order')


def downgrade() -> None:
    op.add_column('products', sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'))
