from rest_framework.permissions import BasePermission
from .models import Conversation

class IsParticipant(BasePermission):
    def has_object_permission(self, request, view, obj):
        if isinstance(obj, Conversation):
            return request.user in [obj.user_a, obj.user_b]
        # For related objects having conversation attribute
        conv = getattr(obj, 'conversation', None)
        if conv:
            return request.user in [conv.user_a, conv.user_b]
        return False
