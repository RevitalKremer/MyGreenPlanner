"""
Settings helpers — override pattern for per-item customization.

Supports three-tier hierarchy: per-item override > area default > app default.
"""


def get_setting_or_override(app_defaults: dict, overrides: dict, key: str):
    """
    Read a setting with per-item override support.
    
    Priority: per-item override > app default.
    Raises KeyError if key is missing from both dicts.
    
    This pattern is used throughout the application for allowing users to
    customize parameters at different scopes (global, area, trapezoid).
    
    Args:
        app_defaults: Application-wide defaults (from app_settings table)
        overrides: Per-item overrides (from user config)
        key: Setting key to retrieve
    
    Returns:
        Setting value (type depends on setting)
    
    Raises:
        KeyError: If key not found in either dict
    
    Examples:
        >>> app = {'blockHeightCm': 7.5, 'baseOverhangCm': 10.0}
        >>> overrides = {'blockHeightCm': 10.0}
        >>> get_setting_or_override(app, overrides, 'blockHeightCm')
        10.0  # Override used
        >>> get_setting_or_override(app, overrides, 'baseOverhangCm')
        10.0  # App default used (no override)
        >>> get_setting_or_override(app, overrides, 'missing')
        KeyError: 'missing'
    """
    if key in overrides:
        return overrides[key]
    return app_defaults[key]
