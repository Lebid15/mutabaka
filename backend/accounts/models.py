from __future__ import annotations
from django.db import models
from django.contrib.auth.models import AbstractUser
from django.utils import timezone


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
