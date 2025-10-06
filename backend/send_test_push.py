#!/usr/bin/env python
"""
Send a test FCM push notification to a specific user
"""
import os
import sys
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'mujard.settings')
django.setup()

from accounts.push import PushMessage, send_push_messages
from accounts.models import UserDevice

def send_test_push(username, title="اختبار", body="رسالة تجريبية"):
    """Send test push to user"""
    from django.contrib.auth import get_user_model
    User = get_user_model()
    
    try:
        user = User.objects.get(username=username)
    except User.DoesNotExist:
        print(f"❌ User '{username}' not found")
        return
    
    print(f"👤 User: {user.username} (ID: {user.id})")
    print(f"   Display Name: {getattr(user, 'display_name', 'N/A')}")
    
    # Get all active devices with push tokens
    devices = UserDevice.objects.filter(
        user=user,
        status__in=['primary', 'active']
    ).exclude(push_token='')
    
    if not devices.exists():
        print(f"❌ No devices with push tokens found for user {username}")
        return
    
    print(f"\n📱 Found {devices.count()} device(s) with push tokens:")
    
    push_batch = []
    for device in devices:
        token = device.push_token
        print(f"\n   Device: {device.id[:20]}...")
        print(f"   Platform: {device.platform}")
        print(f"   Token: {token[:30]}...")
        
        push_batch.append(
            PushMessage(
                to=token,
                title=title,
                body=body,
                data={
                    'type': 'test',
                    'test': True,
                },
                badge=1,
            )
        )
    
    if push_batch:
        print(f"\n🚀 Sending {len(push_batch)} push notification(s)...")
        try:
            send_push_messages(push_batch)
            print("✅ Push notifications sent successfully!")
        except Exception as e:
            print(f"❌ Failed to send push notifications: {e}")
    else:
        print("❌ No push messages to send")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python send_test_push.py <username> [title] [body]")
        sys.exit(1)
    
    username = sys.argv[1]
    title = sys.argv[2] if len(sys.argv) > 2 else "اختبار 🔔"
    body = sys.argv[3] if len(sys.argv) > 3 else "رسالة تجريبية من السيرفر"
    
    send_test_push(username, title, body)
