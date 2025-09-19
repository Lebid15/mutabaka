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
