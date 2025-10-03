# اختبار Push Notifications

## 1️⃣ تسجيل الدخول والحصول على Token

بعد تسجيل الدخول في التطبيق، ابحث في Console عن:
```
[Login] Push token obtained successfully: ExponentPushToken[xxxxxxxxxxxxxx]
```

## 2️⃣ اختبار من Django Admin

### الطريقة الأولى: إرسال رسالة جديدة

1. افتح Django Admin: `http://localhost:8000/admin/`
2. سجل دخول كـ مستخدم
3. اذهب إلى Communications → Conversations
4. افتح محادثة أو أنشئ واحدة جديدة
5. أرسل رسالة - **سيتم إرسال Push Notification تلقائياً**

### الطريقة الثانية: Python Shell

```bash
cd f:\mtk\backend
python manage.py shell
```

```python
from communications.push import send_new_message_notification
from accounts.models import User
from communications.models import Conversation, Message

# احصل على المستخدم المستهدف (الذي سجل دخوله من الموبايل)
user = User.objects.get(username='your_username')

# احصل على محادثة
conversation = Conversation.objects.first()

# احصل على آخر رسالة
message = conversation.messages.last()

# أرسل الإشعار
send_new_message_notification(
    recipient=user,
    sender=message.sender,
    conversation=conversation,
    message_text=message.content
)
```

### الطريقة الثالثة: اختبار مباشر من API

```bash
# احصل على User ID من الموبايل بعد تسجيل الدخول
curl -X POST http://localhost:8000/api/communications/pusher/test-push/ \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": 1,
    "title": "اختبار",
    "body": "هذه رسالة تجريبية"
  }'
```

## 3️⃣ التحقق من إرسال الإشعار

### في Backend Console:

ابحث عن:
```
[Expo Push] Sending notification to user_id=X
[Expo Push] Response: {'data': [{'status': 'ok', 'id': 'xxxxx'}]}
```

### في Mobile Console:

ابحث عن:
```
[PushNotifications] Notification received: {...}
[PushNotifications] User tapped notification, navigating to Chat
```

## 4️⃣ استكشاف الأخطاء

### إذا لم يصل الإشعار:

1. **تحقق من Device Token:**
   ```bash
   cd f:\mtk\backend
   python manage.py shell
   ```
   ```python
   from accounts.models import LinkedDevice
   device = LinkedDevice.objects.filter(user__username='your_username').first()
   print(f"Push Token: {device.push_token}")
   print(f"Is Active: {device.is_active}")
   ```

2. **تحقق من أذونات التطبيق:**
   - في المحاكي: Settings → Apps → Your App → Notifications
   - يجب أن تكون مفعّلة

3. **تحقق من Expo Push Token Format:**
   - يجب أن يبدأ بـ `ExponentPushToken[...]`
   - إذا كان `ExpoPushToken[...]` بدون `ent` فهذا خطأ

4. **اختبر Token يدوياً:**
   - اذهب إلى https://expo.dev/notifications
   - الصق Push Token
   - أرسل رسالة تجريبية

## 5️⃣ سيناريوهات الاختبار

### ✅ اختبار 1: إشعار رسالة جديدة
- المستخدم A يرسل رسالة للمستخدم B
- **المتوقع:** المستخدم B يستلم Push Notification

### ✅ اختبار 2: الضغط على الإشعار
- استلم إشعار
- اضغط عليه
- **المتوقع:** التطبيق يفتح على شاشة المحادثة مباشرة

### ✅ اختبار 3: التطبيق مفتوح
- التطبيق مفتوح ومرئي
- يصل إشعار جديد
- **المتوقع:** يظهر في الـ Notification Bar فقط (لا يصدر صوت)

### ✅ اختبار 4: التطبيق في الخلفية
- التطبيق في الخلفية
- يصل إشعار جديد
- **المتوقع:** يظهر إشعار + صوت

### ✅ اختبار 5: التطبيق مغلق
- التطبيق مغلق تماماً
- يصل إشعار جديد
- **المتوقع:** يظهر إشعار + صوت + عند الضغط يفتح على المحادثة

## 6️⃣ ملاحظات مهمة

⚠️ **في بيئة التطوير (Expo Go/Development Build):**
- قد لا تعمل Push Notifications بشكل موثوق 100%
- للاختبار الكامل، استخدم **Production Build** أو **EAS Build**

⚠️ **Expo Push Token:**
- يتغير عند إعادة تنصيب التطبيق
- يتم تحديثه تلقائياً عند كل login

⚠️ **معدل الإرسال:**
- Expo يسمح بـ 600 notification/hour للحسابات المجانية
- للإنتاج، ستحتاج Expo subscription

✅ **للإنتاج:**
```bash
cd f:\mtk\mobile
eas build --platform android --profile production
```

---

**🎯 الخطوة التالية:** 
سجل دخول في التطبيق وتأكد من ظهور:
```
[Login] Push token obtained successfully: ExponentPushToken[xxxxx]
```

ثم جرب إرسال رسالة من Django Admin!
