import uuid
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.database import Base


class ProjectElectricalBOM(Base):
    """Electrical (Sadot goods) BOM — a fully separate table from the
    construction BOM (project_bom). One row per project; computed from the
    Step-6 equipment selection + Step-7 string plan. Mirrors ProjectBOM's
    shape so the two stacks stay structurally parallel but never share data."""

    __tablename__ = "project_electrical_bom"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        unique=True, nullable=False, index=True,
    )
    items: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    input_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    project: Mapped["Project"] = relationship("Project")
