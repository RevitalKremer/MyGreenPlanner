"""
Math helpers — precision rounding utilities.

All rounding functions use the "round half to even" strategy (Python default).
"""


def round_to_1dp(v: float) -> float:
    """
    Round to 1 decimal place (0.1 cm precision).
    
    Used for most structural measurements where mm precision is not required.
    
    Examples:
        12.34 → 12.3
        12.35 → 12.4
        12.349 → 12.3
    """
    return round(v * 10) / 10


def round_to_2dp(v: float) -> float:
    """
    Round to 2 decimal places (0.01 cm precision = 0.1 mm).
    
    Used for high-precision base calculations.
    
    Examples:
        12.345 → 12.35
        12.344 → 12.34
    """
    return round(v * 100) / 100


def round_to_5cm(length_mm: int) -> int:
    """
    Round rail length to nearest 5cm (50mm) for aluminum profile cutting accuracy.
    
    Aluminum profiles can only be cut to 5cm intervals due to equipment limitations.
    Max cutting accuracy is 0.05m intervals.
    
    Args:
        length_mm: Rail length in millimeters
    
    Returns:
        Rounded length in millimeters (to nearest 50mm)
    
    Examples:
        1234 → 1250
        1272 → 1250
        1280 → 1300
        1225 → 1250 (rounds up at midpoint)
    """
    length_cm = length_mm / 10
    rounded_cm = round(length_cm / 5) * 5
    return round(rounded_cm * 10)
