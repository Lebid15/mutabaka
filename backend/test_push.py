import os
import django
import requests

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'mujard.settings')
django.setup()

from accounts.models import UserDevice

# Get the token
devices = UserDevice.objects.all()
print(f"Total devices: {devices.count()}")
for dev in devices:
    print(f"  Device {dev.id}: label={dev.label}, status={dev.status}, push_token='{dev.push_token}'")

device = devices.filter(push_token__isnull=False).exclude(push_token='').first()
if not device:
    print("\nNo device with push token found! Exiting...")
    exit(1)

print(f"\nUsing device {device.id} with token: {device.push_token}")

# Send a test push directly to Expo
payload = {
    "to": device.push_token,
    "title": "اختبار Push",
    "body": "رسالة تجريبية",
    "priority": "high",
    "sound": "default"
}

response = requests.post(
    "https://exp.host/--/api/v2/push/send",
    json=[payload],
    headers={"Content-Type": "application/json"},
    timeout=10
)

print(f"\nStatus Code: {response.status_code}")
print(f"Response: {response.json()}")
