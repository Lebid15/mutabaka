import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { NotificationPermissionsStatus } from 'expo-notifications';

const SUPPORTED_PLATFORM = Platform.OS === 'ios' || Platform.OS === 'android';
const MAX_BADGE_COUNT = 999;
export const ANDROID_MESSAGES_CHANNEL_ID = 'mutabaka-messages';
let permissionState: 'unknown' | 'granted' | 'denied' = 'unknown';
let permissionPromise: Promise<boolean> | null = null;
let androidChannelReady = false;
let initializing = false;

function isIosStatusGranted(status?: Notifications.IosAuthorizationStatus | null): boolean {
  if (typeof status === 'undefined' || status === null) {
    return false;
  }
  return (
    status === Notifications.IosAuthorizationStatus.AUTHORIZED ||
    status === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    status === Notifications.IosAuthorizationStatus.EPHEMERAL
  );
}

function isPermissionGranted(response: NotificationPermissionsStatus): boolean {
  if (response.granted) {
    return true;
  }
  if (response.status === 'granted') {
    return true;
  }
  if (response.ios && isIosStatusGranted(response.ios.status)) {
    return true;
  }
  return false;
}

async function ensurePermissions(): Promise<boolean> {
  if (!SUPPORTED_PLATFORM) {
    return false;
  }
  if (permissionState === 'granted') {
    return true;
  }
  if (permissionState === 'denied') {
    return false;
  }
  if (permissionPromise) {
    return permissionPromise;
  }

  permissionPromise = (async () => {
    try {
      const current = await Notifications.getPermissionsAsync();
      if (isPermissionGranted(current)) {
        permissionState = 'granted';
        return true;
      }

      if (!current.canAskAgain) {
        permissionState = 'denied';
        return false;
      }

      const requested = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: false,
          allowBadge: true,
          allowSound: true,
          allowCriticalAlerts: false,
          allowDisplayInCarPlay: false,
          provideAppNotificationSettings: false,
        },
      });

      if (isPermissionGranted(requested)) {
        permissionState = 'granted';
        return true;
      }

      permissionState = 'denied';
      return false;
    } catch (error) {
      console.warn('[Mutabaka] Failed to acquire notification permissions for badge', error);
      permissionState = 'denied';
      return false;
    } finally {
      permissionPromise = null;
    }
  })();

  return permissionPromise;
}

async function configureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  if (androidChannelReady) {
    return;
  }
  try {
    await Notifications.setNotificationChannelAsync(ANDROID_MESSAGES_CHANNEL_ID, {
      name: 'رسائل مطابقة',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      enableLights: true,
      enableVibrate: true,
      showBadge: true,
      vibrationPattern: [0, 160, 120, 160],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
    await Notifications.setNotificationChannelAsync('default', {
      name: 'إشعارات عامة',
      importance: Notifications.AndroidImportance.DEFAULT,
      enableLights: true,
      enableVibrate: true,
      showBadge: true,
      sound: 'default',
    });
    androidChannelReady = true;
  } catch (error) {
    console.warn('[Mutabaka] Failed to configure Android notification channel for badges', error);
  }
}

function sanitizeBadgeCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  const rounded = Math.floor(value);
  return rounded > MAX_BADGE_COUNT ? MAX_BADGE_COUNT : rounded;
}

async function applyBadge(count: number): Promise<void> {
  if (!SUPPORTED_PLATFORM) {
    return;
  }
  try {
    const granted = await ensurePermissions();
    if (!granted) {
      return;
    }
    await Notifications.setBadgeCountAsync(count);
  } catch (error) {
    console.warn('[Mutabaka] Failed to set application icon badge', error);
  }
}

async function ensureInitialized(): Promise<void> {
  if (!SUPPORTED_PLATFORM) {
    return;
  }
  if (initializing) {
    return;
  }
  initializing = true;
  try {
    await configureAndroidChannel();
    await ensurePermissions();
  } finally {
    initializing = false;
  }
}

export async function initializeAppBadge(): Promise<void> {
  await ensureInitialized();
  if (!SUPPORTED_PLATFORM) {
    return;
  }
  try {
    const current = await Notifications.getBadgeCountAsync();
    const sanitized = typeof current === 'number' && Number.isFinite(current) ? sanitizeBadgeCount(current) : 0;
    await applyBadge(sanitized);
  } catch (error) {
    console.warn('[Mutabaka] Failed to mirror existing badge count during initialization', error);
  }
}

export async function setAppBadgeCount(count: number): Promise<void> {
  if (!SUPPORTED_PLATFORM) {
    return;
  }
  const sanitized = sanitizeBadgeCount(count);
  await ensureInitialized();
  await applyBadge(sanitized);
}

export async function clearAppBadge(): Promise<void> {
  if (!SUPPORTED_PLATFORM) {
    return;
  }
  await ensureInitialized();
  await applyBadge(0);
}

export async function getSystemBadgeCount(): Promise<number> {
  if (!SUPPORTED_PLATFORM) {
    return 0;
  }
  try {
    const current = await Notifications.getBadgeCountAsync();
    if (typeof current === 'number' && Number.isFinite(current) && current > 0) {
      return Math.floor(current);
    }
    return 0;
  } catch (error) {
    console.warn('[Mutabaka] Failed to query system badge count', error);
    return 0;
  }
}
