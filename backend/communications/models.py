from __future__ import annotations
from django.db import models, transaction
from django.conf import settings
from django.utils import timezone
from finance.models import Currency, Wallet
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
from django.contrib.auth import get_user_model

UserModel = get_user_model()

User = settings.AUTH_USER_MODEL

class NotificationSetting(models.Model):
    """Singleton-like settings for notification configuration.

    Admin can upload a single sound file to be used for in-app notification sound.
    We won't strictly enforce single row at DB level; the latest active row will be used.
    """
    sound = models.FileField(upload_to='notification_sounds/', null=True, blank=True)
    active = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-updated_at', '-id']

    def __str__(self):  # pragma: no cover
        return f"NotificationSetting(active={self.active})"


class BrandingSetting(models.Model):
    """Branding assets (logo) configurable from the admin panel."""

    logo = models.ImageField(upload_to='branding/', null=True, blank=True)
    active = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-updated_at', '-id']

    def __str__(self):  # pragma: no cover
        return f"BrandingSetting(active={self.active})"


class PrivacyPolicy(models.Model):
    """Stores privacy policy / terms content manageable from the admin."""

    DOCUMENT_TYPE_PRIVACY = 'privacy'
    DOCUMENT_TYPE_TERMS = 'terms'
    DOCUMENT_TYPE_CHOICES = [
        (DOCUMENT_TYPE_PRIVACY, 'سياسة الخصوصية'),
        (DOCUMENT_TYPE_TERMS, 'شروط الاستخدام'),
    ]

    document_type = models.CharField(
        max_length=20,
        choices=DOCUMENT_TYPE_CHOICES,
        default=DOCUMENT_TYPE_PRIVACY,
        verbose_name="نوع الوثيقة",
        help_text="حدد ما إذا كان هذا المستند سياسة خصوصية أو شروط استخدام",
    )
    title = models.CharField(max_length=200, blank=True)
    content = models.TextField(help_text="النص الكامل لسياسة الخصوصية أو شروط الاستخدام")
    is_active = models.BooleanField(default=True, verbose_name="مفعل؟")
    display_order = models.PositiveIntegerField(default=0, help_text="رتب السياسات، الأصغر يظهر أولاً")
    updated_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['document_type', 'display_order', '-updated_at']
        verbose_name = "مستند قانوني"
        verbose_name_plural = "مستندات قانونية"

    def __str__(self):  # pragma: no cover
        label = self.title.strip() if self.title else 'Policy'
        try:
            doc_label = dict(self.DOCUMENT_TYPE_CHOICES).get(self.document_type, self.document_type)
        except Exception:
            doc_label = self.document_type
        return f"{doc_label}: {label} (active={self.is_active})"


class ContactLink(models.Model):
    """Contact methods configurable from admin and shown on the login screen."""

    ICON_CHOICES = [
        ('whatsapp', 'WhatsApp'),
        ('facebook', 'Facebook'),
        ('youtube', 'YouTube'),
        ('telegram', 'Telegram'),
        ('instagram', 'Instagram'),
        ('twitter', 'Twitter / X'),
        ('tiktok', 'TikTok'),
        ('snapchat', 'Snapchat'),
        ('linkedin', 'LinkedIn'),
        ('email', 'Email'),
    ]

    icon = models.CharField(max_length=32, choices=ICON_CHOICES)
    label = models.CharField(max_length=100, blank=True, help_text="النص الظاهر بجانب الأيقونة (اختياري)")
    value = models.CharField(max_length=255, help_text="الرابط أو رقم التواصل (مثال: https://example.com أو tel:+963...)")
    is_active = models.BooleanField(default=True, verbose_name="مفعل؟")
    display_order = models.PositiveIntegerField(default=0, help_text="ترتيب العرض (الأصغر يظهر أولاً)")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['display_order', '-updated_at']
        verbose_name = "رابط تواصل"
        verbose_name_plural = "روابط تواصل"

    def __str__(self):  # pragma: no cover
        label = self.label or dict(self.ICON_CHOICES).get(self.icon, self.icon)
        return f"{label} ({self.value})"

