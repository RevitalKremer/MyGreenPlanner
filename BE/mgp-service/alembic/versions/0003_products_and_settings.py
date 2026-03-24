"""add products and app_settings tables with seed data

Revision ID: 0003
Revises: 0002
Create Date: 2026-03-23

"""
from typing import Sequence, Union
import uuid
from datetime import datetime, timezone
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NOW = datetime.now(timezone.utc)

PRODUCTS_SEED = [
    ("angle_profile_40x40", None, "Angle Profile 40X40 mm", None, True, None, None, None, 0),
    ("rail_40x40", None, "Rail Profile 40X40 mm", None, True, None, None, None, 1),
    ("block_50x24x15", None, "Block (50*24*15)", None, True, None, None, None, 2),
    ("bitumen_sheets", None, "Bitumen Sheets", None, True, None, None, None, 3),
    ("jumbo_5x16", None, "Jumbo 5*16", None, True, "10%", "single_arrow_anchor_bolt", 1, 4),
    ("end_panel_clamp", None, "End Panel Clamp", None, True, "10%", None, None, 5),
    ("rail_end_cap", None, "Rail End Cap", None, True, "10%", None, None, 6),
    ("mid_panel_clamp", None, "Mid Panel Clamp", None, True, "10%", None, None, 7),
    ("grounding_panel_clamp", None, "Grounding Panel Clamp", None, True, "10%", None, None, 8),
    ("rail_connector", None, "Rail Connector", None, True, "10%", None, None, 9),
    ("hex_head_bolt_m8x20", None, "Hex Head Bolt M8*20", None, True, "10%", None, None, 10),
    ("flange_nut_m8_stainless_steel", None, "Flange Nut M8 Stainless Steel", None, True, "10%", None, None, 11),
    ("torx_sharp_screw_for_wood_roof_7_5cm_3", None, "Torx Sharp Screw for Wood Roof 7.5cm (3\")", None, False, None, None, None, 12),
    ("torx_sharp_screw_for_wood_roof_10cm", None, "Torx Sharp Screw for Wood Roof 10cm", None, False, None, None, None, 13),
    ("torx_sharp_screw_for_wood_roof_12_5cm_5", None, "Torx Sharp Screw for Wood Roof 12.5cm (5\")", None, False, None, None, None, 14),
    ("sandwich_panel_accessory_screws_not_included", None, "Sandwich Panel Accessory (screws not included)", None, False, None, None, None, 15),
    ("circuit_breaker_100a", None, "Circuit Breaker 100A", None, False, None, None, None, 16),
    ("collection_panel_for_two_50kw_inverters_incl_depreciation_relay", None, "Collection Panel for Two 50kW Inverters incl. Depreciation Relay", None, False, None, None, None, 17),
    ("angle_connector_10cm", None, "Angle Connector 10cm", None, False, None, None, None, 18),
    ("single_arrow_anchor_bolt", None, "Single Arrow Anchor Bolt", None, False, None, "jumbo_5x16", 1, 19),
    ("m12_nut_for_arrow_anchor", None, "M12 Nut for Arrow Anchor", None, False, None, None, None, 20),
    ("m12_washer_for_arrow_anchor", None, "M12 Washer for Arrow Anchor", None, False, None, None, None, 21),
    ("self_drilling_screw_3_5_drill_1_4_1_4_1_with_seal", None, "Self-drilling Screw 3.5 (drill 1/4-1/4 * 1 with seal)", None, False, None, None, None, 22),
    ("self_drilling_screw_7_5_drill_1_4_1_4_1_with_seal", None, "Self-drilling Screw 7.5 (drill 1/4-1/4 * 1 with seal)", None, False, None, None, None, 23),
    ("self_drilling_screw_12_5_5_drill_with_seal", None, "Self-drilling Screw 12.5 (5\" drill with seal)", None, False, None, None, None, 24),
    ("epdm", None, "EPDM", None, False, None, None, None, 25),
    ("hooks", None, "Hooks", None, False, None, None, None, 26),
    ("hook_5cm_with_3_holes_gallery", None, "Hook 5cm with 3 holes (Gallery)", None, False, None, None, None, 27),
    ("connection_angle_10cm_for_base", None, "Connection Angle 10cm for Base", None, False, None, None, None, 28),
    ("end_grounding_panel_clamp_rapid", None, "End Grounding Panel Clamp Rapid", None, False, None, None, None, 29),
    ("mid_grounding_panel_clamp_without_screw", None, "Mid Grounding Panel Clamp without Screw", None, False, None, None, None, 30),
    ("end_grounding_panel_clamp_without_screw", None, "End Grounding Panel Clamp without Screw", None, False, None, None, None, 31),
    ("cable_6mm_red", None, "Cable 6mm Red", None, False, None, None, None, 32),
    ("cable_6mm_black", None, "Cable 6mm Black", None, False, None, None, None, 33),
    ("bare_copper_16mm", None, "Bare Copper 16mm", None, False, None, None, None, 34),
    ("junction_box_2_strings", None, "Junction Box 2 Strings", None, False, None, None, None, 35),
    ("ac_panel_25a", None, "AC Panel 25A", None, False, None, None, None, 36),
    ("ac_panel_40a", None, "AC Panel 40A", None, False, None, None, None, 37),
    ("distribution_board_7_holes", None, "Distribution Board 7 holes", None, False, None, None, None, 38),
    ("circuit_breaker_4x25a", None, "Circuit Breaker 4X25A", None, False, None, None, None, 39),
    ("circuit_breaker_4x40a", None, "Circuit Breaker 4X40A", None, False, None, None, None, 40),
    ("panel_cable_extensions", None, "Panel Cable Extensions", None, False, None, None, None, 41),
    ("rails", None, "------Rails------", None, False, None, None, None, 42),
    ("trapezoidal_purlins", None, "------Trapezoidal Purlins------", None, False, None, None, None, 43),
    ("diagonals", None, "------Diagonals------", None, False, None, None, None, 44),
    ("hardware", None, "------Hardware------", None, False, None, None, None, 45),
    ("washer_m10", None, "Washer (M10)", None, False, None, None, None, 46),
    ("panel_cable_clip_for_rail", None, "Panel Cable Clip for Rail", None, False, None, None, None, 47),
    ("sandwich_roof_accessory", None, "Sandwich Roof Accessory", None, False, None, None, None, 48),
    ("klazip_kit", None, "Klazip Kit", None, False, None, None, None, 49),
    ("self_drilling_screw_6cm_with_seal", None, "Self-drilling Screw 6cm with Seal", None, False, None, None, None, 50),
    ("self_drilling_screw_5cm_with_seal", None, "Self-drilling Screw 5cm with Seal", None, False, None, None, None, 51),
    ("sharp_screw_3_5cm", None, "Sharp Screw 3.5cm", None, False, None, None, None, 52),
    ("sharp_screw_7_5cm", None, "Sharp Screw 7.5cm", None, False, None, None, None, 53),
    ("depreciation_waste", None, "Depreciation/Waste", None, False, None, None, None, 54),
    ("self_drilling_screw_3_5_without_seal", None, "Self-drilling Screw 3.5 (without seal)", None, False, None, None, None, 55),
    ("self_drilling_screw_2_with_seal", None, "Self-drilling Screw 2\" with Seal", None, False, None, None, None, 56),
    ("flexible_conduit_30m_bundle_diameter_18mm_pg16", None, "Flexible Conduit 30m Bundle Diameter 18mm PG16", None, False, None, None, None, 57),
    ("flexible_conduit_21", None, "Flexible Conduit 21", None, False, None, None, None, 58),
    ("connectors", None, "Connectors", None, False, None, None, None, 59),
    ("electrical_cable_4x10", None, "Electrical Cable 4X10", None, False, None, None, None, 60),
    ("meter_panel_25a", None, "Meter Panel 25A", None, False, None, None, None, 61),
    ("distribution_board_11_holes", None, "Distribution Board 11 holes", None, False, None, None, None, 62),
    ("bare_copper_25mm", None, "Bare Copper 25mm", None, False, None, None, None, 63),
    ("yellow_green_copper_16mm", None, "Yellow/Green Copper 16mm", None, False, None, None, None, 64),
    ("yellow_green_copper_25mm", None, "Yellow/Green Copper 25mm", None, False, None, None, None, 65),
    ("yellow_green_copper_35mm", None, "Yellow/Green Copper 35mm", None, False, None, None, None, 66),
    ("roof_connection_accessory_l", None, "Roof Connection Accessory (L)", None, False, None, None, None, 67),
    ("arrow_anchor_bolt_kit", None, "Arrow Anchor Bolt Kit", None, False, None, None, None, 68),
    ("meter_box_25a", None, "Meter Box 25A", None, False, None, None, None, 69),
    ("disconnect_panel_before_after_production_meter", None, "Disconnect Panel Before/After Production Meter", None, False, None, None, None, 70),
    ("breaker_4_200_ampere", None, "Breaker 4*200 Ampere", None, False, None, None, None, 71),
    ("collection_panel_for_70kw_inverter_incl_depreciation", None, "Collection Panel for 70kW Inverter incl. Depreciation", None, False, None, None, None, 72),
]

