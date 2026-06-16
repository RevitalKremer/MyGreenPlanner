"""Seed monetization settings for the volume-discount tier.

Revision ID: 0051
Revises: 0050
Create Date: 2026-06-16

Adds two admin-tunable app_settings rows used by the credits snapshot to
expose a per-user discount-eligibility flag and (eventually) drive the
purchase pricing UI:

  * volumeDiscountThresholdPlans — how many project_charge events a user
    must have in the current calendar year to qualify for the discount.
    Default 25 (per the business rule "מעל 25 תוכניות").
  * volumeDiscountUnitNis — NIS-per-credit price at the discount tier.
    Default 0.75 (= 75 NIS for 100 credits).

The purchase flow isn't shipped yet; these rows let the FE display
"you're eligible for the discount" while we get the UI ready.
"""
from alembic import op


revision = '0051'
down_revision = '0050'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO app_settings
        (key, value_json, label, section, scope, param_type, min_val, max_val, step_val,
         highlight_group, visible, updated_at)
        VALUES
        ('volumeDiscountThresholdPlans', '25', 'Volume discount threshold (plans/year)',
          'monetization', 'global', 'number', 0.0, 1000.0, 1.0, NULL, true, NOW()),
        ('volumeDiscountUnitNis',        '0.75', 'Volume discount price (NIS per credit)',
          'monetization', 'global', 'number', 0.0, 10.0,  0.05, NULL, true, NOW())
        ON CONFLICT (key) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM app_settings WHERE key IN "
        "('volumeDiscountThresholdPlans', 'volumeDiscountUnitNis')"
    )
