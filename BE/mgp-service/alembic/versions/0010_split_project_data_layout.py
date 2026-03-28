"""split project data into data + layout columns

Revision ID: 0010
Revises: 0009
Create Date: 2026-03-27

Splits the existing `data` JSONB column on `projects` into two columns:
  - `layout`  stores UI rendering state (pixel coords, canvas, image)
  - `data`    stores physical project config (source of truth)

Migration strategy:
  - Add `layout` column (nullable, defaults to {})
  - Existing `data` column is preserved as-is (old blobs remain valid)
  - No data transformation — FE handles migration on next save
"""
from typing import Sequence, Union
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("layout", postgresql.JSONB, nullable=False, server_default="{}"),
    )


def downgrade() -> None:
    op.drop_column("projects", "layout")
