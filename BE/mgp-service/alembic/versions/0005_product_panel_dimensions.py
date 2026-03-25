"""add panel dimension columns to products

Revision ID: 0005
Revises: 0004
Create Date: 2026-03-25

"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("products", sa.Column("length_cm", sa.Float(), nullable=True))
    op.add_column("products", sa.Column("width_cm", sa.Float(), nullable=True))
    op.add_column("products", sa.Column("kw_peak", sa.Integer(), nullable=True))

    # Seed the existing AIKO G670 panel with its known dimensions
    op.execute("""
        UPDATE products
        SET length_cm = 238.2, width_cm = 113.4, kw_peak = 670
        WHERE type_key = 'AIKO-G670-MCH72Mw'
    """)


def downgrade() -> None:
    op.drop_column("products", "kw_peak")
    op.drop_column("products", "width_cm")
    op.drop_column("products", "length_cm")
