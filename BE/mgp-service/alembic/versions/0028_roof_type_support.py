"""add roof type support: settings, roof_types column, product activation

Revision ID: 0028
Revises: 0027
Create Date: 2026-04-07

Adds:
- roof_types JSONB column on app_settings (nullable, null = all roof types)
- Populates roof_types for all existing settings
- New settings: purlinBufferCm, extendFront, extendRear
- Activates products for purlin/tile mounting and sets alt_groups
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0028"
down_revision: Union[str, None] = "0027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. Add roof_types column to app_settings ──────────────────────────
    op.add_column(
        'app_settings',
        sa.Column('roof_types', JSONB, nullable=True),
    )

    # ── 2. Populate roof_types for existing settings ──────────────────────
    # Block settings: concrete only
    op.execute(
        """
        UPDATE app_settings
        SET roof_types = '["concrete"]'::jsonb
        WHERE key IN ('blockHeightCm', 'blockLengthCm', 'blockWidthCm', 'blockPunchCm', 'reverseBlockPunches')
        """
    )

    # Diagonal settings: concrete + iskurit + insulated_panel (not tiles)
    op.execute(
        """
        UPDATE app_settings
        SET roof_types = '["concrete", "iskurit", "insulated_panel"]'::jsonb
        WHERE key IN ('diagTopPct', 'diagBasePct', 'diagSkipBelowCm', 'diagDoubleAboveCm')
        """
    )

    # All other existing settings: null (all roof types) — already null by default

    # ── 3. New admin settings for purlin-mounted roofs ────────────────────
    op.execute(
        """
        INSERT INTO app_settings
        (key, value_json, label, section, scope, param_type, min_val, max_val, step_val, highlight_group, visible, roof_types, updated_at)
        VALUES
        ('purlinBufferCm', '5', 'Purlin Buffer (cm)', 'detail', 'global', 'number', 0, 30, 1, NULL, true, '["iskurit", "insulated_panel"]'::jsonb, NOW()),
        ('extendFront', 'true', 'Extend Base Beam Front', 'detail', 'trapezoid', 'boolean', NULL, NULL, NULL, NULL, true, '["iskurit", "insulated_panel"]'::jsonb, NOW()),
        ('extendRear', 'true', 'Extend Base Beam Rear', 'detail', 'trapezoid', 'boolean', NULL, NULL, NULL, NULL, true, '["iskurit", "insulated_panel"]'::jsonb, NOW())
        ON CONFLICT (key) DO NOTHING
        """
    )

    # ── 4. Activate products for purlin/tile mounting ─────────────────────
    # Iskurit screws
    op.execute(
        """
        UPDATE products SET active = true
        WHERE type_key = 'self_drilling_screw_7_5_drill_1_4_1_4_1_with_seal'
        """
    )

    # Insulated panel screws
    op.execute(
        """
        UPDATE products SET active = true
        WHERE type_key = 'self_drilling_screw_12_5_5_drill_with_seal'
        """
    )

    # Tile hooks: activate + set alt_group 2 (group 1 = jumbo/single_arrow)
    op.execute(
        """
        UPDATE products
        SET active = true, alt_group = 2, is_default = true
        WHERE type_key = 'hooks'
        """
    )
    op.execute(
        """
        UPDATE products
        SET active = true, alt_group = 2, is_default = false
        WHERE type_key = 'hook_5cm_with_3_holes_gallery'
        """
    )

    # Torx screws for tile hooks
    op.execute(
        """
        UPDATE products SET active = true
        WHERE type_key = 'torx_sharp_screw_for_wood_roof_7_5cm_3'
        """
    )


def downgrade() -> None:
    # Remove new settings
    op.execute(
        """
        DELETE FROM app_settings
        WHERE key IN ('purlinBufferCm', 'extendFront', 'extendRear')
        """
    )

    # Clear roof_types from all settings
    op.execute(
        """
        UPDATE app_settings SET roof_types = NULL
        """
    )

    # Drop roof_types column
    op.drop_column('app_settings', 'roof_types')

    # Deactivate products and clear alt_groups
    op.execute(
        """
        UPDATE products
        SET active = false, alt_group = NULL, is_default = false
        WHERE type_key IN (
            'self_drilling_screw_7_5_drill_1_4_1_4_1_with_seal',
            'self_drilling_screw_12_5_5_drill_with_seal',
            'hooks',
            'hook_5cm_with_3_holes_gallery',
            'torx_sharp_screw_for_wood_roof_7_5cm_3'
        )
        """
    )
