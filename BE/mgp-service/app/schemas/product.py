import uuid
from datetime import datetime
from pydantic import BaseModel


class ProductBase(BaseModel):
    type_key: str
    part_number: str | None = None
    name: str
    additional_info: str | None = None
    active: bool = True
    extra: str | None = None
    alt: str | None = None
    alt_group: int | None = None
    sort_order: int = 0


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    part_number: str | None = None
    name: str | None = None
    additional_info: str | None = None
    active: bool | None = None
    extra: str | None = None
    alt: str | None = None
    alt_group: int | None = None
    sort_order: int | None = None


class ProductRead(ProductBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
