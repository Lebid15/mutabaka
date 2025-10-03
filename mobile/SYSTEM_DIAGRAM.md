# 📊 مخطط نظام Push Notifications

## 🔄 المسار الكامل للإشعارات

```
┌─────────────────────────────────────────────────────────────────┐
│                         📱 MOBILE APP                           │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  LoginScreen.tsx                                         │  │
│  │  • User enters credentials                               │  │
│  │  • Taps "تسجيل الدخول"                                   │  │
│  └──────────────┬───────────────────────────────────────────┘  │
│                 │                                               │
│                 ↓                                               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  pushNotifications.ts → getExpoPushToken()               │  │
│  │  • Request permissions                                   │  │
│  │  • Register with Expo                                    │  │
│  │  • Return: ExponentPushToken[xxxx...]                   │  │
│  └──────────────┬───────────────────────────────────────────┘  │
│                 │                                               │
│                 ↓                                               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  devices.ts → linkCurrentDevice({ pushToken })           │  │
│  │  POST /api/auth/devices/link                             │  │
│  │  Body: { push_token: "ExponentPushToken[...]" }         │  │
│  └──────────────┬───────────────────────────────────────────┘  │
└─────────────────┼───────────────────────────────────────────────┘
                  │
                  │ HTTP POST
                  │
                  ↓
┌─────────────────────────────────────────────────────────────────┐
│                         🖥️ BACKEND                              │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  device_views.py → DeviceLinkView                        │  │
│  │  • Extract push_token from request                       │  │
│  │  • Save to database                                      │  │
│  └──────────────┬───────────────────────────────────────────┘  │
│                 │                                               │
│                 ↓                                               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  UserDevice Model                                        │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │ id: "abc123"                                       │  │  │
│  │  │ user_id: 42                                        │  │  │
│  │  │ push_token: "ExponentPushToken[xxxxxx...]"        │  │  │
│  │  │ status: "active"                                   │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  [Time passes... User receives a message]                      │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  communications/views.py → CreateMessageView             │  │
│  │  • Message created                                       │  │
│  │  • Call send_message_push()                              │  │
│  └──────────────┬───────────────────────────────────────────┘  │
│                 │                                               │
│                 ↓                                               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  communications/push.py                                  │  │
│  │  • Get target user's push_token from DB                  │  │
│  │  • Calculate unread_count                                │  │
│  │  • Build PushMessage                                     │  │
│  └──────────────┬───────────────────────────────────────────┘  │
│                 │                                               │
│                 ↓                                               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  accounts/push.py → send_push_messages()                 │  │
│  │  POST https://exp.host/--/api/v2/push/send               │  │
│  │  Body: {                                                 │  │
│  │    to: "ExponentPushToken[...]",                        │  │
│  │    title: "رسالة جديدة من أحمد",                        │  │
│  │    body: "مرحباً، كيف حالك؟",                            │  │
│  │    data: {                                               │  │
│  │      type: "message",                                    │  │
│  │      conversation_id: 123,                               │  │
│  │      unread_count: 5                                     │  │
│  │    },                                                    │  │
│  │    badge: 5                                              │  │
│  │  }                                                       │  │
│  └──────────────┬───────────────────────────────────────────┘  │
└─────────────────┼───────────────────────────────────────────────┘
                  │
                  │ HTTP POST
                  │
                  ↓
┌─────────────────────────────────────────────────────────────────┐
│                    ☁️ EXPO PUSH SERVICE                         │
│                                                                 │
│  • Receives notification from backend                           │
│  • Routes to appropriate service:                               │
│    - Android → Firebase Cloud Messaging (FCM)                   │
│    - iOS → Apple Push Notification service (APNs)               │
│                                                                 │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  │
      ┌───────────┴────────────┐
      │                        │
      ↓                        ↓
┌──────────┐            ┌──────────┐
│   FCM    │            │   APNs   │
│ Android  │            │   iOS    │
└─────┬────┘            └────┬─────┘
      │                      │
      └──────────┬───────────┘
                 │
                 │ Push Notification
                 │
                 ↓
┌─────────────────────────────────────────────────────────────────┐
│                         📱 MOBILE APP                           │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  App.tsx → Notification Handler                          │  │
│  │  • Notification received                                 │  │
│  │  • Update badge count                                    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  [User taps notification]                                       │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  useNotificationHandlers.ts                              │  │
│  │  • Extract conversation_id from data                     │  │
│  │  • navigation.navigate('Chat', { conversationId })       │  │
│  └──────────────┬───────────────────────────────────────────┘  │
│                 │                                               │
│                 ↓                                               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  ChatScreen.tsx                                          │  │
│  │  • Opens directly to the conversation                    │  │
│  │  • User can read and reply                               │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📁 بنية الملفات

```
mobile/
├── src/
│   ├── lib/
│   │   ├── pushNotifications.ts ⭐ NEW - خدمة Push Notifications
│   │   └── appBadge.ts ✅ EXISTING - Badge management
│   │
│   ├── hooks/
│   │   └── useNotificationHandlers.ts ⭐ NEW - معالج الإشعارات
│   │
│   ├── screens/
│   │   ├── LoginScreen.tsx ✏️ MODIFIED - تسجيل Token
│   │   └── DevicePendingScreen.tsx ✏️ MODIFIED - تسجيل Token
│   │
│   ├── navigation/
│   │   └── index.tsx ✏️ MODIFIED - إضافة Hook
│   │
│   ├── services/
│   │   ├── auth.ts ✏️ MODIFIED - مسح Token عند Logout
│   │   └── devices.ts ✅ EXISTING - يستقبل pushToken
│   │
│   └── utils/
│       └── testPushNotifications.ts ⭐ NEW - أدوات الاختبار
│
├── PUSH_NOTIFICATIONS_IMPLEMENTATION.md ⭐ NEW
├── IMPLEMENTATION_SUMMARY_AR.md ⭐ NEW
├── CHECKLIST.md ⭐ NEW
├── QUICK_START.md ⭐ NEW
└── SYSTEM_DIAGRAM.md ⭐ NEW (this file)

