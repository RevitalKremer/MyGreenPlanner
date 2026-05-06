"""Enrich products: add price/weight/depreciation columns + category-typed product_type.

Adds three new nullable columns (price_ils, weight_kg, depreciation_pct), bumps
the product_type column from 20 to 50 chars, and updates each existing material
row with its category (replacing the generic 'material' value) and the new
numeric fields. All rows referenced here are expected to already exist in the
DB — the migration UPDATEs only and never inserts. Panels are guarded.

Source: docs/Book1.csv (Hebrew column "type" → English category here).

Revision ID: 0036
Revises: 0035
Create Date: 2026-05-05
"""
from datetime import datetime, timezone
from alembic import op
import sqlalchemy as sa


revision = '0036'
down_revision = '0035'
branch_labels = None
depends_on = None


# (type_key, product_type, price_ils, weight_kg, depreciation_pct)
PRODUCTS = [
    ('sharp_screw_3_5cm',                                              'screws',                 0.32,   None,   None),
    ('hook_5cm_with_3_holes_gallery',                                  'anchoring',              20.0,   None,   None),
    ('flange_nut_m8_stainless_steel',                                  'screws',                 0.48,   None,    None),
    ('hooks',                                                          'anchoring',              20.0,   None,   None),
    ('meter_box_25a',                                                  'electrical_cabinets',    0.0,    None,   None),
    ('self_drilling_screw_3_5_drill_1_4_1_4_1_with_seal',              'screws',                 0.32,   None,   None),
    ('arrow_anchor_bolt_kit',                                          'screws',                 4.0,    None,   None),
    ('collection_panel_for_two_50kw_inverters_incl_depreciation_relay','electrical_cabinets',    2300.0, None,   None),
    ('flexible_conduit_21',                                            'electrical_wiring',      0.0,    None,   None),
    ('flexible_conduit_30m_bundle_diameter_18mm_pg16',                 'electrical_wiring',      0.0,    None,   None),
    ('circuit_breaker_4x40a',                                          'electrical_cabinets',    200.0,  None,   None),
    ('bitumen_sheets',                                                 'anchoring',              5.7,    None,   None),
    ('electrical_cable_4x10',                                          'electrical_wiring',      0.0,    None,   None),
    ('rail_40x40',                                                     'aluminium',              16.5,   0.9,    4.0),
    ('panel_cable_clip_for_rail',                                      'accessories',            1.3,    None,   None),
    ('m12_nut_for_arrow_anchor',                                       'screws',                 0.2,    None,   None),
    ('roof_connection_accessory_l',                                    'accessories',            6.0,    None,   None),
    ('klazip_kit',                                                     'accessories',            13.0,   None,   None),
    ('junction_box_2_strings',                                         'electrical_cabinets',    1150.0, None,   None),
    ('torx_sharp_screw_for_wood_roof_7_5cm_3',                         'screws',                 0.65,   None,   None),
    ('single_arrow_anchor_bolt',                                       'screws',                 2.5,    None,   None),
    ('bare_copper_25mm',                                               'electrical_wiring',      0.0,    None,   None),
    ('end_grounding_panel_clamp_rapid',                                'clamps',                 6.0,    None,   None),
    ('yellow_green_copper_35mm',                                       'electrical_wiring',      0.0,    None,   None),
    ('washer_m10',                                                     'accessories',            0.55,   None,   None),
    ('end_grounding_panel_clamp_without_screw',                        'clamps',                 4.0,    None,   None),
    ('rail_connector',                                                 'accessories',            5.0,    None,   None),
    ('m12_washer_for_arrow_anchor',                                    'screws',                 0.1,    None,   None),
    ('self_drilling_screw_2_with_seal',                                'screws',                 0.0,    None,   None),
    ('circuit_breaker_4x25a',                                          'electrical_cabinets',    150.0,  None,   None),
    ('self_drilling_screw_12_5_5_drill_with_seal',                     'screws',                 0.9,    None,   None),
    ('epdm',                                                           'accessories',            0.78,   None,   None),
    ('connectors',                                                     'electrical_wiring',      0.0,    None,   None),
    ('mid_panel_clamp',                                                'clamps',                 4.5,    None,   None),
    ('collection_panel_for_70kw_inverter_incl_depreciation',           'electrical_cabinets',    0.0,    None,   None),
    ('panel_cable_extensions',                                         'panel_cable_extensions', 0.0,    None,   None),
    ('breaker_4_200_ampere',                                           'electrical_cabinets',    0.0,    None,   None),
    ('cable_6mm_black',                                                'electrical_wiring',      4.0,    None,   None),
    ('self_drilling_screw_7_5_drill_1_4_1_4_1_with_seal',              'screws',                 0.65,   None,   None),
    ('disconnect_panel_before_after_production_meter',                 'electrical_cabinets',    0.0,    None,   None),
    ('ac_panel_25a',                                                   'electrical_cabinets',    1073.0, None,   None),
    ('yellow_green_copper_16mm',                                       'electrical_wiring',      0.0,    None,   None),
    ('angle_profile_40x40',                                            'aluminium',              16.5,   0.623,  4.0),
    ('torx_sharp_screw_for_wood_roof_12_5cm_5',                        'screws',                 0.9,    None,   None),
    ('sandwich_panel_accessory_screws_not_included',                   'accessories',            5.7,    None,   None),
    ('bare_copper_16mm',                                               'electrical_wiring',      7.8,    None,   None),
    ('self_drilling_screw_3_5_without_seal',                           'screws',                 0.32,   None,   None),
    ('sandwich_roof_accessory',                                        'anchoring',              6.0,    None,   None),
    ('self_drilling_screw_5cm_with_seal',                              'screws',                 0.4,    None,   None),
    ('ac_panel_40a',                                                   'electrical_cabinets',    1123.0, None,   None),
    ('mid_grounding_panel_clamp_without_screw',                        'clamps',                 4.5,    None,   None),
    ('rail_end_cap',                                                   'accessories',            1.2,    None,   None),
    ('block_50x24x15',                                                 'anchoring',              25,     42,     None),
    ('connection_angle_10cm_for_base',                                 'accessories',            1.05,   None,   None),
    ('circuit_breaker_100a',                                           'electrical_cabinets',    480.0,  None,   None),
    ('torx_sharp_screw_for_wood_roof_10cm',                            'screws',                 0.85,   None,   None),
    ('distribution_board_11_holes',                                    'electrical_cabinets',    0.0,    None,   None),
    ('meter_panel_25a',                                                'electrical_cabinets',    0.0,    None,   None),
    ('jumbo_5x16',                                                     'screws',                 1.5,    None,   None),
    ('end_panel_clamp',                                                'clamps',                 4.5,    None,   None),
    ('grounding_panel_clamp',                                          'clamps',                 6.0,    None,   None),
    ('hex_head_bolt_m8x20',                                            'screws',                 0.52,   None,   None),
    ('self_drilling_screw_6cm_with_seal',                              'screws',                 0.6,    None,   None),
    ('distribution_board_7_holes',                                     'electrical_cabinets',    175.0,  None,   None),
    ('sharp_screw_7_5cm',                                              'screws',                 0.9,    None,   None),
    ('cable_6mm_red',                                                  'electrical_wiring',      4.0,    None,   None),
    ('yellow_green_copper_25mm',                                       'electrical_wiring',      0.0,    None,   None),
    ('angle_connector_10cm',                                           'aluminium',              0.0,    None,    None),
    ('depreciation_waste',                                             'aluminium',              16.5,   None,   4.0),
]

