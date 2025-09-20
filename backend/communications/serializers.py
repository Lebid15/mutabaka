from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import ContactRelation, Conversation, Message, Transaction, PushSubscription, ConversationMute, TeamMember, ConversationMember
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
    member = PublicUserSerializer(read_only=True)
    username = serializers.CharField(write_only=True)

    class Meta:
        model = TeamMember
        fields = ["id", "owner", "member", "username", "display_name", "phone", "created_at", "updated_at"]
        read_only_fields = ["id", "owner", "member", "created_at", "updated_at"]

    def create(self, validated_data):
        request = self.context['request']
        username = (validated_data.pop('username', '') or '').strip()
        if not username:
            raise serializers.ValidationError({'username': 'required'})
        try:
            target = User.objects.get(username__iexact=username)
        except User.DoesNotExist:
            raise serializers.ValidationError({'username': 'user not found'})
        tm, _ = TeamMember.objects.update_or_create(
            owner=request.user, member=target,
            defaults={
                'display_name': validated_data.get('display_name', '') or getattr(target, 'display_name', '') or target.username,
                'phone': validated_data.get('phone', '') or getattr(target, 'phone', ''),
            }
        )
        return tm

    def update(self, instance, validated_data):
        instance.display_name = validated_data.get('display_name', instance.display_name)
        instance.phone = validated_data.get('phone', instance.phone)
        instance.save(update_fields=["display_name", "phone", "updated_at"])
        return instance


class ConversationMemberSerializer(serializers.ModelSerializer):
    member = PublicUserSerializer(read_only=True)
    team_member_id = serializers.IntegerField(write_only=True, required=True)

    class Meta:
        model = ConversationMember
        fields = ["id", "conversation", "member", "team_member_id", "added_by", "created_at"]
        read_only_fields = ["id", "member", "added_by", "created_at", "conversation"]

    def create(self, validated_data):
        request = self.context['request']
        conv = self.context.get('conversation')
        if not conv:
            raise serializers.ValidationError({'detail': 'conversation required'})
        team_member_id = validated_data.get('team_member_id')
        try:
            tm = TeamMember.objects.get(id=team_member_id, owner=request.user)
        except TeamMember.DoesNotExist:
            raise serializers.ValidationError({'team_member_id': 'not found'})
        cm, _ = ConversationMember.objects.get_or_create(
            conversation=conv,
            member=tm.member,
            defaults={'added_by': request.user}
        )
        return cm

class MessageSerializer(serializers.ModelSerializer):
    sender = PublicUserSerializer(read_only=True)
    attachment_url = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = [
            "id", "conversation", "sender", "type", "body", "created_at",
            "attachment_url", "attachment_name", "attachment_mime", "attachment_size"
        ]
        read_only_fields = ["id", "sender", "type", "created_at", "attachment_url"]

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

    def create(self, validated_data):
        validated_data['sender'] = self.context['request'].user
        return super().create(validated_data)

class TransactionSerializer(serializers.ModelSerializer):
    currency = CurrencySerializer(read_only=True)
    currency_id = serializers.PrimaryKeyRelatedField(queryset=Currency.objects.all(), source='currency', write_only=True)

    class Meta:
        model = Transaction
        fields = [
            "id", "conversation", "from_user", "to_user", "currency", "currency_id", "amount", "direction", "note",
            "balance_after_from", "balance_after_to", "created_at"
        ]
        read_only_fields = ["id", "from_user", "to_user", "balance_after_from", "balance_after_to", "created_at"]

    def validate(self, attrs):
        request = self.context['request']
        conv = attrs['conversation']
        if request.user not in [conv.user_a, conv.user_b]:
            # allow if added as extra member
            if not ConversationMember.objects.filter(conversation=conv, member=request.user).exists():
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
        txn = Transaction.create_transaction(
            conversation=conv,
            actor=request.user,
            currency=currency,
            amount=amount,
            direction=direction,
            note=note
        )
        return txn


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
