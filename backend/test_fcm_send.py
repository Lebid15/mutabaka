#!/usr/bin/env python
"""
Test FCM push notification sending with actual token from database
"""

import os
import sys
import django

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'mujard.settings')
django.setup()

from accounts.models import UserDevice
from accounts.fcm_push import send_fcm_notifications

def test_fcm_push():
    print("\n🧪 Testing FCM Push Notification...")
    print("=" * 60)
    
    # Get a device with FCM token
    device = UserDevice.objects.filter(
        push_token__isnull=False
    ).exclude(
        push_token__exact=''
    ).exclude(
        push_token__startswith='ExponentPushToken'
    ).first()
    
    if not device:
        print("❌ No device with FCM token found!")
        return
    
    print(f"✅ Found device: {device.id}")
    print(f"   User: {device.user.username}")
    print(f"   Token: {device.push_token[:20]}...")
    
    # Send test notification
    print("\n📤 Sending test notification...")
    result = send_fcm_notifications(
        tokens=[device.push_token],
        title="اختبار الإشعارات",
        body="هذا إشعار تجريبي من النظام 🎉",
        data={
            'type': 'test',
            'conversation_id': '123',
            'message_id': '456'
        },
        badge=5
    )
    
    print("\n📊 Results:")
    print(f"   Success: {result['success']}")
    print(f"   Failure: {result['failure']}")
    if result.get('errors'):
        print(f"   Errors: {result['errors']}")
    if result.get('invalid_tokens'):
        print(f"   Invalid tokens: {len(result['invalid_tokens'])}")
    
    if result['success'] > 0:
        print("\n✅ Test notification sent successfully!")
        print("   Check your Android device for the notification.")
    else:
        print("\n❌ Failed to send notification!")
        print(f"   Errors: {result.get('errors', [])}")

if __name__ == '__main__':
    test_fcm_push()
