from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import models, transaction
from django.utils import timezone


class SubscriptionPlan(models.Model):
    CODE_CHOICES = [
        ("trial", "مجاني"),
        ("silver", "Silver"),
        ("golden", "Golden"),
        ("king", "King"),
    ]

    code = models.CharField(max_length=20, unique=True, choices=CODE_CHOICES)
    name = models.CharField(max_length=100, blank=True, null=True)
    monthly_price = models.DecimalField(max_digits=10, decimal_places=2, blank=True, null=True)
    yearly_price = models.DecimalField(max_digits=10, decimal_places=2, blank=True, null=True)
    yearly_discount_percent = models.PositiveIntegerField(blank=True, null=True, help_text="Optional displayed discount for yearly plan")

    class Meta:
        verbose_name = "Subscription Plan"
        verbose_name_plural = "Subscription Plans"

    def __str__(self) -> str:  # pragma: no cover - trivial
        return self.name or self.code


class UserSubscription(models.Model):
    STATUS_ACTIVE = "active"
    STATUS_EXPIRED = "expired"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_EXPIRED, "Expired"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="subscription")
    plan = models.ForeignKey(SubscriptionPlan, on_delete=models.PROTECT, related_name="subscriptions")
    start_at = models.DateTimeField()
    end_at = models.DateTimeField()
    last_renewed_at = models.DateTimeField(blank=True, null=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    notes = models.TextField(blank=True, null=True)
    auto_renew = models.BooleanField(default=False, help_text="Reserved for future behavior; no effect now")

    class Meta:
        verbose_name = "User Subscription"
        verbose_name_plural = "User Subscriptions"

    def __str__(self):  # pragma: no cover - trivial
        return f"{self.user} → {self.plan} ({self.status})"

    @property
    def is_active(self) -> bool:
        now = timezone.now()
        return self.status == self.STATUS_ACTIVE and self.start_at <= now <= self.end_at

    def update_status_from_dates(self):
        now = timezone.now()
        if self.status == self.STATUS_CANCELLED:
            return
        self.status = self.STATUS_ACTIVE if self.start_at <= now <= self.end_at else self.STATUS_EXPIRED

    def extend(self, months: int, use_from: Optional[datetime] = None):
        """Extend subscription by N months.

        Rule: start from max(today, end_at).
        For now monthly=30 days per month, yearly=12*30 days for simplicity.
        """
        base = use_from or timezone.now()
        start_base = max(base, self.end_at)
        delta_days = 30 * months
        self.start_at = start_base if start_base > self.end_at else self.start_at
        self.end_at = start_base + timedelta(days=delta_days)
        self.last_renewed_at = timezone.now()
        self.update_status_from_dates()


class RenewalRequest(models.Model):
    PERIOD_MONTHLY = "monthly"
    PERIOD_YEARLY = "yearly"
    PERIOD_CHOICES = [
        (PERIOD_MONTHLY, "Monthly"),
        (PERIOD_YEARLY, "Yearly"),
    ]

    STATUS_PENDING = "pending"
    STATUS_APPROVED = "approved"
    STATUS_REJECTED = "rejected"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_APPROVED, "Approved"),
        (STATUS_REJECTED, "Rejected"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="renewal_requests")
    plan = models.ForeignKey(SubscriptionPlan, on_delete=models.PROTECT, related_name="renewal_requests")
    period = models.CharField(max_length=20, choices=PERIOD_CHOICES)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    created_at = models.DateTimeField(auto_now_add=True)

    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="approved_renewals")
    approved_at = models.DateTimeField(blank=True, null=True)
    rejected_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="rejected_renewals")
    rejected_at = models.DateTimeField(blank=True, null=True)
    rejection_reason = models.TextField(blank=True, null=True)

    amount = models.DecimalField(max_digits=10, decimal_places=2, blank=True, null=True)
    payment_method = models.CharField(max_length=50, default="cash")

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Renewal Request"
        verbose_name_plural = "Renewal Requests"

    def __str__(self):  # pragma: no cover - trivial
        return f"RenewalRequest({self.user}, {self.plan.code}, {self.period}, {self.status})"

    @classmethod
    def has_open_pending(cls, user) -> bool:
        return cls.objects.filter(user=user, status=cls.STATUS_PENDING).exists()

    @transaction.atomic
    def approve(self, admin_user=None) -> UserSubscription:
        if self.status != self.STATUS_PENDING:
            raise ValueError("Only pending requests can be approved")
        now = timezone.now()
        months = 12 if self.period == self.PERIOD_YEARLY else 1

        # ensure user subscription exists or create new
        sub, created = UserSubscription.objects.select_for_update().get_or_create(
            user=self.user,
            defaults={
                "plan": self.plan,
                "start_at": now,
                "end_at": now,  # will be extended below
                "status": UserSubscription.STATUS_EXPIRED,
            },
        )
        # if upgrading plan at request time, apply
        sub.plan = self.plan
        sub.extend(months)
        sub.save()

        self.status = self.STATUS_APPROVED
        if admin_user is not None:
            self.approved_by = admin_user
        self.approved_at = now
        self.save()
        return sub

    @transaction.atomic
    def reject(self, admin_user, reason: Optional[str] = None):
        if self.status != self.STATUS_PENDING:
            raise ValueError("Only pending requests can be rejected")
        self.status = self.STATUS_REJECTED
        self.rejected_by = admin_user
        self.rejected_at = timezone.now()
        self.rejection_reason = reason
        self.save()
