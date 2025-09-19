import json
from channels.generic.websocket import AsyncWebsocketConsumer
from django.contrib.auth.models import AnonymousUser
from .group_registry import add_channel, remove_channel, get_count


class InboxConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        user = self.scope.get('user')
        if not user or isinstance(user, AnonymousUser) or not user.is_authenticated:
            await self.close(code=4001)
            return
        self.user_id = user.id
        self.group_name = f"user_{self.user_id}"
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