backend/
├── accounts/
│   ├── push.py ✅ EXISTING - Expo Push integration
│   ├── models.py ✅ EXISTING - UserDevice.push_token
│   ├── device_views.py ✅ EXISTING - API endpoints
│   └── device_service.py ✅ EXISTING - Business logic
│
└── communications/
    ├── push.py ✅ EXISTING - send_message_push()
    └── views.py ✅ EXISTING - Message creation
```

---

## 🔑 المكونات الرئيسية

### 📱 Mobile Components:

| الملف | الدور | الحالة |
|------|------|--------|
| `pushNotifications.ts` | تسجيل Token + معالجة Permissions | ⭐ NEW |
| `useNotificationHandlers.ts` | معالجة الإشعارات + Navigation | ⭐ NEW |
| `LoginScreen.tsx` | تسجيل Token عند Login | ✏️ MODIFIED |
| `DevicePendingScreen.tsx` | تسجيل Token عند Refresh | ✏️ MODIFIED |
| `navigation/index.tsx` | إعداد معالجات الإشعارات | ✏️ MODIFIED |
| `auth.ts` | مسح Token عند Logout | ✏️ MODIFIED |

### 🖥️ Backend Components:

| الملف | الدور | الحالة |
|------|------|--------|
| `accounts/push.py` | إرسال إلى Expo Push Service | ✅ READY |
| `accounts/models.py` | تخزين push_token | ✅ READY |
| `accounts/device_views.py` | API لربط الأجهزة | ✅ READY |
| `communications/push.py` | منطق إرسال الإشعارات | ✅ READY |
| `communications/views.py` | استدعاء send_message_push | ✅ READY |

---

## 🎯 نقاط التكامل

### 1️⃣ Token Registration Flow:
```
LoginScreen
    ↓ getExpoPushToken()
pushNotifications.ts
    ↓ linkCurrentDevice({ pushToken })
devices.ts (API call)
    ↓ POST /api/auth/devices/link
device_views.py
    ↓ device.push_token = token
UserDevice Model (DB)
```

### 2️⃣ Notification Sending Flow:
```
Message Created
    ↓ send_message_push()
communications/push.py
    ↓ get_active_device_tokens()
UserDevice.objects.filter(push_token)
    ↓ PushMessage(to=token, ...)
accounts/push.py
    ↓ POST https://exp.host/.../send
Expo Push Service
    ↓ FCM/APNs
User's Device
```

### 3️⃣ Notification Handling Flow:
```
Notification Arrives
    ↓
App.tsx (setNotificationHandler)
    ↓ Update badge count
useNotificationHandlers
    ↓ User taps notification
handleNotificationTapped()
    ↓ Extract conversation_id
navigation.navigate('Chat', { conversationId })
    ↓
ChatScreen opens
```

---

## ✨ الميزات المُنفّذة

| الميزة | Mobile | Backend | الحالة |
|-------|--------|---------|--------|
| Token Registration | ✅ | ✅ | 🟢 جاهز |
| Token Storage | ✅ | ✅ | 🟢 جاهز |
| Send Notifications | N/A | ✅ | 🟢 جاهز |
| Receive Notifications | ✅ | N/A | 🟢 جاهز |
| Navigation on Tap | ✅ | N/A | 🟢 جاهز |
| Badge Count | ✅ | ✅ | 🟢 جاهز |
| Token Cleanup (Logout) | ✅ | ✅ | 🟢 جاهز |
| Error Handling | ✅ | ✅ | 🟢 جاهز |
| Permissions | ✅ | N/A | 🟢 جاهز |
| Android Channel | ✅ | N/A | 🟢 جاهز |

---

## 🎉 النتيجة

نظام **متكامل ويعمل End-to-End**:
- ✅ الموبايل ← يسجل ويرسل Token
- ✅ الباك إند ← يحفظ Token ويرسل إشعارات
- ✅ Expo Service ← يوصل الإشعارات
- ✅ الموبايل ← يستقبل ويعالج الإشعارات
- ✅ Navigation ← يفتح المحادثة المناسبة

**جاهز للاستخدام! 🚀**
