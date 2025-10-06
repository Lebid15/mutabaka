import sqlite3
import os

db_path = '/srv/mutabaka/backend/db.sqlite3'

if not os.path.exists(db_path):
    print(f"❌ Database not found at: {db_path}")
    exit(1)

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

print("\n" + "="*70)
print("📱 فحص Push Tokens على السيرفر")
print("="*70)

query = """
SELECT 
    d.id,
    d.label,
    d.push_token,
    d.status,
    u.username
FROM accounts_userdevice d
JOIN accounts_customuser u ON d.user_id = u.id
WHERE d.push_token IS NOT NULL 
  AND d.push_token != ''
ORDER BY d.last_seen_at DESC
LIMIT 10
"""

rows = cursor.execute(query).fetchall()

print(f"\n✅ عدد الأجهزة مع Tokens: {len(rows)}\n")

for i, (device_id, label, token, status, username) in enumerate(rows, 1):
    is_fcm = not token.startswith('ExponentPushToken')
    token_type = "✅ FCM (جديد - يعمل!)" if is_fcm else "❌ Expo (قديم - لا يعمل)"
    
    print(f"{i}. {label or 'بدون اسم'}")
    print(f"   المستخدم: {username}")
    print(f"   Device ID: {device_id[:40]}...")
    print(f"   نوع Token: {token_type}")
    print(f"   Token: {token[:70]}...")
    print(f"   الحالة: {status}")
    print()

print("="*70)

conn.close()
