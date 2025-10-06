#!/usr/bin/env python
"""
Check if user has FCM push tokens registered in the database
"""
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'mujard.settings')
django.setup()

from accounts.models import UserDevice

def check_tokens(username=None):
    """Check tokens for a specific user or all users"""
    from django.contrib.auth import get_user_model
    User = get_user_model()
    
    if username:
        try:
            user = User.objects.get(username=username)
            users = [user]
            print(f"🔍 Checking tokens for user: {username}")
        except User.DoesNotExist:
            print(f"❌ User '{username}' not found")
            return
    else:
        users = User.objects.all()
        print(f"🔍 Checking tokens for all users ({users.count()} users)")
    
    print("\n" + "="*80)
    
    for user in users:
        devices = UserDevice.objects.filter(user=user)
        print(f"\n👤 User: {user.username} (ID: {user.id})")
        print(f"   Display Name: {getattr(user, 'display_name', 'N/A')}")
        print(f"   Total Devices: {devices.count()}")
        
        if devices.exists():
            for i, device in enumerate(devices, 1):
                print(f"\n   📱 Device #{i}:")
                print(f"      ID: {device.id}")
                print(f"      Push Token: {device.push_token[:50] if device.push_token else 'NONE'}...")
                print(f"      Platform: {device.platform or 'N/A'}")
                print(f"      Status: {device.status}")
                print(f"      Is Web: {device.is_web}")
                print(f"      Last Seen: {device.last_seen_at or 'Never'}")
                print(f"      Created: {device.created_at}")
        else:
            print(f"   ⚠️ No devices registered")
    
    print("\n" + "="*80)

if __name__ == '__main__':
    import sys
    username = sys.argv[1] if len(sys.argv) > 1 else None
    check_tokens(username)
