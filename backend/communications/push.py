from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any, Dict, Iterable, List

from django.db.models import F, OuterRef, Q, Subquery
from django.utils import timezone

from accounts.push import PushMessage, get_active_device_tokens, send_push_messages
from .models import (
    Conversation,
    ConversationMember,
    ConversationMute,
    ConversationReadMarker,
    Message,
    get_conversation_viewer_ids,
)

logger = logging.getLogger(__name__)


def _normalize_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {str(k): _normalize_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_normalize_value(v) for v in value]
    return value


def _conversation_ids_for_user(user_id: int) -> List[int]:
    base_ids = Conversation.objects.filter(Q(user_a_id=user_id) | Q(user_b_id=user_id)).values_list("id", flat=True)
    member_ids = ConversationMember.objects.filter(member_user_id=user_id).values_list("conversation_id", flat=True)
    ordered: List[int] = []
    seen: set[int] = set()
    for conv_id in list(base_ids) + list(member_ids):
        if conv_id and conv_id not in seen:
            seen.add(conv_id)
            ordered.append(conv_id)
    return ordered


def _total_unread_for_user(user_id: int) -> int:
    conversation_ids = _conversation_ids_for_user(user_id)
    if not conversation_ids:
        return 0
    marker_subquery = ConversationReadMarker.objects.filter(
        conversation_id=OuterRef("conversation_id"),
        user_id=user_id,
    ).values("last_read_message_id")[:1]
    unread_qs = (
        Message.objects.filter(conversation_id__in=conversation_ids)
        .exclude(sender_id=user_id)
        .annotate(last_read_id=Subquery(marker_subquery))
        .filter(Q(last_read_id__isnull=True) | Q(id__gt=F("last_read_id")))
    )
    return unread_qs.count()


def _muted_user_ids(conversation_id: int, user_ids: Iterable[int]) -> set[int]:
    audience = [uid for uid in user_ids if uid]
    if not audience:
        return set()
    muted_qs = ConversationMute.objects.filter(conversation_id=conversation_id, user_id__in=audience)
    now = timezone.now()
    muted: set[int] = set()
    for mute in muted_qs:
        if mute.muted_until is None or mute.muted_until > now:
            muted.add(mute.user_id)
    return muted


def send_message_push(
    conversation: Conversation,
    message: Message,
    *,
    title: str,
    body: str,
    data: Dict[str, Any] | None = None,
) -> None:
    if not conversation or not message:
        return
    try:
        target_user_ids = [uid for uid in get_conversation_viewer_ids(conversation) if uid and uid != message.sender_id]
        if not target_user_ids:
            return
        tokens_by_user = get_active_device_tokens(target_user_ids)
        if not tokens_by_user:
            return
        muted_ids = _muted_user_ids(conversation.id, tokens_by_user.keys())
        unread_cache: Dict[int, int] = {}
        push_batch: List[PushMessage] = []
        for user_id, tokens in tokens_by_user.items():
            if user_id in muted_ids or not tokens:
                continue
            unread = unread_cache.get(user_id)
            if unread is None:
                unread = _total_unread_for_user(user_id)
                unread_cache[user_id] = unread
            payload: Dict[str, Any] = {
                "type": "message",
                "conversation_id": conversation.id,
                "message_id": message.id,
                "sender_id": message.sender_id,
                "unread_count": unread,
            }
            if data:
                payload.update(data)
            normalized = _normalize_value(payload)
            badge_value = int(unread) if unread and unread > 0 else 0
            for token in tokens:
                push_batch.append(
                    PushMessage(
                        to=token,
                        title=title,
                        body=body,
                        data=normalized,
                        badge=badge_value,
                    )
                )
        if push_batch:
            send_push_messages(push_batch)
    except Exception:
        logger.exception(
            "send_message_push_failed",
            extra={
                "conversation_id": getattr(conversation, "id", None),
                "message_id": getattr(message, "id", None),
            },
        )
