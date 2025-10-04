# إعداد Pusher للإشعارات الفورية

## المشكلة
تظهر التحذيرات التالية في console المتصفح:
```
[Pusher] Chat feed disabled: missing NEXT_PUBLIC_PUSHER_*
WebSocket connection to '<URL>' failed: WebSocket is closed before the connection is established.
```

## السبب
متغيرات البيئة الخاصة بـ Pusher غير مُعدّة في بيئة الإنتاج.

## الحل

### 1. إنشاء حساب Pusher (إذا لم يكن لديك)
- سجّل على https://pusher.com (يوجد خطة مجانية)
- أنشئ تطبيق جديد (New app)
- اختر Cluster قريب من المستخدمين (مثلاً: `eu` لأوروبا، `ap1` لآسيا)

### 2. احصل على بيانات الاعتماد
من لوحة Pusher:
- **App ID**: مثل `1234567`
- **Key**: مثل `a1b2c3d4e5f6g7h8i9j0`
- **Secret**: مثل `xyz123abc456`
- **Cluster**: مثل `eu` أو `us2` أو `ap1`

### 3. أضف المتغيرات إلى ملف `.env` على السيرفر

في ملف `deploy/.env` على السيرفر، أضف:

```bash
# Pusher Configuration for Real-time Notifications
NEXT_PUBLIC_PUSHER_KEY=your_pusher_key_here
NEXT_PUBLIC_PUSHER_CLUSTER=your_cluster_here
```

### 4. أعد بناء ونشر التطبيق

#### أ. إذا كنت تستخدم GitHub Actions / CI/CD:
تأكد من إضافة المتغيرات إلى Secrets:
- `NEXT_PUBLIC_PUSHER_KEY`
- `NEXT_PUBLIC_PUSHER_CLUSTER`

ثم قم بإعادة البناء.

#### ب. إذا كنت تبني يدويًا:
```bash
# في مجلد المشروع
cd frontend

# بناء الـ Docker image مع المتغيرات
docker build \
  --build-arg NEXT_PUBLIC_PUSHER_KEY=your_key \
  --build-arg NEXT_PUBLIC_PUSHER_CLUSTER=your_cluster \
  -t mutabaka-frontend:latest .

# أعد تشغيل Docker Compose
cd ../deploy
docker-compose down
docker-compose up -d
```

### 5. للتطوير المحلي

أضف إلى `frontend/.env.local`:
```bash
NEXT_PUBLIC_PUSHER_KEY=your_key
NEXT_PUBLIC_PUSHER_CLUSTER=your_cluster
```

ثم أعد تشغيل `npm run dev`

## تعطيل Pusher مؤقتًا (بدون تحذيرات)

إذا لم تكن تريد استخدام Pusher حالياً، يمكنك تعطيله بقيم وهمية:

```bash
NEXT_PUBLIC_PUSHER_KEY=disabled
NEXT_PUBLIC_PUSHER_CLUSTER=mt1
```

هذا سيوقف التحذيرات لكن لن تعمل الإشعارات الفورية.

## ملاحظات مهمة

1. **القيم يجب أن تُضاف وقت البناء (build time)** لـ Next.js، ليس فقط وقت التشغيل
2. لهذا السبب تمت إضافتها كـ `ARG` و `ENV` في `frontend/Dockerfile`
3. بعد إضافة المتغيرات، **يجب إعادة بناء** الـ Docker image

## التحقق

بعد النشر، افتح console المتصفح على mutabaka.com - يجب ألا تظهر التحذيرات.
