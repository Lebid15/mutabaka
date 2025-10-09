import * as Notifications from 'expo-notifications';

type NotificationData = Record<string, unknown> | null | undefined;

const conversationToNotifications = new Map<number, Set<string>>();
const notificationToConversation = new Map<string, number | null>();
const messageToNotification = new Map<number, string>();
const notificationToMessage = new Map<string, number>();

function normalizeNotificationId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return null;
}

function normalizeInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const intVal = Math.trunc(value);
    return intVal > 0 ? intVal : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

export function extractConversationId(value: unknown): number | null {
  return normalizeInteger(value);
}

export function extractMessageId(value: unknown): number | null {
  return normalizeInteger(value);
}

const CONVERSATION_ID_KEYS = [
  'conversation_id',
  'conversationId',
  'conversationID',
  'conversation',
  'thread_id',
  'threadId',
  'threadID',
  'cid',
];

const MESSAGE_ID_KEYS = [
  'message_id',
  'messageId',
  'messageID',
  'id',
  'mid',
];

export function extractConversationIdFromData(data: NotificationData): number | null {
  if (!data || typeof data !== 'object') {
    return null;
  }
  for (const key of CONVERSATION_ID_KEYS) {
    if (key in data) {
      const candidate = extractConversationId((data as Record<string, unknown>)[key]);
      if (candidate !== null) {
        return candidate;
      }
    }
  }
  return null;
}

export function extractMessageIdFromData(data: NotificationData): number | null {
  if (!data || typeof data !== 'object') {
    return null;
  }
  for (const key of MESSAGE_ID_KEYS) {
    if (key in data) {
      const candidate = extractMessageId((data as Record<string, unknown>)[key]);
      if (candidate !== null) {
        return candidate;
      }
    }
  }
  return null;
}

const NOTIFICATION_IDS_KEYS = [
  'notification_ids',
  'notificationIds',
  'notification_ids[]',
  'notification_ids_json',
  'notification_ids_list',
  'notification_ids_str',
  'notification_ids_string',
  'notificationId',
  'notification_id',
  'notificationIdList',
];

export function extractNotificationIdsFromData(data: NotificationData): string[] {
  if (!data || typeof data !== 'object') {
    return [];
  }
  const candidates: string[] = [];
  for (const key of NOTIFICATION_IDS_KEYS) {
    if (key in data) {
      const value = (data as Record<string, unknown>)[key];
      const parsed = parseNotificationIdList(value);
      if (parsed.length) {
        candidates.push(...parsed);
      }
    }
  }
  if (!candidates.length) {
    const flattened = Object.entries(data)
      .filter(([key]) => key.startsWith('notification_ids[') || key.startsWith('notificationIds['))
      .map(([, value]) => value);
    if (flattened.length) {
      const parsed = parseNotificationIdList(flattened);
      if (parsed.length) {
        candidates.push(...parsed);
      }
    }
  }
  return Array.from(new Set(candidates));
}

function trackConversationNotification(conversationId: number, notificationId: string): void {
  let existing = conversationToNotifications.get(conversationId);
  if (!existing) {
    existing = new Set<string>();
    conversationToNotifications.set(conversationId, existing);
  }
  existing.add(notificationId);
}

function cleanupNotificationId(notificationId: string): void {
  const conversationId = notificationToConversation.get(notificationId);
  if (typeof conversationId === 'number') {
    const set = conversationToNotifications.get(conversationId);
    if (set) {
      set.delete(notificationId);
      if (!set.size) {
        conversationToNotifications.delete(conversationId);
      }
    }
  }
  notificationToConversation.delete(notificationId);

  const messageId = notificationToMessage.get(notificationId);
  if (typeof messageId === 'number') {
    notificationToMessage.delete(notificationId);
    const registered = messageToNotification.get(messageId);
    if (registered === notificationId) {
      messageToNotification.delete(messageId);
    }
  }
}

export function registerNotification(params: {
  conversationId?: unknown;
  messageId?: unknown;
  notificationId?: unknown;
}): void {
  const normalizedId = normalizeNotificationId(params.notificationId ?? null);
  if (!normalizedId) {
    return;
  }
  const conversationId = params.conversationId != null ? extractConversationId(params.conversationId) : null;
  if (conversationId !== null) {
    trackConversationNotification(conversationId, normalizedId);
    notificationToConversation.set(normalizedId, conversationId);
  } else {
    notificationToConversation.set(normalizedId, null);
  }
  const messageId = params.messageId != null ? extractMessageId(params.messageId) : null;
  if (messageId !== null) {
    messageToNotification.set(messageId, normalizedId);
    notificationToMessage.set(normalizedId, messageId);
  }
}

