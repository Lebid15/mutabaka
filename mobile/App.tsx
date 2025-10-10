import 'react-native-gesture-handler';
import './global.css';
import * as Notifications from 'expo-notifications';
import type { Notification } from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppState, type AppStateStatus, I18nManager, Platform, type ViewStyle } from 'react-native';
import RootNavigator from './src/navigation';
import { ThemeProvider, useThemeMode } from './src/theme';
import { initializeAppBadge, setAppBadgeCount, getSystemBadgeCount } from './src/lib/appBadge';
import { getExpoPushToken, checkPermissionStatus, getLastNotificationResponse } from './src/lib/pushNotifications';
import { updateCurrentDevicePushToken } from './src/services/devices';
import { getAccessToken } from './src/lib/authStorage';
import { inboxSocketManager } from './src/lib/inboxSocketManager';
import messaging from '@react-native-firebase/messaging';
import { fetchUnreadBadgeCount } from './src/services/conversations';
import { getActiveConversationId, isAppInForeground, setAppForegroundState } from './src/lib/activeConversation';
import { navigateToConversation } from './src/navigation/navigationService';
import {
  dismissAllNotifications,
  dismissNotificationIds,
  dismissNotificationsForConversation,
  extractConversationId,
  extractConversationIdFromData,
  extractMessageIdFromData,
  extractNotificationIdsFromData,
  registerExpoNotification,
} from './src/lib/notificationRegistry';
import {
  clearAllConversationNotificationHistory,
  clearConversationNotificationHistory,
  isMessagePushPayload,
  presentConversationNotification,
} from './src/lib/conversationNotifications';

type BadgeUpdateSource = 'push' | 'fallback' | 'system';

const BADGE_PUSH_PROTECTION_WINDOW_MS = 5000;

const badgeState: {
  lastValue: number | null;
  lastSource: BadgeUpdateSource;
  lastUpdatedAt: number;
} = {
  lastValue: null,
  lastSource: 'system',
  lastUpdatedAt: 0,
};

function rememberBadgeUpdate(value: number, source: BadgeUpdateSource) {
  badgeState.lastValue = value;
  badgeState.lastSource = source;
  badgeState.lastUpdatedAt = Date.now();
}

// معالج  ناجحة الإشعارات في الخلفية (FCM Background Handler)
setAppForegroundState(AppState.currentState === 'active');

messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  console.log('[FCM] Background message received:', remoteMessage);
  const normalizedData = normalizeRemoteMessageData(remoteMessage?.data as Record<string, string | undefined> | undefined);
  if (Object.keys(normalizedData).length && isBadgeResetPayload(normalizedData)) {
    console.log('[FCM] Background badge reset payload detected');
    await handleBadgeResetPayload(normalizedData, 'background');
    await synchronizeBadgeFromSource(0, 'fcm.background.reset');
    return;
  }

  const hasLegacyNotification = Boolean(remoteMessage?.notification);
  const androidCount = remoteMessage?.notification?.android?.count;
  if (typeof androidCount === 'number') {
    console.log('[FCM] 📟 Android status-bar count hint:', androidCount);
  }

  const badgeCandidate = normalizedData.unread_count
    ?? normalizedData.unreadCount
    ?? normalizedData.badge
    ?? remoteMessage?.data?.notification_count
    ?? remoteMessage?.data?.badge
    ?? remoteMessage?.data?.unread_count;

  const sanitizedBadge = sanitizeBadgeCandidate(badgeCandidate);

  if (isMessagePushPayload(normalizedData) && !isAppInForeground() && !hasLegacyNotification) {
    await presentConversationNotification(normalizedData, {
      unreadCount: sanitizedBadge,
      source: 'fcm.background',
    });
  }

  if (badgeCandidate !== undefined) {
    await synchronizeBadgeFromSource(badgeCandidate, 'fcm.background');
  }
});

Notifications.setNotificationHandler({
  handleNotification: async () => {
    const appForeground = isAppInForeground();
    if (appForeground) {
      return {
        shouldShowAlert: false,
        shouldPlaySound: false,
        shouldSetBadge: true,
        shouldShowBanner: false,
        shouldShowList: false,
      };
    }
    return {
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    };
  },
});

