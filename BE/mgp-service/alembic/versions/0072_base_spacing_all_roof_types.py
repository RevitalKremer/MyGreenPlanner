"""Open Base Spacing (spacingMm) to all roof types.

Previously spacingMm was gated to framed roofs only
(roof_types = ["concrete", "iskurit", "insulated_panel"], set in 0029).
Frameless roofs (tiles, flat_installation) generate virtual base lines whose
rail intersections place the omegas / hooks, so base spacing is meaningful
there too — it controls the distance between those anchor lines.

Setting roof_types = NULL makes the param apply to ALL roof types (the FE
treats NULL as "every roof type" — see useAppConfig.paramSchemaForRoof).

Revision ID: 0072
Revises: 0071
Create Date: 2026-06-27

"""
from typing import Sequence, Union
from alembic import op

revision: str = "0072"
down_revision: Union[str, None] = "0071"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Open to all roof types + relabel: the param now covers framed bases AND
    # frameless omega/hook anchor lines. (FE shows the i18n string first; the
    # DB label is the admin-panel / fallback copy.)
    op.execute(
        """
        UPDATE app_settings
        SET roof_types = NULL,
            label = 'Base / Anchor Spacing (mm)'
        WHERE key = 'spacingMm'
        """
    )


def downgrade() -> None:
    # Restore the framed-only gating set in 0029 and the original label.
    op.execute(
        """
        UPDATE app_settings
        SET roof_types = '["concrete", "iskurit", "insulated_panel"]'::jsonb,
            label = 'Base Spacing (mm)'
        WHERE key = 'spacingMm'
        """
    )
