"""Activate the depreciation_waste product.

Seeded inactive in 0003; now used as the BOM depreciation summary row.

Revision ID: 0042
Revises: 0041
Create Date: 2026-05-10
"""
from alembic import op


revision = '0042'
down_revision = '0041'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE products SET active = TRUE WHERE type_key = 'depreciation_waste'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE products SET active = FALSE WHERE type_key = 'depreciation_waste'"
    )