export function registerNotificationRequest(request: Notifications.NotificationRequest | null | undefined): void {
  if (!request) {
    return;
  }
  const identifier = normalizeNotificationId(request.identifier);
  if (!identifier) {
    return;
  }
  const content = request.content ?? {};
  const data = content.data as NotificationData;
  const conversationId = extractConversationIdFromData(data);
  const messageId = extractMessageIdFromData(data);
  registerNotification({
    conversationId,
    messageId,
    notificationId: identifier,
  });
}

export function registerExpoNotification(notification: Notifications.Notification | null | undefined): void {
  if (!notification) {
    return;
  }
  registerNotificationRequest(notification.request);
}

export function getRegisteredNotificationIds(conversationId: unknown): string[] {
  const normalized = extractConversationId(conversationId);
  if (normalized === null) {
    return [];
  }
  const set = conversationToNotifications.get(normalized);
  if (!set || !set.size) {
    return [];
  }
  return Array.from(set);
}

export function parseNotificationIdList(value: unknown): string[] {
  if (!value) {
    return [];
  }
  const candidates: string[] = [];
  if (Array.isArray(value)) {
    for (const entry of value) {
      const normalized = normalizeNotificationId(entry);
      if (normalized) {
        candidates.push(normalized);
      }
    }
    return candidates;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parseNotificationIdList(parsed);
      }
    } catch (error) {
      // Fallback to comma-separated list
    }
    return trimmed
      .split(',')
      .map((token) => normalizeNotificationId(token))
      .filter((token): token is string => Boolean(token));
  }
  return [];
}

export async function dismissNotificationIds(
  ids: Iterable<unknown>,
  reason: string,
  conversationId?: number | null,
): Promise<string[]> {
  const normalized = Array.from(new Set(
    Array.from(ids)
      .map((value) => normalizeNotificationId(value))
      .filter((value): value is string => Boolean(value)),
  ));
  if (!normalized.length) {
    return [];
  }
  const dismissed: string[] = [];
  for (const id of normalized) {
    try {
      await Notifications.dismissNotificationAsync(id);
      dismissed.push(id);
      cleanupNotificationId(id);
    } catch (error) {
      console.warn('[Notifications] failed to dismiss notification', id, error);
    }
  }
  if (dismissed.length) {
    console.log(`[Notifications] dismissed ids=${dismissed.join(',')} conv=${conversationId ?? 'unknown'} reason=${reason}`);
  }
  return dismissed;
}

export async function dismissNotificationsForConversation(
  conversationId: unknown,
  reason: string,
  options: {
    fallbackToAll?: boolean;
    expectedIds?: Iterable<unknown>;
  } = {},
): Promise<void> {
  const normalized = extractConversationId(conversationId);
  const expected = options.expectedIds ? parseNotificationIdList(Array.from(options.expectedIds)) : [];
  if (normalized === null) {
    if (expected.length) {
      await dismissNotificationIds(expected, reason, null);
    } else if (options.fallbackToAll) {
      await dismissAllNotifications(reason);
    }
    return;
  }
  const registered = conversationToNotifications.get(normalized);
  const candidateIds = new Set<string>();
  if (registered && registered.size) {
    registered.forEach((id) => candidateIds.add(id));
  }
  expected.forEach((id) => candidateIds.add(id));
  if (!candidateIds.size) {
    if (options.fallbackToAll) {
      await dismissAllNotifications(reason);
    }
    return;
  }
  await dismissNotificationIds(candidateIds, reason, normalized);
}

export async function dismissAllNotifications(reason: string): Promise<void> {
  try {
    await Notifications.dismissAllNotificationsAsync();
    conversationToNotifications.clear();
    notificationToConversation.clear();
    messageToNotification.clear();
    notificationToMessage.clear();
    console.log(`[Notifications] dismissed ids=ALL conv=ALL reason=${reason}`);
  } catch (error) {
    console.warn('[Notifications] failed to dismiss all notifications', error);
  }
}
