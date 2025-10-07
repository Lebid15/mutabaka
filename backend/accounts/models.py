from __future__ import annotations
from django.db import models
from django.db.models import Q
from django.contrib.auth.models import AbstractUser
from django.utils import timezone
from django.utils.crypto import constant_time_compare
from django.core.exceptions import ValidationError
from django.conf import settings
import hashlib
import secrets
import uuid
import os


def _generate_device_id() -> str:
    # 32-character url-safe token (approx 192 bits entropy)
    return secrets.token_urlsafe(24)[:48]


def _generate_pending_token() -> str:
    return secrets.token_urlsafe(32)


class CustomUser(AbstractUser):
    """Custom user model with additional profile fields.

    Non-editable by the user: username, email (إلا من لوحة المالك), country_code.
    Editable by the user: first_name, last_name, phone, logo, password.
    """
    country_code = models.CharField(max_length=6, blank=True, help_text="International calling code like +90")
    phone = models.CharField(max_length=32, blank=True)
    phone_e164 = models.CharField(max_length=40, blank=True, editable=False, help_text="Normalized full phone number")
    logo = models.ImageField(upload_to='user_logos/', blank=True, null=True)
    display_name = models.CharField(max_length=150, blank=True, help_text="Public display name shown in chats and search")
    created_by = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='created_users')
    last_password_change = models.DateTimeField(null=True, blank=True)
    # Two-Factor Auth (TOTP)
    totp_secret = models.CharField(max_length=64, blank=True, default="", help_text="Base32 secret for TOTP; empty = not configured")
    totp_enabled = models.BooleanField(default=False)
    # Mobile PIN (6 digits) - stored as hash (argon2 if available)
    pin_hash = models.CharField(max_length=256, blank=True, default="")
    pin_initialized_at = models.DateTimeField(null=True, blank=True)
    pin_failed_attempts = models.IntegerField(default=0)
    pin_locked_until = models.DateTimeField(null=True, blank=True)
    pin_enabled = models.BooleanField(default=False, help_text="Whether local device PIN login is currently allowed")
    pin_epoch = models.PositiveIntegerField(default=0, help_text="Bumps whenever admin resets to invalidate local caches")

    def save(self, *args, **kwargs):
        # basic normalization for e164 (simple concatenation, can be replaced by phonenumbers lib)
        if self.country_code and self.phone:
            raw = f"{self.country_code}{self.phone}".replace(' ', '')
            self.phone_e164 = raw
        # Ensure password hashed if someone assigned raw value directly (no admin logic path)
        if self.password and not self.password.startswith('pbkdf2_'):
            # Only set new hash if it's not already a valid algorithm signature.
            raw_pw = self.password
            from django.contrib.auth.hashers import make_password
            self.password = make_password(raw_pw)
            if not self.last_password_change:
                self.last_password_change = timezone.now()
        super().save(*args, **kwargs)

    def mark_password_changed(self):
        self.last_password_change = timezone.now()
        self.save(update_fields=["last_password_change"])  # pragma: no cover

    def __str__(self):
        return self.username


class TrustedDevice(models.Model):
    """Trusted devices per user for mobile channel.

    Approval is limited to a maximum of 2 devices per user.
    """
    user = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="trusted_devices")
    fingerprint = models.CharField(max_length=128, help_text="Stable device fingerprint provided by the app")
    device_name = models.CharField(max_length=120, blank=True)
    platform = models.CharField(max_length=40, blank=True, help_text="ios|android|other")
    approved_at = models.DateTimeField(null=True, blank=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "fingerprint")
        indexes = [
            models.Index(fields=["user", "approved_at"]),
            models.Index(fields=["user", "fingerprint"]),
        ]

    def __str__(self):  # pragma: no cover - debug convenience
        status = "approved" if self.approved_at else "pending"
        return f"{self.user_id}:{self.fingerprint[:6]} ({status})"


class UserSecurityAudit(models.Model):
    ACTION_PIN_RESET = 'pin_reset'
    ACTION_CHOICES = (
        (ACTION_PIN_RESET, 'PIN Reset'),
    )

    subject = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='security_audit_entries')
    actor = models.ForeignKey(CustomUser, on_delete=models.SET_NULL, null=True, blank=True, related_name='security_actions_performed')
    action = models.CharField(max_length=64, choices=ACTION_CHOICES)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['subject', 'created_at']),
            models.Index(fields=['action', 'created_at']),
        ]

    def __str__(self):  # pragma: no cover - debug convenience
        subject = getattr(self.subject, 'username', self.subject_id)
        actor = getattr(self.actor, 'username', self.actor_id)
        return f"{self.get_action_display()} for {subject} by {actor} at {self.created_at:%Y-%m-%d %H:%M:%S}"


