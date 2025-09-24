import json
from channels.generic.websocket import AsyncWebsocketConsumer
from django.contrib.auth.models import AnonymousUser
from .models import Conversation, Message, ConversationMember, TeamMember, get_conversation_viewer_ids
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
        # Upon entering the conversation, mark all inbound messages as read (and delivered)
        try:
            from asgiref.sync import sync_to_async
            from django.utils import timezone
            from django.db import models as dj_models
            from django.db.models import Q, Max
            last_read_id = None
            async_filter = sync_to_async(list)
            # Get ids of messages from others which are not read yet
            from .models import Message
            ids = await sync_to_async(list)(
                Message.objects
                    .filter(conversation_id=self.conversation_id, delivery_status__lt=2)
                    .exclude(sender_id=user.id)
                    .order_by('id')
                    .values_list('id', flat=True)
            )
            if ids:
                now = timezone.now()
                await sync_to_async(Message.objects.filter(id__in=ids).update)(
                    read_at=now, delivered_at=now,
                    delivery_status=dj_models.Case(
                        dj_models.When(delivery_status__lt=2, then=dj_models.Value(2)),
                        default=dj_models.F('delivery_status')
                    )
                )
                last_read_id = max(ids)
                # Broadcast chat.read once with last_read_id
                payload = { 'type': 'chat.read', 'reader': getattr(user, 'username', None), 'last_read_id': int(last_read_id) }
                await self.channel_layer.group_send(self.group_name, {'type': 'broadcast.message', 'data': payload})
                # Also broadcast per-message status for sender ticks (limit to first 300 to avoid flood)
                for mid in ids[:300]:
                    try:
                        await self.channel_layer.group_send(self.group_name, {
                            'type': 'broadcast.message',
                            'data': { 'type': 'message.status', 'id': int(mid), 'delivery_status': 2, 'status': 'read' }
                        })
                    except Exception:
                        pass
        except Exception:
            pass

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
                    # Persist read_at for messages sent by the other participant (reader consumed them)
                    try:
                        if last_read_id:
                            from asgiref.sync import sync_to_async
                            from django.utils import timezone
                            from django.db import models as dj_models
                            qs = Message.objects.filter(conversation_id=self.conversation_id, id__lte=last_read_id, delivery_status__lt=2).exclude(sender_id=user.id)
                            async_update = sync_to_async(qs.update)
                            now = timezone.now()
                            await async_update(
                                read_at=now, delivered_at=now,
                                delivery_status=dj_models.Case(
                                    dj_models.When(delivery_status__lt=2, then=dj_models.Value(2)),
                                    default=dj_models.F('delivery_status')
                                )
                            )
                            # Broadcast per-message read status (cap at 300)
                            ids = await sync_to_async(list)(qs.values_list('id', flat=True)[:300])
                            for mid in ids:
                                try:
                                    await self.channel_layer.group_send(self.group_name, {
                                        'type': 'broadcast.message',
                                        'data': { 'type': 'message.status', 'id': int(mid), 'delivery_status': 2, 'status': 'read' }
                                    })
                                except Exception:
                                    pass
                    except Exception:
                        pass
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
        # Try to attach team member from token in query (if present in scope['token_payload'])
        kwargs = { 'conversation_id': self.conversation_id, 'sender_id': user.id, 'body': body, 'type': msg_type }
        try:
            token_payload = self.scope.get('token_payload') if hasattr(self.scope, 'get') else None
            acting_team_id = (token_payload or {}).get('team_member_id') if isinstance(token_payload, dict) else None
            if acting_team_id:
                tm = await sync_to_async(TeamMember.objects.filter(id=acting_team_id, owner_id=user.id, is_active=True).first)()
                if tm:
                    kwargs['sender_team_member_id'] = tm.id
        except Exception:
            pass
        msg = await async_create(**kwargs)
        payload = {
            'type': 'chat.message',
            'id': msg.id,
            'conversation_id': int(self.conversation_id),
            'sender': user.username,
            'senderDisplay': getattr(user, 'display_name', '') or getattr(user, 'username', ''),
            'body': msg.body,
            'created_at': msg.created_at.isoformat(),
            'kind': msg_type,
            'client_id': client_id,
            'seq': msg.id,
            'status': 'sent',
        }
        try:
            recipients = get_count(self.group_name)
            print(f"[WS] broadcast chat.message conv={self.group_name} id={msg.id} from={user.username} recipients={recipients} client_id={client_id}")
        except Exception:
            pass
        await self.channel_layer.group_send(self.group_name, {'type': 'broadcast.message', 'data': payload})

        # Determine delivery/read based on recipient connectivity
        try:
            from asgiref.sync import sync_to_async
            from django.utils import timezone
            conv = await self.get_conversation()
            recipient_id = conv.user_b_id if user.id == conv.user_a_id else conv.user_a_id
            inbox_group = f"user_{recipient_id}"
            conv_group = self.group_name
            recipient_online = get_count(inbox_group) > 0
            recipient_in_conv = get_count(conv_group) > 1  # sender + recipient present
            # If recipient is in the same conversation: mark read immediately
            if recipient_in_conv:
                from django.db import models as dj_models
                await sync_to_async(Message.objects.filter(id=msg.id).update)(
                    read_at=timezone.now(), delivered_at=timezone.now(),
                    delivery_status=dj_models.Case(
                        dj_models.When(delivery_status__lt=2, then=dj_models.Value(2)),
                        default=dj_models.F('delivery_status')
                    )
                )
                status_evt = {
                    'type': 'message.status',
                    'id': msg.id,
                    'delivery_status': 2, 'status': 'read',
                }
                await self.channel_layer.group_send(conv_group, {'type': 'broadcast.message', 'data': status_evt})
            elif recipient_online:
                from django.db import models as dj_models
                await sync_to_async(Message.objects.filter(id=msg.id).update)(
                    delivered_at=timezone.now(),
                    delivery_status=dj_models.Case(
                        dj_models.When(delivery_status__lt=1, then=dj_models.Value(1)),
                        default=dj_models.F('delivery_status')
                    )
                )
                status_evt = {
                    'type': 'message.status',
                    'id': msg.id,
                    'delivery_status': 1, 'status': 'delivered',
                }
                # Send status back to conversation group so sender updates ticks
                await self.channel_layer.group_send(conv_group, {'type': 'broadcast.message', 'data': status_evt})
        except Exception:
            pass
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
        # Allow if added by user_id or acting team member
        exists_user = await sync_to_async(ConversationMember.objects.filter(conversation_id=conversation_id, member_user_id=user_id).exists)()
        if exists_user:
            return True
        try:
            token_payload = self.scope.get('token_payload') if hasattr(self.scope, 'get') else None
            acting_team_id = (token_payload or {}).get('team_member_id') if isinstance(token_payload, dict) else None
            if acting_team_id:
                exists_team = await sync_to_async(ConversationMember.objects.filter(conversation_id=conversation_id, member_team_id=acting_team_id).exists)()
                return bool(exists_team)
        except Exception:
            pass
        return False
