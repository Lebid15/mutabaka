# Backend Backend Core (الخطة الذهبية – المراحل 1-2)

## المتطلبات
- Python 3.12+
- تفعيل بيئة افتراضية (venv)

## خطوات أول مرة
```bash
pip install django
python manage.py makemigrations accounts finance
python manage.py migrate
python manage.py createsuperuser
python manage.py seed_currencies
```
بعد إنشاء أي مستخدم جديد سيتم إنشاء المحافظ الأربع تلقائياً (إشارة post_save).

## التطبيقات الحالية
- accounts: نموذج مستخدم مخصص `CustomUser`.
- finance: عملات + محافظ + واجهة قراءة المحافظ.
- communications: جهات اتصال، محادثات، رسائل، معاملات مالية.

### حقول المحادثة (Conversation) الجديدة
- `last_message_at`: تاريخ/وقت آخر رسالة (أي نوع).
- `last_activity_at`: آخر نشاط (رسالة أو معاملة) لسهولة الترتيب.
- `last_message_preview`: نص مختصر لأحدث رسالة (حتى 120 حرف).

### منطق المعاملة
3. إنشاء رسالة من نوع `transaction` في نفس المحادثة مع نص عربي واضح.
4. تحديث الحقول الوصفية للمحادثة.

### ملخص المحادثة
`GET /api/conversations/{id}/summary/` يرجع صافي الأرصدة لكل عملة (من منظور user_a >0 يعني الطرف الآخر مدين لـ user_a).

تم تفعيل Simple JWT:
- تحقق: `POST /api/auth/token/verify/`


## أهم المسارات (Endpoints)
| البحث عن مستخدم | GET | /api/users/?q=ali |
| جهات الاتصال | GET/POST | /api/contacts/ |
| ملخص المحادثة | GET | /api/conversations/{id}/summary/ |
| إنشاء معاملة | POST | /api/transactions/ |
| المحافظ | GET | /api/wallets/ |
| JWT توكن | POST | /api/auth/token/ |

## نقاط مضافة حديثاً
### 1. نقطة صافي الحركة (Net Balance)
`GET /api/conversations/{id}/net_balance/` تحسب الصافي المعتمد فقط على سجل المعاملات (وليس أرصدة المحافظ الحالية). الحقل `net_from_user_a_perspective`:
- موجب: الطرف الآخر (user_b) مدين لـ user_a.
- سالب: user_a مدين للطرف الآخر.

المنطق الحالي:
| الحالة | التأثير على صافي user_a |
|--------|--------------------------|
| direction = lna & actor = user_a | +amount |
| direction = lna & actor = user_b | -amount |
| direction = lkm & actor = user_a | -amount |
| direction = lkm & actor = user_b | +amount |

### 2. التصفح (Pagination)
تم تفعيل `LimitOffsetPagination` افتراضياً.
استخدم `?limit=50&offset=0` على القوائم (مثل `/api/transactions/`). القيمة الافتراضية `PAGE_SIZE=50`.

### 3. الحدود (Throttling)
تم ضبط:
```
anon: 100/hour
user: 1000/hour
auth_token: 20/minute (طلب إصدار التوكن)
transaction: 60/minute (إنشاء معاملات)
```
يمكن تعديل المعدلات في `REST_FRAMEWORK['DEFAULT_THROTTLE_RATES']`.

### 4. تحسين الاستعلامات
استخدام `select_related` و `prefetch` في الـ ViewSets الأساسية لتقليل عدد الاستعلامات خاصة للرسائل والمعاملات.

### 5. WebSockets (بناء مبدئي)
تمت إضافة قناة محادثة فورية عبر `channels` و `daphne`:
- المسار: `ws://<HOST>/ws/conversations/<conversation_id>/`
- يتطلب جلسة مصادقة (Session) حالياً (AuthMiddlewareStack).
- أي نص يُرسل على القناة يتم تخزينه كرسالة نوع `text` ويُبث لباقي الأعضاء.

ستتم إضافة دعم JWT عبر query param لاحقاً: `?token=<ACCESS_TOKEN>` مع Middleware مخصص.

