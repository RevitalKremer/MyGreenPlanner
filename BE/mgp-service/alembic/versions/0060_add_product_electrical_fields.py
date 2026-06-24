"""add electrical spec + sadot url to products

Adds the `electrical` JSONB blob (panel electrical specs / inverter MPPT specs)
and the `sadot_url` link (Sadot Energy product page) used by the Tier 2
electrical design module.

Revision ID: 0060
Revises: 0059
Create Date: 2026-06-22

"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0060"
down_revision: Union[str, None] = "0059"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("products", sa.Column("electrical", JSONB, nullable=True))
    op.add_column("products", sa.Column("sadot_url", sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column("products", "sadot_url")
    op.drop_column("products", "electrical")
