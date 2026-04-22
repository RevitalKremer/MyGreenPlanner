"""seed AIKO-G670 panel product

Revision ID: 0035
Revises: 0034
Create Date: 2026-04-22

Earlier migrations assumed an AIKO-G670 row already existed and only UPDATE'd
its dimensions (0005) or flipped its discriminator to 'panel' (0006). Neither
inserts the row, so a freshly-migrated DB has zero panel products and
/products/panel-types returns []. Seed it here, idempotently.
"""
from typing import Sequence, Union
from alembic import op

revision: str = "0035"
down_revision: Union[str, None] = "0034"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO products
            (id, type_key, product_type, part_number, name, name_he,
             additional_info, active, extra, alt_group, is_default,
             length_cm, width_cm, kw_peak, created_at, updated_at)
        VALUES
            (gen_random_uuid(), 'AIKO-G670-MCH72Mw', 'panel', NULL,
             'AIKO G670 MCH72Mw', NULL, NULL, true, NULL, NULL, true,
             238.2, 113.4, 670, NOW(), NOW())
        ON CONFLICT (type_key) DO UPDATE SET
            product_type = 'panel',
            length_cm    = EXCLUDED.length_cm,
            width_cm     = EXCLUDED.width_cm,
            kw_peak      = EXCLUDED.kw_peak,
            active       = true,
            updated_at   = NOW()
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM products WHERE type_key = 'AIKO-G670-MCH72Mw'")
