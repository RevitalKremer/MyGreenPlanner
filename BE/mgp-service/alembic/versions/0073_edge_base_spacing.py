"""Add bases params: Edge Base / Anchor Spacing (edgeSpacingMm) and External
Diagonal Min Leg Height (extDiagMinHeightCm).

Constructors often place the OUTERMOST base at each row end a different
distance from its neighbour than the regular interior spacing — usually tighter
(edges carry more wind load), occasionally looser. ``edgeSpacingMm`` sets that
outermost span at BOTH the start and end of every row; ``spacingMm`` keeps
governing the interior fill.

Default 1300mm. The relationship to ``spacingMm`` is the planner's choice and is
NOT enforced — edgeSpacingMm may be smaller OR larger than spacingMm. Existing
projects that predate this setting carry no value and are unaffected (the
compute pipeline falls back to None → pure even spacing, unchanged layout).

Trapezoid-scoped (area-fallback on frameless roofs, exactly like spacingMm),
all roof types (roof_types = NULL), reuses the 'base-spacing' highlight group.
Independent of spacingMm — no cross-clamp.

Revision ID: 0073
Revises: 0072
Create Date: 2026-06-29

"""
from typing import Sequence, Union
from alembic import op

revision: str = "0073"
down_revision: Union[str, None] = "0072"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Sits alphabetically right before 'spacingMm' in the bases section (the
    # FE orders the schema by (section, key)). ON CONFLICT keeps the migration
    # idempotent / re-runnable.
    op.execute(
        """
        INSERT INTO app_settings
            (key, value_json, label, section, scope, param_type,
             min_val, max_val, step_val, highlight_group, visible, roof_types,
             updated_at)
        VALUES
            ('edgeSpacingMm', '1500'::jsonb, 'Edge Base / Anchor Spacing (mm)',
             'bases', 'trapezoid', 'number',
             100.0, 5000.0, 50.0, 'base-spacing', true, NULL,
             NOW())
        ON CONFLICT (key) DO NOTHING
        """
    )

    # Min leg height (cm) below which NO external diagonal is placed — low legs
    # don't warrant external bracing. Global, user-facing, bases section, framed
    # roof types only (tiles / flat_installation are frameless → no externals).
    op.execute(
        """
        INSERT INTO app_settings
            (key, value_json, label, section, scope, param_type,
             min_val, max_val, step_val, highlight_group, visible, roof_types,
             updated_at)
        VALUES
            ('extDiagMinHeightCm', '30'::jsonb, 'External Diagonal Min Leg Height (cm)',
             'bases', 'global', 'number',
             0.0, 100.0, 1.0, NULL, true,
             '["concrete", "iskurit", "insulated_panel"]'::jsonb,
             NOW())
        ON CONFLICT (key) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM app_settings WHERE key IN ('edgeSpacingMm', 'extDiagMinHeightCm')")
