from __future__ import annotations

import logging
from typing import Optional

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .device_service import (
    LinkResult,
    approve_device,
    link_device,
    list_devices,
    reject_device,
    revoke_device,
    serialize_device,
    rename_device,
)
from .models import UserDevice

logger = logging.getLogger(__name__)


def _get_request_field(request, key: str) -> Optional[str]:
    value = request.data.get(key)
    if isinstance(value, str):
        value = value.strip()
    return value


def _device_payload(result: LinkResult) -> dict:
    payload = serialize_device(result.device)
    payload['requires_replace'] = result.requires_replace
    if result.pending_token:
        payload['pending_token'] = result.pending_token
    return payload


class DeviceLinkView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = 'devices_register'
    skip_device_check = True

    def post(self, request):
        device_id = request.headers.get('X-Device-Id') or request.META.get('HTTP_X_DEVICE_ID')
        push_token_param = _get_request_field(request, 'push_token') or _get_request_field(request, 'pushToken')
        
        # Debug logging
        logger.info(f"DeviceLinkView: device_id={device_id}, push_token={push_token_param}")
        
        result = link_device(
            user=request.user,
            device_id=device_id,
            label=_get_request_field(request, 'label') or _get_request_field(request, 'name'),
            platform=_get_request_field(request, 'platform') or _get_request_field(request, 'client'),
            app_version=_get_request_field(request, 'app_version') or _get_request_field(request, 'version'),
            push_token=push_token_param,
        )
        return Response({'device': _device_payload(result)})


class DeviceListView(APIView):
    def get(self, request):
        devices = list_devices(request.user)
        from django.conf import settings
        limit = getattr(settings, 'USER_DEVICE_MAX_ACTIVE', 3)
        return Response({'devices': devices, 'limit': limit})


class DeviceApproveView(APIView):
    def post(self, request):
        acting: UserDevice = getattr(request, 'user_device', None)
        pending_token = _get_request_field(request, 'pending_token') or _get_request_field(request, 'request_id')
        device_id = _get_request_field(request, 'device_id')
        replace_id = _get_request_field(request, 'replace_device_id')
        try:
            approved = approve_device(
                user=request.user,
                acting_device=acting,
                pending_token=pending_token,
                device_id=device_id,
                replace_device_id=replace_id,
            )
        except PermissionError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except LookupError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_404_NOT_FOUND)
        except TimeoutError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_410_GONE)
        except RuntimeError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response({'device': serialize_device(approved)})


class DeviceRejectView(APIView):
    def post(self, request):
        acting: UserDevice = getattr(request, 'user_device', None)
        pending_token = _get_request_field(request, 'pending_token') or _get_request_field(request, 'request_id')
        device_id = _get_request_field(request, 'device_id')
        try:
            reject_device(
                user=request.user,
                acting_device=acting,
                pending_token=pending_token,
                device_id=device_id,
            )
        except PermissionError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except LookupError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_404_NOT_FOUND)
        return Response({'detail': 'rejected'})


class DeviceRevokeView(APIView):
    def post(self, request):
        acting: UserDevice = getattr(request, 'user_device', None)
        target_id = _get_request_field(request, 'device_id') or _get_request_field(request, 'target_id')
        try:
            revoke_device(user=request.user, acting_device=acting, device_id=target_id)
        except PermissionError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except LookupError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_404_NOT_FOUND)
        return Response({'detail': 'revoked'})


class DeviceReplaceView(APIView):
    def post(self, request):
        acting: UserDevice = getattr(request, 'user_device', None)
        pending_token = _get_request_field(request, 'pending_token') or _get_request_field(request, 'request_id')
        replace_id = _get_request_field(request, 'remove_device_id') or _get_request_field(request, 'replace_device_id')
        try:
            approved = approve_device(
                user=request.user,
                acting_device=acting,
                pending_token=pending_token,
                device_id=_get_request_field(request, 'device_id'),
                replace_device_id=replace_id,
            )
        except (PermissionError, LookupError, TimeoutError, RuntimeError) as exc:
            status_map = {
                PermissionError: status.HTTP_403_FORBIDDEN,
                LookupError: status.HTTP_404_NOT_FOUND,
                TimeoutError: status.HTTP_410_GONE,
                RuntimeError: status.HTTP_409_CONFLICT,
            }
            return Response({'detail': str(exc)}, status=status_map.get(type(exc), status.HTTP_400_BAD_REQUEST))
        return Response({'device': serialize_device(approved)})


class DeviceRenameView(APIView):
    def post(self, request):
        acting: UserDevice = getattr(request, 'user_device', None)
        target_id = _get_request_field(request, 'device_id') or _get_request_field(request, 'target_id') or getattr(acting, 'id', None)
        label = _get_request_field(request, 'label') or _get_request_field(request, 'name')
        try:
            renamed = rename_device(user=request.user, acting_device=acting, device_id=target_id, label=label)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except PermissionError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except LookupError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_404_NOT_FOUND)
        return Response({'device': serialize_device(renamed)})


class DeviceUpdateTokenView(APIView):
    """
    تحديث Push Token للجهاز الحالي
    يُستخدم عند تفعيل الإشعارات بعد رفضها سابقاً
    """
    permission_classes = [IsAuthenticated]
    
    def post(self, request):
        acting: UserDevice = getattr(request, 'user_device', None)
        
        # الحصول على device_id من الـ Header (مثل باقي الـ endpoints)
        device_id = request.headers.get('X-Device-Id') or request.META.get('HTTP_X_DEVICE_ID')
        
        # الحصول على push_token من الـ body
        push_token = _get_request_field(request, 'push_token')
        
        if not device_id:
            return Response({'detail': 'X-Device-Id header is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        if not push_token:
            return Response({'detail': 'push_token is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            # البحث عن الجهاز
            device = UserDevice.objects.get(
                user=request.user,
                device_id=device_id
            )
            
            # التحقق من الصلاحيات: يمكن للجهاز تحديث token نفسه فقط
            if acting and acting.device_id != device_id:
                return Response(
                    {'detail': 'يمكنك تحديث token جهازك فقط'}, 
                    status=status.HTTP_403_FORBIDDEN
                )
            
            # تحديث Token
            device.push_token = push_token
            device.save(update_fields=['push_token'])
            
            logger.info(f"✅ Updated push token for device {device_id[:20]}...")
            
            return Response({'device': serialize_device(device)})
            
        except UserDevice.DoesNotExist:
            return Response({'detail': 'الجهاز غير موجود'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as exc:
            logger.exception(f"Failed to update push token: {exc}")
            return Response(
                {'detail': 'حدث خطأ أثناء تحديث token'}, 
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

