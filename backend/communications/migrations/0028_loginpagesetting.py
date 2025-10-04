from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("communications", "0027_update_wallet_settlement_text"),
    ]

    operations = [
        migrations.CreateModel(
            name="LoginPageSetting",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("login_logo", models.ImageField(blank=True, help_text="شعار مخصص لشاشة تسجيل الدخول (يُستخدم إن وجد بدل الشعار العام)", null=True, upload_to="branding/login/")),
                ("qr_overlay_logo", models.ImageField(blank=True, help_text="شعار صغير يُعرض داخل رمز QR (اختياري)", null=True, upload_to="branding/login/")),
                ("hero_title", models.CharField(default="طريقة تسجيل الدخول إلى حسابك في موقع مطابقة ويب:", help_text="العنوان الرئيسي الظاهر أعلى التعليمات", max_length=255)),
                ("hero_description", models.TextField(blank=True, help_text="وصف مختصر يظهر تحت العنوان الرئيسي (اختياري)")),
                ("instructions_title", models.CharField(blank=True, help_text="عنوان قسم الخطوات (مثلاً: خطوات ربط الجهاز)", max_length=255)),
                ("stay_logged_in_label", models.CharField(default="ابقَ مسجل الدخول على هذا المتصفح", help_text="النص بجانب مربع الاختيار للبقاء متصلاً", max_length=255)),
                ("stay_logged_in_hint", models.CharField(blank=True, help_text="شرح موجز يظهر بجانب خيار البقاء متصلاً (اختياري)", max_length=255)),
                ("alternate_login_label", models.CharField(blank=True, help_text="نص رابط تسجيل الدخول البديل (مثل تسجيل الدخول برقم الهاتف)", max_length=255)),
                ("alternate_login_url", models.CharField(blank=True, help_text="الرابط المستخدم لزر/رابط تسجيل الدخول البديل", max_length=512)),
                ("footer_links_label", models.CharField(blank=True, help_text="نص موحد لروابط السياسة والشروط إن رغبت بإظهاره في سطر منفصل", max_length=255)),
                ("footer_note", models.CharField(blank=True, help_text="نص يظهر أعلى روابط التذييل (اختياري)", max_length=255)),
                ("footer_secondary_note", models.CharField(blank=True, help_text="نص سفلي إضافي للتذييل (مثال: جميع الحقوق محفوظة)", max_length=255)),
                ("footer_brand_name", models.CharField(default="Mutabaka", help_text="اسم العلامة التجارية الذي سيظهر في التذييل", max_length=120)),
                ("footer_year_override", models.CharField(blank=True, help_text="اكتب سنة مخصصة إن رغبت (اتركه فارغًا لاستخدام السنة الحالية)", max_length=16)),
                ("is_active", models.BooleanField(default=True, verbose_name="مُفعل؟")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "ordering": ["-updated_at", "-id"],
                "verbose_name": "إعداد صفحة تسجيل الدخول",
                "verbose_name_plural": "إعدادات صفحة تسجيل الدخول",
            },
        ),
        migrations.CreateModel(
            name="LoginInstruction",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("title", models.CharField(blank=True, help_text="عنوان قصير أو جزء مميز ضمن الخطوة (اختياري)", max_length=255)),
                ("description", models.TextField(help_text="نص الخطوة (يمكن إدخال HTML بسيط)")),
                ("icon_hint", models.CharField(blank=True, help_text="إشارة أو رمز صغير يظهر بجانب الخطوة (اختياري، مثل اسم أيقونة)", max_length=64)),
                ("display_order", models.PositiveIntegerField(default=0, help_text="الترتيب التصاعدي للعرض")),
                ("is_active", models.BooleanField(default=True, verbose_name="مُفعل؟")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("page", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="instructions", to="communications.loginpagesetting", verbose_name="الإعداد المرتبط")),
            ],
            options={
                "ordering": ["display_order", "id"],
                "verbose_name": "تعليمات تسجيل الدخول",
                "verbose_name_plural": "تعليمات تسجيل الدخول",
            },
        ),
    ]
