"""add is_verified and is_sysadmin to users

Revision ID: 0004
Revises: 0003
Create Date: 2026-03-24

"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("is_verified", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("users", sa.Column("is_sysadmin", sa.Boolean(), nullable=False, server_default="false"))
    # Mark all existing users as verified (they pre-date the verification requirement)
    op.execute("UPDATE users SET is_verified = true")


def downgrade() -> None:
    op.drop_column("users", "is_sysadmin")
    op.drop_column("users", "is_verified")
