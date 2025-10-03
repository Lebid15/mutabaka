"""
استخدام Expo's Push Notification Tool للاختبار
بدون الحاجة لـ FCM Server Key
"""

# يمكنك إرسال إشعارات تجريبية باستخدام:
# https://expo.dev/notifications

# أو استخدم EAS Build للحصول على APK يعمل مع Push Notifications:

"""
خطوات EAS Build (الحل النهائي):

1. تثبيت EAS CLI:
   npm install -g eas-cli

2. تسجيل الدخول:
   eas login

3. تهيئة المشروع:
   cd f:\mtk\mobile
   eas build:configure

4. بناء APK للتطوير:
   eas build --platform android --profile development

5. تثبيت APK على الهاتف

بعد ذلك، Push Notifications ستعمل بدون أي Server Key! ✅
"""

print(__doc__)
