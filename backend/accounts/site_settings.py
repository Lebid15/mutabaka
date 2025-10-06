"""
Helper utilities for accessing SiteSettings
"""
from typing import Optional
from .models import SiteSettings


_cached_settings: Optional[SiteSettings] = None


def get_site_settings() -> SiteSettings:
    """
    Get the singleton SiteSettings instance with caching.
    
    Returns:
        SiteSettings: The global site settings object
    """
    global _cached_settings
    if _cached_settings is None:
        _cached_settings = SiteSettings.load()
    return _cached_settings


def clear_site_settings_cache():
    """Clear the cached site settings - useful after updates"""
    global _cached_settings
    _cached_settings = None


def get_notification_icon_url() -> Optional[str]:
    """
    Get the full URL for the notification icon.
    
    Returns:
        str | None: Full URL to the notification icon, or None if not set
    
    Example:
        >>> icon_url = get_notification_icon_url()
        >>> if icon_url:
        ...     fcm_payload['notification']['icon'] = icon_url
    """
    settings = get_site_settings()
    return settings.get_notification_icon_url()
