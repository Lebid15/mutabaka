"""
URL configuration for mujard project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from rest_framework_simplejwt.views import (
    TokenRefreshView, TokenVerifyView
)
from accounts.auth_serializers import EmailOrUsernameTokenObtainPairView
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.http import JsonResponse
from rest_framework import status
from rest_framework.parsers import MultiPartParser, FormParser
from django.contrib.auth import get_user_model
from accounts.totp_views import TOTPStatusView, TOTPSetupView, TOTPEnableView, TOTPDisableView
from django.utils import timezone


class MeView(APIView):
    """Return basic info about current authenticated user.

    Minimal payload used by frontend for avatar/initials.
    """
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request, *args, **kwargs):  # pragma: no cover - simple serialization
        u = request.user
        # Remaining subscription days (if subscriptions app present and user has one)
        remaining_days = 0
        sub = getattr(u, 'subscription', None)
        if sub is not None and getattr(sub, 'end_at', None):
            now = timezone.now()
            delta = sub.end_at - now
            remaining_days = max(0, delta.days)
        return Response({
            'id': u.id,
            'username': u.username,
            'display_name': getattr(u, 'display_name', ''),
            'email': u.email,
            'first_name': u.first_name,
            'last_name': u.last_name,
            'phone': getattr(u, 'phone', ''),
            'country_code': getattr(u, 'country_code', ''),
            'initials': (u.first_name[:1] + u.last_name[:1]).upper() if (u.first_name or u.last_name) else (u.username[:2].upper() if u.username else ''),
            'logo_url': (request.build_absolute_uri(u.logo.url) if getattr(u, 'logo', None) else None),
            'subscription_remaining_days': remaining_days,
        })

    def patch(self, request, *args, **kwargs):
        """Allow updating first_name, last_name, and phone"""
        u = request.user
        # display_name is intentionally NOT updatable here; admin only via Django Admin.
        allowed = ['first_name', 'last_name', 'phone']
        for k in allowed:
            if k in request.data:
                setattr(u, k, request.data.get(k))
        u.save()
        return self.get(request, *args, **kwargs)

    def post(self, request, *args, **kwargs):
        action = request.query_params.get('action') or request.data.get('action')
        u = request.user
        if action == 'change_password':
            old = request.data.get('old_password')
            new = request.data.get('new_password')
            if not old or not new:
                return Response({'detail': 'old_password and new_password required'}, status=status.HTTP_400_BAD_REQUEST)
            if not u.check_password(old):
                return Response({'detail': 'كلمة المرور الحالية غير صحيحة'}, status=status.HTTP_400_BAD_REQUEST)
            u.set_password(new)
            u.mark_password_changed()
            u.save()
            return Response({'detail': 'تم تغيير كلمة السر بنجاح'})
        if action == 'upload_logo':
            file = request.FILES.get('logo')
            if not file:
                return Response({'detail': 'الرجاء اختيار صورة'}, status=status.HTTP_400_BAD_REQUEST)
            u.logo = file
            u.save()
            return Response({'detail': 'تم تحديث الصورة', 'logo_url': (request.build_absolute_uri(u.logo.url) if u.logo else None)})
        return Response({'detail': 'Unsupported action'}, status=status.HTTP_400_BAD_REQUEST)

urlpatterns = [
    path('admin/', admin.site.urls),
    # Health check endpoint
    path('health', lambda request: JsonResponse({"status": "ok"})),
    # Auth endpoints MUST come before the catch-all /api/ include
    path('api/auth/token/', EmailOrUsernameTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('api/auth/token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('api/auth/token/verify/', TokenVerifyView.as_view(), name='token_verify'),
    path('api/auth/me/', MeView.as_view(), name='auth_me'),
    # App includes
    path('api/', include('communications.urls')),
    path('api/subscriptions/', include('subscriptions.urls')),
    # TOTP endpoints
    path('api/auth/totp/status', TOTPStatusView.as_view(), name='totp_status'),
    path('api/auth/totp/setup', TOTPSetupView.as_view(), name='totp_setup'),
    path('api/auth/totp/enable', TOTPEnableView.as_view(), name='totp_enable'),
    path('api/auth/totp/disable', TOTPDisableView.as_view(), name='totp_disable'),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
