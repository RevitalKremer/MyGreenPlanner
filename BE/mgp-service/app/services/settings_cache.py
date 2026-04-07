"""
Settings cache service — preload app_settings at startup for fast access.

All app_settings are loaded into memory once and accessed via get_setting().
Call refresh_settings_cache() after admin updates to reload from DB.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.setting import AppSetting
import logging

logger = logging.getLogger(__name__)

# In-memory cache: key → value_json
_SETTINGS_CACHE: dict[str, any] = {}


async def load_settings_cache(db: AsyncSession) -> None:
    """
    Load all app_settings into memory cache.
    Called at startup and after admin updates.
    """
    global _SETTINGS_CACHE
    
    result = await db.execute(select(AppSetting))
    settings = result.scalars().all()
    
    _SETTINGS_CACHE = {s.key: s.value_json for s in settings}
    logger.info(f"Settings cache loaded: {len(_SETTINGS_CACHE)} keys")


def get_setting(key: str, default=None):
    """
    Get a setting from cache. Raises KeyError if key missing and no default.
    
    Use default=None for optional settings.
    Omit default to enforce strict validation (raises KeyError if missing).
    """
    if key not in _SETTINGS_CACHE:
        if default is None:
            raise KeyError(
                f"Required setting '{key}' not found in cache. "
                f"Cache loaded: {is_cache_loaded()}, keys: {len(_SETTINGS_CACHE)}"
            )
        return default
    return _SETTINGS_CACHE[key]


def get_all_settings() -> dict:
    """Return a copy of the entire settings cache."""
    return dict(_SETTINGS_CACHE)


def is_cache_loaded() -> bool:
    """Check if cache has been initialized."""
    return len(_SETTINGS_CACHE) > 0
