#!/usr/bin/env python3
"""
فحص Tokens على السيرفر
"""

import os
import sys
import django

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'mujard.settings')
django.setup()

from accounts.models import UserDevice

print("\n" + "="*70)
print("📱 فحص Push Tokens على السيرفر")
print("="*70)

# الحصول على الأجهزة التي لديها tokens
devices_with_tokens = UserDevice.objects.exclude(
    push_token=''
).exclude(
    push_token__isnull=True
).order_by('-last_seen_at')[:10]

print(f"\n✅ عدد الأجهزة التي لديها Push Tokens: {devices_with_tokens.count()}\n")

for i, device in enumerate(devices_with_tokens, 1):
    # تحديد نوع الـ Token
    if device.push_token.startswith('ExponentPushToken'):
        token_type = "❌ Expo (قديم - لا يعمل)"
        token_preview = device.push_token[:50]
    else:
        token_type = "✅ FCM (جديد - يعمل!)"
        token_preview = device.push_token[:60]
    
    print(f"{i}. {device.label or 'بدون اسم'}")
    print(f"   المستخدم: {device.user.username}")
    print(f"   Device ID: {device.id[:40]}...")
    print(f"   نوع Token: {token_type}")
    print(f"   Token: {token_preview}...")
    print(f"   الحالة: {device.status}")
    print(f"   آخر ظهور: {device.last_seen_at or 'لم يسجل بعد'}")
    print()

print("="*70)
