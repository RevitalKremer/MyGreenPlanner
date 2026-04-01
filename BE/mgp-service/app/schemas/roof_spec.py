from typing import Literal
from pydantic import BaseModel


class RoofSpec(BaseModel):
    """Roof specification for installation planning."""
    type: Literal['concrete', 'tiles', 'iskurit', 'insulated_panel']
    distanceBetweenPurlinsCm: float | None = None
    installationOrientation: Literal['perpendicular', 'parallel'] | None = None
