# إعداد Firebase Cloud Messaging للـ Push Notifications

## المرحلة 1: إنشاء مشروع Firebase (5 دقائق)

### 1. اذهب إلى Firebase Console:
👉 https://console.firebase.google.com/

### 2. اضغط "Add project" أو "إنشاء مشروع"

### 3. أدخل اسم المشروع:
```
mutabaka
```

### 4. تعطيل Google Analytics (اختياري):
- يمكنك تعطيله للتسريع
- أو تفعيله إذا تريد إحصائيات

### 5. اضغط "Create project"

---

## المرحلة 2: إضافة تطبيق Android (3 دقائق)

### 1. في صفحة المشروع، اضغط على أيقونة Android

### 2. أدخل Package Name:
```
com.lebid15.mutabaka
```

**⚠️ مهم جداً:** Package name يجب أن يطابق ما في `app.json`

### 3. App nickname (اختياري):
```
Mutabaka Mobile
```

### 4. اترك SHA-1 فارغاً (غير مطلوب للـ Push Notifications)

### 5. اضغط "Register app"

---

## المرحلة 3: تحميل google-services.json (2 دقائق)

### 1. اضغط "Download google-services.json"

### 2. احفظ الملف في:
```
F:\mtk\mobile\google-services.json
```

**⚠️ يجب أن يكون في نفس مجلد `app.json`**

### 3. اضغط "Next" → "Next" → "Continue to console"

---

## المرحلة 4: تفعيل Cloud Messaging API (2 دقائق)

### 1. في Firebase Console، اذهب إلى:
```
Project Settings (⚙️) → Cloud Messaging
```

### 2. انسخ **Server Key** (سنحتاجه لاحقاً)

### 3. تأكد أن **Cloud Messaging API** مفعّل:
- إذا ظهر زر "Enable", اضغط عليه
- إذا كان مفعّلاً بالفعل، ستجد "Enabled" ✅

---

## المرحلة 5: إعداد Expo لاستخدام FCM (3 دقائق)

### 1. افتح `app.json` وأضف:

```json
{
  "expo": {
    "android": {
      "package": "com.lebid15.mutabaka",
      "googleServicesFile": "./google-services.json"
    },
    "plugins": [
      [
        "expo-notifications",
        {
          "icon": "./assets/icon.png",
          "color": "#ffffff",
          "sounds": []
        }
      ]
    ]
  }
}
```

### 2. تأكد أن `google-services.json` موجود في:
```
F:\mtk\mobile\google-services.json
```

### 3. في Terminal:
```bash
cd f:\mtk\mobile
npm run android
```

---

## المرحلة 6: اختبار Push Notifications

### 1. سجل دخول في التطبيق

### 2. وافق على أذونات الإشعارات

### 3. في Metro Bundler Console، ابحث عن:
```
[Login] ✅ Push token obtained successfully: ExponentPushToken[xxxxx]
```

### 4. في Django Shell:
```python
from accounts.models import UserDevice
from communications.push import send_message_push

device = UserDevice.objects.filter(push_token__isnull=False).first()

if device:
    print(f"✅ Device: {device.device_name}")
    print(f"✅ Token: {device.push_token[:50]}...")
    
    result = send_message_push(
        recipient=device.user,
        sender_name="Firebase Test",
        conversation_id=1,
        message_text="🔥 Firebase Push Notification تعمل الآن!"
    )
    print(f"📩 Result: {result}")
```

### 5. يجب أن يظهر إشعار في المحاكي! 🔔

---

## ✅ تأكيد النجاح:

- [ ] مشروع Firebase تم إنشاؤه
- [ ] `google-services.json` تم تحميله
- [ ] الملف موضوع في `mobile/google-services.json`
- [ ] `app.json` تم تحديثه
- [ ] التطبيق يعمل بدون أخطاء
- [ ] Push Token يظهر في Console
- [ ] Push Token يُحفظ في Database
- [ ] الإشعار يصل للمحاكي

---

## 🐛 استكشاف الأخطاء:

### خطأ: "Default FirebaseApp is not initialized"
**الحل:** تأكد أن `google-services.json` في المكان الصحيح

### خطأ: "Package name mismatch"
**الحل:** تأكد أن Package name في Firebase = Package name في `app.json`

### خطأ: "Cloud Messaging API disabled"
**الحل:** فعّل Cloud Messaging API من Firebase Console

---

## 📚 مصادر إضافية:

- [Expo Push Notifications with FCM](https://docs.expo.dev/push-notifications/fcm-credentials/)
- [Firebase Cloud Messaging](https://firebase.google.com/docs/cloud-messaging)
- [Expo Notifications API](https://docs.expo.dev/versions/latest/sdk/notifications/)
