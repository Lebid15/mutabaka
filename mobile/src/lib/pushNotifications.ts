import { Platform, Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
import messaging from '@react-native-firebase/messaging';

/**
 * خدمة إدارة Push Notifications
 * - يستخدم Firebase Cloud Messaging (FCM) للحصول على Token حقيقي
 * - يستخدم expo-notifications لعرض الإشعارات
 * - يدعم Android و iOS
 */

let cachedPushToken: string | null = null;
let tokenPromise: Promise<string | null> | null = null;
let isInitialized = false;

// تكوين كيفية عرض الإشعارات
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * التحقق من أن الجهاز يدعم Push Notifications
 */
function isPushNotificationsSupported(): boolean {
  // Web لا يدعم Expo Push Notifications
  if (Platform.OS === 'web') {
    return false;
  }

  // Push Notifications يعمل على iOS و Android
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

/**
 * طلب أذونات الإشعارات من المستخدم
 */
async function requestPermissions(): Promise<boolean> {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    
    let finalStatus = existingStatus;
    
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
          allowCriticalAlerts: false,
          allowDisplayInCarPlay: false,
          provideAppNotificationSettings: false,
        },
      });
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.warn('[PushNotifications] Permission denied by user');
      return false;
    }

    // على Android، نحتاج إنشاء notification channel
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('mutabaka-messages', {
        name: 'رسائل مُتابَكة',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
        sound: 'default',
        enableVibrate: true,
        enableLights: true,
        showBadge: true,
      });
    }

    return true;
  } catch (error) {
    console.error('[PushNotifications] Error requesting permissions:', error);
    return false;
  }
}

/**
 * الحصول على FCM Push Token (Firebase Cloud Messaging)
 * يتم حفظه في cache لتجنب طلبات متكررة
 * يعمل في Production و Development
 */
export async function getExpoPushToken(): Promise<string | null> {
  // إذا كان موجود في cache، نرجعه مباشرة
  if (cachedPushToken) {
    return cachedPushToken;
  }

  // إذا كان هناك طلب جاري، ننتظره
  if (tokenPromise) {
    return tokenPromise;
  }

  tokenPromise = (async () => {
    try {
      console.log('[PushNotifications] 🔔 Starting FCM token registration...');
      
      // التحقق من الدعم
      if (!isPushNotificationsSupported()) {
        console.warn('[PushNotifications] ❌ Platform not supported:', Platform.OS);
        return null;
      }
      
      console.log('[PushNotifications] ✅ Platform supported:', Platform.OS);

      // طلب الأذونات من expo-notifications (للعرض)
      const hasPermission = await requestPermissions();
      if (!hasPermission) {
        console.warn('[PushNotifications] ❌ Permission denied');
        return null;
      }
      
      console.log('[PushNotifications] ✅ Permission granted');

      // طلب إذن Firebase (مطلوب لـ FCM)
      const authStatus = await messaging().requestPermission();
      const fcmEnabled =
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL;

      if (!fcmEnabled) {
        console.warn('[PushNotifications] ❌ FCM permission denied');
        return null;
      }

      console.log('[PushNotifications] ✅ FCM permission granted');

      // الحصول على FCM Token
      let token: string | null = null;
      try {
        console.log('[PushNotifications] 📱 Requesting FCM Token...');
        token = await messaging().getToken();
        console.log('[PushNotifications] ✅ FCM Token received successfully');
      } catch (error) {
        console.error('[PushNotifications] ❌ Failed to get FCM token:', error);
        return null;
      }

      if (!token || typeof token !== 'string') {
        console.error('[PushNotifications] Invalid token received');
        return null;
      }

      console.log('[PushNotifications] Token registered successfully:', token.substring(0, 20) + '...');
      
      // حفظ في cache
      cachedPushToken = token;
      return token;

    } catch (error) {
      console.error('[PushNotifications] ❌ Error getting FCM token:', error);
      return null;
    } finally {
      tokenPromise = null;
    }
  })();

  return tokenPromise;
}

/**
 * مسح cache التوكن (مفيد عند logout)
 */
export function clearCachedPushToken(): void {
  cachedPushToken = null;
  tokenPromise = null;
}

/**
 * معالج الإشعارات الواردة (عندما يكون التطبيق مفتوح)
 */
export type NotificationReceivedHandler = (notification: Notifications.Notification) => void;

/**
 * معالج التفاعل مع الإشعار (عند الضغط عليه)
 */
export type NotificationResponseHandler = (response: Notifications.NotificationResponse) => void;

/**
 * تهيئة معالجات الإشعارات
 */
export function setupNotificationHandlers(
  onNotificationReceived?: NotificationReceivedHandler,
  onNotificationTapped?: NotificationResponseHandler
): () => void {
  if (isInitialized) {
    console.warn('[PushNotifications] Handlers already initialized');
  }

  const subscriptions: Notifications.Subscription[] = [];

  // معالج الإشعارات الواردة (التطبيق مفتوح)
  if (onNotificationReceived) {
    const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
      console.log('[PushNotifications] Notification received:', notification.request.content.title);
      onNotificationReceived(notification);
    });
    subscriptions.push(receivedSubscription);
  }

  // معالج الضغط على الإشعار
  if (onNotificationTapped) {
    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      console.log('[PushNotifications] Notification tapped:', response.notification.request.content.title);
      onNotificationTapped(response);
    });
    subscriptions.push(responseSubscription);
  }

  isInitialized = true;

  // دالة لإلغاء الاشتراكات
  return () => {
    subscriptions.forEach((sub) => sub.remove());
    isInitialized = false;
  };
}

/**
 * الحصول على آخر إشعار تم الضغط عليه (عند فتح التطبيق)
 */
export async function getLastNotificationResponse(): Promise<Notifications.NotificationResponse | null> {
  try {
    return await Notifications.getLastNotificationResponseAsync();
  } catch (error) {
    console.error('[PushNotifications] Error getting last notification response:', error);
    return null;
  }
}

/**
 * التحقق من حالة الأذونات الحالية
 */
export async function checkPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    
    if (status === 'granted') {
      return 'granted';
    }
    
    const { canAskAgain } = await Notifications.getPermissionsAsync();
    if (!canAskAgain) {
      return 'denied';
    }
    
    return 'undetermined';
  } catch (error) {
    console.error('[PushNotifications] Error checking permission status:', error);
    return 'denied';
  }
}

/**
 * فتح إعدادات التطبيق في النظام (لتفعيل الإشعارات يدوياً)
 * يفتح صفحة إعدادات التطبيق مباشرة في إعدادات الجهاز
 */
export async function openNotificationSettings(): Promise<void> {
  try {
    await Linking.openSettings();
    console.log('[PushNotifications] Opened app settings');
  } catch (error) {
    console.error('[PushNotifications] Failed to open settings:', error);
    throw error;
  }
}
