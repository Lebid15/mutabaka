"""
Test sending push notification using Expo's push notification tool
"""
import requests

# Your device's push token
PUSH_TOKEN = "ExponentPushToken[3Mbdk6NAXHzhbC9MN-6bHj]"

# Expo push notification endpoint
url = "https://exp.host/--/api/v2/push/send"

# Notification payload
payload = {
    "to": PUSH_TOKEN,
    "title": "🔔 اختبار الإشعارات",
    "body": "مرحباً! هذا إشعار تجريبي من mutabaka",
    "sound": "default",
    "priority": "high",
    "data": {
        "type": "test",
        "message": "هذا اختبار"
    }
}

print(f"📤 Sending push notification to: {PUSH_TOKEN}")
print(f"📍 URL: {url}")
print(f"📦 Payload: {payload}\n")

response = requests.post(
    url,
    json=[payload],
    headers={"Content-Type": "application/json"},
    timeout=10
)

print(f"✅ Status Code: {response.status_code}")
print(f"📨 Response: {response.json()}")

if response.status_code == 200:
    data = response.json().get('data', [])
    if data and data[0].get('status') == 'ok':
        print("\n🎉 Push notification sent successfully!")
        print("Check your Android device notification bar!")
    else:
        print(f"\n❌ Error: {data}")
else:
    print(f"\n❌ HTTP Error: {response.status_code}")
