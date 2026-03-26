import uuid
from datetime import datetime
from pydantic import BaseModel


class ProductBase(BaseModel):
    type_key: str
    product_type: str = 'material'  # 'panel' | 'material'
    part_number: str | None = None
    name: str
    additional_info: str | None = None
    active: bool = True
    extra: str | None = None
    alt_group: int | None = None
    is_default: bool = False
    # Panel-only fields — only relevant when product_type == 'panel'
    length_cm: float | None = None
    width_cm: float | None = None
    kw_peak: int | None = None


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    product_type: str | None = None
    part_number: str | None = None
    name: str | None = None
    additional_info: str | None = None
    active: bool | None = None
    extra: str | None = None
    alt_group: int | None = None
    is_default: bool | None = None
    # Panel-only fields
    length_cm: float | None = None
    width_cm: float | None = None
    kw_peak: int | None = None


class ProductRead(ProductBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
