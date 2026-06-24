import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Boolean, Integer, Float, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class ElectricalRegulation(Base):
    """Israel Electric Company regulatory tracks (אסדרות) a PV system can be
    registered under. Reference data picked in Step 6. Deliberately holds NO
    tariff/reward data — only the descriptive + engineering fields (the kW AC
    range constrains inverter sizing)."""

    __tablename__ = "electrical_regulations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    name_en: Mapped[str] = mapped_column(String(255), nullable=False)
    name_he: Mapped[str] = mapped_column(String(255), nullable=False)
    description_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    description_he: Mapped[str | None] = mapped_column(Text, nullable=True)
    # AC power band this track applies to (kW). Null = no fixed bound.
    min_kw_ac: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_kw_ac: Mapped[float | None] = mapped_column(Float, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
