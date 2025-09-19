from django.db.models.signals import post_save
from django.dispatch import receiver
from django.conf import settings
from .models import Wallet, Currency

User = settings.AUTH_USER_MODEL

@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def create_wallets_for_new_user(sender, instance, created, **kwargs):
    if not created:
        return
    currencies = Currency.objects.filter(is_active=True)
    for cur in currencies:
        Wallet.objects.get_or_create(user=instance, currency=cur)
