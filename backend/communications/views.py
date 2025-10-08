from rest_framework import viewsets, mixins, status, permissions
from rest_framework.response import Response
from rest_framework.decorators import action
from django.conf import settings
from django.core.exceptions import ValidationError
import mimetypes
from django.core.files.storage import default_storage
from django.db.models import Q
from django.db import models as dj_models, transaction
from django.contrib.auth import get_user_model
import re
from .models import (
    ContactRelation,
    Conversation,
    Message,
    Transaction,
    PushSubscription,
    ConversationMute,
    TeamMember,
    ConversationMember,
    BrandingSetting,
    LoginPageSetting,
    PrivacyPolicy,
    ContactLink,
    CustomEmoji,
    get_conversation_viewer_ids,
)
from .push import send_message_push
from .serializers import (
    PublicUserSerializer, ContactRelationSerializer, ConversationSerializer,
    MessageSerializer, TransactionSerializer, PushSubscriptionSerializer,
    TeamMemberSerializer,
    ConversationMemberSerializer,
    ContactLinkSerializer,
    CustomEmojiSerializer,
    PrivacyPolicySerializer,
    LoginPageSettingSerializer,
)
from .permissions import IsParticipant
from django.conf import settings
from django.utils import timezone
from django.utils.timezone import make_aware
from datetime import datetime, time

# اشتراطات الاشتراك: السماح بالمراسلة وجهات الاتصال وفق الباقة
try:
    from subscriptions.models import UserSubscription  # type: ignore
except Exception:  # pragma: no cover - إذا لم تتوفر وحدة الاشتراكات لأي سبب
    UserSubscription = None  # type: ignore


def _is_admin_user(u) -> bool:
    try:
        return bool(getattr(u, 'is_superuser', False) or str(getattr(u, 'username', '')).lower() == 'admin')
    except Exception:
        return False


def _has_active_subscription(user) -> bool:
    """نشط إذا كان لديه اشتراك يغطي الوقت الحالي بغض النظر عن حقل الحالة المحفوظ."""
    if not UserSubscription:
        return False
    sub = getattr(user, 'subscription', None)
    if not sub:
        return False
    now = timezone.now()
    try:
        return (sub.start_at <= now <= sub.end_at)
    except Exception:
        return False


def _plan_contact_limit(user) -> int | None:
    """حد أقصى لعدد جهات الاتصال غير الـ admin حسب الباقة: silver=5, golden=30, king=غير محدود."""
    # بعد انتهاء النسخة التجريبية أو عدم وجود اشتراك نشط: يُسمح بجهة اتصال واحدة فقط
    if not _has_active_subscription(user):
        return 1
    try:
        code = (getattr(user.subscription.plan, 'code', '') or '').lower()
    except Exception:
        code = ''
    # خلال النسخة التجريبية نمنح نفس صلاحيات المدفوعة (بدون حد)
    if code == 'trial':
        return None


_ATTACHMENT_FILENAME_RE = re.compile(r"\.(?:jpe?g|png|gif|webp|svg|bmp|ico|heic|heif|pdf)(?:[?#].*)?$", re.IGNORECASE)


def _normalize_bubble_text(value) -> str:
    if value is None:
        return ''
    try:
        text = str(value)
    except Exception:
        return ''
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    text = text.replace('\n', ' ')
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def _sanitize_attachment_body(body, attachment_name=None) -> str:
    if not body:
        return ''
    normalized_text = _normalize_bubble_text(body)
    if not normalized_text:
        return ''
    normalized_name = _normalize_bubble_text(attachment_name) if attachment_name else ''
    if normalized_name and normalized_text.casefold() == normalized_name.casefold():
        return ''
    return body


def _attachment_preview_label(preview) -> str:
    if not preview:
        return ''
    normalized = _normalize_bubble_text(preview)
    if not normalized:
        return ''
    if _ATTACHMENT_FILENAME_RE.search(normalized):
        return '📎 مرفق'
    return preview
    if code == 'silver':
        return 5
    if code == 'golden':
        return 30
    if code == 'king':
        return None  # غير محدود
    # افتراضي آمن
    return 0


def _count_non_admin_conversations(user) -> int:
    from django.db.models import Q
    admin_ids = list(get_user_model().objects.filter(is_superuser=True).values_list('id', flat=True))
    # أيضاً اعتبر المستخدم باسم admin كـ admin لو لم يكن superuser
    try:
        admin_named = get_user_model().objects.filter(username__iexact='admin').values_list('id', flat=True)
        for aid in admin_named:
            if aid not in admin_ids:
                admin_ids.append(aid)
    except Exception:
        pass
    qs = Conversation.objects.filter(Q(user_a=user) | Q(user_b=user))
    if admin_ids:
        qs = qs.exclude(Q(user_a_id__in=admin_ids) | Q(user_b_id__in=admin_ids))
    return qs.count()


def _count_non_admin_contacts(user) -> int:
    """عدد جهات الاتصال (ContactRelation) غير الخاصة بالحسابات الإدارية."""
    from django.db.models import Q
    from .models import ContactRelation
    admin_ids = list(get_user_model().objects.filter(is_superuser=True).values_list('id', flat=True))
    try:
        admin_named = get_user_model().objects.filter(username__iexact='admin').values_list('id', flat=True)
        for aid in admin_named:
            if aid not in admin_ids:
                admin_ids.append(aid)
    except Exception:
        pass
    qs = ContactRelation.objects.filter(owner=user)
    if admin_ids:
        qs = qs.exclude(contact_id__in=admin_ids)
    return qs.count()


def _ensure_can_message_or_contact(user, other=None, conversation: Conversation | None = None):
    """يرفع ValidationError برسالة عربية عند عدم السماح بالمراسلة/الإنشاء.

    السياسة الحالية:
    - أثناء التجربة المجانية أو مع اشتراك مدفوع نشط: مسموح بالكامل (مع حدود الباقة إن وُجدت عند الإنشاء).
    - بعد انتهاء التجربة وبدون اشتراك نشط: مسموح المراسلة مع المحادثات الحالية، ومسموح إضافة/بدء جهة اتصال واحدة فقط غير إدارية.
    """
    # إذا وجد محادثة نتحقق من الشخص الآخر
    if conversation is not None:
        if user not in [conversation.user_a, conversation.user_b]:
            raise ValidationError({'detail': 'ليست محادثتك'})
        other = conversation.user_b if user == conversation.user_a else conversation.user_a
    if other is None:
        raise ValidationError({'detail': 'مستخدم غير معروف'})
    if _is_admin_user(other):
        return  # admin دائماً مسموح
    # عند الإنشاء (other بدون conversation):
    # إن لم يكن هناك اشتراك نشط، نتحقق من الحد (1 جهة اتصال)
    if not _has_active_subscription(user):
        # بدون اشتراك نشط: ممنوع المراسلة أو الإضافة مع غير admin (يُطبق حد الإضافة في نقاط الإنشاء نفسها)
        raise ValidationError({'detail': 'انتهت صلاحية الاشتراك أو غير موجود — لا يمكنك المراسلة أو إضافة جهات اتصال إلا مع admin'})


def _is_conversation_muted_for(user, conversation_id) -> bool:
    try:
        m = ConversationMute.objects.filter(user=user, conversation_id=conversation_id).first()
        if not m:
            return False
        if m.muted_until is None:
            return True
        from django.utils import timezone
        return m.muted_until > timezone.now()
    except Exception:
        return False

def send_web_push_to_user(user, payload: dict):
    """Send a web push to all subscriptions of a user. Remove dead ones.

    Payload is a JSON-serializable dict. Failures 404/410 prune the subscription.
    """
    try:
        from pywebpush import webpush, WebPushException
        import json
    except Exception:
        return 0
    # Ensure VAPID keys available
    if not getattr(settings, 'VAPID_PRIVATE_KEY', None) or not getattr(settings, 'VAPID_PUBLIC_KEY', None):
        return 0
    # Filter by mute if payload references a conversation
    conv_id = None
    try:
        conv_id = payload.get('conversationId') or payload.get('conversation_id')
    except Exception:
        conv_id = None
    if conv_id and _is_conversation_muted_for(user, conv_id):
        return 0
    subs = list(PushSubscription.objects.filter(user=user))
    vapid_claims = {"sub": settings.VAPID_CONTACT_EMAIL}
    sent = 0
    for s in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": s.endpoint,
                    "keys": {"p256dh": s.keys_p256dh, "auth": s.keys_auth},
                },
                data=json.dumps(payload),
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_public_key=settings.VAPID_PUBLIC_KEY,
                vapid_claims=vapid_claims,
            )
            sent += 1
        except Exception as e:  # includes WebPushException
            # Remove stale/invalid endpoints (HTTP 404/410 or general invalid)
            try:
                msg = getattr(e, 'message', str(e))
                status_code = getattr(e, 'response', None).status_code if getattr(e, 'response', None) else None
            except Exception:
                status_code = None
            if status_code in [404, 410]:
                try:
                    s.delete()
                except Exception:
                    pass
            # ignore other failures silently for now
            continue
    return sent

User = get_user_model()

class UserSearchViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = User.objects.all().order_by('id')
    serializer_class = PublicUserSerializer
    permission_classes = [permissions.IsAuthenticated]  # Allow web access without device check

    def get_queryset(self):
        qs = super().get_queryset()
        q = self.request.query_params.get('q')
        exclude_self = self.request.query_params.get('exclude_self') in ['1', 'true', 'True']
        if q:
            qs = qs.filter(Q(username__icontains=q) | Q(email__icontains=q) | Q(display_name__icontains=q))
        if exclude_self and self.request.user.is_authenticated:
            qs = qs.exclude(id=self.request.user.id)
        return qs[:20]

