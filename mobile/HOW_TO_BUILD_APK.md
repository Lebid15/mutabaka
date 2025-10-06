# 🚀 دليل بناء APK محلياً - تطبيق مطابقة

## ✅ المتطلبات
- ✅ Node.js 22.17.1
- ✅ Java JDK 17+
- ✅ Android SDK

## 📦 البناء المحلي

### 1. تثبيت المكتبات
```bash
cd f:\mtk\mobile
npm install
```

### 2. بناء APK
```bash
cd android
.\gradlew clean assembleRelease
```

### 3. موقع الملف
```
android\app\build\outputs\apk\release\app-release.apk
```

## 🔔 ملاحظات مهمة للإشعارات

### تم إصلاح مشكلة الإشعارات بإضافة:

**في `AndroidManifest.xml`:**
```xml
<!-- إذن إلزامي لـ Android 13+ -->
<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
```

### خطوات الاختبار:
1. احذف التطبيق القديم من الهاتف
2. ثبت الـ APK الجديد
3. عند فتح التطبيق، سيظهر طلب إذن الإشعارات
4. اضغط "السماح" / "Allow"
5. سجل الدخول وجرب إرسال إشعار

## 🔄 البناء عبر EAS (للنشر)

```bash
cd f:\mtk\mobile
npx eas-cli build --platform android --profile preview
```

## 📝 التغييرات الأخيرة
- ✅ إضافة إذن POST_NOTIFICATIONS
- ✅ تحديث `.easignore` لتقليل حجم الأرشيف
- ✅ إعدادات Firebase موجودة ومضبوطة
- ✅ أيقونات الإشعارات مخصصة

## 🐛 حل المشاكل

### الإشعارات لا تعمل؟
1. تأكد من السماح بالإذن في إعدادات الهاتف
2. تحقق من صلاحية Firebase Token
3. افحص Firebase Console للأخطاء

### البناء فشل؟
```bash
cd android
.\gradlew clean
cd ..
Remove-Item -Recurse -Force node_modules
npm install
cd android
.\gradlew assembleRelease
```

---
**آخر تحديث:** 6 أكتوبر 2025
