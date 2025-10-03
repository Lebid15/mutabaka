# 📱 نظام Expo Push Notifications - دليل التنفيذ

## ✅ الملفات المُنشأة والمُعدّلة

### 📄 ملفات جديدة تم إنشاؤها:

1. **`mobile/src/lib/pushNotifications.ts`** - خدمة إدارة Expo Push Notifications
   - تسجيل Expo Push Token
   - طلب أذونات الإشعارات
   - إعداد Android Notification Channel
   - معالجة الإشعارات الواردة
   - Cache management للـ tokens

2. **`mobile/src/hooks/useNotificationHandlers.ts`** - React Hook لمعالجة الإشعارات
   - معالج الإشعارات الواردة (عندما يكون التطبيق مفتوح)
   - معالج الضغط على الإشعار (Navigation)
   - تحديث Badge Count تلقائياً
   - التنقل للمحادثة المناسبة

### 🔧 ملفات تم تعديلها:

1. **`mobile/src/screens/LoginScreen.tsx`**
   - إضافة import لـ `getExpoPushToken`
   - الحصول على Push Token عند Login
   - إرسال Token إلى الباك إند عبر `linkCurrentDevice`

2. **`mobile/src/screens/DevicePendingScreen.tsx`**
   - إضافة import لـ `getExpoPushToken`
   - الحصول على Push Token عند refresh device
   - إرسال Token إلى الباك إند

3. **`mobile/src/navigation/index.tsx`**
   - إضافة import لـ `useNotificationHandlers`
   - استخدام Hook لإعداد معالجات الإشعارات

4. **`mobile/src/services/auth.ts`**
   - إضافة import لـ `clearCachedPushToken`
   - مسح cached token عند Logout

---

## 🔄 كيفية العمل (Workflow)

### 1️⃣ **عند Login:**
```typescript
// في LoginScreen.tsx
const pushToken = await getExpoPushToken();  // الحصول على Expo Push Token
await linkCurrentDevice({
  accessToken: loginData.access,
  pushToken,  // إرسال Token للباك إند
});
```

### 2️⃣ **الباك إند يحفظ Token:**
```python
# backend/accounts/device_views.py
push_token = request.data.get('push_token')
device.push_token = push_token  # حفظ في قاعدة البيانات
```

### 3️⃣ **عند وصول رسالة جديدة:**
```python
# backend/communications/push.py
send_message_push(
    conversation=conversation,
    message=message,
    title="رسالة جديدة من أحمد",
    body="مرحباً، كيف حالك؟"
)
# ↓ يرسل إلى Expo Push Service
# ↓ Expo يوصل الإشعار للجهاز
```

### 4️⃣ **التطبيق يستقبل الإشعار:**
```typescript
// في useNotificationHandlers.ts
handleNotificationReceived(notification) {
  // تحديث badge count
  setAppBadgeCount(unreadCount);
}

handleNotificationTapped(response) {
  // التنقل للمحادثة
  navigation.navigate('Chat', { conversationId });
}
```

---

## 🎯 الميزات المُنفّذة

### ✅ تسجيل Push Token:
- [x] طلب أذونات الإشعارات من المستخدم
- [x] الحصول على Expo Push Token
- [x] إرسال Token إلى الباك إند عند Login
- [x] إعادة إرسال Token عند Refresh Device
- [x] Cache Token لتجنب طلبات متكررة

### ✅ معالجة الإشعارات:
- [x] استقبال الإشعارات عندما يكون التطبيق مفتوح
- [x] معالجة الضغط على الإشعار
- [x] التنقل التلقائي للمحادثة المناسبة
- [x] تحديث Badge Count تلقائياً
- [x] معالجة آخر إشعار عند فتح التطبيق

### ✅ إدارة Lifecycle:
- [x] مسح Token عند Logout
- [x] تحديث Token عند Login جديد
- [x] معالجة الأخطاء بشكل آمن (non-blocking)

### ✅ Android Support:
- [x] إنشاء Notification Channel تلقائياً
- [x] تكوين الصوت والاهتزاز
- [x] تفعيل Badge Support

---

## 🚀 اختبار النظام

