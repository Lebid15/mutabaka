import os, django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'mujard.settings')
django.setup()

from django.contrib.auth import get_user_model
from accounts.models import UserDevice

User = get_user_model()
users = User.objects.all().order_by('id')

print('All users in database:')
print('='*80)
for u in users:
    devices = UserDevice.objects.filter(user=u)
    print(f'\nID: {u.id}')
    print(f'Username: {u.username}')
    print(f'Display Name: {getattr(u, "display_name", "N/A")}')
    print(f'Devices: {devices.count()}')
    
    for d in devices:
        if d.push_token:
            print(f'  - Device {d.id[:20]}... has Token: {d.push_token[:30]}...')
