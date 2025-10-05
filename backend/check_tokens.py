import sqlite3

conn = sqlite3.connect('db.sqlite3')
rows = conn.execute('''
    SELECT id, label, push_token 
    FROM accounts_userdevice 
    WHERE push_token IS NOT NULL AND push_token != ''
    ORDER BY last_seen_at DESC 
    LIMIT 5
''').fetchall()

print(f'\n✅ Found {len(rows)} devices with tokens:\n')
for i, (device_id, label, token) in enumerate(rows, 1):
    token_preview = token[:70] + '...' if len(token) > 70 else token
    token_type = 'FCM' if not token.startswith('ExponentPushToken') else 'Expo (OLD)'
    print(f'{i}. {label}')
    print(f'   Type: {token_type}')
    print(f'   Token: {token_preview}\n')

if not rows:
    print('❌ No tokens found in database yet!')
