"""Add nullable client discount_percent to users.

Revision ID: 0052
Revises: 0051
Create Date: 2026-06-17

Admins set a per-user discount (percent, 0–100). NULL means no discount —
the user gets the normal price. The price-proposal generator reads the
project owner's value and applies it to the PRICE_AFTER_DISCOUNT cell.
"""
from alembic import op
import sqlalchemy as sa


revision = '0052'
down_revision = '0051'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("discount_percent", sa.Numeric(5, 2), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "discount_percent")
