# دليل رفع التطبيق على Google Play

## الخطوات

### 1. بناء ملف AAB
1. اذهب إلى [GitHub Actions](https://github.com/Lebid15/mutabaka/actions)
2. اختر **Build Android APK & AAB**
3. اضغط **Run workflow** → **Run workflow**
4. انتظر اكتمال البناء (~10-15 دقيقة)

### 2. تحميل AAB
1. افتح الـ workflow المكتمل
2. في قسم **Artifacts** ستجد:
   - `mutabaka-aab` ← **هذا للرفع على Google Play**
   - `mutabaka-apk` ← للاختبار فقط
3. حمّل ملف `mutabaka-aab`

### 3. رفع على Google Play Console
1. افتح [Google Play Console](https://play.google.com/console)
2. اختر تطبيق **مطابقة**
3. اذهب إلى **Release** → **Production** (أو **Internal testing** للاختبار)
4. اضغط **Create new release**
5. ارفع ملف `Mutabaka-release.aab`
6. أكمل باقي التفاصيل (Release notes, etc.)
7. اضغط **Review release** → **Start rollout**

## معلومات الإصدار

### Version Name
يتم أخذه من `mobile/app.json`:
```json
{
  "expo": {
    "version": "1.0.0"  ← هذا هو versionName
  }
}
```

لتغيير الإصدار:
1. عدّل `version` في `mobile/app.json`
2. ادفع التغييرات إلى GitHub
3. شغّل الـ workflow مرة أخرى

### Version Code
- يزيد **تلقائياً** في كل مرة تبني AAB production
- لا حاجة لتعديله يدوياً
- يُدار عبر `eas.json` → `production.autoIncrement: true`

## التوقيع (App Signing)

### الوضع الحالي
- ✅ Google Play تدير المفتاح الرسمي (App Signing by Google Play)
- ✅ الـ workflow يستخدم keystore مؤقت للبناء المحلي
- ✅ Google تعيد توقيع التطبيق تلقائياً عند الرفع

### لا حاجة لـ:
- ❌ رفع keystore يدوياً
- ❌ إدارة مفاتيح التوقيع
- ❌ القلق بشأن فقدان المفتاح

## استكشاف الأخطاء

### الـ workflow فشل؟
1. تحقق من **EXPO_TOKEN** في GitHub Secrets
2. تأكد من أن dependencies محدثة في `mobile/package.json`
3. راجع logs الـ workflow للتفاصيل

### AAB مرفوض من Google Play؟
1. تأكد من أن versionCode أكبر من الإصدار السابق
2. تحقق من أن التطبيق موقّع بشكل صحيح
3. راجع App integrity في Play Console

### حجم AAB كبير؟
- AAB عادةً أكبر من APK، لكن Google تحسّنه تلقائياً
- المستخدمون يحملون نسخة محسّنة (APK splits)
- لتقليل الحجم: راجع `android/app/build.gradle` → enableSeparateBuildPerCPUArchitecture

## روابط مفيدة
- [Google Play Console](https://play.google.com/console)
- [App Signing by Google Play](https://support.google.com/googleplay/android-developer/answer/9842756)
- [Expo EAS Build](https://docs.expo.dev/build/introduction/)