class ContactRelationViewSet(viewsets.ModelViewSet):
    serializer_class = ContactRelationSerializer
    permission_classes = [permissions.IsAuthenticated]  # Allow web access without device check

    def get_queryset(self):
        return ContactRelation.objects.filter(owner=self.request.user)

    def create(self, request, *args, **kwargs):
        # فرض حد إنشاء جهة الاتصال حسب الباقة، مع السماح دومًا بإضافة admin
        contact_id = request.data.get('contact_id') or request.data.get('contact')
        other = None
        if contact_id:
            try:
                other = User.objects.get(id=contact_id)
            except User.DoesNotExist:
                return Response({'detail': 'المستخدم غير موجود'}, status=404)
        # في حال تزويد معرف الطرف الآخر وغير إداري، طبّق الحد
        if other is not None and not _is_admin_user(other):
            limit = _plan_contact_limit(request.user)
            if limit is not None:
                count = _count_non_admin_contacts(request.user)
                if count >= (limit or 0):
                    return Response({'detail': 'لقد بلغت الحد المسموح لجهات الاتصال حسب باقتك'}, status=403)
        return super().create(request, *args, **kwargs)


class TeamMemberViewSet(viewsets.ModelViewSet):
    """CRUD for the current user's team."""
    serializer_class = TeamMemberSerializer
    permission_classes = [permissions.IsAuthenticated]  # Allow web access without device check

    def get_queryset(self):
        return TeamMember.objects.select_related('owner').filter(owner=self.request.user).order_by('-id')

    def get_serializer(self, *args, **kwargs):
        kwargs.setdefault('context', {})
        kwargs['context']['request'] = self.request
        return super().get_serializer(*args, **kwargs)

