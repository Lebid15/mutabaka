from __future__ import annotations

from urllib.parse import urlparse, parse_qs

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from .models import UserDevice, WebLoginSession, _hash_token
from .permissions import ActiveDeviceRequired
from .device_service import count_active_web_devices


def _sanitize_label(value: str | None) -> str:
    if not value:
        return 'متصفح الويب'
    trimmed = value.strip()
    if not trimmed:
        return 'متصفح الويب'
    return trimmed[:120]


def _extract_payload_components(raw: str | None) -> tuple[str | None, str | None]:
    if not raw:
        return None, None
    raw = raw.strip()
    if not raw:
        return None, None
    if raw.startswith('mutabaka://'):
        parsed = urlparse(raw)
        query = parse_qs(parsed.query)
        token = (query.get('token') or query.get('qr_token') or query.get('t') or [None])[0]
        request_id = (query.get('rid') or query.get('request_id') or [None])[0]
        return token, request_id
    return raw, None


def _build_payload(session: WebLoginSession, token: str) -> str:
    return f"mutabaka://link?token={token}&rid={session.id.hex}"


class LoginQrCreateView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_scope = 'login_qr'

    def get(self, request):
        ttl_seconds = int(getattr(settings, 'WEB_LOGIN_QR_TTL_SECONDS', 90) or 90)
        session, token = WebLoginSession.create_new(ttl_seconds)
        payload = _build_payload(session, token)
        return Response({
            'request_id': str(session.id),
            'payload': payload,
            'expires_in': ttl_seconds,
        })

    def post(self, request):
        # Extract device fingerprint from request
        device_fingerprint = request.data.get('device_fingerprint', '')
        stored_device_id = request.data.get('stored_device_id', '')
        
        ttl_seconds = int(getattr(settings, 'WEB_LOGIN_QR_TTL_SECONDS', 90) or 90)
        session, token = WebLoginSession.create_new(ttl_seconds)
        
        # Store device fingerprint in session
        if device_fingerprint:
            session.device_fingerprint = device_fingerprint[:128]  # Limit length
        if stored_device_id:
            session.stored_device_id = stored_device_id[:128]
        session.save(update_fields=['device_fingerprint', 'stored_device_id'])
        
        payload = _build_payload(session, token)
        return Response({
            'request_id': str(session.id),
            'payload': payload,
            'expires_in': ttl_seconds,
        })


class LoginQrStatusView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_scope = 'login_qr_status'

    def get(self, request, request_id: str):
        try:
            session = WebLoginSession.objects.get(id=request_id)
        except WebLoginSession.DoesNotExist:
            return Response({'status': 'not_found'}, status=status.HTTP_404_NOT_FOUND)

        if session.status == WebLoginSession.Status.PENDING and session.is_expired:
            session.mark_expired(save=True)

        if session.status == WebLoginSession.Status.EXPIRED:
            return Response({'status': 'expired'}, status=status.HTTP_410_GONE)

        if session.status == WebLoginSession.Status.PENDING:
            remaining = max(0, int((session.expires_at - timezone.now()).total_seconds()))
            return Response({'status': 'pending', 'expires_in': remaining})

        if session.status == WebLoginSession.Status.CONSUMED:
            return Response({'status': 'consumed'}, status=status.HTTP_410_GONE)

        if session.status == WebLoginSession.Status.APPROVED:
            with transaction.atomic():
                session = WebLoginSession.objects.select_for_update().get(id=session.id)
                if session.status != WebLoginSession.Status.APPROVED:
                    return Response({'status': 'pending'}, status=status.HTTP_202_ACCEPTED)
                access = session.access_token
                refresh = session.refresh_token
                if not access or not refresh:
                    return Response({'status': 'pending'}, status=status.HTTP_202_ACCEPTED)
                session.access_token = ''
                session.refresh_token = ''
                session.status = WebLoginSession.Status.CONSUMED
                session.consumed_at = timezone.now()
                session.save(update_fields=['access_token', 'refresh_token', 'status', 'consumed_at'])
            user_payload = None
            if session.user:
                user_payload = {
                    'id': session.user.id,
                    'username': session.user.username,
                    'display_name': session.user.display_name or session.user.username,
                }
            return Response({
                'status': 'approved',
                'access': access,
                'refresh': refresh,
                'user': user_payload,
            })

        return Response({'status': 'pending'}, status=status.HTTP_202_ACCEPTED)


