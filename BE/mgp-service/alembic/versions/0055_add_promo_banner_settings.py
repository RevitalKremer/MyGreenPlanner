"""Seed promo-banner app_settings (admin Promotions page).

Revision ID: 0055
Revises: 0054
Create Date: 2026-06-19

A green promo banner shown to all users when set by an admin. Stored as
app_settings rows (section 'promotions', param_type 'text') so the existing
public /settings/defaults endpoint surfaces them to the FE. Empty message =
no banner; CTA button shown only when a URL or email is set.
"""
from alembic import op


revision = '0055'
down_revision = '0054'
branch_labels = None
depends_on = None

_KEYS = [
    ('promoMessageEn',  'Promo message (EN)'),
    ('promoMessageHe',  'Promo message (HE)'),
    ('promoCtaLabelEn', 'Promo CTA label (EN)'),
    ('promoCtaLabelHe', 'Promo CTA label (HE)'),
    ('promoCtaUrl',     'Promo CTA URL'),
    ('promoCtaEmail',   'Promo CTA email'),
    ('promoExpiresAt',  'Promo expiration date'),  # ISO date string; empty = no expiry
]


def upgrade() -> None:
    for key, label in _KEYS:
        op.execute(
            "INSERT INTO app_settings "
            "(key, value_json, label, section, scope, param_type, visible, updated_at) "
            f"VALUES ('{key}', '\"\"', '{label}', 'promotions', 'global', 'text', true, NOW()) "
            "ON CONFLICT (key) DO NOTHING"
        )


def downgrade() -> None:
    keys = ", ".join(f"'{k}'" for k, _ in _KEYS)
    op.execute(f"DELETE FROM app_settings WHERE key IN ({keys})")
