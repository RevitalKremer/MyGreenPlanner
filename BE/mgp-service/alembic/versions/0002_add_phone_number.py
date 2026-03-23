"""add phone_number to users

Revision ID: 0002
Revises: 0001
Create Date: 2026-03-23

"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("phone_number", sa.String(30), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "phone_number")
