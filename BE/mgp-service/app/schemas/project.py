import uuid
from datetime import datetime
from pydantic import BaseModel


class ProjectCreate(BaseModel):
    name: str
    location: str | None = None
    data: dict = {}


class ProjectUpdate(BaseModel):
    name: str | None = None
    location: str | None = None
    data: dict | None = None


class ProjectRead(BaseModel):
    id: uuid.UUID
    owner_id: uuid.UUID
    name: str
    location: str | None
    data: dict
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ProjectSummary(BaseModel):
    id: uuid.UUID
    name: str
    location: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
