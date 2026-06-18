import uuid
from pydantic import BaseModel


class CompanyRead(BaseModel):
    id: uuid.UUID
    name: str

    model_config = {"from_attributes": True}
