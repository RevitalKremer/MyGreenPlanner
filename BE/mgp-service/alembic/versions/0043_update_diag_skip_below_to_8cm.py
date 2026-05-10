"""Update diagSkipBelowCm default from 60 to 8 cm.

Revision ID: 0043
Revises: 0042
Create Date: 2026-05-10
"""
from alembic import op


revision = '0043'
down_revision = '0042'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE app_settings SET value_json = '8', updated_at = NOW() WHERE key = 'diagSkipBelowCm'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE app_settings SET value_json = '60', updated_at = NOW() WHERE key = 'diagSkipBelowCm'"
    )
