"""index credit_transactions major columns

Adds btree indexes on the credit_transactions columns the admin ledger views
filter, sort and join on. user_id and project_id are already indexed (declared
on the model), so this covers the remaining major columns: created_at (sort +
date-range), kind (op-type filter), created_by, and refunded.

Revision ID: 0059
Revises: 0058
Create Date: 2026-06-21

"""
from typing import Sequence, Union
from alembic import op

revision: str = "0059"
down_revision: Union[str, None] = "0058"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(op.f("ix_credit_transactions_created_at"), "credit_transactions", ["created_at"])
    op.create_index(op.f("ix_credit_transactions_kind"), "credit_transactions", ["kind"])
    op.create_index(op.f("ix_credit_transactions_created_by"), "credit_transactions", ["created_by"])
    op.create_index(op.f("ix_credit_transactions_refunded"), "credit_transactions", ["refunded"])


def downgrade() -> None:
    op.drop_index(op.f("ix_credit_transactions_refunded"), table_name="credit_transactions")
    op.drop_index(op.f("ix_credit_transactions_created_by"), table_name="credit_transactions")
    op.drop_index(op.f("ix_credit_transactions_kind"), table_name="credit_transactions")
    op.drop_index(op.f("ix_credit_transactions_created_at"), table_name="credit_transactions")
