from typing import Literal
from pydantic import BaseModel


class RoofSpec(BaseModel):
    """Roof specification for installation planning.

    A project with `type == 'mixed'` opts into per-area roof types —
    each step2 area then carries its own RoofSpec via `Step2Area.roofSpec`.
    When `type != 'mixed'`, the project-level spec applies to all areas.
    """
    type: Literal['concrete', 'tiles', 'iskurit', 'insulated_panel', 'mixed']
    distanceBetweenPurlinsCm: float | None = None
    installationOrientation: Literal['perpendicular', 'parallel'] | None = None