class ConversationViewSet(viewsets.ModelViewSet):
    serializer_class = ConversationSerializer
    permission_classes = [IsParticipant]

    def get_queryset(self):
        user = self.request.user
        # If acting as a team member, only list conversations the team member was explicitly added to,
        # plus the owner's conversation with admin (support).
        acting_team_id = getattr(getattr(self.request, 'auth', None), 'payload', {}).get('team_member_id') if getattr(self.request, 'auth', None) else None
        base = Conversation.objects.select_related('user_a', 'user_b')
        if acting_team_id:
            admin_pair = (
                (Q(user_a=user) & (Q(user_b__is_superuser=True) | Q(user_b__username__iexact='admin')))
                | (Q(user_b=user) & (Q(user_a__is_superuser=True) | Q(user_a__username__iexact='admin')))
            )
            return base.filter(
                Q(extra_members__member_team_id=acting_team_id) | admin_pair
            ).distinct()
        return base.filter(
            Q(user_a=user) | Q(user_b=user) | Q(extra_members__member_user=user) | Q(extra_members__member_team__owner=user)
        ).distinct()

    def create(self, request, *args, **kwargs):
        user = request.user
        other_id = request.data.get('other_user_id')
        other_username = request.data.get('other_user_username')
        other = None
        from rest_framework.exceptions import ValidationError
        if other_id:
            try:
                other = User.objects.get(id=other_id)
            except User.DoesNotExist:
                raise ValidationError({'detail': 'User not found'})
        elif other_username:
            try:
                other = User.objects.get(username__iexact=other_username)
            except User.DoesNotExist:
                raise ValidationError({'detail': 'User not found'})
        else:
            raise ValidationError({'detail': 'Specify other_user_id or other_user_username'})
        if other.id == user.id:
            raise ValidationError({'detail': 'لا يمكنك بدء محادثة مع نفسك'})
        # normalize ordering
        a, b = (user, other) if user.id < other.id else (other, user)
        existing = Conversation.objects.filter(user_a=a, user_b=b).first()
        if existing:
            serializer = self.get_serializer(existing)
            headers = self.get_success_headers(serializer.data)
            return Response(serializer.data, status=status.HTTP_200_OK, headers=headers)
        # قيود الاشتراك: السماح دوماً بمحادثة admin. لغير admin يتطلب اشتراك نشط + احترام الحد حسب الباقة
        if not _is_admin_user(other):
            if not _has_active_subscription(user):
                return Response({'detail': 'لا يمكنك إنشاء محادثات جديدة بدون اشتراك نشط. يمكنك مراسلة admin فقط.'}, status=403)
            limit = _plan_contact_limit(user)
            if limit is not None:
                count = _count_non_admin_conversations(user)
                if count >= (limit or 0):
                    return Response({'detail': 'لقد بلغت الحد المسموح لجهات الاتصال حسب باقتك'}, status=403)
        serializer = self.get_serializer(data={})
        serializer.is_valid(raise_exception=True)
        conv = Conversation.objects.create(user_a=a, user_b=b)
        out = self.get_serializer(conv)
        headers = self.get_success_headers(out.data)
        return Response(out.data, status=status.HTTP_201_CREATED, headers=headers)

    def get_serializer(self, *args, **kwargs):
        kwargs.setdefault('context', {})
        if 'request' not in kwargs['context']:
            kwargs['context']['request'] = self.request
        return super().get_serializer(*args, **kwargs)

    @action(detail=True, methods=['post'])
    def request_delete(self, request, pk=None):
        conv = self.get_object()
        # Enforce OTP for sensitive action if user enabled TOTP
        try:
            import pyotp as _pyotp
        except Exception:
            _pyotp = None
        if getattr(request.user, 'totp_enabled', False):
            code = (request.headers.get('X-OTP-Code') or request.data.get('otp') or '').strip()
            if not code:
                return Response({'detail': 'OTP required', 'otp_required': True}, status=403)
            secret = getattr(request.user, 'totp_secret', '') or ''
            totp = _pyotp.TOTP(secret) if (_pyotp and secret) else None
            if not secret or not totp or not totp.verify(code, valid_window=1):
                return Response({'detail': 'Invalid OTP', 'otp_required': True}, status=403)
        user = request.user
        from django.utils import timezone
        # سجل طلب الحذف إذا لم يكن موجوداً أو من نفس المستخدم
        conv.delete_requested_by = user
        conv.delete_requested_at = timezone.now()
        conv.save(update_fields=['delete_requested_by', 'delete_requested_at'])
        requested_at_iso = conv.delete_requested_at.isoformat() if conv.delete_requested_at else timezone.now().isoformat()
        counterpart_id = conv.user_b_id if user.id == conv.user_a_id else conv.user_a_id
        payload = {
            'type': 'delete.request',
            'conversation_id': conv.id,
            'user_id': user.id,
            'username': user.username,
            'display_name': getattr(user, 'display_name', '') or user.username,
            'requested_at': requested_at_iso,
        }
        # بث عبر WebSocket الداخلي للطرف الآخر (المحادثة + صندوق الوارد)
        try:
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync
            channel_layer = get_channel_layer()
            if channel_layer is not None:
                async_to_sync(channel_layer.group_send)(f"conv_{conv.id}", {
                    'type': 'broadcast.message',
                    'data': payload,
                })
                viewer_ids = set(get_conversation_viewer_ids(conv))
                for uid in viewer_ids:
                    if uid == user.id:
                        continue
                    async_to_sync(channel_layer.group_send)(f"user_{uid}", {
                        'type': 'broadcast.message',
                        'data': {**payload, 'scope': 'inbox'},
                    })
        except Exception:
            pass
        # بث عبر Pusher للطرف الآخر
        try:
            from .pusher_client import pusher_client
            if pusher_client:
                pusher_client.trigger(f"chat_{conv.id}", 'message', payload)
        except Exception:
            pass
        # بث الحدث أيضاً عبر قنوات WebSocket الداخلية لكي تستلمه تطبيقاتنا المباشرة
        try:
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync
            channel_layer = get_channel_layer()
            if channel_layer is not None:
                async_to_sync(channel_layer.group_send)(
                    f"conv_{conv.id}",
                    {
                        'type': 'broadcast.message',
                        'data': {
                            'type': 'delete.request',
                            'conversation_id': conv.id,
                            'user_id': user.id,
                            'username': user.username,
                            'display_name': getattr(user, 'display_name', '') or user.username,
                            'requested_at': conv.delete_requested_at.isoformat() if conv.delete_requested_at else None,
                        },
                    },
                )
        except Exception:
            pass
        return Response({'status': 'ok'})

    @action(detail=True, methods=['post'])
    def approve_delete(self, request, pk=None):
        conv = self.get_object()
        user = request.user
        # الموافقة مسموحة فقط للطرف الآخر غير صاحب الطلب
        if conv.delete_requested_by is None or conv.delete_requested_by_id == user.id:
            return Response({'detail': 'لا يوجد طلب معلق أو لا يمكنك الموافقة على طلبك'}, status=400)
        requested_by_username = getattr(conv.delete_requested_by, 'username', None)
        requested_by_display = getattr(conv.delete_requested_by, 'display_name', '') or requested_by_username or ''
        viewer_ids = set(get_conversation_viewer_ids(conv))
        # احذف المحادثة وجميع رسائلها
        cid = conv.id
        conv.delete()
        payload = {
            'type': 'delete.approved',
            'conversation_id': cid,
            'user_id': user.id,
            'username': user.username,
            'display_name': getattr(user, 'display_name', '') or user.username,
            'requested_by': requested_by_username,
            'requested_by_display': requested_by_display,
        }
        try:
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync
            channel_layer = get_channel_layer()
            if channel_layer is not None:
                async_to_sync(channel_layer.group_send)(f"conv_{cid}", {
                    'type': 'broadcast.message',
                    'data': payload,
                })
                for uid in viewer_ids:
                    if uid == user.id:
                        continue
                    async_to_sync(channel_layer.group_send)(f"user_{uid}", {
                        'type': 'broadcast.message',
                        'data': {**payload, 'scope': 'inbox'},
                    })
        except Exception:
            pass
        # أرسل تأكيد عبر Pusher للطرفين
        try:
            from .pusher_client import pusher_client
            if pusher_client:
                pusher_client.trigger(f"chat_{cid}", 'message', payload)
        except Exception:
            pass
        # بث عبر قنوات WebSocket الداخلية
        try:
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync
            channel_layer = get_channel_layer()
            if channel_layer is not None:
                async_to_sync(channel_layer.group_send)(
                    f"conv_{cid}",
                    {
                        'type': 'broadcast.message',
                        'data': {
                            'type': 'delete.approved',
                            'conversation_id': cid,
                            'user_id': user.id,
                            'username': user.username,
                            'display_name': getattr(user, 'display_name', '') or user.username,
                        },
                    },
                )
        except Exception:
            pass
        return Response({'status': 'ok'})

    @action(detail=True, methods=['post'])
    def decline_delete(self, request, pk=None):
        conv = self.get_object()
        user = request.user
        if conv.delete_requested_by is None or conv.delete_requested_by_id == user.id:
            return Response({'detail': 'لا يوجد طلب معلق أو لا يمكنك رفض طلبك'}, status=400)
        conv.delete_requested_by = None
        conv.delete_requested_at = None
        conv.save(update_fields=['delete_requested_by', 'delete_requested_at'])
        payload = {
            'type': 'delete.declined',
            'conversation_id': conv.id,
            'user_id': user.id,
            'username': user.username,
            'display_name': getattr(user, 'display_name', '') or user.username,
        }
        try:
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync
            channel_layer = get_channel_layer()
            if channel_layer is not None:
                async_to_sync(channel_layer.group_send)(f"conv_{conv.id}", {
                    'type': 'broadcast.message',
                    'data': payload,
                })
                viewer_ids = set(get_conversation_viewer_ids(conv))
                for uid in viewer_ids:
                    if uid == user.id:
                        continue
                    async_to_sync(channel_layer.group_send)(f"user_{uid}", {
                        'type': 'broadcast.message',
                        'data': {**payload, 'scope': 'inbox'},
                    })
        except Exception:
            pass
        # بث رفض للطرف الآخر
        try:
            from .pusher_client import pusher_client
            if pusher_client:
                pusher_client.trigger(f"chat_{conv.id}", 'message', payload)
        except Exception:
            pass
        # بث عبر قنوات WebSocket الداخلية
        try:
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync
            channel_layer = get_channel_layer()
            if channel_layer is not None:
                async_to_sync(channel_layer.group_send)(
                    f"conv_{conv.id}",
                    {
                        'type': 'broadcast.message',
                        'data': {
                            'type': 'delete.declined',
                            'conversation_id': conv.id,
                            'user_id': user.id,
                            'username': user.username,
                            'display_name': getattr(user, 'display_name', '') or user.username,
                        },
                    },
                )
        except Exception:
            pass
        return Response({'status': 'ok'})

    @action(detail=True, methods=['get'])
    def messages(self, request, pk=None):
        conv = self.get_object()
        # Mark undelivered inbound messages as delivered upon fetch (idempotent, monotonic)
        try:
            # Use delivery_status as the source of truth (not delivered_at NULLability)
            undelivered_qs = conv.messages.filter(delivery_status__lt=1).exclude(sender_id=request.user.id)
            ids_to_broadcast = list(undelivered_qs.order_by('id').values_list('id', flat=True)[:300])
            if undelivered_qs.exists():
                undelivered_qs.update(
                    delivered_at=timezone.now(),
                    delivery_status=dj_models.Case(
                        dj_models.When(delivery_status__lt=1, then=dj_models.Value(1)),
                        default=dj_models.F('delivery_status')
                    )
                )
                try:
                    from channels.layers import get_channel_layer
                    from asgiref.sync import async_to_sync
                    channel_layer = get_channel_layer()
                    if channel_layer is not None:
                        group = f"conv_{conv.id}"
                        for mid in ids_to_broadcast:
                            async_to_sync(channel_layer.group_send)(group, {
                                'type': 'broadcast.message',
                                'data': { 'type': 'message.status', 'id': int(mid), 'delivery_status': 1, 'status': 'delivered' }
                            })
                except Exception:
                    pass
        except Exception:
            pass
        # Consistency guard: ensure any message already marked read_at has delivery_status=2
        try:
            conv.messages.filter(read_at__isnull=False, delivery_status__lt=2).update(
                delivery_status=dj_models.Value(2)
            )
        except Exception:
            pass
        # Optional: mark inbound as read when explicitly requested by client on open
        try:
            mark_read = request.query_params.get('mark_read') in ['1', 'true', 'True']
        except Exception:
            mark_read = False
        if mark_read:
            try:
                last_id = conv.messages.order_by('-id').values_list('id', flat=True).first()
                if last_id:
                    now = timezone.now()
                    conv.messages.exclude(sender_id=request.user.id).filter(id__lte=last_id, delivery_status__lt=2).update(
                        read_at=now, delivered_at=now,
                        delivery_status=dj_models.Case(
                            dj_models.When(delivery_status__lt=2, then=dj_models.Value(2)),
                            default=dj_models.F('delivery_status')
                        )
                    )
                    # Persist / advance read marker for this user (threshold = last_id)
                    try:
                        from .models import ConversationReadMarker
                        ConversationReadMarker.objects.update_or_create(
                            conversation_id=conv.id,
                            user_id=request.user.id,
                            defaults={'last_read_message_id': int(last_id)}
                        )
                    except Exception:
                        pass
                    # Optional broadcast: per-message read status capped
                    try:
                        from channels.layers import get_channel_layer
                        from asgiref.sync import async_to_sync
                        channel_layer = get_channel_layer()
                        if channel_layer is not None:
                            group = f"conv_{conv.id}"
                            ids = list(conv.messages.exclude(sender_id=request.user.id).filter(id__lte=last_id).order_by('-id').values_list('id', flat=True)[:300])
                            read_iso = now.isoformat()
                            for mid in ids:
                                async_to_sync(channel_layer.group_send)(group, {
                                    'type': 'broadcast.message',
                                    'data': { 'type': 'message.status', 'id': int(mid), 'delivery_status': 2, 'status': 'read', 'read_at': read_iso }
                                })
                            async_to_sync(channel_layer.group_send)(group, {
                                'type': 'broadcast.message',
                                'data': { 'type': 'chat.read', 'reader': request.user.username, 'last_read_id': int(last_id) }
                            })
                    except Exception:
                        pass
            except Exception:
                pass
        since_id = request.query_params.get('since_id')
        before = request.query_params.get('before')
        try:
            if since_id is not None:
                since_id = int(since_id)
        except (TypeError, ValueError):
            since_id = None
        limit = request.query_params.get('limit')
        try:
            limit = int(limit) if limit is not None else 200
        except (TypeError, ValueError):
            limit = 200
        base_qs = conv.messages.select_related('sender', 'sender_team_member', 'transaction_record__currency')
        if since_id:
            qs = base_qs.filter(id__gt=since_id).order_by('created_at')[:limit]
        elif before:
            try:
                b = int(before)
                qs = base_qs.filter(id__lt=b).order_by('-created_at')[:limit]
                qs = qs[::-1]  # return ascending
            except (TypeError, ValueError):
                qs = base_qs.order_by('-created_at')[:limit]
        else:
            qs = base_qs.order_by('-created_at')[:limit]
        # Inject counterpart last_read marker so serializer can freeze blue ticks
        other_last_read_id = 0
        viewer_id = request.user.id
        try:
            from .models import ConversationReadMarker, Message
            other_id = conv.user_b_id if viewer_id == conv.user_a_id else conv.user_a_id
            marker = ConversationReadMarker.objects.filter(conversation_id=conv.id, user_id=other_id).first()
            marker_val = int(marker.last_read_message_id) if (marker and marker.last_read_message_id) else 0
            # Fallback 1 (always compute): max id of my messages with read_at
            fallback1 = Message.objects.filter(conversation_id=conv.id, sender_id=viewer_id, read_at__isnull=False).order_by('-id').values_list('id', flat=True).first()
            fallback1_val = int(fallback1) if fallback1 else 0
            # Effective last read is max of marker and fallback1 only
            effective = max(marker_val, fallback1_val)
            other_last_read_id = effective
            # Reconciliation ALWAYS:
            # حتى إذا لم يتقدم marker (marker_val) الآن، نضمن أن جميع رسائلي حتى 'effective' تمت ترقيتها إلى READ (2)
            # هذا يمنع اختفاء العلامتين الزرقاء بعد إعادة التحميل إذا كان marker ترقى سابقاً عبر WS لكن الرسائل نفسها لم تحدث.
            if effective:
                try:
                    if effective > marker_val:
                        ConversationReadMarker.objects.update_or_create(
                            conversation_id=conv.id,
                            user_id=other_id,
                            defaults={'last_read_message_id': effective}
                        )
                    from django.utils import timezone
                    from django.db import models as dj_models
                    now = timezone.now()
                    stale_qs = Message.objects.filter(
                        conversation_id=conv.id,
                        sender_id=viewer_id,
                        id__lte=effective,
                        delivery_status__lt=2
                    )
                    if stale_qs.exists():
                        stale_qs.update(
                            read_at=now,
                            delivered_at=dj_models.Case(
                                dj_models.When(delivered_at__isnull=True, then=dj_models.Value(now)),
                                default=dj_models.F('delivered_at')
                            ),
                            delivery_status=dj_models.Case(
                                dj_models.When(delivery_status__lt=2, then=dj_models.Value(2)),
                                default=dj_models.F('delivery_status')
                            )
                        )
                except Exception:
                    pass
        except Exception:
            pass
        return Response(MessageSerializer(qs, many=True, context={'request': request, 'other_last_read_id': other_last_read_id, 'viewer_id': viewer_id}).data)

    @action(detail=True, methods=['post'])
    def send(self, request, pk=None):
        conv = self.get_object()
        # Enforce team-member scoping: if token acts as team member, require membership for this conversation
        acting_team_id = getattr(getattr(request, 'auth', None), 'payload', {}).get('team_member_id') if getattr(request, 'auth', None) else None
        if acting_team_id:
            # Allow if team member is added OR if this is owner's admin/support conversation (text only)
            is_member = ConversationMember.objects.filter(conversation=conv, member_team_id=acting_team_id).exists()
            is_admin_conv = (_is_admin_user(conv.user_a) or _is_admin_user(conv.user_b)) and (request.user in [conv.user_a, conv.user_b])
            if not (is_member or is_admin_conv):
                return Response({'detail': 'غير مسموح'}, status=403)
        else:
            # منع الإرسال عند انتهاء الاشتراك إلا إلى admin — للمستخدم الأساسي فقط
            if request.user not in [conv.user_a, conv.user_b]:
                allowed = ConversationMember.objects.filter(conversation=conv, member_user=request.user).exists()
                if not allowed:
                    return Response({'detail': 'غير مسموح'}, status=403)
            else:
                try:
                    _ensure_can_message_or_contact(request.user, conversation=conv)
                except ValidationError as ve:
                    return Response({'detail': ve.message_dict.get('detail') if hasattr(ve, 'message_dict') else 'غير مسموح'}, status=403)
        # Enforce OTP for sensitive action if user enabled TOTP
        try:
            from django.contrib.auth import get_user_model  # noqa: F401
            import pyotp as _pyotp
        except Exception:
            _pyotp = None
        if getattr(request.user, 'totp_enabled', False):
            code = (request.headers.get('X-OTP-Code') or request.data.get('otp') or '').strip()
            if not code:
                return Response({'detail': 'OTP required', 'otp_required': True}, status=403)
            secret = getattr(request.user, 'totp_secret', '') or ''
            totp = _pyotp.TOTP(secret) if (_pyotp and secret) else None
            if not secret or not totp or not totp.verify(code, valid_window=1):
                return Response({'detail': 'Invalid OTP', 'otp_required': True}, status=403)
        body = request.data.get('body', '').strip()
        client_id_raw = (request.data.get('client_id') or '').strip()
        client_id = client_id_raw[:64] if client_id_raw else ''
        if not body:
            return Response({'detail': 'Empty body'}, status=400)
        # If acting as team member, set on message
        acting_team_id = getattr(getattr(request, 'auth', None), 'payload', {}).get('team_member_id') if getattr(request, 'auth', None) else None
        msg_kwargs = { 'conversation': conv, 'sender': request.user, 'body': body, 'type': 'text' }
        if client_id:
            msg_kwargs['client_id'] = client_id
        if acting_team_id:
            try:
                tm = TeamMember.objects.get(id=acting_team_id, owner=request.user, is_active=True)
                msg_kwargs['sender_team_member'] = tm
            except Exception:
                pass
        msg = Message.objects.create(**msg_kwargs)
        # Persist: when user sends a message while viewing a conversation, consider prior inbound as read
        read_timestamp = None
        try:
            from django.utils import timezone
            from django.db import models as dj_models
            inbound_qs = conv.messages.exclude(sender_id=request.user.id).filter(delivery_status__lt=2)
            ids_read = list(inbound_qs.values_list('id', flat=True)[:300])
            if ids_read:
                read_now = timezone.now()
                inbound_qs.update(
                    read_at=read_now, delivered_at=read_now,
                    delivery_status=dj_models.Case(
                        dj_models.When(delivery_status__lt=2, then=dj_models.Value(2)),
                        default=dj_models.F('delivery_status')
                    )
                )
                read_timestamp = read_now.isoformat()
        except Exception:
            ids_read = []
            read_timestamp = None
        # broadcast via WS for realtime delivery
        try:
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync
            channel_layer = get_channel_layer()
            if channel_layer is not None:
                group = f"conv_{conv.id}"
                sender_display = ''
                try:
                    tm = getattr(msg, 'sender_team_member', None)
                    if tm:
                        sender_display = tm.display_name or tm.username
                    else:
                        sender_display = getattr(request.user, 'display_name', '') or request.user.username
                except Exception:
                    sender_display = getattr(request.user, 'display_name', '') or request.user.username
                payload = {
                    'type': 'chat.message',
                    'id': msg.id,
                    'conversation_id': conv.id,
                    'sender': request.user.username,
                    'senderDisplay': sender_display,
                    'body': msg.body,
                    'message': msg.body,
                    'created_at': msg.created_at.isoformat(),
                    'kind': 'text',
                    'seq': msg.id,
                    'status': 'delivered',
                    'delivery_status': 1,
                    'client_id': msg.client_id,
                }
                async_to_sync(channel_layer.group_send)(group, {'type': 'broadcast.message', 'data': payload})
                # Emit explicit numeric status=1 for clients listening for status events
                try:
                    async_to_sync(channel_layer.group_send)(group, {'type': 'broadcast.message', 'data': { 'type': 'message.status', 'id': msg.id, 'delivery_status': 1, 'status': 'delivered' }})
                except Exception:
                    pass
                # Broadcast read updates from this sender's perspective for any prior inbound messages
                try:
                    read_iso = read_timestamp or timezone.now().isoformat()
                    for mid in ids_read:
                        async_to_sync(channel_layer.group_send)(group, {
                            'type': 'broadcast.message',
                            'data': { 'type': 'message.status', 'id': int(mid), 'delivery_status': 2, 'status': 'read', 'read_at': read_iso }
                        })
                    if ids_read:
                        async_to_sync(channel_layer.group_send)(group, {
                            'type': 'broadcast.message',
                            'data': { 'type': 'chat.read', 'reader': request.user.username, 'last_read_id': int(max(ids_read)) }
                        })
                except Exception:
                    pass
                # Try to set delivery status based on connectivity
                try:
                    from .group_registry import get_count
                    recipient_id = conv.user_b_id if request.user.id == conv.user_a_id else conv.user_a_id
                    inbox_group = f"user_{recipient_id}"
                    recipient_online = get_count(inbox_group) > 0
                    recipient_in_conv = get_count(group) > 1
                    from django.utils import timezone
                    if recipient_in_conv:
                        # Upgrade to READ (2) if recipient is actively viewing the conversation
                        read_now = timezone.now()
                        Message.objects.filter(id=msg.id).update(delivery_status=dj_models.Case(
                            dj_models.When(delivery_status__lt=2, then=dj_models.Value(2)), default=dj_models.F('delivery_status')
                        ), read_at=read_now, delivered_at=read_now)
                        async_to_sync(channel_layer.group_send)(group, {'type':'broadcast.message','data': {'type':'message.status','id': msg.id,'delivery_status': 2, 'status':'read', 'read_at': read_now.isoformat()}})
                    elif recipient_online:
                        # Upgrade to DELIVERED (1) if recipient is online but not in conversation
                        Message.objects.filter(id=msg.id).update(delivery_status=dj_models.Case(
                            dj_models.When(delivery_status__lt=1, then=dj_models.Value(1)), default=dj_models.F('delivery_status')
                        ), delivered_at=timezone.now())
                        async_to_sync(channel_layer.group_send)(group, {'type':'broadcast.message','data': {'type':'message.status','id': msg.id,'delivery_status': 1, 'status':'delivered'}})
                except Exception:
                    pass
                # notify all viewers' inboxes (except sender)
                from .push import _total_unread_for_user
                for uid in get_conversation_viewer_ids(conv):
                    if uid == request.user.id:
                        continue
                    # Calculate real unread count for this user
                    user_unread = _total_unread_for_user(uid)
                    import logging
                    logger = logging.getLogger(__name__)
                    logger.info(f"📨 [WS] Sending inbox.update to user {uid}: unread_count={user_unread}")
                    async_to_sync(channel_layer.group_send)(f"user_{uid}", {
                        'type': 'broadcast.message',
                        'data': {
                            'type': 'inbox.update',
                            'conversation_id': conv.id,
                            'last_message_preview': msg.body[:80],
                            'last_message_at': msg.created_at.isoformat(),
                            'unread_count': user_unread,
                        }
                    })
        except Exception:
            pass
        # Also trigger Pusher 'message' event for unified realtime on the frontend
        try:
            from .pusher_client import pusher_client
            if pusher_client:
                sender_display = ''
                try:
                    tm = getattr(msg, 'sender_team_member', None)
                    if tm:
                        sender_display = tm.display_name or tm.username
                    else:
                        sender_display = getattr(request.user, 'display_name', '') or request.user.username
                except Exception:
                    sender_display = getattr(request.user, 'display_name', '') or request.user.username
                pusher_payload = {
                    'type': payload.get('type', 'chat.message'),
                    'id': payload.get('id'),
                    'conversation_id': conv.id,
                    'username': request.user.username,
                    'sender': request.user.username,
                    'display_name': sender_display,
                    'senderDisplay': sender_display,
                    'body': payload.get('body', ''),
                    'message': payload.get('body', ''),
                    'created_at': payload.get('created_at'),
                    'kind': payload.get('kind'),
                    'seq': payload.get('seq'),
                    'status': payload.get('status'),
                    'delivery_status': payload.get('delivery_status'),
                    'client_id': msg.client_id,
                }
                pusher_client.trigger(f"chat_{conv.id}", 'message', pusher_payload)
                # notify all viewers
                for uid in get_conversation_viewer_ids(conv):
                    if uid == request.user.id:
                        continue
                    pusher_client.trigger(f"user_{uid}", 'notify', {
                        'type': 'message',
                        'conversation_id': conv.id,
                        'from': getattr(request.user, 'display_name', '') or request.user.username,
                        'preview': msg.body[:80],
                        'last_message_at': msg.created_at.isoformat(),
                    })
        except Exception:
            pass
        # Web Push notification to recipient
        try:
            display = getattr(request.user, 'display_name', '') or request.user.username
            preview = (msg.body or '').replace('\n', ' ')[:60]
            try:
                avatar = request.build_absolute_uri(request.user.logo.url) if getattr(request.user, 'logo', None) else None
            except Exception:
                avatar = None
            payload = {
                "type": "message",
                "conversationId": conv.id,
                "senderDisplay": display,
                "preview": preview,
                "avatar": avatar,
                "clickUrl": f"/conversation/{conv.id}",
                "title": display,
                "body": preview,
            }
            # push to all viewers except sender
            for uid in get_conversation_viewer_ids(conv):
                if uid == request.user.id:
                    continue
                try:
                    user_obj = get_user_model().objects.get(id=uid)
                    send_web_push_to_user(user_obj, payload)
                except Exception:
                    pass
        except Exception:
            pass
        # Use transaction.on_commit to ensure push is sent AFTER DB commit
        # This prevents race condition where unread count is calculated before message is committed
        try:
            import logging
            logger = logging.getLogger(__name__)
            logger.info(f"📤 Scheduling FCM push for message {msg.id} in conversation {conv.id}")
            sender_display = getattr(request.user, 'display_name', '') or request.user.username
            preview_text = _normalize_bubble_text(msg.body)[:80] if msg.body else (msg.attachment_name or '')[:80]
            
            def send_push_after_commit():
                try:
                    logger.info(f"🚀 [PUSH] Sending FCM push for message {msg.id} (after commit)")
                    send_message_push(
                        conv,
                        msg,
                        title=sender_display,
                        body=preview_text,
                        data={
                            'sender_display': sender_display,
                            'preview': preview_text,
                            'kind': msg.type,
                        },
                    )
                    logger.info(f"✅ [PUSH] FCM push sent successfully for message {msg.id}")
                except Exception as push_error:
                    logger.exception(f"❌ [PUSH] send_message_push failed: {push_error}")
            
            transaction.on_commit(send_push_after_commit)
        except Exception as e:
            import logging
            logger = logging.getLogger(__name__)
            logger.exception(f"❌ Failed to schedule push: {e}")
        return Response(MessageSerializer(msg, context={'request': request}).data)

    def _validate_attachment(self, file_obj):
        if not file_obj:
            raise ValidationError({'detail': 'file required'})
        # Determine MIME
        content_type = getattr(file_obj, 'content_type', None) or mimetypes.guess_type(file_obj.name)[0] or ''
        size = getattr(file_obj, 'size', None) or getattr(file_obj, '_size', None)
        try:
            size = int(size)
        except Exception:
            size = None
        allowed_image_types = {
            'image/jpeg', 'image/png', 'image/gif', 'image/webp'
        }
        allowed_pdf = 'application/pdf'
        max_image_bytes = 5 * 1024 * 1024  # 5 MB
        max_pdf_bytes = 10 * 1024 * 1024   # 10 MB
        if content_type in allowed_image_types:
            if size is not None and size > max_image_bytes:
                raise ValidationError({'detail': 'Image too large (max 5MB)'})
        elif content_type == allowed_pdf:
            if size is not None and size > max_pdf_bytes:
                raise ValidationError({'detail': 'PDF too large (max 10MB)'})
        else:
            raise ValidationError({'detail': 'Only images or PDF allowed'})
        return content_type, size

    @action(detail=True, methods=['post'])
    def send_attachment(self, request, pk=None):
        """Upload image/PDF as a message with optional caption in 'body'. Multipart form required.
        Fields: file (required), body (optional text)
        """
        conv = self.get_object()
        # Team-member tokens must be members of the conversation to upload attachments (admin chat not exempt)
        acting_team_id = getattr(getattr(request, 'auth', None), 'payload', {}).get('team_member_id') if getattr(request, 'auth', None) else None
        if acting_team_id:
            allowed = ConversationMember.objects.filter(conversation=conv, member_team_id=acting_team_id).exists()
            if not allowed:
                return Response({'detail': 'غير مسموح'}, status=403)
        else:
            # منع الإرسال عند انتهاء الاشتراك إلا إلى admin — للمستخدم الأساسي فقط
            if request.user not in [conv.user_a, conv.user_b]:
                allowed = ConversationMember.objects.filter(conversation=conv, member_user=request.user).exists()
                if not allowed:
                    return Response({'detail': 'غير مسموح'}, status=403)
            else:
                try:
                    _ensure_can_message_or_contact(request.user, conversation=conv)
                except ValidationError as ve:
                    return Response({'detail': ve.message_dict.get('detail') if hasattr(ve, 'message_dict') else 'غير مسموح'}, status=403)
        # Enforce OTP for sensitive action if user enabled TOTP
        try:
            import pyotp as _pyotp
        except Exception:
            _pyotp = None
        if getattr(request.user, 'totp_enabled', False):
            code = (request.headers.get('X-OTP-Code') or request.data.get('otp') or '').strip()
            if not code:
                return Response({'detail': 'OTP required', 'otp_required': True}, status=403)
            secret = getattr(request.user, 'totp_secret', '') or ''
            totp = _pyotp.TOTP(secret) if (_pyotp and secret) else None
            if not secret or not totp or not totp.verify(code, valid_window=1):
                return Response({'detail': 'Invalid OTP', 'otp_required': True}, status=403)
        file_obj = request.FILES.get('file') or request.data.get('file')
        try:
            mime, size = self._validate_attachment(file_obj)
        except ValidationError as ve:
            return Response({'detail': ve.message_dict.get('detail') if hasattr(ve, 'message_dict') else 'Invalid file'}, status=400)
        caption_raw = (request.data.get('body') or '').strip()
        attachment_name = getattr(file_obj, 'name', '')
        sanitized_caption = _sanitize_attachment_body(caption_raw, attachment_name)
        client_id_raw = (request.data.get('client_id') or '').strip()
        client_id = client_id_raw[:64] if client_id_raw else ''
        msg_kwargs = {
            'conversation': conv,
            'sender': request.user,
            'body': sanitized_caption,
            'type': 'text',  # keep as text type; attachment fields indicate presence
            'attachment': file_obj,
            'attachment_name': attachment_name,
            'attachment_mime': mime or '',
            'attachment_size': size,
        }
        if client_id:
            msg_kwargs['client_id'] = client_id
        acting_team_id = getattr(getattr(request, 'auth', None), 'payload', {}).get('team_member_id') if getattr(request, 'auth', None) else None
        if acting_team_id:
            try:
                tm = TeamMember.objects.get(id=acting_team_id, owner=request.user, is_active=True)
                msg_kwargs['sender_team_member'] = tm
            except Exception:
                pass
        msg = Message.objects.create(**msg_kwargs)
        sanitized_body = _sanitize_attachment_body(msg.body, msg.attachment_name)
        preview_source = sanitized_body or (msg.attachment_name or '')
        preview_label = _attachment_preview_label(preview_source) or '📎 مرفق'
        attachment_payload = {
            'name': msg.attachment_name,
            'mime': msg.attachment_mime,
            'size': msg.attachment_size,
        }
        attachment_url = None
        try:
            att = getattr(msg, 'attachment', None)
            if att:
                attachment_url = att.url
                if attachment_url and hasattr(request, 'build_absolute_uri'):
                    attachment_url = request.build_absolute_uri(attachment_url)
        except Exception:
            attachment_url = None
        if attachment_url:
            attachment_payload['url'] = attachment_url
        # Realtime broadcast via channels (if configured)
        try:
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync
            channel_layer = get_channel_layer()
            if channel_layer is not None:
                group = f"conv_{conv.id}"
                sender_display = ''
                try:
                    tm = getattr(msg, 'sender_team_member', None)
                    if tm:
                        sender_display = tm.display_name or tm.username
                    else:
                        sender_display = getattr(request.user, 'display_name', '') or request.user.username
                except Exception:
                    sender_display = getattr(request.user, 'display_name', '') or request.user.username
                payload = {
                    'type': 'chat.message',
                    'id': msg.id,
                    'conversation_id': conv.id,
                    'sender': request.user.username,
                    'senderDisplay': sender_display,
                    'body': sanitized_body,
                    'message': sanitized_body,
                    'created_at': msg.created_at.isoformat(),
                    'kind': 'text',
                    'seq': msg.id,
                    'status': 'delivered',
                    'delivery_status': 1,
                    'attachment': attachment_payload,
                    'client_id': msg.client_id,
                }
                async_to_sync(channel_layer.group_send)(group, {'type': 'broadcast.message', 'data': payload})
                # Initial numeric status event (delivered)
                try:
                    async_to_sync(channel_layer.group_send)(group, {'type': 'broadcast.message', 'data': { 'type': 'message.status', 'id': msg.id, 'delivery_status': 1, 'status': 'delivered' }})
                except Exception:
                    pass
                # Connectivity-based status
                try:
                    from .group_registry import get_count
                    recipient_id = conv.user_b_id if request.user.id == conv.user_a_id else conv.user_a_id
                    inbox_group = f"user_{recipient_id}"
                    recipient_online = get_count(inbox_group) > 0
                    recipient_in_conv = get_count(group) > 1
                    from django.utils import timezone
                    if recipient_in_conv:
                        read_now = timezone.now()
                        Message.objects.filter(id=msg.id).update(delivery_status=dj_models.Case(
                            dj_models.When(delivery_status__lt=2, then=dj_models.Value(2)), default=dj_models.F('delivery_status')
                        ), read_at=read_now, delivered_at=read_now)
                        async_to_sync(channel_layer.group_send)(group, {'type':'broadcast.message','data': {'type':'message.status','id': msg.id,'delivery_status': 2, 'status':'read', 'read_at': read_now.isoformat()}})
                    elif recipient_online:
                        Message.objects.filter(id=msg.id).update(delivery_status=dj_models.Case(
                            dj_models.When(delivery_status__lt=1, then=dj_models.Value(1)), default=dj_models.F('delivery_status')
                        ), delivered_at=timezone.now())
                        async_to_sync(channel_layer.group_send)(group, {'type':'broadcast.message','data': {'type':'message.status','id': msg.id,'delivery_status': 1, 'status':'delivered'}})
                except Exception:
                    pass
                from .push import _total_unread_for_user
                for uid in get_conversation_viewer_ids(conv):
                    if uid == request.user.id:
                        continue
                    user_unread = _total_unread_for_user(uid)
                    import logging
                    logger = logging.getLogger(__name__)
                    logger.info(f"📨 [WS] Sending inbox.update to user {uid}: unread_count={user_unread}")
                    async_to_sync(channel_layer.group_send)(f"user_{uid}", {
                        'type': 'broadcast.message',
                        'data': {
                            'type': 'inbox.update',
                            'conversation_id': conv.id,
                            'last_message_preview': preview_label[:80],
                            'last_message_at': msg.created_at.isoformat(),
                            'unread_count': user_unread,
                        }
                    })
        except Exception:
            pass
        # Pusher trigger for unified realtime
        try:
            from .pusher_client import pusher_client
            if pusher_client:
                sender_display = ''
                try:
                    tm = getattr(msg, 'sender_team_member', None)
                    if tm:
                        sender_display = tm.display_name or tm.username
                    else:
                        sender_display = getattr(request.user, 'display_name', '') or request.user.username
                except Exception:
                    sender_display = getattr(request.user, 'display_name', '') or request.user.username
                pusher_payload = {
                    'type': 'chat.message',
                    'id': msg.id,
                    'conversation_id': conv.id,
                    'username': request.user.username,
                    'sender': request.user.username,
                    'display_name': sender_display,
                    'senderDisplay': sender_display,
                    'body': sanitized_body,
                    'message': sanitized_body,
                    'created_at': msg.created_at.isoformat(),
                    'kind': 'text',
                    'seq': msg.id,
                    'status': 'delivered',
                    'delivery_status': 1,
                    'attachment': attachment_payload,
                    'client_id': msg.client_id,
                }
                pusher_client.trigger(f"chat_{conv.id}", 'message', pusher_payload)
                for uid in get_conversation_viewer_ids(conv):
                    if uid == request.user.id:
                        continue
                    pusher_client.trigger(f"user_{uid}", 'notify', {
                        'type': 'message',
                        'conversation_id': conv.id,
                        'from': getattr(request.user, 'display_name', '') or request.user.username,
                        'preview': preview_label[:80],
                        'last_message_at': msg.created_at.isoformat(),
                    })
        except Exception:
            pass
        # Web Push notification
        try:
            display = getattr(request.user, 'display_name', '') or request.user.username
            preview = preview_label[:60]
            try:
                avatar = request.build_absolute_uri(request.user.logo.url) if getattr(request.user, 'logo', None) else None
            except Exception:
                avatar = None
            payload = {
                "type": "message",
                "conversationId": conv.id,
                "senderDisplay": display,
                "preview": preview,
                "avatar": avatar,
                "clickUrl": f"/conversation/{conv.id}",
                "title": display,
                "body": preview,
            }
            for uid in get_conversation_viewer_ids(conv):
                if uid == request.user.id:
                    continue
                try:
                    user_obj = get_user_model().objects.get(id=uid)
                    send_web_push_to_user(user_obj, payload)
                except Exception:
                    pass
        except Exception:
            pass
        # FCM Push notification
        try:
            import logging
            logger = logging.getLogger(__name__)
            logger.info(f"📤 Attempting to send FCM push for attachment message {msg.id} in conversation {conv.id}")
            sender_display = getattr(request.user, 'display_name', '') or request.user.username
            preview_text = _normalize_bubble_text(preview_label)[:80] if preview_label else '📎 مرفق'
            send_message_push(
                conv,
                msg,
                title=sender_display,
                body=preview_text,
                data={
                    'sender_display': sender_display,
                    'preview': preview_text,
                    'kind': msg.type,
                    'attachment': attachment_payload,
                },
            )
            logger.info(f"✅ FCM push sent successfully for attachment message {msg.id}")
        except Exception as e:
            import logging
            logger = logging.getLogger(__name__)
            logger.exception(f"❌ send_message_push (attachment) failed: {e}")
        return Response(MessageSerializer(msg, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def mute(self, request, pk=None):
        conv = self.get_object()
        user = request.user
        obj, created = ConversationMute.objects.update_or_create(
            user=user, conversation=conv,
            defaults={ 'muted_until': None }
        )
        return Response({ 'mutedUntil': None })

    @mute.mapping.delete
    def unmute(self, request, pk=None):
        conv = self.get_object()
        user = request.user
        ConversationMute.objects.filter(user=user, conversation=conv).delete()
        return Response({ 'mutedUntil': None })

    @action(detail=True, methods=['get'])
    def summary(self, request, pk=None):
        """Return per-currency net balance for the conversation from perspective of user_a.
        net > 0 means user_b owes user_a; net < 0 means user_a owes user_b.
        Uses aggregated wallets difference between participants.
        """
        conv = self.get_object()
        from finance.models import Wallet
        user_a = conv.user_a
        user_b = conv.user_b
        wallets_a = {w.currency_id: w for w in Wallet.objects.filter(user=user_a)}
        wallets_b = {w.currency_id: w for w in Wallet.objects.filter(user=user_b)}
        currency_ids = set(wallets_a.keys()) | set(wallets_b.keys())
        data = []
        for cid in currency_ids:
            wa = wallets_a.get(cid)
            wb = wallets_b.get(cid)
            balance_a = wa.balance if wa else 0
            balance_b = wb.balance if wb else 0
            # net from perspective user_a
            net = balance_a - balance_b
            currency = wa.currency if wa else wb.currency
            data.append({
                'currency': {
                    'id': currency.id,
                    'code': currency.code,
                    'symbol': currency.symbol,
                },
                'user_a_balance': str(balance_a),
                'user_b_balance': str(balance_b),
                'net_from_user_a_perspective': str(net),
            })
        return Response({'conversation': conv.id, 'summary': data})

    @action(detail=True, methods=['post'])
    def clear(self, request, pk=None):
        """Delete all chat messages in this conversation without touching transactions.
        Resets last message preview/timestamps. Useful for 'clear chat content'.
        """
        conv = self.get_object()
        deleted, _ = Message.objects.filter(conversation=conv).delete()
        Conversation.objects.filter(pk=conv.pk).update(
            last_message_at=None,
            last_activity_at=None,
            last_message_preview="",
        )
        # Optionally notify inbox to refresh ordering/preview (set empty)
        try:
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync
            channel_layer = get_channel_layer()
            if channel_layer is not None:
                # notify both participants to refresh inbox
                for uid in [conv.user_a_id, conv.user_b_id]:
                    async_to_sync(channel_layer.group_send)(f"user_{uid}", {
                        'type': 'broadcast.message',
                        'data': {
                            'type': 'inbox.update',
                            'conversation_id': conv.id,
                            'last_message_preview': '',
                            'last_message_at': None,
                            'unread_count': 0,
                        }
                    })
        except Exception:
            pass
        return Response({'status': 'ok', 'deleted_messages': deleted})

    @action(detail=True, methods=['post'])
    def read(self, request, pk=None):
        """Mark conversation as read and persist read_at for messages the user has seen.
        Also notifies inbox and broadcasts a chat.read event to the conversation group.
        """
        conv = self.get_object()
        read_status_ids: list[int] = []
        read_iso: str | None = None
        # Persist read_at for messages from the other participant up to latest id
        try:
            last_msg = conv.messages.order_by('-id').first()
            if last_msg:
                from django.utils import timezone
                from django.db import models as dj_models
                qs = conv.messages.filter(id__lte=last_msg.id).exclude(sender_id=request.user.id)
                read_status_ids = list(qs.order_by('-id').values_list('id', flat=True)[:300])
                read_now = timezone.now()
                qs.update(
                    read_at=read_now, delivered_at=read_now,
                    delivery_status=dj_models.Case(
                        dj_models.When(delivery_status__lt=2, then=dj_models.Value(2)),
                        default=dj_models.F('delivery_status')
                    )
                )
                read_iso = read_now.isoformat()
        except Exception:
            read_status_ids = []
            read_iso = None
        # Notify via channels/pusher so inbox badge disappears
        try:
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync
            channel_layer = get_channel_layer()
            if channel_layer is not None:
                async_to_sync(channel_layer.group_send)(f"user_{request.user.id}", {
                    'type': 'broadcast.message',
                    'data': {
                        'type': 'inbox.update',
                        'conversation_id': conv.id,
                        'last_message_preview': conv.last_message_preview[:80] if conv.last_message_preview else '',
                        'last_message_at': conv.last_message_at.isoformat() if conv.last_message_at else None,
                        'unread_count': 0,
                    }
                })
                # Broadcast read receipt to conversation group
                last_id = None
                try:
                    last_id = conv.messages.order_by('-id').values_list('id', flat=True).first()
                except Exception:
                    last_id = None
                group_name = f"conv_{conv.id}"
                if read_status_ids and read_iso:
                    for mid in read_status_ids:
                        try:
                            async_to_sync(channel_layer.group_send)(group_name, {
                                'type': 'broadcast.message',
                                'data': { 'type': 'message.status', 'id': int(mid), 'delivery_status': 2, 'status': 'read', 'read_at': read_iso }
                            })
                        except Exception:
                            pass
                async_to_sync(channel_layer.group_send)(group_name, {
                    'type': 'broadcast.message',
                    'data': {
                        'type': 'chat.read',
                        'reader': request.user.username,
                        'last_read_id': last_id,
                    }
                })
        except Exception:
            pass
        try:
            from .pusher_client import pusher_client
            if pusher_client:
                pusher_client.trigger(f"user_{request.user.id}", 'notify', {
                    'type': 'inbox.update',
                    'conversation_id': conv.id,
                    'last_message_preview': conv.last_message_preview[:80] if conv.last_message_preview else '',
                    'last_message_at': conv.last_message_at.isoformat() if conv.last_message_at else None,
                    'unread_count': 0,
                })
        except Exception:
            pass
        return Response({'status': 'ok'})

    @action(detail=True, methods=['get'])
    def net_balance(self, request, pk=None):
        """Compute net per currency from the transaction history only (ignores current wallet state).
        For each currency: sum( +amount for direction=lna by user_a OR direction=lkm by user_b )
        and subtract the opposite. Returned net is from perspective user_a.
        """
        conv = self.get_object()
        txns = conv.transactions.select_related('currency')
        aggregates = {}
        for t in txns:
            cur = t.currency
            bucket = aggregates.setdefault(cur.id, {
                'currency': {
                    'id': cur.id,
                    'code': cur.code,
                    'symbol': cur.symbol,
                },
                'net_from_user_a_perspective': 0,
            })
            # perspective user_a: direction=lna by user_a adds, direction=lna by user_b subtracts
            # direction=lkm inverse
            if t.direction == 'lna':
                if t.from_user_id == conv.user_a_id:
                    bucket['net_from_user_a_perspective'] += float(t.amount)
                else:
                    bucket['net_from_user_a_perspective'] -= float(t.amount)
            else:  # lkm
                if t.from_user_id == conv.user_a_id:
                    bucket['net_from_user_a_perspective'] -= float(t.amount)
                else:
                    bucket['net_from_user_a_perspective'] += float(t.amount)
        # stringify numbers
        for b in aggregates.values():
            b['net_from_user_a_perspective'] = str(b['net_from_user_a_perspective'])
        return Response({'conversation': conv.id, 'net': list(aggregates.values())})

    # ----- Team-based membership management -----
    def _require_participant(self, user, conv: Conversation):
        if user not in [conv.user_a, conv.user_b]:
            raise ValidationError({'detail': 'فقط طرفا المحادثة يمكنهما إدارة الأعضاء'})

    @action(detail=True, methods=['get'])
    def members(self, request, pk=None):
        conv = self.get_object()
        base = [conv.user_a, conv.user_b]
        extras_users = User.objects.filter(conversation_memberships__conversation=conv).distinct()
        team_members = TeamMember.objects.filter(conversation_team_memberships__conversation=conv).select_related('owner').distinct()
        data = []
        for u in base:
            data.append({
                'id': u.id,
                'username': u.username,
                'display_name': getattr(u, 'display_name', '') or u.username,
                'role': 'participant',
            })
        for u in extras_users:
            data.append({
                'id': u.id,
                'username': u.username,
                'display_name': getattr(u, 'display_name', '') or u.username,
                'role': 'team',
            })
        for tm in team_members:
            data.append({
                'id': tm.id,
                'username': tm.username,
                'display_name': tm.display_name or tm.username,
                'role': 'team_member',
            })
        return Response({'members': data})

    @action(detail=True, methods=['post'])
    def add_team_member(self, request, pk=None):
        conv = self.get_object()
        self._require_participant(request.user, conv)
        acting_team_id = getattr(getattr(self.request, 'auth', None), 'payload', {}).get('team_member_id') if getattr(self.request, 'auth', None) else None
        if acting_team_id:
            return Response({'detail': 'غير مسموح لأعضاء الفريق بإدارة أعضاء المحادثة'}, status=403)
        serializer = ConversationMemberSerializer(data=request.data, context={'request': request, 'conversation': conv})
        serializer.is_valid(raise_exception=True)
        cm = serializer.save()
        # Create a system message noting the addition
        try:
            owner_display = getattr(request.user, 'display_name', '') or request.user.username
            tm = getattr(cm, 'member_team', None)
            added_display = (tm.display_name or tm.username) if tm else 'عضو'
            sys_msg = Message.objects.create(
                conversation=conv,
                sender=request.user,
                type='system',
                body=f"قام {owner_display} بإضافة عضو الفريق {added_display}"
            )
            # Realtime broadcast (Channels)
            try:
                from channels.layers import get_channel_layer
                from asgiref.sync import async_to_sync
                channel_layer = get_channel_layer()
                if channel_layer is not None:
                    group = f"conv_{conv.id}"
                    payload = {
                        'type': 'chat.message',
                        'id': sys_msg.id,
                        'conversation_id': conv.id,
                        'sender': request.user.username,
                        'senderDisplay': owner_display,
                        'body': sys_msg.body,
                        'created_at': sys_msg.created_at.isoformat(),
                        'kind': 'system',
                        'seq': sys_msg.id,
                    }
                    async_to_sync(channel_layer.group_send)(group, {'type': 'broadcast.message', 'data': payload})
                    from .push import _total_unread_for_user
                    for uid in get_conversation_viewer_ids(conv):
                        if uid == request.user.id:
                            continue
                        user_unread = _total_unread_for_user(uid)
                        import logging
                        logger = logging.getLogger(__name__)
                        logger.info(f"📨 [WS] Sending inbox.update (add_member) to user {uid}: unread_count={user_unread}")
                        async_to_sync(channel_layer.group_send)(f"user_{uid}", {
                            'type': 'broadcast.message',
                            'data': {
                                'type': 'inbox.update',
                                'conversation_id': conv.id,
                                'last_message_preview': sys_msg.body[:80],
                                'last_message_at': sys_msg.created_at.isoformat(),
                                'unread_count': user_unread,
                            }
                        })
            except Exception:
                pass
            # Pusher broadcast
            try:
                from .pusher_client import pusher_client
                if pusher_client:
                    pusher_client.trigger(f"chat_{conv.id}", 'message', {
                        'username': request.user.username,
                        'display_name': owner_display,
                        'message': sys_msg.body,
                        'conversation_id': conv.id,
                        'senderDisplay': owner_display,
                        'kind': 'system',
                    })
            except Exception:
                pass
        except Exception:
            pass
        return Response(ConversationMemberSerializer(cm, context={'request': request, 'conversation': conv}).data, status=201)

    @action(detail=True, methods=['post'])
    def remove_member(self, request, pk=None):
        conv = self.get_object()
        self._require_participant(request.user, conv)
        acting_team_id = getattr(getattr(self.request, 'auth', None), 'payload', {}).get('team_member_id') if getattr(self.request, 'auth', None) else None
        if acting_team_id:
            return Response({'detail': 'غير مسموح لأعضاء الفريق بإدارة أعضاء المحادثة'}, status=403)
        member_id = request.data.get('member_id')
        member_type = request.data.get('member_type')  # 'user' or 'team_member'
        try:
            member_id = int(member_id)
        except Exception:
            return Response({'detail': 'member_id required'}, status=400)
        removed_display = ''
        if member_type == 'team_member':
            try:
                tm = TeamMember.objects.get(id=member_id)
                removed_display = tm.display_name or tm.username
            except TeamMember.DoesNotExist:
                removed_display = 'عضو فريق'
            ConversationMember.objects.filter(conversation=conv, member_team_id=member_id).delete()
        else:
            try:
                u = get_user_model().objects.get(id=member_id)
                removed_display = getattr(u, 'display_name', '') or u.username
            except Exception:
                removed_display = 'مستخدم'
            ConversationMember.objects.filter(conversation=conv, member_user_id=member_id).delete()
        # Create a system message noting the removal
        try:
            owner_display = getattr(request.user, 'display_name', '') or request.user.username
            sys_msg = Message.objects.create(
                conversation=conv,
                sender=request.user,
                type='system',
                body=f"قام {owner_display} بإزالة {removed_display} من المحادثة"
            )
            # Channels broadcast
            try:
                from channels.layers import get_channel_layer
                from asgiref.sync import async_to_sync
                channel_layer = get_channel_layer()
                if channel_layer is not None:
                    group = f"conv_{conv.id}"
                    payload = {
                        'type': 'chat.message',
                        'id': sys_msg.id,
                        'conversation_id': conv.id,
                        'sender': request.user.username,
                        'senderDisplay': owner_display,
                        'body': sys_msg.body,
                        'created_at': sys_msg.created_at.isoformat(),
                        'kind': 'system',
                        'seq': sys_msg.id,
                    }
                    async_to_sync(channel_layer.group_send)(group, {'type': 'broadcast.message', 'data': payload})
                    from .push import _total_unread_for_user
                    for uid in get_conversation_viewer_ids(conv):
                        if uid == request.user.id:
                            continue
                        user_unread = _total_unread_for_user(uid)
                        import logging
                        logger = logging.getLogger(__name__)
                        logger.info(f"📨 [WS] Sending inbox.update (remove_member) to user {uid}: unread_count={user_unread}")
                        async_to_sync(channel_layer.group_send)(f"user_{uid}", {
                            'type': 'broadcast.message',
                            'data': {
                                'type': 'inbox.update',
                                'conversation_id': conv.id,
                                'last_message_preview': sys_msg.body[:80],
                                'last_message_at': sys_msg.created_at.isoformat(),
                                'unread_count': user_unread,
                            }
                        })
            except Exception:
                pass
            # Pusher broadcast
            try:
                from .pusher_client import pusher_client
                if pusher_client:
                    pusher_client.trigger(f"chat_{conv.id}", 'message', {
                        'username': request.user.username,
                        'display_name': owner_display,
                        'message': sys_msg.body,
                        'conversation_id': conv.id,
                        'senderDisplay': owner_display,
                        'kind': 'system',
                    })
            except Exception:
                pass
        except Exception:
            pass
        return Response({'status': 'ok'})

class MessageViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = MessageSerializer
    permission_classes = [IsParticipant]

    def get_queryset(self):
        user = self.request.user
        acting_team_id = getattr(getattr(self.request, 'auth', None), 'payload', {}).get('team_member_id') if getattr(self.request, 'auth', None) else None
        base = Message.objects.select_related('conversation', 'sender')
        if acting_team_id:
            return base.filter(Q(conversation__extra_members__member_team_id=acting_team_id)).distinct()
        return base.filter(
            Q(conversation__user_a=user) | Q(conversation__user_b=user) | Q(conversation__extra_members__member_user=user) | Q(conversation__extra_members__member_team__owner=user)
        ).distinct()

class TransactionViewSet(mixins.CreateModelMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = TransactionSerializer
    permission_classes = [IsParticipant]
    throttle_scope = 'transaction'

    def get_queryset(self):
        user = self.request.user
        acting_team_id = getattr(getattr(self.request, 'auth', None), 'payload', {}).get('team_member_id') if getattr(self.request, 'auth', None) else None
        base = Transaction.objects.select_related('conversation', 'currency', 'from_user', 'to_user')
        if acting_team_id:
            base = base.filter(Q(conversation__extra_members__member_team_id=acting_team_id)).distinct()
        else:
            base = base.filter(
                Q(conversation__user_a=user) | Q(conversation__user_b=user) | Q(conversation__extra_members__member_user=user) | Q(conversation__extra_members__member_team__owner=user)
            ).distinct()

        conversation_param = self.request.query_params.get('conversation')
        if conversation_param:
            try:
                cid = int(conversation_param)
                base = base.filter(conversation_id=cid)
            except (TypeError, ValueError):
                pass

        from_date = self.request.query_params.get('from_date') or self.request.query_params.get('from')
        to_date = self.request.query_params.get('to_date') or self.request.query_params.get('to')
        if from_date:
            try:
                dt = datetime.strptime(from_date, '%Y-%m-%d')
                start_candidate = datetime.combine(dt.date(), time.min)
                start = make_aware(start_candidate) if timezone.is_naive(start_candidate) else start_candidate
                base = base.filter(created_at__gte=start)
            except Exception:
                pass
        if to_date:
            try:
                dt = datetime.strptime(to_date, '%Y-%m-%d')
                end_candidate = datetime.combine(dt.date(), time.max)
                aware_end = make_aware(end_candidate) if timezone.is_naive(end_candidate) else end_candidate
                base = base.filter(created_at__lte=aware_end)
            except Exception:
                pass

        ordering_param = self.request.query_params.get('ordering')
        if ordering_param:
            allowed = {'created_at', '-created_at', 'id', '-id'}
            if ordering_param in allowed:
                base = base.order_by(ordering_param)

        return base


from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, AllowAny
from django.urls import reverse
from .models import NotificationSetting
from django.contrib.auth.hashers import check_password
from rest_framework_simplejwt.tokens import RefreshToken


class PushSubscribeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = PushSubscriptionSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        sub = serializer.save()
        return Response({"status": "ok", "id": sub.id})


class PushUnsubscribeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        endpoint = request.data.get('endpoint')
        if not endpoint:
            return Response({'detail': 'endpoint required'}, status=400)
        PushSubscription.objects.filter(user=request.user, endpoint=endpoint).delete()
        return Response({"status": "ok"})


class NotificationSoundView(APIView):
    permission_classes = []  # public

    def get(self, request):
        ns = NotificationSetting.objects.filter(active=True).order_by('-updated_at', '-id').first()
        url = None
        if ns and ns.sound:
            try:
                url = request.build_absolute_uri(ns.sound.url)
            except Exception:
                url = None
        return Response({ 'sound_url': url })


class BrandingView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        branding = BrandingSetting.objects.filter(active=True).order_by('-updated_at', '-id').first()
        url = None
        if branding and branding.logo:
            try:
                url = request.build_absolute_uri(branding.logo.url)
            except Exception:
                try:
                    url = branding.logo.url
                except Exception:
                    url = None
        return Response({'logo_url': url})


class LoginPageView(APIView):
    permission_classes = [AllowAny]

    def _get_branding_logo(self, request):
        branding = BrandingSetting.objects.filter(active=True).order_by('-updated_at', '-id').first()
        if not branding or not getattr(branding, 'logo', None):
            return None
        try:
            return request.build_absolute_uri(branding.logo.url)
        except Exception:
            try:
                return branding.logo.url
            except Exception:
                return None

    def _default_payload(self):
        try:
            current_year = str(timezone.now().year)
        except Exception:
            from datetime import datetime
            current_year = str(datetime.utcnow().year)
        return {
            'id': None,
            'hero_title': "طريقة تسجيل الدخول إلى حسابك في موقع مطابقة ويب:",
            'hero_description': "اتبع الخطوات التالية لإتمام الربط عبر رمز QR من تطبيق مطابقة على هاتفك.",
            'instructions_title': "خطوات تسجيل الدخول:",
            'stay_logged_in_label': "ابقَ مسجل الدخول على هذا المتصفح",
            'stay_logged_in_hint': "استخدم هذا الخيار على أجهزتك الشخصية فقط.",
            'alternate_login_label': "تسجيل الدخول برقم الهاتف",
            'alternate_login_url': "",
            'footer_links_label': "شروط الاستخدام و سياسة الخصوصية",
            'footer_note': "تابعنا أو تواصل معنا عبر القنوات التالية:",
            'footer_secondary_note': "جميع الحقوق محفوظة لموقع مطابقة",
            'footer_brand_name': "Mutabaka",
            'footer_year_override': "",
            'login_logo_url': None,
            'footer_year': current_year,
            'instructions': [
                {'id': None, 'title': "", 'description': "افتح تطبيق <strong>مطابقة</strong> على هاتفك النقّال", 'icon_hint': "app", 'display_order': 1},
                {'id': None, 'title': "", 'description': "اضغط على زر القائمة ⋮ في التطبيق", 'icon_hint': "menu", 'display_order': 2},
                {'id': None, 'title': "", 'description': "انتقل إلى قسم <strong>الأجهزة المرتبطة</strong> ثم اختر <strong>ربط جهاز</strong>", 'icon_hint': "devices", 'display_order': 3},
                {'id': None, 'title': "", 'description': "وجّه الكاميرا نحو رمز QR ليتم تسجيل دخولك تلقائيًا", 'icon_hint': "scan", 'display_order': 4},
            ],
        }

    def get(self, request):
        setting = (
            LoginPageSetting.objects.filter(is_active=True)
            .prefetch_related('instructions')
            .order_by('-updated_at', '-id')
            .first()
        )
        if setting:
            serializer = LoginPageSettingSerializer(setting, context={'request': request})
            payload = serializer.data
        else:
            payload = self._default_payload()
        if not payload.get('login_logo_url'):
            branding_logo = self._get_branding_logo(request)
            if branding_logo:
                payload['login_logo_url'] = branding_logo
        return Response(payload)


class ContactLinkListView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        qs = ContactLink.objects.filter(is_active=True).order_by('display_order', '-updated_at')
        serializer = ContactLinkSerializer(qs, many=True, context={'request': request})
        return Response(serializer.data)


class CustomEmojiListView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        qs = CustomEmoji.objects.filter(is_active=True).order_by('display_order', 'id')
        serializer = CustomEmojiSerializer(qs, many=True)
        return Response(serializer.data)


class PrivacyPolicyView(APIView):
    permission_classes = [AllowAny]
    default_document_type = PrivacyPolicy.DOCUMENT_TYPE_PRIVACY

    def _normalize_document_type(self, raw: str | None) -> str:
        if raw is None:
            return self.default_document_type
        raw_norm = raw.strip().lower()
        valid_types = {choice[0]: choice[0] for choice in PrivacyPolicy.DOCUMENT_TYPE_CHOICES}
        if raw_norm in valid_types:
            return raw_norm
        return raw_norm  # unknown types will result in 404 when querying

    def get(self, request, *args, **kwargs):
        param_type = request.query_params.get('type') or request.query_params.get('document_type')
        kw_type = kwargs.get('document_type')
        document_type = self._normalize_document_type(param_type or kw_type)
        policy = (
            PrivacyPolicy.objects.filter(is_active=True, document_type=document_type)
            .order_by('display_order', '-updated_at')
            .first()
        )
        if not policy:
            return Response({'detail': 'policy not found'}, status=404)
        serializer = PrivacyPolicySerializer(policy, context={'request': request})
        return Response(serializer.data)


class TermsOfUseView(PrivacyPolicyView):
    default_document_type = PrivacyPolicy.DOCUMENT_TYPE_TERMS


class TeamLoginView(APIView):
    permission_classes = []  # public

    def post(self, request):
        owner_username = (request.data.get('owner_username') or '').strip()
        team_username = (request.data.get('team_username') or '').strip()
        password = request.data.get('password') or ''
        if not owner_username or not team_username or not password:
            return Response({'detail': 'owner_username, team_username, password are required'}, status=400)
        try:
            owner = get_user_model().objects.get(username__iexact=owner_username)
        except get_user_model().DoesNotExist:
            return Response({'detail': 'invalid credentials'}, status=401)
        try:
            tm = TeamMember.objects.get(owner=owner, username__iexact=team_username, is_active=True)
        except TeamMember.DoesNotExist:
            return Response({'detail': 'invalid credentials'}, status=401)
        try:
            if not check_password(password, tm.password_hash):
                return Response({'detail': 'invalid credentials'}, status=401)
        except Exception:
            return Response({'detail': 'invalid credentials'}, status=401)
        refresh = RefreshToken.for_user(owner)
        refresh['actor'] = 'team_member'
        refresh['team_member_id'] = tm.id
        refresh['owner_id'] = owner.id
        access = refresh.access_token
        return Response({'access': str(access), 'refresh': str(refresh), 'actor': 'team_member', 'team_member_id': tm.id, 'owner_id': owner.id})


class EnsureAdminConversationView(APIView):
    """Authenticated endpoint to ensure a conversation with admin exists for current user.

    If no admin user found or conversation already exists, it's a no-op. Returns {created: bool, conversation_id?: number}.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        # find an admin (prefer superuser then fallback to username 'admin')
        admin = get_user_model().objects.filter(is_superuser=True).order_by('id').first()
        if not admin:
            admin = get_user_model().objects.filter(username__iexact='admin').order_by('id').first()
        if not admin or admin.id == user.id:
            return Response({'created': False})
        # normalize pair
        a, b = (user, admin) if user.id < admin.id else (admin, user)
        existing = Conversation.objects.filter(user_a=a, user_b=b).first()
        if existing:
            return Response({'created': False, 'conversation_id': existing.id})
        conv = Conversation.objects.create(user_a=a, user_b=b)
        return Response({'created': True, 'conversation_id': conv.id})
