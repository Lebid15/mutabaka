# 🚀 دليل البدء السريع - أيقونة الإشعارات
# Quick Start Guide - Notification Icon

## ⚡ 3 خطوات للبدء

### 1️⃣ رفع الأيقونة
```bash
# افتح Django Admin
http://localhost:8000/admin/

# انتقل إلى:
Accounts → إعدادات الموقع (Site Settings)

# ارفع صورة PNG
```

### 2️⃣ استخدم في كود FCM
```python
from accounts.site_settings import get_notification_icon_url

icon_url = get_notification_icon_url()
if icon_url:
    fcm_payload['notification']['icon'] = icon_url
```

### 3️⃣ أرسل إشعار
```python
# الأيقونة ستظهر تلقائياً! ✅
```

---

## 📝 مثال كامل (Copy & Paste)

```python
from accounts.site_settings import get_notification_icon_url
from firebase_admin import messaging

def send_message_notification(user, sender_name, message_text):
    """إرسال إشعار رسالة جديدة مع الأيقونة المخصصة"""
    
    # الحصول على الأيقونة (إن وُجدت)
    icon_url = get_notification_icon_url()
    
    # بناء الإشعار
    notification = messaging.Notification(
        title=f"رسالة من {sender_name}",
        body=message_text,
        image=icon_url  # ستكون None إذا لم تُرفع أيقونة
    )
    
    # إعدادات Android
    android_config = messaging.AndroidConfig(
        notification=messaging.AndroidNotification(
            icon=icon_url if icon_url else None,  # الأيقونة الصغيرة
            sound='default',
            channel_id='mutabaka-messages',
        )
    )
    
    # إرسال
    message = messaging.Message(
        notification=notification,
        android=android_config,
        token=user.push_token,
    )
    
    response = messaging.send(message)
    return response
```

---

## 🔧 اختبار سريع

```bash
# تأكد من وجود النموذج
python manage.py shell -c "from accounts.models import SiteSettings; print(SiteSettings.load())"

# تأكد من الدوال المساعدة
python manage.py shell -c "from accounts.site_settings import get_notification_icon_url; print(get_notification_icon_url())"

# شغّل الاختبارات
python manage.py test accounts.tests.test_site_settings
```

---

## ✅ متطلبات الأيقونة

| الخاصية | القيمة الموصى بها |
|---------|-------------------|
| **الصيغة** | PNG فقط ✅ |
| **الحجم** | 192×192 أو 512×512 |
| **حجم الملف** | < 100 KB |
| **الخلفية** | شفافة (يُفضل) |

---

## 📚 المزيد من المعلومات

- **دليل كامل**: `accounts/NOTIFICATION_ICON_SETTINGS.md`
- **أمثلة**: `accounts/notification_icon_example.py`
- **التنفيذ**: `NOTIFICATION_ICON_IMPLEMENTATION.md`

---

## 🆘 حل المشاكل

### الأيقونة لا تظهر؟
```python
# تحقق من وجود أيقونة مرفوعة
from accounts.site_settings import get_notification_icon_url
print(get_notification_icon_url())  # يجب أن يطبع رابط أو None
```

### خطأ في رفع الصورة؟
- ✅ تأكد أنها PNG (ليست JPG)
- ✅ الحجم معقول (< 5 MB)

### الأيقونة القديمة ما زالت تظهر؟
```python
# نظّف الـ cache
from accounts.site_settings import clear_site_settings_cache
clear_site_settings_cache()
```

---

## 🎯 نصائح للأداء

1. **استخدم caching**: الدالة `get_notification_icon_url()` مُحسّنة تلقائياً
2. **حجم صغير**: احرص على أن تكون الأيقونة < 100 KB
3. **صيغة صحيحة**: PNG فقط للشفافية

---

**جاهز للاستخدام! 🚀**

أي أسئلة؟ راجع التوثيق الكامل أو شغّل الاختبارات.
