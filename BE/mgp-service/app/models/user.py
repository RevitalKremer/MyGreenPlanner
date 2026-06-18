import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Boolean, Enum as SAEnum, DateTime, Integer, Numeric, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
import enum

from app.database import Base


class UserRole(str, enum.Enum):
    admin = "admin"
    user = "user"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    phone_number: Mapped[str | None] = mapped_column(String(30), nullable=True)
    role: Mapped[UserRole] = mapped_column(SAEnum(UserRole), default=UserRole.user, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_sysadmin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    lang: Mapped[str] = mapped_column(String(5), nullable=False, default='en')
    # Spendable balance. Admins never spend; their value is informational. Writes
    # always go through services/credits.py so the ledger and balance stay in sync.
    credits_balance: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Admin-set client discount, percent 0–100. NULL = no discount (normal
    # price). Applied to the price proposal's PRICE_AFTER_DISCOUNT cell as
    # `cell_above * (100 - discount_percent) / 100`.
    discount_percent: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    # Company the user belongs to. Required for public registrations, NULL for
    # admins (exempt) and legacy users. Drives company-level project sharing.
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    company: Mapped["Company | None"] = relationship("Company", foreign_keys=[company_id])
    projects: Mapped[list["Project"]] = relationship("Project", back_populates="owner", cascade="all, delete-orphan", foreign_keys="Project.owner_id")

    @property
    def company_name(self) -> str | None:
        """Company display name for UserRead. Reads the relationship only when
        it's already loaded — avoids triggering an async lazy load. Serialization
        sites eager-load `company` so the value is present where it matters."""
        from sqlalchemy import inspect as _sa_inspect
        if 'company' in _sa_inspect(self).unloaded:
            return None
        return self.company.name if self.company is not None else None
