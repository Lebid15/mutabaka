from rest_framework import serializers
import re
from django.contrib.auth import get_user_model
from .models import ContactRelation, Conversation, Message, Transaction, PushSubscription, ConversationMute, TeamMember, ConversationMember, ConversationReadMarker, ContactLink, PrivacyPolicy
from finance.models import Currency
from django.core.exceptions import ValidationError

try:
    # استخدم نفس الدوال المساعدة من views بدون تكرار كبير
    from .views import _ensure_can_message_or_contact  # type: ignore
except Exception:
    _ensure_can_message_or_contact = None  # type: ignore

User = get_user_model()

class PublicUserSerializer(serializers.ModelSerializer):
    logo_url = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "display_name", "first_name", "last_name", "email", "logo_url"]

    def get_logo_url(self, obj):  # pragma: no cover - simple serialization
        try:
            if getattr(obj, 'logo', None):
                request = self.context.get('request') if hasattr(self, 'context') else None
                if request is not None:
                    return request.build_absolute_uri(obj.logo.url)
                return obj.logo.url
        except Exception:
            return None
        return None

class CurrencySerializer(serializers.ModelSerializer):
    class Meta:
        model = Currency
        fields = ["id", "code", "symbol", "name"]


_TRANSACTION_BODY_RE = re.compile(r'^معاملة:\s*(لنا|لكم)\s*([0-9]+(?:\.[0-9]+)?)\s*([^\s]+)(?:\s*-\s*(.*))?$', re.DOTALL | re.MULTILINE)


def _parse_transaction_body(body: str | None):
    if not body:
        return None
    try:
        text = body.strip()
    except Exception:
        return None
    m = _TRANSACTION_BODY_RE.match(text)
    if not m:
        return None
    direction = 'lna' if m.group(1) == 'لنا' else 'lkm'
    amount_raw = m.group(2)
    symbol = (m.group(3) or '').strip()
    note = (m.group(4) or '').strip()
    try:
        amount_val = float(amount_raw)
    except Exception:
        try:
            amount_val = float(amount_raw.replace(',', '.'))
        except Exception:
            amount_val = 0.0
    return {
        'direction': direction,
        'amount': amount_val,
        'currency': symbol,
        'symbol': symbol,
        'note': note,
    }


class ContactLinkSerializer(serializers.ModelSerializer):
    icon_display = serializers.SerializerMethodField()

    class Meta:
        model = ContactLink
        fields = ["id", "icon", "icon_display", "label", "value"]

    def get_icon_display(self, obj):
        try:
            return obj.get_icon_display()
        except Exception:
            return obj.icon


class PrivacyPolicySerializer(serializers.ModelSerializer):

    class Meta:
        model = PrivacyPolicy
        fields = ["id", "title", "content", "document_type", "updated_at", "created_at"]

class ContactRelationSerializer(serializers.ModelSerializer):
    contact = PublicUserSerializer(read_only=True)
    contact_id = serializers.PrimaryKeyRelatedField(queryset=User.objects.all(), source='contact', write_only=True)

    class Meta:
        model = ContactRelation
        fields = ["id", "owner", "contact", "contact_id", "status", "created_at"]
        read_only_fields = ["id", "owner", "status", "created_at"]

    def create(self, validated_data):
        validated_data['owner'] = self.context['request'].user
        validated_data['status'] = 'accepted'
        return super().create(validated_data)

class ConversationSerializer(serializers.ModelSerializer):
    user_a = PublicUserSerializer(read_only=True)
    user_b = PublicUserSerializer(read_only=True)
    mutedUntil = serializers.SerializerMethodField()
    isMuted = serializers.SerializerMethodField()

    class Meta:
        model = Conversation
        fields = [
            "id", "user_a", "user_b", "created_at",
            "last_message_at", "last_activity_at", "last_message_preview",
            "mutedUntil", "isMuted",
        ]

    def get_mutedUntil(self, obj):
        request = self.context.get('request') if hasattr(self, 'context') else None
        if not request or not request.user or not request.user.is_authenticated:
            return None
        try:
            m = ConversationMute.objects.filter(user=request.user, conversation=obj).first()
            return m.muted_until.isoformat() if (m and m.muted_until) else None
        except Exception:
            return None

    def get_isMuted(self, obj):
        request = self.context.get('request') if hasattr(self, 'context') else None
        if not request or not request.user or not request.user.is_authenticated:
            return False
        try:
            m = ConversationMute.objects.filter(user=request.user, conversation=obj).first()
            if not m:
                return False
            if m.muted_until is None:
                return True
            from django.utils import timezone
            return m.muted_until > timezone.now()
        except Exception:
            return False