class UserDevice(models.Model):
    class Status(models.TextChoices):
        PRIMARY = 'primary', 'Primary'
        ACTIVE = 'active', 'Active'
        PENDING = 'pending', 'Pending'
        REVOKED = 'revoked', 'Revoked'

    id = models.CharField(primary_key=True, max_length=64, default=_generate_device_id, editable=False)
    user = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='devices')
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    label = models.CharField(max_length=120, blank=True)
    platform = models.CharField(max_length=40, blank=True)
    app_version = models.CharField(max_length=40, blank=True)
    push_token = models.CharField(max_length=256, blank=True)
    is_web = models.BooleanField(default=False, help_text="Whether this device represents a linked web/browser session")
    device_fingerprint = models.CharField(max_length=128, blank=True, null=True, db_index=True, help_text='Hardware fingerprint - identifies physical device across browsers')
    stored_device_id = models.CharField(max_length=128, blank=True, null=True, help_text='Device ID from localStorage (secondary identifier)')
    created_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    pending_token = models.CharField(max_length=96, blank=True)
    pending_expires_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=['user', 'status']),
            models.Index(fields=['pending_token']),
            models.Index(fields=['user', 'last_seen_at']),
            models.Index(fields=['user', 'is_web']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['user'],
                condition=Q(status='primary'),
                name='unique_primary_device_per_user'
            ),
        ]

    def mark_seen(self):
        self.last_seen_at = timezone.now()
        self.save(update_fields=['last_seen_at'])

    def issue_pending_token(self, minutes_valid: int = 15) -> str:
        token = _generate_pending_token()
        self.pending_token = token
        self.pending_expires_at = timezone.now() + timezone.timedelta(minutes=minutes_valid)
        self.save(update_fields=['pending_token', 'pending_expires_at'])
        return token

    def clear_pending_token(self):
        self.pending_token = ''
        self.pending_expires_at = None
        self.save(update_fields=['pending_token', 'pending_expires_at'])

    def set_status(self, status: str, *, save: bool = True):
        if status not in self.Status.values:
            raise ValueError('Invalid status')
        self.status = status
        if save:
            self.save(update_fields=['status'])

    def __str__(self):  # pragma: no cover - debug read
        return f"{self.user_id}:{self.id}({self.status})"


def _hash_token(value: str) -> str:
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


class WebLoginSession(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        APPROVED = 'approved', 'Approved'
        CONSUMED = 'consumed', 'Consumed'
        EXPIRED = 'expired', 'Expired'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    token_hash = models.CharField(max_length=128, unique=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    user = models.ForeignKey(CustomUser, null=True, blank=True, on_delete=models.SET_NULL, related_name='web_login_sessions')
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_device = models.ForeignKey(UserDevice, null=True, blank=True, on_delete=models.SET_NULL, related_name='login_sessions')
    approval_ip = models.GenericIPAddressField(null=True, blank=True)
    consumed_at = models.DateTimeField(null=True, blank=True)
    access_token = models.TextField(blank=True)
    refresh_token = models.TextField(blank=True)
    device_fingerprint = models.CharField(max_length=128, blank=True, null=True, help_text='Hardware fingerprint from browser')
    stored_device_id = models.CharField(max_length=128, blank=True, null=True, help_text='Device ID from localStorage (if available)')

    class Meta:
        ordering = ('-created_at',)
        indexes = [
            models.Index(fields=['status', 'expires_at']),
            models.Index(fields=['created_at']),
        ]

    @property
    def is_expired(self) -> bool:
        return timezone.now() >= self.expires_at

    def mark_expired(self, *, save: bool = True) -> None:
        self.status = self.Status.EXPIRED
        if save:
            self.save(update_fields=['status'])

    def matches_token(self, raw_token: str) -> bool:
        hashed = _hash_token(raw_token)
        return constant_time_compare(hashed, self.token_hash)

    @classmethod
    def create_new(cls, ttl_seconds: int = 90) -> tuple['WebLoginSession', str]:
        raw_token = secrets.token_urlsafe(32)
        expires_at = timezone.now() + timezone.timedelta(seconds=max(30, ttl_seconds))
        session = cls.objects.create(
            expires_at=expires_at,
            token_hash=_hash_token(raw_token),
        )
        return session, raw_token

    def __str__(self) -> str:  # pragma: no cover - debug helper
        return f"LoginSession({self.id})[{self.status}]"


def validate_png_only(file):
    """Validator to ensure only PNG images are uploaded"""
    if not file:
        return
    ext = os.path.splitext(file.name)[1].lower()
    if ext != '.png':
        raise ValidationError('فقط ملفات PNG مسموح بها (Only PNG files are allowed)')


class SiteSettings(models.Model):
    """Global site settings - singleton pattern"""
    notification_icon = models.ImageField(
        upload_to='notification_icons/',
        blank=True,
        null=True,
        validators=[validate_png_only],
        help_text='أيقونة الإشعارات (PNG فقط) - تظهر في شريط الحالة بجانب البطارية'
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'إعدادات الموقع'
        verbose_name_plural = 'إعدادات الموقع'

    def save(self, *args, **kwargs):
        # Enforce singleton pattern
        self.pk = 1
        super().save(*args, **kwargs)
        # Clear cache after saving
        self._clear_cache()

    @classmethod
    def load(cls):
        """Get or create the singleton instance"""
        obj, created = cls.objects.get_or_create(pk=1)
        return obj

    @staticmethod
    def _clear_cache():
        """Clear the cached instance in site_settings module"""
        try:
            from .site_settings import clear_site_settings_cache
            clear_site_settings_cache()
        except ImportError:
            pass

    def get_notification_icon_url(self):
        """Get the full URL for the notification icon"""
        if self.notification_icon:
            return f"{settings.MEDIA_URL}{self.notification_icon.name}"
        return None

    def __str__(self):
        return 'إعدادات الموقع'
