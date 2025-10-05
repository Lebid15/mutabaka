# 🔔 دليل الإشعارات الشامل - مطابقة

## ✅ ما تم تطبيقه بالكامل

### 1️⃣ **النظام الأساسي للإشعارات**

#### Frontend (Mobile App):
- ✅ طلب أذونات الإشعارات
- ✅ الحصول على Expo Push Token
- ✅ إرسال Token للسيرفر عند Login
- ✅ عرض الإشعارات في شريط الإشعارات
- ✅ عرض Badge (الرقم) على أيقونة التطبيق
- ✅ معالجة الإشعارات عند الضغط عليها

#### Backend (Django):
- ✅ حفظ Push Token في قاعدة البيانات
- ✅ Firebase Admin SDK مُهيّأ ويعمل
- ✅ Expo Push API كنظام احتياطي
- ✅ إرسال إشعارات عند وصول رسائل جديدة
- ✅ حساب Badge Count (عدد الرسائل غير المقروءة)

---

### 2️⃣ **الميزات الجديدة (تم تطبيقها الآن)**

#### أ) قسم إدارة الإشعارات في صفحة الإعدادات
- ✅ عرض حالة الإشعارات (مفعّلة / معطّلة)
- ✅ زر "تفعيل الإشعارات" مع أيقونة جرس
- ✅ فتح إعدادات الجهاز مباشرة
- ✅ رسائل توجيهية واضحة بالعربية

#### ب) تحديث Push Token تلقائياً
- ✅ عند تفعيل الإشعارات من صفحة الإعدادات
- ✅ عند العودة للتطبيق (إذا تم تفعيل الإشعارات من إعدادات الجهاز)
- ✅ API جديد في Backend: `/api/auth/devices/update-token`

#### ج) فحص ذكي للأذونات
- ✅ فحص تلقائي عند فتح التطبيق
- ✅ فحص عند العودة للتطبيق من الخلفية
- ✅ تحديث Token فقط عندما يتغير الإذن من "معطّل" إلى "مفعّل"

---

## 📊 كيف يعمل النظام؟

### السيناريو 1️⃣: مستخدم جديد - أول تسجيل دخول

```
1. المستخدم يفتح التطبيق لأول مرة
   ↓
2. يسجل الدخول (LoginScreen)
   ↓
3. يظهر سؤال النظام: "السماح بالإشعارات؟"
   ↓
4a. إذا وافق → ✅
    - يتم الحصول على Push Token
    - يُرسل Token للسيرفر مع تسجيل الدخول
    - يُحفظ في UserDevice.push_token
    - الإشعارات تعمل فوراً!
    
4b. إذا رفض → ❌
    - يتم تسجيل الدخول بدون Token
    - الإشعارات معطّلة
    - لكن يمكن تفعيلها لاحقاً!
```

---

### السيناريو 2️⃣: تفعيل الإشعارات بعد رفضها سابقاً

#### الطريقة 1: من داخل التطبيق (الأسهل)

```
1. المستخدم يذهب: القائمة → الإعدادات
   ↓
2. يرى قسم "إشعارات التطبيق"
   - الحالة: "معطّلة" ❌
   - زر بارز: "تفعيل الإشعارات" 🔔
   ↓
3. يضغط على الزر
   ↓
4a. إذا لم يُطلب الإذن من قبل:
    - يظهر سؤال النظام مباشرة
    - يختار "السماح"
    - ✅ التطبيق يحصل على Token ويرسله للسيرفر تلقائياً!
    
4b. إذا تم رفض الإذن سابقاً:
    - تظهر رسالة توضيحية مع خطوات
    - يضغط "فتح الإعدادات"
    - يُفتح تطبيق الإعدادات مباشرة
    - يفعّل الإشعارات من هناك
    - يعود للتطبيق
    - ✅ التطبيق يكتشف التغيير ويحدّث Token تلقائياً!
```

#### الطريقة 2: من إعدادات الجهاز مباشرة