class TeamMemberSerializer(serializers.ModelSerializer):
    owner = PublicUserSerializer(read_only=True)
    password = serializers.CharField(write_only=True, required=True)

    class Meta:
        model = TeamMember
        fields = ["id", "owner", "username", "display_name", "phone", "password", "is_active", "created_at", "updated_at"]
        read_only_fields = ["id", "owner", "created_at", "updated_at"]

    def create(self, validated_data):
        from django.contrib.auth.hashers import make_password
        request = self.context['request']
        password = validated_data.pop('password')
        username = (validated_data.get('username') or '').strip()
        if not username:
            raise serializers.ValidationError({'username': 'required'})
        # Enforce Latin letters only for team usernames
        # Accept only A-Z or a-z characters to avoid Arabic or other scripts
        if not re.fullmatch(r"[A-Za-z]+", username):
            raise serializers.ValidationError({'username': 'اسم المستخدم يجب أن يتكون من أحرف لاتينية فقط (A-Z) دون أرقام أو مسافات'})
        tm = TeamMember.objects.create(
            owner=request.user,
            username=username,
            display_name=validated_data.get('display_name', '') or username,
            phone=validated_data.get('phone', '') or '',
            password_hash=make_password(password),
            is_active=True,
        )
        return tm

    def update(self, instance, validated_data):
        from django.contrib.auth.hashers import make_password
        pwd = validated_data.pop('password', None)
        if 'username' in validated_data:
            new_username = (validated_data['username'] or '').strip()
            if not re.fullmatch(r"[A-Za-z]+", new_username):
                raise serializers.ValidationError({'username': 'اسم المستخدم يجب أن يتكون من أحرف لاتينية فقط (A-Z) دون أرقام أو مسافات'})
            instance.username = new_username
        if 'display_name' in validated_data:
            instance.display_name = validated_data['display_name'] or instance.username
        if 'phone' in validated_data:
            instance.phone = validated_data['phone'] or ''
        if 'is_active' in validated_data:
            instance.is_active = bool(validated_data['is_active'])
        if pwd:
            instance.password_hash = make_password(pwd)
        instance.save()
        return instance


class ConversationMemberSerializer(serializers.ModelSerializer):
    type = serializers.SerializerMethodField()
    display_name = serializers.SerializerMethodField()
    team_member_id = serializers.IntegerField(write_only=True, required=False)
    member = PublicUserSerializer(read_only=True)

    class Meta:
        model = ConversationMember
        fields = ["id", "conversation", "member", "team_member_id", "added_by", "created_at", "type", "display_name"]
        read_only_fields = ["id", "member", "added_by", "created_at", "conversation", "type", "display_name"]

    def get_type(self, obj):
        return 'team_member' if obj.member_team_id else 'user'

    def get_display_name(self, obj):
        if obj.member_team_id:
            return obj.member_team.display_name or obj.member_team.username
        if obj.member_user_id:
            u = obj.member_user
            return getattr(u, 'display_name', '') or u.username
        return ''

    def create(self, validated_data):
        request = self.context['request']
        conv = self.context.get('conversation')
        if not conv:
            raise serializers.ValidationError({'detail': 'conversation required'})
        team_member_id = validated_data.get('team_member_id')
        if not team_member_id:
            raise serializers.ValidationError({'team_member_id': 'required'})
        try:
            tm = TeamMember.objects.get(id=team_member_id, owner=request.user)
        except TeamMember.DoesNotExist:
            raise serializers.ValidationError({'team_member_id': 'not found'})
        cm, _ = ConversationMember.objects.get_or_create(
            conversation=conv,
            member_team=tm,
            defaults={'added_by': request.user}
        )
        return cm

