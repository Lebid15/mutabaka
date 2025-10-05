# GitHub Actions Workflows

## Build Android APK & AAB

### الوصف
يقوم هذا الـ workflow ببناء ملفي APK و AAB لتطبيق مطابقة تلقائياً.

### الملفات الناتجة
- **AAB** (`Mutabaka-release.aab`): للرفع على Google Play Store
- **APK** (`Mutabaka-release.apk`): للاختبار والتوزيع المباشر

### كيفية التشغيل
1. اذهب إلى **Actions** → **Build Android APK & AAB**
2. اضغط **Run workflow**
3. انتظر اكتمال البناء (~10-15 دقيقة)
4. حمّل الملفات من **Artifacts**

### الإصدارات (Versioning)
- **versionName**: يُؤخذ من `mobile/app.json` → `expo.version`
- **versionCode**: يزيد تلقائياً عبر `eas.json` → `production.autoIncrement: true`

### التوقيع (Signing)
- يستخدم keystore مؤقت للبناء المحلي
- Google Play تدير المفتاح الرسمي (App Signing Key)
- لا حاجة لرفع keystore يدوياً

### المسارات
- المصدر: `mobile/`
- المخرجات: `mobile/dist/`
- Artifacts: يتم رفعها تلقائياً بعد البناء

### متطلبات
- `EXPO_TOKEN` في GitHub Secrets (للمصادقة مع Expo)

---

## Deploy Workflow

يقوم بنشر Backend (Django) و Frontend (Next.js) على السيرفر تلقائياً عند الـ push على `main`.
