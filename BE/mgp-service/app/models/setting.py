from datetime import datetime, timezone
from sqlalchemy import String, DateTime, Float, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import JSONB

from app.database import Base


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value_json: Mapped[dict | list | bool | int | float] = mapped_column(JSONB, nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    section: Mapped[str] = mapped_column(String(50), nullable=False)   # rails / bases / detail
    scope: Mapped[str] = mapped_column(String(50), nullable=False)     # global / area / trapezoid
    param_type: Mapped[str] = mapped_column(String(50), nullable=False) # number / boolean / array / rail-spacing
    min_val: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_val: Mapped[float | None] = mapped_column(Float, nullable=True)
    step_val: Mapped[float | None] = mapped_column(Float, nullable=True)
    highlight_group: Mapped[str | None] = mapped_column(String(50), nullable=True)
    visible: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default='true')
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
