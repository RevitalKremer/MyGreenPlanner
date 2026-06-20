"""Add angleProfileStockLengths setting.

Revision ID: 0056
Revises: 0055
Create Date: 2026-06-20

Available material cut lengths (mm) for the angle profile, analogous to the
rails `stockLengths`. Used to split a base slope longer than the largest cut
into multiple pieces. Admin-only (visible=false) like `stockLengths`; editable
as a comma-separated array on the admin Settings page under the "bases" section.
"""
from alembic import op


revision = '0056'
down_revision = '0055'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO app_settings
        (key, value_json, label, section, scope, param_type, min_val, max_val, step_val,
         visible, updated_at)
        VALUES
        ('angleProfileStockLengths', '[3900, 6000]', 'Angle Profile Stock Lengths (mm)',
         'bases', 'global', 'array', NULL, NULL, NULL, false, NOW())
        ON CONFLICT (key) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM app_settings WHERE key = 'angleProfileStockLengths'")
