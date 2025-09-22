from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status

from django.utils import timezone

from .models import SubscriptionPlan, UserSubscription, RenewalRequest
from .serializers import (
    SubscriptionPlanSerializer,
    UserSubscriptionSerializer,
    RenewalRequestSerializer,
    CreateRenewalRequestSerializer,
)


class MySubscriptionView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        sub = getattr(user, "subscription", None)
        data = {
            "subscription": UserSubscriptionSerializer(sub).data if sub else None,
            "pending_request": None,
        }
        pending = RenewalRequest.objects.filter(user=user, status=RenewalRequest.STATUS_PENDING).first()
        if pending:
            data["pending_request"] = RenewalRequestSerializer(pending).data
        return Response(data)


class PlansListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        plans = SubscriptionPlan.objects.exclude(code="trial").order_by("code")
        return Response(SubscriptionPlanSerializer(plans, many=True).data)


class CreateRenewalView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = CreateRenewalRequestSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        req = serializer.save()
        return Response(RenewalRequestSerializer(req).data, status=status.HTTP_201_CREATED)
