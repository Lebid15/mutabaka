from rest_framework.permissions import BasePermission
from .models import Conversation, ConversationMember

class IsParticipant(BasePermission):
    def has_object_permission(self, request, view, obj):
        if isinstance(obj, Conversation):
            if request.user in [obj.user_a, obj.user_b]:
                return True
            # allow extra members
            try:
                return ConversationMember.objects.filter(conversation=obj, member=request.user).exists()
            except Exception:
                return False
        # For related objects having conversation attribute
        conv = getattr(obj, 'conversation', None)
        if conv:
            if request.user in [conv.user_a, conv.user_b]:
                return True
            try:
                return ConversationMember.objects.filter(conversation=conv, member=request.user).exists()
            except Exception:
                return False
        return False
