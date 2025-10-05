from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Sequence

import requests
from django.conf import settings
from django.db import transaction

from .models import UserDevice

# Try to import Firebase Admin SDK (optional, falls back to Expo API)
try:
    from .fcm_push import send_fcm_multicast
    FCM_AVAILABLE = True
except ImportError:
    FCM_AVAILABLE = False
    send_fcm_multicast = None

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = getattr(settings, "EXPO_PUSH_URL", "https://exp.host/--/api/v2/push/send")
INVALID_EXPO_ERRORS = {
    "DeviceNotRegistered",
    "InvalidCredentials",
    "MismatchSenderId",
    "MessageTooBig",
    "MissingCredentials",
}
ACTIVE_STATUSES = {UserDevice.Status.PRIMARY, UserDevice.Status.ACTIVE}


@dataclass(frozen=True)
class PushMessage:
    to: str
    title: str
    body: str
    data: Dict[str, Any] | None = None
    badge: int | None = None
    sound: str | None = "default"

    def to_payload(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "to": self.to,
            "title": self.title,
            "body": self.body,
            "priority": "high",
        }
        if self.data is not None:
            payload["data"] = self.data
        if self.badge is not None:
            payload["badge"] = int(self.badge)
        if self.sound:
            payload["sound"] = self.sound
        return payload


def get_active_device_tokens(user_ids: Iterable[int]) -> Dict[int, List[str]]:
    ids = list({uid for uid in user_ids if uid})
    if not ids:
        return {}
    qs = (
        UserDevice.objects.filter(user_id__in=ids, status__in=ACTIVE_STATUSES)
        .exclude(push_token__exact="")
        .values_list("user_id", "push_token")
    )
    tokens: Dict[int, List[str]] = {}
    seen: set[str] = set()
    for user_id, token in qs:
        if not token or token in seen:
            continue
        seen.add(token)
        tokens.setdefault(user_id, []).append(token)
    return tokens


def _handle_expo_response(batch: Sequence[PushMessage], response_json: Dict[str, Any]) -> None:
    results = response_json.get("data") if isinstance(response_json, dict) else None
    if not isinstance(results, list):
        return
    invalid_tokens: list[str] = []
    for index, result in enumerate(results):
        if not isinstance(result, dict):
            continue
        status = result.get("status")
        if status == "ok":
            continue
        details = result.get("details") or {}
        if not isinstance(details, dict):
            details = {}
        error_code = details.get("error") or result.get("error")
        token = batch[index].to if index < len(batch) else None
        if error_code in INVALID_EXPO_ERRORS and token:
            invalid_tokens.append(token)
        logger.warning(
            "expo_push_error",
            extra={
                "status": status,
                "error": error_code,
                "error_message": result.get("message"),
                "token": token,
            },
        )
    if invalid_tokens:
        unique_tokens = list({token for token in invalid_tokens})
        with transaction.atomic():
            UserDevice.objects.filter(push_token__in=unique_tokens).update(push_token="")


def send_push_messages(messages: Sequence[PushMessage]) -> None:
    batch = [msg for msg in messages if msg.to]
    if not batch:
        return
    
    # Try Firebase Admin SDK first (recommended for FCM)
    if FCM_AVAILABLE:
        try:
            # Send individual FCM notifications (each with different badge/data)
            logger.info(f"🔥 Sending {len(batch)} notifications via Firebase Admin SDK")
            
            all_success = 0
            all_failure = 0
            all_invalid_tokens = []
            
            for msg in batch:
                result = send_fcm_multicast(
                    tokens=[msg.to],
                    title=msg.title,
                    body=msg.body,
                    data=msg.data,
                    badge=msg.badge
                )
                all_success += result['success']
                all_failure += result['failure']
                if result.get('invalid_tokens'):
                    all_invalid_tokens.extend(result['invalid_tokens'])
            
            logger.info(f"✅ FCM results: {all_success} sent, {all_failure} failed")
            
            # Remove invalid tokens
            if all_invalid_tokens:
                with transaction.atomic():
                    UserDevice.objects.filter(
                        push_token__in=all_invalid_tokens
                    ).update(push_token="")
                logger.info(f"🗑️ Removed {len(all_invalid_tokens)} invalid tokens")
            
            return
        except Exception as e:
            logger.warning(f"⚠️ Firebase Admin SDK failed, falling back to Expo API: {e}")
    
    # Fallback to Expo Push API (legacy method)
    logger.info(f"📤 Sending {len(batch)} notifications via Expo Push API")
    headers = {"Content-Type": "application/json"}
    auth_token = getattr(settings, "EXPO_ACCESS_TOKEN", None)
    if auth_token:
        headers["Authorization"] = f"Bearer {auth_token}"
    chunk_size = 100
    for start in range(0, len(batch), chunk_size):
        chunk = batch[start : start + chunk_size]
        payloads = [msg.to_payload() for msg in chunk]
        try:
            response = requests.post(EXPO_PUSH_URL, json=payloads, headers=headers, timeout=10)
            response.raise_for_status()
            data = response.json()
        except Exception:
            logger.exception("expo_push_request_failed", extra={"count": len(chunk)})
            continue
        try:
            _handle_expo_response(chunk, data)
        except Exception:
            logger.exception("expo_push_response_handle_failed")
