"""upsert all products from product-dict.csv

Revision ID: 0007
Revises: 0006
Create Date: 2026-03-26

Imports every row from public/product-dict.csv (including inactive items).
Uses INSERT ... ON CONFLICT (type_key) DO UPDATE so existing rows are
refreshed and new rows are added without duplicates.
Panel-type products (with dimensions) are unaffected — product_type stays 'panel'.
"""
from typing import Sequence, Union
import uuid
from datetime import datetime, timezone
from alembic import op
import sqlalchemy as sa

revision: str = '0007'
down_revision: Union[str, None] = '0006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NOW = datetime.now(timezone.utc)

# (type_key, part_number, name, active, extra, alt, alt_group, sort_order)
# Source: public/product-dict.csv
# active: "1" → True, "" → False
# extra:  "0" or "" → None
CSV_PRODUCTS = [
    ("angle_profile_40x40",                                             None, "Angle Profile 40X40 mm",                                              True,  None,   None,                   None, 0),
    ("rail_40x40",                                                      None, "Rail Clamps 40X40 mm",                                                True,  None,   None,                   None, 1),
    ("block_50x24x15",                                                  None, "Block (50*24*15)",                                                     True,  None,   None,                   None, 2),
    ("bitumen_sheets",                                                  None, "Bitumen Sheets",                                                       True,  None,   None,                   None, 3),
    ("jumbo_5x16",                                                      None, "Jumbo 5*16",                                                           True,  "10%",  "single_arrow_anchor_bolt", 1,  4),
    ("end_panel_clamp",                                                 None, "End Panel Clamp",                                                      True,  "10%",  None,                   None, 5),
    ("rail_end_cap",                                                    None, "Rail End Cap",                                                         True,  "10%",  None,                   None, 6),
    ("mid_panel_clamp",                                                 None, "Mid Panel Clamp",                                                      True,  "10%",  None,                   None, 7),
    ("grounding_panel_clamp",                                           None, "Grounding Panel Clamp",                                                True,  "10%",  None,                   None, 8),
    ("rail_connector",                                                  None, "Rail Connector",                                                       True,  "10%",  None,                   None, 9),
    ("hex_head_bolt_m8x20",                                             None, "Hex Head Bolt M8*20",                                                  True,  "10%",  None,                   None, 10),
    ("flange_nut_m8_stainless_steel",                                   None, "Flange Nut M8 Stainless Steel",                                        True,  "10%",  None,                   None, 11),
    ("torx_sharp_screw_for_wood_roof_7_5cm_3",                         None, 'Torx Sharp Screw for Wood Roof 7.5cm (3")',                            False, None,   None,                   None, 12),
    ("torx_sharp_screw_for_wood_roof_10cm",                             None, "Torx Sharp Screw for Wood Roof 10cm",                                  False, None,   None,                   None, 13),
    ("torx_sharp_screw_for_wood_roof_12_5cm_5",                        None, 'Torx Sharp Screw for Wood Roof 12.5cm (5")',                           False, None,   None,                   None, 14),
    ("sandwich_panel_accessory_screws_not_included",                    None, "Sandwich Panel Accessory (screws not included)",                       False, None,   None,                   None, 15),
    ("circuit_breaker_100a",                                            None, "Circuit Breaker 100A",                                                 False, None,   None,                   None, 16),
    ("collection_panel_for_two_50kw_inverters_incl_depreciation_relay", None, "Collection Panel for Two 50kW Inverters incl. Depreciation Relay",    False, None,   None,                   None, 17),
    ("angle_connector_10cm",                                            None, "Angle Connector 10cm",                                                 False, None,   None,                   None, 18),
    ("single_arrow_anchor_bolt",                                        None, "Single Arrow Anchor Bolt",                                             False, None,   "jumbo_5x16",           1,    19),
    ("m12_nut_for_arrow_anchor",                                        None, "M12 Nut for Arrow Anchor",                                             False, None,   None,                   None, 20),
    ("m12_washer_for_arrow_anchor",                                     None, "M12 Washer for Arrow Anchor",                                          False, None,   None,                   None, 21),
    ("self_drilling_screw_3_5_drill_1_4_1_4_1_with_seal",              None, "Self-drilling Screw 3.5 (drill 1/4-1/4 * 1 with seal)",               False, None,   None,                   None, 22),
    ("self_drilling_screw_7_5_drill_1_4_1_4_1_with_seal",              None, "Self-drilling Screw 7.5 (drill 1/4-1/4 * 1 with seal)",               False, None,   None,                   None, 23),
    ("self_drilling_screw_12_5_5_drill_with_seal",                     None, 'Self-drilling Screw 12.5 (5" drill with seal)',                        False, None,   None,                   None, 24),
    ("epdm",                                                            None, "EPDM",                                                                 False, None,   None,                   None, 25),
    ("hooks",                                                           None, "Hooks",                                                                False, None,   None,                   None, 26),
    ("hook_5cm_with_3_holes_gallery",                                   None, "Hook 5cm with 3 holes (Gallery)",                                      False, None,   None,                   None, 27),
    ("connection_angle_10cm_for_base",                                  None, "Connection Angle 10cm for Base",                                       False, None,   None,                   None, 28),
    ("end_grounding_panel_clamp_rapid",                                 None, "End Grounding Panel Clamp Rapid",                                      False, None,   None,                   None, 29),
    ("mid_grounding_panel_clamp_without_screw",                        None, "Mid Grounding Panel Clamp without Screw",                              False, None,   None,                   None, 30),
    ("end_grounding_panel_clamp_without_screw",                        None, "End Grounding Panel Clamp without Screw",                              False, None,   None,                   None, 31),
    ("cable_6mm_red",                                                   None, "Cable 6mm Red",                                                        False, None,   None,                   None, 32),
    ("cable_6mm_black",                                                 None, "Cable 6mm Black",                                                      False, None,   None,                   None, 33),
    ("bare_copper_16mm",                                                None, "Bare Copper 16mm",                                                     False, None,   None,                   None, 34),
    ("junction_box_2_strings",                                          None, "Junction Box 2 Strings",                                               False, None,   None,                   None, 35),
    ("ac_panel_25a",                                                    None, "AC Panel 25A",                                                         False, None,   None,                   None, 36),
    ("ac_panel_40a",                                                    None, "AC Panel 40A",                                                         False, None,   None,                   None, 37),
    ("distribution_board_7_holes",                                      None, "Distribution Board 7 holes",                                           False, None,   None,                   None, 38),
    ("circuit_breaker_4x25a",                                           None, "Circuit Breaker 4X25A",                                                False, None,   None,                   None, 39),
    ("circuit_breaker_4x40a",                                           None, "Circuit Breaker 4X40A",                                                False, None,   None,                   None, 40),
    ("panel_cable_extensions",                                          None, "Panel Cable Extensions",                                               False, None,   None,                   None, 41),
    ("rails",                                                           None, "------Rails------",                                                    False, None,   None,                   None, 42),
    ("trapezoidal_purlins",                                             None, "------Trapezoidal Purlins------",                                      False, None,   None,                   None, 43),
    ("diagonals",                                                       None, "------Diagonals------",                                                False, None,   None,                   None, 44),
    ("hardware",                                                        None, "------Hardware------",                                                 False, None,   None,                   None, 45),
    ("washer_m10",                                                      None, "Washer (M10)",                                                         False, None,   None,                   None, 46),
    ("panel_cable_clip_for_rail",                                       None, "Panel Cable Clip for Rail",                                            False, None,   None,                   None, 47),
    ("sandwich_roof_accessory",                                         None, "Sandwich Roof Accessory",                                              False, None,   None,                   None, 48),
    ("klazip_kit",                                                      None, "Klazip Kit",                                                           False, None,   None,                   None, 49),
    ("self_drilling_screw_6cm_with_seal",                               None, "Self-drilling Screw 6cm with Seal",                                    False, None,   None,                   None, 50),
    ("self_drilling_screw_5cm_with_seal",                               None, "Self-drilling Screw 5cm with Seal",                                    False, None,   None,                   None, 51),
    ("sharp_screw_3_5cm",                                               None, "Sharp Screw 3.5cm",                                                    False, None,   None,                   None, 52),
    ("sharp_screw_7_5cm",                                               None, "Sharp Screw 7.5cm",                                                    False, None,   None,                   None, 53),
    ("depreciation_waste",                                              None, "Depreciation/Waste",                                                   False, None,   None,                   None, 54),
    ("self_drilling_screw_3_5_without_seal",                            None, "Self-drilling Screw 3.5 (without seal)",                               False, None,   None,                   None, 55),
    ("self_drilling_screw_2_with_seal",                                 None, 'Self-drilling Screw 2" with Seal',                                    False, None,   None,                   None, 56),
    ("flexible_conduit_30m_bundle_diameter_18mm_pg16",                 None, "Flexible Conduit 30m Bundle Diameter 18mm PG16",                      False, None,   None,                   None, 57),
    ("flexible_conduit_21",                                             None, "Flexible Conduit 21",                                                  False, None,   None,                   None, 58),
    ("connectors",                                                      None, "Connectors",                                                           False, None,   None,                   None, 59),
    ("electrical_cable_4x10",                                           None, "Electrical Cable 4X10",                                                False, None,   None,                   None, 60),
    ("meter_panel_25a",                                                 None, "Meter Panel 25A",                                                      False, None,   None,                   None, 61),
    ("distribution_board_11_holes",                                     None, "Distribution Board 11 holes",                                          False, None,   None,                   None, 62),
    ("bare_copper_25mm",                                                None, "Bare Copper 25mm",                                                     False, None,   None,                   None, 63),
    ("yellow_green_copper_16mm",                                        None, "Yellow/Green Copper 16mm",                                             False, None,   None,                   None, 64),
    ("yellow_green_copper_25mm",                                        None, "Yellow/Green Copper 25mm",                                             False, None,   None,                   None, 65),
    ("yellow_green_copper_35mm",                                        None, "Yellow/Green Copper 35mm",                                             False, None,   None,                   None, 66),
    ("roof_connection_accessory_l",                                     None, "Roof Connection Accessory (L)",                                        False, None,   None,                   None, 67),
    ("arrow_anchor_bolt_kit",                                           None, "Arrow Anchor Bolt Kit",                                                False, None,   None,                   None, 68),
    ("meter_box_25a",                                                   None, "Meter Box 25A",                                                        False, None,   None,                   None, 69),
    ("disconnect_panel_before_after_production_meter",                  None, "Disconnect Panel Before/After Production Meter",                       False, None,   None,                   None, 70),
    ("breaker_4_200_ampere",                                            None, "Breaker 4*200 Ampere",                                                 False, None,   None,                   None, 71),
    ("collection_panel_for_70kw_inverter_incl_depreciation",           None, "Collection Panel for 70kW Inverter incl. Depreciation",               False, None,   None,                   None, 72),
]


