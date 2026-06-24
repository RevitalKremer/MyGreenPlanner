import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Boolean, Integer, Float, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.database import Base


class Product(Base):
    __tablename__ = "products"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    type_key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    # 'panel' for solar panels; for materials a category like 'screws',
    # 'clamps', 'accessories', 'anchoring', 'aluminium', 'electrical_cabinets',
    # 'electrical_wiring', 'panel_cable_extensions', or the legacy 'material'.
    product_type: Mapped[str] = mapped_column(String(50), nullable=False, default='material')
    part_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    name_he: Mapped[str | None] = mapped_column(String(255), nullable=True)
    additional_info: Mapped[str | None] = mapped_column(String(500), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    extra: Mapped[str | None] = mapped_column(String(50), nullable=True)
    alt_group: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    length_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    width_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    kw_peak: Mapped[int | None] = mapped_column(Integer, nullable=True)
    price_ils: Mapped[float | None] = mapped_column(Float, nullable=True)
    weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    depreciation_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Per-product processing percentage (labor cost: material cutting,
    # punching, etc.). Aggregated into a single 'processing' summary row in
    # the BOM, mirroring depreciation_pct → depreciation_waste.
    process_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    # When set, this product is auto-emitted as a child of `parentType`
    # whenever the parent appears in the effective BOM, with
    # qty = parent.qty * multiplier. Shape: {"parentType": str, "multiplier": int}.
    bundle: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
