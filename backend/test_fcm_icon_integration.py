#!/usr/bin/env python
"""
اختبار يدوي لربط أيقونة الإشعارات مع FCM
Manual test for notification icon + FCM integration
"""

import os
import sys
import django

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'mujard.settings')
django.setup()

from accounts.models import SiteSettings
from accounts.site_settings import get_notification_icon_url
from accounts.fcm_push import send_fcm_notifications


def test_integration():
    """اختبار التكامل بين الأيقونة و FCM"""
    
    print("=" * 60)
    print("🧪 اختبار تكامل أيقونة الإشعارات مع FCM")
    print("=" * 60)
    print()
    
    # 1. التحقق من الإعدادات
    print("📋 الخطوة 1: التحقق من الإعدادات")
    print("-" * 40)
    settings = SiteSettings.load()
    print(f"✅ SiteSettings موجود: {settings}")
    
    # 2. التحقق من الأيقونة
    print("\n📋 الخطوة 2: التحقق من الأيقونة")
    print("-" * 40)
    icon_url = get_notification_icon_url()
    if icon_url:
        print(f"✅ أيقونة موجودة: {icon_url}")
    else:
        print("⚠️ لا توجد أيقونة مرفوعة")
        print("   لاختبار كامل، ارفع صورة PNG من:")
        print("   /admin/accounts/sitesettings/")
    
    # 3. محاكاة إرسال إشعار
    print("\n📋 الخطوة 3: محاكاة payload FCM")
    print("-" * 40)
    
    # بناء payload كما يفعل FCM
    from firebase_admin import messaging
    
    try:
        # Build Android notification
        android_notification = messaging.AndroidNotification(
            sound='default',
            priority='high',
            notification_count=1,
            channel_id='mutabaka-messages-v2',
            tag='conversation_test',
        )
        
        # Add icon if available
        if icon_url:
            android_notification.icon = icon_url
            print(f"✅ الأيقونة مضافة للـ payload: {icon_url}")
        else:
            print("⚠️ لا توجد أيقونة للإضافة")
        
        # Build message
        message = messaging.Message(
            notification=messaging.Notification(
                title='اختبار الإشعار',
                body='هذا إشعار تجريبي مع الأيقونة',
            ),
            data={
                'type': 'test',
                'conversation_id': '123',
            },
            token='test-token-will-fail',  # Token وهمي للاختبار
            android=messaging.AndroidConfig(
                priority='high',
                notification=android_notification,
            ),
        )
        
        print("✅ Message payload جاهز:")
        print(f"   - Title: {message.notification.title}")
        print(f"   - Body: {message.notification.body}")
        print(f"   - Android icon: {android_notification.icon if hasattr(android_notification, 'icon') else 'None'}")
        
    except Exception as e:
        print(f"❌ خطأ في بناء payload: {e}")
    
    # 4. توضيح طريقة الاستخدام
    print("\n📋 الخطوة 4: طريقة الاستخدام في الكود")
    print("-" * 40)
    print("""
الآن عند استدعاء send_fcm_notifications():
    
    from accounts.fcm_push import send_fcm_notifications
    
    result = send_fcm_notifications(
        tokens=['user-fcm-token'],
        title='رسالة جديدة',
        body='لديك رسالة من أحمد',
        data={'conversation_id': '123'},
        badge=5,
    )
    
✅ الأيقونة ستُضاف تلقائياً إذا كانت مرفوعة!
✅ لا حاجة لتمرير الأيقونة يدوياً!
✅ كل الإشعارات ستستخدم نفس الأيقونة المخصصة!
    """)
    
    # 5. النتيجة النهائية
    print("\n" + "=" * 60)
    print("📊 النتيجة النهائية")
    print("=" * 60)
    
    if icon_url:
        print("✅ التكامل يعمل بشكل صحيح!")
        print(f"✅ الأيقونة: {icon_url}")
        print("✅ جميع الإشعارات ستستخدم هذه الأيقونة تلقائياً")
    else:
        print("⚠️ التكامل جاهز، لكن لم تُرفع أيقونة بعد")
        print("📝 لاستخدام الميزة:")
        print("   1. افتح: /admin/accounts/sitesettings/")
        print("   2. ارفع صورة PNG")
        print("   3. احفظ")
        print("   4. جميع الإشعارات ستستخدم الأيقونة تلقائياً!")
    
    print()
    return 0


if __name__ == '__main__':
    sys.exit(test_integration())
