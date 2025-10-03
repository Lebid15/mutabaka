"""
Quick test script for Firebase Admin SDK Push Notifications
Run this after placing firebase-service-account.json in backend folder
"""

import os
import django

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'mujard.settings')
django.setup()

from accounts.models import UserDevice
from accounts.fcm_push import send_fcm_multicast

print("🔍 Searching for devices with push tokens...")

# Get devices with push tokens
devices = UserDevice.objects.filter(
    status__in=['active', 'primary']
).exclude(push_token='')

print(f"📱 Found {devices.count()} active devices with push tokens\n")

if not devices.exists():
    print("❌ No active devices found with push tokens!")
    print("\nMake sure:")
    print("1. Device is activated (status='active' or 'primary')")
    print("2. Push token is saved in database")
    exit(1)

# Get first device
device = devices.first()
print(f"✅ Using device: {device.label}")
print(f"   User: {device.user.username}")
print(f"   Token: {device.push_token}\n")

# Send test notification
print("📤 Sending test notification via Firebase Admin SDK...\n")

try:
    results = send_fcm_multicast(
        tokens=[device.push_token],
        title="🎉 اختبار Firebase!",
        body="مرحباً! الإشعارات تعمل بنجاح عبر Firebase Admin SDK",
        data={
            "type": "test",
            "message": "Firebase FCM V1 API works!"
        }
    )
    
    print("📊 Results:")
    print(f"   ✅ Success: {results['success']}")
    print(f"   ❌ Failure: {results['failure']}")
    
    if results['success'] > 0:
        print("\n🎊 SUCCESS! Check your Android device notification bar!")
    else:
        print(f"\n❌ Failed to send. Errors: {results.get('errors', [])}")
        
except Exception as e:
    print(f"\n❌ Error: {e}")
    print("\nMake sure:")
    print("1. firebase-service-account.json is in the backend folder")
    print("2. The JSON file is valid and from the correct Firebase project")
    print("3. Firebase Cloud Messaging API (V1) is enabled")