class ContactRelation(models.Model):
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("accepted", "Accepted"),
        ("blocked", "Blocked"),
    ]
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name='contact_owner_set')
    contact = models.ForeignKey(User, on_delete=models.CASCADE, related_name='contact_target_set')
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default='accepted')  # مبدئياً مباشرة
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("owner", "contact")

    def __str__(self):
        return f"{self.owner} -> {self.contact} ({self.status})"

class Conversation(models.Model):
    user_a = models.ForeignKey(User, on_delete=models.CASCADE, related_name='conversations_a')
    user_b = models.ForeignKey(User, on_delete=models.CASCADE, related_name='conversations_b')
    created_at = models.DateTimeField(auto_now_add=True)
    last_message_at = models.DateTimeField(null=True, blank=True)
    last_activity_at = models.DateTimeField(null=True, blank=True)
    last_message_preview = models.CharField(max_length=120, blank=True)
    # طلب حذف يحتاج موافقة الطرف الآخر
    delete_requested_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='conversations_delete_requested')
    delete_requested_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ("user_a", "user_b")

    def participants(self):
        return [self.user_a, self.user_b]

    def __str__(self):
        return f"Conv({self.user_a}-{self.user_b})"

class ConversationReadMarker(models.Model):
    """Persist the last read message id per (conversation,user).

    This gives an idempotent, monotonic source of truth so that even if some
    individual Message.read_at updates were skipped (race / disconnect), the
    frontend can still render blue ticks permanently (never regress).
    """
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='read_markers')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='conversation_read_markers')
    last_read_message_id = models.BigIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("conversation", "user")
        indexes = [
            models.Index(fields=["conversation", "user"]),
            models.Index(fields=["conversation", "last_read_message_id"]),
        ]

    def __str__(self):  # pragma: no cover
        return f"ReadMarker(conv={self.conversation_id}, user={self.user_id}, last={self.last_read_message_id})"

class ConversationMute(models.Model):
    """Per-user mute state for a conversation.

    If muted_until is NULL => muted forever (MVP). If set to a future datetime => muted until that time.
    """
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='conversation_mutes')
    conversation = models.ForeignKey('Conversation', on_delete=models.CASCADE, related_name='mutes')
    muted_until = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "conversation")
        indexes = [
            models.Index(fields=["user", "conversation"]),
        ]

    def __str__(self):  # pragma: no cover
        return f"Mute(user={self.user_id}, conv={self.conversation_id}, until={self.muted_until})"

class Message(models.Model):
    TYPE_CHOICES = [
        ("text", "Text"),
        ("system", "System"),
        ("transaction", "Transaction"),
    ]
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='messages')
    # Either sent by a real user (owner) or a team sub-user acting on behalf of owner
    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sent_messages')
    sender_team_member = models.ForeignKey('TeamMember', on_delete=models.SET_NULL, null=True, blank=True, related_name='sent_messages')
    type = models.CharField(max_length=16, choices=TYPE_CHOICES, default='text')
    body = models.TextField(blank=True)
    client_id = models.CharField(max_length=64, blank=True, null=True, db_index=True)
    # Optional attachment (image or PDF)
    attachment = models.FileField(upload_to='attachments/', null=True, blank=True)
    attachment_name = models.CharField(max_length=255, blank=True)
    attachment_mime = models.CharField(max_length=100, blank=True)
    attachment_size = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    # Delivery state simplified: 1=delivered, 2=read (monotonic). Legacy 0 removed.
    delivery_status = models.PositiveSmallIntegerField(default=1)
    delivered_at = models.DateTimeField(null=True, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['conversation', 'client_id']),
        ]

    def __str__(self):
        return f"Msg({self.type}) {self.sender}: {self.body[:30]}"
    def save(self, *args, **kwargs):
        new = self.pk is None
        # Auto-upgrade delivery_status based on timestamps (defensive)
        try:
            if self.read_at and (self.delivery_status or 0) < 2:
                self.delivery_status = 2
            elif self.delivered_at and (self.delivery_status or 0) < 1:
                self.delivery_status = 1
        except Exception:
            pass
        # Ensure delivered_at is always stamped for newly created messages that are at least delivered (status>=1)
        # Missing delivered_at caused admin panel + FE inconsistency after refresh.
        if new and (self.delivery_status or 0) >= 1 and not self.delivered_at:
            from django.utils import timezone
            try:
                self.delivered_at = timezone.now()
            except Exception:
                pass
        super().save(*args, **kwargs)
        if new:
            Conversation.objects.filter(pk=self.conversation_id).update(
                last_message_at=self.created_at,
                last_activity_at=self.created_at,
                last_message_preview=(self.body[:120] if self.body else (self.attachment_name or 'مرفق'))
            )

