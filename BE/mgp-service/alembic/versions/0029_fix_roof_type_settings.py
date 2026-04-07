"""fix roof type settings: visibility, highlight groups, scope

Revision ID: 0029
Revises: 0028
Create Date: 2026-04-07

- Hide: diagSkipBelowCm, diagDoubleAboveCm, crossRailEdgeDistMm, stockLengths, angleProfileSizeMm
- purlinBufferCm: highlight_group='extension'
- punchOverlapMarginCm, punchInnerOffsetCm: highlight_group='punches'
- extendFront, extendRear: scope area + highlight_group='extension'
"""
from typing import Sequence, Union
from alembic import op

revision: str = "0029"
down_revision: Union[str, None] = "0028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Hide params (admin only)
    op.execute(
        """
        UPDATE app_settings SET visible = false
        WHERE key IN (
            'diagSkipBelowCm', 'diagDoubleAboveCm',
            'crossRailEdgeDistMm', 'stockLengths', 'angleProfileSizeMm',
            'punchOverlapMarginCm', 'punchInnerOffsetCm'
        )
        """
    )

    # Highlight groups
    op.execute(
        """
        UPDATE app_settings SET highlight_group = 'extension'
        WHERE key IN ('purlinBufferCm', 'extendFront', 'extendRear')
        """
    )
    op.execute(
        """
        UPDATE app_settings SET highlight_group = 'punches'
        WHERE key IN ('punchOverlapMarginCm', 'punchInnerOffsetCm')
        """
    )

    # Highlight groups for bases params
    op.execute(
        """
        UPDATE app_settings SET highlight_group = 'base-overhang'
        WHERE key = 'baseOverhangCm'
        """
    )
    op.execute(
        """
        UPDATE app_settings SET highlight_group = 'base-edges'
        WHERE key = 'edgeOffsetMm'
        """
    )
    op.execute(
        """
        UPDATE app_settings SET highlight_group = 'base-spacing'
        WHERE key = 'spacingMm'
        """
    )

    # extendFront/extendRear stay as trapezoid scope (per-trap extension control)

    # Roof types: bases/trapezoid params not relevant for tiles
    op.execute(
        """
        UPDATE app_settings
        SET roof_types = '["concrete", "iskurit", "insulated_panel"]'::jsonb
        WHERE key IN (
            'baseOverhangCm', 'edgeOffsetMm', 'spacingMm',
            'angleProfileSizeMm', 'punchOverlapMarginCm', 'punchInnerOffsetCm'
        )
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE app_settings SET visible = true
        WHERE key IN (
            'diagSkipBelowCm', 'diagDoubleAboveCm',
            'crossRailEdgeDistMm', 'stockLengths', 'angleProfileSizeMm',
            'punchOverlapMarginCm', 'punchInnerOffsetCm'
        )
        """
    )
    op.execute(
        """
        UPDATE app_settings SET highlight_group = NULL
        WHERE key IN ('purlinBufferCm', 'extendFront', 'extendRear')
        """
    )
    op.execute(
        """
        UPDATE app_settings SET highlight_group = NULL
        WHERE key IN ('punchOverlapMarginCm', 'punchInnerOffsetCm')
        """
    )
    op.execute(
        """
        UPDATE app_settings SET highlight_group = NULL
        WHERE key IN ('baseOverhangCm', 'edgeOffsetMm', 'spacingMm')
        """
    )
    op.execute(
        """
        UPDATE app_settings SET roof_types = NULL
        WHERE key IN (
            'baseOverhangCm', 'edgeOffsetMm', 'spacingMm',
            'angleProfileSizeMm', 'punchOverlapMarginCm', 'punchInnerOffsetCm'
        )
        """
    )

