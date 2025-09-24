from django.core.management.base import BaseCommand
from communications.models import Message, ConversationReadMarker
from django.db import models
from django.db import transaction

class Command(BaseCommand):
    help = "Backfill delivery_status=2 for any messages that have read_at set but delivery_status < 2; also set delivery_status=1 where delivered_at set but status<1."

    def handle(self, *args, **options):
        with transaction.atomic():
            legacy_fixed = Message.objects.filter(delivery_status=0).update(delivery_status=1)
            updated_read = Message.objects.filter(read_at__isnull=False, delivery_status__lt=2).update(delivery_status=2)
            updated_delivered = Message.objects.filter(delivered_at__isnull=False, delivery_status__lt=1).update(delivery_status=1)
            marker_upgraded = 0
            for m in ConversationReadMarker.objects.all().values('conversation_id','user_id','last_read_message_id'):
                last_id = m['last_read_message_id'] or 0
                if not last_id:
                    continue
                qs = Message.objects.filter(conversation_id=m['conversation_id'], id__lte=last_id).exclude(sender_id=m['user_id']).filter(delivery_status__lt=2)
                # Promote and stamp read_at where missing
                marker_upgraded += qs.update(delivery_status=2, read_at=models.functions.Now())
        self.stdout.write(self.style.SUCCESS(f"Legacy0->1: {legacy_fixed}, read_at->2: {updated_read}, delivered->1: {updated_delivered}, marker_upgraded: {marker_upgraded}"))
