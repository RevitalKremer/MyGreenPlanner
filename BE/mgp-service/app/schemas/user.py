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
    # Credits snapshot. `available` is the live balance; `used` is the absolute
    # sum of unrefunded project_charge ledger rows; `total = available + used`.
    # All three default to 0 so endpoints that don't compute them (admin
    # listings) still serialize cleanly.
    credits_available: int = 0
    credits_used: int = 0
    credits_total: int = 0

    model_config = {"from_attributes": True}


class AdminGrantCreditsRequest(BaseModel):
    amount: int
    reason: str


class AdminRefundProjectRequest(BaseModel):
    reason: str


class AdminDismissRefundInboxRequest(BaseModel):
    reason: str | None = None
    undo: bool = False


class UserUpdate(BaseModel):
    full_name: str | None = None
    is_active: bool | None = None
    role: UserRole | None = None


class UserProfileUpdate(BaseModel):
    full_name: str | None = None
    phone_number: str | None = None
    lang: str | None = None
