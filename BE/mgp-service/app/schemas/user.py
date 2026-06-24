import uuid
from datetime import datetime
from pydantic import BaseModel, EmailStr, Field, field_validator
from app.models.user import UserRole


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    # Mandatory at registration (the DB column stays nullable for legacy rows
    # and admin-created users). min_length=1 rejects empty/whitespace-only.
    phone_number: str = Field(min_length=1)
    # Mandatory at registration — resolved to a Company (get-or-create) on the BE.
    company_name: str = Field(min_length=1)
    # Consent gate. Must be explicitly true — registration is rejected otherwise.
    # terms_version records which published revision the user agreed to.
    terms_accepted: bool
    terms_version: str | None = None

    @field_validator('terms_accepted')
    @classmethod
    def must_accept_terms(cls, v: bool) -> bool:
        if v is not True:
            raise ValueError('Terms of Use and Privacy Policy must be accepted')
        return v


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
    # Company membership. company_name resolved from the relationship (None for
    # admins/legacy). Surfaced for sharing + admin/marketing views.
    company_id: uuid.UUID | None = None
    company_name: str | None = None
    created_at: datetime
    # Consent record — surfaced for admin proof-of-consent views. None for
    # legacy/admin-created rows predating the consent gate.
    terms_accepted_at: datetime | None = None
    terms_version: str | None = None
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


class AdminReassignProjectOwnerRequest(BaseModel):
    # New owner for the project. Sharing is derived from the owner's company,
    # so assigning to a company member makes the project visible to that company.
    user_id: uuid.UUID


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
    # Company assignment (admin). `company_id` selects an existing company or
    # clears (explicit null); `company_name` creates a new one (get-or-create).
    # When both are sent, company_name wins. Honored via exclude_unset.
    company_id: uuid.UUID | None = None
    company_name: str | None = None


class UserProfileUpdate(BaseModel):
    full_name: str | None = None
    phone_number: str | None = None
    lang: str | None = None
    # When provided, resolved to a Company (get-or-create). None = not changing.
    company_name: str | None = None

    @field_validator('phone_number', 'company_name')
    @classmethod
    def not_blank(cls, v: str | None) -> str | None:
        # None means "not changing this field" — allowed. But if it is being
        # set, it cannot be blanked out.
        if v is not None and not v.strip():
            raise ValueError('value cannot be empty')
        return v
