"""Set `extra` waste-percent on clamp / screw / hook products.

  • hook_5cm_with_3_holes_gallery, hooks               → '5%'
  • every product with product_type IN ('clamps','screws') → '10%'

The `extra` column is the BOM waste-percent (string like '10%' parsed by
the FE). Several rows already carry '10%' from earlier seeds; this
migration normalises the rule across categories so new rows added later
inherit the same waste factor when their product_type matches.

Revision ID: 0038
Revises: 0037
Create Date: 2026-05-09
"""
from alembic import op
import sqlalchemy as sa


revision = '0038'
down_revision = '0037'
branch_labels = None
depends_on = None


HOOK_KEYS = ['hook_5cm_with_3_holes_gallery', 'hooks']
CLAMP_SCREW_TYPES = ['clamps', 'screws']


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text("UPDATE products SET extra = :pct WHERE type_key IN :keys").bindparams(
            sa.bindparam('keys', expanding=True),
        ),
        {'pct': '5%', 'keys': HOOK_KEYS},
    )
    conn.execute(
        sa.text("UPDATE products SET extra = :pct WHERE product_type IN :types").bindparams(
            sa.bindparam('types', expanding=True),
        ),
        {'pct': '10%', 'types': CLAMP_SCREW_TYPES},
    )


def downgrade() -> None:
    # Revert to NULL for the affected rows. We can't restore prior values
    # without a snapshot, so this drops the waste factor entirely.
    conn = op.get_bind()
    conn.execute(
        sa.text("UPDATE products SET extra = NULL WHERE type_key IN :keys").bindparams(
            sa.bindparam('keys', expanding=True),
        ),
        {'keys': HOOK_KEYS},
    )
    conn.execute(
        sa.text("UPDATE products SET extra = NULL WHERE product_type IN :types").bindparams(
            sa.bindparam('types', expanding=True),
        ),
        {'types': CLAMP_SCREW_TYPES},
    )