function normalizeRemoteMessageData(data?: Record<string, string | undefined> | null): Record<string, unknown> {
  if (!data) {
    return {};
  }
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      normalized[key] = value;
    } else if (value !== undefined && value !== null) {
      normalized[key] = value;
    }
  }
  return normalized;
}

function valueRepresentsBadgeReset(value: unknown): boolean {
  const sanitized = sanitizeBadgeCandidate(value);
  if (sanitized === 0) {
    return true;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    return trimmed === '0' || trimmed === 'false' || trimmed === 'reset';
  }
  return false;
}

function isBadgeResetPayload(data: Record<string, unknown>): boolean {
  if (!data) {
    return false;
  }
  const directKeys = ['badge.update', 'badge_update', 'badgeUpdate'];
  for (const key of directKeys) {
    if (key in data && valueRepresentsBadgeReset((data as Record<string, unknown>)[key])) {
      return true;
    }
  }
  const typeValue = typeof data.type === 'string' ? data.type.toLowerCase() : null;
  const eventValue = typeof data.event === 'string' ? data.event.toLowerCase() : null;
  if (typeValue === 'badge.update' || eventValue === 'badge.update') {
    const candidate = (data as Record<string, unknown>).value
      ?? (data as Record<string, unknown>).badge
      ?? (data as Record<string, unknown>).count;
    if (valueRepresentsBadgeReset(candidate)) {
      return true;
    }
  }
  if ('badge' in data && valueRepresentsBadgeReset((data as Record<string, unknown>).badge)) {
    const marker = (data as Record<string, unknown>).reason
      ?? (data as Record<string, unknown>).source
      ?? (data as Record<string, unknown>).context;
    if (typeof marker === 'string' && marker.toLowerCase().includes('badge')) {
      return true;
    }
  }
  return false;
}

async function handleBadgeResetPayload(data: Record<string, unknown>, source: string): Promise<void> {
  try {
    await setAppBadgeCount(0);
  } catch (error) {
    console.warn(`[Badge] ${source}: failed to reset badge count`, error);
  }

  const conversationId = extractConversationIdFromData(data);
  let fallbackConversation: number | null = null;
  const tagCandidate = typeof data.tag === 'string' ? data.tag : typeof data.group === 'string' ? data.group : null;
  if (tagCandidate) {
    fallbackConversation = extractConversationId(tagCandidate);
  }
  const notificationIds = extractNotificationIdsFromData(data);
  const reason = `push.badge.reset.${source}`;
  const expectedIds = notificationIds.length ? notificationIds : undefined;
  const targetConversation = conversationId ?? fallbackConversation;

  if (targetConversation !== null) {
    await dismissNotificationsForConversation(targetConversation, reason, {
      expectedIds,
      fallbackToAll: !expectedIds,
    });
    await clearConversationNotificationHistory(targetConversation);
    return;
  }

  if (expectedIds) {
    await dismissNotificationIds(expectedIds, reason, null);
    return;
  }

  await dismissAllNotifications(reason);
  await clearAllConversationNotificationHistory();
}

function sanitizeBadgeCandidate(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 0 ? 0 : Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return parsed < 0 ? 0 : parsed;
    }
  }
  return null;
}