class MessageSerializer(serializers.ModelSerializer):
    sender = PublicUserSerializer(read_only=True)
    senderType = serializers.SerializerMethodField()
    senderDisplay = serializers.SerializerMethodField()
    attachment_url = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()  # legacy string for FE compatibility
    delivery_status = serializers.IntegerField(read_only=True)
    delivered_at = serializers.DateTimeField(read_only=True)
    read_at = serializers.DateTimeField(read_only=True)

    class Meta:
        model = Message
        fields = [
            "id", "conversation", "sender", "senderType", "senderDisplay", "type", "body", "client_id", "created_at",
            "attachment_url", "attachment_name", "attachment_mime", "attachment_size",
            "status", "delivery_status", "delivered_at", "read_at"
        ]
        read_only_fields = ["id", "sender", "senderType", "senderDisplay", "type", "client_id", "created_at", "attachment_url", "delivery_status", "delivered_at", "read_at"]

    def get_attachment_url(self, obj):  # pragma: no cover - simple URL builder
        try:
            if obj.attachment:
                request = self.context.get('request') if hasattr(self, 'context') else None
                if request is not None:
                    return request.build_absolute_uri(obj.attachment.url)
                return obj.attachment.url
        except Exception:
            return None
        return None

    def get_senderType(self, obj):
        return 'team_member' if getattr(obj, 'sender_team_member_id', None) else 'user'

    def get_senderDisplay(self, obj):
        tm = getattr(obj, 'sender_team_member', None)
        if tm:
            return tm.display_name or tm.username
        u = getattr(obj, 'sender', None)
        if u:
            return getattr(u, 'display_name', '') or getattr(u, 'username', '')
        return ''

    def get_status(self, obj):
        try:
            ds = getattr(obj, 'delivery_status', 0) or 0
            if ds >= 2:
                return 'read'
            if ds >= 1:
                return 'delivered'
            return 'sent'
        except Exception:
            return 'sent'

    def create(self, validated_data):
        request = self.context['request']
        validated_data['sender'] = request.user
        # Attach team member if token carries it
        acting_team_id = getattr(getattr(request, 'auth', None), 'payload', {}).get('team_member_id') if getattr(request, 'auth', None) else None
        if acting_team_id:
            try:
                tm = TeamMember.objects.get(id=acting_team_id, owner=request.user, is_active=True)
                validated_data['sender_team_member'] = tm
            except Exception:
                pass
        return super().create(validated_data)

    def to_representation(self, instance):
        """Guarantee monotonic delivery numeric status derived from timestamps.

        Even if the stored delivery_status were stale (e.g. read_at set but delivery_status accidentally 1),
        we upgrade it in the API response so the frontend never regresses blue ticks after refresh.
        """
        data = super().to_representation(instance)
        try:
            read_at = data.get('read_at')
            delivered_at = data.get('delivered_at')
            # Force numeric delivery_status based on timestamps (monotonic mapping)
            if read_at:
                data['delivery_status'] = 2
                data['status'] = 'read'
            elif delivered_at and (data.get('delivery_status') or 0) < 1:
                data['delivery_status'] = 1
                if data.get('status') == 'sent':
                    data['status'] = 'delivered'
            # Marker-based freeze: if this message was sent by current viewer AND
            # counterpart's last_read_message_id >= this id => force read (2)
            ctx = getattr(self, 'context', {}) or {}
            viewer_id = ctx.get('viewer_id')
            other_last_read_id = ctx.get('other_last_read_id') or 0
            if other_last_read_id and viewer_id and instance.sender_id == viewer_id and instance.id <= other_last_read_id:
                if data.get('delivery_status', 0) < 2:
                    data['delivery_status'] = 2
                    data['status'] = 'read'
        except Exception:
            pass
        try:
            if instance.type == 'transaction':
                tx_payload = None
                txn = getattr(instance, 'transaction_record', None)
                if txn is not None:
                    tx_payload = txn.build_message_meta()
                if not tx_payload:
                    tx_payload = _parse_transaction_body(instance.body)
                if tx_payload:
                    data['tx'] = tx_payload
        except Exception:
            pass
        return data

