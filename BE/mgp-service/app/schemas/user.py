import uuid
from datetime import datetime
from pydantic import BaseModel, EmailStr
from app.models.user import UserRole


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    phone_number: str | None = None


class UserRead(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    phone_number: str | None
    role: UserRole
    is_active: bool
    is_verified: bool
    is_sysadmin: bool
    lang: str = 'en'
    created_at: datetime
    # Credits snapshot. `available` is the live wallet balance (lifetime).
    # `used` and `total` are CALENDAR-YEAR windowed — only count
    # project_charge rows from Jan 1 of the current year. `total =
    # available + used` and drifts down as old charges age out each Jan 1.
    # `plans_this_year` counts every project_charge in the year (refunds
    # included); `discount_eligible` flips true once that count crosses
    # the admin-tunable threshold (volumeDiscountThresholdPlans).
    # All default to 0/false so endpoints that don't compute the snapshot
    # (admin listings, etc.) still serialize cleanly.
    credits_available: int = 0
    credits_used: int = 0
    credits_total: int = 0
    plans_this_year: int = 0
    discount_eligible: bool = False
    # Configured threshold (admin-tunable via app_settings). Exposed so the
    # FE can render a progress indicator before the user hits eligibility.
    discount_threshold: int = 0
    period_year: int = 0

    model_config = {"from_attributes": True}


class AdminGrantCreditsRequest(BaseModel):
    amount: int
    reason: str


class AdminRefundProjectRequest(BaseModel):
    reason: str


class AdminDismissRefundInboxRequest(BaseModel):
    reason: str | None = None
    undo: bool = False


class UserListResponse(BaseModel):
    """Paginated response for GET /admin/users — mirrors ProjectListResponse /
    LedgerResponse shape so the FE pagination pattern is identical across lists.
    """
    rows: list[UserRead]
    total_rows: int
    has_more: bool


class UserUpdate(BaseModel):
    full_name: str | None = None
    is_active: bool | None = None
    role: UserRole | None = None


class UserProfileUpdate(BaseModel):
    full_name: str | None = None
    phone_number: str | None = None
    lang: str | None = None
