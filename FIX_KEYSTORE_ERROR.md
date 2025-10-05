# حل خطأ: Generating a new Keystore is not supported in --non-interactive mode

## المشكلة
```
Generating a new Keystore is not supported in --non-interactive mode
Error: build command failed.
Error: Process completed with exit code 1.
```

## السبب
GitHub Actions workflow يعمل في وضع `--non-interactive` ولا يستطيع إنشاء Android keystore تلقائياً.

## الحل السريع

### الخطوة 1: إنشاء Credentials على EAS (مرة واحدة فقط)

على جهازك المحلي:

```bash
cd mobile
eas login
eas build --platform android --profile production
```

عندما يسألك:
- **Generate a new Android Keystore?** → اضغط `Yes`
- **Enter Keystore password:** → أدخل كلمة مرور قوية (احفظها!)

⏳ انتظر اكتمال البناء (يمكنك إلغاؤه بعد رفع الـ credentials بنجاح)

### الخطوة 2: التحقق من Credentials

```bash
eas credentials -p android
```

يجب أن تشاهد:
```
✔ Android Keystore
  Keystore: ✔ Configured
```

### الخطوة 3: إعادة تشغيل GitHub Workflow

الآن يمكنك تشغيل workflow من GitHub Actions:
1. اذهب إلى **Actions**
2. اختر **Build Android APK & AAB**
3. اضغط **Run workflow**

✅ سيعمل بنجاح!

## ما الذي تغيّر في الـ Workflow؟

### قبل الإصلاح ❌
```yaml
# كان يحاول إنشاء keystore مؤقت محلياً
eas build --platform android --local --non-interactive
```

**المشاكل:**
- Local builds تحتاج Android SDK كامل
- Keystore مؤقت غير آمن
- فشل في الوضع non-interactive

### بعد الإصلاح ✅
```yaml
# يستخدم EAS Cloud Build مع credentials محفوظة
eas build --platform android --profile production --non-interactive
```

**المزايا:**
- ✅ بناء على سيرفرات EAS (أسرع وأقوى)
- ✅ استخدام keystore آمن محفوظ على EAS
- ✅ لا حاجة لـ Android SDK على runner
- ✅ يعمل في الوضع non-interactive بدون مشاكل

## التحميل بعد البناء

البناءات تتم على سيرفرات EAS وليس GitHub. للتحميل:

### من EAS Dashboard:
```
https://expo.dev/accounts/[your-account]/projects/mutabaka/builds
```

### من البريد الإلكتروني:
ستصلك رسالة مع رابط تحميل مباشر عند اكتمال البناء.

## ملاحظات مهمة

⚠️ **احفظ نسخة احتياطية من الـ Keystore:**
```bash
eas credentials -p android
# اختر: Download credentials
```

⚠️ **لا تحذف الـ Keystore بعد النشر!**
- إذا فقدت الـ keystore، لن تستطيع تحديث التطبيق على Google Play
- احفظ النسخة الاحتياطية في مكان آمن

## الملفات التي تم تعديلها

1. **`.github/workflows/apk.yml`**
   - إزالة خطوات Android SDK setup
   - إزالة خطوة إنشاء keystore مؤقت
   - تغيير من `--local` إلى cloud builds
   - إزالة artifact uploads (لأن الملفات على EAS)

2. **`SETUP_ANDROID_CREDENTIALS.md`** (جديد)
   - دليل شامل لإعداد الـ credentials
   - شرح EAS Build
   - استكشاف الأخطاء

3. **`GOOGLE_PLAY_RELEASE_NEW.md`** (جديد)
   - دليل محدّث للنشر على Google Play
   - يشرح الطريقة الجديدة مع EAS Cloud

## التحقق من النجاح

بعد تطبيق الحل، يجب أن ترى في GitHub Actions:

```
✅ Verify Expo authentication
   You are logged in as [your-account]

✅ Build Android AAB for Production
   🏗️ Building AAB bundle for Google Play...
   Build queued successfully

✅ Build Android APK for Testing
   🏗️ Building APK for testing/distribution...
   Build queued successfully

✅ Build completion notice
   📥 Download your builds from: https://expo.dev/...
```

## المساعدة

إذا واجهت أي مشاكل:

1. **تحقق من EXPO_TOKEN:**
   ```bash
   # على جهازك
   eas whoami --token
   
   # أضفه في GitHub:
   Settings → Secrets → EXPO_TOKEN
   ```

2. **تحقق من الـ credentials:**
   ```bash
   eas credentials -p android
   ```

3. **راجع الوثائق:**
   - [SETUP_ANDROID_CREDENTIALS.md](./SETUP_ANDROID_CREDENTIALS.md)
   - [GOOGLE_PLAY_RELEASE_NEW.md](./GOOGLE_PLAY_RELEASE_NEW.md)

## الخلاصة

✅ **تم الحل بنجاح!**

الآن workflow يستخدم EAS Cloud Builds بدلاً من local builds، مما يحل المشكلة نهائياً.

فقط تأكد من إنشاء الـ credentials مرة واحدة على جهازك المحلي، وبعدها سيعمل workflow تلقائياً في كل مرة.
