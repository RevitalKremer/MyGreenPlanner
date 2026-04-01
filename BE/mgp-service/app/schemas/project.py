import uuid
from datetime import datetime
from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    name: str
    location: str | None = None
    layout: dict = Field(default_factory=dict)
    data: dict = Field(default_factory=dict)


class ProjectUpdate(BaseModel):
    name: str | None = None
    location: str | None = None
    layout: dict | None = None
    data: dict | None = None


class ProjectRead(BaseModel):
    id: uuid.UUID
    owner_id: uuid.UUID
    name: str
    location: str | None
    navigation: dict
    layout: dict
    data: dict
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ProjectSummary(BaseModel):
    id: uuid.UUID
    name: str
    location: str | None
    navigation: dict
    owner_id: uuid.UUID
    owner_email: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ProjectListResponse(BaseModel):
    projects: list[ProjectSummary]
    total: int