```
Android:
1. الإعدادات → التطبيقات → مطابقة → الإشعارات → تفعيل ✅
2. العودة للتطبيق
3. ✅ يتم تحديث Token تلقائياً!

iOS:
1. الإعدادات → الإشعارات → مطابقة → السماح بالإشعارات ✅
2. العودة للتطبيق
3. ✅ يتم تحديث Token تلقائياً!
```

---

### السيناريو 3️⃣: استقبال إشعار

```
1. مستخدم آخر يرسل رسالة
   ↓
2. Backend يحصل على:
   - user_id المستقبل
   - push_token من UserDevice
   - عدد الرسائل غير المقروءة
   ↓
3. Backend يرسل إشعار عبر:
   - Firebase Admin SDK (أولاً)
   - أو Expo Push API (احتياطي)
   ↓
4. الإشعار يصل للجوال:
   a) في شريط الإشعارات (Notification Bar)
      - عنوان الإشعار
      - نص الرسالة
      - الوقت
   
   b) على أيقونة التطبيق (Badge)
      - رقم الرسائل غير المقروءة
   ↓
5. عند الضغط على الإشعار:
   - يفتح التطبيق
   - يفتح المحادثة مباشرة
```

---

## 🧪 خطوات الاختبار الشاملة

### 1️⃣ اختبار Setup الأساسي

#### الخطوة 1: التحقق من Firebase
```bash
# في terminal (backend folder)
cd backend
python test_fcm_push.py
```

**النتيجة المتوقعة:**
```
✅ Firebase Admin SDK initialized successfully
📤 Sending test notification via Firebase Admin SDK...
✅ Notification sent successfully
```

إذا ظهر خطأ:
- تأكد من وجود `firebase-service-account.json` في مجلد `backend/`
- تأكد من صلاحية الملف
- تأكد من تفعيل Firebase Cloud Messaging API

---

#### الخطوة 2: اختبار الحصول على Token

```typescript
// في التطبيق، افتح Console
import { getExpoPushToken } from './src/lib/pushNotifications';

const token = await getExpoPushToken();
console.log('Push Token:', token);
```

**النتيجة المتوقعة:**
```
[PushNotifications] 🔔 Starting push token registration...
[PushNotifications] ✅ Platform supported: ios/android
[PushNotifications] ✅ Permission granted
[PushNotifications] ✅ Token received successfully
Push Token: ExponentPushToken[xxxxxxxxxxxxxx]
```

---

### 2️⃣ اختبار السيناريوهات الكاملة

#### السيناريو A: مستخدم جديد (يوافق على الإشعارات)

1. **احذف التطبيق وأعد تثبيته** (fresh install)
2. **افتح التطبيق وسجل الدخول**
3. **اختر "السماح" عند سؤال الإشعارات**
4. **تحقق من Console:**
   ```
   [Login] 🔔 Getting push token...
   [Login] ✅ Push token obtained successfully
   [Login] 📱 Linking device with pushToken: YES
   ```
5. **تحقق من قاعدة البيانات:**
   ```sql
   SELECT device_id, push_token FROM accounts_userdevice 
   WHERE user_id = <your_user_id>
   ORDER BY created_at DESC LIMIT 1;
   ```
   **النتيجة:** يجب أن يكون `push_token` موجود وليس NULL

6. **اطلب من مستخدم آخر إرسال رسالة لك**
7. **✅ يجب أن يصلك إشعار!**

---

#### السيناريو B: مستخدم رفض الإشعارات ثم فعّلها لاحقاً

##### الجزء 1: الرفض الأولي
1. **احذف التطبيق وأعد تثبيته**
2. **سجل الدخول**
3. **اختر "عدم السماح" / "Don't Allow"**
4. **تحقق من Console:**
   ```
   [Login] ⚠️ Push token is null
   [Login] 📱 Linking device with pushToken: NO
   ```
5. **تحقق من قاعدة البيانات:**
   ```sql
   SELECT push_token FROM accounts_userdevice 
   WHERE device_id = '<your_device_id>';
   ```
   **النتيجة:** `push_token` سيكون NULL أو فارغ

