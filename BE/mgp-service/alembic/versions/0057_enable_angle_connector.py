"""Enable the angle_connector_10cm product (spliced-beam connector).

Revision ID: 0057
Revises: 0056
Create Date: 2026-06-20

The angle splice connector is the part placed over a spliced base/slope beam
joint (one per joint; its two M8 bolts + flange nuts come from the joint's
'connector' punches via the standard punch->bolt BOM path). It was seeded
inactive in 0003 and, although 0039 bulk-activated the catalog, this migration
makes the connector's activation explicit so the spliced-beam feature has a
self-contained enablement step that doesn't rely on the bulk migration.
"""
from alembic import op
import sqlalchemy as sa


revision = '0057'
down_revision = '0056'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().execute(
        sa.text("UPDATE products SET active = TRUE WHERE type_key = 'angle_connector_10cm'")
    )


def downgrade() -> None:
    # No-op: deactivating could hide a connector that other flows now rely on,
    # and 0039 already activated the whole catalog, so there is no clean prior
    # state to restore.
    pass
