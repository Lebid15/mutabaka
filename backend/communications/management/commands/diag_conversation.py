from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from communications.models import Conversation, Message, ConversationReadMarker


class Command(BaseCommand):
    help = "Diagnose message delivery/read state for a conversation (two‑state model)."

    def add_arguments(self, parser):
        parser.add_argument('conversation_id', type=int, help='Conversation ID')
        parser.add_argument('--limit', type=int, default=30, help='How many most recent messages to show (default 30)')

    def handle(self, *args, **options):
        conv_id = options['conversation_id']
        limit = options['limit']
        try:
            conv = Conversation.objects.get(id=conv_id)
        except Conversation.DoesNotExist:
            raise CommandError(f"Conversation {conv_id} not found")

        user_a_id = conv.user_a_id
        user_b_id = conv.user_b_id
        self.stdout.write(f"Conversation {conv_id}: users=({user_a_id},{user_b_id})")

        # Read markers
        markers = {m.user_id: m.last_read_message_id for m in ConversationReadMarker.objects.filter(conversation_id=conv_id)}
        self.stdout.write(f"Markers: {markers or '{}'}")

        msgs = list(Message.objects.filter(conversation_id=conv_id).order_by('-id')[:limit])
        msgs.reverse()  # ascending for readability

        rows = []
        for m in msgs:
            # Expected read for sender if counterpart marker >= id
            sender_id = m.sender_id
            other_id = user_b_id if sender_id == user_a_id else user_a_id
            marker_other = markers.get(other_id, 0)
            expected_read = marker_other >= m.id
            anomaly = []
            if expected_read and m.delivery_status < 2:
                anomaly.append('EXPECTED_READ_NOT_PERSISTED')
            if m.delivery_status == 2 and not m.read_at:
                anomaly.append('STATUS2_NO_READ_AT')
            if m.delivery_status == 1 and m.read_at:
                anomaly.append('READ_AT_STATUS1')
            rows.append({
                'id': m.id,
                'sender': sender_id,
                'delivery_status': m.delivery_status,
                'delivered_at': m.delivered_at.isoformat() if m.delivered_at else None,
                'read_at': m.read_at.isoformat() if m.read_at else None,
                'expected_read': expected_read,
                'anomalies': anomaly,
            })

        self.stdout.write("Messages (old -> new):")
        for r in rows:
            self.stdout.write(str(r))

        # Summary
        total = len(rows)
        exp_not_persisted = sum(1 for r in rows if 'EXPECTED_READ_NOT_PERSISTED' in r['anomalies'])
        self.stdout.write("Summary:")
        self.stdout.write(
            f"  total_messages_listed={total}\n"
            f"  expected_read_not_persisted={exp_not_persisted}\n"
            f"  marker_user_ids={list(markers.keys())}"
        )
        if exp_not_persisted:
            self.stdout.write(self.style.WARNING("Some messages expected to be read are still delivery_status=1. Likely causes: recipient WS not triggering, or code version mismatch in running container."))
        else:
            self.stdout.write(self.style.SUCCESS("No missing persisted reads among the listed messages."))
