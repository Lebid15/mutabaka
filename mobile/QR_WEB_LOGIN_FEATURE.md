# ميزة ربط الجوال بالمتصفح (QR Web Login)

## 📱 نظرة عامة

تم إضافة ميزة جديدة تسمح للمستخدمين بتسجيل الدخول إلى موقع مطابقة من المتصفح عن طريق مسح رمز QR من تطبيق الموبايل، مثل نظام WhatsApp Web.

## ✨ الميزات المضافة

### 1. **Backend (Django)** ✅
- جميع الـ APIs جاهزة ومكتملة
- `LoginQrCreateView` - إنشاء رمز QR جديد
- `LoginQrStatusView` - التحقق من حالة المصادقة
- `LoginQrApproveView` - الموافقة على تسجيل الدخول من الموبايل
- نموذج `WebLoginSession` لإدارة الجلسات

### 2. **Frontend (Next.js)** ✅
- صفحة تسجيل الدخول تعرض QR Code تلقائياً
- تحديث تلقائي للـ QR كل 90 ثانية
- مراقبة حالة الموافقة real-time
- تسجيل دخول تلقائي بعد المسح

### 3. **Mobile App (React Native + Expo)** ✅ الجديد

#### الملفات المضافة:
```
mobile/
├── src/
│   ├── screens/
│   │   └── QrScannerScreen.tsx         # شاشة مسح QR الجديدة
│   └── services/
│       └── qrLogin.ts                  # خدمة API لربط المتصفح
├── app.json                             # تم تحديثه (scheme + camera permission)
└── package.json                         # تم تحديثه (expo-camera)
```

#### التعديلات:
1. **package.json**
   - إضافة `expo-camera: ~16.0.7`

2. **app.json**
   - إضافة `scheme: "mutabaka"` للـ deep linking
   - إضافة plugin `expo-camera` مع صلاحية الكاميرا

3. **src/navigation/index.tsx**
   - إضافة `QrScanner` إلى `RootStackParamList`
   - تسجيل `QrScannerScreen` في Stack Navigator

4. **src/screens/HomeScreen.tsx**
   - إضافة عنصر جديد في القائمة: "ربط الجوال بالمتصفح"
   - تحديث `MenuAction` type
   - تحديث `MenuItem` interface

## 🎯 كيفية الاستخدام

### للمستخدم:
1. افتح موقع مطابقة من المتصفح
2. افتح تطبيق مطابقة على الموبايل
3. اضغط على القائمة (☰)
4. اختر "ربط الجوال بالمتصفح"
5. امسح رمز QR من المتصفح
6. سيتم تسجيل الدخول تلقائياً في المتصفح

### للمطور:

#### تثبيت المكتبات:
```bash
cd mobile
npm install
```

#### تشغيل التطبيق:
```bash
# Android
npm run android

# iOS
npm run ios
```

#### إعادة البناء (للـ native changes):
```bash
npx expo prebuild --clean
```

## 🔐 الأمان

- جميع الجلسات لها مدة صلاحية (90 ثانية افتراضياً)
- كل رمز QR يُستخدم مرة واحدة فقط
- التحقق من Device ID و Access Token
- Token hashing على مستوى قاعدة البيانات
- إنشاء جهاز جديد (web) لكل ربط

## 🛠️ التقنيات المستخدمة

- **expo-camera** - للوصول إلى الكاميرا ومسح QR codes
- **Deep Linking** - معالجة الروابط `mutabaka://link`
- **Django REST Framework** - APIs على الباكند
- **React Native Navigation** - التنقل بين الشاشات

## 📝 ملاحظات

1. **الصلاحيات**: التطبيق يطلب إذن الكاميرا عند أول استخدام
2. **الشاشة**: تعرض واجهة مستخدم جميلة مع إرشادات واضحة
3. **معالجة الأخطاء**: رسائل خطأ واضحة بالعربية للمستخدم
4. **التوافق**: يعمل على Android و iOS

## 🐛 استكشاف الأخطاء

### المشكلة: لا تظهر الشاشة في القائمة
**الحل**: تأكد من تثبيت المكتبات وإعادة بناء التطبيق

### المشكلة: الكاميرا لا تعمل
**الحل**: تحقق من صلاحية الكاميرا في إعدادات الجهاز

### المشكلة: "رمز QR منتهي الصلاحية"
**الحل**: حدّث الصفحة في المتصفح لإنشاء رمز جديد

## 📚 المراجع

- [Expo Camera Documentation](https://docs.expo.dev/versions/latest/sdk/camera/)
- [Deep Linking Guide](https://reactnavigation.org/docs/deep-linking/)
- [Django REST Framework](https://www.django-rest-framework.org/)

---

تم التنفيذ بنجاح! ✅ 🎉
