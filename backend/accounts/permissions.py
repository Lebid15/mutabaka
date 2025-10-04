from __future__ import annotations

from typing import Optional

from django.utils import timezone
from django.conf import settings
from rest_framework.permissions import BasePermission

from .models import UserDevice


def _get_device_id(request) -> Optional[str]:
    header = request.headers.get('X-Device-Id') if hasattr(request, 'headers') else None
    if header:
        return header.strip()
    meta = request.META.get('HTTP_X_DEVICE_ID')
    return meta.strip() if isinstance(meta, str) else None


def _active_statuses() -> set[str]:
    return {UserDevice.Status.PRIMARY, UserDevice.Status.ACTIVE}


class ActiveDeviceRequired(BasePermission):
    message = 'device_not_active'

    def has_permission(self, request, view) -> bool:  # noqa: D401 (DRF signature)
        if getattr(view, 'skip_device_check', False):
            return True
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated:
            return True
        path = request.path or ''
        if path.startswith('/admin') or path.startswith('/health'):
            return True
        if request.method == 'OPTIONS':
            return True
        device_id = _get_device_id(request)
        if not device_id:
            self.message = 'device_id_required'
            return False
        # Cache on request to avoid repeated queries inside a single view
        device: Optional[UserDevice] = getattr(request, '_cached_user_device', None)
        if device is None or device.id != device_id:
            try:
                device = UserDevice.objects.get(id=device_id, user=user)
            except UserDevice.DoesNotExist:
                self.message = 'device_unknown'
                return False
            request._cached_user_device = device
        # Pending expiration check
        if device.status == UserDevice.Status.PENDING:
            expires_at = device.pending_expires_at
            if expires_at and timezone.now() > expires_at:
                device.set_status(UserDevice.Status.REVOKED)
                self.message = 'device_pending_expired'
                return False
            self.message = 'device_pending'
            return False
        if device.status == UserDevice.Status.REVOKED:
            self.message = 'device_revoked'
            return False
        if device.status not in _active_statuses():
            self.message = 'device_not_active'
            return False
        # Enforce max active count even if DB drifted (fail-safe)
        active_count = UserDevice.objects.filter(
            user=user,
            status__in=_active_statuses(),
            is_web=False,
        ).count()
        limit = getattr(settings, 'USER_DEVICE_MAX_ACTIVE', 3)
        if active_count > limit:
            self.message = 'device_limit_exceeded'
            return False
        # Update last seen lazily
        now = timezone.now()
        if not device.last_seen_at or (now - device.last_seen_at).total_seconds() > 90:
            UserDevice.objects.filter(id=device.id).update(last_seen_at=now)
            device.last_seen_at = now
        request.user_device = device
        return True


__all__ = [
    'ActiveDeviceRequired',
]
