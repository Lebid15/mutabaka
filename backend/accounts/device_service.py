from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import UserDevice

_ACTIVE_STATUSES = {UserDevice.Status.PRIMARY, UserDevice.Status.ACTIVE}


@dataclass
class LinkResult:
    device: UserDevice
    pending_token: Optional[str] = None
    requires_replace: bool = False


def _normalize_platform(value: Optional[str]) -> str:
    if not value:
        return ''
    value = value.strip().lower()
    allowed = {'ios', 'android', 'web', 'desktop'}
    if value in allowed:
        return value
    if 'iphone' in value or 'ipad' in value:
        return 'ios'
    if 'droid' in value:
        return 'android'
    return value[:20]


def _normalize_label(label: Optional[str], platform: str) -> str:
    lbl = (label or '').strip()
    if lbl:
        return lbl[:120]
    if platform:
        return platform.capitalize()
    return 'جهازي'


def _set_metadata(device: UserDevice, *, label: Optional[str], platform: Optional[str], app_version: Optional[str], push_token: Optional[str]) -> None:
    device.label = _normalize_label(label, platform or device.platform)
    device.platform = _normalize_platform(platform or device.platform)
    device.app_version = (app_version or '').strip()[:40]
    device.push_token = (push_token or '').strip()[:256]


def _issue_pending(device: UserDevice) -> str:
    ttl_minutes = getattr(settings, 'USER_DEVICE_PENDING_TTL_MINUTES', 15)
    return device.issue_pending_token(ttl_minutes)


def count_active_devices(user) -> int:
    return UserDevice.objects.filter(user=user, status__in=_ACTIVE_STATUSES).count()


@transaction.atomic
def link_device(*, user, device_id: Optional[str], label: Optional[str], platform: Optional[str], app_version: Optional[str], push_token: Optional[str]) -> LinkResult:
    now = timezone.now()
    device: Optional[UserDevice] = None
    if device_id:
        try:
            device = UserDevice.objects.select_for_update().get(user=user, id=device_id)
        except UserDevice.DoesNotExist:
            device = None
    limit = getattr(settings, 'USER_DEVICE_MAX_ACTIVE', 3)
    active_count = count_active_devices(user)

    if device is None:
        if active_count == 0:
            device = UserDevice(user=user, status=UserDevice.Status.PRIMARY)
            _set_metadata(device, label=label, platform=platform, app_version=app_version, push_token=push_token)
            device.last_seen_at = now
            device.save()
            return LinkResult(device=device, pending_token=None, requires_replace=False)
        device = UserDevice(user=user, status=UserDevice.Status.PENDING)
        _set_metadata(device, label=label, platform=platform, app_version=app_version, push_token=push_token)
        device.save()
        token = _issue_pending(device)
        requires_replace = active_count >= limit
        return LinkResult(device=device, pending_token=token, requires_replace=requires_replace)

    # Existing device refresh/update
    _set_metadata(device, label=label or device.label, platform=platform or device.platform, app_version=app_version or device.app_version, push_token=push_token or device.push_token)
    device.last_seen_at = now
    update_fields = ['label', 'platform', 'app_version', 'push_token', 'last_seen_at']

    if device.status == UserDevice.Status.REVOKED:
        # Treat as new pending request respecting limits
        device.status = UserDevice.Status.PENDING
        token = _issue_pending(device)
        update_fields.append('status')
        device.save(update_fields=update_fields)
        requires_replace = active_count >= limit
        return LinkResult(device=device, pending_token=token, requires_replace=requires_replace)

    if device.status == UserDevice.Status.PENDING:
        # Renew pending token if expired or missing
        expires_at = device.pending_expires_at
        if not expires_at or expires_at < now:
            token = _issue_pending(device)
        else:
            token = device.pending_token or _issue_pending(device)
        device.save(update_fields=update_fields)
        requires_replace = active_count >= limit
        return LinkResult(device=device, pending_token=token, requires_replace=requires_replace)

    if device.status in _ACTIVE_STATUSES:
        device.save(update_fields=update_fields)
        return LinkResult(device=device, pending_token=None, requires_replace=False)

    # Fallback: treat as pending
    device.status = UserDevice.Status.PENDING
    token = _issue_pending(device)
    update_fields.append('status')
    device.save(update_fields=update_fields)
    requires_replace = active_count >= limit
    return LinkResult(device=device, pending_token=token, requires_replace=requires_replace)


