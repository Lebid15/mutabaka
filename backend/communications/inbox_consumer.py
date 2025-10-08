import json
from pathlib import Path
from channels.generic.websocket import AsyncWebsocketConsumer
from django.contrib.auth.models import AnonymousUser
from django.conf import settings
from .group_registry import add_channel, remove_channel, get_count
from django.db import models


def _debug_log(message: str) -> None:
    if not getattr(settings, 'DEBUG', False):
        return
    try:
        log_path = Path(settings.BASE_DIR) / 'ws_debug.log'
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open('a', encoding='utf-8') as handle:
            handle.write(message + "\n")
    except Exception:
        pass


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
            _debug_log(f"connect user={self.user_id} group={self.group_name}")
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
            import logging
            logger = logging.getLogger(__name__)
            
            async_get_convs = sync_to_async(list)
            convs = await async_get_convs(Conversation.objects.filter(models.Q(user_a_id=self.user_id) | models.Q(user_b_id=self.user_id)).only('id'))
            now = timezone.now()
            conversations_to_update = []
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
                conversations_to_update.append(c.id)
                async_update = sync_to_async(Message.objects.filter(id__in=ids).update)
                await async_update(
                    delivered_at=now,
                    delivery_status=dj_models.Case(
                        dj_models.When(delivery_status__lt=1, then=dj_models.Value(1)),
                        default=dj_models.F('delivery_status')
                    )
                )
                # Broadcast per-message status ONLY if not already READ (monotonic: never downgrade)
                async_get_messages = sync_to_async(list)
                updated_messages = await async_get_messages(
                    Message.objects.filter(id__in=ids).values('id', 'delivery_status')
                )
                for msg_data in updated_messages:
                    mid = msg_data['id']
                    final_status = msg_data['delivery_status']
                    # Only broadcast if status is DELIVERED (1), never if READ (2) to prevent downgrade
                    if final_status == 1:
                        try:
                            await self.channel_layer.group_send(f"conv_{c.id}", {
                                'type': 'broadcast.message',
                                'data': { 'type': 'message.status', 'id': int(mid), 'delivery_status': 1, 'status': 'delivered' }
                            })
                        except Exception:
                            pass
                    elif final_status >= 2:
                        # Message is already READ, don't broadcast anything to avoid downgrade
                        logger.info(f"📬 [INBOX] Skip broadcast for message {mid} in conv {c.id} - already READ (status={final_status})")
            
            if conversations_to_update:
                logger.info(f"📬 [INBOX] User {self.user_id} reconnected - sending catchup for {len(conversations_to_update)} conversations")
                from .push import _total_unread_for_user
                async_total_unread = sync_to_async(_total_unread_for_user)
                user_unread = await async_total_unread(self.user_id)
                
                for conv_id in conversations_to_update:
                    try:
                        async_get_last_msg = sync_to_async(lambda cid: Message.objects.filter(conversation_id=cid).order_by('-id').first())
                        last_msg = await async_get_last_msg(conv_id)
                        if last_msg:
                            preview = last_msg.body[:80] if last_msg.body else ''
                            logger.info(f"📬 [INBOX] Sending catchup inbox.update for conv {conv_id} to user {self.user_id}: preview='{preview[:30]}...', unread={user_unread}")
                            await self.send(text_data=json.dumps({
                                'type': 'inbox.update',
                                'conversation_id': conv_id,
                                'last_message_preview': preview,
                                'last_message_at': last_msg.created_at.isoformat(),
                                'unread_count': user_unread,
                            }))
                    except Exception as e:
                        logger.exception(f"❌ [INBOX] Failed to send catchup for conv {conv_id}: {e}")
            else:
                logger.info(f"📬 [INBOX] User {self.user_id} reconnected - no catchup needed (no undelivered messages)")
        except Exception as e:
            logger.exception(f"❌ [INBOX] Catchup logic failed for user {self.user_id}: {e}")
        try:
            cnt = add_channel(self.group_name, self.channel_name)
            print(f"[WS] inbox connected user={self.user_id} join group={self.group_name} subscribers={cnt}")
            _debug_log(f"connected user={self.user_id} group={self.group_name} subscribers={cnt}")
        except Exception:
            pass

    async def disconnect(self, code):
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
        try:
            cnt = remove_channel(self.group_name, self.channel_name)
            print(f"[WS] inbox disconnect user={getattr(self, 'user_id', None)} code={code} subscribers={cnt}")
            _debug_log(f"disconnect user={getattr(self, 'user_id', None)} code={code} subscribers={cnt}")
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
                _debug_log(f"ping user={self.user_id}")
            except Exception:
                pass
            await self.send(text_data=json.dumps({'type': 'pong'}))

    async def broadcast_message(self, event):
        await self.send(text_data=json.dumps(event['data']))