# Categories the migration assigns; downgrade reverts these back to 'material'.
NEW_CATEGORIES = (
    'screws', 'clamps', 'accessories', 'anchoring', 'aluminium',
    'electrical_cabinets', 'electrical_wiring', 'panel_cable_extensions',
)


def upgrade() -> None:
    op.add_column('products', sa.Column('price_ils', sa.Float(), nullable=True))
    op.add_column('products', sa.Column('weight_kg', sa.Float(), nullable=True))
    op.add_column('products', sa.Column('depreciation_pct', sa.Float(), nullable=True))

    # Bump product_type length so longer categories like 'panel_cable_extensions'
    # (22 chars) and 'electrical_cabinets' (19) fit comfortably.
    op.alter_column(
        'products', 'product_type',
        existing_type=sa.String(length=20),
        type_=sa.String(length=50),
        existing_nullable=False,
        existing_server_default=None,
    )

    conn = op.get_bind()
    now = datetime.now(timezone.utc)
    for type_key, product_type, price, weight, dep in PRODUCTS:
        # UPDATE only — every type_key here is expected to already exist in the
        # DB (seeded by migration 0007). Panels are guarded so a stray
        # panel-keyed row is never reclassified.
        conn.execute(sa.text("""
            UPDATE products
               SET product_type     = :product_type,
                   price_ils        = :price_ils,
                   weight_kg        = :weight_kg,
                   depreciation_pct = :depreciation_pct,
                   updated_at       = :now
             WHERE type_key = :type_key
               AND product_type != 'panel'
        """), {
            'type_key': type_key,
            'product_type': product_type,
            'price_ils': price,
            'weight_kg': weight,
            'depreciation_pct': dep,
            'now': now,
        })


def downgrade() -> None:
    conn = op.get_bind()
    # Revert any rows we re-categorised back to 'material'.
    conn.execute(
        sa.text("UPDATE products SET product_type = 'material' WHERE product_type = ANY(:cats)"),
        {'cats': list(NEW_CATEGORIES)},
    )

    op.alter_column(
        'products', 'product_type',
        existing_type=sa.String(length=50),
        type_=sa.String(length=20),
        existing_nullable=False,
        existing_server_default=None,
    )

    op.drop_column('products', 'depreciation_pct')
    op.drop_column('products', 'weight_kg')
    op.drop_column('products', 'price_ils')
