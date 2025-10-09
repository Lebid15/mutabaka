import * as Notifications from 'expo-notifications';

import {
  dismissNotificationsForConversation,
  extractConversationIdFromData,
  extractMessageIdFromData,
  registerNotification,
} from './notificationRegistry';

export type PushPayload = Record<string, unknown> | null | undefined;

function extractStringField(data: PushPayload, keys: string[]): string | null {
  if (!data || typeof data !== 'object') {
    return null;
  }
  for (const key of keys) {
    const value = (data as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim().length) {
      return value.trim();
    }
  }
  return null;
}

const MESSAGE_TYPE_HINTS = ['message', 'chat.message', 'inbox.message'];
const MESSAGE_EVENT_HINTS = ['message', 'chat.message', 'chat.message.created'];
const MESSAGE_REASON_IGNORE = ['chat.read', 'conversation.read'];

export function isMessagePushPayload(data: PushPayload): boolean {
  if (!data || typeof data !== 'object') {
    return false;
  }
  const reason = extractStringField(data, ['reason', 'event']);
  if (reason && MESSAGE_REASON_IGNORE.includes(reason.toLowerCase())) {
    return false;
  }
  const type = extractStringField(data, ['type', 'event']);
  if (type) {
    const lowered = type.toLowerCase();
    if (MESSAGE_TYPE_HINTS.some((hint) => lowered.includes(hint))) {
      return true;
    }
  }
  const kind = extractStringField(data, ['kind', 'payload_type']);
  if (kind && kind.toLowerCase().includes('message')) {
    return true;
  }
  const preview = extractStringField(data, ['preview', 'body']);
  return Boolean(preview);
}

type PresentNotificationOptions = {
  unreadCount?: number | null;
  source: string;
};

const FALLBACK_TITLE = 'مطابقة';
const FALLBACK_BODY = 'لديك رسالة جديدة.';

export async function presentConversationNotification(
  data: PushPayload,
  options: PresentNotificationOptions,
): Promise<string | null> {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const conversationId = extractConversationIdFromData(data);
  const messageId = extractMessageIdFromData(data);
  const senderDisplay = extractStringField(data, ['sender_display', 'sender', 'title']);
  const preview = extractStringField(data, ['preview', 'body', 'message']);
  const category = extractStringField(data, ['category']);
  const androidGroup = conversationId !== null ? `conversation-${conversationId}` : undefined;

  const content: Notifications.NotificationContentInput = {
    title: senderDisplay ?? FALLBACK_TITLE,
    body: preview ?? FALLBACK_BODY,
    data: {
      ...data,
      notification_source: options.source,
      notification_category: category ?? 'message',
      notification_group: androidGroup,
    },
    sound: 'default',
  };

  if (typeof options.unreadCount === 'number' && Number.isFinite(options.unreadCount)) {
    content.badge = options.unreadCount;
  }
  if (category) {
    content.categoryIdentifier = category;
  }

  if (conversationId !== null) {
    await dismissNotificationsForConversation(conversationId, `conversation.notification.replace.${options.source}`, {
      fallbackToAll: false,
    });
  }

  try {
    const identifier = await Notifications.scheduleNotificationAsync({
      content,
      trigger: null,
    });

    registerNotification({
      conversationId,
      messageId,
      notificationId: identifier,
    });

    return identifier;
  } catch (error) {
    console.warn('[Notifications] Failed to schedule conversation notification', error);
    return null;
  }
}
