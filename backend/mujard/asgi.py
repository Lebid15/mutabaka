"""
ASGI config for mujard project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/5.2/howto/deployment/asgi/
"""

import os

# Ensure settings are configured BEFORE importing anything that touches Django settings
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'mujard.settings')

from django.core.asgi import get_asgi_application  # noqa: E402
from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from channels.auth import AuthMiddlewareStack  # noqa: E402
from django.urls import path  # noqa: E402

# Initialize Django first so app registry is ready before importing middleware/consumers
django_app = get_asgi_application()

from communications.ws_auth import JWTAuthMiddlewareStack  # noqa: E402
from communications.consumers import ConversationConsumer  # noqa: E402
from communications.inbox_consumer import InboxConsumer  # noqa: E402

application = ProtocolTypeRouter({
    'http': django_app,
    'websocket': JWTAuthMiddlewareStack(
        URLRouter([
            path('ws/conversations/<int:conversation_id>/', ConversationConsumer.as_asgi()),
            path('ws/inbox/', InboxConsumer.as_asgi()),
        ])
    )
})
