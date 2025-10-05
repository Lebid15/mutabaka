#!/usr/bin/env python3
"""
🧪 اختبار سريع لنظام الإشعارات - مطابقة
يختبر: Firebase، Push Token، إرسال إشعار اختباري
"""

import os
import sys
import django

# Setup Django
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'mujard.settings')
django.setup()

from accounts.models import UserDevice
from accounts.fcm_push import send_fcm_notifications
from django.contrib.auth import get_user_model

User = get_user_model()


def test_firebase_initialization():
    """اختبار 1: التحقق من Firebase"""
    print("\n" + "="*60)
    print("🔥 اختبار 1: تهيئة Firebase Admin SDK")
    print("="*60)
    
    try:
        from accounts.fcm_push import _initialize_firebase
        app = _initialize_firebase()
        
        if app:
            print("✅ Firebase Admin SDK تم تهيئته بنجاح!")
            return True
        else:
            print("❌ فشل تهيئة Firebase Admin SDK")
            print("💡 تأكد من وجود ملف firebase-service-account.json")
            return False
    except Exception as e:
        print(f"❌ خطأ: {e}")
        return False


def test_device_tokens():
    """اختبار 2: التحقق من Push Tokens في قاعدة البيانات"""
    print("\n" + "="*60)
    print("📱 اختبار 2: Push Tokens في قاعدة البيانات")
    print("="*60)
    
    # عدد الأجهزة النشطة
    active_devices = UserDevice.objects.filter(
        status__in=['primary', 'active']
    ).exclude(push_token='')
    
    print(f"\n📊 الإحصائيات:")
    print(f"   • إجمالي الأجهزة النشطة: {active_devices.count()}")
    
    devices_with_token = active_devices.exclude(push_token__isnull=True)
    print(f"   • الأجهزة التي لديها Push Token: {devices_with_token.count()}")
    
    if devices_with_token.count() > 0:
        print(f"\n✅ يوجد {devices_with_token.count()} جهاز جاهز لاستقبال الإشعارات!")
        
        print("\n📋 أمثلة على الأجهزة:")
        for device in devices_with_token[:5]:
            token_preview = device.push_token[:30] + "..." if device.push_token else "لا يوجد"
            print(f"   • {device.label}: {token_preview}")
            print(f"     المستخدم: {device.user.username}, الحالة: {device.status}")
        
        return True
    else:
        print("\n⚠️ لا توجد أجهزة لديها Push Token حالياً")
        print("💡 سجل دخول من التطبيق ووافق على الإشعارات")
        return False


def test_send_notification():
    """اختبار 3: إرسال إشعار تجريبي"""
    print("\n" + "="*60)
    print("📤 اختبار 3: إرسال إشعار تجريبي")
    print("="*60)
    
    # البحث عن جهاز للاختبار
    test_device = UserDevice.objects.filter(
        status__in=['primary', 'active']
    ).exclude(push_token='').exclude(push_token__isnull=True).first()
    
    if not test_device:
        print("❌ لا يوجد جهاز للاختبار")
        print("💡 سجل دخول من التطبيق أولاً")
        return False
    
    print(f"\n🎯 سيتم إرسال إشعار اختباري إلى:")
    print(f"   • الجهاز: {test_device.label}")
    print(f"   • المستخدم: {test_device.user.username}")
    print(f"   • Token: {test_device.push_token[:30]}...")
    
    # طلب تأكيد
    confirm = input("\n❓ هل تريد إرسال الإشعار؟ (y/n): ").strip().lower()
    
    if confirm != 'y':
        print("⏭️ تم التخطي")
        return False
    
    try:
        print("\n📤 جاري إرسال الإشعار...")
        
        results = send_fcm_notifications(
            tokens=[test_device.push_token],
            title="🎉 اختبار الإشعارات",
            body=f"مرحباً {test_device.user.username}! الإشعارات تعمل بنجاح ✅",
            data={
                "type": "test",
                "test_message": "This is a test notification",
                "timestamp": str(django.utils.timezone.now()),
            }
        )
        
        print(f"\n📊 النتائج:")
        print(f"   • نجح: {results.get('success', 0)}")
        print(f"   • فشل: {results.get('failure', 0)}")
        
        if results.get('errors'):
            print(f"\n❌ الأخطاء:")
            for error in results['errors']:
                print(f"   • {error}")
        
        if results.get('success', 0) > 0:
            print("\n✅ تم إرسال الإشعار بنجاح!")
            print("💡 تحقق من جوالك الآن!")
            return True
        else:
            print("\n❌ فشل إرسال الإشعار")
            return False
            
    except Exception as e:
        print(f"\n❌ خطأ أثناء الإرسال: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_all():
    """تشغيل جميع الاختبارات"""
    print("\n" + "🧪"*30)
    print("    🔔 اختبار شامل لنظام الإشعارات - مطابقة")
    print("🧪"*30)
    
    results = {
        'firebase': test_firebase_initialization(),
        'tokens': test_device_tokens(),
    }
    
    # إرسال إشعار اختباري فقط إذا كانت الاختبارات السابقة ناجحة
    if results['firebase'] and results['tokens']:
        results['send'] = test_send_notification()
    else:
        results['send'] = False
        print("\n⏭️ تخطي اختبار الإرسال بسبب فشل الاختبارات السابقة")
    
    # النتيجة النهائية
    print("\n" + "="*60)
    print("📊 النتيجة النهائية")
    print("="*60)
    
    print(f"\n✅ Firebase: {'نجح' if results['firebase'] else '❌ فشل'}")
    print(f"✅ Push Tokens: {'نجح' if results['tokens'] else '❌ فشل'}")
    print(f"✅ إرسال إشعار: {'نجح' if results['send'] else '❌ فشل أو تم التخطي'}")
    
    all_passed = all(results.values())
    
    if all_passed:
        print("\n" + "🎉"*30)
        print("    ✅ جميع الاختبارات نجحت! النظام يعمل بشكل ممتاز!")
        print("🎉"*30)
    else:
        print("\n⚠️ بعض الاختبارات فشلت. راجع التفاصيل أعلاه.")
        print("\n💡 نصائح:")
        if not results['firebase']:
            print("   • تأكد من وجود firebase-service-account.json")
            print("   • تأكد من صلاحية الملف")
        if not results['tokens']:
            print("   • سجل دخول من التطبيق (Mobile)")
            print("   • وافق على الإشعارات عند السؤال")


if __name__ == '__main__':
    test_all()
