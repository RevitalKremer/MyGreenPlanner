"""add highlight_group column to app_settings

Revision ID: 0014
Revises: 0013
Create Date: 2026-03-30

Adds highlight_group to app_settings for FE diagram highlight zones.
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

HIGHLIGHTS = {
    'railSpacingV':        'railSpacingV',
    'railSpacingH':        'railSpacingH',
    'railOverhangCm':      'rail-ends',
    'crossRailEdgeDistMm': 'cross-rails',
    'stockLengths':        'rail-cuts',
    'edgeOffsetMm':        'base-edges',
    'spacingMm':           'base-spacing',
    'baseOverhangCm':      'base-overhang',
    'blockHeightCm':       'blocks',
    'blockLengthCm':       'blocks',
    'blockWidthCm':        'blocks',
    'blockPunchCm':        'blocks',
    'diagTopPct':          'diagonal',
    'diagBasePct':         'diagonal',
}


def upgrade() -> None:
    op.add_column('app_settings', sa.Column('highlight_group', sa.String(50), nullable=True))
    for key, group in HIGHLIGHTS.items():
        op.execute(
            f"UPDATE app_settings SET highlight_group = '{group}' WHERE key = '{key}'"
        )


def downgrade() -> None:
    op.drop_column('app_settings', 'highlight_group')