SETTINGS_SEED = [
    # key, value, label, section, scope, param_type, min_val, max_val, step_val
    ("railSpacingV",        140,            "Spacing Vertical (cm)",      "rails",  "area",       "rail-spacing", 130.0,  None,   None),
    ("railSpacingH",        70,             "Spacing Horizontal (cm)",    "rails",  "area",       "rail-spacing",  60.0,  None,   None),
    ("keepSymmetry",        True,           "Keep Symmetry",              "rails",  "area",       "boolean",       None,  None,   None),
    ("railOverhangCm",      4,              "Rail Overhang (cm)",         "rails",  "area",       "number",        0.0,   30.0,   0.5),
    ("crossRailEdgeDistMm", 40,             "Rail Profile Size (mm)",     "rails",  "global",     "number",        20.0,  100.0,  5.0),
    ("stockLengths",        [5000, 6000],   "Stock Lengths (mm)",         "rails",  "global",     "array",         None,  None,   None),
    ("edgeOffsetMm",        300,            "Edge Offset (mm)",           "bases",  "trapezoid",  "number",        0.0,   1000.0, 10.0),
    ("spacingMm",           2000,           "Base Spacing (mm)",          "bases",  "trapezoid",  "number",        100.0, 5000.0, 50.0),
    ("baseOverhangCm",      5,              "Base Overhang (cm)",         "bases",  "trapezoid",  "number",        0.0,   50.0,   0.5),
    ("blockHeightCm",       15,             "Block Height (cm)",          "detail", "area",       "number",        1.0,   100.0,  1.0),
    ("blockLengthCm",       50,             "Block Length (cm)",          "detail", "area",       "number",        1.0,   200.0,  1.0),
    ("blockWidthCm",        24,             "Block Width (cm)",           "detail", "area",       "number",        5.0,   200.0,  1.0),
    ("blockPunchCm",        9,              "Block Punch Distance (cm)",  "detail", "area",       "number",        4.0,   200.0,  0.5),
    ("diagTopPct",          25,             "Diagonal Top (%)",           "detail", "area",       "number",        0.0,   100.0,  1.0),
    ("diagBasePct",         90,             "Diagonal Base (%)",          "detail", "area",       "number",        0.0,   100.0,  1.0),
]


