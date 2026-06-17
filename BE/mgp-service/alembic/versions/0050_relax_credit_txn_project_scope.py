"""Relax the project-scope CHECK on credit_transactions so deleted projects
don't block their `project_charge` / `admin_refund` rows from being nulled out.

Revision ID: 0050
Revises: 0049
Create Date: 2026-06-15

The original CHECK from 0049 required `project_id IS NOT NULL` for kind in
('project_charge','admin_refund'). The matching FK is `ON DELETE SET NULL`,
so deleting a project tries to null those rows and Postgres refuses
(check_violation). Result: any DELETE /projects/{id} on a charged project
returns a 500.

User-facing expectation (per the credits plan): deleting a project succeeds
and the ledger entry is preserved as the historical record. The user has
been charged; the project is gone; the ledger row stays — its project link
is dropped, but the user, amount, kind, refunded flag, and timestamps all
remain intact for audit and balance accounting.

We relax the constraint so:
  * `project_charge` / `admin_refund` MAY have project_id NULL (after
    cascade-detach) but the application code still sets it on insert.
  * `trial` / `admin_grant` MUST have project_id NULL (user-scope only).
  * `purchase` is unconstrained either way.
"""
from alembic import op


revision = '0050'
down_revision = '0049'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint('ck_credit_txn_project_scope', 'credit_transactions', type_='check')
    op.create_check_constraint(
        'ck_credit_txn_project_scope',
        'credit_transactions',
        # Project-tied kinds allow either project_id set (at insert) OR null
        # (post-project-deletion). User-scope kinds must have null. Purchase
        # is unconstrained.
        "kind IN ('project_charge','admin_refund')"
        " OR (kind IN ('trial','admin_grant') AND project_id IS NULL)"
        " OR (kind = 'purchase')",
    )


def downgrade() -> None:
    op.drop_constraint('ck_credit_txn_project_scope', 'credit_transactions', type_='check')
    op.create_check_constraint(
        'ck_credit_txn_project_scope',
        'credit_transactions',
        "(kind IN ('project_charge','admin_refund') AND project_id IS NOT NULL)"
        " OR (kind IN ('trial','admin_grant') AND project_id IS NULL)"
        " OR (kind = 'purchase')",
    )
