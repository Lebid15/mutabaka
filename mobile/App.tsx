import 'react-native-gesture-handler';
import './global.css';
import * as Notifications from 'expo-notifications';
import type { Notification } from 'expo-notifications';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppState, type AppStateStatus, I18nManager, Platform, type ViewStyle } from 'react-native';
import RootNavigator from './src/navigation';
import { ThemeProvider, useThemeMode } from './src/theme';
import { initializeAppBadge, refreshAppBadge, setAppBadgeCount } from './src/lib/appBadge';

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

function useNotificationBadgeBridge() {
  useEffect(() => {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
      return;
    }
    void initializeAppBadge();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
      return undefined;
    }

    const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
      const count = extractUnreadCount(notification);
      if (count !== null) {
        void setAppBadgeCount(count);
      } else {
        refreshAppBadge();
      }
    });

    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const count = extractUnreadCount(response.notification);
      if (count !== null) {
        void setAppBadgeCount(count);
      }
    });

    const appStateSubscription = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (status === 'active') {
        refreshAppBadge();
      }
    });

    return () => {
      receivedSubscription.remove();
      responseSubscription.remove();
      appStateSubscription.remove();
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