def upgrade() -> None:
    products_table = op.create_table(
        "products",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("type_key", sa.String(100), nullable=False, unique=True, index=True),
        sa.Column("part_number", sa.String(100), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("additional_info", sa.String(500), nullable=True),
        sa.Column("active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("extra", sa.String(50), nullable=True),
        sa.Column("alt", sa.String(100), nullable=True),
        sa.Column("alt_group", sa.Integer, nullable=True),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    settings_table = op.create_table(
        "app_settings",
        sa.Column("key", sa.String(100), primary_key=True),
        sa.Column("value_json", postgresql.JSONB, nullable=False),
        sa.Column("label", sa.String(255), nullable=False),
        sa.Column("section", sa.String(50), nullable=False),
        sa.Column("scope", sa.String(50), nullable=False),
        sa.Column("param_type", sa.String(50), nullable=False),
        sa.Column("min_val", sa.Float, nullable=True),
        sa.Column("max_val", sa.Float, nullable=True),
        sa.Column("step_val", sa.Float, nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    # Seed products
    op.bulk_insert(products_table, [
        {
            "id": uuid.uuid4(),
            "type_key": row[0], "part_number": row[1], "name": row[2],
            "additional_info": row[3], "active": row[4], "extra": row[5],
            "alt": row[6], "alt_group": row[7], "sort_order": row[8],
            "created_at": NOW, "updated_at": NOW,
        }
        for row in PRODUCTS_SEED
    ])

    # Seed settings
    op.bulk_insert(settings_table, [
        {
            "key": row[0], "value_json": row[1], "label": row[2],
            "section": row[3], "scope": row[4], "param_type": row[5],
            "min_val": row[6], "max_val": row[7], "step_val": row[8],
            "updated_at": NOW,
        }
        for row in SETTINGS_SEED
    ])


def downgrade() -> None:
    op.drop_table("products")
    op.drop_table("app_settings")
