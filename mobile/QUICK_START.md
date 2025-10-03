# 🚀 دليل البدء السريع - Push Notifications

## ⚡ 3 خطوات فقط للاختبار

### 1️⃣ شغّل التطبيق
```bash
cd mobile
npm start
# اضغط 'a' لـ Android أو 'i' لـ iOS
```

### 2️⃣ سجّل الدخول
- افتح التطبيق
- أدخل بيانات دخول صحيحة
- اضغط "تسجيل الدخول"
- **سيظهر طلب أذونات الإشعارات** → اضغط "السماح"

### 3️⃣ اختبر الإشعار
- من جهاز آخر (أو Web)، أرسل رسالة لحسابك
- **يجب أن يظهر إشعار على جهازك**
- اضغط على الإشعار
- **يجب أن ينتقل للمحادثة مباشرة**

---

## ✅ كيف أعرف أنه يعمل؟

### في Console عند Login:
```
[Login] Push token obtained successfully
[PushNotifications] Token registered successfully: ExponentPushToken[...
```

### في Django Admin:
```
UserDevice → افتح جهازك
push_token: ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]
```

### عند استقبال إشعار:
```
[App] Notification received: رسالة جديدة من أحمد
[App] Notification tapped: رسالة جديدة من أحمد
[App] Navigating to conversation: 123
```

---

## 🧪 اختبار يدوي سريع

### في Metro Bundler Console:
```javascript
// استورد أداة الاختبار
import { runAllTests } from './src/utils/testPushNotifications';

// شغّل الاختبارات
await runAllTests();

// النتيجة المتوقعة:
// ✅ Permission Status: granted
// ✅ Token Retrieved: YES
// ✅ All tests passed!
```

---

## 🔍 حل المشاكل السريع

### المشكلة: "لا يظهر طلب الأذونات"
**الحل:**
1. احذف التطبيق من الجهاز
2. أعد التثبيت
3. سجّل الدخول من جديد

### المشكلة: "الإشعار لا يصل"
**الحل:**
1. تحقق من Console: يجب أن ترى Token
2. تحقق من Django Admin: push_token يجب أن يكون موجوداً
3. تحقق من إعدادات الجهاز: الإشعارات مفعّلة للتطبيق
4. تأكد أنك على جهاز فعلي (ليس محاكي)

### المشكلة: "الإشعار يصل لكن لا ينتقل للمحادثة"
**الحل:**
1. تحقق من Console عند الضغط على الإشعار
2. يجب أن ترى: `[App] Navigating to conversation: X`
3. إذا لم ترَ → تحقق من data payload في الباك إند

---

## 📝 ملاحظات مهمة

### ✅ يعمل على:
- ✅ Android (فعلي أو محاكي)
- ✅ iOS (فعلي فقط - المحاكي محدود)

### ⚠️ لا يعمل على:
- ❌ Web (Expo Push Notifications للموبايل فقط)
- ❌ iOS Simulator (محدود - استخدم جهاز فعلي)

### 🔑 متطلبات:
- ✅ جهاز فعلي (مُفضّل)
- ✅ اتصال إنترنت
- ✅ أذونات الإشعارات من المستخدم

---

## 📚 مزيد من المعلومات

- **التوثيق الكامل:** `PUSH_NOTIFICATIONS_IMPLEMENTATION.md`
- **الملخص بالعربية:** `IMPLEMENTATION_SUMMARY_AR.md`
- **قائمة المراجعة:** `CHECKLIST.md`

---

## 🎉 كل شيء جاهز!

النظام يعمل بالكامل. فقط شغّل التطبيق وجرّب! 🚀
