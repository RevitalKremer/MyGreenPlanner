"""
Panel geometry helpers — orientation inference, position calculation.

Shared utilities for working with panel grids across rail and base services.
"""

from typing import Optional


# ── Constants ─────────────────────────────────────────────────────────────────

EMPTY_ORIENTATIONS = ('EV', 'EH')  # Empty vertical, Empty horizontal (ghost slots)
PANEL_CODES = {'V', 'H', 'EV', 'EH'}  # All valid panel orientation codes


# ── Helpers ───────────────────────────────────────────────────────────────────

def is_empty_orientation(code: str) -> bool:
    """
    Check if orientation code represents an empty/ghost panel slot.
    
    Empty slots are rendered as ghosts in the UI but don't contribute to
    structural calculations (no rails, no bases).
    
    Args:
        code: Orientation code ('V', 'H', 'EV', 'EH')
    
    Returns:
        True if code is 'EV' or 'EH', False otherwise
    
    Examples:
        'EV' → True (empty vertical)
        'EH' → True (empty horizontal)
        'V' → False (real vertical panel)
        'H' → False (real horizontal panel)
    """
    return code in EMPTY_ORIENTATIONS


def infer_row_orientation(cells: list[str]) -> Optional[str]:
    """
    Return 'V' (portrait) or 'H' (landscape) from the first non-empty cell.
    
    Assumes all real panels in a row have the same orientation. Skips empty
    slots ('EV', 'EH') to find the first real panel.
    
    Args:
        cells: List of orientation codes for a row
    
    Returns:
        'V' for vertical/portrait, 'H' for horizontal/landscape, None if all empty
    
    Examples:
        ['V', 'V', 'EV'] → 'V'
        ['EH', 'H', 'H'] → 'H'
        ['EV', 'EH'] → None
    """
    for c in cells:
        if c in ('V', 'EV'):
            return 'V'
        if c in ('H', 'EH'):
            return 'H'
    return None


def default_panel_positions(
    cells: list[str],
    panel_along_cm: float,
    panel_gap_cm: float,
) -> list[float]:
    """
    Leading-edge positions (cm from area start corner) for real panels.
    
    Assumes uniform spacing. Used when explicit rowPositions are not stored.
    Only computes positions for real panels (excludes 'EV', 'EH' ghost slots).
    
    Args:
        cells: List of orientation codes
        panel_along_cm: Panel dimension along the row (width for V, length for H)
        panel_gap_cm: Gap between panels
    
    Returns:
        List of leading-edge positions in cm
    
    Examples:
        cells=['V', 'V', 'V'], panel_along_cm=100, gap=2
        → [0.0, 102.0, 204.0]
        
        cells=['V', 'EV', 'V'], panel_along_cm=100, gap=2
        → [0.0, 204.0]  (skips empty slot)
    """
    return [
        i * (panel_along_cm + panel_gap_cm)
        for i, cell in enumerate(cells)
        if cell in ('V', 'H')
    ]
