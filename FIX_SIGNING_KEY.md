# إصلاح مشكلة التوقيع الخاطئ للـ AAB

## 🚨 المشكلة

Google Play Console رفض الـ AAB لأنه موقّع بـ keystore خاطئ:

**المتوقع (الأصلي):**
```
SHA1: 1D:63:52:EC:EA:F0:35:D3:EB:BF:BF:2F:83:D7:D2:59:43:E1:2E:99
```

**الحالي (الجديد - خاطئ):**
```
SHA1: E8:0E:0A:EE:51:4F:4D:42:F8:23:74:57:99:C6:96:B1:4F:C2:77:E3
```

## ✅ الحل: استبدال Keystore على EAS

### الخطوة 1: حذف الـ Keystore الخاطئ

في نافذة الـ terminal الحالية التي تعرض خيارات EAS credentials:

1. اختر: **`Delete your keystore`**
2. أكد الحذف بـ: **`Yes`**

### الخطوة 2: رفع الـ Keystore الصحيح

بعد حذف الـ keystore الخاطئ:

```bash
cd f:\mtk\mobile
eas credentials -p android
```

سيسألك:
```
? What do you want to do?
  > Set up a new keystore
```

اختر: **`Set up a new keystore`**

ثم اختر: **`Use an existing keystore`** أو **`Set up a new keystore from a local file`**

### الخطوة 3: تحديد الملف

عندما يسألك عن مسار الملف:

```
Path to keystore file: @mutabaka__mobile.jks
```

أدخل:
```
@mutabaka__mobile.jks
```

### الخطوة 4: إدخال معلومات الـ Keystore

سيسألك عن:

1. **Keystore password:** `android` (أو كلمة المرور الصحيحة)
2. **Key alias:** (اضغط Enter لاستخدام الافتراضي أو أدخل الـ alias الصحيح)
3. **Key password:** `android` (أو كلمة المرور الصحيحة)

### الخطوة 5: التحقق من SHA1

بعد الرفع، تحقق من أن SHA1 أصبح صحيحاً:

```bash
eas credentials -p android
```

يجب أن ترى:
```
SHA1 Fingerprint: 1D:63:52:EC:EA:F0:35:D3:EB:BF:BF:2F:83:D7:D2:59:43:E1:2E:99 ✅
```

---

## 🔄 إعادة البناء

بعد استبدال الـ keystore:

### الطريقة 1: عبر GitHub Actions (موصى به)

1. اذهب إلى: https://github.com/Lebid15/mutabaka/actions
2. اختر: **Build Android APK & AAB**
3. اضغط: **Run workflow**

### الطريقة 2: محلياً

```bash
cd mobile
eas build --platform android --profile production
```

---

## 📝 ملاحظات مهمة

### إذا كانت كلمة مرور الـ Keystore غير `android`:

قد تحتاج لتجربة:
- كلمة المرور المحفوظة لديك
- كلمة مرور فارغة (اضغط Enter فقط)
- كلمة مرور مختلفة

### إذا لم تعرف الـ Key Alias:

يمكنك عرض محتوى الـ keystore أولاً:

**إذا كان لديك Java مثبت:**
```bash
keytool -list -v -keystore @mutabaka__mobile.jks
```

**إذا لم يكن Java مثبتاً:**
سيسألك EAS عن الـ alias، جرّب:
- `mutabaka`
- `upload`
- `key0`
- الـ alias الافتراضي (اضغط Enter)

---

## ✅ التحقق النهائي

بعد رفع الـ AAB الجديد إلى Google Play:

1. افتح Google Play Console
2. اذهب إلى: **Release → Production → Create new release**
3. ارفع الـ `.aab` الجديد
4. يجب أن يُقبل بدون أخطاء ✅

---

## 🎯 الخلاصة

1. ✅ حذف الـ keystore الخاطئ من EAS
2. ✅ رفع الـ keystore الصحيح (`@mutabaka__mobile.jks`)
3. ✅ التحقق من SHA1
4. ✅ إعادة البناء
5. ✅ رفع إلى Google Play

---

## 🆘 إذا واجهت مشكلة

أخبرني بـ:
1. رسالة الخطأ الكاملة
2. هل تعرف كلمة مرور الـ keystore؟
3. هل تعرف الـ key alias؟
