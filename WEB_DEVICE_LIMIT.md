# حد أجهزة الويب (Web Device Limit)

## 📋 الملخص
تم إضافة حد أقصى **5 متصفحات** لكل مستخدم عند تسجيل الدخول عبر QR Code.

---

## 🔧 التغييرات المطبقة

### 1️⃣ **إعدادات جديدة** (`mujard/settings.py`)
```python
USER_WEB_DEVICE_MAX_ACTIVE = int(os.getenv('USER_WEB_DEVICE_MAX_ACTIVE', '5'))
```
- **القيمة الافتراضية:** 5 متصفحات
- **قابل للتعديل:** عبر متغير البيئة `USER_WEB_DEVICE_MAX_ACTIVE`

---

### 2️⃣ **دالة جديدة** (`accounts/device_service.py`)
```python
def count_active_web_devices(user) -> int:
    """حساب عدد أجهزة الويب النشطة للمستخدم"""
    return UserDevice.objects.filter(
        user=user, 
        status__in=_ACTIVE_STATUSES, 
        is_web=True
    ).count()
```

---

### 3️⃣ **فحص الحد عند الموافقة** (`accounts/qr_login_views.py`)
عند مسح QR Code والموافقة على تسجيل دخول متصفح جديد:
- ✅ **إذا كان العدد < 5:** يتم إنشاء الجهاز بنجاح
- ❌ **إذا كان العدد = 5:** يتم رفض الطلب مع رسالة:
```json
{
  "detail": "web_device_limit_reached",
  "message": "الحد الأقصى 5 متصفحات. يرجى إلغاء متصفح قديم أولاً.",
  "limit": 5,
  "current": 5
}
```
**HTTP Status:** `409 Conflict`

---

## 📊 جدول الحدود

| نوع الجهاز | الحد الأقصى | القيد |
|-----------|-------------|-------|
| 📱 **Mobile (Android/iOS)** | **3** | `USER_DEVICE_MAX_ACTIVE` |
| 🌐 **Web (Browsers)** | **5** | `USER_WEB_DEVICE_MAX_ACTIVE` |
| **المجموع** | **8 أجهزة** | منفصل (3 موبايل + 5 ويب) |

---

## 🧪 الاختبارات

تم إضافة اختبار `test_web_device_limit_enforced` في `test_web_login.py`:
- ✅ التحقق من إنشاء 5 متصفحات بنجاح
- ✅ رفض المتصفح السادس
- ✅ التحقق من رسالة الخطأ الصحيحة

**لتشغيل الاختبار:**
```bash
cd backend
python manage.py test accounts.tests.test_web_login.WebLoginFlowTests.test_web_device_limit_enforced
```

---

## 🔐 إدارة المتصفحات من Django Admin

### لحذف متصفح قديم:
1. `Admin Panel` → `User Devices`
2. **Filter:** `Is web = Yes`, `Status = Active`
3. **اختر الجهاز** → غيّر Status إلى `Revoked`
4. **احفظ** ✅

### لرؤية جميع متصفحات مستخدم معين:
```
User Devices → Filter by User + Is Web = Yes
```

---

## 🌍 متغيرات البيئة

لتغيير الحد الأقصى، أضف إلى `.env`:
```bash
USER_WEB_DEVICE_MAX_ACTIVE=10  # مثال: زيادة الحد إلى 10 متصفحات
```

---

## 📝 ملاحظات

1. **الحد منفصل عن الموبايلات:** المستخدم يمكنه الحصول على 3 موبايلات + 5 متصفحات
2. **لا يؤثر على الأجهزة الموجودة:** إذا كان لديك 7 متصفحات حالياً، لن يتم حذفها تلقائياً
3. **الحد يُطبق فقط على الجديدة:** سيتم رفض المتصفحات الجديدة عند الوصول للحد

---

## 🚀 التطبيق في Production

بعد Deploy:
1. ✅ قم بتشغيل الاختبارات
2. ✅ تحقق من `settings.py` أن `USER_WEB_DEVICE_MAX_ACTIVE` مضبوط على 5
3. ✅ جرّب مسح QR Code من 6 متصفحات مختلفة للتأكد

---

**تاريخ الإنشاء:** 2025-10-05  
**المطور:** GitHub Copilot
