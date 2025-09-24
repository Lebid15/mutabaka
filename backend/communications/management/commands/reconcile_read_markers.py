from django.core.management.base import BaseCommand
from django.utils import timezone
from django.db import models as dj_models

from communications.models import ConversationReadMarker, Message


class Command(BaseCommand):
    help = "Reconcile Message.read_at / delivery_status from ConversationReadMarker ground truth."

    def add_arguments(self, parser):
        parser.add_argument('--conversation', type=int, help='Limit to a single conversation id')
        parser.add_argument('--dry-run', action='store_true', help='Do not write updates, just report counts')
        parser.add_argument('--batch', type=int, default=10000, help='Max messages to update per marker in one go')

    def handle(self, *args, **options):
        conv_limit = options.get('conversation')
        dry = options.get('dry_run')
        batch = options.get('batch') or 10000
        total_markers = 0
        total_candidate_msgs = 0
        total_updated = 0
        now = timezone.now()
        qs = ConversationReadMarker.objects.all().select_related('conversation')
        if conv_limit:
            qs = qs.filter(conversation_id=conv_limit)
        for marker in qs.iterator():
            total_markers += 1
            # Messages that user (marker.user) has read are those sent by the OTHER participant(s) with id <= marker.last_read_message_id
            if not marker.last_read_message_id:
                continue
            msgs_qs = (Message.objects
                       .filter(conversation_id=marker.conversation_id,
                               id__lte=marker.last_read_message_id)
                       .exclude(sender_id=marker.user_id)
                       .filter(delivery_status__lt=2))
            candidate_ids = list(msgs_qs.order_by('id').values_list('id', flat=True)[:batch])
            cand_count = len(candidate_ids)
            if cand_count == 0:
                continue
            total_candidate_msgs += cand_count
            if dry:
                self.stdout.write(f"[DRY] conv={marker.conversation_id} user={marker.user_id} candidates={cand_count}")
                continue
            upd = (Message.objects
                   .filter(id__in=candidate_ids)
                   .update(
                       read_at=now,
                       delivered_at=dj_models.Case(
                           dj_models.When(delivered_at__isnull=True, then=dj_models.Value(now)),
                           default=dj_models.F('delivered_at')
                       ),
                       delivery_status=dj_models.Value(2)
                   ))
            total_updated += upd
            self.stdout.write(f"Updated conv={marker.conversation_id} user={marker.user_id} msgs={upd}")

        self.stdout.write(f"Summary: markers_scanned={total_markers} candidates={total_candidate_msgs} updated={total_updated} dry_run={dry}")
