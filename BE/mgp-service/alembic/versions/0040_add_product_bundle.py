"""Add `bundle` column to products + seed the standing bundles.

A bundled product names its parent and a multiplier:
    {"parentType": "<type_key>", "multiplier": <int>}
When the parent appears in the effective BOM, the BOM expand_bundles
pass appends the bundled product as a derived child row with
qty = parent.qty * multiplier.

Initial bundles consolidate hard-coded "comes-with-X" rules previously
inlined in `_compute_bolt_bom` and `_compute_hook_bom`:
  • torx_sharp_screw_for_wood_roof_7_5cm_3 → (hook_5cm_with_3_holes_gallery, 2)
  • m12_nut_for_arrow_anchor               → (single_arrow_anchor_bolt, 2)
  • m12_washer_for_arrow_anchor            → (single_arrow_anchor_bolt, 2)
  • flange_nut_m8_stainless_steel          → (hex_head_bolt_m8x20, 1)
  • bitumen_sheets                         → (block_50x24x15, 1)
  • rail_end_cap                           → (end_panel_clamp, 1)

Also sets alt_group = 1 on arrow_anchor_bolt_kit.

Revision ID: 0040
Revises: 0039
Create Date: 2026-05-09
"""
import json
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = '0040'
down_revision = '0039'
branch_labels = None
depends_on = None


BUNDLES = [
    ('torx_sharp_screw_for_wood_roof_7_5cm_3', 'hook_5cm_with_3_holes_gallery', 2),
    ('m12_nut_for_arrow_anchor',               'single_arrow_anchor_bolt',     2),
    ('m12_washer_for_arrow_anchor',            'single_arrow_anchor_bolt',     2),
    ('flange_nut_m8_stainless_steel',          'hex_head_bolt_m8x20',          1),
    ('bitumen_sheets',                         'block_50x24x15',               1),
    ('rail_end_cap',                           'end_panel_clamp',              1),
]


def upgrade() -> None:
    op.add_column('products', sa.Column('bundle', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    conn = op.get_bind()
    for child, parent, mult in BUNDLES:
        conn.execute(
            sa.text("UPDATE products SET bundle = CAST(:b AS jsonb) WHERE type_key = :k"),
            {'b': json.dumps({'parentType': parent, 'multiplier': mult}), 'k': child},
        )
    conn.execute(
        sa.text("UPDATE products SET alt_group = 1 WHERE type_key = 'arrow_anchor_bolt_kit'"),
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text("UPDATE products SET alt_group = NULL WHERE type_key = 'arrow_anchor_bolt_kit'"),
    )
    op.drop_column('products', 'bundle')
