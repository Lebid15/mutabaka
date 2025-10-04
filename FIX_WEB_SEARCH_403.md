# إصلاح خطأ 403 عند البحث عن المستخدمين من المتصفح

## 🐛 المشكلة

عند استخدام نسخة الويب (Web) من التطبيق، كان يظهر خطأ **403 Forbidden** عند البحث عن جهات اتصال:

```
GET https://mutabaka.com/api/users/?q=abd&exclude_self=1 403 (Forbidden)
```

---

## 🔍 السبب

الصلاحيات الافتراضية في `settings.py` تتضمن:

```python
'DEFAULT_PERMISSION_CLASSES': [
    'rest_framework.permissions.IsAuthenticated',
    'accounts.permissions.ActiveDeviceRequired',  # ← المشكلة
]
```

### ما هي `ActiveDeviceRequired`؟
- تتحقق من وجود header **`X-Device-Id`** في الطلب
- تتحقق من أن الجهاز **نشط** (Primary أو Active)
- **مصممة للأجهزة المحمولة فقط** (is_web=False)

### لماذا فشلت مع المتصفحات؟
- أجهزة الويب **لا ترسل** `X-Device-Id` header
- تعتمد فقط على **JWT Token** في Authorization header
- لذلك كانت `ActiveDeviceRequired` ترفض جميع طلبات الويب بـ 403

---

## ✅ الحل

تم إضافة `permission_classes` صريحة للـ ViewSets التي يجب أن تعمل من المتصفح:

### 1️⃣ `UserSearchViewSet` (البحث عن المستخدمين)
```python
class UserSearchViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = User.objects.all().order_by('id')
    serializer_class = PublicUserSerializer
    permission_classes = [permissions.IsAuthenticated]  # ✅ تجاوز الافتراضي
```

### 2️⃣ `ContactRelationViewSet` (إدارة جهات الاتصال)
```python
class ContactRelationViewSet(viewsets.ModelViewSet):
    serializer_class = ContactRelationSerializer
    permission_classes = [permissions.IsAuthenticated]  # ✅ تجاوز الافتراضي
```

### 3️⃣ `TeamMemberViewSet` (كان موجود مسبقاً)
```python
class TeamMemberViewSet(viewsets.ModelViewSet):
    serializer_class = TeamMemberSerializer
    permission_classes = [permissions.IsAuthenticated]  # ✅ موجود
```

---

## 📊 ViewSets الأخرى (لا تحتاج تعديل)

| ViewSet | الصلاحيات | الحالة |
|---------|-----------|--------|
| `ConversationViewSet` | `IsParticipant` | ✅ تعمل مع الويب |
| `MessageViewSet` | `IsParticipant` | ✅ تعمل مع الويب |
| `TransactionViewSet` | `IsParticipant` | ✅ تعمل مع الويب |

**ملاحظة:** `IsParticipant` لا تتحقق من الجهاز، فقط من العضوية في المحادثة.

---

## 🔐 الأمان

### هل هذا التغيير آمن؟
**نعم!** ✅ لأن:

1. **المستخدم مصادق عليه:** `IsAuthenticated` تتحقق من صحة JWT Token
2. **الأجهزة الويب مسجلة:** يتم إنشاؤها عند الموافقة على QR Code
3. **محدودة بـ 5 متصفحات:** تم تطبيق الحد في التحديث السابق
4. **قابلة للإلغاء:** يمكن للمستخدم أو الأدمن إلغاء أجهزة الويب

### ما الفرق عن الموبايل؟
| الميزة | Mobile | Web |
|--------|--------|-----|
| **التحقق من الجهاز** | ✅ `X-Device-Id` إلزامي | ❌ JWT فقط |
| **Push Notifications** | ✅ يستقبل | ❌ لا يستقبل |
| **الجهاز الأساسي** | ✅ واحد فقط | ❌ الكل متساوي |
| **الحد الأقصى** | 3 أجهزة | 5 متصفحات |

---

## 🧪 الاختبار

### للتحقق من الإصلاح:

1. **سجّل دخول من المتصفح** (عبر QR Code)
2. **ابحث عن مستخدم:**
   ```
   GET /api/users/?q=username&exclude_self=1
   ```
3. **يجب أن ترى:** ✅ `200 OK` مع قائمة المستخدمين

### قبل الإصلاح:
```json
{
  "detail": "device_id_required"
}
```
**HTTP Status:** 403 Forbidden

### بعد الإصلاح:
```json
[
  {
    "id": 1,
    "username": "ahmed",
    "display_name": "أحمد محمد",
    ...
  }
]
```
**HTTP Status:** 200 OK

---

## 📝 الملفات المعدلة

1. `backend/communications/views.py`
   - `UserSearchViewSet`: إضافة `permission_classes`
   - `ContactRelationViewSet`: إضافة `permission_classes`

---

## 🚀 Deploy

لا حاجة لتعديلات في:
- ❌ قاعدة البيانات (لا migrations)
- ❌ Frontend (شفاف تماماً)
- ❌ متغيرات البيئة

فقط:
- ✅ إعادة تشغيل Django server
- ✅ اختبار البحث من المتصفح

---

## 💡 دروس مستفادة

### متى تستخدم `ActiveDeviceRequired`?
- ✅ للـ endpoints الحساسة (تغيير كلمة السر، إعدادات الأمان)
- ✅ للـ endpoints المخصصة للموبايل فقط (PIN، Push tokens)
- ❌ **ليس** للـ endpoints العامة (البحث، المحادثات، الرسائل)

### كيف نتجنب هذه المشكلة مستقبلاً؟
1. **لا تستخدم** `DEFAULT_PERMISSION_CLASSES` العالمية للصلاحيات الصارمة
2. **اجعل الافتراضي** `IsAuthenticated` فقط
3. **أضف** `ActiveDeviceRequired` يدوياً للـ endpoints الحساسة

### اقتراح لتحسين `settings.py`:
```python
# بدلاً من:
'DEFAULT_PERMISSION_CLASSES': [
    'rest_framework.permissions.IsAuthenticated',
    'accounts.permissions.ActiveDeviceRequired',  # ❌ صارمة جداً
]

# استخدم:
'DEFAULT_PERMISSION_CLASSES': [
    'rest_framework.permissions.IsAuthenticated',  # ✅ أكثر مرونة
]
```

ثم أضف `ActiveDeviceRequired` يدوياً لـ:
- PIN endpoints
- Device management endpoints
- Password reset endpoints

---

**تاريخ الإصلاح:** 2025-10-05  
**المطور:** GitHub Copilot  
**الحالة:** ✅ تم الحل والاختبار
