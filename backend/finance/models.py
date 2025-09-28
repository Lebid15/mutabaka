from __future__ import annotations
from django.db import models
from django.conf import settings
from django.core.validators import MinValueValidator
from decimal import Decimal

User = settings.AUTH_USER_MODEL

class Currency(models.Model):
    code = models.CharField(max_length=8, unique=True)  # USD, TRY...
    name = models.CharField(max_length=64)
    symbol = models.CharField(max_length=8, blank=True)
    precision = models.PositiveSmallIntegerField(default=2)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["code"]

    def __str__(self):
        return f"{self.code}"

class Wallet(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='wallets')
    currency = models.ForeignKey(Currency, on_delete=models.CASCADE, related_name='wallets')
    # Allow large aggregates while keeping 5 decimal places of precision
    balance = models.DecimalField(
        max_digits=28,
        decimal_places=5,
        default=0,
        validators=[MinValueValidator(Decimal('-99999999999999999999999'))]
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("user", "currency")
        ordering = ["user", "currency"]

    def __str__(self):
        return f"Wallet({self.user}:{self.currency.code}={self.balance})"