function extractUnreadCount(notification: Notification | null | undefined): number | null {
  if (!notification) {
    return null;
  }

  const data = notification.request?.content?.data as Record<string, unknown> | undefined;
  const candidateKeys = [
    'unread_count',
    'unreadCount',
    'badge',
    'badge_count',
    'badgeCount',
    'notification_count',
    'notificationCount',
  ];

  const extractFromObject = (source: Record<string, unknown> | undefined, descriptor: string): number | null => {
    if (!source) {
      return null;
    }
    for (const key of candidateKeys) {
      const candidate = sanitizeBadgeCandidate(source[key]);
      if (candidate !== null) {
        console.log(`[Badge] extractUnreadCount: using ${descriptor}.${key}=${candidate}`);
        return candidate;
      }
    }
    return null;
  };

  const dataCandidate = extractFromObject(data, 'data');
  if (dataCandidate !== null) {
    return dataCandidate;
  }

  if (data && typeof data === 'object') {
    const nested = ['data', 'payload', 'extra'];
    for (const key of nested) {
      const value = data[key];
      if (value && typeof value === 'object') {
        const nestedCandidate = extractFromObject(value as Record<string, unknown>, `data.${key}`);
        if (nestedCandidate !== null) {
          return nestedCandidate;
        }
      }
    }
  }

  const badge = notification.request?.content?.badge;
  if (typeof badge === 'number' && Number.isFinite(badge)) {
    const sanitized = badge < 0 ? 0 : Math.floor(badge);
    console.log(`[Badge] extractUnreadCount: using notification.badge=${sanitized}`);
    // على أندرويد نفضّل أرقام البيانات، لذلك لا نعود للبادج إلا إذا لم نجد شيئاً آخر.
    return sanitized;
  }

  return null;
}

async function fetchBadgeFallback(context: string): Promise<number | null> {
  try {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      console.log(`[Badge] ${context}: no access token, skipping fallback fetch`);
      return null;
    }
    const FALLBACK_ENDPOINT = 'inbox/unread_count';
    console.log(`[Badge] ${context}: querying fallback endpoint ${FALLBACK_ENDPOINT}`);
    const count = await fetchUnreadBadgeCount();
    if (typeof count === 'number' && Number.isFinite(count)) {
      console.log(`[Badge] ${context}: fallback endpoint ${FALLBACK_ENDPOINT} returned`, count);
      return count;
    }
    console.log(`[Badge] ${context}: fallback endpoint ${FALLBACK_ENDPOINT} returned no usable count`);
  } catch (error) {
    console.warn(`[Badge] ${context}: failed to fetch fallback unread count`, error);
  }
  return null;
}

async function synchronizeBadgeFromSource(candidate: unknown, context: string): Promise<number | null> {
  try {
    const systemBefore = await getSystemBadgeCount();
    const sanitized = sanitizeBadgeCandidate(candidate);
    if (sanitized !== null) {
      await setAppBadgeCount(sanitized);
      rememberBadgeUpdate(sanitized, 'push');
      console.log(`[Badge] ${context}: applied push badge`, sanitized);
      const systemAfter = await getSystemBadgeCount();
      console.log(`[Badge] ${context}: system badge now`, systemAfter);
      return sanitized;
    }

    const now = Date.now();
    const protectingPush = badgeState.lastSource === 'push'
      && badgeState.lastValue !== null
      && now - badgeState.lastUpdatedAt < BADGE_PUSH_PROTECTION_WINDOW_MS;

    if (protectingPush) {
      console.log(`[Badge] ${context}: skipped fallback/system to protect recent push badge`, badgeState.lastValue);
      return badgeState.lastValue;
    }

    const fallback = await fetchBadgeFallback(context);
    if (fallback !== null) {
      await setAppBadgeCount(fallback);
      rememberBadgeUpdate(fallback, 'fallback');
      console.log(`[Badge] ${context}: applied fallback badge`, fallback);
      const systemAfter = await getSystemBadgeCount();
      console.log(`[Badge] ${context}: system badge now`, systemAfter);
      return fallback;
    }

    await setAppBadgeCount(systemBefore);
    rememberBadgeUpdate(systemBefore, 'system');
    console.log(`[Badge] ${context}: retained system badge`, systemBefore);
    const systemAfter = await getSystemBadgeCount();
    console.log(`[Badge] ${context}: system badge now`, systemAfter);
    return systemBefore;
  } catch (error) {
    console.warn(`[Badge] ${context}: failed to synchronize badge`, error);
    return null;
  }
}

