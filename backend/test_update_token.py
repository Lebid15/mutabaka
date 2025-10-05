#!/usr/bin/env python3
"""
اختبار endpoint تحديث Push Token
"""

import os
import sys
import django

# Setup Django
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'mujard.settings')
django.setup()

from django.contrib.auth import get_user_model
from accounts.models import UserDevice
from rest_framework.test import APIClient

User = get_user_model()

print("\n" + "="*60)
print("🧪 اختبار endpoint: POST /api/auth/devices/update-token")
print("="*60)

# 1. إنشاء مستخدم تجريبي (أو استخدام موجود)
user = User.objects.filter(username='test_user').first()
if not user:
    user = User.objects.create_user(
        username='test_user',
        email='test@example.com',
        password='testpass123'
    )
    print(f"✅ تم إنشاء مستخدم: {user.username}")
else:
    print(f"✅ استخدام مستخدم موجود: {user.username}")

# 2. إنشاء جهاز تجريبي
device, created = UserDevice.objects.get_or_create(
    user=user,
    id='test-device-123',  # ✅ الحقل الصحيح
    defaults={
        'label': 'Test Device',
        'platform': 'android',
        'app_version': '1.0.0',
        'status': 'primary',
        'push_token': 'old-token-12345'
    }
)
if created:
    print(f"✅ تم إنشاء جهاز: {device.id}")
else:
    print(f"✅ استخدام جهاز موجود: {device.id}")
    device.push_token = 'old-token-12345'
    device.save()

print(f"   Token القديم: {device.push_token}")

# 3. إنشاء API client
client = APIClient()
client.force_authenticate(user=user)

# 4. محاكاة request من الجهاز
print("\n📤 إرسال طلب تحديث Token...")

# حقن device في request (middleware يفعل هذا عادةً)
from unittest.mock import Mock
from django.test import RequestFactory

# استخدام APIClient بشكل صحيح
response = client.post(
    '/api/auth/devices/update-token',
    data={'push_token': 'new-fcm-token-67890'},
    format='json',
    HTTP_X_DEVICE_ID='test-device-123'
)

print(f"\n📊 النتيجة:")
print(f"   Status Code: {response.status_code}")
print(f"   Response: {response.data}")

if response.status_code == 200:
    # تحديث من قاعدة البيانات
    device.refresh_from_db()
    print(f"\n✅ نجح!")
    print(f"   Token الجديد في DB: {device.push_token}")
    
    if device.push_token == 'new-fcm-token-67890':
        print("\n🎉 الاختبار نجح 100%!")
    else:
        print("\n❌ Token لم يتحدث في قاعدة البيانات!")
else:
    print(f"\n❌ فشل! الرمز: {response.status_code}")
    print(f"   التفاصيل: {response.data}")

# تنظيف (اختياري)
print("\n🧹 تنظيف...")
device.delete()
user.delete()
print("✅ تم التنظيف")
