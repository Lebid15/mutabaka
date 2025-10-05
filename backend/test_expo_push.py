#!/usr/bin/env python3
"""
اختبار Expo Push API مباشرة
"""

import os
import sys
import django
import requests

# Setup Django
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'mujard.settings')
django.setup()

from accounts.models import UserDevice

# الحصول على token
device = UserDevice.objects.filter(
    status__in=['primary', 'active']
).exclude(push_token='').exclude(push_token__isnull=True).first()

if not device:
    print("❌ لا يوجد جهاز للاختبار")
    sys.exit(1)

print(f"🎯 اختبار Expo Push API")
print(f"   • Token: {device.push_token[:40]}...")
print(f"   • المستخدم: {device.user.username}")

# إرسال مباشر عبر Expo API
url = "https://exp.host/--/api/v2/push/send"
payload = {
    "to": device.push_token,
    "title": "🎉 اختبار Expo API",
    "body": f"مرحباً {device.user.username}! الإشعارات تعمل ✅",
    "data": {"type": "test"},
    "priority": "high",
    "sound": "default",
}

print("\n📤 جاري الإرسال عبر Expo Push API...")

try:
    response = requests.post(url, json=payload, timeout=10)
    response.raise_for_status()
    result = response.json()
    
    print(f"\n✅ تم الإرسال!")
    print(f"📊 النتيجة: {result}")
    
    if isinstance(result, dict) and 'data' in result:
        data = result['data']
        if isinstance(data, list) and len(data) > 0:
            first = data[0]
            if first.get('status') == 'ok':
                print("\n🎉 نجح! تحقق من جوالك الآن!")
            else:
                print(f"\n⚠️ حالة غير متوقعة: {first}")
    
except Exception as e:
    print(f"\n❌ خطأ: {e}")
    import traceback
    traceback.print_exc()
