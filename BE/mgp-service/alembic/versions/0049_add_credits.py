"""Add credits management — user balance, project charge/quotation/dismiss markers,
the credit_transactions ledger, and monetization app_settings rows.

Revision ID: 0049
Revises: 0048
Create Date: 2026-06-14

Seeds two monetization keys (`projectCostCredits`=100, `trialGrantCredits`=500).
Backfills 500 credits to every already-verified user via a matching `trial`
ledger row so existing accounts start with the same balance new ones will get
via the verify-email hook.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = '0049'
down_revision = '0048'
branch_labels = None
depends_on = None


# Initial trial-grant amount used both for the backfill below and seeded into
# app_settings so admins can adjust the live rate after deployment.
TRIAL_GRANT_DEFAULT = 500
PROJECT_COST_DEFAULT = 100


def upgrade() -> None:
    # ── User balance column ────────────────────────────────────────────────
    op.add_column(
        'users',
        sa.Column('credits_balance', sa.Integer, nullable=False, server_default='0'),
    )

    # ── Project credit markers ─────────────────────────────────────────────
    op.add_column('projects', sa.Column('credits_charged_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('projects', sa.Column('quotation_requested_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('projects', sa.Column('refund_inbox_dismissed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        'projects',
        sa.Column('refund_inbox_dismissed_by_id', UUID(as_uuid=True),
                  sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
    )
    op.add_column('projects', sa.Column('refund_inbox_dismissed_reason', sa.Text, nullable=True))

    # ── credit_transactions ledger ─────────────────────────────────────────
    # Enum type is created automatically by create_table below (default
    # behaviour). Don't call .create() separately — that emits a duplicate.
    kind_col_type = sa.Enum(
        'trial', 'admin_grant', 'admin_refund', 'purchase', 'project_charge',
        name='credit_txn_kind',
    )

    op.create_table(
        'credit_transactions',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('project_id', UUID(as_uuid=True), sa.ForeignKey('projects.id', ondelete='SET NULL'), nullable=True),
        sa.Column('amount', sa.Integer, nullable=False),
        sa.Column('kind', kind_col_type, nullable=False),
        sa.Column('reason', sa.Text, nullable=True),
        sa.Column('created_by', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('refunded', sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column('refunded_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('refunded_by_id', UUID(as_uuid=True),
                  sa.ForeignKey('credit_transactions.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),

        # project-tied vs user-scope split — enforced at the DB layer
        sa.CheckConstraint(
            "(kind IN ('project_charge','admin_refund') AND project_id IS NOT NULL)"
            " OR (kind IN ('trial','admin_grant') AND project_id IS NULL)"
            " OR (kind = 'purchase')",
            name='ck_credit_txn_project_scope',
        ),
        # admin actions always carry a reason
        sa.CheckConstraint(
            "(kind NOT IN ('admin_grant','admin_refund')) OR (reason IS NOT NULL)",
            name='ck_credit_txn_admin_reason_required',
        ),
        # sign matches kind
        sa.CheckConstraint(
            "(kind = 'project_charge' AND amount < 0) OR (kind != 'project_charge' AND amount > 0)",
            name='ck_credit_txn_amount_sign',
        ),
    )
    op.create_index('ix_credit_txn_user_created', 'credit_transactions', ['user_id', sa.text('created_at DESC')])
    op.create_index('ix_credit_txn_project', 'credit_transactions', ['project_id'])
    # Partial index — makes the pending-refunds inbox query cheap.
    op.execute(
        "CREATE INDEX ix_credit_txn_open_charges "
        "ON credit_transactions (project_id) "
        "WHERE kind = 'project_charge' AND NOT refunded"
    )

    # ── Seed monetization app_settings rows ────────────────────────────────
    # Mirrors the INSERT-ON-CONFLICT pattern of 0045_add_long_rail_settings.
    # visible=true so the new MonetizationTab can render them.
    op.execute(
        f"""
        INSERT INTO app_settings
        (key, value_json, label, section, scope, param_type, min_val, max_val, step_val,
         highlight_group, visible, updated_at)
        VALUES
        ('projectCostCredits',  '{PROJECT_COST_DEFAULT}', 'Project cost (credits)',
          'monetization', 'global', 'number',     0.0,  10000.0,    1.0,  NULL, true, NOW()),
        ('trialGrantCredits',   '{TRIAL_GRANT_DEFAULT}',  'Trial credits on email verification',
          'monetization', 'global', 'number',     0.0,  100000.0,  10.0,  NULL, true, NOW())
        ON CONFLICT (key) DO NOTHING
        """
    )

    # ── Backfill: 500 credits to every already-verified user ──────────────
    # Idempotent — only fires for users without an existing 'trial' ledger row.
    # We don't read from settings_cache (not loaded during migrations); the
    # seeded default above is the source of truth for the backfill amount.
    op.execute(
        f"""
        INSERT INTO credit_transactions
            (id, user_id, project_id, amount, kind, reason, created_by,
             refunded, refunded_at, refunded_by_id, created_at)
        SELECT gen_random_uuid(), u.id, NULL, {TRIAL_GRANT_DEFAULT}, 'trial',
               'Backfill of trial grant for existing verified users.',
               NULL, FALSE, NULL, NULL, NOW()
          FROM users u
         WHERE u.is_verified = TRUE
           AND NOT EXISTS (
               SELECT 1 FROM credit_transactions ct
                WHERE ct.user_id = u.id AND ct.kind = 'trial'
           )
        """
    )
    op.execute(
        f"""
        UPDATE users u
           SET credits_balance = u.credits_balance + {TRIAL_GRANT_DEFAULT}
         WHERE u.is_verified = TRUE
           AND EXISTS (
               SELECT 1 FROM credit_transactions ct
                WHERE ct.user_id = u.id
                  AND ct.kind = 'trial'
                  AND ct.reason = 'Backfill of trial grant for existing verified users.'
                  AND ct.created_at > NOW() - INTERVAL '1 minute'
           )
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM app_settings WHERE key IN ('projectCostCredits', 'trialGrantCredits')")
    op.drop_index('ix_credit_txn_open_charges', table_name='credit_transactions')
    op.drop_index('ix_credit_txn_project', table_name='credit_transactions')
    op.drop_index('ix_credit_txn_user_created', table_name='credit_transactions')
    op.drop_table('credit_transactions')
    op.execute("DROP TYPE IF EXISTS credit_txn_kind")

    op.drop_column('projects', 'refund_inbox_dismissed_reason')
    op.drop_column('projects', 'refund_inbox_dismissed_by_id')
    op.drop_column('projects', 'refund_inbox_dismissed_at')
    op.drop_column('projects', 'quotation_requested_at')
    op.drop_column('projects', 'credits_charged_at')

    op.drop_column('users', 'credits_balance')
