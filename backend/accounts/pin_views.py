from __future__ import annotations
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, IsAdminUser
from django.contrib.auth import get_user_model
from django.utils import timezone
from django.db import transaction
from rest_framework.throttling import ScopedRateThrottle
from django.contrib.auth.hashers import make_password, check_password
from .models import TrustedDevice, UserSecurityAudit
import os

User = get_user_model()


def _channel_requires_pin(request) -> bool:
    """Return True if PIN is required based on X-Client and env flag.

    PIN_REQUIRE_CHANNELS env var: comma-separated list of channels, e.g. "mobile".
    Header key: X-Client: mobile|web
    """
    raw = os.environ.get("PIN_REQUIRE_CHANNELS", "mobile")
    channels = {x.strip().lower() for x in raw.split(',') if x.strip()}
    client = (request.headers.get('X-Client') or request.META.get('HTTP_X_CLIENT') or '').strip().lower()
    return client in channels


def _gen_pin() -> str:
    # 6-digit zero-padded random numeric pin
    import secrets
    return f"{secrets.randbelow(1_000_000):06d}"


class GeneratePinOnFirstMobileLogin(APIView):
    """Called right after password auth on mobile-first login to get a fresh PIN.

    Returns the PIN once, and stores only the hash server-side.
    Throttled to avoid abuse.
    """
    permission_classes = [IsAuthenticated]
    throttle_scope = 'pin_generate'
    throttle_classes = [ScopedRateThrottle]

    def post(self, request):
        if not _channel_requires_pin(request):
            return Response({'detail': 'Channel not requiring PIN'}, status=400)
        u = request.user
        # If already has a pin, do not regenerate silently; return indicator
        if getattr(u, 'pin_hash', ''):
            return Response({'pin_already_set': True}, status=200)
        pin = _gen_pin()
        u.pin_hash = make_password(pin)
        u.pin_initialized_at = timezone.now()
        u.pin_failed_attempts = 0
        u.pin_locked_until = None
        update_fields = ['pin_hash', 'pin_initialized_at', 'pin_failed_attempts', 'pin_locked_until']
        if not getattr(u, 'pin_enabled', False):
            u.pin_enabled = True
            update_fields.append('pin_enabled')
        u.save(update_fields=update_fields)
        return Response({'pin': pin})


class VerifyPinView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = 'pin_verify'
    throttle_classes = [ScopedRateThrottle]

    def post(self, request):
        if not _channel_requires_pin(request):
            return Response({'detail': 'Channel not requiring PIN'}, status=400)
        u = request.user
        pin = (request.data.get('pin') or '').strip()
        fingerprint = (request.data.get('fingerprint') or '').strip()
        device_name = (request.data.get('device_name') or '').strip()
        platform = (request.data.get('platform') or '').strip().lower()
        if not getattr(u, 'pin_hash', ''):
            return Response({'detail': 'PIN not set'}, status=400)
        # lockout
        now = timezone.now()
        if getattr(u, 'pin_locked_until', None) and u.pin_locked_until and now < u.pin_locked_until:
            return Response({'detail': 'PIN locked, try later'}, status=423)
        if not pin or not pin.isdigit() or len(pin) != 6:
            return Response({'detail': 'Invalid PIN format'}, status=400)
        ok = check_password(pin, u.pin_hash)
        if not ok:
            u.pin_failed_attempts = int(u.pin_failed_attempts or 0) + 1
            # Simple policy: 5 attempts -> 10 minutes lock
            if u.pin_failed_attempts >= 5:
                u.pin_locked_until = now + timezone.timedelta(minutes=10)
                u.pin_failed_attempts = 0
            u.save(update_fields=['pin_failed_attempts', 'pin_locked_until'])
            return Response({'detail': 'PIN incorrect'}, status=400)
        # success
        u.pin_failed_attempts = 0
        u.pin_locked_until = None
        update_fields = ['pin_failed_attempts', 'pin_locked_until']
        if not getattr(u, 'pin_enabled', False):
            u.pin_enabled = True
            update_fields.append('pin_enabled')
        u.save(update_fields=update_fields)
        # Register/update device if fingerprint provided
        if fingerprint:
            with transaction.atomic():
                td, created = TrustedDevice.objects.select_for_update().get_or_create(
                    user=u, fingerprint=fingerprint,
                    defaults={'device_name': device_name, 'platform': platform}
                )
                # Auto-approve if user has <2 approved
                approved_count = TrustedDevice.objects.filter(user=u, approved_at__isnull=False).count()
                if td.approved_at is None and approved_count < 2:
                    td.approved_at = now
                td.device_name = device_name or td.device_name
                td.platform = platform or td.platform
                td.last_seen_at = now
                td.save()
        return Response({'detail': 'PIN verified'})