##### الجزء 2: التفعيل من داخل التطبيق
6. **اذهب إلى: القائمة → الإعدادات**
7. **ابحث عن قسم "إشعارات التطبيق"**
8. **تحقق من الحالة:**
   - شارة حمراء: "معطّلة" ❌
   - زر أزرق: "تفعيل الإشعارات" 🔔

9. **اضغط على "تفعيل الإشعارات"**

10. **إذا ظهر سؤال النظام مباشرة:**
    - اختر "السماح"
    - ✅ يجب أن ترى رسالة: "تم التفعيل بنجاح!"
    - تحقق من Console:
      ```
      [Settings] 🔔 Getting push token after permission granted...
      [Settings] ✅ Push token obtained: ExponentPushToken[...]
      [Settings] ✅ Push token updated on server
      ```

11. **إذا ظهرت رسالة توجيهية:**
    - اضغط "فتح الإعدادات"
    - سيفتح تطبيق الإعدادات
    - فعّل الإشعارات من هناك
    - ارجع للتطبيق

12. **عند العودة للتطبيق:**
    - تحقق من Console:
      ```
      [App] 🔔 Notifications enabled, updating push token...
      [App] ✅ Push token obtained: ExponentPushToken[...]
      [App] ✅ Push token updated on server successfully
      ```

13. **تحقق من قاعدة البيانات:**
    ```sql
    SELECT push_token FROM accounts_userdevice 
    WHERE device_id = '<your_device_id>';
    ```
    **النتيجة:** `push_token` الآن موجود! ✅

14. **اطلب رسالة اختبار**
15. **✅ يجب أن يصلك إشعار!**

---

#### السيناريو C: تفعيل من إعدادات الجهاز مباشرة

1. **افتح إعدادات الجهاز**
   - **Android**: الإعدادات → التطبيقات → مطابقة → الإشعارات → تفعيل
   - **iOS**: الإعدادات → الإشعارات → مطابقة → السماح بالإشعارات

2. **ارجع للتطبيق (اجعله في المقدمة)**

3. **تحقق من Console:**
   ```
   [App] 🔔 Notifications enabled, updating push token...
   [App] ✅ Push token obtained
   [App] ✅ Push token updated on server successfully
   ```

4. **اذهب للإعدادات في التطبيق**
   - يجب أن ترى: "مفعّلة" ✅

---

### 3️⃣ اختبار Badge (الرقم على الأيقونة)

1. **تأكد من تفعيل الإشعارات**
2. **اطلب من مستخدم آخر إرسال 3 رسائل لك**
3. **لا تفتح التطبيق**
4. **تحقق من أيقونة التطبيق:**
   - يجب أن يظهر رقم "3" على الأيقونة ✅

5. **افتح التطبيق**
6. **افتح المحادثة واقرأ الرسائل**
7. **أغلق التطبيق**
8. **تحقق من الأيقونة:**
   - الرقم يجب أن يختفي أو يصبح "0" ✅

---

### 4️⃣ اختبار الإشعارات في حالات مختلفة

#### أ) التطبيق مغلق تماماً
1. أغلق التطبيق بالكامل (Force Close / Swipe من Recent Apps)
2. اطلب رسالة اختبار
3. **✅ يجب أن يصل الإشعار!**
4. اضغط على الإشعار
5. **✅ يفتح التطبيق ويفتح المحادثة**

#### ب) التطبيق في الخلفية
1. افتح التطبيق
2. اضغط Home (التطبيق في الخلفية)
3. اطلب رسالة اختبار
4. **✅ يجب أن يصل الإشعار!**

#### ج) التطبيق مفتوح (في المقدمة)
1. افتح التطبيق واتركه مفتوحاً
2. اطلب رسالة اختبار
3. **✅ على Android:** قد يظهر إشعار صغير في الأعلى
4. **✅ على iOS:** قد لا يظهر banner لكن Badge يتحدث

---

## 🐛 استكشاف الأخطاء

### المشكلة 1: "لا تصلني إشعارات"

#### الحلول:
1. **تحقق من الأذونات:**
   ```typescript
   import { checkPermissionStatus } from './src/lib/pushNotifications';
   const status = await checkPermissionStatus();
   console.log('Permission status:', status);
   ```
   - يجب أن يكون `'granted'`

