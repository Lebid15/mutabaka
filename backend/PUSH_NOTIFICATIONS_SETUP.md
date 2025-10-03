# 🔔 Push Notifications Setup Guide

## المشكلة الحالية
لا يمكن إرسال Push Notifications لأن Firebase Cloud Messaging API (Legacy) معطل.

## ✅ الحل: تفعيل FCM Legacy API

### الخطوة 1: تفعيل Cloud Messaging API (Legacy)

يوجد طريقتان:

#### الطريقة الأولى (السريعة):
1. في صفحة **Cloud Messaging** التي أنت فيها
2. انقر على النقاط الثلاث (⋮) بجانب **"Cloud Messaging API (Legacy)"**
3. اختر **"Enable"** أو **"تفعيل"**

#### الطريقة الثانية (إذا لم تظهر خيار Enable):
1. اذهب إلى Google Cloud Console: https://console.cloud.google.com/
2. اختر مشروع `mutabaka-94ff1`
3. من القائمة الجانبية: **APIs & Services** → **Library**
4. ابحث عن: **"Firebase Cloud Messaging API"**
5. انقر على النتيجة الأولى
6. انقر على زر **"Enable"**
7. انتظر بضع ثواني حتى يتم التفعيل

---

### الخطوة 2: الحصول على Server Key

بعد التفعيل:

1. ارجع إلى Firebase Console → **Project Settings** → **Cloud Messaging**
2. في قسم **"Cloud Messaging API (Legacy)"**
3. ستجد حقل **"Server key"**
4. انقر على أيقونة النسخ لنسخ المفتاح

---

### الخطوة 3: إضافة Server Key إلى Backend

1. افتح ملف `.env` في مجلد `backend` (أو أنشئه إذا لم يكن موجوداً)

2. أضف السطر التالي:
```bash
EXPO_FCM_SERVER_KEY=YOUR_SERVER_KEY_HERE
```

3. استبدل `YOUR_SERVER_KEY_HERE` بالـ Server Key الذي نسخته

**مثال:**
```bash
EXPO_FCM_SERVER_KEY=AAAAxxx...your-actual-key...xxxxx
```

---

### الخطوة 4: إعادة تشغيل Django Server

```bash
# أوقف السيرفر (Ctrl+C)
# ثم شغله من جديد
cd f:\mtk\backend
python manage.py runserver
```

---

### الخطوة 5: اختبار الإشعارات

بعد إضافة الـ Server Key وإعادة تشغيل السيرفر:

```bash
cd f:\mtk\backend
python send_test_notification.py
```

**المفروض تشوف:**
```
✅ Status Code: 200
📨 Response: {'data': [{'status': 'ok', 'id': 'xxxx-xxxx-xxxx'}]}
🎉 Push notification sent successfully!
```

وسيظهر الإشعار في شريط الإشعارات في هاتف Android! 🔔

---

## 🔍 استكشاف الأخطاء

### إذا ظهر خطأ "InvalidCredentials":
- تأكد من أن Server Key صحيح
- تأكد من أن ملف `.env` في مجلد `backend` مباشرة
- تأكد من أنك أعدت تشغيل Django server

### إذا ظهر خطأ "DeviceNotRegistered":
- تأكد من أن الجهاز مفعّل (status='active')
- تأكد من أن push_token موجود في قاعدة البيانات

### إذا لم يظهر الإشعار على الهاتف:
- تأكد من أن التطبيق مفتوح أو في الخلفية
- تأكد من أن أذونات الإشعارات ممنوحة
- جرب إغلاق التطبيق تماماً ثم فتحه مرة أخرى

---

## 📱 معلومات الجهاز الحالي

- **Device ID**: `AEE6hLAcNwJ71HZHxX9JSfz1kQ4BgtmU`
- **Push Token**: `ExponentPushToken[3Mbdk6NAXHzhbC9MN-6bHj]`
- **Status**: `active` ✅
- **User**: `leibd`

---

## 🎯 الخطوات التالية (بعد نجاح الاختبار)

1. ✅ اختبار الإشعار اليدوي (test_push.py)
2. ✅ اختبار إرسال رسالة من مستخدم آخر
3. ✅ التأكد من أن الإشعار يظهر عند استلام رسالة جديدة
4. ✅ اختبار Navigation عند الضغط على الإشعار
5. ✅ اختبار الإشعارات مع التطبيق في الخلفية
6. ✅ اختبار الإشعارات مع التطبيق مغلق تماماً

---

## 🔒 ملاحظة أمنية

**لا تضف الـ Server Key إلى Git!**

تأكد من أن `.env` موجود في `.gitignore`:

```bash
# في ملف .gitignore
.env
*.env
```

---

## 📚 مصادر إضافية

- [Expo Push Notifications Docs](https://docs.expo.dev/push-notifications/overview/)
- [Firebase Cloud Messaging](https://firebase.google.com/docs/cloud-messaging)
- [Expo FCM Setup Guide](https://docs.expo.dev/push-notifications/fcm/)
