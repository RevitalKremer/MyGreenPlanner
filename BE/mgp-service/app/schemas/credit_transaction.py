import uuid
from datetime import datetime
from pydantic import BaseModel
from app.models.credit_transaction import CreditTxnKind


class CreditTransactionRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    project_id: uuid.UUID | None
    amount: int
    kind: CreditTxnKind
    reason: str | None
    created_by: uuid.UUID | None
    refunded: bool
    refunded_at: datetime | None
    refunded_by_id: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class LedgerResponse(BaseModel):
    rows: list[CreditTransactionRead]
    total_rows: int
    has_more: bool
    # Snapshot fields mirror UserRead (calendar-year windowed). See
    # services/credits.compute_account_snapshot for the full semantics.
    credits_available: int
    credits_used: int
    credits_total: int
    plans_this_year: int = 0
    discount_eligible: bool = False
    discount_threshold: int = 0
    period_year: int = 0


class GlobalLedgerRow(CreditTransactionRead):
    # Cross-user ledger view needs to show WHO and WHICH project, resolved via
    # joins (the per-user view doesn't, since the user is fixed).
    user_email: str | None = None
    project_name: str | None = None


class LedgerKindTotal(BaseModel):
    kind: CreditTxnKind
    count: int
    total: int  # sum(amount) over the filtered set for this kind


class GlobalLedgerResponse(BaseModel):
    rows: list[GlobalLedgerRow]
    total_rows: int
    has_more: bool
    # Per-kind aggregates over the FILTERED set (ignores pagination) — powers
    # the summary header (e.g. total granted / refunded for the current filter).
    totals: list[LedgerKindTotal]


class PendingRefundRow(BaseModel):
    project_id: uuid.UUID
    project_name: str
    owner_id: uuid.UUID
    owner_email: str
    quotation_requested_at: datetime
    charged_at: datetime
    charge_amount: int   # the positive number of credits to refund (= absolute value of the open project_charge)


class PendingRefundsResponse(BaseModel):
    rows: list[PendingRefundRow]
    total_rows: int
    has_more: bool
