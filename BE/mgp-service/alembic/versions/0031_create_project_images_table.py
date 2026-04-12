"""create project_images table for storing uploaded images

Revision ID: 0031
Revises: 0030
Create Date: 2026-04-10

Creates a new `project_images` table to store uploaded project images
separately from the main `projects` table. This reduces payload sizes
for project CRUD operations by ~80-90%.

Strategy:
  - New uploads go to project_images table
  - Existing projects continue using layout.uploadedImageData (base64)
  - Frontend handles both: imageRef (new) and uploadedImageData (legacy)
"""
from typing import Sequence, Union
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision: str = "0031"
down_revision: Union[str, None] = "0030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "project_images",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("image_data", sa.LargeBinary, nullable=False),
        sa.Column("content_type", sa.String(50), nullable=False),
        sa.Column("width", sa.Integer, nullable=False),
        sa.Column("height", sa.Integer, nullable=False),
        sa.Column("file_size", sa.Integer, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_project_images_project_id", "project_images", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_project_images_project_id", table_name="project_images")
    op.drop_table("project_images")
