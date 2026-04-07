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
    highlight_group: str | None
    visible: bool
    roof_types: list[str] | None = None

    model_config = {"from_attributes": True}


class SettingUpdate(BaseModel):
    value_json: Any
    min_val: float | None = None
    max_val: float | None = None
    step_val: float | None = None
    visible: bool | None = None
    roof_types: list[str] | None = None
