import django
import os

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'mujard.settings')
django.setup()

from accounts.models import UserDevice, CustomUser

# Find all users
users = CustomUser.objects.all()[:10]
print("\n=== All Users ===")
for u in users:
    print(f"- {u.username} (ID: {u.id})")

# Get web devices
devices = UserDevice.objects.filter(
    is_web=True
).order_by('-created_at')[:5]

print("\n=== Recent Web Devices ===\n")
for d in devices:
    fp = d.device_fingerprint[:16] if d.device_fingerprint else "None"
    stored_id = d.stored_device_id[:16] if d.stored_device_id else "None"
    print(f"Device ID: {d.id}")
    print(f"  User: {d.user.username if d.user else 'None'}")
    print(f"  Fingerprint: {fp}...")
    print(f"  Stored ID: {stored_id}...")
    print(f"  Created: {d.created_at}")
    print(f"  App Version: {d.app_version}")
    print()
