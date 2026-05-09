import uuid
from datetime import datetime
from pydantic import BaseModel


class ProductBase(BaseModel):
    type_key: str
    # 'panel' for solar panels; for materials a category like 'screws',
    # 'clamps', 'accessories', 'anchoring', 'aluminium', 'electrical_cabinets',
    # 'electrical_wiring', 'panel_cable_extensions', or the legacy 'material'.
    product_type: str = 'material'
    part_number: str | None = None
    name: str
    name_he: str | None = None
    additional_info: str | None = None
    active: bool = True
    extra: str | None = None
    alt_group: int | None = None
    is_default: bool = False
    # Material pricing/weight (per meter for length items, per piece otherwise)
    price_ils: float | None = None
    weight_kg: float | None = None
    depreciation_pct: float | None = None
    # Panel-only fields — only relevant when product_type == 'panel'
    length_cm: float | None = None
    width_cm: float | None = None
    kw_peak: int | None = None
    # Bundle: when this product appears in the effective BOM, the named
    # parent emits this product as a child with qty = parent.qty * multiplier.
    bundle: dict | None = None


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    product_type: str | None = None
    part_number: str | None = None
    name: str | None = None
    name_he: str | None = None
    additional_info: str | None = None
    active: bool | None = None
    extra: str | None = None
    alt_group: int | None = None
    is_default: bool | None = None
    price_ils: float | None = None
    weight_kg: float | None = None
    depreciation_pct: float | None = None
    # Panel-only fields
    length_cm: float | None = None
    width_cm: float | None = None
    kw_peak: int | None = None
    bundle: dict | None = None


class ProductRead(ProductBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