function useNotificationBadgeBridge() {
  const lastPermissionCheckRef = useRef<string>('unknown');

  useEffect(() => {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
      return;
    }
    void initializeAppBadge();
  }, []);

  // فحص وتحديث Push Token عند تغيير حالة التطبيق
  useEffect(() => {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
      return undefined;
    }

    const checkAndUpdatePushToken = async () => {
      try {
        // التحقق من وجود access token (المستخدم مسجل دخول)
        const accessToken = await getAccessToken();
        if (!accessToken) {
          console.log('[App] ⚠️ User not logged in, skipping token update');
          return;
        }
        
        // التحقق من حالة الأذونات
        const currentPermission = await checkPermissionStatus();
        
        // تحديث Token إذا كانت الأذونات مفعّلة
        if (currentPermission === 'granted') {
          console.log('[App] 🔔 Notifications enabled, updating push token...');
          
          // الحصول على Push Token
          const pushToken = await getExpoPushToken();
          
          if (pushToken) {
            console.log('[App] ✅ Push token obtained:', pushToken.substring(0, 20) + '...');
            
            // تحديث Token في السيرفر
            try {
              await updateCurrentDevicePushToken(pushToken);
              console.log('[App] ✅ Push token updated on server successfully');
            } catch (updateError) {
              console.warn('[App] ⚠️ Failed to update push token on server:', updateError);
            }
          } else {
            console.warn('[App] ⚠️ Push token is null');
          }
        } else {
          console.log('[App] ⚠️ Notifications not enabled, skipping token update');
        }
        
        lastPermissionCheckRef.current = currentPermission;
      } catch (error) {
        console.warn('[App] Failed to check/update push token:', error);
      }
    };

    // فحص عند تحميل التطبيق
    checkAndUpdatePushToken();
  void synchronizeBadgeFromSource(undefined, 'app.bootstrap');

    // معالج الإشعارات الواردة من FCM (Foreground)
    const handledResponseIds = new Set<string>();

    const handleNotificationResponseNavigation = (response: Notifications.NotificationResponse | null, source: string) => {
      if (!response) {
        return;
      }

      const identifier = response.notification.request.identifier;
      if (identifier && handledResponseIds.has(identifier)) {
        console.log(`[Notifications] Response ${identifier} from ${source} already handled`);
        return;
      }

      registerExpoNotification(response.notification);

      const data = response.notification.request.content?.data as Record<string, unknown> | undefined;
      const conversationNumeric = extractConversationIdFromData(data);
      if (conversationNumeric !== null) {
        void dismissNotificationsForConversation(conversationNumeric, `notification.response.${source}`, {
          expectedIds: identifier ? [identifier] : undefined,
          fallbackToAll: true,
        });
        void clearConversationNotificationHistory(conversationNumeric);
      } else if (identifier) {
        void dismissNotificationIds([identifier], `notification.response.${source}`, null);
      }

      const conversationIdFromPayload = conversationNumeric !== null
        ? conversationNumeric
        : typeof data?.conversation_id === 'string'
          ? data.conversation_id
          : typeof data?.conversation_id === 'number'
            ? data.conversation_id
            : typeof data?.conversation === 'string'
              ? data.conversation
              : typeof data?.conversation === 'number'
                ? data.conversation
                : null;

      if (conversationIdFromPayload !== null && conversationIdFromPayload !== undefined) {
        navigateToConversation(conversationIdFromPayload);
      } else {
        console.warn(`[Notifications] Unable to resolve conversation from response (${source})`);
      }

      if (identifier) {
        handledResponseIds.add(identifier);
      }

      void synchronizeBadgeFromSource(extractUnreadCount(response.notification), `notification.response.${source}`);
    };

    const unsubscribeFCM = messaging().onMessage(async (remoteMessage) => {
      console.log('[FCM] 📨 Foreground message received');
      console.log('[FCM] Title:', remoteMessage.notification?.title);
      console.log('[FCM] Body:', remoteMessage.notification?.body);
      console.log('[FCM] Data:', JSON.stringify(remoteMessage.data));

      const normalizedData = normalizeRemoteMessageData(remoteMessage.data as Record<string, string | undefined> | undefined);
      if (Object.keys(normalizedData).length && isBadgeResetPayload(normalizedData)) {
        console.log('[FCM] Foreground badge reset payload detected');
        await handleBadgeResetPayload(normalizedData, 'foreground');
        await synchronizeBadgeFromSource(0, 'fcm.foreground');
        return;
      }

      const badgeCandidate = remoteMessage.data?.unread_count ?? remoteMessage.data?.badge;
      const badgeCount = sanitizeBadgeCandidate(badgeCandidate);

      if (remoteMessage.notification) {
        console.log('[FCM] 🏷️ Badge candidate from push:', badgeCandidate);
        console.log('[FCM] 🧮 Sanitized badge:', badgeCount);
        const androidCount = remoteMessage.notification?.android?.count;
        if (typeof androidCount === 'number') {
          console.log('[FCM] 📟 Android status-bar count hint:', androidCount);
        }

        const conversationNumeric = extractConversationIdFromData(normalizedData);
        const activeConversationId = getActiveConversationId();
        const isConversationFocused = typeof conversationNumeric === 'number'
          && typeof activeConversationId === 'number'
          && conversationNumeric === activeConversationId;
        if (isConversationFocused) {
          console.log('[FCM] 🔕 Conversation is currently focused; no foreground banner needed');
        } else {
          console.log('[FCM] 🔕 Suppressing foreground banner (app handles in-app messaging UI)');
        }
      }

      if (!remoteMessage.notification && isMessagePushPayload(normalizedData) && !isAppInForeground()) {
        await presentConversationNotification(normalizedData, {
          unreadCount: badgeCount,
          source: 'fcm.foreground.backgrounded',
        });
      }

      await synchronizeBadgeFromSource(badgeCandidate, 'fcm.foreground');
    });

    const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
      registerExpoNotification(notification);
      void synchronizeBadgeFromSource(extractUnreadCount(notification), 'expo.notification.received');
    });

    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      handleNotificationResponseNavigation(response, 'listener');
    });
    // معالجة الإشعار الأخير عند فتح التطبيق (مثلاً بعد إنهاء التطبيق)
    getLastNotificationResponse()
      .then((lastResponse) => {
        if (lastResponse) {
          console.log('[Notifications] Handling last notification response on startup');
          handleNotificationResponseNavigation(lastResponse, 'startup');
        }
      })
      .catch((error) => {
        console.error('[Notifications] Failed to fetch last notification response', error);
      });

    const initialActive = AppState.currentState === 'active';
    setAppForegroundState(initialActive);
    inboxSocketManager.setForeground(initialActive);
    if (initialActive) {
      void (async () => {
        await dismissAllNotifications('app.bootstrap.active');
        await clearAllConversationNotificationHistory();
      })();
      inboxSocketManager.ensureConnection('foreground');
    }

    const appStateSubscription = AppState.addEventListener('change', (status: AppStateStatus) => {
      const isActive = status === 'active';
      setAppForegroundState(isActive);
      inboxSocketManager.setForeground(isActive);
      if (isActive) {
        void synchronizeBadgeFromSource(undefined, 'appstate.active');
        // فحص وتحديث Token عند العودة للتطبيق
        checkAndUpdatePushToken();
        void (async () => {
          await dismissAllNotifications('appstate.active');
          await clearAllConversationNotificationHistory();
        })();
        inboxSocketManager.ensureConnection('foreground');
      }
    });

    return () => {
    receivedSubscription.remove();
    responseSubscription.remove();
      appStateSubscription.remove();
      unsubscribeFCM(); // إلغاء الاشتراك في FCM
      inboxSocketManager.setForeground(false);
    };
  }, []);
}

I18nManager.allowRTL(true);
I18nManager.forceRTL(true);
I18nManager.swapLeftAndRightInRTL(true);

function AppContainer() {
  const { mode, tokens } = useThemeMode();

  console.log('[Mutabaka] AppContainer mounted with mode:', mode);

  return (
    <>
      <StatusBar style={mode === 'light' ? 'dark' : 'light'} backgroundColor={tokens.background} />
      <RootNavigator />
    </>
  );
}

export default function App() {
  const rtlLayout: ViewStyle = { flex: 1, direction: 'rtl' };
  useNotificationBadgeBridge();
  useEffect(() => {
    inboxSocketManager.ensureConnection();
  }, []);

  return (
    <GestureHandlerRootView style={rtlLayout}>
      <ThemeProvider>
        <SafeAreaProvider style={rtlLayout}>
          <AppContainer />
        </SafeAreaProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
