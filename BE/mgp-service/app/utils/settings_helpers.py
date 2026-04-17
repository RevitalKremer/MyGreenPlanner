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


def resolve_roof_spec(project_roof_spec: dict | None, area: dict | None) -> dict:
    """Return the effective roof spec for a step2 area.

    When the project is `type == 'mixed'`, each area may carry its own
    `roofSpec` (`data.step2.areas[].roofSpec`). We return that spec, or
    a concrete default if an area is missing it (should not happen for
    a fully-configured mixed project, but keeps calls safe).

    When the project is not mixed (the default case for every existing
    project), the project-level `roof_spec` applies to all areas and is
    returned as-is.

    Args:
        project_roof_spec: `project.roof_spec` (may be None).
        area: step2 area dict (may be None when called before areas load).

    Returns:
        A dict shaped like RoofSpec with at least a `type` key.

    Examples:
        >>> resolve_roof_spec({'type': 'concrete'}, {'id': 1})
        {'type': 'concrete'}
        >>> resolve_roof_spec({'type': 'mixed'}, {'roofSpec': {'type': 'tiles'}})
        {'type': 'tiles'}
        >>> resolve_roof_spec({'type': 'mixed'}, {'id': 1})
        {'type': 'concrete'}
    """
    ps = project_roof_spec or {}
    if ps.get('type') != 'mixed':
        # Non-mixed projects: project spec applies to every area.
        # Fall back to concrete if project spec is empty (shouldn't happen).
        return ps if ps else {'type': 'concrete'}
    # Mixed mode — read the per-area spec (or concrete default).
    if area is None:
        return {'type': 'concrete'}
    return area.get('roofSpec') or {'type': 'concrete'}