class Transaction(models.Model):
    DIRECTION_CHOICES = [
        ("lna", "لنا"),  # استلمنا
        ("lkm", "لكم"),  # دفعنا
    ]
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='transactions')
    from_user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='transactions_from')
    to_user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='transactions_to')
    currency = models.ForeignKey(Currency, on_delete=models.PROTECT)
    amount = models.DecimalField(max_digits=28, decimal_places=5)
    direction = models.CharField(max_length=8, choices=DIRECTION_CHOICES)
    note = models.CharField(max_length=255, blank=True)
    balance_after_from = models.DecimalField(max_digits=28, decimal_places=5, null=True, blank=True)
    balance_after_to = models.DecimalField(max_digits=28, decimal_places=5, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Txn {self.amount} {self.currency.code} {self.direction}"

    @classmethod
    def create_transaction(cls, conversation, actor, currency, amount, direction, note="", sender_team_member=None):
        """Create a financial transaction between conversation participants.

        - direction:
            - 'lna' => actor received (credit us) -> actor balance +amount, other -amount
            - 'lkm' => actor paid (debit us)    -> actor balance -amount, other +amount
        - amount is rounded Half Up to 5 decimal places for storage and balance math.
        - Creates a transaction message in the conversation and updates last activity.
        """
        # Normalize and round amount to 5 dp
        def round_amount(val):
            try:
                if not isinstance(val, Decimal):
                    val = Decimal(str(val))
                return val.quantize(Decimal('0.00001'), rounding=ROUND_HALF_UP)
            except (InvalidOperation, TypeError, ValueError):
                raise ValueError("Invalid amount")

        # Format amount for message display: at least 2 dp, up to 5
        def format_display_amount(dec: Decimal) -> str:
            s = f"{dec:.5f}"
            if '.' not in s:
                return s + '.00'
            integer, frac = s.split('.')
            frac = frac.rstrip('0')
            if len(frac) < 2:
                frac = (frac + '0'*2)[:2]
            return integer + '.' + frac

        amount = round_amount(amount)

        # Validate participants
        if actor not in conversation.participants():
            raise ValueError("Actor not in conversation")
        other = conversation.user_b if actor == conversation.user_a else conversation.user_a

        # Compute balance signs
        sign_actor = 1 if direction == 'lna' else -1
        sign_other = -sign_actor

        with transaction.atomic():
            # Ensure wallets exist then lock for update
            from finance.models import Wallet  # local import to avoid potential cycles
            Wallet.objects.get_or_create(user=actor, currency=currency, defaults={"balance": 0})
            Wallet.objects.get_or_create(user=other, currency=currency, defaults={"balance": 0})

            w_actor = Wallet.objects.select_for_update().get(user=actor, currency=currency)
            w_other = Wallet.objects.select_for_update().get(user=other, currency=currency)

            w_actor.balance = (w_actor.balance + (sign_actor * amount)).quantize(Decimal('0.00001'), rounding=ROUND_HALF_UP)
            w_other.balance = (w_other.balance + (sign_other * amount)).quantize(Decimal('0.00001'), rounding=ROUND_HALF_UP)
            w_actor.save(update_fields=["balance", "updated_at"])
            w_other.save(update_fields=["balance", "updated_at"])

            txn = cls.objects.create(
                conversation=conversation,
                from_user=actor,
                to_user=other,
                currency=currency,
                amount=amount,
                direction=direction,
                note=note,
                balance_after_from=w_actor.balance,
                balance_after_to=w_other.balance,
            )

            display_amount = format_display_amount(amount)
            # Create a chat message reflecting the transaction
            chat_message = Message.objects.create(
                conversation=conversation,
                sender=actor,
                sender_team_member=sender_team_member,
                type='transaction',
                body=f"معاملة: {( 'لنا' if direction=='lna' else 'لكم')} {display_amount} {currency.symbol or currency.code}{(' - ' + note) if note else ''}".strip()
            )

            # Compute display for realtime (prefer team member if present)
            sender_display = (sender_team_member.display_name or sender_team_member.username) if sender_team_member else (getattr(actor, 'display_name', '') or actor.username)

            # Optional realtime broadcast via Channels
            try:
                from channels.layers import get_channel_layer
                from asgiref.sync import async_to_sync
                channel_layer = get_channel_layer()
                if channel_layer is not None:
                    group = f"conv_{conversation.id}"
                    preview_body = f"معاملة: {( 'لنا' if direction=='lna' else 'لكم')} {display_amount} {currency.symbol or currency.code}{(' - ' + note) if note else ''}".strip()
                    delivered_at = chat_message.delivered_at.isoformat() if chat_message.delivered_at else None
                    read_at = chat_message.read_at.isoformat() if chat_message.read_at else None
                    async_to_sync(channel_layer.group_send)(group, {
                        'type': 'broadcast.message',
                        'data': {
                            'type': 'chat.message',
                            'conversation_id': conversation.id,
                            'id': chat_message.id,
                            'message_id': chat_message.id,
                            'seq': chat_message.id,
                            'sender': actor.username,
                            'senderDisplay': sender_display,
                            'body': preview_body,
                            'created_at': chat_message.created_at.isoformat(),
                            'kind': 'transaction',
                            'delivery_status': chat_message.delivery_status,
                            'status': 'delivered' if (chat_message.delivery_status or 0) >= 1 else 'sent',
                            'delivered_at': delivered_at,
                            'read_at': read_at,
                        }
                    })
                    from .models import get_conversation_viewer_ids  # local import
                    last_msg_iso = chat_message.created_at.isoformat()
                    for uid in get_conversation_viewer_ids(conversation):
                        if uid == actor.id:
                            continue
                        async_to_sync(channel_layer.group_send)(f"user_{uid}", {
                            'type': 'broadcast.message',
                            'data': {
                                'type': 'inbox.update',
                                'conversation_id': conversation.id,
                                'last_message_preview': preview_body[:80],
                                'last_message_at': last_msg_iso,
                                'unread_count': 1,
                            }
                        })
            except Exception:
                # Don't fail transaction due to optional broadcasting
                pass

            # Pusher fallback (optional)
            try:
                from .pusher_client import pusher_client
                if pusher_client:
                    preview_body = f"معاملة: {( 'لنا' if direction=='lna' else 'لكم')} {display_amount} {currency.symbol or currency.code}{(' - ' + note) if note else ''}".strip()
                    pusher_client.trigger(f"chat_{conversation.id}", 'message', {
                        'username': actor.username,
                        'display_name': sender_display,
                        'senderDisplay': sender_display,
                        'message': preview_body,
                        'conversation_id': conversation.id,
                        'id': chat_message.id,
                        'message_id': chat_message.id,
                        'seq': chat_message.id,
                        'delivered_at': chat_message.delivered_at.isoformat() if chat_message.delivered_at else None,
                        'read_at': chat_message.read_at.isoformat() if chat_message.read_at else None,
                    })
                    from .models import get_conversation_viewer_ids  # local import
                    last_msg_iso = chat_message.created_at.isoformat()
                    for uid in get_conversation_viewer_ids(conversation):
                        if uid == actor.id:
                            continue
                        pusher_client.trigger(f"user_{uid}", 'notify', {
                            'type': 'transaction',
                            'conversation_id': conversation.id,
                            'from': getattr(actor, 'display_name', '') or actor.username,
                            'preview': preview_body[:80],
                            'last_message_at': last_msg_iso,
                        })
            except Exception:
                pass

            # Update conversation activity timestamp
            Conversation.objects.filter(pk=conversation.pk).update(last_activity_at=timezone.now())
            return txn

# ---- Admin-facing proxy models (no DB changes) ----
class ConversationInbox(Conversation):
    class Meta:
        proxy = True
        verbose_name = "Admin inbox"
        verbose_name_plural = "Admin inbox"

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        # After saving transaction, send a web push similar to text message
        try:
            from .views import send_web_push_to_user
            conv = self.conversation
            actor = self.from_user
            recipient = conv.user_b if actor.id == conv.user_a_id else conv.user_a
            display = getattr(actor, 'display_name', '') or actor.username
            preview = f"معاملة: {'لنا' if self.direction=='lna' else 'لكم'} {self.amount} {self.currency.symbol or self.currency.code}"
            payload = {
                "type": "message",
                "conversationId": conv.id,
                "senderDisplay": display,
                "preview": preview[:60],
                "avatar": None,
                "clickUrl": f"/conversation/{conv.id}",
                "title": display,
                "body": preview[:60],
            }
            send_web_push_to_user(recipient, payload)
        except Exception:
            pass


class PushSubscription(models.Model):
    """Web Push subscription per browser/device.

    Unique by endpoint. Multiple per user allowed (multi-device).
    """
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='push_subscriptions')
    endpoint = models.URLField(unique=True)
    keys_auth = models.CharField(max_length=255)
    keys_p256dh = models.CharField(max_length=255)
    user_agent = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):  # pragma: no cover
        return f"PushSub({self.user_id}) {self.endpoint[:32]}..."


