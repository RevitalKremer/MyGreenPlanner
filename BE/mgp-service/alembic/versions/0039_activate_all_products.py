"""Activate every product in the catalog.

Several rows were seeded with active=False back in migration 0003 (and
preserved by 0007's upsert), which silently excluded them from the BOM
enrichment loader (`active == True` filter). The result was BOM rows
rendering raw `type_key` values instead of human names whenever the
emitter hit an inactive product. Marking the entire catalog active so
every emitted BOM line item resolves through to its product record.

Revision ID: 0039
Revises: 0038
Create Date: 2026-05-09
"""
from alembic import op
import sqlalchemy as sa


revision = '0039'
down_revision = '0038'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().execute(sa.text("UPDATE products SET active = TRUE WHERE active = FALSE"))


def downgrade() -> None:
    # No-op: we don't have a snapshot of which rows were inactive before
    # this migration, and reverting blindly would deactivate rows that
    # were already toggled on manually via the admin UI.
    pass
