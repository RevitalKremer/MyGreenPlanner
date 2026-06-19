import uuid
from pydantic import BaseModel, Field


class CompanyRead(BaseModel):
    id: uuid.UUID
    name: str
    # Admin-set client discount, percent 0–100. None = no discount.
    discount_percent: float | None = None
    # Number of users in the company (for the admin Companies tab).
    member_count: int = 0

    model_config = {"from_attributes": True}


class CompanyUpdate(BaseModel):
    # Rename the company (reflected everywhere via the relationship).
    name: str | None = Field(default=None, min_length=1)
    # Percent 0–100. Send null explicitly to clear (back to normal price);
    # the router applies fields with exclude_unset so an explicit null sticks.
    discount_percent: float | None = Field(default=None, ge=0, le=100)
