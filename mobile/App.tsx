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
import { getExpoPushToken, checkPermissionStatus } from './src/lib/pushNotifications';
import { updateCurrentDevicePushToken } from './src/services/devices';
import { getAccessToken } from './src/lib/authStorage';
import { inboxSocketManager } from './src/lib/inboxSocketManager';
import messaging from '@react-native-firebase/messaging';
import { fetchUnreadBadgeCount } from './src/services/conversations';

// معالج الإشعارات في الخلفية (FCM Background Handler)
messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  console.log('[FCM] Background message received:', remoteMessage);
});

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

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
  const badge = notification.request?.content?.badge;
  if (typeof badge === 'number' && Number.isFinite(badge)) {
    return badge < 0 ? 0 : Math.floor(badge);
  }
  const data = notification.request?.content?.data as Record<string, unknown> | undefined;
  if (!data) {
    return null;
  }

  const candidateKeys = [
    'unread_count',
    'unreadCount',
    'badge',
    'badge_count',
    'badgeCount',
    'notification_count',
    'notificationCount',
  ];

  for (const key of candidateKeys) {
    const candidate = sanitizeBadgeCandidate((data as Record<string, unknown>)[key]);
    if (candidate !== null) {
      return candidate;
    }
  }

  const nested = ['data', 'payload', 'extra'];
  for (const key of nested) {
    const value = data[key];
    if (value && typeof value === 'object') {
      for (const nestedKey of candidateKeys) {
        const nestedCandidate = sanitizeBadgeCandidate((value as Record<string, unknown>)[nestedKey]);
        if (nestedCandidate !== null) {
          return nestedCandidate;
        }
      }
    }
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
    const count = await fetchUnreadBadgeCount();
    if (typeof count === 'number' && Number.isFinite(count)) {
      return count;
    }
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
      console.log(`[Badge] ${context}: applied push badge`, sanitized);
      return sanitized;
    }

    const fallback = await fetchBadgeFallback(context);
    if (fallback !== null) {
      await setAppBadgeCount(fallback);
      console.log(`[Badge] ${context}: applied fallback badge`, fallback);
      return fallback;
    }

    await setAppBadgeCount(systemBefore);
    console.log(`[Badge] ${context}: retained system badge`, systemBefore);
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
    const unsubscribeFCM = messaging().onMessage(async (remoteMessage) => {
      console.log('[FCM] 📨 Foreground message received');
      console.log('[FCM] Title:', remoteMessage.notification?.title);
      console.log('[FCM] Body:', remoteMessage.notification?.body);
      console.log('[FCM] Data:', JSON.stringify(remoteMessage.data));

  const badgeCandidate = remoteMessage.data?.unread_count ?? remoteMessage.data?.badge;

      if (remoteMessage.notification) {
        const badgeCount = sanitizeBadgeCandidate(badgeCandidate);
        console.log('[FCM] 🏷️ Badge candidate from push:', badgeCandidate);
        console.log('[FCM] � Sanitized badge:', badgeCount);

        await Notifications.scheduleNotificationAsync({
          content: {
            title: remoteMessage.notification.title || 'إشعار جديد',
            body: remoteMessage.notification.body || '',
            data: remoteMessage.data || {},
            badge: badgeCount ?? undefined,
            sound: 'default',
          },
          trigger: null,
        });

        console.log('[FCM] ✅ Local notification scheduled');
      }

      await synchronizeBadgeFromSource(badgeCandidate, 'fcm.foreground');
    });

    const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
      void synchronizeBadgeFromSource(extractUnreadCount(notification), 'expo.notification.received');
    });

    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void synchronizeBadgeFromSource(extractUnreadCount(response.notification), 'expo.notification.response');
    });

    inboxSocketManager.setForeground(AppState.currentState === 'active');
    if (AppState.currentState === 'active') {
      inboxSocketManager.ensureConnection('foreground');
    }

    const appStateSubscription = AppState.addEventListener('change', (status: AppStateStatus) => {
      const isActive = status === 'active';
      inboxSocketManager.setForeground(isActive);
      if (isActive) {
        void synchronizeBadgeFromSource(undefined, 'appstate.active');
        // فحص وتحديث Token عند العودة للتطبيق
        checkAndUpdatePushToken();
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
