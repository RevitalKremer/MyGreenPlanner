"""products.sadot_url: String -> JSONB { he, en }

Holds per-locale Sadot Energy product links. Any existing plain-string URL is
migrated to {"en": <url>}.

Revision ID: 0066
Revises: 0065
Create Date: 2026-06-23

"""
from typing import Sequence, Union
from alembic import op

revision: str = "0066"
down_revision: Union[str, None] = "0065"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE products "
        "ALTER COLUMN sadot_url TYPE JSONB "
        "USING (CASE WHEN sadot_url IS NULL THEN NULL "
        "ELSE jsonb_build_object('en', sadot_url) END)"
    )


def downgrade() -> None:
    # Collapse back to a single string (prefer en, then he).
    op.execute(
        "ALTER TABLE products "
        "ALTER COLUMN sadot_url TYPE VARCHAR(500) "
        "USING COALESCE(sadot_url->>'en', sadot_url->>'he')"
    )
