"""add name_he to products and lang to users

Revision ID: 0016
Revises: 0015
Create Date: 2026-03-30

Adds Hebrew product name column and user language preference.
Populates name_he from existing additional_info column.
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: Union[str, None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


HEBREW_NAMES = {
    'angle_profile_40x40': 'פרופיל זוית 40*40',
    'rail_40x40': 'קושרות 40*40',
    'block_50x24x15': 'אבן מעבר 42 ק"ג (50*24*15)',
    'bitumen_sheets': 'יריעת זפת',
    'jumbo_5x16': "בורג ג'מבו (16*5)",
    'end_panel_clamp': 'מהדק פאנל קצה',
    'rail_end_cap': 'פקק קושרת 40*40',
    'mid_panel_clamp': 'מהדק פאנל אמצע',
    'grounding_panel_clamp': 'מהדק פאנל הארקה',
    'rail_connector': 'מחבר קושרת 40*40',
    'hex_head_bolt_m8x20': 'בורג ראש משושה M8*20',
    'flange_nut_m8_stainless_steel': "אום פלאנצ' M8",
    'torx_sharp_screw_for_wood_roof_7_5cm_3': 'בורג שפיץ עם אטם 7.5סמ',
    'torx_sharp_screw_for_wood_roof_10cm': 'בורג טורקס שפיץ לגג עץ 10סמ',
    'torx_sharp_screw_for_wood_roof_12_5cm_5': 'בורג טורקס שפיץ לגג עץ 12סמ',
    'sandwich_panel_accessory_screws_not_included': 'אביזר סנטף (לא כולל ברגים)',
    'circuit_breaker_100a': 'Circuit Breaker 100A',
    'collection_panel_for_two_50kw_inverters_incl_depreciation_relay': 'לוח איסוף לשני ממירי 50 כולל ממסר פחת',
    'angle_connector_10cm': "מחבר זווית 10 ס'מ",
    'single_arrow_anchor_bolt': 'בורג עוגן חץ',
    'm12_nut_for_arrow_anchor': 'אום M12 לעוגן חץ',
    'm12_washer_for_arrow_anchor': 'דסקית M12 לעוגן חץ',
    'self_drilling_screw_3_5_drill_1_4_1_4_1_with_seal': 'בורג איסכורית קודח 3.5 (עם אטם)',
    'self_drilling_screw_7_5_drill_1_4_1_4_1_with_seal': 'בורג איסכורית קודח 7.5 ( עם אטם)',
    'self_drilling_screw_12_5_5_drill_with_seal': 'בורג איסכורית 12.5 ( 5צול קודח עם אטם)',
    'epdm': 'גומי EPDM 40*40',
    'hooks': 'הוק 5.5 ס"מ',
    'hook_5cm_with_3_holes_gallery': 'הוק 5 ס"מ עם 3 חורים (גלריה)',
    'connection_angle_10cm_for_base': 'זוית חיבור 10 ס"מ לבסיס',
    'end_grounding_panel_clamp_rapid': 'מהדק פאנל קצה הארקה Rapid',
    'mid_grounding_panel_clamp_without_screw': 'מהדק פאנל אמצע הארקה ללא בורג',
    'end_grounding_panel_clamp_without_screw': 'מהדק פאנל קצה הארקה ללא בורג',
    'cable_6mm_red': 'כבל 6 ממ אדום',
    'cable_6mm_black': 'כבל 6 ממ שחור',
    'bare_copper_16mm': 'נחושת חשופה 16 ממ',
    'junction_box_2_strings': 'ארון איסוף 2 סטרינגים',
    'ac_panel_25a': 'ארון AC 25A',
    'ac_panel_40a': 'ארון AC 40A',
    'distribution_board_7_holes': 'ארון פה"פ 7 חורים',
    'circuit_breaker_4x25a': 'מפסק 4X25A',
    'circuit_breaker_4x40a': 'מפסק 4X40A',
    'panel_cable_extensions': 'מאריכי כבל לפאנל',
    'rails': '--- קושרות ---',
    'trapezoidal_purlins': '--- טרפזים ---',
    'diagonals': '--- דיאגונלים ---',
    'hardware': '--- אביזרי עזר ---',
    'washer_m10': 'דיסקית (M10)',
    'panel_cable_clip_for_rail': 'תפסן כבל לקושרת',
    'sandwich_roof_accessory': 'אומגות',
    'klazip_kit': 'קיט קלזיפ',
    'self_drilling_screw_6cm_with_seal': 'איסכורית קודח 6סמ עם אטם',
    'self_drilling_screw_5cm_with_seal': 'איסכורית קודח 5סמ עם אטם',
    'sharp_screw_3_5cm': 'בורג שפיץ עם אטם 3.5סמ',
    'sharp_screw_7_5cm': 'בורג שפיץ עם אטם 12.5סמ',
    'depreciation_waste': 'פחת',
    'self_drilling_screw_3_5_without_seal': 'בורג איסכורית 3.5 ( ללא אטם)',
    'self_drilling_screw_2_with_seal': 'בורג איסכורית קודח 2 צול עם אטם',
    'flexible_conduit_30m_bundle_diameter_18mm_pg16': 'צינור שרשורי 30מ בחבילה קוטר 18ממ PG16',
    'flexible_conduit_21': 'צינור שרשורי 21',
    'connectors': 'קונקטורים',
    'electrical_cable_4x10': 'כבל חשמל 4X10',
    'meter_panel_25a': 'ארון מונה 25A',
    'distribution_board_11_holes': 'ארון פה"פ 11 חורים',
    'bare_copper_25mm': 'נחושת חשופה 25 ממ',
    'yellow_green_copper_16mm': 'נחושת צהוב\\ירוק 16 ממ',
    'yellow_green_copper_25mm': 'נחושת צהוב\\ירוק 25 ממ',
    'yellow_green_copper_35mm': 'נחושת צהוב\\ירוק 35 ממ',
    'roof_connection_accessory_l': 'אביזר חיבור לגג (L)',
    'arrow_anchor_bolt_kit': 'קיט בורג עוגן חץ',
    'meter_box_25a': 'Meter Box 25A ארון מונה',
    'disconnect_panel_before_after_production_meter': 'לוח מנתק לפני/אחרי מונה ייצור',
    'breaker_4_200_ampere': 'ברייקר 4*200 אמפר',
    'collection_panel_for_70kw_inverter_incl_depreciation': 'לוח איסוף לממיר 70 כולל פחת',
}


def upgrade() -> None:
    # Product Hebrew name
    op.add_column('products', sa.Column('name_he', sa.String(255), nullable=True))

    # Populate Hebrew names
    for type_key, name_he in HEBREW_NAMES.items():
        escaped = name_he.replace("'", "''")
        op.execute(f"UPDATE products SET name_he = '{escaped}' WHERE type_key = '{type_key}'")

    # User language preference
    op.add_column('users', sa.Column('lang', sa.String(5), nullable=False, server_default='en'))


def downgrade() -> None:
    op.drop_column('users', 'lang')
    op.drop_column('products', 'name_he')
