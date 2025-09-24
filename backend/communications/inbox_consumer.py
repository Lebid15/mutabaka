import json
from channels.generic.websocket import AsyncWebsocketConsumer
from django.contrib.auth.models import AnonymousUser
from .group_registry import add_channel, remove_channel, get_count
from django.db import models


class InboxConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        user = self.scope.get('user')
        if not user or isinstance(user, AnonymousUser) or not user.is_authenticated:
            await self.close(code=4001)
            return
        self.user_id = user.id
        self.group_name = f"user_{self.user_id}"  # Ensure group name is set correctly
        try:
            print(f"[WS] inbox connect user={self.user_id} join group={self.group_name}")
        except Exception:
            pass
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        # optional: send hello
        try:
            await self.send(text_data=json.dumps({'type':'inbox.hello'}))
        except Exception:
            pass
        # Mark undelivered inbound messages as delivered now that user is online (outside conversation)
        try:
            from asgiref.sync import sync_to_async
            from django.utils import timezone
            from .models import Message, Conversation
            from django.db import models as dj_models
            async_get_convs = sync_to_async(list)
            convs = await async_get_convs(Conversation.objects.filter(models.Q(user_a_id=self.user_id) | models.Q(user_b_id=self.user_id)).only('id'))
            now = timezone.now()
            for c in convs:
                # Fetch up to last 100 inbound messages that are not yet delivered
                async_get_ids = sync_to_async(list)
                ids = await async_get_ids(
                    Message.objects
                        .filter(conversation_id=c.id, delivery_status__lt=1)
                        .exclude(sender_id=self.user_id)
                        .order_by('-id')
                        .values_list('id', flat=True)[:100]
                )
                if not ids:
                    continue
                async_update = sync_to_async(Message.objects.filter(id__in=ids).update)
                await async_update(
                    delivered_at=now,
                    delivery_status=dj_models.Case(
                        dj_models.When(delivery_status__lt=1, then=dj_models.Value(1)),
                        default=dj_models.F('delivery_status')
                    )
                )
                # Broadcast per-message status so senders update ticks to double gray
                for mid in ids:
                    try:
                        await self.channel_layer.group_send(f"conv_{c.id}", {
                            'type': 'broadcast.message',
                            'data': { 'type': 'message.status', 'id': int(mid), 'delivery_status': 1, 'status': 'delivered' }
                        })
                    except Exception:
                        pass
        except Exception:
            pass
        try:
            cnt = add_channel(self.group_name, self.channel_name)
            print(f"[WS] inbox connected user={self.user_id} join group={self.group_name} subscribers={cnt}")
        except Exception:
            pass

    async def disconnect(self, code):
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
        try:
            cnt = remove_channel(self.group_name, self.channel_name)
            print(f"[WS] inbox disconnect user={getattr(self, 'user_id', None)} code={code} subscribers={cnt}")
        except Exception:
            pass

    async def receive(self, text_data=None, bytes_data=None):
        # Support simple heartbeat from client
        if not text_data:
            return
        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            data = {'type': 'text', 'body': text_data}
        t = (data or {}).get('type')
        if t == 'ping':
            try:
                print(f"[WS] inbox ping from user={self.user_id}")
            except Exception:
                pass
            await self.send(text_data=json.dumps({'type': 'pong'}))

    async def broadcast_message(self, event):
        await self.send(text_data=json.dumps(event['data']))
