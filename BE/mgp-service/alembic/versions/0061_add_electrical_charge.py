"""add electrical (string-plan) non-refundable charge

Adds:
  * projects.electrical_charged_at marker (first 6→7 transition)
  * credit_txn_kind enum value 'electrical_charge'
  * widened CHECK constraints so an electrical_charge row (project-tied,
    negative amount) is valid
  * electricalCostCredits app_setting (default 200), shown in MonetizationTab

Revision ID: 0061
Revises: 0060
Create Date: 2026-06-22

"""
from typing import Sequence, Union
from alembic import op

revision: str = "0061"
down_revision: Union[str, None] = "0060"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ELECTRICAL_COST_DEFAULT = 200


def upgrade() -> None:
    # Project marker. Idempotent: the autocommit_block below commits this column
    # before the enum change, so a failed re-run can find it already present.
    op.execute(
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS electrical_charged_at TIMESTAMP WITH TIME ZONE"
    )

    # New enum value — must commit before it can be referenced below.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE credit_txn_kind ADD VALUE IF NOT EXISTS 'electrical_charge'")

    # Widen the project-scope + amount-sign checks to cover electrical_charge
    # (project-tied, negative amount — same shape as project_charge).
    op.drop_constraint("ck_credit_txn_project_scope", "credit_transactions", type_="check")
    op.create_check_constraint(
        "ck_credit_txn_project_scope",
        "credit_transactions",
        # Keep 0050's relaxation: project-tied kinds MAY have project_id NULL
        # (after ON DELETE SET NULL detaches a deleted project's ledger row).
        "kind IN ('project_charge','admin_refund','electrical_charge')"
        " OR (kind IN ('trial','admin_grant') AND project_id IS NULL)"
        " OR (kind = 'purchase')",
    )
    op.drop_constraint("ck_credit_txn_amount_sign", "credit_transactions", type_="check")
    op.create_check_constraint(
        "ck_credit_txn_amount_sign",
        "credit_transactions",
        "(kind IN ('project_charge','electrical_charge') AND amount < 0)"
        " OR (kind NOT IN ('project_charge','electrical_charge') AND amount > 0)",
    )

    # Seed monetization setting (mirrors projectCostCredits in 0049).
    op.execute(
        f"""
        INSERT INTO app_settings
        (key, value_json, label, section, scope, param_type, min_val, max_val, step_val,
         highlight_group, visible, updated_at)
        VALUES
        ('electricalCostCredits', '{ELECTRICAL_COST_DEFAULT}', 'Electrical unlock cost (credits, non-refundable)',
          'monetization', 'global', 'number', 0.0, 10000.0, 1.0, NULL, true, NOW())
        ON CONFLICT (key) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM app_settings WHERE key = 'electricalCostCredits'")

    op.drop_constraint("ck_credit_txn_amount_sign", "credit_transactions", type_="check")
    op.create_check_constraint(
        "ck_credit_txn_amount_sign",
        "credit_transactions",
        "(kind = 'project_charge' AND amount < 0) OR (kind != 'project_charge' AND amount > 0)",
    )
    op.drop_constraint("ck_credit_txn_project_scope", "credit_transactions", type_="check")
    op.create_check_constraint(
        "ck_credit_txn_project_scope",
        "credit_transactions",
        # Restore 0050's relaxed form (NOT the pre-0050 strict one).
        "kind IN ('project_charge','admin_refund')"
        " OR (kind IN ('trial','admin_grant') AND project_id IS NULL)"
        " OR (kind = 'purchase')",
    )

    op.drop_column("projects", "electrical_charged_at")
    # Note: the 'electrical_charge' enum value is left in place — PostgreSQL
    # cannot drop a single enum value without recreating the type.
