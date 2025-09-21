from rest_framework import viewsets, mixins, status
from rest_framework.response import Response
from rest_framework.decorators import action
from django.conf import settings
from django.core.exceptions import ValidationError
import mimetypes
from django.core.files.storage import default_storage
from django.db.models import Q
from django.contrib.auth import get_user_model
from .models import ContactRelation, Conversation, Message, Transaction, PushSubscription, ConversationMute, TeamMember, ConversationMember, get_conversation_viewer_ids
from .serializers import (
    PublicUserSerializer, ContactRelationSerializer, ConversationSerializer,
    MessageSerializer, TransactionSerializer, PushSubscriptionSerializer,
    TeamMemberSerializer, ConversationMemberSerializer,
)
from .permissions import IsParticipant
from django.conf import settings
from django.utils import timezone

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
    if not _has_active_subscription(user):
        return 0
    try:
        code = (getattr(user.subscription.plan, 'code', '') or '').lower()
    except Exception:
        code = ''
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


def _ensure_can_message_or_contact(user, other=None, conversation: Conversation | None = None):
    """يرفع ValidationError برسالة عربية عند عدم السماح بالمراسلة/الإنشاء.

    - بدون اشتراك نشط: يُسمح فقط مع admin.
    - مع اشتراك نشط: يُسمح مع الجميع، لكن إنشاء محادثات جديدة يخضع للحد.
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
    if not _has_active_subscription(user):
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

    def get_queryset(self):
        return ContactRelation.objects.filter(owner=self.request.user)


class TeamMemberViewSet(viewsets.ModelViewSet):
    """CRUD for the current user's team."""
    serializer_class = TeamMemberSerializer

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
        # قيود الاشتراك: السماح دوماً بمحادثة admin، غير ذلك يتطلب اشتراك نشط واحترام الحد
        if not _is_admin_user(other):
            if not _has_active_subscription(user):
                return Response({'detail': 'لا يمكنك إنشاء محادثات جديدة بدون اشتراك نشط. يمكنك مراسلة admin فقط.'}, status=403)
            # تحقق الحد حسب الباقة
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
        # بث عبر Pusher للطرف الآخر
        try:
            from .pusher_client import pusher_client
            if pusher_client:
                pusher_client.trigger(f"chat_{conv.id}", 'message', {
                    'type': 'delete.request',
                    'conversation_id': conv.id,
                    'username': user.username,
                })
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
        # احذف المحادثة وجميع رسائلها
        cid = conv.id
        conv.delete()
        # أرسل تأكيد عبر Pusher للطرفين
        try:
            from .pusher_client import pusher_client
            if pusher_client:
                pusher_client.trigger(f"chat_{cid}", 'message', {
                    'type': 'delete.approved',
                    'conversation_id': cid,
                    'username': user.username,
                })
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
        # بث رفض للطرف الآخر
        try:
            from .pusher_client import pusher_client
            if pusher_client:
                pusher_client.trigger(f"chat_{conv.id}", 'message', {
                    'type': 'delete.declined',
                    'conversation_id': conv.id,
                    'username': user.username,
                })
        except Exception:
            pass
        return Response({'status': 'ok'})

    @action(detail=True, methods=['get'])
    def messages(self, request, pk=None):
        conv = self.get_object()
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
        if since_id:
            qs = conv.messages.filter(id__gt=since_id).order_by('created_at')[:limit]
        elif before:
            try:
                b = int(before)
                qs = conv.messages.filter(id__lt=b).order_by('-created_at')[:limit]
                qs = qs[::-1]  # return ascending
            except (TypeError, ValueError):
                qs = conv.messages.all().order_by('-created_at')[:limit]
        else:
            qs = conv.messages.all().order_by('-created_at')[:limit]
        return Response(MessageSerializer(qs, many=True, context={'request': request}).data)

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
        if not body:
            return Response({'detail': 'Empty body'}, status=400)
        # If acting as team member, set on message
        acting_team_id = getattr(getattr(request, 'auth', None), 'payload', {}).get('team_member_id') if getattr(request, 'auth', None) else None
        msg_kwargs = { 'conversation': conv, 'sender': request.user, 'body': body, 'type': 'text' }
        if acting_team_id:
            try:
                tm = TeamMember.objects.get(id=acting_team_id, owner=request.user, is_active=True)
                msg_kwargs['sender_team_member'] = tm
            except Exception:
                pass
        msg = Message.objects.create(**msg_kwargs)
        # broadcast via WS for realtime delivery
        try:
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync
            channel_layer = get_channel_layer()
            if channel_layer is not None:
                group = f"conv_{conv.id}"
                payload = {
                    'type': 'chat.message',
                    'id': msg.id,
                    'conversation_id': conv.id,
                    'sender': request.user.username,
                    'body': msg.body,
                    'created_at': msg.created_at.isoformat(),
                    'kind': 'text',
                    'seq': msg.id,
                }
                async_to_sync(channel_layer.group_send)(group, {'type': 'broadcast.message', 'data': payload})
                # notify all viewers' inboxes (except sender)
                for uid in get_conversation_viewer_ids(conv):
                    if uid == request.user.id:
                        continue
                    async_to_sync(channel_layer.group_send)(f"user_{uid}", {
                        'type': 'broadcast.message',
                        'data': {
                            'type': 'inbox.update',
                            'conversation_id': conv.id,
                            'last_message_preview': msg.body[:80],
                            'last_message_at': msg.created_at.isoformat(),
                            'unread_count': 1,
                        }
                    })
        except Exception:
            pass
        # Also trigger Pusher 'message' event for unified realtime on the frontend
        try:
            from .pusher_client import pusher_client
            if pusher_client:
                pusher_client.trigger(f"chat_{conv.id}", 'message', {
                    'username': request.user.username,
                    'display_name': getattr(request.user, 'display_name', '') or request.user.username,
                    'message': msg.body,
                    'conversation_id': conv.id,
                })
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
        caption = (request.data.get('body') or '').strip()
        msg_kwargs = {
            'conversation': conv,
            'sender': request.user,
            'body': caption,
            'type': 'text',  # keep as text type; attachment fields indicate presence
            'attachment': file_obj,
            'attachment_name': getattr(file_obj, 'name', ''),
            'attachment_mime': mime or '',
            'attachment_size': size,
        }
        acting_team_id = getattr(getattr(request, 'auth', None), 'payload', {}).get('team_member_id') if getattr(request, 'auth', None) else None
        if acting_team_id:
            try:
                tm = TeamMember.objects.get(id=acting_team_id, owner=request.user, is_active=True)
                msg_kwargs['sender_team_member'] = tm
            except Exception:
                pass
        msg = Message.objects.create(**msg_kwargs)
        # Realtime broadcast via channels (if configured)
        try:
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync
            channel_layer = get_channel_layer()
            if channel_layer is not None:
                group = f"conv_{conv.id}"
                payload = {
                    'type': 'chat.message',
                    'id': msg.id,
                    'conversation_id': conv.id,
                    'sender': request.user.username,
                    'body': msg.body,
                    'created_at': msg.created_at.isoformat(),
                    'kind': 'text',
                    'seq': msg.id,
                    'attachment': {
                        'name': msg.attachment_name,
                        'mime': msg.attachment_mime,
                        'size': msg.attachment_size,
                    }
                }
                async_to_sync(channel_layer.group_send)(group, {'type': 'broadcast.message', 'data': payload})
                for uid in get_conversation_viewer_ids(conv):
                    if uid == request.user.id:
                        continue
                    async_to_sync(channel_layer.group_send)(f"user_{uid}", {
                        'type': 'broadcast.message',
                        'data': {
                            'type': 'inbox.update',
                            'conversation_id': conv.id,
                            'last_message_preview': (caption or msg.attachment_name or 'مرفق')[:80],
                            'last_message_at': msg.created_at.isoformat(),
                            'unread_count': 1,
                        }
                    })
        except Exception:
            pass
        # Pusher trigger for unified realtime
        try:
            from .pusher_client import pusher_client
            if pusher_client:
                pusher_client.trigger(f"chat_{conv.id}", 'message', {
                    'username': request.user.username,
                    'display_name': getattr(request.user, 'display_name', '') or request.user.username,
                    'message': caption or (msg.attachment_name or 'مرفق'),
                    'conversation_id': conv.id,
                })
                for uid in get_conversation_viewer_ids(conv):
                    if uid == request.user.id:
                        continue
                    pusher_client.trigger(f"user_{uid}", 'notify', {
                        'type': 'message',
                        'conversation_id': conv.id,
                        'from': getattr(request.user, 'display_name', '') or request.user.username,
                        'preview': (caption or msg.attachment_name or 'مرفق')[:80],
                        'last_message_at': msg.created_at.isoformat(),
                    })
        except Exception:
            pass
        # Web Push notification
        try:
            display = getattr(request.user, 'display_name', '') or request.user.username
            preview = (caption or msg.attachment_name or 'مرفق')[:60]
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
        """Mark conversation as read for the current user. For now, we just notify inbox to reset badge.
        Future: persist per-user unread state in DB.
        """
        conv = self.get_object()
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
        serializer = ConversationMemberSerializer(data=request.data, context={'request': request, 'conversation': conv})
        serializer.is_valid(raise_exception=True)
        cm = serializer.save()
        return Response(ConversationMemberSerializer(cm, context={'request': request, 'conversation': conv}).data, status=201)

    @action(detail=True, methods=['post'])
    def remove_member(self, request, pk=None):
        conv = self.get_object()
        self._require_participant(request.user, conv)
        member_id = request.data.get('member_id')
        member_type = request.data.get('member_type')  # 'user' or 'team_member'
        try:
            member_id = int(member_id)
        except Exception:
            return Response({'detail': 'member_id required'}, status=400)
        if member_type == 'team_member':
            ConversationMember.objects.filter(conversation=conv, member_team_id=member_id).delete()
        else:
            ConversationMember.objects.filter(conversation=conv, member_user_id=member_id).delete()
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
            return base.filter(Q(conversation__extra_members__member_team_id=acting_team_id)).distinct()
        return base.filter(
            Q(conversation__user_a=user) | Q(conversation__user_b=user) | Q(conversation__extra_members__member_user=user) | Q(conversation__extra_members__member_team__owner=user)
        ).distinct()


from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
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