### 6. تسجيل الدخول بالبريد أو اسم المستخدم
تم توسيع منطق طلب التوكن للسماح بحقل `username` الذي يقبل اسم المستخدم أو البريد.

## خطط لاحقة (مستقبلية)
- WebSocket JWT (دعم تمرير التوكن في Query / Subprotocol) + التحقق داخل Consumer.
- نقل Channel Layer إلى Redis في الإنتاج (`channels-redis`).
- اختبارات WebSocket (باستخدام `channels.testing.WebsocketCommunicator`).
- إصدار Endpoint لتدقيق (Audit Trail) المعاملات المفصلة.
- دعم فترات زمنية (Time windows) لتقارير صافي تراكمي.
- تنبيه فوري عند تغيّر صافي عملة يتجاوز حد.

### إعداد Redis اختياري (مستقبلاً)
أضف الحزمة:
```
pip install channels-redis
```
ثم في `settings.py`:
```python
import os
REDIS_URL = os.environ.get('REDIS_URL', 'redis://127.0.0.1:6379/0')
CHANNEL_LAYERS = {
		'default': {
				'BACKEND': 'channels_redis.core.RedisChannelLayer',
				'CONFIG': { 'hosts': [REDIS_URL] }
		}
}
```

### مثال تواصل WebSocket (JavaScript)
```js
const ws = new WebSocket(`wss://example.com/ws/conversations/123/`);
ws.onmessage = ev => {
	const data = JSON.parse(ev.data);
	console.log('New message', data);
};
ws.onopen = () => ws.send('مرحبا');
```

### ملاحظات أمان مستقبلية
- تقليل مدة صلاحية التوكن مع Refresh سريع.
- إضافة فحص صلاحيات داخل المستهلك (Consumer) للرسائل من حيث الطول والمحتوى.
- منع رسائل فارغة أو طويلة جداً (مطبق جزئياً حالياً).

### تشغيل محلي مختصر
```bash
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py seed_currencies
python manage.py runserver
```

## أوامر متاحة
- `python manage.py seed_currencies`  لزرع العملات (لن يكرر الموجود).

---
تم تنفيذ الأساس المطلوب للواجهة الأمامية ويمكن الآن البدء بالدمج.

## Web Push (إشعارات الرسائل)

تمت إضافة دعم إشعارات Web Push لإرسال تنبيه عند وصول رسالة جديدة حتى عند إغلاق التبويب.

### المتطلبات
- مفاتيح VAPID (عام/خاص)
- متصفح يدعم Push + Service Worker

### الإعداد محلياً
1) أنشئ ملف `.env` في مجلد `backend/` وأضف:

```
VAPID_PUBLIC_KEY=BK...your_public_key
VAPID_PRIVATE_KEY=KJ...your_private_key
VAPID_CONTACT_EMAIL=mailto:you@example.com
```

2) ثبت الحزم وشغّل المهاجرات:
```
pip install -r requirements.txt
python manage.py migrate
```

3) الواجهة الأمامية: في `frontend/.env.local` ضع نفس المفتاح العام:
```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=BK...your_public_key
NEXT_PUBLIC_API_HOST=localhost
NEXT_PUBLIC_API_PORT=8000
```

4) شغّل الخادمين (backend, frontend) وتأكد من فتح الموقع على `http://localhost` (المعتمد كأصل آمن للتطوير).

### الاستخدام
- من واجهة الإعدادات في الواجهة الأمامية: اضغط "تفعيل الإشعارات" لمنح الإذن، تسجيل Service Worker، وإنشاء الاشتراك وتخزينه في الخادم.
- عند وصول رسالة جديدة، سيقوم الخادم بإرسال Web Push لكل اشتراك للمستلم. يظهر عنوان الإشعار باسم المرسل ونصه معاينة للرسالة.
- عند النقر على الإشعار، سيفتح المتصفح الصفحة `/conversation/<id>` مباشرة أو يركّز التبويب المفتوح.

### نقاط تقنية
- أي فشل إرسال برمز 404/410 يؤدي إلى حذف الاشتراك المتعطّل تلقائياً.
- يتم إرسال Push لكل رسالة حالياً دون منطق الكتم/الهدوء.
- الأيقونة المؤقتة: `frontend/public/icons/notification.png`.
