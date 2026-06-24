import uuid
from datetime import datetime
from pydantic import BaseModel, Field
from app.schemas.roof_spec import RoofSpec


class ProjectCreate(BaseModel):
    name: str
    client_name: str
    location: str | None = None
    roof_spec: RoofSpec = Field(default_factory=lambda: RoofSpec(type='concrete'))
    layout: dict = Field(default_factory=dict)
    data: dict = Field(default_factory=dict)


class ProjectUpdate(BaseModel):
    name: str | None = None
    client_name: str | None = None
    location: str | None = None
    layout: dict | None = None
    data: dict | None = None


class ProjectRead(BaseModel):
    id: uuid.UUID
    owner_id: uuid.UUID
    name: str
    client_name: str
    location: str | None
    roof_spec: dict
    navigation: dict
    layout: dict
    data: dict
    credits_charged_at: datetime | None = None
    quotation_requested_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ProjectSummary(BaseModel):
    id: uuid.UUID
    name: str
    client_name: str
    roof_spec: dict
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
    offset: int = 0
    limit: int | None = None
    has_more: bool = False