class DevicesRegisterView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = 'devices_register'
    throttle_classes = [ScopedRateThrottle]

    def post(self, request):
        if not _channel_requires_pin(request):
            return Response({'detail': 'Channel not requiring PIN'}, status=400)
        u = request.user
        fingerprint = (request.data.get('fingerprint') or '').strip()
        device_name = (request.data.get('device_name') or '').strip()
        platform = (request.data.get('platform') or '').strip().lower()
        if not fingerprint:
            return Response({'detail': 'fingerprint required'}, status=400)
        now = timezone.now()
        with transaction.atomic():
            td, created = TrustedDevice.objects.select_for_update().get_or_create(
                user=u, fingerprint=fingerprint,
                defaults={'device_name': device_name, 'platform': platform}
            )
            if td.approved_at is None:
                approved_count = TrustedDevice.objects.filter(user=u, approved_at__isnull=False).count()
                if approved_count < 2:
                    td.approved_at = now
            td.device_name = device_name or td.device_name
            td.platform = platform or td.platform
            td.last_seen_at = now
            td.save()
        return Response({'id': td.id, 'approved': bool(td.approved_at)})


class DevicesApproveView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = 'devices_approve'
    throttle_classes = [ScopedRateThrottle]

    def post(self, request):
        u = request.user
        target_id = request.data.get('id')
        if not target_id:
            return Response({'detail': 'id required'}, status=400)
        try:
            td = TrustedDevice.objects.get(id=target_id, user=u)
        except TrustedDevice.DoesNotExist:
            return Response({'detail': 'not found'}, status=404)
        # Ensure limit 2
        approved_count = TrustedDevice.objects.filter(user=u, approved_at__isnull=False).count()
        if not td.approved_at and approved_count >= 2:
            return Response({'detail': 'device limit reached'}, status=400)
        td.approved_at = timezone.now()
        td.save(update_fields=['approved_at'])
        return Response({'approved': True})


class DevicesDeleteView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, id: int):
        u = request.user
        deleted, _ = TrustedDevice.objects.filter(id=id, user=u).delete()
        if not deleted:
            return Response({'detail': 'not found'}, status=404)
        return Response({'deleted': True})


class DevicesListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        u = request.user
        items = list(TrustedDevice.objects.filter(user=u).order_by('-approved_at', '-last_seen_at', '-created_at')
                     .values('id', 'fingerprint', 'device_name', 'platform', 'approved_at', 'last_seen_at', 'created_at'))
        return Response({'devices': items})


class PinStatusView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        u = request.user

        def serialize_dt(value):
            if not value:
                return None
            if timezone.is_naive(value):
                value = timezone.make_aware(value, timezone.get_current_timezone())
            return timezone.localtime(value).isoformat()

        payload = {
            'pin_enabled': bool(getattr(u, 'pin_enabled', False)),
            'pin_set': bool(getattr(u, 'pin_hash', '')),
            'pin_epoch': int(getattr(u, 'pin_epoch', 0) or 0),
            'pin_initialized_at': serialize_dt(getattr(u, 'pin_initialized_at', None)),
            'pin_locked_until': serialize_dt(getattr(u, 'pin_locked_until', None)),
            'pin_failed_attempts': int(getattr(u, 'pin_failed_attempts', 0) or 0),
            'channel_requires_pin': _channel_requires_pin(request),
            'server_time': serialize_dt(timezone.now()),
        }
        return Response(payload)


class AdminResetUserPinView(APIView):
    permission_classes = [IsAuthenticated, IsAdminUser]

    def post(self, request):
        target_id = request.data.get('user_id') or request.data.get('id')
        try:
            target_id_int = int(target_id)
        except (TypeError, ValueError):
            return Response({'detail': 'user_id must be an integer'}, status=400)

        reason = request.data.get('reason')
        if isinstance(reason, str):
            reason = reason.strip()

        with transaction.atomic():
            try:
                target = User.objects.select_for_update().get(id=target_id_int)
            except User.DoesNotExist:
                return Response({'detail': 'user not found'}, status=404)

            previous_epoch = int(getattr(target, 'pin_epoch', 0) or 0)
            target.pin_hash = ''
            target.pin_initialized_at = None
            target.pin_failed_attempts = 0
            target.pin_locked_until = None
            target.pin_enabled = False
            target.pin_epoch = previous_epoch + 1
            target.save(update_fields=[
                'pin_hash',
                'pin_initialized_at',
                'pin_failed_attempts',
                'pin_locked_until',
                'pin_enabled',
                'pin_epoch',
            ])

            devices_deleted, _ = TrustedDevice.objects.filter(user=target).delete()

            metadata = {
                'previous_epoch': previous_epoch,
                'new_epoch': target.pin_epoch,
                'reason': reason,
                'devices_revoked': devices_deleted,
            }
            metadata = {k: v for k, v in metadata.items() if v not in (None, '')}
            UserSecurityAudit.objects.create(
                subject=target,
                actor=request.user,
                action=UserSecurityAudit.ACTION_PIN_RESET,
                metadata=metadata,
            )

        return Response({
            'detail': 'PIN reset',
            'user_id': target.id,
            'pin_enabled': target.pin_enabled,
            'pin_epoch': target.pin_epoch,
            'devices_revoked': devices_deleted,
        })
