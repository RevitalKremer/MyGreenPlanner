"""Product param fixes — merge params onto catalog products (general).

Same merge mechanism as the Sadot-specific fixes (0072), kept separate so
general catalog corrections and the Sadot data can be reviewed and applied
independently. Add entries to PRODUCT_PARAMS to merge params (|| jsonb) onto
the existing params of each product (by type_key).

Revision ID: 0071
Revises: 0070
Create Date: 2026-06-26

"""
from typing import Sequence, Union
import json
import sqlalchemy as sa
from alembic import op

revision: str = "0071"
down_revision: Union[str, None] = "0070"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# type_key → params to merge (|| jsonb) onto the existing params.
PRODUCT_PARAMS: dict[str, dict] = {
    # ── add general (non-Sadot) product data fixes here ──
}


def upgrade() -> None:
    bind = op.get_bind()
    for type_key, params in PRODUCT_PARAMS.items():
        bind.execute(
            sa.text(
                "UPDATE products SET params = COALESCE(params, '{}'::jsonb) || CAST(:p AS jsonb) "
                "WHERE type_key = :tk"
            ),
            {"tk": type_key, "p": json.dumps(params)},
        )


def downgrade() -> None:
    # Strip the keys this migration added back out of each product's params.
    bind = op.get_bind()
    for type_key, params in PRODUCT_PARAMS.items():
        strip = " ".join(f"- '{k}'" for k in params)
        bind.execute(
            sa.text(f"UPDATE products SET params = (params {strip}) WHERE type_key = :tk"),
            {"tk": type_key},
        )
