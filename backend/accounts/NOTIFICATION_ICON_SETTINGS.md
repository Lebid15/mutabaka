# إعدادات أيقونة الإشعارات (Notification Icon Settings)

## الوصف
تم إضافة نموذج `SiteSettings` في تطبيق `accounts` لإدارة الإعدادات العامة للموقع، بما في ذلك أيقونة الإشعارات التي تظهر في شريط الحالة على الهواتف.

## المميزات

### 1. **رفع الأيقونة عبر Django Admin**
- انتقل إلى لوحة Django Admin
- اختر **"إعدادات الموقع" (Site Settings)**
- ارفع صورة PNG فقط (سيتم رفض أي صيغة أخرى)
- سيتم عرض معاينة مصغرة للصورة بعد رفعها

### 2. **التخزين**
- يتم تخزين الصور في: `MEDIA_ROOT/notification_icons/`
- الرابط الكامل: `MEDIA_URL/notification_icons/filename.png`

### 3. **الاستخدام في كود الإشعارات**

#### الطريقة الأولى: استخدام الدالة المساعدة (موصى بها)
```python
from accounts.site_settings import get_notification_icon_url

# في كود بناء FCM payload
icon_url = get_notification_icon_url()
if icon_url:
    fcm_payload['notification']['icon'] = icon_url
    # أو
    fcm_payload['notification']['android']['smallIcon'] = icon_url
```

#### الطريقة الثانية: الوصول المباشر
```python
from accounts.models import SiteSettings

settings = SiteSettings.load()
icon_url = settings.get_notification_icon_url()
if icon_url:
    # استخدم icon_url في FCM payload
    pass
```

## مثال كامل للاستخدام في FCM

```python
from accounts.site_settings import get_notification_icon_url

def send_notification(user, title, body):
    icon_url = get_notification_icon_url()
    
    message = {
        'notification': {
            'title': title,
            'body': body,
        },
        'android': {
            'notification': {
                'sound': 'default',
            }
        },
        'apns': {
            'payload': {
                'aps': {
                    'sound': 'default'
                }
            }
        },
        'token': user.push_token
    }
    
    # إضافة الأيقونة إذا كانت متوفرة
    if icon_url:
        message['notification']['icon'] = icon_url
        message['android']['notification']['icon'] = icon_url
    
    # إرسال الإشعار
    # ...
```

## ملاحظات مهمة

### التحقق من الصيغة
- **فقط صور PNG مسموح بها**
- سيظهر خطأ تحقق إذا حاولت رفع صيغة أخرى

### Singleton Pattern
- النموذج يستخدم نمط Singleton
- يوجد سجل واحد فقط (ID=1)
- لا يمكن حذف السجل من Admin
- لا يمكن إضافة سجل جديد بعد إنشاء الأول

### الأداء
- يتم استخدام caching للإعدادات
- يتم تنظيف الـ cache تلقائياً عند الحفظ
- استخدم `clear_site_settings_cache()` للتنظيف اليدوي إذا لزم الأمر

## الملفات المضافة

1. **models.py** - نموذج `SiteSettings` مع validator للـ PNG
2. **admin.py** - تسجيل النموذج في Admin مع معاينة الصورة
3. **site_settings.py** - دوال مساعدة للوصول للإعدادات
4. **migrations/0010_sitesettings.py** - Migration لإنشاء الجدول

## الصلاحيات في Admin

- **الإضافة**: مسموحة فقط إذا لم يوجد سجل
- **التعديل**: مسموح
- **الحذف**: غير مسموح (singleton)
- **العرض**: مسموح لجميع المشرفين

## استكشاف الأخطاء

### الصورة لا تظهر في الإشعار
1. تأكد من رفع صورة PNG
2. تأكد من صحة `MEDIA_URL` في settings
3. تأكد من أن السيرفر يخدم ملفات media بشكل صحيح
4. تحقق من حجم الصورة (يُفضل أن تكون صغيرة للإشعارات)

### خطأ في التحقق
```
ValidationError: فقط ملفات PNG مسموح بها
```
- تأكد من أن الملف بصيغة `.png` وليس `.jpg` أو `.jpeg`

## الحجم الموصى به للأيقونة

للحصول على أفضل نتيجة في الإشعارات:
- **Android**: 192×192 بكسل أو 512×512 بكسل
- **iOS**: 120×120 بكسل أو 180×180 بكسل
- **الحجم**: أقل من 100 كيلوبايت

## الأمان

- يتم التحقق من نوع الملف على مستوى النموذج
- التخزين في مجلد منفصل داخل media
- لا توجد معالجة للصور (upload as-is)
- يُفضل إضافة middleware للتحقق من MIME type إذا لزم الأمر
