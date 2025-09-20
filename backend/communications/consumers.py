import json
from channels.generic.websocket import AsyncWebsocketConsumer
from django.contrib.auth.models import AnonymousUser
from .models import Conversation, Message, ConversationMember, get_conversation_viewer_ids
from decimal import Decimal
from .group_registry import add_channel, remove_channel, get_count

class ConversationConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.conversation_id = self.scope['url_route']['kwargs']['conversation_id']
        user = self.scope.get('user')
        reason = None
        if not user or isinstance(user, AnonymousUser) or not user.is_authenticated:
            reason = 'unauthorized'
        else:
            try:
                conv = await self.get_conversation()
            except Conversation.DoesNotExist:
                reason = 'not_found'
            else:
                if user.id not in [conv.user_a_id, conv.user_b_id]:
                    try:
                        allowed = await self._is_extra_member(user.id, conv.id)
                    except Exception:
                        allowed = False
                    if not allowed:
                        reason = 'forbidden'
        if reason:
            # RFC: subprotocol close codes are limited; use policy violation 1008
            await self.close(code=4001)
            return
        self.group_name = f"conv_{self.conversation_id}"
        try:
            uid = getattr(user, 'id', None)
            print(f"[WS] connect user={uid} join group={self.group_name}")
        except Exception:
            pass
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        # Track membership (dev only)
        try:
            cnt = add_channel(self.group_name, self.channel_name)
            uid = getattr(user, 'id', None)
            print(f"[WS] chat connected user={uid} join group={self.group_name} subscribers={cnt}")
        except Exception:
            pass
        await self.accept()

    async def disconnect(self, code):
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
            try:
                cnt = remove_channel(self.group_name, self.channel_name)
                print(f"[WS] chat disconnect conv={getattr(self, 'group_name', None)} code={code} subscribers={cnt}")
            except Exception:
                pass

    async def receive(self, text_data=None, bytes_data=None):
        # Expect either raw text OR JSON {"type":"text","body":"..."}
        user = self.scope['user']
        if not user.is_authenticated:
            return
        if not text_data:
            return
        original = text_data
        msg_type = 'text'
        body = original
        client_id = None
        try:
            data = json.loads(original)
            if isinstance(data, dict):
                body = data.get('body', '')
                # typing indicator event
                if data.get('type') == 'typing':
                    state = data.get('state') or 'start'
                    payload = {
                        'type': 'chat.typing',
                        'user': user.username,
                        'state': 'start' if state not in ['stop', 'end'] else 'stop',
                    }
                    await self.channel_layer.group_send(self.group_name, {'type': 'broadcast.message', 'data': payload})
                    return
                # read receipts event (ephemeral)
                if data.get('type') == 'read':
                    last_read_id = data.get('last_read_id')
                    try:
                        last_read_id = int(last_read_id) if last_read_id is not None else None
                    except (TypeError, ValueError):
                        last_read_id = None
                    payload = {
                        'type': 'chat.read',
                        'reader': user.username,
                        'last_read_id': last_read_id,
                    }
                    await self.channel_layer.group_send(self.group_name, {'type': 'broadcast.message', 'data': payload})
                    return
                if data.get('type') in ['text']:
                    msg_type = data.get('type')
                client_id = data.get('client_id')
        except json.JSONDecodeError:
            pass
        body = (body or '').strip()
        if not body:
            return
        # Hard limit length to prevent abuse
        MAX_LEN = 1000
        if len(body) > MAX_LEN:
            body = body[:MAX_LEN]
        from asgiref.sync import sync_to_async
        async_create = sync_to_async(Message.objects.create)
        msg = await async_create(conversation_id=self.conversation_id, sender_id=user.id, body=body, type=msg_type)
        payload = {
            'type': 'chat.message',
            'id': msg.id,
            'conversation_id': int(self.conversation_id),
            'sender': user.username,
            'body': msg.body,
            'created_at': msg.created_at.isoformat(),
            'kind': msg_type,
            'client_id': client_id,
            'seq': msg.id,
        }
        try:
            recipients = get_count(self.group_name)
            print(f"[WS] broadcast chat.message conv={self.group_name} id={msg.id} from={user.username} recipients={recipients} client_id={client_id}")
        except Exception:
            pass
        await self.channel_layer.group_send(self.group_name, {'type': 'broadcast.message', 'data': payload})
        # Also notify recipient's inbox channel so their conversation list updates instantly
        try:
            from asgiref.sync import sync_to_async
            conv = await self.get_conversation()
            for uid in get_conversation_viewer_ids(conv):
                if uid == user.id:
                    continue
                inbox_group = f"user_{uid}"
                await self.channel_layer.group_send(inbox_group, {
                    'type': 'broadcast.message',
                    'data': {
                        'type': 'inbox.update',
                        'conversation_id': int(self.conversation_id),
                        'last_message_preview': msg.body[:80],
                        'last_message_at': msg.created_at.isoformat(),
                        'unread_count': 1,
                    }
                })
        except Exception:
            pass

    async def broadcast_message(self, event):
        await self.send(text_data=json.dumps(event['data']))

    async def get_conversation(self):
        from asgiref.sync import sync_to_async
        return await sync_to_async(Conversation.objects.get)(pk=self.conversation_id)

    async def _is_extra_member(self, user_id: int, conversation_id: int) -> bool:
        from asgiref.sync import sync_to_async
        exists = await sync_to_async(ConversationMember.objects.filter(conversation_id=conversation_id, member_id=user_id).exists)()
        return bool(exists)