@transaction.atomic
def approve_device(*, user, acting_device: UserDevice, pending_token: Optional[str], device_id: Optional[str], replace_device_id: Optional[str] = None) -> UserDevice:
    if acting_device.status != UserDevice.Status.PRIMARY:
        raise PermissionError('only_primary_can_approve')
    if not pending_token and not device_id:
        raise ValueError('pending_token_or_device_id_required')
    filters = Q(user=user, status=UserDevice.Status.PENDING)
    if pending_token:
        filters &= Q(pending_token=pending_token)
    if device_id:
        filters &= Q(id=device_id)
    try:
        target = UserDevice.objects.select_for_update().get(filters)
    except UserDevice.DoesNotExist as exc:  # noqa: PERF203 - clarity preferred
        raise LookupError('pending_not_found') from exc

    now = timezone.now()
    if target.pending_expires_at and target.pending_expires_at < now:
        target.status = UserDevice.Status.REVOKED
        target.save(update_fields=['status'])
        raise TimeoutError('pending_expired')

    limit = getattr(settings, 'USER_DEVICE_MAX_ACTIVE', 3)
    active_count = count_active_devices(user)
    requires_replace = active_count >= limit
    removed_device: Optional[UserDevice] = None
    if requires_replace:
        if not replace_device_id:
            raise RuntimeError('device_limit_reached')
        try:
            removed_device = UserDevice.objects.select_for_update().get(user=user, id=replace_device_id, status__in=_ACTIVE_STATUSES)
        except UserDevice.DoesNotExist as exc:  # noqa: PERF203
            raise LookupError('replacement_not_found') from exc
        removed_device.status = UserDevice.Status.REVOKED
        removed_device.pending_token = ''
        removed_device.pending_expires_at = None
        removed_device.push_token = ''
        removed_device.save(update_fields=['status', 'pending_token', 'pending_expires_at', 'push_token'])
    target.status = UserDevice.Status.ACTIVE
    target.pending_token = ''
    target.pending_expires_at = None
    target.last_seen_at = now
    target.save(update_fields=['status', 'pending_token', 'pending_expires_at', 'last_seen_at'])
    return target


@transaction.atomic
def reject_device(*, user, acting_device: UserDevice, pending_token: Optional[str], device_id: Optional[str]) -> None:
    if acting_device.status != UserDevice.Status.PRIMARY:
        raise PermissionError('only_primary_can_reject')
    filters = Q(user=user)
    if pending_token:
        filters &= Q(pending_token=pending_token)
    if device_id:
        filters &= Q(id=device_id)
    filters &= Q(status=UserDevice.Status.PENDING)
    qs = UserDevice.objects.select_for_update().filter(filters)
    if not qs.exists():
        raise LookupError('pending_not_found')
    qs.update(status=UserDevice.Status.REVOKED, pending_token='', pending_expires_at=None, push_token='')


@transaction.atomic
def revoke_device(*, user, acting_device: UserDevice, device_id: str) -> None:
    if not device_id:
        raise ValueError('device_id_required')
    if device_id == acting_device.id:
        raise PermissionError('cannot_revoke_self')
    try:
        target = UserDevice.objects.select_for_update().get(user=user, id=device_id)
    except UserDevice.DoesNotExist as exc:
        raise LookupError('device_not_found') from exc
    if target.status == UserDevice.Status.PRIMARY:
        raise PermissionError('cannot_revoke_primary')
    target.status = UserDevice.Status.REVOKED
    target.pending_token = ''
    target.pending_expires_at = None
    target.push_token = ''
    target.save(update_fields=['status', 'pending_token', 'pending_expires_at', 'push_token'])


@transaction.atomic
def rename_device(*, user, acting_device: UserDevice, device_id: str, label: Optional[str]) -> UserDevice:
    if not device_id:
        raise ValueError('device_id_required')
    try:
        target = UserDevice.objects.select_for_update().get(user=user, id=device_id)
    except UserDevice.DoesNotExist as exc:
        raise LookupError('device_not_found') from exc
    if acting_device.id != target.id and acting_device.status != UserDevice.Status.PRIMARY:
        raise PermissionError('only_primary_can_rename')
    normalized_label = _normalize_label(label, target.platform)
    if normalized_label == target.label:
        return target
    target.label = normalized_label
    target.save(update_fields=['label'])
    return target


def serialize_device(device: UserDevice) -> dict:
    return {
        'device_id': device.id,
        'status': device.status,
        'label': device.label,
        'platform': device.platform,
        'app_version': device.app_version,
        'push_token': device.push_token or None,
        'created_at': device.created_at.isoformat() if device.created_at else None,
        'last_seen_at': device.last_seen_at.isoformat() if device.last_seen_at else None,
        'pending_expires_at': device.pending_expires_at.isoformat() if device.pending_expires_at else None,
    }


def list_devices(user) -> list[dict]:
    devices = UserDevice.objects.filter(user=user).order_by('-status', '-created_at')
    return [serialize_device(d) for d in devices]
