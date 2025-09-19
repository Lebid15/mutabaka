from django.core.management.base import BaseCommand
from finance.models import Currency

DEFAULTS = [
    {"code": "USD", "name": "دولار", "symbol": "$", "precision": 2},
    {"code": "TRY", "name": "تركي", "symbol": "₺", "precision": 2},
    {"code": "EUR", "name": "يورو", "symbol": "€", "precision": 2},
    {"code": "SYP", "name": "سوري", "symbol": "SP", "precision": 0},
]

class Command(BaseCommand):
    help = "Seed default currencies if they don't exist"

    def handle(self, *args, **options):
        created = 0
        for data in DEFAULTS:
            obj, was_created = Currency.objects.get_or_create(code=data["code"], defaults=data)
            if was_created:
                created += 1
        self.stdout.write(self.style.SUCCESS(f"Currencies seeding complete. Newly created: {created}"))
