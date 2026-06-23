"""move panel length_cm/width_cm/kw_peak into params

These columns were panel-only (NULL for every other product). Move them into
the per-product `params` blob (lengthCm / widthCm / Wp) and drop the columns,
leaving the products table free of panel-only columns.

Revision ID: 0070
Revises: 0069
Create Date: 2026-06-23

"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "0070"
down_revision: Union[str, None] = "0069"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "UPDATE products SET params = COALESCE(params, '{}'::jsonb) || jsonb_strip_nulls("
        "  jsonb_build_object('lengthCm', length_cm, 'widthCm', width_cm, 'Wp', kw_peak)) "
        "WHERE product_type = 'panel'"
    )
    op.drop_column("products", "length_cm")
    op.drop_column("products", "width_cm")
    op.drop_column("products", "kw_peak")


def downgrade() -> None:
    op.add_column("products", sa.Column("length_cm", sa.Float, nullable=True))
    op.add_column("products", sa.Column("width_cm", sa.Float, nullable=True))
    op.add_column("products", sa.Column("kw_peak", sa.Integer, nullable=True))
    op.execute(
        "UPDATE products SET "
        "  length_cm = (params->>'lengthCm')::float, "
        "  width_cm  = (params->>'widthCm')::float, "
        "  kw_peak   = (params->>'Wp')::int "
        "WHERE product_type = 'panel'"
    )
