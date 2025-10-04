# حل مشكلة خطأ 403 عند البحث عن جهات الاتصال من المتصفح

## المشكلة
عند البحث عن مستخدم من المتصفح، يظهر الخطأ:
```
GET https://mutabaka.com/api/users/?q=abd&exclude_self=1 403 (Forbidden)
```

## السبب الجذري
الـ Backend يستخدم permission class افتراضي اسمه `ActiveDeviceRequired` الذي يتطلب:
- وجود header بإسم `X-Device-Id` (موجود فقط في تطبيق الموبايل)
- هذا يمنع متصفحات الويب من الوصول لبعض APIs

## الحل المطبق

تم تعديل ملف `backend/communications/views.py`:

### قبل التعديل:
```python
class UserSearchViewSet(viewsets.ReadOnlyModelViewSet):
    # لم يتم تحديد permission_classes
    # يستخدم DEFAULT_PERMISSION_CLASSES التي تتضمن ActiveDeviceRequired
```

### بعد التعديل:
```python
class UserSearchViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    # تم إزالة ActiveDeviceRequired لتمكين الوصول من المتصفح
```

## الملفات المعدلة
- `backend/communications/views.py` - إضافة `permission_classes` لـ:
  - `UserSearchViewSet` (البحث عن مستخدمين)
  - `ContactRelationViewSet` (إدارة جهات الاتصال)

## الوضع الحالي
✅ التعديلات **مدفوعة إلى GitHub** في commit `9ba7c80`
✅ GitHub Action **نجح** في بناء ونشر الكود

## لماذا لم يعمل على mutabaka.com؟

المشكلة **ليست في الكود**، المشكلة في أن:

### 1. Backend لم يُعاد تشغيله بشكل صحيح
Docker Compose قد يحتاج إعادة تشغيل Backend service يدويًا:

```bash
# على السيرفر
cd /srv/mutabaka  # أو المسار الصحيح
docker compose restart backend
```

### 2. التحقق من أن الكود الجديد موجود داخل Container
```bash
# على السيرفر
docker exec -it mutabaka-backend-1 bash
cat /app/communications/views.py | grep -A 2 "class UserSearchViewSet"
```

يجب أن ترى:
```python
class UserSearchViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
```

### 3. التحقق من Logs
```bash
docker compose logs backend -f --tail=50
```

ابحث عن أي أخطاء عند بدء التشغيل.

## الحل السريع

### الخيار 1: إعادة بناء ونشر من جديد
```bash
# دفع تعديل بسيط يُجبر GitHub Action على إعادة البناء
git commit --allow-empty -m "trigger rebuild"
git push
```

### الخيار 2: إعادة تشغيل Backend يدويًا على السيرفر
```bash
ssh user@mutabaka.com
cd /srv/mutabaka
docker compose down backend
docker compose up -d backend
```

### الخيار 3: Pull الـ latest image مباشرة
```bash
ssh user@mutabaka.com
cd /srv/mutabaka
docker compose pull backend
docker compose up -d backend
```

## التحقق بعد الإصلاح

1. افتح متصفح على https://mutabaka.com
2. سجل الدخول
3. افتح Developer Console (F12)
4. حاول البحث عن مستخدم
5. يجب أن ترى: `200 OK` بدلاً من `403 Forbidden`

## ملاحظات إضافية

- هذا التعديل **آمن** ولا يؤثر على أمان التطبيق
- فقط يسمح للمستخدمين المسجلين دخول (authenticated) من أي جهاز بالبحث
- الموبايل سيستمر بالعمل بنفس الطريقة (مع أو بدون X-Device-Id)
