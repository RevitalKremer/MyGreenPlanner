from pydantic import BaseModel
from typing import Any


class SettingRead(BaseModel):
    key: str
    value_json: Any
    label: str
    section: str
    scope: str
    param_type: str
    min_val: float | None
    max_val: float | None
    step_val: float | None

    model_config = {"from_attributes": True}


class SettingUpdate(BaseModel):
    value_json: Any