class TeamMember(models.Model):
    """Owner-managed sub-user.

    Not a platform-wide account. Acts on behalf of the owner inside selected conversations.
    """
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name='team_members')
    username = models.CharField(max_length=150, default="")
    display_name = models.CharField(max_length=150, blank=True)
    phone = models.CharField(max_length=32, blank=True)
    password_hash = models.CharField(max_length=255, default="")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("owner", "username")
        indexes = [
            models.Index(fields=["owner", "username"]),
        ]

    def __str__(self):  # pragma: no cover
        return f"TeamMember(owner={self.owner_id}, username={self.username})"


class ConversationMember(models.Model):
    """Grants access to a conversation to extra viewers (user or team member).

    Exactly one of member_user or member_team must be set.
    Access is scoped per conversation.
    """
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='extra_members')
    member_user = models.ForeignKey(User, on_delete=models.CASCADE, null=True, blank=True, related_name='conversation_memberships')
    member_team = models.ForeignKey(TeamMember, on_delete=models.CASCADE, null=True, blank=True, related_name='conversation_team_memberships')
    added_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='added_conversation_members')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=(
                    (models.Q(member_user__isnull=False) & models.Q(member_team__isnull=True)) |
                    (models.Q(member_user__isnull=True) & models.Q(member_team__isnull=False))
                ),
                name='conv_member_exactly_one'
            ),
        ]
        unique_together = (
            ("conversation", "member_user"),
            ("conversation", "member_team"),
        )
        indexes = [
            models.Index(fields=["conversation", "member_user"]),
            models.Index(fields=["conversation", "member_team"]),
        ]

    def __str__(self):  # pragma: no cover
        return f"ConvMember(conv={self.conversation_id}, user={self.member_user_id}, team={self.member_team_id})"


def get_conversation_viewer_ids(conv: Conversation) -> list[int]:
    """Return all user IDs that should be notified/authorized for a conversation.

    Includes the two primary participants and any additional team members.
    """
    try:
        base = [conv.user_a_id, conv.user_b_id]
        extras_users = list(ConversationMember.objects.filter(conversation_id=conv.id, member_user__isnull=False).values_list('member_user_id', flat=True))
        # Team members act on behalf of owners, so include their owners for inbox previews
        team_owner_ids = list(
            ConversationMember.objects.filter(conversation_id=conv.id, member_team__isnull=False)
            .values_list('member_team__owner_id', flat=True)
        )
        # Ensure uniqueness while preserving order
        seen = set()
        out: list[int] = []
        for uid in base + extras_users + team_owner_ids:
            if uid and uid not in seen:
                seen.add(uid)
                out.append(uid)
        return out
    except Exception:
        # Fallback to participants only on any error
        return [conv.user_a_id, conv.user_b_id]
