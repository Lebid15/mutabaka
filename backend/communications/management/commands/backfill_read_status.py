from django.core.management.base import BaseCommand
from communications.models import Message
from django.db import transaction

class Command(BaseCommand):
    help = "Backfill delivery_status=2 for any messages that have read_at set but delivery_status < 2; also set delivery_status=1 where delivered_at set but status<1."

    def handle(self, *args, **options):
        updated_read = 0
        updated_delivered = 0
        with transaction.atomic():
            qs_read = Message.objects.filter(read_at__isnull=False, delivery_status__lt=2)
            updated_read = qs_read.update(delivery_status=2)
            qs_delivered = Message.objects.filter(delivered_at__isnull=False, delivery_status__lt=1)
            updated_delivered = qs_delivered.update(delivery_status=1)
        self.stdout.write(self.style.SUCCESS(f"Updated read ->2: {updated_read}, delivered ->1: {updated_delivered}"))
