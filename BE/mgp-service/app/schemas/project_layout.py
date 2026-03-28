"""
MGP Project Layout Schema
=========================

The `layout` JSONB column on the projects table.
Stores all UI rendering state — pixel coordinates, canvas state, image data.

IMPORTANT: The backend service must NEVER read from `layout` for any physical
computation (rail layout, BOM, base placement, etc.). Layout is written and
consumed exclusively by the frontend to persist canvas drawing state between
sessions.

Relationship to project_data.py
--------------------------------
  `data`   is the sole source of truth for physical / structural project data.
  `layout` is UI-only state synced from `data` for rendering purposes.

  Fields that appear in both (e.g. panel grid address, panel dimensions) are
  derived from `data` — on any conflict, `data` wins.

Coordinate conventions
----------------------
  All coordinates are raw screen pixels on the uploaded image canvas.
  pixelToCmRatio — cm per pixel (= referenceLineLengthCm / referenceLine pixel length).
"""

from __future__ import annotations
from typing import Optional, Literal
from pydantic import BaseModel, Field


# ── Primitives ────────────────────────────────────────────────────────────────

class Point(BaseModel):
    x: float
    y: float


class LineSegment(BaseModel):
    start: Point
    end: Point


# ── Uploaded image ────────────────────────────────────────────────────────────

class UploadedImageData(BaseModel):
    imageData: str          # data-URL (base64 PNG/JPEG)
    width: int
    height: int
    rotation: float = 0
    scale: float = 1
    isWhiteboard: bool = False


# ── Rect areas (pixel canvas state) ──────────────────────────────────────────

class RectAreaLayout(BaseModel):
    """
    Drawn rectangular area — pixel-space geometry and canvas settings.
    Physical parameters (angleDeg, frontHeightCm) live in ProjectData.areas[].settings.
    """
    id: str
    vertices: list[Point]                               # 4 corners in screen pixels
    rotation: float = 0                                 # degrees CCW from image x-axis
    mode: Literal['free', 'ylocked'] = 'free'
    color: Optional[str] = None
    xDir: Literal['ltr', 'rtl'] = 'ltr'
    yDir: Optional[str] = None
    manualTrapezoids: bool = False
    manualColTrapezoids: dict[str, str] = Field(default_factory=dict)
    # str(colIdx) → explicit trapezoid ID override


# ── Panels (pixel + logical — synced from data) ───────────────────────────────

class PanelLayout(BaseModel):
    """
    A single panel as placed on the canvas.
    Pixel geometry is used for rendering only — the service must not read
    these coordinates for any computation.
    Logical fields (row, col, area, trapezoidId, widthCm, heightCm) are
    synced from ProjectData — data is source of truth on conflict.
    """
    id: int

    # Pixel geometry (rendering only)
    x: float            # top-left x in canvas pixels
    y: float            # top-left y in canvas pixels
    cx: float           # center x in canvas pixels
    cy: float           # center y in canvas pixels
    width: float        # pixel width
    height: float       # pixel height
    rotation: float = 0 # degrees (clockwise)

    # Physical dimensions (cm) — synced from ProjectData.settings
    widthCm: float
    heightCm: float

    # Grid address — synced from ProjectData.areas[].panelGrid
    row: int
    col: int
    line: int = 0       # line index within the area row
    coveredCols: list[int] = Field(default_factory=list)
    area: int           # index into rectAreas[]
    trapezoidId: str    # e.g. 'A', 'A1', 'B2'

    yDir: Optional[str] = None   # panel stacking direction: 'btt' | 'ttb'
    isEmpty: bool = False        # True for ghost/empty slots


# ── Root ──────────────────────────────────────────────────────────────────────

class ProjectLayout(BaseModel):
    """
    Root schema for the `layout` JSONB column.
    All pixel-coordinate and canvas rendering state.
    """
    currentStep: int = 1

    # Image and calibration
    uploadedImageData: Optional[UploadedImageData] = None
    roofPolygon: Optional[dict] = None          # SAM2 polygon output (pixel coords)
    referenceLine: Optional[LineSegment] = None
    referenceLineLengthCm: Optional[float] = None
    pixelToCmRatio: Optional[float] = None

    # Canvas areas and panels (synced from data — rendering only)
    rectAreas: list[RectAreaLayout] = Field(default_factory=list)
    panels: list[PanelLayout] = Field(default_factory=list)
    deletedPanelKeys: dict[str, list[str]] = Field(default_factory=dict)
    # str(areaIdx) → ["row_col", ...]

    # Step-2 baseline marker (pixel coords, UI state only)
    baseline: Optional[dict] = None
