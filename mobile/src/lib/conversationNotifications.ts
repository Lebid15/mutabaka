import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  dismissNotificationsForConversation,
  extractConversationIdFromData,
  extractMessageIdFromData,
  registerNotification,
} from './notificationRegistry';

export type PushPayload = Record<string, unknown> | null | undefined;

const HISTORY_KEY_PREFIX = 'conversation_notification_history:';
const HISTORY_MAX_MESSAGES = 7;

const historyCache = new Map<number, string[]>();
const historyLoads = new Map<number, Promise<string[]>>();

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

async function loadHistory(conversationId: number): Promise<string[]> {
  if (historyCache.has(conversationId)) {
    return historyCache.get(conversationId) ?? [];
  }

  let pending = historyLoads.get(conversationId);
  if (!pending) {
    const storageKey = `${HISTORY_KEY_PREFIX}${conversationId}`;
    pending = AsyncStorage.getItem(storageKey)
      .then((raw) => {
        if (!raw) {
          return [];
        }
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            return parsed.filter((entry) => typeof entry === 'string');
          }
        } catch (error) {
          console.warn('[Notifications] Failed to parse stored conversation history', error);
        }
        return [];
      })
      .finally(() => {
        historyLoads.delete(conversationId);
      });
    historyLoads.set(conversationId, pending);
  }

  const history = await pending;
  historyCache.set(conversationId, history);
  return history;
}

async function persistHistory(conversationId: number, messages: string[]): Promise<void> {
  historyCache.set(conversationId, messages);
  const storageKey = `${HISTORY_KEY_PREFIX}${conversationId}`;
  if (!messages.length) {
    await AsyncStorage.removeItem(storageKey);
    return;
  }
  await AsyncStorage.setItem(storageKey, JSON.stringify(messages));
}

async function appendMessageToHistory(conversationId: number, message: string): Promise<string[]> {
  const sanitized = message.trim();
  if (!sanitized) {
    return loadHistory(conversationId);
  }

  const history = await loadHistory(conversationId);
  const updated = [...history, sanitized].slice(-HISTORY_MAX_MESSAGES);
  await persistHistory(conversationId, updated);
  return updated;
}

export async function clearConversationNotificationHistory(conversationId: number): Promise<void> {
  historyCache.delete(conversationId);
  const storageKey = `${HISTORY_KEY_PREFIX}${conversationId}`;
  await AsyncStorage.removeItem(storageKey);
}

export async function clearAllConversationNotificationHistory(): Promise<void> {
  historyCache.clear();
  historyLoads.clear();
  try {
    const keys = await AsyncStorage.getAllKeys();
    const filtered = keys.filter((key) => key.startsWith(HISTORY_KEY_PREFIX));
    if (filtered.length) {
      await AsyncStorage.multiRemove(filtered);
    }
  } catch (error) {
    console.warn('[Notifications] Failed to clear notification histories', error);
  }
}

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
  const previewText = typeof preview === 'string' ? preview.trim() : null;
  const category = extractStringField(data, ['category']);
  const androidGroup = conversationId !== null ? `conversation-${conversationId}` : undefined;

  const baseData = data as Record<string, unknown>;
  const contentData: Record<string, unknown> = {
    ...baseData,
    notification_source: options.source,
    notification_category: category ?? 'message',
    notification_group: androidGroup,
  };

  const content: Notifications.NotificationContentInput = {
    title: senderDisplay ?? FALLBACK_TITLE,
    body: preview ?? FALLBACK_BODY,
    data: contentData,
    sound: 'default',
  };

  let bodyLines: string[] | null = null;
  if (conversationId !== null && previewText) {
    bodyLines = await appendMessageToHistory(conversationId, previewText);
  } else if (previewText) {
    bodyLines = [previewText];
  }

  let collapsedBody = previewText ?? content.body ?? FALLBACK_BODY;

  if (bodyLines && bodyLines.length) {
    collapsedBody = bodyLines[bodyLines.length - 1];
  }

  content.body = collapsedBody;
  contentData.notification_collapsed_body = collapsedBody;

  console.log('[Notifications] preparing conversation notification', {
    conversationId,
    messageId,
    source: options.source,
    preview: collapsedBody,
  });

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

    console.log('[Notifications] scheduled conversation notification', {
      conversationId,
      messageId,
      notificationId: identifier,
      source: options.source,
    });

    return identifier;
  } catch (error) {
    console.warn('[Notifications] Failed to schedule conversation notification', error);
    return null;
  }
}