class TransactionSerializer(serializers.ModelSerializer):
    currency = CurrencySerializer(read_only=True)
    currency_id = serializers.PrimaryKeyRelatedField(queryset=Currency.objects.all(), source='currency', write_only=True)
    # Accept any decimal string input; model rounding will enforce 5 dp
    amount = serializers.CharField(write_only=True)
    amount_value = serializers.DecimalField(source='amount', max_digits=28, decimal_places=5, read_only=True)
    from_user_info = PublicUserSerializer(source='from_user', read_only=True)
    to_user_info = PublicUserSerializer(source='to_user', read_only=True)
    direction_label = serializers.CharField(source='get_direction_display', read_only=True)

    class Meta:
        model = Transaction
        fields = [
            "id", "conversation", "from_user", "to_user", "currency", "currency_id", "amount", "amount_value",
            "direction", "direction_label", "note", "balance_after_from", "balance_after_to", "created_at",
            "from_user_info", "to_user_info"
        ]
        read_only_fields = [
            "id", "from_user", "to_user", "balance_after_from", "balance_after_to", "created_at",
            "amount_value", "direction_label", "from_user_info", "to_user_info"
        ]

    def validate(self, attrs):
        request = self.context['request']
        conv = attrs['conversation']
        if request.user not in [conv.user_a, conv.user_b]:
            # allow if added as extra member (user or team-member)
            acting_team_id = getattr(getattr(request, 'auth', None), 'payload', {}).get('team_member_id') if getattr(request, 'auth', None) else None
            if acting_team_id:
                if not ConversationMember.objects.filter(conversation=conv, member_team_id=acting_team_id).exists():
                    raise serializers.ValidationError("Not allowed for this conversation")
            else:
                if not ConversationMember.objects.filter(conversation=conv, member_user=request.user).exists():
                    raise serializers.ValidationError("Not allowed for this conversation")
        # قيود الاشتراك: لا معاملات إذا لم يُسمح بالمراسلة (باستثناء admin)
        if _ensure_can_message_or_contact is not None and request.user in [conv.user_a, conv.user_b]:
            try:
                _ensure_can_message_or_contact(request.user, conversation=conv)
            except ValidationError as ve:
                detail = ve.message_dict.get('detail') if hasattr(ve, 'message_dict') else 'غير مسموح'
                raise serializers.ValidationError(detail)
        return attrs

    def create(self, validated_data):
        request = self.context['request']
        conv = validated_data['conversation']
        direction = validated_data['direction']
        amount = validated_data['amount']
        currency = validated_data['currency']
        note = validated_data.get('note', '')
        # If acting as team member, record message display under team member while wallet impact applies to owner
        acting_team_id = getattr(getattr(request, 'auth', None), 'payload', {}).get('team_member_id') if getattr(request, 'auth', None) else None
        tm = None
        if acting_team_id:
            try:
                tm = TeamMember.objects.get(id=acting_team_id, owner=request.user, is_active=True)
            except Exception:
                tm = None

        txn = Transaction.create_transaction(
            conversation=conv,
            actor=request.user,
            currency=currency,
            amount=amount,
            direction=direction,
            note=note,
            sender_team_member=tm
        )
        return txn

    def to_representation(self, instance):
        data = super().to_representation(instance)
        try:
            data['amount'] = str(instance.amount)
        except Exception:
            pass
        return data


class PushSubscriptionSerializer(serializers.ModelSerializer):
    keys = serializers.DictField(write_only=True)
    userAgent = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = PushSubscription
        fields = ["id", "endpoint", "keys", "userAgent", "created_at"]
        read_only_fields = ["id", "created_at"]

    def create(self, validated_data):
        keys = validated_data.pop('keys', {}) or {}
        user_agent = validated_data.pop('userAgent', '') or ''
        request = self.context['request']
        user = request.user
        sub, created = PushSubscription.objects.update_or_create(
            endpoint=validated_data['endpoint'],
            defaults={
                'user': user,
                'keys_p256dh': keys.get('p256dh', ''),
                'keys_auth': keys.get('auth', ''),
                'user_agent': user_agent,
            }
        )
        return sub