2. **تحقق من Push Token:**
   ```sql
   SELECT device_id, push_token, status 
   FROM accounts_userdevice 
   WHERE user_id = <your_user_id>;
   ```
   - `push_token` يجب ألا يكون NULL
   - `status` يجب أن يكون `'primary'` أو `'active'`

3. **تحقق من Firebase:**
   ```bash
   cd backend
   python test_fcm_push.py
   ```

4. **تحقق من Logs:**
   ```bash
   # Backend logs
   tail -f /path/to/django.log
   
   # ابحث عن:
   # ✅ "Notification sent successfully"
   # أو
   # ❌ "Failed to send notification"
   ```

---

### المشكلة 2: "Token لا يتحدث بعد التفعيل"

#### الحلول:
1. **أعد فتح التطبيق:**
   - أغلقه تماماً
   - افتحه مرة أخرى
   - تحقق من Console

2. **سجّل خروج ودخول:**
   - عند Login سيتم الحصول على Token جديد

3. **تحقق من الشبكة:**
   - تأكد من اتصال الإنترنت
   - تحقق من عدم وجود Firewall يمنع الطلبات

---

### المشكلة 3: "Badge لا يظهر"

#### الحلول:
1. **على iOS:**
   - الإعدادات → الإشعارات → مطابقة → تأكد من تفعيل "Badges"

2. **على Android:**
   - بعض الأجهزة تتطلب تفعيل "Notification Dots" في الإعدادات
   - الإعدادات → الإشعارات → Advanced → Allow notification dots

3. **تحقق من الكود:**
   ```typescript
   // في Console عند وصول إشعار
   // يجب أن ترى:
   [App] Setting badge count to: 3
   ```

---

## 📁 الملفات المعدّلة

### Frontend (Mobile):
1. ✅ `mobile/src/lib/pushNotifications.ts`
   - إضافة `openNotificationSettings()`

2. ✅ `mobile/src/services/devices.ts`
   - إضافة `updateCurrentDevicePushToken()`

3. ✅ `mobile/src/screens/SettingsScreen.tsx`
   - إضافة قسم "إشعارات التطبيق"
   - إضافة `handleEnableNotifications()`
   - تحديث Token عند التفعيل

4. ✅ `mobile/App.tsx`
   - إضافة فحص تلقائي للأذونات
   - تحديث Token عند العودة للتطبيق

### Backend (Django):
5. ✅ `backend/accounts/device_views.py`
   - إضافة `DeviceUpdateTokenView`

6. ✅ `backend/mujard/urls.py`
   - إضافة `/api/auth/devices/update-token`

---

## 🎯 الخلاصة

### ما يعمل الآن:
✅ **الحصول على Push Token**: عند Login أو عند تفعيل الإشعارات  
✅ **إرسال Token للسيرفر**: تلقائياً عند Login أو عند التفعيل  
✅ **تحديث Token**: عند تغيير حالة الأذونات  
✅ **Badge على الأيقونة**: يعرض عدد الرسائل غير المقروءة  
✅ **الإشعارات في الشريط**: تظهر بشكل صحيح مع العنوان والنص  
✅ **Firebase Admin SDK**: يرسل الإشعارات بنجاح  
✅ **Expo Push API**: نظام احتياطي يعمل  
✅ **قسم الإعدادات**: واجهة واضحة لإدارة الإشعارات  

### سير العمل الكامل:
```
المستخدم يسجل دخول
    ↓
يحصل على Push Token
    ↓
يُرسل Token للسيرفر
    ↓
يُحفظ في UserDevice.push_token
    ↓
عند وصول رسالة جديدة:
    ↓
السيرفر يجلب Token من قاعدة البيانات
    ↓
يرسل إشعار عبر Firebase/Expo
    ↓
الإشعار يصل للجوال
    ↓
✅ يظهر في شريط الإشعارات + Badge على الأيقونة
```

---

**🎉 النظام متكامل وجاهز للعمل!**
