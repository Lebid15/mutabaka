# إصدار تطبيق Mutabaka على Google Play Store

## المتطلبات الأولية

### 1. إعداد Android Credentials (مرة واحدة فقط)

⚠️ **مهم جداً:** يجب إعداد الـ credentials قبل استخدام GitHub Actions

```bash
# على جهازك المحلي
cd mobile
eas login
eas build --platform android --profile production
```

سيسألك EAS عن إنشاء keystore جديد:
- اختر: **Yes** لإنشاء keystore جديد
- أدخل كلمة مرور قوية واحفظها في مكان آمن
- سيتم رفع الـ keystore إلى EAS servers تلقائياً

✅ بعد هذه الخطوة، لن تحتاج لتكرارها مرة أخرى

📖 **للمزيد من التفاصيل:** راجع [SETUP_ANDROID_CREDENTIALS.md](./SETUP_ANDROID_CREDENTIALS.md)

### 2. التحقق من Expo Token في GitHub

تأكد من وجود `EXPO_TOKEN` في GitHub Secrets:

1. اذهب إلى: **Settings** → **Secrets and variables** → **Actions**
2. تحقق من وجود `EXPO_TOKEN`
3. إذا لم يكن موجوداً:
   ```bash
   # على جهازك المحلي
   eas login
   eas whoami --token
   # انسخ الـ token وأضفه في GitHub Secrets
   ```

## طريقة الإصدار

### الخطوة 1: تحديث رقم الإصدار

في ملف `mobile/app.json`:

```json
{
  "expo": {
    "version": "1.0.1",  // 👈 حدّث هذا الرقم
    "android": {
      "versionCode": 2   // 👈 سيتم زيادته تلقائياً بواسطة EAS
    }
  }
}
```

**ملاحظة:** `versionCode` سيزداد تلقائياً بفضل `"autoIncrement": true` في `eas.json`

### الخطوة 2: Push التغييرات

```bash
git add mobile/app.json
git commit -m "Bump version to 1.0.1"
git push origin main
```

### الخطوة 3: تشغيل Build Workflow

#### من واجهة GitHub:

1. اذهب إلى **Actions** → **Build Android APK & AAB**
2. اضغط **Run workflow**
3. اختر branch: `main`
4. اضغط **Run workflow** الأخضر

#### من سطر الأوامر (اختياري):

```bash
gh workflow run "Build Android APK & AAB"
```

### الخطوة 4: انتظار اكتمال البناء

- ⏱️ يستغرق البناء عادة **10-15 دقيقة**
- 🔍 راقب التقدم في: https://expo.dev/accounts/[your-account]/projects/mutabaka/builds
- 📧 ستستلم إشعار عبر البريد الإلكتروني عند اكتمال البناء

### الخطوة 5: تحميل الملفات

#### من EAS Dashboard:

```
https://expo.dev/accounts/[your-account]/projects/mutabaka/builds
```

ستجد build جديد مع:
- 📦 **Mutabaka-v1.0.1.aab** - للنشر على Google Play
- 📱 **Mutabaka-v1.0.1.apk** - للتوزيع المباشر

#### الرابط المباشر:
سيتم إرسال رابط تحميل مباشر عبر البريد الإلكتروني.

### الخطوة 6: رفع AAB إلى Google Play Console

1. اذهب إلى: https://play.google.com/console
2. اختر تطبيق **Mutabaka**
3. من القائمة الجانبية: **Release** → **Production**
4. اضغط **Create new release**
5. ارفع ملف `.aab` المُحمّل
6. أضف Release notes بالعربية والإنجليزية
7. اضغط **Review release**
8. اضغط **Start rollout to Production**

## ما الذي يحدث في الـ Workflow؟

الـ workflow الآن يستخدم **EAS Cloud Builds**:

```yaml
eas build --platform android --profile production --non-interactive
eas build --platform android --profile preview --non-interactive
```

المزايا:
- ✅ لا حاجة لتثبيت Android SDK على GitHub runner
- ✅ بناء أسرع وأكثر استقراراً
- ✅ استخدام تلقائي للـ keystore المحفوظ على EAS
- ✅ لا مشاكل مع الوضع `--non-interactive`

## Build Profiles

### Production Profile
```json
"production": {
  "autoIncrement": true  // زيادة versionCode تلقائياً
}
```

- ينتج: **AAB** موقّع للنشر على Google Play
- يزيد `versionCode` تلقائياً عند كل build
- يستخدم keystore الإنتاجي من EAS

### Preview Profile
```json
"preview": {
  "distribution": "internal"
}
```

- ينتج: **APK** للتوزيع المباشر
- مناسب للاختبار الداخلي
- لا يحتاج Google Play Console

## استكشاف الأخطاء

### خطأ: "Generating a new Keystore is not supported in --non-interactive mode"

**السبب:** لم يتم إعداد credentials على EAS

**الحل:**
```bash
cd mobile
eas build --platform android --profile production
# اتبع التعليمات لإنشاء keystore جديد
```

### خطأ: "EXPO_TOKEN is not set"

**الحل:**
```bash
# الحصول على token
eas login
eas whoami --token

# إضافته في GitHub:
# Settings → Secrets → New repository secret
# Name: EXPO_TOKEN
# Value: [paste token here]
```

### Build فشل على EAS

**الحل:**
1. تحقق من logs في EAS Dashboard
2. تأكد من صحة `app.json` و `eas.json`
3. تحقق من dependencies في `package.json`

## بناء محلي (اختياري)

إذا أردت البناء على جهازك:

```bash
cd mobile

# بناء AAB للإنتاج
eas build --platform android --profile production --local

# بناء APK للاختبار  
eas build --platform android --profile preview --local
```

**المتطلبات:**
- Android SDK
- Java JDK 17+
- مساحة تخزين >10GB

## النسخ الاحتياطي للـ Keystore

⚠️ **مهم جداً:**

```bash
# تحميل نسخة احتياطية
eas credentials -p android
# اختر: Download credentials
```

**احفظ الملف في:**
- مكان آمن خارج المشروع
- خدمة سحابية مشفرة (مثل: 1Password, LastPass)
- **لا ترفعه** إلى Git أبداً!

## الإصدارات السابقة

يمكنك عرض جميع الإصدارات السابقة في:
```
https://expo.dev/accounts/[your-account]/projects/mutabaka/builds
```

## مصادر إضافية

- [EAS Build Guide](https://docs.expo.dev/build/introduction/)
- [Android App Signing](https://docs.expo.dev/app-signing/android-credentials/)
- [Google Play Publishing](https://docs.expo.dev/submit/android/)
