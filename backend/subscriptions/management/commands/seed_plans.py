from django.core.management.base import BaseCommand

from subscriptions.models import SubscriptionPlan


PLANS = [
    {"code": "silver", "name": "Silver"},
    {"code": "golden", "name": "Golden"},
    {"code": "king", "name": "King"},
]


class Command(BaseCommand):
    help = "Seed the fixed subscription plans (silver/golden/king)"

    def handle(self, *args, **options):
        created = 0
        updated = 0
        for p in PLANS:
            obj, was_created = SubscriptionPlan.objects.update_or_create(
                code=p["code"], defaults={"name": p.get("name", p["code"]) }
            )
            created += 1 if was_created else 0
            updated += 0 if was_created else 1
        self.stdout.write(self.style.SUCCESS(f"Plans seeded. created={created}, updated={updated}"))