class LoginQrApproveView(APIView):
    permission_classes = [IsAuthenticated, ActiveDeviceRequired]
    throttle_scope = 'login_qr_approve'

    def post(self, request):
        raw_payload = request.data.get('payload') or request.data.get('qr_payload')
        token = request.data.get('token') or request.data.get('qr_token')
        request_id = request.data.get('request_id') or request.data.get('rid')

        parsed_token, parsed_request_id = _extract_payload_components(raw_payload)
        if not token and parsed_token:
            token = parsed_token
        if not request_id and parsed_request_id:
            request_id = parsed_request_id

        if not token:
            return Response({'detail': 'token_required'}, status=status.HTTP_400_BAD_REQUEST)

        lookup_kwargs = {}
        if request_id:
            lookup_kwargs['id'] = request_id
        hashed = _hash_token(token)
        if not lookup_kwargs:
            lookup_kwargs['token_hash'] = hashed

        with transaction.atomic():
            try:
                session = WebLoginSession.objects.select_for_update().get(**lookup_kwargs)
            except WebLoginSession.DoesNotExist:
                return Response({'detail': 'session_not_found'}, status=status.HTTP_404_NOT_FOUND)

            if session.status == WebLoginSession.Status.CONSUMED:
                return Response({'detail': 'already_consumed'}, status=status.HTTP_409_CONFLICT)

            if session.status == WebLoginSession.Status.APPROVED:
                return Response({'detail': 'already_approved'}, status=status.HTTP_409_CONFLICT)

            if session.token_hash != hashed:
                return Response({'detail': 'token_mismatch'}, status=status.HTTP_403_FORBIDDEN)

            if session.is_expired:
                session.mark_expired(save=True)
                return Response({'detail': 'expired'}, status=status.HTTP_410_GONE)

            # Extract device fingerprint from session
            device_fingerprint = session.device_fingerprint
            stored_device_id = session.stored_device_id
            existing_device = None
            
            # Try to find existing device with same fingerprint (same physical device)
            if device_fingerprint:
                existing_device = UserDevice.objects.filter(
                    user=request.user,
                    platform='web',
                    is_web=True,
                    device_fingerprint=device_fingerprint
                ).first()
                
                if existing_device:
                    print(f"🔄 [Device Reuse] Found existing device {existing_device.id} for user {request.user.username} with fingerprint {device_fingerprint[:16]}...")
            
            # If device found, reuse it (update it instead of creating new)
            if existing_device:
                device = existing_device
                device.status = UserDevice.Status.ACTIVE
                device.last_seen_at = timezone.now()
                device.label = _sanitize_label(request.data.get('label') or request.data.get('device_label'))
                device.app_version = request.META.get('HTTP_USER_AGENT', '')[:40]
                if stored_device_id:
                    device.stored_device_id = stored_device_id[:128]
                device.save()
                print(f"✅ [Device Reuse] Reactivated device {device.id} - No new device created")
            else:
                # New physical device - check limit before creating
                web_limit = getattr(settings, 'USER_WEB_DEVICE_MAX_ACTIVE', 5)
                active_web_count = count_active_web_devices(request.user)
                
                if active_web_count >= web_limit:
                    return Response({
                        'detail': 'web_device_limit_reached',
                        'message': f'الحد الأقصى {web_limit} أجهزة. يرجى إلغاء جهاز قديم أولاً.',
                        'limit': web_limit,
                        'current': active_web_count
                    }, status=status.HTTP_409_CONFLICT)

                # Create new device
                now = timezone.now()
                label = _sanitize_label(request.data.get('label') or request.data.get('device_label'))
                user_agent = request.META.get('HTTP_USER_AGENT', '')
                device = UserDevice.objects.create(
                    user=request.user,
                    status=UserDevice.Status.ACTIVE,
                    label=label,
                    platform='web',
                    app_version=user_agent[:40],
                    push_token='',
                    is_web=True,
                    device_fingerprint=device_fingerprint[:128] if device_fingerprint else '',
                    stored_device_id=stored_device_id[:128] if stored_device_id else '',
                    last_seen_at=now,
                )
                print(f"🆕 [Device Reuse] Created NEW device {device.id} for user {request.user.username} with fingerprint {device_fingerprint[:16] if device_fingerprint else 'none'}...")

            # Create refresh token for the user
            refresh = RefreshToken.for_user(request.user)
            
            # Check if current user is a team member (from JWT claims)
            # If so, preserve team member info in the new web token
            if hasattr(request, 'auth') and request.auth:
                actor = request.auth.get('actor')
                team_member_id = request.auth.get('team_member_id')
                owner_id = request.auth.get('owner_id')
                
                if actor == 'team_member' and team_member_id and owner_id:
                    # Add team member claims to the new token
                    refresh['actor'] = 'team_member'
                    refresh['team_member_id'] = team_member_id
                    refresh['owner_id'] = owner_id
            
            access = refresh.access_token

            session.user = request.user
            session.status = WebLoginSession.Status.APPROVED
            session.approved_at = now
            session.approved_device = device
            session.approval_ip = request.META.get('REMOTE_ADDR')
            session.access_token = str(access)
            session.refresh_token = str(refresh)
            session.save(update_fields=[
                'user', 'status', 'approved_at', 'approved_device', 'approval_ip', 'access_token', 'refresh_token'
            ])

        return Response({
            'detail': 'approved',
            'request_id': str(session.id),
            'device_id': device.id,
        })
