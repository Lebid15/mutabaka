import { useEffect } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { setupNotificationHandlers, getLastNotificationResponse } from '../lib/pushNotifications';
import { setAppBadgeCount } from '../lib/appBadge';
import type { RootStackParamList } from '../navigation';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

/**
 * Hook لإعداد معالجات الإشعارات في التطبيق
 * - يستمع للإشعارات الواردة
 * - يعالج الضغط على الإشعارات
 * - ينتقل للمحادثة المناسبة
 */
export function useNotificationHandlers() {
  // نحاول الحصول على navigation بطريقة آمنة
  let navigation: Navigation | null = null;
  try {
    navigation = useNavigation<Navigation>();
  } catch (error) {
    // إذا لم يكن Navigation جاهزاً، نتجاهل الخطأ
    console.warn('[useNotificationHandlers] Navigation not ready yet');
    return;
  }

  useEffect(() => {
    // تأكد أن navigation موجود
    if (!navigation) {
      console.warn('[useNotificationHandlers] Navigation is null, skipping setup');
      return;
    }

    let pendingConversationId: string | null = null;

    // معالج الإشعارات الواردة (عندما يكون التطبيق مفتوح)
    const handleNotificationReceived = (notification: Notifications.Notification) => {
      console.log('[App] 📨 Notification received:', notification.request.content.title);
      
      // تحديث badge count إذا كان موجوداً في data
      const data = notification.request.content.data;
      if (data && typeof data === 'object' && 'unread_count' in data) {
        const unreadCount = Number(data.unread_count);
        if (!isNaN(unreadCount) && unreadCount >= 0) {
          console.log('[App] 🔢 Updating badge to:', unreadCount);
          setAppBadgeCount(unreadCount).catch((error: unknown) => {
            console.error('[App] Failed to update badge count:', error);
          });
        }
      }
    };

    // معالج الضغط على الإشعار
    const handleNotificationTapped = (response: Notifications.NotificationResponse) => {
      console.log('[App] 🔔 Notification tapped:', response.notification.request.content.title);
      
      const data = response.notification.request.content.data;
      
      if (!data || typeof data !== 'object') {
        console.warn('[App] ⚠️ No data in notification');
        return;
      }

      // التنقل للمحادثة إذا كان الإشعار من رسالة
      if ('type' in data && data.type === 'message' && 'conversation_id' in data) {
        const conversationId = String(data.conversation_id);
        
        if (conversationId && conversationId !== '0' && navigation) {
          console.log('[App] 🧭 Navigation requested for conversation:', conversationId);
          
          try {
            navigation.navigate('Chat', { conversationId });
            console.log('[App] ✅ Navigation successful');
          } catch (error) {
            console.warn('[App] ⚠️ Navigation failed, will retry after delay:', error);
            pendingConversationId = conversationId;
            
            setTimeout(() => {
              if (pendingConversationId && navigation) {
                try {
                  console.log('[App] 🔄 Retrying navigation to conversation:', pendingConversationId);
                  navigation.navigate('Chat', { conversationId: pendingConversationId });
                  console.log('[App] ✅ Retry successful');
                  pendingConversationId = null;
                } catch (retryError) {
                  console.error('[App] ❌ Retry failed:', retryError);
                }
              }
            }, 2000);
          }
        }
      }
    };

    // تسجيل المعالجات
    const cleanup = setupNotificationHandlers(
      handleNotificationReceived,
      handleNotificationTapped
    );

    // التحقق من آخر إشعار تم الضغط عليه (عند فتح التطبيق)
    const timeoutId = setTimeout(() => {
      getLastNotificationResponse()
        .then((lastResponse) => {
          if (lastResponse) {
            console.log('[App] 📱 Last notification response found, handling...');
            handleNotificationTapped(lastResponse);
          }
        })
        .catch((error) => {
          console.error('[App] ❌ Error getting last notification response:', error);
        });
    }, 1000);

    // إلغاء التسجيل عند unmount
    return () => {
      clearTimeout(timeoutId);
      cleanup();
    };
  }, [navigation]);
}
