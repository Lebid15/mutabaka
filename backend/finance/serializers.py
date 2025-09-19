from rest_framework import serializers
from .models import Wallet, Currency

class CurrencyListSerializer(serializers.ModelSerializer):
    class Meta:
        model = Currency
        fields = ["id", "code", "symbol", "name", "precision", "is_active"]

class CurrencyBasicSerializer(serializers.ModelSerializer):
    class Meta:
        model = Currency
        fields = ["id", "code", "symbol", "name", "precision"]

class WalletSerializer(serializers.ModelSerializer):
    currency = CurrencyBasicSerializer(read_only=True)

    class Meta:
        model = Wallet
        fields = ["id", "currency", "balance", "updated_at"]
