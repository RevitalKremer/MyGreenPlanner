"""create project_electrical_bom table

Separate table for the electrical (Sadot goods) BOM — fully independent of
the construction project_bom table. One row per project; items as JSONB.

Revision ID: 0063
Revises: 0062
Create Date: 2026-06-22

"""
from typing import Sequence, Union
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision: str = "0063"
down_revision: Union[str, None] = "0062"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "project_electrical_bom",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            unique=True, nullable=False, index=True,
        ),
        sa.Column("items", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("input_hash", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("project_electrical_bom")