### الخطوة 1: تسجيل الدخول
```
1. افتح التطبيق
2. سجّل الدخول بحساب صحيح
3. تحقق من Console:
   ✅ "[Login] Push token obtained successfully"
   ✅ Token يبدأ بـ ExponentPushToken[...]
```

### الخطوة 2: التحقق من الباك إند
```bash
# افتح Django Admin → UserDevice
# تحقق من حقل push_token - يجب أن يحتوي على:
ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]
```

### الخطوة 3: إرسال رسالة اختبار
```
1. من جهاز آخر أو Web، أرسل رسالة للمستخدم
2. يجب أن يصل إشعار للجهاز
3. اضغط على الإشعار → ينتقل للمحادثة مباشرة
```

### الخطوة 4: اختبار Badge Count
```
1. أرسل عدة رسائل للمستخدم
2. تحقق من Badge Count على أيقونة التطبيق
3. يجب أن يعرض عدد الرسائل غير المقروءة
```

---

## 🔍 Debugging & Troubleshooting

### مشكلة: لا يصل الإشعار

**الحلول:**
1. تحقق من Console:
   ```
   [PushNotifications] Token registered successfully
   ```
2. تحقق من أذونات الإشعارات في إعدادات الجهاز
3. تحقق من push_token في قاعدة البيانات:
   ```sql
   SELECT push_token FROM accounts_userdevice WHERE user_id = ?;
   ```
4. تحقق من Expo Push Service:
   ```bash
   # اختبار يدوي
   curl -H "Content-Type: application/json" \
        -X POST https://exp.host/--/api/v2/push/send \
        -d '{
          "to": "ExponentPushToken[...]",
          "title": "Test",
          "body": "Testing"
        }'
   ```

### مشكلة: الإشعار يصل لكن لا ينتقل للمحادثة

**الحلول:**
1. تحقق من Console:
   ```
   [App] Notification tapped: رسالة جديدة
   [App] Navigating to conversation: 123
   ```
2. تحقق من data payload في الباك إند:
   ```python
   # يجب أن يحتوي على:
   {
       "type": "message",
       "conversation_id": 123,
       "message_id": 456
   }
   ```

### مشكلة: Token لا يُحفظ في الباك إند

**الحلول:**
1. تحقق من projectId في app.json:
   ```json
   "extra": {
     "eas": {
       "projectId": "be5cc755-f602-4ce7-adcf-66b48c40d445"
     }
   }
   ```
2. تحقق من network request في DevTools
3. تحقق من Console للأخطاء

---

## 📝 ملاحظات مهمة

### ⚠️ Push Notifications تتطلب:
1. **جهاز فعلي** - المحاكي قد لا يعمل بشكل كامل
2. **projectId في app.json** - موجود بالفعل ✅
3. **أذونات المستخدم** - يُطلب تلقائياً عند Login
4. **اتصال إنترنت** - للتواصل مع Expo Push Service

### 🔐 الأمان:
- Push Tokens حساسة - لا تُطبع في production
- الباك إند يحذف tokens غير الصالحة تلقائياً
- Cache يُمسح عند Logout

### 🎨 التخصيص:
- يمكن تعديل Android Channel في `pushNotifications.ts`
- يمكن تعديل سلوك الإشعارات في `App.tsx`
- يمكن تعديل Navigation logic في `useNotificationHandlers.ts`

---

## 🎉 النتيجة النهائية

### ✅ ما تم تنفيذه:
1. تسجيل Expo Push Token عند Login
2. إرسال Token للباك إند تلقائياً
3. استقبال الإشعارات من الباك إند
4. التنقل التلقائي للمحادثة عند الضغط
5. تحديث Badge Count تلقائياً
6. مسح Token عند Logout
7. معالجة الأخطاء بشكل آمن

### 🚀 جاهز للاستخدام!
النظام الآن **متكامل وجاهز للاختبار**. الباك إند كان جاهزاً مسبقاً، والموبايل الآن مُكتمل!

---

## 📚 المراجع

- [Expo Push Notifications Docs](https://docs.expo.dev/push-notifications/overview/)
- [Expo Notifications API](https://docs.expo.dev/versions/latest/sdk/notifications/)
- [Backend Implementation](../../backend/accounts/push.py)
- [Communications Integration](../../backend/communications/push.py)
