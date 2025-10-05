# إعداد Android Credentials لـ EAS Build

## المشكلة
عند تشغيل workflow لبناء APK/AAB، يظهر الخطأ:
```
Generating a new Keystore is not supported in --non-interactive mode
```

## السبب
- GitHub Actions يعمل في وضع `--non-interactive`
- EAS يحتاج إلى Android keystore لتوقيع التطبيق
- لا يمكن إنشاء keystore جديد تلقائياً في الوضع غير التفاعلي

## الحل

### الخطوة 1: إنشاء Android Keystore على EAS (مرة واحدة فقط)

قم بتشغيل هذا الأمر **محلياً على جهازك** لأول مرة:

```bash
cd mobile
eas build --platform android --profile production
```

ستُسأل عن إنشاء credentials جديدة:
```
? Would you like to set up Google Service Account for Play Store submissions?
  → اختر: No (يمكن إضافته لاحقاً)

? Generate a new Android Keystore?
  → اختر: Yes

? Enter Keystore password:
  → أدخل كلمة مرور قوية واحفظها
```

سيتم:
1. ✅ إنشاء Android Keystore جديد
2. ✅ رفعه بشكل آمن إلى EAS servers
3. ✅ استخدامه تلقائياً في جميع البناءات المستقبلية

### الخطوة 2: التحقق من Credentials

```bash
# التحقق من الـ credentials المحفوظة
eas credentials

# عرض تفاصيل Android keystore
eas credentials -p android
```

### الخطوة 3: تشغيل GitHub Actions Workflow

الآن يمكنك تشغيل workflow من GitHub:

1. اذهب إلى: **Actions** → **Build Android APK & AAB**
2. اضغط **Run workflow**
3. اختر branch: `main`
4. اضغط **Run workflow**

سيتم البناء على EAS cloud servers تلقائياً مع استخدام الـ keystore المحفوظ.

## تحميل الملفات المُنتَجة

بعد اكتمال البناء:

### من EAS Dashboard:
```
https://expo.dev/accounts/[your-account]/projects/mutabaka/builds
```

ستجد:
- 📦 **AAB file** - للنشر على Google Play Store
- 📱 **APK file** - للتوزيع المباشر والاختبار

### رابط تحميل مباشر:
سيتم إرسال رابط تحميل مباشر عبر البريد الإلكتروني المسجل في Expo account.

## البدائل

### إذا أردت Build محلي:
```bash
cd mobile

# بناء AAB
eas build --platform android --profile production --local

# بناء APK
eas build --platform android --profile preview --local
```

⚠️ **ملاحظة:** Local builds تحتاج إلى:
- Android SDK مثبت
- Java JDK 17+
- مساحة تخزين كافية (>10GB)

## إدارة Credentials

### عرض جميع الـ credentials:
```bash
eas credentials
```

### حذف وإعادة إنشاء keystore:
```bash
eas credentials -p android
# اختر: Remove Keystore
# ثم أعد تشغيل: eas build --platform android
```

⚠️ **تحذير مهم جداً:**
- **لا تحذف** الـ keystore بعد نشر التطبيق على Play Store
- إذا فقدت الـ keystore، لن تستطيع تحديث التطبيق أبداً!
- احتفظ بنسخة احتياطية آمنة

## الأسئلة الشائعة

### س: هل يمكن استخدام keystore موجود مسبقاً؟
نعم:
```bash
eas credentials -p android
# اختر: Set up a new keystore from a local file
```

### س: كيف أحفظ نسخة احتياطية من الـ keystore؟
```bash
eas credentials -p android
# اختر: Download credentials
```

### س: ما الفرق بين production و preview profiles؟
- **production**: AAB موقّع للنشر على Google Play
- **preview**: APK للتوزيع المباشر والاختبار

### س: كم تستغرق عملية البناء على EAS؟
- عادة: 10-15 دقيقة
- يعتمد على حجم المشروع وعدد الطلبات

## مصادر إضافية

- [EAS Build Documentation](https://docs.expo.dev/build/introduction/)
- [Android Credentials Guide](https://docs.expo.dev/app-signing/android-credentials/)
- [Automating with GitHub Actions](https://docs.expo.dev/build-reference/automating-submissions/)
