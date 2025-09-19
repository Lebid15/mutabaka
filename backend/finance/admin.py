from django.contrib import admin
from .models import Currency, Wallet

@admin.register(Currency)
class CurrencyAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "symbol", "precision", "is_active")
    list_filter = ("is_active",)
    search_fields = ("code", "name")

@admin.register(Wallet)
class WalletAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "currency", "balance", "updated_at")
    list_filter = ("currency", "user")
    search_fields = ("user__username", "currency__code")