def upgrade() -> None:
    conn = op.get_bind()
    for row in CSV_PRODUCTS:
        type_key, part_number, name, active, extra, alt, alt_group, sort_order = row
        conn.execute(sa.text("""
            INSERT INTO products
                (id, type_key, product_type, part_number, name, active, extra, alt, alt_group, sort_order, created_at, updated_at)
            VALUES
                (:id, :type_key, 'material', :part_number, :name, :active, :extra, :alt, :alt_group, :sort_order, :now, :now)
            ON CONFLICT (type_key) DO UPDATE SET
                name       = EXCLUDED.name,
                part_number = EXCLUDED.part_number,
                active     = EXCLUDED.active,
                extra      = EXCLUDED.extra,
                alt        = EXCLUDED.alt,
                alt_group  = EXCLUDED.alt_group,
                sort_order = EXCLUDED.sort_order,
                updated_at = EXCLUDED.updated_at
            WHERE products.product_type != 'panel'
        """), {
            "id": uuid.uuid4(),
            "type_key": type_key,
            "part_number": part_number,
            "name": name,
            "active": active,
            "extra": extra,
            "alt": alt,
            "alt_group": alt_group,
            "sort_order": sort_order,
            "now": NOW,
        })


def downgrade() -> None:
    # Downgrade is a no-op — we don't delete products that may have been
    # referenced by projects. Re-run upgrade of 0003 to restore original seed.
    pass
