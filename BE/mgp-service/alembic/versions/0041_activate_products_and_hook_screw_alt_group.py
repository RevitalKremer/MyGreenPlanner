"""Activate missing products + hook-screw alt-group 3 with shared bundle.

1. Activate self_drilling_screw_3_5_drill_1_4_1_4_1_with_seal — seeded
   inactive in 0003, missed by 0039; needed for the rail-connector BOM row.

2. Rename sharp_screw_7_5cm → torx_sharp_screw_for_wood_roof_12_5cm_3
   (same screw family as torx_sharp_screw_for_wood_roof_7_5cm_3 but 12.5 cm)
   and activate it.

3. Create alt-group 3 for these two hook wood-roof screws with the 7.5 cm
   variant as the default.

4. Give the 12.5 cm screw the same bundle as the 7.5 cm
   (parentType=hook_5cm_with_3_holes_gallery, multiplier=2) so that
   expand_bundles can re-expand the correct alt-group member after the user
   switches between the two options.

Revision ID: 0041
Revises: 0040
Create Date: 2026-05-09
"""
import json
from alembic import op
import sqlalchemy as sa


revision = '0041'
down_revision = '0040'
branch_labels = None
depends_on = None

_CONNECTOR_SCREW = 'self_drilling_screw_3_5_drill_1_4_1_4_1_with_seal'
_ARROW_ANCHOR_BOLT_KIT = 'arrow_anchor_bolt_kit'
_OLD_KEY         = 'sharp_screw_7_5cm'
_NEW_KEY         = 'torx_sharp_screw_for_wood_roof_12_5cm_3'
_NEW_NAME        = 'Torx Sharp Screw for Wood Roof 12.5cm (3")'
_DEFAULT_KEY     = 'torx_sharp_screw_for_wood_roof_7_5cm_3'


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Activate rail-connector screw
    conn.execute(
        sa.text("UPDATE products SET active = TRUE WHERE type_key = :k"),
        {'k': _CONNECTOR_SCREW},
    )

    # 1a. Activate arrow anchor bolt kit
    conn.execute(
        sa.text("UPDATE products SET active = TRUE WHERE type_key = :k"),
        {'k': _ARROW_ANCHOR_BOLT_KIT},
    )


    # 2. Rename, re-describe, and activate the 12.5 cm hook screw
    conn.execute(
        sa.text("""
            UPDATE products
               SET type_key = :new_key,
                   name     = :new_name,
                   active   = TRUE
             WHERE type_key = :old_key
        """),
        {'new_key': _NEW_KEY, 'new_name': _NEW_NAME, 'old_key': _OLD_KEY},
    )

    # 3. Alt-group 3 — both members
    conn.execute(
        sa.text("UPDATE products SET alt_group = 3 WHERE type_key IN (:a, :b)"),
        {'a': _DEFAULT_KEY, 'b': _NEW_KEY},
    )

    # 4. 7.5 cm variant is the default for group 3
    conn.execute(
        sa.text("UPDATE products SET is_default = TRUE WHERE type_key = :k"),
        {'k': _DEFAULT_KEY},
    )

    # 5. Give the 12.5 cm screw the same bundle as the 7.5 cm so expand_bundles
    #    can re-expand the correct alt-group member after a user swap.
    conn.execute(
        sa.text("UPDATE products SET bundle = CAST(:b AS jsonb) WHERE type_key = :k"),
        {'b': json.dumps({'parentType': 'hook_5cm_with_3_holes_gallery', 'multiplier': 2}), 'k': _NEW_KEY},
    )


def downgrade() -> None:
    conn = op.get_bind()

    conn.execute(
        sa.text("UPDATE products SET is_default = FALSE WHERE type_key = :k"),
        {'k': _DEFAULT_KEY},
    )
    conn.execute(
        sa.text("UPDATE products SET alt_group = NULL WHERE type_key IN (:a, :b)"),
        {'a': _DEFAULT_KEY, 'b': _NEW_KEY},
    )
    conn.execute(
        sa.text("""
            UPDATE products
               SET type_key = :old_key,
                   name     = 'Sharp Screw 7.5cm',
                   active   = FALSE
             WHERE type_key = :new_key
        """),
        {'old_key': _OLD_KEY, 'new_key': _NEW_KEY},
    )
    conn.execute(
        sa.text("UPDATE products SET bundle = NULL WHERE type_key = :k"),
        {'k': _NEW_KEY},
    )
    conn.execute(
        sa.text("UPDATE products SET active = FALSE WHERE type_key = :k"),
        {'k': _CONNECTOR_SCREW},
    )
