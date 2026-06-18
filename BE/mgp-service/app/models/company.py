import uuid
from datetime import datetime, timezone
from sqlalchemy import String, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class Company(Base):
    """A customer company. Users register under one (free-text name, deduped by
    `normalized_name`); projects are shared between users of the same company.

    `name` keeps the original casing the first registrant typed (for display);
    `normalized_name` is the dedup key (lower-cased, whitespace-collapsed) and is
    unique so two people typing the same company in different casing/spacing land
    on one row. See app/services/company_service.py.
    """
    __tablename__ = "companies"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
