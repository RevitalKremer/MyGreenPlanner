import uuid
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.database import Base


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    client_name: Mapped[str] = mapped_column(String(255), nullable=False)
    location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    roof_spec: Mapped[dict] = mapped_column(JSONB, nullable=False, default=lambda: {"type": "concrete"})
    navigation: Mapped[dict] = mapped_column(JSONB, nullable=False, default=lambda: {"step": 1, "tab": None})
    layout: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # Set the first time the project transitions 2→3 (and credits are debited).
    # Never cleared — historical marker. Refund state lives on the matching
    # credit_transactions row (kind='project_charge').refunded flag.
    credits_charged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Set when the project owner clicks "Get Quotation" in step 5. Informational
    # signal for the admin pending-refunds inbox; not a refund precondition.
    quotation_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Admin can hide a project from the pending-refunds inbox (e.g. order
    # cancelled externally). Doesn't refund anything; the project is still
    # discoverable in the manual-lookup tab and still refundable later.
    refund_inbox_dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    refund_inbox_dismissed_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    refund_inbox_dismissed_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    owner: Mapped["User"] = relationship("User", back_populates="projects", foreign_keys=[owner_id])
    images: Mapped[list["ProjectImage"]] = relationship("ProjectImage", back_populates="project", cascade="all, delete-orphan")
