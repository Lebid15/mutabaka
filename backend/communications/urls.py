from django.urls import path, include
from .pusher_views import MessageAPIView
from rest_framework.routers import DefaultRouter
from .views import (
    UserSearchViewSet, ContactRelationViewSet, ConversationViewSet,
    MessageViewSet, TransactionViewSet, PushSubscribeView, PushUnsubscribeView,
    NotificationSoundView, EnsureAdminConversationView, TeamMemberViewSet
)
from finance.views import WalletViewSet, CurrencyViewSet

router = DefaultRouter()
router.register(r'users', UserSearchViewSet, basename='user-search')
router.register(r'contacts', ContactRelationViewSet, basename='contacts')
router.register(r'conversations', ConversationViewSet, basename='conversations')
router.register(r'team', TeamMemberViewSet, basename='team')
router.register(r'messages', MessageViewSet, basename='messages')
router.register(r'transactions', TransactionViewSet, basename='transactions')
router.register(r'wallets', WalletViewSet, basename='wallets')
router.register(r'currencies', CurrencyViewSet, basename='currencies')

urlpatterns = [
    # Pusher demo endpoint (flat path /api/messages)
    path('messages', MessageAPIView.as_view(), name='pusher_message'),
    path('push/subscribe', PushSubscribeView.as_view(), name='push_subscribe'),
    path('push/unsubscribe', PushUnsubscribeView.as_view(), name='push_unsubscribe'),
    path('notification/sound', NotificationSoundView.as_view(), name='notification_sound'),
    path('ensure_admin_conversation', EnsureAdminConversationView.as_view(), name='ensure_admin_conversation'),
    path('', include(router.urls))
]
