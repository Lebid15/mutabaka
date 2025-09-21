from rest_framework.permissions import BasePermission
from .models import Conversation, ConversationMember, TeamMember

class IsParticipant(BasePermission):
    def has_object_permission(self, request, view, obj):
        # Determine acting principal: real user or team member via request.auth claims
        acting_user = getattr(request, 'user', None)
        acting_team_id = getattr(getattr(request, 'auth', None), 'payload', {}).get('team_member_id') if getattr(request, 'auth', None) else None
        acting_team = None
        if acting_team_id:
            try:
                acting_team = TeamMember.objects.get(id=acting_team_id, is_active=True)
            except Exception:
                acting_team = None
        if isinstance(obj, Conversation):
            # If acting as a team member, only allow when that team member is added
            if acting_team is not None:
                try:
                    return ConversationMember.objects.filter(conversation=obj, member_team=acting_team).exists()
                except Exception:
                    return False
            # else: regular user can access if participant or added as extra user
            if acting_user in [obj.user_a, obj.user_b]:
                return True
            try:
                return ConversationMember.objects.filter(conversation=obj, member_user=acting_user).exists()
            except Exception:
                return False
        # For related objects having conversation attribute
        conv = getattr(obj, 'conversation', None)
        if conv:
            if acting_team is not None:
                try:
                    return ConversationMember.objects.filter(conversation=conv, member_team=acting_team).exists()
                except Exception:
                    return False
            if acting_user in [conv.user_a, conv.user_b]:
                return True
            try:
                return ConversationMember.objects.filter(conversation=conv, member_user=acting_user).exists()
            except Exception:
                return False
        return False
