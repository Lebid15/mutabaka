from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated
from .models import Wallet, Currency
from .serializers import WalletSerializer, CurrencyListSerializer
from rest_framework import viewsets as drf_viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

class CurrencyViewSet(drf_viewsets.ReadOnlyModelViewSet):
    queryset = Currency.objects.filter(is_active=True).order_by('code')
    serializer_class = CurrencyListSerializer
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=['post'])
    def bootstrap(self, request):
        """إنشاء مجموعة عملات افتراضية إذا كانت غير موجودة"""
        defaults = [
            ("USD", "دولار", "$", 2),
            ("EUR", "يورو", "€", 2),
            ("TRY", "تركي", "₺", 2),
            ("SYP", "سوري", "SP", 2),
        ]
        created = []
        for code, name, symbol, precision in defaults:
            obj, was_created = Currency.objects.get_or_create(code=code, defaults={
                'name': name,
                'symbol': symbol,
                'precision': precision,
            })
            if was_created:
                created.append(code)
        return Response({ 'created': created, 'count': Currency.objects.filter(is_active=True).count() })

class WalletViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = WalletSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Wallet.objects.filter(user=self.request.user).select_related('currency')
