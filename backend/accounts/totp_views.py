from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status
from django.contrib.auth import get_user_model
import os
import base64
try:
    import pyotp
except Exception:  # pragma: no cover
    pyotp = None

User = get_user_model()

def _gen_secret():
    # 20 bytes random base32
    raw = os.urandom(20)
    return base64.b32encode(raw).decode('utf-8').rstrip('=')

class TOTPStatusView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        u = request.user
        return Response({
            'enabled': bool(getattr(u, 'totp_enabled', False)),
            'has_secret': bool(getattr(u, 'totp_secret', '')),
        })

class TOTPSetupView(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request):
        if pyotp is None:
            return Response({'detail': 'TOTP library missing'}, status=500)
        u = request.user
        # generate new secret and save to user (not enabled yet)
        secret = _gen_secret()
        u.totp_secret = secret
        if getattr(u, 'totp_enabled', False) is False:
            # keep disabled until user verifies code
            pass
        u.save(update_fields=['totp_secret'])
        issuer = request.get_host() or 'Mutabaka'
        label = f"{issuer}:{u.username}"
        uri = pyotp.totp.TOTP(secret).provisioning_uri(name=label, issuer_name=issuer)
        return Response({'secret': secret, 'otpauth_uri': uri})

class TOTPEnableView(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request):
        if pyotp is None:
            return Response({'detail': 'TOTP library missing'}, status=500)
        u = request.user
        code = (request.data.get('otp') or '').strip()
        if not getattr(u, 'totp_secret', ''):
            return Response({'detail': 'No secret configured'}, status=400)
        totp = pyotp.TOTP(u.totp_secret)
        if not code or not totp.verify(code, valid_window=1):
            return Response({'detail': 'Invalid code'}, status=400)
        u.totp_enabled = True
        u.save(update_fields=['totp_enabled'])
        return Response({'enabled': True})

class TOTPDisableView(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request):
        if pyotp is None:
            return Response({'detail': 'TOTP library missing'}, status=500)
        u = request.user
        code = (request.data.get('otp') or '').strip()
        if not getattr(u, 'totp_secret', ''):
            return Response({'detail': 'No secret configured'}, status=400)
        totp = pyotp.TOTP(u.totp_secret)
        if not code or not totp.verify(code, valid_window=1):
            return Response({'detail': 'Invalid code'}, status=400)
        u.totp_enabled = False
        u.save(update_fields=['totp_enabled'])
        return Response({'enabled': False})
