from rest_framework import serializers

from .models import SubscriptionPlan, UserSubscription, RenewalRequest


class SubscriptionPlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = SubscriptionPlan
        fields = ["code", "name", "monthly_price", "yearly_price", "yearly_discount_percent"]


class UserSubscriptionSerializer(serializers.ModelSerializer):
    plan = SubscriptionPlanSerializer()
    is_trial = serializers.SerializerMethodField()
    remaining_days = serializers.SerializerMethodField()

    class Meta:
        model = UserSubscription
        fields = [
            "plan",
            "start_at",
            "end_at",
            "last_renewed_at",
            "status",
            "auto_renew",
            "remaining_days",
            "is_trial",
        ]

    def get_remaining_days(self, obj):
        from django.utils import timezone
        now = timezone.now()
        if obj.end_at and obj.end_at > now:
            delta = obj.end_at - now
            return max(0, delta.days)
        return 0

    def get_is_trial(self, obj):
        try:
            return (obj.plan and obj.plan.code == "trial")
        except Exception:
            return False


class RenewalRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = RenewalRequest
        fields = [
            "id",
            "plan",
            "period",
            "status",
            "created_at",
            "amount",
            "payment_method",
        ]
        read_only_fields = ["status", "created_at", "amount", "payment_method"]


class CreateRenewalRequestSerializer(serializers.Serializer):
    plan_code = serializers.ChoiceField(choices=[(c, c) for c, _ in SubscriptionPlan.CODE_CHOICES if c != 'trial'])
    period = serializers.ChoiceField(choices=[(RenewalRequest.PERIOD_MONTHLY, "monthly"), (RenewalRequest.PERIOD_YEARLY, "yearly")])

    def validate(self, attrs):
        user = self.context["request"].user
        if RenewalRequest.has_open_pending(user):
            raise serializers.ValidationError("لديك طلب تجديد قيد المراجعة")
        return attrs

    def create(self, validated_data):
        plan = SubscriptionPlan.objects.get(code=validated_data["plan_code"])
        req = RenewalRequest.objects.create(
            user=self.context["request"].user,
            plan=plan,
            period=validated_data["period"],
            status=RenewalRequest.STATUS_PENDING,
            payment_method="cash",
        )
        return req
