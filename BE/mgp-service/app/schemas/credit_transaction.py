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
    credits_available: int
    credits_used: int
    credits_total: int


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
