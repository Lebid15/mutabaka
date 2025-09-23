from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from django.contrib.auth import get_user_model, authenticate
from rest_framework import serializers
from django.contrib.auth.hashers import make_password
from django.utils import timezone
import os
try:
    import pyotp
except Exception:
    pyotp = None

User = get_user_model()

class EmailOrUsernameTokenObtainPairSerializer(TokenObtainPairSerializer):
    username_field = User.USERNAME_FIELD

    def validate(self, attrs):
        # Allow either username or email field in input. Accept both keys for clarity.
        raw_username = attrs.get(self.username_field, None)
        email = self.initial_data.get('email')
        identifier = email or raw_username
        if not identifier:
            raise serializers.ValidationError({'detail': 'Username or email required'})
        password = self.initial_data.get('password')
        user = None
        # Try username exact match first
        if user is None:
            try:
                user = User.objects.get(username__iexact=identifier)
            except User.DoesNotExist:
                user = None
        # Try email fallback
        if user is None:
            try:
                user = User.objects.get(email__iexact=identifier)
            except User.DoesNotExist:
                user = None
        if user is None:
            raise serializers.ValidationError({'detail': 'No active account found'})
        if not user.check_password(password):
            raise serializers.ValidationError({'detail': 'No active account found'})
        # If user has TOTP enabled, require 6-digit code
        if getattr(user, 'totp_enabled', False):
            otp = (self.initial_data.get('otp') or '').strip()
            if not otp:
                raise serializers.ValidationError({'otp_required': True, 'detail': 'OTP required'})
            if pyotp is None:
                raise serializers.ValidationError({'detail': 'TOTP not available'})
            totp = pyotp.TOTP(getattr(user, 'totp_secret', '') or '')
            if not getattr(user, 'totp_secret', '') or not totp.verify(otp, valid_window=1):
                raise serializers.ValidationError({'otp_required': True, 'detail': 'Invalid OTP'})
        attrs[self.username_field] = user.username
        data = super().validate(attrs)
        # PIN channel check
        try:
            request = self.context.get('request') if hasattr(self, 'context') else None
        except Exception:
            request = None
        client = ''
        if request is not None:
            client = (request.headers.get('X-Client') or request.META.get('HTTP_X_CLIENT') or '').strip().lower()
        raw = os.environ.get('PIN_REQUIRE_CHANNELS', 'mobile')
        channels = {x.strip().lower() for x in raw.split(',') if x.strip()}
        if client in channels:
            # First mobile login: generate a 6-digit PIN and return it once
            if not getattr(user, 'pin_hash', ''):
                import secrets
                pin = f"{secrets.randbelow(1_000_000):06d}"
                try:
                    pin_hash = make_password(pin, hasher='argon2')
                except Exception:
                    pin_hash = make_password(pin)
                user.pin_hash = pin_hash
                user.pin_initialized_at = timezone.now()
                user.pin_failed_attempts = 0
                user.pin_locked_until = None
                user.save(update_fields=['pin_hash', 'pin_initialized_at', 'pin_failed_attempts', 'pin_locked_until'])
                data['pin'] = pin
            else:
                data['pin_required'] = True
        return data

from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework.throttling import ScopedRateThrottle

class EmailOrUsernameTokenObtainPairView(TokenObtainPairView):
    serializer_class = EmailOrUsernameTokenObtainPairSerializer
    throttle_scope = 'auth_token'
    throttle_classes = [ScopedRateThrottle]

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['request'] = self.request
        return ctx